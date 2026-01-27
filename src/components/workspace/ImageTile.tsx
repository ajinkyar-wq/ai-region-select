import { useEffect, useRef, useState } from 'react';
import { ScanAnimation } from './ScanAnimation';
import { BrushTool } from './BrushTool';
import { segmentImage } from '@/lib/segmentation';
import type { ImageTileData, Region } from '@/types/workspace';

interface ImageViewProps {
  tile: ImageTileData;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
  selectionMode?: 'single' | 'multi';
  hoveredRegionOverride?: 'person' | 'background' | null;
  peopleEnabled?: boolean;
  backgroundEnabled?: boolean;
  activeMask?: Region | null;
  brushActive?: boolean;
}

export function ImageTile({
  tile,
  onUpdateTile,
  selectionMode,
  hoveredRegionOverride,
  activeMask,
  brushActive,
  peopleEnabled = true,
  backgroundEnabled = true,
}: ImageViewProps) {
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

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [localHoveredRegion, setLocalHoveredRegion] = useState<string | null>(null);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);

  const MIN_SCALE = 0.3;
  const MAX_SCALE = 4;

  const hoveredRegionId = hoveredRegionOverride ?? localHoveredRegion;

  // Prevent default wheel behavior
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const wheelListener = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', wheelListener, { passive: false });
    return () => el.removeEventListener('wheel', wheelListener);
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.002;
      setScale(prev => Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + zoomDelta)));
      return;
    }

    setOffset(prev => ({
      x: prev.x - e.deltaX,
      y: prev.y - e.deltaY,
    }));
  };

  // Load image and run segmentation
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

      setImageTransform({
        scale,
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
      });

      setShowScan(true);
      const start = Date.now();

      const regions = await segmentImage(img, mainCanvas);
      onUpdateTile({ regions, isProcessing: false });

      const elapsed = Date.now() - start;
      if (elapsed < 900) {
        await new Promise(r => setTimeout(r, 900 - elapsed));
      }

      setShowScan(false);
    };
  }, [tile.imageUrl]);

  // Render masks to overlay canvas
  useEffect(() => {
    if (!overlayCanvasRef.current || !imageTransform || editingRegion) return;

    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Filter enabled regions
    const visibleRegions = tile.regions.filter(r => {
      if (r.type === 'person' && !peopleEnabled) return false;
      if (r.type === 'background' && !backgroundEnabled) return false;
      return r.visible;
    });

    visibleRegions.forEach(region => {
      const isHovered = region.id === hoveredRegionId;
      const isSelected = region.selected;
      const isActive = isHovered || isSelected;

      // Create ImageData from mask
      const imageData = new ImageData(region.maskWidth, region.maskHeight);
      const { maskData } = region;

      // Parse color
      const colorMatch = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
      const r = colorMatch ? parseInt(colorMatch[1], 16) : 255;
      const g = colorMatch ? parseInt(colorMatch[2], 16) : 80;
      const b = colorMatch ? parseInt(colorMatch[3], 16) : 80;

      const fillAlpha = isActive ? 64 : 0;
      const strokeAlpha = isActive ? 230 : 200;

      for (let i = 0; i < maskData.length; i++) {
  const a = maskData[i] / 255;
  if (a > 0.01) {
    imageData.data[i * 4]     = r;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = b;
    imageData.data[i * 4 + 3] = Math.round(a * fillAlpha);
  }
}


      // Create temp canvas for mask
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = region.maskWidth;
      tempCanvas.height = region.maskHeight;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.putImageData(imageData, 0, 0);

      // Draw scaled mask WITH IMAGE OFFSET
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tempCanvas, imageTransform.x, imageTransform.y, imageTransform.width, imageTransform.height);

      ctx.restore();
    });
  }, [tile.regions, imageTransform, hoveredRegionId, editingRegion, peopleEnabled, backgroundEnabled]);

  // Handle click detection
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (editingRegion) {
      setEditingRegion(null);
      return;
    }

    const canvas = overlayCanvasRef.current;
    if (!canvas || !imageTransform) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    // Convert to image coordinates (subtract offset)
    const x = canvasX - imageTransform.x;
    const y = canvasY - imageTransform.y;

    // Check if click is within image bounds
    if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) {
      onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
      return;
    }

    // Check which region was clicked
    let clickedRegion: Region | null = null;

    for (let i = tile.regions.length - 1; i >= 0; i--) {
      const region = tile.regions[i];
      if ((region.type === 'person' && !peopleEnabled) ||
          (region.type === 'background' && !backgroundEnabled)) {
        continue;
      }

      const scaleX = region.maskWidth / imageTransform.width;
      const scaleY = region.maskHeight / imageTransform.height;
      const maskX = Math.floor(x * scaleX);
      const maskY = Math.floor(y * scaleY);
      const maskIdx = maskY * region.maskWidth + maskX;

      if (region.maskData[maskIdx] > 128) {
        clickedRegion = region;
        break;
      }
    }

    if (clickedRegion) {
      const updatedRegions = tile.regions.map(r => ({
        ...r,
        selected: r.id === clickedRegion.id ? !r.selected : false,
      }));
      onUpdateTile({ regions: updatedRegions });
    } else {
      onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
    }
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !imageTransform) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    const x = canvasX - imageTransform.x;
    const y = canvasY - imageTransform.y;

    if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) return;

    for (let i = tile.regions.length - 1; i >= 0; i--) {
      const region = tile.regions[i];
      if ((region.type === 'person' && !peopleEnabled) ||
          (region.type === 'background' && !backgroundEnabled)) {
        continue;
      }

      const scaleX = region.maskWidth / imageTransform.width;
      const scaleY = region.maskHeight / imageTransform.height;
      const maskX = Math.floor(x * scaleX);
      const maskY = Math.floor(y * scaleY);
      const maskIdx = maskY * region.maskWidth + maskX;

      if (region.maskData[maskIdx] > 128) {
        setEditingRegion(region);
        break;
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (editingRegion) return;

    const canvas = overlayCanvasRef.current;
    if (!canvas || !imageTransform) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    const x = canvasX - imageTransform.x;
    const y = canvasY - imageTransform.y;

    if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) {
      setLocalHoveredRegion(null);
      return;
    }

    let foundRegion: string | null = null;

    for (let i = tile.regions.length - 1; i >= 0; i--) {
      const region = tile.regions[i];
      if ((region.type === 'person' && !peopleEnabled) ||
          (region.type === 'background' && !backgroundEnabled)) {
        continue;
      }

      const scaleX = region.maskWidth / imageTransform.width;
      const scaleY = region.maskHeight / imageTransform.height;
      const maskX = Math.floor(x * scaleX);
      const maskY = Math.floor(y * scaleY);
      const maskIdx = maskY * region.maskWidth + maskX;

      if (region.maskData[maskIdx] > 128) {
        foundRegion = region.id;
        break;
      }
    }

    setLocalHoveredRegion(foundRegion);
  };

  const handleMaskUpdate = (newMaskData: Uint8Array) => {
    if (!editingRegion) return;

    const updatedRegions = tile.regions.map(r =>
      r.id === editingRegion.id
        ? { ...r, maskData: newMaskData }
        : r
    );
    onUpdateTile({ regions: updatedRegions });
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-black"
      onWheel={handleWheel}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <canvas ref={mainCanvasRef} className="absolute inset-0 z-0" />

        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 z-10 pointer-events-auto cursor-pointer"
          onClick={handleCanvasClick}
          onDoubleClick={handleCanvasDoubleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setLocalHoveredRegion(null)}
        />

        {editingRegion && imageTransform && mainCanvasRef.current && (
          <BrushTool
            region={editingRegion}
            imageTransform={imageTransform}
            canvasWidth={mainCanvasRef.current.width}
            canvasHeight={mainCanvasRef.current.height}
            onMaskUpdate={handleMaskUpdate}
            onExit={() => setEditingRegion(null)}
          />
        )}
      </div>

      <ScanAnimation isActive={showScan} />
    </div>
  );
}