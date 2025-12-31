<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue';
import { useProjectSystem } from './composables/useProjectSystem';
import { useCanvasPaint } from './composables/useCanvasPaint';
import { useLineArt } from './composables/useLineArt';
import { useAiGeneration } from './composables/useAiGeneration';
import { debounce } from './utils/common'; // ★追加: デバウンス関数

// Components
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';
import PalettePanel from './components/PalettePanel.vue';
import ImageControlPanel from './components/ImageControlPanel.vue';
import AaWorkspace from './components/AaWorkspace.vue';
import AaGridOverlay from './components/AaGridOverlay.vue';
import AaReferenceWindow from './components/AaReferenceWindow.vue';

// --- Composables ---
const project = useProjectSystem();
const paint = useCanvasPaint();
const lineArt = useLineArt();
const ai = useAiGeneration();

// --- Template Aliases ---
const { projectAAs, currentAAIndex, aaOutput, historyChars } = project;

// --- Local UI State ---
const workspaceRef = ref<InstanceType<typeof AaWorkspace> | null>(null);
const canvasRef = computed(() => workspaceRef.value?.canvasRef || null);
const paintCanvasRef = computed(() => workspaceRef.value?.paintCanvasRef || null);
const paintMaskRef = computed(() => workspaceRef.value?.paintMaskRef || null);

const sidebarTab = ref<'palette' | 'image'>('palette');
const traceOpacity = ref(30);
const aaTextColor = ref('#222222');    
const subTextColor = ref('#ffffff');   
const tracePaneRatio = ref(0.5); 
const showBackgroundImage = ref(true);
const viewMode = ref<'single' | 'split'>('single');
const splitDirection = ref<'horizontal' | 'vertical'>('horizontal');
const isLayoutSwapped = ref(false); 
const showConfigModal = ref(false);
const showExportModal = ref(false);
const showDebugModal = ref(false);
const showPaletteEditor = ref(false); 

// Cursor / Ghost
const ghostText = ref('');
const ghostPos = ref({ x: 0, y: 0 });
const isGhostVisible = ref(false);
const activeEditor = ref<'trace' | 'text' | null>(null);
const caretSyncPos = ref({ x: 0, y: 0 });
const cursorInfo = ref({ row: 1, col: 1, charCount: 0, px: 0 });
const lastCaretIndex = ref(-1); // キャレット位置の変更検知用

// Box Selection
const boxSelectionRects = ref<any[]>([]);
const isAltPressed = ref(false);
const isBoxSelecting = ref(false);

// New UI Features
const showGrid = ref(false);
const refWindowVisible = ref(false);
const refContent = ref({ title: '', content: '' });

// --- Palette Data & Editing ---
interface Category { id: string; name: string; chars: string; }

const defaultCategories: Category[] = [
    { id: '1', name: 'Basic', chars: "─│┌┐└┘├┤┬┴┼" },
    { id: '2', name: 'Block', chars: "■□▀▄▌▐▖▗▘▙▚▛▜" },
    { id: '3', name: 'Symbol', chars: "★☆○●◎◇◆" }
];

const categories = ref<Category[]>(JSON.parse(JSON.stringify(defaultCategories)));
const editingCatId = ref<string | null>(null);

const editingCategory = computed(() => {
    return categories.value.find(c => c.id === editingCatId.value);
});

const loadPaletteFromStorage = () => {
    const saved = localStorage.getItem('aa_palette_v1');
    if (saved) {
        try { categories.value = JSON.parse(saved); } catch(e) {}
    }
};

const savePaletteToStorage = () => {
    localStorage.setItem('aa_palette_v1', JSON.stringify(categories.value));
};

const addCategory = () => {
    const newId = Date.now().toString();
    categories.value.push({ id: newId, name: 'New Category', chars: '' });
    editingCatId.value = newId;
    savePaletteToStorage();
};

const removeCategory = (id: string) => {
    if (!confirm("Delete this category?")) return;
    categories.value = categories.value.filter(c => c.id !== id);
    if (editingCatId.value === id) editingCatId.value = null;
    savePaletteToStorage();
};

