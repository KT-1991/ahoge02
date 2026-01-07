import * as ort from 'onnxruntime-web';
import { FeatureExtractor } from './FeatureExtractor';

const BASE_URL = import.meta.env.BASE_URL;

// Vector DBのエントリ定義
export interface VectorDbEntry {
    char: string;
    vector: Float32Array; // 128次元Embedding
    width: number;
}

export interface CharInfo {
  char: string;
  width: number;
  vector: Float32Array | null;
  pixelCount: number;
}

// 標準的な文字リスト（フォールバック用）
export const DEFAULT_CHARS = (() => {
    let chars = " "; 
    for (let i = 33; i < 127; i++) chars += String.fromCharCode(i);
    for (let i = 0xFF61; i < 0xFFA0; i++) chars += String.fromCharCode(i);
    chars += "\u3000";
    chars += "─│┌┐└┘├┤┬┴┼━┃┏┓┛┗┣┳┫┻╋";
    chars += "｡､･ﾟヽヾゝゞ／＼⊂⊃∪∩∀´｀・…ω";
    return chars;
})();

export class InferenceEngine {
  session: ort.InferenceSession | null = null;
  // Code Aにベクトル検索はないが、Code Bとの互換性のために残す（今回は使わない）
  charDb: CharInfo[] = [];
  private modelVocab: Set<string> = new Set();
  mode: 'vector' | 'classifier' = 'classifier';

  // ★追加: コードB用のセッションとDB
  encoderSession: ort.InferenceSession | null = null;
  vectorDb: VectorDbEntry[] = [];
  
  private fullClassList: string[] = [];
  private activeClassMask: boolean[] = [];
  private allowedCharSet: Set<string> = new Set();
  charWidthCache: Map<string, number> = new Map();
  private coordMap: Float32Array | null = null;
  private coordMapVector: Float32Array | null = null; // コードB用マップ

  fontName = 'Saitamaar';

  // ★追加: 各種スペースの幅を保持するキャッシュ
  spaceWidths = {
      half: 8.0,
      full: 16.0,
      thin: 2.0 // デフォルト値（実測で上書きされる）
  };

