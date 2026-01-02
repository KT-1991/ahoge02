<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from 'vue';
import { useProjectSystem } from '../composables/useProjectSystem'; // ★追加: トースト通知用

const props = defineProps<{
  isVisible: boolean;
  aaContent: string;
  fontStack: string;
  defaultTextColor: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const project = useProjectSystem(); // ★使用開始

// Settings
const bgColorMode = ref<'white' | 'dark' | 'transparent'>('white');
const padding = ref(30);
const scale = ref(2); 
const textColorOverride = ref(props.defaultTextColor);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const previewContainerRef = ref<HTMLElement | null>(null);

const currentBgColor = computed(() => {
    if (bgColorMode.value === 'white') return '#ffffff';
    if (bgColorMode.value === 'dark') return '#222222';
    return 'transparent';
});
const currentTextColor = computed(() => {
    if (bgColorMode.value === 'dark' && textColorOverride.value === '#222222') return '#ffffff';
    return textColorOverride.value;
});

const drawPreview = () => {
    const canvas = canvasRef.value;
    if (!canvas || !props.aaContent) return;
    const ctx = canvas.getContext('2d')!;

    const fontSize = 16;
    const lineHeight = fontSize; 
    const lines = props.aaContent.split('\n');

    ctx.font = `${fontSize}px ${props.fontStack}`;
    let maxWidth = 0;
    for (const line of lines) {
        const metrics = ctx.measureText(line);
        maxWidth = Math.max(maxWidth, Math.ceil(metrics.width));
    }
    const textWidth = maxWidth || 100;
    const textHeight = lines.length * lineHeight || fontSize;

    const p = padding.value;
    const s = scale.value;
    const finalWidth = (textWidth + p * 2) * s;
    const finalHeight = (textHeight + p * 2) * s;

    canvas.width = finalWidth;
    canvas.height = finalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgColorMode.value !== 'transparent') {
        ctx.fillStyle = currentBgColor.value;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.scale(s, s);
    ctx.translate(p, p);
    ctx.font = `${fontSize}px ${props.fontStack}`;
    ctx.fillStyle = currentTextColor.value;
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = true; 
    ctx.imageSmoothingQuality = 'high';

    lines.forEach((line, i) => {
        ctx.fillText(line, 0, i * lineHeight + 2); 
    });

    if (previewContainerRef.value) {
        previewContainerRef.value.style.aspectRatio = `${finalWidth} / ${finalHeight}`;
    }
};

watch([() => props.isVisible, () => props.aaContent, bgColorMode, padding, scale, textColorOverride], () => {
    if (props.isVisible) nextTick(drawPreview);
});
onMounted(() => { if (props.isVisible) drawPreview(); });

const downloadImage = () => {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `aa_export_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    emit('close');
};

// ★追加: Xへのシェア機能
const shareToX = async () => {
    const canvas = canvasRef.value;
    if (!canvas) return;

    // 1. 画像BloBを生成
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    const file = new File([blob], 'aatelier_art.png', { type: 'image/png' });
    const shareText = "Created with AAtelier #AAtelier";
    const shareData = {
        files: [file],
        title: 'AAtelier Export',
        text: shareText
    };

    // 2. スマホ等のネイティブシェア (Web Share API Level 2) を試行
    if (navigator.canShare && navigator.canShare(shareData)) {
        try {
            await navigator.share(shareData);
            return; // 成功したら終了
        } catch (e) {
            // キャンセルされた場合などは何もしない
            if ((e as Error).name === 'AbortError') return;
            // 失敗した場合はフォールバックへ進む
        }
    }

    // 3. フォールバック: クリップボードコピー + Xを開く
    try {
        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);
        
        // 投稿画面を開く
        const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
        window.open(intentUrl, '_blank');
        
        // ユーザーに案内
        project.showToastMessage('Image Copied! Paste (Ctrl+V) it on X.');
    } catch (e) {
        console.error(e);
        alert('Could not copy image automatically. Please download it instead.');
    }
};
</script>

<template>
<div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window export-window">
        <div class="studio-header">
            <h2>📤 Export Image</h2>
            <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
        
        <div class="export-layout">
            <div class="preview-pane">
                <div class="canvas-container" ref="previewContainerRef" :class="{ transparent: bgColorMode === 'transparent' }">
                    <canvas ref="canvasRef" class="preview-canvas"></canvas>
                </div>
                <p class="preview-hint">Preview looks easier to read than actual output due to scaling.</p>
            </div>
            
            <div class="settings-pane">
                <div class="config-section">
                    <h3>Theme & Color</h3>
                    <div class="toggle-group">
                        <button :class="{ active: bgColorMode === 'white' }" @click="bgColorMode = 'white'; textColorOverride = defaultTextColor">⚪ White</button>
                        <button :class="{ active: bgColorMode === 'dark' }" @click="bgColorMode = 'dark'">⚫ Dark</button>
                        <button :class="{ active: bgColorMode === 'transparent' }" @click="bgColorMode = 'transparent'">▦ Trans</button>
                    </div>
                    <div class="control-row" style="margin-top:15px;">
                        <label>Text Color</label>
                        <input type="color" v-model="textColorOverride" class="color-input">
                    </div>
                </div>

                <div class="config-section">
                    <h3>Layout & Quality</h3>
                    <div class="control-group">
                        <label>Padding: <b>{{ padding }}px</b></label>
                        <input type="range" min="0" max="100" v-model.number="padding">
                    </div>
                    <div class="control-group">
                        <label>Scale: <b>{{ scale }}x</b></label>
                         <div class="toggle-group small">
                            <button :class="{ active: scale === 1 }" @click="scale = 1">1x</button>
                            <button :class="{ active: scale === 2 }" @click="scale = 2">2x</button>
                            <button :class="{ active: scale === 3 }" @click="scale = 3">3x</button>
                        </div>
                    </div>
                </div>

                <div class="export-actions">
                    <button class="studio-btn w-100 x-share-btn" @click="shareToX">
                        <span class="x-icon">𝕏</span> Share to X
                    </button>
                    
                    <button class="studio-btn primary large w-100" @click="downloadImage">
                        ⬇️ Download PNG
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
</template>

<style scoped>
.export-window { width: 850px; height: 600px; display: flex; flex-direction: column; }
.export-layout { flex: 1; display: flex; overflow: hidden; }
.preview-pane { flex: 2; background: #e0e0e0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; position: relative; }
.canvas-container {
    max-width: 100%; max-height: 100%;
    box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    border-radius: 4px; overflow: hidden;
}
.canvas-container.transparent {
    background-image: linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
.preview-canvas { width: 100%; height: 100%; object-fit: contain; display: block; }
.preview-hint { position: absolute; bottom: 5px; font-size: 0.75rem; color: #666; background: rgba(255,255,255,0.8); padding: 2px 6px; border-radius: 4px; }

.settings-pane { flex: 1; background: #fff; border-left: 1px solid #eee; padding: 20px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; }
h3 { font-size: 1rem; margin: 0 0 12px 0; color: #444; font-weight: bold; }
.config-section { padding-bottom: 20px; border-bottom: 1px solid #eee; }
.toggle-group { display: flex; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
.toggle-group button { flex: 1; border: none; background: #f5f5f5; padding: 8px; cursor: pointer; font-weight: 500; color: #555; transition: all 0.2s; border-right: 1px solid #ddd; }
.toggle-group button:last-child { border-right: none; }
.toggle-group button.active { background: var(--accent-primary); color: white; }
.toggle-group.small button { padding: 6px; font-size: 0.9rem; }
.control-row { display: flex; align-items: center; justify-content: space-between; }
.color-input { height: 32px; padding: 0; border: none; background: none; cursor: pointer; }
.export-actions { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
.studio-btn.large { padding: 12px; font-size: 1.1rem; font-weight: bold; }

/* ★追加: Xシェアボタンのスタイル */
.x-share-btn {
    background: #000; color: #fff;
    padding: 12px; font-size: 1rem; font-weight: bold;
    display: flex; align-items: center; justify-content: center; gap: 8px;
}
.x-share-btn:hover { background: #333; }
.x-icon { font-style: normal; font-size: 1.2rem; }
</style>