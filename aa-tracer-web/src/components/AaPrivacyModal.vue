<script setup lang="ts">
import { useI18n } from '../composables/useI18n'; // ★追加

defineProps<{ isVisible: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n(); // ★追加
</script>

<template>
  <div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window privacy-window">
      <div class="studio-header">
        <h2>{{ t('priv_title') }}</h2> <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="content">
        <h3>{{ t('priv_sec1_title') }}</h3> <p v-html="t('priv_sec1_desc')"></p>
        
        <h3>{{ t('priv_sec2_title') }}</h3> <p v-html="t('priv_sec2_desc')"></p>
        
        <h3>{{ t('priv_sec3_title') }}</h3> <p v-html="t('priv_sec3_desc')"></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.privacy-window { width: 600px; max-width: 95vw; }
.content { padding: 25px; line-height: 1.7; color: #555; font-size: 0.95rem; }
h3 { margin-top: 20px; margin-bottom: 8px; color: #333; font-size: 1rem; border-left: 4px solid var(--accent-primary); padding-left: 10px; }
h3:first-child { margin-top: 0; }
p { margin-bottom: 15px; }
</style>