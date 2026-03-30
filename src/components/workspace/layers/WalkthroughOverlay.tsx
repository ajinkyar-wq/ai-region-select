import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Region } from '@/types/workspace';
import type { WalkthroughStep } from '../Workspacelogic/useWalkthrough';

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
    isWalkthroughActive?: boolean;
    isWaveStopped?: boolean;
    clickPos?: { x: number; y: number } | null;
    walkthroughStep?: WalkthroughStep;
    containerWidth?: number;
    containerHeight?: number;
    onAdvanceStep?: () => void;
    onStopWave?: () => void;
    onCompleteWalkthrough?: () => void;
    // Simulate hover/click/deselect on real canvas state
    onSimulateRegionClick?: (regionId: string) => void;
    onSimulateRegionHover?: (regionId: string | null) => void;
    onSimulateRegionDeselect?: () => void;
}

interface MaskEntry {
    id: string;
    type: string;
    label: string;
    alphaUrl: string;
    colorUrl: string;
    r: number;
    g: number;
    b: number;
    maxX: number;
    cx: number;
    cy: number;
    // Absolute canvas position of mask center
    absCx: number;
    absCy: number;
}

// ─── Mask label + description ─────────────────────────────────────────────────

function getMaskLabel(type: string, regionLabel: string, index: number, total: number): string {
    if (type === 'person') return total > 1 ? `Person ${index + 1}` : 'Person';
    if (regionLabel) return regionLabel;
    if (type === 'people-group') return 'People';
    if (type === 'background') return 'Background';
    if (type === 'subject') return 'Subject';
    return 'Mask';
}

// ─── Contour helpers (mirrors SmartMaskLayer) ─────────────────────────────────

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
    const push = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = y * w + x;
        if (exterior[i] === 1 || mask[i] > 30) return;
        exterior[i] = 1; qx[tail] = x; qy[tail++] = y;
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (head < tail) { const x = qx[head], y = qy[head++]; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }

    const solidMask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) solidMask[i] = (mask[i] > 30 || exterior[i] === 0) ? 255 : 0;

    const radius = 6, blurred = new Uint8Array(w * h), temp = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
        let sum = solidMask[y * w] * radius;
        for (let i = 0; i <= radius; i++) sum += solidMask[y * w + i];
        for (let x = 0; x < w; x++) {
            temp[y * w + x] = sum;
            sum += (x + radius + 1 < w ? solidMask[y * w + (x + radius + 1)] : solidMask[y * w + (w - 1)])
                - (x - radius >= 0 ? solidMask[y * w + (x - radius)] : solidMask[y * w]);
        }
    }
    const diam = radius * 2 + 1;
    for (let x = 0; x < w; x++) {
        let sum = temp[x] * radius;
        for (let i = 0; i <= radius; i++) sum += temp[i * w + x];
        for (let y = 0; y < h; y++) {
            blurred[y * w + x] = Math.floor(sum / (diam * diam));
            sum += (y + radius + 1 < h ? temp[(y + radius + 1) * w + x] : temp[(h - 1) * w + x])
                - (y - radius >= 0 ? temp[(y - radius) * w + x] : temp[x]);
        }
    }

    const path = new Path2D(), iso = 127;
    const interp = (v1: number, v2: number) => v1 === v2 ? 0.5 : (iso - v1) / (v2 - v1);
    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const tl = blurred[y * w + x], tr = blurred[y * w + x + 1];
            const bl = blurred[(y + 1) * w + x], br = blurred[(y + 1) * w + x + 1];
            let state = 0;
            if (tl >= iso) state |= 8; if (tr >= iso) state |= 4;
            if (br >= iso) state |= 2; if (bl >= iso) state |= 1;
            if (state === 0 || state === 15) continue;
            const T = () => ({ x: x + interp(tl, tr), y }), R = () => ({ x: x + 1, y: y + interp(tr, br) });
            const B = () => ({ x: x + interp(bl, br), y: y + 1 }), L = () => ({ x, y: y + interp(tl, bl) });
            let pts: { x: number, y: number }[] = [];
            switch (state) {
                case 1: pts = [L(), B()]; break; case 2: pts = [B(), R()]; break; case 3: pts = [L(), R()]; break;
                case 4: pts = [R(), T()]; break; case 5: pts = [L(), T(), B(), R()]; break; case 6: pts = [B(), T()]; break;
                case 7: pts = [L(), T()]; break; case 8: pts = [T(), L()]; break; case 9: pts = [T(), B()]; break;
                case 10: pts = [T(), R(), L(), B()]; break; case 11: pts = [T(), R()]; break; case 12: pts = [R(), L()]; break;
                case 13: pts = [R(), B()]; break; case 14: pts = [B(), L()]; break;
            }
            if (pts.length >= 2) { path.moveTo(pts[0].x, pts[0].y); path.lineTo(pts[1].x, pts[1].y); }
            if (pts.length === 4) { path.moveTo(pts[2].x, pts[2].y); path.lineTo(pts[3].x, pts[3].y); }
        }
    }
    const scW = Math.floor(destW) || 1, scH = Math.floor(destH) || 1;
    const sc = document.createElement('canvas'); sc.width = scW; sc.height = scH;
    const sctx = sc.getContext('2d')!;
    sctx.scale(scW / w, scH / h);
    sctx.strokeStyle = `rgba(${rC},${gC},${bC},${120 / 255})`;
    sctx.lineWidth = Math.max(1.5, w / scW * 1.5);
    sctx.lineCap = 'round'; sctx.lineJoin = 'round'; sctx.stroke(path);
    ctx.drawImage(sc, 0, 0, scW, scH);
}

