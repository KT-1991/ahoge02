import * as ort from 'onnxruntime-web';
import { FeatureExtractor } from './FeatureExtractor';

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
  private allowedCharSet: Set<string> = new Set();

  // ★追加: 文字幅キャッシュ
  private charWidthCache: Map<string, number> = new Map();
  private currentFontName: string = '';

  fontName = 'Saitamaar';
  currentModelUrl: string | null = null;

  async init(
      modelUrl: string, 
      fontUrl: string, 
      jsonUrl: string, 
      mode: 'vector' | 'classifier' = 'vector',
      fontName: string = 'Saitamaar'
  ) {
    const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
    ort.env.wasm.wasmPaths = onnxPath;
    ort.env.wasm.numThreads = 1;

    const fixPath = (path: string) => {
        if (path.startsWith('http')) return path;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        if (BASE_URL === '/') return `/${cleanPath}`;
        return `${BASE_URL}${cleanPath}`;
    };

    try {
        const response = await fetch(fixPath(jsonUrl));
        if (response.ok) {
            const charList: string[] = await response.json();
            this.fullClassList = charList.map(c => (c === '<UNK>' || c === '<BOS>') ? ' ' : c);
        } else {
            console.warn(`JSON load failed, using default.`);
            this.fullClassList = DEFAULT_CHARS.split('');
        }
    } catch (e) {
        console.error("Failed to load char list json", e);
        this.fullClassList = DEFAULT_CHARS.split('');
    }

    await this.loadModel(fixPath(modelUrl), mode);

    const charString = this.fullClassList.join('');
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

  updateAllowedChars(allowedChars: string) {
      this.allowedCharSet = new Set(allowedChars.split(''));
      if (this.fullClassList.length > 0) {
          this.activeClassMask = this.fullClassList.map(c => 
              this.allowedCharSet.has(c) && c !== '<UNK>' && c !== '<BOS>'
          );
      }
      // フォント名が決まっていればメトリクスも再計算
      if (this.currentFontName) {
          this.updateFontMetrics(this.currentFontName, allowedChars);
      }
  }

  // ★追加: 高精度な文字幅の事前計算
  updateFontMetrics(fontName: string, allowedChars: string) {
      this.currentFontName = fontName;
      this.charWidthCache.clear();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `16px "${fontName}"`; 

      const uniqueChars = Array.from(new Set(allowedChars.split('')));
      const sampleCount = 50; 

      uniqueChars.forEach(c => {
          // 50個並べて平均を取ることで、サブピクセル精度とカーニングの平均値を得る
          const text = c.repeat(sampleCount);
          const width = ctx.measureText(text).width / sampleCount;
          this.charWidthCache.set(c, width);
      });
      // スペースは必須
      if (!this.charWidthCache.has(' ')) {
          this.charWidthCache.set(' ', ctx.measureText(' '.repeat(50)).width / 50);
      }
      console.log(`[InferenceEngine] Metrics updated for ${fontName}. Cache size: ${this.charWidthCache.size}`);
  }

  async updateDatabase(fontUrl: string, charList: string, fontName: string) {
    this.fontName = fontName;
    if (fontUrl && fontUrl.startsWith('blob:')) {
        const font = new FontFace(fontName, `url(${fontUrl})`);
        await font.load();
        document.fonts.add(font);
    }

    const uniqueChars = Array.from(new Set(charList.split('')));
    
    if (this.allowedCharSet.size === 0) {
        this.updateAllowedChars(uniqueChars.join(''));
    }
    // ここで一回計算しておく
    this.updateFontMetrics(fontName, this.getLoadedCharList());

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
        const w = Math.max(4, Math.ceil(metrics.width)); // DB構築時は整数でOK
        
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
    console.log(`DB Rebuilt: ${this.charDb.length} chars.`);
  }

  recordUsage(text: string) {
      for (const char of text) {
          const count = this.usageHistory.get(char) || 0;
          this.usageHistory.set(char, Math.min(count + 1, 50));
      }
  }

  private getColorAt(maskData: Uint8ClampedArray, width: number, x: number, y: number) {
      const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
      if (idx < 0 || idx >= maskData.length) return null;
      const r = maskData[idx]!;
      const b = maskData[idx + 2]!;
      const a = maskData[idx + 3]!;
      if (a < 50) return null; 
      if (b > 100 && r < 100) return 'blue';
      if (r > 100 && b < 100) return 'red';
      return null;
  }

  /**
   * 一括変換用: Hybrid / Accurate モード対応
   */
  async solveLine(
    lineFeatures: Float32Array, 
    width: number,
    blueChar: string,
    redChar: string, 
    maskData: Uint8ClampedArray | null = null,
    _yOffset: number = 0,
    // ★追加: 生成モードとコンテキスト
    generationMode: 'hybrid' | 'accurate' = 'hybrid',
    ctx: CanvasRenderingContext2D | null = null
  ): Promise<string> {
    const half = 16;
    const beamWidth = 3;
    // xはfloatで保持する
    let beams = [{ x: 0.0, cost: 0, text: "", lastChar: "" }];
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

        const centerX = Math.min(Math.max(b.x + half, half), width - half);
        
        // --- 強制文字判定 ---
        let forcedChar = null;
        if (maskData) {
            const y = 16; 
            const color = this.getColorAt(maskData, width, centerX, y); 
            if (color === 'blue') forcedChar = blueChar;
            if (color === 'red') forcedChar = redChar;
        }

        if (forcedChar) {
            // 強制文字の場合はキャッシュから幅を取得
            const w = this.charWidthCache.get(forcedChar) || 8.0;
            const nextText = b.text + forcedChar;
            
            // ★位置更新ロジック (強制文字版)
            let nextX = b.x + w;
            if (generationMode === 'accurate' && ctx) {
                nextX = ctx.measureText(nextText).width;
            } else if (generationMode === 'hybrid' && ctx && nextText.length % 10 === 0) {
                nextX = ctx.measureText(nextText).width;
            }

            newBeams.push({
                x: nextX,
                cost: b.cost,
                text: nextText,
                lastChar: forcedChar
            });
            continue; 
        }

        // --- AI推論 ---
        // searchCacheのキーは整数に丸めてヒット率を上げる
        const cacheKey = Math.floor(b.x);
        if (!searchCache.has(cacheKey)) {
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
            searchCache.set(cacheKey, candidates);
        }

        const candidates = searchCache.get(cacheKey)!;

        for (const cand of candidates) {
           let visualCost = 0;
           if (this.mode === 'classifier') {
               visualCost = (10.0 - cand.score); 
           } else {
               visualCost = (1.0 - cand.score) * 10.0;
           }
           if (visualCost < 0) visualCost = 0;

           const nextText = b.text + cand.char;
           
           // ★位置更新ロジック (AI推論版)
           let nextX = b.x;
           
           if (generationMode === 'accurate' && ctx) {
               // 毎回実測
               nextX = ctx.measureText(nextText).width;
           } else {
               // Hybrid or Normal
               // キャッシュされた高精度幅を使う
               const w = this.charWidthCache.get(cand.char) || cand.width;
               nextX = b.x + w;

               // Hybridかつ10文字ごとなら補正
               if (generationMode === 'hybrid' && ctx && nextText.length % 10 === 0) {
                   nextX = ctx.measureText(nextText).width;
               }
           }

           newBeams.push({
             x: nextX,
             cost: b.cost + visualCost,
             text: nextText,
             lastChar: cand.char
           });
        }
      }

      newBeams.sort((a, b) => a.cost - b.cost);
      beams = newBeams.slice(0, beamWidth);
      beams.push(...finishedBeams);
      
      // 全ビームが終了条件を満たしたら終了
      if (beams.length > 0 && beams.every(b => b.x >= width - 4)) break;
      step++;
    }

    beams.sort((a, b) => a.cost - b.cost);
    return beams[0]?.text || "";
  }

  // suggestTextは簡易版のまま (CanvasコンテキストがないためHybridの補正なし版として動作)
  async suggestText(
    lineFeatures: Float32Array, 
    imgWidth: number, 
    startX: number, 
    maskData: Uint8ClampedArray | null = null,
    blueChar: string = ':',
    redChar: string = '/', 
    maxChars: number = 3
  ): Promise<string> {
      let currentX = startX;
      let resultText = "";
      
      for (let i = 0; i < maxChars; i++) {
          if (currentX >= imgWidth - 4) break;
          const centerX = currentX + 6; 
          
          let forcedChar = null;
          if (maskData) {
              const y = 16; 
              const color = this.getColorAt(maskData, imgWidth, centerX, y);
              if (color === 'blue') forcedChar = blueChar;
              if (color === 'red') forcedChar = redChar;
          }

          if (forcedChar) {
              const w = this.charWidthCache.get(forcedChar) || 8.0;
              resultText += forcedChar;
              currentX += w;
              continue;
          }

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
                  // キャッシュがあればそれを使う
                  currentX += (this.charWidthCache.get(best.char) || best.width);
              }
              break; 
          }

          resultText += best.char;
          currentX += (this.charWidthCache.get(best.char) || best.width);
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
      const uniqueSet = new Set(this.fullClassList);
      uniqueSet.delete(' ');
      return Array.from(uniqueSet).join('');
  }
}