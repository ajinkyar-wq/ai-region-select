
import { useCallback, useState, useRef, useEffect } from 'react';
import { DropZone } from './layout/DropZone';
import { ImageCanvas } from './ImageCanvas';
import { TitleBar } from './layout/TitleBar';
import { TopBar } from './layout/TopBar';
import { Filmstrip } from './layout/Filmstrip';
import { BottomBar } from './layout/BottomBar';
import { SliderPanel } from './slider-panel/SliderPanel';
import { DraggableToolbar } from './tools/DraggableToolbar';
import type { ImageTileData, Region } from '@/types/workspace';
import { Columns2, Paintbrush, Eraser } from 'lucide-react';
import { useKeyboardShortcuts } from './Workspacelogic/useKeyboardShortcuts';
import { useRegionManager } from './Workspacelogic/useRegionManager';
import { useMaskOperations } from './Workspacelogic/useMaskOperations';
import { useGradientOperations } from './Workspacelogic/useGradientOperations';
import { generateMaskPreview } from '@/lib/mask-preview';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled] = useState(true);
  const [backgroundEnabled] = useState(true);
  const [activeMask, setActiveMask] = useState<Region | null>(null);
  const [brushActive, setBrushActive] = useState(false);
  const [isLocalEditing, setIsLocalEditing] = useState(false); // For AI Mask Editor
  const [hoveredRegion] = useState<'person' | 'background' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
  const [brushSize, setBrushSize] = useState([50]);
  const [brushSoftness, setBrushSoftness] = useState([20]);
  const [brushOpacity, setBrushOpacity] = useState([70]);

  // New Drawing Mode State
  const [drawingTool, setDrawingTool] = useState<'linear-gradient' | 'radial-gradient' | null>(null);

  // Canvas Interactions Toggle — when false, new canvas drawing (gradient drag) is disabled
  const [canvasInteractionsEnabled, setCanvasInteractionsEnabled] = useState(true);

  // Clipboard State
  const [clipboard, setClipboard] = useState<Region[]>([]);

  // Selection Snapshot for Async Tools (Gradients)
  const selectionSnapshotRef = useRef<string[]>([]);

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
    handleUpdateAdjustments
  } = useMaskOperations({
    image,
    setImage,
    setActiveMask,
    setBrushActive,
    setDrawingTool,
    setBrushMode
  });

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
    selectionSnapshotRef
  });

  useKeyboardShortcuts({
    image,
    setImage,
    activeMask,
    setActiveMask,
    brushActive,
    setBrushActive,
    drawingTool,
    setDrawingTool,
    clipboard,
    setClipboard,
    autoDissolveGroups,
    removeOrphanedClipChildren
  });

  const handleSelectBatchRegions = (ids: string[], multi: boolean, activeId?: string) => {
    if (!image) return;
    setImage({
      ...image,
      regions: image.regions.map(r => {
        // If ID is in list, select it.
        // If multi is false, deselect everything else.
        // If multi is true, keep others as they are.
        if (ids.includes(r.id)) return { ...r, selected: true };
        return multi ? r : { ...r, selected: false };
      })
    });

    // Sync Activation if activeId is provided (e.g. from single-click or Shift-Click)
    if (activeId) {
      const region = image.regions.find(r => r.id === activeId);
      if (region) {
        setActiveMask(region);
        setBrushActive(false); // Selection never activates brush — only double-click does
        setDrawingTool(null);
      }
    }
  };

  // Called when AI Mask Editor enters/exits in ImageTile
  const handleLocalEditChange = useCallback((isEditing: boolean) => {
    setIsLocalEditing(isEditing);
  }, []);

  const handleFileDrop = useCallback((file: File) => {
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

              {/* DraggableToolbar: Only shows when explicitly ACTIVATED (Double Click / Edit Mode) 
                  AND it's a Brush-based tool (Manual or AI Mask). Gradients use on-canvas handles. */}
              {image && (brushActive || (isLocalEditing && activeMask && activeMask.type !== 'linear-gradient' && activeMask.type !== 'radial-gradient')) && (
                <DraggableToolbar
                  containerRef={containerRef}
                  activeId={(brushActive && activeMask?.type === 'manual') ? (brushMode === 'erase' ? 'eraser' : 'brush') : 'move'}
                  onActiveChange={(id) => {
                    if (id === 'brush') {
                      setBrushActive(true);
                      setBrushMode('add');
                    } else if (id === 'eraser') {
                      setBrushActive(true);
                      setBrushMode('erase');
                    } else {
                      setBrushActive(false);
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

              <div className="relative flex-1 pb-[128px]">
                <ImageCanvas
                  image={image}
                  selectionMode={selectionMode}
                  hoveredRegionOverride={hoveredRegion}
                  activeMask={activeMask}
                  brushActive={brushActive}
                  onBrushExit={() => setBrushActive(false)}

                  // Pass Brush State
                  brushMode={brushMode}
                  brushSize={brushSize[0]} // Pass number
                  brushSoftness={brushSoftness[0]}
                  brushOpacity={brushOpacity[0]}

                  // NEW PROPS
                  drawingTool={drawingTool}
                  onDrawComplete={handleDrawComplete}

                  peopleEnabled={peopleEnabled}
                  backgroundEnabled={backgroundEnabled}
                  onUpdateTile={(updates) => {
                    // Sync activeMask state if regions are being deselected
                    if (activeMask && updates.regions) {
                      const updatedActiveRegion = updates.regions.find(r => r.id === activeMask.id);
                      if (updatedActiveRegion && !updatedActiveRegion.selected) {
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
                    }
                  }}
                  onEditingModeChange={handleLocalEditChange}
                  canvasInteractionsEnabled={canvasInteractionsEnabled}
                />
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
                const newRegions = image.regions.map(r => {
                  if (r.id === id) return { ...r, selected: true };
                  return multi ? r : { ...r, selected: false };
                });
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

                // Explicit Activation -> Edit Mode
                setActiveMask(region);

                // Specific behavior per type
                if (region.type === 'manual') {
                  setBrushActive(true);
                  setBrushMode('add');
                } else if (region.type === 'person' || region.type === 'people-group' || region.type === 'background') {
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

                  // Check if deleting this region empties its group entirely
                  const groupId = region.groupId;
                  const groupClipChildren = groupId
                    ? (() => {
                      const survivors = prev.regions.filter(r => r.groupId === groupId && r.id !== id);
                      // Only cascade group-level clips when the group will be empty after this delete
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
              onCreateLinearGradient={handleCreateLinearGradient}
              onCreateRadialGradient={handleCreateRadialGradient}
              onApplyEdits={handleApplyEdits}
              onSelectBatchRegions={handleSelectBatchRegions}
              onMoveRegion={handleMoveRegion}
              onGroupSelected={handleGroupSelected}
              onDeleteGroup={handleDeleteGroup}
              onInvertMask={handleInvertMask}
              onIntersectGradient={handleIntersectGradient}
              canvasInteractionsEnabled={canvasInteractionsEnabled}
              onToggleCanvasInteractions={() => setCanvasInteractionsEnabled(v => !v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}