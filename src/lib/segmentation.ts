/**
 * YOLOv8 Instance Segmentation
 */
import * as ort from 'onnxruntime-web';
import type { Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';

const YOLO_LABELS = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
  "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
  "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
  "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
  "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
  "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
  "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
  "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
  "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"
];

const MODEL_INPUT_SHAPE = [1, 3, 640, 640];
const TOPK = 100;
const IOU_THRESHOLD = 0.45;
const SCORE_THRESHOLD = 0.25;
const NUM_CLASS = YOLO_LABELS.length;

let yoloSession: ort.InferenceSession | null = null;
let nmsSession: ort.InferenceSession | null = null;
let maskSession: ort.InferenceSession | null = null;
let isOpenCVReady = false;

function waitForOpenCV(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv.Mat) {
      isOpenCVReady = true;
      resolve();
      return;
    }

    const checkInterval = setInterval(() => {
      if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv.Mat) {
        isOpenCVReady = true;
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
  });
}

async function initializeYOLO() {
  if (yoloSession && nmsSession && maskSession) {
    return { yoloSession, nmsSession, maskSession };
  }

  try {
    await waitForOpenCV();

    const [yolo, nms, mask] = await Promise.all([
      ort.InferenceSession.create('/model/yolov8n-seg.onnx'),
      ort.InferenceSession.create('/model/nms-yolov8.onnx'),
      ort.InferenceSession.create('/model/mask-yolov8-seg.onnx'),
    ]);

    const tensor = new ort.Tensor('float32', new Float32Array(640 * 640 * 3), MODEL_INPUT_SHAPE);
    await yolo.run({ images: tensor });

    yoloSession = yolo;
    nmsSession = nms;
    maskSession = mask;

    console.log('YOLOv8 models loaded');
    return { yoloSession, nmsSession, maskSession };
  } catch (error) {
    console.error('Failed to load YOLOv8 models:', error);
    throw error;
  }
}

function preprocessing(
  imageElement: HTMLImageElement,
  modelWidth: number,
  modelHeight: number,
  stride: number = 32
): { input: any; xRatio: number; yRatio: number } {
  const cv = (window as any).cv;

  const mat = cv.imread(imageElement);
  const matC3 = new cv.Mat(mat.rows, mat.cols, cv.CV_8UC3);
  cv.cvtColor(mat, matC3, cv.COLOR_RGBA2BGR);

  const [w, h] = divStride(stride, matC3.cols, matC3.rows);
  cv.resize(matC3, matC3, new cv.Size(w, h));

  const maxSize = Math.max(matC3.rows, matC3.cols);
  const xPad = maxSize - matC3.cols;
  const xRatio = maxSize / matC3.cols;
  const yPad = maxSize - matC3.rows;
  const yRatio = maxSize / matC3.rows;

  const matPad = new cv.Mat();
  cv.copyMakeBorder(matC3, matPad, 0, yPad, 0, xPad, cv.BORDER_CONSTANT);

  const input = cv.blobFromImage(
    matPad,
    1 / 255.0,
    new cv.Size(modelWidth, modelHeight),
    new cv.Scalar(0, 0, 0),
    true,
    false
  );

  mat.delete();
  matC3.delete();
  matPad.delete();

  return { input, xRatio, yRatio };
}

function divStride(stride: number, width: number, height: number): [number, number] {
  const fit = (val: number) =>
    val % stride >= stride / 2
      ? (Math.floor(val / stride) + 1) * stride
      : Math.floor(val / stride) * stride;
  return [fit(width), fit(height)];
}

function overflowBoxes(box: number[], maxSize: number): number[] {
  box[0] = Math.max(0, box[0]);
  box[1] = Math.max(0, box[1]);
  box[2] = Math.min(maxSize - box[0], box[2]);
  box[3] = Math.min(maxSize - box[1], box[3]);
  return box;
}

function hexToRgba(hex: string, alpha: number): number[] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), alpha]
    : [0, 0, 0, alpha];
}

