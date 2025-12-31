import { ref, type Ref } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from '../utils/InferenceEngine';
import { FeatureExtractor } from '../utils/FeatureExtractor';

export function useAiGeneration() {
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
    const lineWeight = ref(0.6); // Classifier用の太さ設定 (コード1では0.6)
    
    // 文字セット管理
    const charSetMode = ref<'all' | 'simple'>('all');

    const targetCharBlue = ref(':');
    const targetCharRed = ref('/');
    const debugCanvasRef = ref<HTMLCanvasElement | null>(null);

    const applyCharSetMode = () => {
        if (charSetMode.value === 'all') {
            config.value.allowedChars = allCharCandidates.value.join('');
        } else {
            config.value.allowedChars = engine.getSafeCharList();
        }
        engine.updateAllowedChars(config.value.allowedChars);
    };

    const toggleCharSetMode = () => {
        charSetMode.value = charSetMode.value === 'all' ? 'simple' : 'all';
        applyCharSetMode();
    };

    const initEngine = async () => {
        const checkCv = setInterval(async () => {
            if ((window as any).cvLoaded) {
                clearInterval(checkCv);
                status.value = 'LOADING AI...';
                try {
                    await engine.init(
                        '/aa_model_a.onnx', 
                        '/aa_model_b.onnx', 
                        '/Saitamaar.ttf', 
                        '/aa_chars.json', 
                        'classifier', // 初期値
                        'Saitamaar'
                    );
                    
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
                    console.error(e);
                    status.value = 'ERROR';
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

    const runGeneration = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        aaOutputRef: Ref<string>
    ) => {
        if (isProcessing.value) return;
        isProcessing.value = true; 
        status.value = 'PROCESSING...';
        
        // ★自動モード切替
        const isDefaultFont = customFontName.value === 'Saitamaar';
        const isFullCharSet = charSetMode.value === 'all'; 
        // 厳密には config.value.allowedChars と allCharCandidates の比較が必要ですが
        // charSetMode が 'all' なら概ねClassifier適用の意図とみなします

        if (isDefaultFont && isFullCharSet) {
            engine.mode = 'classifier';
            console.log("Mode: Classifier");
        } else {
            engine.mode = 'vector';
            console.log("Mode: Vector");
        }

        engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

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
                // OpenCV処理
                const ctx = canvas.getContext('2d')!;
                // Classifierモードの場合は Canvas を直接渡す (generate9ChInputの仕様)
                // Vectorモードの場合は ImageData -> Mat -> Skeletonize の手順
                
                let fullFeatures: Float32Array;

                if (engine.mode === 'classifier') {
                    // 旧方式: 単純な太さ調整 + AdaptiveThreshold (黒背景)
                    fullFeatures = FeatureExtractor.generate9ChInput(
                        canvas, 
                        lineWeight.value, 
                        0, 
                        tempCtx ? tempCtx.canvas : null
                    );
                } else {
                    // 新方式: スケルトン化 -> ハイブリッド
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const srcMat = (window as any).cv.matFromImageData(imgData);
                    const skeletonMat = FeatureExtractor.skeletonize(srcMat);
                    fullFeatures = FeatureExtractor.generate9ChInputFromSkeleton(
                        skeletonMat, 
                        tempCtx ? tempCtx.canvas : null
                    );
                    srcMat.delete(); skeletonMat.delete();
                }
                
                // デバッグ表示
                if (debugCanvasRef.value) {
                    const dCtx = debugCanvasRef.value.getContext('2d')!;
                    debugCanvasRef.value.width = canvas.width;
                    debugCanvasRef.value.height = canvas.height;
                    const idata = dCtx.createImageData(canvas.width, canvas.height);
                    for(let i=0; i<canvas.width*canvas.height; i++) {
                        idata.data[i*4] = fullFeatures[i*9]!;
                        idata.data[i*4+1] = fullFeatures[i*9+3]!;
                        idata.data[i*4+2] = 0;
                        idata.data[i*4+3] = 255;
                    }
                    dCtx.putImageData(idata, 0, 0);
                }

                const w = canvas.width; const h = canvas.height;
                const cropH = 32; const lineH = 16;
                let result = "";
                const imgBottom = (imageTransform.y + 2000 * imageTransform.scale) + 200; 
                const scanLimitY = Math.min(h, imgBottom);
                const measureCanvas = document.createElement('canvas');
                const measureCtx = measureCanvas.getContext('2d')!;
                measureCtx.font = `16px "${customFontName.value}"`;

                let prevLineBottomEdge: Float32Array | null = null;

                for (let y = cropH / 2; y < scanLimitY - cropH / 2; y += lineH) {
                    status.value = `ROW ${Math.floor(y/16)}`;
                    const startIdx = (y - cropH/2) * w * 9;
                    if (startIdx + cropH * w * 9 > fullFeatures.length) break;
                    
                    const lineFeat = fullFeatures.subarray(startIdx, startIdx + cropH * w * 9);
                    
                    let rowMaskData: Uint8ClampedArray | null = null;
                    if (tempCtx) {
                        const srcY = Math.floor(y - cropH/2);
                        if (srcY >= 0 && srcY + 32 <= h) {
                            rowMaskData = tempCtx.getImageData(0, srcY, w, 32).data;
                        }
                    }

                    // solveLineの結果を受け取る (text と bottomEdge)
                    const resultObj = await engine.solveLine(
                        lineFeat, w, targetCharBlue.value, targetCharRed.value, 
                        rowMaskData, y, config.value.generationMode, measureCtx,
                        prevLineBottomEdge // ★前行の情報を渡す
                    );
                    
                    result += resultObj.text + "\n";
                    
                    // ★次行のために保存
                    prevLineBottomEdge = resultObj.bottomEdge;

                    aaOutputRef.value = result;
                    await new Promise(r => setTimeout(r, 0));
                }
                status.value = 'DONE';
            } catch (err) { 
                console.error(err); status.value = 'ERROR'; 
            } finally { 
                isProcessing.value = false; 
            }
        }, 50);
    };
    
    // getSuggestion等は変更なし
    const getSuggestion = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number
    ): Promise<string> => {
        // 1行分の画像を切り出す
        const rowCanvas = document.createElement('canvas');
        rowCanvas.width = canvas.width; rowCanvas.height = 32;
        const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
        
        // 座標計算（行の中心を合わせる）
        const srcY = Math.max(0, lineY - 8);
        const dstY = (lineY - 8 < 0) ? (8 - lineY) : 0;
        rowCtx.drawImage(canvas, 0, srcY, canvas.width, 32, 0, dstY, canvas.width, 32);

        let features: Float32Array;

        // ★修正: モードに応じて前処理を切り替える
        if (engine.mode === 'classifier') {
             // Classifierモード: 旧方式 (単純な生成)
             // lineWeightも反映させる
             features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, 0);
        } else {
             // Vectorモード: 新方式 (スケルトン化 -> ハイブリッド生成)
             const ctx = rowCanvas.getContext('2d')!;
             const imgData = ctx.getImageData(0, 0, rowCanvas.width, rowCanvas.height);
             const srcMat = (window as any).cv.matFromImageData(imgData);
             
             const skeletonMat = FeatureExtractor.skeletonize(srcMat);
             features = FeatureExtractor.generate9ChInputFromSkeleton(skeletonMat);
             
             srcMat.delete(); skeletonMat.delete();
        }

        // マスクデータの準備
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

        // 推論実行
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
            await engine.init('/aa_model_a.onnx', '/aa_model_b.onnx', fUrl, '/aa_chars.json', 'classifier', fName);
            engine.updateAllowedChars(config.value.allowedChars);
            customFontName.value = fName; 
            status.value = `DB UPDATED`;
        } catch(err) { console.error(err); status.value = 'DB ERROR'; }
    };

    return {
        engine, status, isReady, isProcessing, config, allCharCandidates,
        customFontName, 
        lineWeight, 
        targetCharBlue, targetCharRed, debugCanvasRef,
        charSetMode, toggleCharSetMode,
        initEngine, updateAllowedChars, runGeneration, 
        getSuggestion, rebuildDb, 
        toggleAllowedChar 
    };
}