  async init(
      modelUrl: string, encoderUrl: string, fontUrl: string, jsonUrl: string, 
      mode: 'vector' | 'classifier' = 'classifier', fontName: string = 'Saitamaar'
  ) {
    console.log(mode);
    const fixPath = (path: string) => {
        if (path.startsWith('http')) return path;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return BASE_URL === '/' ? `/${cleanPath}` : `${BASE_URL}${cleanPath}`;
    };

    const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
    ort.env.wasm.wasmPaths = onnxPath;
    ort.env.wasm.numThreads = 2; // 少し増やす

    this.coordMap = FeatureExtractor.createCoordMap();
    this.coordMapVector = FeatureExtractor.createCoordMapVector();

    // 文字リストロード
    try {
        const response = await fetch(fixPath(jsonUrl));
        if (response.ok) {
            const charList: string[] = await response.json();
            this.fullClassList = charList.map(c => (c === '<UNK>' || c === '<BOS>') ? ' ' : c);
        } else {
            this.fullClassList = DEFAULT_CHARS.split('');
        }
        // ★追加: 学習済み語彙セットを保存しておく
        this.modelVocab = new Set(this.fullClassList);
    } catch (e) {
        console.error("Failed to load char list", e);
        this.fullClassList = DEFAULT_CHARS.split('');
        this.modelVocab = new Set(this.fullClassList);
    }
    

    // モデルロード (Code A: Classifier)
    try {
        // modelUrl should be 'aa_model_a.onnx'
        this.session = await ort.InferenceSession.create(fixPath(modelUrl), { executionProviders: ['wasm'] });
        console.log("Model A Loaded");
    } catch (e) { console.error("Model Load Error", e); }

    // ★追加: モデルロード (Code B: Encoder)
    // encoderUrl (aa_model_b.onnx) をロード
    try {
        this.encoderSession = await ort.InferenceSession.create(fixPath(encoderUrl), { executionProviders: ['wasm'] });
        console.log("Model B (Encoder) Loaded");
    } catch (e) { console.error("Model B Load Error", e); }

    // ★追加: 初回のDB構築
    // classifierモードでも裏で作っておくと切り替えがスムーズです
    await this.updateDatabase(fontUrl ? fixPath(fontUrl) : null, this.fullClassList.join(''), fontName);

    // フォントロードと幅計算
    if (fontUrl && fontUrl.startsWith('blob:')) {
        const font = new FontFace(fontName, `url(${fontUrl})`);
        await font.load();
        document.fonts.add(font);
    }
    this.fontName = fontName;
    // 全文字許可状態で初期化
    this.updateAllowedChars(this.fullClassList.join(''));

  }

// ベクトル検索 (コサイン類似度)
  searchVectorDb(queryVector: Float32Array, topK: number = 20) {
      if (this.vectorDb.length === 0) return [];

      // クエリベクトルの正規化 (L2 Normalize)
      let norm = 0;
      for(let i=0; i<queryVector.length; i++) norm += queryVector[i]! * queryVector[i]!;
      norm = Math.sqrt(norm);
      const q = new Float32Array(queryVector.length);
      if (norm > 1e-6) {
          for(let i=0; i<queryVector.length; i++) q[i] = queryVector[i]! / norm;
      }

      // 全探索 (文字数が数千程度ならJSでも高速)
      const scores = this.vectorDb.map(entry => {
          // 許可文字チェック
          if (this.allowedCharSet.size > 0 && !this.allowedCharSet.has(entry.char)) {
              return { char: entry.char, score: -1.0, width: entry.width };
          }

          // ドット積 (正規化済みなので = コサイン類似度)
          let dot = 0;
          const v = entry.vector;
          for(let i=0; i<128; i++) dot += q[i]! * v[i]!;
          
          return { char: entry.char, score: dot, width: entry.width };
      });

      // スコア順ソート
      scores.sort((a, b) => b.score - a.score);
      return scores.slice(0, topK);
  }

// ★修正: updateDatabase内でモード自動判定を行う
  async updateDatabase(fontUrl: string | null, charList: string, fontName: string) {
    // ガード処理 (前回の修正分)
    if (!this.coordMapVector) this.coordMapVector = FeatureExtractor.createCoordMapVector();
    if (!this.coordMap) this.coordMap = FeatureExtractor.createCoordMap();

    this.fontName = fontName;
    if (fontUrl && fontUrl.startsWith('blob:')) {
        const font = new FontFace(fontName, `url(${fontUrl})`);
        await font.load();
        document.fonts.add(font);
    }
    
    // 許可文字リストの更新
    // ここで charList はユーザーが設定画面で指定した「使いたい文字すべて」
    const uniqueChars = Array.from(new Set(charList.split('')));
    const uniqueCharsStr = uniqueChars.join('');

    // --- ★ モード自動判定ロジック ---
    // 条件1: フォントがデフォルト(Saitamaar)であること
    const isDefaultFont = (fontName === 'Saitamaar');
    
    // 条件2: 要求された文字がすべて「モデルの学習済み語彙」に含まれていること
    // (1文字でも未知の文字があれば、分類モデルはそれを出力できないのでVectorモードへ行く)
    const isSubset = uniqueChars.every(c => this.modelVocab.has(c));

    if (isDefaultFont && isSubset) {
        this.mode = 'classifier';
        console.log(`Mode Auto-Selected: CLASSIFIER (Default font & Known chars)`);
        
        // 分類モード用のマスク更新
        this.updateAllowedChars(uniqueCharsStr);
        // ClassifierモードでもVector DBは作っておく（念のため、または将来のハイブリッド利用のため）
    } else {
        this.mode = 'vector';
        console.log(`Mode Auto-Selected: VECTOR (Custom font OR Unknown chars detected)`);
        
        // 分類用マスクも一応更新しておく
        this.updateAllowedChars(uniqueCharsStr);
    }

    // メトリクス更新
    this.updateFontMetrics(fontName, uniqueCharsStr);

    // --- Vector DB 構築 (常に最新の charList で作り直す) ---
    // Vectorモードなら必須。Classifierモードでも作っておいて損はない。
    if (this.encoderSession) {
        // ... (以前実装したVector DB構築ロジックそのまま) ...
        // uniqueChars をループして DB を再構築する処理
        
        // ※コード省略なしで書くと長くなるので、前回の buildVectorDB ロジックをここに記述してください
        // ポイントは、ループ対象を `uniqueChars` (ユーザー指定の全文字) にすることです。
        
        console.time("VectorDB Build");
        this.vectorDb = [];
        const C = FeatureExtractor.CROP_SIZE;
        const canvas = document.createElement('canvas');
        canvas.width = C; canvas.height = C;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        
        for (const char of uniqueChars) {
             // ... 文字描画 ...
             ctx.fillStyle = "white"; ctx.fillRect(0, 0, C, C);
             ctx.fillStyle = "black";
             ctx.font = `16px "${this.fontName}"`;
             ctx.textBaseline = "alphabetic";
             const metrics = ctx.measureText(char);
             const x = (C - metrics.width) / 2;
             const y = (C + 16) / 2 - 2;
             ctx.fillText(char, x, y);

             // ... エンコード ...
             const features = FeatureExtractor.generateVectorInput(canvas, this.coordMapVector!);
             const tensor = new ort.Tensor('float32', features, [1, C, C, 6]);
             const inputName = this.encoderSession.inputNames[0];
             const feeds: any = {};
             feeds[inputName!] = tensor;
             
             try {
                 const res = await this.encoderSession.run(feeds);
                 const outName = this.encoderSession.outputNames[0];
                 const vector = res[outName!]!.data as Float32Array;
                 this.vectorDb.push({
                     char: char,
                     vector: vector,
                     width: this.charWidthCache.get(char) || 8.0
                 });
             } catch(e) {}
        }
        console.timeEnd("VectorDB Build");
        console.log(`DB Rebuilt: ${this.vectorDb.length} chars (Mode: ${this.mode})`);
    }
  }

