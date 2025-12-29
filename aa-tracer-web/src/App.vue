<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from './utils/InferenceEngine';
import { FeatureExtractor } from './utils/FeatureExtractor';
import { AaFileManager, type AaEntry, type EncodingType, type FileFormat } from './utils/AaFileManager';

declare const cv: any;

// ★追加: 矩形選択の描画用配列
const boxSelectionRects = ref<Array<{ top: string, left: string, width: string, height: string }>>([]);

// --- Logic State ---
const engine = new InferenceEngine();
const status = ref('BOOTING...');
const isReady = ref(false);
const isProcessing = ref(false);

const sourceImage = ref<HTMLImageElement | null>(null);
const processedSource = ref<HTMLCanvasElement | null>(null);

// Paint Buffer (Offscreen Canvas)
let paintBuffer: HTMLCanvasElement | null = null;

// File I/O Settings
const loadEncoding = ref<EncodingType>('AUTO');

// Refs & Dims
const canvasRef = ref<HTMLCanvasElement | null>(null);     
const maskCanvasRef = ref<HTMLCanvasElement | null>(null); 
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);
const debugCanvasRef = ref<HTMLCanvasElement | null>(null);
const canvasDims = ref({ width: 0, height: 0 });

// --- Project State ---
const projectAAs = ref<AaEntry[]>([ { title: 'Untitled 1', content: '' } ]);
const currentAAIndex = ref(0);

const aaOutput = computed({
    get: () => projectAAs.value[currentAAIndex.value]?.content || '',
    set: (val) => {
        if (projectAAs.value[currentAAIndex.value]) {
            projectAAs.value[currentAAIndex.value]!.content = val;
        }
    }
});

// ★定義順序修正: historyChars (使用前に配置)
const historyChars = ref<string[]>([]);

const imageSize = ref({ w: 0, h: 0 });
const imgTransform = ref({ x: 0, y: 0, scale: 1.0, rotation: 0 });
const isDraggingImage = ref(false);
const lastMousePos = ref({ x: 0, y: 0 });

// Settings
const lineWeight = ref(0.6);
const thinningLevel = ref(0);
const customFontName = ref('Saitamaar');

// Font Stack
const fontStack = computed(() => {
    if (customFontName.value === 'Saitamaar') {
        return `'MSP_Parallel', 'Saitamaar'`;
    }
    return `'${customFontName.value}'`;
});

// Config
const config = ref({ 
    allowedChars: DEFAULT_CHARS, 
    useThinSpace: true, 
    safeMode: false,
    noiseGate: 0.3,
    generationMode: 'hybrid' as 'hybrid' | 'accurate' 
});

// 文字選択UI
const allCharCandidates = ref<string[]>(Array.from(new Set(DEFAULT_CHARS.split(''))));
const toggleAllowedChar = (char: string) => {
    let current = config.value.allowedChars;
    if (current.includes(char)) {
        config.value.allowedChars = current.replace(char, '');
    } else {
        config.value.allowedChars += char;
    }
    onConfigUpdate();
};

const fontMetrics = ref({ half: 0, full: 0, thin: 0 });
let spaceCombinations: { str: string, width: number }[] = [];

// Mode & Tools
const sidebarTab = ref<'palette' | 'image'>('palette');
const paintColor = ref<'blue' | 'red'>('blue');
const paintMode = ref<'brush' | 'bucket' | 'eraser' | 'move'>('move'); 
const brushSize = ref(10);
const targetCharBlue = ref(':');
const targetCharRed = ref('/');

// UI State
const traceOpacity = ref(30);
const aaTextColor = ref('#222222');    
const subTextColor = ref('#ffffff');   
const tracePaneRatio = ref(0.5); 
const isResizingPane = ref(false);
const editorStackRef = ref<HTMLElement | null>(null);
const showBackgroundImage = ref(true);

// Layout State
const viewMode = ref<'single' | 'split'>('single');
const splitDirection = ref<'horizontal' | 'vertical'>('horizontal');
const isLayoutSwapped = ref(false); 
const showLayoutMenu = ref(false);

// History System
const historyStack = ref<string[]>(['']);
const historyIndex = ref(0);
const isHistoryNavigating = ref(false);

const pushHistory = (text: string) => {
    if (historyIndex.value < historyStack.value.length - 1) {
        historyStack.value = historyStack.value.slice(0, historyIndex.value + 1);
    }
    if (historyStack.value[historyIndex.value] === text) return;

    historyStack.value.push(text);
    historyIndex.value++;

    if (historyStack.value.length > 2000) {
        historyStack.value.shift();
        historyIndex.value--;
    }
};

const commitHistory = () => {
    pushHistory(aaOutput.value);
};

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

watch(currentAAIndex, () => {
    historyStack.value = [aaOutput.value];
    historyIndex.value = 0;
    isHistoryNavigating.value = false;
});

const resetHistory = () => {
    historyStack.value = [aaOutput.value];
    historyIndex.value = 0;
};

// Syntax Highlight & Auto History
const highlightedHTML = ref('');
let highlightTimer: any = null;

const updateSyntaxHighlight = () => {
    if (!config.value.safeMode) {
        highlightedHTML.value = '';
        return;
    }
    if (highlightTimer) clearTimeout(highlightTimer);
    
    highlightTimer = setTimeout(() => {
        const text = aaOutput.value;
        const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = text.split('\n');
        const processedLines = lines.map(line => {
            let safeLine = escapeHtml(line);
            const leadMatch = safeLine.match(/^ +/);
            let leadLen = 0;
            let leadStr = "";
            let restStr = safeLine;
            if (leadMatch) {
                leadLen = leadMatch[0].length;
                leadStr = `<span class="err-lead">${leadMatch[0]}</span>`;
                restStr = safeLine.substring(leadLen);
            }
            const seqStr = restStr
                .replace(/ {2,}/g, (match) => `<span class="err-seq">${match}</span>`)
                .replace(/(?:&gt;|＞)+[0-9０-９]+/g, (match) => `<span class="anchor-highlight">${match}</span>`);
            return leadStr + seqStr;
        });
        highlightedHTML.value = processedLines.join('\n');
    }, 100); 
};

watch(aaOutput, (newVal) => {
    updateSyntaxHighlight();
    if (isHistoryNavigating.value) return; 
    pushHistory(newVal);
});

// Caret Sync & Box Selection Helpers
const activeEditor = ref<'trace' | 'text' | null>(null);
const caretSyncPos = ref({ x: 0, y: 0 });
// ★定義順序修正: cursorInfo, lastCursorPos をここで定義
const cursorInfo = ref({ row: 1, col: 1, charCount: 0, px: 0 });
const lastCursorPos = ref({ row: 0, col: 0 });

// Box Selection State
const isAltPressed = ref(false);
const isBoxSelecting = ref(false);
const boxSelectPx = ref({ startX: 0, endX: 0, startRow: 0, endRow: 0 });
const showBoxOverlay = ref(false);

const getPosFromIndex = (text: string, index: number) => {
    const textBefore = text.substring(0, index);
    const row = (textBefore.match(/\n/g) || []).length;
    const lastNewLine = textBefore.lastIndexOf('\n');
    const col = index - (lastNewLine + 1);
    return { row, col };
};

// ピクセル計算ヘルパー
const getPixelWidthOfCol = (row: number, col: number, ctx: CanvasRenderingContext2D) => {
    const lines = aaOutput.value.split('\n');
    const line = lines[row] || "";
    const sub = [...line].slice(0, col).join(''); // サロゲートペア対応
    return ctx.measureText(sub).width;
};

