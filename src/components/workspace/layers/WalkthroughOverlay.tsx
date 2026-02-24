import { useEffect, useState } from 'react';
import type { Region } from '@/types/workspace';

interface WalkthroughOverlayProps {
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    regions: Region[];
    hoveredRegionId: string | null;
    isWalkthroughActive: boolean;
}

interface MaskEntry {
    id: string;
    type: string;
    alphaUrl: string; // white-on-transparent PNG: clips to mask shape via CSS mask-image
    colorUrl: string; // colored PNG: shown in full on hover
    r: number;
    g: number;
    b: number;
    maxX: number;
    cx: number;
    cy: number;
}

function buildMaskPNGs(region: Region): MaskEntry | null {
    const w = region.maskWidth;
    const h = region.maskHeight;
    if (!w || !h || !region.maskData) return null;

    const alphaScratch = document.createElement('canvas');
    alphaScratch.width = w;
    alphaScratch.height = h;
    const alphaCtx = alphaScratch.getContext('2d');
    if (!alphaCtx) return null;
    const alphaImg = alphaCtx.createImageData(w, h);

    const colorScratch = document.createElement('canvas');
    colorScratch.width = w;
    colorScratch.height = h;
    const colorCtx = colorScratch.getContext('2d');
    if (!colorCtx) return null;
    const colorImg = colorCtx.createImageData(w, h);

    const cm = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
    const rC = cm ? parseInt(cm[1], 16) : 100;
    const gC = cm ? parseInt(cm[2], 16) : 150;
    const bC = cm ? parseInt(cm[3], 16) : 255;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const v = region.maskData[i];
            if (v > 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;

                const p = i * 4;
                const a = Math.round((v / 255) * 255);

                alphaImg.data[p] = 255;
                alphaImg.data[p + 1] = 255;
                alphaImg.data[p + 2] = 255;
                alphaImg.data[p + 3] = a; // keep soft edge for clip

                colorImg.data[p] = rC;
                colorImg.data[p + 1] = gC;
                colorImg.data[p + 2] = bC;

                // Fixed opacity across the whole region to avoid lighter/darker splotches
                // This ensures it looks like the clean flat ruby-lith in SmartMaskLayer.
                colorImg.data[p + 3] = Math.round(255 * 0.3);
            }
        }
    }

    alphaCtx.putImageData(alphaImg, 0, 0);
    colorCtx.putImageData(colorImg, 0, 0);

    return {
        id: region.id,
        type: region.type,
        alphaUrl: alphaScratch.toDataURL('image/png'),
        colorUrl: colorScratch.toDataURL('image/png'),
        r: rC,
        g: gC,
        b: bC,
        maxX,
        cx: w > 0 ? ((minX + maxX) / 2 / w) * 100 : 50,
        cy: h > 0 ? ((minY + maxY) / 2 / h) * 100 : 50,
    };
}

