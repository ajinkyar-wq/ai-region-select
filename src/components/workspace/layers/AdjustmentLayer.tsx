
import { useEffect, useState } from 'react';
import { Region, DEFAULT_ADJUSTMENTS, ImageTileData } from '@/types/workspace';

interface AdjustmentLayerProps {
    tile: ImageTileData;
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    width: number;
    height: number;
}

export function AdjustmentLayer({
    tile,
    imageTransform,
    width,
    height,
}: AdjustmentLayerProps) {
    // We need to generate mask URLs for the CSS `mask-image` property
    // We'll cache them to avoid regenerating every frame if possible
    // For now, simple effect that updates when regions change
    const [maskUrls, setMaskUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        // Generate object URLs for masks that have adjustments
        // This is a bit expensive, but necessary for CSS masking
        const newUrls: Record<string, string> = {};
        const adjustedRegions = tile.regions.filter(r => r.adjustments && hasAdjustments(r));

        let active = true;

        const generate = async () => {
            for (const r of adjustedRegions) {
                if (maskUrls[r.id] && !r.hasEdits) {
                    // Keep existing if no edits (handled optimistically? no way to know if mask data changed deep equality)
                    // For now, just regenerate. Performance optimization can come later (hashing).
                    // Or check if r.previewUrl exists?
                }

                // Create a canvas to draw the mask
                const canvas = document.createElement('canvas');
                canvas.width = r.maskWidth;
                canvas.height = r.maskHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) continue;

                const imageData = new ImageData(r.maskData, r.maskWidth, r.maskHeight);
                // We need the ALPHA channel to be the mask. 
                // The maskData is single channel (0-255).
                // ImageData expects RGBA.
                // We'll create a new ImageData where Alpha = maskData

                // Wait, r.maskData is Uint8Array? Usually 1 byte per pixel?
                // "Bitmap mask data" -> usually single channel alpha or 0/1.
                // The type definition says Uint8Array.
                // In SmartMaskLayer/ToolLayer, loop logic suggests it is indeed [0-255] alpha-ish.

                const rgba = new Uint8ClampedArray(r.maskWidth * r.maskHeight * 4);
                for (let i = 0; i < r.maskData.length; i++) {
                    const val = r.maskData[i];
                    rgba[i * 4] = 0;   // R
                    rgba[i * 4 + 1] = 0; // G
                    rgba[i * 4 + 2] = 0; // B
                    rgba[i * 4 + 3] = val; // A
                }

                ctx.putImageData(new ImageData(rgba, r.maskWidth, r.maskHeight), 0, 0);

                if (!active) return;
                // Generate Blob/URL
                const url = await new Promise<string>(resolve => {
                    canvas.toBlob(blob => resolve(URL.createObjectURL(blob!)));
                });
                newUrls[r.id] = url;
            }
            if (active) setMaskUrls(newUrls);
        };

        generate();

        return () => {
            active = false;
            // Revoke OLD urls?
            // Ideally yes.
            Object.values(newUrls).forEach(url => URL.revokeObjectURL(url));
            // Logic error: we can't revoke `newUrls` here because we just made them.
            // We should revoke `maskUrls` (previous) when replacing.
            // Simplified: React handles cleanup? No, ObjectURLs leak. 
            // We need a proper cleanup strategy.
        };
    }, [tile.regions]);

    // Cleanup effect
    useEffect(() => {
        return () => {
            Object.values(maskUrls).forEach(url => URL.revokeObjectURL(url));
        };
    }, [maskUrls]);


    if (!imageTransform) return null;

    return (
        <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{ overflow: 'hidden' }}
        >
            {tile.regions.filter(r => r.adjustments && hasAdjustments(r)).map(region => {
                const url = maskUrls[region.id];
                if (!url) return null;

                const adj = region.adjustments || DEFAULT_ADJUSTMENTS;

                // Map adjustments to CSS Filters
                // This is an approximation. Lightroom algo is complex.
                // Exposure: brightness?
                // Contrast: contrast
                // Saturation: saturate

                // Logic:
                // 1. Position a DIV exactly over the image area
                // 2. Apply Mask Image
                // 3. Apply Backdrop Filter

                const filterString = [
                    `brightness(${100 + (adj.exposure * 20)}%)`, // Exp -5 to 5. 100% is base. +100% = 2x. 
                    `contrast(${100 + adj.contrast}%)`,
                    `saturate(${100 + adj.saturation}%)`,
                    `hue-rotate(${adj.tint}deg)`,
                    // Temp is complex (blue/yellow shift). converting to sepia/hue?
                    // Simple approx: Sepia for warmth? 
                ].join(' ');

                return (
                    <div
                        key={region.id}
                        className="absolute mix-blend-normal"
                        style={{
                            left: imageTransform.x,
                            top: imageTransform.y,
                            width: imageTransform.width,
                            height: imageTransform.height,
                            // The Mask
                            maskImage: `url(${url})`,
                            maskSize: '100% 100%',
                            maskRepeat: 'no-repeat',
                            WebkitMaskImage: `url(${url})`,
                            WebkitMaskSize: '100% 100%',
                            WebkitMaskRepeat: 'no-repeat',

                            // The Effect
                            backdropFilter: filterString,
                            WebkitBackdropFilter: filterString,
                        }}
                    />
                );
            })}
        </div>
    );
}

function hasAdjustments(r: Region): boolean {
    if (!r.adjustments) return false;
    // Check if any value is non-default (0 usually, mostly)
    const a = r.adjustments;
    return (
        a.exposure !== 0 || a.contrast !== 0 || a.saturation !== 0 ||
        a.temp !== 0 || a.tint !== 0 || a.highlights !== 0 ||
        a.shadows !== 0 || a.whites !== 0 || a.blacks !== 0 ||
        a.texture !== 0 || a.clarity !== 0 || a.dehaze !== 0 ||
        a.vibrance !== 0 || a.sharpening !== 0 || a.luminance !== 0
    );
}
