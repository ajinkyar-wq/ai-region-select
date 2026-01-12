import { useEffect, useRef, useState } from 'react';
import { ScanAnimation } from './ScanAnimation';
import { segmentImage } from '@/lib/segmentation';
import { REGION_COLORS } from '@/types/workspace';
import type { ImageTileData } from '@/types/workspace';

interface ImageViewProps {
  tile: ImageTileData;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
}

export function ImageTile({ tile, onUpdateTile }: ImageViewProps) {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScan, setShowScan] = useState(true);

  useEffect(() => {
    if (!mainCanvasRef.current || !overlayCanvasRef.current || !containerRef.current) return;

    const mainCanvas = mainCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    const container = containerRef.current;

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    mainCanvas.width = width;
    mainCanvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;

    const ctx = mainCanvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = tile.imageUrl;

    img.onload = async () => {
      const scale = Math.min(width / img.width, height / img.height);
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const x = (width - scaledWidth) / 2;
      const y = (height - scaledHeight) / 2;

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

      setShowScan(true);
      const start = Date.now();

      const regions = await segmentImage(img, mainCanvas, overlayCanvas);
      onUpdateTile({ regions, isProcessing: false });

      const elapsed = Date.now() - start;
      if (elapsed < 900) {
        await new Promise(r => setTimeout(r, 900 - elapsed));
      }

      setShowScan(false);
    };
  }, [tile.imageUrl]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-black">
      <canvas ref={mainCanvasRef} className="absolute inset-0" />
      <canvas ref={overlayCanvasRef} className="absolute inset-0 pointer-events-none opacity-0" />

      {/* SVG vector overlay */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      >
        {tile.regions
          .filter(region => region.visible)
          .map(region => (
            <path
              key={region.id}
              d={region.pathData}
              fill={
                region.selected
                  ? REGION_COLORS[region.type].selected
                  : REGION_COLORS[region.type].fill
              }
              stroke={region.selected ? REGION_COLORS[region.type].selected.replace('0.25', '0.8') : 'none'}
              strokeWidth={region.selected ? 2 : 0}
              className="transition-all duration-200"
            />
          ))}
      </svg>

      <ScanAnimation isActive={showScan} />
    </div>
  );
}