
import { useEffect, useRef, useState, useMemo } from 'react';
import { ScanAnimation } from './layers/ScanAnimation';
import { AIMaskEditor } from './tools/AIMaskEditor';
import { SmartMaskLayer } from './layers/SmartMaskLayer';
import type { LiveGradient } from './layers/SmartMaskLayer';
import { ToolLayer } from './layers/ToolLayer';
import { BrushTool } from './tools/BrushTool';
import { WalkthroughOverlay } from './layers/WalkthroughOverlay';
import type { WalkthroughStep } from './Workspacelogic/useWalkthrough';
import { segmentImage } from '@/lib/segmentation';
import type { ImageTileData, Region } from '@/types/workspace';

interface ImageCanvasProps {
  image: ImageTileData | null;
  onUpdateTile: (updates: Partial<ImageTileData>) => void;
  selectionMode?: 'single' | 'multi';
  hoveredRegionOverride?: string | null;
  peopleEnabled?: boolean;
  backgroundEnabled?: boolean;
  activeMask?: Region | null;
  brushActive?: boolean;

  // Brush Props
  brushMode?: 'add' | 'erase';
  brushSize?: number;
  onBrushSizeChange?: (size: number) => void;
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

  // Object Tool (SAM box selector). When active, the toolbar converts and a
  // box-drag on the canvas runs SAM, stamping the result into the active manual
  // mask via the existing brush update path (handleMaskUpdate).
  objectToolActive?: boolean;

  // AI↔AI shift-click combine — fired when the user shift-clicks an AI mask
  // while a different primary is selected. Workspace infers add vs subtract
  // from geometry (mask overlap) and creates/toggles the clip-child.
  onCombineWithPrimary?: (pickedId: string) => void;

  // Edit Mode Notification (Local AI Mask Editing)
  onEditingModeChange?: (isEditing: boolean) => void;
  exitEditTrigger?: number;
  canvasInteractionsEnabled?: boolean;
  onActionComplete?: () => void;
  onGradientDraggingChange?: (isDragging: boolean) => void;
  sliderHoveredRegionIds?: string[];

