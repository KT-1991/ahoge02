<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';

// 型定義
interface AaEntry { title: string; content: string; }
interface Category { id: string; name: string; chars: string; }

const props = defineProps<{
  historyChars: string[];
  projectAAs: AaEntry[];
  currentAAIndex: number;
  categories: Category[];
}>();

const emit = defineEmits<{
  (e: 'add-char', char: string): void;
  (e: 'select-aa', idx: number): void;
  (e: 'delete-aa', idx: number): void;
  (e: 'add-new-aa'): void;
  (e: 'show-palette-editor'): void;
}>();

const currentCategoryId = ref<string>('1');
const historyPaneRatio = ref(0.35);
const isResizingPalette = ref(false);
const paletteContainerRef = ref<HTMLElement | null>(null);

const currentCategoryData = computed(() => {
  if (!props.categories || props.categories.length === 0) return { id: '0', name: 'Loading', chars: '' };
  return props.categories.find(c => c.id === currentCategoryId.value) || props.categories[0];
});

// リサイズロジック
const startResizePalette = () => {
  isResizingPalette.value = true;
  window.addEventListener('mousemove', onResizePalette);
  window.addEventListener('mouseup', stopResizePalette);
};
const onResizePalette = (e: MouseEvent) => {
  if (!paletteContainerRef.value) return;
  const rect = paletteContainerRef.value.getBoundingClientRect();
  historyPaneRatio.value = Math.min(0.8, Math.max(0.1, (e.clientY - rect.top) / rect.height));
};
const stopResizePalette = () => {
  isResizingPalette.value = false;
  window.removeEventListener('mousemove', onResizePalette);
  window.removeEventListener('mouseup', stopResizePalette);
};
onUnmounted(() => stopResizePalette());
</script>

<template>
  <div class="panel-box palette-container" ref="paletteContainerRef">
    <div class="history-section" :style="{ flex: `0 0 ${historyPaneRatio * 100}%`, minHeight: '0' }">
      <div class="panel-header">
        <span class="header-title">🕒 History</span>
        <span class="header-badge">{{ historyChars.length }}</span>
      </div>
      <div class="grid-scroll-area history-bg">
        <div class="char-grid-dense">
          <button v-for="c in historyChars" :key="c" class="key-dense" @click="$emit('add-char', c)">{{ c }}</button>
        </div>
      </div>
    </div>

    <div class="palette-resize-handle" @mousedown.prevent="startResizePalette" :class="{ active: isResizingPalette }">
      <div class="handle-bar"></div>
    </div>

    <div class="library-section" style="flex:1; min-height:0;">
      <div class="panel-header">
        <select v-model="currentCategoryId" class="category-selector">
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">📂 {{ cat.name }}</option>
        </select>
        <button class="icon-btn tiny" @click="$emit('show-palette-editor')" title="Edit Palette">✏️</button>
      </div>
      <div class="grid-scroll-area">
        <div class="char-grid-dense">
          <button v-for="c in (currentCategoryData?.chars || '').split('')" :key="c" class="key-dense" @click="$emit('add-char', c)">
            {{ c }}
          </button>
        </div>
      </div>
    </div>

    <div class="project-list-section">
      <div class="panel-header" style="border-top:1px solid #ddd;">
        <span>📚 Project</span>
        <button class="icon-btn tiny" @click="$emit('add-new-aa')" title="Add Page">+</button>
      </div>
      <div class="aa-list">
        <div v-for="(aa, idx) in projectAAs" :key="idx" class="aa-list-item" :class="{ active: idx === currentAAIndex }" @click="$emit('select-aa', idx)">
          <span class="aa-list-title">{{ idx + 1 }}. {{ aa.title }}</span>
          <button v-if="projectAAs.length > 1" @click.stop="$emit('delete-aa', idx)" class="del-btn">×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.history-section, .library-section { display: flex; flex-direction: column; }
.history-bg { background-color: #fffbf5; }
.panel-header { padding: 6px 10px; background: #f5f5f5; font-size: 0.75rem; font-weight: bold; display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #eee; }
.header-title { display: flex; align-items: center; gap: 6px; }
.header-badge { background: #e6b086; color: #fff; font-size: 0.65rem; padding: 1px 5px; border-radius: 8px; }
.category-selector { width: 100%; padding: 2px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.8rem; font-weight: bold; color: #555; }
.icon-btn.tiny { font-size: 0.9rem; padding: 2px 5px; cursor: pointer; border: none; background: none; color: #888; }
.icon-btn.tiny:hover { color: #333; background: #eee; border-radius: 4px; }
.grid-scroll-area { flex: 1; padding: 5px; overflow-y: auto; }
.char-grid-dense { display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); gap: 2px; }
.key-dense { height: 28px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid transparent; border-radius: 4px; font-size: 13px; cursor: pointer; color: #333; font-family: 'Saitamaar', sans-serif; }
.key-dense:hover { border-color: #e6b086; color: #e6b086; background: #fffaf5; transform: scale(1.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1); z-index: 1; }
.palette-resize-handle { flex: 0 0 6px; background: #f5f5f5; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; display: flex; align-items: center; justify-content: center; cursor: row-resize; z-index: 10; }
.palette-resize-handle:hover, .palette-resize-handle.active { background: #e0e0e0; }
.handle-bar { width: 20px; height: 3px; background: #ccc; border-radius: 2px; }
.project-list-section { flex: 0 0 160px; display: flex; flex-direction: column; overflow: hidden; border-top: 1px solid #ccc; background: #fdfdfd; }
.aa-list { flex: 1; overflow-y: auto; }
.aa-list-item { padding: 8px 10px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; }
.aa-list-item:hover { background: #f0f0f0; }
.aa-list-item.active { background: #fffaf0; border-left: 3px solid #e6b086; font-weight: bold; }
.aa-list-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.del-btn { width: 20px; height: 20px; border-radius: 50%; background: rgba(0,0,0,0.1); color: #fff; border: none; font-size: 0.7rem; display: flex; align-items: center; justify-content: center; opacity: 0; cursor: pointer; }
.aa-list-item:hover .del-btn { opacity: 1; }
.del-btn:hover { background: red; }
</style>