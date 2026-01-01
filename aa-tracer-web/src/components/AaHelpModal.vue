<script setup lang="ts">
defineProps<{ isVisible: boolean }>();
defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window help-window">
      <div class="studio-header">
        <h2>📚 Help & Shortcuts</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="help-content">
        
        <div class="help-section">
          <h3>🖌️ Flow Brush (Image Tab)</h3>
          <p>Draw lines on the canvas. When you release the mouse, AI converts your strokes into ASCII Art instantly.</p>
          <div class="key-combo">
            <span class="key">Drag</span> Draw Line
            <span class="sep">→</span>
            <span class="key">Release</span> Generate AA
          </div>
        </div>

        <div class="help-section">
          <h3>⌨️ Keyboard Shortcuts</h3>
          <div class="shortcut-list">
            <div class="row"><span class="keys"><span class="k">Ctrl</span>+<span class="k">Z</span></span> <span class="desc">Undo</span></div>
            <div class="row"><span class="keys"><span class="k">Ctrl</span>+<span class="k">Y</span></span> <span class="desc">Redo</span></div>
            <div class="row"><span class="keys"><span class="k">Alt</span>+<span class="k">Drag</span></span> <span class="desc">Box Selection (Trace Editor)</span></div>
            <div class="row"><span class="keys"><span class="k">Alt</span>+<span class="k">Arrow</span></span> <span class="desc">Nudge Cursor (微調整)</span></div>
            <div class="row"><span class="keys"><span class="k">Tab</span></span> <span class="desc">Insert Zenkaku Space / Accept Ghost</span></div>
            <div class="row"><span class="keys"><span class="k">Right Click</span></span> <span class="desc">Context Menu / AI Suggestion</span></div>
          </div>
        </div>

        <div class="help-section">
          <h3>✨ Tips</h3>
          <ul>
            <li><b>Safe Mode:</b> Use only standard characters visible on all devices.</li>
            <li><b>Trace Opacity:</b> Lower opacity to see your AA clearly over the image.</li>
            <li><b>Box Paste:</b> Use "Rect Paste" in Edit menu to paste AA blocks without breaking layout.</li>
          </ul>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.help-window { width: 600px; max-width: 90vw; height: auto; max-height: 85vh; display: flex; flex-direction: column; }
.help-content { padding: 20px; overflow-y: auto; text-align: left; }
.help-section { margin-bottom: 25px; }
.help-section h3 { margin: 0 0 10px 0; border-bottom: 2px solid #e6b086; display: inline-block; font-size: 1rem; color: #444; }
.help-section p { margin: 0 0 10px 0; font-size: 0.9rem; line-height: 1.5; color: #666; }
.help-section ul { margin: 0; padding-left: 20px; font-size: 0.9rem; color: #666; }
.help-section li { margin-bottom: 5px; }

.key-combo { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; color: #444; background: #f9f9f9; padding: 8px; border-radius: 4px; }
.shortcut-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.row { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
.keys { display: flex; align-items: center; gap: 2px; }
.k { background: #eee; border: 1px solid #ccc; border-radius: 3px; padding: 2px 6px; font-family: monospace; font-weight: bold; font-size: 0.8rem; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.desc { color: #666; }
.sep { color: #999; font-size: 0.8rem; }
</style>