const getCaretPixelAt = (row: number, col: number) => {
    const text = aaOutput.value;
    const lines = text.split('\n');
    const line = lines[row] || '';
    const sub = line.substring(0, col);
    
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${fontStack.value.replace(/'/g, '"')}`;
    const px = Math.round(ctx.measureText(sub).width);
    return { x: px, y: row * 16 };
};

// ★修正: 矩形選択の描画更新 (行ごとの矩形)
const updateBoxSelection = () => {
    if (!showBoxOverlay.value) {
        boxSelectionRects.value = [];
        return;
    }

    const minR = Math.min(boxSelectPx.value.startRow, boxSelectPx.value.endRow);
    const maxR = Math.max(boxSelectPx.value.startRow, boxSelectPx.value.endRow);
    
    const leftPx = Math.min(boxSelectPx.value.startX, boxSelectPx.value.endX);
    const rightPx = Math.max(boxSelectPx.value.startX, boxSelectPx.value.endX);
    const widthPx = Math.max(2, rightPx - leftPx); 

    const rects = [];
    
    for (let r = minR; r <= maxR; r++) {
        rects.push({
            top: `${r * 16}px`,
            left: `${leftPx + 16}px`, // padding考慮
            width: `${widthPx}px`,
            height: `16px`
        });
    }
    boxSelectionRects.value = rects;
};

// マウスイベント処理
const onTextareaMouseDown = (e: MouseEvent, source: 'trace' | 'text') => {
    activeEditor.value = source;
    if (isAltPressed.value || isBoxSelecting.value) {
        isBoxSelecting.value = true;
        showBoxOverlay.value = true;
        
        const textarea = e.target as HTMLTextAreaElement;
        
        setTimeout(() => {
            const selStart = textarea.selectionStart;
            const { row, col } = getPosFromIndex(textarea.value, selStart);
            
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.font = `16px ${fontStack.value.replace(/'/g, '"')}`; 
            
            const px = getPixelWidthOfCol(row, col, ctx);
            
            boxSelectPx.value.startRow = row;
            boxSelectPx.value.endRow = row;
            boxSelectPx.value.startX = px;
            boxSelectPx.value.endX = px;
            
            updateBoxSelection();
        }, 0);
    } else {
        showBoxOverlay.value = false;
    }
};

const onTextareaMouseMove = (e: MouseEvent, source: 'trace' | 'text') => {
    console.log(source)
    if (e.buttons === 1 && isBoxSelecting.value) {
        const textarea = e.target as HTMLTextAreaElement;
        const end = textarea.selectionEnd; 
        const { row, col } = getPosFromIndex(textarea.value, end);
        
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `16px ${fontStack.value.replace(/'/g, '"')}`; 

        const px = getPixelWidthOfCol(row, col, ctx);

        boxSelectPx.value.endRow = row;
        boxSelectPx.value.endX = px;
        
        updateBoxSelection();
    }
};

const onTextareaMouseUp = () => {
    // keep selection
};

const updateCaretSync = (e: Event | null, source: 'trace' | 'text') => {
    activeEditor.value = source;
    if (!e) return;
    const textarea = e.target as HTMLTextAreaElement;
    const selStart = textarea.selectionStart;
    const { row, col } = getPosFromIndex(textarea.value, selStart);
    
    if (!isAltPressed.value && !isBoxSelecting.value && e.type === 'mousedown') {
        showBoxOverlay.value = false;
    }

    const pos = getCaretPixelAt(row, col);
    caretSyncPos.value = { x: pos.x + 16, y: pos.y };
};

// 矩形編集ロジック
const getIndexFromPixelInLine = (line: string, targetPx: number, ctx: CanvasRenderingContext2D): number => {
    if (targetPx <= 0) return 0;
    let currentW = 0;
    const chars = [...line]; 
    for (let i = 0; i < chars.length; i++) {
        const charW = ctx.measureText(chars[i]!).width;
        if (currentW + charW / 2 > targetPx) return i;
        currentW += charW;
    }
    return chars.length;
};

const getPaddingString = (currentW: number, targetPx: number, ctx: CanvasRenderingContext2D): string => {
    if (currentW >= targetPx) return "";
    const spaceW = ctx.measureText(' ').width;
    const fullSpaceW = ctx.measureText('　').width;
    const diff = targetPx - currentW;
    const fullCount = Math.floor(diff / fullSpaceW);
    let padding = '　'.repeat(fullCount);
    let currentPadW = fullCount * fullSpaceW;
    const remaining = diff - currentPadW;
    const halfCount = Math.round(remaining / spaceW);
    padding += ' '.repeat(halfCount);
    return padding;
};

const copyBoxSelection = async () => {
    if (!showBoxOverlay.value) return;

    const minR = Math.min(boxSelectPx.value.startRow, boxSelectPx.value.endRow);
    const maxR = Math.max(boxSelectPx.value.startRow, boxSelectPx.value.endRow);
    const minX = Math.min(boxSelectPx.value.startX, boxSelectPx.value.endX);
    const maxX = Math.max(boxSelectPx.value.startX, boxSelectPx.value.endX);
    
    const lines = aaOutput.value.split('\n');
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${fontStack.value.replace(/'/g, '"')}`;

    let result = "";
    
    for (let r = minR; r <= maxR; r++) {
        const line = lines[r] || "";
        const startIdx = getIndexFromPixelInLine(line, minX, ctx);
        const endIdx = getIndexFromPixelInLine(line, maxX, ctx);
        
        let chunk = [...line].slice(startIdx, endIdx).join('');
        
        const currentW = ctx.measureText([...line].slice(0, endIdx).join('')).width;
        if (currentW < maxX) {
            const neededPad = getPaddingString(currentW, maxX, ctx);
            const linePixelW = ctx.measureText(line).width;
            if (linePixelW < minX) {
                 chunk = getPaddingString(0, maxX - minX, ctx);
            } else {
                chunk += neededPad;
            }
        }
        
        result += chunk + "\n";
    }
    result = result.slice(0, -1);
    
    try {
        await navigator.clipboard.writeText(result);
        showToastMessage(`Box Copied!`);
    } catch (e) { console.error(e); }
};

const pasteBoxSelection = async () => {
    try {
        const text = await navigator.clipboard.readText();
        const decodedText = AaFileManager.decodeEntities(text);
        const boxLines = decodedText.replace(/\r\n/g, '\n').split('\n');
        if (boxLines.length === 0) return;

        let targetPx = 0;
        let startRow = 0;

        if (isBoxSelecting.value) {
            targetPx = Math.min(boxSelectPx.value.startX, boxSelectPx.value.endX);
            startRow = Math.min(boxSelectPx.value.startRow, boxSelectPx.value.endRow);
        } else {
            const pos = getCaretPixelAt(lastCursorPos.value.row, lastCursorPos.value.col);
            targetPx = pos.x;
            startRow = lastCursorPos.value.row;
        }

        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `16px ${fontStack.value.replace(/'/g, '"')}`;

        commitHistory(); 

        const currentLines = aaOutput.value.split('\n');
        
        boxLines.forEach((bLine, i) => {
            const r = startRow + i;
            let lineContent = currentLines[r] || "";
            if (r >= currentLines.length) {
                lineContent = "";
                currentLines[r] = "";
            }

            const lineChars = [...lineContent];
            const currentLineW = ctx.measureText(lineContent).width;
            
            let insertIdx = 0;
            let paddingStr = "";

            if (currentLineW < targetPx) {
                insertIdx = lineChars.length;
                paddingStr = getPaddingString(currentLineW, targetPx, ctx);
            } else {
                insertIdx = getIndexFromPixelInLine(lineContent, targetPx, ctx);
            }

            const pasteW = ctx.measureText(bLine).width;
            const endPx = targetPx + pasteW;
            
            let deleteEndIdx = insertIdx;
            
            if (currentLineW > targetPx) {
                deleteEndIdx = getIndexFromPixelInLine(lineContent, endPx, ctx);
            }
            
            const before = lineChars.slice(0, insertIdx).join('');
            const after = lineChars.slice(deleteEndIdx).join(''); 
            
            currentLines[r] = before + paddingStr + bLine + after;
        });
        
        aaOutput.value = currentLines.join('\n');
        nextTick(() => commitHistory());
        showToastMessage('Box Pasted (Visual Overwrite)!');
        
    } catch (e) { console.error(e); }
};

// Palette UI State
const historyPaneRatio = ref(0.35); 
const isResizingPalette = ref(false);
const paletteContainerRef = ref<HTMLElement | null>(null);

const startResizePalette = () => {
    isResizingPalette.value = true;
    window.addEventListener('mousemove', onResizePalette);
    window.addEventListener('mouseup', stopResizePalette);
    document.body.style.cursor = 'row-resize';
};
const onResizePalette = (e: MouseEvent) => {
    if (!paletteContainerRef.value) return;
    const rect = paletteContainerRef.value.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    historyPaneRatio.value = Math.min(0.8, Math.max(0.1, offsetY / rect.height));
};
const stopResizePalette = () => {
    isResizingPalette.value = false;
    window.removeEventListener('mousemove', onResizePalette);
    window.removeEventListener('mouseup', stopResizePalette);
    document.body.style.cursor = '';
};

// Color Picker
const showColorPicker = ref(false);
const hueValue = ref(0);
const presetColors = [
    '#222222', '#ffffff', '#e60012', '#009944', '#0068b7', 
    '#f39800', '#fff100', '#8fc31f', '#00b7ee', '#920783'
];

const swapColors = () => {
    const temp = aaTextColor.value;
    aaTextColor.value = subTextColor.value;
    subTextColor.value = temp;
};

const updateHue = () => {
    aaTextColor.value = `hsl(${hueValue.value}, 70%, 50%)`;
};

const invertColor = () => {
    let hex = aaTextColor.value;
    if (hex.startsWith('#')) hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    aaTextColor.value = y > 128 ? '#222222' : '#ffffff';
};

// Menus & Modals
const showLoadMenu = ref(false);
const showSaveMenu = ref(false);
const showGridOverlay = ref(false);
const showConfigModal = ref(false);
const showExportModal = ref(false);
const showDebugModal = ref(false);
const showPaletteEditor = ref(false); 
const showCopyMenu = ref(false);
const showEditMenu = ref(false);
const showToast = ref(false);
const toastMessage = ref('');
const isExportingVideo = ref(false); 

const ghostText = ref('');
const ghostPos = ref({ x: 0, y: 0 });
const isGhostVisible = ref(false);
const mirrorRef = ref<HTMLElement | null>(null);

const scrollX = ref(0);
const scrollY = ref(0);

// --- ★Palette System (New) ---

interface Category {
    id: string;
    name: string;
    chars: string;
}

const defaultCategories: Category[] = [
    { id: '1', name: 'Basic Lines', chars: "─│┌┐└┘├┤┬┴┼━┃┏┓┛┗┣┳┫┻╋" },
    { id: '2', name: 'Special', chars: "｡､･ﾟヽヾゝゞ〃仝々〆〇ー―‐／＼〜∥｜…‥‘’“”" },
    { id: '3', name: 'Brackets', chars: "（）〔〕［］｛｝〈〉《》「」『』【】" },
    { id: '4', name: 'Math', chars: "＋－±×÷＝≠＜＞≦≧∞∴♂♀" },
    { id: '5', name: 'Greek', chars: "αβγδεζηθικλμνξοπρστυφχψω" },
    { id: '6', name: 'Cyrillic', chars: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ" },
    { id: '7', name: 'Face', chars: "∀´｀ωДдノ乙ξ" }
];

const categories = ref<Category[]>([]);
const currentCategoryId = ref<string>('1');
const editingCatId = ref<string | null>(null); 

const loadPaletteFromStorage = () => {
    const saved = localStorage.getItem('aa_palette_v1');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                categories.value = parsed;
            } else {
                categories.value = JSON.parse(JSON.stringify(defaultCategories));
            }
        } catch(e) {
            categories.value = JSON.parse(JSON.stringify(defaultCategories));
        }
    } else {
        categories.value = JSON.parse(JSON.stringify(defaultCategories));
    }
    if (categories.value.length > 0) {
        const exists = categories.value.some(c => c.id === currentCategoryId.value);
        if (!exists) currentCategoryId.value = categories.value[0]!.id;
    }
};
loadPaletteFromStorage();

const savePaletteToStorage = () => {
    localStorage.setItem('aa_palette_v1', JSON.stringify(categories.value));
};

const currentCategoryData = computed(() => {
    const found = categories.value.find(c => c.id === currentCategoryId.value);
    if (found) return found;
    if (categories.value.length > 0) return categories.value[0];
    return { id: 'dummy', name: 'Loading...', chars: '' }; 
});

const editingCategory = computed(() => {
    return categories.value.find(c => c.id === editingCatId.value);
});

const addCategory = () => {
    const newId = Date.now().toString();
    categories.value.push({ id: newId, name: 'New Category', chars: '' });
    editingCatId.value = newId;
    savePaletteToStorage();
};
const removeCategory = (id: string) => {
    if (confirm('Delete this category?')) {
        categories.value = categories.value.filter(c => c.id !== id);
        if (editingCatId.value === id) editingCatId.value = null;
        if (currentCategoryId.value === id && categories.value.length > 0) {
            currentCategoryId.value = categories.value[0]!.id;
        }
        savePaletteToStorage();
    }
};
const moveCategory = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= categories.value.length) return;
    const temp = categories.value[index];
    categories.value[index] = categories.value[newIndex]!;
    categories.value[newIndex] = temp!;
    savePaletteToStorage();
};

const recordCharHistory = (char: string) => {
    historyChars.value = historyChars.value.filter(c => c !== char);
    historyChars.value.unshift(char);
    if (historyChars.value.length > 50) historyChars.value.pop();
};

const addCharToOutput = (char: string) => {
    aaOutput.value += char;
    recordCharHistory(char);
    engine.recordUsage(char); 
};

// --- Lifecycle ---
onMounted(async () => {
  updateSyntaxHighlight();
  historyStack.value = [aaOutput.value];

  window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') isAltPressed.value = true;
  });
  window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') isAltPressed.value = false;
  });

  window.addEventListener('mouseup', onGlobalMouseUp);
  window.addEventListener('mousemove', onGlobalMouseMove);

  const checkCv = setInterval(async () => {
    if ((window as any).cvLoaded) {
      clearInterval(checkCv);
      status.value = 'LOADING AI...';
      try {
        await engine.init('/aa_model_a.onnx', '/Saitamaar.ttf', '/aa_chars.json', 'classifier', 'Saitamaar');
        
        // ★重要: メトリクスの初期化
        engine.updateFontMetrics('Saitamaar', config.value.allowedChars);

        const loadedChars = engine.getLoadedCharList();
        if (loadedChars.length > 0) {
            const newSet = ' ' + loadedChars;
            config.value.allowedChars = newSet;
            allCharCandidates.value = Array.from(loadedChars);
        }

        engine.updateAllowedChars(config.value.allowedChars);
        
        setTimeout(initSpaceMetrics, 500);
        status.value = 'READY';
        isReady.value = true;
      } catch (e) {
        status.value = 'ERROR';
        console.error(e);
      }
    }
  }, 100);
});

onUnmounted(() => {
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('mousemove', onGlobalMouseMove);
});

// --- Image & Paint System ---

const toImageSpace = (screenX: number, screenY: number) => {
    const { x, y, scale, rotation } = imgTransform.value;
    let dx = screenX - x;
    let dy = screenY - y;
    const rad = -rotation * Math.PI / 180;
    const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
    return { x: rx / scale, y: ry / scale };
};

const initPaintBuffer = (width: number, height: number) => {
    paintBuffer = document.createElement('canvas');
    paintBuffer.width = width;
    paintBuffer.height = height;
    const ctx = paintBuffer.getContext('2d', { willReadFrequently: true })!;
    ctx.clearRect(0, 0, width, height);
};

const renderAllCanvases = () => {
    if (!canvasRef.value || !paintCanvasRef.value) return;
    renderLayer(canvasRef.value, processedSource.value || sourceImage.value);
    if (paintBuffer) {
        renderLayer(paintCanvasRef.value, paintBuffer);
    }
};

