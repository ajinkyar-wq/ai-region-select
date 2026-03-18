/**
 * Segmentation Pipeline
 * Stage 1: Face detection (working YOLO base) → if faces found → SAM masks per person
 * Stage 2: U2Net fallback (only if no faces found) → subject mask
 * Stage 3: SegFormer → environment regions (always runs)
 */
import * as ort from 'onnxruntime-web';
import type { Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';

// ─── Constants ────────────────────────────────────────────────────────────────

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

const FACE_CONF_THRESHOLD = 0.65;
const FACE_NMS_IOU_THRESHOLD = 0.15;

const SAM_SIZE = 1024;
const U2NET_SIZE = 320;
const SEGFORMER_SIZE = 1024;

const U2NET_MEAN = [0.485, 0.456, 0.406];
const U2NET_STD  = [0.229, 0.224, 0.225];
const SEGFORMER_MEAN = [0.485, 0.456, 0.406];
const SEGFORMER_STD  = [0.229, 0.224, 0.225];

const ENVIRONMENT_CLASSES: Record<number, string> = {
  10: 'sky',
  0: 'ground', 1: 'ground', 9: 'ground',
  8: 'vegetation',
  2: 'architecture', 3: 'architecture', 4: 'architecture',
};
// ─── Types ────────────────────────────────────────────────────────────────────

// All BBoxes are in MODEL space (0..640 after letterbox padding).
type BBox = { x1: number; y1: number; x2: number; y2: number };

// ─── Sessions ─────────────────────────────────────────────────────────────────

let yoloSession: ort.InferenceSession | null = null;
let nmsSession: ort.InferenceSession | null = null;
let maskSession: ort.InferenceSession | null = null;
let faceSession: ort.InferenceSession | null = null;
let samEncoderSession: ort.InferenceSession | null = null;
let samDecoderSession: ort.InferenceSession | null = null;
let u2netSession: ort.InferenceSession | null = null;
let segformerSession: ort.InferenceSession | null = null;
let isOpenCVReady = false;

// ─── OpenCV ───────────────────────────────────────────────────────────────────

function waitForOpenCV(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv.Mat) {
      isOpenCVReady = true; resolve(); return;
    }
    const checkInterval = setInterval(() => {
      if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv.Mat) {
        isOpenCVReady = true; clearInterval(checkInterval); resolve();
      }
    }, 100);
  });
}

// ─── Model Init ───────────────────────────────────────────────────────────────

async function initSessions() {
  if (yoloSession && nmsSession && maskSession && faceSession &&
      samEncoderSession && samDecoderSession && u2netSession && segformerSession) return;

  await waitForOpenCV();

  const sessionOptions = { executionProviders: ['webgpu', 'webgl', 'wasm'] };

  // Load all models except U2Net together, then U2Net separately.
  // U2Net needs wasm-only (ceil_mode MaxPool), and having two different EP configs
  // in a single Promise.all causes 'multiple calls to initWasm()'.
const [yolo, nms, face, enc, dec, seg] = await Promise.all([
    ort.InferenceSession.create('/model/yolov8s-seg.onnx', sessionOptions),
    ort.InferenceSession.create('/model/nms-yolov8.onnx', sessionOptions),
    ort.InferenceSession.create('/model/yolov8n-face-lindevs.onnx', sessionOptions),
    ort.InferenceSession.create('/model/mobile_sam_encoder.onnx', sessionOptions),
    ort.InferenceSession.create('/model/mobile_sam_decoder.onnx', sessionOptions),
    ort.InferenceSession.create('/model/segformer-cityscapes.onnx', sessionOptions),
  ]);
  const u2 = await ort.InferenceSession.create('/model/u2net.quant.onnx', { executionProviders: ['wasm'] });

  const warmup = new ort.Tensor('float32', new Float32Array(640 * 640 * 3), MODEL_INPUT_SHAPE);
  await yolo.run({ images: warmup });

yoloSession = yolo; nmsSession = nms; faceSession = face;
  samEncoderSession = enc; samDecoderSession = dec;
  u2netSession = u2; segformerSession = seg;

  console.log('All segmentation models loaded');
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
  const xRatio = maxSize / matC3.cols;
  const yRatio = maxSize / matC3.rows;
  const matPad = new cv.Mat();
  cv.copyMakeBorder(matC3, matPad, 0, maxSize - matC3.rows, 0, maxSize - matC3.cols, cv.BORDER_CONSTANT);
  const input = cv.blobFromImage(matPad, 1 / 255.0, new cv.Size(modelWidth, modelHeight), new cv.Scalar(0, 0, 0), true, false);
  mat.delete(); matC3.delete(); matPad.delete();
  return { input, xRatio, yRatio };
}