  // Walkthrough
  isWalkthroughActive?: boolean;
  isWaveStopped?: boolean;
  walkthroughStep?: WalkthroughStep;
  onAdvanceWalkthroughStep?: () => void;
  onStopWave?: () => void;
  onCompleteWalkthrough?: (pos?: { x: number; y: number }) => void;
  onSimulateRegionClick?: (regionId: string) => void;
  onSimulateRegionHover?: (regionId: string | null) => void;
  onSimulateRegionDeselect?: () => void;
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
  onBrushSizeChange,
  brushSoftness,
  brushOpacity,
  onActivateBrush,
  onActivateRegion,
  drawingTool,
  onDrawComplete,
  objectToolActive = false,
  onCombineWithPrimary,
  peopleEnabled = true,
  backgroundEnabled = true,
  onEditingModeChange,
  exitEditTrigger,
  canvasInteractionsEnabled = true,
  onGradientDraggingChange,
  sliderHoveredRegionIds = [],
  isWalkthroughActive = false,
  isWaveStopped = false,
  walkthroughStep = 0,
  onAdvanceWalkthroughStep,
  onStopWave,
  onCompleteWalkthrough,
  onSimulateRegionClick,
  onSimulateRegionHover,
  onSimulateRegionDeselect,
}: ImageCanvasProps) {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Walkthrough is driven from Workspace via props

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

  // Object Tool (SAM) state — loaded image element for SAM encoding, the active
  // box-drag, and a busy flag while SAM is running.
  const loadedImageRef = useRef<HTMLImageElement | null>(null);
  const samEncodedForUrlRef = useRef<string | null>(null);
  const objectBoxRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [objectBox, setObjectBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [objectBusy, setObjectBusy] = useState(false);
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

  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const containerPointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const PAN_THRESHOLD = 4;
  const offsetRef = useRef(offset);
  useEffect(() => { offsetRef.current = offset; }, [offset]);

  const isOutsideImage = (clientX: number, clientY: number) => {
    if (!imageTransform || !containerRef.current) return true;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left - offset.x;
    const y = clientY - rect.top - offset.y;
    return (
      x < imageTransform.x ||
      x > imageTransform.x + imageTransform.width ||
      y < imageTransform.y ||
      y > imageTransform.y + imageTransform.height
    );
  };

  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    containerPointerDownRef.current = { x: e.clientX, y: e.clientY };
    // Always allow pan from outside the image area, even when brush is active
    if (!isOutsideImage(e.clientX, e.clientY)) return;
    panStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offsetRef.current.x, offsetY: offsetRef.current.y };
    isPanningRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    if (!isPanningRef.current && Math.sqrt(dx * dx + dy * dy) < PAN_THRESHOLD) return;
    isPanningRef.current = true;
    setOffset({ x: panStartRef.current.offsetX + dx, y: panStartRef.current.offsetY + dy });
  };

  const handleContainerPointerUp = () => {
    panStartRef.current = null;
    if (isPanningRef.current) {
      setTimeout(() => { isPanningRef.current = false; }, 0);
    }
  };

  // Wheel: brush size when brush/edit active, pan otherwise. Attached imperatively so we can preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const isBrushActive = brushActive || !!editingRegion;
      if (isBrushActive) {
        e.preventDefault();
        if (!onBrushSizeChange || brushSize === undefined) return;
        // deltaY positive = scroll down = smaller brush, negative = scroll up = larger
        const delta = e.deltaY > 0 ? -2 : 2;
        const next = Math.max(1, Math.min(100, brushSize + delta));
        onBrushSizeChange(next);
      } else {
        e.preventDefault();
        setOffset(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [brushActive, editingRegion, brushSize, onBrushSizeChange]);

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

      // Keep the decoded image for SAM; invalidate any cached SAM encoding.
      loadedImageRef.current = img;
      samEncodedForUrlRef.current = null;

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

  // --- Object Tool (SAM box selector) handlers ---
  // Map a screen point to ORIGINAL-image pixel coordinates (clamped).
  const screenToOriginalPx = (clientX: number, clientY: number) => {
    if (!imageTransform || !naturalSize) return null;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = clientX - rect.left - imageTransform.x;
    const ly = clientY - rect.top - imageTransform.y;
    const nx = (lx / imageTransform.width) * naturalSize.width;
    const ny = (ly / imageTransform.height) * naturalSize.height;
    return {
      x: Math.max(0, Math.min(naturalSize.width, nx)),
      y: Math.max(0, Math.min(naturalSize.height, ny)),
    };
  };

  const handleObjectPointerDown = (e: React.PointerEvent) => {
    if (!objectToolActive || objectBusy) return;
    const p = screenToOriginalPx(e.clientX, e.clientY);
    if (!p) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    objectBoxRef.current = box;
    setObjectBox(box);
  };

  const handleObjectPointerMove = (e: React.PointerEvent) => {
    if (!objectToolActive || !objectBoxRef.current) return;
    const p = screenToOriginalPx(e.clientX, e.clientY);
    if (!p) return;
    const box = { ...objectBoxRef.current, x2: p.x, y2: p.y };
    objectBoxRef.current = box;
    setObjectBox(box);
  };

  const handleObjectPointerUp = async (e: React.PointerEvent) => {
    if (!objectToolActive || !objectBoxRef.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const raw = objectBoxRef.current;
    objectBoxRef.current = null;
    setObjectBox(null);

    const x1 = Math.min(raw.x1, raw.x2);
    const y1 = Math.min(raw.y1, raw.y2);
    const x2 = Math.max(raw.x1, raw.x2);
    const y2 = Math.max(raw.y1, raw.y2);
    if (x2 - x1 < 6 || y2 - y1 < 6) return; // ignore accidental clicks

    const img = loadedImageRef.current;
    // Edit the ACTIVE manual mask — same target the brush writes to. Resolve
    // fresh from tile.regions by id so we composite against current maskData.
    const targetId = (activeMask?.type === 'manual' ? activeMask.id : null)
      ?? tile.regions.find(r => r.selected && r.type === 'manual')?.id;
    const target = targetId ? tile.regions.find(r => r.id === targetId) : undefined;
    if (!img || !target) return;

    const tw = target.maskWidth;
    const th = target.maskHeight;

    setObjectBusy(true);
    try {
      const { encodeImageForSam, segmentWithSam } = await import('@/lib/sam-segmentation');
      if (samEncodedForUrlRef.current !== tile.imageUrl) {
        await encodeImageForSam(img);
        samEncodedForUrlRef.current = tile.imageUrl;
      }
      // Box + center positive point: stronger prompt than box alone, far more
      // reliable on regions SAM finds ambiguous.
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const res = await segmentWithSam(
        [{ x: cx, y: cy, positive: true }],
        { x1, y1, x2, y2 },
        { width: tw, height: th },
      );
      if (res && res.width === tw && res.height === th) {
        const erase = brushMode === 'erase';
        const next = new Uint8Array(target.maskData);
        if (erase) {
          // Erase only pixels already in the mask, never re-add. SAM tells us
          // which pixels are the object; we only zero those.
          for (let i = 0; i < next.length; i++) if (res.mask[i] > 0) next[i] = 0;
        } else {
          for (let i = 0; i < next.length; i++) if (res.mask[i] > 0) next[i] = 255;
        }
        handleMaskUpdate(next, target.id);
      }
    } catch (err) {
      console.error('[SAM] object tool failed', err);
    } finally {
      setObjectBusy(false);
    }
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

  // Empty-placeholder gradients (created up-front from the dropdown / tool wheel)
  // shouldn't count as a "parent mask selected" for live-preview purposes —
  // they have no mask data yet, so treat the in-progress draw as standalone.
  const isPlaceholderGradient = (r: Region) =>
    (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.maskWidth === 0;

  // Live gradient: fed into SmartMaskLayer/ToolLayer for real-time compositing during draw
  const liveGradient = useMemo<LiveGradient | null>(() => {
    if (!drawState?.isDrawing || !drawingTool) return null;
    const parentRegion = tile?.regions.find(r => r.selected && !r.clipParentId && !isPlaceholderGradient(r));
    if (!parentRegion) return null; // standalone — handled separately by drawing overlay
    return {
      type: drawingTool as 'linear-gradient' | 'radial-gradient',
      start: drawState.start,
      end: drawState.current,
      mode: brushMode === 'erase' ? 'subtract' : 'add',
      parentId: parentRegion.id,
    };
  }, [drawState, drawingTool, tile?.regions, brushMode]);

  // Standalone gradient color: green for manual, inherits nothing
  const standaloneGradientColor = '#50FF50';

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-black ${drawingTool ? 'cursor-crosshair' : ''}`}
      onPointerDown={handleContainerPointerDown}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerLeave={handleContainerPointerUp}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) lastMousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
      onClick={(e) => {
        // Exit Edit / Brush Modes on background click — ignore if user dragged (pan)
        if (isPanningRef.current) return;
        if (drawingTool) return;
        // Wheel/tool overlays disable canvas interactions — drop the click entirely.
        if (!canvasInteractionsEnabled) return;
        // Ignore if user dragged inside the image (drag-to-adjust gradients etc.)
        if (containerPointerDownRef.current) {
          const dx = e.clientX - containerPointerDownRef.current.x;
          const dy = e.clientY - containerPointerDownRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > PAN_THRESHOLD) return;
        }
        // Gradients should NEVER deselect from a canvas-background click
        // (inside or outside the image). They only deselect via their own
        // drag handle, the slider panel toggle, or Esc.
        const isGradientEdit = editingRegion?.type === 'linear-gradient' || editingRegion?.type === 'radial-gradient';
        if (isGradientEdit) return;

        const hasGradientSelected = tile.regions.some(
          r => r.selected && (r.type === 'linear-gradient' || r.type === 'radial-gradient')
        );
        if (hasGradientSelected) return;

        if (editingRegion) {
          setEditingRegion(null);
          onUpdateTile({
            regions: tile.regions.map(r => ({
              ...r,
              selected: r.id === editingRegion.id,
            })),
          });
          if (onBrushExit) {
            onBrushExit();
          }
        } else {
          // No editing region: Deselect ALL on background click
          onUpdateTile({
            regions: tile.regions.map(r => ({ ...r, selected: false })),
          });
          if (onBrushExit) {
            onBrushExit();
          }
        }
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px)`,
          pointerEvents: (drawingTool || objectToolActive) ? 'auto' : 'none'
        }}
      >
        {/* LAYER 1: Base Image */}
        <canvas ref={mainCanvasRef} className="absolute inset-0 z-0" />

        {/* LAYER 2: Smart AI Masks */}
        {viewDimensions && (
          <SmartMaskLayer
            tile={tile}
            imageTransform={imageTransform}
            width={viewDimensions.width}
            height={viewDimensions.height}
            peopleEnabled={peopleEnabled}
            backgroundEnabled={backgroundEnabled}
            isWalkthroughActive={isWalkthroughActive}
            hoveredRegionId={brushActive || !canvasInteractionsEnabled ? null : hoveredRegionId}
            isEditing={!!activeEditingRegion && activeEditingRegion.type !== 'manual' && activeEditingRegion.type !== 'linear-gradient' && activeEditingRegion.type !== 'radial-gradient'}
            onHoverChange={brushActive || !canvasInteractionsEnabled ? () => { } : setLocalHoveredRegion}
            onUpdateTile={onUpdateTile}
            onEditRegion={(r) => {
              if (isWalkthroughActive) onCompleteWalkthrough?.(lastMousePosRef.current ?? undefined);
              setWalkthroughClickPos(lastMousePosRef.current ? { ...lastMousePosRef.current } : null);
              handleEditRegion(r.id);
            }}
            onEnterLocalEdit={(r) => {
              if (isWalkthroughActive) onCompleteWalkthrough?.(lastMousePosRef.current ?? undefined);
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
            liveGradient={liveGradient}
            sliderHoveredRegionIds={sliderHoveredRegionIds}
            onCombineWithPrimary={onCombineWithPrimary}
          />
        )}


        {/* LAYER 3: Creative Tools + View Controls */}
        {naturalSize && (
          <ToolLayer
            width={naturalSize.width}
            height={naturalSize.height}
            imageTransform={imageTransform}
            regions={tile.regions}
            // Exclude the active mask from ToolLayer rendering ONLY when the
            // freehand brush is the input surface (it draws the fill itself via
            // BrushTool). In object-tool mode, BrushTool is hidden but the fill
            // must still be visible — so the active mask renders here, and the
            // handle is suppressed separately via hideHandlesForRegionId.
            excludedRegionId={brushActive && !objectToolActive && activeMask ? activeMask.id : undefined}
            hideHandlesForRegionId={objectToolActive && activeMask ? activeMask.id : undefined}
            editingRegionId={editingRegion?.id}
            activeRegionId={activeMask?.id}
            onUpdateTile={onUpdateTile}
            onEditRegion={handleEditRegion} // Route edits through our dispatcher
            onDoubleEditRegion={onActivateBrush} // Handle Double Click (Enable Brush Toolbar)
            onGradientDraggingChange={onGradientDraggingChange}
            liveGradient={liveGradient}
            canvasInteractionsEnabled={canvasInteractionsEnabled}
          />
        )}

        {/* TOOL: Interactive Brush (Global) - Now Inside Transform */}
        {brushActive && !editingRegion && imageTransform && activeMask && activeMask.type === 'manual' && canvasInteractionsEnabled && (
          <BrushTool
            imageTransform={imageTransform}
            activeMask={activeMask}
            onMaskUpdate={(id, data) => handleMaskUpdate(data, id)}
            brushSize={brushSize}
            brushSoftness={brushSoftness}
            brushOpacity={brushOpacity}
            brushMode={brushMode}
            onExit={onBrushExit}
          />
        )}




        {/* Modal Mask Editor (AI Masks Only - Modal Overlay) */}
        {/* Gradients are handled "In-Place" by their respective tools receiving isEditing=true */}
        {activeEditingRegion && activeEditingRegion.type !== 'linear-gradient' && activeEditingRegion.type !== 'radial-gradient' && activeEditingRegion.type !== 'manual' && imageTransform && mainCanvasRef.current && canvasInteractionsEnabled && (
          <AIMaskEditor
            // Pass ALL selected AI masks as active targets
            activeRegions={tile.regions.filter(r => r.selected && (r.type === 'person' || r.type === 'people-group' ||
r.type === 'background' || r.type === 'subject' ||
r.type.startsWith('background-')
))}
            // All person regions — needed to redirect people-group edits to individual persons
            allPersonRegions={tile.regions.filter(r => r.type === 'person' && !r.clipParentId)}
            // Background region — always a neighbor so it retreats/advances with person edits
            backgroundRegion={tile.regions.find(r => r.type === 'background' && !r.clipParentId) ?? null}

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
        {drawingTool && canvasInteractionsEnabled && (
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

              // Standalone gradient: no real parent mask selected, show fill preview ourselves.
              // Placeholder gradients (just-created, no mask data yet) don't count as a parent.
              const isStandalone = !tile?.regions.some(r => r.selected && !r.clipParentId && !isPlaceholderGradient(r));
              const pcm = standaloneGradientColor.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
              const pR = pcm ? parseInt(pcm[1], 16) : 80;
              const pG = pcm ? parseInt(pcm[2], 16) : 255;
              const pB = pcm ? parseInt(pcm[3], 16) : 80;

              return (
                <div
                  className="absolute pointer-events-none"
                  style={{ left: imageTransform.x, top: imageTransform.y, width: iw, height: ih }}
                >
                  {/* Fill preview for standalone only — add/subtract is composited live by SmartMaskLayer/ToolLayer */}
                  {isStandalone && (
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
                          grad.addColorStop(0, `rgba(${pR}, ${pG}, ${pB}, 0.45)`);
                          grad.addColorStop(1, `rgba(${pR}, ${pG}, ${pB}, 0)`);
                          ctx.fillStyle = grad;
                          ctx.fillRect(0, 0, iw, ih);
                        } else {
                          const rx = Math.abs(ex - sx);
                          const ry = Math.abs(ey - sy);
                          if (rx > 2 && ry > 2) {
                            ctx.save();
                            ctx.translate(sx, sy);
                            ctx.scale(1, ry / rx);
                            const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
                            grad.addColorStop(0, `rgba(${pR}, ${pG}, ${pB}, 0.45)`);
                            grad.addColorStop(1, `rgba(${pR}, ${pG}, ${pB}, 0)`);
                            ctx.fillStyle = grad;
                            ctx.fillRect(-rx * 4, -rx * 4 / (ry / rx), rx * 8, rx * 8 / (ry / rx));
                            ctx.restore();
                          }
                        }
                      }}
                      className="absolute inset-0"
                      style={{ width: iw, height: ih }}
                    />
                  )}
                  {/* Handles */}
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

        {/* OBJECT TOOL OVERLAY (SAM box selector) */}
        {objectToolActive && (
          <div
            className={`absolute inset-0 z-50 ${objectBusy ? 'cursor-wait' : 'cursor-crosshair'}`}
            onPointerDown={handleObjectPointerDown}
            onPointerMove={handleObjectPointerMove}
            onPointerUp={handleObjectPointerUp}
            onPointerLeave={handleObjectPointerUp}
          >
            {objectBox && imageTransform && naturalSize && (() => {
              // Box is in original-image px; convert to display px for preview.
              const sx = (Math.min(objectBox.x1, objectBox.x2) / naturalSize.width) * imageTransform.width + imageTransform.x;
              const sy = (Math.min(objectBox.y1, objectBox.y2) / naturalSize.height) * imageTransform.height + imageTransform.y;
              const w = (Math.abs(objectBox.x2 - objectBox.x1) / naturalSize.width) * imageTransform.width;
              const h = (Math.abs(objectBox.y2 - objectBox.y1) / naturalSize.height) * imageTransform.height;
              return (
                <div
                  className="absolute pointer-events-none border-2 border-dashed"
                  style={{
                    left: sx, top: sy, width: w, height: h,
                    borderColor: 'rgba(80,255,80,0.9)',
                    background: 'rgba(80,255,80,0.12)',
                  }}
                />
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
        isWalkthroughActive={isWalkthroughActive}
        isWaveStopped={isWaveStopped}
        clickPos={walkthroughClickPos}
        walkthroughStep={walkthroughStep}
        containerWidth={viewDimensions?.width ?? 0}
        containerHeight={viewDimensions?.height ?? 0}
        onAdvanceStep={onAdvanceWalkthroughStep}
        onStopWave={onStopWave}
        onCompleteWalkthrough={onCompleteWalkthrough}
        onSimulateRegionClick={onSimulateRegionClick}
        onSimulateRegionHover={(id) => { if (!brushActive) setLocalHoveredRegion(id); }}
        onSimulateRegionDeselect={() => {
          onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
          setLocalHoveredRegion(null);
        }}
      />

      <ScanAnimation isActive={showScan} />
    </div >
  );
}