// ─── Build PNGs ───────────────────────────────────────────────────────────────

function buildMaskPNGs(
    region: Region,
    allRegions: Region[],
    imageTransform: { x: number; y: number; width: number; height: number },
    index: number,
    totalOfType: number,
    regionLabel: string,
): MaskEntry | null {
    const w = region.maskWidth, h = region.maskHeight;
    if (!w || !h || !region.maskData) return null;

    const alphaC = document.createElement('canvas'); alphaC.width = w; alphaC.height = h;
    const alphaCtx = alphaC.getContext('2d'); if (!alphaCtx) return null;
    const alphaImg = alphaCtx.createImageData(w, h);

    const colorC = document.createElement('canvas'); colorC.width = w; colorC.height = h;
    const colorCtx = colorC.getContext('2d'); if (!colorCtx) return null;
    const colorImg = colorCtx.createImageData(w, h);

    const cm = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
    const rC = cm ? parseInt(cm[1], 16) : 100;
    const gC = cm ? parseInt(cm[2], 16) : 150;
    const bC = cm ? parseInt(cm[3], 16) : 255;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x, v = region.maskData[i];
            if (v > 0) {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
                const p = i * 4, a = Math.round((v / 255) * 255);
                alphaImg.data[p] = 255; alphaImg.data[p + 1] = 255; alphaImg.data[p + 2] = 255; alphaImg.data[p + 3] = a;
                colorImg.data[p] = rC; colorImg.data[p + 1] = gC; colorImg.data[p + 2] = bC;
                colorImg.data[p + 3] = Math.round((v / 255) * 0.3 * 255);
            }
        }
    }
    alphaCtx.putImageData(alphaImg, 0, 0);
    colorCtx.putImageData(colorImg, 0, 0);

    if (region.type === 'person') {
        const eroded = erodeMask(region.maskData, w, h, ERODE_RADIUS);
        renderContourOnCanvas(colorCtx, eroded.some(v => v > 30) ? eroded : region.maskData, w, h, rC, gC, bC, w, h);
    } else if (region.type === 'people-group') {
        allRegions.filter(r => r.type === 'person').forEach(p => {
            if (!p.maskData || !p.maskWidth || !p.maskHeight) return;
            const eroded = erodeMask(p.maskData, p.maskWidth, p.maskHeight, ERODE_RADIUS);
            renderContourOnCanvas(colorCtx, eroded.some(v => v > 30) ? eroded : p.maskData, p.maskWidth, p.maskHeight, rC, gC, bC, w, h);
        });
    }

    // Weighted centroid — average position of all mask pixels, guaranteed inside the shape
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = region.maskData[y * w + x];
            if (v > 30) { sumX += x; sumY += y; count++; }
        }
    }
    const cxR = count > 0 ? (sumX / count) / w : 0.5;
    const cyR = count > 0 ? (sumY / count) / h : 0.5;

    return {
        id: region.id,
        type: region.type,
        label: getMaskLabel(region.type, regionLabel, index, totalOfType),
        alphaUrl: alphaC.toDataURL('image/png'),
        colorUrl: colorC.toDataURL('image/png'),
        r: rC, g: gC, b: bC, maxX,
        cx: cxR * 100,
        cy: cyR * 100,
        absCx: imageTransform.x + cxR * imageTransform.width,
        absCy: imageTransform.y + cyR * imageTransform.height,
    };
}