const moveCategory = (idx: number, dir: number) => {
    const target = idx + dir;
    if (target >= 0 && target < categories.value.length) {
        const temp = categories.value[idx];
        categories.value[idx] = categories.value[target]!;
        categories.value[target] = temp!;
        savePaletteToStorage();
    }
};

const fontStack = computed(() => ai.customFontName.value === 'Saitamaar' ? `'MSP_Parallel', 'Saitamaar'` : `'${ai.customFontName.value}'`);

// --- Lifecycle ---
onMounted(async () => {
    project.resetHistory();
    loadPaletteFromStorage();
    
    // Key Events
    window.addEventListener('keydown', (e) => { if (e.key === 'Alt') isAltPressed.value = true; });
    window.addEventListener('keyup', (e) => { if (e.key === 'Alt') isAltPressed.value = false; });
    
    // ★重要: Mouse Eventsの登録
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('mousemove', onGlobalMouseMove);
    
    await ai.initEngine();
});

onUnmounted(() => {
    // クリーンアップ
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('mousemove', onGlobalMouseMove);
});

// --- Feature Logic Wrappers ---

// Grid / Page Ops
const addNewPage = () => {
    project.addNewAA();
    showGrid.value = false;
};

const deletePage = (idx: number) => {
    if (confirm('Are you sure you want to delete this page?')) {
        project.deleteAA(idx);
    }
};

const duplicatePage = () => {
    const current = projectAAs.value[currentAAIndex.value];
    if (current) {
        projectAAs.value.push({
            title: current.title + ' (Copy)',
            content: current.content
        });
        currentAAIndex.value = projectAAs.value.length - 1;
        project.showToastMessage('Page Duplicated');
    }
};

// Reference Pin
const toggleRef = () => {
    if (!refWindowVisible.value) {
        refContent.value = {
            title: projectAAs.value[currentAAIndex.value]?.title || 'Ref',
            content: aaOutput.value
        };
        refWindowVisible.value = true;
    } else {
        refWindowVisible.value = false;
    }
};

// Layout Ops
const toggleLayoutWrapper = (mode: string) => {
    if (mode === 'single') {
        viewMode.value = 'single';
    } else {
        viewMode.value = 'split';
        splitDirection.value = mode === 'split-h' ? 'horizontal' : 'vertical';
    }
};

// File Ops
const triggerLoadWrapper = (enc: string) => {
    project.loadEncoding.value = enc as any;
    document.getElementById('fileInput')?.click();
};

// Config toggle wrapper
const toggleSafeMode = () => {
    // 設定変更を反映し、ハイライトを即座に更新
    ai.initEngine(); 
    project.updateSyntaxHighlight(ai.config.value.safeMode);
};

// Image & Paint & AI
const onImageLoaded = (file: File) => {
    if (!ai.isReady.value) return;
    const img = new Image(); img.src = URL.createObjectURL(file);
    img.onload = async () => {
        paint.sourceImage.value = img; paint.imageSize.value = { w: img.width, h: img.height };
        paint.initPaintBuffer(img.width, img.height);
        sidebarTab.value = 'image'; paint.paintMode.value = 'move';
        await nextTick();
        paint.imgTransform.value = { x: 0, y: 0, scale: 1.0, rotation: 0 };
        await paint.updateCanvasDimensions();
        
        // リセット
        lineArt.rawLineArtCanvas.value = null; 
        lineArt.processedSource.value = null;
        
        // 初期処理
        if (lineArt.thinningLevel.value > 0) lineArt.processSourceImage(null, img);
        
        ai.status.value = 'IMAGE LOADED';
        renderAllCanvases();
    };
};

const renderAllCanvases = () => {
    if (!canvasRef.value || !paintCanvasRef.value) return;
    // LineArt加工済みがあればそれ、なければ元画像
    const src = lineArt.processedSource.value || paint.sourceImage.value;
    
    renderLayer(canvasRef.value, src);
    if (paint.paintBuffer.value) {
        renderLayer(paintCanvasRef.value, paint.paintBuffer.value);
    }
};

