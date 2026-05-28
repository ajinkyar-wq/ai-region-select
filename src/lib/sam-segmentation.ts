/**
 * MobileSAM (Segment Anything) inference.
 *
 * Two-stage pipeline:
 *  1. Encoder  — runs ONCE per image. Input `images` [1,3,1024,1024] (SAM-normalized,
 *     longest side resized to 1024 then padded) → `embeddings` [1,256,64,64].
 *  2. Decoder  — runs per prompt (point/box). Inputs:
 *       image_embeddings [1,256,64,64]
 *       point_coords     [1,N,2]   (in the 1024 padded-input space)
 *       point_labels     [1,N]     (1=positive, 0=negative, 2=box-top-left, 3=box-bottom-right)
 *       mask_input       [1,1,256,256]
 *       has_mask_input   [1]
 *       orig_im_size     [2]       (original image H, W)
 *     Outputs: masks [1,1,H,W] (orig size, logits), iou_predictions, low_res_masks.
 *
 * First pass: prove inference works end-to-end and return a binary Uint8Array mask
 * at the original image resolution.
 */
import * as ort from 'onnxruntime-web';

const SAM_INPUT_SIZE = 1024;
// SAM normalizes with these pixel mean/std (in 0-255 space).
const SAM_MEAN = [123.675, 116.28, 103.53];
const SAM_STD = [58.395, 57.12, 57.375];

let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;

/** Cached encoding for the current image, so prompts are cheap. */
interface SamEncoding {
  embeddings: ort.Tensor;     // [1,256,64,64]
  origWidth: number;
  origHeight: number;
  scale: number;              // SAM_INPUT_SIZE / max(origW, origH)
}

let currentEncoding: SamEncoding | null = null;

export interface SamPoint {
  x: number;          // original-image pixel coords
  y: number;
  positive: boolean;  // true = include, false = exclude
}

export interface SamBox {
  x1: number; y1: number; x2: number; y2: number; // original-image pixel coords
}

async function initSam(): Promise<void> {
  if (encoderSession && decoderSession) return;
  const sessionOptions = { executionProviders: ['webgpu', 'webgl', 'wasm'] };
  const [enc, dec] = await Promise.all([
    ort.InferenceSession.create('/model/mobile_sam_encoder.onnx', sessionOptions),
    ort.InferenceSession.create('/model/mobile_sam_decoder.onnx', { executionProviders: ['wasm'] }),
  ]);
  encoderSession = enc;
  decoderSession = dec;
  console.log('[SAM] encoder/decoder loaded', { encIn: enc.inputNames, encOut: enc.outputNames, decIn: dec.inputNames, decOut: dec.outputNames });
}

/**
 * Resize+pad the source to 1024x1024 (longest-side resize, pad bottom/right with 0),
 * normalize, and lay out as CHW float32. Returns the tensor and the scale factor.
 * Accepts any drawable source (image or canvas) plus its pixel dimensions.
 */
function preprocessForEncoder(
  source: CanvasImageSource,
  ow: number,
  oh: number,
): { tensor: ort.Tensor; scale: number } {
  const scale = SAM_INPUT_SIZE / Math.max(ow, oh);
  const rw = Math.round(ow * scale);
  const rh = Math.round(oh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = SAM_INPUT_SIZE;
  canvas.height = SAM_INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;
  // Pad area stays black (0). Draw the resized source at top-left.
  ctx.drawImage(source, 0, 0, rw, rh);
  const { data } = ctx.getImageData(0, 0, SAM_INPUT_SIZE, SAM_INPUT_SIZE);

  const area = SAM_INPUT_SIZE * SAM_INPUT_SIZE;
  const chw = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    chw[i] = (r - SAM_MEAN[0]) / SAM_STD[0];
    chw[area + i] = (g - SAM_MEAN[1]) / SAM_STD[1];
    chw[2 * area + i] = (b - SAM_MEAN[2]) / SAM_STD[2];
  }

  return {
    tensor: new ort.Tensor('float32', chw, [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]),
    scale,
  };
}

/**
 * Encode an image once. Subsequent segment() calls reuse the cached embeddings.
 */
