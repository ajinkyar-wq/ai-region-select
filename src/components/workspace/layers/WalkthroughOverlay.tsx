import { useEffect, useRef, useState, useMemo } from 'react';
import type { Region } from '@/types/workspace';

interface WalkthroughOverlayProps {
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    panOffset?: { x: number; y: number };
    regions: Region[];
    hoveredRegionId: string | null;
    isWalkthroughActive: boolean;
    isWaveStopped: boolean;
    clickPos?: { x: number; y: number } | null;
}

interface MaskEntry {
    id: string;
    type: string;
    alphaUrl: string;
    colorUrl: string;
    r: number;
    g: number;
    b: number;
    maxX: number;
    cx: number;
    cy: number;
}

// ─── Contour (copied from SmartMaskLayer, no shared dep to avoid touching that file) ───

const ERODE_RADIUS = 12;

function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] <= 30) continue;
            let eroded = false;
            const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
            const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
            outer: for (let ny = y0; ny <= y1; ny++)
                for (let nx = x0; nx <= x1; nx++)
                    if (mask[ny * w + nx] <= 30) { eroded = true; break outer; }
            if (!eroded) out[y * w + x] = mask[y * w + x];
        }
    }
    return out;
}

function renderContourOnCanvas(
    ctx: CanvasRenderingContext2D,
    mask: Uint8Array, w: number, h: number,
    rC: number, gC: number, bC: number,
    destW: number, destH: number,
) {
    const exterior = new Uint8Array(w * h);
    const qx = new Int32Array(w * h), qy = new Int32Array(w * h);
    let head = 0, tail = 0;
    const pushQ = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = y * w + x;
        if (exterior[i] === 1 || mask[i] > 30) return;
        exterior[i] = 1; qx[tail] = x; qy[tail++] = y;
    };
    for (let x = 0; x < w; x++) { pushQ(x, 0); pushQ(x, h - 1); }
    for (let y = 0; y < h; y++) { pushQ(0, y); pushQ(w - 1, y); }
    while (head < tail) {
        const x = qx[head], y = qy[head++];
        pushQ(x + 1, y); pushQ(x - 1, y); pushQ(x, y + 1); pushQ(x, y - 1);
    }
    const solidMask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) solidMask[i] = (mask[i] > 30 || exterior[i] === 0) ? 255 : 0;

    const radius = 6, blurred = new Uint8Array(w * h), temp = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
        let sum = solidMask[y * w] * radius;
        for (let i = 0; i <= radius; i++) sum += solidMask[y * w + i];
        for (let x = 0; x < w; x++) {
            temp[y * w + x] = sum;
            const sub = x - radius >= 0 ? solidMask[y * w + (x - radius)] : solidMask[y * w];
            const add = x + radius + 1 < w ? solidMask[y * w + (x + radius + 1)] : solidMask[y * w + (w - 1)];
            sum += add - sub;
        }
    }
    const diameter = radius * 2 + 1;
    for (let x = 0; x < w; x++) {
        let sum = temp[x] * radius;
        for (let i = 0; i <= radius; i++) sum += temp[i * w + x];
        for (let y = 0; y < h; y++) {
            blurred[y * w + x] = Math.floor(sum / (diameter * diameter));
            const sub = y - radius >= 0 ? temp[(y - radius) * w + x] : temp[x];
            const add = y + radius + 1 < h ? temp[(y + radius + 1) * w + x] : temp[(h - 1) * w + x];
            sum += add - sub;
        }
    }

    const path = new Path2D(), iso = 127;
    const interp = (v1: number, v2: number) => (v1 === v2) ? 0.5 : (iso - v1) / (v2 - v1);
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const tl = blurred[y * w + x], tr = blurred[y * w + x + 1];
            const bl = blurred[(y + 1) * w + x], br = blurred[(y + 1) * w + x + 1];
            let state = 0;
            if (tl >= iso) state |= 8; if (tr >= iso) state |= 4;
            if (br >= iso) state |= 2; if (bl >= iso) state |= 1;
            if (state === 0 || state === 15) continue;
            const getT = () => ({ x: x + interp(tl, tr), y }), getR = () => ({ x: x + 1, y: y + interp(tr, br) });
            const getB = () => ({ x: x + interp(bl, br), y: y + 1 }), getL = () => ({ x, y: y + interp(tl, bl) });
            let pts: { x: number, y: number }[] = [];
            switch (state) {
                case 1: pts = [getL(), getB()]; break; case 2: pts = [getB(), getR()]; break;
                case 3: pts = [getL(), getR()]; break; case 4: pts = [getR(), getT()]; break;
                case 5: pts = [getL(), getT(), getB(), getR()]; break; case 6: pts = [getB(), getT()]; break;
                case 7: pts = [getL(), getT()]; break; case 8: pts = [getT(), getL()]; break;
                case 9: pts = [getT(), getB()]; break; case 10: pts = [getT(), getR(), getL(), getB()]; break;
                case 11: pts = [getT(), getR()]; break; case 12: pts = [getR(), getL()]; break;
                case 13: pts = [getR(), getB()]; break; case 14: pts = [getB(), getL()]; break;
            }
            if (pts.length >= 2) { path.moveTo(pts[0].x, pts[0].y); path.lineTo(pts[1].x, pts[1].y); }
            if (pts.length === 4) { path.moveTo(pts[2].x, pts[2].y); path.lineTo(pts[3].x, pts[3].y); }
        }
    }
    const scW = Math.floor(destW) || 1, scH = Math.floor(destH) || 1;
    const scratch = document.createElement('canvas');
    scratch.width = scW; scratch.height = scH;
    const sctx = scratch.getContext('2d')!;
    sctx.scale(scW / w, scH / h);
    sctx.strokeStyle = `rgba(${rC},${gC},${bC},${120 / 255})`;
    sctx.lineWidth = Math.max(1.5, w / scW * 1.5);
    sctx.lineCap = 'round'; sctx.lineJoin = 'round';
    sctx.stroke(path);
    ctx.drawImage(scratch, 0, 0, scW, scH);
}

