<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick, computed } from 'vue';

const props = defineProps<{
  isVisible: boolean;
  historyStack: string[];
  fontStack: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

// --- Playback State ---
const currentIndex = ref(0);
const isPlaying = ref(false);
const playbackSpeed = ref(50); // ms per frame (録画時のFPSにも影響)
let timer: number | null = null;

// --- Export State ---
const isExporting = ref(false);
const exportProgress = ref(0);
const hiddenCanvasRef = ref<HTMLCanvasElement | null>(null);

// --- Computed ---
const displayContent = computed(() => {
    if (!props.historyStack || props.historyStack.length === 0) return '';
    return props.historyStack[currentIndex.value];
});

const progress = computed(() => {
    if (props.historyStack.length <= 1) return 100;
    return (currentIndex.value / (props.historyStack.length - 1)) * 100;
});

// --- Playback Logic ---
const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
    isPlaying.value = false;
};

const play = () => {
    if (timer) clearInterval(timer);
    isPlaying.value = true;
    
    if (currentIndex.value >= props.historyStack.length - 1) {
        currentIndex.value = 0;
    }

    timer = window.setInterval(() => {
        if (currentIndex.value < props.historyStack.length - 1) {
            currentIndex.value++;
            scrollToBottom();
        } else {
            stop();
        }
    }, playbackSpeed.value);
};

const togglePlay = () => {
    if (isPlaying.value) stop();
    else play();
};

const onSeek = (e: Event) => {
    const val = +(e.target as HTMLInputElement).value;
    currentIndex.value = val;
    if (isPlaying.value) play(); 
};

// --- UI Helper ---
const textAreaRef = ref<HTMLTextAreaElement | null>(null);
const scrollToBottom = () => {
    nextTick(() => {
        if (textAreaRef.value) {
            textAreaRef.value.scrollTop = textAreaRef.value.scrollHeight;
        }
    });
};

watch(() => props.isVisible, (val) => {
    if (val) {
        currentIndex.value = 0;
        stop();
        // 自動再生したい場合はここで play()
    } else {
        stop();
    }
});

onUnmounted(() => stop());

// --- ★追加: Video Export Logic ---

// テキストを描画する関数 (Canvas操作)
const drawFrameToCanvas = (ctx: CanvasRenderingContext2D, text: string, width: number, height: number) => {
    // 背景 (白)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // テキスト設定
    ctx.font = `16px ${props.fontStack}`;
    ctx.fillStyle = '#222222';
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = false; // ドット絵らしさを維持

    const lines = text.split('\n');
    const lineHeight = 16;
    const padding = 20;

    lines.forEach((line, i) => {
        ctx.fillText(line, padding, padding + (i * lineHeight));
    });
};