function divStride(stride: number, width: number, height: number): [number, number] {
  const fit = (val: number) =>
    val % stride >= stride / 2
      ? (Math.floor(val / stride) + 1) * stride
      : Math.floor(val / stride) * stride;
  return [fit(width), fit(height)];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }

function iou(a: BBox, b: BBox): number {
  const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
  const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (aArea + bArea - inter + 1e-6);
}

function nmsBoxes(detections: { bbox: BBox; conf: number }[], iouThresh: number): BBox[] {
  detections.sort((a, b) => b.conf - a.conf);
  const kept: BBox[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < detections.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(detections[i].bbox);
    for (let j = i + 1; j < detections.length; j++) {
      if (!suppressed.has(j) && iou(detections[i].bbox, detections[j].bbox) > iouThresh)
        suppressed.add(j);
    }
  }
  return kept;
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

function unionPersonMasks(personRegions: Region[]): Uint8Array {
  const size = personRegions[0].maskWidth * personRegions[0].maskHeight;
  const out = new Uint8Array(size);
  for (const region of personRegions)
    for (let i = 0; i < size; i++)
      if (region.maskData[i] > out[i]) out[i] = region.maskData[i];
  return out;
}

// ─── Face Detection ───────────────────────────────────────────────────────────
// Returns face bboxes in MODEL space (0..640).

async function detectFaces(imageElement: HTMLImageElement): Promise<BBox[]> {
  if (!faceSession) return [];
  const { input } = preprocessing(imageElement, 640, 640);
  const tensor = new ort.Tensor('float32', input.data32F, MODEL_INPUT_SHAPE);
  const outputMap = await faceSession.run({ images: tensor });
  input.delete();

  const out = outputMap[Object.keys(outputMap)[0]];
  const data = out.data as Float32Array;
  const dims = out.dims;

  let numAnchors: number, numFeatures: number, isTransposed: boolean;
  if (dims.length === 3) {
    if (dims[1] < dims[2]) { isTransposed = true;  numFeatures = dims[1]; numAnchors = dims[2]; }
    else                   { isTransposed = false; numAnchors  = dims[1]; numFeatures = dims[2]; }
  } else { isTransposed = false; numAnchors = dims[0]; numFeatures = dims[1] ?? 20; }

  const get = (i: number, f: number) => isTransposed ? data[f * numAnchors + i] : data[i * numFeatures + f];

  const detections: { bbox: BBox; conf: number }[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const conf = get(i, 4);
    if (conf < FACE_CONF_THRESHOLD) continue;
    const cx = get(i, 0), cy = get(i, 1), w = get(i, 2), h = get(i, 3);
    detections.push({ bbox: { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 }, conf });
  }

  const faces = nmsBoxes(detections, FACE_NMS_IOU_THRESHOLD);
  console.log(`Face detections: ${faces.length}`);
  return faces;
}

// ─── Face ↔ Person Overlap ────────────────────────────────────────────────────

function personHasFace(personBox: BBox, faces: BBox[]): boolean {
  for (const face of faces) {
    const ix1 = Math.max(personBox.x1, face.x1), iy1 = Math.max(personBox.y1, face.y1);
    const ix2 = Math.min(personBox.x2, face.x2), iy2 = Math.min(personBox.y2, face.y2);
    if (ix2 > ix1 && iy2 > iy1) return true;
  }
  return false;
}

// ─── YOLO: person bboxes in model space ───────────────────────────────────────

async function detectPersonBoxes(imageElement: HTMLImageElement): Promise<BBox[]> {
  if (!yoloSession || !nmsSession) return [];

  const { input } = preprocessing(imageElement, 640, 640);
  const tensor = new ort.Tensor('float32', input.data32F, MODEL_INPUT_SHAPE);
  const config = new ort.Tensor('float32', new Float32Array([NUM_CLASS, TOPK, IOU_THRESHOLD, SCORE_THRESHOLD]));
  const { output0 } = await yoloSession.run({ images: tensor });
  const { selected } = await nmsSession.run({ detection: output0, config });
  input.delete();

  const maxSize = Math.max(...MODEL_INPUT_SHAPE.slice(2));
  const boxes: BBox[] = [];

  for (let idx = 0; idx < selected.dims[1]; idx++) {
    const d = selected.data.slice(idx * selected.dims[2], (idx + 1) * selected.dims[2]) as any;
    const scores = d.slice(4, 4 + NUM_CLASS);
    const score = Math.max(...scores);
    const label = YOLO_LABELS[scores.indexOf(score)];
    if (label !== 'person') continue;

    const rawBox = overflowBoxes([d[0] - 0.5 * d[2], d[1] - 0.5 * d[3], d[2], d[3]], maxSize);
    boxes.push({ x1: rawBox[0], y1: rawBox[1], x2: rawBox[0] + rawBox[2], y2: rawBox[1] + rawBox[3] });
  }

  console.log(`YOLO person boxes: ${boxes.length}`);
  return boxes;
}

// ─── SAM helpers ──────────────────────────────────────────────────────────────
// SAM uses ResizeLongestSide(1024): scale so the longest edge == 1024,
// preserve aspect ratio, then pad the short side to 1024×1024.
// point_coords fed to the decoder must be in this same resized+padded space.

function samResizeLongestSide(imgW: number, imgH: number): { newW: number; newH: number; scale: number } {
  const scale = SAM_SIZE / Math.max(imgW, imgH);
  return {
    newW: Math.round(imgW * scale),
    newH: Math.round(imgH * scale),
    scale,
  };
}

// apply_coords: scale image-pixel coords → SAM resized space (uniform scale, same for x & y)
function samApplyCoords(x: number, y: number, imgW: number, imgH: number): [number, number] {
  const { scale } = samResizeLongestSide(imgW, imgH);
  return [x * scale, y * scale];
}

// ─── SAM Encoder ──────────────────────────────────────────────────────────────
// Resize longest-side → 1024, pad short side to 1024×1024, normalize.

async function runSAMEncoder(imageElement: HTMLImageElement): Promise<ort.Tensor> {
  const imgW = imageElement.naturalWidth;
  const imgH = imageElement.naturalHeight;
  const { newW, newH } = samResizeLongestSide(imgW, imgH);

  // Draw resized image (aspect-ratio preserved) into top-left of 1024×1024 canvas
  const oc = new OffscreenCanvas(SAM_SIZE, SAM_SIZE);
  const ctx = oc.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, SAM_SIZE, SAM_SIZE);
  ctx.drawImage(imageElement, 0, 0, newW, newH);

  const { data } = ctx.getImageData(0, 0, SAM_SIZE, SAM_SIZE);
  const SAM_MEAN = [123.675, 116.28, 103.53];
  const SAM_STD  = [58.395,  57.12,  57.375];
  const t = new Float32Array(3 * SAM_SIZE * SAM_SIZE);
  for (let i = 0; i < SAM_SIZE * SAM_SIZE; i++) {
    t[i]                           = (data[i * 4]     - SAM_MEAN[0]) / SAM_STD[0];
    t[i + SAM_SIZE * SAM_SIZE]     = (data[i * 4 + 1] - SAM_MEAN[1]) / SAM_STD[1];
    t[i + 2 * SAM_SIZE * SAM_SIZE] = (data[i * 4 + 2] - SAM_MEAN[2]) / SAM_STD[2];
  }
  const tensor = new ort.Tensor('float32', t, [1, 3, SAM_SIZE, SAM_SIZE]);
  const res = await samEncoderSession!.run({ [samEncoderSession!.inputNames[0]]: tensor });
  return res[samEncoderSession!.outputNames[0]];
}

