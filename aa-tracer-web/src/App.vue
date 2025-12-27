<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from './utils/InferenceEngine';
import { FeatureExtractor } from './utils/FeatureExtractor';

declare const cv: any;

// --- Logic State ---
const engine = new InferenceEngine();
const status = ref('BOOTING...');
const isReady = ref(false);
const isProcessing = ref(false);

const sourceImage = ref<HTMLImageElement | null>(null);
const processedSource = ref<HTMLCanvasElement | null>(null);

// Refs
const canvasRef = ref<HTMLCanvasElement | null>(null);     
const maskCanvasRef = ref<HTMLCanvasElement | null>(null); 
// const paintContainerRef = ref<HTMLElement | null>(null); // ★削除: 未使用
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);

const aaOutput = ref('');
const imageSize = ref({ w: 0, h: 0 });

// --- Image Transform State ---
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
const tracePaneRatio = ref(0.6);
const isResizingPane = ref(false);
const editorStackRef = ref<HTMLElement | null>(null);
const isBottomCollapsed = ref(false);

// Modals
const showPaintModal = ref(false);
const showConfigModal = ref(false);
const showExportModal = ref(false);
const showGridOverlay = ref(false);

// Scroll Sync
const scrollX = ref(0);
const scrollY = ref(0);

const VIEW_SCALE = 1.0; 

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

// --- Image Processing (Thinning) ---
watch([sourceImage, thinningLevel], async () => {
    if (!sourceImage.value) return;
    
    if (thinningLevel.value === 0) {
        processedSource.value = null; 
    } else {
        processSourceImage();
    }
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

    const src = cv.imread(canvas);
    const dst = new cv.Mat();
    
    cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
    cv.threshold(src, src, 200, 255, cv.THRESH_BINARY);

    const M = cv.Mat.ones(3, 3, cv.CV_8U);
    const anchor = new cv.Point(-1, -1);
    cv.dilate(src, dst, M, anchor, thinningLevel.value, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    
    cv.imshow(canvas, dst);
    processedSource.value = canvas;

    src.delete(); dst.delete(); M.delete();
};

// --- Rendering ---
const renderAllCanvases = () => {
    renderCanvas(paintCanvasRef.value); 
    renderCanvas(canvasRef.value);      
};

const renderCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !sourceImage.value) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(imgTransform.value.x, imgTransform.value.y);
    ctx.scale(imgTransform.value.scale, imgTransform.value.scale);
    
    const imgToDraw = processedSource.value || sourceImage.value;
    ctx.drawImage(imgToDraw, 0, 0);
    
    ctx.restore();
};

// --- Image Load ---
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
    updateCanvasDimensions();
    
    if(thinningLevel.value > 0) processSourceImage();

    status.value = 'IMAGE LOADED';
  };
};

const updateCanvasDimensions = () => {
    if (!sourceImage.value) return;
    const w = Math.floor(sourceImage.value.width * imgTransform.value.scale) + 100;
    const h = Math.floor(sourceImage.value.height * imgTransform.value.scale) + 100;

    const setSize = (c: HTMLCanvasElement | null) => {
        if(c) { c.width = w; c.height = h; }
    };
    
    setSize(canvasRef.value);
    setSize(maskCanvasRef.value);
    setSize(paintCanvasRef.value);
    setSize(paintMaskRef.value);
    
    // ★削除: initMaskLayerは使わなくなったので呼び出しも削除
    
    renderAllCanvases();
};

// --- Process (Run AI) ---
const processImage = async () => {
  if (!sourceImage.value || isProcessing.value) return;
  
  if (!canvasRef.value) {
      status.value = 'ERROR: CANVAS NOT FOUND';
      return;
  }

  isProcessing.value = true;
  status.value = 'PROCESSING...';
  showPaintModal.value = false;
  
  if (paintMaskRef.value && maskCanvasRef.value) {
      const ctx = maskCanvasRef.value.getContext('2d')!;
      ctx.clearRect(0, 0, maskCanvasRef.value.width, maskCanvasRef.value.height);
      ctx.drawImage(paintMaskRef.value, 0, 0);
  }
  renderCanvas(canvasRef.value);
  
  setTimeout(async () => {
    try {
      const fullFeatures = FeatureExtractor.generate9ChInput(
          canvasRef.value!, lineWeight.value, thinningLevel.value, maskCanvasRef.value!
      );
      
      const w = canvasRef.value!.width;
      const h = canvasRef.value!.height;
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
    } catch (err) {
      console.error(err);
      status.value = 'ERROR';
    } finally {
      isProcessing.value = false;
    }
  }, 50);
};

