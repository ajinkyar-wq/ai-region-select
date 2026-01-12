import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, FabricImage, Path } from 'fabric';
import { ScanAnimation } from './ScanAnimation';
import { HideButton } from './HideButton';
import { useImageTile } from '@/hooks/useImageTile';
import type { ImageTileData } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';

interface ImageViewProps {
  tile: ImageTileData;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
}

export function ImageTile({ tile, onUpdateTile }: ImageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const [hideButtonPos, setHideButtonPos] =
    useState<{ x: number; y: number } | null>(null);

  // ✅ NEW: local scan animation state
  const [showScan, setShowScan] = useState(true);

  const {
    isProcessing,
    regions,
    selectedRegionId,
    processImage,
    selectRegion,
    hideRegion,
  } = useImageTile(tile);

  useEffect(() => {
    onUpdateTile({ regions, isProcessing, selectedRegionId });
  }, [regions, isProcessing, selectedRegionId]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    const canvas = new FabricCanvas(canvasRef.current, {
      width,
      height,
      backgroundColor: 'transparent',
      selection: false,
    });

    fabricRef.current = canvas;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = tile.imageUrl;

    img.onload = async () => {
      const scale = Math.min(width / img.width, height / img.height);

      const fabricImage = new FabricImage(img, {
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
        left: (width - img.width * scale) / 2,
        top: (height - img.height * scale) / 2,
      });

      canvas.add(fabricImage);
      canvas.sendObjectToBack(fabricImage);
      canvas.renderAll();

      // ✅ NEW: explicitly show scan while AI runs
      setShowScan(true);

      const start = Date.now();
      await processImage(img, width, height);

      // minimum 900ms so it feels deliberate
      const elapsed = Date.now() - start;
      const minDuration = 900;

      if (elapsed < minDuration) {
        await new Promise(r => setTimeout(r, minDuration - elapsed));
      }

      setShowScan(false);
    };

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [tile.imageUrl]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    canvas.getObjects().forEach(obj => {
      if (obj instanceof Path) canvas.remove(obj);
    });

    regions.filter(r => r.visible).forEach(region => {
      if (!region.pathData) return;

      const colors = REGION_COLORS[region.type];
      const path = new Path(region.pathData, {
        fill: region.selected ? colors.selected : colors.fill,
        stroke: 'transparent',
        selectable: false,
        evented: true,
      });

      (path as any).regionId = region.id;
      canvas.add(path);
    });

    canvas.renderAll();
  }, [regions]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const onMouseDown = (e: any) => {
      const target = e.target;
      if (target instanceof Path && (target as any).regionId) {
        selectRegion((target as any).regionId);
        const p = canvas.getPointer(e.e);
        setHideButtonPos({ x: p.x, y: p.y });
      } else {
        selectRegion(null);
        setHideButtonPos(null);
      }
    };

    canvas.on('mouse:down', onMouseDown);
    return () => {
      canvas.off('mouse:down', onMouseDown);
    };
  }, [selectRegion]);

  const handleHide = useCallback(() => {
    if (selectedRegionId) {
      hideRegion(selectedRegionId);
      setHideButtonPos(null);
    }
  }, [selectedRegionId, hideRegion]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full" />

      {/* ✅ NEW: animation no longer depends on hook timing */}
      <ScanAnimation isActive={showScan} />

      {selectedRegionId && hideButtonPos && (
        <HideButton position={hideButtonPos} onHide={handleHide} />
      )}
    </div>
  );
}
