import * as ort from 'onnxruntime-web';
import { FeatureExtractor } from './FeatureExtractor';

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
  
  private fullClassList: string[] = [];
  private activeClassMask: boolean[] = [];

  fontName = 'Saitamaar';
  currentModelUrl: string | null = null;

  async init(modelUrl: string, fontUrl: string, jsonUrl: string, mode: 'vector' | 'classifier' = 'vector') {
    ort.env.wasm.wasmPaths = "/";
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

    try {
        const response = await fetch(jsonUrl);
        if (response.ok) {
            const charList: string[] = await response.json();
            this.fullClassList = charList.map(c => (c === '<UNK>' || c === '<BOS>') ? ' ' : c);
        } else {
            console.warn("JSON load failed, using default list.");
            this.fullClassList = DEFAULT_CHARS.split('');
        }
    } catch (e) {
        console.error("Failed to load char list json", e);
        this.fullClassList = DEFAULT_CHARS.split('');
    }

    await this.loadModel(modelUrl, mode);
    const charString = this.fullClassList.join('');
    await this.updateDatabase(fontUrl, charString, 'Saitamaar');
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

  async updateDatabase(fontUrl: string, charList: string, fontName: string) {
    this.fontName = fontName;
    if (fontUrl && fontUrl.startsWith('blob:')) {
        const font = new FontFace(fontName, `url(${fontUrl})`);
        await font.load();
        document.fonts.add(font);
    }

    const uniqueChars = Array.from(new Set(charList.split('')));
    const inputSet = new Set(uniqueChars); // ★未使用警告解決: 下で使用

    if (this.mode === 'classifier') {
        this.activeClassMask = new Array(this.fullClassList.length).fill(false);
        this.fullClassList.forEach((char, idx) => {
            if (inputSet.has(char) && char !== '<UNK>' && char !== '<BOS>') {
                this.activeClassMask[idx] = true;
            }
        });
        console.log(`Classifier Mask: ${this.activeClassMask.filter(b=>b).length} chars active.`);
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
        // ★修正: ! で非nullを保証
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
                    // ★修正: [keys[0]!]
                    vector = res[keys[0]!]!.data as Float32Array;
                }
            }
        }

        // ★修正: !
        this.charDb.push({ char: char, vector, width: w });
    }
    
    console.log(`DB Rebuilt: ${this.charDb.length} chars. Mode=${this.mode}`);
  }

  async solveLine(
    lineFeatures: Float32Array, 
    width: number,
    _bluePattern: string, // ★修正: _ を付けて未使用警告回避
    _redPattern: string   // ★修正: _ を付けて未使用警告回避
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

        if (!searchCache.has(b.x)) {
            const centerX = Math.min(Math.max(b.x + half, half), width - half);
            const patch = this.extractPatch(lineFeatures, width, centerX);
            const tensor = this.toTensor(patch, 1, 32, 32, 9);
            
            const res = await this.session!.run({ input_image: tensor });
            const keys = Object.keys(res);
            // ★修正: [keys[0]!]
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
          // ★修正: [i]!
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
        // ★修正: [i] ?? 0
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
        if (!item.vector) return { ...item, score: -9999 };
        let dot = 0;
        for(let i=0; i<t.length; i++) {
             // ★修正: t[i]! * (item.vector[i] ?? 0)
             dot += t[i]! * (item.vector[i] ?? 0);
        }
        return { ...item, score: dot };
    });

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
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
                 // ★修正: [srcIdx + c] ?? 0
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
         // ★修正: [i] ?? 0
         float32[i] = (data[i] ?? 0) / 255.0;
     }
     return new ort.Tensor('float32', float32, [b, h, w, c]);
  }
}