function enforcePixelOwnership(regions: Region[]) {
  if (regions.length <= 1) return regions;

  const width = regions[0].maskWidth;
  const height = regions[0].maskHeight;
  const size = width * height;

  for (let i = 0; i < size; i++) {
    let bestRegion = -1;
    let bestValue = 0;

    for (let r = 0; r < regions.length; r++) {
      const v = regions[r].maskData[i];
      if (v > bestValue) {
        bestValue = v;
        bestRegion = r;
      }
    }

    for (let r = 0; r < regions.length; r++) {
      if (r !== bestRegion) {
        regions[r].maskData[i] = 0;
      }
    }
  }

}

function unionPersonMasks(personRegions: Region[]): Uint8Array {
  const size = personRegions[0].maskWidth * personRegions[0].maskHeight;
  const out = new Uint8Array(size);

  for (const region of personRegions) {
    for (let i = 0; i < size; i++) {
      if (region.maskData[i] > 0) {
        out[i] = 255;
      }
    }
  }

  return out;
}

function erodeMask(
  maskData: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  const cv = (window as any).cv;

  const src = cv.matFromArray(height, width, cv.CV_8UC1, maskData);
  const dst = new cv.Mat();

  const kernelSize = radius * 2 + 1;
  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE,
    new cv.Size(kernelSize, kernelSize)
  );

  cv.erode(src, dst, kernel);

  const out = new Uint8Array(dst.data);

  src.delete();
  dst.delete();
  kernel.delete();

  return out;
}


