import * as ort from 'onnxruntime-web';
import { FeatureExtractor, type BaseFeatureMaps } from './FeatureExtractor';
import { _unused } from './common';

const BASE_URL = import.meta.env.BASE_URL;

export interface VectorDbEntry {
    char: string;
    vector: Float32Array; 
    width: number;
    bitmap: Uint8Array; // 0-255 (グレースケール、40x40)
    entryX: number | null;
    exitX: number | null;
}

interface BeamNode {
    text: string;
    score: number;
    x: number;
    lastChar: string;
    contextData: ImageData | null; 
    residualMap: Uint8Array | null; 
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
    classifierSession: ort.InferenceSession | null = null;
    draftSession: ort.InferenceSession | null = null;
    encoderSession: ort.InferenceSession | null = null;

    mode: 'classifier' | 'vector' = 'classifier';
    vectorDb: VectorDbEntry[] = [];
    
    fontName = 'Saitamaar';
    charWidthCache: Map<string, number> = new Map();
    spaceWidths = { half: 8.0, full: 16.0, thin: 2.0 };
    
    coordMapA: Float32Array;
    coordMapB: Float32Array;
    focusMask: Float32Array; // ★追加

    private fullClassList: string[] = []; 
    private modelVocab: Set<string> = new Set(); 

    private readonly DOT_CHARS = new Set([".", ",", "､", "'", "`", "´", "′", "ﾞ", "¨", "_", "￣", "＿"]);
    private readonly REFINE_THRESHOLD = 0.2; 
    private readonly DRAFT_THRESHOLD = 0.6;
    private readonly DOT_CONFIDENCE_THRESHOLD = 0.8;

    constructor() {
        this.coordMapA = FeatureExtractor.createCoordMapA();
        this.coordMapB = FeatureExtractor.createCoordMapB();
        this.focusMask = FeatureExtractor.createFocusMask(FeatureExtractor.CROP_SIZE_B);
    }

    async init(classifierUrl: string, draftUrl: string, encoderUrl: string, charListUrl: string = '/aa_chars.json') {
        const fixPath = (path: string) => {
            if (path.startsWith('http')) return path;
            const cleanPath = path.startsWith('/') ? path.slice(1) : path;
            return BASE_URL === '/' ? `/${cleanPath}` : `${BASE_URL}${cleanPath}`;
        };
        
        const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
        ort.env.wasm.wasmPaths = onnxPath;
        ort.env.wasm.numThreads = 2;

        try {
            const targetUrl = fixPath(charListUrl);
            console.log(`[Init] Fetching chars from: ${targetUrl}`);
            
            const res = await fetch(targetUrl);
            if (res.ok) {
                this.fullClassList = await res.json();
                this.modelVocab = new Set(this.fullClassList);
            }
        } catch (e) { console.error("Failed to load char list", e); }

        try {
            const opt = { executionProviders: ['wasm'] };
            this.classifierSession = await ort.InferenceSession.create(fixPath(classifierUrl), opt);
            this.draftSession = await ort.InferenceSession.create(fixPath(draftUrl), opt);
            this.encoderSession = await ort.InferenceSession.create(fixPath(encoderUrl), opt);
            console.log("All Models Loaded");
        } catch (e) { console.error("Model Load Error", e); }
    }

    getLoadedCharList(): string { return this.fullClassList.join(''); }

    // ★追加: ベクトル正規化 (L2 Normalize)
    private normalizeVector(v: Float32Array): Float32Array {
        let sum = 0;
        for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
        const norm = Math.sqrt(sum);
        if (norm < 1e-6) return v; // ゼロ除算防止
        for (let i = 0; i < v.length; i++) v[i]! /= norm;
        return v;
    }

    /**
     * カーニングを考慮した移動量を計算
     */
    private getAdvanceWidth(prevChar: string, currChar: string, ctx: CanvasRenderingContext2D): number {
        // 1文字目は単体の幅
        if (!prevChar) return this.charWidthCache.get(currChar) || 8.0;
        
        // "前の文字 + 今の文字" の幅を計測
        const pairWidth = ctx.measureText(prevChar + currChar).width;
        // "前の文字" の幅（キャッシュ推奨だがここでは簡易的に計測またはキャッシュ利用）
        const prevWidth = this.charWidthCache.get(prevChar) || ctx.measureText(prevChar).width;
        
        // 差分が実質的な移動量 (カーニング込み)
        return pairWidth - prevWidth;
    }

    async updateDatabase(fontUrl: string | null, allowedChars: string, fontName: string) {
        this.fontName = fontName;
        if (fontUrl && fontUrl.startsWith('blob:')) {
            try {
                const font = new FontFace(fontName, `url(${fontUrl})`);
                await font.load();
                document.fonts.add(font);
            } catch (e) { console.error("Font Load Error", e); }
        }
        this.updateFontMetrics(fontName, allowedChars);

        const uniqueChars = Array.from(new Set(allowedChars.split('')));
        const isSubset = uniqueChars.every(c => this.modelVocab.has(c));

        if (fontName === 'Saitamaar' && isSubset) {
            this.mode = 'classifier';
            console.log("Mode: Classifier (Code A)");
        } else {
            this.mode = 'vector';
            console.log("Mode: Vector Search (Code B) - Building DB...");
            await this.buildVectorDb(allowedChars);
        }
    }