// ─── Build PNGs ───────────────────────────────────────────────────────────────

function buildMaskPNGs(region: Region, allRegions: Region[]): MaskEntry | null {
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

    let minX = w, minY = h, maxX = 0, maxY = 0;

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
                alphaImg.data[p + 3] = a;

                colorImg.data[p] = rC;
                colorImg.data[p + 1] = gC;
                colorImg.data[p + 2] = bC;
                colorImg.data[p + 3] = Math.round((v / 255) * 0.3 * 255);
            }
        }
    }

    alphaCtx.putImageData(alphaImg, 0, 0);
    colorCtx.putImageData(colorImg, 0, 0);

    // Bake contour strokes directly into colorScratch so it's part of the animated image
    if (region.type === 'person') {
        const eroded = erodeMask(region.maskData, w, h, ERODE_RADIUS);
        const contourMask = eroded.some(v => v > 30) ? eroded : region.maskData;
        renderContourOnCanvas(colorCtx, contourMask, w, h, rC, gC, bC, w, h);
    } else if (region.type === 'people-group') {
        allRegions.filter(r => r.type === 'person').forEach(person => {
            if (!person.maskData || !person.maskWidth || !person.maskHeight) return;
            const eroded = erodeMask(person.maskData, person.maskWidth, person.maskHeight, ERODE_RADIUS);
            const contourMask = eroded.some(v => v > 30) ? eroded : person.maskData;
            renderContourOnCanvas(colorCtx, contourMask, person.maskWidth, person.maskHeight, rC, gC, bC, w, h);
        });
    }

    return {
        id: region.id,
        type: region.type,
        alphaUrl: alphaScratch.toDataURL('image/png'),
        colorUrl: colorScratch.toDataURL('image/png'),
        r: rC, g: gC, b: bC,
        maxX,
        cx: w > 0 ? ((minX + maxX) / 2 / w) * 100 : 50,
        cy: h > 0 ? ((minY + maxY) / 2 / h) * 100 : 50,
    };
}

