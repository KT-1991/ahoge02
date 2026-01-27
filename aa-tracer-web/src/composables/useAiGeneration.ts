import { ref, type Ref } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from '../utils/InferenceEngine';
import { FeatureExtractor } from '../utils/FeatureExtractor';
import { _unused, fixPath } from '../utils/common';

export function useAiGeneration() {
    const engine = new InferenceEngine();
    
    // UI State
    const status = ref('BOOTING...');
    const isReady = ref(false);
    const isProcessing = ref(false);
    const abortTrigger = ref(false);
    // ★追加: 現在の推論モードを保持するリアクティブ変数
    const currentMode = ref<'classifier' | 'vector'>('classifier');
    
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
                `/aa_fcn_classifier.onnx?v=${Date.now()}`,  // ★キャッシュ無効化
                null,  // Code A (Draft)
                '/aa_model_encoder.onnx',// Code B (Encoder)
                '/aa_chars.json'         // Character List
            );
            //await engine.debugCheckEncoderBatchability();
            
            // 初回DB構築
            const loadedChars = engine.getLoadedCharList();
            let charsToUse = loadedChars.length > 1 ? loadedChars : DEFAULT_CHARS;
            
            config.value.allowedChars = charsToUse;
            await engine.updateDatabase(null, charsToUse, 'Saitamaar');
            currentMode.value = engine.mode;

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
        currentMode.value = engine.mode;
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
                const res = await fetch(fixPath('/aa_chars.json'));
                if (res.ok) {
                    const data = await res.json();
                    defaultChars = data.map((c: string) => (c === '<UNK>' || c === '<BOS>') ? ' ' : c).join('');
                }
            } catch (e) { console.warn("Using fallback chars"); }

            config.value.allowedChars = defaultChars;
            await engine.updateDatabase(null, defaultChars, 'Saitamaar');
            currentMode.value = engine.mode;
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

    //@ts-ignore
    function u8ToImageData(u8: Uint8Array, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  const dst = img.data;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = u8[i] ?? 0;
    const o = i * 4;
    dst[o + 0] = v;
    dst[o + 1] = v;
    dst[o + 2] = v;
    dst[o + 3] = 255;
  }
  return img;
}

//@ts-ignore
function drawPanel(
  dstCtx: CanvasRenderingContext2D,
  src: HTMLCanvasElement | ImageData,
  x: number,
  y: number,
  panelW: number,
  panelH: number,
  label: string
) {
  // panel背景
  dstCtx.fillStyle = "white";
  dstCtx.fillRect(x, y, panelW, panelH);

  // 描画（スケールしてはめ込む）
  if (src instanceof HTMLCanvasElement) {
    dstCtx.drawImage(src, x, y, panelW, panelH);
  } else {
    // ImageData は一旦オフスクリーンに置いてから拡縮
    const tmp = document.createElement("canvas");
    tmp.width = src.width;
    tmp.height = src.height;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.putImageData(src, 0, 0);
    dstCtx.drawImage(tmp, x, y, panelW, panelH);
  }

  // ラベル
  dstCtx.fillStyle = "rgba(255,255,255,0.75)";
  dstCtx.fillRect(x, y, 140, 18);
  dstCtx.fillStyle = "black";
  dstCtx.font = "12px sans-serif";
  dstCtx.textBaseline = "top";
  dstCtx.fillText(label, x + 4, y + 2);
}

//@ts-ignore
function drawHLine(dstCtx: CanvasRenderingContext2D, x: number, y: number, w: number, color = "red") {
  dstCtx.strokeStyle = color;
  dstCtx.lineWidth = 1;
  dstCtx.beginPath();
  dstCtx.moveTo(x, y + 0.5);
  dstCtx.lineTo(x + w, y + 0.5);
  dstCtx.stroke();
}

