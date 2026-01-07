<script setup lang="ts">

import { useI18n } from '../composables/useI18n'; // ★追加

const { t } = useI18n(); // ★使用開始

const props = defineProps<{
  sourceImage: HTMLImageElement | null;
  isProcessing: boolean;
  isExtracting: boolean; 
  rawLineArtCanvas: HTMLCanvasElement | null;
  // LineArtSettingsはApp.vueと合わせるため、汎用的に定義しておきます
  lineArtSettings: { threshold: number, thickness?: number, blur?: number, denoise?: number };
  traceOpacity: number;
  imgTransform: { scale: number, rotation: number, x: number, y: number };
  paintMode: string;
  paintColor: string;
  // ★追加: ハッチング文字
  targetCharBlue: string;
  targetCharRed: string;
  brushSize: number;
  thinningLevel: number;
  noiseGate: number;
  generationMode: string;
}>();

// Vueのイベント規約(kebab-case)に合わせて定義します
const emit = defineEmits<{
  (e: 'load-image', file: File): void;
  (e: 'extract-lineart'): void;
  (e: 'reset-lineart'): void;
  (e: 'process-image'): void;
  (e: 'update:line-art-settings', val: any): void;
  (e: 'update:trace-opacity', val: number): void;
  (e: 'update:img-transform', val: any): void;
  (e: 'update:paint-mode', val: string): void;
  (e: 'update:paint-color', val: string): void;
  // ★追加: 文字更新
  (e: 'update:target-char-blue', val: string): void;
  (e: 'update:target-char-red', val: string): void;
  (e: 'update:brush-size', val: number): void;
  (e: 'update:thinning-level', val: number): void;
  (e: 'update:noise-gate', val: number): void;
  (e: 'update:generation-mode', val: string): void;
  (e: 'load-sample'): void; // ★追加
  (e: 'cancel-generation'): void; // ★追加: 中断イベント
}>();

const onLoadFile = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) emit('load-image', file);
};
</script>

