import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';
import { applyBrushStroke } from '@/lib/brush-engine';

interface BrushToolProps {
    imageTransform: {
        x: number;
        y: number;
        scale: number;
        width: number;
        height: number;
    } | null;
    activeMask: Region | null;
    onMaskUpdate: (regionId: string, newMaskData: Uint8Array) => void;

    // Settings from Toolbar
    brushSize: number;
    brushSoftness: number;
    brushOpacity: number;
    brushMode: 'add' | 'erase';

    /** Called when the user double-clicks to exit edit mode. */
    onExit?: () => void;
}

// Tuned to match OS double-click feel — generous enough that a deliberate
// double-tap is reliably caught, tight enough that a tap-then-real-stroke isn't
// mis-detected.
const DOUBLE_CLICK_MS = 400;       // max gap between tap 1's up and tap 2's down
const DOUBLE_CLICK_PX = 12;        // max distance between tap 1 and tap 2 down points
// A pointerdown→up sequence only counts as a "tap" (half of a double-click) if
// it was short and barely moved. Long holds or drags are real brush strokes.
const TAP_MAX_MS = 400;            // max hold duration for a tap
const TAP_MAX_MOVE_PX = 8;         // max drift within a single tap

export function BrushTool({
    imageTransform,
    activeMask,
    onMaskUpdate,
    brushSize = 20,
    brushSoftness = 0,
    brushOpacity = 100,
    brushMode = 'add',
    onExit,
}: BrushToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const maskDataRef = useRef<Uint8Array | null>(null);
    // Double-click detection: a "tap" is a quick, near-stationary down→up.
    // Two taps in quick succession within DOUBLE_CLICK_PX = double-click exit.
    const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
    // Tracks the in-progress stroke so we can decide on pointerup whether it
    // qualified as a tap.
    const strokeStartRef = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null);
    // Snapshot of the mask buffer from BEFORE the previous stroke. On a detected
    // double-click we restore this to roll back BOTH clicks' dabs (the first one
    // committed on the prior pointerup, and the second one which we never start).
    const prevStrokeSnapshotRef = useRef<Uint8Array | null>(null);

    // Sync mask data ref
    useEffect(() => {
        if (activeMask) {
            maskDataRef.current = new Uint8Array(activeMask.maskData);
        } else {
            maskDataRef.current = null;
        }
    }, [activeMask]);

    // Update canvas size to match image transform
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !imageTransform) return;

        canvas.width = imageTransform.width;
        canvas.height = imageTransform.height;
        renderBrushOverlay(); // Re-render mask when canvas size changes
    }, [imageTransform?.width, imageTransform?.height]);

    // Re-render when mode changes
    useEffect(() => {
        renderBrushOverlay();
    }, [brushMode]);

    // Render current mask state
    const renderBrushOverlay = () => {
        const canvas = canvasRef.current;
        if (!canvas || !activeMask || !maskDataRef.current) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Create ImageData from mask
        const imageData = new ImageData(activeMask.maskWidth, activeMask.maskHeight);
        const maskData = maskDataRef.current;

        const color = brushMode === 'erase' ? [255, 80, 80] : [34, 197, 94];

        for (let i = 0; i < maskData.length; i++) {
            const alpha = maskData[i];
            if (alpha > 0) {
                imageData.data[i * 4] = color[0];
                imageData.data[i * 4 + 1] = color[1];
                imageData.data[i * 4 + 2] = color[2];
                imageData.data[i * 4 + 3] = Math.round(alpha * 0.6); // Scale alpha for comparison but keep visibility
            }
        }

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = activeMask.maskWidth;
        tempCanvas.height = activeMask.maskHeight;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(imageData, 0, 0);

        ctx.save();
        // Use nearest neighbor for crisp pixels
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        ctx.restore();
    };



    const lastPosRef = useRef<{ x: number, y: number } | null>(null);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!imageTransform) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const currentScale = rect.width / imageTransform.width;
        const x = (e.clientX - rect.left) / currentScale;
        const y = (e.clientY - rect.top) / currentScale;
        const now = performance.now();

        // Double-click detection — only if the PREVIOUS stroke was a tap (quick,
        // stationary down→up). Fires BEFORE any brush logic so no second dab lands.
        const lastTap = lastTapRef.current;
        if (lastTap && onExit && activeMask && prevStrokeSnapshotRef.current) {
            const dt = now - lastTap.t;
            const dx = x - lastTap.x;
            const dy = y - lastTap.y;
            if (dt < DOUBLE_CLICK_MS && Math.sqrt(dx * dx + dy * dy) < DOUBLE_CLICK_PX) {
                const restored = new Uint8Array(prevStrokeSnapshotRef.current);
                maskDataRef.current = restored;
                renderBrushOverlay();
                onMaskUpdate(activeMask.id, new Uint8Array(restored));
                lastTapRef.current = null;
                prevStrokeSnapshotRef.current = null;
                strokeStartRef.current = null;
                onExit();
                return;
            }
        }

        // Snapshot the buffer BEFORE this stroke modifies it, so if THIS stroke
        // turns out to be the first tap of a double-click, we can roll it back.
        if (maskDataRef.current) {
            prevStrokeSnapshotRef.current = new Uint8Array(maskDataRef.current);
        }

        strokeStartRef.current = { t: now, x, y, moved: false };
        setIsDrawing(true);
        e.currentTarget.setPointerCapture(e.pointerId);

        if (activeMask && maskDataRef.current) {
            applyBrushStroke(
                { x, y },
                { x, y }, // Start == End for dot
                maskDataRef.current,
                activeMask.maskWidth,
                activeMask.maskHeight,
                imageTransform,
                {
                    radius: brushSize / 2, // Size is diameter
                    softness: brushSoftness,
                    opacity: brushOpacity,
                    mode: brushMode
                }
            );
            renderBrushOverlay();
        }

        lastPosRef.current = { x, y };
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!imageTransform) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const currentScale = rect.width / imageTransform.width;

        const x = (e.clientX - rect.left) / currentScale;
        const y = (e.clientY - rect.top) / currentScale;

        setCursorPos({ x, y });

        if (isDrawing && activeMask && maskDataRef.current && lastPosRef.current) {
            // Flag stroke as "moved" if it drifts past the tap threshold.
            if (strokeStartRef.current && !strokeStartRef.current.moved) {
                const sdx = x - strokeStartRef.current.x;
                const sdy = y - strokeStartRef.current.y;
                if (Math.sqrt(sdx * sdx + sdy * sdy) > TAP_MAX_MOVE_PX) {
                    strokeStartRef.current.moved = true;
                }
            }

            applyBrushStroke(
                lastPosRef.current,
                { x, y },
                maskDataRef.current,
                activeMask.maskWidth,
                activeMask.maskHeight,
                imageTransform,
                {
                    radius: brushSize / 2,
                    softness: brushSoftness,
                    opacity: brushOpacity,
                    mode: brushMode
                }
            );
            renderBrushOverlay();
            lastPosRef.current = { x, y };
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isDrawing) {
            setIsDrawing(false);
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }

            if (activeMask && maskDataRef.current) {
                onMaskUpdate(activeMask.id, new Uint8Array(maskDataRef.current));
            }

            // Only count this stroke as a "tap" (eligible for double-click) if it
            // was short and barely moved. Long holds or drags are real strokes.
            const stroke = strokeStartRef.current;
            if (stroke && !stroke.moved && performance.now() - stroke.t < TAP_MAX_MS) {
                lastTapRef.current = { t: performance.now(), x: stroke.x, y: stroke.y };
            } else {
                lastTapRef.current = null;
            }
            strokeStartRef.current = null;
        }
    };

    // OS-level cancellation (focus loss, gesture interrupt, etc.). Reset state
    // so the next pointerdown starts fresh — and do NOT record this as a tap.
    const handlePointerCancel = (e: React.PointerEvent) => {
        setIsDrawing(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        strokeStartRef.current = null;
        lastTapRef.current = null;
    };

    if (!imageTransform) return null;

    return (
        <div
            className="absolute z-50 cursor-none pointer-events-auto"
            style={{
                left: imageTransform.x,
                top: imageTransform.y,
                width: imageTransform.width,
                height: imageTransform.height,
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0 pointer-events-none"
            />
            {/* Brush Cursor */}
            <div
                className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-1/2"
                style={{
                    left: cursorPos.x,
                    top: cursorPos.y,
                }}
            >
                <div
                    className="rounded-full border-2 transition-all duration-75 ease-out"
                    style={{
                        width: brushSize,
                        height: brushSize,
                        borderColor: brushMode === 'erase' ? 'rgba(255, 80, 80, 0.9)' : 'rgba(34, 197, 94, 0.9)',
                        backgroundColor: brushMode === 'erase' ? 'rgba(255, 80, 80, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                    }}
                />
                <div
                    className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full -translate-x-1/2 -translate-y-1/2"
                    style={{
                        backgroundColor: brushMode === 'erase' ? 'rgb(255, 80, 80)' : 'rgb(34, 197, 94)',
                    }}
                />
            </div>
        </div>
    );
}