/** lineCenterY 近辺の “生ピクセルのインク” を canvas から直接計算（FeatureExtractorを疑う前の確認用） */
//@ts-ignore
function inkSumFromCanvas(canvas: HTMLCanvasElement, lineCenterY: number, stripeW = 12): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.max(0, Math.floor(lineCenterY - 9));
  const y1 = Math.min(h, y0 + 18);
  const img = ctx.getImageData(0, y0, w, y1 - y0).data;

  // 左端〜stripeW の簡易チェック（ここは好きに変えてOK）
  const x0 = 0;
  const x1 = Math.min(w, stripeW);

  let s = 0;
  for (let yy = 0; yy < (y1 - y0); yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * w + xx) * 4;
      const r = img[o]; // aiCanvasは白黒想定
      s += (255 - r!);
    }
  }
  return s;
}


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

  // ===== 0) 定数（AaWorkspace.vue と合わせる）=====
  const lineH = 18;
  const PADDING_LEFT = 10;
  const PADDING_TOP = 10;   // ★これが重要（textarea の paddingTop と揃える）
  //const Y_OFFSET = 0;       // 追加でズラす必要があるならここで調整

  // ===== 1) AI入力用キャンバス（線画のみ）=====
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = w;
  compositeCanvas.height = h;
  const ctx = compositeCanvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0);

        function scanDarkest(canvas: HTMLCanvasElement) {
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            const w = canvas.width, h = canvas.height;
            const img = ctx.getImageData(0, 0, w, h).data;

            let minR = 255, maxR = 0;
            for (let i = 0; i < img.length; i += 4) {
                const r = img[i]!;
                if (r < minR) minR = r;
                if (r > maxR) maxR = r;
            }
            console.log("[canvas] r min/max =", minR, maxR);
        }

        scanDarkest(compositeCanvas);

  // ===== 2) マスク用（paintBuffer）=====
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  maskCtx.clearRect(0, 0, w, h);

  if (paintBuffer) {
    // ★ paint は見た目通りにしたいなら transform を適用
    maskCtx.save();
    maskCtx.translate(imageTransform.x, imageTransform.y);
    maskCtx.rotate((imageTransform.rotation * Math.PI) / 180);
    maskCtx.scale(imageTransform.scale, imageTransform.scale);
    maskCtx.drawImage(paintBuffer, 0, 0);
    maskCtx.restore();
  }

  // ===== 3) accumulated（コンテキスト）=====
  const accumulatedCanvas = document.createElement('canvas');
  accumulatedCanvas.width = w;
  accumulatedCanvas.height = h;
  const accCtx = accumulatedCanvas.getContext('2d')!;
  accCtx.fillStyle = 'white';
  accCtx.fillRect(0, 0, w, h);
  accCtx.font = `16px "${customFontName.value}"`;
  accCtx.fillStyle = 'black';
  accCtx.textBaseline = 'middle';

  // ===== 4) 特徴量 =====
  // ※ paintBuffer は maskCtx 側で transform 済みなので、FeatureExtractor 側は null でよい
  const baseFeatures = FeatureExtractor.generateBaseFeatures(
    compositeCanvas,
    paintBuffer,
    imageTransform
  );

  //engine.debugFindInkRows(baseFeatures);

  // ===== 5) 行ループ =====
  try {
    let result = "";

    // ★ lineCenterY を “行の中心” にする
    const startLineCenterY = PADDING_TOP + (lineH / 2);

    for (let lineCenterY = startLineCenterY; lineCenterY < h; lineCenterY += lineH) {
      if (abortTrigger.value) {
        status.value = 'CANCELLED';
        break;
      }

      const rowIdx = Math.floor((lineCenterY - startLineCenterY) / lineH);
      status.value = `ROW ${rowIdx}`;

      // 32pxマスクband（中心が16になるように切り出す）
      let rowMaskData: Uint8ClampedArray | null = null;
      const maskY = Math.floor(lineCenterY - 16);
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
        lineCenterY,
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

      // accumulatedCanvas に同じ座標系で描画
      let currentX = PADDING_LEFT;
      for (const ch of lineText) {
        const cw = engine.charWidthCache.get(ch) || 8.0;
        accCtx.fillText(ch, currentX, lineCenterY);
        currentX += cw;
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
        ctx.drawImage(canvas, 0, 0)

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
            null,
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
        currentMode,
        getSuggestion, 
        getCandidates,
        cancelGeneration, 
        generateRows
    };
}

