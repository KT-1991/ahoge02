import { ref, computed, nextTick, watch } from 'vue';
import { AaFileManager, type AaEntry, type EncodingType } from '../utils/AaFileManager';
import Encoding from 'encoding-japanese';

// 文字列のピクセル幅を計測するヘルパー関数
const measureWidth = (text: string, fontName: string): number => {
    if (typeof document === 'undefined') return 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `16px "${fontName}", "MS PGothic", sans-serif`;
    return ctx.measureText(text).width;
};

export function useProjectSystem() {
    // --- State ---
    const projectAAs = ref<AaEntry[]>([ { title: 'Untitled 1', content: '' } ]);
    const currentAAIndex = ref(0);
    const historyStack = ref<string[]>(['']);
    const historyIndex = ref(0);
    const isHistoryNavigating = ref(false);
    const historyChars = ref<string[]>([]);
    
    // Highlight State
    const highlightedHTML = ref('');
    
    // UI State
    const showToast = ref(false);
    const toastMessage = ref('');
    const loadEncoding = ref<EncodingType>('AUTO');

    // --- Computed ---
    const aaOutput = computed({
        get: () => projectAAs.value[currentAAIndex.value]?.content || '',
        set: (val) => {
            if (projectAAs.value[currentAAIndex.value]) {
                projectAAs.value[currentAAIndex.value]!.content = val;
            }
        }
    });

    const showToastMessage = (msg: string) => {
        toastMessage.value = msg;
        showToast.value = true;
        setTimeout(() => { showToast.value = false; }, 1500);
    };

    // --- History Logic ---
    const _pushToStack = (text: string) => {
        if (historyIndex.value < historyStack.value.length - 1) {
            historyStack.value = historyStack.value.slice(0, historyIndex.value + 1);
        }
        const last = historyStack.value[historyStack.value.length - 1];
        if (last !== text) {
            historyStack.value.push(text);
            if (historyStack.value.length > 1000) historyStack.value.shift();
            else historyIndex.value++;
        }
    };
    const commitHistory = () => { if (!isHistoryNavigating.value) _pushToStack(aaOutput.value); };
    const recordCharHistory = (char: string) => { if (!char || char.length > 10) return; if (!historyChars.value.includes(char) && char.trim() !== '') { historyChars.value.unshift(char); if (historyChars.value.length > 20) historyChars.value.pop(); } };
    const undo = () => { if (historyIndex.value > 0) { isHistoryNavigating.value = true; historyIndex.value--; aaOutput.value = historyStack.value[historyIndex.value]!; nextTick(() => { isHistoryNavigating.value = false; }); } else { showToastMessage('No Undo history'); } };
    const redo = () => { if (historyIndex.value < historyStack.value.length - 1) { isHistoryNavigating.value = true; historyIndex.value++; aaOutput.value = historyStack.value[historyIndex.value]!; nextTick(() => { isHistoryNavigating.value = false; }); } else { showToastMessage('No Redo history'); } };
    const resetHistory = () => { historyStack.value = [aaOutput.value]; historyIndex.value = 0; };

    // --- File Operations ---
    const addNewAA = () => { const num = projectAAs.value.length + 1; projectAAs.value.push({ title: `Untitled ${num}`, content: '' }); currentAAIndex.value = projectAAs.value.length - 1; resetHistory(); showToastMessage('New Page Added'); };
    const deleteAA = (idx: number) => { if (confirm('Are you sure?')) { if (projectAAs.value.length <= 1) { projectAAs.value[0] = { title: 'Untitled 1', content: '' }; currentAAIndex.value = 0; } else { projectAAs.value.splice(idx, 1); if (currentAAIndex.value >= projectAAs.value.length) { currentAAIndex.value = projectAAs.value.length - 1; } } resetHistory(); showToastMessage('Page Deleted'); } };
    const onLoadFile = async (file: File) => { if (!file) return; try { const entries = await AaFileManager.loadFile(file, loadEncoding.value); entries.forEach(e => projectAAs.value.push(e)); currentAAIndex.value = projectAAs.value.length - entries.length; resetHistory(); showToastMessage(`Loaded ${entries.length} AAs`); } catch (e) { console.error(e); showToastMessage('Load Failed'); } };
    
    // ファイル保存ロジック (3形式 × 2エンコード)
    const onSaveFile = (format: 'AST'|'MLT'|'TXT', encoding: 'SJIS'|'UTF8') => {
        let content = '';
        let ext = 'txt';

        if (format === 'MLT') {
            content = projectAAs.value.map(a => a.content).join('\n[SPLIT]\n');
            ext = 'mlt';
        } else if (format === 'AST') {
            content = projectAAs.value.map(a => `[AA][${a.title}]\n${a.content}\n`).join('');
            ext = 'ast';
        } else {
            content = aaOutput.value;
            ext = 'txt';
        }
        
        let blobParts: BlobPart[];
        let mimeType: string;

        if (encoding === 'SJIS') {
            const unicodeList = Encoding.stringToCode(content);
            const sjisCodeList = Encoding.convert(unicodeList, {
                to: 'SJIS',
                from: 'UNICODE',
                type: 'array'
            });
            const uint8Array = new Uint8Array(sjisCodeList);
            blobParts = [uint8Array];
            mimeType = 'text/plain;charset=shift_jis';
        } else {
            blobParts = [content];
            mimeType = 'text/plain;charset=utf-8';
        }

        const blob = new Blob(blobParts, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const baseName = format === 'TXT' 
            ? (projectAAs.value[currentAAIndex.value]?.title || 'aa')
            : 'aa_project';
            
        a.download = `${baseName}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        showToastMessage(`File Saved (.${ext})`);
    };

    // ★修正: Shift-JIS変換時に実体参照を使うコピー処理
    const triggerCopy = async (mode: 'normal' | 'bbs') => {
        try {
            let text = aaOutput.value;

            if (mode === 'bbs') {
                let safeText = '';
                // 文字単位でループ (サロゲートペアも考慮して for-of を使用)
                for (const char of text) {
                    // 1. 文字コードを取得
                    const unicodeList = Encoding.stringToCode(char);
                    
                    // 2. Shift-JISに変換してみる (配列で取得)
                    const sjisList = Encoding.convert(unicodeList, {
                        to: 'SJIS',
                        from: 'UNICODE',
                        type: 'array'
                    });

                    // 3. 判定: 元が'?'ではないのに、変換結果が'?'(63)になった場合は変換不能文字
                    // encoding-japanese は変換できない文字を 63 (?) に置換します
                    const isFallback = (sjisList.length === 1 && sjisList[0] === 63);
                    
                    if (isFallback && char !== '?') {
                        // Shift-JISに存在しない文字 -> 数値実体参照に置換 (例: &#12345;)
                        const codePoint = char.codePointAt(0);
                        safeText += `&#${codePoint};`;
                    } else {
                        // 変換可能、または元々'?'だった場合 -> そのまま結合
                        safeText += char;
                    }
                }
                text = safeText;
            }

            await navigator.clipboard.writeText(text);
            showToastMessage(mode === 'bbs' ? 'Copied for BBS (NCRs)!' : 'Copied!');
        } catch (e) {
            console.error(e);
            showToastMessage('Copy Failed');
        }
    };

    const handlePaste = (e: ClipboardEvent, textarea: HTMLTextAreaElement) => { console.log(e.target, textarea.value); nextTick(() => commitHistory()); };
    
    // テキスト編集ロジック (Align Right修正済み)
    const applyTextEdit = (type: string, fontName = 'Saitamaar') => {
        if (typeof commitHistory === 'function') commitHistory();
        
        const text = aaOutput.value;
        const lines = text.split('\n');
        let newLines: string[] = [];

        switch (type) {
            case 'add-end-space': newLines = lines.map(line => line + '　'); break;
            case 'trim-end': newLines = lines.map(line => line.replace(/[ 　\u2009]+$/, '')); break;
            case 'del-last-char': newLines = lines.map(line => { const chars = Array.from(line); if (chars.length > 0) chars.pop(); return chars.join(''); }); break;
            case 'add-start-space': newLines = lines.map(line => '　' + line); break;
            case 'trim-start': newLines = lines.map(line => line.replace(/^[ 　]/, '')); break;
            case 'remove-empty': newLines = lines.filter(line => line.trim().length > 0); break;
            case 'align-right': {
                const wZen = measureWidth('　', fontName);
                const wHan = measureWidth(' ', fontName);
                const wThin = measureWidth('\u2009', fontName); 
                const useThin = wThin > 0.1;

                let maxW = 0;
                const lineData = lines.map(line => {
                    const cleanLine = line.replace(/[ 　\u2009\|]+$/, ''); 
                    const w = measureWidth(cleanLine, fontName);
                    if (w > maxW) maxW = w;
                    return { text: cleanLine, width: w };
                });

                maxW += wZen; // マージン

                newLines = lineData.map(item => {
                    let remaining = maxW - item.width;
                    let spacer = '';
                    
                    if (wZen > 0) {
                        const count = Math.floor(remaining / wZen);
                        if (count > 0) { spacer += '　'.repeat(count); remaining -= count * wZen; }
                    }
                    if (wHan > 0) {
                        const count = Math.floor(remaining / wHan);
                        if (count > 0) { spacer += ' '.repeat(count); remaining -= count * wHan; }
                    }
                    if (useThin) {
                        const count = Math.round(remaining / wThin);
                        if (count > 0) spacer += '\u2009'.repeat(count);
                    } else {
                        if (remaining > wHan * 0.5) spacer += ' ';
                    }

                    return item.text + spacer + '|';
                });
                break;
            }
            default: return; 
        }
        aaOutput.value = newLines.join('\n');
        showToastMessage('Text Edit Applied');
    };

    // Syntax Highlight Logic (BBS Mode)
    const updateSyntaxHighlight = (bbsMode: boolean) => {
        if (!bbsMode) {
            highlightedHTML.value = '';
            return;
        }
        let text = aaOutput.value;
        text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        text = text.replace(/^( +)/gm, '<span class="warn-leading-space">$1</span>');
        text = text.replace(/( {2,})/g, '<span class="warn-consecutive-space">$1</span>');
        text = text.replace(/(&gt;&gt;\d+)/g, '<span class="bbs-anchor">$1</span>');
        highlightedHTML.value = text;
    };

    // --- Watchers ---
    watch(currentAAIndex, () => { resetHistory(); });
    watch(aaOutput, (newVal) => {
        if (!isHistoryNavigating.value) _pushToStack(newVal);
    });

    return {
        projectAAs, currentAAIndex, aaOutput, 
        historyStack, historyIndex, historyChars,
        highlightedHTML, showToast, toastMessage, loadEncoding,
        addNewAA, deleteAA, onLoadFile, onSaveFile,
        recordCharHistory, commitHistory, undo, redo, resetHistory,
        triggerCopy, handlePaste, applyTextEdit, updateSyntaxHighlight, showToastMessage
    };
}