export function WalkthroughOverlay({
    imageTransform,
    regions,
    hoveredRegionId,
    isWalkthroughActive,
}: WalkthroughOverlayProps) {
    const [masks, setMasks] = useState<MaskEntry[]>([]);

    useEffect(() => {
        if (!isWalkthroughActive) { setMasks([]); return; }

        const targets = regions.filter(r =>
            (r.type === 'person' || r.type === 'background' || r.type === 'people-group') &&
            r.visible && r.maskData && r.maskWidth && r.maskHeight
        );

        const entries: MaskEntry[] = [];
        for (const region of targets) {
            const e = buildMaskPNGs(region);
            if (e) entries.push(e);
        }
        setMasks(entries);
    }, [regions, isWalkthroughActive]);

    if (!imageTransform || !isWalkthroughActive || masks.length === 0) return null;

    const anyHovered = hoveredRegionId !== null && masks.some(m => m.id === hoveredRegionId);

    return (
        <div className="absolute inset-0 z-20 pointer-events-none">
            <div
                className="absolute overflow-hidden"
                style={{
                    left: imageTransform.x,
                    top: imageTransform.y,
                    width: imageTransform.width,
                    height: imageTransform.height,
                }}
            >
                {masks.map(mask => {
                    const isHovered = mask.id === hoveredRegionId;

                    // rgba helpers — avoids black fringing from transparent→color interpolation
                    const c0 = `rgba(${mask.r},${mask.g},${mask.b},0)`;
                    const c1 = `rgba(${mask.r},${mask.g},${mask.b},0.3)`;

                    // Stagger the waves so individual person masks sweep distinctly,
                    // ordered spatially from right to left (descending maxX).
                    // followed by people-group and background with delays
                    const personMasks = masks
                        .filter(m => m.type === 'person')
                        .sort((a, b) => b.maxX - a.maxX);

                    let delay = 0;
                    if (mask.type === 'person') {
                        delay = personMasks.findIndex(m => m.id === mask.id) * 0.5;
                    } else if (mask.type === 'people-group') {
                        // People group sweeps right behind the individuals
                        delay = (personMasks.length * 0.5) + 0.5;
                    } else if (mask.type === 'background') {
                        // Background sweeps right alongside the people group
                        delay = (personMasks.length * 0.5) + 0.5;
                    }

                    // Total animation time is the base 5s + the maximum possible delay.
                    // This ensures the loop is synchronised across everyone.
                    const maxDelay = (personMasks.length * 0.5) + 0.5;
                    const totalDuration = 5 + maxDelay;

                    return (
                        <div
                            key={mask.id}
                            className="absolute inset-0 pointer-events-none"
                            // Clips everything inside to the mask shape.
                            // The inner wave uses `background` (not mask-image) so
                            // there is no nested mask → no triangle artifacts.
                            style={{
                                WebkitMaskImage: `url(${mask.alphaUrl})`,
                                maskImage: `url(${mask.alphaUrl})`,
                                WebkitMaskSize: '100% 100%',
                                maskSize: '100% 100%',
                                opacity: anyHovered && !isHovered ? 0 : 1,
                                transition: 'opacity 0.3s ease',
                                transformOrigin: `${mask.cx}% ${mask.cy}%`,
                                ...(isHovered ? {
                                    animation: mask.type === 'background'
                                        ? 'walkthrough-bg-bounce 2s ease-in-out infinite'
                                        : 'walkthrough-bounce 2s ease-in-out infinite'
                                } : {})
                            }}
                        >
                            {isHovered ? (
                                <img
                                    src={mask.colorUrl}
                                    alt=""
                                    className="absolute inset-0 w-full h-full pointer-events-none"
                                    style={{
                                        objectFit: 'fill',
                                        // Use normal blend mode instead of screen so 
                                        // 30% alpha looks identical to SmartMaskLayer
                                        mixBlendMode: 'normal',
                                    }}
                                />
                            ) : mask.type === 'people-group' ? null : (
                                /*
                                 * Wave: a diagonal band of color sweeping from bottom-right
                                 * to top-left, implemented via background-position animation.
                                 *
                                 * The gradient tile is 300%×300% (3W × 3H). The opaque band
                                 * sits at 46–54% of the -45deg gradient line, which places it
                                 * at the tile center (1.5W, 1.5H).
                                 *
                                 * background-position math (diff = element - tile = -2W / -2H):
                                 *   -25% -25%  → tile origin at (+0.5W, +0.5H)
                                 *               → band center at (2W, 2H)  [off-screen BR]
                                 *    50%  50%  → tile origin at (-1W, -1H)
                                 *               → band center at (0.5W, 0.5H) [screen center]
                                 *   125% 125%  → tile origin at (-2.5W, -2.5H)
                                 *               → band center at (-W, -H)  [off-screen TL]
                                 *
                                 * Only where the band intersects the mask shape is anything
                                 * visible — the rest is clipped by the outer mask-image.
                                 */
                                <div
                                    className="absolute inset-0 animate-walkthrough-wave"
                                    style={{
                                        background: `linear-gradient(-45deg,
                                            ${c0} 40%,
                                            ${c1} 46%,
                                            ${c1} 54%,
                                            ${c0} 60%
                                        )`,
                                        backgroundSize: '300% 300%',
                                        backgroundRepeat: 'no-repeat',
                                        // Use normal instead of screen to avoid blowing out highlights
                                        mixBlendMode: 'normal',
                                        // Use inline animation here overriding the class to encode the duration 
                                        // and negative delay, so that it runs in perfect sync across all masks 
                                        // without some starting late and cutting off. 
                                        animation: `walkthrough-wave ${totalDuration}s linear infinite`,
                                        animationDelay: `-${maxDelay - delay}s`
                                    }}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}