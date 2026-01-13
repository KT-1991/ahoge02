import { ref, type Ref } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from '../utils/InferenceEngine';
import { FeatureExtractor } from '../utils/FeatureExtractor';
import { _unused } from '../utils/common';

export function useAiGeneration() {
    const engine = new InferenceEngine();
    
    // UI State
    const status = ref('BOOTING...');
    const isReady = ref(false);
    const isProcessing = ref(false);
    const abortTrigger = ref(false);
    
    // Configuration
    const customFontName = ref('Saitamaar');
    const config = ref({ 
        allowedChars: DEFAULT_CHARS, 
        useThinSpace: true, 
        safeMode: false,
        noiseGate: 0.3,
        generationMode: 'hybrid' as 'hybrid' | 'accurate',
        bbsMode: true,
    });
    
    //const allCharCandidates = ref<string[]>([]);
    const targetCharBlue = ref(':');
    const targetCharRed = ref('/');
    
    // Debugging
    const debugCanvasRef = ref<HTMLCanvasElement | null>(null);

    // -------------------------------------------------------------------------
    //  Initialization & Config
    // -------------------------------------------------------------------------

    const initEngine = async () => {
        if (isReady.value) return;
        
        try {
            // モデルファイルのロード (publicフォルダ配置を想定)
            await engine.init(
                '/aa_model_refine.onnx', // Code A (Refine)
                '/aa_model_draft.onnx',  // Code A (Draft)
                '/aa_model_encoder.onnx',// Code B (Encoder)
                '/aa_chars.json'         // Character List
            );
            
            // 初回DB構築
            const loadedChars = engine.getLoadedCharList();
            let charsToUse = loadedChars.length > 1 ? loadedChars : DEFAULT_CHARS;
            
            config.value.allowedChars = charsToUse;
            await engine.updateDatabase(null, charsToUse, 'Saitamaar');

            status.value = 'READY';
            isReady.value = true;
        } catch (e) {
            console.error(e);
            status.value = 'ERROR';
        }
    };

    const updateAllowedChars = async () => {
        status.value = 'UPDATING DB...';
        await new Promise(r => setTimeout(r, 10)); // UI更新用ウェイト
        await engine.updateDatabase(null, config.value.allowedChars, customFontName.value);
        status.value = 'READY';
    };

    const resetConfig = async () => {
        status.value = 'RESETTING...';
        try {
            customFontName.value = 'Saitamaar';
            config.value.safeMode = false;
            config.value.useThinSpace = true;
            config.value.bbsMode = true;
            config.value.generationMode = 'hybrid';

            // デフォルト文字リストの復元
            let defaultChars = DEFAULT_CHARS;
            try {
                const res = await fetch('/aa_chars.json');
                if (res.ok) {
                    const data = await res.json();
                    defaultChars = data.map((c: string) => (c === '<UNK>' || c === '<BOS>') ? ' ' : c).join('');
                }
            } catch (e) { console.warn("Using fallback chars"); }

            config.value.allowedChars = defaultChars;
            await engine.updateDatabase(null, defaultChars, 'Saitamaar');
            
            status.value = 'READY';
        } catch (e) {
            console.error(e);
            status.value = 'ERROR';
        }
    };

    const cancelGeneration = () => {
        if (isProcessing.value) {
            abortTrigger.value = true;
            status.value = 'CANCELLING...';
        }
    };

    // -------------------------------------------------------------------------
    //  Core Generation Logic (Full Image)
    // -------------------------------------------------------------------------

const runGeneration = async (
        canvas: HTMLCanvasElement, 
        paintBuffer: HTMLCanvasElement | null, 
        imageTransform: any, 
        aaOutputRef: Ref<string>
    ) => {
        if (isProcessing.value) return;
        isProcessing.value = true; 
        abortTrigger.value = false;
        status.value = 'PROCESSING...';
        
        const w = canvas.width;
        const h = canvas.height;
        
        // 1. AI入力用キャンバス (線画のみ)
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = w;
        compositeCanvas.height = h;
        const ctx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
        
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0); 

        // 2. マスク判定用 (色情報のみ)
        // ★修正: ここで変形 (imageTransform) を適用して描画します
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w; maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
        maskCtx.clearRect(0, 0, w, h);

        if (paintBuffer) {
            maskCtx.save();
            // ★変形を適用 (これにより見た目通りの位置に色が配置されます)
            maskCtx.translate(imageTransform.x, imageTransform.y);
            maskCtx.rotate(imageTransform.rotation * Math.PI / 180);
            maskCtx.scale(imageTransform.scale, imageTransform.scale);
            maskCtx.drawImage(paintBuffer, 0, 0);
            maskCtx.restore();
        }

        // 3. コンテキスト用
        const accumulatedCanvas = document.createElement('canvas');
        accumulatedCanvas.width = w;
        accumulatedCanvas.height = h;
        const accCtx = accumulatedCanvas.getContext('2d')!;
        accCtx.fillStyle = "white";
        accCtx.fillRect(0, 0, w, h);
        accCtx.font = `16px "${customFontName.value}"`;
        accCtx.fillStyle = "black";
        accCtx.textBaseline = "middle";

        setTimeout(async () => {
            try {
                // 4. 特徴量生成
                // ★修正: Transformには null を渡す (paintBufferは既に変形不要)
                const baseFeatures = FeatureExtractor.generateBaseFeatures(
                    compositeCanvas, 
                    paintBuffer, 
                    imageTransform
                );

                const lineH = 18;
                const PADDING_TOP = 10;
                const Y_OFFSET = 10;
                const startY = lineH / 2 + Y_OFFSET;
                
                let result = "";

                // 行ループ
                for (let y = startY; y < h; y += lineH) {
                    if (abortTrigger.value) {
                        status.value = 'CANCELLED';
                        break;
                    }

                    const rowIdx = Math.floor((y - PADDING_TOP) / lineH);
                    status.value = `ROW ${rowIdx}`;

                    // 5. マスクデータの取得
                    let rowMaskData: Uint8ClampedArray | null = null;
                    const maskY = Math.floor(y - 16);
                    if (maskY >= 0 && maskY + 32 <= h) {
                        rowMaskData = maskCtx.getImageData(0, maskY, w, 32).data;
                    }

                    // 1行推論
                    const resultObj = await engine.solveLine(
                        baseFeatures,
                        w,
                        targetCharBlue.value,
                        targetCharRed.value,
                        rowMaskData,
                        y, 
                        config.value.generationMode,
                        null,
                        null,
                        config.value.bbsMode,
                        config.value.useThinSpace,
                        debugCanvasRef.value,
                        accumulatedCanvas 
                    );
                    
                    let lineText = resultObj.text;
                    lineText = lineText.replace(/[ 　\u2009]+$/, ''); 
                    result += lineText + "\n";
                    
                    aaOutputRef.value = result;

                    const PADDING_LEFT = 10;
                    let currentX = PADDING_LEFT;
                    for (const char of lineText) {
                        const charW = engine.charWidthCache.get(char) || 8.0;
                        accCtx.fillText(char, currentX, y);
                        currentX += charW;
                    }

                    await new Promise(r => setTimeout(r, 0));
                }

                result = result.replace(/\n+$/, '');
                aaOutputRef.value = result;
                status.value = 'DONE';

            } catch (err) { 
                console.error(err); 
                status.value = 'ERROR'; 
            } finally { 
                isProcessing.value = false; 
            }
        }, 50);
    };

    // -------------------------------------------------------------------------
    //  Flow Brush Generation (Partial Update)
    // -------------------------------------------------------------------------

    const generateRows = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        rows: number[], 
        currentAA: string
    ): Promise<string> => {
        _unused(imageTransform);
        if (!isReady.value) return currentAA;
        
        const w = canvas.width;
        const h = canvas.height;

        // 1. AI入力用 (線画のみ)
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = w; compositeCanvas.height = h;
        const ctx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(canvas, 0, 0);

        // 2. マスク判定用 (色情報のみ)
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w; maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
        maskCtx.clearRect(0, 0, w, h);
        
        if (paintBuffer) {
            // ★修正: Transformなし
            maskCtx.drawImage(paintBuffer, 0, 0);
        }

        // 3. 特徴量生成
        // ★修正: Transformなし
        const baseFeatures = FeatureExtractor.generateBaseFeatures(
            compositeCanvas,
            paintBuffer,
            null // imageTransform -> null
        );

        // 4. コンテキスト復元
        const accumulatedCanvas = document.createElement('canvas');
        accumulatedCanvas.width = w; accumulatedCanvas.height = h;
        const accCtx = accumulatedCanvas.getContext('2d')!;
        accCtx.fillStyle = "white"; accCtx.fillRect(0, 0, w, h);
        accCtx.font = `16px "${customFontName.value}"`;
        accCtx.fillStyle = "black";
        accCtx.textBaseline = "middle";

        const lines = currentAA.split('\n');
        const lineH = 18;
        const PADDING_TOP = 10;
        const Y_OFFSET = 10;
        const PADDING_LEFT = 10;

        lines.forEach((line, idx) => {
            const y = PADDING_TOP + (idx * lineH) + (lineH / 2) + Y_OFFSET;
            let cx = PADDING_LEFT;
            for(const c of line) {
                const cw = engine.charWidthCache.get(c) || 8.0;
                accCtx.fillText(c, cx, y);
                cx += cw;
            }
        });

        // 5. 指定行のみ再生成
        for (const rowIdx of rows) {
            const y = PADDING_TOP + (rowIdx * lineH) + (lineH / 2) + Y_OFFSET;
            if (y > h) continue;

            let rowMaskData: Uint8ClampedArray | null = null;
            const maskY = Math.floor(y - 16);
            if (maskY >= 0 && maskY + 32 <= h) {
                rowMaskData = maskCtx.getImageData(0, maskY, w, 32).data;
            }

            const resultObj = await engine.solveLine(
                baseFeatures,
                w,
                targetCharBlue.value,
                targetCharRed.value,
                rowMaskData,
                y,
                config.value.generationMode,
                null,
                null,
                config.value.bbsMode,
                config.value.useThinSpace,
                null,
                accumulatedCanvas 
            );

            let lineText = resultObj.text;
            lineText = lineText.replace(/[ 　\u2009]+$/, '');
            
            while (lines.length <= rowIdx) lines.push("");
            lines[rowIdx] = lineText;

            const clearY = y - (lineH/2);
            accCtx.fillStyle = "white";
            accCtx.fillRect(0, clearY, w, lineH);
            accCtx.fillStyle = "black";
            
            let cx = PADDING_LEFT;
            for(const c of lineText) {
                const cw = engine.charWidthCache.get(c) || 8.0;
                accCtx.fillText(c, cx, y);
                cx += cw;
            }
        }

        let result = lines.join('\n');
        result = result.replace(/\n+$/, '');
        return result;
    };

    // -------------------------------------------------------------------------
    //  Helper: Prepare Local Features (ROI) for Ghost/Context Menu
    // -------------------------------------------------------------------------
    
    // 戻り値に maskData を追加
    const prepareLocalFeatures = (
        sourceCanvas: HTMLCanvasElement, 
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number, 
        lineY: number 
    ) => {
        const lineH = 18;
        const aiCenterY = lineY + (lineH / 2);
        const ROI_W = 128; 
        const ROI_H = 48; 
        
        const aiCenterX = caretPixelX; 
        const roiX = Math.floor(aiCenterX - ROI_W / 2);
        const roiY = Math.floor(aiCenterY - ROI_H / 2);

        // 1. AI入力用 (Sourceのみ)
        const roiSourceCanvas = document.createElement('canvas');
        roiSourceCanvas.width = ROI_W;
        roiSourceCanvas.height = ROI_H;
        const ctxSource = roiSourceCanvas.getContext('2d', { willReadFrequently: true })!;
        
        ctxSource.fillStyle = "white";
        ctxSource.fillRect(0, 0, ROI_W, ROI_H);
        ctxSource.drawImage(sourceCanvas, -roiX, -roiY);

        // 2. マスク/加筆用 (Paintのみ)
        // ROIのサイズで切り出したペイントバッファを作る
        const roiPaintCanvas = document.createElement('canvas');
        roiPaintCanvas.width = ROI_W;
        roiPaintCanvas.height = ROI_H;
        const ctxPaint = roiPaintCanvas.getContext('2d', { willReadFrequently: true })!;
        // ここ重要: ペイントがない場所は透明にしておく
        ctxPaint.clearRect(0, 0, ROI_W, ROI_H); 

        if (paintBuffer) {
            ctxPaint.save();
            // ROIの原点分ずらしてから、ペイントの変形を適用
            ctxPaint.translate(-roiX, -roiY);
            ctxPaint.translate(imageTransform.x, imageTransform.y);
            ctxPaint.rotate(imageTransform.rotation * Math.PI / 180);
            ctxPaint.scale(imageTransform.scale, imageTransform.scale);
            ctxPaint.drawImage(paintBuffer, 0, 0);
            ctxPaint.restore();
        }

        // 3. 特徴量生成
        // 分離したキャンバスを渡すことで、FeatureExtractorが「青除去＆黒合成」を正しく行う
        const features = FeatureExtractor.generateBaseFeatures(
            roiSourceCanvas, 
            roiPaintCanvas, 
            null // 既にROI座標系に変形済みなので null
        );

        // 4. マスクデータの抽出
        // ROIの中心 (Ghostが表示される位置) 付近のデータを取得
        // 48px高さの中心は24px。
        let maskData: Uint8ClampedArray | null = null;
        // マスク判定は少し広めに取るか、ピンポイントで取るか。
        // ここではROI全体を渡して InferenceEngine 側で座標計算させるか、
        // 簡易的に中心行だけ渡すか。
        // suggestText の仕様に合わせて「全体」を渡すのが安全ですが、
        // suggestText は maskStride を要求するので、ROI幅(128)のデータを渡せばOK。
        
        // ROI全体を取得
        maskData = ctxPaint.getImageData(0, 0, ROI_W, ROI_H).data;

        return { 
            features, 
            roiX, 
            roiY, 
            localCenterX: aiCenterX - roiX,
            localCenterY: ROI_H / 2,
            maskData,      // ★追加
            maskStride: ROI_W // ★追加
        };
    };

    // -------------------------------------------------------------------------
    //  Ghost / Context Menu Methods
    // -------------------------------------------------------------------------

    const getSuggestion = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number,
        prevChar: string = "" // ★追加: 直前の文字を受け取る
    ): Promise<string> => {
        if (!isReady.value) return "";
        if (caretPixelX < 0 || caretPixelX > canvas.width || lineY < 0 || lineY > canvas.height) return "";

        // prepareLocalFeatures から maskData も受け取る
        const { features, localCenterX, localCenterY, roiX, maskData, maskStride } = prepareLocalFeatures(
            canvas, paintBuffer, imageTransform, caretPixelX, lineY
        );

        return await engine.suggestText(
            features, 
            localCenterX, 
            localCenterY, 
            targetCharBlue.value, 
            targetCharRed.value, 
            3, 
            maskData, 
            roiX, // これは globalX だが、ROI内の判定には localX が必要...
            // InferenceEngine.suggestText の実装を確認する必要があります。
            // 修正後の suggestText は localCenterX を基準に判定するようにします。
            maskStride,
            prevChar // ★追加: エンジンに渡す
        );
    };

    const getCandidates = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number
    ) => {
        if (!isReady.value) return [];

        const { features, localCenterX, localCenterY } = prepareLocalFeatures(
            canvas, paintBuffer, imageTransform, caretPixelX, lineY
        );

        return await engine.getCandidatesAt(
            features,
            localCenterX,
            localCenterY
        );
    };

    return {
        initEngine, 
        updateAllowedChars, 
        runGeneration, 
        resetConfig,
        config, 
        customFontName, 
        status, 
        isReady, 
        isProcessing,
        targetCharBlue, 
        targetCharRed, 
        debugCanvasRef, 
        engine, 
        getSuggestion, 
        getCandidates,
        cancelGeneration, 
        generateRows
    };
}