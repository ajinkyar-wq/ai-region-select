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
 * Extract a binary mask for a specific category
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
        { type: 'foreground', categories: [5], id: 'foreground-' + Date.now() },
        { type: 'background', categories: [0], id: 'background-' + Date.now() },
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

      // Convert mask to SVG path
      const pathData = maskToPath(
        binaryMask,
        maskWidth,
        maskHeight,
        scaleX,
        scaleY,
        2 // epsilon for simplification
      );

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
    console.log('Vector regions created:', regions.length);

    return regions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return [];
  }
}

/**
 * Translate SVG path by offset
 */
function translatePath(pathData: string, offsetX: number, offsetY: number): string {
  if (offsetX === 0 && offsetY === 0) return pathData;

  return pathData.replace(/([ML])\s*([\d.-]+)\s+([\d.-]+)|([C])\s*([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+)/g,
    (match, cmd1, x1, y1, cmd2, cx1, cy1, cx2, cy2, x2, y2) => {
      if (cmd1) {
        // M or L command
        return `${cmd1} ${parseFloat(x1) + offsetX} ${parseFloat(y1) + offsetY}`;
      } else if (cmd2) {
        // C command
        return `${cmd2} ${parseFloat(cx1) + offsetX} ${parseFloat(cy1) + offsetY}, ${parseFloat(cx2) + offsetX} ${parseFloat(cy2) + offsetY}, ${parseFloat(x2) + offsetX} ${parseFloat(y2) + offsetY}`;
      }
      return match;
    }
  );
}

export function isSegmenterReady(): boolean {
  return segmenter !== null;
}