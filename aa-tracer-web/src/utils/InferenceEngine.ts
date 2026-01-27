// InferenceEngine.ts
import * as ort from 'onnxruntime-web';
import { FeatureExtractor, type BaseFeatureMaps } from './FeatureExtractor';
import { _unused } from './common';

const BASE_URL = import.meta.env.BASE_URL;

export interface VectorDbEntry {
  char: string;
  vector: Float32Array;
  width: number;
  bitmap: Uint8Array; // inv(0..255), 40x40
  entryX: number | null;
  exitX: number | null;
}

interface BeamNode {
  text: string;
  score: number;
  x: number; // ★キャレット位置(px)として扱う（ここが統一の肝）
  lastChar: string;
  lastWasHalf: boolean;        // ★追加（直前が半角スペース/薄スペか）
  contextData: ImageData | null;
  residualMap: Uint8Array | null; // inv band (C x width)
}

export const DEFAULT_CHARS = (() => {
  let chars = " ";
  for (let i = 33; i < 127; i++) chars += String.fromCharCode(i);
  for (let i = 0xFF61; i < 0xFFA0; i++) chars += String.fromCharCode(i);
  chars += "　\u2009";
  chars += "─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋";
  chars += "｡､･ﾟヽヾゝゞ／＼⊂⊃∪∩∀´｀・…ω";
  return chars;
})();

function fixPath(path: string) {
  if (path.startsWith('http')) return path;
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return BASE_URL === '/' ? `/${clean}` : `${BASE_URL}${clean}`;
}

// ---- 文字画像（gray）を inv に変換（inv: ink=255） ----
function canvasGrayToInv(imgData: ImageData): Uint8Array {
  const W = imgData.width, H = imgData.height;
  const out = new Uint8Array(W * H);
  const d = imgData.data;
  for (let i = 0; i < W * H; i++) {
    const g = d[i * 4] ?? 255; // 既にモノクロで描いてる想定
    out[i] = 255 - g;
  }
  return out;
}

