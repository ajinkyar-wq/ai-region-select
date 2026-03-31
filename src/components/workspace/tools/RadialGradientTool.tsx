import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';
import { cn } from '@/lib/utils';
import { generateRadialGradientMask } from '@/lib/mask-analysis';
import { GlassCard } from 'react-glass-ui';
import { FlipVertical2 } from 'lucide-react';

interface RadialGradientToolProps {
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
    /** When set, the gradient overlay is clipped to these mask pixels (for intersect mode) */
    clipMask?: { data: Uint8Array; width: number; height: number };
    /** When true the parent mask is selected — gradient should reveal its overlay even without editing */
    isParentSelected?: boolean;
}

export function RadialGradientTool({
    imageTransform,
    region,
    isSelected,
    isEditing,
    onUpdate,
    onSelect,
    onDoubleClick,
    onDrag,
    onDragEnd,
    clipMask,
    isParentSelected = false,
}: RadialGradientToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ringCursor, setRingCursor] = useState<string>('nwse-resize');

    // Local state for smooth dragging
    const [dragState, setDragState] = useState<{
        center: { x: number, y: number }; // Pixel coords
        radius: { x: number, y: number }; // Pixel radii
        feather: number; // 0-1 Ratio
        rotation: number; // Degrees
        isDragging: 'move-center' | 'resize-outer-n' | 'resize-outer-s' | 'resize-outer-e' | 'resize-outer-w' | 'resize-outer-free' | 'resize-inner-n' | 'resize-inner-s' | 'resize-inner-e' | 'resize-inner-w' | 'rotate' | null;
        initialClickOffset?: { x: number; y: number }; // For relative move
        initialRadius?: { x: number, y: number };
        initialCenter?: { x: number, y: number }; // For calculating total delta
        initialRotation?: number; // For rotate drag
    } | null>(null);

    // Sync state with region prop
    useEffect(() => {
        if (!imageTransform || !region.radialGradient) return;

        const center = {
            x: region.radialGradient.center.x * imageTransform.width,
            y: region.radialGradient.center.y * imageTransform.height
        };
        const radius = {
            x: region.radialGradient.radius.x * imageTransform.width,
            y: region.radialGradient.radius.y * imageTransform.height
        };

        // Only sync if NOT dragging to avoid fighting local updates
        if (!dragState?.isDragging) {
            setDragState({
                center,
                radius,
                feather: region.radialGradient.feather,
                rotation: region.radialGradient.rotation ?? 0,
                isDragging: null
            });
        }
    }, [region.radialGradient, imageTransform?.width, imageTransform?.height, imageTransform?.x, imageTransform?.y, dragState?.isDragging]);

    // Live Gradient Preview (Uses Local State 'dragState')
    useEffect(() => {
        const canvas = canvasRef.current;
        // Render if dragging OR if selected/editing. 
        // We always want to render the gradient on the preview canvas if we are active.
        if (!canvas || !dragState || !imageTransform) return;

        // When parent is selected and handles are not actively being dragged:
        // the parent's rendering layer already draws the intersection — clear to avoid doubling.
        // Only show our own canvas during an active handle drag (live positioning feedback).
        if (isParentSelected && !dragState.isDragging) {
            const ctx2 = canvas.getContext('2d');
            if (ctx2) ctx2.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        // Default off: not editing, not dragging, and not selected without a parent.
        if (!isEditing && !dragState.isDragging && !isSelected) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Elliptical Gradient Visualization
        // HTML5 Canvas gradient is strictly circular.
        // To do Ellipse, we must scale the context.

        const { center, radius, feather, rotation } = dragState;
        const isInverted = region.radialGradient?.invert || false;

        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate((rotation * Math.PI) / 180);

        // Calculate scaling to transform circle to ellipse
        // Let's draw a Unit circle and scale it to radius.x, radius.y
        if (radius.x > 0 && radius.y > 0) {
            ctx.scale(1, radius.y / radius.x);
        }

        // Now we are in a space where drawing a Circle(r=radius.x) will look like Ellipse(rx, ry)
        const effectiveRadius = radius.x;
        const effectiveInnerRadius = effectiveRadius * feather;

        // Gradient in transformed space
        const grad = ctx.createRadialGradient(
            0, 0, effectiveInnerRadius,
            0, 0, effectiveRadius
        );

        const cm = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
        const rC = cm ? parseInt(cm[1], 16) : 255;
        const gC = cm ? parseInt(cm[2], 16) : 50;
        const bC = cm ? parseInt(cm[3], 16) : 50;

        if (isInverted) {
            grad.addColorStop(0, `rgba(${rC}, ${gC}, ${bC}, 0)`);
            grad.addColorStop(1, `rgba(${rC}, ${gC}, ${bC}, 0.4)`);
        } else {
            grad.addColorStop(0, `rgba(${rC}, ${gC}, ${bC}, 0.4)`);
            grad.addColorStop(1, `rgba(${rC}, ${gC}, ${bC}, 0)`);
        }

        ctx.fillStyle = grad;

        // We need to fill the whole canvas, but we are transformed.
        // We need to inverse transform the fill rect bounds?
        // Easier: Just fill a massive rect that covers the screen
        const maxDim = Math.max(imageTransform.width, imageTransform.height) * 2;
        ctx.fillRect(-maxDim, -maxDim, maxDim * 2, maxDim * 2);

        ctx.restore();

        // If inverted, we need to fill the "rest" of the screen with Red because gradient stops at outer radius.
        // The gradient above handles the transition. 
        // Logic check:
        // Inverted:
        // Inner (0) -> Transp
        // Outer (1) -> Red (0.4)
        // Outside (>1) -> Red (0.4) (Extended by fillRect with the gradient? Canvas extends last stop)
        // Correct.

        // ── Clip to parent mask if in intersect mode ──────────────────────
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

    }, [dragState, clipMask, imageTransform?.width, imageTransform?.height, isSelected, isEditing, isParentSelected, region.radialGradient?.invert, region.radialGradient?.rotation]);


    // --- Interaction Handlers ---

    const handlePointerDown = (e: React.PointerEvent, action: any) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        if (!dragState) return;

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const initialClickOffset = {
            x: x - dragState.center.x,
            y: y - dragState.center.y
        };

        setDragState({
            ...dragState,
            isDragging: action,
            initialClickOffset,
            initialRadius: { ...dragState.radius },
            initialCenter: { ...dragState.center },
            initialRotation: dragState.rotation
        });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!dragState || !dragState.isDragging || !imageTransform) return;
        e.stopPropagation();

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dxRaw = x - dragState.center.x;
        const dyRaw = y - dragState.center.y;
        // Unrotate into ellipse local space
        const rotRadMove = (dragState.rotation * Math.PI) / 180;
        const cosM = Math.cos(-rotRadMove);
        const sinM = Math.sin(-rotRadMove);
        const dx = cosM * dxRaw - sinM * dyRaw;
        const dy = sinM * dxRaw + cosM * dyRaw;

        let newRadius = { ...dragState.radius };
        let newFeather = dragState.feather;
        let newRotation = dragState.rotation;

        switch (dragState.isDragging) {
            case 'move-center':
                const offset = dragState.initialClickOffset || { x: 0, y: 0 };
                const newX = x - offset.x;
                const newY = y - offset.y;

                setDragState({
                    ...dragState,
                    center: { x: newX, y: newY }
                });

                // Propagate TOTAL delta in Image Pixels
                if (onDrag && dragState.initialCenter) {
                    const deltaScreenX = newX - dragState.initialCenter.x;
                    const deltaScreenY = newY - dragState.initialCenter.y;
                    const scale = imageTransform.scale || 1;

                    onDrag({
                        x: deltaScreenX / scale,
                        y: deltaScreenY / scale
                    });
                }
                return;

            case 'rotate': {
                const angle = Math.atan2(y - dragState.center.y, x - dragState.center.x) * 180 / Math.PI;
                newRotation = ((angle % 360) + 360) % 360;
                break;
            }

            // --- Outer Resizing (Radius) ---
            case 'resize-outer-e': // Right -> Modifies X
            case 'resize-outer-w': // Left -> Modifies X
                newRadius.x = Math.max(5, Math.abs(dx));
                break;
            case 'resize-outer-s': // Bottom -> Modifies Y
            case 'resize-outer-n': // Top -> Modifies Y
                newRadius.y = Math.max(5, Math.abs(dy));
                break;
            case 'resize-outer-free': // Ring drag -> Modifies both X and Y
                newRadius.x = Math.max(5, Math.abs(dx));
                newRadius.y = Math.max(5, Math.abs(dy));
                break;

            // --- Inner Resizing (Feather) ---
            case 'resize-inner-e':
            case 'resize-inner-w':
                // Horizontal feather
                newFeather = Math.min(1, Math.max(0, Math.abs(dx) / newRadius.x));
                break;
        }

        // JUST Update Local State (No onUpdate call here)
        setDragState({
            ...dragState,
            radius: newRadius,
            feather: newFeather,
            rotation: newRotation
        });
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!dragState?.isDragging) return;
        e.stopPropagation();
        e.preventDefault(); // Prevent click event generation after drag
        e.currentTarget.releasePointerCapture(e.pointerId);

        if (imageTransform) {
            // Normalized Params
            const normCenter = {
                x: dragState.center.x / imageTransform.width,
                y: dragState.center.y / imageTransform.height
            };
            const normRadius = {
                x: dragState.radius.x / imageTransform.width,
                y: dragState.radius.y / imageTransform.height
            };

            const width = Math.floor(region.maskWidth);
            const height = Math.floor(region.maskHeight);
            const isInverted = region.radialGradient?.invert || false;

            const maskData = generateRadialGradientMask(
                width,
                height,
                normCenter,
                normRadius,
                dragState.feather,
                isInverted,
                dragState.rotation
            );

            const sourceUpdates = {
                maskData,
                radialGradient: {
                    center: normCenter,
                    radius: normRadius,
                    feather: dragState.feather,
                    invert: isInverted,
                    rotation: dragState.rotation
                }
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

    const handleInvert = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (imageTransform) {
            const isInverted = !region.radialGradient?.invert;

            const width = Math.floor(region.maskWidth);
            const height = Math.floor(region.maskHeight);

            // Use Region's own normalized values
            const normCenter = region.radialGradient!.center;
            const normRadius = region.radialGradient!.radius;
            const feather = region.radialGradient!.feather;

            const maskData = generateRadialGradientMask(
                width,
                height,
                normCenter,
                normRadius,
                feather,
                isInverted,
                region.radialGradient!.rotation ?? 0
            );

            onUpdate({
                maskData,
                radialGradient: {
                    ...region.radialGradient!,
                    invert: isInverted
                }
            });
        }
    };


    if (!imageTransform || !dragState) return null;

    // STATE 1: Not Editing
    if (!isEditing) {
        return (
            <div
                ref={containerRef}
                className="absolute inset-0 z-40 pointer-events-none"
                style={{ width: imageTransform.width, height: imageTransform.height }}
            >
                {/* Canvas removed: ToolLayer renders the static overlay */}
                {/* Center Handle for selection */}
                {isSelected ? (
                    <div
                        className={cn(
                            "absolute w-5 h-5 rounded-full pointer-events-auto transform -translate-x-1/2 -translate-y-1/2 shadow-[0_2px_5px_rgba(0,0,0,0.2)] flex items-center justify-center z-50",
                            "transition-[transform,background-color,border-color,box-shadow]",
                            "cursor-move",
                            "bg-blue-600 border-2 border-white ring-4 ring-blue-600/20 scale-110",
                            "hover:ring-blue-600/40 hover:scale-125"
                        )}
                        style={{ left: dragState.center.x, top: dragState.center.y }}
                        onPointerDown={(e) => handlePointerDown(e, 'move-center')}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onClick={(e) => { e.stopPropagation(); onSelect?.(e); }}
                        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(e); }}
                    >
                        {/* Inner Dot */}
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                ) : (
                    <div
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-auto transition-transform hover:scale-110"
                        style={{ left: dragState.center.x, top: dragState.center.y }}
                        onClick={(e) => { e.stopPropagation(); onSelect?.(e); }}
                        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(e); }}
                    >
                        <GlassCard
                            width={20}
                            height={20}
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
                            contentClassName="flex items-center justify-center w-full h-full"
                            className="cursor-pointer"
                            flexibility={0}
                        />
                    </div>
                )}
            </div>
        );
    }

    // STATE 2: Editing
    const featherRx = dragState.radius.x * dragState.feather;
    const featherRy = dragState.radius.y * dragState.feather;

    // Rotation handle: a point above the top of the outer ellipse, rotated
    const rotRad = (dragState.rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    // Rotate a local offset (lx, ly) around center
    const rotPt = (lx: number, ly: number) => ({
        x: dragState.center.x + lx * cosR - ly * sinR,
        y: dragState.center.y + lx * sinR + ly * cosR,
    });
    const rotHandleOffset = dragState.radius.y + 28;
    const rotHandle = rotPt(0, -rotHandleOffset);
    const rotHandleX = rotHandle.x;
    const rotHandleY = rotHandle.y;
    // Tick line from top of ellipse to rotation handle
    const tick = rotPt(0, -dragState.radius.y);
    const tickX = tick.x;
    const tickY = tick.y;
    // Rotated cardinal handle positions
    const handleN = rotPt(0, -dragState.radius.y);
    const handleS = rotPt(0, dragState.radius.y);
    const handleW = rotPt(-dragState.radius.x, 0);
    const handleE = rotPt(dragState.radius.x, 0);
    const handleInnerE = rotPt(featherRx, 0);

    // Generic Handle Component
    const Handle = ({ x, y, cursor, rotateCursor, onDown, isInner }: any) => {
        const [hovered, setHovered] = useState(false);
        return (
        <div
            className={cn(
                "absolute rounded-full transform -translate-x-1/2 -translate-y-1/2 z-50 flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.2)] pointer-events-auto",
                "transition-[transform,background-color,border-color,box-shadow]",
                // Base size
                "w-4 h-4",
                // Colors & Rings
                isInner
                    ? "bg-white/90 border border-blue-500/50 ring-2 ring-white/50"
                    : "bg-white border border-gray-300 ring-2 ring-transparent hover:ring-blue-400",
                // Hover Effects
                "hover:scale-125 hover:z-60",
                isInner ? "hover:bg-blue-50" : "hover:bg-gray-50"
            )}
            style={{ left: x, top: y, cursor: hovered && rotateCursor ? 'crosshair' : cursor }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onPointerDown={onDown}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Center dot for precision feel */}
            <div className={cn("w-1 h-1 rounded-full", isInner ? "bg-blue-400" : "bg-gray-400")} />
        </div>
        );
    };

    return (
        <div
            ref={containerRef}
            className={`absolute inset-0 z-50 ${dragState?.isDragging ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ width: imageTransform.width, height: imageTransform.height }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
        >
            <canvas ref={canvasRef} width={imageTransform.width} height={imageTransform.height} className="absolute inset-0 pointer-events-none" />

            <svg className="absolute inset-0 w-full h-full visible overflow-visible pointer-events-none">
                <g transform={`rotate(${dragState.rotation}, ${dragState.center.x}, ${dragState.center.y})`}>
                    {/* Outer Ring — visual */}
                    <ellipse
                        cx={dragState.center.x} cy={dragState.center.y}
                        rx={Math.max(0, dragState.radius.x)} ry={Math.max(0, dragState.radius.y)}
                        fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1"
                    />
                    {/* Outer Ring — fat invisible hit area, pick nearest axis to resize */}
                    <ellipse
                        cx={dragState.center.x} cy={dragState.center.y}
                        rx={Math.max(0, dragState.radius.x)} ry={Math.max(0, dragState.radius.y)}
                        fill="none" stroke="transparent" strokeWidth="24"
                        style={{ pointerEvents: 'stroke', cursor: ringCursor }}
                        onPointerMove={(e) => {
                            const rect = containerRef.current?.getBoundingClientRect();
                            if (!rect || !dragState) return;
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const angle = Math.atan2(y - dragState.center.y, x - dragState.center.x) * 180 / Math.PI;
                            const a = ((angle % 180) + 180) % 180; // 0-180
                            if (a < 22.5 || a >= 157.5) setRingCursor('ew-resize');
                            else if (a < 67.5) setRingCursor('nwse-resize');
                            else if (a < 112.5) setRingCursor('ns-resize');
                            else setRingCursor('nesw-resize');
                        }}
                        onPointerDown={(e) => handlePointerDown(e as any, 'resize-outer-free')}
                        onClick={(e) => e.stopPropagation()}
                    />
                    {/* Inner Ring */}
                    <ellipse
                        cx={dragState.center.x} cy={dragState.center.y}
                        rx={Math.max(0, featherRx)} ry={Math.max(0, featherRy)}
                        fill="none" stroke="rgba(200,200,200,0.6)" strokeWidth="1" strokeDasharray="4 4"
                    />
                </g>
                {/* Rotation handle stem line */}
                <line
                    x1={tickX} y1={tickY} x2={rotHandleX} y2={rotHandleY}
                    stroke="rgba(255,255,255,0.6)" strokeWidth="1" strokeDasharray="3 3"
                />
            </svg>

            {/* Center Handle */}
            <div
                className={cn(
                    "absolute w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-[0_2px_5px_rgba(0,0,0,0.3)] cursor-move transform -translate-x-1/2 -translate-y-1/2 z-50 flex items-center justify-center pointer-events-auto",
                    "transition-[transform,background-color,border-color,box-shadow]",
                    // Outer ring for "selected" feel
                    "ring-2 ring-blue-500/30",
                    dragState.isDragging === 'move-center' ? "scale-110 ring-4 ring-blue-500/50" : "hover:scale-110 hover:ring-4 hover:ring-blue-500/30"
                )}
                style={{ left: dragState.center.x, top: dragState.center.y }}
                onPointerDown={(e) => handlePointerDown(e, 'move-center')}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="w-1.5 h-1.5 bg-white rounded-full" />
            </div>

            {/* Invert Button — sits 20px to the right of the rotation handle */}
            <button
                onClick={handleInvert}
                title={region.radialGradient?.invert ? "Invert: ON" : "Invert"}
                className={cn(
                    "absolute w-[18px] h-[18px] flex items-center justify-center rounded-full border z-50 pointer-events-auto transform -translate-x-1/2 -translate-y-1/2 transition-colors shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
                    region.radialGradient?.invert
                        ? "bg-white border-gray-200 text-black"
                        : "bg-white border-gray-200 text-gray-500"
                )}
                style={{ left: dragState.center.x + 20, top: dragState.center.y - 20 }}
            >
                <FlipVertical2 size={9} />
            </button>

            {/* Rotation Handle */}
            <div
                className={cn(
                    "absolute w-5 h-5 rounded-full transform -translate-x-1/2 -translate-y-1/2 z-50 flex items-center justify-center pointer-events-auto shadow-[0_2px_4px_rgba(0,0,0,0.3)]",
                    "bg-white/90 border border-purple-400 ring-2 ring-purple-300/50",
                    "hover:scale-125 hover:ring-purple-400 cursor-crosshair"
                )}
                style={{ left: rotHandleX, top: rotHandleY }}
                onPointerDown={(e) => handlePointerDown(e, 'rotate')}
                onClick={(e) => e.stopPropagation()}
                title="Rotate"
            >
                <div className="w-1 h-1 rounded-full bg-purple-400" />
            </div>

            {/* --- Outer Handles (4) — show rotate cursor on hover --- */}
            <Handle x={handleN.x} y={handleN.y} cursor="ns-resize" rotateCursor onDown={(e: any) => handlePointerDown(e, 'resize-outer-n')} />
            <Handle x={handleS.x} y={handleS.y} cursor="ns-resize" rotateCursor onDown={(e: any) => handlePointerDown(e, 'resize-outer-s')} />
            <Handle x={handleW.x} y={handleW.y} cursor="ew-resize" rotateCursor onDown={(e: any) => handlePointerDown(e, 'resize-outer-w')} />
            <Handle x={handleE.x} y={handleE.y} cursor="ew-resize" rotateCursor onDown={(e: any) => handlePointerDown(e, 'resize-outer-e')} />

            {/* --- Inner Handle (1) - Right Side only --- */}
            <Handle x={handleInnerE.x} y={handleInnerE.y} cursor="ew-resize" isInner onDown={(e: any) => handlePointerDown(e, 'resize-inner-e')} />

        </div>
    );
}
