import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas as FabricCanvas, FabricImage, Path } from 'fabric';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScanAnimation } from './ScanAnimation';
import { HideButton } from './HideButton';
import { useImageTile } from '@/hooks/useImageTile';
import type { ImageTileData, Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';

interface ImageTileProps {
  tile: ImageTileData;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onRegionSelect: (region: Region | null) => void;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
}

export function ImageTile({ 
  tile, 
  isActive, 
  onSelect, 
  onRemove,
  onRegionSelect,
  onUpdateTile,
}: ImageTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const [hideButtonPos, setHideButtonPos] = useState<{ x: number; y: number } | null>(null);
  
  const {
    isProcessing,
    regions,
    selectedRegionId,
    processImage,
    selectRegion,
    hideRegion,
    getSelectedRegion,
  } = useImageTile(tile);

  // Update parent when regions change
  useEffect(() => {
    onUpdateTile({ regions, isProcessing, selectedRegionId });
  }, [regions, isProcessing, selectedRegionId]);

  // Notify parent of selection changes
  useEffect(() => {
    onRegionSelect(getSelectedRegion());
  }, [selectedRegionId]);

  // Initialize Fabric canvas and load image
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight || 400;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: containerWidth,
      height: containerHeight,
      backgroundColor: 'transparent',
      selection: false,
    });

    fabricRef.current = canvas;

    // Load the image
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = tile.imageUrl;
    
    img.onload = async () => {
      const scale = Math.min(
        containerWidth / img.width,
        containerHeight / img.height
      );
      
      const fabricImage = new FabricImage(img, {
        scaleX: scale,
        scaleY: scale,
        selectable: false,
        evented: false,
      });

      // Center the image
      fabricImage.set({
        left: (containerWidth - img.width * scale) / 2,
        top: (containerHeight - img.height * scale) / 2,
      });

      canvas.add(fabricImage);
      canvas.sendObjectToBack(fabricImage);
      canvas.renderAll();

      // Process with AI
      await processImage(img, containerWidth, containerHeight);
    };

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
  }, [tile.imageUrl]);

  // Render regions on canvas
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    // Remove existing region paths (keep the image)
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj instanceof Path) {
        canvas.remove(obj);
      }
    });

    // Add visible regions
    regions
      .filter(r => r.visible)
      .forEach(region => {
        if (!region.pathData) return;

        const colors = REGION_COLORS[region.type];
        const fillColor = region.selected ? colors.selected : colors.fill;

        try {
          const path = new Path(region.pathData, {
            fill: fillColor,
            stroke: region.selected ? colors.selected.replace('0.25', '0.6') : 'transparent',
            strokeWidth: region.selected ? 2 : 0,
            selectable: false,
            evented: true,
          });
          
          // Store region ID on the path object
          (path as any).regionId = region.id;

          canvas.add(path);
        } catch (e) {
          console.error('Failed to create path for region:', region.id, e);
        }
      });

    canvas.renderAll();
  }, [regions]);

  // Handle canvas click for region selection
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;

    const handleMouseDown = (e: any) => {
      const target = e.target;
      
      if (target instanceof Path && (target as any).regionId) {
        const regionId = (target as any).regionId;
        selectRegion(regionId);
        
        // Position hide button near click
        const pointer = canvas.getPointer(e.e);
        setHideButtonPos({ x: pointer.x, y: pointer.y });
      } else {
        selectRegion(null);
        setHideButtonPos(null);
      }
    };

    canvas.on('mouse:down', handleMouseDown);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
    };
  }, [selectRegion]);

  const handleHide = useCallback(() => {
    if (selectedRegionId) {
      hideRegion(selectedRegionId);
      setHideButtonPos(null);
    }
  }, [selectedRegionId, hideRegion]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative bg-muted/30 rounded-xl overflow-hidden border-2 transition-all duration-200 aspect-video cursor-pointer group',
        isActive ? 'border-primary shadow-lg' : 'border-transparent hover:border-muted-foreground/30'
      )}
      onClick={onSelect}
    >
      {/* Remove button */}
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 z-40 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity bg-card/80 backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Fabric canvas */}
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* Scan animation overlay */}
      <ScanAnimation isActive={isProcessing} />

      {/* Hide button */}
      {selectedRegionId && hideButtonPos && (
        <HideButton position={hideButtonPos} onHide={handleHide} />
      )}
    </div>
  );
}