const renderLayer = (targetCanvas: HTMLCanvasElement, source: HTMLImageElement | HTMLCanvasElement | null) => {
    const ctx = targetCanvas.getContext('2d', { willReadFrequently: true })!;
    const w = targetCanvas.width; const h = targetCanvas.height;
    
    // 全体クリア
    ctx.clearRect(0, 0, w, h);
    
    // ベースレイヤーだけ背景白塗り
    if (targetCanvas === canvasRef.value) { 
        ctx.fillStyle = "white"; 
        ctx.fillRect(0, 0, w, h); 
    }
    
    if (!source) return;
    
    ctx.save();
    ctx.translate(paint.imgTransform.value.x, paint.imgTransform.value.y);
    ctx.rotate(paint.imgTransform.value.rotation * Math.PI / 180);
    ctx.scale(paint.imgTransform.value.scale, paint.imgTransform.value.scale);
    ctx.imageSmoothingEnabled = true; // 綺麗に描画
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0);
    ctx.restore();
};

const updateImageTransformWrapper = async () => { 
    await paint.updateCanvasDimensions(); 
    renderAllCanvases(); 
};

const processImageWrapper = () => { 
    if (canvasRef.value) {
        ai.runGeneration(canvasRef.value, paint.paintBuffer.value, paint.imgTransform.value, project.aaOutput); 
    }
};

const extractLineArtWrapper = async () => { 
    if (paint.sourceImage.value) { 
        await lineArt.extractLineArt(paint.sourceImage.value); 
        sidebarTab.value = 'image'; 
        renderAllCanvases(); 
    } 
};

// Font change handler (修正版)
const onFontFileChange = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
      const url = URL.createObjectURL(file);
      const fontName = file.name.split('.')[0];
      
      // ステータス更新
      ai.status.value = 'OPTIMIZING AI...';
      
      // UIの描画更新のために少し待機
      await new Promise(r => setTimeout(r, 50));

      try {
          // カスタムフォントなので強制的に Vector モードにする
          ai.engine.mode = 'vector';
          ai.customFontName.value = fontName!;

          // エンジンのDBを再構築 (URL, 現在の許可文字リスト, フォント名)
          await ai.engine.updateDatabase(
              url, 
              ai.config.value.allowedChars, 
              fontName!
          );
          
          ai.status.value = 'READY (VEC)';
      } catch (err) {
          console.error(err);
          ai.status.value = 'FONT ERROR';
      }
  }
};

const swapColors = () => { const t = aaTextColor.value; aaTextColor.value = subTextColor.value; subTextColor.value = t; };
const invertColor = () => { 
    let hex = aaTextColor.value.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    aaTextColor.value = y > 128 ? '#222222' : '#ffffff';
};

// Paint Event Handlers (Fix)
const onMouseDownCanvas = (e: MouseEvent) => {
    if (ai.isProcessing.value) return;
    
    // Move Mode
    if (paint.paintMode.value === 'move') {
        paint.isDraggingImage.value = true;
        paint.lastMousePos.value = { x: e.clientX, y: e.clientY };
        e.preventDefault(); 
        return;
    }
    
    // Paint Mode: Buffer Check
    if (!paint.paintBuffer.value && paint.sourceImage.value) {
        paint.initPaintBuffer(paint.sourceImage.value.width, paint.sourceImage.value.height);
    }
    if (!paint.paintBuffer.value) return;

    // Calc Pos
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const imgPos = paint.toImageSpace(screenPos.x, screenPos.y);

    if (paint.paintMode.value === 'bucket') {
        const bg = lineArt.processedSource.value || paint.sourceImage.value;
        if (bg) paint.performFloodFill(imgPos.x, imgPos.y, e.button === 2, bg);
        renderAllCanvases();
    } else {
        const ctx = paint.paintBuffer.value.getContext('2d', { willReadFrequently: true })!;
        ctx.beginPath();
        ctx.moveTo(imgPos.x, imgPos.y);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        (window as any).isPaintDragging = true;
        (window as any).lastImgPos = imgPos;
        
        const isEraser = paint.paintMode.value === 'eraser' || e.buttons === 2;
        ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
        if (!isEraser) ctx.strokeStyle = paint.paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
        ctx.lineWidth = paint.brushSize.value;
        ctx.lineTo(imgPos.x, imgPos.y);
        ctx.stroke();
        renderAllCanvases();
    }
};

