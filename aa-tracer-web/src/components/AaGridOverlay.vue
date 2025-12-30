<script setup lang="ts">
import type { AaEntry } from '../utils/AaFileManager';

defineProps<{
  isActive: boolean;
  projectAAs: AaEntry[];
  currentIndex: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', idx: number): void;
  (e: 'add'): void;
  (e: 'delete', idx: number): void;
}>();
</script>

<template>
  <div class="grid-overlay" :class="{ active: isActive }" @click.self="$emit('close')">
    <div class="grid-container">
      <div class="grid-header">
        <h2>Pages ({{ projectAAs.length }})</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      
      <div class="grid-content">
        <div 
          v-for="(aa, idx) in projectAAs" :key="idx" 
          class="aa-thumb-card" 
          :class="{ current: idx === currentIndex }"
          @click="$emit('select', idx)"
        >
          <div class="thumb-preview">{{ aa.content }}</div>
          <div class="thumb-footer">
            <span class="thumb-title">#{{ idx + 1 }} {{ aa.title }}</span>
            <button class="thumb-del" @click.stop="$emit('delete', idx)" v-if="projectAAs.length > 1">🗑️</button>
          </div>
        </div>
        
        <div class="aa-thumb-card add-card" @click="$emit('add')">
          <span class="plus-icon">+</span>
          <span class="add-text">New Page</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: calc(100% - 50px); /* Footer height */
    background: rgba(250, 248, 245, 0.95);
    backdrop-filter: blur(4px);
    z-index: 15;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
    overflow-y: auto;
}
.grid-overlay.active { opacity: 1; pointer-events: auto; }

.grid-container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
.grid-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.grid-header h2 { margin: 0; color: #555; }
.close-btn { font-size: 2rem; color: #999; background: none; border: none; cursor: pointer; }

.grid-content {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 20px;
}

.aa-thumb-card {
    background: #fff; border-radius: 12px;
    border: 1px solid rgba(0,0,0,0.08);
    height: 200px; display: flex; flex-direction: column;
    cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;
    overflow: hidden; position: relative;
    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
}
.aa-thumb-card:hover { transform: translateY(-4px); box-shadow: 0 10px 20px rgba(0,0,0,0.08); border-color: #e6b086; }
.aa-thumb-card.current { border: 2px solid #e6b086; box-shadow: 0 0 0 4px rgba(230, 176, 134, 0.2); }

.thumb-preview {
    flex: 1; padding: 12px; 
    font-family: 'MS PGothic', 'Saitamaar', monospace; 
    font-size: 8px; line-height: 1.1; 
    overflow: hidden; white-space: pre; color: #888;
    background: #fff;
}
.thumb-footer {
    padding: 8px 12px; background: #fafafa; border-top: 1px solid #eee;
    display: flex; justify-content: space-between; align-items: center;
}
.thumb-title { font-size: 0.75rem; font-weight: bold; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.thumb-del {
    background: none; border: none; font-size: 0.9rem; cursor: pointer; opacity: 0.3; transition: opacity 0.2s;
}
.thumb-del:hover { opacity: 1; }

.add-card {
    align-items: center; justify-content: center; 
    border: 2px dashed #ddd; background: transparent;
    color: #bbb;
}
.add-card:hover { border-color: #bbb; background: rgba(0,0,0,0.02); color: #888; }
.plus-icon { font-size: 3rem; line-height: 1; }
.add-text { font-size: 0.9rem; font-weight: bold; margin-top: 5px; }
</style>