// ─── Easing ───────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

// ─── Virtual Cursor ───────────────────────────────────────────────────────────

function VirtualCursor({ x, y, clicking, visible }: { x: number; y: number; clicking: boolean; visible: boolean }) {
    return (
        <div style={{
            // Offset so the arrow tip (hotspot) lands exactly at (x, y)
            position: 'absolute', left: x - 3, top: y - 2,
            pointerEvents: 'none', zIndex: 50,
            opacity: visible ? 1 : 0,
            transform: clicking ? 'scale(0.82)' : 'scale(1)',
            transformOrigin: '3px 2px',
            transition: `opacity 0.25s ease, transform ${clicking ? '0.08s' : '0.12s'} ease`,
            willChange: 'transform, opacity',
        }}>
            <svg width="22" height="26" viewBox="0 0 22 26" fill="none" xmlns="http://www.w3.org/2000/svg"
                style={{ filter: 'drop-shadow(0px 2px 5px rgba(0,0,0,0.5))' }}>
                <path d="M3 2L3 21L7.5 16L10.5 23L13 22L10 15.5L17 15.5L3 2Z"
                    fill="white" stroke="#1a1a1a" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
        </div>
    );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function CursorTooltip({ x, y, text, visible, above = false }: { x: number; y: number; text: string; visible: boolean; above?: boolean }) {
    return (
        <div style={{
            position: 'absolute',
            left: x + (above ? -24 : 24),
            top: above ? y - 36 : y + 4,
            pointerEvents: 'none', zIndex: 50,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.3s ease',
            whiteSpace: 'nowrap',
        }}>
            <div style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '5px 9px', background: '#F6F6F6',
                borderRadius: '5px', boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
            }}>
                <span style={{
                    fontFamily: 'Geist, sans-serif', fontSize: '11px',
                    fontWeight: 500, color: '#474747', lineHeight: '14px',
                }}>
                    {text}
                </span>
            </div>
        </div>
    );
}

// ─── Canvas-level intro tooltip (no cursor) ───────────────────────────────────

function IntroTooltip({ visible, containerWidth, containerHeight }: { visible: boolean; containerWidth: number; containerHeight: number }) {
    return (
        <div style={{
            position: 'absolute',
            left: '50%', top: '50%',
            transform: 'translate(-50%, calc(-50% - 60px))',
            pointerEvents: 'none', zIndex: 50,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.5s ease',
            whiteSpace: 'nowrap',
        }}>
            <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 12px', background: '#F6F6F6',
                borderRadius: '6px', boxShadow: '0 3px 14px rgba(0,0,0,0.2)',
            }}>
                <span style={{
                    fontFamily: 'Geist, sans-serif', fontSize: '12px',
                    fontWeight: 500, color: '#474747', lineHeight: '16px',
                }}>
                    Move your cursor to see the masks.
                </span>
            </div>
        </div>
    );
}

// ─── Async animation helpers ──────────────────────────────────────────────────

function animateTo(
    from: { x: number; y: number },
    to: { x: number; y: number },
    duration: number,
    setPos: (p: { x: number; y: number }) => void,
    rafRef: React.MutableRefObject<number | null>,
): Promise<void> {
    return new Promise(resolve => {
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const e = easeInOutCubic(t);
            setPos({ x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) });
            if (t < 1) { rafRef.current = requestAnimationFrame(tick); }
            else resolve();
        };
        rafRef.current = requestAnimationFrame(tick);
    });
}