const onGlobalMouseMove = (e: MouseEvent) => {
    if (ai.isProcessing.value) return;
    
    // Image Moving
    if (paint.isDraggingImage.value && paint.paintMode.value === 'move') {
        const dx = e.clientX - paint.lastMousePos.value.x;
        const dy = e.clientY - paint.lastMousePos.value.y;
        paint.imgTransform.value.x += dx;
        paint.imgTransform.value.y += dy;
        paint.lastMousePos.value = { x: e.clientX, y: e.clientY };
        
        // アニメーションフレームで再描画 (滑らかさ向上)
        requestAnimationFrame(() => {
            renderAllCanvases();
        });
        return;
    }
    
    // Paint Drawing
    if (sidebarTab.value === 'image' && (window as any).isPaintDragging && paint.paintBuffer.value && paintMaskRef.value) {
         const rect = paintMaskRef.value.getBoundingClientRect();
         const imgPos = paint.toImageSpace(e.clientX - rect.left, e.clientY - rect.top);
         const lastPos = (window as any).lastImgPos;
         const ctx = paint.paintBuffer.value.getContext('2d')!;
         ctx.lineWidth = paint.brushSize.value; ctx.lineCap='round'; ctx.lineJoin='round';
         const isEraser = paint.paintMode.value === 'eraser' || e.buttons === 2;
         ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
         if(!isEraser) ctx.strokeStyle = paint.paintColor.value === 'blue' ? '#0000FF' : '#FF0000';
         ctx.beginPath(); ctx.moveTo(lastPos.x, lastPos.y); ctx.lineTo(imgPos.x, imgPos.y); ctx.stroke();
         (window as any).lastImgPos = imgPos;
         
         requestAnimationFrame(() => {
            renderAllCanvases();
         });
    }
};
const onGlobalMouseUp = () => { 
    paint.isDraggingImage.value = false; 
    (window as any).isPaintDragging = false; 
};

// Config handler
const onConfigUpdate = async () => {
    await ai.updateAllowedChars(); // DB再構築も含む
    project.updateSyntaxHighlight(ai.config.value.safeMode);
};

// ★追加: パレットから文字を追加するラッパー関数
const addCharWrapper = (char: string) => {
    if (!char) return;
    
    // 1. 履歴に追加
    project.recordCharHistory(char);
    
    // 2. Workspaceに挿入命令を送る
    if (workspaceRef.value) {
        // activeEditor が null の場合は 'trace' (メイン) に入れる
        workspaceRef.value.insertAtCursor(char, activeEditor.value || 'trace');
    }
};

// ★追加: ライブプレビュー用の監視ロジック
// LineArt設定またはThinningレベルが変わったら、少し待ってから適用処理を走らせる
const updateLineArtPreview = debounce(() => {
    if (!paint.sourceImage.value) return;

    // LineArtの抽出済みデータがある場合 -> 設定適用 (Threshold/Thickness)
    if (lineArt.rawLineArtCanvas.value) {
        lineArt.applyLineArtSettings(paint.sourceImage.value);
    } 
    // まだ抽出していない場合 -> Thinningだけ適用 (Process Source)
    else {
        lineArt.processSourceImage(null, paint.sourceImage.value);
    }
    
    // 画面更新
    renderAllCanvases();
}, 150); // 150msの遅延

// 監視設定
watch(
    [
        () => lineArt.lineArtSettings.value, // Threshold, Thickness
        () => lineArt.thinningLevel.value    // Thinning
    ],
    () => {
        updateLineArtPreview();
    },
    { deep: true }
);

