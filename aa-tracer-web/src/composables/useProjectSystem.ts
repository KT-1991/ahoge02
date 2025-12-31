import { ref, computed, nextTick, watch } from 'vue';
import { AaFileManager, type AaEntry, type EncodingType, type FileFormat } from '../utils/AaFileManager';

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

    // --- History Logic (省略なし) ---
    const pushHistory = (text: string) => {
        if (historyIndex.value < historyStack.value.length - 1) {
            historyStack.value = historyStack.value.slice(0, historyIndex.value + 1);
        }
        if (historyStack.value[historyIndex.value] === text) return;
        historyStack.value.push(text);
        historyIndex.value++;
        if (historyStack.value.length > 2000) { historyStack.value.shift(); historyIndex.value--; }
    };
    const commitHistory = () => { pushHistory(aaOutput.value); };
    const undo = () => {
        if (historyIndex.value > 0) {
            isHistoryNavigating.value = true;
            historyIndex.value--;
            aaOutput.value = historyStack.value[historyIndex.value]!;
            nextTick(() => isHistoryNavigating.value = false);
        }
    };
    const redo = () => {
        if (historyIndex.value < historyStack.value.length - 1) {
            isHistoryNavigating.value = true;
            historyIndex.value++;
            aaOutput.value = historyStack.value[historyIndex.value]!;
            nextTick(() => isHistoryNavigating.value = false);
        }
    };
    const resetHistory = () => { historyStack.value = [aaOutput.value]; historyIndex.value = 0; };
    const recordCharHistory = (char: string) => {
        historyChars.value = historyChars.value.filter(c => c !== char);
        historyChars.value.unshift(char);
        if (historyChars.value.length > 50) historyChars.value.pop();
    };

    // --- Actions ---
    const addNewAA = () => {
        const num = projectAAs.value.length + 1;
        projectAAs.value.push({ title: `Untitled ${num}`, content: '' });
        currentAAIndex.value = projectAAs.value.length - 1;
    };
    const deleteAA = (idx: number) => {
        if (projectAAs.value.length <= 1) {
            projectAAs.value[0]!.content = ''; projectAAs.value[0]!.title = 'Untitled 1'; return;
        }
        projectAAs.value.splice(idx, 1);
        if (currentAAIndex.value >= projectAAs.value.length) currentAAIndex.value = projectAAs.value.length - 1;
    };

    // ★修正: ハイライト更新ロジック (強化版)
    const updateSyntaxHighlight = (safeMode: boolean) => {
        if (!safeMode) {
            highlightedHTML.value = '';
            return;
        }
        
        const text = aaOutput.value;
        const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = text.split('\n');
        
        highlightedHTML.value = lines.map(line => {
            let processedLine = '';
            const charArray = [...line]; // サロゲートペア対策

            // 1. 文字単位チェック (Shift-JIS非互換)
            for (const char of charArray) {
                const escaped = escapeHtml(char);
                if (char.charCodeAt(0) <= 0x7E) {
                    processedLine += escaped;
                } else {
                    const safeChar = AaFileManager.encodeToBbsSafe(char);
                    if (safeChar !== char) {
                        processedLine += `<span class="err-char" title="Shift-JIS非互換">${escaped}</span>`;
                    } else {
                        processedLine += escaped;
                    }
                }
            }

            // 2. パターンマッチング (エスケープ済みの文字列に対して適用)
            
            // 行頭の半角スペース (警告色)
            processedLine = processedLine.replace(/^( +)/, (m) => `<span class="err-lead">${m}</span>`);
            
            // 連続する半角スペース (警告色)
            // ※行頭処理の後に行うことで、行頭以外の連続スペースを検出
            processedLine = processedLine.replace(/( {2,})/g, (m) => `<span class="err-seq">${m}</span>`);
            
            // アンカー (>>1, ＞１など) (青色など)
            // > は &gt; にエスケープされていることに注意
            processedLine = processedLine.replace(/((?:&gt;|＞)+[0-9０-９]+)/g, `<span class="anchor-highlight">$1</span>`);

            return processedLine;
        }).join('\n');
    };

    // ★修正: ペースト処理 (実体参照デコード)
    const handlePaste = (e: ClipboardEvent, textarea: HTMLTextAreaElement) => {
        e.preventDefault();
        const rawText = e.clipboardData?.getData('text/plain') || '';
        
        // 数値実体参照 (&#9999; 等) をデコード
        const decodedText = AaFileManager.decodeEntities(rawText);

        // カーソル位置に挿入
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentVal = aaOutput.value;
        
        commitHistory(); // 変更前に履歴保存
        aaOutput.value = currentVal.substring(0, start) + decodedText + currentVal.substring(end);
        
        nextTick(() => {
            textarea.selectionStart = textarea.selectionEnd = start + decodedText.length;
            commitHistory(); // 変更後に履歴保存
        });
    };

    // ... (File I/O, Toast, etc. は変更なし) ...
    const showToastMessage = (msg: string) => { toastMessage.value = msg; showToast.value = true; setTimeout(() => { showToast.value = false; }, 2000); };
    const triggerCopy = async (mode: 'normal' | 'bbs') => {
        let text = aaOutput.value;
        if (mode === 'bbs') text = AaFileManager.encodeToBbsSafe(text);
        try { await navigator.clipboard.writeText(text); showToastMessage(mode === 'bbs' ? 'Copied (BBS Safe)!' : 'Copied!'); } 
        catch (err) { console.error(err); showToastMessage('Copy Failed'); }
    };
    const onSaveFile = (format: FileFormat, encoding: EncodingType) => {
        const ext = format === 'AST' ? '.ast' : '.mlt'; const name = `aa_project${ext}`;
        AaFileManager.saveFile(projectAAs.value, encoding, format, name);
    };
    const onLoadFile = async (file: File) => {
        try {
            const loaded = await AaFileManager.loadFile(file, loadEncoding.value);
            if (loaded.length > 0) { projectAAs.value = loaded; currentAAIndex.value = 0; resetHistory(); return true; }
        } catch (err) { console.error(err); } return false;
    };
    const applyTextEdit = (type: string, customFontName: string) => {
        // ... (前のコードと同じ) ...
        console.log(customFontName);
        // 簡易実装:
        commitHistory();
        const text = aaOutput.value;
        const lines = text.split('\n');
        let newText = text;
        if (type === 'trim-end') newText = lines.map(l => l.replace(/[ 　\u2009]+$/, '')).join('\n');
        else if (type === 'add-end-space') newText = lines.map(l => l + '　').join('\n');
        else if (type === 'trim-start') newText = lines.map(l => l.replace(/^　/, '')).join('\n');
        else if (type === 'add-start-space') newText = lines.map(l => '　' + l).join('\n');
        else if (type === 'remove-empty') newText = lines.filter(l => l.length > 0).join('\n');
        else if (type === 'align-right') { /* ... */ } 
        aaOutput.value = newText;
        nextTick(() => commitHistory());
        showToastMessage('Applied!');
    };

    // Watchers
    watch(currentAAIndex, () => { resetHistory(); });
    watch(aaOutput, (newVal) => { if (!isHistoryNavigating.value) pushHistory(newVal); });

    return {
        projectAAs, currentAAIndex, aaOutput, historyStack, historyIndex, historyChars,
        highlightedHTML, // export
        showToast, toastMessage, loadEncoding,
        addNewAA, deleteAA, recordCharHistory, commitHistory, undo, redo, resetHistory,
        updateSyntaxHighlight, // export
        handlePaste, // export
        applyTextEdit, triggerCopy, onSaveFile, onLoadFile, showToastMessage,
        moveCategory: (cats: any[], idx: number, dir: number) => { console.log(cats, idx, dir) },
        removeCategory: (cats: any[], id: string) => { console.log(cats, id) }
    };
}