function wait(ms: number, timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>): Promise<void> {
    return new Promise(resolve => { timerRef.current = setTimeout(resolve, ms); });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WalkthroughOverlay({
    imageTransform,
    panOffset = { x: 0, y: 0 },
    regions,
    hoveredRegionId,
    isWalkthroughActive = false,
    isWaveStopped = false,
    containerWidth = 0,
    containerHeight = 0,
    onStopWave,
    onCompleteWalkthrough,
    onSimulateRegionClick,
    onSimulateRegionHover,
    onSimulateRegionDeselect,
}: WalkthroughOverlayProps) {
    const [masks, setMasks] = useState<MaskEntry[]>([]);

    const animatedMasks = useMemo(() => {
        const personMasks = masks.filter(m => m.type === 'person').sort((a, b) => b.maxX - a.maxX);
        const perMaskDelay = 0.18;
        const maxDelay = personMasks.length * perMaskDelay + 0.1;
        const sweepDuration = 1.4; // single diagonal pass duration
        const totalDuration = sweepDuration + maxDelay;
        return masks.map(mask => {
            const delay = mask.type === 'person'
                ? personMasks.findIndex(m => m.id === mask.id) * perMaskDelay
                : maxDelay;
            return { ...mask, delay, maxDelay, totalDuration };
        });
    }, [masks]);

    // Virtual cursor
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: containerWidth + 60, y: containerHeight * 0.45 });
    const [cursorVisible, setCursorVisible] = useState(false);
    const [cursorClicking, setCursorClicking] = useState(false);

    // Tooltips
    const [introVisible, setIntroVisible] = useState(false);
    const [cursorTooltipText, setCursorTooltipText] = useState('');
    const [cursorTooltipVisible, setCursorTooltipVisible] = useState(false);
    const [cursorTooltipAbove, setCursorTooltipAbove] = useState(false);

    const rafRef = useRef<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelledRef = useRef(false);
    const hasRunRef = useRef(false);
    // Always-current snapshot of regions so the async loop can check hasEdits
    const regionsRef = useRef(regions);
    useEffect(() => { regionsRef.current = regions; }, [regions]);

    // Build mask entries whenever regions/transform change
    useEffect(() => {
        if (!isWalkthroughActive || !imageTransform) { setMasks([]); return; }
        const targets = regions.filter(r =>
            (r.type === 'person' || r.type === 'background' || r.type === 'people-group' || r.type.startsWith('background-')) &&
            r.visible && r.maskData && r.maskWidth && r.maskHeight
        );
        const personCount = targets.filter(r => r.type === 'person').length;
        let personIndex = 0;
        const entries: MaskEntry[] = [];
        for (const region of targets) {
            const idx = region.type === 'person' ? personIndex++ : 0;
            const e = buildMaskPNGs(region, targets, imageTransform, idx, personCount, region.label);
            if (e) entries.push(e);
        }
        setMasks(entries);
    }, [regions, isWalkthroughActive, imageTransform]);

    // ── Main walkthrough sequence ─────────────────────────────────────────────
    const runWalkthrough = useCallback(async (maskList: MaskEntry[]) => {
        if (maskList.length === 0 || containerWidth === 0) return;
        cancelledRef.current = false;
        const cancelled = () => cancelledRef.current;

        // Masks to tour: persons/group first (up to 2), then background subtypes (sky, vegetation…)
        // falling back to generic background. Max 3 total.
        const bgSubtypes = maskList.filter(m => m.type.startsWith('background-'));
        const bgFallback = bgSubtypes.length > 0 ? bgSubtypes.slice(0, 2) : maskList.filter(m => m.type === 'background').slice(0, 1);
        const tourMasks = [
            ...maskList.filter(m => m.type === 'person' || m.type === 'people-group').slice(0, 2),
            ...bgFallback,
        ].slice(0, 3);

        const offRight = { x: containerWidth + 50, y: containerHeight * 0.45 };

        // ── Phase 1: wave plays once, then cursor ────────────────────────────
        // Last mask to finish = background mask: starts at maxDelay, runs for totalDuration (sweepDuration + maxDelay)
        // So finishes at: maxDelay + sweepDuration + maxDelay = sweepDuration + 2 * maxDelay
        const personCount2 = maskList.filter(m => m.type === 'person').length;
        const waveMaxDelay = personCount2 * 0.18 + 0.1;
        const sweepDuration = 1.4;
        const waveFinishMs = Math.ceil((sweepDuration + 2 * waveMaxDelay) * 1000) + 150;

        setIntroVisible(true);
        await wait(waveFinishMs, timerRef); if (cancelled()) return;
        setIntroVisible(false);
        onStopWave?.();
        await wait(150, timerRef); if (cancelled()) return;

        // ── Phase 2: cursor tour loop ────────────────────────────────────────
        while (!cancelled()) {
            // Deselect + clear hover so hover works this iteration
            onSimulateRegionDeselect?.();
            onSimulateRegionHover?.(null);

            setCursorPos(offRight);
            setCursorVisible(false);
            setCursorTooltipVisible(false);

            await wait(200, timerRef); if (cancelled()) return;
            setCursorVisible(true);

            // Filter out masks already in the list (hasEdits) each loop iteration
            const currentRegions = regionsRef.current;
            const activeTourMasks = tourMasks.filter(m => {
                const r = currentRegions.find(r => r.id === m.id);
                return !r?.hasEdits;
            });

            // If all masks are already in the list, nothing to show — just idle
            if (activeTourMasks.length === 0) {
                setCursorVisible(false);
                await wait(1500, timerRef); if (cancelled()) return;
                continue;
            }

            // Visit each unselected mask: move → hover → label stays → move on
            let prevPos = offRight;
            for (let i = 0; i < activeTourMasks.length; i++) {
                if (cancelled()) return;
                const mask = activeTourMasks[i];
                const dest = { x: mask.absCx + panOffset.x, y: mask.absCy + panOffset.y };

                await animateTo(prevPos, dest, i === 0 ? 700 : 550, setCursorPos, rafRef);
                if (cancelled()) return;
                prevPos = dest;

                await wait(80, timerRef); if (cancelled()) return;

                onSimulateRegionHover?.(mask.id);
                setCursorTooltipAbove(dest.y < containerHeight * 0.22);
                setCursorTooltipText(mask.label);
                setCursorTooltipVisible(true);

                await wait(1400, timerRef); if (cancelled()) return;

                onSimulateRegionHover?.(null);
                setCursorTooltipVisible(false);
                await wait(200, timerRef); if (cancelled()) return;
            }

            if (cancelled()) return;

            // ── Click the first mask that is still NOT in the list ───────────
            const freshRegions = regionsRef.current;
            const clickTarget = tourMasks.find(m => {
                const r = freshRegions.find(r => r.id === m.id);
                return !r?.hasEdits;
            });
            if (!clickTarget) {
                setCursorVisible(false);
                await wait(500, timerRef); if (cancelled()) return;
                continue;
            }
            const clickDest = { x: clickTarget.absCx + panOffset.x, y: clickTarget.absCy + panOffset.y };

            await animateTo(prevPos, clickDest, 500, setCursorPos, rafRef);
            if (cancelled()) return;

            await wait(80, timerRef); if (cancelled()) return;
            onSimulateRegionHover?.(clickTarget.id);
            setCursorTooltipAbove(clickDest.y < containerHeight * 0.22);
            setCursorTooltipText('Click to add masks you need.');
            setCursorTooltipVisible(true);
            await wait(700, timerRef); if (cancelled()) return;

            setCursorClicking(true);
            onSimulateRegionClick?.(clickTarget.id);
            await wait(60, timerRef); if (cancelled()) return;
            setCursorClicking(false);
            onSimulateRegionHover?.(null);

            await wait(900, timerRef); if (cancelled()) return;
            setCursorTooltipVisible(false);
            onSimulateRegionDeselect?.();
            await wait(350, timerRef); if (cancelled()) return;

            // Exit right before looping
            setCursorVisible(false);
            await wait(500, timerRef); if (cancelled()) return;
        }
    }, [containerWidth, containerHeight, panOffset.x, panOffset.y, onStopWave, onSimulateRegionClick, onSimulateRegionHover, onSimulateRegionDeselect]);

    // Start once masks are ready
    useEffect(() => {
        if (!isWalkthroughActive || masks.length === 0 || containerWidth === 0) return;
        if (hasRunRef.current) return;
        hasRunRef.current = true;
        runWalkthrough(masks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isWalkthroughActive, masks.length, containerWidth]);

    // Cancel immediately when user clicks
    useEffect(() => {
        if (!isWalkthroughActive) {
            cancelledRef.current = true;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (timerRef.current) clearTimeout(timerRef.current);
            setCursorVisible(false);
            setCursorTooltipVisible(false);
            setIntroVisible(false);
            setMasks([]);
            hasRunRef.current = false;
        }
    }, [isWalkthroughActive]);


    if (!imageTransform || !isWalkthroughActive || masks.length === 0) return null;

    return (
        <div className="absolute inset-0 z-20 pointer-events-none">
            {/* Phase 1: intro tooltip */}
            <IntroTooltip visible={introVisible} containerWidth={containerWidth} containerHeight={containerHeight} />

            {/* Virtual cursor */}
            <VirtualCursor x={cursorPos.x} y={cursorPos.y} clicking={cursorClicking} visible={cursorVisible} />

            {/* Cursor label tooltip */}
            <CursorTooltip
                x={cursorPos.x} y={cursorPos.y}
                text={cursorTooltipText}
                visible={cursorTooltipVisible}
                above={cursorTooltipAbove}
            />

            {/* Full-canvas light sweep — one diagonal band across the whole image once */}
            {!isWaveStopped && (
                <div className="absolute overflow-hidden pointer-events-none" style={{
                    left: imageTransform.x + panOffset.x,
                    top: imageTransform.y + panOffset.y,
                    width: imageTransform.width,
                    height: imageTransform.height,
                }}>
                    <div className="absolute inset-0" style={{
                        background: 'linear-gradient(-45deg, transparent 35%, rgba(255,255,255,0.55) 47%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0.55) 53%, transparent 65%)',
                        backgroundSize: '300% 300%',
                        backgroundRepeat: 'no-repeat',
                        animation: 'walkthrough-canvas-flash 1.1s linear 1 forwards',
                        mixBlendMode: 'screen',
                    }} />
                </div>
            )}

            {/* Per-mask wave sweep + hover overlays */}
            <div className="absolute overflow-hidden" style={{
                left: imageTransform.x + panOffset.x,
                top: imageTransform.y + panOffset.y,
                width: imageTransform.width,
                height: imageTransform.height,
                willChange: 'transform',
            }}>
                {animatedMasks.map(mask => {
                    const isHovered = mask.id === hoveredRegionId;
                    return (
                        <div key={mask.id} className="absolute inset-0 pointer-events-none">
                            <div className="absolute inset-0 pointer-events-none" style={{
                                WebkitMaskImage: `url(${mask.alphaUrl})`,
                                maskImage: `url(${mask.alphaUrl})`,
                                WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
                                opacity: 1,
                                transformOrigin: `${mask.cx}% ${mask.cy}%`,
                                willChange: 'opacity, transform',
                                ...(isHovered ? {
                                    animation: mask.type === 'background'
                                        ? 'walkthrough-bg-bounce 2s ease-in-out infinite'
                                        : 'walkthrough-bounce 2s ease-in-out infinite',
                                } : {}),
                            }}>
                                {isHovered ? (
                                    <img src={mask.colorUrl} alt=""
                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                        style={{ objectFit: 'fill', mixBlendMode: 'normal' }} />
                                ) : !isWaveStopped ? (
                                    <img src={mask.colorUrl} alt=""
                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                        style={{
                                            objectFit: 'fill',
                                            WebkitMaskImage: 'linear-gradient(-45deg, transparent 40%, black 46%, black 54%, transparent 60%)',
                                            maskImage: 'linear-gradient(-45deg, transparent 40%, black 46%, black 54%, transparent 60%)',
                                            WebkitMaskSize: '300% 300%', maskSize: '300% 300%',
                                            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                                            animation: `walkthrough-mask-pos ${mask.totalDuration}s linear 1 forwards`,
                                            animationDelay: `${mask.delay}s`,
                                        }} />
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
