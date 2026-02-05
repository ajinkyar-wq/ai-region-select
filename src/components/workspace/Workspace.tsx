
import { useCallback, useState, useRef, useEffect } from 'react';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import { TitleBar } from './TitleBar';
import { TopBar } from './TopBar';
import { Filmstrip } from './Filmstrip';
import { BottomBar } from './BottomBar';
import { SliderPanel } from './SliderPanel';
import { DraggableToolbar } from './DraggableToolbar';
import type { ImageTileData, Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { Columns2, Paintbrush, Eraser } from 'lucide-react';
import { generateRadialGradientMask } from '@/lib/mask-analysis';
import { generateMaskPreview } from '@/lib/mask-preview';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled, setPeopleEnabled] = useState(true);
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [activeMask, setActiveMask] = useState<Region | null>(null);
  const [brushActive, setBrushActive] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<'person' | 'background' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
  const [brushSize, setBrushSize] = useState([50]);
  const [brushSoftness, setBrushSoftness] = useState([20]);
  const [brushOpacity, setBrushOpacity] = useState([70]);

  // New Drawing Mode State
  const [drawingTool, setDrawingTool] = useState<'linear-gradient' | 'radial-gradient' | null>(null);

  const showMaskImage = !!image?.regions.some(r => r.selected);

  const handleCreateManualMask = () => {
    if (!image) return;

    // Use image dimensions if available, else default
    const width = image.width ?? 640;
    const height = image.height ?? 640;
    const maskData = new Uint8Array(width * height);

    const newMask: Region = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      type: 'manual',
      label: 'My Mask',
      maskData,
      maskWidth: width,
      maskHeight: height,
      color: REGION_COLORS.manual,
      visible: true,
      selected: true,
      hovered: false,
      hasEdits: true, // Manual masks always listed
      previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
    };

    setImage(prev =>
      prev ? { ...prev, regions: [...prev.regions, newMask] } : prev
    );

    setActiveMask(newMask);
    setBrushActive(true);
    setBrushMode('add'); // Default to add
  };

  const handleApplyEdits = () => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;

      const selectedRegions = prev.regions.filter(r => r.selected);

      // Grouping Logic:
      // 1. If any selected region is already in a group, we merge ALL selected regions into that group.
      //    (If multiple groups are involved, we pick the first one we encounter - "merging groups")
      // 2. If no group involved, but multiple items selected, create NEW group.
      // 3. If single item selected and no group, keep as is (or if it was in a group, it stays in it).

      const existingGroup = selectedRegions.find(r => r.groupId)?.groupId;

      let targetGroupId: string | undefined = existingGroup;

      if (!targetGroupId && selectedRegions.length > 1) {
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      }

      const newRegions = prev.regions.map(r => {
        if (r.selected) {
          const previewUrl = r.previewUrl || generateMaskPreview(r.maskData, r.maskWidth, r.maskHeight, r.color);
          // If we have a target group, enforce it. 
          // If we DON'T have a target group (single item, never grouped), keep existing groupId (undefined or whatever it was if we didn't want to ungroup).
          // Wait, if I select a grouped item and click edit, it should stay in group. 
          // This logic holds because `targetGroupId` will pick it up.
          // What if I select a grouped item AND an ungrouped item? `targetGroupId` will be the group. Both become grouped. Correct.
          return { ...r, hasEdits: true, previewUrl, groupId: targetGroupId !== undefined ? targetGroupId : r.groupId };
        }
        return r;
      });
      return { ...prev, regions: newRegions };
    });
  };

  const handleSelectBatchRegions = (ids: string[], multi: boolean) => {
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
  };

  const handleMoveRegion = (id: string, targetGroupId: string | undefined) => {
    if (!image) return;
    setImage({
      ...image,
      regions: image.regions.map(r => r.id === id ? { ...r, groupId: targetGroupId } : r)
    });
  };

  const handleEditManualMask = (regionId: string) => {
    if (!image) return;
    const region = image.regions.find(r => r.id === regionId);
    if (region && region.type === 'manual') {
      setActiveMask(region);
      setBrushActive(true);
      setBrushMode('add');
    }
  };

  const handleFileDrop = useCallback((file: File) => {
    const imageUrl = URL.createObjectURL(file);

    setImage({
      id: 'single-image',
      file,
      imageUrl,
      isProcessing: true,
      regions: [],
      selectedRegionId: null,
    });
  }, []);

  // Handle Delete Key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && image) {
        // Prevent deleting if typing in an input
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }

        setImage(prev => {
          if (!prev) return prev;

          // 1. Identify masks to HARD delete (Manual/Gradient)
          const manualToDelete = prev.regions.filter(r =>
            (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.selected
          );

          // 2. Identify masks to SOFT delete/reset (AI Masks)
          const aiToReset = prev.regions.filter(r =>
            (r.type === 'person' || r.type === 'background' || r.type === 'people-group') && r.selected
          );

          if (manualToDelete.length === 0 && aiToReset.length === 0) return prev;

          // 3. Clear Active Mask if it's being deleted/reset
          const allAffected = [...manualToDelete, ...aiToReset];
          if (activeMask && allAffected.some(r => r.id === activeMask.id)) {
            setActiveMask(null);
            setBrushActive(false);
          }

          // 4. Construct new state
          // A. Filter out manual masks
          let newRegions = prev.regions.filter(r => !manualToDelete.some(del => del.id === r.id));

          // B. Reset AI masks
          newRegions = newRegions.map(r => {
            if (aiToReset.some(reset => reset.id === r.id)) {
              return {
                ...r,
                hasEdits: false,
                selected: false,
                visible: true // Reset visibility too
              };
            }
            return r;
          });

          return {
            ...prev,
            regions: newRegions
          };
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [image, activeMask]);

  const selectRegionByType = (
    type: 'person' | 'background' | null,
    edit = false
  ) => {
    if (!type || !image) return;

    if (edit) {
      const region = image.regions.find(r => r.type === type);
      if (!region) return;

      // ✅ CLEAR ALL SELECTIONS
      setImage(prev =>
        prev
          ? {
            ...prev,
            regions: prev.regions.map(r => ({
              ...r,
              selected: false,
            })),
          }
          : prev
      );

      // ✅ ENTER EDIT MODE
      setActiveMask(region);
      setBrushActive(true);
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

  const handleResetMasks = () => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        regions: prev.regions.map(r => {
          // Only reset selected regions that have original data
          if (r.selected && r.originalMaskData) {
            return {
              ...r,
              maskData: new Uint8Array(r.originalMaskData),
            };
          }
          return r;
        }),
      };
    });
  };

  const handleCreateLinearGradient = () => {
    if (!image) return;
    setDrawingTool('linear-gradient');
    // Clear selections while drawing
    setImage(prev => prev ? {
      ...prev,
      regions: prev.regions.map(r => ({ ...r, selected: false }))
    } : prev);
    setBrushActive(false);
  };

  const handleCreateRadialGradient = () => {
    if (!image) return;
    setDrawingTool('radial-gradient');
    // Clear selections while drawing
    setImage(prev => prev ? {
      ...prev,
      regions: prev.regions.map(r => ({ ...r, selected: false }))
    } : prev);
    setBrushActive(false);
  };

  // Callback when user finishes dragging to create gradient
  const handleDrawComplete = (start: { x: number, y: number }, end: { x: number, y: number }) => {
    if (!image) return;
    const tool = drawingTool;
    setDrawingTool(null);

    const width = image.width ?? 640;
    const height = image.height ?? 640;

    if (tool === 'radial-gradient') {
      // Create Radial Gradient Region (Elliptical)
      const normCenter = start;
      const radiusX = Math.abs(end.x - start.x);
      const radiusY = Math.abs(end.y - start.y);

      // Width/Height helper
      const rX_px = radiusX * width;
      const rY_px = radiusY * height;

      // Minimum size check (5px)
      if (rX_px < 5 || rY_px < 5) {
        setDrawingTool(null);
        return;
      }

      // Generate Mask
      const maskData = generateRadialGradientMask(
        width,
        height,
        normCenter,
        { x: radiusX, y: radiusY },
        0.5, // Default Feather
        false // Not inverted
      );

      const newMask: Region = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        type: 'radial-gradient',
        label: 'Radial Gradient',
        maskData,
        maskWidth: width,
        maskHeight: height,
        color: REGION_COLORS.manual,
        radialGradient: {
          center: normCenter,
          radius: { x: radiusX, y: radiusY },
          feather: 0.5,
          invert: false
        },
        visible: true,
        selected: true,
        hovered: false,
        hasEdits: true,
        previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
      };

      setImage(prev =>
        prev ? { ...prev, regions: [...prev.regions, newMask] } : prev
      );
      setActiveMask(newMask);
      return;
    }

    // Linear Logic (Existing)
    if (tool === 'linear-gradient') {
      const p1_px = { x: start.x * width, y: start.y * height };
      const p2_px = { x: end.x * width, y: end.y * height };

      const c_px = { x: (p1_px.x + p2_px.x) / 2, y: (p1_px.y + p2_px.y) / 2 };

      const dx = p2_px.x - p1_px.x;
      const dy = p2_px.y - p1_px.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      // Default fallback if drag is too small (just a click?)
      let perp_px = { x: 0, y: -1 }; // Vertical Up
      if (len > 1) {
        const u_px = { x: dx / len, y: dy / len };
        perp_px = { x: -u_px.y, y: u_px.x }; // Visual Perpendicular (Rotate -90)
      }

      // Default Spread (Distance from Center to 100% or 0%)
      // Total spread = 2 * SPREAD_PX
      const SPREAD_PX = Math.min(width, height) * 0.25;

      const start_px = {
        x: c_px.x - perp_px.x * SPREAD_PX,
        y: c_px.y - perp_px.y * SPREAD_PX
      };
      const end_px = {
        x: c_px.x + perp_px.x * SPREAD_PX,
        y: c_px.y + perp_px.y * SPREAD_PX
      };

      // 2. Normalize back for storage/generation
      const normStart = { x: start_px.x / width, y: start_px.y / height };
      const normEnd = { x: end_px.x / width, y: end_px.y / height };

      // Generate mask data
      const maskData = new Uint8Array(width * height);

      // Re-calc vector in pixels for generation
      const vPx = end_px.x - start_px.x;
      const vPy = end_px.y - start_px.y;
      const m2 = vPx * vPx + vPy * vPy;

      const mx_start = start_px.x;
      const my_start = start_px.y;

      if (m2 > 0.0001) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const px = x - mx_start;
            const py = y - my_start;
            const u = (px * vPx + py * vPy) / m2;
            let alpha = 0;
            if (u <= 0) alpha = 255;
            else if (u >= 1) alpha = 0;
            else alpha = Math.round((1 - u) * 255);
            if (alpha > 0) maskData[y * width + x] = alpha;
          }
        }
      }

      const newMask: Region = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        type: 'linear-gradient',
        label: 'Linear Gradient',
        maskData,
        maskWidth: width,
        maskHeight: height,
        color: REGION_COLORS.manual,
        gradient: { start: normStart, end: normEnd },
        visible: true,
        selected: true,
        hovered: false,
        hasEdits: true,
        previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
      };

      setImage(prev =>
        prev ? { ...prev, regions: [...prev.regions, newMask] } : prev
      );
      setActiveMask(newMask);
    }
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

              {/* Draggable Toolbar */}
              {image && image.regions.some(r => r.selected && r.type !== 'linear-gradient' && r.type !== 'radial-gradient') && (
                <DraggableToolbar
                  containerRef={containerRef}
                  activeId={brushActive ? (brushMode === 'erase' ? 'eraser' : 'brush') : 'move'}
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
                <ImageTile
                  tile={image}
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
                    setImage(prev => (prev ? { ...prev, ...updates } : prev));
                  }}
                  onActivateBrush={handleEditManualMask}
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
                setImage({ ...image, regions: newRegions });

                // Also set active mask if it's a manual/gradient type
                const selected = newRegions.find(r => r.id === id);
                if (selected && (selected.type === 'manual' || selected.type === 'linear-gradient' || selected.type === 'radial-gradient')) {
                  setActiveMask(selected);
                }
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

                const isManual = region.type === 'manual' || region.type === 'linear-gradient' || region.type === 'radial-gradient';

                setImage(prev => {
                  if (!prev) return prev;
                  let newRegions: Region[];

                  if (isManual) {
                    // Hard Delete
                    newRegions = prev.regions.filter(r => r.id !== id);
                  } else {
                    // Soft Delete (Reset)
                    newRegions = prev.regions.map(r => r.id === id ? { ...r, hasEdits: false, selected: false, visible: true } : r);
                  }

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
            />
          </div>
        </div>
      )}
    </div>
  );
}