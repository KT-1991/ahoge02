import * as ort from 'onnxruntime-web';
import { FeatureExtractor } from './FeatureExtractor';

// ★重要: import.meta.env.BASE_URL でViteのbase設定(/ahoge02/)を取得できます
const BASE_URL = import.meta.env.BASE_URL;

export interface CharInfo {
  char: string;
  width: number;
  vector: Float32Array | null;
}

export const DEFAULT_CHARS = (() => {
    let chars = " "; 
    for (let i = 33; i < 127; i++) chars += String.fromCharCode(i);
    for (let i = 0xFF61; i < 0xFFA0; i++) chars += String.fromCharCode(i);
    chars += "\u3000";
    chars += "─│┌┐└┘├┤┬┴┼━┃┏┓┛┗┣┳┫┻╋";
    chars += "｡､･ﾟヽヾゝゞ";
    chars += "／＼⊂⊃∪∩∀´｀・…ω";
    return chars;
})();

export class InferenceEngine {
  session: ort.InferenceSession | null = null;
  charDb: CharInfo[] = [];
  mode: 'vector' | 'classifier' = 'vector';
  usageHistory: Map<string, number> = new Map();
  
  private fullClassList: string[] = [];
  private activeClassMask: boolean[] = [];
  
  // ★追加: 許可された文字のセット (Vectorモード用フィルタ)
  private allowedCharSet: Set<string> = new Set();

  fontName = 'Saitamaar';
  currentModelUrl: string | null = null;

  async init(
      modelUrl: string, 
      fontUrl: string, 
      jsonUrl: string, 
      mode: 'vector' | 'classifier' = 'vector',
      fontName: string = 'Saitamaar' // ★修正: フォント名を受け取る
  ) {
    const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
    
    ort.env.wasm.wasmPaths = onnxPath;
    ort.env.wasm.numThreads = 1;

    // --- パス補正関数 ---
    const fixPath = (path: string) => {
        if (path.startsWith('http')) return path;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        if (BASE_URL === '/') {
            return `/${cleanPath}`;
        }
        return `${BASE_URL}${cleanPath}`;
    };

    try {
        const response = await fetch(fixPath(jsonUrl));
        if (response.ok) {
            const charList: string[] = await response.json();
            this.fullClassList = charList.map(c => (c === '<UNK>' || c === '<BOS>') ? ' ' : c);
        } else {
            console.warn(`JSON load failed (${fixPath(jsonUrl)}), using default list.`);
            this.fullClassList = DEFAULT_CHARS.split('');
        }
    } catch (e) {
        console.error("Failed to load char list json", e);
        this.fullClassList = DEFAULT_CHARS.split('');
    }

    await this.loadModel(fixPath(modelUrl), mode);

    const charString = this.fullClassList.join('');
    // ★修正: 引数のfontNameを渡す
    await this.updateDatabase(fixPath(fontUrl), charString, fontName);
  }

  async loadModel(modelUrl: string, mode: 'vector' | 'classifier') {
      if (this.currentModelUrl === modelUrl && this.session) {
          this.mode = mode; 
          return; 
      }
      this.mode = mode;
      console.log(`Loading Model: ${modelUrl} (Mode: ${mode})`);
      
      try {
          this.session = await ort.InferenceSession.create(modelUrl, {
              executionProviders: ['wasm']
          });
          this.currentModelUrl = modelUrl;
          console.log(`Model Loaded.`);
      } catch (e) {
          console.error(`Failed to load model: ${modelUrl}`, e);
          throw e;
      }
  }

  // ★追加: 許可文字リストを更新するメソッド
  updateAllowedChars(allowedChars: string) {
      // Setを作成 (Vectorモード用)
      this.allowedCharSet = new Set(allowedChars.split(''));

      // ActiveMaskを更新 (Classifierモード用)
      if (this.fullClassList.length > 0) {
          this.activeClassMask = this.fullClassList.map(c => 
              this.allowedCharSet.has(c) && c !== '<UNK>' && c !== '<BOS>'
          );
          console.log(`Allowed Chars Updated: ${this.allowedCharSet.size} chars active.`);
      }
  }

