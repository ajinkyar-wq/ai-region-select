import { useEffect, useRef, useCallback } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';
import { getMaskCenter } from '@/lib/mask-analysis';

interface SmartMaskLayerProps {
    tile: ImageTileData;
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    width: number;
    height: number;
    peopleEnabled: boolean;
    backgroundEnabled: boolean;
    hoveredRegionId: string | null;
    isEditing: boolean;
    onHoverChange: (id: string | null) => void;
    onUpdateTile: (updates: Partial<ImageTileData>) => void;
    onEditRegion: (region: Region) => void;
    onEnterLocalEdit?: (region: Region) => void;
    canvasInteractionsEnabled?: boolean;
    isWalkthroughActive?: boolean;
    isManualToolActive?: boolean;
}

// ─── Erosion ──────────────────────────────────────────────────────────────────

const ERODE_RADIUS = 12;

function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] <= 30) continue;
            let eroded = false;
            outer: for (let ny = y - radius; ny <= y + radius; ny++) {
                for (let nx = x - radius; nx <= x + radius; nx++) {
                    // out-of-bounds counts as empty — so edge pixels erode inward
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h || mask[ny * w + nx] <= 30) {
                        eroded = true; break outer;
                    }
                }
            }
            if (!eroded) out[y * w + x] = mask[y * w + x];
        }
    }
    return out;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface ErodedEntry {
    eroded: Uint8Array;
    // checksum to detect mask data changes within same region id
    checksum: number;
}

/** Fast checksum — sum every 64th byte */
function maskChecksum(mask: Uint8Array): number {
    let s = 0;
    for (let i = 0; i < mask.length; i += 64) s += mask[i];
    return s;
}

