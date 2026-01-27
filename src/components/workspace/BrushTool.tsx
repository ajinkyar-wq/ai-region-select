import { useEffect, useRef, useState } from 'react';
import { Paintbrush, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
}

export function BrushTool({
  region,
  imageTransform,
  canvasWidth,
  canvasHeight,
  onMaskUpdate,
  onExit,
}: BrushToolProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'add' | 'erase'>('erase');
  const [brushSize, setBrushSize] = useState(20);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [buttonPos, setButtonPos] = useState({ x: 0, y: 0 });
  const [isHoveringButton, setIsHoveringButton] = useState(false);

  const maskDataRef = useRef<Uint8Array>(new Uint8Array(region.maskData));
  const buttonTargetRef = useRef({ x: 0, y: 0 });
  const buttonCurrentRef = useRef({ x: 0, y: 0 });

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    renderMask();
  }, [canvasWidth, canvasHeight]);

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
    const scaleX = region.maskWidth / canvasWidth;
    const scaleY = region.maskHeight / canvasHeight;

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
    if (isHoveringButton) return;
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
    buttonTargetRef.current = { x: x + 40, y: y - 40 };

    if (isDrawing && !isHoveringButton) {
      paintAt(x, y);
    }
  };

  const handlePointerUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
      onMaskUpdate(new Uint8Array(maskDataRef.current));
    }
  };

  // Button follow animation
  useEffect(() => {
    let raf: number;

    const animate = () => {
      if (isHoveringButton) {
        raf = requestAnimationFrame(animate);
        return;
      }

      const target = buttonTargetRef.current;
      const current = buttonCurrentRef.current;

      const dx = target.x - current.x;
      const dy = target.y - current.y;
      const distance = Math.hypot(dx, dy);

      const speed = 0.05 * Math.min(distance / 140, 1) ** 2;

      if (distance > 6) {
        current.x += dx * speed;
        current.y += dy * speed;
      }

      buttonCurrentRef.current = current;
      setButtonPos({ ...current });

      raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [isHoveringButton]);

  // Handle brush size drag
  const dragRef = useRef({
    active: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    startSize: brushSize,
  });

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
      {!isHoveringButton && (
        <div
          className="absolute pointer-events-none z-30"
          style={{
            left: imageTransform.x + cursorPos.x,
            top: imageTransform.y + cursorPos.y,
            transform: 'translate(-50%, -50%)',
          }}
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
      )}

      {/* Control button */}
      {!isDrawing && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{
            left: buttonPos.x,
            top: buttonPos.y,
            transform: 'translate(-50%, -50%)',
          }}
          onPointerEnter={() => setIsHoveringButton(true)}
          onPointerLeave={() => setIsHoveringButton(false)}
        >
          <Button
            size="icon"
            variant="secondary"
            className="h-10 w-10 rounded-full shadow-lg select-none"
            onPointerDown={(e) => {
              e.stopPropagation();
              dragRef.current = {
                active: true,
                hasMoved: false,
                startX: e.clientX,
                startY: e.clientY,
                startSize: brushSize,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              dragRef.current.hasMoved = true;
              if (!dragRef.current.active) return;

              const dx = e.clientX - dragRef.current.startX;
              const dy = dragRef.current.startY - e.clientY;
              const distance = Math.sqrt(dx * dx + dy * dy);
              const direction = dy >= 0 ? 1 : -1;

              const nextSize = Math.max(
                5,
                Math.min(80, dragRef.current.startSize + distance * 0.15 * direction)
              );

              setBrushSize(Math.round(nextSize));
            }}
            onPointerUp={(e) => {
              e.stopPropagation();

              const wasDragging = dragRef.current.hasMoved;
              dragRef.current.active = false;
              dragRef.current.hasMoved = false;

              try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
              } catch {}

              if (!wasDragging) {
                setMode(prev => (prev === 'add' ? 'erase' : 'add'));
              }
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {mode === 'add' ? (
              <Eraser className="h-4 w-4" />
            ) : (
              <Paintbrush className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </>
  );
}