  updateAllowedChars(allowedChars: string) {
      this.allowedCharSet = new Set(allowedChars.split(''));
      if (this.fullClassList.length > 0) {
          this.activeClassMask = this.fullClassList.map(c => this.allowedCharSet.has(c));
      }
      this.updateFontMetrics(this.fontName, allowedChars);
  }

updateFontMetrics(fontName: string, allowedChars: string) {
      //this.currentFontName = fontName;
      this.charWidthCache.clear();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `16px "${fontName}"`; 
      
      const uniqueChars = Array.from(new Set(allowedChars.split('')));
      uniqueChars.forEach(c => {
          const w = ctx.measureText(c).width;
          this.charWidthCache.set(c, w);
      });

      // ★修正: 各種スペースの幅を実測してキャッシュする
      // リストに含まれていなくても必ず計測する
      this.spaceWidths.half = ctx.measureText(' ').width;
      this.spaceWidths.full = ctx.measureText('　').width;
      this.spaceWidths.thin = ctx.measureText('\u2009').width; // Thin Space

      // キャッシュにも入れておく（検索用）
      this.charWidthCache.set(' ', this.spaceWidths.half);
      this.charWidthCache.set('　', this.spaceWidths.full);
      this.charWidthCache.set('\u2009', this.spaceWidths.thin);
  }