<template>
  <div class="image-control-panel">
    
    <div class="panel-section">
      <h3>{{ t('img_source_image') }}</h3>
      <div class="control-row">
        <label class="studio-btn primary w-100">
          {{ t('img_load_btn') }}
          <input type="file" @change="onLoadFile" accept="image/*" hidden>
        </label>
      </div>
      <div class="control-row">
         <button class="studio-btn outline w-100" @click="$emit('load-sample')" :disabled="isProcessing">
            🖼️ Try Sample Image
         </button>
      </div>
      <div class="control-row" v-if="sourceImage">
        <button class="studio-btn outline w-100" @click="$emit('extract-lineart')" :disabled="isExtracting">
            {{ t('img_extract_btn') }}
        </button>
      </div>
    </div>

    <div class="panel-section" v-if="rawLineArtCanvas">
        <h3>{{ t('img_adjust_lines') }}</h3>
        <div class="control-group">
            <label>{{ t('img_threshold') }}</label>
            <input type="range" min="0" max="255" :value="lineArtSettings.threshold" @input="$emit('update:line-art-settings', { ...lineArtSettings, threshold: +($event.target as HTMLInputElement).value })">
        </div>
        <div class="control-group" v-if="lineArtSettings.thickness !== undefined">
            <label>{{ t('img_thickness') }}</label>
            <input type="range" min="-3" max="5" :value="lineArtSettings.thickness" @input="$emit('update:line-art-settings', { ...lineArtSettings, thickness: +($event.target as HTMLInputElement).value })">
        </div>
        <button class="studio-btn small w-100" @click="$emit('reset-lineart')">{{ t('img_reset_btn') }}</button>
    </div>

    <div class="panel-section">
        <h3>{{ t('img_paint_transform') }}</h3>
        <div class="paint-tools">
            <button :class="{ active: paintMode === 'move' }" @click="$emit('update:paint-mode', 'move')" title="Move/Scale Image">✋</button>
            <button :class="{ active: paintMode === 'brush' }" @click="$emit('update:paint-mode', 'brush')" title="Brush">🖊</button>
            <button :class="{ active: paintMode === 'eraser' }" @click="$emit('update:paint-mode', 'eraser')" title="Eraser">消</button>
            <button :class="{ active: paintMode === 'bucket' }" @click="$emit('update:paint-mode', 'bucket')" title="Fill">🪣</button>
            <button :class="{ active: paintMode === 'flow' }" @click="$emit('update:paint-mode', 'flow')" title="Flow Brush (Direct AA)">✒️</button>
        </div>
        
        <div class="paint-colors" v-if="paintMode !== 'move'">
            <button class="color-btn blue" :class="{ active: paintColor === 'blue' }" @click="$emit('update:paint-color', 'blue')"></button>
            <button class="color-btn red" :class="{ active: paintColor === 'red' }" @click="$emit('update:paint-color', 'red')"></button>
            
            <input type="range" min="1" max="50" :value="brushSize" class="brush-size-slider" @input="$emit('update:brush-size', +($event.target as HTMLInputElement).value)">
        </div>

        <div class="hatch-settings" v-if="paintMode !== 'move' && paintMode !== 'eraser' && paintMode !== 'flow'">
             <div class="hatch-row">
                 <span class="dot blue"></span>
                 <input type="text" :value="targetCharBlue" @input="$emit('update:target-char-blue', ($event.target as HTMLInputElement).value)" class="char-input" placeholder=":">
             </div>
             <div class="hatch-row">
                 <span class="dot red"></span>
                 <input type="text" :value="targetCharRed" @input="$emit('update:target-char-red', ($event.target as HTMLInputElement).value)" class="char-input" placeholder="/">
             </div>
        </div>

        <div v-if="paintMode === 'flow'" style="margin: 10px 0; font-size: 0.8rem; color: #666; background: #f9f9f9; padding: 8px; border-radius: 4px;">
            <b>Flow Mode:</b> Draw directly to generate AA.
        </div>

        <hr class="sep">

        <div class="control-group">
          <label>{{ t('img_thinning') }}: {{ thinningLevel }}</label>
          <input type="range" min="0" max="3" :value="thinningLevel" @input="$emit('update:thinning-level', +($event.target as HTMLInputElement).value)">
          
          <label style="margin-top:10px;">{{ t('img_noise') }}: {{ noiseGate }}</label>
          <input type="range" min="0" max="2.0" step="0.1" :value="noiseGate" @input="$emit('update:noise-gate', +($event.target as HTMLInputElement).value)">
          
          <label class="check-row" style="margin-top:10px; font-size:0.8rem;">
            <input type="checkbox" :checked="generationMode === 'hybrid'" @change="$emit('update:generation-mode', ($event.target as HTMLInputElement).checked ? 'hybrid' : 'accurate')">
            <span>Hybrid Mode (Faster)</span>
          </label>

          <button class="studio-btn outline w-100" 
                  style="display:flex; justify-content:center; align-items:center; gap:8px; margin-top:10px;"
                  @click="$emit('process-image')" :disabled="isProcessing">
            <span v-if="isProcessing" class="spinner small"></span>
            <span>{{ t('img_generate_btn') }}</span>
          </button>
          <button v-if="isProcessing" 
                  class="studio-btn danger w-100"
                  style="margin-top: 8px; display:flex; justify-content:center; align-items:center; gap:6px;"
                  @click="$emit('cancel-generation')">
            <span>⏹</span>
            <span>{{ t('img_stop_btn') }}</span>
          </button>
        </div>
    </div>

    <div class="panel-section">
      <h3>{{ t('img_appearance') }}</h3>
      <div class="control-group">
        <label>{{ t('img_opacity') }}: {{ traceOpacity }}%</label>
        <input type="range" min="0" max="100" :value="traceOpacity" @input="$emit('update:trace-opacity', +($event.target as HTMLInputElement).value)">
      </div>
      <div class="control-group">
        <label>{{ t('img_scale') }}: {{ imgTransform.scale.toFixed(2) }}</label>
        <input type="range" min="0.1" max="5.0" step="0.1" :value="imgTransform.scale" @input="$emit('update:img-transform', { ...imgTransform, scale: +($event.target as HTMLInputElement).value })">
      </div>
      <div class="control-group">
        <label>{{ t('img_rotation') }}: {{ imgTransform.rotation }}°</label>
        <input type="range" min="-180" max="180" :value="imgTransform.rotation" @input="$emit('update:img-transform', { ...imgTransform, rotation: +($event.target as HTMLInputElement).value })">
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-control-panel {
    padding: 10px;
    display: flex; flex-direction: column; gap: 15px;
    min-height: 100%;
}

.spinner {
    width: 30px; height: 30px;
    border: 3px solid #eee;
    border-top-color: #e6b086;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}
.spinner.small { width: 16px; height: 16px; border-width: 2px; }

@keyframes spin { to { transform: rotate(360deg); } }

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
.paint-colors { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.color-btn { width: 24px; height: 24px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #ccc; cursor: pointer; }
.color-btn.blue { background: blue; }
.color-btn.red { background: red; }
.color-btn.active { box-shadow: 0 0 0 2px #e6b086; transform: scale(1.1); }
.brush-size-slider { flex: 1; }
.sep { border: 0; border-top: 1px dashed #eee; margin: 10px 0; }
.check-row { display: flex; align-items: center; gap: 6px; cursor: pointer; }

/* ★追加: ハッチング文字設定用のスタイル */
.hatch-settings {
    background: #fdfdfd; border: 1px solid #eee;
    padding: 8px; border-radius: 4px;
    display: flex; flex-direction: column; gap: 5px;
}
.hatch-row { display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.blue { background: blue; }
.dot.red { background: red; }
.char-input {
    flex: 1; border: 1px solid #ddd; border-radius: 3px;
    padding: 2px 6px; font-family: monospace; font-size: 0.9rem;
}
/* ★追加: Danger Button Style */
.studio-btn.danger {
    background: transparent;
    border-color: #ff9b9b;
    color: #e06060;
}
.studio-btn.danger:hover {
    background: #ff7b7b;
    border-color: #ff7b7b;
    color: white;
}
</style>