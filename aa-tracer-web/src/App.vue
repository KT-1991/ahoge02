<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from './utils/InferenceEngine';
import { FeatureExtractor } from './utils/FeatureExtractor';
import { AaFileManager, type AaEntry, type EncodingType, type FileFormat } from './utils/AaFileManager';

declare const cv: any;

// --- Logic State ---
const engine = new InferenceEngine();
const status = ref('BOOTING...');
const isReady = ref(false);
const isProcessing = ref(false);

const sourceImage = ref<HTMLImageElement | null>(null);
const processedSource = ref<HTMLCanvasElement | null>(null);

// Refs & Dims
const canvasRef = ref<HTMLCanvasElement | null>(null);     
const maskCanvasRef = ref<HTMLCanvasElement | null>(null); 
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);
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

const imageSize = ref({ w: 0, h: 0 });
const imgTransform = ref({ x: 0, y: 0, scale: 1.0 });
const isDraggingImage = ref(false);
const lastMousePos = ref({ x: 0, y: 0 });

// Settings
const lineWeight = ref(0.6);
const thinningLevel = ref(0);
const customFontName = ref('Saitamaar');
const allowedChars = ref(DEFAULT_CHARS);

// Tools
const paintColor = ref<'blue' | 'red'>('blue');
const paintMode = ref<'brush' | 'bucket' | 'eraser' | 'move'>('move'); 
const brushSize = ref(10);
const isDrawing = ref(false);
const targetCharBlue = ref(':');
const targetCharRed = ref('/');

// UI State
const traceOpacity = ref(30);
const aaTextColor = ref('#222222');
const tracePaneRatio = ref(0.6); // 上部パネルの比率 (0.0 ~ 1.0)
const isResizingPane = ref(false);
const editorStackRef = ref<HTMLElement | null>(null);

// Menus & Modals
const showLoadMenu = ref(false);
const showSaveMenu = ref(false);
const showGridOverlay = ref(false);
const showPaintModal = ref(false);
const showConfigModal = ref(false);
const showExportModal = ref(false);

// Ghost State
const ghostText = ref('');
const ghostPos = ref({ x: 0, y: 0 });
const isGhostVisible = ref(false);
const mirrorRef = ref<HTMLElement | null>(null);

const scrollX = ref(0);
const scrollY = ref(0);
//const VIEW_SCALE = 1.0; 

// --- Lifecycle ---
onMounted(async () => {
  const checkCv = setInterval(async () => {
    if ((window as any).cvLoaded) {
      clearInterval(checkCv);
      status.value = 'LOADING AI...';
      try {
        await engine.init('/aa_model_a.onnx', '/Saitamaar.ttf', '/aa_chars.json', 'classifier');
        status.value = 'READY';
        isReady.value = true;
      } catch (e) {
        status.value = 'ERROR';
        console.error(e);
      }
    }
  }, 100);
});

// --- File I/O ---
const loadEncoding = ref<EncodingType>('AUTO');
const triggerLoad = (enc: EncodingType) => {
    loadEncoding.value = enc;
    document.getElementById('fileInput')?.click();
    showLoadMenu.value = false;
};
const onFileSelected = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
        const loaded = await AaFileManager.loadFile(file, loadEncoding.value);
        if (loaded.length > 0) {
            projectAAs.value = loaded;
            currentAAIndex.value = 0;
            status.value = `LOADED ${loaded.length} AAs`;
        }
    } catch (err) {
        console.error(err);
        status.value = 'LOAD ERROR';
    }
    (e.target as HTMLInputElement).value = '';
};
const onSaveFile = (format: FileFormat, encoding: EncodingType) => {
    const ext = format === 'AST' ? '.ast' : '.mlt';
    const name = `aa_project${ext}`;
    AaFileManager.saveFile(projectAAs.value, encoding, format, name);
    showSaveMenu.value = false;
};

// Project Mgmt
const addNewAA = () => {
    const num = projectAAs.value.length + 1;
    projectAAs.value.push({ title: `Untitled ${num}`, content: '' });
    currentAAIndex.value = projectAAs.value.length - 1;
    showGridOverlay.value = false;
};
const deleteAA = (idx: number) => {
    if (projectAAs.value.length <= 1) {
        projectAAs.value[0]!.content = '';
        projectAAs.value[0]!.title = 'Untitled 1';
        return;
    }
    projectAAs.value.splice(idx, 1);
    if (currentAAIndex.value >= projectAAs.value.length) {
        currentAAIndex.value = projectAAs.value.length - 1;
    }
};
const selectAA = (idx: number) => {
    currentAAIndex.value = idx;
    showGridOverlay.value = false;
};