    updateAllowedChars(allowedChars: string) {
        this.updateDatabase(null, allowedChars, this.fontName);
    }

    private updateFontMetrics(fontName: string, allowedChars: string) {
        this.charWidthCache.clear();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.font = `16px "${fontName}"`; 
        
        const uniqueChars = Array.from(new Set(allowedChars.split('')));
        for (const c of uniqueChars) {
            this.charWidthCache.set(c, ctx.measureText(c).width);
        }
        
        this.spaceWidths.half = ctx.measureText(' ').width;
        this.spaceWidths.full = ctx.measureText('　').width;
        this.spaceWidths.thin = ctx.measureText('\u2009').width;
        
        this.charWidthCache.set(' ', this.spaceWidths.half);
        this.charWidthCache.set('　', this.spaceWidths.full);
        this.charWidthCache.set('\u2009', this.spaceWidths.thin);
    }

    async buildVectorDb(chars: string) {
        if (!this.encoderSession) return;
        
        this.vectorDb = [];
        const C = FeatureExtractor.CROP_SIZE_B; // 40
        const canvas = document.createElement('canvas');
        canvas.width = C; canvas.height = C;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        
        const uniqueChars = Array.from(new Set(chars.split('')));
        
        // Timer重複エラー回避のため、ラベルを一意にするかtryで囲むのが無難ですが
        // ここでは単純に console.log に変更します
        console.log("Start DB Build...");
        
        for (const char of uniqueChars) {
            // 1. 文字描画 (白背景・黒文字)
            ctx.fillStyle = "white"; ctx.fillRect(0, 0, C, C);
            ctx.fillStyle = "black";
            ctx.font = `16px "${this.fontName}"`;
            ctx.textBaseline = "middle"; ctx.textAlign = "left";
            ctx.fillText(char, C / 2, C / 2);

            const imgData = ctx.getImageData(0, 0, C, C);
            const bitmap = new Uint8Array(C * C);
            
            // 2. 接続点解析
            let topMoment = 0; let topMass = 0;
            let bottomMoment = 0; let bottomMass = 0;
            const scanHeight = 10; 

            for (let i = 0; i < C * C; i++) {
                const val = 255 - imgData.data[i * 4]!; 
                bitmap[i] = val;

                const y = Math.floor(i / C);
                const x = i % C;

                if (y < scanHeight && val > 128) {
                    topMoment += x * val;
                    topMass += val;
                }
                if (y >= C - scanHeight && val > 128) {
                    bottomMoment += x * val;
                    bottomMass += val;
                }
            }

            const entryX = topMass > 0 ? (topMoment / topMass) - (C / 2) : null;
            const exitX = bottomMass > 0 ? (bottomMoment / bottomMass) - (C / 2) : null;

            // 3. ベクトル生成 (Encoder)
            // ★修正: generateVectorBaseFeatures -> generateBaseFeatures
            const feats = FeatureExtractor.generateBaseFeatures(canvas);
            
            // ★修正: extractPatchVector -> extractPatch40_6ch
            const inputTensor = FeatureExtractor.extractPatch40_6ch(feats, C/2, C/2, this.coordMapB);
            
            // ★修正: 以下の行（delete処理）を削除しました
            // feats.inv.delete(); feats.dist.delete(); ... 

            const tensor = new ort.Tensor('float32', inputTensor, [1, C, C, 6]);
            const results = await this.encoderSession.run({ [this.encoderSession.inputNames[0]!]: tensor });
            let vector = results[this.encoderSession.outputNames[0]!]!.data as Float32Array;

            // 正規化して保存
            vector = this.normalizeVector(vector);

            this.vectorDb.push({
                char: char, 
                vector: vector, 
                width: this.charWidthCache.get(char) || 8.0, 
                bitmap: bitmap,
                entryX: entryX, 
                exitX: exitX
            });
        }
        console.log(`DB Rebuilt: ${this.vectorDb.length} chars`);
    }

    private searchVectorDb(query: Float32Array, k: number) {
        if (this.vectorDb.length === 0) return [];
        
        const scores = this.vectorDb.map(entry => {
            let dot = 0;
            for(let i=0; i<128; i++) dot += query[i]! * entry.vector[i]!;
            return { entry: entry, score: dot }; 
        });
        
        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, k);
    }

    private findConnectionAnchor(ctx: CanvasRenderingContext2D, centerX: number, yOffset: number): number | null {
        const scanW = 12;
        const startX = Math.floor(centerX - scanW/2);
        if (startX < 0) return null;
        try {
            const data = ctx.getImageData(startX, yOffset, scanW, 1).data;
            let mass = 0;
            let moment = 0;
            for(let x=0; x<scanW; x++) {
                const val = 255 - data[x*4]!; 
                if(val > 128) {
                    mass += val;
                    moment += x * val;
                }
            }
            if(mass > 0) return startX + (moment / mass);
        } catch(e) {}
        return null;
    }

    private findNextInkX(features: BaseFeatureMaps, startX: number, lineCenterY: number, threshold: number = 128): number | null {
        const w = features.width;
        const endX = Math.min(w, startX + 100);
        const scanHeight = 16; 
        const yStart = Math.floor(lineCenterY - scanHeight / 2);
        const data = features.invData; 

        for (let x = Math.floor(startX); x < endX; x++) {
            let colSum = 0;
            for (let y = 0; y < scanHeight; y++) {
                const gy = yStart + y;
                if (gy >= 0 && gy < features.height) {
                    colSum += data[gy * w + x]!;
                }
            }
            if (colSum > threshold) return x;
        }
        return null;
    }

