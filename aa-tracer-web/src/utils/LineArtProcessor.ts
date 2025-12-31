import * as ort from 'onnxruntime-web';

//const BASE_URL = import.meta.env.BASE_URL;

export class LineArtProcessor {
    private session: ort.InferenceSession | null = null;
    private isLoaded = false;
    
    // AIに入力する固定サイズ (Anime2Sketchは512以上でも動きますが、1024が画質と速度のバランスが良いです)
    // ※必ず 32 や 64 の倍数であること。
    private readonly MODEL_INPUT_SIZE = 1024; 

    async init(modelName: string = 'anime2sketch.onnx') {
        if (this.isLoaded) return;

        //const modelPath = BASE_URL === '/' ? `/${modelName}` : `${BASE_URL}${modelName}`;
        const modelPath = modelName;
        console.log(`[LineArt] Loading model from: ${modelPath}`);

        try {
            this.session = await ort.InferenceSession.create(modelPath, {
                executionProviders: ['wasm'], 
                graphOptimizationLevel: 'all'
            });
            this.isLoaded = true;
            console.log('[LineArt] Model loaded successfully');
        } catch (e) {
            console.error('[LineArt] Failed to load model', e);
            throw e;
        }
    }

    async process(
        sourceElement: HTMLImageElement | HTMLCanvasElement
    ): Promise<HTMLCanvasElement> {
        if (!this.session) throw new Error("Model not initialized");

        // 1. 前処理: 正方形キャンバスへのパディング
        const { inputTensor, validW, validH } = this.preprocess(sourceElement);

        // 2. 推論
        const feeds: Record<string, ort.Tensor> = {};
        const inputNames = this.session.inputNames;
        feeds[inputNames[0]!] = inputTensor;

        console.log(`[LineArt] Inference start. Input fixed to: ${this.MODEL_INPUT_SIZE}x${this.MODEL_INPUT_SIZE}`);
        const start = performance.now();
        
        let results;
        try {
            results = await this.session.run(feeds);
        } catch(e) {
            // エラー詳細をコンソールに出して再スロー
            console.error("[LineArt] Inference execution failed:", e);
            throw e;
        }
        
        console.log(`[LineArt] Done in ${performance.now() - start}ms`);

        // 3. 後処理: 有効領域のみ切り抜き
        const outputName = this.session.outputNames[0];
        const outputTensor = results[outputName!]!;
        
        return this.postprocess(outputTensor, validW, validH, sourceElement.width, sourceElement.height);
    }

    private preprocess(img: HTMLImageElement | HTMLCanvasElement) {
        const w = img.width;
        const h = img.height;
        
        // 長辺を MODEL_INPUT_SIZE に合わせるスケール
        const scale = Math.min(this.MODEL_INPUT_SIZE / w, this.MODEL_INPUT_SIZE / h);
        
        // リサイズ後の画像サイズ
        const validW = Math.round(w * scale);
        const validH = Math.round(h * scale);

        // 正方形の作業用キャンバスを作成
        const canvas = document.createElement('canvas');
        canvas.width = this.MODEL_INPUT_SIZE;
        canvas.height = this.MODEL_INPUT_SIZE;
        const ctx = canvas.getContext('2d')!;
        
        // 全体を白で埋める（パディング部分）
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, this.MODEL_INPUT_SIZE, this.MODEL_INPUT_SIZE);
        
        // 左上に画像を配置
        // (中央寄せよりも座標計算が楽で、モデルの特性上も端にあっても問題ない)
        ctx.drawImage(img, 0, 0, validW, validH);

        const imageData = ctx.getImageData(0, 0, this.MODEL_INPUT_SIZE, this.MODEL_INPUT_SIZE);
        const { data } = imageData;

        // Tensor作成 [1, 3, SIZE, SIZE]
        const float32 = new Float32Array(3 * this.MODEL_INPUT_SIZE * this.MODEL_INPUT_SIZE);
        
        for (let i = 0; i < this.MODEL_INPUT_SIZE * this.MODEL_INPUT_SIZE; i++) {
            // Anime2Sketch Normalize: [-1, 1]
            const r = (data[i * 4]! / 127.5) - 1.0;
            const g = (data[i * 4 + 1]! / 127.5) - 1.0;
            const b = (data[i * 4 + 2]! / 127.5) - 1.0;

            float32[i] = r; 
            float32[this.MODEL_INPUT_SIZE * this.MODEL_INPUT_SIZE + i] = g;
            float32[2 * this.MODEL_INPUT_SIZE * this.MODEL_INPUT_SIZE + i] = b;
        }

        const tensor = new ort.Tensor('float32', float32, [1, 3, this.MODEL_INPUT_SIZE, this.MODEL_INPUT_SIZE]);
        
        // validW, validH は後で切り抜くために返す
        return { inputTensor: tensor, validW, validH };
    }

    private postprocess(tensor: ort.Tensor, validW: number, validH: number, origW: number, origH: number): HTMLCanvasElement {
        const data = tensor.data as Float32Array;
        
        // 出力データも正方形サイズで返ってくる
        const canvas = document.createElement('canvas');
        canvas.width = this.MODEL_INPUT_SIZE;
        canvas.height = this.MODEL_INPUT_SIZE;
        const ctx = canvas.getContext('2d')!;
        const imgData = ctx.createImageData(this.MODEL_INPUT_SIZE, this.MODEL_INPUT_SIZE);
        
        for (let i = 0; i < data.length; i++) {
            let val = data[i]!;
            // [-1, 1] -> [0, 255]
            let pixel = (val + 1.0) * 127.5;
            pixel = Math.max(0, Math.min(255, pixel));

            imgData.data[i * 4] = pixel;     // R
            imgData.data[i * 4 + 1] = pixel; // G
            imgData.data[i * 4 + 2] = pixel; // B
            imgData.data[i * 4 + 3] = 255;   // A
        }
        
        ctx.putImageData(imgData, 0, 0);

        // ★ここが重要: パディングした白余白を捨てて、元の画像部分だけを取り出し、元のサイズにリサイズして返す
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = origW;
        finalCanvas.height = origH;
        const fCtx = finalCanvas.getContext('2d')!;
        
        // drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
        // 作業用Canvasの (0,0) から (validW, validH) までを切り出し、
        // 最終Canvasの (0,0) から (origW, origH) に引き伸ばして描画
        fCtx.drawImage(canvas, 0, 0, validW, validH, 0, 0, origW, origH);
        
        return finalCanvas;
    }
}