// ─── SAM Decoder ──────────────────────────────────────────────────────────────
// personBox is in YOLO model space (0..640, letterboxed). Steps:
//   1. Undo YOLO letterbox → original image pixel coords
//   2. apply_coords: scale by (1024 / max(imgW,imgH)) — same uniform scale SAM encoder used
//   3. orig_im_size = [imgH, imgW] (original, before any SAM transform) — SAM upsamples to this
//   4. Threshold logits at > 0.0 (not sigmoid), then downsample to canvas size

async function runSAMDecoder(
  embedding: ort.Tensor,
  personBox: BBox,
  imgW: number, imgH: number,
  scaledW: number, scaledH: number,
): Promise<Uint8Array> {
  // Step 1: undo YOLO letterbox → image pixel coords
  const [snappedW, snappedH] = divStride(32, imgW, imgH);
  const maxSize = Math.max(snappedW, snappedH);
  const x1img = (personBox.x1 / 640) * maxSize * (imgW / snappedW);
  const y1img = (personBox.y1 / 640) * maxSize * (imgH / snappedH);
  const x2img = (personBox.x2 / 640) * maxSize * (imgW / snappedW);
  const y2img = (personBox.y2 / 640) * maxSize * (imgH / snappedH);

  console.log(`SAM box (image px): (${x1img.toFixed(0)},${y1img.toFixed(0)}) → (${x2img.toFixed(0)},${y2img.toFixed(0)}) in ${imgW}x${imgH}`);

  // Step 2: apply_coords → SAM resized+padded 1024 space (uniform scale)
  const [x1s, y1s] = samApplyCoords(x1img, y1img, imgW, imgH);
  const [x2s, y2s] = samApplyCoords(x2img, y2img, imgW, imgH);

  console.log(`SAM box (SAM space): (${x1s.toFixed(1)},${y1s.toFixed(1)}) → (${x2s.toFixed(1)},${y2s.toFixed(1)})`);

  const feeds = {
    image_embeddings: embedding,
    point_coords:   new ort.Tensor('float32', new Float32Array([x1s, y1s, x2s, y2s]), [1, 2, 2]),
    point_labels:   new ort.Tensor('float32', new Float32Array([2, 3]), [1, 2]), // 2=TL, 3=BR
    mask_input:     new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    // Step 3: original image size — SAM decoder upsamples mask to this
    orig_im_size:   new ort.Tensor('float32', new Float32Array([imgH, imgW]), [2]),
  };

  const res = await samDecoderSession!.run(feeds);
  const maskTensor = res[samDecoderSession!.outputNames[0]];
  const [, , mH, mW] = maskTensor.dims;
  const mdata = maskTensor.data as Float32Array;

  // Step 4: threshold logits at > 0.0, then downsample from imgW×imgH → scaledW×scaledH
  const out = new Uint8Array(scaledW * scaledH);
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const mx = Math.min(Math.floor(x * mW / scaledW), mW - 1);
      const my = Math.min(Math.floor(y * mH / scaledH), mH - 1);
      out[y * scaledW + x] = mdata[my * mW + mx] > 0.0 ? 255 : 0;
    }
  }
  return out;
}

