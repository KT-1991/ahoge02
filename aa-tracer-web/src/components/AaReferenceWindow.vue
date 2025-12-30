<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  isVisible: boolean;
  title: string;
  content: string;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const pos = ref({ x: 20, y: 80 });
const isDragging = ref(false);
const offset = ref({ x: 0, y: 0 });

const startDrag = (e: MouseEvent) => {
  isDragging.value = true;
  offset.value = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y };
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
};

const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return;
  pos.value = { x: e.clientX - offset.value.x, y: e.clientY - offset.value.y };
};

const stopDrag = () => {
  isDragging.value = false;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
};
</script>

<template>
  <div v-if="isVisible" class="reference-window" :style="{ top: pos.y + 'px', left: pos.x + 'px' }">
    <div class="ref-header" @mousedown="startDrag">
      <span>📌 {{ title || 'Reference' }}</span>
      <button class="close-btn" @click="$emit('close')">×</button>
    </div>
    <div class="ref-body">
      <div class="ref-content">{{ content }}</div>
    </div>
  </div>
</template>

<style scoped>
.reference-window {
    position: fixed;
    width: 320px; height: 240px;
    background: rgba(255, 255, 255, 0.95);
    border-radius: 12px;
    box-shadow: 0 15px 40px rgba(0,0,0,0.15);
    border: 2px solid #e6b086;
    display: flex; flex-direction: column;
    z-index: 100;
    resize: both; overflow: hidden;
    min-width: 200px; min-height: 150px;
}
.ref-header {
    background: #e6b086; color: #fff; padding: 6px 12px; 
    font-size: 0.8rem; font-weight: bold;
    display: flex; justify-content: space-between; align-items: center; 
    cursor: move; flex-shrink: 0;
}
.ref-body { flex: 1; overflow: hidden; position: relative; background: #fff; }
.ref-content {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    overflow: auto; padding: 10px;
    font-family: 'MS PGothic', 'Saitamaar', monospace; 
    font-size: 12px; white-space: pre; line-height: 1.1;
    color: #333;
}
.close-btn { background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer; padding: 0; line-height: 1; }
</style>