const renderLayer = (targetCanvas: HTMLCanvasElement, source: HTMLImageElement | HTMLCanvasElement | null) => {
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
    const w = targetCanvas.width;
    const h = targetCanvas.height;
    ctx.clearRect(0, 0, w, h);
    
    if (!showBackgroundImage.value && targetCanvas === canvasRef.value) {
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h);
        return;
    }
    if (targetCanvas === canvasRef.value) {
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h);
    }

    if (!source) return;

    ctx.save();
    ctx.translate(imgTransform.value.x, imgTransform.value.y);
    ctx.rotate(imgTransform.value.rotation * Math.PI / 180);
    ctx.scale(imgTransform.value.scale, imgTransform.value.scale);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
};

const updateImageTransform = async () => { 
    await updateCanvasDimensions(); 
    renderAllCanvases(); 
};

// --- Mouse Interactions ---

const getPointerPosInCanvas = (e: MouseEvent) => {
    if (!paintMaskRef.value) return { x: 0, y: 0 };
    const rect = paintMaskRef.value.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

const onMouseDown = (e: MouseEvent) => {
    if (sidebarTab.value !== 'image') return;
    
    if (paintMode.value === 'move') {
        isDraggingImage.value = true;
        lastMousePos.value = { x: e.clientX, y: e.clientY };
        return;
    }
    
    if (!paintBuffer && sourceImage.value) {
        initPaintBuffer(sourceImage.value.width, sourceImage.value.height);
    }
    if (!paintBuffer) return;
    
    const screenPos = getPointerPosInCanvas(e);
    const imgPos = toImageSpace(screenPos.x, screenPos.y);
    
    if (paintMode.value === 'bucket') {
        performFloodFill(imgPos.x, imgPos.y, e.button === 2 || e.buttons === 2);
    } else {
        const ctx = paintBuffer.getContext('2d', { willReadFrequently: true })!;
        ctx.beginPath();
        ctx.moveTo(imgPos.x, imgPos.y);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        (window as any).isPaintDragging = true;
        (window as any).lastImgPos = imgPos;
        
        const isEraser = paintMode.value === 'eraser' || e.buttons === 2;
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
        }
        ctx.lineWidth = brushSize.value;
        ctx.lineTo(imgPos.x, imgPos.y);
        ctx.stroke();
        renderAllCanvases();
    }
};

const onGlobalMouseMove = (e: MouseEvent) => {
    if (isDraggingImage.value && paintMode.value === 'move') {
        const dx = e.clientX - lastMousePos.value.x;
        const dy = e.clientY - lastMousePos.value.y;
        imgTransform.value.x += dx;
        imgTransform.value.y += dy;
        lastMousePos.value = { x: e.clientX, y: e.clientY };
        renderAllCanvases();
        return;
    }

    if (sidebarTab.value === 'image' && (window as any).isPaintDragging && paintBuffer) {
        if (!paintMaskRef.value) return;
        const rect = paintMaskRef.value.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const imgPos = toImageSpace(screenX, screenY);
        const lastPos = (window as any).lastImgPos;

        const ctx = paintBuffer.getContext('2d', { willReadFrequently: true })!;
        ctx.lineWidth = brushSize.value;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const isEraser = paintMode.value === 'eraser' || e.buttons === 2;
        if (isEraser) {
            ctx.globalCompositeOperation = 'destination-out';
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
        }

        ctx.beginPath();
        ctx.moveTo(lastPos.x, lastPos.y);
        ctx.lineTo(imgPos.x, imgPos.y);
        ctx.stroke();

        (window as any).lastImgPos = imgPos;
        renderAllCanvases();
    }
};

const onGlobalMouseUp = () => {
    isDraggingImage.value = false;
    (window as any).isPaintDragging = false;
};

const performFloodFill = (imgX: number, imgY: number, isEraser: boolean) => {
    if (!paintBuffer || !sourceImage.value) return;
    const w = paintBuffer.width;
    const h = paintBuffer.height;
    if (imgX < 0 || imgY < 0 || imgX >= w || imgY >= h) return;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w; srcCanvas.height = h;
    const sCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
    
    if (processedSource.value) sCtx.drawImage(processedSource.value, 0, 0, w, h);
    else sCtx.drawImage(sourceImage.value, 0, 0, w, h);

    const srcMat = (window as any).cv.imread(srcCanvas);
    if (srcMat.channels() > 1) {
        (window as any).cv.cvtColor(srcMat, srcMat, (window as any).cv.COLOR_RGBA2GRAY);
    }
    (window as any).cv.threshold(srcMat, srcMat, 200, 255, (window as any).cv.THRESH_BINARY);

    const fillMask = new (window as any).cv.Mat.zeros(h + 2, w + 2, (window as any).cv.CV_8U);
    const seedPoint = new (window as any).cv.Point(Math.floor(imgX), Math.floor(imgY));
    const newVal = new (window as any).cv.Scalar(100);
    
    (window as any).cv.floodFill(srcMat, fillMask, seedPoint, newVal, new (window as any).cv.Rect(), new (window as any).cv.Scalar(5), new (window as any).cv.Scalar(5), 4);

    const pCtx = paintBuffer.getContext('2d', { willReadFrequently: true })!;
    const pData = pCtx.getImageData(0, 0, w, h);
    const data = pData.data;
    
    let color = [0, 0, 0, 0];
    if (!isEraser) {
        color = paintColor.value === 'blue' ? [0, 0, 255, 150] : [255, 0, 0, 150];
    }

    const maskPtr = fillMask.data;
    const maskStride = w + 2;
    
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const maskIdx = (y + 1) * maskStride + (x + 1);
            if (maskPtr[maskIdx] !== 0) { 
                const idx = (y * w + x) * 4;
                if (isEraser) {
                    data[idx + 3] = 0;
                } else {
                    data[idx] = color[0]!;
                    data[idx+1] = color[1]!;
                    data[idx+2] = color[2]!;
                    data[idx+3] = color[3]!;
                }
            }
        }
    }
    pCtx.putImageData(pData, 0, 0);
    srcMat.delete(); fillMask.delete();
    renderAllCanvases();
};

// --- Process Logic ---

const processImage = async () => {
  if (!sourceImage.value || isProcessing.value) return;
  if (!canvasRef.value) return;
  isProcessing.value = true; status.value = 'PROCESSING...';
  
  if (maskCanvasRef.value) {
      const ctx = maskCanvasRef.value.getContext('2d', { willReadFrequently: true })!;
      ctx.clearRect(0, 0, maskCanvasRef.value.width, maskCanvasRef.value.height);
  }
  
  let tempCtx: CanvasRenderingContext2D | null = null;
  
  if (paintBuffer) {
      const tempCvs = document.createElement('canvas');
      tempCvs.width = canvasRef.value.width;
      tempCvs.height = canvasRef.value.height;
      tempCtx = tempCvs.getContext('2d', { willReadFrequently: true })!;
      
      tempCtx.save();
      tempCtx.translate(imgTransform.value.x, imgTransform.value.y);
      tempCtx.rotate(imgTransform.value.rotation * Math.PI / 180);
      tempCtx.scale(imgTransform.value.scale, imgTransform.value.scale);
      tempCtx.drawImage(paintBuffer, 0, 0);
      tempCtx.restore();
  }

  renderLayer(canvasRef.value, processedSource.value || sourceImage.value);
  
  // ★重要: メトリクス更新
  engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

  setTimeout(async () => {
    try {
      const fullFeatures = FeatureExtractor.generate9ChInput(
          canvasRef.value!, 
          lineWeight.value, 
          thinningLevel.value
      );
      
      visualizeFeatureMap(fullFeatures, canvasRef.value!.width, canvasRef.value!.height);

      const w = canvasRef.value!.width; 
      const h = canvasRef.value!.height;
      const lineH = 16; const cropH = 32;
      let result = "";
      const imgBottom = (imgTransform.value.y + sourceImage.value!.height * imgTransform.value.scale) + 200; 
      const scanLimitY = Math.min(h, imgBottom);

      // コンテキスト準備
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `16px "${customFontName.value}"`;

      for (let y = cropH / 2; y < scanLimitY - cropH / 2; y += lineH) {
         status.value = `ROW ${Math.floor(y/16)}`;
         
         const lineLen = cropH * w * 9;
         const startIdx = (y - cropH/2) * w * 9;
         const lineFeat = fullFeatures.subarray(startIdx, startIdx + lineLen);
         
         let rowMaskData: Uint8ClampedArray | null = null;
         if (tempCtx) {
             const srcY = Math.floor(y - cropH/2);
             if (srcY >= 0 && srcY + 32 <= h) {
                 rowMaskData = tempCtx.getImageData(0, srcY, w, 32).data;
             }
         }
         
         // ★engine.solveLine にパラメータを渡す
         const lineText = await engine.solveLine(
             lineFeat, w, targetCharBlue.value, targetCharRed.value, 
             rowMaskData, y,
             config.value.generationMode, // 'hybrid' or 'accurate'
             ctx
         );
         
         result += lineText + "\n";
         aaOutput.value = result;
         await new Promise(r => setTimeout(r, 0));
      }
      status.value = 'DONE'; sidebarTab.value = 'palette';
      updateSyntaxHighlight();
    } catch (err) { console.error(err); status.value = 'ERROR'; } finally { isProcessing.value = false; }
  }, 50);
};

const visualizeFeatureMap = (features: Float32Array, width: number, height: number) => {
    if (!debugCanvasRef.value) return;
    const cvs = debugCanvasRef.value;
    cvs.width = width;
    cvs.height = height;
    const ctx = cvs.getContext('2d', { willReadFrequently: true })!;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;
    
    let minVal = Infinity;
    let maxVal = -Infinity;
    const len = width * height;
    
    for (let i = 0; i < len; i += 10) {
        const val = features[i * 9]!;
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
    }
    if (maxVal === minVal) { maxVal = minVal + 1; }
    
    for (let i = 0; i < len; i++) {
        const val = features[i * 9]!; 
        let color = Math.floor((val - minVal) / (maxVal - minVal) * 255);
        if (color < 0) color = 0;
        if (color > 255) color = 255;
        
        const idx = i * 4;
        data[idx] = color;
        data[idx + 1] = color;
        data[idx + 2] = color;
        data[idx + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
};

// --- Input Handling ---

const onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'c' && showBoxOverlay.value) {
        e.preventDefault();
        copyBoxSelection();
        return;
    }

    if (e.ctrlKey) {
        if (e.key === 'z') {
            e.preventDefault();
            undo();
            return;
        } else if (e.key === 'y' || (e.shiftKey && e.key === 'Z')) {
            e.preventDefault();
            redo();
            return;
        }
    }

    if (e.altKey) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); shiftSpace('narrow'); return; } 
        else if (e.key === 'ArrowRight') { e.preventDefault(); shiftSpace('wide'); return; }
    }
    
    const isConfirmKey = (e.code === 'Tab') || (e.shiftKey && e.code === 'Space');
    if (isConfirmKey) {
        if (isGhostVisible.value && ghostText.value) { 
            e.preventDefault(); 
            e.stopPropagation(); 
            insertGhostText(); 
        } else if (e.code === 'Tab') {
            e.preventDefault();
        }
        return;
    }
};

const onKeyPress = (e: KeyboardEvent) => {
    if (e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
    }
};

const onInput = (e: Event) => { 
    updateGhostDebounced(); 
    updateCursorInfo(e); 
    updateCaretSync(e, activeEditor.value || 'text');
};
const onKeyUp = (e: KeyboardEvent) => { 
    updateCursorInfo(null); 
    updateCaretSync(e, activeEditor.value || 'text');
};
const onClickText = () => { 
    updateGhost(); 
    updateCursorInfo(null);
};

const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    const decoded = AaFileManager.decodeEntities(text);
    const textarea = e.target as HTMLTextAreaElement;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = aaOutput.value;
    
    commitHistory();

    aaOutput.value = current.substring(0, start) + decoded + current.substring(end);
    
    nextTick(() => {
        textarea.selectionStart = textarea.selectionEnd = start + decoded.length;
        engine.recordUsage(decoded);
        updateGhost();
        const lastChar = decoded.slice(-1);
        if(lastChar) recordCharHistory(lastChar);
        commitHistory();
    });
};

