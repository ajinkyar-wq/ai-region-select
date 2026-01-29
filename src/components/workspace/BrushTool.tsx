import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';

interface BrushToolProps {
  region: Region;
  imageTransform: {
    scale: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  canvasWidth: number;
  canvasHeight: number;
  onMaskUpdate: (newMaskData: Uint8Array) => void;
  onExit: () => void;
  // New Props
  mode?: 'add' | 'erase';
  brushSize?: number;
  softness?: number; // Not used in logic yet but passed
  opacity?: number;  // Not used in logic yet but passed
}

export function BrushTool({
  region,
  imageTransform,
  canvasWidth,
  canvasHeight,
  onMaskUpdate,
  onExit,
  mode = 'add',
  brushSize = 20,
}: BrushToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Internal drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  const maskDataRef = useRef<Uint8Array>(new Uint8Array(region.maskData));

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = imageTransform.width;
    canvas.height = imageTransform.height;

    renderMask();
  }, [canvasWidth, canvasHeight, mode]); // Re-render on mode change

  // Sync with external mask updates (Reset)
  useEffect(() => {
    maskDataRef.current = new Uint8Array(region.maskData);
    renderMask();
  }, [region.maskData]);

  // Render current mask state
  const renderMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Create ImageData from mask
    const imageData = new ImageData(region.maskWidth, region.maskHeight);
    const maskData = maskDataRef.current;

    const color = mode === 'erase' ? [255, 80, 80] : [34, 197, 94];

    for (let i = 0; i < maskData.length; i++) {
      const alpha = maskData[i];
      if (alpha > 10) {
        imageData.data[i * 4] = color[0];
        imageData.data[i * 4 + 1] = color[1];
        imageData.data[i * 4 + 2] = color[2];
        imageData.data[i * 4 + 3] = 128;
      }
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = region.maskWidth;
    tempCanvas.height = region.maskHeight;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
  };

  // Paint into mask
  const paintAt = (x: number, y: number) => {
    const scaleX = region.maskWidth / imageTransform.width;
    const scaleY = region.maskHeight / imageTransform.height;

    const maskX = Math.floor(x * scaleX);
    const maskY = Math.floor(y * scaleY);
    const radius = Math.floor(brushSize * Math.max(scaleX, scaleY) / 2);

    const value = mode === 'add' ? 255 : 0;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const px = maskX + dx;
          const py = maskY + dy;

          if (px >= 0 && px < region.maskWidth && py >= 0 && py < region.maskHeight) {
            const idx = py * region.maskWidth + px;
            maskDataRef.current[idx] = value;
          }
        }
      }
    }

    renderMask();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDrawing(true);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    paintAt(x, y);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCursorPos({ x, y });

    if (isDrawing) {
      paintAt(x, y);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDrawing) {
      setIsDrawing(false);
      onMaskUpdate(new Uint8Array(maskDataRef.current));
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { }
    }
  };

  return (
    <>
      {/* Brush canvas */}
      <div
        className="absolute z-20 pointer-events-auto"
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
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{ cursor: 'none' }}
        />
      </div>

      {/* Cursor */}
      <div
        className="absolute pointer-events-none z-30"
        style={{
          left: imageTransform.x + cursorPos.x,
          top: imageTransform.y + cursorPos.y,
          transform: 'translate(-50%, -50%)',
        }}
      // Force hide cursor when not over canvas? No, keep it.
      >
        <div
          className="rounded-full border-2 transition-colors"
          style={{
            width: brushSize,
            height: brushSize,
            borderColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.9)' : 'rgba(34, 197, 94, 0.9)',
            backgroundColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.1)' : 'rgba(34, 197, 94, 0.1)',
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            backgroundColor: mode === 'erase' ? 'rgb(255, 80, 80)' : 'rgb(34, 197, 94)',
          }}
        />
      </div>
    </>
  );
}