  // Code A: Beam Search Implementation
  async solveLine(
    baseFeatures: any, // FeatureExtractor.generateBaseFeatures の戻り値
    width: number,
    blueChar: string, redChar: string, 
    paintMaskData: Uint8ClampedArray | null, 
    lineCenterY: number, 
    generationMode: 'hybrid' | 'accurate', 
    measureCtx: CanvasRenderingContext2D | null,
    prevBottomEdge: any, // 今回は未使用だがIF合わせのため残す
    bbsMode: boolean,
    useThinSpace: boolean,
    debugCanvas: HTMLCanvasElement | null = null,
    globalContextCanvas: HTMLCanvasElement | null = null
  ): Promise<{ text: string, bottomEdge: Float32Array | null }> {

    console.log(generationMode, prevBottomEdge, debugCanvas, measureCtx);
    if (!this.session) return { text: "", bottomEdge: null };

    // 文字のバリデーション関数（再掲 + 少し修正）
    const validateAndFixChar = (char: string, currentText: string, lastChar: string): string | null => {
        if (!useThinSpace && char === '\u2009') return null;
        
        if (bbsMode) {
            // 行頭: 半角スペース -> 全角
            if (char === ' ' && currentText === "") return '　';
            // 連続半角スペース: 半角 -> 全角
            if (char === ' ' && lastChar === ' ') return '　';
        }
        return char;
    };

    // ★追加: 現在位置のハッチング文字を取得するヘルパー
    // 塗られていればその文字を、塗られていなければ null を返す
    const getHatchingChar = (centerX: number): string | null => {
        if (!paintMaskData) return null;
        const maskX = Math.floor(centerX + 4);
        if (maskX < 0 || maskX >= width) return null;

        // 中心付近 (y=16) の色を確認
        const idx = (16 * width + maskX) * 4;
        const r = paintMaskData[idx]!;
        const b = paintMaskData[idx + 2]!;

        if (r > 128 && redChar.length > 0) return redChar;
        if (b > 128 && blueChar.length > 0) return blueChar;
        return null;
    };

    // ★追加: パターンの次の文字を決定する関数
    // 例: pattern="i;", lastChar="i" -> returns ";"
    // 例: pattern="i;", lastChar=";" -> returns "i"
    // 例: pattern="i;", lastChar="A" -> returns "i" (初回)
    const getNextPatternChar = (pattern: string, lastChar: string): string => {
        if (!pattern) return "";
        
        // 直前の文字がパターン内のどこにあるか探す
        const idx = pattern.indexOf(lastChar);
        
        if (idx === -1) {
            // パターン外の文字（ハッチング開始時など）なら1文字目から
            return pattern[0]!;
        } else {
            // 次の文字（末尾なら先頭へループ）
            return pattern[(idx + 1) % pattern.length]!;
        }
    };

    // ★追加: 空白エリアで「どのスペースを試すべきか」を生成してビームに追加する関数
    // Code A / Code B 共通で使用
// ★修正: SpaceBeams生成ロジック
    // ハッチングエリア内なら、スペースの代わりにハッチング文字を候補に入れる
    const addSpaceBeams = (beamsList: any[], currentBeam: any, baseCost: number, centerX: number) => {
        const hatchStr = getHatchingChar(centerX);

        if (hatchStr) {
            const nextChar = getNextPatternChar(hatchStr, currentBeam.lastChar);
            
            const charToUse = validateAndFixChar(nextChar, currentBeam.text, currentBeam.lastChar);
            
            if (charToUse) {
                const w = this.charWidthCache.get(charToUse) || 8.0;
                beamsList.push({
                    x: currentBeam.x + w,
                    cost: baseCost, // コスト変動なし
                    text: currentBeam.text + charToUse,
                    lastChar: charToUse,
                    ctxSnapshot: currentBeam.ctxSnapshot 
                });
            }
        } else {
            // ■ 通常エリア: 既存のスペースロジック
            const candidates = [' ', '　'];
            if (useThinSpace) candidates.push('\u2009');
            
            const triedChars = new Set<string>();
            for (const rawSpace of candidates) {
                const spaceChar = validateAndFixChar(rawSpace, currentBeam.text, currentBeam.lastChar);
                if (spaceChar === null || triedChars.has(spaceChar)) continue;
                triedChars.add(spaceChar);

                let w = 8.0;
                if (spaceChar === ' ') w = this.spaceWidths.half;
                else if (spaceChar === '　') w = this.spaceWidths.full;
                else if (spaceChar === '\u2009') w = this.spaceWidths.thin;

                beamsList.push({
                    x: currentBeam.x + w,
                    cost: baseCost, 
                    text: currentBeam.text + spaceChar,
                    lastChar: spaceChar,
                    ctxSnapshot: currentBeam.ctxSnapshot 
                });
            }
        }
    };

    // ==========================================
    // ★ 分岐: Vector Mode (Code B: Sliding Window Beam Search)
    // ==========================================
    if (this.mode === 'vector' && this.encoderSession) {
        
        // InkEater(残差処理)は廃止し、シンプルなビームサーチ状態管理にします
        const BEAM_WIDTH = 3;
        // ビーム状態: x, cost, text, lastChar
        let beams = [{ x: 0.0, cost: 0, text: "", lastChar: "", ctxSnapshot: null as any }]; 
        // ※Code BでもctxSnapshot等の構造を合わせるなら修正が必要ですが、
        // 前回のCode B実装は simple object でした。
        // ここでは Code B のロジックに合わせて書き換えます。

        const PADDING_LEFT = 10;
        const maxSteps = width * 2;
        let step = 0;

        while (beams.length > 0 && step < maxSteps) {
            const newBeams = [];
            const finishedBeams = [];

            for (const b of beams) {
                // 終了判定
                if (b.x >= width - 4) {
                    finishedBeams.push(b); continue;
                }
                // 中心座標 (パディング考慮)
                const centerX = b.x + PADDING_LEFT;

                

                // --- 1. 特徴量抽出 ---
                const patch = FeatureExtractor.extractPatchVector(
                    baseFeatures,
                    centerX,
                    lineCenterY,
                    this.coordMapVector!
                );

                // --- 2. 空白判定 (Empty Check) ---
                // パッチ中心付近のインク量(Srcチャンネル)を確認
                // Srcは 0.0(Bg) ～ 1.0(Ink)
                let inkSum = 0;
                for(let dy=16; dy<32; dy++) {
                    for(let dx=16; dx<32; dx++) {
                        // 6ch [Src, Dist, Sin, Cos, X, Y] なので index 0
                        inkSum += patch[(dy*48+dx)*6 + 0]!;
                    }
                }

                // 閾値チェック (Srcは0-1正規化済みなので、ピクセル数より小さい値になる)
                // 15.0 くらいを下回れば空白とみなす
                if (inkSum < 15.0) {
                    // ★修正: 単一スペースではなく、addSpaceBeamsを使って分岐させる
                    // ※Code BはContext Snapshotを使っていないので、ダミーを渡すか構造を合わせる
                    // ここでは簡易的に b をそのまま拡張します
                    const bObj = { ...b, ctxSnapshot: null }; // 互換用ラッパー
                    addSpaceBeams(newBeams, bObj, b.cost, centerX);
                    continue; 
                }

                // --- 3. 推論実行 (Encoder) ---
                const tensor = new ort.Tensor('float32', patch, [1, 48, 48, 6]);
                const inputName = this.encoderSession.inputNames[0];
                const feeds: any = {};
                feeds[inputName!] = tensor;
                
                const res = await this.encoderSession.run(feeds);
                const outName = this.encoderSession.outputNames[0];
                const vector = res[outName!]!.data as Float32Array;
                
                // --- 4. 候補検索 ---
                const candidates = this.searchVectorDb(vector, 5);

                for (const cand of candidates) {
                    // ★修正: 候補がスペース系だった場合、ハッチングエリアなら差し替える
                    let charCandidate = cand.char;
                    
                    // 候補がスペース(または類似の空白)の場合
                    if (charCandidate === ' ' || charCandidate === '　'|| charCandidate === '\u2009') {
                        const hatchStr = getHatchingChar(centerX);
                        if (hatchStr) {
                            // ハッチング文字の先頭を採用（または全候補試すべきだが、ここでは代表1つ）
                            // 厳密にはここでもループすべきだが、類似度検索の結果なので1つに絞る
                            charCandidate = getNextPatternChar(hatchStr, b.lastChar);
                    }
                    }

                    const charToUse = validateAndFixChar(cand.char, b.text, b.lastChar);
                    if (charToUse === null) continue;

                    let stepCost = (1.0 - cand.score) * 10.0;
                    if (stepCost < 0) stepCost = 0;

                    if (b.lastChar === charToUse) stepCost += 10.0;
                    if (b.text.length > 1 && b.text[b.text.length - 2] === charToUse) stepCost += 5.0;

                    const w = this.charWidthCache.get(charToUse) || 8.0;

                    newBeams.push({
                        x: b.x + w,
                        cost: b.cost + stepCost,
                        text: b.text + charToUse,
                        lastChar: charToUse
                    });
                }
            }
            
            newBeams.sort((a, b) => a.cost - b.cost);
            beams = newBeams.slice(0, BEAM_WIDTH) as any;
            beams.push(...finishedBeams);
            if (beams.length > 0 && beams.every(b => b.x >= width - 4)) break;
            step++;
        }
        beams.sort((a, b) => a.cost - b.cost);
        return { text: beams[0]?.text || "", bottomEdge: null };
    }
// ==========================================
    // ★ Classifier Mode (Code A)
    // ==========================================
    
    // ... (Canvas初期化などはそのまま) ...
    const rowCanvas = document.createElement('canvas');
    rowCanvas.width = width;
    rowCanvas.height = FeatureExtractor.CROP_SIZE;
    const ctx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
    ctx.font = `16px "${this.fontName}"`; // ★フォント設定
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, FeatureExtractor.CROP_SIZE);
    if (globalContextCanvas) {
        const srcY = lineCenterY - (FeatureExtractor.CROP_SIZE / 2);
        ctx.drawImage(globalContextCanvas, 0, srcY, width, FeatureExtractor.CROP_SIZE, 0, 0, width, FeatureExtractor.CROP_SIZE);
    }
    ctx.fillStyle = "black"; ctx.textBaseline = "middle";

