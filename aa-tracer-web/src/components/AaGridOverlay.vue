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
        <div class="header-actions">
            <button class="add-btn" @click="$emit('add')">+ New Page</button>
            <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
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
            <span class="thumb-title" :title="aa.title">#{{ idx + 1 }} {{ aa.title }}</span>
            <button class="thumb-del" @click.stop="$emit('delete', idx)" title="Delete">🗑</button>
          </div>
        </div>

        <div class="aa-thumb-card add-card" @click="$emit('add')">
            <span class="plus-icon">+</span>
            <span>Add New</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.4); backdrop-filter: blur(2px);
    z-index: 500;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
    display: flex; align-items: center; justify-content: center;
}
.grid-overlay.active { opacity: 1; pointer-events: auto; }

.grid-container {
    width: 80vw; height: 80vh; max-width: 1000px;
    background: #fdfbf7; border-radius: 12px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.2);
    display: flex; flex-direction: column; overflow: hidden;
}

.grid-header {
    padding: 15px 20px; border-bottom: 1px solid #ddd; background: #fff;
    display: flex; justify-content: space-between; align-items: center;
}
.grid-header h2 { margin: 0; font-size: 1.2rem; color: #444; }
.header-actions { display: flex; gap: 10px; align-items: center; }

.close-btn { 
    background: transparent; border: none; font-size: 1.5rem; cursor: pointer; color: #888; 
    width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%;
}
.close-btn:hover { background: #eee; color: #333; }

.add-btn {
    background: #e6b086; color: white; border: none; padding: 6px 12px;
    border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.9rem;
}
.add-btn:hover { background: #dda275; }

/* ★変更: グリッドレイアウト */
.grid-content {
    flex: 1; 
    padding: 20px; 
    overflow-y: auto;
    background: #f4f4f4;
    
    /* Grid設定 */
    display: grid;
    /* 最小幅180pxで折り返し、余った幅は均等割り */
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 16px;
    align-content: start; /* 要素が少ない時に上に詰める */
}

/* カードスタイル */
.aa-thumb-card {
    background: white; border: 1px solid #ddd; border-radius: 8px;
    height: 220px; /* 固定高さ */
    display: flex; flex-direction: column;
    cursor: pointer; transition: all 0.2s ease;
    overflow: hidden; position: relative;
    box-shadow: 0 2px 5px rgba(0,0,0,0.05);
}

.aa-thumb-card:hover { 
    transform: translateY(-4px); 
    box-shadow: 0 8px 15px rgba(0,0,0,0.1); 
    border-color: #e6b086;
}

.aa-thumb-card.current { 
    border: 2px solid #e6b086; 
    box-shadow: 0 0 0 3px rgba(230, 176, 134, 0.2); 
}

.thumb-preview {
    flex: 1; 
    padding: 10px; 
    font-family: 'MSP_Parallel', 'Saitamaar', 'MS PGothic', monospace; 
    font-size: 10px; /* 縮小表示 */
    line-height: 1.1; 
    overflow: hidden; 
    white-space: pre; 
    color: #666;
    background: #fff;
    /* 長い行も折り返さず、切り取る */
}

.thumb-footer {
    padding: 8px 10px; background: #fafafa; border-top: 1px solid #eee;
    display: flex; justify-content: space-between; align-items: center;
    height: 40px;
}

.thumb-title { 
    font-weight: bold; font-size: 0.85rem; color: #555;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;
}

.thumb-del {
    background: transparent; border: none; color: #ccc; cursor: pointer;
    font-size: 1rem; padding: 4px; border-radius: 4px;
}
.thumb-del:hover { color: #d32f2f; background: #fee; }

/* 末尾の追加用カード */
.aa-thumb-card.add-card {
    border: 2px dashed #ccc;
    background: transparent;
    align-items: center; justify-content: center;
    color: #888;
}
.aa-thumb-card.add-card:hover {
    border-color: #e6b086; color: #e6b086; background: rgba(230, 176, 134, 0.05);
}
.plus-icon { font-size: 2rem; font-weight: bold; margin-bottom: 5px; }

</style>