import { useEffect, useRef, useState } from 'react';
import { ScanAnimation } from './ScanAnimation';
import { BrushTool } from './BrushTool';
import { segmentImage } from '@/lib/segmentation';
import type { ImageTileData, Region } from '@/types/workspace';
import { RotateCcw, Users, Ungroup } from 'lucide-react';



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

      onUpdateTile({
        regions: regions.map(r => {
          if (r.type === 'people-group') {
            return { ...r, visible: true };
          }
          if (r.type === 'person') {
            return { ...r, visible: false };
          }
          return r;
        }),
        isProcessing: false,
      });

      const elapsed = Date.now() - start;
      if (elapsed < 900) {
        await new Promise(r => setTimeout(r, 900 - elapsed));
      }

      setShowScan(false);
    };
  }, [tile.imageUrl]);

  // Render masks to overlay canvas
  useEffect(() => {
    if (!overlayCanvasRef.current || !imageTransform) return;

    // 🚫 DO NOT render ANY masks while editing
    if (editingRegion) {
      const ctx = overlayCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(
          0,
          0,
          overlayCanvasRef.current.width,
          overlayCanvasRef.current.height
        );
      }
      return;
    }


    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const groupVisible = tile.regions.some(
      r => r.type === 'people-group' && r.visible
    );

    const visibleRegions = tile.regions.filter(r => {
      if (r.type === 'background') {
        return backgroundEnabled && r.visible;
      }

      if (r.type === 'people-group') {
        return r.visible;
      }

      if (r.type === 'person') {
        return !groupVisible && peopleEnabled && r.visible;
      }

      return false;
    });

    visibleRegions.forEach(region => {
      const isHovered = region.id === hoveredRegionId;
      const isSelected = region.selected;

      const mask = region.maskData;
      const inner = region.innerMaskData;

      const w = region.maskWidth;
      const h = region.maskHeight;

      // Base fill (UNCHANGED SHAPE)
      const imageData = new ImageData(w, h);

      const colorMatch = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
      const r = colorMatch ? parseInt(colorMatch[1], 16) : 255;
      const g = colorMatch ? parseInt(colorMatch[2], 16) : 80;
      const b = colorMatch ? parseInt(colorMatch[3], 16) : 80;

      const baseAlpha =
        isSelected ? 110 :
          isHovered ? 75 :
            0;

      // ---- PASS 1: NORMAL MASK RENDER (NO DISTORTION)
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] <= 0 || baseAlpha === 0) continue;

        const idx = i * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = baseAlpha;
      }


      // ---- DRAW
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = w;
      tempCanvas.height = h;
      tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
      // ---- PASS A: BASE TINT
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(
        tempCanvas,
        imageTransform.x,
        imageTransform.y,
        imageTransform.width,
        imageTransform.height
      );
      ctx.restore();

      // ---- PASS B: GLASS LIGHTING
      if (isHovered || isSelected) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.45;      // SAME AS GROUP
        ctx.shadowColor = region.color;
        ctx.shadowBlur = 16;         // SAME AS GROUP

        ctx.drawImage(
          tempCanvas,
          imageTransform.x,
          imageTransform.y,
          imageTransform.width,
          imageTransform.height
        );
        ctx.restore();
      }
    });

  }, [
    tile.regions,
    imageTransform,
    hoveredRegionId,
    editingRegion,
    peopleEnabled,
    backgroundEnabled
  ]);

  // Handle click detection
  const handleCanvasClick = (e: React.MouseEvent) => {
    const isMultiToggle = e.ctrlKey || e.metaKey;
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

      if (region.type === 'person') {
        const hit = hitTestPersonRegion(x, y, region, imageTransform);
        if (!hit) continue;

        if (region.visible) {
          clickedRegion = region;
        } else {
          const group = tile.regions.find(
            r => r.type === 'people-group' && r.visible
          );
          clickedRegion = group ?? null;
        }

        break;
      }

      if (!clickedRegion && backgroundEnabled) {
        const bg = tile.regions.find(r => r.type === 'background');
        if (bg) {
          const scaleX = bg.maskWidth / imageTransform.width;
          const scaleY = bg.maskHeight / imageTransform.height;

          const mx = Math.floor(x * scaleX);
          const my = Math.floor(y * scaleY);
          const idx = my * bg.maskWidth + mx;

          if (bg.maskData[idx] > 128) {
            clickedRegion = bg;
          }
        }
      }

    }

    if (clickedRegion) {
      const updatedRegions = tile.regions.map(r => {
        // ⌘ / Ctrl + click → toggle ONLY this region
        if (isMultiToggle) {
          if (r.id === clickedRegion.id) {
            return { ...r, selected: !r.selected };
          }
          return r; // ← DO NOT TOUCH OTHERS
        }

        // Normal click → single select
        return {
          ...r,
          selected: r.id === clickedRegion.id,
        };
      });

      onUpdateTile({ regions: updatedRegions });
    } else {
      // Clicked empty space → clear selection (ONLY if not multi-toggle)
      if (!isMultiToggle) {
        onUpdateTile({
          regions: tile.regions.map(r => ({ ...r, selected: false })),
        });
      }
    }
  };

  function hitTestPersonRegion(
    x: number,
    y: number,
    region: Region,
    imageTransform: {
      width: number;
      height: number;
    }
  ): 'inner' | 'outer' | null {
    const scaleX = region.maskWidth / imageTransform.width;
    const scaleY = region.maskHeight / imageTransform.height;

    const mx = Math.floor(x * scaleX);
    const my = Math.floor(y * scaleY);
    const idx = my * region.maskWidth + mx;

    if (region.maskData[idx] <= 128) return null;

    if (region.innerMaskData && region.innerMaskData[idx] > 128) {
      return 'inner';
    }

    return 'outer';
  }


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
      if (region.type === 'person') {
        const hit = hitTestPersonRegion(x, y, region, imageTransform);
        if (!hit) continue;

        if (region.visible) {
          setEditingRegion(region);
        } else {
          const group = tile.regions.find(
            r => r.type === 'people-group' && r.visible
          );
          if (group) {
            setEditingRegion(group);
          }
        }

        return;
      }
      const bg = tile.regions.find(r => r.type === 'background');
      if (bg && backgroundEnabled) {
        const scaleX = bg.maskWidth / imageTransform.width;
        const scaleY = bg.maskHeight / imageTransform.height;
        const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);

        if (bg.maskData[idx] > 128) {
          setEditingRegion(bg);
          return;
        }
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

    // PERSONS FIRST
    for (let i = tile.regions.length - 1; i >= 0; i--) {
      const region = tile.regions[i];
      if (region.type !== 'person' || !peopleEnabled) continue;

      const hit = hitTestPersonRegion(x, y, region, imageTransform);
      if (!hit) continue;

      // 🔑 IMPORTANT: only hover visible regions
      if (region.visible) {
        setLocalHoveredRegion(region.id);
      } else {
        // fallback to visible group if it exists
        const group = tile.regions.find(
          r => r.type === 'people-group' && r.visible
        );
        setLocalHoveredRegion(group ? group.id : null);
      }

      return;
    }

    // BACKGROUND
    const bg = tile.regions.find(r => r.type === 'background');
    if (bg && backgroundEnabled) {
      const scaleX = bg.maskWidth / imageTransform.width;
      const scaleY = bg.maskHeight / imageTransform.height;
      const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);
      if (bg.maskData[idx] > 128) {
        setLocalHoveredRegion(bg.id);
        return;
      }
    }

    setLocalHoveredRegion(null);
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

  const resetRegionMask = (regionId: string) => {
    onUpdateTile({
      regions: tile.regions.map(r => {
        if (r.id !== regionId || !r.originalMaskData) return r;

        return {
          ...r,
          maskData: new Uint8Array(r.originalMaskData), // restore
        };
      }),
    });
  };

  const splitGroup = () => {
    onUpdateTile({
      regions: tile.regions.map(r => {
        if (r.type === 'people-group') {
          return { ...r, visible: false, selected: false };
        }
        if (r.type === 'person') {
          return { ...r, visible: true };
        }
        return r;
      }),
    });
  };

  const groupPeople = () => {
    onUpdateTile({
      regions: tile.regions.map(r => {
        if (r.type === 'people-group') {
          return { ...r, visible: true, selected: true };
        }
        if (r.type === 'person') {
          return { ...r, visible: false, selected: false };
        }
        return r;
      }),
    });
  };


  function getMaskAnchor(region: Region) {
    const { maskData, maskWidth, maskHeight } = region;

    let minX = maskWidth, minY = maskHeight;
    let maxX = 0, maxY = 0;

    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        const i = y * maskWidth + x;
        if (maskData[i] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    return {
      x: (minX + maxX) / 2,
      y: minY, // top edge feels right UX-wise
    };
  }



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

        {!editingRegion &&
          imageTransform &&
          tile.regions
            .filter(r => r.selected)
            .map(region => {
              const anchor = getMaskAnchor(region);

              const x =
                imageTransform.x +
                (anchor.x / region.maskWidth) * imageTransform.width;

              const y =
                imageTransform.y +
                (anchor.y / region.maskHeight) * imageTransform.height;

              return (
                <div
                  key={region.id}
                  className="absolute z-40 pointer-events-auto"
                  style={{
                    left: x,
                    top: y - 28,
                    transform: 'translate(-50%, -100%)',
                  }}
                >
                  <div className="flex gap-1">
                    {/* SPLIT / UNGROUP */}
                    {region.type === 'people-group' && region.selected && (
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black shadow-lg"
                        title="Ungroup"
                        onClick={(e) => {
                          e.stopPropagation();
                          splitGroup();
                        }}
                      >
                        <Ungroup size={14} />
                      </button>
                    )}

                    {/* GROUP */}
                    {region.type === 'person' &&
                      !tile.regions.some(r => r.type === 'people-group' && r.visible) && (
                        <button
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black shadow-lg"
                          title="Group"
                          onClick={(e) => {
                            e.stopPropagation();
                            groupPeople();
                          }}
                        >
                          <Users size={14} />
                        </button>
                      )}

                    {/* RESET */}
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-white hover:bg-black shadow-lg"
                      title="Reset mask"
                      onClick={(e) => {
                        e.stopPropagation();
                        resetRegionMask(region.id);
                      }}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </div>
                </div>
              );
            })}


        {editingRegion && imageTransform && mainCanvasRef.current && (
          <BrushTool
            region={editingRegion}
            imageTransform={imageTransform}
            canvasWidth={mainCanvasRef.current.width}
            canvasHeight={mainCanvasRef.current.height}
            onMaskUpdate={handleMaskUpdate}
            onExit={() => {
              // 1. Exit edit mode
              setEditingRegion(null);

              // 2. Re-select the edited region ONLY
              onUpdateTile({
                regions: tile.regions.map(r => ({
                  ...r,
                  selected: r.id === editingRegion.id,
                })),
              });
            }}


          />
        )}
      </div>

      <ScanAnimation isActive={showScan} />
    </div>
  );
}