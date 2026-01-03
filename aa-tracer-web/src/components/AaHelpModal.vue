<script setup lang="ts">
import { useI18n } from '../composables/useI18n'; // ★追加

defineProps<{ isVisible: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n(); // ★追加
</script>

<template>
  <div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window help-window">
      <div class="studio-header">
        <h2>{{ t('help_title') }}</h2> <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="help-content">
        
        <div class="help-section">
          <h3>{{ t('help_flow_title') }}</h3> <p>{{ t('help_flow_desc') }}</p>     <div class="key-combo">
            <span class="key">{{ t('help_action_drag') }}</span> {{ t('help_action_draw') }}
            <span class="sep">→</span>
            <span class="key">{{ t('help_action_release') }}</span> {{ t('help_action_gen') }}
          </div>
        </div>

        <div class="help-section">
          <h3>{{ t('help_kb_title') }}</h3> <div class="shortcut-list">
            <div class="row"><span class="keys"><span class="k">Ctrl</span>+<span class="k">Z</span></span> <span class="desc">{{ t('edit_undo') }}</span></div>
            <div class="row"><span class="keys"><span class="k">Ctrl</span>+<span class="k">Y</span></span> <span class="desc">{{ t('edit_redo') }}</span></div>
            <div class="row"><span class="keys"><span class="k">Alt</span>+<span class="k">Drag</span></span> <span class="desc">{{ t('help_kb_box') }}</span></div>
            <div class="row"><span class="keys"><span class="k">Alt</span>+<span class="k">Arrow</span></span> <span class="desc">{{ t('help_kb_nudge') }}</span></div>
            <div class="row"><span class="keys"><span class="k">Tab</span></span> <span class="desc">{{ t('help_kb_tab') }}</span></div>
            <div class="row"><span class="keys"><span class="k">Right Click</span></span> <span class="desc">{{ t('help_kb_ctx') }}</span></div>
          </div>
        </div>

        <div class="help-section">
          <h3>{{ t('help_tips_title') }}</h3> <ul>
            <li v-html="t('help_tips_safe')"></li>
            <li v-html="t('help_tips_opacity')"></li>
            <li v-html="t('help_tips_box')"></li>
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