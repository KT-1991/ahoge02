<script setup lang="ts">
import { useI18n } from '../composables/useI18n'; // ★追加

const { t } = useI18n(); // ★使用開始
// Props定義を修正 (色関連を削除)
defineProps<{
  status: string;
  isReady: boolean;
  isProcessing: boolean;
}>();

// Emits定義を修正 (色関連を削除)
const emit = defineEmits<{
  (e: 'toggle-debug'): void;
  (e: 'toggle-config'): void;
  (e: 'toggle-help'): void;
}>();
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="app-logo">{{ t('app_title') }}</h1>
      <span class="app-version">v1.0</span>
      
      <div class="status-badge" :class="{ ready: isReady, processing: isProcessing }">
        <span class="status-dot"></span>
        {{ status }}
      </div>
    </div>

    <div class="header-right">
      <button class="icon-btn" @click="$emit('toggle-help')" title="Help">❓</button>
      <button class="icon-btn" @click="$emit('toggle-config')" title="Configuration">⚙️</button>
      <button class="icon-btn" @click="$emit('toggle-debug')" title="Debug Info">🐞</button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
    height: 40px; background: #333; color: #eee;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 15px; font-size: 0.9rem; user-select: none;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1); z-index: 100;
}
.header-left, .header-right { display: flex; align-items: center; gap: 15px; }
.app-logo { font-size: 1rem; font-weight: bold; color: #e6b086; margin: 0; letter-spacing: 1px; }
.app-version { font-size: 0.7rem; color: #888; background: #444; padding: 2px 6px; border-radius: 10px; }

.status-badge { 
    display: flex; align-items: center; gap: 6px; font-size: 0.75rem; 
    color: #aaa; background: #222; padding: 3px 10px; border-radius: 12px; border: 1px solid #444;
}
.status-badge.ready { color: #fff; border-color: #555; }
.status-badge.processing { color: #e6b086; border-color: #e6b086; }
.status-dot { width: 8px; height: 8px; background: #666; border-radius: 50%; transition: background 0.3s; }
.ready .status-dot { background: #4caf50; box-shadow: 0 0 5px #4caf50; }
.processing .status-dot { background: #e6b086; animation: pulse 1s infinite; }

.icon-btn { background: transparent; border: none; font-size: 1.1rem; cursor: pointer; opacity: 0.8; transition: opacity 0.2s; padding: 4px; }
.icon-btn:hover { opacity: 1; transform: scale(1.1); }

@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
</style>