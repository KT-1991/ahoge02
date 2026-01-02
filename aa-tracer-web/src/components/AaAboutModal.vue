<script setup lang="ts">


defineProps<{ isVisible: boolean }>();
defineEmits<{ (e: 'close'): void }>();

const appVersion = "v1.0.0"; // 将来的にpackage.jsonから読むことも可能
</script>

<template>
  <div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window about-window">
      <div class="studio-header">
        <h2>ℹ️ About AAtelier</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>
      
      <div class="about-content">
        <div class="logo-section">
            <div class="app-icon">
                <span class="icon-text">AA</span>
            </div>
            <h1 class="app-name">AAtelier</h1>
            <p class="app-version">Version {{ appVersion }}</p>
        </div>

        <div class="desc-section">
            <p>
                AAtelier (アートリエ) は、AIを搭載した次世代のアスキーアートエディタです。<br>
                画像をなぞるだけで、誰でも簡単に職人技のようなAAを作成できます。
            </p>
        </div>

        <div class="links-section">
            <a href="https://github.com/あなたのID/リポジトリ名" target="_blank" class="link-card">
                <span class="icon">📦</span>
                <div class="link-info">
                    <span class="link-title">GitHub Repository</span>
                    <span class="link-desc">Source code & Issues</span>
                </div>
            </a>
            
            <a href="https://twitter.com/あなたのID" target="_blank" class="link-card">
                <span class="icon">🐦</span>
                <div class="link-info">
                    <span class="link-title">Developer's X</span>
                    <span class="link-desc">Follow for updates</span>
                </div>
            </a>
        </div>

        <div class="credits-section">
            <h3>Powered by</h3>
            <div class="tech-tags">
                <span class="tag">Vue 3</span>
                <span class="tag">TypeScript</span>
                <span class="tag">ONNX Runtime</span>
                <span class="tag">OpenCV.js</span>
            </div>
        </div>

        <div class="footer-section">
            &copy; 2026 AAtelier Project. All rights reserved.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-window { width: 450px; max-width: 90vw; }
.about-content { padding: 30px 20px; text-align: center; display: flex; flex-direction: column; gap: 20px; }

.logo-section { display: flex; flex-direction: column; align-items: center; }
.app-icon { 
    width: 64px; height: 64px; background: var(--accent-primary); border-radius: 16px; 
    display: flex; align-items: center; justify-content: center; margin-bottom: 10px;
    box-shadow: 0 4px 10px rgba(230, 176, 134, 0.4);
}
.icon-text { color: white; font-weight: bold; font-size: 1.5rem; font-family: monospace; }
.app-name { margin: 0; font-size: 1.5rem; color: #444; letter-spacing: 1px; }
.app-version { margin: 0; color: #999; font-size: 0.85rem; }

.desc-section p { font-size: 0.9rem; color: #666; line-height: 1.6; margin: 0; }

.links-section { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
.link-card { 
    display: flex; align-items: center; gap: 10px; padding: 10px; 
    background: #f9f9f9; border: 1px solid #eee; border-radius: 8px; 
    text-decoration: none; color: #444; transition: all 0.2s; text-align: left;
}
.link-card:hover { transform: translateY(-2px); border-color: var(--accent-primary); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
.link-card .icon { font-size: 1.5rem; }
.link-info { display: flex; flex-direction: column; }
.link-title { font-size: 0.85rem; font-weight: bold; }
.link-desc { font-size: 0.7rem; color: #999; }

.credits-section h3 { font-size: 0.8rem; color: #aaa; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 1px; }
.tech-tags { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.tag { font-size: 0.75rem; padding: 4px 8px; background: #eee; border-radius: 12px; color: #666; }

.footer-section { font-size: 0.75rem; color: #ccc; margin-top: 10px; }
</style>