<script setup lang="ts">
defineProps<{ isVisible: boolean }>();
defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window privacy-window">
      <div class="studio-header">
        <h2>🔒 Privacy Policy</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      <div class="content">
        <h3>1. アクセス解析について</h3>
        <p>当サイトでは、サービスの向上のために <b>Google Analytics</b> を使用しています。これらは匿名で収集され、個人を特定するものではありません。</p>
        
        <h3>2. データの保存について</h3>
        <p>作成中のAAや設定データは、お使いのブラウザの <b>Local Storage</b> に保存されます。これらが外部のサーバーに送信されることはありません。</p>
        
        <h3>3. 画像処理について</h3>
        <p>画像の読み込みやAIによる変換処理は、すべて <b>お客様のブラウザ内 (クライアントサイド)</b> で行われます。画像データが開発者のサーバー等にアップロードされることは一切ありませんので、安心してご利用ください。</p>
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