<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  currentAaIndex: number;
  totalAAs: number;
  title: string;
  cursorInfo: { row: number, col: number, charCount: number, px: number };
  isBoxSelecting: boolean;
  viewMode: string;
  showBackgroundImage: boolean;
}>();

const emit = defineEmits<{
  (e: 'nav-prev'): void;
  (e: 'nav-next'): void;
  (e: 'toggle-grid'): void;
  (e: 'duplicate'): void;
  (e: 'pin-ref'): void;
  (e: 'delete'): void;
  
  // History
  (e: 'undo'): void;
  (e: 'redo'): void;

  // Menus
  (e: 'trigger-load', enc: string): void;
  (e: 'save', format: 'AST'|'MLT', enc: 'SJIS'|'UTF8'): void;
  (e: 'copy', mode: 'normal'|'bbs'): void;
  (e: 'show-export'): void;
  
  // Edit
  (e: 'apply-edit', type: string): void;
  (e: 'paste-box'): void;

  // Layout
  (e: 'toggle-layout', mode: string): void;
  (e: 'swap-panes'): void;
  (e: 'toggle-box-mode'): void;
  (e: 'toggle-bg-image'): void;
}>();

// Popover states
const showFileMenu = ref(false);
const showEditMenu = ref(false);
const showLayoutMenu = ref(false);
</script>

<template>
  <footer class="sketchbook-nav">
    <div class="nav-controls">
      <button class="page-btn" @click="$emit('nav-prev')" title="Previous Page">←</button>
      
      <div class="page-indicator" @click="$emit('toggle-grid')" title="Show Grid View">
        <span class="icon">📄</span>
        <span class="page-text">{{ currentAaIndex + 1 }} / {{ totalAAs }}</span>
        <span class="dropdown-arrow">▼</span>
      </div>
      
      <button class="page-btn" @click="$emit('nav-next')" title="Next Page">→</button>

      <div class="divider-v"></div>

      <button class="icon-action-btn" @click="$emit('undo')" title="Undo (Ctrl+Z)">↩</button>
      <button class="icon-action-btn" @click="$emit('redo')" title="Redo (Ctrl+Y)">↪</button>
    </div>

    <div class="footer-status">
      <span class="status-info">Ln {{ cursorInfo.row }}, Col {{ cursorInfo.col }}</span>
      <span class="status-info dim">{{ cursorInfo.charCount }} chars</span>
    </div>

    <div class="meta-actions">
      
      <div class="dropdown-container">
        <button class="text-btn" @click="showLayoutMenu = !showLayoutMenu" :class="{ active: showLayoutMenu }">Layout</button>
        <div class="popover-menu bottom-up" v-if="showLayoutMenu" @click.self="showLayoutMenu = false">
          <div class="menu-label">View Mode</div>
          <button class="menu-item" @click="$emit('toggle-layout', 'single')">⬜ Single View</button>
          <button class="menu-item" @click="$emit('toggle-layout', 'split-h')">日 Split Horizontal</button>
          <button class="menu-item" @click="$emit('toggle-layout', 'split-v')">|| Split Vertical</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('swap-panes')">⇄ Swap Panes</button>
          <button class="menu-item" @click="$emit('toggle-bg-image')">{{ showBackgroundImage ? 'Hide' : 'Show' }} Image</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('toggle-box-mode')">
            {{ isBoxSelecting ? 'Exit Box Mode' : 'Enter Box Mode' }}
          </button>
        </div>
      </div>

      <div class="dropdown-container">
        <button class="text-btn" @click="showEditMenu = !showEditMenu" :class="{ active: showEditMenu }">Edit</button>
        <div class="popover-menu bottom-up" v-if="showEditMenu" @click.self="showEditMenu = false">
          <div class="menu-label">Formatting</div>
          <button class="menu-item" @click="$emit('apply-edit', 'trim-end')">Trim End Space</button>
          <button class="menu-item" @click="$emit('apply-edit', 'add-end-space')">Add End Space</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('apply-edit', 'trim-start')">Trim Start Space</button>
          <button class="menu-item" @click="$emit('apply-edit', 'add-start-space')">Add Start Space</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('apply-edit', 'remove-empty')">Remove Empty Lines</button>
          <button class="menu-item" @click="$emit('apply-edit', 'align-right')">Align Right (|)</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('paste-box')">Rect Paste (Overwrite)</button>
        </div>
      </div>

      <div class="dropdown-container">
        <button class="text-btn" @click="showFileMenu = !showFileMenu" :class="{ active: showFileMenu }">File</button>
        <div class="popover-menu bottom-up" v-if="showFileMenu" @click.self="showFileMenu = false">
          <div class="menu-label">Open</div>
          <button class="menu-item" @click="$emit('trigger-load', 'AUTO')">📂 Open (Auto)</button>
          <button class="menu-item" @click="$emit('trigger-load', 'SJIS')">📂 Open (SJIS)</button>
          <div class="menu-sep"></div>
          <div class="menu-label">Save Project</div>
          <button class="menu-item" @click="$emit('save', 'AST', 'SJIS')">💾 Save AST (SJIS)</button>
          <button class="menu-item" @click="$emit('save', 'AST', 'UTF8')">💾 Save AST (UTF8)</button>
          <button class="menu-item" @click="$emit('save', 'MLT', 'SJIS')">💾 Export MLT (SJIS)</button>
          <div class="menu-sep"></div>
          <div class="menu-label">Clipboard</div>
          <button class="menu-item" @click="$emit('copy', 'normal')">📋 Copy Text</button>
          <button class="menu-item" @click="$emit('copy', 'bbs')">🛡️ Copy (BBS Safe)</button>
          <div class="menu-sep"></div>
          <button class="menu-item" @click="$emit('show-export')">📤 Export Image</button>
        </div>
      </div>

      <div class="divider-v"></div>

      <button class="icon-action-btn" @click="$emit('duplicate')" title="Duplicate Page">📄⁺</button>
      <button class="icon-action-btn" @click="$emit('pin-ref')" title="Pin as Reference">📌</button>
      <button class="icon-action-btn danger" @click="$emit('delete')" title="Delete Page">🗑️</button>
    </div>
  </footer>
