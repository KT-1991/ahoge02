<script setup lang="ts">
import { ref, onUnmounted, nextTick, computed, watch, onMounted } from 'vue';
import { useI18n } from '../composables/useI18n'; // ★追加

const { t } = useI18n(); // ★追加

const props = defineProps<{
  viewMode: 'single' | 'split';
  splitDirection: 'horizontal' | 'vertical';
  isLayoutSwapped: boolean;
  tracePaneRatio: number;
  aaOutput: string;
  currentAaTitle: string;
  sourceImage: HTMLImageElement | null;
  canvasDims: { width: number, height: number };
  traceOpacity: number;
  showBackgroundImage: boolean;
  showGridOverlay: boolean;
  paintMode: string;
  caretSyncPos: { x: number, y: number };
  isBoxSelecting: boolean;
  isGhostVisible: boolean;
  ghostPos: { x: number, y: number };
  ghostText: string;
  aaTextColor: string;
  highlightedHTML: string;
  isPaintingActive: boolean;
  contextMenuVisible: boolean;
  contextMenuPos: { x: number, y: number };
  contextCandidates: { char: string, score: number }[];
  fontStack: string; 
}>();

const emit = defineEmits<{
  (e: 'update:aaOutput', val: string): void;
  (e: 'update:currentAaTitle', val: string): void;
  (e: 'update:tracePaneRatio', val: number): void;
  (e: 'active-editor', val: 'trace' | 'text'): void;
  (e: 'scroll', ev: Event): void;
  (e: 'mousedown-canvas', ev: MouseEvent): void;
  (e: 'wheel-canvas', ev: WheelEvent): void;
  (e: 'input-text', ev: Event): void;
  (e: 'click-text', ev: MouseEvent): void;
  (e: 'keydown-text', ev: KeyboardEvent): void;
  (e: 'keypress-text', ev: KeyboardEvent): void;
  (e: 'keyup-text', ev: KeyboardEvent): void;
  (e: 'focus-text', source: 'trace'|'text'): void;
  (e: 'mousedown-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mousemove-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mouseup-textarea'): void;
  (e: 'paste-text', ev: ClipboardEvent): void;
  (e: 'request-context-menu', ev: MouseEvent, target: HTMLTextAreaElement): void;
  (e: 'select-candidate', char: string): void;
  (e: 'close-context-menu'): void;
  (e: 'cursor-info-update', info: { px: number }): void;
  (e: 'flow-paint-end', pos: { minY: number, maxY: number }): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const maskCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);
const editorStackRef = ref<HTMLElement | null>(null);
const traceTextareaRef = ref<HTMLTextAreaElement | null>(null);
const textTextareaRef = ref<HTMLTextAreaElement | null>(null);
const activeEditor = ref<'trace' | 'text' | null>(null);
const syncCaretStyle = ref({ top: '0px', left: '0px', height: '16px', display: 'none' });
const textareaHeight = ref(0);

// Flow Brush用: 更新範囲の記録
const dirtyRect = ref<{ minY: number, maxY: number } | null>(null);

// ★追加: 共通の範囲更新ロジック
const updateDirtyRect = (clientY: number) => {
    if (!traceTextareaRef.value || !dirtyRect.value) return;
    
    const rect = traceTextareaRef.value.getBoundingClientRect();
    // テキストエリア基準でのY座標を計算
    const y = clientY - rect.top + traceTextareaRef.value.scrollTop;
    
    dirtyRect.value.minY = Math.min(dirtyRect.value.minY, y);
    dirtyRect.value.maxY = Math.max(dirtyRect.value.maxY, y);
};

const resizeTextarea = () => {
    const ta = traceTextareaRef.value;
    if (!ta) return;
    ta.style.height = 'auto'; 
    const scrollH = ta.scrollHeight;
    textareaHeight.value = scrollH;
    ta.style.height = scrollH + 'px';
    ta.style.overflow = 'hidden';
};
const containerStyle = computed(() => {
    // 画像がない場合でも最低限の高さを確保 (800x600ベース)
    const imgH = props.canvasDims.height || 600; 
    const txtH = textareaHeight.value;
    const finalH = Math.max(imgH, txtH, 100); 
    return { width: (props.canvasDims.width || 800) + 'px', height: finalH + 'px', minHeight: '100%', position: 'relative' as const };
});

