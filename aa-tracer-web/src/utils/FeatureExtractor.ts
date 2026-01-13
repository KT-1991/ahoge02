// FeatureExtractor.ts
declare const cv: any;

export interface BaseFeatureMaps {
    width: number;
    height: number;
    invData: Uint8Array;      
    distData: Float32Array;   
    sinData: Uint8Array;      
    cosData: Uint8Array;      
    skeletonData: Uint8Array; 
    densityData: Uint8Array;  
}

export class FeatureExtractor {
    static CROP_SIZE_A = 48;
    static CROP_SIZE_B = 40;
    static LINE_HEIGHT = 18;

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

    private static skeletonize(binaryMat: any): any {
        const skeleton = new cv.Mat.zeros(binaryMat.rows, binaryMat.cols, cv.CV_8UC1);
        let eroded = binaryMat.clone();
        const temp = new cv.Mat();
        const tempErode = new cv.Mat();
        const tempDilate = new cv.Mat();
        const element = cv.getStructuringElement(cv.MORPH_CROSS, new cv.Size(3, 3));
        
        let done = false;
        while (!done) {
            cv.erode(eroded, tempErode, element);
            cv.dilate(tempErode, tempDilate, element);
            cv.subtract(eroded, tempDilate, temp);
            cv.bitwise_or(skeleton, temp, skeleton);
            const oldEroded = eroded;
            eroded = tempErode.clone();
            oldEroded.delete();
            if (cv.countNonZero(eroded) === 0) done = true;
        }
        const finalSkel = new cv.Mat();
        cv.dilate(skeleton, finalSkel, element);
        //const finalSkel = skeleton.clone();
        skeleton.delete(); eroded.delete(); temp.delete();
        tempErode.delete(); tempDilate.delete(); element.delete();
        return finalSkel;
    }

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
                input[dstIdx + 0] = base.skeletonData[srcIdx]!; 
                input[dstIdx + 1] = base.densityData[srcIdx]!;
                input[dstIdx + 2] = base.sinData[srcIdx]!;
                input[dstIdx + 3] = base.cosData[srcIdx]!;
                input[dstIdx + 4] = coordMap[(y * C + x) * 2 + 0]! * 255;
                input[dstIdx + 5] = coordMap[(y * C + x) * 2 + 1]! * 255;
            }
        }
        return input;
    }

    static generateBaseFeatures(
        sourceCanvas: HTMLCanvasElement, 
        paintBuffer: HTMLCanvasElement | null = null,
        imageTransform: any = null
    ): BaseFeatureMaps {
        const src = cv.imread(sourceCanvas); 
        
        if (paintBuffer && imageTransform) {
            // A. 作業用Canvas作成
            const tmp = document.createElement('canvas');
            tmp.width = sourceCanvas.width;
            tmp.height = sourceCanvas.height;
            const ctx = tmp.getContext('2d', { willReadFrequently: true })!;
            
            // 背景を白で塗りつぶす
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, tmp.width, tmp.height);
            
            // ペイントを描画 (変形適用)
            ctx.save();
            ctx.translate(imageTransform.x, imageTransform.y);
            ctx.rotate(imageTransform.rotation * Math.PI / 180);
            ctx.scale(imageTransform.scale, imageTransform.scale);
            ctx.drawImage(paintBuffer, 0, 0);
            ctx.restore();
            
            // ★★★ 変更点: ピクセル操作で色を強制排除する ★★★
            const imgData = ctx.getImageData(0, 0, tmp.width, tmp.height);
            const data = imgData.data;
            
            // 全ピクセルを走査
            for(let i = 0; i < data.length; i += 4) {
                const r = data[i]!;
                const g = data[i+1]!;
                const b = data[i+2]!;
                // 白(255,255,255) は無視
                if (r > 250 && g > 250 && b > 250) continue;

                // 彩度(色の鮮やかさ)を簡易計算: Max - Min
                const max = Math.max(r, g, b);
                const min = Math.min(r, g, b);
                const saturation = max - min;

                // 彩度が高い(>20)ピクセルは「有彩色（青や赤）」なので、白く塗りつぶして消す
                // 黒やグレーのインクは彩度が低いため、このifに入らず残ります
                if (saturation > 20) {
                    data[i] = 255;   // R
                    data[i+1] = 255; // G
                    data[i+2] = 255; // B
                }
            }
            // 加工した画像を戻す
            ctx.putImageData(imgData, 0, 0);
            // ★★★★★★★★★★★★★★★★★★★★★★★★★★★

            // B. 合成 (OpenCV)
            // ここで paintMat は「黒インク以外は真っ白」になっている
            const paintMat = cv.imread(tmp); 
            
            // src(元画像) と paintMat(黒加筆) を比較し、暗い方(黒)を残す
            cv.min(src, paintMat, src);
            
            // Cleanup
            tmp.width = 0; 
            paintMat.delete();
        }
        const gray = new cv.Mat();

        if (src.channels() === 4) {
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        } else {
            src.copyTo(gray);
        }

        const mean = cv.mean(gray);
        const inv = new cv.Mat();
        
        if (mean[0] > 127) {
            cv.bitwise_not(gray, inv); 
        } else {
            gray.copyTo(inv);
        }

        cv.threshold(inv, inv, 20, 0, cv.THRESH_TOZERO);

        const h = inv.rows;
        const w = inv.cols;

        const dist = new cv.Mat();
        cv.distanceTransform(inv, dist, cv.DIST_L2, 5);
        cv.normalize(dist, dist, 0.0, 1.0, cv.NORM_MINMAX);

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
        cv.threshold(mag, mask, 30, 255, cv.THRESH_BINARY); 
        mask.convertTo(mask, cv.CV_8U);

        const size = w * h;
        const angleData = angle.data32F;
        const maskData = mask.data;
        const sinData = new Uint8Array(size);
        const cosData = new Uint8Array(size);

        for (let i = 0; i < size; i++) {
            if (maskData[i] > 0) {
                const rad = angleData[i];
                sinData[i] = ((Math.sin(rad) + 1.0) / 2.0) * 255;
                cosData[i] = ((Math.cos(rad) + 1.0) / 2.0) * 255;
            } else {
                sinData[i] = 0;
                cosData[i] = 0;
            }
        }

        const binary = new cv.Mat();
        cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
        
        const skeletonMat = this.skeletonize(binary);
        //const skeletonMat = binary.clone()

        const densityMat = new cv.Mat();
        cv.GaussianBlur(inv, densityMat, new cv.Size(15, 15), 0);
        cv.normalize(densityMat, densityMat, 0, 255, cv.NORM_MINMAX);

        const result: BaseFeatureMaps = {
            width: w,
            height: h,
            invData: new Uint8Array(inv.data),           
            distData: new Float32Array(dist.data32F),    
            sinData: sinData,
            cosData: cosData,
            skeletonData: new Uint8Array(skeletonMat.data), 
            densityData: new Uint8Array(densityMat.data)    
        };

        src.delete(); gray.delete(); inv.delete();
        dist.delete(); blurred.delete(); blurredF32.delete();
        gx.delete(); gy.delete(); mag.delete(); angle.delete(); mask.delete();
        binary.delete(); skeletonMat.delete(); densityMat.delete();

        return result;
    }

    static extractPatch48_9ch(
        base: BaseFeatureMaps,
        contextCanvas: HTMLCanvasElement,     
        prevRowCanvas: HTMLCanvasElement | null, 
        nextRowCanvas: HTMLCanvasElement | null, 
        cx: number, cy: number,
        coordMap: Float32Array
    ): Float32Array {
        const C = 48;
        const size = C * C;
        const input = new Float32Array(size * 9);
        const half = C / 2;
        
        const startX = Math.floor(cx - half);
        const startY = Math.floor(cy - half);
        const w = base.width;
        const h = base.height;

        const ctxCur = contextCanvas.getContext('2d', { willReadFrequently: true })!;
        const curImgData = ctxCur.getImageData(startX, 0, C, C).data;

        let aboveData: Uint8ClampedArray | null = null;
        if (prevRowCanvas) aboveData = prevRowCanvas.getContext('2d')!.getImageData(startX, 0, C, C).data;
        
        let belowData: Uint8ClampedArray | null = null;
        if (nextRowCanvas) belowData = nextRowCanvas.getContext('2d')!.getImageData(startX, 0, C, C).data;

        const lhHalf = this.LINE_HEIGHT / 2;

        for (let y = 0; y < C; y++) {
            for (let x = 0; x < C; x++) {
                const gx = startX + x;
                const gy = startY + y;
                const dstIdx = (y * C + x) * 9;

                if (gx < 0 || gx >= w || gy < 0 || gy >= h) {
                    input.fill(0, dstIdx, dstIdx + 9);
                    continue;
                }

                const srcIdx = gy * w + gx;

                input[dstIdx + 0] = base.skeletonData[srcIdx]!;

                let pixelVal = 0;
                const isMasked = (y >= half + lhHalf) || (y < half - lhHalf) || 
                                 (y >= half - lhHalf && y < half + lhHalf && x >= half);
                
                if (!isMasked) {
                    const r = curImgData[(y * C + x) * 4]!;
                    pixelVal = r < 200 ? 255 : 0; 
                }
                input[dstIdx + 1] = pixelVal;

                if (aboveData) {
                    const r = aboveData[(y * C + x) * 4]!;
                    input[dstIdx + 2] = r < 200 ? 255 : 0;
                } else input[dstIdx + 2] = 0;

                if (belowData) {
                    const r = belowData[(y * C + x) * 4]!;
                    input[dstIdx + 3] = r < 200 ? 255 : 0;
                } else input[dstIdx + 3] = 0;

                input[dstIdx + 4] = base.densityData[srcIdx]!;
                input[dstIdx + 5] = base.sinData[srcIdx]!;
                input[dstIdx + 6] = base.cosData[srcIdx]!;
                input[dstIdx + 7] = coordMap[(y * C + x) * 2 + 0]! * 255;
                input[dstIdx + 8] = coordMap[(y * C + x) * 2 + 1]! * 255;
            }
        }
        return input;
    }

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
                    continue; 
                }

                const srcIdx = gy * w + gx;

                input[dstIdx + 0] = base.invData[srcIdx]! / 255.0;
                input[dstIdx + 1] = base.distData[srcIdx]!;
                input[dstIdx + 2] = base.sinData[srcIdx]! / 255.0;
                input[dstIdx + 3] = base.cosData[srcIdx]! / 255.0;
                input[dstIdx + 4] = coordMap[(y * C + x) * 2 + 0]!;
                input[dstIdx + 5] = coordMap[(y * C + x) * 2 + 1]!;
            }
        }
        return input;
    }
}