// --- Helper: キャレットのピクセル座標を計算 (修正版) ---
const getCaretPixelPos = (
    textarea: HTMLTextAreaElement, 
    text: string, 
    caretIdx: number
): { x: number, y: number, row: number, col: number } | null => {
    // 1. 行と列を特定
    const textBefore = text.substring(0, caretIdx);
    const lines = textBefore.split('\n');
    const row = lines.length - 1;
    const currentLineText = lines[row]!;
    
    // 2. 文字幅を計測
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px "${ai.customFontName.value}"`;
    const textWidth = ctx.measureText(currentLineText).width;

    // 3. テキストエリアのスタイルを取得 (padding, border)
    const style = window.getComputedStyle(textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    
    // 4. 座標計算
    // Y座標 = 行数×高さ + 上余白 + 上枠線 - スクロール量
    const y = (row * 16) + paddingTop + borderTop - textarea.scrollTop;
    
    // X座標 = 文字幅 + 左余白 + 左枠線 - スクロール量
    const x = textWidth + paddingLeft + borderLeft - textarea.scrollLeft;
    
    return { x, y, row, col: currentLineText.length };
};

// --- Action: サジェストの更新 (Debounce付き) ---
const updateGhostSuggestion = debounce(async (textarea: HTMLTextAreaElement) => {
    if (!paint.sourceImage.value || !ai.isReady.value) return;
    
    const caretIdx = textarea.selectionStart;
    if (caretIdx !== textarea.selectionEnd) {
        isGhostVisible.value = false; // 範囲選択中は無効
        return;
    }

    const pos = getCaretPixelPos(textarea, project.aaOutput.value, caretIdx);
    if (!pos) return;

    // 画面外チェック (簡易)
    if (pos.y > paint.canvasDims.value.height) {
        isGhostVisible.value = false;
        return;
    }

    // AIに問い合わせ
    const suggestion = await ai.getSuggestion(
        canvasRef.value!, 
        paint.paintBuffer.value, 
        paint.imgTransform.value, 
        pos.x, 
        pos.y + 16/2 // 行の中心Y座標を渡す
    );

    if (suggestion && suggestion.length > 0) {
        ghostText.value = suggestion;
        ghostPos.value = { x: pos.x, y: pos.y };
        isGhostVisible.value = true;
    } else {
        isGhostVisible.value = false;
    }
}, 150); // 150ms待ってから推論

// --- Event Handlers ---

// カーソル移動や入力時に呼ばれる
const onTextCursorMove = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    if (!target) return;
    
    // キャレット位置が変わったか確認
    if (target.selectionStart === lastCaretIndex.value) return;
    lastCaretIndex.value = target.selectionStart;

    // ゴーストを一旦消して、再計算予約
    isGhostVisible.value = false;
    updateGhostSuggestion(target);
};

// キー入力ハンドリング
const onTextKeyDown = async (e: KeyboardEvent) => {
    // Tabキー: いかなる場合もフォーカス移動を防ぐ
    if (e.key === 'Tab') {
        e.preventDefault(); 

        // ゴーストが表示されていれば確定する
        if (isGhostVisible.value) {
            const char = ghostText.value;
            
            if (workspaceRef.value) {
                // 1. 文字を挿入
                workspaceRef.value.insertAtCursor(char, activeEditor.value || 'text');
                
                // 2. 一旦ゴーストを消す
                isGhostVisible.value = false;
                
                // 3. ★重要: DOM更新（カーソル移動）が完了するのを待つ
                await nextTick();

                // 4. 新しい位置で次のサジェストを即座にリクエスト
                const ta = (activeEditor.value === 'text' 
                    ? (workspaceRef.value as any).textTextareaRef 
                    : (workspaceRef.value as any).traceTextareaRef) as HTMLTextAreaElement;
                
                if (ta) {
                    // Debounceされているため、ここで呼んでも少し待ってから実行されます。
                    // もし連打したい場合は、debounce無しの関数を別途用意する必要がありますが、
                    // まずはこの修正で挙動を確認してください。
                    updateGhostSuggestion(ta);
                }
            }
        }
        return;
    }
    
    // 他のキー入力があったらゴーストを消す（Shift等は除く）
    if (isGhostVisible.value && !['Shift', 'Control', 'Alt'].includes(e.key)) {
        isGhostVisible.value = false;
    }
};

// Watchers
watch(aaOutput, () => {
    // テキスト変更時にハイライト更新
    if (ai.config.value.safeMode) {
        project.updateSyntaxHighlight(true);
    }
});
</script>

<template>
  <div class="app-root" :style="{ '--aa-text-color': aaTextColor, '--font-aa': fontStack }">
    <AppHeader 
      :status="ai.status.value" :is-ready="ai.isReady.value" :is-processing="ai.isProcessing.value"
      v-model:aa-text-color="aaTextColor" v-model:sub-text-color="subTextColor"
      @toggle-debug="showDebugModal=true" @toggle-config="showConfigModal=true"
      @swap-colors="swapColors" @invert-color="invertColor"
    />

    <div class="workspace">
      <AaWorkspace ref="workspaceRef"
        v-model:aa-output="aaOutput"
        v-model:current-aa-title="projectAAs[currentAAIndex]!.title"
        
        :is-painting-active="sidebarTab === 'image'"
        @click-text="onTextCursorMove"
        @keyup-text="onTextCursorMove"
        
        @keydown-text="onTextKeyDown"
        v-model:trace-pane-ratio="tracePaneRatio"
        :view-mode="viewMode" :split-direction="splitDirection" :is-layout-swapped="isLayoutSwapped"
        :source-image="paint.sourceImage.value" :canvas-dims="paint.canvasDims.value" :trace-opacity="traceOpacity"
        :show-background-image="showBackgroundImage" :show-grid-overlay="false"
        :paint-mode="paint.paintMode.value" :caret-sync-pos="caretSyncPos"
        :is-box-selecting="isBoxSelecting" :box-selection-rects="boxSelectionRects"
        :is-ghost-visible="isGhostVisible" :ghost-pos="ghostPos" :ghost-text="ghostText"
        :aa-text-color="aaTextColor" 
        :highlighted-h-t-m-l="project.highlightedHTML.value" 
        @active-editor="val => activeEditor = val"
        @mousedown-canvas="onMouseDownCanvas"
        @input-text="e => { project.recordCharHistory((e as any).data); }"
        @paste-text="e => project.handlePaste(e, e.target as HTMLTextAreaElement)"
      />

      <aside class="sidebar">
        <div class="sidebar-tabs">
          <button :class="{ active: sidebarTab==='palette' }" @click="sidebarTab='palette'">📝 Palette</button>
          <button :class="{ active: sidebarTab==='image' }" @click="sidebarTab='image'">🎨 Image</button>
        </div>
        
        <PalettePanel v-show="sidebarTab==='palette'"
          :history-chars="historyChars" :project-a-as="projectAAs" :current-a-a-index="currentAAIndex" :categories="categories"
          @add-char="addCharWrapper" 
          @select-aa="idx => { currentAAIndex = idx; }" 
          @delete-aa="deletePage" 
          @add-new-aa="addNewPage"
          @show-palette-editor="showPaletteEditor=true"
        />

        <ImageControlPanel v-show="sidebarTab==='image'"
          :source-image="paint.sourceImage.value" :is-processing="ai.isProcessing.value"
          :raw-line-art-canvas="lineArt.rawLineArtCanvas.value" :line-art-settings="lineArt.lineArtSettings.value"
          :trace-opacity="traceOpacity" :img-transform="paint.imgTransform.value"
          :paint-mode="paint.paintMode.value" :paint-color="paint.paintColor.value" :brush-size="paint.brushSize.value"
          :target-char-blue="ai.targetCharBlue.value" :target-char-red="ai.targetCharRed.value"
          :thinning-level="lineArt.thinningLevel.value" :noise-gate="ai.config.value.noiseGate" :generation-mode="ai.config.value.generationMode"
          @load-image="onImageLoaded" @extract-lineart="extractLineArtWrapper"
          @reset-lineart="() => { lineArt.rawLineArtCanvas.value=null; renderAllCanvases(); }"
          @process-image="processImageWrapper"
          @update:img-transform="val => { paint.imgTransform.value = val; updateImageTransformWrapper(); }"
          @update:paint-mode="val => paint.paintMode.value = val as any"
          @update:paint-color="val => paint.paintColor.value = val as any"
          @update:brush-size="val => paint.brushSize.value = val"
          @update:trace-opacity="val => traceOpacity = val"
          @update:line-art-settings="val => lineArt.lineArtSettings.value = val"
          @update:thinning-level="val => lineArt.thinningLevel.value = val"
          @update:noise-gate="val => ai.config.value.noiseGate = val"
          @update:generation-mode="val => ai.config.value.generationMode = val as any"
        />
      </aside>
    </div>

    <AppFooter 
      :current-aa-index="currentAAIndex" :total-a-as="projectAAs.length"
      :title="projectAAs[currentAAIndex]?.title || ''"
      :cursor-info="cursorInfo" :is-box-selecting="isBoxSelecting"
      :view-mode="viewMode" :show-background-image="showBackgroundImage"
      @nav-prev="currentAAIndex = Math.max(0, currentAAIndex - 1)"
      @nav-next="currentAAIndex = Math.min(projectAAs.length - 1, currentAAIndex + 1)"
      @toggle-grid="showGrid = !showGrid"
      @duplicate="duplicatePage"
      @pin-ref="toggleRef"
      @delete="deletePage(currentAAIndex)"
      
      @undo="project.undo" 
      @redo="project.redo"
      @trigger-load="triggerLoadWrapper"
      @save="(fmt, enc) => project.onSaveFile(fmt, enc as any)"
      @copy="mode => project.triggerCopy(mode as any)"
      @show-export="showExportModal = true"
      @apply-edit="val => project.applyTextEdit(val, ai.customFontName.value)"
      @paste-box="() => project.applyTextEdit('paste-box', ai.customFontName.value)"
      
      @toggle-layout="toggleLayoutWrapper"
      @swap-panes="isLayoutSwapped = !isLayoutSwapped"
      @toggle-box-mode="isBoxSelecting = !isBoxSelecting"
      @toggle-bg-image="showBackgroundImage = !showBackgroundImage"
    />

    <AaGridOverlay 
      :is-active="showGrid" :project-a-as="projectAAs" :current-index="currentAAIndex"
      @close="showGrid = false"
      @select="idx => { currentAAIndex = idx; showGrid = false; }"
      @add="addNewPage"
      @delete="deletePage"
    />

    <AaReferenceWindow 
      :is-visible="refWindowVisible" 
      :title="refContent.title" :content="refContent.content"
      @close="refWindowVisible = false" 
    />

    <div class="modal-backdrop" v-if="showPaletteEditor" @click.self="showPaletteEditor = false">
        <div class="modal-window" style="width: 700px; height: 500px; display:flex; flex-direction:column;">
            <div class="studio-header">
                <h2>✏️ Edit Palette</h2>
                <button class="close-btn" @click="showPaletteEditor = false">✕</button>
            </div>
            
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
                                <button @click.stop="moveCategory(idx, -1)" :disabled="idx===0" title="Move Up">↑</button>
                                <button @click.stop="moveCategory(idx, 1)" :disabled="idx===categories.length-1" title="Move Down">↓</button>
                                <button @click.stop="removeCategory(cat.id)" class="del" title="Delete">×</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column; padding:20px;" v-if="editingCategory">
                    <div class="control-group">
                        <label>Category Name</label>
                        <input type="text" v-model="editingCategory.name" @change="savePaletteToStorage" class="full-input">
                    </div>
                    <div class="control-group" style="flex:1; display:flex; flex-direction:column;">
                        <label>Characters</label>
                        <textarea v-model="editingCategory.chars" @change="savePaletteToStorage" class="config-textarea" style="flex:1; font-size:16px;"></textarea>
                        <p class="desc">Newlines and spaces are ignored.</p>
                    </div>
                </div>
                <div style="flex:1; display:flex; align-items:center; justify-content:center; color:#999;" v-else>
                    Select a category to edit.
                </div>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" v-if="showConfigModal" @click.self="showConfigModal = false">
        <div class="modal-window config-window">
            <div class="studio-header">
                <h2>⚙️ Configuration</h2>
                <button class="close-btn" @click="showConfigModal = false">✕</button>
            </div>
            
            <div class="settings-pane">
                <div class="config-section">
                    <h3>Allowed Characters</h3>
                    <div class="char-select-grid">
                        <button v-for="c in ai.allCharCandidates.value" :key="c" 
                                class="char-select-btn" :class="{ active: ai.config.value.allowedChars.includes(c) }"
                                @click="ai.toggleAllowedChar(c)">{{ c }}</button>
                    </div>
                    <textarea v-model="ai.config.value.allowedChars" @change="onConfigUpdate" class="config-textarea" style="height:60px; margin-top:10px;"></textarea>
                </div>

                <div class="config-section">
                    <h3>Font Settings</h3>
                    <div class="control-row">
                        <span class="control-label">Current: <b>{{ ai.customFontName.value }}</b></span>
                        <label class="studio-btn outline small">Change (.ttf)
                            <input type="file" @change="onFontFileChange" accept=".ttf,.otf" hidden>
                        </label>
                    </div>
                </div>

                <div class="config-section">
                    <h3>Advanced</h3>
                    <label class="check-row">
                        <input type="checkbox" v-model="ai.config.value.useThinSpace" @change="ai.initEngine">
                        <span>Use Advanced 1px Shift (Thin Space)</span>
                    </label>
                    <label class="check-row">
                        <input type="checkbox" v-model="ai.config.value.safeMode" @change="toggleSafeMode">
                        <span>BBS Compatibility Mode (Safe Mode)</span>
                    </label>
                </div>
            </div>
        </div>
    </div>

    <div class="modal-backdrop" v-if="showExportModal" @click.self="showExportModal=false">
        <div class="modal-window"><div class="settings-pane"><button class="big-btn" @click="showExportModal=false">Close</button></div></div>
    </div>
    
    <div class="toast-notification" :class="{ active: project.showToast.value }">{{ project.toastMessage.value }}</div>
    
    <input id="fileInput" type="file" hidden @change="project.onLoadFile(($event.target as HTMLInputElement).files![0]!)" accept=".txt,.mlt,.ast">
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
.card-header { flex: 0 0 28px; padding: 0 10px; background: #f9f9f9; font-size: 0.7rem; font-weight: bold; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.resize-handle { flex: 0 0 8px; display: flex; align-items: center; justify-content: center; cursor: row-resize; background: #f9f9f9; border-top:1px solid #ddd; border-bottom:1px solid #ddd; z-index:10; }
.resize-handle.handle-v { flex: 0 0 8px; cursor: col-resize; border-top: none; border-bottom: none; border-left: 1px solid #ddd; border-right: 1px solid #ddd; flex-direction: column; }
.resize-handle.handle-v .handle-bar { width: 3px; height: 30px; }

.handle-bar { width: 30px; height: 3px; background: #ccc; border-radius: 2px; }
.panel-box { display: flex; flex-direction: column; overflow: hidden; height: 100%; } .panel-header { padding: 8px; background: #f5f5f5; font-size: 0.75rem; font-weight: bold; display:flex; justify-content:space-between; align-items:center; }
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
.palette-container { display: flex; flex-direction: column; height: 100%; gap: 0; overflow: hidden; }
.history-section { min-height: 0; display: flex; flex-direction: column; }
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

/* ★追加: サイドバーのスクロール対応 */
.scrollable-content {
    overflow-y: auto;
    overflow-x: hidden;
    /* スクロールバーのデザイン (Chrome/Safari) */
    scrollbar-width: thin;
}
.scrollable-content::-webkit-scrollbar {
    width: 6px;
}
.scrollable-content::-webkit-scrollbar-thumb {
    background-color: #ccc;
    border-radius: 3px;
}

/* ★追加: 処理中オーバーレイ */
.processing-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.7);
    backdrop-filter: blur(2px);
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #333;
    font-weight: bold;
}

.processing-text {
    margin-top: 10px;
    font-size: 0.9rem;
    color: #555;
    animation: blink 1.5s infinite;
}

/* ★追加: スピナーアニメーション */
.spinner {
    width: 30px;
    height: 30px;
    border: 4px solid rgba(0, 0, 0, 0.1);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

.spinner.small {
    width: 16px;
    height: 16px;
    border-width: 2px;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

</style>