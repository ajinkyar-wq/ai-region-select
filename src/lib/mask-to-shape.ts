/**
 * Dead Simple Mask to Vector
 * Takes MediaPipe binary mask, finds the outline, makes SVG path
 * NO EXTERNAL LIBRARIES
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Find outline pixels by checking if pixel has empty neighbor
 */
function findOutlinePixels(mask: Uint8Array, width: number, height: number): Point[] {
  const outline: Point[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // If this pixel is white (part of mask)
      if (mask[idx] > 128) {
        // Check if any neighbor is black (edge detection)
        const hasEmptyNeighbor =
          mask[idx - 1] < 128 ||           // left
          mask[idx + 1] < 128 ||           // right
          mask[idx - width] < 128 ||       // top
          mask[idx + width] < 128;         // bottom

        if (hasEmptyNeighbor) {
          outline.push({ x, y });
        }
      }
    }
  }

  return outline;
}

/**
 * Sort outline points into a path by angle from center
 */
function sortByAngle(points: Point[]): Point[] {
  if (points.length === 0) return [];

  // Find center
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const centerX = sumX / points.length;
  const centerY = sumY / points.length;

  // Sort by angle
  return points.sort((a, b) => {
    const angleA = Math.atan2(a.y - centerY, a.x - centerX);
    const angleB = Math.atan2(b.y - centerY, b.x - centerX);
    return angleA - angleB;
  });
}

/**
 * Reduce number of points - keep every Nth point
 */
function reducePoints(points: Point[], keepEvery: number = 5): Point[] {
  if (points.length === 0) return [];

  const reduced: Point[] = [];
  for (let i = 0; i < points.length; i += keepEvery) {
    reduced.push(points[i]);
  }

  // Always include last point
  if (reduced[reduced.length - 1] !== points[points.length - 1]) {
    reduced.push(points[points.length - 1]);
  }

  return reduced;
}

/**
 * Convert points to SVG path with scaling
 */
function pointsToPath(points: Point[], scaleX: number, scaleY: number): string {
  if (points.length === 0) return '';

  const scaled = points.map(p => ({
    x: Math.round(p.x * scaleX * 10) / 10,
    y: Math.round(p.y * scaleY * 10) / 10
  }));

  let path = `M ${scaled[0].x} ${scaled[0].y}`;

  for (let i = 1; i < scaled.length; i++) {
    path += ` L ${scaled[i].x} ${scaled[i].y}`;
  }

  path += ' Z';
  return path;
}

/**
 * MAIN FUNCTION: Mask → Vector Path
 */
export async function maskToPath(
  mask: Uint8Array,
  width: number,
  height: number,
  scaleX: number = 1,
  scaleY: number = 1,
  epsilon: number = 2
): Promise<string> {

  console.log(`maskToPath called: ${width}x${height}, scale: ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}`);

  // Step 1: Find all outline pixels
  const outlinePixels = findOutlinePixels(mask, width, height);
  console.log(`Found ${outlinePixels.length} outline pixels`);

  if (outlinePixels.length === 0) {
    console.warn('No outline pixels found');
    return '';
  }

  // Step 2: Sort them into a path
  const sortedPoints = sortByAngle(outlinePixels);
  console.log(`Sorted ${sortedPoints.length} points`);

  // Step 3: Reduce point count
  const reducedPoints = reducePoints(sortedPoints, 8);
  console.log(`Reduced to ${reducedPoints.length} points`);

  // Step 4: Convert to SVG path
  const path = pointsToPath(reducedPoints, scaleX, scaleY);
  console.log(`Generated path: ${path.substring(0, 100)}...`);

  return path;
}

/**
 * Fallback rectangle
 */
export function createRectPath(x: number, y: number, width: number, height: number, inset: number = 10): string {
  const left = x + inset;
  const top = y + inset;
  const right = x + width - inset;
  const bottom = y + height - inset;

  return `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
}

/**
 * Organic blob
 */
export function createOrganicShape(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  segments: number = 8,
  variance: number = 0.2
): string {
  const points: Point[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const rx = radiusX * (1 + (Math.random() - 0.5) * variance);
    const ry = radiusY * (1 + (Math.random() - 0.5) * variance);

    points.push({
      x: centerX + Math.cos(angle) * rx,
      y: centerY + Math.sin(angle) * ry,
    });
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  path += ' Z';

  return path;
}