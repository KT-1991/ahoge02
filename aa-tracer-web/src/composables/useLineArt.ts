import { ref } from 'vue';
import { LineArtProcessor } from '../utils/LineArtProcessor';

declare const cv: any;

export function useLineArt() {
    // --- State ---
    const lineArtProcessor = new LineArtProcessor();
    const rawLineArtCanvas = ref<HTMLCanvasElement | null>(null); // AIの生出力
    const processedSource = ref<HTMLCanvasElement | null>(null);  // 最終的な加工済み画像
    
    // Settings
    const lineArtSettings = ref({
        threshold: 128,  // 2値化しきい値
        thickness: 0,    // 太さ (-1:細く, 0:そのまま, 1:太く)
        opacity: 100
    });
    const thinningLevel = ref(0);

    // ★追加: 分割ファイルを結合してURLを生成する関数
    async function loadSplitModel(baseUrl: string, partCount: number): Promise<string> {
        //const buffers: ArrayBuffer[] = [];
        
        // 1. 全パートを並列ダウンロード
        const promises = [];
        for (let i = 0; i < partCount; i++) {
            const url = `${baseUrl}.part${i}`;
            promises.push(fetch(url).then(res => res.arrayBuffer()));
        }
        
        const chunks = await Promise.all(promises);
        
        // 2. 合計サイズを計算
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
        
        // 3. 結合用の大きなバッファを作成
        const combinedBuffer = new Uint8Array(totalLength);
        
        // 4. データを書き込む
        let offset = 0;
        for (const chunk of chunks) {
            combinedBuffer.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        
        // 5. Blobを作成し、そのURLを返す
        // ONNX Runtime Web は URL 文字列を受け取れる
        const blob = new Blob([combinedBuffer], { type: 'application/octet-stream' });
        return URL.createObjectURL(blob);
    }



    // --- Actions ---
    
    // 1. AIによる線画抽出 (anime2sketch)
    const extractLineArt = async (sourceImage: HTMLImageElement) => {
        try {
            const modelUrl = await loadSplitModel('/anime2sketch.onnx', 5);
            console.log(modelUrl)
            await lineArtProcessor.init(modelUrl); 
            //await lineArtProcessor.init('anime2sketch.onnx'); 
            const result = await lineArtProcessor.process(sourceImage);
            rawLineArtCanvas.value = result;
            
            // 設定を初期値にリセット
            lineArtSettings.value = { threshold: 200, thickness: 0, opacity: 100 };
            
            // 適用してプロセスチェーンを回す
            applyLineArtSettings(sourceImage);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };


    // 2. 線の太さ調整 (OpenCV Erode/Dilate)
    const applyLineArtSettings = (sourceImage: HTMLImageElement | null) => {
        if (!rawLineArtCanvas.value) return;

        const w = rawLineArtCanvas.value.width;
        const h = rawLineArtCanvas.value.height;
        
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(rawLineArtCanvas.value, 0, 0);
        
        const src = cv.imread(canvas);
        const dst = new cv.Mat();
        
        // グレースケール & 2値化
        cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
        cv.threshold(src, dst, lineArtSettings.value.threshold, 255, cv.THRESH_BINARY);
        
        // 太さ調整
        const t = lineArtSettings.value.thickness;
        if (t !== 0) {
            const kSize = Math.abs(t) * 2 + 1;
            const M = cv.Mat.ones(kSize, kSize, cv.CV_8U);
            const anchor = new cv.Point(-1, -1);
            if (t > 0) cv.erode(dst, dst, M, anchor, 1); // 太く (黒を広げる)
            else cv.dilate(dst, dst, M, anchor, 1);      // 細く (白を広げる)
            M.delete();
        }

        cv.imshow(canvas, dst);
        src.delete(); dst.delete();
        
        // 次の工程（細線化）へ渡す
        processSourceImage(canvas, sourceImage);
    };

    // 3. 最終プロセス（ThinningとSourceの決定）
    // inputCanvasがあればそれを加工、なければ sourceImage or rawLineArt を使う
    const processSourceImage = (
        inputCanvas: HTMLCanvasElement | null, 
        sourceImage: HTMLImageElement | null
    ) => {
        let source: HTMLImageElement | HTMLCanvasElement | null = inputCanvas;
        
        if (!source) {
            if (rawLineArtCanvas.value) source = rawLineArtCanvas.value;
            else source = sourceImage;
        }
        
        if (!source) return;

        const w = source.width;
        const h = source.height;

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        
        ctx.drawImage(source, 0, 0);

        if (thinningLevel.value === 0) {
            processedSource.value = canvas;
            return;
        }

        // OpenCVによる細線化 (Dilateで黒線を削る)
        const src = cv.imread(canvas);
        const dst = new cv.Mat();

        if (src.channels() > 1) cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
        cv.threshold(src, src, 200, 255, cv.THRESH_BINARY);
        
        const M = cv.Mat.ones(3, 3, cv.CV_8U);
        const anchor = new cv.Point(-1, -1);
        
        cv.dilate(src, dst, M, anchor, thinningLevel.value, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

        cv.imshow(canvas, dst);
        processedSource.value = canvas;

        src.delete(); dst.delete(); M.delete();
    };

    return {
        lineArtProcessor,
        rawLineArtCanvas,
        processedSource,
        lineArtSettings,
        thinningLevel,
        extractLineArt,
        applyLineArtSettings,
        processSourceImage
    };
}