export async function segmentImage(
  imageElement: HTMLImageElement,
  canvas: HTMLCanvasElement
): Promise<Region[]> {
  try {
    const { yoloSession, nmsSession, maskSession } = await initializeYOLO();
    const cv = (window as any).cv;

    const [modelWidth, modelHeight] = MODEL_INPUT_SHAPE.slice(2);
    const maxSize = Math.max(modelWidth, modelHeight);

    const { input, xRatio, yRatio } = preprocessing(imageElement, modelWidth, modelHeight);

    const tensor = new ort.Tensor('float32', input.data32F, MODEL_INPUT_SHAPE);
    const config = new ort.Tensor(
      'float32',
      new Float32Array([NUM_CLASS, TOPK, IOU_THRESHOLD, SCORE_THRESHOLD])
    );

    const { output0, output1 } = await yoloSession.run({ images: tensor });
    const { selected } = await nmsSession.run({ detection: output0, config: config });

    const regions: Region[] = [];

    const scale = Math.min(canvas.width / imageElement.width, canvas.height / imageElement.height);
    const scaledWidth = Math.floor(imageElement.width * scale);
    const scaledHeight = Math.floor(imageElement.height * scale);

    for (let idx = 0; idx < selected.dims[1]; idx++) {
      const data = selected.data.slice(idx * selected.dims[2], (idx + 1) * selected.dims[2]) as any;

      let box = [data[0], data[1], data[2], data[3]] as number[];
      const scores = data.slice(4, 4 + NUM_CLASS);
      const score = Math.max(...scores);
      const labelIdx = scores.indexOf(score);
      const label = YOLO_LABELS[labelIdx];

      if (label !== 'person') continue;

      const color = '#FF5050';

      box = overflowBoxes(
        [box[0] - 0.5 * box[2], box[1] - 0.5 * box[3], box[2], box[3]],
        maxSize
      );
      const [x, y, w, h] = overflowBoxes(
        [
          Math.floor(box[0] * xRatio),
          Math.floor(box[1] * yRatio),
          Math.floor(box[2] * xRatio),
          Math.floor(box[3] * yRatio),
        ],
        maxSize
      );

      const maskInput = new ort.Tensor(
        'float32',
        new Float32Array([...box, ...data.slice(4 + NUM_CLASS)])
      );
      const maskConfig = new ort.Tensor(
        'float32',
        new Float32Array([maxSize, x, y, w, h, ...hexToRgba(color, 255)])
      );

      const { mask_filter } = await maskSession.run({
        detection: maskInput,
        mask: output1,
        config: maskConfig,
      });

      const mH = mask_filter.dims[0];
      const mW = mask_filter.dims[1];
      const rawMask = new Uint8Array(mH * mW);

      for (let i = 0; i < mH * mW; i++) {
        const alphaValue = mask_filter.data[i * 4 + 3];
        rawMask[i] = Math.min(255, Math.max(0, Number(alphaValue) || 0));
      }

      const srcMat = cv.matFromArray(mH, mW, cv.CV_8UC1, rawMask);
      const dstMat = new cv.Mat();
      cv.resize(srcMat, dstMat, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_LINEAR);
      
      const scaledMask = new Uint8Array(dstMat.data);
      for (let i = 0; i < scaledMask.length; i++) {
        scaledMask[i] = scaledMask[i] > 96 ? 255 : 0;
      }

      srcMat.delete();
      dstMat.delete();


regions.push({
  id: `person-${idx}-${Date.now()}`,
  type: 'person',
  label: `Person ${regions.filter(r => r.type === 'person').length + 1}`,
  originalMaskData: new Uint8Array(scaledMask),
  maskData: scaledMask,          // OUTER mask
  maskWidth: scaledWidth,
  maskHeight: scaledHeight,
  color: REGION_COLORS.person,
  visible: true,
  selected: false,
  hovered: false,
});
    }

const personRegions = regions.filter(r => r.type === 'person');
enforcePixelOwnership(personRegions);

for (const region of personRegions) {
  region.innerMaskData = erodeMask(
    region.maskData,      // IMPORTANT: FINAL mask
    region.maskWidth,
    region.maskHeight,
    12                    // same radius as before
  );
}


// Write back explicitly to avoid relying on mutation side-effects
for (let i = 0; i < regions.length; i++) {
  if (regions[i].type === 'person') {
    const updated = personRegions.find(p => p.id === regions[i].id);
    if (updated) regions[i] = updated;
  }
}

let peopleGroupRegion: Region | null = null;

if (personRegions.length > 0) {
  peopleGroupRegion = {
    id: `people-group-${Date.now()}`,
    type: 'people-group',
    label: 'All People',
    maskData: unionPersonMasks(personRegions),
    originalMaskData: unionPersonMasks(personRegions), 
    maskWidth: personRegions[0].maskWidth,
    maskHeight: personRegions[0].maskHeight,
    color: REGION_COLORS['people-group'],
    visible: true,
    selected: false,
    hovered: false,
  };
}


    input.delete();


    // Create background mask
    if (personRegions.length > 0) {
      const bgMask = new Uint8Array(scaledWidth * scaledHeight);
      bgMask.fill(255);

      personRegions.forEach((region) => {
        const { maskData } = region;
        for (let i = 0; i < maskData.length; i++) {
          if (maskData[i] > 128) {
            bgMask[i] = 0;
          }
        }
      });

      regions.push({
        id: `background-${Date.now()}`,
        type: 'background',
        label: 'Background',
        maskData: bgMask,
        originalMaskData: new Uint8Array(bgMask),
        maskWidth: scaledWidth,
        maskHeight: scaledHeight,
        color: REGION_COLORS.background,
        visible: true,
        selected: false,
        hovered: false,
      });
    }

const orderedRegions: Region[] = [];

if (peopleGroupRegion) orderedRegions.push(peopleGroupRegion);

orderedRegions.push(...personRegions);

const backgroundRegion = regions.find(r => r.type === 'background');
if (backgroundRegion) orderedRegions.push(backgroundRegion);

console.log(
  'Created regions:',
  orderedRegions.map(r => `${r.type}:${r.id}`)
);

return orderedRegions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

export function isSegmenterReady(): boolean {
  return yoloSession !== null && nmsSession !== null && maskSession !== null && isOpenCVReady;
}