// 動画生成のメイン関数
const downloadVideo = async () => {
    if (isExporting.value || !hiddenCanvasRef.value) return;
    
    // 再生中なら止める
    stop();
    isExporting.value = true;
    exportProgress.value = 0;

    try {
        const canvas = hiddenCanvasRef.value;
        const ctx = canvas.getContext('2d')!;
        
        // 1. 全履歴を走査して、Canvasサイズを決定 (最大サイズに合わせる)
        // ※毎回サイズを変えると動画がおかしくなるため、最大サイズで固定
        ctx.font = `16px ${props.fontStack}`;
        let maxW = 0;
        let maxLines = 0;
        
        // パフォーマンスのため、最初・中間・最後・および100ステップごとのサンプリングでサイズを推定
        // (全件走査は重すぎる場合があるが、正確さを期すなら全件推奨)
        for (const text of props.historyStack) {
            const lines = text.split('\n');
            maxLines = Math.max(maxLines, lines.length);
            for (const line of lines) {
                const w = ctx.measureText(line).width;
                if (w > maxW) maxW = w;
            }
        }

        const padding = 20;
        const width = Math.ceil(maxW + padding * 2);
        const height = Math.ceil((maxLines * 16) + padding * 2);
        
        // 偶数サイズに補正 (エンコーダ対策)
        canvas.width = width % 2 === 0 ? width : width + 1;
        canvas.height = height % 2 === 0 ? height : height + 1;

        // 2. MediaRecorderの準備
        // 30fpsのストリームを作成
        const stream = canvas.captureStream(30); 
        const recorder = new MediaRecorder(stream, { 
            mimeType: 'video/webm; codecs=vp9' // Chrome/Firefox向け
        });
        
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        
        recorder.start();

        // 3. フレーム描画ループ
        // playbackSpeed に応じたフレームレートで書き込むのは難しいので、
        // ここでは「一定間隔で描画して録画する」アプローチを取ります。
        // "書き出し" なので、リアルタイム再生より速く処理してOKですが、
        // MediaRecorderは「実時間」を録画するため、一定のウェイトが必要です。
        
        // 高速書き出しのために、描画間隔を少し詰めます (例: 20ms = 50fps相当)
        const frameInterval = 20; 
        
        for (let i = 0; i < props.historyStack.length; i++) {
            drawFrameToCanvas(ctx, props.historyStack[i]!, canvas.width, canvas.height);
            exportProgress.value = Math.round((i / props.historyStack.length) * 100);
            
            // MediaRecorderにフレームを認識させるため待機
            await new Promise(r => setTimeout(r, frameInterval));
        }

        // 4. 終了処理
        recorder.stop();
        
        // stopイベントを待つ
        await new Promise<void>(resolve => {
            recorder.onstop = () => resolve();
        });

        // ダウンロード
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aa_timelapse_${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error(e);
        alert('Video export failed. Browser may not support WebM recording.');
    } finally {
        isExporting.value = false;
        exportProgress.value = 0;
    }
};
</script>

<template>
<div class="modal-backdrop" v-if="isVisible" @click.self="$emit('close')">
    <div class="modal-window timelapse-window">
        <div class="studio-header">
            <h2>⏱️ Timelapse Replay ({{ currentIndex + 1 }} / {{ historyStack.length }})</h2>
            <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
        
        <div class="timelapse-screen">
            <textarea ref="textAreaRef" class="preview-area" readonly :value="displayContent" :style="{ fontFamily: fontStack }"></textarea>
            
            <div v-if="isExporting" class="export-overlay">
                <div class="spinner"></div>
                <p>Rendering Video... {{ exportProgress }}%</p>
                <p class="sub-text">Do not close window</p>
            </div>
        </div>

        <canvas ref="hiddenCanvasRef" style="display: none;"></canvas>

        <div class="timelapse-controls">
            <div class="progress-container">
                <input type="range" class="seek-slider" min="0" :max="historyStack.length - 1" :value="currentIndex" @input="onSeek" :disabled="isExporting">
                <div class="progress-track" :style="{ width: progress + '%' }"></div>
            </div>

            <div class="control-row">
                <div class="left-controls">
                    <button class="control-btn" @click="togglePlay" :disabled="isExporting">
                        {{ isPlaying ? '⏸ Pause' : '▶ Play' }}
                    </button>
                    <button class="control-btn icon" @click="currentIndex = 0; stop()" title="Rewind" :disabled="isExporting">⏮</button>
                </div>

                <div class="right-controls">
                    <div class="speed-control">
                        <span>Speed:</span>
                        <select v-model.number="playbackSpeed" @change="isPlaying && play()" :disabled="isExporting">
                            <option :value="200">0.5x</option>
                            <option :value="100">1.0x</option>
                            <option :value="50">2.0x</option>
                            <option :value="20">5.0x</option>
                            <option :value="10">Max</option>
                        </select>
                    </div>
                    <button class="control-btn primary" @click="downloadVideo" :disabled="isExporting" title="Save as .webm">
                        💾 Save Video
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>
</template>

<style scoped>
.timelapse-window { width: 800px; height: 600px; display: flex; flex-direction: column; background: #222; color: #eee; border-radius: 8px; overflow: hidden; }
.timelapse-screen { flex: 1; position: relative; background: #fff; overflow: hidden; margin: 10px; border-radius: 4px; }
.preview-area { 
    width: 100%; height: 100%; border: none; resize: none; outline: none; 
    font-size: 16px; line-height: 16px; padding: 20px; 
    color: #222; background: #fff; white-space: pre;
}

.timelapse-controls { padding: 15px 20px; background: #333; display: flex; flex-direction: column; gap: 10px; }

.progress-container { position: relative; width: 100%; height: 6px; background: #555; border-radius: 3px; cursor: pointer; }
.seek-slider { 
    position: absolute; top: -5px; left: 0; width: 100%; height: 16px; 
    opacity: 0; cursor: pointer; z-index: 10; margin: 0;
}
.progress-track { height: 100%; background: #e6b086; border-radius: 3px; pointer-events: none; transition: width 0.1s linear; }

.control-row { display: flex; justify-content: space-between; align-items: center; margin-top: 5px; }
.left-controls, .right-controls { display: flex; gap: 10px; align-items: center; }

.control-btn { 
    background: #444; color: #fff; border: 1px solid #555; 
    padding: 6px 16px; border-radius: 4px; font-weight: bold; font-size: 0.9rem;
    transition: 0.2s;
}
.control-btn:hover:not(:disabled) { background: #555; border-color: #777; }
.control-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.control-btn.icon { padding: 6px 10px; }
.control-btn.primary { background: #e6b086; border-color: #e6b086; color: #fff; }
.control-btn.primary:hover:not(:disabled) { background: #dba070; }

.speed-control { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #ccc; }
.speed-control select { 
    background: #444; color: #fff; border: 1px solid #555; 
    padding: 4px; border-radius: 4px; cursor: pointer; 
}

/* 録画中オーバーレイ */
.export-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: white; font-weight: bold; z-index: 20;
}
.sub-text { font-size: 0.8rem; color: #ccc; font-weight: normal; margin-top: 5px; }
.spinner {
    width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.2);
    border-top-color: #e6b086; border-radius: 50%;
    animation: spin 1s linear infinite; margin-bottom: 15px;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>