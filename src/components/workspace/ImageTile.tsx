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
  const [imageTransform, setImageTransform] = useState<{
    scale: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

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

      // 🔑 Store ACTUAL IMAGE RECT
      setImageTransform({
        scale,
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
      });

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
      {/* Image */}
      <canvas ref={mainCanvasRef} className="absolute inset-0 z-0" />

      {/* Hidden mask canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 pointer-events-none opacity-0"
      />

      {/* SVG vector overlay */}
      {imageTransform && (
        <svg
          className="absolute inset-0 z-10"
          viewBox={`0 0 ${mainCanvasRef.current!.width} ${mainCanvasRef.current!.height}`}
          pointerEvents="auto"
        >
          <defs>
            {/* ✅ CLIP TO IMAGE ONLY */}
            <clipPath id={`image-clip-${tile.id}`}>
              <rect
                x={imageTransform.x}
                y={imageTransform.y}
                width={imageTransform.width}
                height={imageTransform.height}
              />
            </clipPath>
          </defs>

          <g clipPath={`url(#image-clip-${tile.id})`}>
            {(() => {
              const people = tile.regions.find(
                r => r.type === 'people' && r.visible
              );

              return (
                <>
                  {/* BACKGROUND */}
                  {people && (
                    <path
                      d={`
                        M ${imageTransform.x} ${imageTransform.y}
                        H ${imageTransform.x + imageTransform.width}
                        V ${imageTransform.y + imageTransform.height}
                        H ${imageTransform.x}
                        Z
                        ${people.pathData}
                      `}
                      fill="rgba(0, 55, 255, 0.3)"
                      fillRule="evenodd"
                      onClick={() => console.log('background selected')}
                    />
                  )}

                  {/* PEOPLE */}
                  {people && (
                    <path
                      d={people.pathData}
                      fill="rgba(0, 255, 0, 0.3)"
                      stroke="white"
                      strokeWidth={2}
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('people selected');
                      }}
                    />
                  )}
                </>
              );
            })()}
          </g>
        </svg>
      )}

      <ScanAnimation isActive={showScan} />
    </div>
  );
}