// --- Watchers & Processing ---
watch([sourceImage, thinningLevel], async () => {
    if (!sourceImage.value) return;
    ghostText.value = ''; isGhostVisible.value = false;
    if (thinningLevel.value === 0) processedSource.value = null; 
    else processSourceImage();
    await nextTick();
    renderAllCanvases(); 
});
const processSourceImage = () => {
    if (!sourceImage.value) return;
    const canvas = document.createElement('canvas');
    canvas.width = sourceImage.value.width;
    canvas.height = sourceImage.value.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(sourceImage.value, 0, 0);
    // eslint-disable-next-line no-undef
    const src = (window as any).cv.imread(canvas);
    const dst = new (window as any).cv.Mat();
    (window as any).cv.cvtColor(src, src, (window as any).cv.COLOR_RGBA2GRAY);
    (window as any).cv.threshold(src, src, 200, 255, (window as any).cv.THRESH_BINARY);
    const M = (window as any).cv.Mat.ones(3, 3, (window as any).cv.CV_8U);
    const anchor = new (window as any).cv.Point(-1, -1);
    (window as any).cv.dilate(src, dst, M, anchor, thinningLevel.value, (window as any).cv.BORDER_CONSTANT, (window as any).cv.morphologyDefaultBorderValue());
    (window as any).cv.imshow(canvas, dst);
    processedSource.value = canvas;
    src.delete(); dst.delete(); M.delete();
};
const renderAllCanvases = () => { renderCanvas(paintCanvasRef.value); renderCanvas(canvasRef.value); };
const renderCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !sourceImage.value) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width; const h = canvas.height;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(imgTransform.value.x, imgTransform.value.y);
    ctx.scale(imgTransform.value.scale, imgTransform.value.scale);
    const imgToDraw = processedSource.value || sourceImage.value;
    ctx.drawImage(imgToDraw, 0, 0);
    ctx.restore();
};
const onFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file || !isReady.value) return;
  loadImageFromFile(file);
};
const loadImageFromFile = (file: File) => {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = async () => {
    sourceImage.value = img;
    imageSize.value = { w: img.width, h: img.height };
    showPaintModal.value = true;
    paintMode.value = 'move';
    await nextTick();
    imgTransform.value = { x: 0, y: 0, scale: 1.0 };
    await updateCanvasDimensions();
    if(thinningLevel.value > 0) processSourceImage();
    status.value = 'IMAGE LOADED';
  };
};
const updateCanvasDimensions = async () => {
    if (!sourceImage.value) return;
    const w = Math.floor(sourceImage.value.width * imgTransform.value.scale) + 100;
    const h = Math.floor(sourceImage.value.height * imgTransform.value.scale) + 100;
    canvasDims.value = { width: w, height: h };
    await nextTick();
    renderAllCanvases();
};
const processImage = async () => {
  if (!sourceImage.value || isProcessing.value) return;
  if (!canvasRef.value) return;
  isProcessing.value = true; status.value = 'PROCESSING...'; showPaintModal.value = false;
  if (paintMaskRef.value && maskCanvasRef.value) {
      const ctx = maskCanvasRef.value.getContext('2d')!;
      ctx.clearRect(0, 0, maskCanvasRef.value.width, maskCanvasRef.value.height);
      ctx.drawImage(paintMaskRef.value, 0, 0);
  }
  renderCanvas(canvasRef.value);
  setTimeout(async () => {
    try {
      const fullFeatures = FeatureExtractor.generate9ChInput(canvasRef.value!, lineWeight.value, thinningLevel.value, maskCanvasRef.value!);
      const w = canvasRef.value!.width; const h = canvasRef.value!.height;
      const lineH = 16; const cropH = 32;
      let result = "";
      const imgBottom = (imgTransform.value.y + sourceImage.value!.height * imgTransform.value.scale);
      const scanLimitY = Math.min(h, imgBottom + 50);
      for (let y = cropH / 2; y < scanLimitY - cropH / 2; y += lineH) {
         status.value = `ROW ${Math.floor(y/16)}`;
         const lineLen = cropH * w * 9;
         const startIdx = (y - cropH/2) * w * 9;
         const lineFeat = fullFeatures.subarray(startIdx, startIdx + lineLen);
         const lineText = await engine.solveLine(lineFeat, w, targetCharBlue.value, targetCharRed.value);
         result += lineText + "\n";
         aaOutput.value = result;
         await new Promise(r => setTimeout(r, 0));
      }
      status.value = 'DONE';
    } catch (err) { console.error(err); status.value = 'ERROR'; } finally { isProcessing.value = false; }
  }, 50);
};

