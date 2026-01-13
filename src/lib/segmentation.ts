/**
 * MediaPipe Image Segmentation with Vector Path Conversion
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

/**
 * Extract a binary mask for specific categories
 */
function extractCategoryMask(
  maskData: Uint8Array,
  width: number,
  height: number,
  categories: number[]
): Uint8Array {
  const binaryMask = new Uint8Array(width * height);

  for (let i = 0; i < maskData.length; i++) {
    const category = maskData[i];
    binaryMask[i] = categories.includes(category) ? 255 : 0;
  }

  return binaryMask;
}

/**
 * Translate SVG path by offset
 */
function translatePath(pathData: string, offsetX: number, offsetY: number): string {
  if (offsetX === 0 && offsetY === 0) return pathData;

  // Simple regex to match M, L, and Z commands with coordinates
  return pathData.replace(/([ML])\s*([\d.-]+)\s+([\d.-]+)/g,
    (match, cmd, x, y) => {
      return `${cmd} ${parseFloat(x) + offsetX} ${parseFloat(y) + offsetY}`;
    }
  );
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

    // Calculate scaling from mask space to canvas space
    const imgWidth = imageElement.width;
    const imgHeight = imageElement.height;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const scaledWidth = imgWidth * scale;
    const scaledHeight = imgHeight * scale;
    const offsetX = (canvasWidth - scaledWidth) / 2;
    const offsetY = (canvasHeight - scaledHeight) / 2;

    // Scale factors from mask coordinates to canvas coordinates
    const scaleX = scaledWidth / maskWidth;
    const scaleY = scaledHeight / maskHeight;

    const regions: Region[] = [];

    // Process each region type
    const regionConfigs: Array<{
      type: RegionType;
      categories: number[];
      id: string;
    }> = [
        { type: 'people', categories: [1, 2, 3, 4], id: 'people-' + Date.now() },
        { type: 'foreground', categories: [5], id: 'foreground-' + Date.now() + 1 },
        { type: 'background', categories: [0], id: 'background-' + Date.now() + 2 },
      ];

    for (const config of regionConfigs) {
      // Extract binary mask for this region
      const binaryMask = extractCategoryMask(
        maskData,
        maskWidth,
        maskHeight,
        config.categories
      );

      // Check if region has any pixels
      const hasPixels = binaryMask.some(v => v > 0);
      if (!hasPixels) continue;

      console.log(`Converting ${config.type} to vector...`);

      // Convert mask to SVG path (now async!)
      const pathData = await maskToPath(
        binaryMask,
        maskWidth,
        maskHeight,
        scaleX,
        scaleY,
        2 // epsilon for simplification
      );

      console.log(`${config.type} path length:`, pathData.length);

      if (pathData) {
        // Translate path to account for image offset
        const translatedPath = translatePath(pathData, offsetX, offsetY);

        regions.push({
          id: config.id,
          type: config.type,
          pathData: translatedPath,
          visible: true,
          selected: false,
        });
      }
    }

    result.categoryMask.close();
    console.log('Vector regions created:', regions);

    return regions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

export function isSegmenterReady(): boolean {
  return segmenter !== null;
}