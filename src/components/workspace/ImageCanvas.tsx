
import { useEffect, useRef, useState } from 'react';
import { ScanAnimation } from './layers/ScanAnimation';
import { AIMaskEditor } from './tools/AIMaskEditor';
import { SmartMaskLayer } from './layers/SmartMaskLayer';
import { ToolLayer } from './layers/ToolLayer';
import { AdjustmentLayer } from './layers/AdjustmentLayer';
import { BrushTool } from './tools/BrushTool';
import { WalkthroughOverlay } from './layers/WalkthroughOverlay';
//import { useWalkthrough } from './Workspacelogic/useWalkthrough';
import { segmentImage } from '@/lib/segmentation';
import type { ImageTileData, Region } from '@/types/workspace';

interface ImageCanvasProps {
  image: ImageTileData | null;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
  selectionMode?: 'single' | 'multi';
  hoveredRegionOverride?: 'person' | 'background' | null;
  peopleEnabled?: boolean;
  backgroundEnabled?: boolean;
  activeMask?: Region | null;
  brushActive?: boolean;

  // Brush Props
  brushMode?: 'add' | 'erase';
  brushSize?: number;
  brushSoftness?: number;
  brushOpacity?: number;
  onBrushExit?: () => void;

  // Renamed for clarity: This activates the global brush tool
  onActivateBrush?: (regionId: string) => void;
  // Generic activation (unified dispatcher)
  onActivateRegion?: (regionId: string) => void;

  // New Drawing Props
  drawingTool?: 'linear-gradient' | 'radial-gradient' | null;
  onDrawComplete?: (start: { x: number, y: number }, end: { x: number, y: number }) => void;

  // Edit Mode Notification (Local AI Mask Editing)
  onEditingModeChange?: (isEditing: boolean) => void;
  exitEditTrigger?: number;
  canvasInteractionsEnabled?: boolean;
  onActionComplete?: () => void;
  onGradientDraggingChange?: (isDragging: boolean) => void;

}

