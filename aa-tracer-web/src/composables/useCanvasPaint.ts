import { ref } from 'vue';
declare const cv: any;

export function useCanvasPaint() {
    // --- State ---
    const paintBuffer = ref<HTMLCanvasElement | null>(null);
    const paintMode = ref<'brush' | 'bucket' | 'eraser' | 'move'>('move'); 
    const paintColor = ref<'blue' | 'red'>('blue');
    const brushSize = ref(10);
    
    // Image State
    const sourceImage = ref<HTMLImageElement | null>(null);
    const imageSize = ref({ w: 0, h: 0 });
    const imgTransform = ref({ x: 0, y: 0, scale: 1.0, rotation: 0 });
    const isDraggingImage = ref(false);
    const lastMousePos = ref({ x: 0, y: 0 });
    const canvasDims = ref({ width: 0, height: 0 });

    // --- Actions ---
    const initPaintBuffer = (width: number, height: number) => {
        paintBuffer.value = document.createElement('canvas');
        paintBuffer.value.width = width;
        paintBuffer.value.height = height;
        const ctx = paintBuffer.value.getContext('2d', { willReadFrequently: true })!;
        ctx.clearRect(0, 0, width, height);
    };

    const updateCanvasDimensions = async () => {
        if (!sourceImage.value) return;
        const w = Math.floor(sourceImage.value.width * imgTransform.value.scale * 1.5) + 200;
        const h = Math.floor(sourceImage.value.height * imgTransform.value.scale * 1.5) + 200;
        canvasDims.value = { width: w, height: h };
    };

    const toImageSpace = (screenX: number, screenY: number) => {
        const { x, y, scale, rotation } = imgTransform.value;
        let dx = screenX - x;
        let dy = screenY - y;
        const rad = -rotation * Math.PI / 180;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        return { x: rx / scale, y: ry / scale };
    };

    const performFloodFill = (
        imgX: number, imgY: number, 
        isEraser: boolean, 
        bgImage: HTMLImageElement | HTMLCanvasElement
    ) => {
        if (!paintBuffer.value || !bgImage) return;
        const w = paintBuffer.value.width;
        const h = paintBuffer.value.height;
        if (imgX < 0 || imgY < 0 || imgX >= w || imgY >= h) return;

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = w; srcCanvas.height = h;
        const sCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
        sCtx.drawImage(bgImage, 0, 0, w, h);

        const srcMat = cv.imread(srcCanvas);
        if (srcMat.channels() > 1) {
            cv.cvtColor(srcMat, srcMat, cv.COLOR_RGBA2GRAY);
        }
        cv.threshold(srcMat, srcMat, 200, 255, cv.THRESH_BINARY);

        const fillMask = new cv.Mat.zeros(h + 2, w + 2, cv.CV_8U);
        const seedPoint = new cv.Point(Math.floor(imgX), Math.floor(imgY));
        const newVal = new cv.Scalar(100);
        
        cv.floodFill(srcMat, fillMask, seedPoint, newVal, new cv.Rect(), new cv.Scalar(5), new cv.Scalar(5), 4);

        const pCtx = paintBuffer.value.getContext('2d', { willReadFrequently: true })!;
        const pData = pCtx.getImageData(0, 0, w, h);
        const data = pData.data;
        
        let color = [0, 0, 0, 0];
        if (!isEraser) {
            color = paintColor.value === 'blue' ? [0, 0, 255, 150] : [255, 0, 0, 150];
        }

        const maskPtr = fillMask.data;
        const maskStride = w + 2;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const maskIdx = (y + 1) * maskStride + (x + 1);
                if (maskPtr[maskIdx] !== 0) { 
                    const idx = (y * w + x) * 4;
                    if (isEraser) {
                        data[idx + 3] = 0;
                    } else {
                        data[idx] = color[0]!;
                        data[idx+1] = color[1]!;
                        data[idx+2] = color[2]!;
                        data[idx+3] = color[3]!;
                    }
                }
            }
        }
        pCtx.putImageData(pData, 0, 0);
        srcMat.delete(); fillMask.delete();
    };

    return {
        paintBuffer,
        paintMode,
        paintColor,
        brushSize,
        sourceImage,
        imageSize,
        imgTransform,
        isDraggingImage,
        lastMousePos,
        canvasDims,
        initPaintBuffer,
        updateCanvasDimensions,
        toImageSpace,
        performFloodFill
    };
}