    const BEAM_WIDTH = 3;
    let beams = [{ 
        x: 0.0, cost: 0, text: "", lastChar: "",
        ctxSnapshot: ctx.getImageData(0,0,width,FeatureExtractor.CROP_SIZE)
    }];
    const PADDING_LEFT = 10;
    const maxSteps = width * 2;
    let step = 0;

    while (beams.length > 0 && step < maxSteps) {
        const newBeams = [];
        const finishedBeams = [];

        for (const b of beams) {
            if (b.x >= width - 4) { finishedBeams.push(b); continue; }
            const centerX = b.x + PADDING_LEFT;

            // 特徴量抽出
            ctx.putImageData(b.ctxSnapshot, 0, 0);
            const patch = FeatureExtractor.extractPatch7Ch(
                baseFeatures, rowCanvas, centerX, lineCenterY, this.coordMap!
            );

            // 空白判定 (Code A)
            let centerDensitySum = 0;
            for (let dy = 16; dy < 32; dy++) {
                for (let dx = 20; dx < 28; dx++) {
                    centerDensitySum += patch[(dy * 48 + dx) * 7 + 2]!;
                }
            }

            if (centerDensitySum < 1500.0) {
                // ★修正: addSpaceBeams を呼ぶ (内部でハッチング判定)
                addSpaceBeams(newBeams, b, b.cost, centerX);
                continue;
            }

            // 推論実行 (省略: 前回のまま)
            const tensor = new ort.Tensor('float32', patch.map(v => v / 255.0), [1, 48, 48, 7]);
            const inputName = this.session.inputNames[0];
            const feeds: any = {}; feeds[inputName!] = tensor;
            const results = await this.session.run(feeds);
            const outputName = this.session.outputNames[0];
            const logits = results[outputName!]!.data as Float32Array;
            const candidates = this.getMaskedTopK(logits, 5);

            for (const cand of candidates) {
                // ★修正: 候補がスペースだった場合のハッチング置換
                let charCandidate = cand.char;
                if (charCandidate === ' ' || charCandidate === '　'|| charCandidate === '\u2009') {
                    const hatchStr = getHatchingChar(centerX);
                    if (hatchStr) {
                         charCandidate = getNextPatternChar(hatchStr, b.lastChar);
                    }
                }
                const charToUse = validateAndFixChar(cand.char, b.text, b.lastChar);
                if (charToUse === null) continue;

                const maxLogit = candidates[0]!.score;
                const probCost = (maxLogit! - cand.score!);
                
                let repPenalty = 0.0;
                if (b.lastChar === charToUse) repPenalty = 0.0;
                if (b.text.length > 1 && b.text[b.text.length - 2] === charToUse) repPenalty = 0.0;

                const stepCost = probCost + repPenalty;
                const w = this.charWidthCache.get(charToUse) || 8.0;

                ctx.putImageData(b.ctxSnapshot, 0, 0);
                ctx.fillText(charToUse, b.x, 24); 

                newBeams.push({
                    x: b.x + w,
                    cost: b.cost + stepCost,
                    text: b.text + charToUse,
                    lastChar: charToUse,
                    ctxSnapshot: ctx.getImageData(0, 0, width, FeatureExtractor.CROP_SIZE)
                });
            }
        }
        
        newBeams.sort((a, b) => a.cost - b.cost);
        beams = newBeams.slice(0, BEAM_WIDTH);
        beams.push(...finishedBeams);
        if (beams.length > 0 && beams.every(b => b.x >= width - 4)) break;
        step++;
    }
    
