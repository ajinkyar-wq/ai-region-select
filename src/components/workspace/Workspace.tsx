
import { useCallback, useState, useRef, useEffect } from 'react';
import { DropZone } from './layout/DropZone';
import { ImageCanvas } from './ImageCanvas';
import { TitleBar } from './layout/TitleBar';
import { TopBar } from './layout/TopBar';
import { Filmstrip } from './layout/Filmstrip';
import { BottomBar } from './layout/BottomBar';
import { SliderPanel } from './slider-panel/SliderPanel';
import { DraggableToolbar } from './tools/DraggableToolbar';
import { ToolWheel, SIMPLE_SECTORS, SPLIT_SECTORS } from './tools/ToolWheel';
import type { WheelTool } from './tools/ToolWheel';
import { CombineMasksControl } from './tools/CombineMasksControl';
import type { ImageTileData, Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { Columns2, Paintbrush, Eraser, SquareDashedMousePointer } from 'lucide-react';
import { useKeyboardShortcuts } from './Workspacelogic/useKeyboardShortcuts';
import { useRegionManager } from './Workspacelogic/useRegionManager';
import { useMaskOperations } from './Workspacelogic/useMaskOperations';
import { useGradientOperations } from './Workspacelogic/useGradientOperations';
import { useWalkthrough } from './Workspacelogic/useWalkthrough';
import { generateMaskPreview } from '@/lib/mask-preview';
import { masksOverlap } from '@/lib/mask-analysis';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled] = useState(true);
  const [backgroundEnabled] = useState(true);
  const [activeMask, setActiveMask] = useState<Region | null>(null);
  // Sticky primary for combine flow. The FIRST mask selected stays primary while
  // additional masks are Shift-added. Cleared when selection drops to zero.
  const [primaryMaskId, setPrimaryMaskId] = useState<string | null>(null);
  const [brushActive, setBrushActive] = useState(false);
  const [isLocalEditing, setIsLocalEditing] = useState(false); // For AI Mask Editor
  const [exitEditTrigger, setExitEditTrigger] = useState(0);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [panelHoveredRegionId, setPanelHoveredRegionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
  const [brushSize, setBrushSize] = useState([50]);
  const [brushSoftness, setBrushSoftness] = useState([20]);
  const [brushOpacity, setBrushOpacity] = useState([100]);

  // New Drawing Mode State
  const [drawingTool, setDrawingTool] = useState<'linear-gradient' | 'radial-gradient' | null>(null);

  // Object Tool (SAM box selector). When active, the toolbar converts and the
  // canvas captures box-drags that feed SAM, stamping results into the active
  // manual mask using the current brush mode (add fills, erase removes).
  const [objectToolActive, setObjectToolActive] = useState(false);

  // Canvas Interactions Toggle — when false, new canvas drawing (gradient drag) is disabled
  const [canvasInteractionsEnabled, setCanvasInteractionsEnabled] = useState(true);

  // When the user hovers over the sliders panel, temporarily hide the overlay for those regions
  const [isSliderHovered, setIsSliderHovered] = useState(false);

  // Hide the brush toolbar while the user is actively dragging a gradient handle
  const [isGradientDragging, setIsGradientDragging] = useState(false);

  // Tool wheel state
  const [wheelVisible, setWheelVisible] = useState(false);
  const [wheelPos, setWheelPos] = useState({ x: 0, y: 0 });
  const wheelHoveredRef = useRef<number>(-2);
  const hasMaskSelectedRef = useRef(false);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const prevMousePosRef = useRef({ x: 0, y: 0 });

  const { isWalkthroughActive, isWaveStopped, walkthroughStep, stopWave, advanceStep, completeWalkthrough, resetWalkthrough } = useWalkthrough();
  const [postWalkthroughTip, setPostWalkthroughTip] = useState<{ x: number; y: number } | null>(null);
  const postTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dblClickTipCountRef = useRef(4); // show "double click" tip up to 4 times
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTippedMaskIdRef = useRef<string | null>(null); // track which mask last triggered the tip

  // Clipboard State
  const [clipboard, setClipboard] = useState<Region[]>([]);

  // Selection Snapshot for Async Tools (Gradients)
  const selectionSnapshotRef = useRef<string[]>([]);
  const gradientModeRef = useRef<'add' | 'erase'>('add');
  const pendingGradientIdRef = useRef<string | null>(null);

  const showMaskImage = !!image?.regions.some(r => r.selected);

  const { autoDissolveGroups, removeOrphanedClipChildren, handleMoveRegion, handleGroupSelected, handleDeleteGroup } = useRegionManager({
    image,
    setImage,
    activeMask,
    setActiveMask,
    setBrushActive,
    setDrawingTool
  });

  const {
    handleCreateManualMask,
    handleApplyEdits,
    handleResetMasks,
    handleInvertMask,
    handleEditManualMask,
    handleUpdateAdjustments,
    handleCombineMasks
  } = useMaskOperations({
    image,
    setImage,
    activeMask,
    setActiveMask,
    setBrushActive,
    setDrawingTool,
    setBrushMode
  });

  // ── Object Tool (SAM) ───────────────────────────────────────────────────────
  // The object tool IS the manual brush session. handleCreateManualMask creates
  // and activates a manual mask AND sets brushActive=true — so the entire brush
  // flow (handle suppression, isManualToolActive, overlay, commit) applies
  // unchanged. objectToolActive is ONLY the input-surface switch: box prompt
  // instead of cursor strokes.
  const handleCreateObjectMask = useCallback(() => {
    handleCreateManualMask();
    setObjectToolActive(true);
  }, [handleCreateManualMask]);

  // Brush and Object tool share one session. Leaving the brush ends object mode.
  useEffect(() => {
    if (!brushActive) setObjectToolActive(false);
  }, [brushActive]);

  // ── AI↔AI shift-click combine (geometry-based add/subtract) ───────────────
  // Fired when the user shift-clicks an AI mask while a different primary is
  // selected. Geometry decides: meaningful overlap = subtract, otherwise = add.
  // Toggles off if the same combine already exists; flips if the opposite mode
  // does. Manual/gradient masks DO NOT use this path — the SmartMaskLayer gate
  // ensures it only fires for pure AI↔AI selections; manual involvement falls
  // through to additive multi-select so the Add/Subtract pill handles it.
  const handleCombineWithPrimary = useCallback((pickedId: string) => {
    if (!image) return;
    const primaryId = primaryMaskId
      ?? image.regions.find(r => r.selected && !r.clipParentId)?.id;
    if (!primaryId || primaryId === pickedId) return;

    const primary = image.regions.find(r => r.id === primaryId);
    const picked = image.regions.find(r => r.id === pickedId);
    if (!primary || !picked || picked.clipParentId) return;

    const mode: 'add' | 'subtract' = masksOverlap(primary, picked) ? 'subtract' : 'add';

    // Already attached in this mode? Toggle off.
    const existingChild = image.regions.find(r =>
      r.clipParentId === primary.id &&
      r.clipMode === mode &&
      r.sourceRegionId === picked.id
    );
    if (existingChild) {
      setImage(prev => prev ? {
        ...prev,
        regions: prev.regions.filter(r => r.id !== existingChild.id)
      } : prev);
      return;
    }

    // If an OPPOSITE-mode clip-child for this source exists, flip it (remove the
    // opposite first so the new mode takes effect cleanly).
    const oppositeChild = image.regions.find(r =>
      r.clipParentId === primary.id &&
      r.clipMode === (mode === 'add' ? 'subtract' : 'add') &&
      r.sourceRegionId === picked.id
    );

    const clonedMask = new Uint8Array(picked.maskData);
    const newChild: Region = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      type: picked.type,
      label: `${mode === 'add' ? 'Add' : 'Subtract'}: ${picked.label}`,
      maskData: clonedMask,
      maskWidth: picked.maskWidth,
      maskHeight: picked.maskHeight,
      offset: picked.offset,
      gradient: picked.gradient,
      radialGradient: picked.radialGradient,
      color: primary.color,
      visible: true,
      selected: false,
      hovered: false,
      hasEdits: true,
      previewUrl: generateMaskPreview(clonedMask, picked.maskWidth, picked.maskHeight, primary.color),
      clipParentId: primary.id,
      clipMode: mode,
      sourceRegionId: picked.id,
    };

    setImage(prev => {
      if (!prev) return prev;
      const primaryIdx = prev.regions.findIndex(r => r.id === primary.id);
      let newRegions = prev.regions.map(r => {
        if (r.id === primary.id) return { ...r, selected: true, hasEdits: true };
        if (r.selected) return { ...r, selected: false };
        return r;
      });
      if (oppositeChild) {
        newRegions = newRegions.filter(r => r.id !== oppositeChild.id);
      }
      const insertAt = primaryIdx >= 0 ? primaryIdx + 1 : newRegions.length;
      newRegions.splice(insertAt, 0, newChild);
      return { ...prev, regions: newRegions };
    });
    setActiveMask({ ...primary, selected: true });
  }, [image, primaryMaskId, setImage, setActiveMask]);

  const {
    handleCreateLinearGradient,
    handleCreateRadialGradient,
    handleDrawComplete,
    handleIntersectGradient
  } = useGradientOperations({
    image,
    setImage,
    setActiveMask,
    setBrushActive,
    drawingTool,
    setDrawingTool,
    selectionSnapshotRef,
    gradientModeRef,
    pendingGradientIdRef,
  });

  useKeyboardShortcuts({
    image,
    setImage,
    activeMask,
    setActiveMask,
    brushActive,
    setBrushActive,
    brushMode,
    setBrushMode,
    isLocalEditing,
    onExitEditMode: () => setExitEditTrigger(v => v + 1),
    drawingTool,
    setDrawingTool,
    clipboard,
    setClipboard,
    autoDissolveGroups,
    removeOrphanedClipChildren
  });

  const addGradientPlaceholder = useCallback((type: 'linear-gradient' | 'radial-gradient') => {
    if (!image) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const placeholder: Region = {
      id,
      type,
      label: type === 'linear-gradient' ? 'Linear Gradient' : 'Radial Gradient',
      maskData: new Uint8Array(0),
      maskWidth: 0,
      maskHeight: 0,
      color: REGION_COLORS.manual,
      visible: true,
      selected: true,
      hovered: false,
      hasEdits: true,
    };
    pendingGradientIdRef.current = id;
    selectionSnapshotRef.current = [];
    gradientModeRef.current = 'add';
    setImage(prev => prev ? {
      ...prev,
      regions: [
        ...prev.regions.map(r => ({ ...r, selected: false })),
        placeholder
      ]
    } : prev);
    setActiveMask(placeholder);
    setBrushActive(false);
    setDrawingTool(type);
  }, [image]);

  // Tool wheel: select tool handler (stable ref to avoid stale closures)
  const handleWheelSelectTool = useCallback((tool: WheelTool, mode: 'add' | 'erase') => {
    setBrushMode(mode);
    if (tool === 'brush' || tool === 'eraser') {
      const hasMask = image?.regions.some(r => r.selected);
      if (!hasMask) {
        handleCreateManualMask();
      } else {
        setBrushActive(true);
        setDrawingTool(null);
      }
    } else if (tool === 'linear-gradient') {
      // Standalone (no mask selected) → pre-create the listing immediately,
      // matching the side-panel dropdown behavior. Clip-child case (mask
      // selected) keeps going through the snapshot-based flow.
      const hasMask = image?.regions.some(r => r.selected);
      if (!hasMask) {
        addGradientPlaceholder('linear-gradient');
      } else {
        handleCreateLinearGradient(mode);
      }
    } else if (tool === 'radial-gradient') {
      const hasMask = image?.regions.some(r => r.selected);
      if (!hasMask) {
        addGradientPlaceholder('radial-gradient');
      } else {
        handleCreateRadialGradient(mode);
      }
    }
  }, [image, handleCreateManualMask, handleCreateLinearGradient, handleCreateRadialGradient, addGradientPlaceholder]);

  const handleWheelSelectToolRef = useRef(handleWheelSelectTool);
  handleWheelSelectToolRef.current = handleWheelSelectTool;

  // Maintain sticky primary for combine flow. The primary stays put while the
  // user Shift-adds more masks; it only changes when the user makes a fresh
  // single-mask selection, and clears when nothing is selected.
  useEffect(() => {
    if (!image) { setPrimaryMaskId(null); return; }
    const selectedTopLevel = image.regions.filter(r => r.selected && !r.clipParentId);
    if (selectedTopLevel.length === 0) {
      if (primaryMaskId !== null) setPrimaryMaskId(null);
      return;
    }
    // If current primary is still selected, keep it sticky (no change).
    if (primaryMaskId && selectedTopLevel.some(r => r.id === primaryMaskId)) return;
    // Otherwise: primary was deselected (or never set). Adopt the first selected.
    setPrimaryMaskId(selectedTopLevel[0].id);
  }, [image, primaryMaskId]);

  // Tool wheel: track mouse and Tab key
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      prevMousePosRef.current = mousePosRef.current;
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        e.stopPropagation();
        // Blur whatever is focused so browser can't tab-cycle
        (document.activeElement as HTMLElement)?.blur?.();
        if (!e.repeat) {
          setWheelPos(mousePosRef.current);
          setWheelVisible(true);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        e.stopPropagation();
        setWheelVisible(false);
        const idx = wheelHoveredRef.current;
        if (idx >= 0) {
          const sectors = hasMaskSelectedRef.current ? SPLIT_SECTORS : SIMPLE_SECTORS;
          const s = sectors[idx];
          if (s) handleWheelSelectToolRef.current(s.tool, s.mode);
        }
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  const handleSelectBatchRegions = (ids: string[], multi: boolean, activeId?: string) => {
    if (!image) return;

    // Empty ids = deselect signal from clicking an already-selected region
    if (ids.length === 0 && !multi) {
      if (brushActive) {
        // In edit mode: exit edit mode, keep selected
        setBrushActive(false);
        setDrawingTool(null);
      } else {
        // Not in edit mode: deselect all
        setImage({ ...image, regions: image.regions.map(r => ({ ...r, selected: false })) });
        setActiveMask(null);
        setDrawingTool(null);
      }
      return;
    }

    // Single-click toggle-off: plain click on an already-selected mask when it's
    // the only thing selected and we're not in edit mode deselects it.
    if (!multi && ids.length === 1 && !brushActive) {
      const targetId = ids[0];
      const selectedNow = image.regions.filter(r => r.selected);
      const onlyThisSelected = selectedNow.length === 1 && selectedNow[0].id === targetId;
      if (onlyThisSelected) {
        setImage({ ...image, regions: image.regions.map(r => ({ ...r, selected: false })) });
        setActiveMask(null);
        setDrawingTool(null);
        return;
      }
    }

    // Multi-select must NOT promote a transient secondary into a permanent
    // listing — hasEdits is what makes a mask show up in the side panel, so
    // only set it when selecting (non-multi) or when the mask is already
    // committed (hasEdits already true). Otherwise a shift-click would create
    // a phantom listing for what is just an add/subtract candidate.
    let newRegions = image.regions.map(r => {
      if (ids.includes(r.id)) {
        const promoteHasEdits = !multi || r.hasEdits;
        return { ...r, selected: true, hasEdits: promoteHasEdits ? true : r.hasEdits };
      }
      return multi ? r : { ...r, selected: false };
    });

    // No auto-grouping: multi-selection is transient (it drives the
    // Add/Subtract pill). Forming a group on every shift-click both pollutes
    // the side panel and changes downstream rendering — neither is wanted.

    newRegions = autoDissolveGroups(newRegions);

    setImage({
      ...image,
      regions: newRegions
    });

    // Single click in slider panel: stop wave animation
    if (isWalkthroughActive) stopWave();

    // Sync Activation if activeId is provided (e.g. from single-click or Shift-Click)
    if (activeId) {
      const region = image.regions.find(r => r.id === activeId);
      if (region) {
        setActiveMask(region);
        setBrushActive(false);
        setDrawingTool(null);
      }
    }
  };

  // Called when AI Mask Editor enters/exits in ImageTile
  const handleLocalEditChange = useCallback((isEditing: boolean) => {
    setIsLocalEditing(isEditing);
  }, []);

  const handleFileDrop = useCallback((file: File) => {
    resetWalkthrough();
    dblClickTipCountRef.current = 4;
    lastTippedMaskIdRef.current = null;
    setPostWalkthroughTip(null);
    if (postTipTimerRef.current) clearTimeout(postTipTimerRef.current);
    const imageUrl = URL.createObjectURL(file);

    // Load image to get dimensions
    const img = new Image();
    img.onload = () => {
      setImage({
        id: 'single-image',
        file,
        imageUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        isProcessing: true,
        regions: [],
        selectedRegionId: null,
      });
    };
    img.src = imageUrl;
  }, []);



  const selectRegionByType = (
    type: 'person' | 'background' | null,
    edit = false
  ) => {
    if (!type || !image) return;

    if (edit) {
      const region = image.regions.find(r => r.type === type);
      if (!region) return;

      const isAI = type === 'person' || type === 'background';

      // ✅ SMART SELECTION: Preserve AI Multi-Select
      setImage(prev =>
        prev
          ? {
            ...prev,
            regions: prev.regions.map(r => {
              // If we are editing AI, and 'r' is also AI/Group and WAS selected -> Keep it.
              if (isAI) {
                const rIsAI = r.type === 'person' || r.type === 'background' || r.type === 'people-group';
                if (rIsAI && r.selected) return r;
              }
              return {
                ...r,
                selected: false,
              };
            }),
          }
          : prev
      );

      // ✅ ENTER EDIT MODE
      setActiveMask(region);
      setBrushActive(true);
      setDrawingTool(null);
      return;
    }

    const isAlreadySelected = image.regions.some(
      r => r.type === type && r.selected
    );

    setImage(prev =>
      prev
        ? {
          ...prev,
          regions: prev.regions.map(r => ({
            ...r,
            selected: isAlreadySelected ? false : r.type === type,
          })),
        }
        : prev
    );
  };


  return (
    <div
      className="relative h-screen w-screen bg-[#111111] overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
    >
      {!image && (
        <div className="flex h-full w-full items-center justify-center">
          <DropZone onFileDrop={handleFileDrop} />
        </div>
      )}

      {image && (
        <div className="flex h-screen w-screen flex-col">
          <TitleBar />
          <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="relative flex flex-1 overflow-hidden">
            <div
              ref={containerRef}
              className="relative flex flex-1 flex-col overflow-hidden"
              style={{ marginRight: isPanelOpen ? 344 : 0 }}
            >

              {/* Escape to deselect tip — top center, shown when mask selected but no tool active */}
              {activeMask && !brushActive && !isLocalEditing && !isWalkthroughActive && (
                <div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none z-40">
                  <div style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '5px 10px', background: 'rgba(30,30,30,0.72)',
                    borderRadius: '6px', boxShadow: '0 2px 10px rgba(0,0,0,0.22)',
                    backdropFilter: 'blur(6px)', whiteSpace: 'nowrap',
                  }}>
                    <span style={{ fontFamily: 'Geist, sans-serif', fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: '14px' }}>
                      Press <kbd style={{ display: 'inline-block', padding: '1px 5px', background: 'rgba(255,255,255,0.15)', borderRadius: '4px', fontFamily: 'Geist, sans-serif', fontSize: '11px', fontWeight: 600, color: '#fff' }}>Esc</kbd> to unselect all masks
                    </span>
                  </div>
                </div>
              )}

              {/* Post-walkthrough tip */}
              {postWalkthroughTip && (
                <div
                  className="absolute pointer-events-none z-50"
                  style={{ left: postWalkthroughTip.x + 14, top: postWalkthroughTip.y - 10 }}
                >
                  <div style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '5px 9px', background: '#F6F6F6',
                    borderRadius: '5px', boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{
                      fontFamily: 'Geist, sans-serif', fontSize: '11px',
                      fontWeight: 500, color: '#474747', lineHeight: '14px',
                    }}>
                      Double click anywhere to select brush tool directly
                    </span>
                  </div>
                </div>
              )}

              <div className="absolute top-3 right-3 z-30 pointer-events-auto">
                <button
                  className="
                  h-9 w-9
                  rounded-md
                  bg-black/60
                  border border-white/10
                  text-white
                  flex items-center justify-center
                  hover:bg-black/80
                  transition
                  shadow-md
                 "
                  title="Compare"
                >
                  <Columns2 className="h-4 w-4 opacity-90" />
                </button>
              </div>

              {/* DraggableToolbar — Object Tool variant: a single Object tool with
                  add/subtract via brushMode (add fills the SAM region, subtract
                  removes it). Shares the brush session (brushActive=true) but
                  replaces the freehand brush UI on this slot. */}
              {image && objectToolActive && (
                <DraggableToolbar
                  disabled={false}
                  containerRef={containerRef}
                  imageId={image.id}
                  activeId={brushMode === 'erase' ? 'object-subtract' : 'object-add'}
                  onActiveChange={(id) => {
                    if (!id) {
                      // Exit the whole session — same as deselecting the brush.
                      setBrushActive(false);
                      setObjectToolActive(false);
                      setExitEditTrigger(v => v + 1);
                    } else if (id === 'object-add') {
                      setBrushMode('add');
                    } else if (id === 'object-subtract') {
                      setBrushMode('erase');
                    }
                  }}
                  brushSize={brushSize}
                  onBrushSizeChange={setBrushSize}
                  brushSoftness={brushSoftness}
                  onBrushSoftnessChange={setBrushSoftness}
                  brushOpacity={brushOpacity}
                  onBrushOpacityChange={setBrushOpacity}
                  onResetMask={handleResetMasks}
                  items={[
                    {
                      id: 'object-add',
                      icon: <SquareDashedMousePointer className="h-[20px] w-[20px]" />,
                      label: 'Add',
                      onClick: () => setBrushMode('add'),
                    },
                    {
                      id: 'object-subtract',
                      icon: <SquareDashedMousePointer className="h-[20px] w-[20px]" />,
                      label: 'Subtract',
                      onClick: () => setBrushMode('erase'),
                    },
                  ]}
                />
              )}

              {/* DraggableToolbar: Only shows when explicitly ACTIVATED (Double Click / Edit Mode)
                  AND it's a Brush-based tool (Manual or AI Mask). Gradients use on-canvas handles. */}
              {image && !objectToolActive && !image.regions.some(r => r.selected && (r.type === 'linear-gradient' || r.type === 'radial-gradient')) && (
                <DraggableToolbar
                  disabled={!image.regions.some(r => r.selected && r.type !== 'linear-gradient' && r.type !== 'radial-gradient')}
                  containerRef={containerRef}
                  imageId={image.id}
                  activeId={(brushActive || isLocalEditing) ? (brushMode === 'erase' ? 'eraser' : 'brush') : undefined}
                  onActiveChange={(id) => {
                    if (!id) {
                      setBrushActive(false);
                      setExitEditTrigger(v => v + 1);
                    } else if (id === 'brush') {
                      setBrushActive(true);
                      setBrushMode('add');
                    } else if (id === 'eraser') {
                      setBrushActive(true);
                      setBrushMode('erase');
                    }
                  }}
                  // State Props
                  brushSize={brushSize}
                  onBrushSizeChange={setBrushSize}
                  brushSoftness={brushSoftness}
                  onBrushSoftnessChange={setBrushSoftness}
                  brushOpacity={brushOpacity}
                  onBrushOpacityChange={setBrushOpacity}

                  // Reset Handler
                  onResetMask={handleResetMasks}

                  items={[
                    {
                      id: 'brush',
                      icon: <Paintbrush className="h-[20px] w-[20px]" />, // aligned with 20px icon size in design
                      label: 'Brush',
                      onClick: () => {
                        setBrushActive(true);
                        setBrushMode('add');
                      },
                    },
                    {
                      id: 'eraser',
                      icon: <Eraser className="h-[20px] w-[20px]" />,
                      label: 'Eraser',
                      onClick: () => {
                        setBrushActive(true);
                        setBrushMode('erase');
                      },
                    },
                  ]}
                />
              )}

              {/* Combine Masks pill — only appears when a manual or gradient mask
                  is involved in the selection (intent can't be inferred from
                  geometry in that case). Pure AI↔AI shift-click combines go
                  through handleCombineWithPrimary instead and don't surface here. */}
              {(() => {
                if (!image || !primaryMaskId) return null;
                if (brushActive || isLocalEditing || drawingTool || wheelVisible) return null;
                const primary = image.regions.find(r => r.id === primaryMaskId);
                if (!primary) return null;
                const secondaries = image.regions.filter(r =>
                  r.selected && r.id !== primaryMaskId && !r.clipParentId
                );
                if (secondaries.length === 0) return null;
                const isManualLike = (r: Region) =>
                  r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient';
                const manualInvolved = isManualLike(primary) || secondaries.some(isManualLike);
                if (!manualInvolved) return null;
                return (
                  <CombineMasksControl
                    primaryLabel={primary.label || 'Primary'}
                    secondaryCount={secondaries.length}
                    onAdd={() => handleCombineMasks('add', primaryMaskId)}
                    onSubtract={() => handleCombineMasks('subtract', primaryMaskId)}
                  />
                );
              })()}

              {/* Tool Wheel — shown when Tab is held */}
              {wheelVisible && image && (
                <ToolWheel
                  x={wheelPos.x}
                  y={wheelPos.y}
                  hasMaskSelected={(() => { const v = image.regions.some(r => r.selected); hasMaskSelectedRef.current = v; return v; })()}
                  brushMode={brushMode}
                  onSelectTool={handleWheelSelectTool}
                  onToggleBrushMode={() => setBrushMode(prev => prev === 'add' ? 'erase' : 'add')}
                  onHoverChange={(idx) => { wheelHoveredRef.current = idx; }}
                />
              )}

              <div className="relative flex-1 pb-[128px]"
                onPointerDown={(e) => { lastPointerPosRef.current = { x: e.clientX, y: e.clientY }; }}
              >
                <ImageCanvas
                  image={image}
                  selectionMode={selectionMode}
                  hoveredRegionOverride={panelHoveredRegionId ?? hoveredRegion}
                  activeMask={activeMask}
                  brushActive={brushActive}
                  onBrushExit={() => setBrushActive(false)}

                  // Pass Brush State
                  brushMode={brushMode}
                  brushSize={brushSize[0]} // Pass number
                  onBrushSizeChange={(size) => setBrushSize([size])}
                  brushSoftness={brushSoftness[0]}
                  brushOpacity={brushOpacity[0]}

                  // NEW PROPS
                  drawingTool={drawingTool}
                  onDrawComplete={handleDrawComplete}

                  peopleEnabled={peopleEnabled}
                  backgroundEnabled={backgroundEnabled}
                  onUpdateTile={(updates) => {
                    // Sync activeMask state if regions are being deselected.
                    // IMPORTANT: Don't clear activeMask if another region is concurrently being
                    // selected in this same update (e.g. clicking Gradient B while Gradient A is
                    // active). In that case, onActivateRegion will set the new activeMask — we
                    // must not race it with null.
                    if (activeMask && updates.regions) {
                      const updatedActiveRegion = updates.regions.find(r => r.id === activeMask.id);
                      const someOtherRegionSelected = updates.regions.some(
                        r => r.id !== activeMask.id && r.selected
                      );
                      if (updatedActiveRegion && !updatedActiveRegion.selected && !someOtherRegionSelected) {
                        setActiveMask(null);
                        setBrushActive(false);
                      }
                    }

                    setImage(prev => {
                      if (!prev) return prev;

                      // Check if maskData changed for any region, if so regenerate preview
                      let regions = prev.regions;
                      if (updates.regions) {
                        regions = updates.regions.map(updatedRegion => {
                          const oldRegion = prev.regions.find(r => r.id === updatedRegion.id);
                          if (oldRegion && updatedRegion.maskData && updatedRegion.maskData !== oldRegion.maskData) {
                            // Mask changed, regenerate preview
                            const previewUrl = generateMaskPreview(
                              updatedRegion.maskData,
                              updatedRegion.maskWidth,
                              updatedRegion.maskHeight,
                              updatedRegion.color
                            );
                            return { ...updatedRegion, previewUrl };
                          }
                          return updatedRegion;
                        });
                      }

                      return { ...prev, ...updates, regions };
                    });
                  }}
                  onActivateBrush={handleEditManualMask}
                  onActivateRegion={(id) => {
                    if (!image) return;
                    const region = image.regions.find(r => r.id === id);
                    if (region) {
                      setActiveMask(region);
                      // Single-click: Select only. NEVER activate brush here.
                      // Brush is activated ONLY via double-click (onDoubleEditRegion).
                      setBrushActive(false);

                      // Show "double click" tip up to 4 times, once per unique mask selection
                      if (dblClickTipCountRef.current > 0 && lastTippedMaskIdRef.current !== id) {
                        lastTippedMaskIdRef.current = id;
                        dblClickTipCountRef.current -= 1;
                        const containerEl = containerRef.current;
                        const rect = containerEl?.getBoundingClientRect();
                        const pos = rect
                          ? { x: lastPointerPosRef.current.x - rect.left, y: lastPointerPosRef.current.y - rect.top }
                          : lastPointerPosRef.current;
                        setPostWalkthroughTip(pos);
                        if (postTipTimerRef.current) clearTimeout(postTipTimerRef.current);
                        postTipTimerRef.current = setTimeout(() => setPostWalkthroughTip(null), 2800);
                      }
                    }
                  }}
                  onEditingModeChange={handleLocalEditChange}
                  exitEditTrigger={exitEditTrigger}
                  canvasInteractionsEnabled={canvasInteractionsEnabled && !wheelVisible}
                  objectToolActive={objectToolActive}
                  onCombineWithPrimary={handleCombineWithPrimary}
                  onGradientDraggingChange={setIsGradientDragging}
                  sliderHoveredRegionIds={isSliderHovered ? (image?.regions.filter(r => r.selected).map(r => r.id) ?? []) : []}
                  isWalkthroughActive={isWalkthroughActive}
                  isWaveStopped={isWaveStopped}
                  walkthroughStep={walkthroughStep}
                  onAdvanceWalkthroughStep={advanceStep}
                  onStopWave={stopWave}
                  onCompleteWalkthrough={(pos) => {
                    completeWalkthrough();
                    if (pos) {
                      setPostWalkthroughTip(pos);
                      if (postTipTimerRef.current) clearTimeout(postTipTimerRef.current);
                      postTipTimerRef.current = setTimeout(() => setPostWalkthroughTip(null), 3500);
                    }
                  }}
                  onSimulateRegionClick={(regionId) => {
                    if (!image) return;
                    const region = image.regions.find(r => r.id === regionId);
                    if (!region) return;
                    const updated = { ...region, selected: true, hasEdits: true };
                    setActiveMask(updated);
                    setBrushActive(false);
                    setImage({ ...image, regions: image.regions.map(r =>
                      r.id === regionId ? updated : { ...r, selected: false }
                    )});
                  }}
                />

                {/* Edit mode tooltip */}
                {isLocalEditing && (
                  <div style={{
                    position: 'absolute', bottom: 148, left: '50%',
                    transform: 'translateX(-50%)',
                    pointerEvents: 'none', zIndex: 60,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                    padding: '7px 13px',
                    background: 'rgba(30,30,30,0.82)',
                    borderRadius: '8px',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.28)',
                    backdropFilter: 'blur(6px)',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ fontFamily: 'Geist, sans-serif', fontSize: '12px', fontWeight: 500, color: '#fff', lineHeight: '17px' }}>
                      <kbd style={{
                        display: 'inline-block', padding: '1px 5px',
                        background: 'rgba(255,255,255,0.15)', borderRadius: '4px',
                        fontFamily: 'Geist, sans-serif', fontSize: '11px', fontWeight: 600, color: '#fff',
                      }}>Esc</kbd>{' '}or click outside the image to unselect tools
                    </span>
                    <span style={{ fontFamily: 'Geist, sans-serif', fontSize: '11px', fontWeight: 400, color: 'rgba(255,255,255,0.6)', lineHeight: '15px' }}>
                      Switching masks will unselect tools
                    </span>
                  </div>
                )}
              </div>

              <div className="absolute bottom-[42px] left-0 right-0 z-10">
                <Filmstrip />
              </div>

              <div className="absolute bottom-0 left-0 right-0 z-10">
                <BottomBar />
              </div>
            </div>

            <SliderPanel
              isOpen={isPanelOpen}
              onToggle={() => setIsPanelOpen(!isPanelOpen)}
              regions={image?.regions || []}
              onSelectRegion={(id, multi) => {
                if (!image) return;
                // Multi-select is transient (drives the Add/Subtract pill).
                // Don't promote hasEdits when adding via multi-select — that
                // would create a phantom listing for a mere combine candidate.
                let newRegions = image.regions.map(r => {
                  if (r.id === id) {
                    const promoteHasEdits = !multi || r.hasEdits;
                    return { ...r, selected: true, hasEdits: promoteHasEdits ? true : r.hasEdits };
                  }
                  return multi ? r : { ...r, selected: false };
                });

                // No auto-grouping on multi-select — the selection is just a
                // combine candidate set, not a persistent group.

                newRegions = autoDissolveGroups(newRegions);

                // Only update selection state
                setImage({ ...image, regions: newRegions });

                // Sync Activation (Parity with Canvas)
                // When selecting in panel (Single Click), we set it as Active Mask but DO NOT enter edit mode (Brush).
                const region = image.regions.find(r => r.id === id);
                if (region) {
                  setActiveMask(region);
                  setBrushActive(false); // Single click = Select only

                  // Clear drawing tool if switching masks
                  setDrawingTool(null);
                }
              }}
              onActivateRegion={(id) => {
                if (!image) return;
                const region = image.regions.find(r => r.id === id);
                if (!region) return;

                // Double Click: complete walkthrough (parity with canvas double-click)
                if (isWalkthroughActive) completeWalkthrough();

                // Toggle out of edit mode if double-clicking the same region we're already editing
                if (activeMask?.id === id && brushActive) {
                  setBrushActive(false);
                  setDrawingTool(null);
                  return;
                }

                // Explicit Activation -> Edit Mode
                setActiveMask(region);

                // Specific behavior per type
                if (region.type === 'manual') {
                  setBrushActive(true);
                  setBrushMode('add');
                } else if (region.type === 'person' || region.type === 'people-group' ||
region.type === 'background' || region.type === 'subject' ||
region.type.startsWith('background-')) {
                  // AI Masks: Signal Intent to Edit (ImageTile will pick up brushActive + AI type -> Enter Local Editor)
                  setBrushActive(true);
                  setBrushMode('add');
                }
                // For AI/Gradient, ImageTile's useEffect on activeMask will handle it
              }}
              onToggleVisibility={(id) => {
                if (!image) return;
                setImage({
                  ...image,
                  regions: image.regions.map(r => r.id === id ? { ...r, visible: !r.visible } : r)
                });
              }}
              onToggleBatchVisibility={(ids, visible) => {
                if (!image) return;
                setImage({
                  ...image,
                  regions: image.regions.map(r => ids.includes(r.id) ? { ...r, visible } : r)
                });
              }}
              onDeleteRegion={(id) => {
                if (!image) return;
                const region = image.regions.find(r => r.id === id);
                if (!region) return;

                const isManual = region.type === 'manual' ||
                  region.type === 'linear-gradient' ||
                  region.type === 'radial-gradient';

                setImage(prev => {
                  if (!prev) return prev;

                  // Identify the main region to delete, any regions clipped directly
                  // to it (clipParentId === id), and any clipped to the group it belongs to
                  // if this deletion will leave that group with 0 members.
                  const directClipChildren = prev.regions.filter(r => r.clipParentId === id);

                  // Check if deleting this region will empty its group
                  const groupId = region.groupId;
                  const groupClipChildren = groupId
                    ? (() => {
                      const survivors = prev.regions.filter(r => r.groupId === groupId && r.id !== id);
                      // Only remove group-level clip children when the group will be fully empty.
                      // While the group still has remaining members, the gradient stays on the group.
                      return survivors.length === 0
                        ? prev.regions.filter(r => r.clipParentId === groupId)
                        : [];
                    })()
                    : [];

                  const dependents = [...directClipChildren, ...groupClipChildren];
                  const regionsToDelete = [region, ...dependents];

                  // Filter sets
                  const manualToDelete = regionsToDelete.filter(r =>
                    r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient'
                  );

                  const aiToReset = regionsToDelete.filter(r =>
                    !manualToDelete.includes(r)
                  );

                  let newRegions: Region[];

                  // 1. Convert prev regions to a new list, filtering out HARD deletes
                  newRegions = prev.regions.filter(r => !manualToDelete.some(del => del.id === r.id));

                  // 2. Soft Reset AI masks
                  newRegions = newRegions.map(r => {
                    if (aiToReset.some(reset => reset.id === r.id)) {
                      return {
                        ...r,
                        hasEdits: false,
                        selected: false,
                        visible: true,
                        groupId: undefined,
                        clipParentId: undefined
                      };
                    }
                    return r;
                  });

                  // 3. Dissolve groups that became singletons; clean up any remaining ghosts
                  newRegions = autoDissolveGroups(newRegions);
                  newRegions = removeOrphanedClipChildren(newRegions);

                  return { ...prev, regions: newRegions };
                });

                if (activeMask?.id === id) {
                  setActiveMask(null);
                  setBrushActive(false);
                }
              }}
              showMaskImage={showMaskImage}
              onCreateManualMask={handleCreateManualMask}
              onCreateObjectMask={handleCreateObjectMask}
              onCreateLinearGradient={() => addGradientPlaceholder('linear-gradient')}
              onCreateRadialGradient={() => addGradientPlaceholder('radial-gradient')}
              onApplyEdits={handleApplyEdits}
              onSelectBatchRegions={handleSelectBatchRegions}
              onMoveRegion={handleMoveRegion}
              onGroupSelected={handleGroupSelected}
              onDeleteGroup={handleDeleteGroup}
              onInvertMask={handleInvertMask}
              onIntersectGradient={handleIntersectGradient}
              canvasInteractionsEnabled={canvasInteractionsEnabled}
              onToggleCanvasInteractions={() => setCanvasInteractionsEnabled(v => !v)}
              onSliderHoverChange={setIsSliderHovered}
              onMaskItemHover={setPanelHoveredRegionId}
            />
          </div>
        </div>
      )}
    </div>
  );
}