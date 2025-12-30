import { ref, type Ref } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from '../utils/InferenceEngine';
import { FeatureExtractor } from '../utils/FeatureExtractor';

export function useAiGeneration() {
    // --- State ---
    const engine = new InferenceEngine();
    const status = ref('BOOTING...');
    const isReady = ref(false);
    const isProcessing = ref(false);
    
    // Config
    const customFontName = ref('Saitamaar');
    const config = ref({ 
        allowedChars: DEFAULT_CHARS, 
        useThinSpace: true, 
        safeMode: false,
        noiseGate: 0.3,
        generationMode: 'hybrid' as 'hybrid' | 'accurate' 
    });
    const allCharCandidates = ref<string[]>(Array.from(new Set(DEFAULT_CHARS.split(''))));

    // Params
    const lineWeight = ref(0.6);
    const targetCharBlue = ref(':');
    const targetCharRed = ref('/');

    const debugCanvasRef = ref<HTMLCanvasElement | null>(null);

    // --- Actions ---
    const initEngine = async () => {
        const checkCv = setInterval(async () => {
            if ((window as any).cvLoaded) {
                clearInterval(checkCv);
                status.value = 'LOADING AI...';
                try {
                    await engine.init('/aa_model_a.onnx', '/Saitamaar.ttf', '/aa_chars.json', 'classifier', 'Saitamaar');
                    engine.updateFontMetrics('Saitamaar', config.value.allowedChars);
                    const loadedChars = engine.getLoadedCharList();
                    if (loadedChars.length > 0) {
                        const newSet = ' ' + loadedChars;
                        config.value.allowedChars = newSet;
                        allCharCandidates.value = Array.from(loadedChars);
                    }
                    engine.updateAllowedChars(config.value.allowedChars);
                    status.value = 'READY';
                    isReady.value = true;
                } catch (e) {
                    status.value = 'ERROR';
                    console.error(e);
                }
            }
        }, 100);
    };

    const updateAllowedChars = () => {
        engine.updateAllowedChars(config.value.allowedChars);
    };

    const toggleAllowedChar = (char: string) => {
        let current = config.value.allowedChars;
        if (current.includes(char)) {
            config.value.allowedChars = current.replace(char, '');
        } else {
            config.value.allowedChars += char;
        }
        updateAllowedChars();
    };

    const visualizeFeatureMap = (features: Float32Array, width: number, height: number) => {
        if (!debugCanvasRef.value) return;
        const cvs = debugCanvasRef.value;
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext('2d')!;
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;
        let minVal = Infinity; let maxVal = -Infinity;
        for (let i = 0; i < features.length; i += 9) {
            const val = features[i]!;
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
        }
        if (maxVal === minVal) maxVal = minVal + 1;
        
        for (let i = 0; i < width * height; i++) {
            const val = features[i * 9]!; 
            const color = Math.floor((val - minVal) / (maxVal - minVal) * 255);
            const idx = i * 4;
            data[idx] = color; data[idx+1] = color; data[idx+2] = color; data[idx+3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
    };

    // --- Main Generation Loop ---
    const runGeneration = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        aaOutputRef: Ref<string>
    ) => {
        if (isProcessing.value) return;
        isProcessing.value = true; 
        status.value = 'PROCESSING...';
        
        engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

        // マスクレイヤーの準備 (paintBufferを変形して合わせる)
        let tempCtx: CanvasRenderingContext2D | null = null;
        if (paintBuffer) {
            const tempCvs = document.createElement('canvas');
            tempCvs.width = canvas.width; tempCvs.height = canvas.height;
            tempCtx = tempCvs.getContext('2d', { willReadFrequently: true })!;
            tempCtx.save();
            tempCtx.translate(imageTransform.x, imageTransform.y);
            tempCtx.rotate(imageTransform.rotation * Math.PI / 180);
            tempCtx.scale(imageTransform.scale, imageTransform.scale);
            tempCtx.drawImage(paintBuffer, 0, 0);
            tempCtx.restore();
        }

        setTimeout(async () => {
            try {
                const fullFeatures = FeatureExtractor.generate9ChInput(
                    canvas, 
                    lineWeight.value, 
                    0 // Thinningは画像側で処理済み
                );
                
                visualizeFeatureMap(fullFeatures, canvas.width, canvas.height);

                const w = canvas.width; const h = canvas.height;
                const cropH = 32;
                let result = "";
                // 画像がある範囲を推定してスキャン終了位置を決める
                const imgBottom = (imageTransform.y + 2000 * imageTransform.scale) + 200; // 簡易
                const scanLimitY = Math.min(h, imgBottom);

                const ctx = document.createElement('canvas').getContext('2d')!;
                ctx.font = `16px "${customFontName.value}"`;

                for (let y = cropH / 2; y < scanLimitY - cropH / 2; y += 16) {
                    status.value = `ROW ${Math.floor(y/16)}`;
                    
                    const startIdx = (y - cropH/2) * w * 9;
                    const lineFeat = fullFeatures.subarray(startIdx, startIdx + cropH * w * 9);
                    
                    let rowMaskData: Uint8ClampedArray | null = null;
                    if (tempCtx) {
                        const srcY = Math.floor(y - cropH/2);
                        if (srcY >= 0 && srcY + 32 <= h) {
                            rowMaskData = tempCtx.getImageData(0, srcY, w, 32).data;
                        }
                    }
                    
                    const lineText = await engine.solveLine(
                        lineFeat, w, 
                        targetCharBlue.value, targetCharRed.value, 
                        rowMaskData, y,
                        config.value.generationMode,
                        ctx
                    );
                    
                    result += lineText + "\n";
                    aaOutputRef.value = result;
                    await new Promise(r => setTimeout(r, 0));
                }
                status.value = 'DONE';
            } catch (err) { console.error(err); status.value = 'ERROR'; } 
            finally { isProcessing.value = false; }
        }, 50);
    };
    
    // Ghost Suggestion
    const getSuggestion = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number
    ): Promise<string> => {
        const rowCanvas = document.createElement('canvas');
        rowCanvas.width = canvas.width; rowCanvas.height = 32;
        const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
        const srcY = Math.max(0, lineY - 8);
        const dstY = (lineY - 8 < 0) ? (8 - lineY) : 0;
        rowCtx.drawImage(canvas, 0, srcY, canvas.width, 32, 0, dstY, canvas.width, 32);

        const features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, 0);

        let rowMaskData: Uint8ClampedArray | null = null;
        if (paintBuffer) {
            const maskCvs = document.createElement('canvas');
            maskCvs.width = canvas.width; maskCvs.height = 32;
            const mCtx = maskCvs.getContext('2d', { willReadFrequently: true })!;
            mCtx.save();
            mCtx.translate(imageTransform.x, imageTransform.y - srcY);
            mCtx.rotate(imageTransform.rotation * Math.PI / 180);
            mCtx.scale(imageTransform.scale, imageTransform.scale);
            mCtx.drawImage(paintBuffer, 0, 0);
            mCtx.restore();
            rowMaskData = mCtx.getImageData(0, 0, maskCvs.width, 32).data;
        }

        return await engine.suggestText(
            features, rowCanvas.width, caretPixelX, 
            rowMaskData, targetCharBlue.value, targetCharRed.value, 3
        );
    };

    const rebuildDb = async (fontUrl: string | null, fontName: string | null) => {
        status.value = 'OPTIMIZING AI...'; await new Promise(r => setTimeout(r, 10));
        try {
            const fUrl = fontUrl || '/Saitamaar.ttf'; 
            const fName = fontName || 'Saitamaar';
            await engine.init('/aa_model_a.onnx', fUrl, '/aa_chars.json', 'classifier', fName);
            engine.updateAllowedChars(config.value.allowedChars);
            customFontName.value = fName; 
            status.value = `DB UPDATED`;
        } catch(err) { console.error(err); status.value = 'DB ERROR'; }
    };

    return {
        engine,
        status,
        isReady,
        isProcessing,
        config,
        allCharCandidates,
        customFontName,
        lineWeight,
        targetCharBlue,
        targetCharRed,
        debugCanvasRef,
        initEngine,
        toggleAllowedChar,
        updateAllowedChars,
        runGeneration,
        getSuggestion,
        rebuildDb
    };
}