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
  const [buttonPos, setButtonPos] = useState({ x: 0, y: 0 });
  
  const cursorRef = useRef({ x: 0, y: 0 });
  const buttonRef = useRef({ x: 0, y: 0 });
  const isHoveringButtonRef = useRef(false);
  const isDrawingRef = useRef(false);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      isDrawingMode: true,
      width: canvasWidth,
      height: canvasHeight,
    });

    canvas.defaultCursor = 'none';
    canvas.hoverCursor = 'none';
    fabricCanvasRef.current = canvas;

    // Configure brush
    const brush = new fabric.PencilBrush(canvas);
    brush.width = brushSize;
    brush.color = mode === 'add' ? 'rgba(255, 80, 80, 0.5)' : 'rgba(255, 80, 80, 0.8)';
    canvas.freeDrawingBrush = brush;

    // Show existing region as reference
    if (regionPathData) {
      const referencePath = new fabric.Path(regionPathData, {
        fill: 'rgba(255, 80, 80, 0.25)',
        stroke: 'rgba(255, 80, 80, 0.9)',
        strokeWidth: 2.5,
        selectable: false,
        evented: false,
        name: 'reference-path',
      });
      canvas.add(referencePath);
      canvas.sendObjectToBack(referencePath);
    }

    // Track drawing state
    canvas.on('mouse:down', () => {
      isDrawingRef.current = true;
    });

    canvas.on('mouse:up', () => {
      isDrawingRef.current = false;
    });

    // Handle completed strokes
    canvas.on('path:created', async (e: any) => {
      const drawnPath = e.path;
      
      // Convert stroke to filled polygon
      const filledPolygon = strokePathToFilledPolygon(drawnPath, brushSize);
      
      // Convert to SVG path
      const drawnPathData = polygonToSvgPath(filledPolygon);
      
      // Perform boolean operation
      const newPathData = await performBooleanOperation(
        currentPathRef.current,
        drawnPathData,
        mode
      );
      
      // Update reference
      currentPathRef.current = newPathData;
      onPathUpdate(newPathData);
      
      // Remove drawn stroke
      canvas.remove(drawnPath);
      
      // Update reference path visual
      const refPath = canvas.getObjects().find((obj: any) => obj.name === 'reference-path');
      if (refPath) {
        canvas.remove(refPath);
      }
      
      if (newPathData && newPathData.length > 0) {
        const updatedRefPath = new fabric.Path(newPathData, {
          fill: 'rgba(255, 80, 80, 0.25)',
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
    const canvas = fabricCanvasRef.current;
    if (canvas?.freeDrawingBrush) {
      canvas.freeDrawingBrush.width = brushSize;
      canvas.freeDrawingBrush.color = mode === 'add' 
        ? 'rgba(255, 80, 80, 0.5)' 
        : 'rgba(255, 80, 80, 0.8)';
    }
  }, [mode, brushSize]);

  // Button follow cursor animation
  useEffect(() => {
    let raf: number;

    const tick = () => {
      if (isHoveringButtonRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const target = cursorRef.current;
      const current = buttonRef.current;

      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const cursorDistance = Math.hypot(dx, dy);

      const baseSpeed = 0.05;
      const slowRadius = 140;
      const proximity = Math.min(cursorDistance / slowRadius, 1);
      const speed = baseSpeed * proximity * proximity;

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

  // Track cursor position
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      cursorRef.current = {
        x: e.clientX + 40,
        y: e.clientY - 40,
      };
    };

    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const toggleMode = () => {
    setMode(prev => prev === 'add' ? 'erase' : 'add');
  };

  return (
    <>
      {/* Brush Canvas Overlay */}
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
          style={{ cursor: 'crosshair' }}
        />
      </div>

      {/* Hide Button - only show when not drawing */}
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

// Convert stroke path to filled polygon using offset
function strokePathToFilledPolygon(
  pathObj: fabric.Path,
  strokeWidth: number
): ClipperLib.Path {
  const points: ClipperLib.Path = [];

  // Extract points from path
  if (pathObj.path) {
    for (const seg of pathObj.path) {
      const x = seg[1];
      const y = seg[2];
      if (typeof x === 'number' && typeof y === 'number') {
        points.push({ X: x, Y: y });
      }
    }
  }

  // Use Clipper offset to create filled area
  const offset = new ClipperLib.ClipperOffset();
  offset.AddPath(
    points,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etOpenRound
  );

  const solution = new ClipperLib.Paths();
  offset.Execute(solution, strokeWidth / 2);

  return solution[0] ?? points;
}

// Boolean operations using clipper
async function performBooleanOperation(
  existingPathData: string,
  newPathData: string,
  mode: 'add' | 'erase'
): Promise<string> {
  try {
    const existingPolygon = svgPathToPolygon(existingPathData, 2);
    const newPolygon = svgPathToPolygon(newPathData, 2);

    // Scale for precision
    const scale = 100;
    const scaledExisting = existingPolygon.map(p => ({ 
      X: Math.round(p.X * scale), 
      Y: Math.round(p.Y * scale) 
    }));
    const scaledNew = newPolygon.map(p => ({ 
      X: Math.round(p.X * scale), 
      Y: Math.round(p.Y * scale) 
    }));

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
      console.warn('Boolean operation failed');
      return existingPathData;
    }

    // Scale back
    const scaledBack = solution[0].map(p => ({ 
      X: p.X / scale, 
      Y: p.Y / scale 
    }));

    return polygonToSvgPath(scaledBack, true);
  } catch (error) {
    console.error('Boolean operation error:', error);
    return existingPathData;
  }
}

// Convert SVG path to polygon
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
        // Cubic bezier - sample points
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
        // Quadratic bezier
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

// Convert polygon to SVG path
function polygonToSvgPath(polygon: ClipperLib.Path, smooth: boolean = false): string {
  if (polygon.length === 0) return '';

  let path = `M ${polygon[0].X.toFixed(2)} ${polygon[0].Y.toFixed(2)}`;

  if (smooth && polygon.length > 3) {
    // Use quadratic curves for smoothness
    for (let i = 1; i < polygon.length - 1; i += 2) {
      const p1 = polygon[i];
      const p2 = polygon[Math.min(i + 1, polygon.length - 1)];
      path += ` Q ${p1.X.toFixed(2)} ${p1.Y.toFixed(2)} ${p2.X.toFixed(2)} ${p2.Y.toFixed(2)}`;
    }
    if (polygon.length % 2 === 0) {
      const last = polygon[polygon.length - 1];
      path += ` L ${last.X.toFixed(2)} ${last.Y.toFixed(2)}`;
    }
  } else {
    for (let i = 1; i < polygon.length; i++) {
      path += ` L ${polygon[i].X.toFixed(2)} ${polygon[i].Y.toFixed(2)}`;
    }
  }

  path += ' Z';
  return path;
}