// --- Input Handling ---
const onKeyDown = (e: KeyboardEvent) => {
    if (e.shiftKey && e.code === 'Space') {
        if (isGhostVisible.value && ghostText.value) { e.preventDefault(); insertGhostText(); }
        return;
    }
};
const onInput = () => { updateGhostDebounced(); };
const insertGhostText = () => {
    const textarea = document.querySelector('.aa-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart; const end = textarea.selectionEnd;
    const text = textarea.value; const insert = ghostText.value;
    aaOutput.value = text.substring(0, start) + insert + text.substring(end);
    nextTick(() => { textarea.selectionStart = textarea.selectionEnd = start + insert.length; engine.recordUsage(insert); updateGhost(); });
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
    const rowCtx = rowCanvas.getContext('2d')!;
    const srcY = Math.max(0, lineY - 8);
    const dstY = (lineY - 8 < 0) ? (8 - lineY) : 0; 
    rowCtx.drawImage(canvasRef.value, 0, srcY, canvasRef.value.width, 32, 0, dstY, canvasRef.value.width, 32);
    const features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, thinningLevel.value);
    const suggestion = await engine.suggestText(features, rowCanvas.width, caretPixelX, 3);
    if (suggestion) { ghostText.value = suggestion; ghostPos.value = { x: caretPixelX, y: lineY }; isGhostVisible.value = true; } else { isGhostVisible.value = false; }
};

const onScroll = (e: Event) => { 
    const target = e.target as HTMLElement; 
    scrollX.value = target.scrollLeft; 
    scrollY.value = target.scrollTop; 
};

// --- Mouse Interaction ---
const getPointerPos = (e: MouseEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
};
const onMouseDown = (e: MouseEvent) => {
  if (!paintMaskRef.value) return;
  if (paintMode.value === 'move') { isDraggingImage.value = true; lastMousePos.value = { x: e.clientX, y: e.clientY }; }
  else if (paintMode.value === 'bucket') { const pos = getPointerPos(e, paintMaskRef.value); performFloodFill(pos.x, pos.y, e.button === 2 || e.buttons === 2); }
  else { isDrawing.value = true; paint(e); }
};
const onMouseMove = (e: MouseEvent) => {
    if (isDraggingImage.value && paintMode.value === 'move') {
        const dx = e.clientX - lastMousePos.value.x; const dy = e.clientY - lastMousePos.value.y;
        imgTransform.value.x += dx; imgTransform.value.y += dy; lastMousePos.value = { x: e.clientX, y: e.clientY }; renderAllCanvases(); return;
    }
    paint(e);
};
const onMouseUp = () => { isDrawing.value = false; isDraggingImage.value = false; paintMaskRef.value?.getContext('2d')?.beginPath(); };
const onWheel = (e: WheelEvent) => {
    if (!sourceImage.value) return; e.preventDefault();
    const zoomSpeed = 0.001; const delta = -e.deltaY * zoomSpeed;
    const newScale = Math.max(0.1, imgTransform.value.scale + delta);
    imgTransform.value.scale = newScale; updateCanvasDimensions(); 
};
const paint = (e: MouseEvent) => {
  if (!isDrawing.value || paintMode.value === 'bucket' || paintMode.value === 'move' || !paintMaskRef.value) return;
  const ctx = paintMaskRef.value.getContext('2d')!;
  const pos = getPointerPos(e, paintMaskRef.value);
  ctx.lineWidth = brushSize.value; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const isEraser = paintMode.value === 'eraser' || e.buttons === 2;
  if (isEraser) { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = 'rgba(0,0,0,1)'; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = paintColor.value === 'blue' ? '#0000FF' : '#FF0000'; }
  ctx.lineTo(pos.x, pos.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
};
const performFloodFill = (startX: number, startY: number, isEraser: boolean) => {
    const srcCanvas = paintCanvasRef.value!; const maskCanvas = paintMaskRef.value!;
    const w = srcCanvas.width; const h = srcCanvas.height;
    // eslint-disable-next-line no-undef
    const srcMat = (window as any).cv.imread(srcCanvas);
    (window as any).cv.cvtColor(srcMat, srcMat, (window as any).cv.COLOR_RGBA2GRAY);
    (window as any).cv.threshold(srcMat, srcMat, 200, 255, (window as any).cv.THRESH_BINARY);
    const fillMask = new (window as any).cv.Mat.zeros(h + 2, w + 2, (window as any).cv.CV_8U);
    const seedPoint = new (window as any).cv.Point(Math.floor(startX), Math.floor(startY));
    if (seedPoint.x < 0 || seedPoint.y < 0 || seedPoint.x >= w || seedPoint.y >= h) { srcMat.delete(); fillMask.delete(); return; }
    const pixelValue = srcMat.ucharPtr(seedPoint.y, seedPoint.x)[0];
    if (pixelValue < 128) { srcMat.delete(); fillMask.delete(); return; }
    const newVal = new (window as any).cv.Scalar(100);
    (window as any).cv.floodFill(srcMat, fillMask, seedPoint, newVal, new (window as any).cv.Rect(), new (window as any).cv.Scalar(5), new (window as any).cv.Scalar(5), 4);
    const maskCtx = maskCanvas.getContext('2d')!; const maskData = maskCtx.getImageData(0, 0, w, h);
    const data = maskData.data; let color = [0, 0, 0, 0];
    if (!isEraser) { color = paintColor.value === 'blue' ? [0, 0, 255, 150] : [255, 0, 0, 150]; }
    const maskPtr = fillMask.data; const maskStride = w + 2;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const maskIdx = (y + 1) * maskStride + (x + 1);
            if (maskPtr[maskIdx] !== 0) {
                const idx = (y * w + x) * 4;
                if (isEraser) { data[idx + 3] = 0; } else { data[idx] = color[0] ?? 0; data[idx+1] = color[1] ?? 0; data[idx+2] = color[2] ?? 0; data[idx+3] = color[3] ?? 255; }
            }
        }
    }
    maskCtx.putImageData(maskData, 0, 0); srcMat.delete(); fillMask.delete();
};
const onFontFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) { const fontName = file.name.split('.')[0]; const fontUrl = URL.createObjectURL(file); await rebuildDb(fontUrl, fontName!); }
};
const rebuildDb = async (fontUrl: string | null, fontName: string | null) => {
    status.value = 'OPTIMIZING AI...'; await new Promise(r => setTimeout(r, 10));
    try {
        const fUrl = fontUrl || '/Saitamaar.ttf'; const fName = fontName || 'Saitamaar';
        const defaultSet = new Set(DEFAULT_CHARS.split('')); const inputChars = allowedChars.value.split('');
        const hasUnknown = inputChars.some(c => !defaultSet.has(c));
        const isSaitamaar = !fontName || /saitama/i.test(fName) || fName === 'Saitamaar';
        const useClassifier = isSaitamaar && !hasUnknown;
        const targetModel = useClassifier ? '/aa_model_a.onnx' : '/aa_model_b.onnx';
        const targetMode = useClassifier ? 'classifier' : 'vector';
        await engine.init(targetModel, fUrl, '/aa_chars.json', targetMode);
        customFontName.value = fName; status.value = `DB UPDATED (${targetMode.toUpperCase()} MODE)`;
    } catch(err) { console.error(err); status.value = 'DB ERROR'; }
};

