/**
 * MediaPipe Image Segmentation - Simplified
 * Directly overlays colored masks on canvas
 */

import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Region, RegionType } from '@/types/workspace';

let segmenter: ImageSegmenter | null = null;
let initPromise: Promise<ImageSegmenter> | null = null;

async function initializeSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return segmenter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });

    return segmenter;
  })();

  return initPromise;
}

const MASK_COLORS = {
  people: [232, 28, 79, 60],      // Pink with alpha
  foreground: [16, 185, 129, 60], // Green with alpha
  background: [59, 130, 246, 60], // Blue with alpha
};

export async function segmentImage(
  imageElement: HTMLImageElement,
  canvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement
): Promise<Region[]> {
  try {
    const segmenterInstance = await initializeSegmenter();
    const result = segmenterInstance.segment(imageElement);

    if (!result.categoryMask) {
      console.warn('No category mask');
      return [];
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return [];

    const maskWidth = result.categoryMask.width;
    const maskHeight = result.categoryMask.height;
    const maskData = result.categoryMask.getAsUint8Array();

    // Calculate where the image actually is on canvas
    const imgWidth = imageElement.width;
    const imgHeight = imageElement.height;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;
    const offsetX = (canvasWidth - scaledWidth) / 2;
    const offsetY = (canvasHeight - scaledHeight) / 2;

    // Create colored mask at mask resolution
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = maskWidth;
    tempCanvas.height = maskHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return [];

    const imageData = tempCtx.createImageData(maskWidth, maskHeight);
    const pixels = imageData.data;

    const regions: Region[] = [];
    let hasPeople = false;
    let hasForeground = false;
    let hasBackground = false;

    for (let i = 0; i < maskData.length; i++) {
      const category = maskData[i];
      const pixelIndex = i * 4;

      if (category >= 1 && category <= 4) {
        pixels[pixelIndex] = MASK_COLORS.people[0];
        pixels[pixelIndex + 1] = MASK_COLORS.people[1];
        pixels[pixelIndex + 2] = MASK_COLORS.people[2];
        pixels[pixelIndex + 3] = MASK_COLORS.people[3];
        hasPeople = true;
      } else if (category === 5) {
        pixels[pixelIndex] = MASK_COLORS.foreground[0];
        pixels[pixelIndex + 1] = MASK_COLORS.foreground[1];
        pixels[pixelIndex + 2] = MASK_COLORS.foreground[2];
        pixels[pixelIndex + 3] = MASK_COLORS.foreground[3];
        hasForeground = true;
      } else if (category === 0) {
        pixels[pixelIndex] = MASK_COLORS.background[0];
        pixels[pixelIndex + 1] = MASK_COLORS.background[1];
        pixels[pixelIndex + 2] = MASK_COLORS.background[2];
        pixels[pixelIndex + 3] = MASK_COLORS.background[3];
        hasBackground = true;
      }
    }

    tempCtx.putImageData(imageData, 0, 0);

    // Clear overlay and draw mask at the SAME position as the image
    overlayCanvas.width = canvasWidth;
    overlayCanvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(tempCanvas, offsetX, offsetY, scaledWidth, scaledHeight);

    // Create region metadata
    if (hasPeople) {
      regions.push({
        id: 'people-' + Date.now(),
        type: 'people',
        pathData: '',
        visible: true,
        selected: false,
      });
    }

    if (hasForeground) {
      regions.push({
        id: 'foreground-' + Date.now(),
        type: 'foreground',
        pathData: '',
        visible: true,
        selected: false,
      });
    }

    if (hasBackground) {
      regions.push({
        id: 'background-' + Date.now(),
        type: 'background',
        pathData: '',
        visible: true,
        selected: false,
      });
    }

    result.categoryMask.close();
    console.log('Regions detected:', regions.length);

    return regions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}
export function isSegmenterReady(): boolean {
  return segmenter !== null;
}