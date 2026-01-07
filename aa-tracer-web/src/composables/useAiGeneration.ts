import { ref, type Ref } from 'vue';
import { InferenceEngine, DEFAULT_CHARS } from '../utils/InferenceEngine';
import { FeatureExtractor } from '../utils/FeatureExtractor';

export function useAiGeneration() {
    const engine = new InferenceEngine();
    const status = ref('BOOTING...');
    const isReady = ref(false);
    const isProcessing = ref(false);
    // ★追加: 中断用フラグ
    const abortTrigger = ref(false);
    
    // Config
    const customFontName = ref('Saitamaar');
    const config = ref({ 
        allowedChars: DEFAULT_CHARS, 
        useThinSpace: true, 
        safeMode: false,
        noiseGate: 0.3,
        generationMode: 'hybrid' as 'hybrid' | 'accurate',
        bbsMode: true,
    });
    
    const allCharCandidates = ref<string[]>([]);
    const targetCharBlue = ref(':');
    const targetCharRed = ref('/');
    const debugCanvasRef = ref<HTMLCanvasElement | null>(null);

// ★追加: 中断関数
    const cancelGeneration = () => {
        if (isProcessing.value) {
            abortTrigger.value = true;
            status.value = 'CANCELLING...';
        }
    };
// カーソル周辺の画像を切り出して特徴量を生成するヘルパー関数
    const prepareLocalFeatures = (
        sourceCanvas: HTMLCanvasElement, 
        paintBuffer: HTMLCanvasElement | null,
        imgTransform: any,
        caretPixelX: number, 
        lineY: number // UI上のY座標 (padding込み)
    ) => {
        console.log(imgTransform);
        // AIが見るべき中心Y座標
        const lineH = 18;
        const aiCenterY = lineY + (lineH / 2);
        
        // 切り出し範囲 (ROI) の設定
        // カーソルを中心に、前後十分な余白を持たせる
        const ROI_W = 128; 
        const ROI_H = 48; // 48px (Crop Size)
        
        // ROIの左上座標 (画像座標系)
        // caretPixelX は padding-left(10) 込みの値なので、画像座標にするには -10 する
        // しかし、AIはパディング込みの座標系で動いているので、
        // ここでは「AIにとってのX座標」を基準にする
        const aiCenterX = caretPixelX; 
        const roiX = Math.floor(aiCenterX - ROI_W / 2);
        const roiY = Math.floor(aiCenterY - ROI_H / 2);

        // 1. ソース画像からROIを切り出す
        const roiCanvas = document.createElement('canvas');
        roiCanvas.width = ROI_W;
        roiCanvas.height = ROI_H;
        const ctx = roiCanvas.getContext('2d', { willReadFrequently: true })!;
        
        // 背景白
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, ROI_W, ROI_H);
        
        // 画像描画 (変形適用済みsourceCanvasから切り出し)
        // sourceCanvasはApp.vueで既にTransform適用済みのものが渡ってくる前提
        // (App.vueの renderAllCanvases で描画された canvasRef)
        ctx.drawImage(sourceCanvas, -roiX, -roiY);

        // ペイントバッファがあれば合成
        if (paintBuffer) {
            // paintBufferは生サイズなのでTransformが必要だが、
            // 引数の sourceCanvas が既に合成・変形済みなら不要。
            // App.vueの実装を見ると canvasRef には描画済みだが、
            // paintBuffer は別レイヤー。
            // ここでは簡易的に「canvasRef (sourceCanvas) にはペイント以外が含まれている」と仮定し、
            // paintBufferを合成する処理は（重くなるので）省略するか、
            // もしGhostにペイントを反映させたいなら、ここで合成する。
            
            // 今回はシンプルに sourceCanvas (表示中の見た目そのまま) を使うことにします。
        }

        // 2. モードに応じた特徴量生成
        let features: any;
        if (engine.mode === 'vector') {
            features = FeatureExtractor.generateVectorBaseFeatures(roiCanvas);
        } else {
            features = FeatureExtractor.generateBaseFeatures(roiCanvas);
        }

        return { 
            features, 
            roiX, 
            roiY, 
            // ROI内での相対中心座標
            localCenterX: aiCenterX - roiX,
            localCenterY: ROI_H / 2 // つねに24
        };
    };

    // ... (fetchDefaultChars等は変更なし) ...
    const fetchDefaultChars = async (): Promise<string> => {
        // ... (省略: 元のコードと同じ) ...
        return DEFAULT_CHARS;
    };

    const initEngine = async () => {
        // ... (省略: cv待ちロジックは同じ) ...
                try {
                    // Code A用のモデルパスを指定
                    // 実際には '/model_final_5ch_coord.onnx' などにリネームして配置してください
                    await engine.init(
                        '/aa_model_a.onnx', 
                        '/aa_model_b.onnx', 
                        '/Saitamaar.ttf', 
                        '/aa_chars.json', 
                        'classifier', 
                        'Saitamaar'
                    );
                    
                    const loadedChars = engine.getLoadedCharList();
                    let charsToUse = loadedChars.length > 1 ? loadedChars : await fetchDefaultChars();
                    config.value.allowedChars = charsToUse;
                    engine.updateAllowedChars(charsToUse);

                    status.value = 'READY';
                    isReady.value = true;
                } catch (e) {
                    console.error(e);
                    status.value = 'ERROR';
                }
        // ...
    };

    // ★追加: 設定リセット機能
    const resetConfig = async () => {
        status.value = 'RESETTING...';
        
        try {
            // 1. 変数をデフォルトに戻す
            customFontName.value = 'Saitamaar';
            config.value.safeMode = false;
            config.value.useThinSpace = true;
            config.value.bbsMode = true;
            config.value.generationMode = 'hybrid';

            // 2. デフォルトの文字リストを取得
            // initEngine と同様のロジックで aa_chars.json を取り直すか、
            // キャッシュがあればそれを使う
            let defaultChars = DEFAULT_CHARS;
            try {
                const res = await fetch('/aa_chars.json');
                if (res.ok) {
                    const data = await res.json();
                    // <UNK> 等を除外して結合
                    defaultChars = data.map((c: string) => (c === '<UNK>' || c === '<BOS>') ? ' ' : c).join('');
                }
            } catch (e) {
                console.warn("Using fallback chars");
            }

            config.value.allowedChars = defaultChars;
            allCharCandidates.value = Array.from(new Set(defaultChars.split('')));

            // 3. エンジンのDB更新
            // fontUrl=null, fontName='Saitamaar' を渡すと、
            // InferenceEngine側で自動的に 'classifier' モードに戻ります
            await engine.updateDatabase(null, defaultChars, 'Saitamaar');

            status.value = 'READY';
        } catch (e) {
            console.error(e);
            status.value = 'ERROR';
        }
    };

    const updateAllowedChars = async () => {
        await engine.updateDatabase(null, config.value.allowedChars, customFontName.value);
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
        // ★初期化: フラグを下ろす
        abortTrigger.value = false;
        
        engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

        // ペイントバッファの合成（FeatureExtractorに渡す前に1枚の絵にする必要があるか？
        // FeatureExtractor.generateBaseFeaturesは画像のみを見る。
        // PaintBufferは「強制指定(Mask)」として使う。
        // ここでは、変形適用後のPaintBufferを生成しておく。
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

        // ★追加: 累積コンテキスト用キャンバス (画像と同じサイズ)
        const accumulatedCanvas = document.createElement('canvas');
        accumulatedCanvas.width = canvas.width;
        accumulatedCanvas.height = canvas.height;
        const accCtx = accumulatedCanvas.getContext('2d')!;
        
        // 白で塗りつぶす（背景）
        accCtx.fillStyle = "white";
        accCtx.fillRect(0, 0, accumulatedCanvas.width, accumulatedCanvas.height);
        
        // 文字描画用設定
        accCtx.font = `16px "${customFontName.value}"`;
        accCtx.fillStyle = "black";
        accCtx.textBaseline = "middle"; // InferenceEngineに合わせてmiddleにする

        setTimeout(async () => {
            try {
                // ★修正: 特徴量生成の分岐
                let baseFeatures: any;
                // 自動判定されたモードに従う
                if (engine.mode === 'vector') {
                    baseFeatures = FeatureExtractor.generateVectorBaseFeatures(canvas);
                } else {
                    baseFeatures = FeatureExtractor.generateBaseFeatures(canvas);
                }
                // 1. 画像全体からベース特徴量を作成 (Skel, Dens, Sin, Cos)
                // canvasは既に変形適用済みで渡ってくる想定(App.vueの実装による)

                const w = canvas.width;
                const h = canvas.height;
                //const cropH = 48;      // Code A
                const lineH = 18;      // 16px -> 18pxに変更
                
                let result = "";
                const Y_OFFSET = 10;
                const startY = lineH / 2 + Y_OFFSET;
                const PADDING_TOP = 10;

                // 2. 行ごとに推論
                // Code Aでは y は中心座標として扱われることが多いが、
                // ここのループは「行の上端」基準か「中心」基準か注意。
                // FeatureExtractor.extractPatch7Ch は CenterY を受け取る。
                // 1行目の中心は padding + lineH/2。
                // canvasにはpaddingが含まれていないので、座標計算に注意。
                
                // 行ループ
                // yは行の中心Y座標とする
                for (let y = startY; y < h; y += lineH) {
                    // ▼▼▼▼▼ 中断チェック ▼▼▼▼▼
                     if (abortTrigger.value) {
                         console.log("Generation Aborted.");
                         status.value = 'CANCELLED';
                         break; // ループを抜ける
                     }
                     // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

                     status.value = `ROW ${Math.floor((y - PADDING_TOP) / lineH)}`;

                     // マスクデータの取得（強制指定用）
                     let rowMaskData: Uint8ClampedArray | null = null;
                     if (tempCtx) {
                         // 中心yを中心に32px高さを切り出す（従来のMask仕様に合わせる）
                         const maskY = Math.floor(y - 16);
                         if (maskY >= 0 && maskY + 32 <= h) {
                             rowMaskData = tempCtx.getImageData(0, maskY, w, 32).data;
                         }
                     }

                     const resultObj = await engine.solveLine(
                         baseFeatures,
                         w,
                         targetCharBlue.value,
                         targetCharRed.value,
                         rowMaskData,
                         y, // ここに 9, 27, 45... が渡されるようになる
                         config.value.generationMode,
                         null,
                         null,
                         config.value.bbsMode,
                         config.value.useThinSpace,
                         debugCanvasRef.value,
                         accumulatedCanvas // ★追加: 累積キャンバスを渡す
                     );
                    
                     // 結果テキスト
                     let lineText = resultObj.text;
                     lineText = lineText.replace(/[ 　\u2009]+$/, '');
                     result += lineText + "\n";
                     aaOutputRef.value = result;
                     // ★重要: 確定した行を累積キャンバスに描画する（次行への引継ぎ用）
                     // Y座標は y (行の中心) を使う
                     // X座標は PADDING_LEFT (10) から開始
                     const PADDING_LEFT = 10;
                     let currentX = PADDING_LEFT;
                     
                     for (const char of lineText) {
                         const charW = engine.charWidthCache.get(char) || 8.0; // engineから幅取得
                         accCtx.fillText(char, currentX, y);
                         currentX += charW;
                     }
                     // 少し休む（UIブロック回避）
                     await new Promise(r => setTimeout(r, 0));
                }

                result = result.replace(/\n+$/, '');
                aaOutputRef.value = result;
                status.value = 'DONE';

                // メモリ解放 (BaseFeatures内のMatデータはFeatureExtractor内でdeleteされていないならここで解放が必要だが
                // 今回のFeatureExtractorの実装では data (Uint8Array) をコピーして返しているので、
                // Mat自体は関数内でdelete済み。GCに任せてOK)

            } catch (err) { 
                console.error(err); status.value = 'ERROR'; 
            } finally { 
                isProcessing.value = false; 
            }
        }, 50);
    };

    // ... (generateRows, getSuggestion, etc. も同様に18px/48px対応が必要) ...
    // 今回は「一括生成(runGeneration)」に注力するため省略、または上記と同様に修正
    

