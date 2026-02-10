
import { useEffect, useRef, useState } from 'react';
import type { Region, ImageTileData } from '@/types/workspace';
import { getMaskCenter } from '@/lib/mask-analysis';
import { Brush } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LinearGradientTool } from '../tools/LinearGradientTool';
import { RadialGradientTool } from '../tools/RadialGradientTool';
import { generateRadialGradientMask } from '@/lib/mask-analysis';

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
    onUpdateTile?: (updates: Partial<ImageTileData>) => void;
    onEditRegion?: (regionId: string) => void;
}

export function ToolLayer({
    width,
    height,
    imageTransform,
    regions,
    excludedRegionId,
    editingRegionId,
    onUpdateTile,
    onEditRegion,
}: ToolLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

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
                        const dxNorm = multiDragState.delta.x / imageTransform.width;
                        const dyNorm = multiDragState.delta.y / imageTransform.height;
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
                        const dxNorm = multiDragState.delta.x / imageTransform.width;
                        const dyNorm = multiDragState.delta.y / imageTransform.height;
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

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Filter for manual & gradient masks
        // IMPORTANT: Exclude SELECTED gradients because they are rendered live by the tool
        // UNLESS they are being multi-dragged by someone else?
        // Actually, Gradient Tools render themselves.

        const manualRegions = effectiveRegions.filter(r => // Use effective regions!
            (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') &&
            r.visible &&
            r.id !== excludedRegionId
        );

        manualRegions.forEach(region => {
            const imageData = new ImageData(region.maskWidth, region.maskHeight);
            const data = region.maskData;

            // Color logic: Manual = Green, Linear/Radial Gradient = Red
            for (let i = 0; i < data.length; i++) {
                if (data[i] > 10) {
                    const idx = i * 4;
                    // Use alpha from mask for gradients
                    const opacity = data[i] / 255;

                    if (region.type === 'linear-gradient' || region.type === 'radial-gradient') {
                        imageData.data[idx] = 255;     // R
                        imageData.data[idx + 1] = 50;  // G
                        imageData.data[idx + 2] = 50;  // B
                    } else {
                        imageData.data[idx] = 50;     // R
                        imageData.data[idx + 1] = 255; // G
                        imageData.data[idx + 2] = 50;  // B
                    }
                    // Standard overlay is semi-transparent.
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

    }, [regions, width, height, excludedRegionId, dragState]); // Added dragState to dependencies

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
    const handleChildDragEnd = () => {
        if (!multiDragState || !onUpdateTile || !imageTransform) {
            setMultiDragState(null);
            return;
        }

        // Get list of OTHER selected regions (not the source)
        const otherSelectedRegions = regions.filter(r =>
            r.selected && r.id !== multiDragState.sourceId
        );

        // If there are no other selected regions, just clear state and return
        // The source already updated itself via onUpdate
        if (otherSelectedRegions.length === 0) {
            setMultiDragState(null);
            return;
        }

        // Commit changes for OTHER selected regions by applying the delta
        const finalRegions = regions.map(existing => {
            // Don't touch the source - it already updated itself
            if (existing.id === multiDragState.sourceId) return existing;

            // Update other selected regions with the delta
            if (existing.selected) {
                // Apply delta based on type
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
                    const dxNorm = multiDragState.delta.x / imageTransform.width;
                    const dyNorm = multiDragState.delta.y / imageTransform.height;
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
                    const dxNorm = multiDragState.delta.x / imageTransform.width;
                    const dyNorm = multiDragState.delta.y / imageTransform.height;

                    // Calculate new center
                    const newCenter = {
                        x: existing.radialGradient.center.x + dxNorm,
                        y: existing.radialGradient.center.y + dyNorm
                    };

                    // Regenerate mask with new center
                    const maskData = generateRadialGradientMask(
                        Math.floor(existing.maskWidth),
                        Math.floor(existing.maskHeight),
                        newCenter,
                        existing.radialGradient.radius,
                        existing.radialGradient.feather,
                        existing.radialGradient.invert || false
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

    const handleIconClick = (e: React.MouseEvent, region: Region) => {
        e.stopPropagation(); // prevent background deselect
        if (!onUpdateTile) return;

        // If drag happened, don't select toggle
        // But this is onClick. Drag is handled by pointer events.
        // We rely on standard click.

        // Should we ignore click if we just dragged?
        if (multiDragState) return;

        const isMultiToggle = e.ctrlKey || e.metaKey || e.shiftKey;

        const updatedRegions = regions.map(r => { // Use original regions for selection logic
            if (isMultiToggle) {
                if (r.id === region.id) {
                    return { ...r, selected: !r.selected };
                }
                return r; // Don't touch others
            }

            // Single select
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

                    return (
                        <div
                            key={region.id}
                            className={cn(
                                "absolute pointer-events-auto rounded-full transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center",
                                "transition-[transform,background-color,border-color,box-shadow]",
                                region.selected
                                    ? "bg-blue-600 text-white ring-2 ring-white shadow-lg z-50"
                                    : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-white z-40",
                                (isEditing || region.selected) ? "cursor-move p-2 scale-110" : "cursor-pointer p-1.5 hover:scale-110"
                            )}
                            style={{
                                left: cx,
                                top: cy,
                            }}
                            onClick={(e) => handleIconClick(e, region)}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                onEditRegion?.(region.id);
                            }}
                            onPointerDown={(e) => handlePointerDown(e, region)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                        >
                            <Brush className="w-4 h-4" />
                        </div>
                    );
                })}

            {/* Gradient Tools - Render all (selected will be full UI) */}
            {effectiveRegions // Use Effective regions to pass down offsets!
                .filter(r => (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.visible && r.id !== excludedRegionId)
                .map(region => {
                    if (region.type === 'radial-gradient') {
                        return (
                            <RadialGradientTool
                                key={region.id}
                                imageTransform={imageTransform}
                                region={region}
                                isSelected={region.selected}
                                isEditing={region.id === editingRegionId}
                                onUpdate={(updates) => {
                                    if (!onUpdateTile) return;
                                    const updatedRegions = regions.map(r =>
                                        r.id === region.id ? { ...r, ...updates } : r
                                    );
                                    onUpdateTile({ regions: updatedRegions });
                                }}
                                onDrag={(delta) => handleChildDrag(region.id, delta)}
                                onDragEnd={handleChildDragEnd}
                                onSelect={(e) => handleIconClick(e, region)}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    onEditRegion?.(region.id);
                                }}
                            />
                        );
                    }

                    return (
                        <LinearGradientTool
                            key={region.id}
                            imageTransform={imageTransform}
                            region={region}
                            isSelected={region.selected}
                            isEditing={region.id === editingRegionId}
                            onUpdate={(updates) => {
                                if (!onUpdateTile) return;
                                const updatedRegions = regions.map(r =>
                                    r.id === region.id ? { ...r, ...updates } : r
                                );
                                onUpdateTile({ regions: updatedRegions });
                            }}
                            onDrag={(delta) => handleChildDrag(region.id, delta)}
                            onDragEnd={handleChildDragEnd}
                            onSelect={(e) => {
                                // Use common handle logic
                                handleIconClick(e, region);
                            }}
                            onDoubleClick={(e) => {
                                // Enter Edit Mode (Double Click)
                                e.stopPropagation();
                                onEditRegion?.(region.id);
                            }}
                        />
                    )
                })}
        </div>
    );
}