watch(() => props.aaOutput, () => nextTick(resizeTextarea));
watch(() => props.sourceImage, () => nextTick(resizeTextarea));
watch(() => props.canvasDims, () => nextTick(resizeTextarea), { deep: true });
onMounted(() => { nextTick(resizeTextarea); });

const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    emit('update:aaOutput', target.value);
    emit('input-text', e);
    resizeTextarea();
    nextTick(() => updateSyncCaretAndInfo(target));
};

const updateSyncCaretAndInfo = (target: HTMLTextAreaElement) => {
    if (!target) return;
    const caret = target.selectionStart;
    const textBefore = props.aaOutput.substring(0, caret);
    const lines = textBefore.split('\n');
    const row = lines.length - 1;
    const currentLineText = lines[row] || '';
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${props.fontStack}`;
    const textWidth = ctx.measureText(currentLineText).width;
    const style = window.getComputedStyle(target);
    const paddingLeft = parseFloat(style.paddingLeft) || 10;
    const paddingTop = parseFloat(style.paddingTop) || 10;
    const top = (row * 16) + paddingTop;
    const left = textWidth + paddingLeft;
    syncCaretStyle.value = { top: `${top}px`, left: `${left}px`, height: '16px', display: 'block' };
    emit('cursor-info-update', { px: Math.round(textWidth) });
};

const handleCursorMove = (e: Event, source: 'trace' | 'text') => {
    const target = e.target as HTMLTextAreaElement;
    activeEditor.value = source;
    emit('active-editor', source);
    if (source === 'trace') emit('click-text', e as MouseEvent);
    updateSyncCaretAndInfo(target);
};
// 1px Nudge Logic
const checkBbsConstraint = (z: number, h: number, isLineStart: boolean): boolean => {
    if (isLineStart) {
        // 行頭: 半角スペースで開始してはいけない
        // つまり、全角スペースが0個なら、半角スペースも0個でなければならない（半角のみはNG）
        if (z === 0 && h > 0) return false; 
        // 交互配置 (Z H Z H...) するために、Hの数はZ以下でなければならない
        return h <= z; 
    } else {
        // 行頭以外: 交互配置 (H Z H Z H...) するために、Hの数は Z+1 以下でなければならない
        return h <= z + 1;
    }
};

const buildBbsSafeString = (z: number, h: number, isLineStart: boolean): string => {
    let res = '';
    let zenCount = z;
    let hanCount = h;
    
    if (isLineStart) {
        // 行頭: 必ず全角から始める (Z H Z H...)
        while (zenCount > 0 || hanCount > 0) {
            if (zenCount > 0) { res += '　'; zenCount--; }
            if (hanCount > 0) { res += ' '; hanCount--; }
        }
    } else {
        // 行頭以外: 半角から始めてスペース効率を最大化する (H Z H Z...)
        while (zenCount > 0 || hanCount > 0) {
            if (hanCount > 0) { res += ' '; hanCount--; }
            if (zenCount > 0) { res += '　'; zenCount--; }
        }
    }
    return res;
};

const nudgeCursor = (direction: -1 | 1, useThinSpace: boolean, isBbsMode: boolean) => {
  // ★修正: BBSモード時は Thin Space を強制的に無効化
  const enableThin = useThinSpace && !isBbsMode;

  let target = document.activeElement as HTMLTextAreaElement;
  if (target !== traceTextareaRef.value && target !== textTextareaRef.value) {
      target = activeEditor.value === 'text' ? textTextareaRef.value! : traceTextareaRef.value!;
  }
  if (!target) return;
  
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const content = props.aaOutput;
  if (start !== end) return;
  
  let i = start - 1;
  while (i >= 0) {
    const c = content[i];
    if (c !== ' ' && c !== '　' && c !== '\u2009') break;
    i--;
  }
  const spaceStart = i + 1;
  const isLineStart = (spaceStart === 0 || content[spaceStart - 1] === '\n');
  const currentSpaces = content.substring(spaceStart, start);
  
  if (currentSpaces.length === 0 && direction === -1) return;
  
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `16px ${props.fontStack}`;
  const wZen = ctx.measureText('　').width;
  const wHan = ctx.measureText(' ').width;
  const wThin = ctx.measureText('\u2009').width;
  
  let currentWidth = 0;
  for (const char of currentSpaces) {
    if (char === '　') currentWidth += wZen;
    else if (char === ' ') currentWidth += wHan;
    else if (char === '\u2009') currentWidth += wThin;
  }
  
  let found = false;
  let combination = { zen: 0, han: 0, thin: 0 };
  const EPSILON = 0.1;
  
  for (let offset = 1; offset <= 30; offset++) {
    const targetW = currentWidth + (direction * offset);
    if (targetW < 0) continue;
    
    const maxZ = Math.floor((targetW + EPSILON) / wZen);
    for (let z = maxZ; z >= 0; z--) {
        const remZ = targetW - (z * wZen);
        
        // ★修正: enableThin フラグを使用
        if (enableThin) {
            const h = Math.floor((remZ + EPSILON) / wHan);
            const remH = remZ - (h * wHan);
            const t = Math.round(remH / wThin);
            
            const calcW = (z * wZen) + (h * wHan) + (t * wThin);
            if (Math.abs(calcW - targetW) < EPSILON) {
                combination = { zen: z, han: h, thin: t };
                found = true;
                break;
            }
        } else {
            const h = Math.round(remZ / wHan);
            const calcW = (z * wZen) + (h * wHan);
            
            if (Math.abs(calcW - targetW) < EPSILON) {
                if (isBbsMode) {
                    if (!checkBbsConstraint(z, h, isLineStart)) continue;
                }
                combination = { zen: z, han: h, thin: 0 };
                found = true;
                break;
            }
        }
    }
    if (found) break;
  }
  
  if (!found) return;
  
  let newStr = '';
  // ★修正: BBSモードなら必ず安全な構築ロジックを使用
  if (isBbsMode) {
      newStr = buildBbsSafeString(combination.zen, combination.han, isLineStart);
  } else {
      newStr += '　'.repeat(combination.zen);
      newStr += ' '.repeat(combination.han);
      newStr += '\u2009'.repeat(combination.thin);
  }
  
  const newContent = content.substring(0, spaceStart) + newStr + content.substring(start);
  emit('update:aaOutput', newContent);
  
  nextTick(() => {
    target.focus();
    const newCaretPos = spaceStart + newStr.length;
    target.selectionStart = target.selectionEnd = newCaretPos;
    emit('input-text', { target } as any);
    updateSyncCaretAndInfo(target);
  });
};

// Box Selection
const boxStart = ref<{ row: number, x: number } | null>(null);
const boxEnd = ref<{ row: number, x: number } | null>(null);
const isDragBoxMode = ref(false);
const getPosInfoFromXY = (clientX: number, clientY: number) => {
    const textarea = traceTextareaRef.value;
    if (!textarea) return { row: 0, x: 0 };
    const rect = textarea.getBoundingClientRect();
    const style = window.getComputedStyle(textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 10;
    const paddingTop = parseFloat(style.paddingTop) || 10;
    const lineHeight = 16; 
    const clickX = clientX - rect.left + textarea.scrollLeft;
    const clickY = clientY - rect.top + textarea.scrollTop;
    let row = Math.floor((clickY - paddingTop) / lineHeight);
    if (row < 0) row = 0;
    const relativeX = clickX - paddingLeft;
    return { row, x: relativeX };
};
const getColFromVisualX = (ctx: CanvasRenderingContext2D, lineText: string, targetX: number): number => {
    if (targetX <= 0) return 0;
    let currentW = 0;
    for (let i = 0; i < lineText.length; i++) {
        const charW = ctx.measureText(lineText[i]!).width;
        if (currentW + charW / 2 > targetX) return i;
        currentW += charW;
    }
    if (targetX > currentW) {
        const spaceW = 8; 
        const extraChars = Math.round((targetX - currentW) / spaceW);
        return lineText.length + extraChars;
    }
    return lineText.length;
};
const normalizedBox = computed(() => {
    if (!boxStart.value || !boxEnd.value) return null;
    return { startRow: Math.min(boxStart.value.row, boxEnd.value.row), endRow: Math.max(boxStart.value.row, boxEnd.value.row), minX: Math.min(boxStart.value.x, boxEnd.value.x), maxX: Math.max(boxStart.value.x, boxEnd.value.x) };
});
const boxSelectionRects = computed(() => {
    if (!normalizedBox.value || !traceTextareaRef.value) return [];
    const { startRow, endRow, minX, maxX } = normalizedBox.value;
    const rects = [];
    const lines = props.aaOutput.split('\n');
    const style = window.getComputedStyle(traceTextareaRef.value);
    const paddingLeft = parseFloat(style.paddingLeft) || 10;
    const paddingTop = parseFloat(style.paddingTop) || 10;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${props.fontStack}`;
    for (let r = startRow; r <= endRow; r++) {
        const line = lines[r] || '';
        const colStart = getColFromVisualX(ctx, line, minX);
        const colEnd = getColFromVisualX(ctx, line, maxX);
        const maxCol = Math.max(colStart, colEnd);
        const lineContent = line + ' '.repeat(Math.max(0, maxCol - line.length));
        const subStrPre = lineContent.substring(0, colStart);
        const leftPx = ctx.measureText(subStrPre).width + paddingLeft;
        const selectedText = lineContent.substring(colStart, colEnd);
        const widthPx = ctx.measureText(selectedText).width || 5;
        rects.push({ top: (r * 16 + paddingTop) + 'px', left: leftPx + 'px', width: widthPx + 'px', height: '16px' });
    }
    return rects;
});
const hasBoxSelection = computed(() => boxSelectionRects.value.length > 0);

