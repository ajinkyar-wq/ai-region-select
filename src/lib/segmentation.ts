/**
 * YOLOv8 Instance Segmentation with Face Filtering
 * Only returns person segments where a face is detected overlapping the person bbox.
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
const IOU_THRESHOLD = 0.80;
const SCORE_THRESHOLD = 0.01;
const NUM_CLASS = YOLO_LABELS.length;

const FACE_CONF_THRESHOLD = 0.1;
const FACE_NMS_IOU_THRESHOLD = 0.1;

let yoloSession: ort.InferenceSession | null = null;
let nmsSession: ort.InferenceSession | null = null;
let maskSession: ort.InferenceSession | null = null;
let faceSession: ort.InferenceSession | null = null;
let isOpenCVReady = false;

// ─── Types ────────────────────────────────────────────────────────────────────

// All BBoxes are in MODEL space (0..640 range, after letterbox padding).
// This is the coordinate system the seg model and face model both use natively.
type BBox = { x1: number; y1: number; x2: number; y2: number };

// ─── OpenCV ───────────────────────────────────────────────────────────────────

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

// ─── Model Init ───────────────────────────────────────────────────────────────

async function initializeYOLO() {
  if (yoloSession && nmsSession && maskSession && faceSession) {
    return { yoloSession, nmsSession, maskSession, faceSession };
  }

  try {
    await waitForOpenCV();

    const sessionOptions = {
      executionProviders: ['webgpu', 'webgl', 'wasm']
    };


    const [yolo, nms, mask, face] = await Promise.all([
      ort.InferenceSession.create('/model/yolov8s-seg.onnx', sessionOptions),
      ort.InferenceSession.create('/model/nms-yolov8.onnx', sessionOptions),
      ort.InferenceSession.create('/model/mask-yolov8-seg.onnx', sessionOptions),
      ort.InferenceSession.create('/model/yolov8n-face-lindevs.onnx', sessionOptions),
    ]);


    const warmup = new ort.Tensor('float32', new Float32Array(640 * 640 * 3), MODEL_INPUT_SHAPE);
    await yolo.run({ images: warmup });

    yoloSession = yolo;
    nmsSession = nms;
    maskSession = mask;
    faceSession = face;

    console.log('YOLOv8 seg + face models loaded');
    console.log('Face model input names:', face.inputNames);
    console.log('Face model output names:', face.outputNames);

    return { yoloSession, nmsSession, maskSession, faceSession };
  } catch (error) {
    console.error('Failed to load YOLOv8 models:', error);
    throw error;
  }
}

// ─── Preprocessing ────────────────────────────────────────────────────────────

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

// ─── Face Detection ───────────────────────────────────────────────────────────

function iou(a: BBox, b: BBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const interW = Math.max(0, ix2 - ix1);
  const interH = Math.max(0, iy2 - iy1);
  const interArea = interW * interH;
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  return interArea / (aArea + bArea - interArea + 1e-6);
}

function nmsBoxes(detections: { bbox: BBox; conf: number }[], iouThresh: number): BBox[] {
  detections.sort((a, b) => b.conf - a.conf);
  const kept: BBox[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < detections.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(detections[i].bbox);
    for (let j = i + 1; j < detections.length; j++) {
      if (!suppressed.has(j) && iou(detections[i].bbox, detections[j].bbox) > iouThresh) {
        suppressed.add(j);
      }
    }
  }
  return kept;
}

/**
 * Returns face bboxes in MODEL space (0..640).
 * The face model outputs cx,cy,w,h already in 640x640 space — we just
 * convert center→corner format. No ratio scaling needed.
 */