const insertGhostText = () => {
    const textarea = document.querySelector('.aa-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const text = textarea.value; const insert = ghostText.value;
    aaOutput.value = text.substring(0, start) + insert + text.substring(end);
    nextTick(() => { 
        textarea.selectionStart = textarea.selectionEnd = start + insert.length; 
        engine.recordUsage(insert); 
        updateGhost(); 
        updateSyntaxHighlight();
    });
};
let debounceTimer: any = null;
const updateGhostDebounced = () => { if (debounceTimer) clearTimeout(debounceTimer); debounceTimer = setTimeout(updateGhost, 100); };
const updateGhost = async () => {
    if (!sourceImage.value || !canvasRef.value) { isGhostVisible.value = false; return; }
    const textarea = document.querySelector('.aa-textarea') as HTMLTextAreaElement;
    if (!textarea || !mirrorRef.value) return;
    const text = textarea.value; const caretIdx = textarea.selectionStart;
    const textBefore = text.substring(0, caretIdx);
    const lastNewLine = textBefore.lastIndexOf('\n');
    const lineTextBefore = textBefore.substring(lastNewLine + 1);
    const rowIdx = (textBefore.match(/\n/g) || []).length;
    mirrorRef.value.textContent = lineTextBefore;
    const caretPixelX = mirrorRef.value.clientWidth;
    if (caretPixelX >= canvasRef.value.width) { isGhostVisible.value = false; return; }
    const lineY = rowIdx * 16;
    if (lineY >= canvasRef.value.height) { isGhostVisible.value = false; return; }
    
    const rowCanvas = document.createElement('canvas');
    rowCanvas.width = canvasRef.value.width; rowCanvas.height = 32; 
    const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
    const srcY = Math.max(0, lineY - 8);
    const dstY = (lineY - 8 < 0) ? (8 - lineY) : 0; 
    rowCtx.drawImage(canvasRef.value, 0, srcY, canvasRef.value.width, 32, 0, dstY, canvasRef.value.width, 32);
    
    const features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, thinningLevel.value);
    
    let rowMaskData: Uint8ClampedArray | null = null;
    if (paintBuffer) {
        const maskCvs = document.createElement('canvas');
        maskCvs.width = canvasRef.value.width;
        maskCvs.height = 32;
        const mCtx = maskCvs.getContext('2d', { willReadFrequently: true })!;
        
        mCtx.save();
        mCtx.translate(imgTransform.value.x, imgTransform.value.y - srcY); 
        mCtx.rotate(imgTransform.value.rotation * Math.PI / 180);
        mCtx.scale(imgTransform.value.scale, imgTransform.value.scale);
        mCtx.drawImage(paintBuffer, 0, 0);
        mCtx.restore();
        
        rowMaskData = mCtx.getImageData(0, 0, maskCvs.width, 32).data;
    }

    const suggestion = await engine.suggestText(
        features, 
        rowCanvas.width, 
        caretPixelX, 
        rowMaskData, 
        targetCharBlue.value, 
        targetCharRed.value, 
        3
    );
    if (suggestion) { ghostText.value = suggestion; ghostPos.value = { x: caretPixelX, y: lineY }; isGhostVisible.value = true; } else { isGhostVisible.value = false; }
};

const onScroll = (e: Event) => { const target = e.target as HTMLElement; scrollX.value = target.scrollLeft; scrollY.value = target.scrollTop; };
//const getPointerPos = (e: MouseEvent, canvas: HTMLCanvasElement) => { const rect = canvas.getBoundingClientRect(); const scaleX = canvas.width / rect.width; const scaleY = canvas.height / rect.height; return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }; };
const onWheel = (e: WheelEvent) => { if (!sourceImage.value || sidebarTab.value !== 'image') return; e.preventDefault(); const zoomSpeed = 0.001; const delta = -e.deltaY * zoomSpeed; const newScale = Math.max(0.1, imgTransform.value.scale + delta); imgTransform.value.scale = newScale; updateCanvasDimensions(); };