// --- Mouse Interaction ---
const getPointerPos = (e: MouseEvent, canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { 
      x: (e.clientX - rect.left) * scaleX, 
      y: (e.clientY - rect.top) * scaleY 
  };
};

const onMouseDown = (e: MouseEvent) => {
  if (!paintMaskRef.value) return;
  if (paintMode.value === 'move') {
      isDraggingImage.value = true;
      lastMousePos.value = { x: e.clientX, y: e.clientY };
  } else if (paintMode.value === 'bucket') {
      const pos = getPointerPos(e, paintMaskRef.value);
      const isEraserMode = e.button === 2 || e.buttons === 2;
      performFloodFill(pos.x, pos.y, isEraserMode);
  } else {
      isDrawing.value = true;
      paint(e);
  }
};

const onMouseMove = (e: MouseEvent) => {
    if (isDraggingImage.value && paintMode.value === 'move') {
        const dx = e.clientX - lastMousePos.value.x;
        const dy = e.clientY - lastMousePos.value.y;
        imgTransform.value.x += dx;
        imgTransform.value.y += dy;
        lastMousePos.value = { x: e.clientX, y: e.clientY };
        renderAllCanvases(); 
        return;
    }
    paint(e);
};

const onMouseUp = () => {
    isDrawing.value = false;
    isDraggingImage.value = false;
    paintMaskRef.value?.getContext('2d')?.beginPath();
};

const onWheel = (e: WheelEvent) => {
    if (!sourceImage.value) return;
    e.preventDefault();
    const zoomSpeed = 0.001;
    const delta = -e.deltaY * zoomSpeed;
    const newScale = Math.max(0.1, imgTransform.value.scale + delta);
    imgTransform.value.scale = newScale;
    updateCanvasDimensions(); 
};

const paint = (e: MouseEvent) => {
  if (!isDrawing.value || paintMode.value === 'bucket' || paintMode.value === 'move' || !paintMaskRef.value) return;
  const ctx = paintMaskRef.value.getContext('2d')!;
  const pos = getPointerPos(e, paintMaskRef.value);
  ctx.lineWidth = brushSize.value;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const isEraser = paintMode.value === 'eraser' || e.buttons === 2;
  
  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
  }
  ctx.lineTo(pos.x, pos.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
};

// FloodFill
const performFloodFill = (startX: number, startY: number, isEraser: boolean) => {
    const srcCanvas = paintCanvasRef.value!;
    const maskCanvas = paintMaskRef.value!;
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const srcMat = cv.imread(srcCanvas);
    cv.cvtColor(srcMat, srcMat, cv.COLOR_RGBA2GRAY);
    cv.threshold(srcMat, srcMat, 200, 255, cv.THRESH_BINARY);
    const fillMask = new cv.Mat.zeros(h + 2, w + 2, cv.CV_8U);
    const seedPoint = new cv.Point(Math.floor(startX), Math.floor(startY));
    if (seedPoint.x < 0 || seedPoint.y < 0 || seedPoint.x >= w || seedPoint.y >= h) {
        srcMat.delete(); fillMask.delete(); return;
    }
    const pixelValue = srcMat.ucharPtr(seedPoint.y, seedPoint.x)[0];
    if (pixelValue < 128) { srcMat.delete(); fillMask.delete(); return; }
    const newVal = new cv.Scalar(100);
    cv.floodFill(srcMat, fillMask, seedPoint, newVal, new cv.Rect(), new cv.Scalar(5), new cv.Scalar(5), 4);
    
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskData = maskCtx.getImageData(0, 0, w, h);
    const data = maskData.data;
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
                    // ★修正: 配列アクセスが undefined になる可能性を ?? で防ぐ
                    data[idx] = color[0] ?? 0; 
                    data[idx+1] = color[1] ?? 0; 
                    data[idx+2] = color[2] ?? 0; 
                    data[idx+3] = color[3] ?? 255; 
                }
            }
        }
    }
    maskCtx.putImageData(maskData, 0, 0);
    srcMat.delete(); fillMask.delete();
};

const onFontFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
      const fontName = file.name.split('.')[0];
      const fontUrl = URL.createObjectURL(file);
      await rebuildDb(fontUrl, fontName!);
  }
};

const rebuildDb = async (fontUrl: string | null, fontName: string | null) => {
    status.value = 'OPTIMIZING AI...';
    await new Promise(r => setTimeout(r, 10));
    try {
        const fUrl = fontUrl || '/Saitamaar.ttf';
        // ★修正: string | null に合わせる
        const fName = fontName || 'Saitamaar';
        
        const defaultSet = new Set(DEFAULT_CHARS.split(''));
        const inputChars = allowedChars.value.split('');
        const hasUnknown = inputChars.some(c => !defaultSet.has(c));
        
        const isSaitamaar = !fontName || /saitama/i.test(fName) || fName === 'Saitamaar';
        const useClassifier = isSaitamaar && !hasUnknown;
        
        const targetModel = useClassifier ? '/aa_model_a.onnx' : '/aa_model_b.onnx';
        const targetMode = useClassifier ? 'classifier' : 'vector';

        await engine.loadModel(targetModel, targetMode);
        await engine.updateDatabase(fUrl, allowedChars.value, fName);
        
        customFontName.value = fName;
        status.value = `DB UPDATED (${targetMode.toUpperCase()} MODE)`;
        
    } catch(err) { 
        console.error(err); 
        status.value = 'DB ERROR'; 
    }
};