// ─── Stage 2: U2Net ───────────────────────────────────────────────────────────

async function runU2Net(imageElement: HTMLImageElement, scaledW: number, scaledH: number): Promise<Uint8Array> {
  const oc = new OffscreenCanvas(U2NET_SIZE, U2NET_SIZE);
  oc.getContext('2d')!.drawImage(imageElement, 0, 0, U2NET_SIZE, U2NET_SIZE);
  const { data } = oc.getContext('2d')!.getImageData(0, 0, U2NET_SIZE, U2NET_SIZE);
  const t = new Float32Array(3 * U2NET_SIZE * U2NET_SIZE);
  for (let i = 0; i < U2NET_SIZE * U2NET_SIZE; i++) {
    t[i]                           = (data[i * 4]     / 255 - U2NET_MEAN[0]) / U2NET_STD[0];
    t[i + U2NET_SIZE * U2NET_SIZE]     = (data[i * 4 + 1] / 255 - U2NET_MEAN[1]) / U2NET_STD[1];
    t[i + 2 * U2NET_SIZE * U2NET_SIZE] = (data[i * 4 + 2] / 255 - U2NET_MEAN[2]) / U2NET_STD[2];
  }
  const tensor = new ort.Tensor('float32', t, [1, 3, U2NET_SIZE, U2NET_SIZE]);
  const res = await u2netSession!.run({ [u2netSession!.inputNames[0]]: tensor });
  const raw = res[u2netSession!.outputNames[0]].data as Float32Array;
  let mn = Infinity, mx = -Infinity;
  for (const v of raw) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const range = mx - mn;
  const out = new Uint8Array(scaledW * scaledH);
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const sx = Math.min(Math.floor(x * U2NET_SIZE / scaledW), U2NET_SIZE - 1);
      const sy = Math.min(Math.floor(y * U2NET_SIZE / scaledH), U2NET_SIZE - 1);
      const v = range > 0 ? (raw[sy * U2NET_SIZE + sx] - mn) / range : sigmoid(raw[sy * U2NET_SIZE + sx]);
      out[y * scaledW + x] = v > 0.5 ? Math.round(v * 255) : 0;
    }
  }
  return out;
}

// ─── Stage 3: SegFormer ───────────────────────────────────────────────────────

