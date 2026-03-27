
import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';
import { cn } from '@/lib/utils';
import { GlassCard } from 'react-glass-ui';

interface LinearGradientToolProps {
    imageTransform: {
        x: number;
        y: number;
        scale: number;
        width: number;
        height: number;
    } | null;
    region: Region;
    isSelected: boolean;
    isEditing: boolean;
    onUpdate: (updates: Partial<Region>) => void;
    onSelect?: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    onDrag?: (delta: { x: number, y: number }) => void;
    onDragEnd?: (sourceUpdates?: Partial<Region>) => void;
    onDragStart?: () => void;
    /** When set, the gradient overlay is clipped to these mask pixels (for intersect mode) */
    clipMask?: { data: Uint8Array; width: number; height: number };
    /** When true the parent mask is selected — gradient should reveal its overlay even without editing */
    isParentSelected?: boolean;
}

export function LinearGradientTool({
    imageTransform,
    region,
    isSelected,
    isEditing,
    onUpdate,
    onSelect,
    onDoubleClick,
    onDrag,
    onDragEnd,
    onDragStart,
    clipMask,
    isParentSelected = false,
}: LinearGradientToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Local state for smooth dragging
    const [dragState, setDragState] = useState<{
        start: { x: number, y: number }; // Pixel coords
        end: { x: number, y: number };   // Pixel coords
        isDragging: 'move-center' | 'rotate-start' | 'rotate-end' | 'rotate-pivot' | null;
        initialClickOffset?: { x: number; y: number }; // For relative move
        pivotRadius?: number; // For fixed-radius rotation
        initialCenter?: { x: number, y: number }; // For calculating total delta
    } | null>(null);

    // Sync state with region prop
    useEffect(() => {
        if (!imageTransform || !region.gradient) return;

        const start = {
            x: region.gradient.start.x * imageTransform.width,
            y: region.gradient.start.y * imageTransform.height
        };
        const end = {
            x: region.gradient.end.x * imageTransform.width,
            y: region.gradient.end.y * imageTransform.height
        };

        // Only sync if NOT dragging to avoid fighting local updates
        if (!dragState?.isDragging) {
            setDragState({ start, end, isDragging: null });
        }
    }, [region.gradient, imageTransform?.width, imageTransform?.height, imageTransform?.x, imageTransform?.y, dragState?.isDragging]);

    // Live Gradient Preview — redraws canvas whenever selection, editing, or clip state changes
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !dragState || !imageTransform) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // When parent is selected and handles are not actively being dragged:
        // the parent's rendering layer (SmartMaskLayer for AI masks, ToolLayer canvas
        // for manual masks) already draws the intersection — clear here to avoid doubling.
        // Only show our own canvas during an active handle drag (live positioning feedback).
        if (isParentSelected && !dragState.isDragging) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        // Default off: not editing, not dragging, and not selected without a parent.
        if (!isEditing && !dragState.isDragging && !isSelected) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);


        const grad = ctx.createLinearGradient(
            dragState.start.x, dragState.start.y,
            dragState.end.x, dragState.end.y
        );

        grad.addColorStop(0, 'rgba(255, 50, 50, 0.4)');
        grad.addColorStop(1, 'rgba(255, 50, 50, 0)');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // ── Clip to parent mask if in intersect mode ────────────────────────
        if (clipMask) {
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = canvas.width;
            maskCanvas.height = canvas.height;
            const mCtx = maskCanvas.getContext('2d');
            if (mCtx) {
                const imgData = mCtx.createImageData(canvas.width, canvas.height);
                const mW = clipMask.width;
                const mH = clipMask.height;
                for (let py = 0; py < canvas.height; py++) {
                    for (let px = 0; px < canvas.width; px++) {
                        const nx = px / canvas.width;
                        const ny = py / canvas.height;
                        const mx = Math.min(Math.floor(nx * mW), mW - 1);
                        const my = Math.min(Math.floor(ny * mH), mH - 1);
                        const alpha = clipMask.data[my * mW + mx];
                        const i = (py * canvas.width + px) * 4;
                        imgData.data[i] = 255;
                        imgData.data[i + 1] = 255;
                        imgData.data[i + 2] = 255;
                        imgData.data[i + 3] = alpha;
                    }
                }
                mCtx.putImageData(imgData, 0, 0);
                ctx.globalCompositeOperation = 'destination-in';
                ctx.drawImage(maskCanvas, 0, 0);
                ctx.globalCompositeOperation = 'source-over';
            }
        }
    }, [dragState, clipMask, imageTransform?.width, imageTransform?.height, isSelected, isEditing, isParentSelected]);



    // --- Geometry Helpers ---

    const getCenter = () => {
        if (!dragState) return { x: 0, y: 0 };
        return {
            x: (dragState.start.x + dragState.end.x) / 2,
            y: (dragState.start.y + dragState.end.y) / 2
        };
    };

    const getPerpendicularLineCoords = (point: { x: number, y: number }, axisStart: { x: number, y: number }, axisEnd: { x: number, y: number }, totalLength = 10000) => {
        const dx = axisEnd.x - axisStart.x;
        const dy = axisEnd.y - axisStart.y;

        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.001) return { x1: point.x - totalLength, y1: point.y, x2: point.x + totalLength, y2: point.y };

        const udx = -dy / len;
        const udy = dx / len;

        const halfLen = totalLength / 2;

        return {
            x1: point.x + udx * halfLen,
            y1: point.y + udy * halfLen,
            x2: point.x - udx * halfLen,
            y2: point.y - udy * halfLen
        };
    };

    // --- Interaction Handlers ---

    const handlePointerDown = (e: React.PointerEvent, action: 'move-center' | 'rotate-start' | 'rotate-end' | 'rotate-pivot') => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        if (!dragState) return;

        onDragStart?.();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const center = getCenter();
        const initialClickOffset = {
            x: x - center.x,
            y: y - center.y
        };

        let pivotRadius = 0;
        if (action === 'rotate-pivot') {
            const dx = dragState.start.x - center.x;
            const dy = dragState.start.y - center.y;
            pivotRadius = Math.sqrt(dx * dx + dy * dy);
        }

        setDragState({
            ...dragState,
            isDragging: action,
            initialClickOffset,
            pivotRadius,
            initialCenter: { ...center }
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState || !dragState.isDragging || !imageTransform) return;
        e.stopPropagation();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (dragState.isDragging === 'move-center') {
            const offset = dragState.initialClickOffset || { x: 0, y: 0 };
            const newCenterX = x - offset.x;
            const newCenterY = y - offset.y;

            // Calculate new positions based on center delta
            const currentCenter = getCenter();
            const dx = newCenterX - currentCenter.x;
            const dy = newCenterY - currentCenter.y;

            setDragState({
                ...dragState,
                start: { x: dragState.start.x + dx, y: dragState.start.y + dy },
                end: { x: dragState.end.x + dx, y: dragState.end.y + dy }
            });

            // Propagate TOTAL delta for multi-select
            if (onDrag && dragState.initialCenter) {
                const totalDeltaX = newCenterX - dragState.initialCenter.x;
                const totalDeltaY = newCenterY - dragState.initialCenter.y;
                const scale = imageTransform.scale || 1;

                onDrag({
                    x: totalDeltaX / scale,
                    y: totalDeltaY / scale
                });
            }
            // NO onUpdate
            return;

        } else if (dragState.isDragging === 'rotate-start' || dragState.isDragging === 'rotate-end') {
            const center = getCenter();
            const vX = x - center.x;
            const vY = y - center.y;
            const isStart = dragState.isDragging === 'rotate-start';
            const mag = Math.sqrt(vX * vX + vY * vY);

            if (mag < 5) return;

            let newStart, newEnd;
            if (isStart) {
                newStart = { x: center.x + vX, y: center.y + vY };
                newEnd = { x: center.x - vX, y: center.y - vY };
            } else {
                newEnd = { x: center.x + vX, y: center.y + vY };
                newStart = { x: center.x - vX, y: center.y - vY };
            }

            setDragState({ ...dragState, start: newStart, end: newEnd });
            // NO onUpdate
            return;

        } else if (dragState.isDragging === 'rotate-pivot') {
            const center = getCenter();
            const mx = x - center.x;
            const my = y - center.y;
            const mLen = Math.sqrt(mx * mx + my * my);

            if (mLen < 1) return;

            const uMx = mx / mLen;
            const uMy = my / mLen;

            const oldAxisX = dragState.start.x - center.x;
            const oldAxisY = dragState.start.y - center.y;

            const c1x = -uMy;
            const c1y = uMx;
            const dot = c1x * oldAxisX + c1y * oldAxisY;

            let finalDirX, finalDirY;
            if (dot > 0) {
                finalDirX = c1x; finalDirY = c1y;
            } else {
                finalDirX = uMy; finalDirY = -uMx;
            }

            const spread = dragState.pivotRadius || 50;
            setDragState({
                ...dragState,
                start: { x: center.x + finalDirX * spread, y: center.y + finalDirY * spread },
                end: { x: center.x - finalDirX * spread, y: center.y - finalDirY * spread }
            });
            // NO onUpdate
            return;
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState?.isDragging) return;
        e.stopPropagation();
        e.preventDefault(); // Prevent click event generation after drag
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (imageTransform) {
            const normStart = {
                x: dragState.start.x / imageTransform.width,
                y: dragState.start.y / imageTransform.height
            };
            const normEnd = {
                x: dragState.end.x / imageTransform.width,
                y: dragState.end.y / imageTransform.height
            };

            const maskMX = region.maskWidth;
            const maskMY = region.maskHeight;
            const maskStart = { x: normStart.x * maskMX, y: normStart.y * maskMY };
            const maskEnd = { x: normEnd.x * maskMX, y: normEnd.y * maskMY };

            const data = new Uint8Array(maskMX * maskMY);
            const vx = maskEnd.x - maskStart.x;
            const vy = maskEnd.y - maskStart.y;
            const mag2 = vx * vx + vy * vy;

            if (mag2 > 0.0001) {
                for (let y = 0; y < maskMY; y++) {
                    for (let x = 0; x < maskMX; x++) {
                        const px = x - maskStart.x;
                        const py = y - maskStart.y;
                        const u = (px * vx + py * vy) / mag2;
                        let alpha = 0;
                        if (u <= 0) alpha = 255;
                        else if (u >= 1) alpha = 0;
                        else alpha = Math.round((1 - u) * 255);

                        if (alpha > 0) data[y * maskMX + x] = alpha;
                    }
                }
            }

            const sourceUpdates = {
                maskData: data,
                gradient: { start: normStart, end: normEnd }
            };

            // For move-center: pass updates through onDragEnd to avoid duplicate onUpdateTile calls
            if (dragState.isDragging === 'move-center') {
                onDragEnd?.(sourceUpdates);
            } else {
                onUpdate(sourceUpdates);
            }
        }

        setDragState({ ...dragState, isDragging: null });
    };

    if (!imageTransform || !dragState) return null;

    const center = getCenter();
    const centerLine = getPerpendicularLineCoords(center, dragState.start, dragState.end); // Full line for editing
    const startLine = getPerpendicularLineCoords(dragState.start, dragState.start, dragState.end);
    const endLine = getPerpendicularLineCoords(dragState.end, dragState.start, dragState.end);

    // Cursor for the perpendicular lines based on their angle
    const perpAngle = Math.atan2(
        dragState.end.y - dragState.start.y,
        dragState.end.x - dragState.start.x
    ) * 180 / Math.PI;
    const a = ((perpAngle % 180) + 180) % 180;
    const lineCursor = a < 22.5 || a >= 157.5 ? 'ew-resize'
        : a < 67.5 ? 'nwse-resize'
        : a < 112.5 ? 'ns-resize'
        : 'nesw-resize';

    // Short line for indicator: 80px total length
    const rotateIndicator = getPerpendicularLineCoords(center, dragState.start, dragState.end, 80);

    // STATE 1: Not Editing (Unselected OR Selected)
    if (!isEditing) {
        return (
            <div
                ref={containerRef}
                className="absolute inset-0 z-40 pointer-events-none"
                style={{
                    width: imageTransform.width,
                    height: imageTransform.height,
                }}
            >
                {/* Canvas removed: ToolLayer renders the static overlay */}

                {isSelected ? (
                    <div
                        className={cn(
                            "absolute w-4 h-4 rounded cursor-pointer transform -translate-x-1/2 -translate-y-1/2 border-2 pointer-events-auto shadow-md transition-colors",
                            "bg-blue-600 border-white hover:bg-blue-500 cursor-move" // Selected
                        )}
                        style={{ left: center.x, top: center.y }}
                        onPointerDown={(e) => handlePointerDown(e, 'move-center')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(e);
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onDoubleClick?.(e);
                        }}
                    />
                ) : (
                    <div
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto transition-transform hover:scale-110"
                        style={{ left: center.x, top: center.y }}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(e);
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onDoubleClick?.(e);
                        }}
                    >
                        <GlassCard
                            width={16}
                            height={16}
                            borderRadius={4}
                            blur={6}
                            distortion={12}
                            chromaticAberration={0}
                            borderOpacity={0}
                            borderColor="#000000"
                            backgroundOpacity={0.1}
                            outerLightBlur={10}
                            outerLightOpacity={0.4}
                            outerLightColor="#000000"
                            contentClassName="flex items-center justify-center w-full h-full"
                            className="cursor-pointer"
                            flexibility={0}
                        />
                    </div>
                )}
            </div>
        );
    }

    // STATE 2: Editing (Lines + Controls)
    return (
        <div
            ref={containerRef}
            className={`absolute inset-0 z-50 ${dragState?.isDragging ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{
                width: imageTransform.width,
                height: imageTransform.height,
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            {/* Live Preview Canvas */}
            <canvas
                ref={canvasRef}
                width={imageTransform.width}
                height={imageTransform.height}
                className="absolute inset-0 pointer-events-none"
            />

            {/* SVG Lines */}
            <svg className="absolute inset-0 w-full h-full visible overflow-visible pointer-events-none">
                <line
                    x1={dragState.start.x} y1={dragState.start.y}
                    x2={dragState.end.x} y2={dragState.end.y}
                    stroke="rgba(255,255,255,0.4)" strokeWidth="1" strokeDasharray="4 4"
                />

                {/* Start Line */}
                <line
                    x1={startLine.x1} y1={startLine.y1}
                    x2={startLine.x2} y2={startLine.y2}
                    stroke="transparent" strokeWidth="20"
                    className="pointer-events-auto"
                    style={{ cursor: lineCursor }}
                    onPointerDown={(e) => handlePointerDown(e, 'rotate-start')}
                    onClick={(e) => e.stopPropagation()}
                />
                <line
                    x1={startLine.x1} y1={startLine.y1}
                    x2={startLine.x2} y2={startLine.y2}
                    stroke="rgba(200,200,200,0.8)" strokeWidth="1"
                    className="pointer-events-none hover:stroke-white"
                />

                {/* Center Line */}
                <line
                    x1={centerLine.x1} y1={centerLine.y1}
                    x2={centerLine.x2} y2={centerLine.y2}
                    stroke="transparent" strokeWidth="20"
                    className="cursor-refresh pointer-events-auto"
                    style={{ cursor: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2\"><path d=\"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/></svg>') 10 10, auto" }}
                    onPointerDown={(e) => handlePointerDown(e, 'rotate-pivot')}
                    onClick={(e) => e.stopPropagation()}
                />
                <line
                    x1={centerLine.x1} y1={centerLine.y1}
                    x2={centerLine.x2} y2={centerLine.y2}
                    stroke="white" strokeWidth="1.5"
                    className="pointer-events-none"
                />

                {/* End Line */}
                <line
                    x1={endLine.x1} y1={endLine.y1}
                    x2={endLine.x2} y2={endLine.y2}
                    stroke="transparent" strokeWidth="20"
                    className="pointer-events-auto"
                    style={{ cursor: lineCursor }}
                    onPointerDown={(e) => handlePointerDown(e, 'rotate-end')}
                    onClick={(e) => e.stopPropagation()}
                />
                <line
                    x1={endLine.x1} y1={endLine.y1}
                    x2={endLine.x2} y2={endLine.y2}
                    stroke="rgba(200,200,200,0.8)" strokeWidth="1"
                    className="pointer-events-none hover:stroke-white"
                />
            </svg>

            <div
                className="absolute w-8 h-8 rounded-full cursor-grab active:cursor-grabbing transform -translate-x-1/2 -translate-y-1/2 hover:bg-white/10 pointer-events-auto"
                style={{ left: dragState.start.x, top: dragState.start.y }}
                onPointerDown={(e) => handlePointerDown(e, 'rotate-start')}
                onClick={(e) => e.stopPropagation()}
            />

            <div
                className="absolute w-8 h-8 rounded-full cursor-grab active:cursor-grabbing transform -translate-x-1/2 -translate-y-1/2 hover:bg-white/10 pointer-events-auto"
                style={{ left: dragState.end.x, top: dragState.end.y }}
                onPointerDown={(e) => handlePointerDown(e, 'rotate-end')}
                onClick={(e) => e.stopPropagation()}
            />

            <div
                className={cn(
                    "absolute w-4 h-4 bg-[#3B82F6] rounded-sm border-2 border-white shadow-sm cursor-move transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform z-50 pointer-events-auto",
                    dragState.isDragging === 'move-center' && "scale-110"
                )}
                style={{
                    left: center.x,
                    top: center.y
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move-center')}
                onClick={(e) => e.stopPropagation()}
            />

        </div>
    );
}
