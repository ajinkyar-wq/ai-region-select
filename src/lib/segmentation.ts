/**
 * MediaPipe Image Segmentation
 */

import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Region, RegionType } from '@/types/workspace';
import { maskToPath } from './mask-to-shape';

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

function extractCategoryMask(
  maskData: Uint8Array,
  width: number,
  height: number,
  categories: number[]
): Uint8Array {
  const binaryMask = new Uint8Array(width * height);
  for (let i = 0; i < maskData.length; i++) {
    binaryMask[i] = categories.includes(maskData[i]) ? 255 : 0;
  }
  return binaryMask;
}

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

    const maskWidth = result.categoryMask.width;
    const maskHeight = result.categoryMask.height;
    const maskData = result.categoryMask.getAsUint8Array();

    const imgWidth = imageElement.width;
    const imgHeight = imageElement.height;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;
    const offsetX = (canvasWidth - scaledWidth) / 2;
    const offsetY = (canvasHeight - scaledHeight) / 2;

    const scaleX = scaledWidth / maskWidth;
    const scaleY = scaledHeight / maskHeight;

    const regions: Region[] = [];

    const regionConfigs: Array<{
      type: RegionType;
      categories: number[];
      id: string;
    }> = [
        { type: 'people', categories: [0], id: 'people-' + Date.now() },
        { type: 'foreground', categories: [5], id: 'foreground-' + Date.now() + 1 },
        { type: 'background', categories: [1, 2, 3, 4], id: 'background-' + Date.now() + 2 },
      ];

    for (const config of regionConfigs) {
      const binaryMask = extractCategoryMask(maskData, maskWidth, maskHeight, config.categories);

      if (!binaryMask.some(v => v > 0)) continue;

      // PASS OFFSET DIRECTLY TO maskToPath
      const pathData = await maskToPath(
        binaryMask,
        maskWidth,
        maskHeight,
        scaleX,
        scaleY,
        2,
      );

      if (pathData) {
        regions.push({
          id: config.id,
          type: config.type,
          pathData,
          visible: true,
          selected: false,
        });
      }
    }

    result.categoryMask.close();
    return regions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

export function isSegmenterReady(): boolean {
  return segmenter !== null;
}