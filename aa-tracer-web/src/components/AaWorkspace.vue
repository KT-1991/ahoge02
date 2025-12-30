<script setup lang="ts">
import { ref, onUnmounted, nextTick } from 'vue';

const props = defineProps<{
  viewMode: 'single' | 'split';
  splitDirection: 'horizontal' | 'vertical';
  isLayoutSwapped: boolean;
  tracePaneRatio: number;
  aaOutput: string; // v-model
  currentAaTitle: string; // v-model
  sourceImage: HTMLImageElement | null;
  canvasDims: { width: number, height: number };
  traceOpacity: number;
  showBackgroundImage: boolean;
  showGridOverlay: boolean;
  paintMode: string;
  caretSyncPos: { x: number, y: number };
  isBoxSelecting: boolean;
  boxSelectionRects: any[];
  isGhostVisible: boolean;
  ghostPos: { x: number, y: number };
  ghostText: string;
  aaTextColor: string;
  highlightedHTML: string;
// ★追加: ペイント中（Imageタブ選択中）かどうかを受け取るフラグ
  isPaintingActive: boolean;
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
  (e: 'click-text'): void;
  (e: 'keydown-text', ev: KeyboardEvent): void;
  (e: 'keypress-text', ev: KeyboardEvent): void;
  (e: 'keyup-text', ev: KeyboardEvent): void;
  (e: 'focus-text', source: 'trace'|'text'): void;
  (e: 'mousedown-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mousemove-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mouseup-textarea'): void;
  (e: 'paste-text', ev: ClipboardEvent): void;
}>();

// Refs to expose to parent
const canvasRef = ref<HTMLCanvasElement | null>(null);
const maskCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);
const editorStackRef = ref<HTMLElement | null>(null);

// テキストエリアへの参照を追加
const traceTextareaRef = ref<HTMLTextAreaElement | null>(null);
const textTextareaRef = ref<HTMLTextAreaElement | null>(null);

// ★追加: カーソル位置への文字挿入とフォーカス復帰
const insertAtCursor = (text: string, targetEditor: 'trace' | 'text' | null) => {
  const target = targetEditor === 'text' ? textTextareaRef.value : traceTextareaRef.value;
  if (!target) return;

  const start = target.selectionStart;
  const end = target.selectionEnd;
  const currentVal = props.aaOutput;

  // 新しいテキストを作成
  const newVal = currentVal.substring(0, start) + text + currentVal.substring(end);
  
  // 親へ更新通知
  emit('update:aaOutput', newVal);
  
  // カーソル位置の更新とフォーカス (DOM更新後に行う)
  nextTick(() => {
    target.focus();
    target.selectionStart = target.selectionEnd = start + text.length;
    // 入力イベントを発火させて履歴記録などを促す
    emit('input-text', { target } as any);
  });
};

defineExpose({
  canvasRef,
  maskCanvasRef,
  paintCanvasRef,
  paintMaskRef,
  editorStackRef,
  insertAtCursor // ★ここ重要
});

// Resize Logic
const isResizingPane = ref(false);

const startResizePane = () => {
  isResizingPane.value = true;
  window.addEventListener('mousemove', onResizePane);
  window.addEventListener('mouseup', stopResizePane);
};

const onResizePane = (e: MouseEvent) => {
  if (!editorStackRef.value) return;
  const rect = editorStackRef.value.getBoundingClientRect();
  let ratio = 0.5;
  if (props.splitDirection === 'horizontal') {
    ratio = (e.clientY - rect.top) / rect.height;
  } else {
    ratio = (e.clientX - rect.left) / rect.width;
  }
  emit('update:tracePaneRatio', Math.min(0.9, Math.max(0.1, ratio)));
};

const stopResizePane = () => {
  isResizingPane.value = false;
  window.removeEventListener('mousemove', onResizePane);
  window.removeEventListener('mouseup', stopResizePane);
};



onUnmounted(() => stopResizePane());
</script>

