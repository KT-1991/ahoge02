<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from 'vue';

const props = defineProps<{
  isVisible: boolean;
  aaContent: string;
  fontStack: string;
  defaultTextColor: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// Settings
const bgColorMode = ref<'white' | 'dark' | 'transparent'>('white');
const padding = ref(30);
const scale = ref(2); // Default to 2x retina
const textColorOverride = ref(props.defaultTextColor);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const previewContainerRef = ref<HTMLElement | null>(null);

// Computed theme colors
const currentBgColor = computed(() => {
    if (bgColorMode.value === 'white') return '#ffffff';
    if (bgColorMode.value === 'dark') return '#222222';
    return 'transparent';
});
const currentTextColor = computed(() => {
    if (bgColorMode.value === 'dark' && textColorOverride.value === '#222222') return '#ffffff';
    return textColorOverride.value;
});

// Draw function
const drawPreview = () => {
    const canvas = canvasRef.value;
    if (!canvas || !props.aaContent) return;
    const ctx = canvas.getContext('2d')!;

    const fontSize = 16;
    const lineHeight = fontSize; // AAは行間を詰めるのが基本
    const lines = props.aaContent.split('\n');

    // 1. Measure text size
    ctx.font = `${fontSize}px ${props.fontStack}`;
    let maxWidth = 0;
    for (const line of lines) {
        const metrics = ctx.measureText(line);
        // 実際の描画幅をより正確に取るため、少しバッファを持たせる
        maxWidth = Math.max(maxWidth, Math.ceil(metrics.width));
    }
    const textWidth = maxWidth || 100;
    const textHeight = lines.length * lineHeight || fontSize;

    // 2. Calculate canvas size with padding and scale
    const p = padding.value;
    const s = scale.value;
    const finalWidth = (textWidth + p * 2) * s;
    const finalHeight = (textHeight + p * 2) * s;

    canvas.width = finalWidth;
    canvas.height = finalHeight;

    // 3. Draw Background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgColorMode.value !== 'transparent') {
        ctx.fillStyle = currentBgColor.value;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 4. Draw Text
    ctx.scale(s, s);
    ctx.translate(p, p);
    ctx.font = `${fontSize}px ${props.fontStack}`;
    ctx.fillStyle = currentTextColor.value;
    ctx.textBaseline = 'top';
    // アンチエイリアスを効かせる
    ctx.imageSmoothingEnabled = true; 
    ctx.imageSmoothingQuality = 'high';

    lines.forEach((line, i) => {
        // 上下に少しずれるフォントの特性を吸収するための微調整 (例: +2px)
        ctx.fillText(line, 0, i * lineHeight + 2); 
    });

    // Update preview container size for fitting
    if (previewContainerRef.value) {
        previewContainerRef.value.style.aspectRatio = `${finalWidth} / ${finalHeight}`;
    }
};

// Watchers to trigger redraw
watch([() => props.isVisible, () => props.aaContent, bgColorMode, padding, scale, textColorOverride], () => {
    if (props.isVisible) nextTick(drawPreview);
});
onMounted(() => { if (props.isVisible) drawPreview(); });

const downloadImage = () => {
    const canvas = canvasRef.value;
    if (!canvas) return;
    
    // Create download link
    const link = document.createElement('a');
    link.download = `aa_export_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    emit('close');
};
</script>

<template>
<div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window export-window">
        <div class="studio-header">
            <h2>📤 Export Image for SNS</h2>
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
                        <button :class="{ active: bgColorMode === 'white' }" @click="bgColorMode = 'white'; textColorOverride = defaultTextColor">⚪ White BG</button>
                        <button :class="{ active: bgColorMode === 'dark' }" @click="bgColorMode = 'dark'">⚫ Dark BG</button>
                        <button :class="{ active: bgColorMode === 'transparent' }" @click="bgColorMode = 'transparent'">▦ Transparent</button>
                    </div>
                    <div class="control-row" style="margin-top:15px;">
                        <label>Text Color (Override)</label>
                        <input type="color" v-model="textColorOverride" class="color-input">
                    </div>
                </div>

                <div class="config-section">
                    <h3>Layout & Quality</h3>
                    <div class="control-group">
                        <label>Padding (Margin): <b>{{ padding }}px</b></label>
                        <input type="range" min="0" max="100" v-model.number="padding">
                    </div>
                    <div class="control-group">
                        <label>Scale (Resolution): <b>{{ scale }}x</b></label>
                         <div class="toggle-group small">
                            <button :class="{ active: scale === 1 }" @click="scale = 1">1x</button>
                            <button :class="{ active: scale === 2 }" @click="scale = 2">2x (Retina)</button>
                            <button :class="{ active: scale === 3 }" @click="scale = 3">3x (High)</button>
                        </div>
                        <p class="config-desc">Higher scale is better for modern smartphones.</p>
                    </div>
                </div>

                <div class="export-actions">
                    <button class="studio-btn primary large w-100" @click="downloadImage">
                        ⬇️ Download PNG Image
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
    /* 透過背景時の市松模様 */
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
.export-actions { margin-top: auto; }
.studio-btn.large { padding: 12px; font-size: 1.1rem; font-weight: bold; }
</style>