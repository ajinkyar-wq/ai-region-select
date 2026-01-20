// ImageTile.tsx - Updated with Brush Tool Integration
import { useEffect, useRef, useState } from 'react';
import { ScanAnimation } from './ScanAnimation';
import { BrushTool } from './BrushTool';
import { segmentImage } from '@/lib/segmentation';
import { REGION_COLORS } from '@/types/workspace';
import type { ImageTileData, Region } from '@/types/workspace';

interface ImageViewProps {
  tile: ImageTileData;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
  selectionMode?: 'single' | 'multi';

  hoveredRegionOverride?: 'people' | 'background' | null;
  editRegionType?: 'people' | 'background' | null;
  peopleEnabled?: boolean;
  backgroundEnabled?: boolean;
}

export function ImageTile({ tile, onUpdateTile, selectionMode,   hoveredRegionOverride,
  editRegionType,
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

const MIN_SCALE = 0.3;
const MAX_SCALE = 4;

const handleWheel = (e: React.WheelEvent) => {
  // Pinch gesture → zoom
  if (e.ctrlKey) {
    e.preventDefault();

    const zoomDelta = -e.deltaY * 0.002;
    setScale(prev =>
      Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + zoomDelta))
    );
    return;
  }

  // Two-finger scroll → pan
  setOffset(prev => ({
    x: prev.x - e.deltaX,
    y: prev.y - e.deltaY,
  }));
};

useEffect(() => {
  const el = containerRef.current;
  if (!el) return;

  const wheelListener = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault(); // ⛔ STOP browser zoom
    }
  };

  el.addEventListener('wheel', wheelListener, { passive: false });

  return () => {
    el.removeEventListener('wheel', wheelListener);
  };
}, []);

  

const [localHoveredRegion, setLocalHoveredRegion] =
  useState<'people' | 'background' | null>(null);

const hoveredRegion =
  hoveredRegionOverride ?? localHoveredRegion;
  const [localSelectionMode, setLocalSelectionMode] = useState<'single' | 'multi'>('single');

  // NEW: Edit mode state
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);

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

      const regions = await segmentImage(img, mainCanvas, overlayCanvas);
      onUpdateTile({ regions, isProcessing: false });

      const elapsed = Date.now() - start;
      if (elapsed < 900) {
        await new Promise(r => setTimeout(r, 900 - elapsed));
      }

      setShowScan(false);
    };
  }, [tile.imageUrl]);

  useEffect(() => {
  if (!editRegionType) return;

  const region = tile.regions.find(r => r.type === editRegionType);
  if (region) {
    setEditingRegion(region);
  }
}, [editRegionType, tile.regions]);


  const effectiveSelectionMode = selectionMode ?? localSelectionMode;

  const handleRegionClick = (regionType: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // GATE interaction by enable flags
    if (regionType === 'people' && !peopleEnabled) return;
    if (regionType === 'background' && !backgroundEnabled) return;

    if (effectiveSelectionMode === 'multi') {
      const updatedRegions = tile.regions.map(r =>
        r.type === regionType
          ? { ...r, selected: !r.selected }
          : r
      );
      onUpdateTile({ regions: updatedRegions });
} else {
  const isAlreadySelected = tile.regions.some(
    r => r.type === regionType && r.selected
  );

  const updatedRegions = tile.regions.map(r => ({
    ...r,
    selected: isAlreadySelected ? false : r.type === regionType,
  }));

  onUpdateTile({ regions: updatedRegions });
}
  };

  // NEW: Handle double-click to enter edit mode
  const handleRegionDoubleClick = (region: Region, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // GATE interaction by enable flags
    if (region.type === 'people' && !peopleEnabled) return;
    if (region.type === 'background' && !backgroundEnabled) return;
    
    setEditingRegion(region);
  };

  // NEW: Handle path updates from brush tool
  const handlePathUpdate = (newPathData: string) => {
    if (!editingRegion) return;

    const updatedRegions = tile.regions.map(r =>
      r.id === editingRegion.id
        ? { ...r, pathData: newPathData }
        : r
    );
    onUpdateTile({ regions: updatedRegions });
  };

  // NEW: Exit edit mode
  const handleExitEditMode = () => {
    setEditingRegion(null);
    onUpdateTile({});
  };
const people = tile.regions.find(r => r.type === 'people');
const background = tile.regions.find(r => r.type === 'background');

const editPathData =
  editingRegion?.type === 'background' && people && imageTransform
    ? `
        M 0 0
        H ${imageTransform.width}
        V ${imageTransform.height}
        H 0
        Z
        ${people.pathData}
      `
    : editingRegion?.pathData ?? '';


