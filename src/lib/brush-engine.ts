export type BrushMode = 'add' | 'erase';

interface BrushOptions {
    radius: number;
    softness: number; // 0-100
    opacity: number; // 0-100
    mode: BrushMode;
}

/**
 * Applies a brush stroke to the mask data with interpolation, softness, and opacity.
 */
export function applyBrushStroke(
    start: { x: number; y: number },
    end: { x: number; y: number },
    maskData: Uint8Array,
    maskWidth: number,
    maskHeight: number,
    transform: { scale: number; width: number; height: number },
    options: BrushOptions
) {
    const { radius, softness, opacity, mode } = options;

    // Calculate scaling factors
    // The input coordinates (start/end) are relative to the Container DIV (which matches imageTransform).
    // We need to map them to Mask Pixels.
    const scaleX = maskWidth / transform.width;
    const scaleY = maskHeight / transform.height;

    // Scale start/end to mask coordinates
    const x0 = start.x * scaleX;
    const y0 = start.y * scaleY;
    const x1 = end.x * scaleX;
    const y1 = end.y * scaleY;

    // Calculate brush radius in Mask Pixels
    // We take the max scale to ensure coverage, consistent with previous simplistic approach,
    // but strictly speaking, brush size usually defined in Screen Pixels?
    // Let's assume input 'radius' is in Screen Pixels.
    const rIdx = Math.ceil(radius * Math.max(scaleX, scaleY));
    const rSq = rIdx * rIdx;

    // Softness factor: Distances < innerRadius have full alpha. Distances > innerRadius fade out.
    // softness 0 -> inner = radius (Hard)
    // softness 100 -> inner = 0 (Full gradient)
    const innerRadius = rIdx * (1 - softness / 100);
    const fadeDist = rIdx - innerRadius;

    // Target Opacity (0-255)
    const targetAlpha = Math.round((opacity / 100) * 255);

    // Interpolation: Bresenham or Step-based
    const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
    const stepSize = Math.max(1, rIdx * 0.25); // Step every 1/4th of radius for smoothness
    const steps = Math.ceil(dist / stepSize);

    for (let i = 0; i <= steps; i++) {
        const t = steps > 0 ? i / steps : 0;
        const cx = Math.round(x0 + (x1 - x0) * t);
        const cy = Math.round(y0 + (y1 - y0) * t);

        // Bounding box for this stamp
        const minX = Math.max(0, cx - rIdx);
        const maxX = Math.min(maskWidth - 1, cx + rIdx);
        const minY = Math.max(0, cy - rIdx);
        const maxY = Math.min(maskHeight - 1, cy + rIdx);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const idx = y * maskWidth + x;
                const dx = x - cx;
                const dy = y - cy;
                const currDist = Math.sqrt(dx * dx + dy * dy);

                if (currDist <= rIdx) {
                    // Calculate Alpha for this pixel based on Softness
                    let alphaFactor = 1;
                    if (currDist > innerRadius) {
                        // Linear fade
                        alphaFactor = 1 - (currDist - innerRadius) / fadeDist;
                    }
                    // Clamp
                    alphaFactor = Math.max(0, Math.min(1, alphaFactor));

                    // Easing for smoother falloff (optional, using smoothstep-like)
                    alphaFactor = alphaFactor * alphaFactor * (3 - 2 * alphaFactor);

                    const brushStrength = Math.round(targetAlpha * alphaFactor);
                    const currentVal = maskData[idx];

                    if (mode === 'add') {
                        // MAX Blending: Don't exceed the brush strength for this stamp, 
                        // but if the canvas already has higher value, keep it.
                        // Wait, standard opacity painting usually accumulates?
                        // "Flow" accumulates. "Opacity" usually caps.
                        // User asked for "Opacity". In styling, Opacity 50% means if I paint over and over, it stays 50%.
                        // So Max(current, new) is correct for "Opacity" behavior in a single stroke context?
                        // Actually, standard digital painting:
                        // Single Stroke: Max(current, brushVal)
                        // Multiple Strokes: Accumulate (usually).
                        // Since we modify buffer in-place per stamp, Max prevents "caterpillar" (dark spots).
                        maskData[idx] = Math.max(currentVal, brushStrength);
                    } else {
                        // Erase
                        // brushStrength is how much we want to REMOVE.
                        // Target is 0.
                        // We want to reduce currentVal by brushStrength? No, that's Flow.
                        // Opacity erase usually means "Fade to transparent by X amount".
                        // Or, "Limit the Alpha to (1 - Opacity)".
                        // Let's implement: "At this pixel, the mask can be AT MOST (255 - brushStrength)".

                        const limit = 255 - brushStrength;
                        maskData[idx] = Math.min(currentVal, limit);
                    }
                }
            }
        }
    }
}
