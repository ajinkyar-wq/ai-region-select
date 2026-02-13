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
}

export function BrushTool({
    imageTransform,
    activeMask,
    onMaskUpdate,
    brushSize = 20,
    brushSoftness = 0,
    brushOpacity = 100,
    brushMode = 'add',
}: BrushToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
    const maskDataRef = useRef<Uint8Array | null>(null);

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

        setIsDrawing(true);
        e.currentTarget.setPointerCapture(e.pointerId);

        const rect = e.currentTarget.getBoundingClientRect();
        // Calculate current CSS scale applied to container
        // rect.width is Screen Pixels. imageTransform.width is Logical Pixels (at Scale=1).
        const currentScale = rect.width / imageTransform.width;

        const x = (e.clientX - rect.left) / currentScale;
        const y = (e.clientY - rect.top) / currentScale;

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
            e.currentTarget.releasePointerCapture(e.pointerId);

            if (activeMask && maskDataRef.current) {
                onMaskUpdate(activeMask.id, new Uint8Array(maskDataRef.current));
            }
        }
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
            onClick={(e) => e.stopPropagation()}
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
