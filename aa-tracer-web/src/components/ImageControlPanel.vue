<script setup lang="ts">
  
const props = defineProps<{
  sourceImage: HTMLImageElement | null;
  isProcessing: boolean;
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
  // (e: 'apply-lineart'): void; // 不要になったため削除
  (e: 'reset-lineart'): void;
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
  (e: 'process-image'): void;
}>();

const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) emit('load-image', file);
};
</script>

<template>
  <div class="panel-box" style="flex:1; background:#eee; display:flex; flex-direction:column; position:relative; overflow:hidden;">
    <div v-if="isProcessing" class="processing-overlay">
      <div class="spinner"></div>
      <span class="processing-text">Processing...</span>
    </div>

    <div class="scrollable-content" style="flex:1; overflow-y:auto; padding:10px;">
      <label class="studio-btn primary w-100" style="text-align:center; display:block; margin-bottom:15px;">
        📂 Load Image <input type="file" @change="onFileChange" accept="image/*" hidden />
      </label>

      <div v-if="sourceImage">
        <div class="control-group" style="border:1px solid #4ade80; background:#f0fdf4;">
          <label style="color:#166534;">🤖 AI Line Art</label>
          <button v-if="!rawLineArtCanvas" class="studio-btn w-100" 
                  style="background:#4ade80; color:#064e3b; border:none; display:flex; justify-content:center; align-items:center; gap:8px;" 
                  @click="$emit('extract-lineart')" :disabled="isProcessing">
            <span v-if="isProcessing" class="spinner small"></span>
            {{ isProcessing ? 'Extracting...' : '✨ Extract Lines' }}
          </button>
          <div v-else>
            <div style="display:flex; gap:5px; margin-bottom:5px;">
              <button class="studio-btn small outline w-100" @click="$emit('reset-lineart')" :disabled="isProcessing">Reset to Original</button>
            </div>
            
            <label>Density (Thresh): {{ lineArtSettings.threshold }}</label>
            <input type="range" min="10" max="250" 
                   :value="lineArtSettings.threshold" 
                   @input="$emit('update:lineArtSettings', { ...lineArtSettings, threshold: +($event.target as HTMLInputElement).value })">
            
            <label>Thickness: {{ lineArtSettings.thickness }}</label>
            <input type="range" min="-2" max="2" step="1" 
                   :value="lineArtSettings.thickness" 
                   @input="$emit('update:lineArtSettings', { ...lineArtSettings, thickness: +($event.target as HTMLInputElement).value })">
          </div>
        </div>

        <div class="control-group">
          <label>Opacity: {{ traceOpacity }}%</label>
          <input type="range" min="0" max="100" :value="traceOpacity" @input="$emit('update:traceOpacity', +($event.target as HTMLInputElement).value)">
        </div>
        <div class="control-group">
          <label>Scale: {{ Math.round(imgTransform.scale * 100) }}%</label>
          <input type="range" min="0.1" max="3.0" step="0.1" :value="imgTransform.scale" @input="$emit('update:imgTransform', { ...imgTransform, scale: +($event.target as HTMLInputElement).value })">
        </div>
        <div class="control-group">
          <label>Rotate: {{ imgTransform.rotation }}°</label>
          <input type="range" min="-180" max="180" step="1" :value="imgTransform.rotation" @input="$emit('update:imgTransform', { ...imgTransform, rotation: +($event.target as HTMLInputElement).value })">
        </div>
        <hr class="sep">

        <div class="control-group">
          <label>Mode</label>
          <div class="btn-group">
            <button :class="{ active: paintMode==='move' }" @click="$emit('update:paintMode', 'move')">✋ Move</button>
            <button :class="{ active: paintMode==='brush' }" @click="$emit('update:paintMode', 'brush')">🖌️ Brush</button>
            <button :class="{ active: paintMode==='bucket' }" @click="$emit('update:paintMode', 'bucket')">🪣 Fill</button>
            <button :class="{ active: paintMode==='eraser' }" @click="$emit('update:paintMode', 'eraser')">🧹 Eraser</button>
          </div>
        </div>
        <div class="control-group" v-if="paintMode !== 'move'">
          <label>Color</label>
          <div class="btn-group">
            <button :class="{ active: paintColor==='blue' }" @click="$emit('update:paintColor', 'blue')" style="color:blue;">Blue</button>
            <button :class="{ active: paintColor==='red' }" @click="$emit('update:paintColor', 'red')" style="color:red;">Red</button>
          </div>
          <div style="display:flex; gap:5px; margin-top:8px;">
            <div style="flex:1;">
              <label style="font-size:0.7rem; color:blue;">Blue Char</label>
              <input type="text" :value="targetCharBlue" @input="$emit('update:targetCharBlue', ($event.target as HTMLInputElement).value)" class="char-input">
            </div>
            <div style="flex:1;">
              <label style="font-size:0.7rem; color:red;">Red Char</label>
              <input type="text" :value="targetCharRed" @input="$emit('update:targetCharRed', ($event.target as HTMLInputElement).value)" class="char-input">
            </div>
          </div>
          <label style="margin-top:5px;">Brush Size: {{ brushSize }}</label>
          <input type="range" min="1" max="50" :value="brushSize" @input="$emit('update:brushSize', +($event.target as HTMLInputElement).value)">
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
            <span>✨ Update Features</span>
          </button>
        </div>
      </div>
      <div v-else class="placeholder-text" style="color:#888;">No Image Loaded</div>
    </div>
  </div>
</template>