const onMouseDownTextarea = (e: MouseEvent, source: 'trace' | 'text') => {
    activeEditor.value = source;
    updateSyncCaretAndInfo(e.target as HTMLTextAreaElement);
    
    // ★ Flow Brush開始
    if (props.paintMode === 'flow' && source === 'trace') {
        e.preventDefault();
        (window as any).isFlowPainting = true;
        
        // ダーティレクタングル初期化
        const rect = traceTextareaRef.value!.getBoundingClientRect();
        const y = e.clientY - rect.top + traceTextareaRef.value!.scrollTop;
        dirtyRect.value = { minY: y, maxY: y };
        
        // 描画開始 (App.vueのonMouseDownCanvasへ委譲)
        emit('mousedown-canvas', e); 
        return;
    }

    if (e.altKey && source === 'trace') { e.preventDefault(); boxStart.value = getPosInfoFromXY(e.clientX, e.clientY); boxEnd.value = boxStart.value; isDragBoxMode.value = true; } 
    else { if (boxStart.value) { boxStart.value = null; boxEnd.value = null; } emit('mousedown-textarea', e, source); }
};

// 既存の onMouseMoveTextarea を修正 (共通ロジックを使用)
const onMouseMoveTextarea = (e: MouseEvent, source: 'trace' | 'text') => {
    // ★ Flow Brush描画中
    if ((window as any).isFlowPainting && props.paintMode === 'flow') {
        updateDirtyRect(e.clientY); // ★修正
        return;
    }

    if (isDragBoxMode.value && source === 'trace') {
        boxEnd.value = getPosInfoFromXY(e.clientX, e.clientY);
    } else {
        emit('mousemove-textarea', e, source);
    }
};

