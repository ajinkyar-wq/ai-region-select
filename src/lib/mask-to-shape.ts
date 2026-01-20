/**
 * Mask to Vector using Potrace - ACTUALLY WORKING VERSION
 */

import Potrace from 'potrace';

export async function maskToPath(
  mask: Uint8Array,
  width: number,
  height: number,
  scaleX: number = 1,
  scaleY: number = 1,
  epsilon: number = 2,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const rgbaData = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < mask.length; i++) {
      const value = mask[i];
      const rgbaIndex = i * 4;
      rgbaData[rgbaIndex] = value;
      rgbaData[rgbaIndex + 1] = value;
      rgbaData[rgbaIndex + 2] = value;
      rgbaData[rgbaIndex + 3] = 255;
    }

    const imageData = new ImageData(rgbaData, width, height);

    Potrace.trace(imageData, { threshold: 128, turdSize: epsilon, optTolerance: 0.2 }, (err: Error | null, svg: string) => {
      if (err) {
        console.error('Potrace error:', err);
        reject(err);
        return;
      }

      const pathMatch = svg.match(/<path[^>]+d="([^"]+)"/);
      if (!pathMatch || !pathMatch[1]) {
        resolve('');
        return;
      }

      // Transform the path: scale + offset
      const transformed = transformPath(pathMatch[1], scaleX, scaleY);
      resolve(transformed);
    });
  });
}

function transformPath(
  path: string,
  scaleX: number,
  scaleY: number
): string {
  let result = '';
  let i = 0;
  let currentCommand = '';

  while (i < path.length) {
    const c = path[i];

    // Command letter
    if (/[MLHVCSQTAZ]/i.test(c)) {
      currentCommand = c.toUpperCase();
      result += c + ' ';
      i++;
      continue;
    }

    // Whitespace/comma
    if (/[\s,]/.test(c)) {
      i++;
      continue;
    }

    // Number
    if (/[-\d.]/.test(c)) {
      let num = '';
      while (i < path.length && /[-\d.]/.test(path[i])) {
        num += path[i++];
      }

      const val = parseFloat(num);
      let scaled = val;

      // ✅ SCALE BASED ON COMMAND SEMANTICS
      switch (currentCommand) {
        case 'H': // horizontal lineto
          scaled = val * scaleX;
          break;
        case 'V': // vertical lineto
          scaled = val * scaleY;
          break;
        default:
          // For M, L, C, Q, etc — alternate X/Y properly
          scaled =
            result.trim().endsWith(currentCommand)
              ? val * scaleX
              : val * scaleY;
          break;
      }

      result += scaled.toFixed(2) + ' ';
      continue;
    }

    i++;
  }

  return result.trim();
}
