declare const cv: any;

export class FeatureExtractor {
  // コードAに合わせて48pxに変更
  static CROP_SIZE = 48;
  // 行間を18pxに変更
  static LINE_HEIGHT = 18; 

  /**
   * 画像全体から静的な特徴量（Skeleton, Density, Sin, Cos）を生成する
   * ContextとCoordは推論時に動的に結合する
   */
  static generateBaseFeatures(imgElement: HTMLImageElement | HTMLCanvasElement): any {
    const src = cv.imread(imgElement);
    const gray = new cv.Mat();
    
    // グレースケール変換 (RGBA -> GRAY)
    if (src.channels() === 4) {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    } else {
        src.copyTo(gray);
    }

    // 1. 白黒反転 (黒背景、白インクにする)
    const inv = new cv.Mat();
    cv.bitwise_not(gray, inv);

  // --- ★ここから修正: Zhang-Suen Thinning Algorithm ---
    // 2. Skeleton
    // まず2値化 (0 or 255)
    const binary = new cv.Mat();
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    // Zhang-Suen法の実装
    // OpenCV.jsには組み込みのskeletonizeがないため、画素操作で実装します
    const skeleton = binary.clone();
    const rows = skeleton.rows;
    const cols = skeleton.cols;
    const data = skeleton.data; // Uint8Arrayへの参照

    // ヘルパー: ピクセルインデックス取得
    const getIdx = (r: number, c: number) => r * cols + c;

    let isChanged = true;
    
    // 背景(黒)=0, 前景(白)=1 として扱うための正規化はせず、255/0のまま扱う
    // 計算コスト削減のため、ループ内で分岐判定
    
    while (isChanged) {
        isChanged = false;
        const pixelsToRemove: number[] = [];

        // Step 1 & Step 2 loop
        for (let step = 0; step < 2; step++) {
            pixelsToRemove.length = 0;

            for (let r = 1; r < rows - 1; r++) {
                for (let c = 1; c < cols - 1; c++) {
                    const idx = getIdx(r, c);
                    if (data[idx] === 0) continue; // 黒ならスキップ

                    // 8近傍取得 (p2, p3, ..., p9)
                    // p9 p2 p3
                    // p8 p1 p4
                    // p7 p6 p5
                    const p2 = data[getIdx(r - 1, c)] > 0 ? 1 : 0;
                    const p3 = data[getIdx(r - 1, c + 1)] > 0 ? 1 : 0;
                    const p4 = data[getIdx(r, c + 1)] > 0 ? 1 : 0;
                    const p5 = data[getIdx(r + 1, c + 1)] > 0 ? 1 : 0;
                    const p6 = data[getIdx(r + 1, c)] > 0 ? 1 : 0;
                    const p7 = data[getIdx(r + 1, c - 1)] > 0 ? 1 : 0;
                    const p8 = data[getIdx(r, c - 1)] > 0 ? 1 : 0;
                    const p9 = data[getIdx(r - 1, c - 1)] > 0 ? 1 : 0;

                    const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    if (B < 2 || B > 6) continue;

                    let A = 0;
                    if (p2 === 0 && p3 === 1) A++;
                    if (p3 === 0 && p4 === 1) A++;
                    if (p4 === 0 && p5 === 1) A++;
                    if (p5 === 0 && p6 === 1) A++;
                    if (p6 === 0 && p7 === 1) A++;
                    if (p7 === 0 && p8 === 1) A++;
                    if (p8 === 0 && p9 === 1) A++;
                    if (p9 === 0 && p2 === 1) A++;

                    if (A !== 1) continue;

                    let m1, m2;
                    if (step === 0) {
                        m1 = p2 * p4 * p6;
                        m2 = p4 * p6 * p8;
                    } else {
                        m1 = p2 * p4 * p8;
                        m2 = p2 * p6 * p8;
                    }

                    if (m1 === 0 && m2 === 0) {
                        pixelsToRemove.push(idx);
                    }
                }
            }

            if (pixelsToRemove.length > 0) {
                isChanged = true;
                for (let i = 0; i < pixelsToRemove.length; i++) {
                    data[pixelsToRemove[i]!] = 0;
                }
            }
        }
    }
    binary.delete(); // binaryはもう不要、skeletonに残っている
    // --- ★修正ここまで ---

    // 3. Density (Blur)
    const density = new cv.Mat();
    cv.GaussianBlur(inv, density, new cv.Size(3, 3), 0);
    // Normalize 0-255
    cv.normalize(density, density, 0, 255, cv.NORM_MINMAX);

    // 4. Sin/Cos (Sobel -> CartToPolar)
    const blurred = new cv.Mat();
    cv.GaussianBlur(inv, blurred, new cv.Size(3, 3), 0);
    const blurredF32 = new cv.Mat();
    blurred.convertTo(blurredF32, cv.CV_32F);

    const gx = new cv.Mat();
    const gy = new cv.Mat();
    cv.Sobel(blurredF32, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(blurredF32, gy, cv.CV_32F, 0, 1, 3);

    const mag = new cv.Mat();
    const angle = new cv.Mat();
    cv.cartToPolar(gx, gy, mag, angle, false); // radians

    // マスク作成 (勾配が弱いところは0にする)
    const mask = new cv.Mat();
    cv.threshold(mag, mask, 30, 255, cv.THRESH_BINARY);
    mask.convertTo(mask, cv.CV_8U);

    // Sin/Cos計算
    // ((sin(a) + 1) / 2) * 255
    // JSのMath.sin等は遅いので、ループで処理するか、cvの計算を使う
    // ここでは簡便のためFloat32Arrayで計算してMatに戻す
    const h = gray.rows;
    const w = gray.cols;
    const size = h * w;
    const angleData = angle.data32F;
    const maskData = mask.data;
    
    const sinData = new Uint8Array(size);
    const cosData = new Uint8Array(size);

    for (let i = 0; i < size; i++) {
        if (maskData[i] > 0) {
            const a = angleData[i];
            sinData[i] = ((Math.sin(a) + 1.0) / 2.0) * 255;
            cosData[i] = ((Math.cos(a) + 1.0) / 2.0) * 255;
        } else {
            sinData[i] = 0;
            cosData[i] = 0;
        }
    }
    
    // Clean up
    src.delete(); gray.delete(); inv.delete(); blurred.delete(); blurredF32.delete();
    gx.delete(); gy.delete(); mag.delete(); angle.delete(); mask.delete();

    // Matオブジェクトとして返す（後でcropするため）
    // 注意: sinData/cosDataはJS ArrayなのでMatにする必要はないが、
    // skeleton, densityはMatなので、全てTypedArrayまたはMatとして管理する方が良い。
    // ここではメモリ管理を楽にするため、Float32Arrayの巨大なバッファにまとめて返す設計にする。
    
    // Output Format: [Skeleton, Density, Sin, Cos] (4 channels)
    // Context, CoordX, CoordY は推論時に追加する
    const baseFeatures = {
        width: w,
        height: h,
        skeleton: skeleton.data, // Uint8Array
        density: density.data,   // Uint8Array
        sin: sinData,            // Uint8Array
        cos: cosData             // Uint8Array
    };

    skeleton.delete(); density.delete();

    return baseFeatures;
  }

  /**
   * 指定位置のパッチを切り出し、7チャンネルの入力テンソルデータを生成する
   * Code A: [Skel(0), Context(1), Dens(2), Sin(3), Cos(4), X(5), Y(6)]
   */
static extractPatch7Ch(
      baseFeats: any, 
      currentContextCanvas: HTMLCanvasElement,
      centerX: number, 
      centerY: number,
      coords: Float32Array
  ): Float32Array {
      const C = this.CROP_SIZE; // 48
      const half = C / 2;
      const w = baseFeats.width;
      const h = baseFeats.height;

      const x1 = Math.floor(centerX - half);
      const y1 = Math.floor(centerY - half);

      // Contextの取得
      // ★修正ポイント: コンテキスト用キャンバスは「現在の行(高さ48px)」だけを持っているので
      // Y座標は y1（絶対座標）ではなく、0（ローカル座標の先頭）から読み取る必要があります。
      const ctx = currentContextCanvas.getContext('2d', { willReadFrequently: true })!;
      
      // y=0 から C(48)px 分取得する
      const ctxData = ctx.getImageData(x1, 0, C, C); 
      
      const result = new Float32Array(C * C * 7);

      for (let py = 0; py < C; py++) {
          for (let px = 0; px < C; px++) {
              const globalX = x1 + px;
              const globalY = y1 + py;
              const dstIdx = (py * C + px) * 7;
              
              // 範囲外チェック
              if (globalX < 0 || globalX >= w || globalY < 0 || globalY >= h) {
                  // 範囲外処理
                  result[dstIdx + 0] = 255; // Skel: Bg(255)
                  result[dstIdx + 1] = 0;   // Ctx: Bg(0)
                  result[dstIdx + 2] = 0;
                  result[dstIdx + 3] = 0;
                  result[dstIdx + 4] = 0;
                  result[dstIdx + 5] = 0;
                  result[dstIdx + 6] = 0;
                  continue; 
              }

              const srcIdx = globalY * w + globalX;
              
              // 1. Skeleton (反転: 255-val)
              result[dstIdx + 0] = 255 - baseFeats.skeleton[srcIdx];

              // 2. Context
              // ★修正ポイント: ctxDataは (0,0) 起点で取得したので、
              // インデックス計算は (py * C + px) * 4 でOK。
              // (以前はここがズレていた可能性があります)
              const ctxPixelIdx = (py * C + px) * 4;
              
              // 範囲外(x方向のハミ出し)のケア
              // getImageDataはキャンバス外を透明(0)で返すため、
              // x1+px がキャンバス幅を超えている場合は透明になる。
              // 期待値は「白(255)」なので、透明なら白扱いにして、そのあと反転する
              
              let r = 255; // デフォルト白(紙)
              // ctxDataのバッファ範囲内かチェック
              if (ctxPixelIdx < ctxData.data.length) {
                  // アルファチャンネルを確認
                  const a = ctxData.data[ctxPixelIdx + 3]!;
                  if (a > 0) {
                      // 色があるならそのR値
                      r = ctxData.data[ctxPixelIdx]!;
                  } else {
                      // 透明なら白(紙)とみなす
                      r = 255;
                  }
              }

              let contextVal = 255 - r; // 黒(0) -> 255(Ink)

              // 現在行より下(未来)は隠す
              // LINE_HEIGHT(18)の半分(9)より下はマスク
              if (py > half + (this.LINE_HEIGHT/2)) {
                  contextVal = 0;
              }
              result[dstIdx + 1] = contextVal;

              // 3. Density
              result[dstIdx + 2] = baseFeats.density[srcIdx];

              // 4. Sin
              result[dstIdx + 3] = baseFeats.sin[srcIdx];

              // 5. Cos
              result[dstIdx + 4] = baseFeats.cos[srcIdx];

              // 6. X-Coord
              result[dstIdx + 5] = coords[(py * C + px) * 2 + 0]!;

              // 7. Y-Coord
              result[dstIdx + 6] = coords[(py * C + px) * 2 + 1]!;
          }
      }
      return result;
  }

  /**
   * 48x48のCoordMapを生成する (0-255)
   */
  static createCoordMap(): Float32Array {
      const C = this.CROP_SIZE;
      const map = new Float32Array(C * C * 2);
      for (let y = 0; y < C; y++) {
          for (let x = 0; x < C; x++) {
              const idx = (y * C + x) * 2;
              // 0.0 - 1.0 -> 0 - 255
              map[idx + 0] = (x / (C - 1)) * 255;
              map[idx + 1] = (y / (C - 1)) * 255;
          }
      }
      return map;
  }

  static createCoordMapVector(): Float32Array {
      const C = this.CROP_SIZE;
      const map = new Float32Array(C * C * 2);
      for (let y = 0; y < C; y++) {
          for (let x = 0; x < C; x++) {
              const idx = (y * C + x) * 2;
              // 0..47 -> -1.0..1.0
              // formula: (val / (size-1)) * 2 - 1
              map[idx + 0] = (x / (C - 1)) * 2.0 - 1.0;
              map[idx + 1] = (y / (C - 1)) * 2.0 - 1.0;
          }
      }
      return map;
  }

  /**
   * 画像(48x48)を受け取り、コードB用の6チャンネル入力を生成して返す
   * Channels: [Src, Dist, Sin, Cos, X, Y]
   * ※入力はすでに48x48にクロップされたCanvasまたはMatを想定
   */
  static generateVectorInput(
      sourceCanvas: HTMLCanvasElement | any, // 48x48の文字画像
      coordMap: Float32Array
  ): Float32Array {
      // ★追加: ガード処理
      if (!coordMap) {
          console.error("generateVectorInput: coordMap is missing!");
          // 緊急回避用のダミーマップを作成
          coordMap = this.createCoordMapVector();
      }
      const C = this.CROP_SIZE;
      
      // 1. 画像読み込み & 前処理
      const src = cv.imread(sourceCanvas);
      const gray = new cv.Mat();
      if (src.channels() === 4) cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      else src.copyTo(gray);
      
      const inv = new cv.Mat();
      cv.bitwise_not(gray, inv); // 0=Bg, 255=Ink

      // Ch0: Src (反転画像を 0.0-1.0 に正規化して使う)
      // Ch1: Dist (距離変換)
      const dist = new cv.Mat();
      // cv.distanceTransform(src, dst, distanceType, maskSize)
      cv.distanceTransform(inv, dist, cv.DIST_L2, 5);
      cv.normalize(dist, dist, 0.0, 1.0, cv.NORM_MINMAX);

      // Ch2,3: Sin, Cos
      const blurred = new cv.Mat();
      cv.GaussianBlur(inv, blurred, new cv.Size(3, 3), 0);
      const blurredF32 = new cv.Mat();
      blurred.convertTo(blurredF32, cv.CV_32F);

      const gx = new cv.Mat();
      const gy = new cv.Mat();
      cv.Sobel(blurredF32, gx, cv.CV_32F, 1, 0, 3);
      cv.Sobel(blurredF32, gy, cv.CV_32F, 0, 1, 3);

      const mag = new cv.Mat();
      const angle = new cv.Mat();
      cv.cartToPolar(gx, gy, mag, angle, false); // radians

      const mask = new cv.Mat();
      cv.threshold(mag, mask, 10, 255, cv.THRESH_BINARY); // Python版閾値: 10.0
      mask.convertTo(mask, cv.CV_8U);

      // データ取り出し
      const size = C * C;
      const result = new Float32Array(size * 6);
      
      const invData = inv.data;
      const distData = dist.data32F; // float
      const angleData = angle.data32F;
      const maskData = mask.data;

      for (let i = 0; i < size; i++) {
          const idx = i * 6;
          
          // Ch0: Src (0-255 -> 0.0-1.0)
          result[idx + 0] = invData[i] / 255.0;

          // Ch1: Dist (すでに0.0-1.0)
          result[idx + 1] = distData[i];

          // Ch2,3: Sin, Cos
          if (maskData[i] > 0) {
              const a = angleData[i];
              // Python: (np.sin(angle) + 1.0) / 2.0
              result[idx + 2] = (Math.sin(a) + 1.0) / 2.0;
              result[idx + 3] = (Math.cos(a) + 1.0) / 2.0;
          } else {
              result[idx + 2] = 0;
              result[idx + 3] = 0;
          }

          // Ch4,5: Coord (-1.0 ~ 1.0)
          result[idx + 4] = coordMap[i * 2 + 0]!;
          result[idx + 5] = coordMap[i * 2 + 1]!;
      }

      // Cleanup
      src.delete(); gray.delete(); inv.delete(); dist.delete();
      blurred.delete(); blurredF32.delete(); gx.delete(); gy.delete();
      mag.delete(); angle.delete(); mask.delete();

      return result;
  }

/**
   * Code B推論用: 画像全体からベース特徴量(4ch)を生成
   * [Src, Dist, Sin, Cos]
   * ※ generateBaseFeatures (7ch用) と似ていますが、こちらはSkeletonを含まず、
   * Src(反転画像)とDist(距離変換)を含みます。
   */
  static generateVectorBaseFeatures(imgElement: HTMLImageElement | HTMLCanvasElement): any {
      const src = cv.imread(imgElement);
      const gray = new cv.Mat();
      if (src.channels() === 4) cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      else src.copyTo(gray);

      const inv = new cv.Mat();
      cv.bitwise_not(gray, inv); // 0=Bg, 255=Ink

      const h = gray.rows;
      const w = gray.cols;

      // 1. Dist (Distance Transform)
      const dist = new cv.Mat();
      cv.distanceTransform(inv, dist, cv.DIST_L2, 5);
      cv.normalize(dist, dist, 0.0, 1.0, cv.NORM_MINMAX);

      // 2. Sin/Cos
      const blurred = new cv.Mat();
      cv.GaussianBlur(inv, blurred, new cv.Size(3, 3), 0);
      const blurredF32 = new cv.Mat();
      blurred.convertTo(blurredF32, cv.CV_32F);

      const gx = new cv.Mat();
      const gy = new cv.Mat();
      cv.Sobel(blurredF32, gx, cv.CV_32F, 1, 0, 3);
      cv.Sobel(blurredF32, gy, cv.CV_32F, 0, 1, 3);

      const mag = new cv.Mat();
      const angle = new cv.Mat();
      cv.cartToPolar(gx, gy, mag, angle, false); 

      const mask = new cv.Mat();
      cv.threshold(mag, mask, 10, 255, cv.THRESH_BINARY);
      mask.convertTo(mask, cv.CV_8U);

      // Sin/Cosを計算してUint8に格納 (0-255)
      const size = h * w;
      const angleData = angle.data32F;
      const maskData = mask.data;
      const sinData = new Uint8Array(size);
      const cosData = new Uint8Array(size);

      for(let i=0; i<size; i++) {
          if (maskData[i] > 0) {
              const a = angleData[i];
              sinData[i] = ((Math.sin(a) + 1.0) / 2.0) * 255;
              cosData[i] = ((Math.cos(a) + 1.0) / 2.0) * 255;
          } else {
              sinData[i] = 0;
              cosData[i] = 0;
          }
      }

      // Cleanup
      src.delete(); gray.delete(); blurred.delete(); blurredF32.delete();
      gx.delete(); gy.delete(); mag.delete(); angle.delete(); mask.delete();
      
      const features = {
          width: w,
          height: h,
          invData: inv.data,      // Uint8 (Src)
          distData: dist.data32F, // Float32 (Dist)
          sinData: sinData,       // Uint8
          cosData: cosData        // Uint8
      };
      
      inv.delete(); dist.delete();

      return features;
  }
/**
   * Code B推論用: 6チャンネルパッチ抽出
   * [Src, Dist, Sin, Cos, X, Y]
   */
  static extractPatchVector(
      baseFeats: any,
      centerX: number,
      centerY: number,
      coordMap: Float32Array // -1.0 ~ 1.0
  ): Float32Array {
      const C = this.CROP_SIZE; // 48
      const half = C / 2;
      const w = baseFeats.width;
      const h = baseFeats.height;

      const x1 = Math.floor(centerX - half);
      const y1 = Math.floor(centerY - half);

      const result = new Float32Array(C * C * 6);

      for (let py = 0; py < C; py++) {
          for (let px = 0; px < C; px++) {
              const globalX = x1 + px;
              const globalY = y1 + py;
              const dstIdx = (py * C + px) * 6;

              // 範囲外は 0 (Padding)
              if (globalX < 0 || globalX >= w || globalY < 0 || globalY >= h) {
                  result[dstIdx + 0] = 0;
                  result[dstIdx + 1] = 0;
                  result[dstIdx + 2] = 0;
                  result[dstIdx + 3] = 0;
                  result[dstIdx + 4] = 0;
                  result[dstIdx + 5] = 0;
                  continue;
              }

              const srcIdx = globalY * w + globalX;

              // Ch0: Src (0-255 -> 0.0-1.0)
              result[dstIdx + 0] = baseFeats.invData[srcIdx] / 255.0;

              // Ch1: Dist (すでにFloat 0.0-1.0)
              result[dstIdx + 1] = baseFeats.distData[srcIdx];

              // Ch2,3: Sin, Cos (0-255 -> 0.0-1.0)
              result[dstIdx + 2] = baseFeats.sinData[srcIdx] / 255.0;
              result[dstIdx + 3] = baseFeats.cosData[srcIdx] / 255.0;

              // Ch4,5: Coord (-1.0 ~ 1.0)
              result[dstIdx + 4] = coordMap[(py * C + px) * 2 + 0]!;
              result[dstIdx + 5] = coordMap[(py * C + px) * 2 + 1]!;
          }
      }
      return result;
  }
}