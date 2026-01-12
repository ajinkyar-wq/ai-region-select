/**
 * MediaPipe Image Segmentation Integration
 * Runs client-side via WASM, produces People/Foreground/Background masks
 */

import { ImageSegmenter, FilesetResolver } from '@mediapipe/tasks-vision';
import { maskToPath, createOrganicShape } from './mask-to-shape';
import type { Region, RegionType } from '@/types/workspace';

let segmenter: ImageSegmenter | null = null;
let isInitializing = false;
let initPromise: Promise<ImageSegmenter> | null = null;

/**
 * Initialize MediaPipe Image Segmenter
 */
async function initializeSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return segmenter;

  if (initPromise) return initPromise;

  isInitializing = true;

  initPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });

      return segmenter;
    } catch (error) {
      console.error('Failed to initialize MediaPipe:', error);
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

/**
 * Create fallback regions when AI fails
 */
function createFallbackRegions(width: number, height: number): Region[] {
  const centerX = width / 2;
  const centerY = height / 2;

  return [
    {
      id: 'people-fallback',
      type: 'people' as RegionType,
      pathData: createOrganicShape(centerX, centerY * 0.8, width * 0.15, height * 0.35, 12, 0.15),
      visible: true,
      selected: false,
    },
    {
      id: 'foreground-fallback',
      type: 'foreground' as RegionType,
      pathData: createOrganicShape(centerX, height * 0.75, width * 0.4, height * 0.2, 10, 0.2),
      visible: true,
      selected: false,
    },
    {
      id: 'background-fallback',
      type: 'background' as RegionType,
      pathData: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
      visible: true,
      selected: false,
    },
  ];
}

/**
 * Extract mask data from segmentation result
 */
function extractMaskFromCategory(
  categoryMask: { width: number; height: number; getAsUint8Array: () => Uint8Array },
  targetCategory: number,
  width: number,
  height: number
): Uint8Array {
  const maskData = categoryMask.getAsUint8Array();
  const result = new Uint8Array(width * height);

  for (let i = 0; i < maskData.length; i++) {
    result[i] = maskData[i] === targetCategory ? 255 : 0;
  }

  return result;
}

/**
 * Offset SVG path coordinates
 */
function offsetPath(pathData: string, offsetX: number, offsetY: number): string {
  if (!pathData || offsetX === 0 && offsetY === 0) return pathData;

  // Match all numbers in the path and offset them appropriately
  const commands = pathData.match(/[A-Z]/g) || [];
  const numbers = pathData.match(/[-]?[0-9]*\.?[0-9]+/g)?.map(Number) || [];

  if (numbers.length === 0) return pathData;

  let result = '';
  let numIndex = 0;
  let cmdIndex = 0;

  for (let i = 0; i < pathData.length; i++) {
    const char = pathData[i];

    if (/[A-Z]/.test(char)) {
      result += char;
      cmdIndex++;
    } else if (/[0-9.-]/.test(char)) {
      // Start of a number - consume the whole number
      let numStr = '';
      while (i < pathData.length && /[0-9.-]/.test(pathData[i])) {
        numStr += pathData[i];
        i++;
      }
      i--; // Back up one since the loop will increment

      const num = parseFloat(numStr);
      const isX = numIndex % 2 === 0;
      const offsetNum = isX ? num + offsetX : num + offsetY;
      result += offsetNum;
      numIndex++;
    } else {
      result += char;
    }
  }

  return result;
}
/**
 * Run segmentation on an image and return regions
 */
export async function segmentImage(
  imageElement: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
): Promise<Region[]> {
  try {
    const segmenterInstance = await initializeSegmenter();

    const result = segmenterInstance.segment(imageElement);

    if (!result.categoryMask) {
      console.warn('No category mask returned, using fallback');
      return createFallbackRegions(canvasWidth, canvasHeight);
    }

    const maskWidth = result.categoryMask.width;
    const maskHeight = result.categoryMask.height;

    // Calculate actual image scale and position in canvas
    const imgWidth = imageElement.width;
    const imgHeight = imageElement.height;
    const scale = Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const actualWidth = imgWidth * scale;
    const actualHeight = imgHeight * scale;
    const offsetX = (canvasWidth - actualWidth) / 2;
    const offsetY = (canvasHeight - actualHeight) / 2;

    // Scale masks to actual image size, not canvas size
    const scaleX = actualWidth / maskWidth;
    const scaleY = actualHeight / maskHeight;

    console.log('Segmentation debug:', {
      maskSize: `${maskWidth}x${maskHeight}`,
      imageSize: `${imgWidth}x${imgHeight}`,
      canvasSize: `${canvasWidth}x${canvasHeight}`,
      actualSize: `${actualWidth}x${actualHeight}`,
      offset: `${offsetX}, ${offsetY}`,
      scale: `${scaleX}, ${scaleY}`
    });

    const regions: Region[] = [];
    const maskData = result.categoryMask.getAsUint8Array();

    // Category indices for selfie_multiclass model:
    // 0: background, 1: hair, 2: body-skin, 3: face-skin, 4: clothes, 5: others

    // People mask (hair + body + face + clothes)
    const peopleMask = new Uint8Array(maskWidth * maskHeight);
    for (let i = 0; i < maskData.length; i++) {
      const category = maskData[i];
      peopleMask[i] = (category >= 1 && category <= 4) ? 255 : 0;
    }

    const peoplePixels = peopleMask.filter(p => p > 0).length;
    console.log('People mask pixels:', peoplePixels);

    let peoplePath = maskToPath(peopleMask, maskWidth, maskHeight, scaleX, scaleY, 1.5);
    if (peoplePath) {
      peoplePath = offsetPath(peoplePath, offsetX, offsetY);
      regions.push({
        id: 'people-' + Date.now(),
        type: 'people',
        pathData: peoplePath,
        visible: true,
        selected: false,
      });
    }

    // Foreground mask (category 5: accessories)
    const foregroundMask = extractMaskFromCategory(result.categoryMask, 5, maskWidth, maskHeight);
    const foregroundPixels = foregroundMask.filter(p => p > 0).length;
    console.log('Foreground mask pixels:', foregroundPixels);

    let foregroundPath = maskToPath(foregroundMask, maskWidth, maskHeight, scaleX, scaleY, 1.5);
    if (foregroundPath) {
      foregroundPath = offsetPath(foregroundPath, offsetX, offsetY);
      regions.push({
        id: 'foreground-' + Date.now(),
        type: 'foreground',
        pathData: foregroundPath,
        visible: true,
        selected: false,
      });
    } else if (foregroundPixels > 0) {
      // Has pixels but no path generated - use fallback shape
      regions.push({
        id: 'foreground-' + Date.now(),
        type: 'foreground',
        pathData: createOrganicShape(
          offsetX + actualWidth / 2,
          offsetY + actualHeight * 0.75,
          actualWidth * 0.3,
          actualHeight * 0.15,
          8,
          0.2
        ),
        visible: true,
        selected: false,
      });
    }

    // Background mask (category 0)
    const backgroundMask = extractMaskFromCategory(result.categoryMask, 0, maskWidth, maskHeight);
    const backgroundPixels = backgroundMask.filter(p => p > 0).length;
    console.log('Background mask pixels:', backgroundPixels);

    let backgroundPath = maskToPath(backgroundMask, maskWidth, maskHeight, scaleX, scaleY, 2);
    if (backgroundPath) {
      backgroundPath = offsetPath(backgroundPath, offsetX, offsetY);
      regions.push({
        id: 'background-' + Date.now(),
        type: 'background',
        pathData: backgroundPath,
        visible: true,
        selected: false,
      });
    } else {
      // Full canvas background as fallback
      regions.push({
        id: 'background-' + Date.now(),
        type: 'background',
        pathData: `M 0 0 L ${canvasWidth} 0 L ${canvasWidth} ${canvasHeight} L 0 ${canvasHeight} Z`,
        visible: true,
        selected: false,
      });
    }

    console.log('Total regions generated:', regions.length);

    // Clean up
    result.categoryMask.close();

    return regions;
  } catch (error) {
    console.error('Segmentation failed:', error);
    return createFallbackRegions(canvasWidth, canvasHeight);
  }
}

/**
 * Check if segmenter is ready
 */
export function isSegmenterReady(): boolean {
  return segmenter !== null && !isInitializing;
}