    beams.sort((a, b) => a.cost - b.cost);
    return { text: beams[0]?.text || "", bottomEdge: null };
  }

  private getMaskedTopK(logits: Float32Array, k: number) {
      const candidates = [];
      const len = Math.min(logits.length, this.activeClassMask.length);
      for (let i = 0; i < len; i++) {
          if (this.activeClassMask[i]) {
              candidates.push({ index: i, score: logits[i] });
          }
      }
      candidates.sort((a, b) => b.score! - a.score!); // 降順
      
      const top = candidates.slice(0, k);
      return top.map(c => ({
          char: this.fullClassList[c.index] || ' ',
          score: c.score
      }));
  }

  // ... Vector関連のメソッドはCode B統合時に実装 ...
  getLoadedCharList() { return Array.from(this.allowedCharSet).join(''); }
  getSafeCharList() { return DEFAULT_CHARS; }

  /**
   * ゴーストサジェスト用: 指定位置から数文字分を予測する
   */
  async suggestText(
    baseFeatures: any,
    localCenterX: number, // ROI内でのX座標
    localCenterY: number, // ROI内でのY座標 (通常24)
    blueChar: string, 
    redChar: string,
    maxChars: number = 3,
    paintMaskData: Uint8ClampedArray | null = null,
    globalRoiX: number = 0, // ROIの左端が全体画像のどこにあるか
    maskStride: number = 0
  ): Promise<string> {
      
      let currentX = localCenterX;
      let resultText = "";

      // 直前の文字（パターン継続用）。
      // ゴーストは「カーソル直後の文字」を予測するため、本来は「カーソル直前の文字」を知る必要がありますが、
      // ここでは簡易的に空文字スタートとします（入力済みの文字との連続性は考慮しない制限あり）。
      let lastChar = ""; 

      // ヘルパー: パターン取得 (solveLineと同じロジック)
      const getNextPatternChar = (pattern: string, prevChar: string): string => {
          if (!pattern) return "";
          const idx = pattern.indexOf(prevChar);
          if (idx === -1) return pattern[0]!;
          return pattern[(idx + 1) % pattern.length]!;
      };

      /// ヘルパー: ハッチング文字判定
      const getHatchingChar = (localX: number): string | null => {
          if (!paintMaskData) return null;
          
          // ROI内座標 -> グローバル座標
          // +4 は中心付近を見るための補正
          const globalX = Math.floor(globalRoiX + localX + 4); 
          
          // 範囲チェック (maskStride に対して行う)
          if (globalX < 0 || globalX >= maskStride) return null;

          // ★修正: インデックス計算に maskStride (実際の画像データの幅) を使う
          // これが canvas.width と異なっているとズレる原因になります
          const idx = (16 * maskStride + globalX) * 4;
          
          // 配列範囲外チェック (念のため)
          if (idx < 0 || idx >= paintMaskData.length) return null;

          const r = paintMaskData[idx]!;
          const b = paintMaskData[idx + 2]!;

          if (r > 128 && redChar.length > 0) return redChar;
          if (b > 128 && blueChar.length > 0) return blueChar;
          return null;
      };
      
      // CoordMap (48x48) - 共通
      const C = FeatureExtractor.CROP_SIZE; // 48
      
      // ループ (最大 maxChars 文字)
      for (let i = 0; i < maxChars; i++) {
          // 画像範囲外チェック
          if (currentX >= baseFeatures.width - 4) break;

          // 1. パッチ抽出
          let patch: Float32Array;
          if (this.mode === 'vector') {
              // Vector Mode (6ch)
              patch = FeatureExtractor.extractPatchVector(
                  baseFeatures, currentX, localCenterY, this.coordMapVector!
              );
          } else {
              // Classifier Mode (7ch)
              // Context Canvas は無いので、一旦「白(背景)」として扱う
              // (ゴーストなので直前の文字入力は考慮しない、あるいは直前の文字画像を作るのはコスト高)
              const dummyContext = document.createElement('canvas');
              dummyContext.width = C; dummyContext.height = C;
              const ctx = dummyContext.getContext('2d')!;
              ctx.fillStyle = "white"; ctx.fillRect(0,0,C,C); // 白=背景
              
              patch = FeatureExtractor.extractPatch7Ch(
                  baseFeatures, dummyContext, currentX, localCenterY, this.coordMap!
              );
          }

          // 2. 空白判定 (Empty Check)
          // 2. 空白判定 & ハッチングチェック
          let inkSum = 0;
          const chIdx = (this.mode === 'vector') ? 0 : 2; 
          const channels = (this.mode === 'vector') ? 6 : 7;
          for(let dy=16; dy<32; dy++) {
              for(let dx=16; dx<32; dx++) inkSum += patch[(dy*48+dx)*channels + chIdx]!;
          }
          
          
          const threshold = (this.mode === 'vector') ? 15.0 : 1500.0;
          
          // ★推論前の空白チェック
          if (inkSum < threshold) {
              let charToAppend = " ";
              
              // ハッチングチェック
              const hatchStr = getHatchingChar(currentX);
              if (hatchStr) {
                  charToAppend = getNextPatternChar(hatchStr, lastChar);
              }

              if (i === 0) { // 1文字目
                  resultText += charToAppend;
                  lastChar = charToAppend;
                  const w = this.charWidthCache.get(charToAppend) || 8.0;
                  currentX += w;
                  continue; 
              } else {
                  // 2文字目以降の空白はサジェスト終了（ハッチング時は続ける手もあるが、一旦終了で統一）
                  if (!hatchStr) break; 
                  
                  // ハッチングなら続ける
                  resultText += charToAppend;
                  lastChar = charToAppend;
                  const w = this.charWidthCache.get(charToAppend) || 8.0;
                  currentX += w;
                  continue;
              }
          }

          // 3. 推論実行
          let bestChar = "";
          let bestWidth = 8.0;

          if (this.mode === 'vector' && this.encoderSession) {
              const tensor = new ort.Tensor('float32', patch, [1, 48, 48, 6]);
              const inputName = this.encoderSession.inputNames[0];
              const feeds: any = {}; feeds[inputName!] = tensor;
              const res = await this.encoderSession.run(feeds);
              const vector = res[this.encoderSession.outputNames[0]!]!.data as Float32Array;
              
              const candidates = this.searchVectorDb(vector, 1);
              if (candidates.length > 0) {
                  bestChar = candidates[0]!.char;
                  bestWidth = candidates[0]!.width;
              }
          } else if (this.session) { // Classifier
              const tensor = new ort.Tensor('float32', patch.map(v=>v/255.0), [1, 48, 48, 7]);
              const inputName = this.session.inputNames[0];
              const feeds: any = {}; feeds[inputName!] = tensor;
              const res = await this.session.run(feeds);
              const logits = res[this.session.outputNames[0]!]!.data as Float32Array;
              
              const candidates = this.getMaskedTopK(logits, 1);
              if (candidates.length > 0) {
                  bestChar = candidates[0]!.char;
                  bestWidth = this.charWidthCache.get(bestChar) || 8.0;
              }
          }

          if (bestChar) {
              // ★推論結果のハッチング置換
              if (bestChar === ' ' || bestChar === '　' || bestChar === '\u2009') {
                  const hatchStr = getHatchingChar(currentX);
                  if (hatchStr) {
                      bestChar = getNextPatternChar(hatchStr, lastChar);
                      bestWidth = this.charWidthCache.get(bestChar) || 8.0;
                  }
              }

              resultText += bestChar;
              lastChar = bestChar;
              currentX += bestWidth;
          } else {
              break;
          }
      }
      
      return resultText;
  }

  /**
   * 右クリックメニュー用: 指定位置の候補リストを返す
   */
  async getCandidatesAt(
    baseFeatures: any,
    localCenterX: number,
    localCenterY: number
  ): Promise<{ char: string, score: number }[]> {
      
      const C = FeatureExtractor.CROP_SIZE;
      let candidates: { char: string, score: number }[] = [];

      // パッチ抽出
      let patch: Float32Array;
      if (this.mode === 'vector') {
          patch = FeatureExtractor.extractPatchVector(
              baseFeatures, localCenterX, localCenterY, this.coordMapVector!
          );
      } else {
          const dummyContext = document.createElement('canvas');
          dummyContext.width = C; dummyContext.height = C;
          const ctx = dummyContext.getContext('2d')!;
          ctx.fillStyle = "white"; ctx.fillRect(0,0,C,C);
          
          patch = FeatureExtractor.extractPatch7Ch(
              baseFeatures, dummyContext, localCenterX, localCenterY, this.coordMap!
          );
      }

      // 推論
      if (this.mode === 'vector' && this.encoderSession) {
          const tensor = new ort.Tensor('float32', patch, [1, 48, 48, 6]);
          const inputName = this.encoderSession.inputNames[0];
          const feeds: any = {}; feeds[inputName!] = tensor;
          const res = await this.encoderSession.run(feeds);
          const vector = res[this.encoderSession.outputNames[0]!]!.data as Float32Array;
          
          // 類似度そのままだと分かりにくいので 0-100 にマップ
          const rawCands = this.searchVectorDb(vector, 10);
          candidates = rawCands.map(c => ({ char: c.char, score: c.score * 100 }));

      } else if (this.session) {
          const tensor = new ort.Tensor('float32', patch.map(v=>v/255.0), [1, 48, 48, 7]);
          const inputName = this.session.inputNames[0];
          const feeds: any = {}; feeds[inputName!] = tensor;
          const res = await this.session.run(feeds);
          const logits = res[this.session.outputNames[0]!]!.data as Float32Array;
          
          const rawCands = this.getMaskedTopK(logits, 10);
          // Logitsを適当にスコア化
          candidates = rawCands.map(c => ({ char: c.char, score: c.score })) as any;
      }

      return candidates;
  }
}