export function ImageCanvas({
  image: tile,
  onUpdateTile,
  selectionMode,
  hoveredRegionOverride,
  activeMask,
  brushActive,
  onBrushExit,
  brushMode,
  brushSize,
  brushSoftness,
  brushOpacity,
  onActivateBrush,
  onActivateRegion,
  drawingTool,
  onDrawComplete,
  peopleEnabled = true,
  backgroundEnabled = true,
  onEditingModeChange,
  exitEditTrigger,
  canvasInteractionsEnabled = true,
  onGradientDraggingChange,
}: ImageCanvasProps) {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  //const { isWalkthroughActive, isWaveStopped, stopWaveCount, stopWave, completeWalkthrough, resetWalkthrough } = useWalkthrough();

  const [walkthroughClickPos, setWalkthroughClickPos] = useState<{ x: number; y: number } | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const viewDimensionsRef = useRef<{ width: number; height: number } | null>(null);

  // When wave is stopped from slider panel, re-anchor tooltip to image center on every click
  /*useEffect(() => {
    if (isWaveStopped && viewDimensionsRef.current) {
      setWalkthroughClickPos({ x: viewDimensionsRef.current.width / 2, y: viewDimensionsRef.current.height / 2 });
    }
  }, [stopWaveCount]);*/

  const [showScan, setShowScan] = useState(true);
  const [imageTransform, setImageTransform] = useState<{
    scale: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewDimensions, setViewDimensions] = useState<{ width: number; height: number } | null>(null);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [localHoveredRegion, setLocalHoveredRegion] = useState<string | null>(null);
  const [editingRegion, setEditingRegion] = useState<Region | null>(null);

  // Drawing State
  const [drawState, setDrawState] = useState<{
    start: { x: number, y: number };
    current: { x: number, y: number };
    isDrawing: boolean;
  } | null>(null);


  // Clear editingRegion when parent triggers exit (e.g. Escape key)
  useEffect(() => {
    if (exitEditTrigger) setEditingRegion(null);
  }, [exitEditTrigger]);

  // Sync editingRegion with tile updates (e.g. Reset Mask)
  useEffect(() => {
    if (editingRegion) {
      const fresh = tile.regions.find(r => r.id === editingRegion.id);
      if (fresh) {
        // For gradients: exit edit mode when deselected
        const isGradient = fresh.type === 'linear-gradient' || fresh.type === 'radial-gradient';
        if (isGradient && !fresh.selected) {
          setEditingRegion(null);
        } else if (fresh !== editingRegion) {
          setEditingRegion(fresh);
        }
      } else {
        // Region was deleted -> Exit Edit Mode
        setEditingRegion(null);
      }
    }

    // Notify parent of local edit state change
    if (onEditingModeChange) {
      onEditingModeChange(!!editingRegion);
    }
  }, [tile.regions, editingRegion, onEditingModeChange]);

  // Auto-Enter Edit Mode when activeMask changes (Activation)
  useEffect(() => {
    if (activeMask) {
      // For gradients, auto-enter edit mode (since they are always "live")
      const isGradient = activeMask.type === 'linear-gradient' || activeMask.type === 'radial-gradient';
      if (isGradient) {
        setEditingRegion(activeMask);
      } else {
        // For Person/Background (AI Masks):
        // Active = Selected. Do NOT auto-enter refining mode.
        // User must explicitly double-click to refine mask.

        // Default behavior: Selecting an AI mask normally does NOT enter edit mode.
        // HOWEVER: If we Just Double-Clicked (setEditingRegion(activeMask)), 
        // we must NOT clear it here.
        if (editingRegion?.id === activeMask.id) {
          return;
        }

        setEditingRegion(null);
      }
    } else {
      setEditingRegion(null);
    }
  }, [activeMask, editingRegion]);






  const hoveredRegionId = hoveredRegionOverride ?? localHoveredRegion;

  // DERIVE active editing region from props OR local state (Replaces useEffect sync)
  const activeEditingRegion = editingRegion || (
    brushActive && activeMask && (
activeMask.type === 'person' ||
activeMask.type === 'people-group' ||
activeMask.type === 'background' ||
activeMask.type === 'subject' ||
activeMask.type.startsWith('background-')
    ) ? activeMask : null
  );

  // Pan only — zoom removed (scale breaks brush and multi-select mask movement)
  const handleWheel = (e: React.WheelEvent) => {
    setOffset(prev => ({
      x: prev.x - e.deltaX,
      y: prev.y - e.deltaY,
    }));
  };

  // Load image and run segmentation (LAYER 1)
  useEffect(() => {
    if (!mainCanvasRef.current || !containerRef.current) return;

    // Reset walkthrough each time a new image is loaded
    //resetWalkthrough();
    setWalkthroughClickPos(null);

    const mainCanvas = mainCanvasRef.current;
    const container = containerRef.current;

    const width = container.offsetWidth;
    const height = container.offsetHeight;

    viewDimensionsRef.current = { width, height };
    setViewDimensions({ width, height });

    mainCanvas.width = width;
    mainCanvas.height = height;

    const ctx = mainCanvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = tile.imageUrl;

    img.onload = async () => {
      setNaturalSize({ width: img.width, height: img.height });

      // Update tile with image dimensions if missing
      if (!tile.width || !tile.height) {
        onUpdateTile({ width: img.width, height: img.height });
      }

      const imgWidth = img.naturalWidth;
      const imgHeight = img.naturalHeight;
      const scale = Math.min(width / imgWidth, height / imgHeight);
      const scaledWidth = imgWidth * scale;
      const scaledHeight = imgHeight * scale;
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

      const segmentedRegions = await segmentImage(img, mainCanvas);
      onUpdateTile({ regions: segmentedRegions, isProcessing: false });

      const elapsed = Date.now() - start;
      if (elapsed < 900) {
        await new Promise(r => setTimeout(r, 900 - elapsed));
      }

      setShowScan(false);
    };
  }, [tile.imageUrl]);

  const handleMaskUpdate = (newMaskData: Uint8Array, regionId?: string) => {
    const targetId = regionId || editingRegion?.id;
    if (!targetId) return;

    const updatedRegions = tile.regions.map(r =>
      r.id === targetId
        ? { ...r, maskData: newMaskData }
        : r
    );
    onUpdateTile({ regions: updatedRegions });
  };


  // --- Drawing Handlers ---
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawingTool || !imageTransform) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    // Relative to Image
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - imageTransform.x;
    const y = e.clientY - rect.top - imageTransform.y;

    // Values should be normalized 0-1
    const normX = x / imageTransform.width;
    const normY = y / imageTransform.height;

    setDrawState({
      start: { x: normX, y: normY },
      current: { x: normX, y: normY },
      isDrawing: true
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawState?.isDrawing || !imageTransform) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - imageTransform.x;
    const y = e.clientY - rect.top - imageTransform.y;

    const normX = x / imageTransform.width;
    const normY = y / imageTransform.height;

    setDrawState({
      ...drawState,
      current: { x: normX, y: normY }
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drawState?.isDrawing) return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const start = drawState.start;
    const end = drawState.current;
    if (onDrawComplete) {
      onDrawComplete(start, end);
    }
    setDrawState(null);
  };

  // --- Edit Routing Logic (THE DISPATCHER) ---
  // --- Edit Routing Logic (THE DISPATCHER) ---
  const handleEditRegion = (regionId: string) => {
    const region = tile.regions.find(r => r.id === regionId);
    if (!region) return;

    // Single-click path: Select + Set Active. NO brush activation.
    // Brush activation is ONLY via double-click (onDoubleEditRegion -> onActivateBrush).
    if (onActivateRegion) {
      onActivateRegion(regionId);
    }
  };


  // Determine if SmartMaskLayer should be hidden (only if editing an AI mask/Person)
  // Gradients do NOT hide the smart layer.
  const isEditingAIMask = !!editingRegion &&
    editingRegion.type !== 'linear-gradient' &&
    editingRegion.type !== 'radial-gradient' &&
    editingRegion.type !== 'manual';

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-black ${drawingTool ? 'cursor-crosshair' : ''}`}
      onWheel={handleWheel}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) lastMousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
      onClick={() => {
        // Exit Edit / Brush Modes on background click
        if (drawingTool) return;

        if (editingRegion) {
          const isGradient = editingRegion.type === 'linear-gradient' || editingRegion.type === 'radial-gradient';
          setEditingRegion(null);
          onUpdateTile({
            regions: tile.regions.map(r => ({
              ...r,
              // Gradients: fully deselect on background click (no intermediate state)
              // Other types (AI masks): keep selected when exiting edit
              selected: isGradient ? false : r.id === editingRegion.id,
            })),
          });
        } else {
          // No editing region: Deselect ALL on background click
          onUpdateTile({
            regions: tile.regions.map(r => ({ ...r, selected: false })),
          });
        }

        if (onBrushExit) {
          onBrushExit();
        }
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          pointerEvents: drawingTool ? 'auto' : 'none'
        }}
      >
        {/* LAYER 1: Base Image */}
        <canvas ref={mainCanvasRef} className="absolute inset-0 z-0" />

        {/* LAYER 1.5: Image Adjustments */}
        {imageTransform && (
          <AdjustmentLayer
            tile={tile}
            imageTransform={imageTransform}
            width={viewDimensions?.width ?? 0}
            height={viewDimensions?.height ?? 0}
          />
        )}

        {/* LAYER 2: Smart AI Masks */}
        {viewDimensions && (
          <SmartMaskLayer
            tile={tile}
            imageTransform={imageTransform}
            width={viewDimensions.width}
            height={viewDimensions.height}
            peopleEnabled={peopleEnabled}
            backgroundEnabled={backgroundEnabled}
            //isWalkthroughActive={isWalkthroughActive}
            hoveredRegionId={brushActive ? null : hoveredRegionId}
            isEditing={!!activeEditingRegion && activeEditingRegion.type !== 'manual' && activeEditingRegion.type !== 'linear-gradient' && activeEditingRegion.type !== 'radial-gradient'}
            onHoverChange={brushActive ? () => { } : setLocalHoveredRegion}
            onUpdateTile={onUpdateTile}
            onEditRegion={(r) => { // Single Click: stop wave, show/reset tooltip
              //if (isWalkthroughActive) stopWave();
              setWalkthroughClickPos(lastMousePosRef.current ? { ...lastMousePosRef.current } : null);
              handleEditRegion(r.id);
            }}
            onEnterLocalEdit={(r) => { // Double Click: enter edit mode + activate brush
              //if (isWalkthroughActive) completeWalkthrough();
              setWalkthroughClickPos(null);
              if (r.type === 'manual') {
                if (onActivateBrush) onActivateBrush(r.id);
              } else {
                if (onActivateRegion) onActivateRegion(r.id);
                setEditingRegion(r);
              }
            }}
            canvasInteractionsEnabled={canvasInteractionsEnabled}
            isManualToolActive={
              !!brushActive ||
              activeMask?.type === 'manual' ||
              activeMask?.type === 'linear-gradient' ||
              activeMask?.type === 'radial-gradient' ||
              activeEditingRegion?.type === 'linear-gradient' ||
              activeEditingRegion?.type === 'radial-gradient'
            }
          />
        )}


        {/* LAYER 3: Creative Tools + View Controls */}
        {naturalSize && (
          <ToolLayer
            width={naturalSize.width}
            height={naturalSize.height}
            imageTransform={imageTransform}
            regions={tile.regions}
            excludedRegionId={brushActive && activeMask ? activeMask.id : undefined}
            editingRegionId={editingRegion?.id}
            activeRegionId={activeMask?.id}
            onUpdateTile={onUpdateTile}
            onEditRegion={handleEditRegion} // Route edits through our dispatcher
            onDoubleEditRegion={onActivateBrush} // Handle Double Click (Enable Brush Toolbar)
            onGradientDraggingChange={onGradientDraggingChange}
          />
        )}

        {/* TOOL: Interactive Brush (Global) - Now Inside Transform */}
        {brushActive && !editingRegion && imageTransform && activeMask && activeMask.type === 'manual' && (
          <BrushTool
            imageTransform={imageTransform}
            activeMask={activeMask}
            onMaskUpdate={(id, data) => handleMaskUpdate(data, id)}
            brushSize={brushSize}
            brushSoftness={brushSoftness}
            brushOpacity={brushOpacity}
            brushMode={brushMode}
          />
        )}




        {/* Modal Mask Editor (AI Masks Only - Modal Overlay) */}
        {/* Gradients are handled "In-Place" by their respective tools receiving isEditing=true */}
        {activeEditingRegion && activeEditingRegion.type !== 'linear-gradient' && activeEditingRegion.type !== 'radial-gradient' && activeEditingRegion.type !== 'manual' && imageTransform && mainCanvasRef.current && (
          <AIMaskEditor
            // Pass ALL selected AI masks as active targets
            activeRegions={tile.regions.filter(r => r.selected && (r.type === 'person' || r.type === 'people-group' ||
r.type === 'background' || r.type === 'subject' ||
r.type.startsWith('background-')
))}
            // All person regions — needed to redirect people-group edits to individual persons
            allPersonRegions={tile.regions.filter(r => r.type === 'person')}
            // Background region — always a neighbor so it retreats/advances with person edits
            backgroundRegion={tile.regions.find(r => r.type === 'background') ?? null}

            imageTransform={imageTransform}
            canvasWidth={mainCanvasRef.current.width}
            canvasHeight={mainCanvasRef.current.height}
            onMasksUpdate={(updates) => {
              const newRegions = tile.regions.map(r => {
                const u = updates.find(u => u.id === r.id);
                return u ? { ...r, maskData: u.maskData } : r;
              });
              onUpdateTile({ regions: newRegions });
            }}
            mode={brushMode}
            brushSize={brushSize}
            softness={brushSoftness}
            opacity={brushOpacity}

            onExit={() => {
              setEditingRegion(null);
              // Also exit global brush state if it was active
              if (brushActive && onBrushExit) {
                onBrushExit();
              }
            }}
          />
        )
        }

        {/* DRAWING OVERLAY */}
        {drawingTool && (
          <div
            className="absolute inset-0 z-50 cursor-crosshair"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {drawState?.isDrawing && imageTransform && (() => {
              const iw = imageTransform.width;
              const ih = imageTransform.height;
              const sx = drawState.start.x * iw;
              const sy = drawState.start.y * ih;
              const ex = drawState.current.x * iw;
              const ey = drawState.current.y * ih;

              return (
                <div
                  className="absolute pointer-events-none"
                  style={{ left: imageTransform.x, top: imageTransform.y, width: iw, height: ih }}
                >
                  {/* Live gradient preview canvas */}
                  <canvas
                    ref={(canvas) => {
                      if (!canvas) return;
                      canvas.width = iw;
                      canvas.height = ih;
                      const ctx = canvas.getContext('2d');
                      if (!ctx) return;
                      ctx.clearRect(0, 0, iw, ih);

                      if (drawingTool === 'linear-gradient') {
                        const grad = ctx.createLinearGradient(sx, sy, ex, ey);
                        grad.addColorStop(0, 'rgba(255, 50, 50, 0.45)');
                        grad.addColorStop(1, 'rgba(255, 50, 50, 0)');
                        ctx.fillStyle = grad;
                        ctx.fillRect(0, 0, iw, ih);
                      } else {
                        // Radial gradient — ellipse via scaled context
                        const rx = Math.abs(ex - sx);
                        const ry = Math.abs(ey - sy);
                        if (rx > 2 && ry > 2) {
                          ctx.save();
                          ctx.translate(sx, sy);
                          ctx.scale(1, ry / rx);
                          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
                          grad.addColorStop(0, 'rgba(255, 50, 50, 0.45)');
                          grad.addColorStop(1, 'rgba(255, 50, 50, 0)');
                          ctx.fillStyle = grad;
                          ctx.fillRect(-rx * 4, -rx * 4 / (ry / rx), rx * 8, rx * 8 / (ry / rx));
                          ctx.restore();
                        }
                      }
                    }}
                    className="absolute inset-0"
                    style={{ width: iw, height: ih }}
                  />

                  {/* Control handles on top */}
                  <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
                    {drawingTool === 'radial-gradient' ? (
                      <ellipse
                        cx={sx} cy={sy}
                        rx={Math.abs(ex - sx)} ry={Math.abs(ey - sy)}
                        stroke="rgba(255,255,255,0.7)" strokeWidth="1.5" strokeDasharray="5 3"
                        fill="none"
                      />
                    ) : (
                      <line
                        x1={sx} y1={sy} x2={ex} y2={ey}
                        stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeDasharray="5 3"
                      />
                    )}
                    <circle cx={sx} cy={sy} r="5" fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
                    {drawingTool !== 'radial-gradient' && (
                      <circle cx={ex} cy={ey} r="5" fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
                    )}
                  </svg>
                </div>
              );
            })()}
          </div>
        )}

      </div >

      {/* LAYER 2.5: Walkthrough overlay — outside transform div so tooltip coords match container */}
      <WalkthroughOverlay
        imageTransform={imageTransform}
        panOffset={offset}
        regions={tile.regions}
        hoveredRegionId={hoveredRegionId}
        //isWalkthroughActive={isWalkthroughActive}
        //isWaveStopped={isWaveStopped}
        clickPos={walkthroughClickPos}
      />

      <ScanAnimation isActive={showScan} />
    </div >
  );
}