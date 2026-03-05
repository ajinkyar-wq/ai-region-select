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
}

// ─── Erosion ──────────────────────────────────────────────────────────────────

const ERODE_RADIUS = 12;

function erodeMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x] <= 30) continue;
            let eroded = false;
            const y0 = Math.max(0, y - radius);
            const y1 = Math.min(h - 1, y + radius);
            const x0 = Math.max(0, x - radius);
            const x1 = Math.min(w - 1, x + radius);
            outer: for (let ny = y0; ny <= y1; ny++) {
                for (let nx = x0; nx <= x1; nx++) {
                    if (mask[ny * w + nx] <= 30) { eroded = true; break outer; }
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
            if (r.type === 'background' && !backgroundEnabled) return false;
            if (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') return false;
            if (!canvasInteractionsEnabled) {
                if (r.type === 'background' || r.type === 'people-group') return r.hasEdits !== false;
                return !!r.hasEdits;
            }
            return r.visible;
        });

        // Pre-compute clip-children map: parentId -> gradient regions clipped to it
        const clipChildrenByParent: Record<string, Region[]> = {};
        tile.regions.forEach(r => {
            if (r.clipParentId && (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.visible) {
                if (!clipChildrenByParent[r.clipParentId]) clipChildrenByParent[r.clipParentId] = [];
                clipChildrenByParent[r.clipParentId].push(r);
            }
        });
        // Also map clip-children that point to a group (clipParentId = groupId)
        // by resolving which group members have maskData
        const clipChildrenByGroup: Record<string, Region[]> = {};
        tile.regions.forEach(r => {
            if (r.clipParentId && (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.visible) {
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


            // Collect all clip-children for this region (direct + via group)
            const directClipKids = clipChildrenByParent[region.id] || [];
            const groupClipKids = region.groupId ? (clipChildrenByGroup[region.groupId] || []) : [];
            const allClipKids = [...directClipKids, ...groupClipKids];

            if (allClipKids.length > 0) {
                // ── Intersection rendering ──────────────────────────────────────
                // Show the INTERSECTION of the parent mask with each gradient.
                // For each clip-child: compute parent ∩ gradient and render it.
                // This gives the user a clear view of the effective mask regions.

                // First, render a dimmed version of the parent mask as context
                // REMOVED per user request: "other side of gradient needs to be blank"
                // renderMask(ctx, mask, w, h, rC, gC, bC, overlayAlpha * 0.3, destX, destY, destW, destH);

                // Then render each intersection at full overlay alpha
                allClipKids.forEach(child => {
                    // Compute intersection: min(parent[pixel], gradient[pixel]) at each pixel
                    // We need to resample both masks to the same resolution.
                    // Use the parent mask dimensions as the target.
                    const iW = w;
                    const iH = h;
                    const intersected = new Uint8Array(iW * iH);

                    const cW = child.maskWidth;
                    const cH = child.maskHeight;

                    for (let py = 0; py < iH; py++) {
                        for (let px = 0; px < iW; px++) {
                            // Parent mask value at this pixel
                            const parentVal = mask[py * iW + px];
                            if (parentVal <= 0) continue;

                            // Sample child mask at corresponding position
                            const cx = Math.min(Math.floor((px / iW) * cW), cW - 1);
                            const cy = Math.min(Math.floor((py / iH) * cH), cH - 1);
                            const childVal = child.maskData[cy * cW + cx];

                            // Intersection = min of both
                            intersected[py * iW + px] = Math.min(parentVal, childVal);
                        }
                    }

                    // Render the intersection using the region's own color
                    renderMask(ctx, intersected, iW, iH, rC, gC, bC, overlayAlpha, destX, destY, destW, destH);

                    // DELETED: renderContourStroke on intersected mask
                    // Why? Because gradients produce ugly internal contour lines where they fade out.
                    // The user wants "just the contour showcase only", which implies the clean original boundary.
                });
            } else {
                // Pass 1 — rubylith wash over the full mask (no clip-children or not selected)
                renderMask(ctx, mask, w, h, rC, gC, bC, overlayAlpha, destX, destY, destW, destH);
            }

            // Pass 2 — soft contour
            // The contour is now ALWAYS drawn if the region is actively rendering.
            // Gradients (allClipKids) are passed in to dictate where the contour fades out visually.
            const clipMasksPayload = allClipKids.map(k => ({ data: k.maskData, w: k.maskWidth, h: k.maskHeight }));

            if (region.type === 'person') {
                // Soft, solid line using the Adobe mask's inherent color (rC, gC, bC)
                // Drawn on the eroded mask edge to visualize the exact hit-detection 
                // threshold between the outer (group) and inner (individual) selection logic.
                const entry = getOrBuildErodedEntry(region, erodeCache.current);
                const contourMask = entry && entry.eroded ? entry.eroded : mask;
                renderContourStroke(ctx, contourMask, w, h, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
            } else if (region.type === 'people-group') {
                // The group mask shouldn't have its own massive outer contour.
                // Instead, it should draw the *exact same inner contours* that the individual
                // person masks draw, to show exactly what makes up the group.
                tile.regions.forEach(ch => {
                    if (ch.type === 'person') {
                        const entry = getOrBuildErodedEntry(ch, erodeCache.current);
                        const contourMask = entry && entry.eroded ? entry.eroded : ch.maskData;
                        renderContourStroke(ctx, contourMask, ch.maskWidth, ch.maskHeight, rC, gC, bC, contourAlpha255, destX, destY, destW, destH, clipMasksPayload, contourLineWidth);
                    }
                });
            }
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

    const isOnList = (r: Region) => {
        if (r.type === 'background' || r.type === 'people-group') return r.hasEdits !== false;
        return !!r.hasEdits;
    };

    const resolveHit = (x: number, y: number): Region | null => {
        if (!imageTransform) return null;

        for (let i = tile.regions.length - 1; i >= 0; i--) {
            const region = tile.regions[i];
            if (region.type !== 'person' || !peopleEnabled) continue;
            // Always hit-test — never skip. Filter the result after.
            const hit = hitTestPerson(x, y, region, imageTransform, erodeCache.current);
            if (!hit) continue;

            const pg = tile.regions.find(r => r.type === 'people-group');

            if (!canvasInteractionsEnabled) {
                // Return the most specific on-list candidate
                if (hit === 'inner' && isOnList(region)) return region;
                if (pg && isOnList(pg)) return pg;
                if (isOnList(region)) return region;
                return null;
            }

            if (hit === 'inner') return region;
            return pg ?? region;
        }

        const bg = tile.regions.find(r => r.type === 'background');
        if (bg && backgroundEnabled) {
            if (!canvasInteractionsEnabled && !isOnList(bg)) return null;
            const scaleX = bg.maskWidth / imageTransform.width;
            const scaleY = bg.maskHeight / imageTransform.height;
            const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);
            if (idx >= 0 && idx < bg.maskData.length && bg.maskData[idx] > 30) return bg;
        }

        return null;
    };

    // ── Event handlers ────────────────────────────────────────────────────────

    // ── Shift-key tracking ────────────────────────────────────────────────────
    // Hover is gated behind Shift. When Shift is released, hover clears immediately.
    const isShiftHeldRef = useRef(false);

    const handleMouseLeaveCanvas = useCallback(() => {
        onHoverChange(null);
    }, [onHoverChange]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Shift' && !isShiftHeldRef.current) {
                isShiftHeldRef.current = true;
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'Shift') {
                isShiftHeldRef.current = false;
                // Clear hover immediately when Shift is released
                onHoverChange(null);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, [onHoverChange]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isEditing) return;

        // Hover is only active while Shift is held
        if (!isShiftHeldRef.current) {
            // If we were showing hover and shift was just released externally,
            // the keyup handler already cleared it. Nothing to do here.
            return;
        }

        const coords = toImageCoords(e);

        if (!coords) {
            handleMouseLeaveCanvas();
            return;
        }

        const hit = resolveHit(coords.x, coords.y);

        if (!hit) {
            if (hoveredRegionId) onHoverChange(null);
            return;
        }

        // In shift-hover mode: instant, no debounce, no anchor delays, no tool halo
        if (hit.id !== hoveredRegionId) {
            onHoverChange(hit.id);
        }
    };

    const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCanvasClick = (e: React.MouseEvent) => {
        const isMultiToggle = e.ctrlKey || e.metaKey || e.shiftKey;
        const coords = toImageCoords(e);
        if (!coords) {
            if (!isMultiToggle) onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
            return;
        }

        const clickedRegion = resolveHit(coords.x, coords.y);

        if (clickedRegion) {
            e.stopPropagation();
            const performSelectionUpdate = () => {
                let updatedRegions = tile.regions.map(r => {
                    if (isMultiToggle) {
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
            const isDeselecting = isMultiToggle && clickedRegion.selected;
            if (!isDeselecting) onEditRegion(clickedRegion);
        } else {
            if (!isMultiToggle) onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
        }
    };

    const handleCanvasDoubleClick = (e: React.MouseEvent) => {
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        const coords = toImageCoords(e);
        if (!coords) return;
        const hit = resolveHit(coords.x, coords.y);
        if (!hit) return;
        if (onEnterLocalEdit) onEnterLocalEdit(hit);
        else onEditRegion(hit);
    };

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 z-10 pointer-events-auto cursor-pointer"
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeaveCanvas}
        />
    );
}