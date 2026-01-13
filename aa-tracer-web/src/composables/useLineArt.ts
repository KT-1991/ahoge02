import { ref } from 'vue';
import { LineArtProcessor } from '../utils/LineArtProcessor';
import { _unused } from '../utils/common';

declare const cv: any;

export function useLineArt() {
    // --- State ---
    const lineArtProcessor = new LineArtProcessor();
    const rawLineArtCanvas = ref<HTMLCanvasElement | null>(null);
    const processedSource = ref<HTMLCanvasElement | null>(null);
    
    // ★追加: 線画抽出中フラグ
    const isExtracting = ref(false);
    
    // Settings
    const lineArtSettings = ref({
        threshold: 200,
        thickness: 0,
        opacity: 100
    });
    const thinningLevel = ref(0);

    // --- Actions ---
    
    // 1. AIによる線画抽出 (anime2sketch)
    const extractLineArt = async (sourceImage: HTMLImageElement) => {
        if (isExtracting.value) return; // 二重実行防止
        
        isExtracting.value = true; // ★開始
        try {
            await lineArtProcessor.init(); 
            const result = await lineArtProcessor.process(sourceImage);
            rawLineArtCanvas.value = result;
            
            // 設定を初期値にリセットして適用
            lineArtSettings.value = { threshold: 200, thickness: 0, opacity: 100 };
            applyLineArtSettings(sourceImage);
            
        } catch (e) {
            console.error('Line art extraction failed:', e);
            alert('Failed to extract line art.');
        } finally {
            isExtracting.value = false; // ★終了
        }
    };

    // 2. パラメータ調整 (OpenCV)
    const applyLineArtSettings = (sourceImage: HTMLImageElement) => {
        _unused(sourceImage);
        if (!rawLineArtCanvas.value) {
            processedSource.value = null;
            return;
        }

        const src = cv.imread(rawLineArtCanvas.value);
        const dst = new cv.Mat();

        // グレースケール & 2値化
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
        
        // Threshold (2値化)
        // 反転させて処理しやすくする (線=白, 背景=黒)
        cv.threshold(dst, dst, lineArtSettings.value.threshold, 255, cv.THRESH_BINARY_INV);

        // Thickness (膨張・収縮)
        const kSize = 3;
        const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kSize, kSize));
        
        if (lineArtSettings.value.thickness > 0) {
            // 太くする (Dilate)
            cv.dilate(dst, dst, kernel, new cv.Point(-1, -1), lineArtSettings.value.thickness);
        } else if (lineArtSettings.value.thickness < 0) {
            // 細くする (Erode)
            cv.erode(dst, dst, kernel, new cv.Point(-1, -1), Math.abs(lineArtSettings.value.thickness));
        }
        
        // 反転を戻す (線=黒, 背景=白)
        cv.bitwise_not(dst, dst);

        // アルファチャンネル追加してCanvasへ
        // (省略: 表示用にprocessedSourceへ書き出し)
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = rawLineArtCanvas.value.width;
        outputCanvas.height = rawLineArtCanvas.value.height;
        cv.imshow(outputCanvas, dst);
        processedSource.value = outputCanvas;

        src.delete(); dst.delete(); kernel.delete();
    };

    // 3. 背景透過処理 (Thinningも含む最終出力)
    const processSourceImage = (
        inputCanvas: HTMLCanvasElement | null, 
        sourceImage: HTMLImageElement
    ) => {
        let source: any = inputCanvas;
        
        if (!source) {
            if (rawLineArtCanvas.value) source = processedSource.value || rawLineArtCanvas.value;
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

        // OpenCVによる細線化
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
        rawLineArtCanvas, processedSource, lineArtSettings, thinningLevel, isExtracting, // ★isExtractingを追加
        extractLineArt, applyLineArtSettings, processSourceImage
    };
}