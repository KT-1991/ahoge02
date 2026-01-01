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
  aaTextColor: string;
  subTextColor: string;
}>();

const emit = defineEmits<{
  (e: 'nav-prev'): void;
  (e: 'nav-next'): void;
  (e: 'toggle-grid'): void;
  (e: 'duplicate'): void;
  (e: 'pin-ref'): void;
  (e: 'delete'): void;
  (e: 'undo'): void;
  (e: 'redo'): void;
  (e: 'trigger-load', enc: string): void;
  (e: 'save', format: 'AST'|'MLT', enc: 'SJIS'|'UTF8'): void;
  (e: 'copy', mode: 'normal'|'bbs'): void;
  (e: 'show-export'): void;
  (e: 'apply-edit', type: string): void;
  (e: 'paste-box'): void;
  (e: 'toggle-layout', mode: string): void;
  (e: 'swap-panes'): void;
  (e: 'toggle-box-mode'): void;
  (e: 'toggle-bg-image'): void;
  (e: 'swap-colors'): void;

  // ★変更: 色更新ではなく「ピッカーを開く」イベントにする
  (e: 'open-color-picker', target: 'main' | 'sub'): void;
  (e: 'show-timelapse'): void;
}>();

// Popover States
const showFileMenu = ref(false);
const showEditMenu = ref(false);
const showCopyMenu = ref(false);
const showViewMenu = ref(false);

const closeAllMenus = () => {
    showFileMenu.value = false;
    showEditMenu.value = false;
    showCopyMenu.value = false;
    showViewMenu.value = false;
};

const toggleMenu = (menu: string) => {
    const targetState = 
        menu === 'file' ? showFileMenu : 
        menu === 'edit' ? showEditMenu :
        menu === 'copy' ? showCopyMenu : showViewMenu;
    const current = targetState.value;
    closeAllMenus();
    targetState.value = !current;
};
</script>

<template>
  <footer class="app-footer">
    
    <div class="footer-group">
      <button class="nav-btn" @click="$emit('nav-prev')">◀</button>
      <span class="page-indicator" @click="$emit('toggle-grid')">{{ currentAaIndex + 1 }} / {{ totalAAs }}</span>
      <button class="nav-btn" @click="$emit('nav-next')">▶</button>
      <div class="divider-v"></div>
      <span class="aa-title">{{ title }}</span>
    </div>

    <div class="footer-center">
      <div class="dropdown-container"><button class="text-btn" :class="{ active: showFileMenu }" @click.stop="toggleMenu('file')">File</button><div v-if="showFileMenu" class="popover-menu"><div class="menu-item" @click="$emit('trigger-load', 'AUTO'); closeAllMenus()">📂 Open File...</div><div class="menu-item" @click="$emit('save', 'AST', 'UTF8'); closeAllMenus()">💾 Save (AST/Text)</div><div class="menu-item" @click="$emit('save', 'MLT', 'UTF8'); closeAllMenus()">📦 Save All (MLT)</div><div class="divider-h"></div><div class="menu-item" @click="$emit('show-export'); closeAllMenus()">📤 Export Image...</div></div></div>
      <div class="dropdown-container"><button class="text-btn" :class="{ active: showEditMenu }" @click.stop="toggleMenu('edit')">Edit</button><div v-if="showEditMenu" class="popover-menu"><div class="menu-item" @click="$emit('undo'); closeAllMenus()">↩ Undo (Ctrl+Z)</div><div class="menu-item" @click="$emit('redo'); closeAllMenus()">↪ Redo (Ctrl+Y)</div><div class="divider-h"></div><div class="menu-item" @click="$emit('paste-box'); closeAllMenus()">📋 Rect Paste (Box)</div><div class="divider-h"></div><div class="menu-item" @click="$emit('apply-edit', 'trim-end'); closeAllMenus()">✂ Trim Line Ends</div><div class="menu-item" @click="$emit('apply-edit', 'remove-empty'); closeAllMenus()">🗑 Remove Empty Lines</div><div class="divider-h"></div><div class="menu-item" @click="$emit('apply-edit', 'add-start-space'); closeAllMenus()">indent (Add Space)</div><div class="menu-item" @click="$emit('apply-edit', 'trim-start'); closeAllMenus()">unindent (Remove Space)</div><div class="divider-h"></div><div class="menu-item danger" @click="$emit('delete'); closeAllMenus()">✖ Delete Page</div></div></div>
      <div class="dropdown-container"><button class="text-btn" :class="{ active: showCopyMenu }" @click.stop="toggleMenu('copy')">Copy</button><div v-if="showCopyMenu" class="popover-menu"><div class="menu-item" @click="$emit('copy', 'normal'); closeAllMenus()">📄 Copy Text (Ctrl+C)</div><div class="menu-item" @click="$emit('copy', 'bbs'); closeAllMenus()">💬 Copy for BBS (Compat)</div></div></div>
      <div class="dropdown-container"><button class="text-btn" :class="{ active: showViewMenu }" @click.stop="toggleMenu('view')">View</button>
      <div v-if="showFileMenu" class="popover-menu">
          <div class="menu-label">Open File</div>
          <div class="menu-item" @click="$emit('trigger-load', 'AUTO'); closeAllMenus()">📂 Auto Detect</div>
          <div class="menu-item" @click="$emit('trigger-load', 'SJIS'); closeAllMenus()">📂 Shift-JIS (Legacy)</div>
          <div class="menu-item" @click="$emit('trigger-load', 'UTF8'); closeAllMenus()">📂 UTF-8</div>
          
          <div class="divider-h"></div>
          
          <div class="menu-label">Save Text (.txt/.ast)</div>
          <div class="menu-item" @click="$emit('save', 'AST', 'UTF8'); closeAllMenus()">💾 Save as UTF-8</div>
          <div class="menu-item" @click="$emit('save', 'AST', 'SJIS'); closeAllMenus()">💾 Save as Shift-JIS</div>
          
          <div class="divider-h"></div>

          <div class="menu-label">Save Project (.mlt)</div>
          <div class="menu-item" @click="$emit('save', 'MLT', 'UTF8'); closeAllMenus()">📦 Save All (UTF-8)</div>
          <div class="menu-item" @click="$emit('save', 'MLT', 'SJIS'); closeAllMenus()">📦 Save All (Shift-JIS)</div>

          <div class="divider-h"></div>
          <div class="menu-item" @click="$emit('show-export'); closeAllMenus()">📤 Export Image...</div>
        </div>
      </div>

      <div class="divider-v" style="margin: 0 4px;"></div>

      <div class="color-palette-widget">
        <div class="color-pair">
            <button class="color-sq sub" :style="{ backgroundColor: subTextColor }" title="Sub Color"
                 @click.stop="emit('open-color-picker', 'sub')">
            </button>
            <button class="color-sq main" :style="{ backgroundColor: aaTextColor }" title="Main Color"
                 @click.stop="emit('open-color-picker', 'main')">
            </button>
        </div>
        <button class="swap-mini-btn" @click.stop="emit('swap-colors')" title="Swap Colors">
            <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"></path></svg>
        </button>
      </div>
    </div>

    <div class="footer-group right">
        <div v-if="isBoxSelecting" class="mode-badge box">BOX SELECT</div>
        <span class="info-item">{{ cursorInfo.px }} px</span><div class="divider-v"></div>
        <span class="info-item">Ln {{ cursorInfo.row + 1 }}, Col {{ cursorInfo.col }}</span><div class="divider-v"></div>
        <span class="info-item">{{ cursorInfo.charCount }} chars</span>
    </div>

    <div v-if="showFileMenu || showEditMenu || showCopyMenu || showViewMenu" 
         class="menu-backdrop" @click="closeAllMenus"></div>
  </footer>