// --- Resizer Logic ---
const startResizePane = () => { isResizingPane.value = true; window.addEventListener('mousemove', onResizePane); window.addEventListener('mouseup', stopResizePane); document.body.style.cursor = 'row-resize'; };
const onResizePane = (e: MouseEvent) => { 
    if (!editorStackRef.value) return; 
    const rect = editorStackRef.value.getBoundingClientRect(); 
    const offsetY = e.clientY - rect.top; 
    // 上部の比率を計算 (最小10%, 最大90%)
    tracePaneRatio.value = Math.min(0.9, Math.max(0.1, offsetY / rect.height)); 
};
const stopResizePane = () => { isResizingPane.value = false; window.removeEventListener('mousemove', onResizePane); window.removeEventListener('mouseup', stopResizePane); document.body.style.cursor = ''; };

// ★追加: テキストの内容から必要なサイズを計算する
const textDimensions = computed(() => {
    const text = aaOutput.value;
    if (!text) return { width: 0, height: 0 };

    const lines = text.split('\n');
    // 高さ: 行数 × 16px + 余白(200px)
    const h = lines.length * 16 + 200;
    
    // 幅: 最長行の文字数 × 概算幅(10px) + 余白
    // ※正確な幅計算は重いので概算です。AAは縦に長いことが多いので、高さ確保が主目的です。
    let maxLen = 0;
    for (const line of lines) {
        if (line.length > maxLen) maxLen = line.length;
    }
    const w = maxLen * 10 + 100;

    return { width: w, height: h };
});