async function runSegFormer(
  imageElement: HTMLImageElement,
  scaledW: number, scaledH: number,
  foregroundMask: Uint8Array,
): Promise<{ envRegions: Region[]; landscapeMask: Uint8Array }> {
  const oc = new OffscreenCanvas(SEGFORMER_SIZE, SEGFORMER_SIZE);
  oc.getContext('2d')!.drawImage(imageElement, 0, 0, SEGFORMER_SIZE, SEGFORMER_SIZE);
  const { data } = oc.getContext('2d')!.getImageData(0, 0, SEGFORMER_SIZE, SEGFORMER_SIZE);
  const t = new Float32Array(3 * SEGFORMER_SIZE * SEGFORMER_SIZE);
  for (let i = 0; i < SEGFORMER_SIZE * SEGFORMER_SIZE; i++) {
    t[i]                                   = (data[i * 4]     / 255 - SEGFORMER_MEAN[0]) / SEGFORMER_STD[0];
    t[i + SEGFORMER_SIZE * SEGFORMER_SIZE]     = (data[i * 4 + 1] / 255 - SEGFORMER_MEAN[1]) / SEGFORMER_STD[1];
    t[i + 2 * SEGFORMER_SIZE * SEGFORMER_SIZE] = (data[i * 4 + 2] / 255 - SEGFORMER_MEAN[2]) / SEGFORMER_STD[2];
  }
  const tensor = new ort.Tensor('float32', t, [1, 3, SEGFORMER_SIZE, SEGFORMER_SIZE]);
  const res = await segformerSession!.run({ pixel_values: tensor });
  const logits = res[segformerSession!.outputNames[0]];
  const [, numClasses, lH, lW] = logits.dims;
  const ldata = logits.data as Float32Array;

  const classMap = new Int32Array(lH * lW);
  for (let i = 0; i < lH * lW; i++) {
    let bestClass = 0, bestVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = ldata[c * lH * lW + i];
      if (v > bestVal) { bestVal = v; bestClass = c; }
    }
    classMap[i] = bestClass;
  }

  const classPixels: Map<number, Uint8Array> = new Map();
  const envClassIds = [...new Set(Array.from(classMap).filter(c => ENVIRONMENT_CLASSES[c]))];
  for (const cls of envClassIds) {
    const small = new OffscreenCanvas(lW, lH);
    const sCtx = small.getContext('2d')!;
    const sImg = sCtx.createImageData(lW, lH);
    for (let i = 0; i < classMap.length; i++) {
      const v = classMap[i] === cls ? 255 : 0;
      sImg.data[i * 4] = v; sImg.data[i * 4 + 1] = v;
      sImg.data[i * 4 + 2] = v; sImg.data[i * 4 + 3] = 255;
    }
    sCtx.putImageData(sImg, 0, 0);
    const big = new OffscreenCanvas(scaledW, scaledH);
    const bCtx = big.getContext('2d')!;
    bCtx.imageSmoothingEnabled = true;
    bCtx.imageSmoothingQuality = 'high';
    bCtx.drawImage(small, 0, 0, scaledW, scaledH);
    const upscaled = bCtx.getImageData(0, 0, scaledW, scaledH);
    const mask = new Uint8Array(scaledW * scaledH);
    for (let i = 0; i < scaledW * scaledH; i++) {
      if (foregroundMask[i] > 128) continue;
      mask[i] = upscaled.data[i * 4];
    }
    classPixels.set(cls, mask);
  }
  const minPixels = scaledW * scaledH * 0.005;
  const labelMasks: Map<string, Uint8Array> = new Map();
  for (const [cls, mask] of classPixels) {
    const label = ENVIRONMENT_CLASSES[cls];
    if (!labelMasks.has(label)) labelMasks.set(label, new Uint8Array(scaledW * scaledH));
    const target = labelMasks.get(label)!;
    for (let i = 0; i < mask.length; i++) if (mask[i] > target[i]) target[i] = mask[i];
  }

  const regions: Region[] = [];
  for (const [label, mask] of labelMasks) {
    if (mask.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) < minPixels) continue;
    regions.push({
      id: `bg-${label}-${Date.now()}`, type: `background-${label}` as any,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      maskData: mask, originalMaskData: new Uint8Array(mask),
      maskWidth: scaledW, maskHeight: scaledH,
      color: REGION_COLORS.background,
      visible: true, selected: false, hovered: false,
    });
  }

  const landscapeMask = new Uint8Array(scaledW * scaledH);
  for (const mask of labelMasks.values())
    for (let i = 0; i < mask.length; i++) if (mask[i] > landscapeMask[i]) landscapeMask[i] = mask[i];

  return { envRegions: regions, landscapeMask };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function segmentImage(
  imageElement: HTMLImageElement,
  canvas: HTMLCanvasElement
): Promise<Region[]> {
  try {
    await initSessions();

    const imgW = imageElement.naturalWidth;
    const imgH = imageElement.naturalHeight;
    const scale = Math.min(canvas.width / imgW, canvas.height / imgH);
    const scaledWidth  = Math.floor(imgW * scale);
    const scaledHeight = Math.floor(imgH * scale);

    // Faces first — no point running YOLO if there are no faces
    const faces = await detectFaces(imageElement);
    console.log(`Faces detected: ${faces.length}`);

    let matchedBoxes: BBox[] = [];
    if (faces.length > 0) {
      const personBoxes = await detectPersonBoxes(imageElement);
      matchedBoxes = personBoxes.filter(box => personHasFace(box, faces));
      console.log(`YOLO person boxes: ${personBoxes.length}, face-matched: ${matchedBoxes.length}`);
    }

    const regions: Region[] = [];
    let foregroundMask = new Uint8Array(scaledWidth * scaledHeight);

    if (matchedBoxes.length > 0) {
      // Stage 1: SAM — one mask per matched person box
      const embedding = await runSAMEncoder(imageElement);
      const personRegions: Region[] = [];

      for (let i = 0; i < matchedBoxes.length; i++) {
        const mask = await runSAMDecoder(embedding, matchedBoxes[i], imgW, imgH, scaledWidth, scaledHeight);
        for (let j = 0; j < mask.length; j++) if (mask[j] > foregroundMask[j]) foregroundMask[j] = mask[j];
        personRegions.push({
          id: `person-${i}-${Date.now()}`, type: 'person', label: `Person ${i + 1}`,
          maskData: mask, originalMaskData: new Uint8Array(mask),
          maskWidth: scaledWidth, maskHeight: scaledHeight,
          color: REGION_COLORS.person, visible: true, selected: false, hovered: false,
        });
      }

      if (personRegions.length > 1) {
        const unionMask = unionPersonMasks(personRegions);
        regions.push({
          id: `people-group-${Date.now()}`, type: 'people-group', label: 'All People',
          maskData: unionMask, originalMaskData: new Uint8Array(unionMask),
          maskWidth: scaledWidth, maskHeight: scaledHeight,
          color: REGION_COLORS['people-group'], visible: true, selected: false, hovered: false,
        });
      }
      regions.push(...personRegions);

    } else {
      // Stage 2: U2Net fallback — no faces found
      console.log('No people found — running U2Net...');
      const subjectMask = await runU2Net(imageElement, scaledWidth, scaledHeight);
      foregroundMask = new Uint8Array(subjectMask);
      regions.push({
        id: `subject-${Date.now()}`, type: 'subject', label: 'Subject',
        maskData: subjectMask, originalMaskData: new Uint8Array(subjectMask),
        maskWidth: scaledWidth, maskHeight: scaledHeight,
        color: REGION_COLORS.subject ?? REGION_COLORS.person,
        visible: true, selected: false, hovered: false,
      });
    }

    // Stage 3: SegFormer — always runs
    const { envRegions, landscapeMask } = await runSegFormer(imageElement, scaledWidth, scaledHeight, foregroundMask);
    regions.push(...envRegions);

    // Background — full inverse of the foreground (subject/people).
    // SegFormer landscape regions are subsets of this; background is the encompassing mask.
    const backgroundMask = new Uint8Array(scaledWidth * scaledHeight);
    for (let i = 0; i < backgroundMask.length; i++) {
      if (foregroundMask[i] <= 128) backgroundMask[i] = 255;
    }
    regions.push({
      id: `background-${Date.now()}`, type: 'background', label: 'Background',
      maskData: backgroundMask, originalMaskData: new Uint8Array(backgroundMask),
      maskWidth: scaledWidth, maskHeight: scaledHeight,
      color: REGION_COLORS.background, visible: true, selected: false, hovered: false,
    });

    console.log('Final regions:', regions.map(r => r.label));
    return regions;

  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

export function isSegmenterReady(): boolean {
  return !!(yoloSession && nmsSession && maskSession && faceSession &&
    samEncoderSession && samDecoderSession && u2netSession && segformerSession && isOpenCVReady);
}