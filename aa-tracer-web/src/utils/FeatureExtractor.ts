// src/utils/FeatureExtractor.ts
declare const cv: any;

export class FeatureExtractor {
  static CROP_SIZE = 32;
  static LINE_HEIGHT = 16;

  static generate9ChInput(imgElement: HTMLImageElement | HTMLCanvasElement, 
                          lineThreshold: number = 0.4,
                          thinningIterations: number = 0,
                          maskElement: HTMLCanvasElement | null = null // ★追加: 塗りレイヤー
                          ): Float32Array {
    // 1. 画像読み込み
    const src = cv.imread(imgElement);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // =========================================================
    // ★追加: モルフォロジー変換による細線化処理
    // =========================================================
    if (thinningIterations > 0) {
      // 2値化してノイズを消してから処理したほうが綺麗に削れます
      cv.threshold(gray, gray, 200, 255, cv.THRESH_BINARY);

      // 十字型のカーネルを作成（矩形より角が丸くならず、自然に削れます）
      const kernel = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));
      
      // 「白」を膨張させる ＝ 「黒」い線が細くなる
      cv.dilate(gray, gray, kernel, new cv.Point(-1, -1), thinningIterations);
      
      // メモリ解放
      kernel.delete();
    }
    // =========================================================

    const h = gray.rows;
    const w = gray.cols;

    // --- 前処理 ---
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

    const binary = new cv.Mat();
    cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    // --- Ch0: Skeleton ---
    const dist = new cv.Mat();
    cv.distanceTransform(binary, dist, cv.DIST_L2, 5);
    cv.normalize(dist, dist, 0.0, 1.0, cv.NORM_MINMAX);
    const skeleton = new cv.Mat();
    cv.threshold(dist, skeleton, lineThreshold, 255, cv.THRESH_BINARY);
    skeleton.convertTo(skeleton, cv.CV_8U);

    // --- Ch1, Ch2: Angle (Sin/Cos) ---
    const gx = new cv.Mat();
    const gy = new cv.Mat();
    const blurredF32 = new cv.Mat();
    blurred.convertTo(blurredF32, cv.CV_32F);
    
    cv.Sobel(blurredF32, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(blurredF32, gy, cv.CV_32F, 0, 1, 3);
    
    const mag = new cv.Mat();
    const angle = new cv.Mat();
    cv.cartToPolar(gx, gy, mag, angle, false); // radians

    const mask = new cv.Mat();
    cv.threshold(mag, mask, 30, 255, cv.THRESH_BINARY);
    mask.convertTo(mask, cv.CV_8U);

    // --- Ch3: Density ---
    const ch3 = new cv.Mat();
    cv.GaussianBlur(binary, ch3, new cv.Size(15, 15), 0);

    // --- 2. カラーマスク (Hatching) の処理 ---
    // デフォルトは真っ黒
    const ch4 = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U); // Dot Body (Blue)
    const ch5 = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U); // Line Body (Red)
    const ch6 = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U); // Dot Border
    const ch7 = new cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8U); // Line Border

    if (maskElement) {
      // マスク画像を読み込み
      const maskSrc = cv.imread(maskElement);
      const rgbaPlanes = new cv.MatVector();
      cv.split(maskSrc, rgbaPlanes);
      
      // RGBAなので: 0:R, 1:G, 2:B, 3:A
      const rPlane = rgbaPlanes.get(0);
      const bPlane = rgbaPlanes.get(2);

      // 閾値処理 (塗られている部分を抽出)
      // 赤成分があれば Ch5 (Line Pattern)
      cv.threshold(rPlane, ch5, 100, 255, cv.THRESH_BINARY);
      // 青成分があれば Ch4 (Dot Pattern)
      cv.threshold(bPlane, ch4, 100, 255, cv.THRESH_BINARY);

      // 境界抽出 (Erodeして差分を取る)
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      
      const erodedDot = new cv.Mat();
      cv.erode(ch4, erodedDot, kernel);
      cv.subtract(ch4, erodedDot, ch6); // Ch6
      
      const erodedLine = new cv.Mat();
      cv.erode(ch5, erodedLine, kernel);
      cv.subtract(ch5, erodedLine, ch7); // Ch7

      // メモリ解放
      maskSrc.delete(); rgbaPlanes.delete(); rPlane.delete(); bPlane.delete();
      kernel.delete(); erodedDot.delete(); erodedLine.delete();
    }
    // カラーチャンネルのデータを取得
    const ch4Data = ch4.data;
    const ch5Data = ch5.data;
    const ch6Data = ch6.data;
    const ch7Data = ch7.data;

    // --- メモリ確保 (Float32Array) ---
    const resultLen = h * w * 9;
    const resultData = new Float32Array(resultLen);

    // 高速アクセスのためTypedArrayを取得
    const skeletonData = skeleton.data; // Uint8
    const angleData = angle.data32F; // Float32
    const maskData = mask.data; // Uint8
    const ch3Data = ch3.data; // Uint8
    // カラーマスク(Ch4-7)は今回は省略(All 0)

    // ループ処理 (ここが重いのでTypedArrayでアクセス)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const outIdx = idx * 9;

        // Ch0: Skeleton
        resultData[outIdx + 0] = skeletonData[idx];

        // Ch1, Ch2: Sin/Cos
        if (maskData[idx] > 0) {
           const a = angleData[idx];
           resultData[outIdx + 1] = ((Math.sin(a) + 1.0) / 2.0) * 255;
           resultData[outIdx + 2] = ((Math.cos(a) + 1.0) / 2.0) * 255;
        } else {
           resultData[outIdx + 1] = 0;
           resultData[outIdx + 2] = 0;
        }

        // Ch3: Density
        resultData[outIdx + 3] = ch3Data[idx];

        // Ch4-7: Dummy (Color masks)
// Ch4 - Ch7 (今回追加)
        resultData[outIdx + 4] = ch4Data[idx]; // Dot Body
        resultData[outIdx + 5] = ch5Data[idx]; // Line Body
        resultData[outIdx + 6] = ch6Data[idx]; // Dot Border
        resultData[outIdx + 7] = ch7Data[idx]; // Line Border

        // Ch8: Grid
        resultData[outIdx + 8] = ((x + y) % 2) * 255;
      }
    }

    // メモリ解放
    src.delete(); gray.delete(); blurred.delete(); binary.delete();
    dist.delete(); skeleton.delete(); blurredF32.delete();
    gx.delete(); gy.delete(); mag.delete(); angle.delete(); mask.delete(); ch3.delete();
    ch4.delete(); ch5.delete(); ch6.delete(); ch7.delete();

    return resultData;
  }
}