</template>

<style scoped>
.app-footer { height: 35px; background: #fdfdfd; border-top: 1px solid #ddd; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; font-size: 0.85rem; user-select: none; color: #444; position: relative; z-index: 200; overflow: visible !important; }
.footer-group { display: flex; align-items: center; gap: 8px; }
.footer-center { display: flex; align-items: center; gap: 4px; position: absolute; left: 50%; transform: translateX(-50%); z-index: 300; pointer-events: auto; overflow: visible !important; }
.footer-group.right { justify-content: flex-end; font-family: monospace; font-size: 0.8rem; color: #666; }
.nav-btn, .text-btn, .icon-btn { background: transparent; border: none; cursor: pointer; }
.nav-btn:hover, .text-btn:hover { background: #eee; }
.text-btn { padding: 4px 10px; border-radius: 4px; font-weight: 500; color: #444; }
.text-btn.active { background: #e0e0e0; color: #000; }
.divider-v { width: 1px; height: 16px; background: #ddd; margin: 0 4px; }
.divider-h { height: 1px; background: #eee; margin: 4px 0; }
.info-item { min-width: 60px; text-align: center; }
.dropdown-container { position: relative; overflow: visible; }
.popover-menu { position: absolute; bottom: 38px; left: 0; min-width: 180px; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 5px 15px rgba(0,0,0,0.15); padding: 4px 0; z-index: 400; animation: slideUp 0.1s ease-out; }
.menu-item { padding: 6px 16px; cursor: pointer; display: block; color: #333; font-size: 0.85rem; }
.menu-item:hover { background: #f0f0f0; }
.menu-item.danger { color: #d32f2f; }
.menu-backdrop { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 150; cursor: default; }
.mode-badge { background: #4caf50; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; }
.mode-badge.box { background: #2196f3; }
.color-palette-widget { display: flex; align-items: center; gap: 6px; margin-left: 6px; position: relative; overflow: visible !important; }
.color-pair { position: relative; width: 24px; height: 24px; cursor: pointer; }
.color-sq { position: absolute; width: 14px; height: 14px; border: 1px solid #999; box-shadow: 0 1px 2px rgba(0,0,0,0.2); cursor: pointer; padding: 0; z-index: 10; }
.color-sq.sub { bottom: 0; right: 0; z-index: 20; }
.color-sq.main { top: 0; left: 0; z-index: 21; }
.swap-mini-btn { background: transparent; border: none; cursor: pointer; padding: 0; color: #666; display: flex; align-items: center; justify-content: center; opacity: 0.7; width: 16px; height: 16px; }
.swap-mini-btn:hover { opacity: 1; color: #333; }
@keyframes slideUp { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
</style>