  async updateDatabase(fontUrl: string, charList: string, fontName: string) {
    this.fontName = fontName;
    if (fontUrl && fontUrl.startsWith('blob:')) {
        const font = new FontFace(fontName, `url(${fontUrl})`);
        await font.load();
        document.fonts.add(font);
    }

    const uniqueChars = Array.from(new Set(charList.split('')));
    
    // ★修正: updateAllowedChars が呼ばれる前なら、ここで初期化
    if (this.allowedCharSet.size === 0) {
        this.updateAllowedChars(uniqueChars.join(''));
    }

    this.charDb = [];
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    
    ctx.font = `16px "${this.fontName}"`; 
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'black';
    
    const loopList = (this.mode === 'classifier') ? this.fullClassList : uniqueChars;

    for (let i = 0; i < loopList.length; i++) {
        const char = loopList[i]!;
        
        const metrics = ctx.measureText(char);
        const w = Math.max(4, Math.ceil(metrics.width));
        
        let vector: Float32Array | null = null;

        if (this.mode === 'vector') {
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 32, 32); ctx.fillStyle = 'black';
            const x = (32 - w) / 2; 
            const y = (32 - 16) / 2;
            ctx.fillText(char, x, y);

            const features = FeatureExtractor.generate9ChInput(canvas);
            const tensor = this.toTensor(features, 1, 32, 32, 9);
            
            if (this.session) {
                const res = await this.session.run({ input_image: tensor });
                const keys = Object.keys(res);
                if (keys.length > 0) {
                    vector = res[keys[0]!]!.data as Float32Array;
                }
            }
        }

        this.charDb.push({ char: char, vector, width: w });
    }
    