function getOrBuildErodedEntry(
    region: Region,
    erodeCache: Map<string, ErodedEntry | null>,
): ErodedEntry | null {
    const cs = maskChecksum(region.maskData);
    const existing = erodeCache.get(region.id);

    // Rebuild if missing or mask has changed
    if (!existing || existing.checksum !== cs) {
        const { maskData: mask, maskWidth: w, maskHeight: h } = region;
        const eroded = erodeMask(mask, w, h, ERODE_RADIUS);
        const hasCore = eroded.some(v => v > 30);
        if (!hasCore) {
            erodeCache.set(region.id, null);
            return null;
        }
        const entry: ErodedEntry = { eroded, checksum: cs };
        erodeCache.set(region.id, entry);
        return entry;
    }

    return existing;
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

function hitTestPerson(
    x: number,
    y: number,
    region: Region,
    transform: { width: number; height: number },
    erodeCache: Map<string, ErodedEntry | null>,
): 'inner' | 'outer' | null {
    const scaleX = region.maskWidth / transform.width;
    const scaleY = region.maskHeight / transform.height;
    const mx = Math.floor(x * scaleX);
    const my = Math.floor(y * scaleY);

    if (mx < 0 || mx >= region.maskWidth || my < 0 || my >= region.maskHeight) return null;
    if (region.maskData[my * region.maskWidth + mx] <= 30) return null;

    const entry = getOrBuildErodedEntry(region, erodeCache);
    if (!entry) return 'inner'; // mask too thin — all inner

    return entry.eroded[my * region.maskWidth + mx] > 30 ? 'inner' : 'outer';
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderMask(
    ctx: CanvasRenderingContext2D,
    mask: Uint8Array,
    w: number, h: number,
    rC: number, gC: number, bC: number,
    overlayAlpha: number,
    destX: number, destY: number, destW: number, destH: number,
) {
    const scratch = document.createElement('canvas');
    scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d');
    if (!sctx) return;

    const img = sctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
        const v = mask[i];
        if (v > 0) {
            const p = i * 4;
            img.data[p] = rC;
            img.data[p + 1] = gC;
            img.data[p + 2] = bC;
            img.data[p + 3] = Math.round((v / 255) * overlayAlpha * 255);
        }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scratch, destX, destY, destW, destH);
    ctx.restore();
}

// ─── Contour tracing ──────────────────────────────────────────────────────────

/**
 * Render a smooth, single external contour line.
 * Uses a flood-fill algorithm to definitively isolate the absolute major outer
 * boundary, completely ignoring all internal hollows or disjointed holes.
 * The strict 1px edge is then mapped back to the canvas with native interpolation
 * to naturally smooth out the jagged pixel boundaries.
 */
function renderContourStroke(
    ctx: CanvasRenderingContext2D,
    mask: Uint8Array,
    w: number, h: number,
    rC: number, gC: number, bC: number,
    alpha255: number,
    destX: number, destY: number, destW: number, destH: number,
    clipMasks?: { data: Uint8Array, w: number, h: number }[],
    lineWidthMultiplier: number = 2
) {
    // 1. Flood-fill to discover the true exterior space (ignoring internal holes)
    const exterior = new Uint8Array(w * h);
    const qx = new Int32Array(w * h);
    const qy = new Int32Array(w * h);
    let head = 0; let tail = 0;

    const pushQ = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = y * w + x;
        if (exterior[i] === 1) return;
        if (mask[i] > 30) return;
        exterior[i] = 1;
        qx[tail] = x; qy[tail] = y; tail++;
    };

    for (let x = 0; x < w; x++) { pushQ(x, 0); pushQ(x, h - 1); }
    for (let y = 0; y < h; y++) { pushQ(0, y); pushQ(w - 1, y); }

    while (head < tail) {
        const x = qx[head]; const y = qy[head]; head++;
        pushQ(x + 1, y); pushQ(x - 1, y); pushQ(x, y + 1); pushQ(x, y - 1);
    }

    // 2. Create a solid mask that explicitly plugs internal holes to guarantee 1 contour
    const solidMask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) {
        solidMask[i] = (mask[i] > 30 || exterior[i] === 0) ? 255 : 0;
    }

    // 3. Fast Box Blur on the solid mask to create a smooth mathematical gradient
    // This allows Interpolated Marching Squares to draw perfectly swooping curves instead of 45-deg angles.
    const radius = 6;
    const blurred = new Uint8Array(w * h);
    const temp = new Uint16Array(w * h);

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

    // 4. Interpolated Marching Squares 
    // This converts the image grid smartly into a perfectly smooth vector path calculation
    const path = new Path2D();
    const iso = 127;
    const interp = (v1: number, v2: number) => (v1 === v2) ? 0.5 : (iso - v1) / (v2 - v1);

    for (let y = 0; y < h - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
            const tl = blurred[y * w + x];
            const tr = blurred[y * w + x + 1];
            const bl = blurred[(y + 1) * w + x];
            const br = blurred[(y + 1) * w + x + 1];

            let state = 0;
            if (tl >= iso) state |= 8;
            if (tr >= iso) state |= 4;
            if (br >= iso) state |= 2;
            if (bl >= iso) state |= 1;

            if (state === 0 || state === 15) continue;

            const getT = () => ({ x: x + interp(tl, tr), y: y });
            const getR = () => ({ x: x + 1, y: y + interp(tr, br) });
            const getB = () => ({ x: x + interp(bl, br), y: y + 1 });
            const getL = () => ({ x: x, y: y + interp(tl, bl) });

            let pts = [];
            switch (state) {
                case 1: pts = [getL(), getB()]; break;
                case 2: pts = [getB(), getR()]; break;
                case 3: pts = [getL(), getR()]; break;
                case 4: pts = [getR(), getT()]; break;
                case 5: pts = [getL(), getT(), getB(), getR()]; break;
                case 6: pts = [getB(), getT()]; break;
                case 7: pts = [getL(), getT()]; break;
                case 8: pts = [getT(), getL()]; break;
                case 9: pts = [getT(), getB()]; break;
                case 10: pts = [getT(), getR(), getL(), getB()]; break;
                case 11: pts = [getT(), getR()]; break;
                case 12: pts = [getR(), getL()]; break;
                case 13: pts = [getR(), getB()]; break;
                case 14: pts = [getB(), getL()]; break;
            }

            if (pts.length >= 2) {
                path.moveTo(pts[0].x, pts[0].y);
                path.lineTo(pts[1].x, pts[1].y);
            }
            if (pts.length === 4) {
                path.moveTo(pts[2].x, pts[2].y);
                path.lineTo(pts[3].x, pts[3].y);
            }
        }
    }

    // 5. Draw the smart vector line onto a scratch canvas
    const scW = Math.floor(destW) || 1;
    const scH = Math.floor(destH) || 1;

    const scratch = document.createElement('canvas');
    scratch.width = scW; scratch.height = scH;
    const sctx = scratch.getContext('2d')!;

    sctx.scale(scW / w, scH / h);
    sctx.strokeStyle = `rgba(${rC}, ${gC}, ${bC}, ${alpha255 / 255})`;
    sctx.lineWidth = Math.max(lineWidthMultiplier * 0.75, w / scW * lineWidthMultiplier);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    sctx.stroke(path);

    // 6. Intersection Logic: Multiply the line by the clip masks directly
    if (clipMasks && clipMasks.length > 0) {
        sctx.resetTransform();
        const lineImg = sctx.getImageData(0, 0, scW, scH);
        for (let y = 0; y < scH; y++) {
            for (let x = 0; x < scW; x++) {
                const p = (y * scW + x) * 4;
                if (lineImg.data[p + 3] === 0) continue;

                let maxClip = 0;
                for (const cm of clipMasks) {
                    const cx = Math.min(Math.floor((x / scW) * cm.w), cm.w - 1);
                    const cy = Math.min(Math.floor((y / scH) * cm.h), cm.h - 1);
                    const clipVal = cm.data[cy * cm.w + cx];
                    if (clipVal > maxClip) maxClip = clipVal;
                }
                lineImg.data[p + 3] = Math.round((lineImg.data[p + 3] * maxClip) / 255);
            }
        }
        sctx.putImageData(lineImg, 0, 0);
    }

    // 7. Render contour line onto main canvas
    ctx.drawImage(scratch, destX, destY, destW, destH);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SmartMaskLayer({
    tile,
    imageTransform,
    width,
    height,
    peopleEnabled,
    backgroundEnabled,
    hoveredRegionId,
    isEditing,
    onHoverChange,
    onUpdateTile,
    onEditRegion,
    onEnterLocalEdit,
    canvasInteractionsEnabled = true,
    isWalkthroughActive = false,
    isManualToolActive = false,
}: SmartMaskLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Cache persists across renders; checksum-based invalidation handles mask edits
    const erodeCache = useRef<Map<string, ErodedEntry | null>>(new Map());

    const toolHandlesRef = useRef<{ x: number, y: number, time?: number }[]>([]);
    const pathHistoryRef = useRef<{ x: number, y: number, time: number }[]>([]);

    useEffect(() => {
        if (!imageTransform) return;
        const handles: { x: number, y: number }[] = [];
        tile.regions.forEach(r => {
            if (!r.visible) return;
            if (r.type === 'linear-gradient' && r.gradient) {
                handles.push({ x: r.gradient.start.x * imageTransform.width, y: r.gradient.start.y * imageTransform.height });
                handles.push({ x: r.gradient.end.x * imageTransform.width, y: r.gradient.end.y * imageTransform.height });
            } else if (r.type === 'radial-gradient' && r.radialGradient) {
                handles.push({ x: r.radialGradient.center.x * imageTransform.width, y: r.radialGradient.center.y * imageTransform.height });
            } else if (r.type === 'manual' && r.maskData && r.selected) {
                const center = getMaskCenter(r.maskData, r.maskWidth, r.maskHeight);
                if (center) {
                    const scaleX = imageTransform.width / r.maskWidth;
                    const scaleY = imageTransform.height / r.maskHeight;
                    handles.push({
                        x: (center.x + (r.offset?.x || 0)) * scaleX,
                        y: (center.y + (r.offset?.y || 0)) * scaleY
                    });
                }
            }
        });
        toolHandlesRef.current = handles;
    }, [tile.regions, imageTransform]);

    // ── Render ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!canvasRef.current || !imageTransform) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (isEditing) return;

        const { x: destX, y: destY, width: destW, height: destH } = imageTransform;

        const visibleRegions = tile.regions.filter(r => {
            if (r.type === 'person' && !peopleEnabled) return false;
            if ((r.type === 'background' || r.type.startsWith('background-')) && !backgroundEnabled) return false;
            if (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') return false;
            if (!canvasInteractionsEnabled) return r.id === hoveredRegionId;
            return r.visible;
        });

        // Pre-compute clip-children map: parentId -> gradient regions clipped to it
        const clipChildrenByParent: Record<string, Region[]> = {};
        tile.regions.forEach(r => {
            if (r.clipParentId && (r.type === 'linear-gradient' || r.type === 'radial-gradient' || r.type === 'manual') && r.visible) {
                if (!clipChildrenByParent[r.clipParentId]) clipChildrenByParent[r.clipParentId] = [];
                clipChildrenByParent[r.clipParentId].push(r);
            }
        });
        // Also map clip-children that point to a group (clipParentId = groupId)
        // by resolving which group members have maskData
        const clipChildrenByGroup: Record<string, Region[]> = {};
        tile.regions.forEach(r => {
            if (r.clipParentId && (r.type === 'linear-gradient' || r.type === 'radial-gradient' || r.type === 'manual') && r.visible) {
                // Check if this clipParentId is actually a groupId
                const isGroupId = !tile.regions.some(p => p.id === r.clipParentId) &&
                    tile.regions.some(p => p.groupId === r.clipParentId);
                if (isGroupId) {
                    if (!clipChildrenByGroup[r.clipParentId]) clipChildrenByGroup[r.clipParentId] = [];
                    clipChildrenByGroup[r.clipParentId].push(r);
                }
            }
        });

        visibleRegions.forEach(region => {
            const shouldDrawHover = region.id === hoveredRegionId && !isWalkthroughActive;
            if (!region.selected && !shouldDrawHover) return;

            const mask = region.maskData;
            const w = region.maskWidth;
            const h = region.maskHeight;

            const cm = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
            const rC = cm ? parseInt(cm[1], 16) : 255;
            const gC = cm ? parseInt(cm[2], 16) : 80;
            const bC = cm ? parseInt(cm[3], 16) : 80;

            // Fill opacity: simple two states — selected is denser, hover is lighter
            const isHovered = shouldDrawHover;
            const overlayAlpha = region.selected ? 0.5 : 0.3;

            // Hover = boldest affordance. Selected = already done, back off significantly.
            const contourAlpha255 = !region.selected && isHovered ? 190   // pure hover: strong but not blasting
                : region.selected && isHovered ? 120                       // selected+hovered: moderate
                    : 70;                                                      // selected only: very quiet
            const contourLineWidth = !region.selected && isHovered ? 2    // hover: bold
                : region.selected && isHovered ? 1.75                     // selected+hovered: normal
                    : 1.5;                                                     // selected only: thin


            // Helper to recursively compute the UNION of all effective branches starting from a set of clip-children.
            const getUnionOfClipBranches = (kids: Region[], baseW: number, baseH: number): Uint8Array | null => {
                if (kids.length === 0) return null;

                const union = new Uint8Array(baseW * baseH);
                let hasData = false;

                for (const kid of kids) {
                    // Recursive call: what is the kid's own branch shape?
                    const kidEffective = getEffectiveMaskUnion(kid.id, kid.maskData, kid.maskWidth, kid.maskHeight);
                    const kW = kid.maskWidth;
                    const kH = kid.maskHeight;

                    for (let py = 0; py < baseH; py++) {
                        for (let px = 0; px < baseW; px++) {
                            const cx = Math.min(Math.floor((px / baseW) * kW), kW - 1);
                            const cy = Math.min(Math.floor((py / baseH) * kH), kH - 1);
                            const val = kidEffective[cy * kW + cx];
                            if (val > 0) {
                                union[py * baseW + px] = Math.max(union[py * baseW + px], val);
                                hasData = true;
                            }
                        }
                    }
                }
                return hasData ? union : null;
            };

            // Pre-declare a helper to recursively compute the shape of a region as constrained by its own clip children.
            const getEffectiveMaskUnion = (regionId: string, baseMask: Uint8Array, w: number, h: number): Uint8Array => {
                const kids = clipChildrenByParent[regionId] || [];
                if (kids.length === 0) return baseMask;

                const branchUnion = getUnionOfClipBranches(kids, w, h);
                if (!branchUnion) return baseMask;

                // Intersect the base mask with the union of its clip children
                const result = new Uint8Array(w * h);
                for (let i = 0; i < baseMask.length; i++) {
                    result[i] = Math.min(baseMask[i], branchUnion[i]);
                }
                return result;
            };

            const directClipKids = clipChildrenByParent[region.id] || [];
            const groupClipKids = region.groupId ? (clipChildrenByGroup[region.groupId] || []) : [];

            // 1. Calculate the union of all group-level constraints
            const groupUnion = getUnionOfClipBranches(groupClipKids, w, h);
            // 2. Calculate the union of all direct-level constraints
            const directUnion = getUnionOfClipBranches(directClipKids, w, h);

            if (groupUnion || directUnion) {
                const finalMask = new Uint8Array(w * h);
                for (let i = 0; i < mask.length; i++) {
                    const baseVal = mask[i];
                    if (baseVal <= 0) continue;

                    let effectiveVal = baseVal;
                    // Intersect with Group Union if it exists
                    if (groupUnion) effectiveVal = Math.min(effectiveVal, groupUnion[i]);
                    // Intersect with Direct Union if it exists
                    if (directUnion) effectiveVal = Math.min(effectiveVal, directUnion[i]);

                    finalMask[i] = effectiveVal;
                }

                if (finalMask.some(v => v > 0)) {
                    renderMask(ctx, finalMask, w, h, rC, gC, bC, overlayAlpha, destX, destY, destW, destH);
                }
            } else {
                // No clips at all — render base rubylith
                renderMask(ctx, mask, w, h, rC, gC, bC, overlayAlpha, destX, destY, destW, destH);
            }

            // Pass 2 — soft contour
            // The contour must be clipped by the EXACT SAME combined constraints as the fill.
            // We pass a single composite clip mask to renderContourStroke.
            let compositeContourClip: { data: Uint8Array, w: number, h: number } | undefined = undefined;

            if (groupUnion || directUnion) {
                const combined = new Uint8Array(w * h);
                for (let i = 0; i < combined.length; i++) {
                    let val = 255;
                    if (groupUnion) val = Math.min(val, groupUnion[i]);
                    if (directUnion) val = Math.min(val, directUnion[i]);
                    combined[i] = val;
                }
                compositeContourClip = { data: combined, w, h };
            }

            const clipMasksPayload = compositeContourClip ? [compositeContourClip] : [];

            if (region.type === 'person') {
                const hasMultiplePeople = tile.regions.filter(r => r.type === 'person').length > 1;
                if (hasMultiplePeople) {
                    const entry = getOrBuildErodedEntry(region, erodeCache.current);
                    const contourMask = entry && entry.eroded ? entry.eroded : mask;
                    renderContourStroke(ctx, contourMask, w, h, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
                }
            } else if (region.type === 'people-group') {
                tile.regions.forEach(ch => {
                    if (ch.type === 'person') {
                        const entry = getOrBuildErodedEntry(ch, erodeCache.current);
                        const contourMask = entry && entry.eroded ? entry.eroded : ch.maskData;
                        renderContourStroke(ctx, contourMask, ch.maskWidth, ch.maskHeight, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
                    }
                });
            } else if (region.type.startsWith('background-')) {
                const hasMultipleChildren = tile.regions.filter(r => r.type.startsWith('background-')).length > 1;
                if (hasMultipleChildren) {
                    const entry = getOrBuildErodedEntry(region, erodeCache.current);
                    const contourMask = entry && entry.eroded ? entry.eroded : mask;
                    renderContourStroke(ctx, contourMask, w, h, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
                }
            } else if (region.type === 'background') {
                tile.regions.forEach(ch => {
                    if (ch.type.startsWith('background-')) {
                        const entry = getOrBuildErodedEntry(ch, erodeCache.current);
                        const contourMask = entry && entry.eroded ? entry.eroded : ch.maskData;
                        renderContourStroke(ctx, contourMask, ch.maskWidth, ch.maskHeight, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
                    }
                });
            }
            // subject: fill only, no contour
        });

    }, [tile.regions, imageTransform, hoveredRegionId, isEditing, peopleEnabled, backgroundEnabled, width, height, canvasInteractionsEnabled]);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const toImageCoords = (e: React.MouseEvent): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas || !imageTransform) return null;
        const rect = canvas.getBoundingClientRect();
        const canvasX = (e.clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = (e.clientY - rect.top) * (canvas.height / rect.height);
        const x = canvasX - imageTransform.x;
        const y = canvasY - imageTransform.y;
        if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) return null;
        return { x, y };
    };

    const resolveHit = (x: number, y: number): Region | null => {
        if (!imageTransform) return null;

        for (let i = tile.regions.length - 1; i >= 0; i--) {
            const region = tile.regions[i];

            if (region.type === 'manual' || region.type === 'linear-gradient' || region.type === 'radial-gradient') continue;

            if (region.type === 'person') {
                if (!peopleEnabled) continue;
                const hit = hitTestPerson(x, y, region, imageTransform, erodeCache.current);
                if (!hit) continue;

                const pg = tile.regions.find(r => r.type === 'people-group');

                if (hit === 'inner') return region;
                return pg ?? region;
            }

            // Skip background in main loop — handle after landscape
            if (region.type === 'background') continue;

            if (region.type.startsWith('background-')) {
                const hit = hitTestPerson(x, y, region, imageTransform, erodeCache.current);
                if (!hit) continue;
                if (hit === 'inner') return region;
                const bg = tile.regions.find(r => r.type === 'background');
                return bg ?? region;
            }

            // subject and people-group — simple pixel test
            if (!region.visible) continue;
            const scaleX = region.maskWidth / imageTransform.width;
            const scaleY = region.maskHeight / imageTransform.height;
            const idx = Math.floor(y * scaleY) * region.maskWidth + Math.floor(x * scaleX);
            if (idx >= 0 && idx < region.maskData.length && region.maskData[idx] > 30) return region;
        }

        // Background fallback — only if no landscape inner hit claimed the click
        if (backgroundEnabled) {
            const bg = tile.regions.find(r => r.type === 'background');
            if (bg) {
                const scaleX = bg.maskWidth / imageTransform.width;
                const scaleY = bg.maskHeight / imageTransform.height;
                const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);
                if (idx >= 0 && idx < bg.maskData.length && bg.maskData[idx] > 30) return bg;
            }
        }

        return null;
    };

    // ── Event handlers ────────────────────────────────────────────────────────

    const handleMouseLeaveCanvas = useCallback(() => {
        onHoverChange(null);
    }, [onHoverChange]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!canvasInteractionsEnabled) return;
        if (isEditing) return;

        // When something is selected in the right panel, gate hover behind Shift
        if (tile.regions.some(r => r.selected) && !e.shiftKey) {
            if (hoveredRegionId) onHoverChange(null);
            return;
        }

        const coords = toImageCoords(e);

        if (!coords) {
            handleMouseLeaveCanvas();
            return;
        }

        const hit = resolveHit(coords.x, coords.y);

        if (!hit) {
            handleMouseLeaveCanvas();
            return;
        }

        let isTargetingTool = false;
        if (!isManualToolActive) {
            for (const handle of toolHandlesRef.current) {
                const handleDist = Math.hypot(coords.x - handle.x, coords.y - handle.y);
                if (handleDist < 80) { // 80px magnetic halo
                    isTargetingTool = true;
                    break;
                }
            }
        }

        if (isTargetingTool) {
            if (hoveredRegionId) onHoverChange(null);
            return;
        }

        if (hit.id !== hoveredRegionId) {
            onHoverChange(hit.id);
        }
    };

    const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Snapshot of selected region captured at mousedown, before click processing clears it
    const selectedAtMouseDownRef = useRef<Region | null>(null);

    const handleCanvasMouseDown = () => {
        selectedAtMouseDownRef.current = tile.regions.find(r => r.selected) ?? null;
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (!canvasInteractionsEnabled) return;
        const isMultiToggle = e.ctrlKey || e.metaKey;
        const isAdditive = e.shiftKey || isMultiToggle;
        if (tile.regions.some(r => r.selected) && !isAdditive) {
            // Only block if cursor is actually over a region — empty space should deselect
            const coords2 = toImageCoords(e);
            const hitCheck = coords2 ? resolveHit(coords2.x, coords2.y) : null;
            if (hitCheck) {
                e.stopPropagation();
                return;
            }
            // No hit → let it bubble to background deselect
            return;
        }
        const coords = toImageCoords(e);
        if (!coords) return;

        const clickedRegion = resolveHit(coords.x, coords.y);

        if (clickedRegion) {
            e.stopPropagation();
            const performSelectionUpdate = () => {
                let updatedRegions = tile.regions.map(r => {
                    if (isAdditive) {
                        const isBecomingSelected = r.id === clickedRegion.id ? !r.selected : r.selected;
                        return { ...r, selected: isBecomingSelected, hasEdits: isBecomingSelected ? true : r.hasEdits };
                    }
                    const isBecomingSelected = r.id === clickedRegion.id;
                    return { ...r, selected: isBecomingSelected, hasEdits: isBecomingSelected ? true : r.hasEdits };
                });

                const selectedStandalone = updatedRegions.filter(r => r.selected && !r.clipParentId);
                if (selectedStandalone.length > 1) {
                    const firstGroup = selectedStandalone[0].groupId;
                    const allSameGroup = firstGroup && selectedStandalone.every(r => r.groupId === firstGroup);

                    if (!allSameGroup) {
                        const targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
                        updatedRegions = updatedRegions.map(r => {
                            if (r.selected && !r.clipParentId) {
                                return { ...r, groupId: targetGroupId };
                            }
                            return r;
                        });
                    }
                }

                onUpdateTile({ regions: updatedRegions });
            };
            if (!isMultiToggle && clickedRegion.selected) {
                if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
                clickTimeoutRef.current = setTimeout(performSelectionUpdate, 250);
            } else {
                performSelectionUpdate();
            }
            const isDeselecting = isAdditive && clickedRegion.selected;
            if (!isDeselecting) onEditRegion(clickedRegion);
        }
    };

    const handleCanvasDoubleClick = (e: React.MouseEvent) => {
        if (!canvasInteractionsEnabled) return;
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        const coords = toImageCoords(e);
        // Use the selection snapshot captured at mousedown
        const snapshotSelected = selectedAtMouseDownRef.current;
        if (coords) {
            const hit = resolveHit(coords.x, coords.y);
            const target = snapshotSelected ?? hit;
            if (!target) return;
            onEditRegion(target);
            if (onEnterLocalEdit) onEnterLocalEdit(target);
            else onEditRegion(target);
        } else if (snapshotSelected) {
            // No image coords but something was selected — still enter edit
            onEditRegion(snapshotSelected);
            if (onEnterLocalEdit) onEnterLocalEdit(snapshotSelected);
            else onEditRegion(snapshotSelected);
        }
    };

    return (
        <canvas
            ref={canvasRef}
            className={`absolute inset-0 z-10 pointer-events-auto ${canvasInteractionsEnabled ? 'cursor-pointer' : 'cursor-default'}`}
            onMouseDown={handleCanvasMouseDown}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeaveCanvas}
        />
    );
}