// ... (以下、Pane Resize関連は変更なし)
const startResizePane = () => { isResizingPane.value = true; window.addEventListener('mousemove', onResizePane); window.addEventListener('mouseup', stopResizePane); document.body.style.cursor = 'row-resize'; };
const onResizePane = (e: MouseEvent) => { if (!editorStackRef.value || isBottomCollapsed.value) return; const rect = editorStackRef.value.getBoundingClientRect(); const offsetY = e.clientY - rect.top; tracePaneRatio.value = Math.min(0.95, Math.max(0.1, offsetY / rect.height)); };
const stopResizePane = () => { isResizingPane.value = false; window.removeEventListener('mousemove', onResizePane); window.removeEventListener('mouseup', stopResizePane); document.body.style.cursor = ''; };
const toggleCollapse = () => { isBottomCollapsed.value = !isBottomCollapsed.value; };
const onScroll = (e: Event) => { const target = e.target as HTMLTextAreaElement; scrollX.value = target.scrollLeft; scrollY.value = target.scrollTop; };
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
            <div class="editor-card trace-card" :style="{ flex: isBottomCollapsed ? '1' : `0 0 ${tracePaneRatio * 100}%` }">
                <div class="card-header"><span>TRACE EDITOR</span><div class="card-actions"><span v-if="!sourceImage" class="hint">Paint Studioで画像をロードしてください</span></div></div>
                <div class="aa-canvas-wrapper">
                    <div class="scroll-sync-layer" :style="{ transform: `translate(${-scrollX}px, ${-scrollY}px)` }">
                        <div class="canvas-layers" v-show="sourceImage" :style="{ width: canvasRef?.width + 'px', height: canvasRef?.height + 'px', transform: `scale(${VIEW_SCALE})`, transformOrigin: 'top left', opacity: traceOpacity/100 }">
                            <canvas ref="canvasRef" class="layer-base"></canvas>
                            <canvas ref="maskCanvasRef" class="layer-mask" :style="{ opacity: showGridOverlay ? 0 : 0.6 }"></canvas>
                        </div>
                    </div>
                    <textarea class="aa-textarea" v-model="aaOutput" placeholder="Type or Drag Image Here..." @scroll="onScroll" :style="{ minHeight: (imageSize.h * VIEW_SCALE) + 'px', minWidth: (imageSize.w * VIEW_SCALE) + 'px' }"></textarea>
                </div>
                <div class="floating-toolbar" v-if="sourceImage"><button class="tool-btn" @click="showPaintModal = true" title="Edit in Studio">🖌️</button></div>
            </div>
            <div class="resize-handle" @mousedown.prevent="startResizePane" :class="{ active: isResizingPane, collapsed: isBottomCollapsed }"><button class="collapse-btn" @click.stop="toggleCollapse" :title="isBottomCollapsed ? 'Show Detail' : 'Hide Detail'">{{ isBottomCollapsed ? '▲' : '▼' }}</button></div>
            <div class="editor-card text-card" v-show="!isBottomCollapsed" style="flex: 1;"><div class="card-header"><span>DETAIL PREVIEW</span></div><div class="aa-canvas-wrapper"><textarea class="aa-textarea" v-model="aaOutput"></textarea></div></div>
        </main>
        <aside class="sidebar">
            <div class="panel-box" style="flex:1;"><div class="panel-header"><select class="category-select"><option>📂 Basic Lines</option></select></div><div class="grid-area"><div class="char-grid"><div class="key" v-for="c in '─│┌┐└┘├┤┬┴┼━┃┏┓┛┗┣┳┫┻╋'" :key="c" @click="aaOutput += c">{{ c }}</div><div class="key" v-for="c in '｡､･ﾟヽヾゝゞ'" :key="c" @click="aaOutput += c">{{ c }}</div><div class="key" v-for="c in '／＼⊂⊃∪∩∀´｀・…ω'" :key="c" @click="aaOutput += c">{{ c }}</div></div></div></div>
        </aside>
    </div>
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
                        <canvas ref="paintCanvasRef" class="layer-base"></canvas>
                        <canvas ref="paintMaskRef" class="layer-mask" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp" @contextmenu.prevent></canvas>
                    </div>
                    <div v-if="!sourceImage" class="placeholder-text">Please Load Image</div>
                </div>
            </div>
        </div>
    </div>
    <div class="modal-backdrop" v-if="showConfigModal" @click.self="showConfigModal = false"><div class="modal-window config-window"><div class="settings-pane"><div class="settings-title"><span>⚙️ AI Configuration</span><button class="close-btn" @click="showConfigModal = false">✕</button></div><div class="config-section"><h3>Font Setting</h3><div class="control-row"><span class="control-label">CURRENT FONT: {{ customFontName }}</span><p class="desc">Default: Saitamaar (Auto-loaded if exists in public/)</p><label class="studio-btn outline small">Change Font (.ttf)<input type="file" @change="onFontFileChange" accept=".ttf,.otf" hidden></label></div></div></div></div></div>
    <footer class="app-footer"><div class="nav-group"></div><div class="file-group"><button class="footer-btn" @click="showExportModal=true">📤 Export</button></div></footer>
    <div class="modal-backdrop" v-if="showExportModal" @click.self="showExportModal=false"><div class="modal-window"><div class="preview-pane"><div class="aa-export-preview" :style="{color:aaTextColor}">{{aaOutput}}</div></div><div class="settings-pane"><div class="settings-title"><span>Export</span><button @click="showExportModal=false">✕</button></div><button class="big-btn">Download PNG</button></div></div></div>
  </div>
</template>