async function detectFaces(imageElement: HTMLImageElement): Promise<BBox[]> {
  if (!faceSession) return [];

  const { input } = preprocessing(imageElement, 640, 640);
  const tensor = new ort.Tensor('float32', input.data32F, MODEL_INPUT_SHAPE);

  const outputMap = await faceSession.run({ images: tensor });
  input.delete();

  const outKey = Object.keys(outputMap)[0];
  const out = outputMap[outKey];
  const data = out.data as Float32Array;
  const dims = out.dims;

  console.log('Face output key:', outKey, 'dims:', JSON.stringify(dims));

  // Layout detection: [1, 20, 8400] transposed vs [1, 8400, 20] normal
  let numAnchors: number;
  let numFeatures: number;
  let isTransposed: boolean;

  if (dims.length === 3) {
    if (dims[1] < dims[2]) {
      isTransposed = true;
      numFeatures = dims[1];
      numAnchors = dims[2];
    } else {
      isTransposed = false;
      numAnchors = dims[1];
      numFeatures = dims[2];
    }
  } else {
    isTransposed = false;
    numAnchors = dims[0];
    numFeatures = dims[1] ?? 20;
  }

  const get = (i: number, f: number): number =>
    isTransposed ? data[f * numAnchors + i] : data[i * numFeatures + f];

  const detections: { bbox: BBox; conf: number }[] = [];

  for (let i = 0; i < numAnchors; i++) {
    const conf = get(i, 4);
    if (conf < FACE_CONF_THRESHOLD) continue;

    const cx = get(i, 0);
    const cy = get(i, 1);
    const w = get(i, 2);
    const h = get(i, 3);

    // Coords are already in 640x640 model space — just convert center→corner
    detections.push({
      bbox: { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
      conf,
    });
  }

  console.log(`Face detections before NMS: ${detections.length}`);
  const faces = nmsBoxes(detections, FACE_NMS_IOU_THRESHOLD);
  console.log(`Face detections after NMS: ${faces.length}`);
  faces.forEach((f, i) => console.log(`  Face ${i}: x1=${f.x1.toFixed(1)} y1=${f.y1.toFixed(1)} x2=${f.x2.toFixed(1)} y2=${f.y2.toFixed(1)}`));

  return faces;
}

// ─── Face ↔ Person Overlap ────────────────────────────────────────────────────

/**
 * Both personBox and faces are in MODEL space (0..640).
 * personBox here is the RAW box before xRatio scaling — i.e. [x, y, w, h]
 * from the seg model output which is also in model/maxSize space.
 */
function personHasFace(personBox: BBox, faces: BBox[]): boolean {
  for (const face of faces) {
    const ix1 = Math.max(personBox.x1, face.x1);
    const iy1 = Math.max(personBox.y1, face.y1);
    const ix2 = Math.min(personBox.x2, face.x2);
    const iy2 = Math.min(personBox.y2, face.y2);
    if (ix2 > ix1 && iy2 > iy1) return true;
  }
  return false;
}

// ─── Mask Utilities ───────────────────────────────────────────────────────────

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
  if (regions.length <= 1) return;
  const size = regions[0].maskWidth * regions[0].maskHeight;
  for (let i = 0; i < size; i++) {
    let bestRegion = -1;
    let bestValue = 0;
    for (let r = 0; r < regions.length; r++) {
      if (regions[r].maskData[i] > bestValue) {
        bestValue = regions[r].maskData[i];
        bestRegion = r;
      }
    }
    for (let r = 0; r < regions.length; r++) {
      if (r !== bestRegion) regions[r].maskData[i] = 0;
    }
  }
}

