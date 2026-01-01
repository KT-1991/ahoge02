import { ref, computed, nextTick, watch } from 'vue';
import { AaFileManager, type AaEntry, type EncodingType } from '../utils/AaFileManager';

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

    // --- History Logic (変更なし) ---
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

    // --- File Operations (変更なし) ---
    const addNewAA = () => { const num = projectAAs.value.length + 1; projectAAs.value.push({ title: `Untitled ${num}`, content: '' }); currentAAIndex.value = projectAAs.value.length - 1; resetHistory(); showToastMessage('New Page Added'); };
    const deleteAA = (idx: number) => { if (confirm('Are you sure?')) { if (projectAAs.value.length <= 1) { projectAAs.value[0] = { title: 'Untitled 1', content: '' }; currentAAIndex.value = 0; } else { projectAAs.value.splice(idx, 1); if (currentAAIndex.value >= projectAAs.value.length) { currentAAIndex.value = projectAAs.value.length - 1; } } resetHistory(); showToastMessage('Page Deleted'); } };
    const onLoadFile = async (file: File) => { if (!file) return; try { const entries = await AaFileManager.loadFile(file, loadEncoding.value); entries.forEach(e => projectAAs.value.push(e)); currentAAIndex.value = projectAAs.value.length - entries.length; resetHistory(); showToastMessage(`Loaded ${entries.length} AAs`); } catch (e) { console.error(e); showToastMessage('Load Failed'); } };
    const onSaveFile = (format: 'AST'|'MLT', encoding: 'SJIS'|'UTF8') => { console.log(encoding); const content = format === 'MLT' ? projectAAs.value.map(a => `[AA][${a.title}]\n${a.content}\n`).join('') : aaOutput.value; const blob = new Blob([content], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `aa_project.${format.toLowerCase()}`; a.click(); URL.revokeObjectURL(url); showToastMessage('File Saved'); };
    const triggerCopy = async (mode: 'normal' | 'bbs') => { try { await navigator.clipboard.writeText(aaOutput.value); showToastMessage(mode === 'bbs' ? 'Copied for BBS!' : 'Copied!'); } catch (e) { showToastMessage('Copy Failed'); } };
    const handlePaste = (e: ClipboardEvent, textarea: HTMLTextAreaElement) => { console.log(e.target); nextTick(() => commitHistory()); console.log(textarea.value) };
    const applyTextEdit = (type: string, fontName: string) => { console.log(fontName); const text = aaOutput.value; const lines = text.split('\n'); let newText = text; if (type === 'trim-end') newText = lines.map(l => l.replace(/[ 　\u2009]+$/, '')).join('\n'); else if (type === 'add-start-space') newText = lines.map(l => '　' + l).join('\n'); else if (type === 'trim-start') newText = lines.map(l => l.replace(/^[ 　]+/, '')).join('\n'); else if (type === 'remove-empty') newText = lines.filter(l => l.trim().length > 0).join('\n'); if (newText !== text) { aaOutput.value = newText; nextTick(() => commitHistory()); showToastMessage('Applied!'); } };

    // --- ★変更: Syntax Highlight Logic (BBS Mode) ---
    const updateSyntaxHighlight = (bbsMode: boolean) => {
        if (!bbsMode) {
            highlightedHTML.value = '';
            return;
        }
        
        let text = aaOutput.value;
        // HTMLエスケープ (XSS対策)
        text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 1. 行頭の半角スペース (警告色)
        // マルチラインモード(m)で、行頭(^)の半角スペース( +)を置換
        text = text.replace(/^( +)/gm, '<span class="warn-leading-space">$1</span>');

        // 2. 連続する半角スペース (警告色)
        // 2つ以上連続する場合
        text = text.replace(/( {2,})/g, '<span class="warn-consecutive-space">$1</span>');

        // 3. アンカー (青色)
        // >>数字 のパターン
        text = text.replace(/(&gt;&gt;\d+)/g, '<span class="bbs-anchor">$1</span>');

        highlightedHTML.value = text;
    };

    // --- Watchers ---
    watch(currentAAIndex, () => { resetHistory(); });
    watch(aaOutput, (newVal) => {
        if (!isHistoryNavigating.value) _pushToStack(newVal);
        // テキスト変更時にハイライト更新（設定状態はApp.vueから渡されるため、ここではリアクティブに反応できないが、
        // 実際にはApp.vue側のwatchで制御するか、ここでstoreを持つ必要がある。
        // 簡易的に、外部から updateSyntaxHighlight を呼ぶ設計にする。
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