const getRegionStyle = (regionType: string) => {
  const isHovered = hoveredRegion === regionType;
  const isEditing = editingRegion?.type === regionType;

  // Check if region is disabled
  const isDisabled =
    (regionType === 'people' && !peopleEnabled) ||
    (regionType === 'background' && !backgroundEnabled);

  const isSelected = tile.regions.some(
  r => r.type === regionType && r.selected
);

const active = isHovered || isEditing || isSelected;


  return {
    cursor: isDisabled ? 'default' : 'pointer',
    transition: 'fill 180ms ease, stroke-width 180ms ease, opacity 180ms ease',

    // 🔴 RED ONLY on hover OR edit
    fill: active
      ? 'rgba(255, 80, 80, 0.25)'
      : 'rgba(255, 80, 80, 0)',

    // ⚪ WHITE outline ALWAYS
    stroke: 'rgba(255, 255, 255, 0.9)',
    strokeWidth: active ? 2.75 : 2,

    vectorEffect: 'non-scaling-stroke',
    opacity: isDisabled ? 0.25 : 1,
    pointerEvents: isDisabled ? 'none' : 'auto',
  } as React.CSSProperties;
};

return (
  <div
    ref={containerRef}
    className="relative h-full w-full overflow-hidden bg-black"
    onWheel={handleWheel}
onClick={() => {
  // Exit edit mode if active
  if (editingRegion) {
    setEditingRegion(null);
    return;
  }

  // Otherwise just clear selection
  onUpdateTile({
    regions: tile.regions.map(r => ({ ...r, selected: false })),
  });
}}
  >
    <style>{`
      @keyframes pulseOpacity {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.7; }
      }
    `}</style>

    {/* ================= TRANSFORM WRAPPER (ZOOM + PAN) ================= */}
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: 'center center',
      }}
    >
      {/* Image */}
      <canvas ref={mainCanvasRef} className="absolute inset-0 z-0" />

      {/* Hidden mask canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 pointer-events-none opacity-0"
      />

      {/* SVG vector overlay */}
      {imageTransform && !editingRegion && (
        <svg
          className="absolute inset-0 z-10"
          viewBox={`0 0 ${mainCanvasRef.current!.width} ${mainCanvasRef.current!.height}`}
          pointerEvents="auto"
        >
          <defs>
            <clipPath id={`image-clip-${tile.id}`}>
              <rect
                x={imageTransform.x}
                y={imageTransform.y}
                width={imageTransform.width}
                height={imageTransform.height}
              />
            </clipPath>

            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g clipPath={`url(#image-clip-${tile.id})`}>
            <g transform={`translate(${imageTransform.x}, ${imageTransform.y})`}>
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
                          M 0 0
                          H ${imageTransform.width}
                          V ${imageTransform.height}
                          H 0
                          Z
                          ${people.pathData}
                        `}
                        fillRule="evenodd"
                        style={getRegionStyle('background')}
                        filter={
                          hoveredRegion === 'background'
                            ? 'url(#glow)'
                            : undefined
                        }
                        onMouseEnter={() => {
                          if (backgroundEnabled)
                            setLocalHoveredRegion('background');
                        }}
                        onMouseLeave={() => {
                          if (backgroundEnabled)
                            setLocalHoveredRegion(null);
                        }}
                        onClick={e => handleRegionClick('background', e)}
                        onDoubleClick={e => {
                          const bgRegion = tile.regions.find(
                            r => r.type === 'background'
                          );
                          if (bgRegion)
                            handleRegionDoubleClick(bgRegion, e);
                        }}
                      />
                    )}

                    {/* PEOPLE */}
                    {people && (
                      <path
                        d={people.pathData}
                        style={getRegionStyle('people')}
                        filter={
                          hoveredRegion === 'people'
                            ? 'url(#glow)'
                            : undefined
                        }
                        onMouseEnter={() => {
                          if (peopleEnabled)
                            setLocalHoveredRegion('people');
                        }}
                        onMouseLeave={() => {
                          if (peopleEnabled)
                            setLocalHoveredRegion(null);
                        }}
                        onClick={e => handleRegionClick('people', e)}
                        onDoubleClick={e =>
                          handleRegionDoubleClick(people, e)
                        }
                      />
                    )}

                    {/* Animated pulse on hover */}
                    {hoveredRegion && (
                      <g
                        style={{
                          animation:
                            'pulseOpacity 1.5s ease-in-out infinite',
                        }}
                        opacity="0.5"
                      >
                        {hoveredRegion === 'people' && people && (
                          <path
                            d={people.pathData}
                            fill="none"
                            stroke="#00ff64"
                            strokeWidth="1"
                            strokeDasharray="5,5"
                            pointerEvents="none"
                          />
                        )}
                      </g>
                    )}
                  </>
                );
              })()}
            </g>
          </g>
        </svg>
      )}

      {editingRegion && imageTransform && mainCanvasRef.current && (
  <BrushTool
    regionId={editingRegion.id}
    regionPathData={editPathData}
    regionType={editingRegion.type as 'people' | 'background'}
    imageTransform={imageTransform}
    canvasWidth={mainCanvasRef.current.width}
    canvasHeight={mainCanvasRef.current.height}
    onPathUpdate={handlePathUpdate}
    onExit={handleExitEditMode}
  />
)}

    </div>



      <ScanAnimation isActive={showScan} />
    </div>
  );
}
