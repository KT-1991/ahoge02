import * as ort from 'onnxruntime-web';
import { FeatureExtractor } from './FeatureExtractor';

const BASE_URL = import.meta.env.BASE_URL;

export interface CharInfo {
  char: string;
  width: number;
  vector: Float32Array | null;
  pixelCount: number;
}

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
  encoderSession: ort.InferenceSession | null = null;
  charDb: CharInfo[] = [];
  mode: 'vector' | 'classifier' = 'vector';
  usageHistory: Map<string, number> = new Map();
  
  private fullClassList: string[] = [];
  private activeClassMask: boolean[] = [];
  private allowedCharSet: Set<string> = new Set();
  private charWidthCache: Map<string, number> = new Map();
  private currentFontName: string = '';
  private centerMask: Float32Array | null = null;

  fontName = 'Saitamaar';
  currentModelUrl: string | null = null;

  async init(
      modelUrl: string, encoderUrl: string, fontUrl: string, jsonUrl: string, 
      mode: 'vector' | 'classifier' = 'vector', fontName: string = 'Saitamaar'
  ) {
    const fixPath = (path: string) => {
        if (path.startsWith('http')) return path;
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        if (BASE_URL === '/') return `/${cleanPath}`;
        return `${BASE_URL}${cleanPath}`;
    };

    const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
    ort.env.wasm.wasmPaths = onnxPath;
    ort.env.wasm.numThreads = 1;

    this.createCenterMask();

    try {
        const response = await fetch(fixPath(jsonUrl));
        if (response.ok) {
            const charList: string[] = await response.json();
            this.fullClassList = charList.map(c => (c === '<UNK>' || c === '<BOS>') ? ' ' : c);
        } else {
            this.fullClassList = DEFAULT_CHARS.split('');
        }
    } catch (e) {
        console.error(e);
        this.fullClassList = DEFAULT_CHARS.split('');
    }

    await this.loadModel(fixPath(modelUrl), mode);
    try {
        if (!this.encoderSession) {
            this.encoderSession = await ort.InferenceSession.create(fixPath(encoderUrl), { executionProviders: ['wasm'] });
        }
    } catch (e) { console.warn(e); }

    const charString = this.fullClassList.join('');
    await this.updateDatabase(fontUrl ? fixPath(fontUrl) : null, charString, fontName);
  }

  private createCenterMask() {
      const size = 32;
      this.centerMask = new Float32Array(size * size);
      const sigma = 0.25;
      const center = (size - 1) / 2.0;
      let maxVal = 0; let minVal = 1.0;
      for(let y=0; y<size; y++) {
          for(let x=0; x<size; x++) {
              const ny = (y - center) / center;
              const nx = (x - center) / center;
              const d = Math.sqrt(nx*nx + ny*ny);
              const val = Math.exp( - (d * d) / (2.0 * sigma * sigma) );
              this.centerMask[y*size + x] = val;
              if (val > maxVal) maxVal = val;
              if (val < minVal) minVal = val;
          }
      }
      for(let i=0; i<this.centerMask.length; i++) {
          this.centerMask[i] = (this.centerMask[i]! - minVal) / (maxVal - minVal);
      }
  }

  async loadModel(modelUrl: string, mode: 'vector' | 'classifier') {
      if (this.currentModelUrl === modelUrl && this.session) {
          this.mode = mode; return; 
      }
      this.mode = mode;
      try {
          this.session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
          this.currentModelUrl = modelUrl;
      } catch (e) { throw e; }
  }

  public getSafeCharList(): string {
      const chars: string[] = [];
      for (let i = 32; i < 127; i++) chars.push(String.fromCharCode(i));
      chars.push('\u3000');
      for (let i = 0x3041; i < 0x3097; i++) chars.push(String.fromCharCode(i));
      for (let i = 0x30A1; i < 0x30FB; i++) chars.push(String.fromCharCode(i));
      for (let i = 0xFF61; i < 0xFFA0; i++) chars.push(String.fromCharCode(i));
      for (let i = 0x2010; i < 0x2027; i++) chars.push(String.fromCharCode(i));
      for (let i = 0x2500; i < 0x2580; i++) chars.push(String.fromCharCode(i));
      for (let i = 0x2580; i < 0x25A0; i++) chars.push(String.fromCharCode(i));
      for (let i = 0x25A0; i < 0x2600; i++) chars.push(String.fromCharCode(i));
      return Array.from(new Set(chars)).join('');
  }

  updateAllowedChars(allowedChars: string) {
      this.allowedCharSet = new Set(allowedChars.split(''));
      if (this.fullClassList.length > 0) {
          this.activeClassMask = this.fullClassList.map(c => this.allowedCharSet.has(c));
      }
      if (this.currentFontName) this.updateFontMetrics(this.currentFontName, allowedChars);
  }

  updateFontMetrics(fontName: string, allowedChars: string) {
      this.currentFontName = fontName;
      this.charWidthCache.clear();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.font = `16px "${fontName}"`; 
      const uniqueChars = Array.from(new Set(allowedChars.split('')));
      const sampleCount = 50; 
      uniqueChars.forEach(c => {
          const text = c.repeat(sampleCount);
          const width = ctx.measureText(text).width / sampleCount;
          this.charWidthCache.set(c, width);
      });
      if (!this.charWidthCache.has(' ')) {
          this.charWidthCache.set(' ', ctx.measureText(' '.repeat(50)).width / 50);
      }
  }

  async updateDatabase(fontUrl: string | null, charList: string, fontName: string) {
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
    this.updateFontMetrics(fontName, this.getLoadedCharList());

    this.charDb = [];
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'black';
    
    // モードに関わらず全リストを対象にする（モード切替時のため）
    const loopList = (this.mode === 'classifier') ? this.fullClassList : uniqueChars;

    for (let i = 0; i < loopList.length; i++) {
        const char = loopList[i]!;
        const metrics = ctx.measureText(char);
        const w = Math.max(4, Math.ceil(metrics.width)); 
        let vector: Float32Array | null = null;

        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 32, 32); 
        ctx.fillStyle = 'black';
        const x = (32 - w) / 2; const y = (32 - 16) / 2;
        ctx.fillText(char, x, y);

        const imgData = ctx.getImageData(0, 0, 32, 32);
        let inkAmount = 0;
        for(let k=0; k<imgData.data.length; k+=4) {
            if (imgData.data[k]! < 128) inkAmount++;
        }

        // Encoderがあればベクトル生成
        if (this.encoderSession) {
            try {
                const src = (window as any).cv.imread(canvas);
                const skeleton = FeatureExtractor.skeletonize(src);
                const features = FeatureExtractor.generate9ChInputFromSkeleton(skeleton);
                const tensor = this.toTensor(features, 1, 32, 32, 9);
                if (this.encoderSession) {
                    const res = await this.encoderSession.run({ input_image: tensor });
                    const keys = Object.keys(res);
                    if (keys.length > 0) vector = res[keys[0]!]!.data as Float32Array;
                }
                src.delete(); skeleton.delete();
            } catch(e) {
                // Vector生成失敗は無視
            }
        }
        this.charDb.push({ char: char, vector, width: w, pixelCount: inkAmount });
    }
    console.log(`DB Rebuilt: ${this.charDb.length} chars.`);
  }

  private async rerankCandidates(
      patch: Float32Array, 
      candidates: any[], 
      ctx: CanvasRenderingContext2D,
      prevBottomEdge: Float32Array | null
  ): Promise<any[]> {
      const reranked = [];
      const canvas = ctx.canvas;

      const patchPixels = new Float32Array(32 * 32);
      let inputInkSum = 0;
      for (let i = 0; i < 32 * 32; i++) {
          const val = patch[i * 9]; 
          if (val! > 50) {
              patchPixels[i] = 1.0;
              inputInkSum += 1.0;
          } else {
              patchPixels[i] = 0.0;
          }
      }

      for (const cand of candidates) {
          if (cand.char_id === -1) {
              const spaceScore = (inputInkSum < 5) ? 1.0 : 0.0;
              reranked.push({ ...cand, finalScore: spaceScore });
              continue;
          }

          ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 32, 32);
          ctx.fillStyle = 'black';
          const info = this.charDb.find(c => c.char === cand.char);
          const w = info ? info.width : 10;
          const x = (32 - w) / 2; const y = (32 - 16) / 2;
          ctx.fillText(cand.char, x, y);

          const src = (window as any).cv.imread(canvas);
          const skeleton = FeatureExtractor.skeletonize(src);
          (window as any).cv.bitwise_not(skeleton, skeleton);
          const charData = skeleton.data; 

          let intersection = 0;
          let union = 0;
          let charInkSum = 0;
          const margin = 8; 
          for (let py = 0; py < 32; py++) {
              for (let px = margin; px < 32 - margin; px++) {
                  const i = py * 32 + px;
                  const inVal = patchPixels[i];
                  const chVal = (charData[i] > 100) ? 1.0 : 0.0;
                  if (inVal! > 0 || chVal > 0) union += 1.0;
                  if (inVal! > 0 && chVal > 0) intersection += 1.0;
                  if (chVal > 0) charInkSum += 1.0;
              }
          }
          let matchScore = 0.0;
          if (union > 0) {
              const coverRate = (inputInkSum > 0) ? (intersection / inputInkSum) : 0;
              const precision = (charInkSum > 0) ? (intersection / charInkSum) : 0;
              matchScore = (coverRate * 0.7) + (precision * 0.3);
          }

          let verticalConnectScore = 0.0;
          if (prevBottomEdge) {
              let connectHits = 0;
              let connectTotal = 0;
              for (let px = 0; px < 32; px++) {
                  const upperVal = prevBottomEdge[px]!; 
                  if (upperVal > 0) {
                      connectTotal += 1;
                      let hasInkBelow = false;
                      for(let py=0; py<3; py++) {
                          if (charData[py*32 + px] > 100) hasInkBelow = true;
                          if (px>0 && charData[py*32 + px - 1] > 100) hasInkBelow = true;
                          if (px<31 && charData[py*32 + px + 1] > 100) hasInkBelow = true;
                      }
                      if (hasInkBelow) connectHits += 1;
                  }
              }
              if (connectTotal > 0) {
                  verticalConnectScore = (connectHits / connectTotal);
              }
          }

          const finalScore = (cand.score * 0.3) + (matchScore * 0.5) + (verticalConnectScore * 0.5);
          reranked.push({ ...cand, finalScore });
          src.delete(); skeleton.delete();
      }
      reranked.sort((a, b) => b.finalScore - a.finalScore);
      return reranked;
  }

  async solveLine(
    lineFeatures: Float32Array, width: number,
    blueChar: string, redChar: string, maskData: Uint8ClampedArray | null = null, 
    _yOffset: number = 0, generationMode: 'hybrid' | 'accurate' = 'hybrid', 
    measureCtx: CanvasRenderingContext2D | null = null,
    prevBottomEdge: Float32Array | null = null 
  ): Promise<{ text: string, bottomEdge: Float32Array }> {
    
    const currentBottomEdge = new Float32Array(width);

    // --- Classifier Mode ---
    if (this.mode === 'classifier') {
        const half = 16;
        const beamWidth = 3; 
        let beams = [{ x: 0.0, cost: 0, text: "", lastChar: "" }];
        const searchCache = new Map<number, any[]>();
        let step = 0;
        const maxSteps = width * 2; 

        while (beams.length > 0 && step < maxSteps) {
            const newBeams = [];
            const finishedBeams = [];
            for (const b of beams) {
                if (b.x >= width - 4) { finishedBeams.push(b); continue; }
                const centerX = Math.min(Math.max(b.x + half, half), width - half);
                
                let forcedChar = null;
                if (maskData) {
                    const y = 16; 
                    const color = this.getColorAt(maskData, width, centerX, y); 
                    if (color === 'blue') forcedChar = blueChar;
                    if (color === 'red') forcedChar = redChar;
                }
                if (forcedChar) {
                    // 幅の取得を強化: キャッシュになければ計測、計測不可なら文字数×8px
                    let w = this.charWidthCache.get(forcedChar);
                    if (w === undefined) {
                        if (measureCtx) {
                            w = measureCtx.measureText(forcedChar).width;
                        } else {
                            // キャッシュもなく計測もできない場合のフォールバック
                            w = forcedChar.length * (this.charWidthCache.get(' ') || 8.0);
                        }
                    }
                    
                    let nextX = b.x + w;
                    const nextText = b.text + forcedChar;
                    if (generationMode === 'accurate' && measureCtx) {
                        nextX = measureCtx.measureText(nextText).width;
                    } else if (generationMode === 'hybrid' && measureCtx && nextText.length % 10 === 0) {
                        nextX = measureCtx.measureText(nextText).width;
                    }
                    newBeams.push({ x: nextX, cost: b.cost, text: nextText, lastChar: forcedChar });
                    continue; 
                }

                const patch = this.extractPatch(lineFeatures, width, centerX);
                let sumSkeleton = 0; let sumDensity = 0;
                for (let i = 0; i < 32*32; i++) {
                    sumSkeleton += patch[i*9+0]!;
                    sumDensity += patch[i*9+3]!;
                }
                const baseSignal = Math.max(sumSkeleton/(32*32), sumDensity/(32*32));
                if (baseSignal < 15) { 
                    const w = this.charWidthCache.get(' ') || 8.0;
                    newBeams.push({ x: b.x + w, cost: b.cost, text: b.text + ' ', lastChar: ' ' });
                    continue;
                }

                const cacheKey = Math.floor(b.x);
                if (!searchCache.has(cacheKey)) {
                    const tensor = this.toTensor(patch, 1, 32, 32, 9);
                    const res = await this.session!.run({ input_image: tensor });
                    const keys = Object.keys(res);
                    const outputData = res[keys[0]!]!.data as Float32Array;
                    const candidates = this.getMaskedTopKClasses(outputData, 10);
                    searchCache.set(cacheKey, candidates);
                }
                const candidates = searchCache.get(cacheKey)!;

                for (const cand of candidates) {
                    let visualCost = (10.0 - cand.score); 
                    if (visualCost < 0) visualCost = 0;
                    const nextText = b.text + cand.char;
                    let nextX = b.x;
                    if (generationMode === 'accurate' && measureCtx) {
                        nextX = measureCtx.measureText(nextText).width;
                    } else {
                        const w = this.charWidthCache.get(cand.char) || cand.width;
                        nextX = b.x + w;
                        if (generationMode === 'hybrid' && measureCtx && nextText.length % 10 === 0) {
                            nextX = measureCtx.measureText(nextText).width;
                        }
                    }
                    newBeams.push({ x: nextX, cost: b.cost + visualCost, text: nextText, lastChar: cand.char });
                }
            }
            newBeams.sort((a, b) => a.cost - b.cost);
            beams = newBeams.slice(0, beamWidth);
            beams.push(...finishedBeams);
            if (beams.length > 0 && beams.every(b => b.x >= width - 4)) break;
            step++;
        }
        beams.sort((a, b) => a.cost - b.cost);
        return { text: beams[0]?.text || "", bottomEdge: currentBottomEdge };
    }

    // --- Vector Mode ---
    const half = 16;
    const beamWidth = 3;
    let beams = [{ x: 0.0, cost: 0, text: "", lastChar: "" }];
    const searchCache = new Map<number, any[]>();
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 32; tempCanvas.height = 32;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })!;
    tempCtx.font = `16px "${this.fontName}"`; 
    tempCtx.textBaseline = 'top';

    let step = 0;
    const maxSteps = width * 2; 
    let spaceWidth = 8.0;
    if (this.charWidthCache.has(' ')) spaceWidth = this.charWidthCache.get(' ')!;

    while (beams.length > 0 && step < maxSteps) {
      const newBeams = [];
      const finishedBeams = [];

      for (const b of beams) {
        if (b.x >= width - 4) { finishedBeams.push(b); continue; }
        
        const centerX = b.x + half; 
        const xCenterInt = Math.round(centerX);
        const xStart = xCenterInt - half;
        const xEnd = xCenterInt + half;
        if (xEnd > width) { finishedBeams.push(b); continue; }

        let forcedChar = null;
        if (maskData) {
            const y = 16; 
            const color = this.getColorAt(maskData, width, xCenterInt, y); 
            if (color === 'blue') forcedChar = blueChar;
            if (color === 'red') forcedChar = redChar;
        }
        if (forcedChar) {
            const w = this.charWidthCache.get(forcedChar) || 8.0;
            newBeams.push({ x: b.x + w, cost: b.cost, text: b.text + forcedChar, lastChar: forcedChar });
            continue; 
        }

        const patch = this.extractPatch(lineFeatures, width, xCenterInt);

        let centerInk = 0;
        const cy = 16; const cx = 16;
        for(let dy=-6; dy<6; dy++) {
            for(let dx=-6; dx<6; dx++) {
                const idx = ((cy+dy)*32 + (cx+dx)) * 9;
                centerInk += patch[idx]!; 
            }
        }
        let totalDensity = 0;
        for(let i=0; i<32*32; i++) totalDensity += patch[i*9+3]!;
        totalDensity /= (32*32);

        let candidates: any[] = [];
        if (centerInk < 30) {
            candidates = [{ char: ' ', score: 100.0, finalScore: 100.0, pixelCount: 0 }];
        } else {
            if (!searchCache.has(xCenterInt)) {
                const tensor = this.toTensor(patch, 1, 32, 32, 9);
                
                // ★修正: Vector Modeなら必ず encoderSession を使用する
                const sess = this.encoderSession || this.session;
                
                if (sess) {
                    const res = await sess.run({ input_image: tensor });
                    const keys = Object.keys(res);
                    const outputData = res[keys[0]!]!.data as Float32Array;
                    const baseCands = this.searchVectorDb(outputData, 15);
                    
                    let prevPatchBottom: Float32Array | null = null;
                    if (prevBottomEdge) {
                        prevPatchBottom = new Float32Array(32);
                        for(let px=0; px<32; px++) {
                            const globalX = xStart + px;
                            if(globalX >= 0 && globalX < width) {
                                prevPatchBottom[px] = prevBottomEdge[globalX]!;
                            }
                        }
                    }

                    const reranked = await this.rerankCandidates(patch, baseCands, tempCtx, prevPatchBottom);
                    searchCache.set(xCenterInt, reranked);
                } else {
                    candidates = []; // セッションがない場合
                }
            }
            if (searchCache.has(xCenterInt)) {
                candidates = searchCache.get(xCenterInt)!;
            }
        }

        for (const cand of candidates) {
            const scoreToUse = (cand.finalScore !== undefined) ? cand.finalScore : cand.score;
            let visualCost = (1.0 - scoreToUse) * 10.0;
            if (visualCost < 0) visualCost = 0;

            const char = cand.char;
            const charPixels = cand.pixelCount || 0;

            if (char !== ' ') {
                if (totalDensity < 40 && charPixels > 40) visualCost += 5.0;
                else if (totalDensity > 80 && charPixels < 20) visualCost += 1.0;
            }

            let w = spaceWidth;
            if (char !== ' ') {
                w = this.charWidthCache.get(char) || 10.0;
            }
            if (w < 4.0) w = 4.0;

            let transCost = 0;
            if (char === b.lastChar && char !== ' ' && char !== '─') {
                transCost = 0.5;
            }
            const nextX = b.x + w;

            newBeams.push({
                x: nextX,
                cost: b.cost + visualCost + transCost,
                text: b.text + char,
                lastChar: char
            });
        }
      }
      newBeams.sort((a, b) => a.cost - b.cost);
      beams = newBeams.slice(0, beamWidth);
      beams.push(...finishedBeams);
      if (beams.length > 0 && beams.every(b => b.x >= width - 4)) break;
      step++;
    }
    beams.sort((a, b) => a.cost - b.cost);
    
    const bestText = beams[0]?.text || "";

    if (this.mode === 'vector') {
        let currentX = 0.0;
        const canvas = tempCtx.canvas;
        tempCtx.fillStyle = 'black'; 
        for (const char of bestText) {
            const w = this.charWidthCache.get(char) || 10.0;
            tempCtx.fillStyle = 'white'; tempCtx.fillRect(0,0,32,32);
            tempCtx.fillStyle = 'black';
            const dbW = this.charDb.find(c=>c.char===char)?.width || w;
            const drawX = (32 - dbW)/2;
            const drawY = (32 - 16)/2;
            tempCtx.fillText(char, drawX, drawY);
            
            const src = (window as any).cv.imread(canvas);
            const skeleton = FeatureExtractor.skeletonize(src);
            (window as any).cv.bitwise_not(skeleton, skeleton);
            const charData = skeleton.data; 
            
            for(let cx=0; cx<32; cx++) {
                let hasInk = false;
                for(let cy=29; cy<32; cy++) {
                    if (charData[cy*32 + cx] > 100) hasInk = true;
                }
                if (hasInk) {
                    const globalX = Math.round(currentX) + (cx - Math.floor(drawX));
                    if (globalX >= 0 && globalX < width) {
                        currentBottomEdge[globalX] = 1.0;
                    }
                }
            }
            src.delete(); skeleton.delete();
            currentX += w;
        }
    }

    return { text: bestText, bottomEdge: currentBottomEdge };
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

  private getMaskedTopKClasses(logits: Float32Array, topK: number) {
      const indexed: { score: number, index: number }[] = [];
      const len = Math.min(logits.length, this.activeClassMask.length);
      for(let i=0; i<len; i++) {
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
              results.push({ char: info.char, score: item.score, width: info.width });
          }
      }
      return results;
  }

  private searchVectorDb(target: Float32Array, topK: number) {
    let norm = 0;
    for(let i=0; i<target.length; i++) norm += target[i]! * target[i]!;
    norm = Math.sqrt(norm);
    const t = new Float32Array(target.length);
    if(norm > 1e-6) for(let i=0; i<target.length; i++) t[i] = target[i]! / norm;

    const scores = this.charDb.map(item => {
        if (this.allowedCharSet.size > 0 && !this.allowedCharSet.has(item.char)) {
            return { ...item, score: -Infinity };
        }
        if (!item.vector) return { ...item, score: -9999 };
        
        // 次元数チェック (念のため)
        if (item.vector.length !== t.length) return { ...item, score: -9999 };

        let dot = 0;
        for(let i=0; i<t.length; i++) dot += t[i]! * item.vector[i]!;
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
             for(let c=0; c<9; c++) result[dstIdx + c] = fullFeat[srcIdx + c] ?? 0;
         }
       }
     }
     return result;
  }

  private toTensor(data: Float32Array, b: number, h: number, w: number, c: number): ort.Tensor {
     const float32 = new Float32Array(data.length);
     for(let i=0; i<data.length; i++) float32[i] = data[i]! / 255.0;
     return new ort.Tensor('float32', float32, [b, h, w, c]);
  }

  getLoadedCharList(): string {
      return Array.from(this.allowedCharSet).join('');
  }
  
  recordUsage(text: string) {
      for (const char of text) {
          const count = this.usageHistory.get(char) || 0;
          this.usageHistory.set(char, Math.min(count + 1, 50));
      }
  }

  async suggestText(
    lineFeatures: Float32Array, imgWidth: number, startX: number, maskData: Uint8ClampedArray | null = null,
    blueChar: string = ':', redChar: string = '/', maxChars: number = 3
  ): Promise<string> {
      let currentX = startX;
      let resultText = "";
      
      let tempCtx: CanvasRenderingContext2D | null = null;
      if (this.mode === 'vector') {
          const c = document.createElement('canvas');
          c.width = 32; c.height = 32;
          tempCtx = c.getContext('2d', { willReadFrequently: true });
          if (tempCtx) {
              tempCtx.font = `16px "${this.fontName}"`; 
              tempCtx.textBaseline = 'top';
          }
      }

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
                let w = this.charWidthCache.get(forcedChar);
                if (w === undefined) {
                    // tempCtxがあれば計測
                    if (tempCtx) {
                        w = tempCtx.measureText(forcedChar).width;
                    } else {
                        w = forcedChar.length * 8.0;
                    }
                }
                resultText += forcedChar;
                currentX += w;
                continue;
          }

          const patch = this.extractPatch(lineFeatures, imgWidth, centerX);

          let centerInk = 0;
          if (this.mode === 'vector') {
             const cy = 16; const cx = 16;
             for(let dy=-6; dy<6; dy++) {
                for(let dx=-6; dx<6; dx++) {
                    const idx = ((cy+dy)*32 + (cx+dx)) * 9;
                    centerInk += patch[idx]!; 
                }
             }
          } else {
             let sum = 0;
             for(let k=0; k<32*32; k++) sum += patch[k*9]!;
             centerInk = sum / (32*32);
          }

          const threshold = (this.mode === 'vector') ? 0 : 0;
          if (centerInk < threshold) {
              if (i === 0) {
                  resultText += " ";
                  currentX += (this.charWidthCache.get(" ") || 8.0);
              }
              break; 
          }

          const tensor = this.toTensor(patch, 1, 32, 32, 9);
          
          // ★修正: Vector Modeなら encoderSession を使う
          const sess = (this.mode === 'vector' && this.encoderSession) ? this.encoderSession : this.session;
          if (!sess) break;
          
          const res = await sess.run({ input_image: tensor });
          const keys = Object.keys(res);
          const outputData = res[keys[0]!]!.data as Float32Array;
          
          let candidates: any[] = [];
          if (this.mode === 'classifier') {
              candidates = this.getMaskedTopKClasses(outputData, 5);
          } else {
              const baseCands = this.searchVectorDb(outputData, 15);
              if (tempCtx) {
                  candidates = await this.rerankCandidates(patch, baseCands, tempCtx, null);
              } else {
                  candidates = baseCands;
              }
          }
          
          if (candidates.length === 0) break;
          const best = this.pickBestWithHistory(candidates)!;
          
          if (best.char === ' ' || best.char === '　') {
              if (i === 0) {
                  resultText += best.char;
                  currentX += (this.charWidthCache.get(best.char) || best.width);
              }
              break; 
          }
          resultText += best.char;
          currentX += (this.charWidthCache.get(best.char) || best.width);
      }
      return resultText;
  }

  private pickBestWithHistory(candidates: { char: string, score: number, width: number, finalScore?: number }[]) {
      const scored = candidates.map(c => {
          const usage = this.usageHistory.get(c.char) || 0;
          const bonus = usage * 0.05;
          const baseScore = (c.finalScore !== undefined) ? c.finalScore : c.score;
          return { ...c, selectionScore: baseScore + bonus };
      });
      scored.sort((a, b) => b.selectionScore - a.selectionScore);
      return scored[0];
  }

  async getCandidatesAt(
      lineFeatures: Float32Array, imgWidth: number, startX: number, 
      maskData: Uint8ClampedArray | null = null,
      blueChar: string = ':', redChar: string = '/'
  ): Promise<{ char: string, score: number }[]> {
      const centerX = startX + 6; 
      
      if (maskData) {
          const y = 16; 
          const color = this.getColorAt(maskData, imgWidth, centerX, y);
          if (color === 'blue') return [{ char: blueChar, score: 100 }];
          if (color === 'red') return [{ char: redChar, score: 100 }];
      }

      const patch = this.extractPatch(lineFeatures, imgWidth, centerX);
      
      let centerInk = 0;
      if (this.mode === 'vector') {
          const cy = 16; const cx = 16;
          for(let dy=-6; dy<6; dy++) for(let dx=-6; dx<6; dx++) {
              centerInk += patch[((cy+dy)*32 + (cx+dx)) * 9]!;
          }
      } else {
          let sum = 0; for(let k=0; k<32*32; k++) sum += patch[k*9]!; 
          centerInk = sum / (32*32);
      }

      const threshold = (this.mode === 'vector') ? 0 : 0;
      if (centerInk < threshold) {
          return [{ char: ' ', score: 100 }];
      }

      const tensor = this.toTensor(patch, 1, 32, 32, 9);
      
      // ★修正: Vector Modeなら encoderSession を使う
      const sess = (this.mode === 'vector' && this.encoderSession) ? this.encoderSession : this.session;
      if (!sess) return [];
      
      const res = await sess.run({ input_image: tensor });
      const keys = Object.keys(res);
      const outputData = res[keys[0]!]!.data as Float32Array;

      let candidates: any[] = [];
      
      if (this.mode === 'classifier') {
          candidates = this.getMaskedTopKClasses(outputData, 20); 
      } else {
          candidates = this.searchVectorDb(outputData, 20);
      }

      return candidates.map(c => ({ char: c.char, score: c.score }));
  }
}