export function WalkthroughOverlay({
    imageTransform,
    panOffset = { x: 0, y: 0 },
    regions,
    hoveredRegionId,
    isWalkthroughActive,
    isWaveStopped,
    clickPos,
}: WalkthroughOverlayProps) {
    const [masks, setMasks] = useState<MaskEntry[]>([]);

    // Auto-hide tooltip 2s after each click; reset timer on each new click
    const [tooltipShowing, setTooltipShowing] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (!clickPos) {
            setTooltipShowing(false);
            return;
        }
        setTooltipShowing(true);
        timerRef.current = setTimeout(() => setTooltipShowing(false), 2000);
    }, [clickPos]);

    useEffect(() => {
        if (!isWalkthroughActive) { setMasks([]); return; }

        const targets = regions.filter(r =>
            (r.type === 'person' || r.type === 'background' || r.type === 'people-group') &&
            r.visible && r.maskData && r.maskWidth && r.maskHeight
        );

        const entries: MaskEntry[] = [];
        for (const region of targets) {
            const e = buildMaskPNGs(region, targets);
            if (e) entries.push(e);
        }
        setMasks(entries);
    }, [regions, isWalkthroughActive]);

    const animatedMasks = useMemo(() => {
        const personMasks = masks
            .filter(m => m.type === 'person')
            .sort((a, b) => b.maxX - a.maxX);

        const maxDelay = (personMasks.length * 0.5) + 0.5;
        const totalDuration = 5 + maxDelay;

        return masks.map(mask => {
            let delay = 0;
            if (mask.type === 'person') {
                delay = personMasks.findIndex(m => m.id === mask.id) * 0.5;
            } else {
                delay = maxDelay;
            }
            return { ...mask, delay, maxDelay, totalDuration };
        });
    }, [masks]);

    if (!imageTransform || !isWalkthroughActive || masks.length === 0) return null;

    const anyHovered = hoveredRegionId !== null && masks.some(m => m.id === hoveredRegionId);

    return (
        <div className="absolute inset-0 z-20 pointer-events-none">
            {/* Tooltip: appears next to click, fades out after 2s, resets on each new click */}
            {clickPos && (
                <div
                    className="absolute"
                    style={{
                        left: clickPos.x + 14,
                        top: clickPos.y - 10,
                        pointerEvents: 'none',
                        zIndex: 30,
                        opacity: tooltipShowing ? 1 : 0,
                        transition: 'opacity 0.4s ease',
                    }}
                >
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 6px',
                        background: '#F6F6F6',
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                    }}>
                        <span style={{
                            fontFamily: 'Geist, sans-serif',
                            fontSize: '11px',
                            fontWeight: 500,
                            color: '#474747',
                            lineHeight: '12px',
                        }}>
                            Double click to edit
                        </span>
                    </div>
                </div>
            )}
            <div
                className="absolute overflow-hidden"
                style={{
                    left: imageTransform.x + panOffset.x,
                    top: imageTransform.y + panOffset.y,
                    width: imageTransform.width,
                    height: imageTransform.height,
                    willChange: 'transform',
                }}
            >
                {animatedMasks.map(mask => {
                    const isHovered = mask.id === hoveredRegionId;

                    const c0 = `rgba(${mask.r},${mask.g},${mask.b},0)`;
                    const c1 = `rgba(${mask.r},${mask.g},${mask.b},0.3)`;

                    return (
                        <div key={mask.id} className="absolute inset-0 pointer-events-none">
                            {/* Root container clipped to mask shape */}
                            <div
                                className="absolute inset-0 pointer-events-none"
                                style={{
                                    WebkitMaskImage: `url(${mask.alphaUrl})`,
                                    maskImage: `url(${mask.alphaUrl})`,
                                    WebkitMaskSize: '100% 100%',
                                    maskSize: '100% 100%',
                                    opacity: 1,
                                    transition: 'opacity 0.3s ease',
                                    transformOrigin: `${mask.cx}% ${mask.cy}%`,
                                    willChange: 'opacity, transform',
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
                                        style={{ objectFit: 'fill', mixBlendMode: 'normal' }}
                                    />
                                ) : !isWaveStopped ? (
                                    // colorUrl has fill + contour baked in.
                                    // CSS gradient mask-image sweeps the image — no nested PNG
                                    // masks, no GPU layer destruction, no flicker.
                                    <img
                                        src={mask.colorUrl}
                                        alt=""
                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                        style={{
                                            objectFit: 'fill',
                                            WebkitMaskImage: 'linear-gradient(-45deg, transparent 40%, black 46%, black 54%, transparent 60%)',
                                            maskImage: 'linear-gradient(-45deg, transparent 40%, black 46%, black 54%, transparent 60%)',
                                            WebkitMaskSize: '300% 300%',
                                            maskSize: '300% 300%',
                                            WebkitMaskRepeat: 'no-repeat',
                                            maskRepeat: 'no-repeat',
                                            animation: `walkthrough-mask-pos ${mask.totalDuration}s linear infinite`,
                                            animationDelay: `-${mask.maxDelay - mask.delay}s`,
                                        }}
                                    />
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
