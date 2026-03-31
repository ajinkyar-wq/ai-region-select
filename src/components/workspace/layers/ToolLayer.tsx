
import { useEffect, useRef, useState } from 'react';
import type { Region, ImageTileData } from '@/types/workspace';
import { getMaskCenter, generateRadialGradientMask } from '@/lib/mask-analysis';
import { Brush, Contrast } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LinearGradientTool } from '../tools/LinearGradientTool';
import { RadialGradientTool } from '../tools/RadialGradientTool';
import { GlassCard } from 'react-glass-ui';
import type { LiveGradient } from './SmartMaskLayer';

interface ToolLayerProps {
    width: number;
    height: number;
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    } | null;
    regions: Region[];
    excludedRegionId?: string | null;
    editingRegionId?: string | null;
    activeRegionId?: string | null;
    onUpdateTile?: (updates: Partial<ImageTileData>) => void;
    onEditRegion?: (regionId: string) => void;
    onDoubleEditRegion?: (regionId: string) => void;
    onGradientDraggingChange?: (isDragging: boolean) => void;
    liveGradient?: LiveGradient | null;
}

export function ToolLayer({
    width,
    height,
    imageTransform,
    regions,
    excludedRegionId,
    editingRegionId,
    activeRegionId,
    onUpdateTile,
    onEditRegion,
    onDoubleEditRegion,
    onGradientDraggingChange,
    liveGradient = null,
}: ToolLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDraggingRef = useRef(false); // Track if a drag occurred to prevent click-deselection

    // Drag State for Manual Masks (Single)
    const [dragState, setDragState] = useState<{
        regionId: string;
        startX: number;
        startY: number;
        initialOffset: { x: number; y: number };
        currentOffset: { x: number; y: number };
    } | null>(null);

    // Multi-Select Drag State (Coordinated)
    const [multiDragState, setMultiDragState] = useState<{
        sourceId: string; // The region being dragged (Manual or Gradient)
        delta: { x: number, y: number }; // Cumulative delta in Image Pixels
    } | null>(null);

    // Helper: Get Effective Regions (With temporary offsets applied)
    const getEffectiveRegions = () => {
        if (!multiDragState) return regions;

        return regions.map(r => {
            // Apply delta if:
            // 1. Region is selected
            // 2. Region is NOT the source (source handles itself via local state)
            // 3. Region is 'manual' OR 'gradient' types
            if (r.selected && r.id !== multiDragState.sourceId && (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient')) {

                // Apply delta based on type
                if (r.type === 'manual') {
                    const currentOff = r.offset || { x: 0, y: 0 };
                    return {
                        ...r,
                        offset: { x: currentOff.x + multiDragState.delta.x, y: currentOff.y + multiDragState.delta.y }
                    };
                }

                if (r.type === 'linear-gradient' && r.gradient) {
                    // Normalized coordinates require width/height to apply pixel delta?
                    // No, delta is pixel. We can convert or keep pixel.
                    // Wait, Gradient Tools expect normalized updates usually?
                    // Actually, LinearGradientTool takes `region`.
                    // If we modify `region.gradient` directly here, we need Image Size to normalize pixel delta.
                    // imageTransform might be null?

                    // Helper inside: just use pixel projection if possible?
                    // Actually, simplified: Gradients store normalized 0-1.
                    // Delta is pixels.
                    // We need to convert pixels to normalized range.
                    const w = width; // ToolLayer width ~ image width? No. `width` is container.
                    // We need image dimensions.
                    // `imageTransform` has `width/height` (displayed size).
                    // But gradients are normalized to natural image size?
                    // No, `region.gradient` is 0-1.
                    // `imageTransform.width` is the rendered width.

                    if (imageTransform) {
                        // delta.x is in natural image pixels (screen delta / fit_scale).
                        // Normalize by natural image dimensions (width/height props), not displayed dimensions.
                        const dxNorm = multiDragState.delta.x / width;
                        const dyNorm = multiDragState.delta.y / height;
                        return {
                            ...r,
                            gradient: {
                                start: { x: r.gradient.start.x + dxNorm, y: r.gradient.start.y + dyNorm },
                                end: { x: r.gradient.end.x + dxNorm, y: r.gradient.end.y + dyNorm }
                            }
                        };
                    }
                }

                if (r.type === 'radial-gradient' && r.radialGradient) {
                    if (imageTransform) {
                        const dxNorm = multiDragState.delta.x / width;
                        const dyNorm = multiDragState.delta.y / height;
                        return {
                            ...r,
                            radialGradient: {
                                ...r.radialGradient,
                                center: { x: r.radialGradient.center.x + dxNorm, y: r.radialGradient.center.y + dyNorm }
                            }
                        };
                    }
                }
            }
            return r;
        });
    };

    const effectiveRegions = getEffectiveRegions();

    // Render mask
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Use standard clearRect
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Filter for manual & gradient masks
        // IMPORTANT: Exclude SELECTED gradients because they are rendered live by the tool
        // UNLESS they are being multi-dragged by someone else?
        // Actually, Gradient Tools render themselves.

        const manualRegions = effectiveRegions.filter(r => {
            // Base checks
            if (!r.visible || r.id === excludedRegionId) return false;



            // Gradients: Render NEVER in ToolLayer.
            // - Active: Renders itself in Tool (Live Preview).
            // - Other Selected: User wants NO Overlay (Handle Only).
            if (r.type === 'linear-gradient' || r.type === 'radial-gradient') {
                return false;
            }

            // Manual: Render ONLY if Selected AND Active (Last Selected)
            // Unselected = no overlay. Selected but not active = no overlay (icon only).
            if (r.type === 'manual') {
                if (r.selected && r.id === activeRegionId) return true;
                return false;
            }

            return false;
        });

        manualRegions.forEach(region => {
            const imageData = new ImageData(region.maskWidth, region.maskHeight);
            const data = region.maskData;

            // Identify intersected gradients (Clip Children)
            const clipKids = [...effectiveRegions.filter(c => c.clipParentId === region.id)];

            // Inject live gradient as temporary clip child for real-time preview
            if (liveGradient && liveGradient.parentId === region.id) {
                const rw2 = region.maskWidth;
                const rh2 = region.maskHeight;
                let liveMaskData: Uint8Array;
                if (liveGradient.type === 'radial-gradient') {
                    const radiusX = Math.abs(liveGradient.end.x - liveGradient.start.x);
                    const radiusY = Math.abs(liveGradient.end.y - liveGradient.start.y);
                    liveMaskData = generateRadialGradientMask(rw2, rh2, liveGradient.start, { x: radiusX, y: radiusY }, 0.5, false);
                } else {
                    liveMaskData = new Uint8Array(rw2 * rh2);
                    const p1x = liveGradient.start.x * rw2;
                    const p1y = liveGradient.start.y * rh2;
                    const p2x = liveGradient.end.x * rw2;
                    const p2y = liveGradient.end.y * rh2;
                    const vx = p2x - p1x;
                    const vy = p2y - p1y;
                    const m2 = vx * vx + vy * vy;
                    if (m2 > 0.0001) {
                        for (let py = 0; py < rh2; py++) {
                            for (let px = 0; px < rw2; px++) {
                                const u = ((px - p1x) * vx + (py - p1y) * vy) / m2;
                                const a = u <= 0 ? 255 : u >= 1 ? 0 : Math.round((1 - u) * 255);
                                if (a > 0) liveMaskData[py * rw2 + px] = a;
                            }
                        }
                    }
                }
                clipKids.push({
                    id: '__live__',
                    type: liveGradient.type,
                    label: '',
                    maskData: liveMaskData,
                    maskWidth: rw2,
                    maskHeight: rh2,
                    color: region.color,
                    visible: true,
                    selected: false,
                    hovered: false,
                    clipParentId: region.id,
                    clipMode: liveGradient.mode === 'subtract' ? 'subtract' : 'add',
                } as Region);
            }

            const hasClipKids = clipKids.length > 0;
            const hasAddKids = clipKids.some(k => k.clipMode === 'add');
            const rw = region.maskWidth; // capture for loop

            // Color logic: Manual = Green, Linear/Radial Gradient = Red
            for (let i = 0; i < data.length; i++) {
                let alpha = data[i];

                // Run clip kids: always if add kids exist (alpha may be 0), otherwise only where parent has coverage
                if (hasClipKids && (alpha > 0 || hasAddKids)) {
                    const x = i % rw;
                    const y = Math.floor(i / rw);

                    for (const kid of clipKids) {
                        const kw = kid.maskWidth;
                        const kh = kid.maskHeight;

                        let childVal = 0;
                        if (kw === rw && kh === region.maskHeight) {
                            childVal = kid.maskData[i];
                        } else {
                            const kx = Math.min(Math.floor((x / rw) * kw), kw - 1);
                            const ky = Math.min(Math.floor((y / region.maskHeight) * kh), kh - 1);
                            childVal = kid.maskData[ky * kw + kx];
                        }
                        if (kid.clipMode === 'subtract') {
                            alpha = Math.max(0, alpha - childVal);
                        } else if (kid.clipMode === 'add') {
                            alpha = Math.min(255, alpha + childVal);
                        } else {
                            // intersect (default)
                            alpha = Math.min(alpha, childVal);
                        }
                    }
                }

                if (alpha > 10) {
                    const idx = i * 4;
                    const opacity = alpha / 255;
                    const cm = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
                    imageData.data[idx]     = cm ? parseInt(cm[1], 16) : 50;
                    imageData.data[idx + 1] = cm ? parseInt(cm[2], 16) : 255;
                    imageData.data[idx + 2] = cm ? parseInt(cm[3], 16) : 50;
                    imageData.data[idx + 3] = Math.floor(opacity * 100);
                }
            }

            // Draw to canvas
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = region.maskWidth;
            tempCanvas.height = region.maskHeight;
            tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

            // Apply Offset if it exists (for Manual Masks)
            ctx.save();

            // Use local drag state if this region is being dragged
            let drawOffset = region.offset;
            if (dragState && dragState.regionId === region.id) {
                drawOffset = dragState.currentOffset;
            }

            if (drawOffset) {
                // Determine scale to match canvas (which draws at 'width'/'height' of visible area)
                const scaleX = width / region.maskWidth;
                const scaleY = height / region.maskHeight;

                ctx.translate(drawOffset.x * scaleX, drawOffset.y * scaleY);
            }

            ctx.drawImage(tempCanvas, 0, 0, width, height);
            ctx.restore();
        });

    }, [regions, width, height, excludedRegionId, dragState, multiDragState, activeRegionId, liveGradient]);

    if (!imageTransform) return null;

    // Filter valid manual regions for interaction (Brush Icons)
    const interactiveRegions = regions
        .filter(r => r.type === 'manual' && r.visible && r.maskData && r.id !== excludedRegionId)
        .map(r => ({
            ...r,
            center: getMaskCenter(r.maskData, r.maskWidth, r.maskHeight)
        }))
        .filter(r => r.center !== null);

    // --- Multi-Select Handlers ---

    // Called by Gradient Tools when they drag
    const handleChildDrag = (sourceId: string, delta: { x: number, y: number }) => {
        setMultiDragState({ sourceId, delta });
    };

    // Called by Gradient Tools when they end drag
    const handleChildDragEnd = (sourceId: string, sourceUpdates?: Partial<Region>) => {
        if (!onUpdateTile || !imageTransform) {
            setMultiDragState(null);
            return;
        }

        // Build final regions: apply source updates + multi-drag delta to others
        const finalRegions = regions.map(existing => {
            // Source: apply source updates
            if (existing.id === sourceId && sourceUpdates) {
                return { ...existing, ...sourceUpdates };
            }

            // Other selected: apply multi-drag delta
            if (multiDragState && existing.selected && existing.id !== sourceId) {
                // Apply same logic as getEffectiveRegions but finalize it
                if (existing.type === 'manual') {
                    const currentOff = existing.offset || { x: 0, y: 0 };
                    return {
                        ...existing,
                        offset: {
                            x: currentOff.x + multiDragState.delta.x,
                            y: currentOff.y + multiDragState.delta.y
                        }
                    };
                }

                if (existing.type === 'linear-gradient' && existing.gradient) {
                    const dxNorm = multiDragState.delta.x / width;
                    const dyNorm = multiDragState.delta.y / height;
                    return {
                        ...existing,
                        gradient: {
                            start: {
                                x: existing.gradient.start.x + dxNorm,
                                y: existing.gradient.start.y + dyNorm
                            },
                            end: {
                                x: existing.gradient.end.x + dxNorm,
                                y: existing.gradient.end.y + dyNorm
                            }
                        }
                    };
                }

                if (existing.type === 'radial-gradient' && existing.radialGradient) {
                    const dxNorm = multiDragState.delta.x / width;
                    const dyNorm = multiDragState.delta.y / height;

                    const newCenter = {
                        x: existing.radialGradient.center.x + dxNorm,
                        y: existing.radialGradient.center.y + dyNorm
                    };

                    const maskData = generateRadialGradientMask(
                        Math.floor(existing.maskWidth),
                        Math.floor(existing.maskHeight),
                        newCenter,
                        existing.radialGradient.radius,
                        existing.radialGradient.feather,
                        existing.radialGradient.invert || false,
                        existing.radialGradient.rotation ?? 0
                    );

                    return {
                        ...existing,
                        maskData,
                        radialGradient: {
                            ...existing.radialGradient,
                            center: newCenter
                        }
                    };
                }
            }

            return existing;
        });

        onUpdateTile({ regions: finalRegions });
        setMultiDragState(null);
    };

    // --- Manual Mask Handlers ---

    const handleIconDoubleClick = (e: React.MouseEvent, region: Region) => {
        e.stopPropagation();
        // Don't enter edit mode during multi-select (shift/ctrl held)
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (region.type === 'manual') {
            onDoubleEditRegion?.(region.id);
        }
    };
    const handleIconClick = (e: React.MouseEvent, region: Region) => {
        e.stopPropagation(); // prevent background deselect
        if (!onUpdateTile) return;

        // If drag happened, don't perform selection toggle
        if (isDraggingRef.current) {
            // But Ensure it is Active (so HUD shows up), without clearing selection
            if (onEditRegion) {
                onEditRegion(region.id);
            }
            isDraggingRef.current = false;
            return;
        }

        if (multiDragState) return;

        const isMultiToggle = e.ctrlKey || e.metaKey || e.shiftKey;

        // For gradients: if already selected (single-click, no modifier), deselect immediately
        if (!isMultiToggle && region.selected && (region.type === 'linear-gradient' || region.type === 'radial-gradient')) {
            const updatedRegions = regions.map(r => ({
                ...r,
                selected: false
            }));
            onUpdateTile({ regions: updatedRegions });
            return;
        }

        // Always set as Active Region if we are interacting with it (SINGLE or MULTI)
        // This ensures the "Most Recently Selected" item gets the Red Overlay + Controls.
        if (onEditRegion) {
            onEditRegion(region.id);
        }

        const updatedRegions = regions.map(r => { // Use original regions for selection logic
            if (isMultiToggle) {
                if (r.id === region.id) {
                    return { ...r, selected: !r.selected };
                }
                return r; // Don't touch others
            }

            // Single select — if clicking a clip child, keep siblings with the same parent selected
            if (region.clipParentId && r.clipParentId === region.clipParentId) {
                return r; // keep sibling clip children as-is
            }
            return {
                ...r,
                selected: r.id === region.id
            };
        });

        onUpdateTile({ regions: updatedRegions });
    };

    const handlePointerDown = (e: React.PointerEvent, region: Region) => {
        // Allow move if Selected
        if (!region.selected) return;

        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        isDraggingRef.current = false; // Reset drag flag

        setDragState({
            regionId: region.id,
            startX: e.clientX,
            startY: e.clientY,
            initialOffset: region.offset ? { ...region.offset } : { x: 0, y: 0 },
            currentOffset: region.offset ? { ...region.offset } : { x: 0, y: 0 }
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.stopPropagation();

        if (!imageTransform) return;

        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;

        // Threshold to count as drag
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            isDraggingRef.current = true;
        }

        // Convert View Pixels -> Image Pixels
        // scale = viewPixels / imagePixels
        const scale = imageTransform.scale;

        const dxImg = dx / scale;
        const dyImg = dy / scale;

        const newOffset = {
            x: dragState.initialOffset.x + dxImg,
            y: dragState.initialOffset.y + dyImg
        };

        // Update LOCAL state only (fast)
        setDragState(prev => prev ? { ...prev, currentOffset: newOffset } : null);

        // Also update Multi-Drag for others
        const delta = {
            x: dxImg - (dragState.currentOffset.x - dragState.initialOffset.x), // Incremental? No, Logic asks for Total Delta?
            // `newOffset` is Total Offset. 
            // `initialOffset` is Start.
            // Delta = newOffset - initialOffset
        };
        // Actually my `handleChildDrag` expects Total Delta from start?
        // RadialGradientTool sends `dx, dy` which are "Delta from Center".
        // Center was initial. So yes, Total Delta.

        const totalDelta = {
            x: dxImg,
            y: dyImg
        };
        setMultiDragState({ sourceId: dragState.regionId, delta: totalDelta });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState) return;
        e.preventDefault(); // Prevent click event generation after drag
        e.currentTarget.releasePointerCapture(e.pointerId);

        // Commit to Parent State
        if (onUpdateTile) {
            const updatedRegions = regions.map(r => {
                // If Source (Manual Mask being dragged)
                if (r.id === dragState.regionId) {
                    return { ...r, offset: dragState.currentOffset };
                }
                // If Other Selected (Multi-move)
                if (r.selected && multiDragState) {
                    const eff = effectiveRegions.find(e => e.id === r.id);
                    if (eff) return eff;
                }
                return r;
            });
            onUpdateTile({ regions: updatedRegions });
        }

        setMultiDragState(null);

        setDragState(null);
    };

    return (
        <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
                left: imageTransform.x,
                top: imageTransform.y,
                width: imageTransform.width,
                height: imageTransform.height
            }}
        >
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="absolute inset-0 pointer-events-none"
                style={{ width: '100%', height: '100%' }}
            />

            {/* Interactive Brush Icons */}
            {effectiveRegions // Use Effective Regions for rendering positions
                .filter(r => r.type === 'manual' && r.visible && r.maskData && r.id !== excludedRegionId)
                .map(r => ({
                    ...r,
                    center: getMaskCenter(r.maskData, r.maskWidth, r.maskHeight)
                }))
                .filter(r => r.center !== null)
                .map(region => {
                    const scaleX = imageTransform.width / region.maskWidth;
                    const scaleY = imageTransform.height / region.maskHeight;

                    // Center is in Image Pixels. Offset is in Image Pixels.

                    // Use local drag state if available
                    let activeOffset = region.offset;
                    if (dragState && dragState.regionId === region.id) {
                        activeOffset = dragState.currentOffset;
                    }

                    const cx = (region.center!.x + (activeOffset?.x || 0)) * scaleX;
                    const cy = (region.center!.y + (activeOffset?.y || 0)) * scaleY;

                    const isEditing = editingRegionId === region.id;
                    const isBackgroundOrInvert = region.label?.includes('Background') || region.label?.includes('Invert');
                    const Icon = isBackgroundOrInvert ? Contrast : Brush;

                    return (
                        region.selected ? (
                            <div
                                key={region.id}
                                className={cn(
                                    "absolute pointer-events-auto rounded-full transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center",
                                    "transition-[transform,background-color,border-color,box-shadow]",
                                    "bg-blue-600 text-white ring-2 ring-white shadow-lg z-50",
                                    (isEditing || region.selected) ? "cursor-move p-2 scale-110" : "cursor-pointer p-1.5 hover:scale-110"
                                )}
                                style={{
                                    left: cx,
                                    top: cy,
                                }}
                                onClick={(e) => handleIconClick(e, region)}
                                onDoubleClick={(e) => handleIconDoubleClick(e, region)}
                                onPointerDown={(e) => handlePointerDown(e, region)}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                            >
                                <Icon className="w-4 h-4" />
                            </div>
                        ) : (
                            <div
                                key={region.id}
                                className="absolute transform -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto transition-transform hover:scale-110"
                                style={{ left: cx, top: cy }}
                                onClick={(e) => handleIconClick(e, region)}
                                onDoubleClick={(e) => handleIconDoubleClick(e, region)}
                            >
                                <GlassCard
                                    width={32}
                                    height={32}
                                    borderRadius={50}
                                    blur={6}
                                    distortion={12}
                                    chromaticAberration={0}
                                    borderOpacity={0}
                                    borderColor="#000000"
                                    backgroundOpacity={0.1}
                                    outerLightBlur={10}
                                    outerLightOpacity={0.4}
                                    outerLightColor="#000000"
                                    contentClassName="flex items-center justify-center w-full h-full text-white"
                                    className="cursor-pointer"
                                    flexibility={0}
                                >
                                    <Icon className="w-3.5 h-3.5" />
                                </GlassCard>
                            </div>
                        )
                    );
                })}

            {/* Gradient Tools - Render all (selected will be full UI) */}
            {effectiveRegions // Use Effective regions to pass down offsets!
                .filter(r => (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.visible && r.id !== excludedRegionId)
                .map(region => {
                    // clipParentId can be a single region ID or a group ID — handle both.
                    const clipParent = region.clipParentId
                        ? regions.find(r => r.id === region.clipParentId)
                        : undefined;

                    // If no direct region match, treat clipParentId as a group ID
                    const clipGroupMembers = (!clipParent && region.clipParentId)
                        ? regions.filter(r => r.groupId === region.clipParentId)
                        : [];

                    const isParentSelected = clipParent
                        ? clipParent.selected
                        : clipGroupMembers.some(r => r.selected);

                    // When parent is selected, we want to show the gradient tool (icon/overlay)
                    // so the user knows it exists and can select it to edit.
                    // Previously we hid it, which made "intersect on group" invisible in terms of controls.
                    // if (isParentSelected && !region.selected) {
                    //     return null;
                    // }

                    // If clipParentId is set but neither a valid region nor a valid group
                    // exists, this gradient is orphaned — skip rendering it entirely so it
                    // doesn't appear as an unclipped ghost on the canvas.
                    if (region.clipParentId && !clipParent && clipGroupMembers.length === 0) {
                        return null;
                    }

                    // Compute clip mask: for a single parent, use its mask directly.
                    // For a group, compute the union of all group members' masks.
                    let clipMask: { data: Uint8Array; width: number; height: number } | undefined;

                    if (clipParent?.maskData) {
                        clipMask = { data: clipParent.maskData, width: clipParent.maskWidth, height: clipParent.maskHeight };
                    } else if (clipGroupMembers.length > 0) {
                        // Compute union of all group members
                        const membersWithMask = clipGroupMembers.filter(m => m.maskData);
                        if (membersWithMask.length === 1) {
                            clipMask = { data: membersWithMask[0].maskData, width: membersWithMask[0].maskWidth, height: membersWithMask[0].maskHeight };
                        } else if (membersWithMask.length > 1) {
                            // Union: use the max dimensions, then for each pixel take max across all members
                            const uW = Math.max(...membersWithMask.map(m => m.maskWidth));
                            const uH = Math.max(...membersWithMask.map(m => m.maskHeight));
                            const unionData = new Uint8Array(uW * uH);
                            membersWithMask.forEach(m => {
                                for (let py = 0; py < uH; py++) {
                                    for (let px = 0; px < uW; px++) {
                                        const mx = Math.min(Math.floor((px / uW) * m.maskWidth), m.maskWidth - 1);
                                        const my = Math.min(Math.floor((py / uH) * m.maskHeight), m.maskHeight - 1);
                                        const val = m.maskData[my * m.maskWidth + mx];
                                        if (val > unionData[py * uW + px]) {
                                            unionData[py * uW + px] = val;
                                        }
                                    }
                                }
                            });
                            clipMask = { data: unionData, width: uW, height: uH };
                        }
                    }

                    const effectiveClipMask = clipMask;

                    if (region.type === 'radial-gradient') {
                        return (
                            <RadialGradientTool
                                key={region.id}
                                imageTransform={imageTransform}
                                region={region}
                                isSelected={region.selected}
                                isEditing={region.id === editingRegionId || (!!region.clipParentId && region.clipParentId === editingRegionId)}
                                clipMask={effectiveClipMask}
                                isParentSelected={isParentSelected}
                                onUpdate={(updates) => {
                                    if (!onUpdateTile) return;
                                    const updatedRegions = regions.map(r =>
                                        r.id === region.id ? { ...r, ...updates } : r
                                    );
                                    onUpdateTile({ regions: updatedRegions });
                                }}
                                onDragStart={() => onGradientDraggingChange?.(true)}
                                onDrag={(delta) => handleChildDrag(region.id, delta)}
                                onDragEnd={(sourceUpdates) => { handleChildDragEnd(region.id, sourceUpdates); onGradientDraggingChange?.(false); }}
                                onSelect={(e) => handleIconClick(e, region)}
                            />
                        );
                    }

                    return (
                        <LinearGradientTool
                            key={region.id}
                            imageTransform={imageTransform}
                            region={region}
                            isSelected={region.selected}
                            isEditing={region.id === editingRegionId || (!!region.clipParentId && region.clipParentId === editingRegionId)}
                            clipMask={effectiveClipMask}
                            isParentSelected={isParentSelected}
                            onUpdate={(updates) => {
                                if (!onUpdateTile) return;
                                const updatedRegions = regions.map(r =>
                                    r.id === region.id ? { ...r, ...updates } : r
                                );
                                onUpdateTile({ regions: updatedRegions });
                            }}
                            onDragStart={() => onGradientDraggingChange?.(true)}
                            onDrag={(delta) => handleChildDrag(region.id, delta)}
                            onDragEnd={(sourceUpdates) => { handleChildDragEnd(region.id, sourceUpdates); onGradientDraggingChange?.(false); }}
                            onSelect={(e) => {
                                // Use common handle logic
                                handleIconClick(e, region);
                            }}
                        />
                    )

                })}
        </div>
    );
}