private addSpaceCandidatesCommon(
        candidates: any[], parent: BeamNode, baseFeatures: BaseFeatureMaps, 
        lineCenterY: number, width: number, bbsMode: boolean, useThinSpace: boolean, 
        paintMaskData: Uint8ClampedArray | null,
        patternBlue: string,
        patternRed: string,
        basePenalty: number = 0, isCodeB: boolean = false
    ) {
        // --- 1. ハッチング判定 ---
        let hatchingChar = "";
        
        if (paintMaskData) {
            const maskX = Math.floor(parent.x + 4);
            if (maskX >= 0 && maskX < width) {
                const idx = (16 * width + maskX) * 4;
                if (idx < paintMaskData.length) {
                    const r = paintMaskData[idx]!;
                    const b = paintMaskData[idx + 2]!;
                    const a = paintMaskData[idx + 3]!;

                    if (a > 0) { 
                        // 青色判定 (緩和: b>100)
                        if (b > 100 && r < 150 && patternBlue) {
                            hatchingChar = this.getNextPatternChar(patternBlue, parent.lastChar);
                        } 
                        // 赤色判定 (緩和: r>100)
                        else if (r > 100 && b < 150 && patternRed) {
                            hatchingChar = this.getNextPatternChar(patternRed, parent.lastChar);
                        }
                    }
                }
            }
        }

        // --- 2. ハッチング文字の追加 (ハッチング有効時) ---
        if (hatchingChar) {
            const w = this.charWidthCache.get(hatchingChar) || 8.0;
            if (isCodeB) {
                candidates.push({
                    type: 'char',
                    parent: parent,
                    char: hatchingChar,
                    width: w,
                    bitmap: new Uint8Array(1600), // Dummy
                    leftX: 0,
                    score: parent.score + basePenalty + 5.0, // 強力なボーナス
                    stepScore: basePenalty + 5.0
                });
            } else {
                candidates.push({
                    text: parent.text + hatchingChar,
                    score: parent.score + basePenalty + 5.0,
                    x: parent.x + w,
                    lastChar: hatchingChar,
                    contextData: parent.contextData,
                    residualMap: parent.residualMap
                });
            }
            return; // ハッチング時はスペース探索をスキップ
        }
        
        // --- 3. 通常スペース探索 ---
        const nextInkX = this.findNextInkX(baseFeatures, parent.x + 2, lineCenterY);
        const distToTarget = nextInkX !== null ? (nextInkX - parent.x) : null;

        const spaces = [];
        const canUseHalf = !bbsMode || (parent.text !== "" && parent.lastChar !== ' ');
        if (canUseHalf) spaces.push({ char: ' ', width: this.spaceWidths.half });
        spaces.push({ char: '　', width: this.spaceWidths.full });
        if (useThinSpace) spaces.push({ char: '\u2009', width: this.spaceWidths.thin });
        
        // ★修正: 少なくとも1つは候補に追加するためのフラグ
        let anySpaceAdded = false;

        for (const sp of spaces) {
            // ★修正: ThinSpace不使用時は、半角スペースの距離制限を緩和する
            // もし「ThinSpace禁止」かつ「このスペースが半角スペース」なら、
            // 距離チェック (distToTarget) をスキップして、無理やり通す。
            const isForcedHalf = !useThinSpace && sp.char === ' ';

            if (!isForcedHalf) {
                if (distToTarget !== null && sp.width > distToTarget + 2.0) continue; 
            }

            let alignmentBonus = 0.0;
            if (distToTarget !== null) {
                const remaining = distToTarget - sp.width;
                if (Math.abs(remaining) < 1.0) alignmentBonus += 3.0; 
                if (remaining > 0) {
                    const remHalf = remaining % this.spaceWidths.half;
                    if (remHalf < 1.0 || remHalf > this.spaceWidths.half - 1.0) alignmentBonus += 1.0;
                    if (useThinSpace) {
                        const remThin = remaining % this.spaceWidths.thin;
                        if (remThin < 0.5 || remThin > this.spaceWidths.thin - 0.5) alignmentBonus += 0.5;
                    }
                }
            }
            if (isCodeB) {
                candidates.push({
                    type: 'space', parent: parent, char: sp.char, width: sp.width,
                    score: parent.score + basePenalty + alignmentBonus, stepScore: basePenalty + alignmentBonus
                });
            } else {
                candidates.push({
                    text: parent.text + sp.char, score: parent.score + basePenalty + alignmentBonus,
                    x: parent.x + sp.width, lastChar: sp.char,
                    contextData: parent.contextData, residualMap: parent.residualMap
                });
            }
            anySpaceAdded = true;
        }
        // ▼▼▼ 修正: 強力な救済措置 (Fallback) ▼▼▼
        // 距離制限ですべて弾かれてしまった場合、生成が止まるのを防ぐために
        // 「現在使える最小のスペース」を強制的に採用します。
        if (!anySpaceAdded) {
             let fallbackSpace = null;
             
             // 1. 半角が使えるなら半角を強制
             if (canUseHalf) {
                 fallbackSpace = { char: ' ', width: this.spaceWidths.half };
             } 
             // 2. 半角禁止(行頭など)なら、やむを得ず全角を強制
             else {
                 fallbackSpace = { char: '　', width: this.spaceWidths.full };
             }
             
             if (fallbackSpace) {
                 const sp = fallbackSpace;
                 // ペナルティを与えて、他に選択肢があるなら選ばれないようにする
                 const forcedScore = parent.score + basePenalty - 1.0; 
                 
                 if (isCodeB) {
                    candidates.push({
                        type: 'space', parent: parent, char: sp.char, width: sp.width,
                        score: forcedScore, stepScore: -1.0
                    });
                } else {
                    candidates.push({
                        text: parent.text + sp.char, score: forcedScore,
                        x: parent.x + sp.width, lastChar: sp.char,
                        contextData: parent.contextData, residualMap: parent.residualMap
                    });
                }
            }
        }
    }