export async function encodeImageForSam(image: HTMLImageElement): Promise<void> {
  await initSam();
  const { tensor, scale } = preprocessForEncoder(image, image.naturalWidth, image.naturalHeight);
  const out = await encoderSession!.run({ images: tensor });
  const embeddings = out[encoderSession!.outputNames[0]];
  currentEncoding = {
    embeddings,
    origWidth: image.naturalWidth,
    origHeight: image.naturalHeight,
    scale,
  };
  console.log('[SAM] image encoded', { dims: embeddings.dims, scale });
}

/**
 * Encode an arbitrary canvas as the SAM image. Use this to feed a version of the
 * photo that's been MASKED to the user's painted pixels — SAM then refines the
 * real object edge inside exactly that painted area. Replaces the cached encoding.
 */
export async function encodeCanvasForSam(canvas: HTMLCanvasElement): Promise<void> {
  await initSam();
  const { tensor, scale } = preprocessForEncoder(canvas, canvas.width, canvas.height);
  const out = await encoderSession!.run({ images: tensor });
  const embeddings = out[encoderSession!.outputNames[0]];
  currentEncoding = {
    embeddings,
    origWidth: canvas.width,
    origHeight: canvas.height,
    scale,
  };
  console.log('[SAM] canvas encoded', { dims: embeddings.dims, scale });
}

export function hasSamEncoding(): boolean {
  return currentEncoding !== null;
}

export function clearSamEncoding(): void {
  currentEncoding = null;
}

/**
 * Run the decoder for the given point/box prompts and return a binary mask
 * (Uint8Array, 0 or 255).
 *
 * `outSize` lets the caller request the output at a SPECIFIC resolution (e.g. the
 * target manual mask's dimensions). SAM's decoder upscales its mask to whatever we
 * pass as `orig_im_size`, so passing the mask size makes the result land in the
 * SAME coordinate space as the mask — no remap, and add/subtract align exactly.
 * When omitted, output is at the original image resolution.
 */