// --- 1px Shift Logic ---
const initSpaceMetrics = () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `12pt "${customFontName.value}"`;
    const half = ctx.measureText(' ').width;
    const full = ctx.measureText('　').width;
    const thin = ctx.measureText('\u2009').width;
    fontMetrics.value = { half, full, thin };
    const combos: { str: string, width: number }[] = [];
    const useThin = config.value.useThinSpace; const safe = config.value.safeMode;
    for (let f = 0; f <= 4; f++) {
        for (let h = 0; h <= (safe ? 1 : 2); h++) {
            const tMax = useThin ? 8 : 0;
            for (let t = 0; t <= tMax; t++) {
                if (f === 0 && h === 0 && t === 0) continue;
                let str = '　'.repeat(f) + ' '.repeat(h);
                if (useThin) str += '\u2009'.repeat(t);
                if (safe) str = str.replace(/  /g, ' \u00A0');
                const width = f * full + h * half + t * thin;
                combos.push({ str, width });
            }
        }
    }
    combos.sort((a, b) => a.width - b.width);
    spaceCombinations = combos;
};
const shiftSpace = (direction: 'narrow' | 'wide') => {
    const textarea = document.querySelector('.aa-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd; if (start !== end) return;
    const text = textarea.value;
    const lastNewLine = text.lastIndexOf('\n', start - 1);
    const lineStart = lastNewLine + 1;
    const textBefore = text.substring(lineStart, start);
    const match = textBefore.match(/[\s\u2009\u00A0\u3000]+$/);
    const spacer = match ? match[0] : '';
    const prefix = textBefore.substring(0, textBefore.length - spacer.length);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `12pt "${customFontName.value}"`;
    const currentPx = ctx.measureText(spacer).width;
    const { full } = fontMetrics.value;
    let targetPx = direction === 'wide' ? currentPx + 1.0 : currentPx - 1.0;
    if (targetPx < 0) targetPx = 0;
    let baseFullCount = Math.floor(targetPx / full);
    if (baseFullCount > 1) baseFullCount -= 1; 
    const basePx = baseFullCount * full;
    const remainderPx = targetPx - basePx;
    let bestSuffix = ""; let minDiff = Infinity;
    for (const combo of spaceCombinations) {
        const diff = Math.abs(combo.width - remainderPx);
        if (diff < minDiff) { minDiff = diff; bestSuffix = combo.str; }
    }
    const newSpacer = '　'.repeat(baseFullCount) + bestSuffix;
    const newFullText = text.substring(0, lineStart) + prefix + newSpacer + text.substring(start);
    aaOutput.value = newFullText;
    nextTick(() => { const newPos = lineStart + prefix.length + newSpacer.length; textarea.selectionStart = textarea.selectionEnd = newPos; updateCursorInfo(null); });
};
const updateCursorInfo = (e: Event | null) => {
    console.log(e?.target)
    const textarea = document.querySelector('.aa-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const val = textarea.value; const sel = textarea.selectionStart;
    const before = val.substring(0, sel);
    const row = (before.match(/\n/g) || []).length + 1;
    const lastNewLine = before.lastIndexOf('\n');
    const col = sel - lastNewLine; 
    const lineText = before.substring(lastNewLine + 1);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `12pt "${customFontName.value}"`;
    const px = Math.round(ctx.measureText(lineText).width);
    cursorInfo.value = { row, col, charCount: val.length, px };
    lastCursorPos.value = { row: row - 1, col }; 
};

// --- ★追加: テキスト編集機能 (Edit Menu) ---
const applyTextEdit = (type: string) => {
    commitHistory();

    const text = aaOutput.value;
    const lines = text.split('\n');
    let newText = text;

    if (type === 'add-end-space') {
        newText = lines.map(l => l + '　').join('\n');
    } else if (type === 'trim-end') {
        newText = lines.map(l => l.replace(/[ 　\u2009]+$/, '')).join('\n');
    } else if (type === 'add-start-space') {
        newText = lines.map(l => '　' + l).join('\n');
    } else if (type === 'trim-start') {
        newText = lines.map(l => l.replace(/^　/, '')).join('\n');
    } else if (type === 'remove-empty') {
        newText = lines.filter(l => l.length > 0).join('\n');
    } else if (type === 'del-last-char') {
        newText = lines.map(l => [...l].slice(0, -1).join('')).join('\n');
    } else if (type === 'align-right') {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `16px "${customFontName.value}"`; 
        
        let maxW = 0;
        const measured = lines.map(l => {
            const clean = l.replace(/[ 　\u2009\|]+$/, '');
            const w = ctx.measureText(clean).width;
            if (w > maxW) maxW = w;
            return { text: clean, width: w };
        });
        
        const fullW = ctx.measureText('　').width;
        const halfW = ctx.measureText(' ').width;
        
        newText = measured.map(m => {
            let diff = maxW - m.width;
            let spacer = '';
            const fullCount = Math.floor(diff / fullW);
            spacer += '　'.repeat(fullCount);
            diff -= fullCount * fullW;
            if (diff > halfW * 0.5) {
                spacer += ' ';
            }
            return m.text + spacer + '|';
        }).join('\n');
    }

    aaOutput.value = newText;
    showEditMenu.value = false;
    
    nextTick(() => commitHistory());
    showToastMessage('Applied!');
};

// --- File I/O ---
// Copy Menu
const triggerCopy = async (mode: 'normal' | 'bbs') => {
    let text = aaOutput.value;
    if (mode === 'bbs') {
        text = AaFileManager.encodeToBbsSafe(text);
    }
    try {
        await navigator.clipboard.writeText(text);
        showToastMessage(mode === 'bbs' ? 'Copied (BBS Safe)!' : 'Copied!');
    } catch (err) {
        console.error('Copy failed', err);
        showToastMessage('Copy Failed');
    }
    showCopyMenu.value = false;
};
const showToastMessage = (msg: string) => {
    toastMessage.value = msg;
    showToast.value = true;
    setTimeout(() => { showToast.value = false; }, 2000);
};

// ★追加: タイムラプス動画生成
const generateTimelapse = async () => {
    if (historyStack.value.length < 2) return;
    isExportingVideo.value = true;
    showToastMessage('Generating Timelapse...');
    showExportModal.value = false;

    const cvs = document.createElement('canvas');
    cvs.width = 1280;
    cvs.height = 720;
    const ctx = cvs.getContext('2d')!;

    const stream = cvs.captureStream(30); 
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();

    const font = `16px "${customFontName.value}"`;
    const bgColor = '#ffffff';
    const textColor = '#222222';
    const lineHeight = 16;
    const padding = 20;

    for (let i = 0; i < historyStack.value.length; i++) {
        await new Promise(r => setTimeout(r, 30)); 

        const text = historyStack.value[i];
        
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, cvs.width, cvs.height);

        ctx.font = font;
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'top';
        
        const lines = text!.split('\n');
        for (let j = 0; j < lines.length; j++) {
            ctx.fillText(lines[j]!, padding, padding + j * lineHeight);
        }
        
        if (i % 50 === 0) {
            toastMessage.value = `Generating... ${Math.floor((i / historyStack.value.length) * 100)}%`;
        }
    }

    recorder.stop();
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `timelapse_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        isExportingVideo.value = false;
        showToastMessage('Timelapse Downloaded!');
    };
};

const onFileSelected = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    try { const loaded = await AaFileManager.loadFile(file, loadEncoding.value); if (loaded.length > 0) { projectAAs.value = loaded; currentAAIndex.value = 0; status.value = `LOADED ${loaded.length} AAs`; resetHistory(); } } catch (err) { console.error(err); status.value = 'LOAD ERROR'; }
    (e.target as HTMLInputElement).value = '';
};
const onSaveFile = (format: FileFormat, encoding: EncodingType) => { const ext = format === 'AST' ? '.ast' : '.mlt'; const name = `aa_project${ext}`; AaFileManager.saveFile(projectAAs.value, encoding, format, name); showSaveMenu.value = false; };
const addNewAA = () => { const num = projectAAs.value.length + 1; projectAAs.value.push({ title: `Untitled ${num}`, content: '' }); currentAAIndex.value = projectAAs.value.length - 1; showGridOverlay.value = false; };
const deleteAA = (idx: number) => { if (projectAAs.value.length <= 1) { projectAAs.value[0]!.content = ''; projectAAs.value[0]!.title = 'Untitled 1'; return; } projectAAs.value.splice(idx, 1); if (currentAAIndex.value >= projectAAs.value.length) { currentAAIndex.value = projectAAs.value.length - 1; } };
const selectAA = (idx: number) => { currentAAIndex.value = idx; showGridOverlay.value = false; };
const onFileChange = async (e: Event) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file || !isReady.value) return; loadImageFromFile(file); };
const loadImageFromFile = (file: File) => {
  const img = new Image(); img.src = URL.createObjectURL(file);
  img.onload = async () => {
    sourceImage.value = img; imageSize.value = { w: img.width, h: img.height };
    initPaintBuffer(img.width, img.height);
    sidebarTab.value = 'image'; paintMode.value = 'move';
    await nextTick();
    imgTransform.value = { x: 0, y: 0, scale: 1.0, rotation: 0 };
    await updateCanvasDimensions();
    if(thinningLevel.value > 0) processSourceImage();
    status.value = 'IMAGE LOADED';
  };
};
const updateCanvasDimensions = async () => {
    if (!sourceImage.value) return;
    const w = Math.floor(sourceImage.value.width * imgTransform.value.scale * 1.5) + 200;
    const h = Math.floor(sourceImage.value.height * imgTransform.value.scale * 1.5) + 200;
    canvasDims.value = { width: w, height: h };
    await nextTick(); renderAllCanvases();
};
const onFontFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { 
      const fontName = file.name.split('.')[0]; 
      const fontUrl = URL.createObjectURL(file); 
      await rebuildDb(fontUrl, fontName || 'CustomFont'); 
  }
};
const rebuildDb = async (fontUrl: string | null, fontName: string | null) => {
    status.value = 'OPTIMIZING AI...'; await new Promise(r => setTimeout(r, 10));
    try {
        const fUrl = fontUrl || '/Saitamaar.ttf'; 
        const fName = fontName || 'Saitamaar';
        await engine.init('/aa_model_a.onnx', fUrl, '/aa_chars.json', 'classifier', fName);
        engine.updateAllowedChars(config.value.allowedChars);
        customFontName.value = fName; 
        status.value = `DB UPDATED`;
        setTimeout(initSpaceMetrics, 200);
    } catch(err) { console.error(err); status.value = 'DB ERROR'; }
};
const onConfigUpdate = () => { 
    engine.updateAllowedChars(config.value.allowedChars);
    initSpaceMetrics();
};

// Layout Control
const startResizePane = () => { isResizingPane.value = true; window.addEventListener('mousemove', onResizePane); window.addEventListener('mouseup', stopResizePane); 
    document.body.style.cursor = splitDirection.value === 'horizontal' ? 'row-resize' : 'col-resize';
};
const onResizePane = (e: MouseEvent) => { 
    if (!editorStackRef.value) return; 
    const rect = editorStackRef.value.getBoundingClientRect(); 
    if (splitDirection.value === 'horizontal') {
        const offsetY = e.clientY - rect.top; 
        tracePaneRatio.value = Math.min(0.9, Math.max(0.1, offsetY / rect.height)); 
    } else {
        const offsetX = e.clientX - rect.left;
        tracePaneRatio.value = Math.min(0.9, Math.max(0.1, offsetX / rect.width));
    }
};
const stopResizePane = () => { isResizingPane.value = false; window.removeEventListener('mousemove', onResizePane); window.removeEventListener('mouseup', stopResizePane); document.body.style.cursor = ''; };

const toggleLayout = (mode: 'single' | 'split-h' | 'split-v') => {
    if (mode === 'single') {
        viewMode.value = 'single';
        showLayoutMenu.value = false;
        return;
    }
    viewMode.value = 'split';
    splitDirection.value = mode === 'split-h' ? 'horizontal' : 'vertical';
    showLayoutMenu.value = false;
};

const triggerLoad = (enc: EncodingType) => { loadEncoding.value = enc; document.getElementById('fileInput')?.click(); showLoadMenu.value = false; };
const processSourceImage = () => {
    if (!sourceImage.value) return;
    const canvas = document.createElement('canvas'); canvas.width = sourceImage.value.width; canvas.height = sourceImage.value.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(sourceImage.value, 0, 0);
    const src = (window as any).cv.imread(canvas); const dst = new (window as any).cv.Mat();
    (window as any).cv.cvtColor(src, src, (window as any).cv.COLOR_RGBA2GRAY);
    (window as any).cv.threshold(src, src, 200, 255, (window as any).cv.THRESH_BINARY);
    const M = (window as any).cv.Mat.ones(3, 3, (window as any).cv.CV_8U);
    const anchor = new (window as any).cv.Point(-1, -1);
    (window as any).cv.dilate(src, dst, M, anchor, thinningLevel.value, (window as any).cv.BORDER_CONSTANT, (window as any).cv.morphologyDefaultBorderValue());
    (window as any).cv.imshow(canvas, dst); processedSource.value = canvas;
    src.delete(); dst.delete(); M.delete();
};
</script>

<template>
  <div class="app-root" :style="{ '--aa-text-color': aaTextColor, '--font-aa': fontStack }">
    <header class="app-header">
        <div class="brand"><div class="status-indicator" :class="{ ready: isReady, processing: isProcessing }"></div>Cozy Craft AA</div>
        <div class="visual-controls">
            <button class="nav-icon-btn" @click="showDebugModal = true" title="Debug View">👁️ Debug</button>
            <button class="nav-icon-btn" @click="showConfigModal = true" title="AI Config">⚙️ Config</button>
            
            <div class="color-control-group">
                <button class="icon-btn tiny" @click="swapColors" title="Swap Colors">⇄</button>
                <div class="dual-swatch-container">
                    <div class="swatch-back" :style="{ background: subTextColor }" @click="swapColors"></div>
                    <button class="swatch-front" 
                        :style="{ background: aaTextColor }" 
                        @click="showColorPicker = !showColorPicker"
                    ></button>
                </div>
                <button class="icon-btn tiny" @click="invertColor" title="Invert B/W" style="margin-left:5px;">◑</button>

                <div class="color-picker-popover" v-if="showColorPicker">
                    <div class="color-grid">
                        <button v-for="c in presetColors" :key="c" class="color-swatch" :style="{ background: c }" @click="aaTextColor = c; showColorPicker = false"></button>
                    </div>
                    <div class="color-slider-row">
                        <span class="label">HUE</span>
                        <input type="range" min="0" max="360" v-model="hueValue" @input="updateHue" class="hue-slider">
                    </div>
                    <div class="color-custom-row">
                        <span style="font-size:0.8rem; color:#666;">Custom:</span>
                        <input type="color" v-model="aaTextColor" class="color-input">
                    </div>
                </div>
            </div>
        </div>
    </header>

    <div class="workspace">
        <main class="editor-stack" ref="editorStackRef" 
              :style="{ flexDirection: splitDirection === 'horizontal' ? 'column' : 'row' }">
            
            <div class="editor-card trace-card" 
                 :style="{ 
                     flex: viewMode === 'single' ? '1' : `0 0 ${tracePaneRatio * 100}%`,
                     order: isLayoutSwapped ? 3 : 1
                 }"
                 @click="activeEditor = 'trace'">
                <div class="card-header">
                    <input v-model="projectAAs[currentAAIndex]!.title" class="aa-title-input" placeholder="AA Title" />
                    <div class="card-actions">
                        <span v-if="!sourceImage" class="hint">Load Image from Sidebar →</span>
                    </div>
                </div>
                
                <div class="aa-canvas-wrapper" @scroll="onScroll">
                    <div class="canvas-scroll-area" 
                         :style="{ width: (canvasDims.width || '100%') + (canvasDims.width ? 'px' : ''), height: (canvasDims.height || '100%') + (canvasDims.height ? 'px' : '') }">
                        
                        <div class="canvas-layers" v-show="sourceImage" 
                             :style="{ width: '100%', height: '100%', opacity: traceOpacity/100 }">
                            <canvas v-show="showBackgroundImage" ref="canvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base"></canvas>
                            <canvas v-show="showBackgroundImage" ref="maskCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" :style="{ opacity: showGridOverlay ? 0 : 0.6 }"></canvas>
                        </div>
                        
                        <div class="canvas-layers" v-show="sourceImage && sidebarTab === 'image'" 
                             :style="{ 
                                 width: '100%', height: '100%', 
                                 zIndex: 10,
                                 pointerEvents: 'auto', 
                                 cursor: paintMode==='move' ? 'move' : (paintMode==='bucket' ? 'cell' : 'crosshair')
                             }">
                            <canvas ref="paintCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base" style="pointer-events:none;"></canvas>
                            <canvas ref="paintMaskRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" 
                                    @mousedown="onMouseDown" 
                                    @wheel="onWheel"></canvas>
                        </div>

                        <div v-if="viewMode === 'split' && activeEditor === 'text'" 
                             class="remote-caret" 
                             :style="{ top: caretSyncPos.y + 'px', left: caretSyncPos.x + 'px' }"></div>

                        <div class="box-overlay-container" v-show="showBoxOverlay">
                            <div v-for="(rect, i) in boxSelectionRects" :key="i" class="box-selection-line" :style="rect"></div>
                        </div>

                        <div class="ghost-layer" v-show="isGhostVisible && sidebarTab === 'palette'" :style="{ width: '100%', height: '100%' }">
                            <span class="ghost-text" :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px' }">{{ ghostText }}</span>
                        </div>
                        
                        <textarea class="aa-textarea" 
                                  :class="{ 'box-mode-active': isBoxSelecting }"
                                  v-model="aaOutput" 
                                  @keydown="onKeyDown" @keypress="onKeyPress" 
                                  @input="onInput" 
                                  @click="onClickText; updateCaretSync($event, 'trace')" 
                                  @keyup="onKeyUp" 
                                  @focus="activeEditor = 'trace'"
                                  @mousedown="onTextareaMouseDown($event, 'trace')"
                                  @mousemove="onTextareaMouseMove($event, 'trace')"
                                  @mouseup="onTextareaMouseUp"
                                  @paste="onPaste"
                                  placeholder="Type or Drag Image Here..."
                                  :style="{ 
                                      color: aaTextColor,
                                      pointerEvents: sidebarTab === 'image' ? 'none' : 'auto', 
                                      opacity: sidebarTab === 'image' ? 0.3 : 1 
                                  }"
                        ></textarea>
                    </div>
                </div>
            </div>

            <div v-show="viewMode === 'split'" 
                 class="resize-handle" 
                 @mousedown.prevent="startResizePane" 
                 :class="{ 
                     active: isResizingPane,
                     'handle-v': splitDirection === 'vertical'
                 }"
                 :style="{ order: 2 }">
                <div class="handle-bar"></div>
            </div>

            <div v-show="viewMode === 'split'" 
                 class="editor-card text-card" 
                 :style="{ 
                     flex: 1,
                     order: isLayoutSwapped ? 1 : 3 
                 }"
                 @click="activeEditor = 'text'">
                <div class="aa-canvas-wrapper">
                    <div class="aa-highlight-layer" v-html="highlightedHTML"></div>

                    <div v-if="viewMode === 'split' && activeEditor === 'trace'" 
                         class="remote-caret" 
                         :style="{ top: caretSyncPos.y + 'px', left: caretSyncPos.x + 'px' }"></div>
                    
                    <div class="box-overlay-container" v-show="showBoxOverlay">
                        <div v-for="(rect, i) in boxSelectionRects" :key="i" class="box-selection-line" :style="rect"></div>
                    </div>

                    <textarea class="aa-textarea" 
                              :class="{ 'box-mode-active': isBoxSelecting }"
                              v-model="aaOutput" 
                              @keydown="onKeyDown" @keypress="onKeyPress" 
                              @input="updateCaretSync($event, 'text')"
                              @click="updateCaretSync($event, 'text')"
                              @keyup="updateCaretSync($event, 'text')"
                              @focus="activeEditor = 'text'"
                              @mousedown="onTextareaMouseDown($event, 'text')"
                              @mousemove="onTextareaMouseMove($event, 'text')"
                              @mouseup="onTextareaMouseUp"
                              @paste="onPaste"
                              style="color: #222222;"></textarea>
                </div>
            </div>
        </main>

        <aside class="sidebar">
            <div class="sidebar-tabs">
                <button :class="{ active: sidebarTab==='palette' }" @click="sidebarTab='palette'">📝 Palette</button>
                <button :class="{ active: sidebarTab==='image' }" @click="sidebarTab='image'">🎨 Image</button>
            </div>

            <div v-show="sidebarTab==='palette'" class="panel-box palette-container" ref="paletteContainerRef">
                <div class="history-section" :style="{ flex: `0 0 ${historyPaneRatio * 100}%`, minHeight: '0' }">
                    <div class="panel-header">
                        <span class="header-title">🕒 History</span>
                        <span class="header-badge">{{ historyChars?.length || 0 }}</span>
                    </div>
                    <div class="grid-scroll-area history-bg">
                        <div class="char-grid-dense">
                            <button v-for="c in historyChars" :key="c" class="key-dense" @click="addCharToOutput(c)">{{ c }}</button>
                        </div>
                    </div>
                </div>

                <div class="palette-resize-handle" 
                     @mousedown.prevent="startResizePalette"
                     :class="{ active: isResizingPalette }">
                     <div class="handle-bar"></div>
                </div>

                <div class="library-section" style="flex:1; min-height:0;">
                    <div class="panel-header">
                        <select v-model="currentCategoryId" class="category-selector">
                            <option v-for="cat in categories" :key="cat.id" :value="cat.id">📂 {{ cat.name }}</option>
                        </select>
                        <button class="icon-btn tiny" @click="showPaletteEditor = true" title="Edit Palette">✏️</button>
                    </div>
                    <div class="grid-scroll-area">
                        <div class="char-grid-dense">
                            <button 
                                v-for="c in (currentCategoryData?.chars || '').split('')" 
                                :key="c" 
                                class="key-dense" 
                                @click="addCharToOutput(c)"
                            >
                                {{ c }}
                            </button>
                        </div>
                    </div>
                </div>

                <div class="project-list-section">
                    <div class="panel-header" style="border-top:1px solid #ddd;"><span>📚 Project</span></div>
                    <div class="aa-list">
                        <div v-for="(aa, idx) in projectAAs" :key="idx" class="aa-list-item" :class="{ active: idx === currentAAIndex }" @click="selectAA(idx)">
                            <span class="aa-list-title">{{ aa.title }}</span>
                            <button v-if="idx === currentAAIndex" @click.stop="deleteAA(idx)" class="del-btn">×</button>
                        </div>
                    </div>
                </div>
            </div>

            <div v-show="sidebarTab==='image'" class="panel-box" style="flex:1; padding:10px; background:#eee;">
                <label class="studio-btn primary w-100" style="text-align:center; display:block; margin-bottom:15px;">
                    📂 Load Image <input type="file" @change="onFileChange" accept="image/*" hidden />
                </label>

                <div v-if="sourceImage">
                    <div class="control-group">
                        <label>Opacity: {{ traceOpacity }}%</label>
                        <input type="range" min="0" max="100" v-model="traceOpacity">
                    </div>
                    <div class="control-group">
                        <label>Scale: {{ Math.round(imgTransform.scale * 100) }}%</label>
                        <input type="range" min="0.1" max="3.0" step="0.1" v-model.number="imgTransform.scale" @input="updateImageTransform">
                    </div>
                    <div class="control-group">
                        <label>Rotate: {{ imgTransform.rotation }}°</label>
                        <input type="range" min="-180" max="180" step="1" v-model.number="imgTransform.rotation" @input="updateImageTransform">
                    </div>
                    <hr class="sep">
                    <div class="control-group">
                        <label>Mode</label>
                        <div class="btn-group">
                            <button :class="{ active: paintMode==='move' }" @click="paintMode='move'">✋ Move</button>
                            <button :class="{ active: paintMode==='brush' }" @click="paintMode='brush'">🖌️ Brush</button>
                            <button :class="{ active: paintMode==='bucket' }" @click="paintMode='bucket'">🪣 Fill</button>
                            <button :class="{ active: paintMode==='eraser' }" @click="paintMode='eraser'">🧹 Eraser</button>
                        </div>
                    </div>
                    <div class="control-group" v-if="paintMode !== 'move'">
                        <label>Color</label>
                        <div class="btn-group">
                            <button :class="{ active: paintColor==='blue' }" @click="paintColor='blue'" style="color:blue;">Blue</button>
                            <button :class="{ active: paintColor==='red' }" @click="paintColor='red'" style="color:red;">Red</button>
                        </div>
                        <div style="display:flex; gap:5px; margin-top:8px;">
                            <div style="flex:1;">
                                <label style="font-size:0.7rem; color:blue;">Blue Char</label>
                                <input type="text" v-model="targetCharBlue" class="char-input">
                            </div>
                            <div style="flex:1;">
                                <label style="font-size:0.7rem; color:red;">Red Char</label>
                                <input type="text" v-model="targetCharRed" class="char-input">
                            </div>
                        </div>
                        <label style="margin-top:5px;">Brush Size: {{ brushSize }}</label>
                        <input type="range" min="1" max="50" v-model="brushSize">
                    </div>
                    <hr class="sep">
                    <div class="control-group">
                        <label>Line Thinning: {{ thinningLevel }}</label>
                        <input type="range" min="0" max="3" v-model.number="thinningLevel">
                        <label style="margin-top:10px;">Noise Gate: {{ config.noiseGate }}</label>
                        <input type="range" min="0" max="2.0" step="0.1" v-model.number="config.noiseGate">
                        <label class="check-row" style="margin-top:10px; font-size:0.8rem;"><input type="checkbox" v-model="config.generationMode" true-value="hybrid" false-value="accurate"><span>Hybrid Mode (Faster)</span></label>
                        <button class="studio-btn outline w-100" @click="processImage" :disabled="isProcessing" style="margin-top:10px;">✨ Update Features</button>
                    </div>
                </div>
                <div v-else class="placeholder-text" style="color:#888;">No Image Loaded</div>
            </div>
        </aside>
    </div>

    <div class="modal-backdrop" v-if="showPaletteEditor" @click.self="showPaletteEditor = false">
        <div class="modal-window" style="width: 700px; height: 500px; display:flex; flex-direction:column;">
            <div class="studio-header"><h2>✏️ Edit Palette</h2><button class="close-btn" @click="showPaletteEditor = false">✕</button></div>
            <div style="flex:1; display:flex; overflow:hidden;">
                <div style="width:220px; border-right:1px solid #ddd; display:flex; flex-direction:column; background:#f9f9f9;">
                    <div style="padding:10px; border-bottom:1px solid #ddd;">
                        <button class="studio-btn primary w-100" @click="addCategory">+ New Category</button>
                    </div>
                    <div style="flex:1; overflow-y:auto;">
                        <div v-for="(cat, idx) in categories" :key="cat.id" 
                             class="palette-list-item" 
                             :class="{ active: editingCatId === cat.id }"
                             @click="editingCatId = cat.id">
                            <span class="cat-name">{{ cat.name }}</span>
                            <div class="cat-actions" v-if="editingCatId === cat.id">
                                <button @click.stop="moveCategory(idx, -1)" :disabled="idx===0">↑</button>
                                <button @click.stop="moveCategory(idx, 1)" :disabled="idx===(categories?.length||0)-1">↓</button>
                                <button @click.stop="removeCategory(cat.id)" class="del">×</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="flex:1; display:flex; flex-direction:column; padding:20px;" v-if="editingCategory">
                    <div class="control-group">
                        <label>Category Name</label>
                        <input type="text" v-model="editingCategory.name" @change="savePaletteToStorage" style="width:100%; padding:5px; font-weight:bold;">
                    </div>
                    <div class="control-group" style="flex:1; display:flex; flex-direction:column;">
                        <label>Characters (Paste here)</label>
                        <textarea v-model="editingCategory.chars" @change="savePaletteToStorage" class="config-textarea" style="flex:1; font-size:16px;"></textarea>
                        <p class="desc">Spaces and line breaks will be ignored in the palette view.</p>
                    </div>
                </div>
                <div style="flex:1; display:flex; align-items:center; justify-content:center; color:#999;" v-else>
                    Select a category to edit
                </div>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" v-if="showDebugModal" @click.self="showDebugModal = false">
        <div class="modal-window" style="width: 800px; height: 600px; flex-direction:column;">
            <div class="studio-header"><h2>👁️ Debug View (Feature Map Ch0)</h2><button class="close-btn" @click="showDebugModal = false">✕</button></div>
            <div style="flex:1; overflow:auto; background:#333; display:flex; justify-content:center; align-items:center;">
                <canvas ref="debugCanvasRef" style="border:1px solid #666;"></canvas>
            </div>
            <div style="padding:10px; background:#fff;">
                <p class="desc">White = High Activation (Line), Black = Background. Adjust 'Noise Gate' to filter faint signals.</p>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" v-if="showConfigModal" @click.self="showConfigModal = false">
        <div class="modal-window config-window">
            <div class="settings-pane">
                <div class="settings-title"><span>⚙️ Configuration</span><button class="close-btn" @click="showConfigModal = false">✕</button></div>
                <div class="config-section">
                    <h3>Allowed Characters (AI Generation)</h3>
                    <p class="desc">Click to toggle characters used for generation.</p>
                    <div class="char-select-grid">
                        <button 
                            v-for="c in allCharCandidates" 
                            :key="c"
                            class="char-select-btn"
                            :class="{ active: config.allowedChars.includes(c) }"
                            @click="toggleAllowedChar(c)"
                        >
                            {{ c }}
                        </button>
                    </div>
                    <textarea v-model="config.allowedChars" @change="onConfigUpdate" class="config-textarea"></textarea>
                    <h3>Advanced Settings</h3>
                    <label class="check-row"><input type="checkbox" v-model="config.useThinSpace" @change="onConfigUpdate"><span>Use Thin Space (&amp;thinsp;)</span></label>
                    <label class="check-row"><input type="checkbox" v-model="config.safeMode" @change="onConfigUpdate; updateSyntaxHighlight()"><span>Safe Mode (BBS Compatibility)</span></label>
                    <h3>Generation Logic</h3>
                    <div class="control-row" style="justify-content:flex-start; gap:20px;">
                        <label class="radio-label">
                            <input type="radio" v-model="config.generationMode" value="hybrid">
                            <span>Hybrid (Recommended)</span>
                            <div class="sub-text">Pre-calc + Sync. Fast & Accurate.</div>
                        </label>
                        <label class="radio-label">
                            <input type="radio" v-model="config.generationMode" value="accurate">
                            <span>Dry Run (Full)</span>
                            <div class="sub-text">Measure every char. Slowest but perfect.</div>
                        </label>
                    </div>
                    <h3>Font Setting</h3>
                    <div class="control-row"><span class="control-label">Current: {{ customFontName }}</span><label class="studio-btn outline small">Change (.ttf)<input type="file" @change="onFontFileChange" accept=".ttf,.otf" hidden></label></div>
                </div>
            </div>
        </div>
    </div>
    
    <div class="modal-backdrop" v-if="showExportModal" @click.self="showExportModal=false"><div class="modal-window"><div class="preview-pane"><div class="aa-export-preview" :style="{color:aaTextColor}">{{aaOutput}}</div></div><div class="settings-pane"><div class="settings-title"><span>Export</span><button @click="showExportModal=false">✕</button></div>
    <button class="big-btn" style="margin-bottom:10px;">Download PNG</button>
    <button class="big-btn" @click="generateTimelapse" :disabled="isExportingVideo" style="background:#555;">{{ isExportingVideo ? 'Generating...' : '🎬 Download Timelapse' }}</button>
    </div></div></div>
    
    <footer class="app-footer">
        <div class="footer-compact-row">
            <div style="position:relative;">
                <button class="footer-icon-btn" @click="showLayoutMenu = !showLayoutMenu" title="Layout Settings">
                    {{ viewMode === 'single' ? '⬜ Single' : (splitDirection === 'horizontal' ? '日 Split(H)' : '|| Split(V)') }}
                </button>
                <div class="file-menu-popover bottom-up" v-if="showLayoutMenu" style="left:0; right:auto;">
                    <button class="menu-item" @click="toggleLayout('single')">⬜ Single View</button>
                    <button class="menu-item" @click="toggleLayout('split-h')">日 Split Horizontal</button>
                    <button class="menu-item" @click="toggleLayout('split-v')">|| Split Vertical</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="isLayoutSwapped = !isLayoutSwapped">⇄ Swap Panes</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="isBoxSelecting = !isBoxSelecting; showBoxOverlay = false;">{{ isBoxSelecting ? 'Exit Box Mode' : 'Enter Box Mode' }}</button>
                </div>
            </div>

            <button class="footer-icon-btn" @click="showBackgroundImage = !showBackgroundImage" :style="{ opacity: showBackgroundImage?1:0.5 }" title="Toggle Image">🖼️</button>
            <div class="footer-sep"></div>
            <button class="footer-icon-btn" @click="currentAAIndex = Math.max(0, currentAAIndex - 1)">←</button>
            <div class="page-indicator" @click="showGridOverlay = !showGridOverlay"><span>{{ currentAAIndex + 1 }} / {{ projectAAs?.length || 0 }}</span><span style="font-size:0.7rem; opacity:0.5; margin-left:4px;">▼</span></div>
            <button class="footer-icon-btn" @click="currentAAIndex = Math.min((projectAAs?.length||1) - 1, currentAAIndex + 1)">→</button>
            <div class="footer-sep"></div>
            <div style="position:relative;">
                <button class="footer-text-btn" @click="showLoadMenu = !showLoadMenu">📂 Open</button>
                <div class="file-menu-popover bottom-up" v-if="showLoadMenu">
                    <div class="menu-label">Load Encoding</div>
                    <button class="menu-item" @click="triggerLoad('AUTO')">🤖 Auto</button>
                    <button class="menu-item" @click="triggerLoad('SJIS')">🇯🇵 SJIS</button>
                    <button class="menu-item" @click="triggerLoad('UTF8')">🌐 UTF-8</button>
                </div>
            </div>
            <div style="position:relative;">
                <button class="footer-text-btn" @click="showSaveMenu = !showSaveMenu">💾 Save</button>
                <div class="file-menu-popover bottom-up" v-if="showSaveMenu">
                    <div class="menu-label">Project (AST)</div>
                    <button class="menu-item" @click="onSaveFile('AST', 'SJIS')">SJIS</button>
                    <button class="menu-item" @click="onSaveFile('AST', 'UTF8')">UTF-8</button>
                    <div class="menu-sep"></div>
                    <div class="menu-label">Export (MLT)</div>
                    <button class="menu-item" @click="onSaveFile('MLT', 'SJIS')">SJIS</button>
                    <button class="menu-item" @click="onSaveFile('MLT', 'UTF8')">UTF-8</button>
                </div>
            </div>

            <div style="position:relative;">
                <button class="footer-text-btn" @click="showEditMenu = !showEditMenu">🛠️ Edit</button>
                <div class="file-menu-popover bottom-up" v-if="showEditMenu">
                    <div class="menu-label">Formatting</div>
                    <button class="menu-item" @click="applyTextEdit('add-end-space')">Add End Space</button>
                    <button class="menu-item" @click="applyTextEdit('trim-end')">Trim End Space</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="applyTextEdit('add-start-space')">Add Start Space</button>
                    <button class="menu-item" @click="applyTextEdit('trim-start')">Trim Start Space</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="applyTextEdit('remove-empty')">Remove Empty Lines</button>
                    <button class="menu-item" @click="applyTextEdit('del-last-char')">Del Last Char</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="applyTextEdit('align-right')">Align Right with |</button>
                    <div class="menu-sep"></div>
                    <button class="menu-item" @click="pasteBoxSelection">Rect Paste (Overwrite)</button>
                </div>
            </div>

            <div style="position:relative;">
                <button class="footer-text-btn" @click="showCopyMenu = !showCopyMenu">📋 Copy</button>
                <div class="file-menu-popover bottom-up" v-if="showCopyMenu">
                    <div class="menu-label">Copy to Clipboard</div>
                    <button class="menu-item" @click="triggerCopy('normal')">📄 Normal Text</button>
                    <button class="menu-item" @click="triggerCopy('bbs')">🛡️ BBS Safe (SJIS)</button>
                </div>
            </div>

            <button class="footer-text-btn" @click="showExportModal=true">📤 Image</button>
            <input id="fileInput" type="file" hidden @change="onFileSelected" accept=".txt,.mlt,.ast">
        </div>
        <div class="footer-status"><span>Ln {{ cursorInfo?.row || 1 }}, Col {{ cursorInfo?.col || 1 }} ({{ cursorInfo?.px || 0 }}px)</span><span style="margin-left:10px; opacity:0.6;">{{ cursorInfo?.charCount || 0 }} chars</span></div>
    </footer>

    <div class="toast-notification" :class="{ active: showToast }">
        {{ toastMessage }}
    </div>

    <div ref="mirrorRef" class="aa-mirror"></div>
    <div class="grid-overlay" :class="{ active: showGridOverlay }" @click.self="showGridOverlay = false">
        <div v-for="(aa, idx) in projectAAs" :key="idx" class="thumb-card" :class="{ 'active-page': idx === currentAAIndex }" @click="selectAA(idx)">
            <div class="thumb-content">{{ aa.content }}</div><div class="thumb-label">{{ idx + 1 }}. {{ aa.title }}</div><button class="thumb-del" @click.stop="deleteAA(idx)">×</button>
        </div>
        <div class="thumb-card add-card" @click="addNewAA"><span style="font-size:2rem; color:#ccc;">+</span></div>
    </div>
  </div>
</template>

<style>
@font-face {
    font-family: 'MSP_Parallel';
    src: local('MS PGothic'), local('MS Pゴシック');
    unicode-range: U+2225;
}
@font-face { font-family: 'Saitamaar'; src: url('/Saitamaar.ttf') format('truetype'); font-display: swap; }
:root { --bg-app: #Fdfbf7; --bg-panel: #ffffff; --text-main: #5c554f; --text-sub: #948c85; --accent-primary: #e6b086; --border-soft: 1px solid rgba(92, 85, 79, 0.1); --font-ui: "Hiragino Maru Gothic Pro", "Rounded Mplus 1c", sans-serif; }
* { box-sizing: border-box; } 
body { margin: 0; height: 100vh; background-color: var(--bg-app); color: var(--text-main); font-family: var(--font-ui); overflow: hidden; }
.app-root { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; } 
button { border:none; background:transparent; cursor:pointer; font-family:inherit; }
.app-header { flex: 0 0 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; background: #fff; border-bottom: var(--border-soft); z-index: 50; }
.app-footer { flex: 0 0 32px; background: #f5f5f5; border-top: var(--border-soft); display: flex; align-items: center; justify-content: space-between; padding: 0 10px; z-index: 50; font-size: 0.8rem; }
.footer-compact-row { display: flex; align-items: center; gap: 8px; }
.footer-icon-btn { font-size: 1rem; padding: 2px 6px; color: var(--text-main); border-radius: 4px; }
.footer-icon-btn:hover { background: #e0e0e0; }
.footer-text-btn { font-size: 0.8rem; font-weight: bold; padding: 2px 8px; border-radius: 4px; color: var(--text-main); }
.footer-text-btn:hover { background: #e0e0e0; }
.footer-sep { width:1px; height:16px; background:#ccc; margin:0 4px; }
.footer-status { color: #888; font-family: monospace; font-size: 0.8rem; }
.workspace { flex: 1; min-height: 0; padding: 0; display: grid; grid-template-columns: 1fr 260px; gap: 0; overflow: hidden; }
.editor-stack { display: flex; flex-direction: column; height: 100%; min-width: 0; border-right: var(--border-soft); overflow: hidden; }
.editor-card { background: #fff; display: flex; flex-direction: column; overflow: hidden; border-bottom: var(--border-soft); }
.sidebar { 
    display: flex; 
    flex-direction: column; 
    background: #fdfdfd; 
    overflow: hidden; 
    height: 100%;
}
.sidebar-tabs { display: flex; border-bottom: 1px solid #ddd; }
.sidebar-tabs button { flex: 1; padding: 10px; font-weight: bold; font-size: 0.85rem; color: #888; border-bottom: 2px solid transparent; }
.sidebar-tabs button.active { color: var(--accent-primary); border-bottom-color: var(--accent-primary); background: #fff; }
.control-group { background: #fff; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #ddd; }
.control-group label { display: block; font-size: 0.75rem; font-weight: bold; margin-bottom: 5px; color: #555; }
.control-group input[type=range] { width: 100%; }
.btn-group { display: flex; gap: 5px; }
.btn-group button { flex: 1; padding: 4px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.75rem; }
.btn-group button.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }
.sep { border: 0; border-top: 1px solid #ddd; margin: 10px 0; }
.w-100 { width: 100%; }
.desc { font-size: 0.7rem; color: #999; margin: 5px 0 0 0; }
.aa-canvas-wrapper { flex: 1; position: relative; overflow: auto; background: #fff; padding: 0; }
.canvas-scroll-area { position: relative; min-width: 100%; min-height: 100%; }
.aa-textarea { position: absolute; top:0; left:0; width: 100%; height: 100%; padding: 0 0 0 16px; border: none; resize: none; outline: none; background: transparent; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 16px; line-height: 16px; color: var(--aa-text-color); white-space: pre; overflow: hidden; z-index: 2; font-feature-settings: "palt" 0, "kern" 0; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: geometricPrecision; }
/* Highlight Layer */
.aa-highlight-layer {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    padding: 0 0 0 16px;
    font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace;
    font-size: 16px;
    line-height: 16px;
    white-space: pre;
    color: transparent;
    pointer-events: none;
    z-index: 1;
}
.err-lead { background-color: rgba(255, 0, 0, 0.2); }
.err-seq { background-color: rgba(255, 200, 0, 0.3); }
.anchor-highlight { background-color: rgba(0, 100, 255, 0.15); }
/* Box Selection Overlay */
.box-selection-overlay {
    position: absolute;
    background-color: rgba(0, 100, 255, 0.2);
    border: 1px solid rgba(0, 100, 255, 0.5);
    pointer-events: none;
    z-index: 5;
}

.canvas-layers { position: absolute; top:0; left:0; z-index: 0; pointer-events: none; } 
.layer-base { position: absolute; top:0; left:0; } .layer-mask { position: absolute; top:0; left:0; }
.card-header { flex: 0 0 28px; padding: 0 10px; background: #f9f9f9; font-size: 0.7rem; font-weight: bold; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.resize-handle { flex: 0 0 8px; display: flex; align-items: center; justify-content: center; cursor: row-resize; background: #f9f9f9; border-top:1px solid #ddd; border-bottom:1px solid #ddd; z-index:10; }
.resize-handle.handle-v { flex: 0 0 8px; cursor: col-resize; border-top: none; border-bottom: none; border-left: 1px solid #ddd; border-right: 1px solid #ddd; flex-direction: column; }
.resize-handle.handle-v .handle-bar { width: 3px; height: 30px; }

.handle-bar { width: 30px; height: 3px; background: #ccc; border-radius: 2px; }
.collapse-btn { width: 100%; height: 100%; background: transparent; border: none; font-size: 0.6rem; color: #888; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; letter-spacing: 1px; }
.floating-toolbar { position: absolute; bottom: 15px; right: 15px; background: #fff; padding: 4px 8px; border-radius: 20px; border: 1px solid #ddd; display: flex; gap: 5px; z-index: 20; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
.tool-btn { width: 28px; height: 28px; border-radius: 50%; font-size: 1rem; display: flex; align-items: center; justify-content: center; } .tool-btn.active { background: #eee; border: 1px solid #ccc; }
.panel-box { display: flex; flex-direction: column; overflow: hidden; height: 100%; } .panel-header { padding: 8px; background: #f5f5f5; font-size: 0.75rem; font-weight: bold; display:flex; justify-content:space-between; align-items:center; }
.grid-area { flex: 1; padding: 5px; overflow-y: auto; } .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); gap: 2px; }
.key { height: 32px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #eee; cursor: pointer; } .key:hover { background: #f9f9f9; color: var(--accent-primary); border-color: var(--accent-primary); }
.studio-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #e6e6e6; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
.studio-content { width: 100%; height: 100%; background: #fff; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; }
.studio-header { flex: 0 0 50px; padding: 0 15px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; }
.studio-body { flex: 1; display: flex; flex-direction: column; background: #888; }
.paint-toolbar { flex: 0 0 40px; background: #333; color: #eee; display: flex; align-items: center; padding: 0 15px; gap: 15px; font-size: 0.8rem; }
.paint-canvas-area { flex: 1; overflow: auto; background: #999; display: block; position: relative; }
.canvas-stack { position: relative; background: white; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
.studio-btn { padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 0.85rem; cursor: pointer; }
.studio-btn.primary { background: var(--accent-primary); color: #fff; border:none; }
.studio-btn.outline { border: 1px solid #ccc; background: #fff; color: #333; }
.swatch { width:10px; height:10px; display:inline-block; border-radius:50%; } .swatch.blue{background:blue;} .swatch.red{background:red;}
.modal-backdrop { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 300; display: flex; align-items: center; justify-content: center; }
.modal-window { width: 500px; background: #fff; border-radius: 8px; display: flex; overflow: hidden; max-height: 80vh; }
.config-window { flex-direction: column; } .settings-pane { padding: 15px; overflow-y:auto; } .close-btn { font-size: 1.2rem; color: #999; border:none; background:none; cursor:pointer; }
.ghost-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 5; }
.ghost-text { position: absolute; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 16px; line-height: 16px; color: rgba(0, 0, 0, 0.3); white-space: pre; pointer-events: none; background: rgba(255, 255, 0, 0.2); }
.app-root[style*="--aa-text-color: #ffffff"] .ghost-text { color: rgba(255, 255, 255, 0.4); }
.aa-mirror { position: absolute; top: -9999px; left: -9999px; visibility: hidden; white-space: pre; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 16px; line-height: 16px; padding: 0 0 0 16px; border: none; }
.grid-overlay { position: fixed; top:0; left:0; width:100%; height: calc(100vh - 32px); background: rgba(253, 251, 247, 0.95); backdrop-filter: blur(5px); z-index: 30; padding: 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; grid-auto-rows: 150px; overflow-y: auto; opacity: 0; pointer-events: none; transition: 0.3s; }
.grid-overlay.active { opacity: 1; pointer-events: auto; }
.thumb-card { background: #fff; border: 1px solid rgba(0,0,0,0.1); border-radius: 12px; cursor: pointer; transition: 0.2s; padding: 10px; position: relative; overflow: hidden; display: flex; flex-direction: column; }
.thumb-card:hover { transform: translateY(-4px); box-shadow: 0 10px 20px rgba(0,0,0,0.1); border-color: var(--accent-primary); }
.thumb-card.active-page { border: 2px solid var(--accent-primary); box-shadow: 0 0 0 4px rgba(230, 176, 134, 0.2); }
.thumb-content { flex: 1; overflow: hidden; white-space: pre; font-family: var(--font-aa), monospace; font-size: 6px; line-height: 8px; color: #666; pointer-events: none; }
.thumb-label { position: absolute; bottom: 0; left: 0; width: 100%; padding: 6px 10px; background: rgba(255,255,255,0.9); border-top: 1px solid #eee; font-size: 0.75rem; color: #333; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thumb-del { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; border-radius: 50%; background: rgba(0,0,0,0.1); color: #fff; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; opacity: 0; transition: 0.2s; }
.thumb-card:hover .thumb-del { opacity: 1; }
.thumb-del:hover { background: red; }
.add-card { display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.02); border-style: dashed; }
.add-card:hover { background: rgba(0,0,0,0.05); border-color: #aaa; }
.file-menu-popover { position: absolute; top: 35px; right: 10px; width: 200px; background: white; border: 1px solid #ccc; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border-radius: 4px; z-index: 100; display: flex; flex-direction: column; padding: 5px 0; }
.file-menu-popover.bottom-up { top: auto; bottom: 35px; right: 0; }
.menu-item { display: block; padding: 8px 15px; text-align: left; font-size: 0.85rem; cursor: pointer; color: #333; background: none; border: none; width: 100%; transition: 0.1s; }
.menu-item:hover { background: #f5f5f5; color: var(--accent-primary); }
.menu-label { padding: 4px 10px; font-size: 0.7rem; font-weight: bold; color: #999; background: #f9f9f9; }
.btn-accent { background: var(--text-main); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.btn-accent:hover { background: #443d38; transform: translateY(-1px); }
.brand { font-weight: bold; }
.config-textarea { width: 100%; height: 100px; border: 1px solid #ccc; border-radius: 4px; padding: 5px; font-family: monospace; font-size: 0.8rem; resize: vertical; }
.check-row { display: flex; align-items: center; margin-bottom: 10px; cursor: pointer; }
.check-row input { margin-right: 8px; }
.check-row span { font-weight: bold; font-size: 0.9rem; }
.control-row { display:flex; justify-content: space-between; align-items: center; margin-bottom:10px; }
.control-label { font-size:0.8rem; color:#555; }
.char-input { width: 100%; border: 1px solid #ccc; border-radius: 4px; text-align: center; padding: 2px; font-weight: bold; }
.char-select-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); gap: 4px; margin-bottom: 10px; max-height: 200px; overflow-y: auto; border: 1px solid #eee; padding: 5px; background: #fafafa; }
.char-select-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 1px solid #ddd; background: #fff; border-radius: 4px; font-size: 14px; cursor: pointer; color: #ccc; transition: 0.1s; }
.char-select-btn:hover { background: #f0f0f0; border-color: #bbb; }
.char-select-btn.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); font-weight: bold; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.color-control-group { display: flex; align-items: center; gap: 8px; margin-left: 10px; position: relative; }
.dual-swatch-container { width: 32px; height: 32px; position: relative; cursor: pointer; }
.swatch-back { position: absolute; width: 20px; height: 20px; bottom: 2px; right: 2px; border: 1px solid rgba(0,0,0,0.2); box-shadow: 1px 1px 3px rgba(0,0,0,0.1); background: white; z-index: 1; }
.swatch-front { position: absolute; width: 20px; height: 20px; top: 2px; left: 2px; border: 1px solid rgba(0,0,0,0.2); box-shadow: 1px 1px 3px rgba(0,0,0,0.1); background: #222; z-index: 2; padding: 0; }
.swatch-front:hover { transform: scale(1.05); }
.color-picker-popover { position: absolute; top: 100%; right: 0; margin-top: 10px; background: white; border: 1px solid #ddd; border-radius: 8px; padding: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); z-index: 100; width: 200px; }
.color-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 10px; }
.color-swatch { width: 28px; height: 28px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.1s; }
.color-swatch:hover { transform: scale(1.1); box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
.color-slider-row { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid #eee; padding-top: 10px; }
.hue-slider { -webkit-appearance: none; width: 100%; height: 12px; border-radius: 6px; background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%); outline: none; border: 1px solid rgba(0,0,0,0.1); }
.hue-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #ccc; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.color-custom-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 0.8rem; color: #555; }
.icon-btn.tiny { font-size: 0.8rem; padding: 2px; color:#888; }
.icon-btn.tiny:hover { color:#333; background:none; }

/* Palette Editor Styles */
.palette-container { 
    display: flex; 
    flex-direction: column; 
    height: 100%; 
    gap: 0; 
    overflow: hidden; /* ★追加 */
}
.history-section { min-height: 0; display: flex; flex-direction: column; } /* flex basis sets height */
.library-section { min-height: 0; display: flex; flex-direction: column; }
.project-list-section { flex: 0 0 180px; display: flex; flex-direction: column; overflow: hidden; }
.history-bg { background-color: #fffbf5; }
.header-title { font-size: 0.75rem; font-weight: bold; display: flex; align-items: center; gap: 6px; }
.header-badge { background: var(--accent-primary); color: #fff; font-size: 0.65rem; padding: 1px 5px; border-radius: 8px; }
.category-selector { width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; font-weight: bold; color: #555; }
.char-grid-dense { display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); gap: 3px; }
.key-dense { height: 28px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid transparent; border-radius: 4px; font-size: 13px; cursor: pointer; color: #333; transition: 0.1s; font-family: var(--font-aa); }
.key-dense:hover { border-color: var(--accent-primary); color: var(--accent-primary); transform: scale(1.2); box-shadow: 0 2px 5px rgba(0,0,0,0.1); z-index: 2; background: #fff; }
.grid-scroll-area { flex: 1; padding: 8px; overflow-y: auto; }
.grid-scroll-area::-webkit-scrollbar { width: 5px; }
.grid-scroll-area::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
.grid-scroll-area::-webkit-scrollbar-thumb:hover { background: #aaa; }
/* Palette Editor List */
.palette-list-item { padding: 8px 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; }
.palette-list-item:hover { background: #f0f0f0; }
.palette-list-item.active { background: var(--accent-primary); color: #fff; font-weight: bold; }
.cat-actions { display: flex; gap: 4px; }
.cat-actions button { background: rgba(255,255,255,0.2); border: none; border-radius: 3px; color: #fff; cursor: pointer; padding: 2px 6px; font-size: 0.7rem; }
.cat-actions button:hover { background: rgba(255,255,255,0.4); }
.cat-actions button.del:hover { background: red; }

.palette-resize-handle {
    flex: 0 0 6px;
    background: #f5f5f5;
    border-top: 1px solid #ddd;
    border-bottom: 1px solid #ddd;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: row-resize;
    z-index: 10;
}
.palette-resize-handle:hover, .palette-resize-handle.active {
    background: #e0e0e0;
}
.palette-resize-handle .handle-bar {
    width: 20px;
    height: 3px;
    background: #ccc;
    border-radius: 2px;
}

/* Remote Caret (Ghost) */
.remote-caret {
    position: absolute;
    width: 2px;
    height: 16px;
    background: rgba(230, 176, 134, 0.8); /* Accent Color */
    z-index: 20;
    pointer-events: none;
    transition: top 0.05s, left 0.05s;
    box-shadow: 0 0 4px rgba(230, 176, 134, 0.5);
}

/* Toast Notification */
.toast-notification {
    position: fixed;
    bottom: 50px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: bold;
    opacity: 0;
    pointer-events: none;
    transition: 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
    z-index: 1000;
}
.toast-notification.active {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
/* ★修正: Box Mode 中は標準の選択色を透明にする (詳細度を上げるため .aa-textarea を付与) */
textarea.aa-textarea.box-mode-active {
    caret-color: transparent !important;
}

textarea.aa-textarea.box-mode-active::selection {
    background-color: transparent !important;
    color: inherit !important;
}

/* ★追加: 新しい矩形選択スタイル */
.box-overlay-container {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 5;
}

.box-selection-line {
    position: absolute;
    background-color: rgba(0, 100, 255, 0.2);
    /* border: 1px solid rgba(0, 100, 255, 0.3); ボーダーがあると重なって濃くなるので好みで */
}

.radio-label {
    display: flex;
    flex-direction: column;
    cursor: pointer;
    padding: 5px;
}
.radio-label input { margin-bottom: 4px; }
.radio-label span { font-weight: bold; font-size: 0.9rem; }
.radio-label .sub-text { font-size: 0.7rem; color: #888; font-weight: normal; }
</style>