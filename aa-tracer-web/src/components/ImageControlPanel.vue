<script setup lang="ts">
  
const props = defineProps<{
  sourceImage: HTMLImageElement | null;
  isProcessing: boolean;
  isExtracting: boolean; 
  rawLineArtCanvas: HTMLCanvasElement | null;
  lineArtSettings: { threshold: number, thickness: number };
  traceOpacity: number;
  imgTransform: { scale: number, rotation: number, x: number, y: number };
  paintMode: string;
  paintColor: string;
  targetCharBlue: string;
  targetCharRed: string;
  brushSize: number;
  thinningLevel: number;
  noiseGate: number;
  generationMode: string;
}>();

const emit = defineEmits<{
  (e: 'load-image', file: File): void;
  (e: 'extract-lineart'): void;
  (e: 'reset-lineart'): void;
  (e: 'process-image'): void;
  (e: 'update:lineArtSettings', val: any): void;
  (e: 'update:traceOpacity', val: number): void;
  (e: 'update:imgTransform', val: any): void;
  (e: 'update:paintMode', val: string): void;
  (e: 'update:paintColor', val: string): void;
  (e: 'update:targetCharBlue', val: string): void;
  (e: 'update:targetCharRed', val: string): void;
  (e: 'update:brushSize', val: number): void;
  (e: 'update:thinningLevel', val: number): void;
  (e: 'update:noiseGate', val: number): void;
  (e: 'update:generationMode', val: string): void;
}>();

const onLoadFile = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) emit('load-image', file);
};
</script>

<template>
  <div class="image-control-panel">
    
    <div class="panel-section">
      <h3>📁 Source Image</h3>
      <div class="control-row">
        <label class="studio-btn primary w-100">
          Load Image
          <input type="file" @change="onLoadFile" accept="image/*" hidden>
        </label>
      </div>
      
      <div class="control-row" v-if="sourceImage">
        <button class="studio-btn outline w-100" @click="$emit('extract-lineart')" :disabled="isExtracting">
           ⚡ Extract Line Art (AI)
        </button>
      </div>
    </div>

    <div class="panel-section" v-if="rawLineArtCanvas">
        <h3>Adjust Lines</h3>
        <div class="control-group">
            <label>Threshold</label>
            <input type="range" min="0" max="255" :value="lineArtSettings.threshold" @input="$emit('update:lineArtSettings', { ...lineArtSettings, threshold: +($event.target as HTMLInputElement).value })">
        </div>
        <div class="control-group">
            <label>Thickness</label>
            <input type="range" min="-3" max="5" :value="lineArtSettings.thickness" @input="$emit('update:lineArtSettings', { ...lineArtSettings, thickness: +($event.target as HTMLInputElement).value })">
        </div>
        <button class="studio-btn small w-100" @click="$emit('reset-lineart')">Reset Adjustments</button>
    </div>

    <div class="panel-section">
        <h3>🖌 Paint & Transform</h3>
        <div class="paint-tools">
            <button :class="{ active: paintMode === 'move' }" @click="$emit('update:paintMode', 'move')" title="Move/Scale Image">✋</button>
            <button :class="{ active: paintMode === 'brush' }" @click="$emit('update:paintMode', 'brush')" title="Brush">🖊</button>
            <button :class="{ active: paintMode === 'eraser' }" @click="$emit('update:paintMode', 'eraser')" title="Eraser">消</button>
            <button :class="{ active: paintMode === 'bucket' }" @click="$emit('update:paintMode', 'bucket')" title="Fill">🪣</button>
            <button :class="{ active: paintMode === 'flow' }" @click="$emit('update:paintMode', 'flow')" title="Flow Brush (Direct AA)">✒️</button>
        </div>
        <div class="paint-colors" v-if="paintMode !== 'move'">
            <button class="color-btn blue" :class="{ active: paintColor === 'blue' }" @click="$emit('update:paintColor', 'blue')"></button>
            <button class="color-btn red" :class="{ active: paintColor === 'red' }" @click="$emit('update:paintColor', 'red')"></button>
            <input type="range" min="1" max="50" :value="brushSize" class="brush-size-slider" @input="$emit('update:brushSize', +($event.target as HTMLInputElement).value)">
        </div>
        <div v-if="paintMode === 'flow'" style="margin: 10px 0; font-size: 0.8rem; color: #666; background: #f9f9f9; padding: 8px; border-radius: 4px;">
            <b>Flow Mode:</b> Draw directly on the canvas to place characters based on stroke direction.
        </div>

        <hr class="sep">

        <div class="control-group">
          <label>Line Thinning: {{ thinningLevel }}</label>
          <input type="range" min="0" max="3" :value="thinningLevel" @input="$emit('update:thinningLevel', +($event.target as HTMLInputElement).value)">
          
          <label style="margin-top:10px;">Noise Gate: {{ noiseGate }}</label>
          <input type="range" min="0" max="2.0" step="0.1" :value="noiseGate" @input="$emit('update:noiseGate', +($event.target as HTMLInputElement).value)">
          
          <label class="check-row" style="margin-top:10px; font-size:0.8rem;">
            <input type="checkbox" :checked="generationMode === 'hybrid'" @change="$emit('update:generationMode', ($event.target as HTMLInputElement).checked ? 'hybrid' : 'accurate')">
            <span>Hybrid Mode (Faster)</span>
          </label>

          <button class="studio-btn outline w-100" 
                  style="display:flex; justify-content:center; align-items:center; gap:8px; margin-top:10px;"
                  @click="$emit('process-image')" :disabled="isProcessing">
            <span v-if="isProcessing" class="spinner small"></span>
            <span>✨ Update AA</span>
          </button>
        </div>
    </div>

    <div class="panel-section">
      <h3>Appearance</h3>
      <div class="control-group">
        <label>Trace Opacity: {{ traceOpacity }}%</label>
        <input type="range" min="0" max="100" :value="traceOpacity" @input="$emit('update:traceOpacity', +($event.target as HTMLInputElement).value)">
      </div>
      <div class="control-group">
        <label>Scale: {{ imgTransform.scale.toFixed(2) }}</label>
        <input type="range" min="0.1" max="5.0" step="0.1" :value="imgTransform.scale" @input="$emit('update:imgTransform', { ...imgTransform, scale: +($event.target as HTMLInputElement).value })">
      </div>
      <div class="control-group">
        <label>Rotation: {{ imgTransform.rotation }}°</label>
        <input type="range" min="-180" max="180" :value="imgTransform.rotation" @input="$emit('update:imgTransform', { ...imgTransform, rotation: +($event.target as HTMLInputElement).value })">
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-control-panel {
    padding: 10px;
    display: flex; flex-direction: column; gap: 15px;
    /* position: relative;  ←削除しても良い */
    min-height: 100%;
}

