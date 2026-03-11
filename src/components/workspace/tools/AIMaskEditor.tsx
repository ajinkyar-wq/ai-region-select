import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';

interface AIMaskEditorProps {
    activeRegions: Region[];
    allPersonRegions: Region[];
    backgroundRegion: Region | null;
    imageTransform: {
        scale: number;
        x: number;
        y: number;
        width: number;
        height: number;
    };
    canvasWidth: number;
    canvasHeight: number;
    onMasksUpdate: (updates: { id: string; maskData: Uint8Array }[]) => void;
    onExit: () => void;

    mode?: 'add' | 'erase';
    brushSize?: number;
    softness?: number;
    opacity?: number;
}

export function AIMaskEditor({
    activeRegions,
    allPersonRegions,
    backgroundRegion,
    imageTransform,
    canvasWidth,
    canvasHeight,
    onMasksUpdate,
    mode = 'add',
    brushSize = 20,
    softness = 0,
    opacity = 100,
}: AIMaskEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

    // One mutable mask buffer per active region (keyed by region id)
    const maskBuffers = useRef<Map<string, { data: Uint8Array; w: number; h: number }>>(new Map());

    // ── Initialize / sync ────────────────────────────────────────────────────
    useEffect(() => {
        maskBuffers.current.clear();
        for (const r of activeRegions) {
            maskBuffers.current.set(r.id, {
                data: new Uint8Array(r.maskData),
                w: r.maskWidth,
                h: r.maskHeight,
            });
        }
        renderEditorCanvas();
    }, [activeRegions]);

    // ── Canvas rendering ─────────────────────────────────────────────────────
    const renderEditorCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const color = mode === 'erase' ? [255, 80, 80] : [34, 197, 94];

        maskBuffers.current.forEach(({ data, w, h }) => {
            const imageData = new ImageData(w, h);
            for (let i = 0; i < data.length; i++) {
                const alpha = data[i];
                if (alpha > 0) {
                    imageData.data[i * 4] = color[0];
                    imageData.data[i * 4 + 1] = color[1];
                    imageData.data[i * 4 + 2] = color[2];
                    imageData.data[i * 4 + 3] = Math.round(alpha * 0.6);
                }
            }
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        });
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = imageTransform.width;
        canvas.height = imageTransform.height;
        renderEditorCanvas();
    }, [canvasWidth, canvasHeight, imageTransform]);

    useEffect(() => { renderEditorCanvas(); }, [mode]);

    const lastPosRef = useRef<{ x: number, y: number } | null>(null);

    // ── Brush ────────────────────────────────────────────────────────────────
    const applyBrush = (start: { x: number, y: number }, end: { x: number, y: number }) => {
        maskBuffers.current.forEach(({ data, w, h }) => {
            const scaleX = w / imageTransform.width;
            const scaleY = h / imageTransform.height;

            const x0 = start.x * scaleX;
            const y0 = start.y * scaleY;
            const x1 = end.x * scaleX;
            const y1 = end.y * scaleY;

            const rIdx = Math.ceil((brushSize / 2) * Math.max(scaleX, scaleY));
            const innerRadius = rIdx * (1 - softness / 100);
            const fadeDist = Math.max(rIdx - innerRadius, 0.001);
            const targetAlpha = Math.round((opacity / 100) * 255);

            const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
            const stepSize = Math.max(1, rIdx * 0.25);
            const steps = Math.ceil(dist / stepSize);

            for (let si = 0; si <= steps; si++) {
                const t = steps > 0 ? si / steps : 0;
                const cx = Math.round(x0 + (x1 - x0) * t);
                const cy = Math.round(y0 + (y1 - y0) * t);

                const minX = Math.max(0, cx - rIdx);
                const maxX = Math.min(w - 1, cx + rIdx);
                const minY = Math.max(0, cy - rIdx);
                const maxY = Math.min(h - 1, cy + rIdx);

                for (let py = minY; py <= maxY; py++) {
                    for (let px = minX; px <= maxX; px++) {
                        const dx = px - cx;
                        const dy = py - cy;
                        const currDist = Math.sqrt(dx * dx + dy * dy);
                        if (currDist > rIdx) continue;

                        let alphaFactor = currDist <= innerRadius
                            ? 1
                            : 1 - (currDist - innerRadius) / fadeDist;
                        alphaFactor = Math.max(0, Math.min(1, alphaFactor));
                        alphaFactor = alphaFactor * alphaFactor * (3 - 2 * alphaFactor);
                        const brushStrength = Math.round(targetAlpha * alphaFactor);
                        if (brushStrength === 0) continue;

                        const idx = py * w + px;
                        if (mode === 'add') {
                            data[idx] = Math.max(data[idx], brushStrength);
                        } else {
                            data[idx] = Math.min(data[idx], 255 - brushStrength);
                        }
                    }
                }
            }
        });
    };

    const performBrushStroke = (start: { x: number, y: number }, end: { x: number, y: number }) => {
        applyBrush(start, end);
        renderEditorCanvas();
    };

    // ── Commit ───────────────────────────────────────────────────────────────
    const commitUpdates = () => {
        const updates: { id: string; maskData: Uint8Array }[] = [];
        maskBuffers.current.forEach(({ data }, id) => {
            updates.push({ id, maskData: new Uint8Array(data) });
        });
        onMasksUpdate(updates);
    };

    // ── Pointer handlers ─────────────────────────────────────────────────────
    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDrawing(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        performBrushStroke(point, point);
        lastPosRef.current = point;
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setCursorPos({ x, y });
        if (isDrawing && lastPosRef.current) {
            performBrushStroke(lastPosRef.current, { x, y });
            lastPosRef.current = { x, y };
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isDrawing) {
            setIsDrawing(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
            commitUpdates();
        }
    };

    return (
        <>
            <div
                className="absolute z-20 pointer-events-auto cursor-none"
                style={{
                    left: imageTransform.x,
                    top: imageTransform.y,
                    width: imageTransform.width,
                    height: imageTransform.height,
                    overflow: 'hidden',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onClick={(e) => e.stopPropagation()}
            >
                <canvas ref={canvasRef} className="absolute inset-0" />

                <div
                    className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: cursorPos.x, top: cursorPos.y }}
                >
                    <div
                        className="rounded-full border-2 transition-all duration-75 ease-out"
                        style={{
                            width: brushSize,
                            height: brushSize,
                            borderColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.9)' : 'rgba(34, 197, 94, 0.9)',
                            backgroundColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                        }}
                    />
                    <div
                        className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full -translate-x-1/2 -translate-y-1/2"
                        style={{ backgroundColor: mode === 'erase' ? 'rgb(255, 80, 80)' : 'rgb(34, 197, 94)' }}
                    />
                </div>
            </div>
        </>
    );
}
