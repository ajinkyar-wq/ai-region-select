export type Point = { x: number; y: number };

export function generateRadialGradientMask(
    width: number,
    height: number,
    center: { x: number, y: number },
    radius: { x: number, y: number },
    feather: number,
    invert: boolean,
    rotation: number = 0
): Uint8Array {
    const data = new Uint8Array(width * height);
    const cx = center.x * width;
    const cy = center.y * height;
    const rx = radius.x * width;
    const ry = radius.y * height;

    const angle = (rotation * Math.PI) / 180;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = x - cx;
            const dy = y - cy;

            // Rotate point into ellipse local space
            const rdx = cos * dx - sin * dy;
            const rdy = sin * dx + cos * dy;

            // Normalized Elliptical Distance
            // d = 0 at center, 1 at perimeter
            const d = Math.sqrt((rdx * rdx) / (rx * rx) + (rdy * rdy) / (ry * ry));

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


interface MaskInput {
    data: Uint8Array;
    width: number;
    height: number;
    offset?: { x: number; y: number };
}

export function generateInvertedMask(
    masks: MaskInput[],
    targetWidth: number,
    targetHeight: number
): Uint8Array {
    const newMaskData = new Uint8Array(targetWidth * targetHeight);

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            let maxAlpha = 0;

            for (const mask of masks) {
                // Calculate scale factors (to map Target -> Mask space)
                // If mask covers full image conceptually, we scale.
                // If mask has offset, we shift.
                // Formula: maskX = (targetX * (maskW / targetW)) - offsetX

                const scaleX = mask.width / targetWidth;
                const scaleY = mask.height / targetHeight;

                const offsetX = mask.offset?.x ?? 0;
                const offsetY = mask.offset?.y ?? 0;

                const localX = Math.floor(x * scaleX) - offsetX;
                const localY = Math.floor(y * scaleY) - offsetY;

                // Check if within mask bounds
                if (localX >= 0 && localX < mask.width && localY >= 0 && localY < mask.height) {
                    const idx = localY * mask.width + localX;
                    if (idx < mask.data.length) {
                        const val = mask.data[idx];
                        if (val > maxAlpha) maxAlpha = val;
                    }
                }

                if (maxAlpha === 255) break;
            }

            const targetIdx = y * targetWidth + x;
            newMaskData[targetIdx] = 255 - maxAlpha;
        }
    }
    return newMaskData;
}

export function generateUnionMask(
    masks: MaskInput[],
    targetWidth: number,
    targetHeight: number
): Uint8Array {
    const newMaskData = new Uint8Array(targetWidth * targetHeight);

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            let maxAlpha = 0;

            for (const mask of masks) {
                // Scale & Offset logic
                const scaleX = mask.width / targetWidth;
                const scaleY = mask.height / targetHeight;

                const offsetX = mask.offset?.x ?? 0;
                const offsetY = mask.offset?.y ?? 0;

                const localX = Math.floor(x * scaleX) - offsetX;
                const localY = Math.floor(y * scaleY) - offsetY;

                // Check if within mask bounds
                if (localX >= 0 && localX < mask.width && localY >= 0 && localY < mask.height) {
                    const idx = localY * mask.width + localX;
                    if (idx < mask.data.length) {
                        const val = mask.data[idx];
                        if (val > maxAlpha) maxAlpha = val;
                    }
                }

                if (maxAlpha === 255) break;
            }

            const targetIdx = y * targetWidth + x;
            newMaskData[targetIdx] = maxAlpha; // Union = Max Alpha (No Invert)
        }
    }
    return newMaskData;
}

export function subtractMasks(
    baseMask: Uint8Array,
    masksToSubtract: MaskInput[],
    width: number,
    height: number
): Uint8Array {
    // Clone base mask
    const result = new Uint8Array(baseMask);

    // We must iterate over every pixel of the RESULT (width x height)
    // because mapping from Mask -> Result (inverse) is harder if scaling is involved.
    // So we iterate x,y of Result, and check if it hits any mask.

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            for (const mask of masksToSubtract) {
                const scaleX = mask.width / width;
                const scaleY = mask.height / height;

                const offsetX = mask.offset?.x ?? 0;
                const offsetY = mask.offset?.y ?? 0;

                const localX = Math.floor(x * scaleX) - offsetX;
                const localY = Math.floor(y * scaleY) - offsetY;

                if (localX >= 0 && localX < mask.width && localY >= 0 && localY < mask.height) {
                    const val = mask.data[localY * mask.width + localX];
                    if (val > 10) {
                        // Erase in result
                        result[y * width + x] = 0;
                        // Optimization: If erased, no need to check other masks for this pixel
                        break;
                    }
                }
            }
        }
    }
    return result;
}