// ★追加: 最終的に適用するキャンバスエリアのサイズ
const activeCanvasSize = computed(() => {
    // 画像サイズ (未ロード時は0)
    const imgW = canvasDims.value.width;
    const imgH = canvasDims.value.height;
    
    // テキストサイズ
    const txtW = textDimensions.value.width;
    const txtH = textDimensions.value.height;

    // 大きい方を採用 (ただし画像があるときは画像の幅を優先したい場合もあるが、
    // エディタとしては切れるよりは広がったほうが安全)
    return {
        width: Math.max(imgW, txtW),
        height: Math.max(imgH, txtH)
    };
});

</script>

<template>
  <div class="app-root" :style="{ '--aa-text-color': aaTextColor, '--font-aa': customFontName }">
    <header class="app-header">
        <div class="brand"><div class="status-indicator" :class="{ ready: isReady, processing: isProcessing }"></div>Cozy Craft AA</div>
        <div class="visual-controls">
            <button class="nav-icon-btn" @click="showPaintModal = true" title="Paint Studio">🎨 Paint Studio</button>
            <button class="nav-icon-btn" @click="showConfigModal = true" title="AI Config">⚙️ Config</button>
            <div class="divider"></div>
            <div class="range-mini"><span>👁️</span><input type="range" min="0" max="100" v-model="traceOpacity" title="Trace Opacity"></div>
            <button class="icon-btn" @click="aaTextColor = aaTextColor==='#ffffff'?'#222222':'#ffffff'">◑</button>
        </div>
    </header>

    <div class="workspace">
        <main class="editor-stack" ref="editorStackRef">
            <div class="editor-card trace-card" :style="{ flex: `0 0 ${tracePaneRatio * 100}%` }">
                <div class="card-header">
                    <input v-model="projectAAs[currentAAIndex]!.title" class="aa-title-input" placeholder="AA Title" />
                    <div class="card-actions">
                        <span v-if="!sourceImage" class="hint">Paint Studioで画像をロードしてください</span>
                    </div>
                </div>
                
                <div class="aa-canvas-wrapper" @scroll="onScroll">
                    <div class="canvas-scroll-area" 
                         :style="{ 
                            width: (activeCanvasSize.width || '100%') + (activeCanvasSize.width ? 'px' : ''), 
                            height: (activeCanvasSize.height || '100%') + (activeCanvasSize.height ? 'px' : '') 
                         }">
                        <div class="canvas-layers" v-show="sourceImage" 
                             :style="{ width: '100%', height: '100%', opacity: traceOpacity/100 }">
                            <canvas ref="canvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base"></canvas>
                            <canvas ref="maskCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" :style="{ opacity: showGridOverlay ? 0 : 0.6 }"></canvas>
                        </div>
                        <div class="ghost-layer" v-show="isGhostVisible" :style="{ width: '100%', height: '100%' }">
                            <span class="ghost-text" :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px' }">{{ ghostText }}</span>
                        </div>
                        <textarea class="aa-textarea" v-model="aaOutput" @keydown="onKeyDown" @input="onInput" @click="updateGhost" @keyup="updateGhostDebounced" placeholder="Type or Drag Image Here..."></textarea>
                    </div>
                </div>
                <div class="floating-toolbar" v-if="sourceImage"><button class="tool-btn" @click="showPaintModal = true" title="Edit in Studio">🖌️</button></div>
            </div>

            <div class="resize-handle" @mousedown.prevent="startResizePane" :class="{ active: isResizingPane }">
                <div class="handle-bar"></div>
            </div>

            <div class="editor-card text-card" style="flex: 1;">
                <div class="aa-canvas-wrapper" >
                    <textarea class="aa-textarea" v-model="aaOutput" :style="{ 
                            width: (activeCanvasSize.width || '100%') + (activeCanvasSize.width ? 'px' : ''), 
                            height: (activeCanvasSize.height || '100%') + (activeCanvasSize.height ? 'px' : '') 
                         }"></textarea>
                </div>
            </div>
        </main>

        <aside class="sidebar">
            <div class="panel-box" style="flex:1;">
                <div class="panel-header"><select class="category-select"><option>📂 Basic Lines</option></select></div>
                <div class="grid-area">
                    <div class="char-grid">
                        <div class="key" v-for="c in '─│┌┐└┘├┤┬┴┼━┃┏┓┛┗┣┳┫┻╋'" :key="c" @click="aaOutput += c">{{ c }}</div>
                        <div class="key" v-for="c in '｡､･ﾟヽヾゝゞ'" :key="c" @click="aaOutput += c">{{ c }}</div>
                        <div class="key" v-for="c in '／＼⊂⊃∪∩∀´｀・…ω'" :key="c" @click="aaOutput += c">{{ c }}</div>
                    </div>
                </div>
            </div>
        </aside>
    </div>

    <div ref="mirrorRef" class="aa-mirror"></div>

    <div class="grid-overlay" :class="{ active: showGridOverlay }" @click.self="showGridOverlay = false">
        <div v-for="(aa, idx) in projectAAs" :key="idx" class="thumb-card" :class="{ 'active-page': idx === currentAAIndex }" @click="selectAA(idx)">
            <div class="thumb-content">{{ aa.content }}</div>
            <div class="thumb-label">{{ idx + 1 }}. {{ aa.title }}</div>
            <button class="thumb-del" @click.stop="deleteAA(idx)">×</button>
        </div>
        <div class="thumb-card add-card" @click="addNewAA"><span style="font-size:2rem; color:#ccc;">+</span></div>
    </div>

    <footer class="app-footer">
        <div class="footer-compact-row">
            <button class="footer-icon-btn" @click="currentAAIndex = Math.max(0, currentAAIndex - 1)" title="Prev Page">←</button>
            
            <div class="page-indicator" @click="showGridOverlay = !showGridOverlay">
                <span>{{ currentAAIndex + 1 }} / {{ projectAAs.length }}</span>
                <span style="font-size:0.7rem; opacity:0.5; margin-left:4px;">▼</span>
            </div>
            
            <button class="footer-icon-btn" @click="currentAAIndex = Math.min(projectAAs.length - 1, currentAAIndex + 1)" title="Next Page">→</button>
            
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

            <button class="footer-text-btn" @click="showExportModal=true">📤 Export</button>
            
            <input id="fileInput" type="file" hidden @change="onFileSelected" accept=".txt,.mlt,.ast">
        </div>
    </footer>

    <div class="studio-modal" v-show="showPaintModal">
        <div class="studio-content">
            <div class="studio-header"><h2>🎨 Paint Studio</h2><div class="studio-actions"><label class="studio-btn outline">📂 Load Image <input type="file" @change="onFileChange" accept="image/*" hidden /></label><button class="studio-btn primary" @click="processImage" :disabled="!sourceImage || isProcessing">{{ isProcessing ? 'Generating...' : '✨ Run AI' }}</button><button class="close-btn" @click="showPaintModal = false">✕</button></div></div>
            <div class="studio-body">
                <div class="paint-toolbar">
                     <div class="tool-section"><span class="label">MODE</span><button :class="{ active: paintMode==='move' }" @click="paintMode='move'">✋ MOVE</button></div><div class="sep"></div>
                     <div class="tool-section"><span class="label">THINNING: {{ thinningLevel }}</span><input type="range" min="0" max="3" v-model.number="thinningLevel" style="width:60px;"></div><div class="sep"></div>
                     <div class="tool-section"><span class="label">COLOR</span><button :class="{ active: paintColor==='blue' }" @click="paintColor='blue'"><span class="swatch blue"></span> DOT</button><button :class="{ active: paintColor==='red' }" @click="paintColor='red'"><span class="swatch red"></span> LINE</button></div>
                     <div class="tool-section"><button :class="{ active: paintMode==='brush' }" @click="paintMode='brush'">🖌️</button><button :class="{ active: paintMode==='bucket' }" @click="paintMode='bucket'">🪣</button><button :class="{ active: paintMode==='eraser' }" @click="paintMode='eraser'">🧹</button></div>
                     <div class="tool-section"><span class="label">SIZE: {{brushSize}}</span><input type="range" min="1" max="50" v-model="brushSize" style="width:80px;"></div>
                </div>
                <div class="paint-canvas-area" @wheel="onWheel">
                    <div class="canvas-stack" v-show="sourceImage">
                        <canvas ref="paintCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base"></canvas>
                        <canvas ref="paintMaskRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" @contextmenu.prevent></canvas>
                    </div>
                    <div v-if="!sourceImage" class="placeholder-text">Please Load Image</div>
                </div>
            </div>
        </div>
    </div>
    <div class="modal-backdrop" v-if="showConfigModal" @click.self="showConfigModal = false"><div class="modal-window config-window"><div class="settings-pane"><div class="settings-title"><span>⚙️ AI Configuration</span><button class="close-btn" @click="showConfigModal = false">✕</button></div><div class="config-section"><h3>Font Setting</h3><div class="control-row"><span class="control-label">CURRENT FONT: {{ customFontName }}</span><p class="desc">Default: Saitamaar (Auto-loaded if exists in public/)</p><label class="studio-btn outline small">Change Font (.ttf)<input type="file" @change="onFontFileChange" accept=".ttf,.otf" hidden></label></div></div></div></div></div>
    <div class="modal-backdrop" v-if="showExportModal" @click.self="showExportModal=false"><div class="modal-window"><div class="preview-pane"><div class="aa-export-preview" :style="{color:aaTextColor}">{{aaOutput}}</div></div><div class="settings-pane"><div class="settings-title"><span>Export</span><button @click="showExportModal=false">✕</button></div><button class="big-btn">Download PNG</button></div></div></div>
  </div>