// ★追加: キャンバス用のマウス移動ハンドラ
const onMouseMoveCanvas = (e: MouseEvent) => {
    // Flow Brushモード中のみ処理
    if ((window as any).isFlowPainting && props.paintMode === 'flow') {
        updateDirtyRect(e.clientY);
    }
};

// ★追加: キャンバス用マウスダウンハンドラ
const onMouseDownCanvasLocal = (e: MouseEvent) => {
    // Flowブラシモードなら、フラグを立てて更新範囲を初期化する
    if (props.paintMode === 'flow') {
        (window as any).isFlowPainting = true;
        
        if (traceTextareaRef.value) {
            const rect = traceTextareaRef.value.getBoundingClientRect();
            const y = e.clientY - rect.top + traceTextareaRef.value.scrollTop;
            dirtyRect.value = { minY: y, maxY: y };
        }
    }
    
    // 本来の描画処理（App.vue）へイベントを流す
    emit('mousedown-canvas', e);
};

const onMouseUpTextarea = () => { 
    // ★ Flow Brush終了
    console.log("test1-1", (window as any).isFlowPainting)
    if ((window as any).isFlowPainting) {
        (window as any).isFlowPainting = false;
        console.log("test1-2")
        if (dirtyRect.value) {
            emit('flow-paint-end', { minY: dirtyRect.value.minY, maxY: dirtyRect.value.maxY });
            dirtyRect.value = null;
        }
    }
    
    isDragBoxMode.value = false; 
    emit('mouseup-textarea'); 
};

