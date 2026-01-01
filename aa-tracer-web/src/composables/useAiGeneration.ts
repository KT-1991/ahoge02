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
        generationMode: 'hybrid' as 'hybrid' | 'accurate',
        bbsMode: false,
    });
    
    const allCharCandidates = ref<string[]>(Array.from(new Set(DEFAULT_CHARS.split(''))));
    const lineWeight = ref(0.6); 
    const charSetMode = ref<'all' | 'simple'>('all');
    const targetCharBlue = ref(':');
    const targetCharRed = ref('/');
    const debugCanvasRef = ref<HTMLCanvasElement | null>(null);

    const fetchDefaultChars = async (): Promise<string> => {
        try {
            const res = await fetch('/aa_chars.json');
            if (!res.ok) throw new Error('Failed to fetch aa_chars.json');
            const data = await res.json();
            let chars = '';
            if (Array.isArray(data)) chars = data.join('');
            else if (typeof data === 'string') chars = data;
            if (!chars.includes(' ')) chars = ' ' + chars;
            return chars;
        } catch (e) {
            console.warn('Could not load aa_chars.json, using fallback.', e);
            return DEFAULT_CHARS;
        }
    };

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
                        'classifier', 
                        'Saitamaar'
                    );
                    
                    const loadedChars = engine.getLoadedCharList();
                    let charsToUse = loadedChars;

                    if (loadedChars.length <= 1) { // ほぼ空ならロード失敗とみなしてfetch
                        charsToUse = await fetchDefaultChars();
                    }
                    
                    // 文字リストの正規化（重複排除など）
                    const newSet = Array.from(new Set((' ' + charsToUse).split(''))).join('');
                    
                    config.value.allowedChars = newSet;
                    allCharCandidates.value = Array.from(newSet); // ★重要: 候補リストも同期
                    engine.updateAllowedChars(newSet); // ★重要: エンジンに確実に適用

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
        
        const isDefaultFont = customFontName.value === 'Saitamaar';
        const isFullCharSet = charSetMode.value === 'all'; 

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
                const ctx = canvas.getContext('2d')!;
                let fullFeatures: Float32Array;

                if (engine.mode === 'classifier') {
                    fullFeatures = FeatureExtractor.generate9ChInput(
                        canvas, lineWeight.value, 0, tempCtx ? tempCtx.canvas : null
                    );
                } else {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const srcMat = (window as any).cv.matFromImageData(imgData);
                    const skeletonMat = FeatureExtractor.skeletonize(srcMat);
                    fullFeatures = FeatureExtractor.generate9ChInputFromSkeleton(
                        skeletonMat, tempCtx ? tempCtx.canvas : null
                    );
                    srcMat.delete(); skeletonMat.delete();
                }
                
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

                    const resultObj = await engine.solveLine(
                        lineFeat, w, targetCharBlue.value, targetCharRed.value, 
                        rowMaskData, y, config.value.generationMode, measureCtx,
                        prevLineBottomEdge 
                    );
                    
                    result += resultObj.text + "\n";
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

        let features: Float32Array;

        if (engine.mode === 'classifier') {
             features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, 0);
        } else {
             const ctx = rowCanvas.getContext('2d')!;
             const imgData = ctx.getImageData(0, 0, rowCanvas.width, rowCanvas.height);
             const srcMat = (window as any).cv.matFromImageData(imgData);
             const skeletonMat = FeatureExtractor.skeletonize(srcMat);
             features = FeatureExtractor.generate9ChInputFromSkeleton(skeletonMat);
             srcMat.delete(); skeletonMat.delete();
        }

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
            await engine.init('/aa_model_a.onnx', '/aa_model_b.onnx', fUrl, '/aa_chars.json', 'classifier', fName);
            engine.updateAllowedChars(config.value.allowedChars);
            customFontName.value = fName; 
            status.value = `DB UPDATED`;
        } catch(err) { console.error(err); status.value = 'DB ERROR'; }
    };

    const generateRows = async (
        canvas: HTMLCanvasElement,       
        paintLayer: HTMLCanvasElement | null, 
        transform: { scale: number, rotation: number, x: number, y: number },
        currentAA: string,
        minY: number,
        maxY: number
    ): Promise<string> => {
        if (!isReady.value) return currentAA;
        if (canvas.width === 0 || canvas.height === 0) return currentAA;

        const PADDING_TOP = 10;
        const workCanvas = document.createElement('canvas');
        workCanvas.width = canvas.width;
        workCanvas.height = canvas.height;
        const ctx = workCanvas.getContext('2d', { willReadFrequently: true })!;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, workCanvas.width, workCanvas.height);

        ctx.save();
        ctx.translate(transform.x, transform.y);
        ctx.rotate(transform.rotation * Math.PI / 180);
        ctx.scale(transform.scale, transform.scale);
        
        ctx.drawImage(canvas, 0, 0);
        
        if (paintLayer && paintLayer.width > 0 && paintLayer.height > 0) {
            ctx.drawImage(paintLayer, 0, 0);
        }
        ctx.restore();

        const lines = currentAA.split('\n');
        const lineHeight = 16;
        
        const startRow = Math.max(0, Math.floor((minY - PADDING_TOP - lineHeight) / lineHeight));
        const endRow = Math.ceil((maxY - PADDING_TOP + lineHeight) / lineHeight);

        while (lines.length <= endRow) lines.push('');

        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d')!;
        measureCtx.font = `16px "${customFontName.value}"`;

        for (let row = startRow; row <= endRow; row++) {
            const y = row * lineHeight + PADDING_TOP; 
            if (y < 0 || y >= canvas.height) continue;

            const rowCanvas = document.createElement('canvas');
            rowCanvas.width = canvas.width; 
            rowCanvas.height = 32;
            const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;

            const centerY = y + 8;
            const cropSrcY = centerY - 16; 
            
            rowCtx.fillStyle = '#ffffff';
            rowCtx.fillRect(0, 0, rowCanvas.width, rowCanvas.height);
            rowCtx.drawImage(workCanvas, 0, cropSrcY, canvas.width, 32, 0, 0, canvas.width, 32);

            let features: Float32Array;
            if (engine.mode === 'classifier') {
                 features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, 0);
            } else {
                 const rCtx = rowCanvas.getContext('2d')!;
                 const imgData = rCtx.getImageData(0, 0, rowCanvas.width, rowCanvas.height);
                 const srcMat = (window as any).cv.matFromImageData(imgData);
                 const skeletonMat = FeatureExtractor.skeletonize(srcMat);
                 features = FeatureExtractor.generate9ChInputFromSkeleton(skeletonMat);
                 srcMat.delete(); skeletonMat.delete();
            }

            let rowMaskData: Uint8ClampedArray | null = null;
            if (paintLayer && paintLayer.width > 0 && paintLayer.height > 0) {
                const maskCvs = document.createElement('canvas');
                maskCvs.width = canvas.width; 
                maskCvs.height = 32;
                const mCtx = maskCvs.getContext('2d', { willReadFrequently: true })!;
                mCtx.drawImage(paintLayer, 0, cropSrcY, canvas.width, 32, 0, 0, canvas.width, 32);
                rowMaskData = mCtx.getImageData(0, 0, maskCvs.width, 32).data;
            }

            const resultObj = await engine.solveLine(
                features, canvas.width, targetCharBlue.value, targetCharRed.value,
                rowMaskData, centerY, config.value.generationMode, measureCtx, null 
            );

            lines[row] = resultObj.text;
        }
        return lines.join('\n');
    };

    const getCandidates = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number
    ) => {
        const rowCanvas = document.createElement('canvas');
        rowCanvas.width = canvas.width; rowCanvas.height = 32;
        const rowCtx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
        const srcY = Math.max(0, lineY - 8);
        const dstY = (lineY - 8 < 0) ? (8 - lineY) : 0;
        rowCtx.drawImage(canvas, 0, srcY, canvas.width, 32, 0, dstY, canvas.width, 32);

        let features: Float32Array;
        if (engine.mode === 'classifier') {
             features = FeatureExtractor.generate9ChInput(rowCanvas, lineWeight.value, 0);
        } else {
             const ctx = rowCanvas.getContext('2d')!;
             const imgData = ctx.getImageData(0, 0, rowCanvas.width, rowCanvas.height);
             const srcMat = (window as any).cv.matFromImageData(imgData);
             const skeletonMat = FeatureExtractor.skeletonize(srcMat);
             features = FeatureExtractor.generate9ChInputFromSkeleton(skeletonMat);
             srcMat.delete(); skeletonMat.delete();
        }

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

        return await engine.getCandidatesAt(
            features, rowCanvas.width, caretPixelX, 
            rowMaskData, targetCharBlue.value, targetCharRed.value
        );
    };

    // ★修正: 設定リセット時に allCharCandidates も同期させる
    const resetConfig = async () => {
        customFontName.value = 'Saitamaar';
        config.value.safeMode = false;
        config.value.useThinSpace = true;
        config.value.generationMode = 'hybrid';
        
        const defaultChars = await fetchDefaultChars();
        
        // 1. エンジンを更新
        engine.updateAllowedChars(defaultChars);
        
        // 2. Configを更新
        config.value.allowedChars = defaultChars;
        
        // 3. ★重要: 全文字リストの控えも更新 (これを忘れると charSetMode 切り替えでおかしくなる)
        allCharCandidates.value = Array.from(new Set(defaultChars.split('')));
        
        await rebuildDb(null, 'Saitamaar');
    };

    return {
        engine, status, isReady, isProcessing, config, allCharCandidates,
        customFontName, 
        lineWeight, 
        targetCharBlue, targetCharRed, debugCanvasRef,
        charSetMode, toggleCharSetMode,
        initEngine, updateAllowedChars, runGeneration, 
        getSuggestion, rebuildDb, 
        toggleAllowedChar, getCandidates, generateRows, resetConfig
    };
}