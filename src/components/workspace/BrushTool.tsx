// BrushTool.tsx
import { useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import * as ClipperLib from 'clipper-lib';
import { HideButton } from './HideButton';
import type { RegionType } from '@/types/workspace';


interface BrushToolProps {
    regionId: string;
    regionPathData: string;
    regionType: RegionType;
    imageTransform: {
        scale: number;
        x: number;
        y: number;
        width: number;
        height: number;
    };
    canvasWidth: number;
    canvasHeight: number;
    onPathUpdate: (newPathData: string) => void;
    onExit: () => void;
}

export function BrushTool({
    regionId,
    regionPathData,
    regionType,
    imageTransform,
    canvasWidth,
    canvasHeight,
    onPathUpdate,
    onExit
}: BrushToolProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<fabric.Canvas | null>(null);
    const currentPathRef = useRef<string>(regionPathData);

    const [mode, setMode] = useState<'add' | 'erase'>('add');
    const [brushSize, setBrushSize] = useState(20);
    const cursorRef = useRef({ x: 0, y: 0 });
    const buttonRef = useRef({ x: 0, y: 0 });

    const [buttonPos, setButtonPos] = useState({ x: 0, y: 0 });
    const isHoveringButtonRef = useRef(false);
    const isDrawingRef = useRef(false);

    const isSizingRef = useRef(false);
    const sizeStartRef = useRef({
        x: 0,
        y: 0,
        size: 20,
    });





    useEffect(() => {
        if (!canvasRef.current) return;

        // Initialize Fabric canvas
        const canvas = new fabric.Canvas(canvasRef.current, {
            isDrawingMode: true,
            width: canvasWidth,
            height: canvasHeight,
        });

        canvas.defaultCursor = 'none';
        canvas.hoverCursor = 'none';

        fabricCanvasRef.current = canvas;

        canvas.on('mouse:down', () => {
            isDrawingRef.current = true;
        });

        canvas.on('mouse:up', () => {
            isDrawingRef.current = false;
        });


        // Configure brush
        canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        canvas.freeDrawingBrush.width = brushSize;
        canvas.freeDrawingBrush.color = mode === 'add' ? '#00ff64' : '#ff0000';

        // Show existing region path as reference
        if (regionPathData) {
const referencePath = new fabric.Path(regionPathData, {
  fill: 'rgba(255, 80, 80, 0.25)',   // 🔴 SAME RED AS HOVER
  stroke: 'rgba(255, 80, 80, 0.9)', // 🔴 SAME RED STROKE
  strokeWidth: 2.5,
  selectable: false,
  evented: false,
  name: 'reference-path',
});
            canvas.add(referencePath);
            canvas.sendObjectToBack(referencePath);
        }

        // Handle path creation (when user finishes a stroke)
        canvas.on('path:created', async (e: any) => {
            const drawnPath = e.path;

            console.log('Path created:', drawnPath);

            // Get the drawn path as SVG path data
            const drawnPathData = pathObjectToSVGPathData(drawnPath);

            // Perform boolean operation
            const newPathData = await performBooleanOperation(
                currentPathRef.current,
                drawnPathData,
                mode
            );

            console.log('New path after boolean:', newPathData);

            // Update the reference
            currentPathRef.current = newPathData;

            // Update parent component
            onPathUpdate(newPathData);

            // Remove the drawn stroke and update reference path
            canvas.remove(drawnPath);

            // Update reference path visual
            const refPath = canvas.getObjects().find((obj: any) => obj.name === 'reference-path');
            if (refPath) {
                canvas.remove(refPath);
            }

            if (newPathData && newPathData.length > 0) {
const updatedRefPath = new fabric.Path(newPathData, {
  fill: 'rgba(255, 80, 80, 0.25)',   // 🔴 SAME RED
  stroke: 'rgba(255, 80, 80, 0.9)',
  strokeWidth: 2.5,
  selectable: false,
  evented: false,
  name: 'reference-path',
});
                canvas.add(updatedRefPath);
                canvas.sendObjectToBack(updatedRefPath);
            }

            canvas.renderAll();
        });

        return () => {
            canvas.dispose();
        };
    }, [regionPathData, canvasWidth, canvasHeight]);

    // Update brush when mode/size changes
    useEffect(() => {
        if (fabricCanvasRef.current?.freeDrawingBrush) {
            fabricCanvasRef.current.freeDrawingBrush.width = brushSize;
            fabricCanvasRef.current.freeDrawingBrush.color = mode === 'add' ? '#00ff64' : '#ff0000';
        }
    }, [mode, brushSize]);

    useEffect(() => {
        let raf: number;

        const tick = () => {

            // 🛑 HARD STOP — DO NOT MOVE WHEN CURSOR IS OVER BUTTON
            if (isHoveringButtonRef.current) {
                raf = requestAnimationFrame(tick);
                return;
            }

            const target = cursorRef.current;
            const current = buttonRef.current;

            // Vector button → target
            const dx = target.x - current.x;
            const dy = target.y - current.y;

            // Distance cursor → button (THIS controls forgiveness)
            const cursorDx = cursorRef.current.x - current.x;
            const cursorDy = cursorRef.current.y - current.y;
            const cursorDistance = Math.hypot(cursorDx, cursorDy);

            // Very slow base speed
            const baseSpeed = 0.05;

            // Forgiving slowdown radius
            const slowRadius = 140;

            // Strong nonlinear slowdown near button
            const proximity = Math.min(cursorDistance / slowRadius, 1);
            const speed = baseSpeed * proximity * proximity;

            // Dead zone so it fully stops under cursor
            if (cursorDistance > 6) {
                current.x += dx * speed;
                current.y += dy * speed;
            }

            buttonRef.current = current;
            setButtonPos({ x: current.x, y: current.y });

            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);


    const toggleMode = () => {
        setMode(prev => prev === 'add' ? 'erase' : 'add');
    };

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            cursorRef.current = {
                x: e.clientX + 40, // offset right (≈3–4cm visually)
                y: e.clientY - 40, // offset up
            };
        };

        window.addEventListener('pointermove', onMove);
        return () => window.removeEventListener('pointermove', onMove);
    }, []);


    return (
        <>
            {/* Brush Canvas Overlay - clipped to image bounds */}
<div
  className="absolute z-20"
  onPointerDown={e => e.stopPropagation()}
  onPointerUp={e => e.stopPropagation()}
  onClick={e => e.stopPropagation()}
  style={{
    left: imageTransform.x,
    top: imageTransform.y,
    width: imageTransform.width,
    height: imageTransform.height,
    overflow: 'hidden',
  }}
>
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 pointer-events-auto"
                    style={{
                        cursor: 'crosshair',
                    }}
                />
            </div>


            {/* ✅ THIS IS WHAT YOU WERE MISSING */}
            {!isDrawingRef.current && (
                <HideButton
                    position={buttonPos}
                    mode={mode}
                    brushSize={brushSize}
                    onToggle={toggleMode}
                    onSizeChange={setBrushSize}
                    hoverRef={isHoveringButtonRef}
                />
            )}
        </>

    );
}



