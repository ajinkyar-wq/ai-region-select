/**
 * Mask-to-Shape Pipeline
 * Converts AI pixel masks to interactive vector paths using:
 * 1. Marching Squares for contour extraction
 * 2. Ramer-Douglas-Peucker for point reduction
 * 3. Catmull-Rom to Bézier for curve smoothing
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Marching Squares algorithm for contour extraction
 */
function marchingSquares(mask: Uint8Array, width: number, height: number, threshold: number = 128): Point[][] {
  const contours: Point[][] = [];
  const visited = new Set<string>();

  const getPixel = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    return mask[y * width + x];
  };

  const getSquareIndex = (x: number, y: number): number => {
    let index = 0;
    if (getPixel(x, y) >= threshold) index |= 1;
    if (getPixel(x + 1, y) >= threshold) index |= 2;
    if (getPixel(x + 1, y + 1) >= threshold) index |= 4;
    if (getPixel(x, y + 1) >= threshold) index |= 8;
    return index;
  };

  // Direction lookup for marching squares
  const directions: Record<number, [number, number]> = {
    1: [0, -1], 2: [1, 0], 3: [1, 0], 4: [1, 0],
    5: [0, -1], 6: [1, 0], 7: [1, 0], 8: [0, 1],
    9: [0, -1], 10: [0, 1], 11: [0, -1], 12: [0, 1],
    13: [0, -1], 14: [0, 1],
  };

  for (let startY = 0; startY < height - 1; startY++) {
    for (let startX = 0; startX < width - 1; startX++) {
      const key = `${startX},${startY}`;
      if (visited.has(key)) continue;

      const index = getSquareIndex(startX, startY);
      if (index === 0 || index === 15) continue;

      const contour: Point[] = [];
      let x = startX;
      let y = startY;
      let prevDir: [number, number] = [0, 0];

      for (let i = 0; i < width * height; i++) {
        const cellKey = `${x},${y}`;
        visited.add(cellKey);

        const cellIndex = getSquareIndex(x, y);
        if (cellIndex === 0 || cellIndex === 15) break;

        // Get interpolated edge point
        contour.push({ x: x + 0.5, y: y + 0.5 });

        const dir = directions[cellIndex] || [0, 0];
        x += dir[0];
        y += dir[1];
        prevDir = dir;

        if (x === startX && y === startY) break;
        if (x < 0 || x >= width - 1 || y < 0 || y >= height - 1) break;
      }

      if (contour.length > 10) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

/**
 * Ramer-Douglas-Peucker algorithm for point reduction
 */
function rdpSimplify(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;

  const perpendicularDistance = (point: Point, lineStart: Point, lineEnd: Point): number => {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    
    const u = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (mag * mag);
    const closestX = lineStart.x + u * dx;
    const closestY = lineStart.y + u * dy;
    return Math.sqrt((point.x - closestX) ** 2 + (point.y - closestY) ** 2);
  };

  let maxDistance = 0;
  let maxIndex = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDistance) {
      maxDistance = d;
      maxIndex = i;
    }
  }

  if (maxDistance > epsilon) {
    const left = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const right = rdpSimplify(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0], points[points.length - 1]];
}

/**
 * Catmull-Rom to Bézier conversion for smooth curves
 */
function catmullRomToBezier(points: Point[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const tension = 0.5;
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  path += ' Z';
  return path;
}

/**
 * Main pipeline: Convert mask to SVG path
 */
export function maskToPath(
  mask: Uint8Array,
  width: number,
  height: number,
  scaleX: number = 1,
  scaleY: number = 1,
  epsilon: number = 2
): string {
  // Extract contours using marching squares
  const contours = marchingSquares(mask, width, height);
  
  if (contours.length === 0) return '';

  // Find the largest contour
  const largestContour = contours.reduce((a, b) => a.length > b.length ? a : b);

  // Simplify with RDP
  const simplified = rdpSimplify(largestContour, epsilon);

  // Scale points
  const scaled = simplified.map(p => ({
    x: p.x * scaleX,
    y: p.y * scaleY,
  }));

  // Convert to smooth Bézier path
  return catmullRomToBezier(scaled);
}

/**
 * Generate a simple rectangular path as fallback
 */
export function createRectPath(x: number, y: number, width: number, height: number, inset: number = 10): string {
  const left = x + inset;
  const top = y + inset;
  const right = x + width - inset;
  const bottom = y + height - inset;
  
  return `M ${left} ${top} L ${right} ${top} L ${right} ${bottom} L ${left} ${bottom} Z`;
}

/**
 * Create an organic blob shape for demo/fallback purposes
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
  
  // Close the loop
  points.push(points[0]);
  
  return catmullRomToBezier(points);
}
