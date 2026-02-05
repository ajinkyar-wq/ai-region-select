export type Point = { x: number; y: number };

export function generateRadialGradientMask(
    width: number,
    height: number,
    center: { x: number, y: number },
    radius: { x: number, y: number },
    feather: number,
    invert: boolean
): Uint8Array {
    const data = new Uint8Array(width * height);
    const cx = center.x * width;
    const cy = center.y * height;
    const rx = radius.x * width;
    const ry = radius.y * height;

    // Optimization values
    const rx_sq = rx * rx;
    const ry_sq = ry * ry;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - cx;
            const dy = y - cy;

            // Normalized Elliptical Distance
            // d = 0 at center, 1 at perimeter
            const d = Math.sqrt((dx * dx) / rx_sq + (dy * dy) / ry_sq);

            let alpha = 0;
            if (d <= feather) {
                alpha = 255;
            } else if (d >= 1.0) {
                alpha = 0;
            } else {
                // Linear interpolate between feather and 1.0
                const range = 1.0 - feather;
                const u = (d - feather) / range;
                alpha = Math.round((1 - u) * 255);
            }

            if (invert) alpha = 255 - alpha;
            if (alpha > 0) data[y * width + x] = alpha;
        }
    }
    return data;
}

export function getMaskCenter(
    maskData: Uint8Array,
    width: number,
    height: number
): { x: number; y: number } | null {
    let totalX = 0;
    let totalY = 0;
    let count = 0;

    // 1. Calculate Centroid (Center of Mass)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (maskData[idx] > 10) {
                totalX += x;
                totalY += y;
                count++;
            }
        }
    }

    if (count === 0) return null;

    const cx = Math.round(totalX / count);
    const cy = Math.round(totalY / count);

    // 2. Scanline Search: Find the longest segment passing through the centroid
    // This snaps the center to the "body" of the mask (e.g. valid pixels)
    // and avoids holes (like in a donut or arch).

    let bestPoint = { x: cx, y: cy };
    let maxLen = -1;

    // Helper to process a run of valid pixels
    const checkRun = (runLen: number, start: number, fixed: number, isHorizontal: boolean) => {
        if (runLen > maxLen) {
            maxLen = runLen;
            if (isHorizontal) {
                bestPoint = { x: Math.floor(start + runLen / 2), y: fixed };
            } else {
                bestPoint = { x: fixed, y: Math.floor(start + runLen / 2) };
            }
        }
    };

    // Scan Horizontal Row at Cy
    let currentRun = 0;
    let runStart = 0;
    for (let x = 0; x < width; x++) {
        const idx = cy * width + x;
        if (maskData[idx] > 10) {
            if (currentRun === 0) runStart = x;
            currentRun++;
        } else {
            if (currentRun > 0) checkRun(currentRun, runStart, cy, true);
            currentRun = 0;
        }
    }
    if (currentRun > 0) checkRun(currentRun, runStart, cy, true);

    // Scan Vertical Col at Cx
    currentRun = 0;
    runStart = 0;
    for (let y = 0; y < height; y++) {
        const idx = y * width + cx;
        if (maskData[idx] > 10) {
            if (currentRun === 0) runStart = y;
            currentRun++;
        } else {
            if (currentRun > 0) checkRun(currentRun, runStart, cx, false);
            currentRun = 0;
        }
    }
    if (currentRun > 0) checkRun(currentRun, runStart, cx, false);

    // 3. Validation: If scanlines somehow missed (e.g. extremely thin diagonal), 
    // fall back to purely finding *any* valid pixel closest to centroid (BFS)
    const finalIdx = bestPoint.y * width + bestPoint.x;
    if (maskData[finalIdx] <= 10) {
        // Fallback BFS
        const visited = new Set<number>();
        const queue: [number, number][] = [[cx, cy]];
        visited.add(cy * width + cx);

        while (queue.length > 0) {
            const [qX, qY] = queue.shift()!;
            const idx = qY * width + qX;
            if (maskData[idx] > 10) return { x: qX, y: qY };

            const neighbors = [[qX + 1, qY], [qX - 1, qY], [qX, qY + 1], [qX, qY - 1]];
            for (const [nX, nY] of neighbors) {
                if (nX >= 0 && nX < width && nY >= 0 && nY < height) {
                    const nIdx = nY * width + nX;
                    if (!visited.has(nIdx)) {
                        visited.add(nIdx);
                        queue.push([nX, nY]);
                    }
                }
            }
        }
        return { x: cx, y: cy }; // Should technically never reach here if count > 0
    }

    return bestPoint;
}