<style>
@font-face { font-family: 'Saitamaar'; src: url('/Saitamaar.ttf') format('truetype'); font-display: swap; }
:root { --bg-app: #Fdfbf7; --bg-panel: #ffffff; --text-main: #5c554f; --text-sub: #948c85; --accent-primary: #e6b086; --border-soft: 1px solid rgba(92, 85, 79, 0.1); --font-ui: "Hiragino Maru Gothic Pro", "Rounded Mplus 1c", sans-serif; }
* { box-sizing: border-box; } body { margin: 0; height: 100vh; background-color: var(--bg-app); color: var(--text-main); font-family: var(--font-ui); overflow: hidden; }
.app-root { display: flex; flex-direction: column; height: 100%; width: 100%; } button { border:none; background:transparent; cursor:pointer; font-family:inherit; }
.app-header { flex: 0 0 50px; display: flex; align-items: center; justify-content: space-between; padding: 0 15px; background: #fff; border-bottom: var(--border-soft); z-index: 50; }
.brand { font-weight: bold; } .status-indicator { width:8px; height:8px; border-radius:50%; background:#ddd; margin-right:8px; } .status-indicator.ready { background: #0f0; } .status-indicator.processing { background: #f00; animation: blink 1s infinite; }
.visual-controls { display: flex; gap: 10px; align-items: center; } .nav-icon-btn { background: #f5f5f5; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.85rem; }
.range-mini { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; } .icon-btn { font-size: 1.2rem; } .divider { width:1px; height:20px; background:#ddd; }
.workspace { flex: 1; min-height: 0; padding: 0; display: grid; grid-template-columns: 1fr 260px; gap: 0; }
.editor-stack { display: flex; flex-direction: column; height: 100%; min-width: 0; border-right: var(--border-soft); }
.editor-card { background: #fff; display: flex; flex-direction: column; overflow: hidden; border-bottom: var(--border-soft); }
.card-header { flex: 0 0 28px; padding: 0 10px; background: #f9f9f9; font-size: 0.7rem; font-weight: bold; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.aa-canvas-wrapper { flex: 1; position: relative; overflow: hidden; background: #fff; padding: 0; }
.scroll-sync-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; transform-origin: 0 0; will-change: transform; }
.canvas-layers { position: absolute; top:0; left:0; width:auto; height:auto; z-index: 0; } 
.layer-base { position: absolute; top:0; left:0; } .layer-mask { position: absolute; top:0; left:0; cursor: crosshair; pointer-events: auto; }
.aa-textarea { position: relative; z-index: 2; width: 100%; height: 100%; padding: 0 0 0 16px; border: none; resize: none; outline: none; background: transparent; font-family: var(--font-aa), 'MS PGothic', 'Mona', monospace; font-size: 12pt; line-height: 16px; color: var(--aa-text-color); white-space: pre; overflow: auto; scrollbar-gutter: stable; -webkit-font-smoothing: none; }
.resize-handle { flex: 0 0 12px; display: flex; align-items: center; justify-content: center; cursor: row-resize; background: #f0f0f0; z-index:10; border-top:1px solid #ddd; border-bottom:1px solid #ddd; position: relative; }
.resize-handle:hover { background: #e0e0e0; } .handle-bar { width: 40px; height: 4px; background: #ccc; border-radius: 2px; }
.collapse-btn { width: 100%; height: 100%; background: transparent; border: none; font-size: 0.6rem; color: #888; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; letter-spacing: 1px; }
.collapse-btn:hover { color: var(--accent-primary); background: rgba(0,0,0,0.05); }
.floating-toolbar { position: absolute; bottom: 15px; right: 15px; background: #fff; padding: 4px 8px; border-radius: 20px; border: 1px solid #ddd; display: flex; gap: 5px; z-index: 20; box-shadow:0 2px 10px rgba(0,0,0,0.1); }
.tool-btn { width: 28px; height: 28px; border-radius: 50%; font-size: 1rem; display: flex; align-items: center; justify-content: center; } .tool-btn.active { background: #eee; border: 1px solid #ccc; }
.sidebar { display: flex; flex-direction: column; background: #fdfdfd; }
.panel-box { display: flex; flex-direction: column; overflow: hidden; height: 100%; } .panel-header { padding: 8px; background: #f5f5f5; font-size: 0.75rem; font-weight: bold; }
.grid-area { flex: 1; padding: 5px; overflow-y: auto; } .char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 2px; }
.key { height: 32px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #eee; cursor: pointer; } .key:hover { background: #f9f9f9; color: var(--accent-primary); border-color: var(--accent-primary); }
.app-footer { flex: 0 0 32px; background: #f5f5f5; border-top: var(--border-soft); display: flex; align-items: center; justify-content: space-between; padding: 0 10px; }
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
</style>