/* ★Spinner用スタイルはボタン内(spinner small)で使っているので残す */
.spinner {
    width: 30px; height: 30px;
    border: 3px solid #eee;
    border-top-color: #e6b086;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
.spinner.small { width: 16px; height: 16px; border-width: 2px; }

@keyframes spin { to { transform: rotate(360deg); } }

/* 既存スタイル維持 */
.panel-section { border-bottom: 1px solid #eee; padding-bottom: 15px; }
.panel-section:last-child { border-bottom: none; }
h3 { margin: 0 0 10px 0; font-size: 0.9rem; color: #444; }
.control-row { margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.control-group { margin-bottom: 12px; display: flex; flex-direction: column; }
.control-group label { font-size: 0.8rem; color: #666; margin-bottom: 4px; }
input[type="range"] { width: 100%; }
.studio-btn { padding: 6px 12px; border-radius: 4px; font-size: 0.85rem; cursor: pointer; border: 1px solid transparent; font-weight: 500; transition: all 0.2s; }
.studio-btn.primary { background: #e6b086; color: white; }
.studio-btn.primary:hover { background: #d49a6a; }
.studio-btn.outline { background: transparent; border-color: #ccc; color: #555; }
.studio-btn.outline:hover { border-color: #e6b086; color: #e6b086; }
.studio-btn.small { padding: 4px 8px; font-size: 0.75rem; }
.studio-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.w-100 { width: 100%; }
.paint-tools { display: flex; gap: 5px; margin-bottom: 8px; }
.paint-tools button { flex: 1; padding: 6px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
.paint-tools button.active { background: #e6b086; color: white; border-color: #e6b086; }
.paint-colors { display: flex; gap: 8px; align-items: center; }
.color-btn { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #ccc; cursor: pointer; }
.color-btn.blue { background: blue; }
.color-btn.red { background: red; }
.color-btn.active { box-shadow: 0 0 0 2px #e6b086; transform: scale(1.1); }
.brush-size-slider { flex: 1; }
.sep { border: 0; border-top: 1px dashed #eee; margin: 10px 0; }
.check-row { display: flex; align-items: center; gap: 6px; cursor: pointer; }
</style>