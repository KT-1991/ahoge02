<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  status: string;
  isReady: boolean;
  isProcessing: boolean;
  aaTextColor: string;
  subTextColor: string;
}>();

const emit = defineEmits<{
  (e: 'update:aaTextColor', val: string): void;
  (e: 'update:subTextColor', val: string): void;
  (e: 'toggle-debug'): void;
  (e: 'toggle-config'): void;
  (e: 'swap-colors'): void;
  (e: 'invert-color'): void;
}>();

const showColorPicker = ref(false);
const hueValue = ref(0);
const presetColors = ['#222222', '#ffffff', '#e60012', '#009944', '#0068b7', '#f39800', '#fff100', '#8fc31f', '#00b7ee', '#920783'];

const updateHue = () => {
  emit('update:aaTextColor', `hsl(${hueValue.value}, 70%, 50%)`);
};
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <div class="status-indicator" :class="{ ready: isReady, processing: isProcessing }"></div>
      Cozy Craft AA
    </div>
    <div class="visual-controls">
      <button class="nav-icon-btn" @click="$emit('toggle-debug')" title="Debug View">👁️ Debug</button>
      <button class="nav-icon-btn" @click="$emit('toggle-config')" title="AI Config">⚙️ Config</button>

      <div class="color-control-group">
        <button class="icon-btn tiny" @click="$emit('swap-colors')" title="Swap Colors">⇄</button>
        <div class="dual-swatch-container">
          <div class="swatch-back" :style="{ background: subTextColor }" @click="$emit('swap-colors')"></div>
          <button class="swatch-front" :style="{ background: aaTextColor }" @click="showColorPicker = !showColorPicker"></button>
        </div>
        <button class="icon-btn tiny" @click="$emit('invert-color')" title="Invert B/W" style="margin-left:5px;">◑</button>

        <div class="color-picker-popover" v-if="showColorPicker">
          <div class="color-grid">
            <button v-for="c in presetColors" :key="c" class="color-swatch" :style="{ background: c }"
              @click="$emit('update:aaTextColor', c); showColorPicker = false"></button>
          </div>
          <div class="color-slider-row">
            <span class="label">HUE</span>
            <input type="range" min="0" max="360" v-model="hueValue" @input="updateHue" class="hue-slider">
          </div>
          <div class="color-custom-row">
            <span style="font-size:0.8rem; color:#666;">Custom:</span>
            <input type="color" :value="aaTextColor" @input="$emit('update:aaTextColor', ($event.target as HTMLInputElement).value)" class="color-input">
          </div>
        </div>
      </div>
    </div>
  </header>
</template>