</template>

<style scoped>
.sketchbook-nav {
    height: 50px;
    background: #fff;
    border-top: 1px solid rgba(0,0,0,0.08);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 15px;
    box-shadow: 0 -4px 20px rgba(0,0,0,0.03);
    z-index: 20;
    user-select: none;
}

.nav-controls { display: flex; align-items: center; gap: 8px; }

.page-btn {
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid #ddd;
    background: #fff; cursor: pointer; color: #555; font-size: 1rem;
    display: flex; align-items: center; justify-content: center; transition: all 0.1s;
}
.page-btn:hover { background: #e6b086; color: #fff; border-color: #e6b086; }

.page-indicator {
    font-weight: bold; font-size: 0.85rem; color: #444;
    padding: 4px 12px; border-radius: 16px;
    background: #f5f5f5; cursor: pointer; border: 1px solid transparent;
    transition: background 0.2s;
    display: flex; align-items: center; gap: 6px;
}
.page-indicator:hover { background: #eee; border-color: #ddd; }
.dropdown-arrow { font-size: 0.6rem; opacity: 0.5; }

.footer-status {
    font-size: 0.75rem; color: #888; font-family: monospace;
    display: flex; gap: 10px;
}
.status-info.dim { opacity: 0.6; }

.meta-actions { display: flex; gap: 4px; align-items: center; }

.divider-v { width: 1px; height: 20px; background: #ddd; margin: 0 4px; }

.text-btn {
    background: transparent; border: none; color: #555; font-weight: bold; font-size: 0.85rem;
    cursor: pointer; padding: 6px 10px; border-radius: 6px; transition: background 0.2s;
}
.text-btn:hover, .text-btn.active { background: #f0f0f0; color: #222; }

.icon-action-btn {
    width: 30px; height: 30px; border-radius: 4px; border: none;
    background: transparent; cursor: pointer; color: #666; font-size: 1.1rem;
    display: flex; align-items: center; justify-content: center;
}
.icon-action-btn:hover { background: #f0f0f0; color: #333; }
.icon-action-btn.danger:hover { background: #fee2e2; color: #dc2626; }

/* Popover */
.dropdown-container { position: relative; }
.popover-menu {
    position: absolute; bottom: 35px; right: 0;
    min-width: 200px; background: white; border: 1px solid #ddd;
    border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    padding: 4px 0; z-index: 100;
}
.menu-label { padding: 6px 12px; font-size: 0.7rem; color: #999; font-weight: bold; background: #fafafa; border-bottom: 1px solid #eee; }
.menu-item {
    display: block; width: 100%; text-align: left; padding: 8px 15px;
    background: none; border: none; font-size: 0.85rem; color: #333; cursor: pointer;
}
.menu-item:hover { background: #f7f7f7; color: #e6b086; }
.menu-sep { height: 1px; background: #eee; margin: 2px 0; }
</style>