// Helper: Convert Fabric.js path object to SVG path data
function pathObjectToSVGPathData(pathObj: any): string {
    if (!pathObj || !pathObj.path) return '';

    return pathObj.path.map((segment: any[]) => {
        return segment.join(' ');
    }).join(' ');
}

// Boolean operations using clipper-lib
async function performBooleanOperation(
    existingPathData: string,
    newPathData: string,
    mode: 'add' | 'erase'
): Promise<string> {
    try {
        // Convert SVG paths to polygon points with MORE detail for smoother results
        const existingPolygon = svgPathToPolygon(existingPathData, 2); // Sample every 2 pixels
        const newPolygon = svgPathToPolygon(newPathData, 2);

        // Scale up for Clipper precision
        const scale = 100;
        const scaledExisting = existingPolygon.map(p => ({ X: Math.round(p.X * scale), Y: Math.round(p.Y * scale) }));
        const scaledNew = newPolygon.map(p => ({ X: Math.round(p.X * scale), Y: Math.round(p.Y * scale) }));

        // Perform boolean operation with Clipper
        const clipper = new ClipperLib.Clipper();
        const solution = new ClipperLib.Paths();

        clipper.AddPath(scaledExisting, ClipperLib.PolyType.ptSubject, true);
        clipper.AddPath(scaledNew, ClipperLib.PolyType.ptClip, true);

        const succeeded = clipper.Execute(
            mode === 'add' ? ClipperLib.ClipType.ctUnion : ClipperLib.ClipType.ctDifference,
            solution,
            ClipperLib.PolyFillType.pftNonZero,
            ClipperLib.PolyFillType.pftNonZero
        );

        if (!succeeded || solution.length === 0) {
            console.warn('Boolean operation failed, returning existing path');
            return existingPathData;
        }

        // Scale back down
        const scaledBackSolution = solution[0].map(p => ({ X: p.X / scale, Y: p.Y / scale }));

        // Convert result back to SVG path with smoothing
        return polygonToSvgPath(scaledBackSolution, true);
    } catch (error) {
        console.error('Boolean operation error:', error);
        return existingPathData;
    }
}