const getSuggestion = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        caretPixelX: number,
        lineY: number
    ): Promise<string> => {
        if (!isReady.value) return "";

        // 範囲外チェック
        if (caretPixelX < 0 || caretPixelX > canvas.width || lineY < 0 || lineY > canvas.height) return "";

        engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

        const { features, localCenterX, localCenterY, roiX } = prepareLocalFeatures(
            canvas, paintBuffer, imageTransform, caretPixelX, lineY
        );

        // ★追加: マスクデータの取得
        let maskData: Uint8ClampedArray | null = null;
        // ★追加: マスクデータの幅を記録する変数
        let maskStride = canvas.width;

        if (paintBuffer) {
            // runGeneration と同じロジックで対象行の中心付近を取得
            const lineH = 18;
            //const PADDING_TOP = 10;
            const Y_OFFSET = 10;
            const aiCenterY = lineY + (lineH / 2) + Y_OFFSET;
            
            // マスク取得Y座標 (中心 - 16)
            const maskY = Math.floor(aiCenterY - 16);
            
            // ペイントバッファから1行分(高さ32px)を取得
            // paintBuffer自体はTransformされていない生データだが、
            // 簡易的にそのまま座標を使って取得する（もしズレるならTransform考慮が必要だが、
            // 現状の実装方針では PaintBuffer = Overlay Canvas サイズ一致 前提）
            const ctx = paintBuffer.getContext('2d');
            if (ctx && maskY >= 0 && maskY + 32 <= paintBuffer.height) {
                maskStride = paintBuffer.width; // ★ここで実際の幅を取得
                maskData = ctx.getImageData(0, maskY, maskStride, 32).data;
            }
        }

        // 推論実行 (ROI内の相対座標を渡す)
        return await engine.suggestText(
            features, 
            localCenterX, 
            localCenterY, 
            targetCharBlue.value, 
            targetCharRed.value, 
            3, // 3文字先まで予測
            // ★追加引数
            maskData, 
            roiX,             // ROIの全体X座標
            maskStride      // 全体幅
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

// ★追加: フローブラシ用 (指定された行インデックスだけを再生成)
    const generateRows = async (
        canvas: HTMLCanvasElement,
        paintBuffer: HTMLCanvasElement | null,
        imageTransform: any,
        rows: number[], // 再生成すべき行インデックスのリスト (例: [5, 6, 7])
        currentAA: string // 現在のAAテキスト (これの一部を書き換える)
    ): Promise<string> => {
        if (!isReady.value) return currentAA;
        
        // 1. エンジン設定更新 (フォントなど)
        engine.updateFontMetrics(customFontName.value, config.value.allowedChars);

        // 2. 特徴量生成 (一括生成と同じ)
        // ※部分更新でも、文脈(Context)のために全体の特徴量があった方が良い、
        //   あるいは高速化のためにROI切り出しも考えられるが、
        //   フローブラシは「書き心地」優先で、一旦全体特徴量を作るのがシンプルで安全。
        //   (重すぎる場合は ROI切り出しに最適化可能)
        
        let baseFeatures: any;
        if (engine.mode === 'vector') {
            baseFeatures = FeatureExtractor.generateVectorBaseFeatures(canvas);
        } else {
            baseFeatures = FeatureExtractor.generateBaseFeatures(canvas);
        }

        // 3. マスク準備 (必要な場合)
        // Flowブラシの場合、paintBufferに描かれた内容(Mask)を反映させたいはず
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

        // 4. 行ループ準備
        const lines = currentAA.split('\n');
        const w = canvas.width;
        const lineH = 18;
        const PADDING_TOP = 10;
        const Y_OFFSET = 10;
        
        // Context用のCanvas (一括生成と同じ)
        // ただし、フローブラシの場合は「上の行」は変更されない前提なので、
        // 既存のAAからContextを作るとより良いが、実装が複雑になるため
        // ここでは「白紙Context」または「簡易Context」で進める
        const accumulatedCanvas = document.createElement('canvas');
        accumulatedCanvas.width = canvas.width;
        accumulatedCanvas.height = canvas.height;
        // (本来はここで lines の内容を描画して Context を復元すべきだが、
        //  リアルタイム性を重視して省略するか、前行の結果を簡易的に使う)

        // 指定された行だけループ
        for (const rowIdx of rows) {
            // 行座標計算
            const y = PADDING_TOP + (rowIdx * lineH) + (lineH / 2) + Y_OFFSET;
            
            if (y > canvas.height) continue;

            // マスク取得
            let rowMaskData: Uint8ClampedArray | null = null;
            if (tempCtx) {
                const maskY = Math.floor(y - 16);
                if (maskY >= 0 && maskY + 32 <= canvas.height) {
                    rowMaskData = tempCtx.getImageData(0, maskY, w, 32).data;
                }
            }

            // 推論実行
            const resultObj = await engine.solveLine(
                baseFeatures,
                w,
                targetCharBlue.value,
                targetCharRed.value,
                rowMaskData,
                y,
                config.value.generationMode, // 'hybrid' or 'accurate'
                null,
                null,
                config.value.bbsMode,
                config.value.useThinSpace,
                null, // debugCanvasは描画しない
                null  // accumulatedCanvas (Context) も省略 (Code Aだと精度落ちるが速度優先)
            );

            // 行末トリミング
            let lineText = resultObj.text;
            lineText = lineText.replace(/[ 　\u2009]+$/, '');
            
            // 結果を配列に反映
            // 配列が足りない場合は拡張
            while (lines.length <= rowIdx) {
                lines.push("");
            }
            lines[rowIdx] = lineText;
        }

        // 結合して返す (末尾トリム含む)
        let result = lines.join('\n');
        result = result.replace(/\n+$/, '');
        
        return result;
    };

    return {
        // ... (元の戻り値と同じ) ...
        initEngine, updateAllowedChars, runGeneration, resetConfig,
        config, customFontName, status, isReady, isProcessing,
        targetCharBlue, targetCharRed, debugCanvasRef, engine, getSuggestion, getCandidates,cancelGeneration, generateRows
    };


}