async solveLine(
        baseFeatures: BaseFeatureMaps, width: number,
        targetCharBlue: string, targetCharRed: string, paintMaskData: Uint8ClampedArray | null, 
        lineCenterY: number, generationMode: 'hybrid' | 'accurate', 
        measureCtx: CanvasRenderingContext2D | null, prevBottomEdge: any, 
        bbsMode: boolean, useThinSpace: boolean,
        debugCanvas: HTMLCanvasElement | null = null, accumulatedCanvas: HTMLCanvasElement | null = null
    ): Promise<{ text: string, bottomEdge: Float32Array | null }> {
        _unused(generationMode, debugCanvas, prevBottomEdge)

        if (this.mode === 'classifier' && !this.classifierSession) return { text: "", bottomEdge: null };
        if (this.mode === 'vector' && !this.encoderSession) return { text: "", bottomEdge: null };

        const PADDING_LEFT = 10;
        const BEAM_WIDTH = 5;
        
        const validateAndFixChar = (char: string, currentText: string, lastChar: string): string | null => {
            if (!useThinSpace && char === '\u2009') return null;
            if (bbsMode) {
                if (char === ' ' && currentText === "") return '　';
                if (char === ' ' && lastChar === ' ') return '　';
            }
            return char;
        };

        // --- Mode A: Classifier ---
        if (this.mode === 'classifier') {
            const C = FeatureExtractor.CROP_SIZE_A; 
            let nextRowCanvas: HTMLCanvasElement | null = null;
            const nextLineY = lineCenterY + FeatureExtractor.LINE_HEIGHT;
            if (this.draftSession && nextLineY < baseFeatures.height) {
                nextRowCanvas = await this.runDraftInference(baseFeatures, width, nextLineY);
            }

            const rowCanvas = document.createElement('canvas');
            rowCanvas.width = width; rowCanvas.height = C;
            const ctx = rowCanvas.getContext('2d', { willReadFrequently: true })!;
            ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, C);
            ctx.font = `16px "${this.fontName}"`; ctx.textBaseline = "middle"; ctx.fillStyle = "black";

            let prevRowCanvas: HTMLCanvasElement | null = null;
            if (accumulatedCanvas) {
                prevRowCanvas = document.createElement('canvas');
                prevRowCanvas.width = width; prevRowCanvas.height = C;
                const prevCtx = prevRowCanvas.getContext('2d')!;
                const srcY = (lineCenterY - FeatureExtractor.LINE_HEIGHT) - (C / 2);
                prevCtx.drawImage(accumulatedCanvas, 0, srcY, width, C, 0, 0, width, C);
            }

            const initialImageData = ctx.getImageData(0, 0, width, C);
            let beams: BeamNode[] = [{ text: "", score: 0.0, x: 0.0, lastChar: "", contextData: initialImageData, residualMap: null }];
            let step = 0; const maxSteps = width * 2;

            while (beams.some(b => b.x < width - PADDING_LEFT) && step < maxSteps) {
                step++;
                const nextCandidates: BeamNode[] = [];
                const finishedBeams: BeamNode[] = [];

                for (const beam of beams) {
                    if (beam.x >= width - PADDING_LEFT) { finishedBeams.push(beam); continue; }
                    
                    // ★修正: 強制ハッチングチェックを削除
                    // ここにあった if (isMasked) ... は不要です。
                    // 以下の Density Check が「インクあり」と判定すれば文字生成へ、
                    // 「インクなし（空白）」と判定すれば addSpaceCandidatesCommon へ飛び、
                    // そこで初めてハッチングが適用されます。

                    const centerX = beam.x + PADDING_LEFT;
                    ctx.putImageData(beam.contextData!, 0, 0);
                    const patch9ch = FeatureExtractor.extractPatch48_9ch(baseFeatures, rowCanvas, prevRowCanvas, nextRowCanvas, centerX, lineCenterY, this.coordMapA);

                    let centerDensity = 0;
                    for (let dy = 16; dy < 32; dy++) for (let dx = 20; dx < 28; dx++) centerDensity += patch9ch[(dy * 48 + dx) * 9 + 4]!;
                    
                    if (centerDensity < 500.0) { 
                        // インクがない（空白） -> ハッチングのチャンス
                        this.addSpaceCandidatesCommon(nextCandidates, beam, baseFeatures, lineCenterY, width, bbsMode, useThinSpace, 
                                                        paintMaskData, targetCharBlue, targetCharRed);
                        continue;
                    }

                    // インクがある -> 通常の推論
                    const floatInput = new Float32Array(patch9ch.length);
                    for(let i=0; i<patch9ch.length; i++) floatInput[i] = patch9ch[i]! / 255.0;
                    const tensor = new ort.Tensor('float32', floatInput, [1, 48, 48, 9]);
                    const results = await this.classifierSession!.run({ [this.classifierSession!.inputNames[0]!]: tensor });
                    const logits = results[this.classifierSession!.outputNames[0]!]!.data as Float32Array;
                    const topK = this.getTopK(this.softmax(logits), 5);

                    let added = false;
                    for (const cand of topK) {
                        const char = cand.char;
                        if (char === ' ' || char === '　') continue;
                        if (cand.score! < this.REFINE_THRESHOLD) continue;
                        if (this.DOT_CHARS.has(char) && cand.score! < this.DOT_CONFIDENCE_THRESHOLD) continue;
                        if ((char === 'ー' || char === '―' || char === '-') && cand.score! < 0.7) continue;

                        const charToUse = validateAndFixChar(char, beam.text, beam.lastChar);
                        if (!charToUse) continue;

                        const w = this.charWidthCache.get(charToUse) || 8.0;
                        ctx.putImageData(beam.contextData!, 0, 0);
                        ctx.fillText(charToUse, beam.x + PADDING_LEFT, 24); 
                        nextCandidates.push({
                            text: beam.text + charToUse, score: beam.score + Math.log(cand.score! + 1e-9), x: beam.x + w,
                            lastChar: charToUse, contextData: ctx.getImageData(0, 0, width, C), residualMap: null
                        });
                        added = true;
                    }
                    if (!added) this.addSpaceCandidatesCommon(nextCandidates, beam, baseFeatures, lineCenterY, width, bbsMode, useThinSpace, 
                                                                paintMaskData, targetCharBlue, targetCharRed, -0.5);
                }
                nextCandidates.sort((a, b) => b.score - a.score);
                beams = nextCandidates.slice(0, BEAM_WIDTH);
                finishedBeams.forEach(b => beams.push(b));
                if (beams.length > 0 && beams.every(b => b.x >= width - PADDING_LEFT)) break;
            }
            beams.sort((a, b) => b.score - a.score);
            return { text: beams[0] ? beams[0].text : "", bottomEdge: null };
        }

        // --- Mode B: Vector Search (Code B) ---
        else {
            const C = FeatureExtractor.CROP_SIZE_B; 
            const startY = Math.floor(lineCenterY - C / 2);
            const initialResidual = new Uint8Array(width * C);
            const srcData = baseFeatures.invData;
            const globalW = baseFeatures.width;

            for(let y=0; y<C; y++) {
                const gy = startY + y;
                if (gy < 0 || gy >= baseFeatures.height) continue;
                for(let x=0; x<width; x++) initialResidual[y * width + x] = srcData[gy * globalW + x]!;
            }

            let prevRowData: Uint8ClampedArray | null = null;
            if (accumulatedCanvas) {
                const prevCtx = accumulatedCanvas.getContext('2d')!;
                const sampleY = Math.floor(lineCenterY - 10); 
                if (sampleY >= 0) prevRowData = prevCtx.getImageData(0, sampleY, width, 1).data;
            }

            let nextRowData: Uint8ClampedArray | null = null;
            const nextLineY = lineCenterY + FeatureExtractor.LINE_HEIGHT;
            if (this.draftSession && nextLineY < baseFeatures.height) {
                const nextDraftCanvas = await this.runDraftInference(baseFeatures, width, nextLineY);
                const nextCtx = nextDraftCanvas.getContext('2d')!;
                nextRowData = nextCtx.getImageData(0, 8, width, 1).data;
            }

            let beams: BeamNode[] = [{ text: "", score: 0.0, x: 0.0, lastChar: "", contextData: null, residualMap: initialResidual }];
            let step = 0; const maxSteps = width * 2;
            const patchCanvas = document.createElement('canvas');
            patchCanvas.width = C; patchCanvas.height = C;
            const pCtx = patchCanvas.getContext('2d', { willReadFrequently: true })!;
            const patchImgData = pCtx.createImageData(C, C);

            while (beams.some(b => b.x < width - PADDING_LEFT) && step < maxSteps) {
                step++;
                const nextCandidates: any[] = [];
                const finishedBeams: BeamNode[] = [];

                for (const beam of beams) {
                    if (beam.x >= width - PADDING_LEFT) { finishedBeams.push(beam); continue; }
                    const centerX = Math.floor(beam.x + PADDING_LEFT);
                    
                    // ★修正: Code B でも強制ハッチングチェックを削除

                    const leftX = Math.floor(centerX - C / 2);

                    let hasPrevConnection = false;
                    if (prevRowData) {
                        const anchor = this.findConnectionAnchor(accumulatedCanvas!.getContext('2d')!, centerX, lineCenterY - 10);
                        if (anchor !== null && Math.abs(anchor - centerX) < 6) hasPrevConnection = true;
                    }
                    
                    let hasNextConnection = false;
                    if (nextRowData && nextRowData.length > 0) {
                        let scanMass = 0;
                        for(let k = -4; k <= 4; k++) {
                            const px = centerX + k;
                            if (px >= 0 && px < width) {
                                const idx = px * 4;
                                if (idx < nextRowData.length) {
                                    const val = 255 - nextRowData[idx]!;
                                    if (val > 128) scanMass++;
                                }
                            }
                        }
                        if (scanMass > 0) hasNextConnection = true;
                    }

                    let inkSum = 0;
                    for(let y=0; y<C; y++) {
                        for(let x=0; x<C; x++) {
                            const gx = leftX + x;
                            let val = 0;
                            if (gx >= 0 && gx < width) val = beam.residualMap![y * width + gx]!;
                            
                            const maskVal = this.focusMask[y * C + x]!;
                            val = val * maskVal; 

                            const idx = (y * C + x) * 4;
                            const c = Math.min(255, Math.floor(val));
                            patchImgData.data[idx] = c; patchImgData.data[idx+1] = c;
                            patchImgData.data[idx+2] = c; patchImgData.data[idx+3] = 255;

                            if (y >= 16 && y < 24 && x >= 16 && x < 24) inkSum += val;
                        }
                    }
                    
                    if (inkSum < 100) { 
                        // インクなし -> ハッチング
                        this.addSpaceCandidatesCommon(nextCandidates, beam, baseFeatures, lineCenterY, width, bbsMode, useThinSpace, 
                                                        paintMaskData, targetCharBlue, targetCharRed, 0, true);
                        continue;
                    }

                    pCtx.putImageData(patchImgData, 0, 0);
                    const feats = FeatureExtractor.generateBaseFeatures(patchCanvas);
                    const inputTensor = FeatureExtractor.extractPatch40_6ch(feats, C/2, C/2, this.coordMapB);
                    const tensor = new ort.Tensor('float32', inputTensor, [1, C, C, 6]);
                    const res = await this.encoderSession!.run({ [this.encoderSession!.inputNames[0]!]: tensor });
                    let vector = res[this.encoderSession!.outputNames[0]!]!.data as Float32Array;
                    vector = this.normalizeVector(vector);

                    const dbCands = this.searchVectorDb(vector, 30);
                    
                    let validCandFound = false;
                    for (const item of dbCands) {
                        const entry = item.entry;
                        const vecScore = item.score; 
                        if (vecScore < 0.2) continue;
                        if (entry.char === ' ' || entry.char === '　') continue;

                        const charToUse = validateAndFixChar(entry.char, beam.text, beam.lastChar);
                        if (!charToUse) continue;

                        let advance = entry.width;
                        if (measureCtx) advance = this.getAdvanceWidth(beam.lastChar, charToUse, measureCtx);

                        let charInkSum = 0; let targetInkSum = 0;
                        let inkConsumed = 0; let inkWasted = 0;

                        for(let i=0; i<C*C; i++) {
                            const charVal = entry.bitmap[i]!; 
                            charInkSum += charVal;
                            const py = Math.floor(i / C); const px = i % C; const gx = leftX + px;
                            let targetVal = 0;
                            if (gx >= 0 && gx < width) targetVal = beam.residualMap![py * width + gx]!; 
                            if (charVal > 10 || targetVal > 10) targetInkSum += targetVal;
                            inkConsumed += Math.min(charVal, targetVal);
                            inkWasted += Math.max(0, charVal - targetVal);
                        }

                        const charPixels = charInkSum / 255.0;
                        const targetPixels = targetInkSum / 255.0;
                        const intersectPixels = inkConsumed / 255.0;
                        const excessPixels = inkWasted / 255.0;

                        const coverage = targetPixels > 1.0 ? intersectPixels / targetPixels : 0;
                        const excessRatio = charPixels > 1.0 ? excessPixels / charPixels : 0;
                        
                        let connBonus = 0.0;
                        if (hasPrevConnection && entry.entryX !== null) connBonus += 0.5;
                        if (hasNextConnection && entry.exitX !== null) connBonus += 0.5;

                        const stepScore = vecScore + (coverage * 0.8) - (excessRatio * 0.5) + connBonus;

                        nextCandidates.push({
                            type: 'char', parent: beam, char: charToUse,
                            width: advance, bitmap: entry.bitmap, leftX: leftX,
                            score: beam.score + stepScore, stepScore: stepScore
                        });
                        validCandFound = true;
                    }

                    if (!validCandFound) {
                        this.addSpaceCandidatesCommon(nextCandidates, beam, baseFeatures, lineCenterY, width, bbsMode, useThinSpace, 
                                                        paintMaskData, targetCharBlue, targetCharRed, -0.1, true);
                    }
                }

                nextCandidates.sort((a, b) => b.score - a.score);
                const survivors = nextCandidates.slice(0, BEAM_WIDTH);
                
                beams = [];
                for (const item of survivors) {
                    const newResidual = new Uint8Array(item.parent.residualMap);
                    if (item.type === 'char') {
                        const leftX = item.leftX;
                        const bitmap = item.bitmap;
                        for(let i=0; i<C*C; i++) {
                            if (bitmap[i] > 20) {
                                const py = Math.floor(i / C); const px = i % C; const gx = leftX + px;
                                if (gx >= 0 && gx < width) newResidual[py * width + gx] = 0;
                            }
                        }
                    }
                    beams.push({
                        text: item.parent.text + item.char, score: item.score,
                        x: item.parent.x + item.width, lastChar: item.char,
                        contextData: null, residualMap: newResidual
                    });
                }
                finishedBeams.forEach(b => beams.push(b));
                if (beams.length > 0 && beams.every(b => b.x >= width - PADDING_LEFT)) break;
            }
            beams.sort((a, b) => b.score - a.score);
            return { text: beams[0] ? beams[0].text : "", bottomEdge: null };
        }
    }

    // [Draft Inference (Code A)]
    // 前回の実装と同じ (コンテキストなしで高速予測)
    private async runDraftInference(
        baseFeatures: BaseFeatureMaps, 
        width: number, 
        lineCenterY: number
    ): Promise<HTMLCanvasElement> {
        const C = FeatureExtractor.CROP_SIZE_A;
        const draftCanvas = document.createElement('canvas');
        draftCanvas.width = width; draftCanvas.height = C;
        const ctx = draftCanvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, C);
        ctx.font = `16px "${this.fontName}"`; ctx.textBaseline = "middle"; ctx.fillStyle = "black";

        if (!this.draftSession) return draftCanvas;
        const PADDING_LEFT = 10;
        let currentX = 0;

        while (currentX < width - PADDING_LEFT) {
            const centerX = currentX + PADDING_LEFT;
            const patch6ch = FeatureExtractor.extractPatchDraft(baseFeatures, centerX, lineCenterY, this.coordMapA);

            let centerDensity = 0;
            for (let dy = 16; dy < 32; dy++) for (let dx = 20; dx < 28; dx++) centerDensity += patch6ch[(dy * 48 + dx) * 6 + 1]!;
            
            if (centerDensity < 800.0) { 
                currentX += this.spaceWidths.half; continue; 
            }

            const floatInput = new Float32Array(patch6ch.length);
            for(let i=0; i<patch6ch.length; i++) floatInput[i] = patch6ch[i]! / 255.0;
            const tensor = new ort.Tensor('float32', floatInput, [1, 48, 48, 6]);
            const results = await this.draftSession.run({ [this.draftSession.inputNames[0]!]: tensor });
            const logits = results[this.draftSession.outputNames[0]!]!.data as Float32Array;
            const best = this.getTopK(this.softmax(logits), 1)[0];
            
            let char = best!.char;
            if (best!.score! < this.DRAFT_THRESHOLD) char = ' ';
            
            if (char !== ' ' && char !== '　') {
                ctx.fillText(char, centerX, 24);
                const w = this.charWidthCache.get(char) || 8.0;
                currentX += Math.max(w, 2.0);
            } else {
                currentX += this.spaceWidths.half;
            }
        }
        return draftCanvas;
    }

    private softmax(logits: Float32Array): Float32Array {
        const max = logits.reduce((a, b) => Math.max(a, b), -Infinity);
        const exps = logits.map(v => Math.exp(v - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        return exps.map(v => v / sum);
    }

    private getTopK(probs: Float32Array, k: number) {
        const candidates = [];
        for(let i=0; i<probs.length; i++) candidates.push({ idx: i, score: probs[i] });
        candidates.sort((a, b) => b.score! - a.score!);
        return candidates.slice(0, k).map(c => ({ char: this.fullClassList[c.idx] || ' ', score: c.score }));
    }

/**
     * [Ghost] キャレット位置の次の1文字を予測する
     */
    async suggestText(
        baseFeatures: BaseFeatureMaps, 
        localCenterX: number, 
        localCenterY: number,
        // ★追加引数
        patternBlue: string = "",
        patternRed: string = "",
        beamWidth: number = 1,
        paintMaskData: Uint8ClampedArray | null = null,
        roiGlobalX: number = 0, // 今回は使わないがIF互換のため
        maskStride: number = 0,
        prevChar: string = "" // ★追加
    ): Promise<string> {
        _unused(beamWidth, roiGlobalX);

        // ヘルパー: ハッチング判定
        const checkHatching = (): string | null => {
            if (!paintMaskData || maskStride <= 0) return null;
            
            const mx = Math.floor(localCenterX);
            const my = Math.floor(localCenterY); // 24
            
            if (mx < 0 || mx >= maskStride) return null;
            
            const idx = (my * maskStride + mx) * 4;
            
            if (idx < paintMaskData.length) {
                const r = paintMaskData[idx]!;
                const b = paintMaskData[idx+2]!;
                const a = paintMaskData[idx+3]!;
                
                if (a > 0) {
                    // 青色判定
                    if (b > 100 && r < 150 && patternBlue) {
                        // ★修正: 直前の文字を考慮して次のパターン文字を取得
                        return this.getNextPatternChar(patternBlue, prevChar);
                    }
                    // 赤色判定
                    if (r > 100 && b < 150 && patternRed) {
                        // ★修正: 同上
                        return this.getNextPatternChar(patternRed, prevChar);
                    }
                }
            }
            return null;
        };
        // --- Mode A: Classifier (48px, 9ch) ---
        if (this.mode === 'classifier') {
            if (!this.classifierSession) return "";
            
            const C = FeatureExtractor.CROP_SIZE_A; // 48
            const dummyContext = document.createElement('canvas');
            dummyContext.width = C; dummyContext.height = C;
            const ctx = dummyContext.getContext('2d')!;
            ctx.fillStyle = "white"; ctx.fillRect(0,0,C,C);

            const patch = FeatureExtractor.extractPatch48_9ch(
                baseFeatures, 
                dummyContext, 
                null, null,
                localCenterX, localCenterY, 
                this.coordMapA
            );
            
            // 密度チェック
            let centerDensity = 0;
            for (let dy = 16; dy < 32; dy++) {
                for (let dx = 20; dx < 28; dx++) {
                    centerDensity += patch[(dy * 48 + dx) * 9 + 4]!;
                }
            }
            
            // 空白判定
            if (centerDensity < 300.0) {
                // ★ハッチングチェック
                const hatch = checkHatching();
                if (hatch) return hatch;
                
                return '　'; // なければ全角スペース
            }

            const floatInput = new Float32Array(patch.length);
            for(let i=0; i<patch.length; i++) floatInput[i] = patch[i]! / 255.0;
            
            const tensor = new ort.Tensor('float32', floatInput, [1, 48, 48, 9]);
            const results = await this.classifierSession.run({ [this.classifierSession.inputNames[0]!]: tensor });
            const logits = results[this.classifierSession.outputNames[0]!]!.data as Float32Array;
            
            const best = this.getTopK(this.softmax(logits), 1)[0];
            return (best && best.score! > 0.3) ? best.char : "";
        }

        // --- Mode B: Vector Search (40px, 6ch) ---
        else {
            if (!this.encoderSession) return "";

            const C = FeatureExtractor.CROP_SIZE_B; // 40
            const inputTensor = FeatureExtractor.extractPatch40_6ch(
                baseFeatures, localCenterX, localCenterY, this.coordMapB
            );

            // 密度チェック
            let inkSum = 0;
            for(let y=16; y<24; y++) {
                for(let x=16; x<24; x++) {
                    inkSum += inputTensor[(y*C+x)*6 + 0]! * 255.0;
                }
            }
            
            if (inkSum < 30.0) {
                // ★ハッチングチェック
                const hatch = checkHatching();
                if (hatch) return hatch;
                
                return '　';
            }

            const tensor = new ort.Tensor('float32', inputTensor, [1, C, C, 6]);
            const res = await this.encoderSession.run({ [this.encoderSession.inputNames[0]!]: tensor });
            let vector = res[this.encoderSession.outputNames[0]!]!.data as Float32Array;
            vector = this.normalizeVector(vector);

            const candidates = this.searchVectorDb(vector, 1);
            if (candidates.length > 0) {
                const best = candidates[0];
                if (best!.score > 0.4) return best!.entry.char;
            }
            return "";
        }
    }
    /**
     * [Context Menu] 指定位置の候補リスト(Top-K)を返す
     */
    async getCandidatesAt(
        baseFeatures: BaseFeatureMaps, 
        localCenterX: number, 
        localCenterY: number
    ): Promise<{ char: string, score: number }[]> {
        
        // --- Mode A ---
        if (this.mode === 'classifier') {
            if (!this.classifierSession) return [];
            const C = FeatureExtractor.CROP_SIZE_A;
            const dummyContext = document.createElement('canvas');
            dummyContext.width = C; dummyContext.height = C;
            const ctx = dummyContext.getContext('2d')!;
            ctx.fillStyle = "white"; ctx.fillRect(0,0,C,C);

            const patch = FeatureExtractor.extractPatch48_9ch(
                baseFeatures, dummyContext, null, null, localCenterX, localCenterY, this.coordMapA
            );
            
            const floatInput = new Float32Array(patch.length);
            for(let i=0; i<patch.length; i++) floatInput[i] = patch[i]! / 255.0;
            
            const tensor = new ort.Tensor('float32', floatInput, [1, 48, 48, 9]);
            const results = await this.classifierSession.run({ [this.classifierSession.inputNames[0]!]: tensor });
            const logits = results[this.classifierSession.outputNames[0]!]!.data as Float32Array;
            
            // Top 10 を返す
            //@ts-ignore
            return this.getTopK(this.softmax(logits), 10);
        }

        // --- Mode B ---
        else {
            if (!this.encoderSession) return [];
            const C = FeatureExtractor.CROP_SIZE_B; // 40

            const inputTensor = FeatureExtractor.extractPatch40_6ch(
                baseFeatures, localCenterX, localCenterY, this.coordMapB
            );

            const tensor = new ort.Tensor('float32', inputTensor, [1, C, C, 6]);
            const res = await this.encoderSession.run({ [this.encoderSession.inputNames[0]!]: tensor });
            let vector = res[this.encoderSession.outputNames[0]!]!.data as Float32Array;
            vector = this.normalizeVector(vector);

            // Top 20 検索
            const rawCands = this.searchVectorDb(vector, 20);
            
            // UI用に整形 ({ char, score })
            return rawCands.map(c => ({
                char: c.entry.char,
                // ベクトル類似度(0.0-1.0)を、確率っぽく見せるため適当にスケーリング
                score: Math.max(0, c.score) 
            }));
        }
    }

    /**
     * [New] パターン文字列から次の文字を決定する
     * @param pattern 例: "i:" や ": "
     * @param lastChar 直前の文字
     */
    private getNextPatternChar(pattern: string, lastChar: string): string {
        if (!pattern) return "";
        
        // 直前の文字がパターン内のどこにあるか探す
        const idx = pattern.indexOf(lastChar);
        
        if (idx === -1) {
            // パターン外の文字（ハッチング開始時など）なら1文字目から開始
            return pattern[0]!;
        } else {
            // 次の文字（末尾なら先頭へループ）
            return pattern[(idx + 1) % pattern.length]!;
        }
    }
}