// Helper: Convert SVG path to polygon points for Clipper
function svgPathToPolygon(pathData: string, samplingInterval: number = 5): ClipperLib.Path {
    const points: ClipperLib.Path = [];
    const commands = pathData.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];

    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;

    commands.forEach(cmd => {
        const type = cmd[0].toUpperCase();
        const values = cmd.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));

        switch (type) {
            case 'M':
                currentX = values[0];
                currentY = values[1];
                startX = currentX;
                startY = currentY;
                points.push({ X: currentX, Y: currentY });
                break;
            case 'L':
                currentX = values[0];
                currentY = values[1];
                points.push({ X: currentX, Y: currentY });
                break;
            case 'H':
                currentX = values[0];
                points.push({ X: currentX, Y: currentY });
                break;
            case 'V':
                currentY = values[0];
                points.push({ X: currentX, Y: currentY });
                break;
            case 'C':
                // Cubic bezier - sample intermediate points for smoothness
                const x1 = values[0], y1 = values[1];
                const x2 = values[2], y2 = values[3];
                const x3 = values[4], y3 = values[5];

                for (let t = 0; t <= 1; t += 0.1) {
                    const xt = Math.pow(1 - t, 3) * currentX +
                        3 * Math.pow(1 - t, 2) * t * x1 +
                        3 * (1 - t) * Math.pow(t, 2) * x2 +
                        Math.pow(t, 3) * x3;
                    const yt = Math.pow(1 - t, 3) * currentY +
                        3 * Math.pow(1 - t, 2) * t * y1 +
                        3 * (1 - t) * Math.pow(t, 2) * y2 +
                        Math.pow(t, 3) * y3;
                    points.push({ X: xt, Y: yt });
                }

                currentX = x3;
                currentY = y3;
                break;
            case 'Q':
                // Quadratic bezier - sample intermediate points
                const qx1 = values[0], qy1 = values[1];
                const qx2 = values[2], qy2 = values[3];

                for (let t = 0; t <= 1; t += 0.1) {
                    const xt = Math.pow(1 - t, 2) * currentX +
                        2 * (1 - t) * t * qx1 +
                        Math.pow(t, 2) * qx2;
                    const yt = Math.pow(1 - t, 2) * currentY +
                        2 * (1 - t) * t * qy1 +
                        Math.pow(t, 2) * qy2;
                    points.push({ X: xt, Y: yt });
                }

                currentX = qx2;
                currentY = qy2;
                break;
            case 'Z':
                if (currentX !== startX || currentY !== startY) {
                    points.push({ X: startX, Y: startY });
                }
                break;
        }
    });

    return points;
}

// Helper: Convert polygon points back to SVG path with optional smoothing
function polygonToSvgPath(polygon: ClipperLib.Path, smooth: boolean = false): string {
    if (polygon.length === 0) return '';

    let path = `M ${polygon[0].X.toFixed(2)} ${polygon[0].Y.toFixed(2)}`;

    if (smooth && polygon.length > 3) {
        // Use quadratic curves for smoother result
        for (let i = 1; i < polygon.length - 1; i += 2) {
            const p1 = polygon[i];
            const p2 = polygon[Math.min(i + 1, polygon.length - 1)];
            path += ` Q ${p1.X.toFixed(2)} ${p1.Y.toFixed(2)} ${p2.X.toFixed(2)} ${p2.Y.toFixed(2)}`;
        }
        // Handle last point if odd number
        if (polygon.length % 2 === 0) {
            const last = polygon[polygon.length - 1];
            path += ` L ${last.X.toFixed(2)} ${last.Y.toFixed(2)}`;
        }
    } else {
        // Simple line-to commands
        for (let i = 1; i < polygon.length; i++) {
            path += ` L ${polygon[i].X.toFixed(2)} ${polygon[i].Y.toFixed(2)}`;
        }
    }

    path += ' Z';
    return path;
}

function strokePathToFilledPolygon(
    pathObj: fabric.Path,
    strokeWidth: number
): ClipperLib.Path {
    const points: ClipperLib.Path = [];

    for (const seg of pathObj.path) {
        const x = seg[1];
        const y = seg[2];
        if (typeof x === 'number' && typeof y === 'number') {
            points.push({ X: x, Y: y });
        }
    }

    const offset = new ClipperLib.ClipperOffset();
    offset.AddPath(
        points,
        ClipperLib.JoinType.jtRound,
        ClipperLib.EndType.etOpenRound
    );

    const solution = new ClipperLib.Paths();
    offset.Execute(solution, strokeWidth / 2);

    return solution[0] ?? [];
}
