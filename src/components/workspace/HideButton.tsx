import { useRef } from 'react';
import { Paintbrush, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface HideButtonProps {
  position: { x: number; y: number };
  mode: 'add' | 'erase';
  brushSize: number;
  onToggle: () => void;
  onSizeChange: (size: number) => void;
  hoverRef: React.MutableRefObject<boolean>;
}

export function HideButton({
  position,
  mode,
  brushSize,
  onToggle,
  onSizeChange,
  hoverRef,
}: HideButtonProps) {
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startSize: brushSize,
  });

  return (
    <div
      className="absolute z-30 pointer-events-auto"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
      }}
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
    >
      <Button
        size="icon"
        variant="secondary"
        className="h-10 w-10 rounded-full shadow-lg select-none"
        onPointerDown={(e) => {
          e.stopPropagation();

          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            startSize: brushSize,
          };

          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return;

          const dx = e.clientX - dragRef.current.startX;
          const dy = dragRef.current.startY - e.clientY;

          // radial-ish pull (mostly vertical, forgiving)
          const distance = Math.sqrt(dx * dx + dy * dy);
          const direction = dy >= 0 ? 1 : -1;

          const nextSize = Math.max(
            5,
            Math.min(80, dragRef.current.startSize + distance * 0.15 * direction)
          );

          onSizeChange(Math.round(nextSize));
        }}
        onPointerUp={(e) => {
          e.stopPropagation();

          const wasDragging = dragRef.current.active;
          dragRef.current.active = false;

          try {
            (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
          } catch { }

          // Click without drag → toggle mode
          if (!wasDragging) {
            onToggle();
          }
        }}
      >
        {mode === 'add' ? (
          <Eraser className="h-4 w-4" />
        ) : (
          <Paintbrush className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