<template>
  <main class="editor-stack" ref="editorStackRef" :style="{ flexDirection: splitDirection === 'horizontal' ? 'column' : 'row' }">
    
    <div class="editor-card trace-card" 
         :style="{ flex: viewMode === 'single' ? '1' : `0 0 ${tracePaneRatio * 100}%`, order: isLayoutSwapped ? 3 : 1 }"
         @click="$emit('active-editor', 'trace')">
      
      <div class="card-header">
        <input :value="currentAaTitle" @input="$emit('update:currentAaTitle', ($event.target as HTMLInputElement).value)" class="aa-title-input" placeholder="AA Title" />
        <div class="card-actions">
          <span v-if="!sourceImage" class="hint">Load Image from Sidebar →</span>
        </div>
      </div>

      <div class="aa-canvas-wrapper" @scroll="$emit('scroll', $event)">
        <div class="canvas-scroll-area" 
             :style="{ width: (canvasDims.width || '100%') + (canvasDims.width ? 'px' : ''), height: (canvasDims.height || '100%') + (canvasDims.height ? 'px' : '') }">
          
          <div class="canvas-layers" v-show="sourceImage" :style="{ width: '100%', height: '100%', opacity: traceOpacity/100 }">
            <canvas v-show="showBackgroundImage" ref="canvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base"></canvas>
            <canvas v-show="showBackgroundImage" ref="maskCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" :style="{ opacity: showGridOverlay ? 0 : 0.6 }"></canvas>
          </div>

          <div class="canvas-layers" v-show="sourceImage" 
               :style="{ width: '100%', height: '100%', zIndex: 10, pointerEvents: 'auto', cursor: paintMode==='move' ? 'move' : (paintMode==='bucket' ? 'cell' : 'crosshair') }">
            <canvas ref="paintCanvasRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-base" style="pointer-events:none;"></canvas>
            <canvas ref="paintMaskRef" :width="canvasDims.width" :height="canvasDims.height" class="layer-mask" 
                    @mousedown="$emit('mousedown-canvas', $event)" 
                    @wheel="$emit('wheel-canvas', $event)"></canvas>
          </div>

          <div class="box-overlay-container" v-show="isBoxSelecting">
            <div v-for="(rect, i) in boxSelectionRects" :key="i" class="box-selection-line" :style="rect"></div>
          </div>
          <div class="ghost-layer" v-show="isGhostVisible" :style="{ width: '100%', height: '100%' }">
            <span class="ghost-text" :style="{ left: ghostPos.x + 'px', top: ghostPos.y + 'px' }">{{ ghostText }}</span>
          </div>

          <textarea ref="traceTextareaRef"
                    class="aa-textarea" 
                    :class="{ 'box-mode-active': isBoxSelecting }"
                    :value="aaOutput"
                    @input="$emit('update:aaOutput', ($event.target as HTMLInputElement).value); $emit('input-text', $event)"
                    @click="$emit('click-text')" 
                    @keydown="$emit('keydown-text', $event)"
                    @keypress="$emit('keypress-text', $event)"
                    @keyup="$emit('keyup-text', $event)"
                    @focus="$emit('focus-text', 'trace')"
                    @mousedown="$emit('mousedown-textarea', $event, 'trace')"
                    @mousemove="$emit('mousemove-textarea', $event, 'trace')"
                    @mouseup="$emit('mouseup-textarea')"
                    @paste="$emit('paste-text', $event)"
                    placeholder="Type or Drag Image Here..."
                    :style="{ 
                        color: aaTextColor, 
                        /* ★修正: ペイント中(Imageタブ)なら操作無効、そうでなければ有効 */
                        pointerEvents: isPaintingActive ? 'none' : 'auto', 
                        opacity: isPaintingActive ? 0.3 : 1 
                    }">
          </textarea>
        </div>
      </div>
    </div>

    <div v-show="viewMode === 'split'" class="resize-handle" 
         @mousedown.prevent="startResizePane" 
         :class="{ active: isResizingPane, 'handle-v': splitDirection === 'vertical' }" :style="{ order: 2 }">
      <div class="handle-bar"></div>
    </div>

    <div v-show="viewMode === 'split'" class="editor-card text-card" 
         :style="{ flex: 1, order: isLayoutSwapped ? 1 : 3 }" 
         @click="$emit('active-editor', 'text')">
      <div class="aa-canvas-wrapper">
        <div class="aa-highlight-layer" v-html="highlightedHTML"></div>
        <div class="box-overlay-container" v-show="isBoxSelecting">
           <div v-for="(rect, i) in boxSelectionRects" :key="i" class="box-selection-line" :style="rect"></div>
        </div>
        <textarea ref="textTextareaRef"
                  class="aa-textarea" 
                  :class="{ 'box-mode-active': isBoxSelecting }"
                  :value="aaOutput"
                  @input="$emit('update:aaOutput', ($event.target as HTMLInputElement).value); $emit('input-text', $event)"
                  @click="$emit('click-text')"
                  @keyup="$emit('keyup-text', $event)"
                  @focus="$emit('focus-text', 'text')"
                  @mousedown="$emit('mousedown-textarea', $event, 'text')"
                  @mousemove="$emit('mousemove-textarea', $event, 'text')"
                  @mouseup="$emit('mouseup-textarea')"
                  @paste="$emit('paste-text', $event)"
                  style="color: #222222;">
        </textarea>
      </div>
    </div>
  </main>
</template>
<style lang="css" scoped>
/* 共通設定: フォント、サイズ、行間、余白を完全に一致させる */
.aa-textarea,
.aa-highlight-layer {
    /* フォント設定 */
    font-family: var(--font-aa);
    font-size: 16px;
    line-height: 16px; /* または 18px など固定値 */
    letter-spacing: 0;
    
    /* 配置と余白の統一 ★ここが重要 */
    padding: 10px;       /* 任意の値を設定し、両方揃える */
    border: 1px solid transparent; /* 枠線の太さも揃える */
    box-sizing: border-box; /* パディングを含めたサイズ計算にする */
    
    width: 100%;
    min-height: 100%;
    white-space: pre; /* 折り返しなしで統一 */
    overflow: auto;   /* スクロール挙動 */
    margin: 0;
}

/* ハイライトレイヤー固有 */
.aa-highlight-layer {
    position: absolute;
    top: 0;
    left: 0;
    color: transparent; /* 文字自体は透明 */
    pointer-events: none; /* クリックを透過 */
    z-index: 5;
    background: transparent;
    /* borderは見えなくて良いが、サイズ計算のためにtransparentで存在させる */
}

/* テキストエリア固有 */
.aa-textarea {
    position: relative;
    z-index: 10;
    background: transparent;
    color: var(--aa-text-color);
    resize: none;
    outline: none;
    display: block; /* 隙間防止 */
}

/* エラー箇所のスタイル */
.err-char {
    background-color: rgba(255, 0, 0, 0.2);
    border-bottom: 2px solid red;
}
.err-lead {
    background-color: rgba(255, 165, 0, 0.3);
    border-bottom: 2px solid orange;
}
.err-seq {
    background-color: rgba(255, 165, 0, 0.3);
    border-bottom: 2px dotted orange;
}
.anchor-highlight {
    color: rgba(0, 0, 255, 0.3) !important;
    border-bottom: 2px solid blue;
}


</style>