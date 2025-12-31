<script setup lang="ts">
import { ref, onUnmounted, nextTick } from 'vue';

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
  boxSelectionRects: any[];
  isGhostVisible: boolean;
  ghostPos: { x: number, y: number };
  ghostText: string;
  aaTextColor: string;
  highlightedHTML: string;
  // ★重要: ペイント中かどうか
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
  (e: 'click-text', ev: MouseEvent): void;
  (e: 'keydown-text', ev: KeyboardEvent): void;
  (e: 'keypress-text', ev: KeyboardEvent): void;
  (e: 'keyup-text', ev: KeyboardEvent): void;
  (e: 'focus-text', source: 'trace'|'text'): void;
  (e: 'mousedown-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mousemove-textarea', ev: MouseEvent, source: 'trace'|'text'): void;
  (e: 'mouseup-textarea'): void;
  (e: 'paste-text', ev: ClipboardEvent): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const maskCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintCanvasRef = ref<HTMLCanvasElement | null>(null);
const paintMaskRef = ref<HTMLCanvasElement | null>(null);
const editorStackRef = ref<HTMLElement | null>(null);
const traceTextareaRef = ref<HTMLTextAreaElement | null>(null);
const textTextareaRef = ref<HTMLTextAreaElement | null>(null);

const insertAtCursor = (text: string, targetEditor: 'trace' | 'text' | null) => {
  const target = targetEditor === 'text' ? textTextareaRef.value : traceTextareaRef.value;
  if (!target) return;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const currentVal = props.aaOutput;
  const newVal = currentVal.substring(0, start) + text + currentVal.substring(end);
  emit('update:aaOutput', newVal);
  nextTick(() => {
    target.focus();
    target.selectionStart = target.selectionEnd = start + text.length;
    emit('input-text', { target } as any);
  });
};

defineExpose({
  canvasRef, maskCanvasRef, paintCanvasRef, paintMaskRef, editorStackRef, insertAtCursor
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
  if (props.splitDirection === 'horizontal') ratio = (e.clientY - rect.top) / rect.height;
  else ratio = (e.clientX - rect.left) / rect.width;
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
                    @click="$emit('click-text', $event)"
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
                        /* ★修正: ペイント中はクリック無効だが、表示はくっきり(opacity: 1)させる */
                        pointerEvents: isPaintingActive ? 'none' : 'auto', 
                        opacity: 1,
                        zIndex: 20 /* ★修正: ペイントレイヤー(z=10)より上にする */
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
                  @click="$emit('click-text', $event)"
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
/* 共通設定 */
.aa-textarea,
.aa-highlight-layer {
    font-family: var(--font-aa);
    font-size: 16px;
    line-height: 16px; /* AIに合わせて固定 */
    letter-spacing: 0;
    padding: 10px;
    border: 1px solid transparent;
    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
    white-space: pre;
    overflow: auto;
    margin: 0;
}

/* ハイライトレイヤー */
.aa-highlight-layer {
    position: absolute;
    top: 0; left: 0;
    color: transparent;
    pointer-events: none;
    z-index: 5;
    background: transparent;
}

/* テキストエリア */
.aa-textarea {
    position: relative;
    z-index: 20; /* ★修正: 最前面へ */
    background: transparent;
    color: var(--aa-text-color);
    resize: none;
    outline: none;
    display: block;
}

/* その他のスタイル */
.aa-title-input { border:none; background:transparent; font-weight:bold; font-size:1rem; width:200px; color:#333; }
.aa-title-input:focus { outline:none; border-bottom:1px solid #ccc; }
.hint { color:#888; font-size:0.8rem; margin-right:10px; }
.card-header { padding:8px 10px; background:#f9f9f9; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center; flex: 0 0 32px; }
.resize-handle { flex:0 0 8px; background:#f5f5f5; border:1px solid #ddd; display:flex; align-items:center; justify-content:center; cursor:row-resize; z-index:50; }
.resize-handle.handle-v { cursor:col-resize; flex-direction:column; }
.handle-bar { width:30px; height:3px; background:#ccc; border-radius:2px; }
.resize-handle.handle-v .handle-bar { width:3px; height:30px; }
.editor-stack { display:flex; height:100%; width:100%; overflow:hidden; }
.editor-card { display:flex; flex-direction:column; background:#fff; overflow:hidden; position:relative; min-width:0; min-height:0; }
.aa-canvas-wrapper { flex:1; position:relative; overflow:auto; background:#fff; }
.canvas-scroll-area { position:relative; min-width:100%; min-height:100%; }
.canvas-layers { position:absolute; top:0; left:0; pointer-events:none; }
.layer-base, .layer-mask { position:absolute; top:0; left:0; }
.box-overlay-container { position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:30; }
.box-selection-line { position:absolute; background-color:rgba(0,100,255,0.2); }
.ghost-layer { position:absolute; top:0; left:0; pointer-events:none; z-index:25; }
.ghost-text { position:absolute; font-family:var(--font-aa); font-size:16px; line-height:16px; color:rgba(0,0,0,0.3); white-space:pre; background:rgba(255,255,0,0.2); }
</style>