function unionPersonMasks(personRegions: Region[]): Uint8Array {
  const size = personRegions[0].maskWidth * personRegions[0].maskHeight;
  const out = new Uint8Array(size);
  for (const region of personRegions) {
    for (let i = 0; i < size; i++) {
      if (region.maskData[i] > out[i]) out[i] = region.maskData[i];
    }
  }
  return out;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

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

    const scale = Math.min(canvas.width / imageElement.width, canvas.height / imageElement.height);
    const scaledWidth = Math.floor(imageElement.width * scale);
    const scaledHeight = Math.floor(imageElement.height * scale);

    const allPersonRegions: Region[] = [];
    // Store person bboxes in MODEL space (rawBox coords) for face comparison
    const allPersonBoxesModelSpace: BBox[] = [];

    for (let idx = 0; idx < selected.dims[1]; idx++) {
      const data = selected.data.slice(idx * selected.dims[2], (idx + 1) * selected.dims[2]) as any;

      let box = [data[0], data[1], data[2], data[3]] as number[];
      const scores = data.slice(4, 4 + NUM_CLASS);
      const score = Math.max(...scores);
      const labelIdx = scores.indexOf(score);
      const label = YOLO_LABELS[labelIdx];

      if (label !== 'person') continue;

      // rawBox is in MODEL space (0..maxSize ~= 0..640)
      // This is the SAME space the face model outputs coords in
      const rawBox = overflowBoxes(
        [box[0] - 0.5 * box[2], box[1] - 0.5 * box[3], box[2], box[3]],
        maxSize
      );

      // Store model-space bbox for face overlap check
      const personBBoxModelSpace: BBox = {
        x1: rawBox[0],
        y1: rawBox[1],
        x2: rawBox[0] + rawBox[2],
        y2: rawBox[1] + rawBox[3],
      };

      // Scaled box for mask processing (image pixel space)
      const [x, y, w, h] = overflowBoxes(
        [
          Math.floor(rawBox[0] * xRatio),
          Math.floor(rawBox[1] * yRatio),
          Math.floor(rawBox[2] * xRatio),
          Math.floor(rawBox[3] * yRatio),
        ],
        maxSize
      );

      console.log(`Person ${idx} model-space bbox: x1=${personBBoxModelSpace.x1.toFixed(1)} y1=${personBBoxModelSpace.y1.toFixed(1)} x2=${personBBoxModelSpace.x2.toFixed(1)} y2=${personBBoxModelSpace.y2.toFixed(1)}`);

      const maskInput = new ort.Tensor(
        'float32',
        new Float32Array([...rawBox, ...data.slice(4 + NUM_CLASS)])
      );
      const maskConfig = new ort.Tensor(
        'float32',
        new Float32Array([maxSize, x, y, w, h, ...hexToRgba('#FF5050', 255)])
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
        rawMask[i] = Math.min(255, Math.max(0, Number(mask_filter.data[i * 4 + 3]) || 0));
      }

      const srcMat = cv.matFromArray(mH, mW, cv.CV_8UC1, rawMask);
      const dstMat = new cv.Mat();
      cv.resize(srcMat, dstMat, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_LINEAR);
      const blurMat = new cv.Mat();
      cv.GaussianBlur(dstMat, blurMat, new cv.Size(5, 5), 1.5, 1.5, cv.BORDER_DEFAULT);

      // Morphological closing: bridges gaps between disconnected body parts
      // (e.g. upper body and leg separated by a drum kit).
      // Kernel size controls how large a gap gets bridged — 60px covers
      // typical occlusion gaps at display resolution without bleeding too far.
      const closedMat = new cv.Mat();
      const kernel = cv.getStructuringElement(
        cv.MORPH_ELLIPSE,
        new cv.Size(60, 60)
      );
      cv.morphologyEx(blurMat, closedMat, cv.MORPH_CLOSE, kernel);
      kernel.delete();

      // Re-apply blur after closing to smooth the newly filled edges
      const finalMat = new cv.Mat();
      cv.GaussianBlur(closedMat, finalMat, new cv.Size(5, 5), 1.5, 1.5, cv.BORDER_DEFAULT);

      const scaledMask = new Uint8Array(finalMat.data);
      srcMat.delete();
      dstMat.delete();
      blurMat.delete();
      closedMat.delete();
      finalMat.delete();

      allPersonRegions.push({
        id: `person-${idx}-${Date.now()}`,
        type: 'person',
        label: `Person ${allPersonRegions.length + 1}`,
        originalMaskData: new Uint8Array(scaledMask),
        maskData: scaledMask,
        maskWidth: scaledWidth,
        maskHeight: scaledHeight,
        color: REGION_COLORS.person,
        visible: true,
        selected: false,
        hovered: false,
      });

      allPersonBoxesModelSpace.push(personBBoxModelSpace);
    }

    input.delete();

    const faces = await detectFaces(imageElement);
    console.log('Detected faces:', faces.length);

    // Filter: keep only persons where a face overlaps in MODEL space
    const personRegions: Region[] = [];
    for (let i = 0; i < allPersonRegions.length; i++) {
      const hasFace = personHasFace(allPersonBoxesModelSpace[i], faces);
      console.log(`Person ${i} model bbox:`, JSON.stringify(allPersonBoxesModelSpace[i]), hasFace ? 'KEPT' : 'DROPPED');
      if (hasFace) personRegions.push(allPersonRegions[i]);
    }

    console.log(`Kept ${personRegions.length} / ${allPersonRegions.length} persons`);

    personRegions.forEach((r, i) => { r.label = `Person ${i + 1}`; });
    enforcePixelOwnership(personRegions);

    let peopleGroupRegion: Region | null = null;
    if (personRegions.length > 1) {
      const unionMask = unionPersonMasks(personRegions);
      peopleGroupRegion = {
        id: `people-group-${Date.now()}`,
        type: 'people-group',
        label: 'All People',
        maskData: unionMask,
        originalMaskData: new Uint8Array(unionMask),
        maskWidth: personRegions[0].maskWidth,
        maskHeight: personRegions[0].maskHeight,
        color: REGION_COLORS['people-group'],
        visible: true,
        selected: false,
        hovered: false,
      };
    }

    const orderedRegions: Region[] = [];
    if (peopleGroupRegion) orderedRegions.push(peopleGroupRegion);
    orderedRegions.push(...personRegions);

    if (personRegions.length > 0) {
      const bgMask = new Uint8Array(scaledWidth * scaledHeight);
      for (let i = 0; i < bgMask.length; i++) {
        let maxAlpha = 0;
        for (const r of personRegions) {
          if (r.maskData[i] > maxAlpha) maxAlpha = r.maskData[i];
        }
        bgMask[i] = 255 - maxAlpha;
      }
      orderedRegions.push({
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

    console.log('Final regions:', orderedRegions.map(r => `${r.type}:${r.id}`));
    return orderedRegions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

export function isSegmenterReady(): boolean {
  return yoloSession !== null && nmsSession !== null && maskSession !== null
    && faceSession !== null && isOpenCVReady;
}