    console.log(`DB Rebuilt: ${this.charDb.length} chars. Mode=${this.mode}`);
  }

  recordUsage(text: string) {
      for (const char of text) {
          const count = this.usageHistory.get(char) || 0;
          this.usageHistory.set(char, Math.min(count + 1, 50));
      }
  }

  // --- ヘルパー: 指定座標の色を取得 ---
  private getColorAt(maskData: Uint8ClampedArray, width: number, x: number, y: number) {
      const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
      if (idx < 0 || idx >= maskData.length) return null;
      
      const r = maskData[idx]!;
      //const g = maskData[idx + 1]!; // 未使用警告回避のため一旦読み込むが使わないなら _g でも可
      const b = maskData[idx + 2]!;
      const a = maskData[idx + 3]!;
      
      if (a < 50) return null; // 透明なら無視
      
      // 青 (B強, R弱)
      if (b > 100 && r < 100) return 'blue';
      // 赤 (R強, B弱)
      if (r > 100 && b < 100) return 'red';
      
      return null;
  }

  /**
   * 一括変換用 (ビームサーチ + ハッチング強制適用)
   */
  async solveLine(
    lineFeatures: Float32Array, 
    width: number,
    blueChar: string, // ★追加
    redChar: string,  // ★追加
    maskData: Uint8ClampedArray | null = null, // ★追加
    _yOffset: number = 0, // 互換性のため残すが未使用(_付き)
    _noiseThreshold: number = 0 // 互換性のため残すが未使用(_付き)
  ): Promise<string> {
    const half = 16;
    const beamWidth = 3;
    let beams = [{ x: 0, cost: 0, text: "", lastChar: "" }];
    const searchCache = new Map<number, any[]>();
    
    let step = 0;
    const maxSteps = width * 2; 

    while (beams.length > 0 && step < maxSteps) {
      const newBeams = [];
      const finishedBeams = [];

      for (const b of beams) {
        if (b.x >= width - 4) {
          finishedBeams.push(b);
          continue;
        }

        // ★ハッチング強制判定 (Hard Override)
        // 現在位置の中心付近の色を確認
        const centerX = Math.min(Math.max(b.x + half, half), width - half);
        
        let forcedChar = null;
        if (maskData) {
            // maskDataは行ごとのデータ(Height=32)と仮定
            const y = 16; // 行の中心
            const color = this.getColorAt(maskData, width, centerX, y); 
            if (color === 'blue') forcedChar = blueChar;
            if (color === 'red') forcedChar = redChar;
        }

        if (forcedChar) {
            // 強制文字が見つかった場合、AI推論をスキップしてその文字を採用
            const charInfo = this.charDb.find(c => c.char === forcedChar);
            const w = charInfo ? charInfo.width : 16; // フォールバック
            
            newBeams.push({
                x: b.x + w,
                cost: b.cost, // コスト加算なし（最優先）
                text: b.text + forcedChar,
                lastChar: forcedChar
            });
            // 強制文字がある場合は他の候補(AI予測)は生成しない
            continue; 
        }

        // --- 通常のAI推論 (ビームサーチ) ---
        if (!searchCache.has(b.x)) {
            const patch = this.extractPatch(lineFeatures, width, centerX);
            const tensor = this.toTensor(patch, 1, 32, 32, 9);
            
            const res = await this.session!.run({ input_image: tensor });
            const keys = Object.keys(res);
            const outputData = res[keys[0]!]!.data as Float32Array;
            
            let candidates: any[] = [];

            if (this.mode === 'classifier') {
                candidates = this.getMaskedTopKClasses(outputData, 10);
            } else {
                candidates = this.searchVectorDb(outputData, 10);
            }
            
            searchCache.set(b.x, candidates);
        }

        const candidates = searchCache.get(b.x)!;

        for (const cand of candidates) {
           let visualCost = 0;
           if (this.mode === 'classifier') {
               visualCost = (10.0 - cand.score); 
           } else {
               visualCost = (1.0 - cand.score) * 10.0;
           }
           if (visualCost < 0) visualCost = 0;

           newBeams.push({
             x: b.x + cand.width,
             cost: b.cost + visualCost,
             text: b.text + cand.char,
             lastChar: cand.char
           });
        }
      }

      newBeams.sort((a, b) => a.cost - b.cost);
      beams = newBeams.slice(0, beamWidth);
      beams.push(...finishedBeams);
      
      if (beams.every(b => b.x >= width - 4)) break;
      step++;
    }

    beams.sort((a, b) => a.cost - b.cost);
    return beams[0]?.text || "";
  }

  /**
   * 局所サジェスト用: ハッチング強制適用付き
   */
  async suggestText(
    lineFeatures: Float32Array, 
    imgWidth: number, 
    startX: number, 
    maskData: Uint8ClampedArray | null = null, // ★追加
    blueChar: string = ':', // ★追加
    redChar: string = '/',  // ★追加
    maxChars: number = 3
  ): Promise<string> {
      let currentX = startX;
      let resultText = "";
      
      for (let i = 0; i < maxChars; i++) {
          if (currentX >= imgWidth - 4) break;
          const centerX = currentX + 6; 
          
          // ★ハッチング強制判定
          let forcedChar = null;
          if (maskData) {
              const y = 16; 
              const color = this.getColorAt(maskData, imgWidth, centerX, y);
              if (color === 'blue') forcedChar = blueChar;
              if (color === 'red') forcedChar = redChar;
          }

          if (forcedChar) {
              const charInfo = this.charDb.find(c => c.char === forcedChar);
              const w = charInfo ? charInfo.width : 16;
              resultText += forcedChar;
              currentX += w;
              continue; // 次の文字へ
          }

          // AI推論
          const patch = this.extractPatch(lineFeatures, imgWidth, centerX);
          const tensor = this.toTensor(patch, 1, 32, 32, 9);
          
          if (!this.session) break;
          const res = await this.session.run({ input_image: tensor });
          const keys = Object.keys(res);
          const outputData = res[keys[0]!]!.data as Float32Array;
          
          let candidates: any[] = [];
          if (this.mode === 'classifier') {
              candidates = this.getMaskedTopKClasses(outputData, 5);
          } else {
              candidates = this.searchVectorDb(outputData, 5);
          }

          if (candidates.length === 0) break;

          const best = this.pickBestWithHistory(candidates);
          if (!best) break;
          
          if (best.char === ' ' || best.char === '　') {
              if (i === 0) {
                  resultText += best.char;
                  currentX += best.width;
              }
              break; 
          }

          resultText += best.char;
          currentX += best.width;
      }

      return resultText;
  }

  private pickBestWithHistory(candidates: { char: string, score: number, width: number }[]) {
      const scored = candidates.map(c => {
          const usage = this.usageHistory.get(c.char) || 0;
          const bonus = usage * 0.05;
          return { ...c, finalScore: c.score + bonus };
      });
      scored.sort((a, b) => b.finalScore - a.finalScore);
      return scored[0];
  }

  private getMaskedTopKClasses(logits: Float32Array, topK: number) {
      const indexed: { score: number, index: number }[] = [];
      for(let i=0; i<logits.length; i++) {
          if (this.activeClassMask[i]) {
              const score = logits[i] ?? -Infinity;
              indexed.push({ score, index: i });
          }
      }
      indexed.sort((a, b) => b.score - a.score);
      const results = [];
      for (let i = 0; i < topK && i < indexed.length; i++) {
          const item = indexed[i]!;
          const idx = item.index;
          const info = this.charDb[idx]; 
          if (info) {
              results.push({ 
                  char: info.char, 
                  score: item.score, 
                  width: info.width 
              });
          }
      }
      return results;
  }

  // ★修正: Vectorモード検索にもフィルタを追加
  private searchVectorDb(target: Float32Array, topK: number) {
    let norm = 0;
    for(let i=0; i<target.length; i++) {
        const val = target[i] ?? 0;
        norm += val * val;
    }
    norm = Math.sqrt(norm);
    
    const t = new Float32Array(target.length);
    if(norm > 1e-6) {
        for(let i=0; i<target.length; i++) {
             t[i] = (target[i] ?? 0) / norm;
        }
    }

    const scores = this.charDb.map(item => {
        // ★フィルタ: 許可されていない文字は除外
        if (this.allowedCharSet.size > 0 && !this.allowedCharSet.has(item.char)) {
            return { ...item, score: -Infinity };
        }

        if (!item.vector) return { ...item, score: -9999 };
        let dot = 0;
        for(let i=0; i<t.length; i++) {
             dot += t[i]! * (item.vector[i] ?? 0);
        }
        return { ...item, score: dot };
    });

    scores.sort((a, b) => b.score - a.score);
    // スコアが低すぎるものは除外
    return scores.filter(s => s.score > -9000).slice(0, topK);
  }

  private extractPatch(fullFeat: Float32Array, fullW: number, centerX: number): Float32Array {
     const size = 32;
     const result = new Float32Array(size * size * 9);
     const startX = Math.floor(centerX - 16);
     
     for (let y = 0; y < size; y++) {
       for (let x = 0; x < size; x++) {
         const srcX = startX + x;
         const dstIdx = (y * size + x) * 9;
         
         if (srcX < 0 || srcX >= fullW) {
             for(let c=0; c<9; c++) result[dstIdx + c] = 0;
         } else {
             const srcIdx = (y * fullW + srcX) * 9;
             for(let c=0; c<9; c++) {
                 result[dstIdx + c] = fullFeat[srcIdx + c] ?? 0;
             }
         }
       }
     }
     return result;
  }

  private toTensor(data: Float32Array, b: number, h: number, w: number, c: number): ort.Tensor {
     const float32 = new Float32Array(data.length);
     for(let i=0; i<data.length; i++) {
         float32[i] = (data[i] ?? 0) / 255.0;
     }
     return new ort.Tensor('float32', float32, [b, h, w, c]);
  }
    getLoadedCharList(): string {
      // Setで重複を除去
      const uniqueSet = new Set(this.fullClassList);
      // 特殊トークンが ' ' に変換されている場合があるので、それは除外して後で制御する
      uniqueSet.delete(' ');
      
      // 文字列として結合
      return Array.from(uniqueSet).join('');
  }
}