</template>

<style>
@font-face { font-family: 'Saitamaar'; src: url('/Saitamaar.ttf') format('truetype'); font-display: swap; }
:root { --bg-app: #Fdfbf7; --bg-panel: #ffffff; --text-main: #5c554f; --text-sub: #948c85; --accent-primary: #e6b086; --border-soft: 1px solid rgba(92, 85, 79, 0.1); --font-ui: "Hiragino Maru Gothic Pro", "Rounded Mplus 1c", sans-serif; }
* { box-sizing: border-box; } 
body { margin: 0; height: 100vh; background-color: var(--bg-app); color: var(--text-main); font-family: var(--font-ui); overflow: hidden; }
.app-root { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; } 
button { border:none; background:transparent; cursor:pointer; font-family:inherit; }

/* Header & Footer */
.app-header { flex: 0 0 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; background: #fff; border-bottom: var(--border-soft); z-index: 50; }
.app-footer { flex: 0 0 45px; background: #f5f5f5; border-top: var(--border-soft); display: flex; align-items: center; justify-content: center; padding: 0 10px; z-index: 50; }

/* Compact Footer Style */
.footer-compact-row { display: flex; align-items: center; gap: 10px; }
.footer-icon-btn { font-size: 1.1rem; padding: 4px 8px; color: var(--text-main); border-radius: 4px; }
.footer-icon-btn:hover { background: #e0e0e0; }
.footer-text-btn { font-size: 0.85rem; font-weight: bold; padding: 6px 10px; border-radius: 6px; color: var(--text-main); }
.footer-text-btn:hover { background: #e0e0e0; }
.footer-sep { width:1px; height:20px; background:#ccc; margin:0 5px; }
.page-indicator { font-weight: bold; font-size: 0.9rem; padding: 4px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; }
.page-indicator:hover { background: #e0e0e0; }

/* Workspace */
.workspace { flex: 1; min-height: 0; padding: 0; display: grid; grid-template-columns: 1fr 260px; gap: 0; overflow: hidden; }
.editor-stack { display: flex; flex-direction: column; height: 100%; min-width: 0; border-right: var(--border-soft); overflow: hidden; }
.editor-card { background: #fff; display: flex; flex-direction: column; overflow: hidden; border-bottom: var(--border-soft); }

/* Resizer - Clean Splitter */
.resize-handle { flex: 0 0 8px; display: flex; align-items: center; justify-content: center; cursor: row-resize; background: #f9f9f9; border-top:1px solid #ddd; border-bottom:1px solid #ddd; z-index:10; }
.resize-handle:hover { background: #eee; }
.handle-bar { width: 30px; height: 3px; background: #ccc; border-radius: 2px; }

/* Canvas */
.aa-canvas-wrapper { flex: 1; position: relative; overflow: auto; background: #fff; padding: 0; }
.canvas-scroll-area { position: relative; min-width: 100%; min-height: 100%; }
.aa-textarea { position: absolute; top:0; left:0; width: 100%; height: 100%; padding: 0 0 0 16px; border: none; resize: none; outline: none; background: transparent; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 12pt; line-height: 16px; color: var(--aa-text-color); white-space: pre; overflow: hidden; z-index: 2; }
.canvas-layers { position: absolute; top:0; left:0; z-index: 0; pointer-events: none; } 
.layer-base { position: absolute; top:0; left:0; } .layer-mask { position: absolute; top:0; left:0; }

/* Sidebar & Others (Existing) */
.brand { font-weight: bold; } .status-indicator { width:8px; height:8px; border-radius:50%; background:#ddd; margin-right:8px; } .status-indicator.ready { background: #0f0; } .status-indicator.processing { background: #f00; animation: blink 1s infinite; }
.visual-controls { display: flex; gap: 10px; align-items: center; } .nav-icon-btn { background: #f5f5f5; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
.range-mini { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; } .icon-btn { font-size: 1.2rem; } .divider { width:1px; height:20px; background:#ddd; }
.card-header { flex: 0 0 28px; padding: 0 10px; background: #f9f9f9; font-size: 0.7rem; font-weight: bold; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.floating-toolbar { position: absolute; bottom: 15px; right: 15px; background: #fff; padding: 4px 8px; border-radius: 20px; border: 1px solid #ddd; display: flex; gap: 5px; z-index: 20; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
.tool-btn { width: 28px; height: 28px; border-radius: 50%; font-size: 1rem; display: flex; align-items: center; justify-content: center; } .tool-btn.active { background: #eee; border: 1px solid #ccc; }
.sidebar { display: flex; flex-direction: column; background: #fdfdfd; }
.panel-box { display: flex; flex-direction: column; overflow: hidden; height: 100%; } .panel-header { padding: 8px; background: #f5f5f5; font-size: 0.75rem; font-weight: bold; }
.grid-area { flex: 1; padding: 5px; overflow-y: auto; } .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 2px; }
.key { height: 32px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #eee; cursor: pointer; } .key:hover { background: #f9f9f9; color: var(--accent-primary); border-color: var(--accent-primary); }
.studio-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #e6e6e6; z-index: 200; display: flex; align-items: center; justify-content: center; padding: 20px; }
.studio-content { width: 100%; height: 100%; background: #fff; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; }
.studio-header { flex: 0 0 50px; padding: 0 15px; border-bottom: 1px solid #eee; display: flex; align-items: center; justify-content: space-between; }
.studio-body { flex: 1; display: flex; flex-direction: column; background: #888; }
.paint-toolbar { flex: 0 0 40px; background: #333; color: #eee; display: flex; align-items: center; padding: 0 15px; gap: 15px; font-size: 0.8rem; }
.paint-canvas-area { flex: 1; overflow: auto; background: #999; display: block; position: relative; }
.canvas-stack { position: relative; background: white; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
.studio-btn { padding: 4px 12px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; } .studio-btn.primary { background: var(--accent-primary); color: #fff; } .studio-btn.outline { border: 1px solid #ccc; background: #fff; }
.swatch { width:10px; height:10px; display:inline-block; border-radius:50%; } .swatch.blue{background:blue;} .swatch.red{background:red;}
.modal-backdrop { position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(2px); z-index: 300; display: flex; align-items: center; justify-content: center; }
.modal-window { width: 500px; background: #fff; border-radius: 8px; display: flex; overflow: hidden; max-height: 80vh; }
.config-window { flex-direction: column; } .settings-pane { padding: 15px; overflow-y:auto; } .close-btn { font-size: 1.2rem; color: #999; }
@keyframes blink { 50% { opacity: 0; } }
.ghost-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 5; }
.ghost-text { position: absolute; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 12pt; line-height: 16px; color: rgba(0, 0, 0, 0.3); white-space: pre; pointer-events: none; background: rgba(255, 255, 0, 0.2); }
.app-root[style*="--aa-text-color: #ffffff"] .ghost-text { color: rgba(255, 255, 255, 0.4); }
.aa-mirror { position: absolute; top: -9999px; left: -9999px; visibility: hidden; white-space: pre; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 12pt; line-height: 16px; padding: 0 0 0 16px; border: none; }
.grid-overlay { position: fixed; top:0; left:0; width:100%; height: calc(100vh - 50px); background: rgba(253, 251, 247, 0.95); backdrop-filter: blur(5px); z-index: 30; padding: 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; grid-auto-rows: 150px; overflow-y: auto; opacity: 0; pointer-events: none; transition: 0.3s; }
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
.aa-title-input { border: none; background: transparent; font-weight: bold; font-size: 0.8rem; width: 200px; outline: none; border-bottom: 1px solid transparent; transition: 0.2s; }
.aa-title-input:focus { border-bottom: 1px solid var(--accent-primary); }
.aa-count { font-size: 0.75rem; color: #999; }
.file-menu-popover { position: absolute; top: 35px; right: 10px; width: 200px; background: white; border: 1px solid #ccc; box-shadow: 0 4px 10px rgba(0,0,0,0.1); border-radius: 4px; z-index: 100; display: flex; flex-direction: column; padding: 5px 0; }
.file-menu-popover.bottom-up { top: auto; bottom: 45px; right: 0; }
.menu-item { display: block; padding: 8px 15px; text-align: left; font-size: 0.85rem; cursor: pointer; color: #333; background: none; border: none; width: 100%; transition: 0.1s; }
.menu-item:hover { background: #f5f5f5; color: var(--accent-primary); }
.menu-label { padding: 4px 10px; font-size: 0.7rem; font-weight: bold; color: #999; background: #f9f9f9; }
.btn-accent { background: var(--text-main); color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.btn-accent:hover { background: #443d38; transform: translateY(-1px); }
</style>