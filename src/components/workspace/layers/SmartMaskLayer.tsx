import { useEffect, useRef } from 'react';
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
 * Render the edge pixels of a mask directly as a pixel overlay.
 * Edge = any ON pixel with at least one OFF 4-neighbor.
 * Painted as solid colour at full opacity — same pipeline as renderMask.
 * Cannot fail, cannot produce crossed lines, works on any shape.
 */
function renderContourStroke(
    ctx: CanvasRenderingContext2D,
    mask: Uint8Array,
    w: number, h: number,
    rC: number, gC: number, bC: number,
    destX: number, destY: number, destW: number, destH: number,
) {
    const scratch = document.createElement('canvas');
    scratch.width = w; scratch.height = h;
    const sctx = scratch.getContext('2d')!;
    const img = sctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = mask[y * w + x];
            if (v <= 30) continue;
            const hasOffNeighbor =
                (x === 0 || mask[y * w + (x - 1)] <= 30) ||
                (x === w - 1 || mask[y * w + (x + 1)] <= 30) ||
                (y === 0 || mask[(y - 1) * w + x] <= 30) ||
                (y === h - 1 || mask[(y + 1) * w + x] <= 30);
            if (!hasOffNeighbor) continue;
            // Heavy dotted line: 4px ON, 2px OFF
            if ((x + y) % 6 >= 4) continue;
            const p = (y * w + x) * 4;
            img.data[p] = rC;
            img.data[p + 1] = gC;
            img.data[p + 2] = bC;
            img.data[p + 3] = 230; // near-full opacity, crisp line
        }
    }

    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false; // pixel-perfect — no blur on the line
    ctx.drawImage(scratch, destX, destY, destW, destH);
    ctx.restore();
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

            const overlayAlpha = region.selected ? 0.5 : 0.3;

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

            // Pass 2 — dashed contour
            // REMOVED per user request: "just remove the contours altogether they do not make sense now"
            /*
            const showOriginalContour = !(region.selected && allClipKids.length > 0);

            if (showOriginalContour) {
                if (region.type === 'person') {
                   // ...
                } else if (region.type === 'people-group') {
                   // ...
                }
            }
            */
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

    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hoverAnchorRef = useRef<{ x: number, y: number } | null>(null);

    const handleMouseLeaveCanvas = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        hoverAnchorRef.current = null;
        onHoverChange(null);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isEditing) return;
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
        for (const handle of toolHandlesRef.current) {
            const handleDist = Math.hypot(coords.x - handle.x, coords.y - handle.y);
            if (handleDist < 80) { // 80px magnetic halo
                isTargetingTool = true;
                break;
            }
        }

        if (hit.type !== 'background') {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
            }
            hoverAnchorRef.current = null;
            if (hit.id !== hoveredRegionId) {
                onHoverChange(hit.id);
            }
            return;
        }

        // --- Environmental / Background Logic ---

        if (isTargetingTool) {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
            }
            hoverAnchorRef.current = null;
            if (hoveredRegionId) onHoverChange(null);
            return;
        }

        if (hoveredRegionId === hit.id) {
            // Already actively hovering the background
            return;
        }

        // We are on the background, but NOT hovering it yet.
        // We use a simple 200ms spatial timer. If they move out of a 20px radius, restart the timer.
        // If they twitch erratically inside the 20px radius, the timer completes and turns it on.

        if (!hoverAnchorRef.current) {
            hoverAnchorRef.current = { x: coords.x, y: coords.y };
        }

        const anchor = hoverAnchorRef.current;
        const dist = Math.hypot(coords.x - anchor.x, coords.y - anchor.y);

        if (dist > 15) {
            // Broke the anchor boundary (transiting or slow course correction). Reset.
            hoverAnchorRef.current = { x: coords.x, y: coords.y };
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            hoverTimeoutRef.current = setTimeout(() => {
                onHoverChange(hit.id);
                hoverTimeoutRef.current = null;
                hoverAnchorRef.current = null;
            }, 300);
        } else if (!hoverTimeoutRef.current) {
            // Inside boundary, but no timer running (initial entry)
            hoverTimeoutRef.current = setTimeout(() => {
                onHoverChange(hit.id);
                hoverTimeoutRef.current = null;
                hoverAnchorRef.current = null;
            }, 300);
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
                const updatedRegions = tile.regions.map(r => {
                    if (isMultiToggle) return r.id === clickedRegion.id ? { ...r, selected: !r.selected } : r;
                    return { ...r, selected: r.id === clickedRegion.id };
                });
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