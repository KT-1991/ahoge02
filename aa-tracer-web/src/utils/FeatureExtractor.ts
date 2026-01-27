// FeatureExtractor.ts (Python code_a faithful for FCN band features)
// Drop-in replacement: keeps existing exports/signatures; only adds helpers for CodeB DT + optional batching.
declare const cv: any;

export interface BaseFeatureMaps {
  width: number;
  height: number;
  grayData: Uint8Array;     // 0-255 grayscale, background=255 white, ink=0 black
  // 下面は互換のため残す（他コードが参照しても落ちないように）
  invData: Uint8Array;      // 0-255 inverted, background=0, ink=255
  distData: Float32Array;   // 0..1 (recommended), distance-to-ink map
  sinData: Uint8Array;      // 0..255
  cosData: Uint8Array;      // 0..255
  skeletonData: Uint8Array; // 0..255
  densityData: Uint8Array;  // 0..255
}

export class FeatureExtractor {
  static CROP_SIZE_A = 48;
  static CROP_SIZE_B = 40;
  static LINE_HEIGHT = 18;

  // Python cfg.BAND_H
  static BAND_H = 24;

  // -----------------------------
  // Coord maps
  // -----------------------------
  static createCoordMapA(): Float32Array {
    const C = this.CROP_SIZE_A;
    const map = new Float32Array(C * C * 2);
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const idx = (y * C + x) * 2;
        map[idx + 0] = x / (C - 1);
        map[idx + 1] = y / (C - 1);
      }
    }
    return map;
  }

  static createCoordMapB(): Float32Array {
    const C = this.CROP_SIZE_B;
    const map = new Float32Array(C * C * 2);
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const idx = (y * C + x) * 2;
        map[idx + 0] = (x / (C - 1)) * 2.0 - 1.0;
        map[idx + 1] = (y / (C - 1)) * 2.0 - 1.0;
      }
    }
    return map;
  }

  static createFocusMask(size: number): Float32Array {
    const mask = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2.0 - 1.0;
        const ny = (y / (size - 1)) * 2.0 - 1.0;
        const d2 = nx * nx + ny * ny;
        let val = Math.exp(-d2 / (2.0 * 0.6 * 0.6));
        val = val * 0.8 + 0.2;
        mask[y * size + x] = val;
      }
    }
    return mask;
  }

  // ============================================================
  // Python-like helpers (for band features)
  // ============================================================

  /** Python crop_band(gray, cy, band_h, fill=255) */
  private static cropBandFromGray(
    grayData: Uint8Array,
    W: number,
    H: number,
    cy: number,
    bandH: number,
    fill: number = 255
  ): Uint8Array {
    const half = Math.floor(bandH / 2);
    const startY = Math.floor(cy - half); // y1
    const band = new Uint8Array(bandH * W);
    band.fill(fill);

    for (let by = 0; by < bandH; by++) {
      const gy = startY + by;
      if (gy < 0 || gy >= H) continue;
      const srcOff = gy * W;
      const dstOff = by * W;
      band.set(grayData.subarray(srcOff, srcOff + W), dstOff);
    }
    return band;
  }

  /** Python compute_sobel_sin_cos(inv_u8): mag-threshold=20, sin/cos masked */
  private static computeSobelSinCosFromInv(
    invMatU8: any, // cv.Mat CV_8UC1
    W: number,
    H: number
  ): { sinU8: Uint8Array; cosU8: Uint8Array } {
    const blurred = new cv.Mat();
    cv.GaussianBlur(invMatU8, blurred, new cv.Size(3, 3), 0);

    const blurredF32 = new cv.Mat();
    blurred.convertTo(blurredF32, cv.CV_32F);

    const gx = new cv.Mat();
    const gy = new cv.Mat();
    cv.Sobel(blurredF32, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(blurredF32, gy, cv.CV_32F, 0, 1, 3);

    const mag = new cv.Mat();
    const angle = new cv.Mat();
    cv.cartToPolar(gx, gy, mag, angle, false);

    const maskF = new cv.Mat();
    cv.threshold(mag, maskF, 20, 255, cv.THRESH_BINARY);

    const mask = new cv.Mat();
    maskF.convertTo(mask, cv.CV_8U);

    const angleData = angle.data32F as Float32Array;
    const maskData = mask.data as Uint8Array;

    const n = W * H;
    const sinU8 = new Uint8Array(n);
    const cosU8 = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      if (maskData[i]! > 0) {
        const rad = angleData[i]!;
        sinU8[i] = Math.max(0, Math.min(255, Math.round(((Math.sin(rad) + 1.0) * 0.5) * 255.0)));
        cosU8[i] = Math.max(0, Math.min(255, Math.round(((Math.cos(rad) + 1.0) * 0.5) * 255.0)));
      } else {
        sinU8[i] = 0;
        cosU8[i] = 0;
      }
    }

    blurred.delete();
    blurredF32.delete();
    gx.delete();
    gy.delete();
    mag.delete();
    angle.delete();
    maskF.delete();
    mask.delete();

    return { sinU8, cosU8 };
  }

  /** Python dens = GaussianBlur(inv,(15,15)); dens=normalize(0..255) */
  private static computeDensityFromInv(invMatU8: any): Uint8Array {
    const dens = new cv.Mat();
    cv.GaussianBlur(invMatU8, dens, new cv.Size(15, 15), 0);
    cv.normalize(dens, dens, 0, 255, cv.NORM_MINMAX);
    const out = new Uint8Array(dens.data);
    dens.delete();
    return out;
  }

  //@ts-ignore
  private static adaptiveThresholdFromGrayU8(
    bandGrayU8: Uint8Array,
    bandH: number,
    W: number
  ): Uint8Array {
    const invMat = new cv.Mat(bandH, W, cv.CV_8UC1);
    invMat.data.set(bandGrayU8);
    cv.bitwise_not(invMat, invMat);

    const binary = new cv.Mat();
    cv.adaptiveThreshold(
      invMat,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      2
    );

    const bin = new Uint8Array(binary.data);

    invMat.delete();
    binary.delete();

    return bin;
  }

  /**
   * Python skeletonize_from_gray(gray_u8):
   * inv = bitwise_not(gray)
   * binary = adaptiveThreshold(inv,255, GAUSSIAN_C, THRESH_BINARY, 11, 2)
   * skel = skimage.skeletonize(binary>0) *255
   *
   * → Web版は Zhang-Suen thinning で近似（bandが小さいので実用的）
   */
  //@ts-ignore
  private static skeletonizeBandFromGrayU8(
    bandGrayU8: Uint8Array,
    bandH: number,
    W: number
  ): Uint8Array {
    const invMat = new cv.Mat(bandH, W, cv.CV_8UC1);
    invMat.data.set(bandGrayU8);
    cv.bitwise_not(invMat, invMat);

    const binary = new cv.Mat();
    cv.adaptiveThreshold(
      invMat,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      2
    );

    const bin = binary.data as Uint8Array;

    const n = bandH * W;
    const img01 = new Uint8Array(n);
    for (let i = 0; i < n; i++) img01[i] = bin[i]! > 0 ? 1 : 0;

    const thinned01 = this.zhangSuenThinning(img01, bandH, W);

    const skel = new Uint8Array(n);
    for (let i = 0; i < n; i++) skel[i] = thinned01[i] ? 255 : 0;

    invMat.delete();
    binary.delete();

    return skel;
  }

  /** Zhang-Suen thinning (0/1) */
  private static zhangSuenThinning(img01: Uint8Array, H: number, W: number): Uint8Array {
    const idx = (y: number, x: number) => y * W + x;

    const out = new Uint8Array(img01);
    let changed = true;

    const neighbors = (y: number, x: number) => {
      const p2 = out[idx(y - 1, x)];
      const p3 = out[idx(y - 1, x + 1)];
      const p4 = out[idx(y, x + 1)];
      const p5 = out[idx(y + 1, x + 1)];
      const p6 = out[idx(y + 1, x)];
      const p7 = out[idx(y + 1, x - 1)];
      const p8 = out[idx(y, x - 1)];
      const p9 = out[idx(y - 1, x - 1)];
      return [p2, p3, p4, p5, p6, p7, p8, p9] as const;
    };

    const transitions01 = (ns: readonly number[]) => {
      let A = 0;
      for (let i = 0; i < 8; i++) {
        const a = ns[i]!;
        const b = ns[(i + 1) % 8]!;
        if (a === 0 && b === 1) A++;
      }
      return A;
    };

    const sumN = (ns: readonly number[]) => {
      let s = 0;
      for (let i = 0; i < 8; i++) s += ns[i]!;
      return s;
    };

    while (changed) {
      changed = false;
      const toDel1: number[] = [];
      const toDel2: number[] = [];

      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const p1 = out[idx(y, x)];
          if (p1 !== 1) continue;

          const ns = neighbors(y, x) as any;
          const B = sumN(ns);
          if (B < 2 || B > 6) continue;

          const A = transitions01(ns);
          if (A !== 1) continue;

          const p2 = ns[0], p4 = ns[2], p6 = ns[4], p8 = ns[6];
          if (p2 * p4 * p6 !== 0) continue;
          if (p4 * p6 * p8 !== 0) continue;

          toDel1.push(idx(y, x));
        }
      }
      if (toDel1.length) {
        changed = true;
        for (const k of toDel1) out[k] = 0;
      }

      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const p1 = out[idx(y, x)];
          if (p1 !== 1) continue;

          const ns = neighbors(y, x) as any;
          const B = sumN(ns);
          if (B < 2 || B > 6) continue;

          const A = transitions01(ns);
          if (A !== 1) continue;

          const p2 = ns[0], p4 = ns[2], p6 = ns[4], p8 = ns[6];
          if (p2 * p4 * p8 !== 0) continue;
          if (p2 * p6 * p8 !== 0) continue;

          toDel2.push(idx(y, x));
        }
      }
      if (toDel2.length) {
        changed = true;
        for (const k of toDel2) out[k] = 0;
      }
    }

    return out;
  }

  // ============================================================
  // CodeB helper: Distance Transform (inv -> dist01)
  //  - background(=0) should have larger distance, ink(=255) should be 0.
  //  - returns 0..1 normalized by max distance in image (safe for encoder input)
  // ============================================================
  private static computeDist01FromInv(invMatU8: any): Float32Array {
    const w = invMatU8.cols;
    const h = invMatU8.rows;

    // Create binary "ink mask" where ink=1 (non-zero), bg=0
    const bin = new cv.Mat();
    cv.threshold(invMatU8, bin, 0, 255, cv.THRESH_BINARY);

    // distanceTransform computes distance to nearest zero pixel.
    // So we invert: make ink=0, bg=255, then DT gives distance-to-ink for bg pixels.
    const invBin = new cv.Mat();
    cv.bitwise_not(bin, invBin);

    const dist = new cv.Mat();
    cv.distanceTransform(invBin, dist, cv.DIST_L2, 3);

    // Normalize to 0..1
    const dist01 = new cv.Mat();
    cv.normalize(dist, dist01, 0.0, 1.0, cv.NORM_MINMAX);

    const out = new Float32Array(w * h);
    const d = dist01.data32F as Float32Array;
    out.set(d);

    bin.delete();
    invBin.delete();
    dist.delete();
    dist01.delete();

    return out;
  }

  // ============================================================
  // Base features (keep gray faithful; other fields kept for compatibility)
  // ============================================================
  static generateBaseFeatures(
    sourceCanvas: HTMLCanvasElement,
    paintBuffer: HTMLCanvasElement | null = null,
    imageTransform: any = null
  ): BaseFeatureMaps {
    const src = cv.imread(sourceCanvas);

    // paint overlay logic (kept)
    if (paintBuffer && imageTransform) {
      const tmp = document.createElement("canvas");
      tmp.width = sourceCanvas.width;
      tmp.height = sourceCanvas.height;
      const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, tmp.width, tmp.height);

      ctx.save();
      ctx.translate(imageTransform.x, imageTransform.y);
      ctx.rotate((imageTransform.rotation * Math.PI) / 180);
      ctx.scale(imageTransform.scale, imageTransform.scale);
      ctx.drawImage(paintBuffer, 0, 0);
      ctx.restore();

      const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        if (r > 250 && g > 250 && b > 250) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max - min;
        if (saturation > 20) {
          data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      const paintMat = cv.imread(tmp);
      cv.min(src, paintMat, src);
      paintMat.delete();
      tmp.width = 0;
    }

    const gray = new cv.Mat();
    if (src.channels() === 4) {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    } else if (src.channels() === 3) {
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
    } else {
      src.copyTo(gray);
    }

    const w = gray.cols;
    const h = gray.rows;
    const grayData = new Uint8Array(gray.data);

    const inv = new cv.Mat();
    cv.bitwise_not(gray, inv);

    // Density (same as your code)
    const densityMat = new cv.Mat();
    cv.GaussianBlur(inv, densityMat, new cv.Size(15, 15), 0);
    cv.normalize(densityMat, densityMat, 0, 255, cv.NORM_MINMAX);

    // Sobel sin/cos (same)
    const { sinU8, cosU8 } = this.computeSobelSinCosFromInv(inv, w, h);

    // Skeleton data: you were using adaptiveThreshold as placeholder. Keep that behavior for compatibility.
    const binary = new cv.Mat();
    cv.adaptiveThreshold(
      inv,
      binary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      2
    );
    const skeletonData = new Uint8Array(binary.data);

    // IMPORTANT: fill distData for CodeB encoder input
    const distData = this.computeDist01FromInv(inv);

    const result: BaseFeatureMaps = {
      width: w,
      height: h,
      grayData,
      invData: new Uint8Array(inv.data),
      distData,
      sinData: sinU8,
      cosData: cosU8,
      skeletonData,
      densityData: new Uint8Array(densityMat.data),
    };

    src.delete();
    gray.delete();
    inv.delete();
    densityMat.delete();
    binary.delete();

    return result;
  }

  // ============================================================
  // FCN input (NHWC): [1, bandH, width, 5]
  // Channels: skel, dens, sin, cos, yCoord(0..255)
  // Values: u8/255 (same as python)
  // ============================================================
  static extractBand24_5ch(
    base: BaseFeatureMaps,
    width: number,
    lineCenterY: number,
    bandH: number = 24
  ): Float32Array {
    const W = Math.min(width, base.width);
    const H = base.height;

    const bandGrayU8 = this.cropBandFromGray(base.grayData, base.width, H, lineCenterY, bandH, 255);

    const bandGrayMat = new cv.Mat(bandH, base.width, cv.CV_8UC1);
    bandGrayMat.data.set(bandGrayU8);

    const invMat = new cv.Mat();
    cv.bitwise_not(bandGrayMat, invMat);

    const densU8_fullW = this.computeDensityFromInv(invMat);
    const { sinU8: sinU8_fullW, cosU8: cosU8_fullW } = this.computeSobelSinCosFromInv(invMat, base.width, bandH);
    //const skelU8_fullW = this.skeletonizeBandFromGrayU8(bandGrayU8, bandH, base.width);
    //const skelU8_fullW = this.adaptiveThresholdFromGrayU8(bandGrayU8, bandH, base.width);
    const skelU8_fullW = new Uint8Array(invMat.data);

    const out = new Float32Array(bandH * W * 5);

    for (let by = 0; by < bandH; by++) {
      const yCoordU8 = (bandH <= 1) ? 0 : Math.round((by / (bandH - 1)) * 255);

      for (let x = 0; x < W; x++) {
        const dst = (by * W + x) * 5;
        const src = by * base.width + x;

        out[dst + 0] = (skelU8_fullW[src] ?? 0) / 255.0;
        out[dst + 1] = (densU8_fullW[src] ?? 0) / 255.0;
        out[dst + 2] = (sinU8_fullW[src] ?? 0) / 255.0;
        out[dst + 3] = (cosU8_fullW[src] ?? 0) / 255.0;
        out[dst + 4] = yCoordU8 / 255.0;
      }
    }

    bandGrayMat.delete();
    invMat.delete();

    return out;
  }

  // ============================================================
  // Patch extractors (kept for compatibility)
  // ============================================================
  static extractPatchDraft(base: BaseFeatureMaps, cx: number, cy: number, coordMap: Float32Array): Float32Array {
    const C = this.CROP_SIZE_A;
    const size = C * C;
    const input = new Float32Array(size * 6);
    const half = C / 2;
    const startX = Math.floor(cx - half);
    const startY = Math.floor(cy - half);
    const w = base.width;
    const h = base.height;

    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const gx = startX + x;
        const gy = startY + y;
        const dstIdx = (y * C + x) * 6;
        if (gx < 0 || gx >= w || gy < 0 || gy >= h) {
          input.fill(0, dstIdx, dstIdx + 6);
          continue;
        }
        const srcIdx = gy * w + gx;
        input[dstIdx + 0] = base.skeletonData[srcIdx] ?? 0;
        input[dstIdx + 1] = base.densityData[srcIdx] ?? 0;
        input[dstIdx + 2] = base.sinData[srcIdx] ?? 0;
        input[dstIdx + 3] = base.cosData[srcIdx] ?? 0;
        input[dstIdx + 4] = (coordMap[(y * C + x) * 2 + 0] ?? 0) * 255;
        input[dstIdx + 5] = (coordMap[(y * C + x) * 2 + 1] ?? 0) * 255;
      }
    }
    return input;
  }

  // NOTE: CodeB encoder input. Keep signature.
  // Channels: inv01, dist01, sin01, cos01, coordX(-1..1), coordY(-1..1)
  static extractPatch40_6ch(
    base: BaseFeatureMaps,
    cx: number, cy: number,
    coordMap: Float32Array
  ): Float32Array {
    const C = 40;
    const size = C * C;
    const input = new Float32Array(size * 6);
    const half = C / 2;

    const startX = Math.floor(cx - half);
    const startY = Math.floor(cy - half);
    const w = base.width;
    const h = base.height;

    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const gx = startX + x;
        const gy = startY + y;
        const dstIdx = (y * C + x) * 6;

        if (gx < 0 || gx >= w || gy < 0 || gy >= h) {
          // background fill: inv=0, dist=1 is often safer than all-zero,
          // but to keep compatibility, we leave zeros (same as your original).
          // If you want: input[dstIdx+1] = 1.0;
          continue;
        }

        const srcIdx = gy * w + gx;

        // inv01
        input[dstIdx + 0] = (base.invData[srcIdx] ?? 0) / 255.0;

        // dist01 (IMPORTANT: now filled in generateBaseFeatures)
        input[dstIdx + 1] = base.distData[srcIdx] ?? 0.0;

        // sin/cos 0..1
        input[dstIdx + 2] = (base.sinData[srcIdx] ?? 0) / 255.0;
        input[dstIdx + 3] = (base.cosData[srcIdx] ?? 0) / 255.0;

        // coord (-1..1)
        input[dstIdx + 4] = coordMap[(y * C + x) * 2 + 0] ?? 0.0;
        input[dstIdx + 5] = coordMap[(y * C + x) * 2 + 1] ?? 0.0;
      }
    }
    return input;
  }

  // -----------------------------
  // Optional helper (useful for CodeB residual patch -> 6ch without recomputing global features)
  // Not used unless you call it.
  // -----------------------------
  static patchInv40To6ch(
    invPatchU8: Uint8Array, // length 1600, 0..255
    coordMap: Float32Array
  ): Float32Array {
    const C = 40;
    if (invPatchU8.length !== C * C) {
      throw new Error(`invPatchU8 length must be ${C * C}, got ${invPatchU8.length}`);
    }

    const invMat = new cv.Mat(C, C, cv.CV_8UC1);
    invMat.data.set(invPatchU8);

    const dist01 = this.computeDist01FromInv(invMat);
    const { sinU8, cosU8 } = this.computeSobelSinCosFromInv(invMat, C, C);

    const out = new Float32Array(C * C * 6);
    for (let i = 0; i < C * C; i++) {
      const o = i * 6;
      out[o + 0] = (invPatchU8[i] ?? 0) / 255.0;
      out[o + 1] = dist01[i] ?? 0.0;
      out[o + 2] = (sinU8[i] ?? 0) / 255.0;
      out[o + 3] = (cosU8[i] ?? 0) / 255.0;
      out[o + 4] = coordMap[i * 2 + 0] ?? 0.0;
      out[o + 5] = coordMap[i * 2 + 1] ?? 0.0;
    }

    invMat.delete();
    return out;
  }

    // ============================================================
  // FAST CodeB patch builder (NO cv, NO canvas)
  // ch0(inv01): from residual map (per-beam), with optional focus mask
  // ch1(dist01), ch2(sin01), ch3(cos01): from baseFeatures (static)
  // ch4-5: coordMap (-1..1)
  //
  // residualMap is expected to be a band buffer of size (C * width),
  // where C=40 and y=0 corresponds to (lineCenterY - C/2).
  // ============================================================
  static extractPatch40_6ch_fromResidualAndBase(
    base: BaseFeatureMaps,
    residualMap: Uint8Array,      // length: C * width (C=40)
    width: number,                // line width for residualMap stride
    cx: number,                   // global centerX (same as before)
    lineCenterY: number,          // global centerY (same as before)
    coordMap: Float32Array,
    focusMask: Float32Array | null = null
  ): Float32Array {
    const C = this.CROP_SIZE_B; // 40
    const half = C / 2;

    // residual band is aligned to lineCenterY
    const startX = Math.floor(cx - half);
    const startY = Math.floor(lineCenterY - half);

    const out = new Float32Array(C * C * 6);

    const gw = base.width;
    const gh = base.height;

    for (let y = 0; y < C; y++) {
      const gy = startY + y;

      const resOff = y * width;
      const baseOff = gy * gw;

      for (let x = 0; x < C; x++) {
        const gx = startX + x;
        const o = (y * C + x) * 6;

        // ---- ch0: inv01 from residualMap (per-beam) ----
        let invU8 = 0;
        if (gx >= 0 && gx < width) {
          invU8 = residualMap[resOff + gx] ?? 0;
          if (focusMask) invU8 = invU8 * (focusMask[y * C + x] ?? 1.0);
        }
        out[o + 0] = invU8 / 255.0;

        // ---- ch1..3 from baseFeatures (static) ----
        if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
          const bi = baseOff + gx;

          out[o + 1] = base.distData[bi] ?? 0.0;
          out[o + 2] = (base.sinData[bi] ?? 0) / 255.0;
          out[o + 3] = (base.cosData[bi] ?? 0) / 255.0;
        } else {
          // keep 0s (compat with your current extractPatch40_6ch behavior)
          out[o + 1] = 0.0;
          out[o + 2] = 0.0;
          out[o + 3] = 0.0;
        }

        // ---- coord ----
        out[o + 4] = coordMap[(y * C + x) * 2 + 0] ?? 0.0;
        out[o + 5] = coordMap[(y * C + x) * 2 + 1] ?? 0.0;
      }
    }

    return out;
  }

}
