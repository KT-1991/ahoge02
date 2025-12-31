declare const cv: any;

export class FeatureExtractor {
  static CROP_SIZE = 32;
  static LINE_HEIGHT = 16;

  // === Classifier用 (提供されたコード準拠) ===
  static generate9ChInput(
    imgElement: HTMLImageElement | HTMLCanvasElement, 
    lineThreshold: number = 0.4, // ここは提供コードでは lineWeight ではなく threshold になっていた点に注意
    thinningIterations: number = 0,
    maskElement: HTMLCanvasElement | null = null
  ): Float32Array {
    // 1. 画像読み込み
    const src = cv.imread(imgElement);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // モルフォロジー変換による細線化処理
    if (thinningIterations > 0) {
      cv.threshold(gray, gray, 200, 255, cv.THRESH_BINARY);
      const kernel = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));
      cv.dilate(gray, gray, kernel, new cv.Point(-1, -1), thinningIterations);
      kernel.delete();
    }

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
    const ch4 = new cv.Mat.zeros(h, w, cv.CV_8U); // Dot Body (Blue)
    const ch5 = new cv.Mat.zeros(h, w, cv.CV_8U); // Line Body (Red)
    const ch6 = new cv.Mat.zeros(h, w, cv.CV_8U); // Dot Border
    const ch7 = new cv.Mat.zeros(h, w, cv.CV_8U); // Line Border

    if (maskElement) {
      const maskSrc = cv.imread(maskElement);
      const rgbaPlanes = new cv.MatVector();
      cv.split(maskSrc, rgbaPlanes);
      
      const rPlane = rgbaPlanes.get(0);
      const bPlane = rgbaPlanes.get(2);

      cv.threshold(rPlane, ch5, 100, 255, cv.THRESH_BINARY);
      cv.threshold(bPlane, ch4, 100, 255, cv.THRESH_BINARY);

      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      
      const erodedDot = new cv.Mat();
      cv.erode(ch4, erodedDot, kernel);
      cv.subtract(ch4, erodedDot, ch6);
      
      const erodedLine = new cv.Mat();
      cv.erode(ch5, erodedLine, kernel);
      cv.subtract(ch5, erodedLine, ch7);

      maskSrc.delete(); rgbaPlanes.delete(); rPlane.delete(); bPlane.delete();
      kernel.delete(); erodedDot.delete(); erodedLine.delete();
    }

    // --- Output ---
    const resultLen = h * w * 9;
    const resultData = new Float32Array(resultLen);

    const skeletonData = skeleton.data;
    const angleData = angle.data32F;
    const maskData = mask.data;
    const ch3Data = ch3.data;
    const ch4Data = ch4.data; const ch5Data = ch5.data;
    const ch6Data = ch6.data; const ch7Data = ch7.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const outIdx = idx * 9;

        resultData[outIdx + 0] = skeletonData[idx];

        if (maskData[idx] > 0) {
           const a = angleData[idx];
           resultData[outIdx + 1] = ((Math.sin(a) + 1.0) / 2.0) * 255;
           resultData[outIdx + 2] = ((Math.cos(a) + 1.0) / 2.0) * 255;
        } else {
           resultData[outIdx + 1] = 0;
           resultData[outIdx + 2] = 0;
        }

        resultData[outIdx + 3] = ch3Data[idx];
        resultData[outIdx + 4] = ch4Data[idx];
        resultData[outIdx + 5] = ch5Data[idx];
        resultData[outIdx + 6] = ch6Data[idx];
        resultData[outIdx + 7] = ch7Data[idx];
        resultData[outIdx + 8] = ((x + y) % 2) * 255;
      }
    }

    src.delete(); gray.delete(); blurred.delete(); binary.delete();
    dist.delete(); skeleton.delete(); blurredF32.delete();
    gx.delete(); gy.delete(); mag.delete(); angle.delete(); mask.delete(); ch3.delete();
    ch4.delete(); ch5.delete(); ch6.delete(); ch7.delete();

    return resultData;
  }

  // === Vector用 (Code B準拠) ===
  static skeletonize(src: any): any {
    const gray = new cv.Mat();
    if (src.channels() === 4) cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    else src.copyTo(gray);

    const binary = new cv.Mat();
    // 白背景(255) -> 黒背景(0)
    cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    const skeleton = new cv.Mat.zeros(binary.rows, binary.cols, cv.CV_8U);
    const temp = new cv.Mat();
    const eroded = new cv.Mat();
    const element = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));
    
    const img = binary.clone();
    let done = false;
    while (!done) {
        cv.erode(img, eroded, element);
        cv.dilate(eroded, temp, element);
        cv.subtract(img, temp, temp);
        cv.bitwise_or(skeleton, temp, skeleton);
        eroded.copyTo(img);
        if (cv.countNonZero(img) === 0) done = true;
    }

    // 白背景・黒文字に戻す (1px)
    const result = new cv.Mat();
    cv.bitwise_not(skeleton, result);

    gray.delete(); binary.delete(); skeleton.delete();
    temp.delete(); eroded.delete(); element.delete(); img.delete();
    return result;
  }

  static generate9ChInputFromSkeleton(skeletonSrc: any, maskElement: any = null): Float32Array {
    console.log(maskElement);
    const h = skeletonSrc.rows;
    const w = skeletonSrc.cols;

    // 1pxスケルトン (黒背景)
    const imgSkeletonInv = new cv.Mat();
    cv.bitwise_not(skeletonSrc, imgSkeletonInv);

    // 3px太らせ画像 (黒背景)
    const kernelFat = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    const imgFatInv = new cv.Mat();
    cv.dilate(imgSkeletonInv, imgFatInv, kernelFat, new cv.Point(-1, -1), 1);
    
    // Ch0: Skeleton (1px版)
    const ch0 = imgSkeletonInv; 

    // Ch1, Ch2: Angle (3px版)
    const imgFat = new cv.Mat();
    cv.bitwise_not(imgFatInv, imgFat); // 白背景(3px)
    const blurredFat = new cv.Mat();
    cv.GaussianBlur(imgFat, blurredFat, new cv.Size(3, 3), 0);
    const blurredFatF32 = new cv.Mat();
    blurredFat.convertTo(blurredFatF32, cv.CV_32F);
    
    const gx = new cv.Mat(); const gy = new cv.Mat();
    cv.Sobel(blurredFatF32, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(blurredFatF32, gy, cv.CV_32F, 0, 1, 3);
    const mag = new cv.Mat(); const angle = new cv.Mat();
    cv.cartToPolar(gx, gy, mag, angle, false);
    const maskMat = new cv.Mat();
    cv.threshold(mag, maskMat, 30, 255, cv.THRESH_BINARY);
    maskMat.convertTo(maskMat, cv.CV_8U);

    // Ch3: Density (3px版)
    const ch3 = new cv.Mat();
    cv.GaussianBlur(imgFatInv, ch3, new cv.Size(15, 15), 0);

    const resultLen = h * w * 9;
    const resultData = new Float32Array(resultLen);
    const d0 = ch0.data; const dAng = angle.data32F; const dMask = maskMat.data; const d3 = ch3.data;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const outIdx = idx * 9;
            resultData[outIdx + 0] = d0[idx];
            if (dMask[idx] > 0) {
                const a = dAng[idx];
                resultData[outIdx + 1] = ((Math.sin(a) + 1.0) / 2.0) * 255;
                resultData[outIdx + 2] = ((Math.cos(a) + 1.0) / 2.0) * 255;
            } else {
                resultData[outIdx + 1] = 0; resultData[outIdx + 2] = 0;
            }
            resultData[outIdx + 3] = d3[idx];
            resultData[outIdx + 8] = ((x + y) % 2) * 255;
        }
    }

    imgSkeletonInv.delete(); kernelFat.delete(); imgFatInv.delete(); imgFat.delete();
    blurredFat.delete(); blurredFatF32.delete(); gx.delete(); gy.delete(); mag.delete();
    angle.delete(); maskMat.delete(); ch3.delete();
    return resultData;
  }
}