// ---- inv(40x40) から min_x を見つけて「min_x -> centerX」へ横シフト（CodeB基準統一） ----
function shiftInvMinXToCenter(inv: Uint8Array, C: number, centerX: number): Uint8Array {
  let minX = 1e9;
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const v = inv[y * C + x]!;
      if (v > 10) minX = Math.min(minX, x);
    }
  }
  if (minX === 1e9) return inv; // blank

  const shift = centerX - minX;
  const out = new Uint8Array(C * C);
  out.fill(0);
  for (let y = 0; y < C; y++) {
    for (let x = 0; x < C; x++) {
      const nx = x + shift;
      if (0 <= nx && nx < C) out[y * C + nx] = inv[y * C + x]!;
    }
  }
  return out;
}

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
  focusMask: Float32Array;

  private fullClassList: string[] = [];
  private modelVocab: Set<string> = new Set();

  //private readonly DOT_CHARS = new Set([".", ",", "､", "'", "`", "´", "′", "ﾞ", "¨", "_", "￣", "＿"]);
  private readonly CODEA_TRASH_CHARS = new Set([
    ":", ";", ".", "`", "'", "、", "。", "’", "‘", "＇",
    "ﾞ", "ﾟ", "丶", "冫"
  ]);

  //private readonly REFINE_THRESHOLD = 0.2;
  private readonly DRAFT_THRESHOLD = 0.6;
  //private readonly DOT_CONFIDENCE_THRESHOLD = 0.8;

  // CodeB knobs
  private readonly CODEB_BATCH_SIZE_DB = 32;
  private readonly CODEB_BATCH_SIZE_SOLVE = 16;
  private readonly CODEB_TOPK = 30;

  constructor() {
    this.coordMapA = FeatureExtractor.createCoordMapA();
    this.coordMapB = FeatureExtractor.createCoordMapB();
    this.focusMask = FeatureExtractor.createFocusMask(FeatureExtractor.CROP_SIZE_B);
  }

  // -------------------------------------------------------------------------
  // Grapheme tokenizer (for Myanmar / combining sequences / emoji etc.)
  //   - Uses Intl.Segmenter if available
  //   - Filters out control chars like \r \n \t
  // -------------------------------------------------------------------------
  private tokenizeAllowedChars(allowedChars: string): string[] {
    // Normalize newlines etc.
    const s = (allowedChars ?? "").replace(/\r\n/g, "\n");

    // Split into grapheme clusters if possible
    let tokens: string[] = [];
    const Seg = (globalThis as any).Intl?.Segmenter as any;

    if (Seg) {
      try {
        // 'und' (undetermined) tends to work well for generic grapheme segmentation
        const seg = new Seg("und", { granularity: "grapheme" });
        tokens = Array.from(seg.segment(s), (x: any) => x.segment);
      } catch {
        // fallback below
        tokens = Array.from(s);
      }
    } else {
      // Fallback: codepoints (still better than split('') for surrogate pairs)
      tokens = Array.from(s);
    }

    // Filter: remove empty and control chars (incl. newline)
    tokens = tokens.filter(t => {
      if (!t) return false;
      // Exclude common whitespace controls (keep normal space ' ' and full-width space '　' and thin space)
      if (t === "\n" || t === "\r" || t === "\t") return false;
      // Exclude other C0 controls just in case
      if (t.length === 1) {
        const cp = t.codePointAt(0)!;
        if (cp < 0x20) return false;
        if (cp === 0x7f) return false;
      }
      return true;
    });

    // Unique
    return Array.from(new Set(tokens));
  }


  async createSessionFromUrl(url: string) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${url}`);
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    return await ort.InferenceSession.create(u8, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }

  async debugFetchModel(label: string, url: string) {
    const res = await fetch(url, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    console.log(
      `[onnx fetch] ${label}`, url,
      "status", res.status,
      "type", res.headers.get("content-type"),
      "len", u8.length,
      "head16", Array.from(u8.slice(0, 16)).map(v => v.toString(16).padStart(2, '0')).join(' ')
    );
    return u8;
  }

  async init(classifierUrl: string, draftUrl: string | null, encoderUrl: string, charListUrl: string = '/aa_chars.json') {
    const onnxPath = BASE_URL === '/' ? '/onnx/' : `${BASE_URL}onnx/`;
    ort.env.wasm.wasmPaths = onnxPath;
    ort.env.wasm.numThreads = 2;

    await this.debugFetchModel("classifier", classifierUrl);
    await this.debugFetchModel("encoder", encoderUrl);

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
      const opt = { executionProviders: ['wasm'] as const };
      this.classifierSession = await this.createSessionFromUrl(fixPath(classifierUrl));
      if (draftUrl) {
        try { this.draftSession = await this.createSessionFromUrl(fixPath(draftUrl)); }
        catch (e) { console.warn("draft load skipped", e); }
      }
      this.encoderSession = await ort.InferenceSession.create(fixPath(encoderUrl), opt);
      console.log("All Models Loaded");
    } catch (e) { console.error("Model Load Error", e); }
  }

  getLoadedCharList(): string {
    let charsToUse = this.fullClassList.join('');
    if (this.fullClassList.length > 1) {
      charsToUse = this.fullClassList
        .map(c => {
          if (c === '<UNK>') return ' ';
          if (c.length > 1) return '';
          return c;
        })
        .join('');
    }
    return charsToUse;
  }

  private normalizeVector(v: Float32Array): Float32Array {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
    const norm = Math.sqrt(sum);
    if (norm < 1e-6) return v;
    for (let i = 0; i < v.length; i++) v[i]! /= norm;
    return v;
  }

  private getAdvanceWidth(prevChar: string, currChar: string, ctx: CanvasRenderingContext2D): number {
    if (!prevChar) return this.charWidthCache.get(currChar) || this.spaceWidths.half;
    const pairWidth = ctx.measureText(prevChar + currChar).width;
    const prevWidth = this.charWidthCache.get(prevChar) || ctx.measureText(prevChar).width;
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

    const uniqueChars = this.tokenizeAllowedChars(allowedChars);
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

  // -------------------------------------------------------------------------
  // Code B DB build (キャレット基準統一版)
  //   1) 文字を 40x40 に描画（左寄せ）
  //   2) inv を作る
  //   3) inv の min_x を検出し min_x -> x=20 に横シフト（＝キャレット位置）
  //   4) その inv で encoder 入力を作る（FeatureExtractor.patchInv40To6ch）
  // -------------------------------------------------------------------------
  async buildVectorDb(chars: string) {
    if (!this.encoderSession) return;

    this.vectorDb = [];
    const C = FeatureExtractor.CROP_SIZE_B; // 40
    const half = C >> 1; // 20

    const canvas = document.createElement('canvas');
    canvas.width = C; canvas.height = C;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const uniqueChars = this.tokenizeAllowedChars(chars);
    console.log("Start DB Build... (batched, caret-centered)");

    const rendered: Array<{
      char: string;
      width: number;
      bitmapInv: Uint8Array;      // inv(40x40) caret-centered
      entryX: number | null;
      exitX: number | null;
      featsTensor: Float32Array;  // (40*40*6)
    }> = [];

    for (const char of uniqueChars) {
      // 1) render (bg white, ink black)
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, C, C);
      ctx.fillStyle = "black";
      ctx.font = `16px "${this.fontName}"`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(char, 0, C / 2);

      const imgData = ctx.getImageData(0, 0, C, C);
      let inv = canvasGrayToInv(imgData);              // inv: ink=255
      inv = shiftInvMinXToCenter(inv, C, half);        // ★基準統一（min_x -> 20）

      // entry/exit（上端/下端の重心X、キャレット中心(20)からの相対）
      let topMoment = 0, topMass = 0;
      let bottomMoment = 0, bottomMass = 0;
      const scanHeight = 10;

      for (let y = 0; y < C; y++) {
        for (let x = 0; x < C; x++) {
          const v = inv[y * C + x]!;
          if (y < scanHeight && v > 128) { topMoment += x * v; topMass += v; }
          if (y >= C - scanHeight && v > 128) { bottomMoment += x * v; bottomMass += v; }
        }
      }
      const entryX = topMass > 0 ? (topMoment / topMass) - half : null;
      const exitX  = bottomMass > 0 ? (bottomMoment / bottomMass) - half : null;

      const feats = FeatureExtractor.patchInv40To6ch(inv, this.coordMapB);

      rendered.push({
        char,
        width: this.charWidthCache.get(char) || this.spaceWidths.half,
        bitmapInv: inv,
        entryX,
        exitX,
        featsTensor: feats
      });
    }

    // 2) Batched encoder run
    const inputName = this.encoderSession.inputNames[0]!;
    const outputName = this.encoderSession.outputNames[0]!;
    const dim = 128;

    for (let i = 0; i < rendered.length; i += this.CODEB_BATCH_SIZE_DB) {
      const batch = rendered.slice(i, i + this.CODEB_BATCH_SIZE_DB);
      const N = batch.length;
      const batchInput = new Float32Array(N * C * C * 6);
      for (let b = 0; b < N; b++) batchInput.set(batch[b]!.featsTensor, b * C * C * 6);

      const tensor = new ort.Tensor('float32', batchInput, [N, C, C, 6]);
      const res = await this.encoderSession.run({ [inputName]: tensor });
      const out = res[outputName]!.data as Float32Array;

      for (let b = 0; b < N; b++) {
        const vec = out.slice(b * dim, (b + 1) * dim) as unknown as Float32Array;
        const v = this.normalizeVector(new Float32Array(vec));
        const entry = batch[b]!;
        this.vectorDb.push({
          char: entry.char,
          vector: v,
          width: entry.width,
          bitmap: entry.bitmapInv,   // ★ inv(40x40) caret-centered
          entryX: entry.entryX,
          exitX: entry.exitX
        });
      }
    }

    console.log(`DB Rebuilt: ${this.vectorDb.length} chars (caret=min_x@20)`);
  }

  private searchVectorDb(query: Float32Array, k: number) {
    if (this.vectorDb.length === 0) return [];
    const scores = this.vectorDb.map(entry => {
      let dot = 0;
      for (let i = 0; i < 128; i++) dot += query[i]! * entry.vector[i]!;
      return { entry, score: dot };
    });
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, k);
  }

  private findConnectionAnchor(ctx: CanvasRenderingContext2D, centerX: number, yOffset: number): number | null {
    const scanW = 12;
    const startX = Math.floor(centerX - scanW / 2);
    if (startX < 0) return null;
    try {
      const data = ctx.getImageData(startX, yOffset, scanW, 1).data;
      let mass = 0;
      let moment = 0;
      for (let x = 0; x < scanW; x++) {
        const val = 255 - data[x * 4]!;
        if (val > 128) { mass += val; moment += x * val; }
      }
      if (mass > 0) return startX + (moment / mass);
    } catch (e) { }
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
        if (gy >= 0 && gy < features.height) colSum += data[gy * w + x]!;
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
    basePenalty: number = 0, isCodeB: boolean = false,
    measureCtx: CanvasRenderingContext2D | null = null   // ★追加
  ) {
    let hatchingChar = "";
    if (bbsMode) useThinSpace = false; // ★BBS互換では薄スペは探索から除外


    if (paintMaskData) {
      const maskX = Math.floor(parent.x + 4);
      if (maskX >= 0 && maskX < width) {
        const idx = (16 * width + maskX) * 4;
        if (idx < paintMaskData.length) {
          const r = paintMaskData[idx]!;
          const b = paintMaskData[idx + 2]!;
          const a = paintMaskData[idx + 3]!;
          if (a > 0) {
            if (b > 100 && r < 150 && patternBlue) {
              hatchingChar = this.getNextPatternChar(patternBlue, parent.lastChar);
            }
            else if (r > 100 && b < 150 && patternRed) {
              hatchingChar = this.getNextPatternChar(patternRed, parent.lastChar);
            }
          }
        }
      }
    }

    if (hatchingChar) {
          if (hatchingChar) {
          // ★BBS互換: 行頭半角/連続半角を根本で排除
          let ch = hatchingChar;

          if (!useThinSpace && ch === '\u2009') return; // 使わないなら捨てる
          if (bbsMode) {
            if (ch === '\u2009') ch = '　'; // そもそも薄スペは禁止（上でuseThinSpace=falseだが保険）
            if (ch === ' ' && parent.text === "") ch = '　';
            if (ch === ' ' && parent.lastWasHalf) ch = '　';
          }

          // ★advanceはペア幅で厳密に
          let adv = this.charWidthCache.get(ch) || this.spaceWidths.half;
          if (measureCtx) adv = this.getAdvanceWidth(parent.lastChar, ch, measureCtx);

          const nextLastWasHalf = (ch === ' ' || ch === '\u2009');

          if (isCodeB) {
            candidates.push({
              type: 'char',
              parent,
              char: ch,
              width: adv,
              bitmap: new Uint8Array(1600),
              leftX: 0,
              score: parent.score + basePenalty + 5.0,
              stepScore: basePenalty + 5.0,
              nextLastWasHalf
            });
          } else {
            candidates.push({
              text: parent.text + ch,
              score: parent.score + basePenalty + 5.0,
              x: parent.x + adv,
              lastChar: ch,
              lastWasHalf: nextLastWasHalf,
              contextData: parent.contextData,
              residualMap: parent.residualMap
            });
          }
          return;
        }
    }

    const nextInkX = this.findNextInkX(baseFeatures, parent.x + 2, lineCenterY);
    const distToTarget = nextInkX !== null ? (nextInkX - parent.x) : null;

    const spaces: Array<{ char: string; width: number }> = [];
    // ★BBS互換: 行頭半角禁止 + 連続半角禁止（状態で判定）
    const canUseHalf = !bbsMode || (parent.text !== "" && !parent.lastWasHalf);
    if (canUseHalf) spaces.push({ char: ' ', width: this.spaceWidths.half });
    spaces.push({ char: '　', width: this.spaceWidths.full });
    if (useThinSpace) spaces.push({ char: '\u2009', width: this.spaceWidths.thin });

    let anySpaceAdded = false;

    for (const sp of spaces) {
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

      // ★advanceはペア幅で厳密に（半角=5px/全角=11pxの「非2倍」をここで正確に扱う）
      let adv = sp.width;
      if (measureCtx) adv = this.getAdvanceWidth(parent.lastChar, sp.char, measureCtx);

      const nextLastWasHalf = (sp.char === ' ' || sp.char === '\u2009');

      if (isCodeB) {
        candidates.push({
          type: 'space', parent, char: sp.char, width: adv,
          score: parent.score + basePenalty + alignmentBonus, stepScore: basePenalty + alignmentBonus,
          nextLastWasHalf
        });
      } else {
        candidates.push({
          text: parent.text + sp.char, score: parent.score + basePenalty + alignmentBonus,
          x: parent.x + adv, lastChar: sp.char,
          lastWasHalf: nextLastWasHalf,
          contextData: parent.contextData, residualMap: parent.residualMap
        });
      }
      anySpaceAdded = true;
    }

    if (!anySpaceAdded) {
      const sp = canUseHalf
        ? { char: ' ', width: this.spaceWidths.half }
        : { char: '　', width: this.spaceWidths.full };

      let adv = sp.width;
      if (measureCtx) adv = this.getAdvanceWidth(parent.lastChar, sp.char, measureCtx);

      const forcedScore = parent.score + basePenalty - 1.0;
      const nextLastWasHalf = (sp.char === ' ' || sp.char === '\u2009');

      if (isCodeB) {
        candidates.push({ type: 'space', parent, char: sp.char, width: adv, score: forcedScore, stepScore: -1.0, nextLastWasHalf });
      } else {
        candidates.push({
          text: parent.text + sp.char, score: forcedScore,
          x: parent.x + adv, lastChar: sp.char, lastWasHalf: nextLastWasHalf,
          contextData: parent.contextData, residualMap: parent.residualMap
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // solveLine (CodeB: キャレット中心でパッチ抽出 + center gate + left mask)
  // -------------------------------------------------------------------------
  async solveLine(
    baseFeatures: BaseFeatureMaps, width: number,
    targetCharBlue: string, targetCharRed: string, paintMaskData: Uint8ClampedArray | null,
    lineCenterY: number, generationMode: 'hybrid' | 'accurate',
    measureCtx: CanvasRenderingContext2D | null, prevBottomEdge: any,
    bbsMode: boolean, useThinSpace: boolean,
    debugCanvas: HTMLCanvasElement | null = null, accumulatedCanvas: HTMLCanvasElement | null = null
  ): Promise<{ text: string, bottomEdge: Float32Array | null }> {
    _unused(generationMode, debugCanvas, prevBottomEdge);

    if (this.mode === 'classifier' && !this.classifierSession) return { text: "", bottomEdge: null };
    if (this.mode === 'vector' && !this.encoderSession) return { text: "", bottomEdge: null };

    const PADDING_LEFT = 10;
    const BEAM_WIDTH = 5;

    const validateAndFixChar = (char: string, currentText: string, lastChar: string, lastWasHalf: boolean): string | null => {
      _unused(lastChar);
      if (!useThinSpace && char === "\u2009") return null;

      if (bbsMode) {
        if (char === "\u2009") return null;        // ★BBS互換は薄スペ禁止（根本）
        if (char === " " && currentText === "") return "　";      // 行頭半角禁止
        if (char === " " && lastWasHalf) return "　";             // 連続半角禁止
      }
      return char;
    };

    // --- Mode A: Classifier ---
    if (this.mode === 'classifier') {
      const text = await this.inferLineCodeA(
        baseFeatures,
        width,
        lineCenterY,
        paintMaskData,
        targetCharBlue,
        targetCharRed,
        bbsMode,
        useThinSpace,
        debugCanvas
      );
      return { text, bottomEdge: null };
    }

    //code B
    
    const C = FeatureExtractor.CROP_SIZE_B; // 40
    const startY = Math.floor(lineCenterY - C / 2);

    // --- residual band init: [C, width] ---
    const initialResidual = new Uint8Array(width * C);
    const srcData = baseFeatures.invData;
    const globalW = baseFeatures.width;

    for (let y = 0; y < C; y++) {
      const gy = startY + y;
      if (gy < 0 || gy >= baseFeatures.height) continue;
      const srcOff = gy * globalW;
      const dstOff = y * width;
      const copyW = Math.min(width, globalW);
      for (let x = 0; x < copyW; x++) initialResidual[dstOff + x] = srcData[srcOff + x] ?? 0;
    }

    // --- prev/next connection probes (kept) ---
    let prevRowData: Uint8ClampedArray | null = null;
    if (accumulatedCanvas) {
      const prevCtx = accumulatedCanvas.getContext("2d")!;
      const sampleY = Math.floor(lineCenterY - 10);
      if (sampleY >= 0) prevRowData = prevCtx.getImageData(0, sampleY, width, 1).data;
    }

    let nextRowData: Uint8ClampedArray | null = null;
    const nextLineY = lineCenterY + FeatureExtractor.LINE_HEIGHT;
    if (this.draftSession && nextLineY < baseFeatures.height) {
      const nextDraftCanvas = await this.runDraftInference(baseFeatures, width, nextLineY);
      const nextCtx = nextDraftCanvas.getContext("2d")!;
      nextRowData = nextCtx.getImageData(0, 8, width, 1).data;
    }

    // --- beam init ---
    let beams: BeamNode[] = [
      { text: "", score: 0.0, x: 0.0, lastChar: "", contextData: null, residualMap: initialResidual, lastWasHalf: false}
    ];

    let step = 0;
    const maxSteps = width * 2;

    // encoder I/O
    const encoderInputName = this.encoderSession!.inputNames[0]!;
    const encoderOutputName = this.encoderSession!.outputNames[0]!;
    const EMB = 128;

    // Reuse batch buffer to reduce GC
    const PATCH_SIZE = C * C * 6;
    const batchBuf = new Float32Array(this.CODEB_BATCH_SIZE_SOLVE * PATCH_SIZE);

    while (beams.some(b => b.x < width - PADDING_LEFT) && step < maxSteps) {
      step++;

      const finishedBeams: BeamNode[] = [];
      const activeBeams: BeamNode[] = [];

      for (const beam of beams) {
        if (beam.x >= width - PADDING_LEFT) finishedBeams.push(beam);
        else activeBeams.push(beam);
      }
      if (activeBeams.length === 0) break;

      const nextCandidates: any[] = [];

      // Process active beams in chunks (batched encoder)
      for (let bi = 0; bi < activeBeams.length; bi += this.CODEB_BATCH_SIZE_SOLVE) {
        const chunk = activeBeams.slice(bi, bi + this.CODEB_BATCH_SIZE_SOLVE);

        const nonEmpty: Array<{
          beam: BeamNode;
          centerX: number;
          leftX: number;
          hasPrevConnection: boolean;
          hasNextConnection: boolean;
          // input tensor is written into batchBuf; keep offset for this item
          bufOffset: number;
        }> = [];

        // 1) Pre-check empty/hatching + prepare encoder inputs (NO cv/canvas)
        for (const beam of chunk) {
          if (beam.x >= width - PADDING_LEFT) continue;

          const centerX = Math.floor(beam.x + PADDING_LEFT);
          const leftX = Math.floor(centerX - C / 2);

          let hasPrevConnection = false;
          if (prevRowData && accumulatedCanvas) {
            const anchor = this.findConnectionAnchor(
              accumulatedCanvas.getContext("2d")!,
              centerX,
              lineCenterY - 10
            );
            if (anchor !== null && Math.abs(anchor - centerX) < 6) hasPrevConnection = true;
          }

          let hasNextConnection = false;
          if (nextRowData && nextRowData.length > 0) {
            let scanMass = 0;
            for (let k = -4; k <= 4; k++) {
              const px = centerX + k;
              if (px >= 0 && px < width) {
                const idx = px * 4;
                if (idx < nextRowData.length) {
                  const val = 255 - (nextRowData[idx] ?? 255);
                  if (val > 128) scanMass++;
                }
              }
            }
            if (scanMass > 0) hasNextConnection = true;
          }

          // --- cheap inkSum: center 8x8 only ---
          let inkSum = 0;
          for (let y = 16; y < 24; y++) {
            const resOff = y * width;
            for (let x = 16; x < 24; x++) {
              const gx = leftX + x;
              if (gx < 0 || gx >= width) continue;
              let v = beam.residualMap![resOff + gx] ?? 0;
              v = v * (this.focusMask[y * C + x] ?? 1.0);
              inkSum += v;
            }
          }

          if (inkSum < 100) {
            this.addSpaceCandidatesCommon(
              nextCandidates,
              beam,
              baseFeatures,
              lineCenterY,
              width,
              bbsMode,
              useThinSpace,
              paintMaskData,
              targetCharBlue,
              targetCharRed,
              0,
              true,
              measureCtx          // ★追加
            );
            continue;
          }

          // --- build encoder input directly (NO cv/canvas) ---
          const patch6 = FeatureExtractor.extractPatch40_6ch_fromResidualAndBase(
            baseFeatures,
            beam.residualMap!,
            width,
            centerX,
            lineCenterY,
            this.coordMapB,
            this.focusMask
          );

          const idxInBatch = nonEmpty.length;
          const bufOffset = idxInBatch * PATCH_SIZE;
          batchBuf.set(patch6, bufOffset);

          nonEmpty.push({ beam, centerX, leftX, hasPrevConnection, hasNextConnection, bufOffset });
        }

        // 2) Run encoder batched for non-empty
        if (nonEmpty.length > 0) {
          const N = nonEmpty.length;
          const tensor = new ort.Tensor(
            "float32",
            batchBuf.subarray(0, N * PATCH_SIZE),
            [N, C, C, 6]
          );
          const res = await this.encoderSession!.run({ [encoderInputName]: tensor });
          const out = res[encoderOutputName]!.data as Float32Array;

          for (let i = 0; i < N; i++) {
            const item = nonEmpty[i]!;
            const beam = item.beam;

            // normalize embedding
            const vec = out.slice(i * EMB, (i + 1) * EMB) as unknown as Float32Array;
            const vector = this.normalizeVector(new Float32Array(vec));

            const dbCands = this.searchVectorDb(vector, this.CODEB_TOPK);

            let validCandFound = false;
            for (const cand of dbCands) {
              const entry = cand.entry;
              const vecScore = cand.score;

              if (vecScore < 0.2) continue;
              if (entry.char === " " || entry.char === "　") continue;

              const charToUse = validateAndFixChar(entry.char, beam.text, beam.lastChar, entry.char == " ");
              if (!charToUse) continue;

              let advance = entry.width;
              if (measureCtx) advance = this.getAdvanceWidth(beam.lastChar, charToUse, measureCtx);

              // --- overlap scoring (kept) ---
              let charInkSum = 0,
                targetInkSum = 0;
              let inkConsumed = 0,
                inkWasted = 0;

              const leftX = item.leftX;

              for (let p = 0; p < C * C; p++) {
                const charVal = entry.bitmap[p] ?? 0;
                charInkSum += charVal;

                const py = (p / C) | 0;
                const px = p - py * C;
                const gx = leftX + px;

                let targetVal = 0;
                if (gx >= 0 && gx < width) targetVal = beam.residualMap![py * width + gx] ?? 0;

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
              if (item.hasPrevConnection && entry.entryX !== null) connBonus += 0.5;
              if (item.hasNextConnection && entry.exitX !== null) connBonus += 0.5;

              const stepScore = vecScore + coverage * 0.8 - excessRatio * 0.5 + connBonus;

              nextCandidates.push({
                type: "char",
                parent: beam,
                char: charToUse,
                width: advance,
                bitmap: entry.bitmap,
                leftX: leftX,
                score: beam.score + stepScore,
                stepScore: stepScore
              });
              validCandFound = true;
            }

            if (!validCandFound) {
              this.addSpaceCandidatesCommon(
                nextCandidates,
                beam,
                baseFeatures,
                lineCenterY,
                width,
                bbsMode,
                useThinSpace,
                paintMaskData,
                targetCharBlue,
                targetCharRed,
                -0.1,
                true
              );
            }
          }
        }
      }

      // ---------- Beam update (unchanged) ----------
      nextCandidates.sort((a, b) => b.score - a.score);
      const survivors = nextCandidates.slice(0, BEAM_WIDTH);

      beams = [];
      for (const item of survivors) {
        const newResidual = new Uint8Array(item.parent.residualMap);
        if (item.type === "char") {
          const leftX = item.leftX;
          const bitmap = item.bitmap;
          for (let i = 0; i < C * C; i++) {
            if ((bitmap[i] ?? 0) > 20) {
              const py = (i / C) | 0;
              const px = i - py * C;
              const gx = leftX + px;
              if (gx >= 0 && gx < width) newResidual[py * width + gx] = 0;
            }
          }
        }
        beams.push({
          text: item.parent.text + item.char,
          score: item.score,
          x: item.parent.x + item.width,
          lastChar: item.char,
          lastWasHalf: (item.nextLastWasHalf ?? (item.char === ' ' || item.char === '\u2009')), // ★追加
          contextData: null,
          residualMap: newResidual
        });
      }

      finishedBeams.forEach(b => beams.push(b));
      if (beams.length > 0 && beams.every(b => b.x >= width - PADDING_LEFT)) break;
    }

    beams.sort((a, b) => b.score - a.score);
    return { text: beams[0] ? beams[0].text : "", bottomEdge: null };
  }

  // -------------------------------------------------------------------------
  // Draft inference (Code A) そのまま（あなたの貼り付けを維持）
  // -------------------------------------------------------------------------
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
    const PADDING_LEFT = 0;
    let currentX = 0;

    while (currentX < width - PADDING_LEFT) {
      const centerX = currentX + PADDING_LEFT;
      const patch6ch = FeatureExtractor.extractPatchDraft(baseFeatures, centerX, lineCenterY, this.coordMapA);

      let centerDensity = 0;
      for (let dy = 16; dy < 32; dy++) for (let dx = 20; dx < 28; dx++) centerDensity += patch6ch[(dy * 48 + dx) * 6 + 1]!;
      if (centerDensity < 800.0) { currentX += this.spaceWidths.half; continue; }

      const floatInput = new Float32Array(patch6ch.length);
      for (let i = 0; i < patch6ch.length; i++) floatInput[i] = patch6ch[i]! / 255.0;
      const tensor = new ort.Tensor('float32', floatInput, [1, 48, 48, 6]);
      const results = await this.draftSession.run({ [this.draftSession.inputNames[0]!]: tensor });
      const logits = results[this.draftSession.outputNames[0]!]!.data as Float32Array;
      const best = this.getTopK(this.softmax(logits), 1)[0];

      let char = best!.char;
      if (best!.score! < this.DRAFT_THRESHOLD) char = ' ';

      if (char !== ' ' && char !== '　') {
        ctx.fillText(char, centerX, 24);
        const w = this.charWidthCache.get(char) || this.spaceWidths.half;
        currentX += Math.max(w, 2.0);
      } else {
        currentX += this.spaceWidths.half;
      }
    }
    return draftCanvas;
  }

  private softmax(logits: Float32Array): Float32Array {
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]!);
    const exps = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) { const v = Math.exp(logits[i]! - max); exps[i] = v; sum += v; }
    for (let i = 0; i < exps.length; i++) exps[i] = exps[i]! / (sum + 1e-12);
    return exps;
  }

  private getTopK(probs: Float32Array, k: number) {
    const candidates: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < probs.length; i++) candidates.push({ idx: i, score: probs[i]! });
    candidates.sort((a, b) => b.score! - a.score!);
    return candidates.slice(0, k).map(c => ({ char: this.fullClassList[c.idx] || ' ', score: c.score }));
  }

  private getNextPatternChar(pattern: string, lastChar: string): string {
    if (!pattern) return "";
    const idx = pattern.indexOf(lastChar);
    if (idx === -1) return pattern[0]!;
    return pattern[(idx + 1) % pattern.length]!;
  }

  // -------------------------------------------------------------------------
  // suggestText / getCandidatesAt：CodeB 側は extractPatch40_6ch を新シグネチャで呼ぶ
  // -------------------------------------------------------------------------
  async suggestText(
    baseFeatures: BaseFeatureMaps,
    localCenterX: number,
    localCenterY: number,
    patternBlue: string = "",
    patternRed: string = "",
    beamWidth: number = 1,
    paintMaskData: Uint8ClampedArray | null = null,
    roiGlobalX: number = 0,
    maskStride: number = 0,
    prevChar: string = ""
  ): Promise<string> {
    _unused(beamWidth, roiGlobalX);

    const checkHatching = (): string | null => {
      if (!paintMaskData || maskStride <= 0) return null;
      const mx = Math.floor(localCenterX);
      const my = Math.floor(localCenterY);
      if (mx < 0 || mx >= maskStride) return null;
      const idx = (my * maskStride + mx) * 4;
      if (idx < paintMaskData.length) {
        const r = paintMaskData[idx]!;
        const b = paintMaskData[idx + 2]!;
        const a = paintMaskData[idx + 3]!;
        if (a > 0) {
          if (b > 100 && r < 150 && patternBlue) return this.getNextPatternChar(patternBlue, prevChar);
          if (r > 100 && b < 150 && patternRed) return this.getNextPatternChar(patternRed, prevChar);
        }
      }
      return null;
    };

    if (this.mode === 'classifier') {
      if (!this.classifierSession) return "";

      // hatching first
      const hatch = checkHatching();
      if (hatch) return hatch;

      // FCN cache: run once per line, then lookup by x
      await this.ensureCodeASuggestCache(baseFeatures, baseFeatures.width, localCenterY);
      const cache = this._codeA_suggestCache;
      if (!cache.topIdx || !cache.topProb) return "";

      const W = cache.width;
      const paddingLeft = 0; // inferLineCodeA / decodeLineBeamCodeA と合わせる
      const tx = Math.round(localCenterX - paddingLeft);
      const t = Math.max(0, Math.min(W - 1, tx));

      const K = cache.topK;
      for (let k = 0; k < K; k++) {
        const idx = cache.topIdx[t * K + k]!;
        const prob = cache.topProb[t * K + k]!;
        if (idx < 0) continue;

        const raw = this.fullClassList[idx] || "";
        if (!raw || raw === "<UNK>" || raw === "<BOS>") continue;
        if (raw.length > 1) continue;

        if (prob < 0.3) return "";
        return raw;
      }
      return "";
    } else {
      if (!this.encoderSession) return "";
      const C = FeatureExtractor.CROP_SIZE_B;

      const inputTensor = FeatureExtractor.extractPatch40_6ch(
        baseFeatures, localCenterX, localCenterY, this.coordMapB
      );

      let inkSum = 0;
      for (let y = 16; y < 24; y++) for (let x = 16; x < 24; x++) inkSum += inputTensor[(y * C + x) * 6 + 0]! * 255.0;
      if (inkSum < 30.0) {
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

  async getCandidatesAt(
    baseFeatures: BaseFeatureMaps,
    localCenterX: number,
    localCenterY: number
  ): Promise<{ char: string, score: number }[]> {
    if (this.mode === 'classifier') {
      if (!this.classifierSession) return [];

      await this.ensureCodeASuggestCache(baseFeatures, baseFeatures.width, localCenterY);
      const cache = this._codeA_suggestCache;
      if (!cache.topIdx || !cache.topProb) return [];

      const W = cache.width;
      const paddingLeft = 0; // inferLineCodeA / decodeLineBeamCodeA と合わせる
      const tx = Math.round(localCenterX - paddingLeft);
      const t = Math.max(0, Math.min(W - 1, tx));

      const out: { char: string; score: number }[] = [];
      const K = cache.topK;

      for (let k = 0; k < K; k++) {
        const idx = cache.topIdx[t * K + k]!;
        const prob = cache.topProb[t * K + k]!;
        if (idx < 0) continue;

        const raw = this.fullClassList[idx] || "";
        if (!raw || raw === "<UNK>" || raw === "<BOS>") continue;
        if (raw.length > 1) continue;

        out.push({ char: raw, score: prob });
      }
      return out;
    } else {
      if (!this.encoderSession) return [];
      const C = FeatureExtractor.CROP_SIZE_B;
      const inputTensor = FeatureExtractor.extractPatch40_6ch(
        baseFeatures, localCenterX, localCenterY, this.coordMapB
      );
      const tensor = new ort.Tensor('float32', inputTensor, [1, C, C, 6]);
      const res = await this.encoderSession.run({ [this.encoderSession.inputNames[0]!]: tensor });
      let vector = res[this.encoderSession.outputNames[0]!]!.data as Float32Array;
      vector = this.normalizeVector(vector);

      const rawCands = this.searchVectorDb(vector, 20);
      return rawCands.map(c => ({ char: c.entry.char, score: Math.max(0, c.score) }));
    }
  }

  // -------------------------------------------------------------------------
  // CodeA(FCN) はあなたの貼り付け版をそのまま移植想定
  // ここから下は「既存の inferLineCodeA / drawDebugBand / decodeLineBeamCodeA」を
  // そのまま残してください（あなたの貼り付けの続きと同一）。
  // -------------------------------------------------------------------------
  private async inferLineCodeA(
    base: BaseFeatureMaps,
    width: number,
    lineCenterY: number,
    paintMaskData: Uint8ClampedArray | null,
    targetCharBlue: string,
    targetCharRed: string,
    bbsMode: boolean,
    useThinSpace: boolean,
    debugCanvas: HTMLCanvasElement | null = null
  ): Promise<string> {
    if (!this.classifierSession) return "";

    const BAND_H = 24;
    const STRIDE = 1;
    const PADDING_LEFT = 10;

    const band = FeatureExtractor.extractBand24_5ch(base, width, lineCenterY, BAND_H);
    if (debugCanvas) this.drawDebugBand24_5ch(debugCanvas, band, width, BAND_H);

    const inp = new ort.Tensor("float32", band, [1, BAND_H, width, 5]);
    const results = await this.classifierSession.run({ [this.classifierSession.inputNames[0]!]: inp });

    const outName = this.classifierSession.outputNames[0]!;
    const logits = results[outName]!.data as Float32Array;

    const T = width;
    const V = this.fullClassList.length;

    return this.decodeLineBeamCodeA({
      logits, T, V, width, lineCenterY,
      stride: STRIDE,
      paddingLeft: PADDING_LEFT,
      paintMaskData,
      targetCharBlue,
      targetCharRed,
      bbsMode,
      useThinSpace,
      base
    });
  }

  private drawDebugBand24_5ch(canvas: HTMLCanvasElement, band: Float32Array, W: number, H: number) {
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;

    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const img = ctx.createImageData(W, H);

    const CH_DENSITY = 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v01 = band[(y * W + x) * 5 + CH_DENSITY] ?? 0;
        const v = Math.max(0, Math.min(255, Math.floor(v01 * 255)));
        const i = (y * W + x) * 4;
        img.data[i + 0] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.moveTo(0, Math.floor(H / 2) + 0.5);
    ctx.lineTo(W, Math.floor(H / 2) + 0.5);
    ctx.stroke();
  }
    private decodeLineBeamCodeA(args: {
    logits: Float32Array;
    T: number;
    V: number;
    width: number;
    lineCenterY: number;
    stride: number;
    paddingLeft: number;
    paintMaskData: Uint8ClampedArray | null;
    targetCharBlue: string;
    targetCharRed: string;
    bbsMode: boolean;
    useThinSpace: boolean;
    base: BaseFeatureMaps;
  }): string {
    const {
      logits, T, V, width, lineCenterY,
      stride, paddingLeft,
      paintMaskData, targetCharBlue, targetCharRed,
      bbsMode, useThinSpace,
      base
    } = args;
    _unused(paddingLeft);
    const BEAM = 10;
    const TOPK = 18;
    const CONF_TH = 0.3;
    const DENSITY_SKIP = 250.0;
    const MAX_STEPS = 500;
    const STRIPE_W = 8;
    const PROB_MIN = 0.002;

    const LINE_H = FeatureExtractor.LINE_HEIGHT;
    const W = width;
    const STR = stride;

    const wOf = (ch: string) => (this.charWidthCache.get(ch) || this.spaceWidths.half);

    const validateAndFixChar = (char: string, currentText: string, lastChar: string, lastWasHalf: boolean): string | null => {
      _unused(lastChar);
      if (!useThinSpace && char === "\u2009") return null;

      if (bbsMode) {
        if (char === "\u2009") return null;        // ★BBS互換は薄スペ禁止（根本）
        if (char === " " && currentText === "") return "　";      // 行頭半角禁止
        if (char === " " && lastWasHalf) return "　";             // 連続半角禁止
      }
      return char;
    };

    const buildRowU8 = (): Uint8Array => {
      const row = new Uint8Array(LINE_H * W);
      row.fill(255);

      const gw = base.width;
      const gh = base.height;

      const y0 = Math.floor(lineCenterY - LINE_H / 2);
      for (let dy = 0; dy < LINE_H; dy++) {
        const gy = y0 + dy;
        if (gy < 0 || gy >= gh) continue;
        const srcOff = gy * gw;
        const dstOff = dy * W;
        const copyW = Math.min(W, gw);
        for (let x = 0; x < copyW; x++) {
          row[dstOff + x] = base.grayData[srcOff + x] ?? 255;
        }
      }
      return row;
    };

    const rowU8 = buildRowU8();

    const getInkSum = (cx: number): number => {
      const x0 = Math.max(0, Math.min(W - 1, cx));
      const x1 = Math.max(0, Math.min(W, x0 + STRIPE_W));

      let s = 0.0;
      for (let y = 0; y < LINE_H; y++) {
        const off = y * W;
        for (let x = x0; x < x1; x++) {
          const v = rowU8[off + x] ?? 255;
          s += (255.0 - v);
        }
      }
      return s;
    };

    const pickHatchChar = (srcX: number, prevChar: string): string | null => {
      if (!paintMaskData) return null;

      const mx = Math.floor(srcX);
      const my = 16;
      if (mx < 0 || mx >= W) return null;

      const idx = (my * W + mx) * 4;
      if (idx < 0 || idx + 3 >= paintMaskData.length) return null;

      const r = paintMaskData[idx]!;
      const b = paintMaskData[idx + 2]!;
      const a = paintMaskData[idx + 3]!;
      if (a <= 0) return null;

      if (b > 100 && r < 150 && targetCharBlue) return this.getNextPatternChar(targetCharBlue, prevChar);
      if (r > 100 && b < 150 && targetCharRed) return this.getNextPatternChar(targetCharRed, prevChar);
      return null;
    };

    const charCanvas = document.createElement("canvas");
    const charCtx = charCanvas.getContext("2d", { willReadFrequently: true })!;
    const charImgCache = new Map<string, { w: number; data: Uint8Array }>();

    const renderCharImage = (ch: string): { w: number; data: Uint8Array } | null => {
      const cached = charImgCache.get(ch);
      if (cached) return cached;

      const cw = wOf(ch);
      const wInt = Math.max(0, Math.ceil(cw));
      if (wInt <= 0) return null;

      charCanvas.width = wInt;
      charCanvas.height = LINE_H;

      charCtx.fillStyle = "white";
      charCtx.fillRect(0, 0, wInt, LINE_H);
      charCtx.fillStyle = "black";
      charCtx.font = `16px "${this.fontName}"`;
      charCtx.textBaseline = "top";
      charCtx.fillText(ch, 0, 0);

      const img = charCtx.getImageData(0, 0, wInt, LINE_H).data;
      const out = new Uint8Array(wInt * LINE_H);
      for (let i = 0; i < wInt * LINE_H; i++) out[i] = img[i * 4] ?? 255;

      const ret = { w: wInt, data: out };
      charImgCache.set(ch, ret);
      return ret;
    };

    const calculatePixelMatch = (
      charGray: Uint8Array,
      charW: number,
      srcCrop: Uint8Array,
      srcW: number,
      thr = 200,
      beta = 0.5,
      rightFrac = 0.35,
      rightFpWeight = 2.5
    ): number => {
      const w = Math.min(charW, srcW);
      if (w <= 0) return 0.0;

      let tp = 0.0, fp = 0.0, fn = 0.0;
      for (let y = 0; y < LINE_H; y++) {
        const co = y * charW;
        const so = y * srcW;
        for (let x = 0; x < w; x++) {
          const cInk = (charGray[co + x]! < thr) ? 1.0 : 0.0;
          const sInk = (srcCrop[so + x]! < thr) ? 1.0 : 0.0;
          tp += cInk * sInk;
          fp += cInk * (1.0 - sInk);
          fn += (1.0 - cInk) * sInk;
        }
      }

      if (tp < 1e-3 && fp < 1e-3 && fn < 1e-3) return 1.0;
      if ((tp + fp) < 1e-3 || (tp + fn) < 1e-3) return 0.0;

      const precision = tp / (tp + fp + 1e-6);
      const recall = tp / (tp + fn + 1e-6);
      const b2 = beta * beta;
      let fbeta = (1 + b2) * (precision * recall) / (b2 * precision + recall + 1e-6);

      const x0 = Math.floor(w * (1.0 - rightFrac));
      if (x0 < w) {
        let rightFp = 0.0;
        for (let y = 0; y < LINE_H; y++) {
          const co = y * charW;
          const so = y * srcW;
          for (let x = x0; x < w; x++) {
            const cInk = (charGray[co + x]! < thr) ? 1.0 : 0.0;
            const sInk = (srcCrop[so + x]! < thr) ? 1.0 : 0.0;
            rightFp += cInk * (1.0 - sInk);
          }
        }
        const rightFpRate = rightFp / (tp + fp + 1e-6);
        fbeta = fbeta - rightFpWeight * rightFpRate;
      }

      if (fbeta < 0) fbeta = 0;
      if (fbeta > 1) fbeta = 1;
      return fbeta;
    };

    const buildSrcCrop = (cx: number, cropW: number): Uint8Array => {
      const w2 = Math.max(0, cropW);
      const out = new Uint8Array(LINE_H * w2);
      out.fill(255);
      const x0 = Math.max(0, Math.min(W, cx));
      const x1 = Math.max(0, Math.min(W, cx + w2));
      const copyW = Math.max(0, x1 - x0);

      for (let y = 0; y < LINE_H; y++) {
        const srcOff = y * W + x0;
        const dstOff = y * w2;
        for (let x = 0; x < copyW; x++) out[dstOff + x] = rowU8[srcOff + x] ?? 255;
      }
      return out;
    };

    const computeInkNorm = (srcCrop: Uint8Array): number => {
      let ink = 0.0;
      for (let i = 0; i < srcCrop.length; i++) ink += (255.0 - srcCrop[i]!);
      return ink / (srcCrop.length * 255.0 + 1e-6);
    };

    type Top = { idx: number; prob: number };
    const topCache = new Map<number, Top[]>();
    const top1Cache = new Map<number, number>();

    const getTopKFromLogits = (t: number): Top[] => {
      const cached = topCache.get(t);
      if (cached) return cached;

      const off = t * V;
      if (off < 0 || off + V > logits.length) return [];

      let mx = -1e30;
      for (let i = 0; i < V; i++) {
        const v = logits[off + i]!;
        if (Number.isNaN(v)) continue;
        if (v > mx) mx = v;
      }

      const bestIdx = new Int32Array(TOPK);
      const bestVal = new Float32Array(TOPK);
      bestVal.fill(-1e30);
      bestIdx.fill(-1);

      let sumExp = 0.0;
      for (let i = 0; i < V; i++) {
        const v0 = logits[off + i]!;
        const v = Number.isFinite(v0) ? v0 : -1e30;

        const e = Math.exp(v - mx);
        sumExp += e;

        if (v <= bestVal[TOPK - 1]!) continue;

        let j = TOPK - 1;
        while (j > 0 && v > bestVal[j - 1]!) {
          bestVal[j] = bestVal[j - 1]!;
          bestIdx[j] = bestIdx[j - 1]!;
          j--;
        }
        bestVal[j] = v;
        bestIdx[j] = i;
      }

      const ret: Top[] = [];
      for (let k = 0; k < TOPK; k++) {
        const id = bestIdx[k]!;
        if (id < 0) continue;
        const p = Math.exp(bestVal[k]! - mx) / (sumExp + 1e-12);
        ret.push({ idx: id, prob: p });
      }
      ret.sort((a, b) => b.prob - a.prob);

      topCache.set(t, ret);
      top1Cache.set(t, ret.length ? ret[0]!.prob : 0.0);
      return ret;
    };

    type State = { x: number; t: number; score: number; text: string; last: string; lastWasHalf: boolean };
    let beams: State[] = [{ x: 0.0, t: 0, score: 0.0, text: "", last: "", lastWasHalf: false }];

    for (let step = 0; step < MAX_STEPS; step++) {
      const nextBeams: State[] = [];
      const active = beams.filter(b => b.x < W - 2);
      if (active.length === 0) break;

      for (const b of active) {
        const t = b.t;
        if (t < 0 || t >= T) continue;

        const cx = Math.round(b.x);

        const ink = getInkSum(cx);
        const isEmpty = ink < DENSITY_SKIP;

        if (isEmpty) {
          const hatch = pickHatchChar(cx, b.last);
          if (hatch) {
            const ch0 = validateAndFixChar(hatch, b.text, b.last, b.lastWasHalf);
            if (ch0) {
              const nx = b.x + wOf(ch0);
              const nt = Math.round(nx / STR);
              nextBeams.push({ x: nx, t: nt, score: b.score + 0.2, text: b.text + ch0, last: ch0 ,lastWasHalf: (ch0 === " ")});
            }
          }

          {
            let ch = validateAndFixChar(" ", b.text, b.last, b.lastWasHalf);
            if (ch) {
              const nx = b.x + wOf(ch);
              const nt = Math.round(nx / STR);
              nextBeams.push({
                x: nx, t: nt,
                score: b.score - 0.8,
                text: b.text + ch,
                last: ch,
                lastWasHalf: (ch === " ")
              });
            }
          }
          {
            const ch = "　";
            const nx = b.x + wOf(ch);
            const nt = Math.round(nx / STR);
            nextBeams.push({
              x: nx, t: nt,
              score: b.score - 0.9,
              text: b.text + ch,
              last: ch,
              lastWasHalf: false
            });
          }
          continue;
        }

        const cands = getTopKFromLogits(t);
        const top1 = top1Cache.get(t) ?? (cands.length ? cands[0]!.prob : 0.0);
        const lowConf = top1 < CONF_TH;

        for (const c of cands) {
          const prob = c.prob;
          if (!(prob >= PROB_MIN)) continue;

          const raw = this.fullClassList[c.idx] || "";
          if (!raw || raw === "<UNK>" || raw === "<BOS>") continue;

          if (lowConf && this.CODEA_TRASH_CHARS.has(raw)) continue;

          const ch = validateAndFixChar(raw, b.text, b.last, b.lastWasHalf);
          if (!ch) continue;

          const cw = wOf(ch);
          if (cw <= 0) continue;

          let s = Math.log(prob + 1e-12);

          if (lowConf) {
            if (ch === " ") s += 0.2;
            else s -= 0.2;
          }

          if (ch === b.last && ch !== " " && ch !== "　") s -= 0.4;

          const charImg = renderCharImage(ch);
          if (charImg) {
            const cropW = charImg.w;
            const srcCrop = buildSrcCrop(cx, cropW);
            const match = calculatePixelMatch(charImg.data, charImg.w, srcCrop, cropW);

            const inkNorm = computeInkNorm(srcCrop);
            let thrBad: number, penBad: number, bonusK: number;
            if (inkNorm > 0.08) {
              thrBad = 0.18; penBad = 0.6; bonusK = 5.0;  //0.6, 5.0
            } else {
              thrBad = 0.30; penBad = 1.0; bonusK = 10.0; //1.5, 10.0
            }

            if (match < thrBad) s -= penBad;
            else s += match * bonusK;
          }

          const nx = b.x + cw;
          if (nx > W + 5) continue;

          const nt = Math.round(nx / STR);
          nextBeams.push({ x: nx, t: nt, score: b.score + s, text: b.text + ch, last: ch , lastWasHalf: (ch === " ") });
        }
      }

      if (nextBeams.length === 0) break;

      nextBeams.sort((a, b) => b.score - a.score);

      const selected: State[] = [];
      const seen = new Set<number>();
      for (const nb of nextBeams) {
        const bucket = Math.floor(nb.t / 2);
        if (!seen.has(bucket)) {
          selected.push(nb);
          seen.add(bucket);
        } else if (selected.length < BEAM) {
          selected.push(nb);
        }
        if (selected.length >= BEAM) break;
      }
      beams = selected;
    }

    beams.sort((a, b) => b.score - a.score);
    return beams.length ? beams[0]!.text : "";
  }

  // -----------------------------
  // CodeA suggest cache
  // -----------------------------
  private _codeA_suggestCache: {
    baseRef: BaseFeatureMaps | null;
    width: number;
    lineCenterY: number;
    logits: Float32Array | null;      // [T*V]
    topK: number;
    topIdx: Int32Array | null;        // [T*topK]
    topProb: Float32Array | null;     // [T*topK]  (softmax prob)
  } = {
    baseRef: null,
    width: -1,
    lineCenterY: -1,
    logits: null,
    topK: 10,
    topIdx: null,
    topProb: null,
  };

    private async ensureCodeASuggestCache(base: BaseFeatureMaps, width: number, lineCenterY: number) {
    if (!this.classifierSession) return;

    const cache = this._codeA_suggestCache;
    if (cache.baseRef === base && cache.width === width && cache.lineCenterY === lineCenterY && cache.logits) {
      return; // reuse
    }

    // 1) run FCN once for this line
    const BAND_H = 24;
    const band = FeatureExtractor.extractBand24_5ch(base, width, lineCenterY, BAND_H);
    const inp = new ort.Tensor("float32", band, [1, BAND_H, width, 5]);
    const results = await this.classifierSession.run({ [this.classifierSession.inputNames[0]!]: inp });

    const outName = this.classifierSession.outputNames[0]!;
    const logits = results[outName]!.data as Float32Array; // [T*V]
    const T = width;
    const V = this.fullClassList.length;

    // 2) precompute TopK + exact softmax prob (per t)
    const topK = cache.topK;
    const topIdx = new Int32Array(T * topK);
    const topProb = new Float32Array(T * topK);

    for (let t = 0; t < T; t++) {
      const off = t * V;

      // max for numerical stability
      let mx = -1e30;
      for (let i = 0; i < V; i++) {
        const v = logits[off + i]!;
        if (Number.isFinite(v) && v > mx) mx = v;
      }

      // find topK logits (insertion)
      const bestIdx = new Int32Array(topK);
      const bestVal = new Float32Array(topK);
      bestIdx.fill(-1);
      bestVal.fill(-1e30);

      let sumExp = 0.0;
      for (let i = 0; i < V; i++) {
        const v0 = logits[off + i]!;
        const v = Number.isFinite(v0) ? v0 : -1e30;

        const e = Math.exp(v - mx);
        sumExp += e;

        if (v <= bestVal[topK - 1]!) continue;

        let j = topK - 1;
        while (j > 0 && v > bestVal[j - 1]!) {
          bestVal[j] = bestVal[j - 1]!;
          bestIdx[j] = bestIdx[j - 1]!;
          j--;
        }
        bestVal[j] = v;
        bestIdx[j] = i;
      }

      // store softmax probs of the topK
      for (let k = 0; k < topK; k++) {
        const id = bestIdx[k]!;
        topIdx[t * topK + k] = id;
        if (id < 0) {
          topProb[t * topK + k] = 0;
        } else {
          topProb[t * topK + k] = Math.exp(bestVal[k]! - mx) / (sumExp + 1e-12);
        }
      }
    }

    cache.baseRef = base;
    cache.width = width;
    cache.lineCenterY = lineCenterY;
    cache.logits = logits;
    cache.topIdx = topIdx;
    cache.topProb = topProb;
  }


}