export async function segmentWithSam(
  points: SamPoint[] = [],
  box: SamBox | null = null,
  outSize?: { width: number; height: number },
  maskPrompt?: { data: Uint8Array; width: number; height: number },
): Promise<{ mask: Uint8Array; width: number; height: number } | null> {
  if (!currentEncoding) {
    console.warn('[SAM] segment called before encodeImageForSam');
    return null;
  }
  await initSam();

  const { embeddings, origWidth, origHeight, scale } = currentEncoding;
  // Decode at the encoded image's native dimensions; orig_im_size is what the
  // ONNX decoder treats as the photo's spatial domain (it handles pad cropping
  // internally). Resampling to caller-requested dims happens below.
  const outW = origWidth;
  const outH = origHeight;
  const requestedW = outSize?.width ?? origWidth;
  const requestedH = outSize?.height ?? origHeight;

  // Build point_coords / point_labels in the 1024 padded-input space.
  const coords: number[] = [];
  const labels: number[] = [];

  for (const p of points) {
    coords.push(p.x * scale, p.y * scale);
    labels.push(p.positive ? 1 : 0);
  }
  if (box) {
    // Box encoded as two special points: top-left=2, bottom-right=3.
    coords.push(box.x1 * scale, box.y1 * scale);
    labels.push(2);
    coords.push(box.x2 * scale, box.y2 * scale);
    labels.push(3);
  }

  // SAM's ONNX decoder requires a non-empty point set. When ONLY a mask prompt is
  // given, pad with the sentinel point (0,0 / label -1) so the prompt encoder runs.
  if (coords.length === 0) {
    if (!maskPrompt) return null;
    coords.push(0, 0);
    labels.push(-1);
  }

  // Dense mask prompt: feed the user's DRAWN pixels back to SAM so it refines that
  // exact shape into the clean region. mask_input is 256×256 LOGITS (positive =
  // foreground). Downsample the drawn mask (nearest) into that grid.
  let maskInputData = new Float32Array(256 * 256);
  let hasMask = 0;
  if (maskPrompt) {
    const { data, width: mw, height: mh } = maskPrompt;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const sx2 = Math.min(mw - 1, Math.floor((x / 256) * mw));
        const sy2 = Math.min(mh - 1, Math.floor((y / 256) * mh));
        // Map 0/255 → strong negative/positive logits.
        maskInputData[y * 256 + x] = data[sy2 * mw + sx2] > 30 ? 10 : -10;
      }
    }
    hasMask = 1;
  }

  const numPoints = labels.length;
  const pointCoords = new ort.Tensor('float32', Float32Array.from(coords), [1, numPoints, 2]);
  const pointLabels = new ort.Tensor('float32', Float32Array.from(labels), [1, numPoints]);
  const maskInput = new ort.Tensor('float32', maskInputData, [1, 1, 256, 256]);
  const hasMaskInput = new ort.Tensor('float32', Float32Array.from([hasMask]), [1]);
  const origImSize = new ort.Tensor('float32', Float32Array.from([outH, outW]), [2]);

  const feeds: Record<string, ort.Tensor> = {
    image_embeddings: embeddings,
    point_coords: pointCoords,
    point_labels: pointLabels,
    mask_input: maskInput,
    has_mask_input: hasMaskInput,
    orig_im_size: origImSize,
  };

  const out = await decoderSession!.run(feeds);
  const masksTensor = out['masks'] ?? out[decoderSession!.outputNames[0]];
  const dims = masksTensor.dims; // [1, M, H, W]
  const mh = dims[dims.length - 2] as number;
  const mw = dims[dims.length - 1] as number;
  const logits = masksTensor.data as Float32Array;
  const area = mw * mh;
  const numMasks = dims.length === 4 ? (dims[1] as number) : 1;
  const iou = (out['iou_predictions']?.data as Float32Array) ?? null;

  // Count foreground for a given mask channel at a given logit threshold.
  const countFg = (offset: number, thr: number) => {
    let n = 0;
    for (let i = 0; i < area; i++) if (logits[offset + i] > thr) n++;
    return n;
  };

  // Rank candidate channels by IoU (best first); fall back to channel order.
  const order = Array.from({ length: numMasks }, (_, i) => i);
  if (iou) order.sort((a, b) => (iou[b] ?? 0) - (iou[a] ?? 0));

  // Try progressively lower thresholds so a faint/ambiguous object still gets
  // detected instead of silently returning an empty mask. Require at least a
  // tiny but non-trivial foreground (>0.05% of the image) to count as a hit.
  const MIN_FG = Math.max(16, Math.floor(area * 0.0005));
  const thresholds = [0, -1, -2, -4];

  let chosenOffset = 0;
  let chosenThr = 0;
  let chosenFg = 0;
  outer: for (const thr of thresholds) {
    for (const ch of order) {
      const off = ch * area;
      const fg = countFg(off, thr);
      if (fg >= MIN_FG) { chosenOffset = off; chosenThr = thr; chosenFg = fg; break outer; }
    }
  }

  // Last resort: take whatever channel has the most foreground at the loosest
  // threshold, even if below MIN_FG, so the gesture still does something.
  if (chosenFg === 0) {
    const thr = thresholds[thresholds.length - 1];
    for (const ch of order) {
      const off = ch * area;
      const fg = countFg(off, thr);
      if (fg > chosenFg) { chosenFg = fg; chosenOffset = off; chosenThr = thr; }
    }
  }

  const mask = new Uint8Array(area);
  for (let i = 0; i < area; i++) mask[i] = logits[chosenOffset + i] > chosenThr ? 255 : 0;

  // SAM's decoder already maps its low-res mask into the photo's spatial domain
  // (origWidth × origHeight) — the output IS the actual image-space mask.
  // Resample to caller-requested dims if needed.
  if (requestedW === mw && requestedH === mh) {
    console.log('[SAM] segmented', { mw, mh, numMasks, chosenThr, fg: chosenFg });
    return { mask, width: mw, height: mh };
  }
  const resized = new Uint8Array(requestedW * requestedH);
  for (let y = 0; y < requestedH; y++) {
    const sy = Math.min(mh - 1, Math.floor((y / requestedH) * mh));
    for (let x = 0; x < requestedW; x++) {
      const sx = Math.min(mw - 1, Math.floor((x / requestedW) * mw));
      resized[y * requestedW + x] = mask[sy * mw + sx];
    }
  }
  console.log('[SAM] segmented', { decoded: [mw, mh], requested: [requestedW, requestedH], chosenThr, fg: chosenFg });
  return { mask: resized, width: requestedW, height: requestedH };
}