const performBoxPaste = async () => { try { const text = await navigator.clipboard.readText(); if (text) pasteTextAsBox(text); emit('close-context-menu'); } catch (e) { alert('Clipboard access denied.'); } };
const getBoxSelectionText = () => {
    if (!normalizedBox.value) return '';
    const { startRow, endRow, minX, maxX } = normalizedBox.value;
    const lines = props.aaOutput.split('\n');
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${props.fontStack}`;
    let result = '';
    for (let r = startRow; r <= endRow; r++) {
        const line = lines[r] || '';
        const colStart = getColFromVisualX(ctx, line, minX);
        const colEnd = getColFromVisualX(ctx, line, maxX);
        const lineContent = line + '　'.repeat(Math.max(0, colEnd - line.length)); 
        result += lineContent.substring(colStart, colEnd) + (r < endRow ? '\n' : '');
    }
    return result;
};
// pasteTextAsBox 関数全体を置き換え
const pasteTextAsBox = (text: string) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `16px ${props.fontStack}`;
    
    // スペースの幅を計測
    const wZen = ctx.measureText('　').width;
    const wHan = ctx.measureText(' ').width;

    let startRow = 0; 
    let targetX = 0;

    // 1. 貼り付け開始位置 (行番号とX座標) を決定
    if (boxStart.value) { 
        startRow = Math.min(boxStart.value.row, boxEnd.value?.row || boxStart.value.row); 
        targetX = Math.min(boxStart.value.x, boxEnd.value?.x || boxStart.value.x); 
    } else if (traceTextareaRef.value) { 
        const caret = traceTextareaRef.value.selectionStart; 
        const textBefore = props.aaOutput.substring(0, caret); 
        const linesBefore = textBefore.split('\n'); 
        startRow = linesBefore.length - 1; 
        const lineText = linesBefore[linesBefore.length - 1]; 
        targetX = ctx.measureText(lineText!).width; 
    }

    const pasteLines = text.split('\n'); 
    const currentLines = props.aaOutput.split('\n');

    // 2. 行数が足りない場合は空行を追加
    while (currentLines.length < startRow + pasteLines.length) currentLines.push('');

    // 3. 各行への貼り付け処理
    for (let i = 0; i < pasteLines.length; i++) { 
        const r = startRow + i; 
        const line = currentLines[r] || ''; 
        const ins = pasteLines[i]; 
        
        // ★修正: 行の現在の幅（ピクセル）を計測
        const currentLineWidth = ctx.measureText(line).width;
        
        let pre = '';
        let post = '';

        if (currentLineWidth < targetX) {
            // A. 行がターゲット位置より短い場合 -> 隙間をスペースで埋める
            const diff = targetX - currentLineWidth;
            let padding = '';
            let remaining = diff;
            
            // 全角スペースで埋められるだけ埋める
            const zenCount = Math.floor(remaining / wZen);
            padding += '　'.repeat(zenCount);
            remaining -= zenCount * wZen;
            
            // 残りを半角スペースで埋める（四捨五入で近い個数に）
            const hanCount = Math.round(remaining / wHan);
            padding += ' '.repeat(hanCount);
            
            pre = line + padding;
            // postは無し（行末に追加するため）
        } else {
            // B. 行がターゲット位置まである場合 -> その位置で分割
            const col = getColFromVisualX(ctx, line, targetX);
            pre = line.substring(0, col);
            
            // 矩形貼り付けなので、貼り付ける文字数分だけ元の文字を上書き(消去)する
            // (元の挙動を維持: ins.length 分だけスキップ)
            const postIndex = col + ins!.length;
            if (postIndex < line.length) {
                post = line.substring(postIndex);
            }
        }
        
        currentLines[r] = pre + ins + post; 
    }

    const newVal = currentLines.join('\n'); 
    emit('update:aaOutput', newVal);
    
    nextTick(() => { 
        if (traceTextareaRef.value) { 
            traceTextareaRef.value.focus(); 
            emit('input-text', { target: traceTextareaRef.value } as any); 
            emit('paste-text', { clipboardData: null } as any); 
        } 
    });
};
const insertAtCursor = (text: string, targetEditor: 'trace' | 'text' | null) => {
  const target = targetEditor === 'text' ? textTextareaRef.value : traceTextareaRef.value;
  if (!target) return;

  const wrapper = target.closest('.aa-canvas-wrapper');
  const savedScrollTop = wrapper ? wrapper.scrollTop : 0;
  const savedScrollLeft = wrapper ? wrapper.scrollLeft : 0;

  const start = target.selectionStart;
  const end = target.selectionEnd;
  const currentVal = props.aaOutput;
  
  let deleteCount = 0;
  if (start === end && start < currentVal.length && currentVal[start] !== '\n') deleteCount = 1;
  
  const newVal = currentVal.substring(0, start) + text + currentVal.substring(end + deleteCount);
  
  emit('update:aaOutput', newVal);
  
  nextTick(() => { 
      target.focus(); 
      target.selectionStart = target.selectionEnd = start + text.length; 
      emit('input-text', { target } as any); 
      if (wrapper) {
          wrapper.scrollTop = savedScrollTop;
          wrapper.scrollLeft = savedScrollLeft;
      }
  });
};
defineExpose({ canvasRef, maskCanvasRef, paintCanvasRef, paintMaskRef, editorStackRef, insertAtCursor, traceTextareaRef, textTextareaRef, getBoxSelectionText, pasteTextAsBox, hasBoxSelection, nudgeCursor });
const isResizingPane = ref(false);
const startResizePane = () => { isResizingPane.value = true; window.addEventListener('mousemove', onResizePane); window.addEventListener('mouseup', stopResizePane); };
const onResizePane = (e: MouseEvent) => { if (!editorStackRef.value) return; const rect = editorStackRef.value.getBoundingClientRect(); let ratio = 0.5; if (props.splitDirection === 'horizontal') ratio = (e.clientY - rect.top) / rect.height; else ratio = (e.clientX - rect.left) / rect.width; emit('update:tracePaneRatio', Math.min(0.9, Math.max(0.1, ratio))); };
const stopResizePane = () => { isResizingPane.value = false; window.removeEventListener('mousemove', onResizePane); window.removeEventListener('mouseup', stopResizePane); };
onUnmounted(() => stopResizePane());
</script>

<template>
  <main class="editor-stack" ref="editorStackRef" :style="{ flexDirection: splitDirection === 'horizontal' ? 'column' : 'row' }">
    <div class="editor-card trace-card" :style="{ flex: viewMode === 'single' ? '1' : `0 0 ${tracePaneRatio * 100}%`, order: isLayoutSwapped ? 3 : 1 }" @click="$emit('active-editor', 'trace')">
      <div class="card-header">
        <input :value="currentAaTitle" @input="$emit('update:currentAaTitle', ($event.target as HTMLInputElement).value)" class="aa-title-input" :placeholder="t('ws_title_ph')" /> <div class="card-actions"></div>
      </div>
      <div class="aa-canvas-wrapper" @scroll="$emit('scroll', $event)">
        <div class="canvas-scroll-area" :style="containerStyle">
          <div class="canvas-layers" :style="{ width: '100%', height: '100%', opacity: traceOpacity/100 }">
            <canvas v-show="showBackgroundImage" ref="canvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base"></canvas>
            <canvas v-show="showBackgroundImage" ref="maskCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" :style="{ opacity: showGridOverlay ? 0 : 0.6 }"></canvas>
          </div>
          <div class="canvas-layers" :style="{ width: '100%', height: '100%', zIndex: 10, pointerEvents: 'auto', cursor: paintMode==='move' ? 'move' : (paintMode==='bucket' ? 'cell' : 'crosshair') , opacity: traceOpacity/100}">
            <canvas ref="paintCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base" style="pointer-events:none;"></canvas>
            <canvas ref="paintMaskRef" 
                :width="canvasDims.width" 
                :height="canvasDims.height" 
                class="layer-mask" 
                @mousedown="onMouseDownCanvasLocal"  @wheel="$emit('wheel-canvas', $event)"
                @mousemove="onMouseMoveCanvas"
                @mouseup="onMouseUpTextarea">
            </canvas>
          </div>
          
          <div class="box-overlay-container" v-show="boxSelectionRects.length > 0"><div v-for="(rect, i) in boxSelectionRects" :key="i" class="box-selection-line" :style="rect"></div></div>
          <div class="ghost-layer" v-show="isGhostVisible" :style="{ width: '100%', height: '100%' }"><span class="ghost-text" :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px' }">{{ ghostText }}</span></div>
          <div class="sync-caret" v-show="activeEditor === 'text'" :style="syncCaretStyle"></div>
          
          <textarea ref="traceTextareaRef" class="aa-textarea" :class="{ 'box-mode-active': isDragBoxMode || boxSelectionRects.length > 0 }" :value="aaOutput"
                    @input="handleInput" @click="handleCursorMove($event, 'trace')" @keydown="emit('keydown-text', $event); handleCursorMove($event, 'trace')" @keypress="emit('keypress-text', $event)" @keyup="handleCursorMove($event, 'trace')" @focus="handleCursorMove($event, 'trace'); emit('focus-text', 'trace')" @mousedown="onMouseDownTextarea($event, 'trace')" @mousemove="onMouseMoveTextarea($event, 'trace')" @mouseup="onMouseUpTextarea" @paste="$emit('paste-text', $event)" @contextmenu.prevent="$emit('request-context-menu', $event, $event.target as any)" 
                    :placeholder="t('ws_ph_trace')" 
                    :style="{ color: aaTextColor, pointerEvents: isPaintingActive ? 'none' : 'auto', opacity: 1, zIndex: 20 }"></textarea> </div>
      </div>
    </div>
    
    <div v-show="viewMode === 'split'" class="resize-handle" @mousedown.prevent="startResizePane" :class="{ active: isResizingPane, 'handle-v': splitDirection === 'vertical' }" :style="{ order: 2 }"><div class="handle-bar"></div></div>
    
    <div v-show="viewMode === 'split'" class="editor-card text-card" :style="{ flex: 1, order: isLayoutSwapped ? 1 : 3 }" @click="$emit('active-editor', 'text')">
      <div class="aa-canvas-wrapper" @scroll="$emit('scroll', $event)">
        <div class="canvas-scroll-area" :style="containerStyle">
            <div class="aa-highlight-layer" v-html="highlightedHTML"></div>
            <div class="sync-caret" v-show="activeEditor === 'trace'" :style="syncCaretStyle"></div>
            
            <textarea ref="textTextareaRef" class="aa-textarea" :value="aaOutput"
                      @input="handleInput" @click="handleCursorMove($event, 'text')" @keyup="handleCursorMove($event, 'text')" @focus="handleCursorMove($event, 'text'); emit('focus-text', 'text')" @contextmenu.prevent="$emit('request-context-menu', $event, $event.target as any)"
                      @keydown="emit('keydown-text', $event); handleCursorMove($event, 'text')"
                      @keypress="emit('keypress-text', $event)"
                      style="color: #222222; background: transparent; z-index: 20;"></textarea>
        </div>
      </div>
    </div>
    
    <div v-if="contextMenuVisible" class="context-menu" :style="{ top: contextMenuPos.y + 'px', left: contextMenuPos.x + 'px' }" @click.stop>
        <div class="menu-header">
            <span>{{ t('ws_actions') }}</span> <button class="menu-close-btn" @click="$emit('close-context-menu')">×</button>
        </div>
        <div v-if="contextCandidates.length > 0" class="candidate-grid">
            <button v-for="(cand, i) in contextCandidates" :key="i" class="cand-btn" :title="`${t('ws_score')}: ${cand.score.toFixed(2)}`" @click="$emit('select-candidate', cand.char)"> {{ cand.char === ' ' ? 'SPC' : cand.char }}
            </button>
        </div>
        <div v-else class="menu-no-cands">{{ t('ws_no_cands') }}</div> <div class="menu-actions">
            <button class="menu-action-btn" @click="performBoxPaste">
                <span class="icon">📋</span> {{ t('ws_rect_paste') }} </button>
        </div>
        <div class="menu-backdrop" @click="$emit('close-context-menu')"></div>
    </div>
  </main>
</template>

<style scoped>
/* (既存のStyleはそのまま維持してください。変更点はありません) */
.aa-textarea, .aa-highlight-layer { font-family: var(--font-aa); font-size: 16px; line-height: 16px; letter-spacing: 0; padding: 10px; border: 1px solid transparent; box-sizing: border-box; width: 100%; min-height: 100%; white-space: pre; overflow: hidden; margin: 0; outline: none; resize: none; display: block; }
.aa-highlight-layer { position: absolute; top: 0; left: 0; color: transparent; pointer-events: none; z-index: 5; background: transparent; overflow: visible; }
:deep(.warn-leading-space) { background-color: rgba(255, 0, 0, 0.2); }
:deep(.warn-consecutive-space) { background-color: rgba(255, 165, 0, 0.3); }
:deep(.bbs-anchor) { color: #0000FF !important; text-decoration: underline; background-color: rgba(0,0,255,0.05); }
.aa-textarea { position: relative; background: transparent; }
.editor-stack { display:flex; height:100%; width:100%; overflow:hidden; }
.editor-card { display:flex; flex-direction:column; background:#fff; overflow:hidden; position:relative; min-width:0; min-height:0; }
.aa-canvas-wrapper { flex:1; position:relative; overflow:auto; background:#fff; }
.canvas-scroll-area { position:relative; min-width:100%; min-height:100%; }
.canvas-layers { position:absolute; top:0; left:0; pointer-events:none; }
.layer-base, .layer-mask { position:absolute; top:0; left:0; }
.ghost-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 25; }
.ghost-text { position: absolute; font-family: var(--font-aa); font-size: 16px; line-height: 16px; color: rgba(255, 0, 0, 0.5); white-space: pre; background: rgba(255, 255, 0, 0.1); }
.context-menu { position: fixed; background: white; border: 1px solid #ccc; box-shadow: 0 4px 15px rgba(0,0,0,0.2); z-index: 10000; border-radius: 6px; overflow: hidden; min-width: 220px; animation: fadeIn 0.1s ease-out; }
.menu-header { background: #f5f5f5; padding: 6px 10px; font-size: 0.75rem; font-weight: bold; color: #666; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
.menu-close-btn { font-size: 1rem; color: #999; cursor: pointer; border: none; background: transparent; }
.candidate-grid { display: grid; grid-template-columns: repeat(5, 1fr); padding: 5px; gap: 2px; max-height: 200px; overflow-y: auto; border-bottom: 1px solid #eee; }
.cand-btn { width: 32px; height: 32px; border: 1px solid transparent; background: white; font-family: var(--font-aa); cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.cand-btn:hover { background: #e6b086; color: white; border-color: #e6b086; }
.menu-no-cands { padding: 10px; color: #999; font-size: 0.8rem; text-align: center; font-style: italic; border-bottom: 1px solid #eee; }
.menu-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: -1; cursor: default; }
.menu-actions { padding: 5px; background: #fff; }
.menu-action-btn { width: 100%; text-align: left; background: transparent; border: none; padding: 8px 10px; cursor: pointer; font-size: 0.85rem; color: #444; border-radius: 4px; display: flex; align-items: center; gap: 8px; }
.menu-action-btn:hover { background: #f0f0f0; color: #222; }
.menu-action-btn .icon { font-size: 1rem; }
.aa-title-input { border:none; background:transparent; font-weight:bold; font-size:1rem; width:200px; color:#333; }
.hint { color:#888; font-size:0.8rem; margin-right:10px; }
.card-header { padding:8px 10px; background:#f9f9f9; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center; flex: 0 0 32px; }
.resize-handle { flex:0 0 8px; background:#f5f5f5; border:1px solid #ddd; display:flex; align-items:center; justify-content:center; cursor:row-resize; z-index:50; }
/* 左右分割（縦棒）モードのときのスタイル上書き */
.resize-handle.handle-v {
  cursor: col-resize; /* カーソルを「左右矢印」に変更 */
  border-top: none;   /* 上下の線は不要なので消す（お好みで） */
  border-bottom: none;
  border-left: 1px solid #ddd;  /* 左右に線をつける */
  border-right: 1px solid #ddd;
}

/* 左右分割のときの「ハンドルバー（中央の棒）」を回転させる */
.resize-handle.handle-v .handle-bar {
  width: 3px;   /* 横幅を細く */
  height: 30px; /* 縦幅を長く */
}

.handle-bar { width:30px; height:3px; background:#ccc; border-radius:2px; }
.box-overlay-container { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:30; }
.box-selection-line { position:absolute; background-color:rgba(0,100,255,0.2); border-left: 2px solid rgba(0,100,255,0.5); border-right: 2px solid rgba(0,100,255,0.5); }
.sync-caret { position: absolute; width: 2px; background-color: rgba(0, 0, 0, 0.6); pointer-events: none; z-index: 100; animation: blink-caret 1s step-end infinite; }
@keyframes blink-caret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
</style>