import { useState, useMemo, useRef } from 'react';
import { SliderPanelContent } from './SliderPanelContent';
import { generateMaskPreview } from '@/lib/mask-preview';
import {
  SlidersHorizontal, Crop, ChevronDown, ChevronRight, Plus, PlusCircle,
  Brush,
  Eye,
  EyeOff,
  Trash2,
  Layers,
  Contrast, // Use Contrast icon for Invert
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import type { Region, RegionAdjustments } from '@/types/workspace';

interface SliderPanelProps {
  isOpen?: boolean;
  onToggle?: () => void;
  regions: Region[];
  onSelectRegion: (id: string, multi: boolean) => void;
  onToggleVisibility: (id: string) => void;
  onToggleBatchVisibility: (ids: string[], visible: boolean) => void;
  onDeleteRegion: (id: string) => void;
  onCreateManualMask: () => void;
  onCreateLinearGradient?: () => void;
  onCreateRadialGradient?: () => void;
  onInvertMask?: (id?: string) => void;
  onApplyEdits?: () => void;
  onSelectBatchRegions?: (ids: string[], multi: boolean, activeId?: string) => void;
  onMoveRegion?: (id: string, targetGroupId: string | undefined, targetIndex?: number) => void;
  onDeleteGroup?: (groupId: string) => void;
  // New Prop for Activation (Double Click)
  onActivateRegion?: (id: string) => void;
  showMaskImage: boolean;
  onUpdateAdjustments?: (adjustments: RegionAdjustments) => void;
  /** Called when a gradient is dropped onto a target mask/group to intersect with it */
  onIntersectGradient?: (gradientId: string, targetId: string) => void;
  /** Whether canvas drawing interactions (gradient creation) are enabled */
  canvasInteractionsEnabled?: boolean;
  onToggleCanvasInteractions?: () => void;
}

export function SliderPanel({
  isOpen = true,
  onToggle,
  regions,
  onSelectRegion,
  onToggleVisibility,
  onToggleBatchVisibility,
  onDeleteRegion,
  showMaskImage,
  onCreateManualMask,
  onCreateLinearGradient,
  onCreateRadialGradient,
  onInvertMask,
  onApplyEdits,
  onSelectBatchRegions,
  onMoveRegion,
  onDeleteGroup,
  onActivateRegion,
  onUpdateAdjustments,
  onIntersectGradient,
  canvasInteractionsEnabled = true,
  onToggleCanvasInteractions,
}: SliderPanelProps) {
  const [activeTab, setActiveTab] = useState<'sliders' | 'crop' | 'masking'>('masking');
  const [showAddMaskMenu, setShowAddMaskMenu] = useState(false);

  // Group expansion states
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'smart-selections': true,
    'masks': true,
  });

  // Drag & Drop State — must live before the early return to satisfy Rules of Hooks
  const [dropTarget, setDropTarget] = useState<{ id: string | null; position: 'top' | 'bottom' | 'inside' | null }>({ id: null, position: null });
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // ── Intersect Drag State ──────────────────────────────────────────────────
  const [intersectTarget, setIntersectTarget] = useState<string | null>(null);
  const [intersectHoverTarget, setIntersectHoverTarget] = useState<string | null>(null);
  const [draggingGradientId, setDraggingGradientId] = useState<string | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const intersectHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INTERSECT_HOLD_MS = 800;

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!isOpen) return null;

  // UNIFIED LIST LOGIC
  // 1. Filter regions: Show masks with edits OR default system masks (Background/People Group) - UNLESS hasEdits is explicitly false (deleted)
  const editedRegions = regions.filter(r => {
    // Standard masks: Must have edits
    if (r.type !== 'people-group' && r.type !== 'background') return r.hasEdits;

    // Default masks: Show if hasEdits is true OR undefined. Hide if explicitly false (Soft Deleted).
    return r.hasEdits !== false;
  });

  // 2. Build Render List respecting original order
  // We want groups to appear at the position of their FIRST member.
  // Clip children (gradients with clipParentId) are excluded from the root list
  // and rendered inline under their parent mask instead.
  const topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[] = [];
  const processedGroupIds = new Set<string>();

  // Pre-group regions for checks
  const regionsByGroup: Record<string, Region[]> = {};
  editedRegions.forEach(r => {
    // Exclude clip children from group membership (they exclusively belong to their parent)
    if (r.clipParentId) return;

    if (r.groupId) {
      if (!regionsByGroup[r.groupId]) regionsByGroup[r.groupId] = [];
      regionsByGroup[r.groupId].push(r);
    }
  });

  // Build map: parentId -> clip-children (gradients clipped to that mask)
  const clipChildrenByParent: Record<string, Region[]> = {};
  editedRegions.forEach(r => {
    if (r.clipParentId) {
      if (!clipChildrenByParent[r.clipParentId]) clipChildrenByParent[r.clipParentId] = [];
      clipChildrenByParent[r.clipParentId].push(r);
    }
  });

  editedRegions.forEach(r => {
    // Exclude clip-children from root list — they appear under their parent
    if (r.clipParentId) return;

    if (r.groupId) {
      // It's in a group
      if (!processedGroupIds.has(r.groupId)) {
        // First time encountering this group -> Render the Whole Group here
        processedGroupIds.add(r.groupId);
        topLevelItems.push({
          type: 'group',
          id: r.groupId,
          regions: regionsByGroup[r.groupId] || []
        });
      }
    } else {
      // Root Item
      topLevelItems.push(r);
    }
  });

  // Which group (if any) the currently-dragged item originally belongs to.
  // Used to show the "remove from group" escape zone above that group header.
  const draggingItemSourceGroupId = draggingItemId
    ? editedRegions.find(r => r.id === draggingItemId)?.groupId
    : undefined;

  const clearIntersectHold = () => {
    if (intersectHoldTimerRef.current) {
      clearTimeout(intersectHoldTimerRef.current);
      intersectHoldTimerRef.current = null;
    }
  };

  const clearAllIntersect = () => {
    clearIntersectHold();
    setIntersectTarget(null);
    setIntersectHoverTarget(null);
  };

  // Helper for DnD
  const handleDragStart = (e: React.DragEvent, id: string, regionType?: string) => {
    e.dataTransfer.setData('text/plain', id);
    setDraggingItemId(id);
    // Tag gradient drags so drop targets know what's coming
    if (regionType === 'linear-gradient' || regionType === 'radial-gradient') {
      e.dataTransfer.setData('gradient-intersect', id);
      setDraggingGradientId(id);
    } else {
      setDraggingGradientId(null);
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetGroupId: string | undefined, targetIndex?: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) {
      // If no targetIndex is provided, we default to the end? 
      // Or handle logic in Workspace. 
      onMoveRegion?.(id, targetGroupId, targetIndex);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Flatten items for Shift-Select range calculation
  const getVisibleItems = () => {
    const items: string[] = [];
    topLevelItems.forEach(item => {
      if ('type' in item && item.type === 'group') {
        items.push(item.id); // Group Header
        if (expandedGroups[item.id]) {
          item.regions.forEach(r => items.push(r.id));
        }
      } else {
        items.push((item as Region).id);
      }
    });
    return items;
  };

  const handleSelectRegion = (id: string, multi: boolean, shift: boolean) => {
    setLastSelectedId(id);

    if (shift && lastSelectedId) {
      // Find range
      const visibleItems = getVisibleItems();
      const lastIdx = visibleItems.indexOf(lastSelectedId);
      const currIdx = visibleItems.indexOf(id);

      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeIds = visibleItems.slice(start, end + 1);

        // Filter out groups from selection if we only select regions
        const regionsToSelect = rangeIds.filter(rid =>
          !topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === rid)
        );

        onSelectBatchRegions?.(regionsToSelect, multi, id);
        return;
      }
    }

    onSelectRegion(id, multi);
  };

  const handleDragOverItem = (e: React.DragEvent, id: string, isGroup: boolean, targetRegionType?: string) => {
    e.preventDefault();
    e.stopPropagation();

    const isGradientDrag = !!draggingGradientId;

    // A gradient that already has a clipParentId is being moved/repositioned —
    // dragging it over a GROUP header should only reorder, never re-clip.
    // A FREE gradient (no clipParentId) can still trigger the amber hold timer on
    // a group header to clip it to the whole group (additive operation).
    const draggingGradientIsClipped = !!editedRegions.find(r => r.id === draggingGradientId)?.clipParentId;

    const isValidIntersectTarget = isGradientDrag &&
      !(isGroup && draggingGradientIsClipped) &&
      targetRegionType &&
      targetRegionType !== 'linear-gradient' &&
      targetRegionType !== 'radial-gradient';

    if (isValidIntersectTarget) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = rect.height;
      // Outer 30% of the row = plain reorder (top/bottom insertion line).
      // Centre 40% = intersect/group zone with hold timer.
      const edgeThreshold = h * 0.3;

      if (y < edgeThreshold || y > h - edgeThreshold) {
        // Reorder zone — treat gradient like any other item, no intersect UI
        clearAllIntersect();
        setDropTarget({ id, position: y < h / 2 ? 'top' : 'bottom' });
        return;
      }

      // Centre zone: start / continue intersect hold timer
      setDropTarget({ id, position: 'inside' });
      if (intersectHoverTarget !== id) {
        setIntersectHoverTarget(id);
        clearIntersectHold();
        setIntersectTarget(null);
        intersectHoldTimerRef.current = setTimeout(() => {
          setIntersectTarget(id);
        }, INTERSECT_HOLD_MS);
      }
      return;
    }

    // Normal DnD positioning — moved off a valid intersect target
    clearAllIntersect();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;

    if (isGroup) {
      // Group headers: 3 zones — top edge moves before group, center adds to group, bottom edge moves after
      const edgeThreshold = height * 0.3;
      if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
      else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
      else setDropTarget({ id, position: 'inside' });
    } else {
      // Individual items: simple 50/50 split — top half = insert before, bottom half = insert after.
      // No accidental grouping; to add to a group drag onto the group header instead.
      setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
    }
  };

  const handleDragLeave = () => {
    setDropTarget({ id: null, position: null });
    clearAllIntersect();
  };

  // Called when the drag ends globally (so we can reset dragging gradient state)
  const handleGlobalDragEnd = () => {
    setDraggingGradientId(null);
    setDraggingItemId(null);
    clearAllIntersect();
    setDropTarget({ id: null, position: null });
  };

  const handleDropItem = (e: React.DragEvent, targetId: string, targetRegionType?: string) => {
    e.preventDefault();
    e.stopPropagation();

    clearIntersectHold();
    setDraggingGradientId(null);
    setDraggingItemId(null);
    setIntersectHoverTarget(null);

    const gradId = e.dataTransfer.getData('gradient-intersect');
    const isValidTarget = targetRegionType &&
      targetRegionType !== 'linear-gradient' &&
      targetRegionType !== 'radial-gradient';

    // Only intercept gradient drags that landed in the centre (intersect/group) zone.
    // top/bottom drops fall through to the normal reorder path below.
    if (gradId && isValidTarget && dropTarget.position === 'inside') {
      if (intersectTarget === targetId) {
        // ── AMBER phase: CLIP the gradient to this mask ──────────────────────
        onIntersectGradient?.(gradId, targetId);
      } else {
        // ── BLUE phase: GROUP the gradient with this mask ─────────────────
        handleDrop(e, targetId);
      }

      setIntersectTarget(null);
      setDropTarget({ id: null, position: null });
      return;
    }

    setIntersectTarget(null);

    const { position } = dropTarget;
    setDropTarget({ id: null, position: null });

    if (!position) return;

    if (position === 'inside') {
      // Grouping behavior requires no index, just ID
      handleDrop(e, targetId);
    } else {
      // Moving next to an item
      // We need to find the *index* of the target item in the *Original Regions List*?
      // Or in the `topLevelItems` list?

      // `Workspace` deals with the `regions` array.
      // So we should try to find the index in `regions`. 
      // BUT `SliderPanel` doesn't know the full `regions` array index easily if filtering happens.
      // However, `editedRegions` is our list.

      // Let's find index in `editedRegions` (which reflects the visual order we want).
      // If we move Item A before Item B, we want A's index to become B's index.

      // Let's find the target item in `editedRegions`.
      // NOTE: `targetId` could be a GroupID (if we dropped on a header).
      // If dropping on Group Header 'top', we want to insert before the group's first item.

      let targetIndex = -1;

      // Function to get absolute index of an item or start of a group in `editedRegions`
      const getIndexInList = (tid: string): number => {
        return editedRegions.findIndex(r => r.id === tid || r.groupId === tid);
      };

      targetIndex = getIndexInList(targetId);

      if (targetIndex !== -1) {
        // Adjust for bottom drop
        if (position === 'bottom') {
          // If it's a group, we need to skip *all* its members to find the "after" index.
          const targetIsGroup = topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === targetId);
          if (targetIsGroup) {
            // Find the last member of this group in editedRegions
            // simpler: find index of next item in topLevelItems?
            // Or just add 1 to index of *last member*.
            const groupMembers = editedRegions.filter(r => r.groupId === targetId);
            targetIndex += groupMembers.length;
          } else {
            targetIndex += 1;
          }
        }
      }

      // Use logic to determine Parent Group
      const targetIsGroupHeader = topLevelItems.some(i => 'type' in i && i.type === 'group' && i.id === targetId);
      let newGroupId: string | undefined;

      if (targetIsGroupHeader) {
        // If we drop *next* to a group header (top/bottom), we are effectively moving to Root (or parent group).
        newGroupId = undefined; // Assuming headers are top-level
      } else {
        // Dropped next to a region. Use its group ID.
        const region = editedRegions.find(r => r.id === targetId);
        newGroupId = region?.groupId;
      }

      handleDrop(e, newGroupId, targetIndex);
    }
  };

  // Global index for striping across groups
  let globalIndex = 0;

  return (
    <>
      {/* Overlay gradient at bottom */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-[344px] z-30">
        <div className="h-20 bg-gradient-to-t from-[#1C1C1C] to-transparent" />
      </div>

      {/* Panel - Full height overlay on right */}
      <div className="absolute right-0 top-0 z-40 flex h-full w-[344px] flex-col gap-0 overflow-y-auto bg-[#1C1C1C]/95 pt-3 pb-0 shadow-2xl backdrop-blur-[120px]">
        {/* Tab Selector */}
        <div className="flex items-end w-full gap-3 px-4 mb-[18px]">
          {/* SLIDERS TAB */}
          <button
            onClick={() => setActiveTab('sliders')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'sliders' ? 'text-white' : 'text-[#777777]'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Sliders
            </span>
            {activeTab === 'sliders' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>

          {/* CROP TAB */}
          <button
            onClick={() => setActiveTab('crop')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'crop' ? 'text-white' : 'text-[#777777]'}`}
          >
            <Crop className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Crop
            </span>
            {activeTab === 'crop' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>

          {/* MASKING TAB */}
          <button
            onClick={() => setActiveTab('masking')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'masking' ? 'text-[#E2E2E2]' : 'text-[#777777]'}`}
          >
            {/* Mask Icon - 16x16 with dashed border pattern */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" fillOpacity="0.1" />
              <rect x="2.5" y="2.5" width="11" height="11" rx="0.5" stroke="currentColor" strokeDasharray="1 2" />
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Masking
            </span>
            {activeTab === 'masking' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>
        </div>

        {/* Line 237 - Divider */}
        <div className="h-[1px] w-[344px] bg-[#111111]" />

        {/* Masks Header */}
        <div className="relative flex w-full items-center justify-between py-4 px-4">
          <h2 className="text-[14px] font-semibold leading-[20px] text-[#E2E2E2]" style={{ fontFamily: 'Google Sans, sans-serif' }}>Masks</h2>

          <div className="flex items-center gap-3">
            {/* Canvas Interactions Toggle */}
            <button
              onClick={onToggleCanvasInteractions}
              className={`flex items-center justify-center transition-colors ${canvasInteractionsEnabled ? 'text-white hover:opacity-80' : 'text-[#484848] hover:text-[#666666]'}`}
              aria-label={canvasInteractionsEnabled ? 'Disable canvas interactions' : 'Enable canvas interactions'}
              title={canvasInteractionsEnabled ? 'Canvas interactions on' : 'Canvas interactions off'}
            >
              {canvasInteractionsEnabled
                ? <ToggleRight className="h-[22px] w-[22px]" />
                : <ToggleLeft className="h-[22px] w-[22px]" />
              }
            </button>

            {/* Add mask */}
            <button
              onClick={() => setShowAddMaskMenu(v => !v)}
              className="flex h-4 w-4 items-center justify-center text-white hover:opacity-80"
              aria-label="Add mask"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>

          {showAddMaskMenu && (
            <div className="absolute right-4 top-8 z-50 w-[132px] rounded-lg bg-[#242424] p-1 shadow-xl border border-[#5E5E5E] mt-2">
              {/* Brush */}
              <button
                onClick={() => {
                  onCreateManualMask();
                  setShowAddMaskMenu(false);
                }}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <Brush className="h-3 w-3 text-white" />
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">
                  Brush
                </span>
              </button>

              {/* Object */}
              <button
                onClick={() => setShowAddMaskMenu(false)}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                  <rect x="0.5" y="0.5" width="6" height="6" rx="0.5" stroke="currentColor" />
                  <rect x="9.5" y="0.5" width="6" height="6" rx="0.5" stroke="currentColor" />
                  <rect x="0.5" y="9.5" width="6" height="6" rx="0.5" stroke="currentColor" />
                  <rect x="9.5" y="9.5" width="6" height="6" rx="0.5" stroke="currentColor" />
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Object</span>
              </button>

              {/* Linear Gradient */}
              <button
                onClick={() => {
                  onCreateLinearGradient?.();
                  setShowAddMaskMenu(false);
                }}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" stroke="#ABABAB" />
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Linear Gradient</span>
              </button>

              {/* Radial Gradient */}
              <button
                onClick={() => {
                  onCreateRadialGradient?.();
                  setShowAddMaskMenu(false);
                }}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6" cy="6" r="4.5" stroke="#ABABAB" />
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Radial Gradient</span>
              </button>
            </div>
          )}
        </div>

        {/* OUTLINER CONTENT - Inset to match Figma */}
        <div className="flex flex-col w-full px-4"
          onDragOver={(e) => {
            e.preventDefault();
            // If dragging over empty space, show "Move to Root" intent?
            // Maybe just clear specific target
            // setDropTarget({ id: 'root', position: 'inside' }); // Could visualize panel border
          }}
          onDrop={(e) => {
            // Drop on empty space = root, append to end
            e.stopPropagation();
            setDraggingItemId(null);
            setDraggingGradientId(null);
            clearAllIntersect();
            setDropTarget({ id: null, position: null });
            handleDrop(e, undefined, editedRegions.length);
          }}
        >
          {/* UNIFIED LIST RENDERING */}
          <div className="flex flex-col w-full min-h-[50px]">
            {topLevelItems.length === 0 ? (
              <div className="px-5 py-2 text-[11px] text-[#555] italic">No active masks</div>
            ) : (
              topLevelItems.map((item) => {
                if ('type' in item && item.type === 'group') {
                  // RENDER GROUP
                  const groupRegions = item.regions;
                  const groupId = item.id;
                  const isExpanded = expandedGroups[groupId] !== false; // Default to TRUE (Expanded)
                  const isAllVisible = groupRegions.every(r => r.visible);
                  const isGroupSelected = groupRegions.length > 0 && groupRegions.every(r => r.selected);

                  // Consume index for the group header itself
                  const groupHeaderIndex = globalIndex++;
                  const isDropTarget = dropTarget.id === groupId;

                  return (
                    <div
                      key={groupId}
                      className="flex flex-col relative"
                    >
                      {/* ── ESCAPE ZONE: shown when dragging a member of THIS group ─── */}
                      {draggingItemSourceGroupId === groupId && (
                        <div
                          className={`flex items-center justify-center gap-1.5 h-7 mx-0.5 mb-0.5 rounded cursor-default select-none transition-colors ${dropTarget.id === `escape-${groupId}`
                              ? 'bg-blue-500/20 border border-blue-500/60'
                              : 'border border-dashed border-white/15'
                            }`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTarget({ id: `escape-${groupId}`, position: 'top' });
                          }}
                          onDragLeave={() => setDropTarget({ id: null, position: null })}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const id = e.dataTransfer.getData('text/plain');
                            if (id) {
                              const firstIdx = editedRegions.findIndex(r => r.groupId === groupId);
                              onMoveRegion?.(id, undefined, firstIdx >= 0 ? firstIdx : 0);
                            }
                            setDraggingItemId(null);
                            setDraggingGradientId(null);
                            clearAllIntersect();
                            setDropTarget({ id: null, position: null });
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                            className={dropTarget.id === `escape-${groupId}` ? 'text-blue-400' : 'text-white/25'}>
                            <path d="M5 7.5V2.5M5 2.5L2.5 5M5 2.5L7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className={`text-[10px] ${dropTarget.id === `escape-${groupId}` ? 'text-blue-400' : 'text-white/25'}`}>
                            Drop here to remove from group
                          </span>
                        </div>
                      )}

                      {/* Insertion Lines for Group */}
                      {isDropTarget && dropTarget.position === 'top' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                      )}

                      {/* ── INTERACTION STATES (Copied from OutlinerItem) ── */}

                      {/* 1. Full-row amber flash/wipe (Intersect Target) */}
                      {intersectTarget === groupId && (
                        <>
                          <div
                            className="absolute inset-0 pointer-events-none z-10"
                            style={{
                              background: 'linear-gradient(90deg, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0.3) 60%, transparent 100%)',
                              animation: 'intersect-wipe 0.4s cubic-bezier(0.22,1,0.36,1) forwards',
                            }}
                          />
                          <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20 bg-orange-400"
                            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
                          <div className="absolute inset-x-0 bottom-0 h-[2px] pointer-events-none z-20 bg-orange-400"
                            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
                        </>
                      )}

                      {/* 2. Blue hover tint (Group Phase) */}
                      {intersectHoverTarget === groupId && intersectTarget !== groupId && (
                        <div
                          className="absolute inset-0 pointer-events-none z-10"
                          style={{ background: 'rgba(59,130,246,0.10)' }}
                        />
                      )}

                      <div
                        className={`
                            group flex items-center justify-between
                            h-[35px] px-2 cursor-pointer select-none
                            transition-colors relative z-20
                            ${isGroupSelected ? 'bg-[#04395E] text-white' : (groupHeaderIndex % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]')}
                            ${!isGroupSelected && isDropTarget && dropTarget.position === 'inside' ? 'ring-2 ring-blue-500 ring-inset' : ''}
                            ${intersectTarget === groupId ? 'ring-2 ring-orange-400 ring-inset' : ''}
                            ${!isGroupSelected && 'hover:bg-[#353535]'}
                          `}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, groupId)}
                        onDragEnd={handleGlobalDragEnd}
                        onDragOver={(e) => handleDragOverItem(e, groupId, true, 'group')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDropItem(e, groupId, 'group')}
                        onClick={(e) => {
                          const multi = e.metaKey || e.ctrlKey;
                          const shift = e.shiftKey;

                          // Collect all IDs to select: Group members + Intersected Gradients
                          // Include clip children of the GROUP and of each individual member.
                          const memberIds = groupRegions.map(r => r.id);
                          const groupClipChildIds = (clipChildrenByParent[groupId] || []).map(c => c.id);
                          const memberClipChildIds = groupRegions.flatMap(r => (clipChildrenByParent[r.id] || []).map(c => c.id));
                          const allIdsToSelect = [...memberIds, ...groupClipChildIds, ...memberClipChildIds];

                          if (shift) {
                            onSelectBatchRegions?.(allIdsToSelect, true);
                          } else {
                            onSelectBatchRegions?.(allIdsToSelect, multi);
                          }
                          // SmartMaskLayer handles intersection rendering when the group is selected.
                          // No need to activate individual clip-child gradients here.
                        }}
                      >
                        {/* ... Header Content ... */}
                        <div className="flex items-center gap-2 overflow-hidden min-w-0">
                          {/* ... */}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(groupId);
                            }}
                            className="p-0.5 hover:bg-white/10 rounded"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3 text-[#ABABAB]" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-[#ABABAB]" />
                            )}
                          </button>

                          {/* Group Icon */}
                          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[#E2E2E2]">
                              <path d="M1.75 3.5C2 3.5 1.75 3.5 1.75 3.5H5.25L6.125 4.375H12.25V10.5H1.75V3.5Z" fill="currentColor" fillOpacity="0.8" stroke="currentColor" strokeWidth="1" />
                            </svg>
                          </div>
                          <span className="text-[13px] text-[#E2E2E2] truncate">Mask Group</span>

                          {/* CLIP COUNT BADGE — includes group-level + member-level clip children */}
                          {(() => {
                            const totalClipCount =
                              (clipChildrenByParent[groupId] || []).length +
                              groupRegions.reduce((sum, r) => sum + (clipChildrenByParent[r.id] || []).length, 0);
                            return totalClipCount > 0 ? (
                              <span
                                className="flex-shrink-0 ml-0.5 text-[9px] font-bold px-1 py-0 rounded-full leading-4"
                                style={{ background: 'rgba(251,146,60,0.25)', color: 'rgba(251,146,60,0.9)', border: '1px solid rgba(251,146,60,0.35)' }}
                              >
                                {totalClipCount}
                              </span>
                            ) : null;
                          })()}
                        </div>

                        {/* HOVER BADGES */}
                        {intersectHoverTarget === groupId && intersectTarget !== groupId && (
                          <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                            style={{ animation: 'intersect-badge-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
                          >
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                              style={{ background: 'rgba(59,130,246,0.85)', backdropFilter: 'blur(4px)' }}>
                              <span className="text-[11px] font-bold text-white tracking-wide">Add to Group</span>
                            </div>
                          </div>
                        )}

                        {intersectTarget === groupId && (
                          <div
                            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                            style={{ animation: 'intersect-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
                          >
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                              style={{ background: 'rgba(251,146,60,0.9)', backdropFilter: 'blur(4px)' }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-white">
                                <path d="M3 10V5.5C3 3.567 4.567 2 6.5 2H7.5C9.433 2 11 3.567 11 5.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <line x1="2" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              </svg>
                              <span className="text-[11px] font-bold text-white tracking-wide">Clip to Mask</span>
                            </div>
                          </div>
                        )}

                        {/* Normal Controls */}
                        {!intersectTarget && !intersectHoverTarget && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onInvertMask?.(groupId);
                              }}
                              className="p-1 text-[#ABABAB] hover:text-white transition-colors"
                              title="Invert Group"
                            >
                              <Contrast className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // Delete Group Icon - Updated to Grey
                                onDeleteGroup?.(groupId);
                              }}
                              className="p-1 text-[#ABABAB] hover:text-white transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleBatchVisibility(groupRegions.map(r => r.id), !isAllVisible);
                              }}
                              className={`p-1 hover:text-white ${!isAllVisible ? 'text-white/40' : 'text-[#ABABAB]'}`}
                            >
                              {isAllVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Group Children */}
                      {
                        isExpanded && (
                          <div className="flex flex-col">
                            {/* Standard Group Members */}
                            {groupRegions.map((region) => {
                              const itemIndex = globalIndex++;
                              const memberClipKids = clipChildrenByParent[region.id] || [];
                              // Expansion state mirrors standalone items — default expanded
                              const memberItemId = `single-${region.id}`;
                              const isMemberExpanded = expandedGroups[memberItemId] !== false;
                              return (
                                <div key={region.id} className="relative">
                                  {/* Insertion Lines logic for children */}
                                  {dropTarget.id === region.id && dropTarget.position === 'top' && (
                                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                                  )}

                                  <OutlinerItem
                                    region={region}
                                    index={itemIndex}
                                    onSelect={(multi, shift) => {
                                      // Mirror standalone: select member + all its clip children together
                                      const allIds = [region.id, ...memberClipKids.map(c => c.id)];
                                      if (shift) {
                                        onSelectBatchRegions?.(allIds, true);
                                      } else {
                                        onSelectBatchRegions?.(allIds, multi, region.id);
                                      }
                                    }}
                                    onActivate={() => onActivateRegion?.(region.id)}
                                    onToggleVis={() => onToggleVisibility(region.id)}
                                    onDelete={() => onDeleteRegion(region.id)}
                                    onInvert={() => onInvertMask?.(region.id)}
                                    onDragStart={(e) => handleDragStart(e, region.id, region.type)}
                                    onDragEnd={handleGlobalDragEnd}
                                    onDragOver={(e) => handleDragOverItem(e, region.id, false, region.type)}
                                    onDrop={(e) => handleDropItem(e, region.id, region.type)}
                                    isChild={true}
                                    dropTarget={dropTarget.id === region.id ? dropTarget.position : null}
                                    isIntersectTarget={intersectTarget === region.id}
                                    isIntersectHover={intersectHoverTarget === region.id && intersectTarget !== region.id}
                                    isDraggingGradient={!!draggingGradientId}
                                    isDragSource={draggingItemId === region.id}
                                    dragIntent={draggingItemId === region.id ? (
                                      draggingGradientId
                                        ? (intersectTarget ? 'intersect' : intersectHoverTarget ? 'group' : null)
                                        : (dropTarget.position === 'inside' ? 'group' : null)
                                    ) : null}
                                    clipChildCount={memberClipKids.length}
                                    hasChildren={memberClipKids.length > 0}
                                    isExpanded={isMemberExpanded}
                                    onToggleExpand={() => toggleGroup(memberItemId)}
                                  />

                                  {/* Clip children — same tree structure as standalone, respects expand/collapse */}
                                  {isMemberExpanded && memberClipKids.length > 0 && (
                                    <div
                                      className="relative ml-6"
                                      style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.4)' }}
                                    >
                                      {memberClipKids.map((child) => {
                                        const childIndex = globalIndex++;
                                        return (
                                          <div key={child.id} className="relative flex items-center">
                                            <div
                                              className="absolute left-0 top-1/2 w-3.5 flex-shrink-0"
                                              style={{ height: '1px', background: 'rgba(251,146,60,0.4)' }}
                                            />
                                            <div className="flex-1 pl-3.5">
                                              <OutlinerItem
                                                region={child}
                                                index={childIndex}
                                                onSelect={(multi, shift) => {
                                                  handleSelectRegion(child.id, multi, shift!);
                                                  if (!multi && !shift) onActivateRegion?.(child.id);
                                                }}
                                                onActivate={() => onActivateRegion?.(child.id)}
                                                onToggleVis={() => onToggleVisibility(child.id)}
                                                onDelete={() => onDeleteRegion(child.id)}
                                                onDragStart={(e) => handleDragStart(e, child.id, child.type)}
                                                onDragEnd={handleGlobalDragEnd}
                                                onDragOver={(e) => handleDragOverItem(e, child.id, false, child.type)}
                                                onDrop={(e) => handleDropItem(e, child.id, child.type)}
                                                isClipChild={true}
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {dropTarget.id === region.id && dropTarget.position === 'bottom' && (
                                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )
                      }

                      {/* Intersected Gradients (Clip Children of the Group) — collapse with the group */}
                      {isExpanded && (clipChildrenByParent[groupId] || []).map((child) => {
                        const childIndex = globalIndex++;
                        return (
                          <div key={child.id} className="relative flex items-center pl-5">
                            {/* Elbow connector - slightly indented relative to group members */}
                            <div className="absolute left-[18px] top-0 bottom-0 w-[1px]"
                              style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.35)' }}
                            />
                            <div className="absolute left-[18px] top-1/2 w-3 h-px"
                              style={{ background: 'rgba(251,146,60,0.35)', top: '50%' }}
                            />

                            <div className="flex-1">
                              <OutlinerItem
                                region={child}
                                index={childIndex}
                                onSelect={(multi, shift) => {
                                  handleSelectRegion(child.id, multi, shift!);
                                  if (!multi && !shift) {
                                    onActivateRegion?.(child.id);
                                  }
                                }}
                                onActivate={() => onActivateRegion?.(child.id)}
                                onToggleVis={() => onToggleVisibility(child.id)}
                                onDelete={() => onDeleteRegion(child.id)}
                                onDragStart={(e) => handleDragStart(e, child.id, child.type)}
                                onDragEnd={handleGlobalDragEnd}
                                onDragOver={(e) => handleDragOverItem(e, child.id, false, child.type)}
                                onDrop={(e) => handleDropItem(e, child.id, child.type)}
                                isClipChild={true}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Insertion Line Bottom */}
                      {
                        isDropTarget && dropTarget.position === 'bottom' && (
                          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                        )
                      }
                    </div>
                  );
                } else {
                  // RENDER SINGLE ITEM
                  const region = item as Region;
                  const itemIndex = globalIndex++;
                  const isDropTarget = dropTarget.id === region.id;
                  const clipKids = clipChildrenByParent[region.id] || [];

                  // Use a unique ID for single-item expansion state (e.g. prefix 'single-')
                  const singleItemId = `single-${region.id}`;
                  const isSingleItemExpanded = expandedGroups[singleItemId] !== false; // Default expanded

                  return (
                    <div key={region.id} className="relative">
                      {isDropTarget && dropTarget.position === 'top' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                      )}

                      <OutlinerItem
                        region={region}
                        index={itemIndex}
                        onSelect={(multi, shift) => {
                          // Select Parent + All Clip Children
                          const allIds = [region.id, ...clipKids.map(c => c.id)];
                          if (shift) {
                            onSelectBatchRegions?.(allIds, true);
                          } else {
                            // Pass region.id as activeId so activeMask is synced (matches canvas single-click)
                            onSelectBatchRegions?.(allIds, multi, region.id);
                          }
                        }}
                        onActivate={() => onActivateRegion?.(region.id)}
                        onToggleVis={() => onToggleVisibility(region.id)}
                        onDelete={() => onDeleteRegion(region.id)}
                        onInvert={() => onInvertMask?.(region.id)}
                        onDragStart={(e) => handleDragStart(e, region.id, region.type)}
                        onDragEnd={handleGlobalDragEnd}
                        onDragOver={(e) => handleDragOverItem(e, region.id, false, region.type)}
                        onDrop={(e) => handleDropItem(e, region.id, region.type)}
                        dropTarget={isDropTarget ? dropTarget.position : null}
                        isIntersectTarget={intersectTarget === region.id}
                        isIntersectHover={intersectHoverTarget === region.id && intersectTarget !== region.id}
                        clipChildCount={clipKids.length}
                        isDraggingGradient={!!draggingGradientId}
                        isDragSource={draggingItemId === region.id}
                        dragIntent={draggingItemId === region.id ? (
                          draggingGradientId
                            ? (intersectTarget ? 'intersect' : intersectHoverTarget ? 'group' : null)
                            : (dropTarget.position === 'inside' ? 'group' : null)
                        ) : null}
                        hasChildren={clipKids.length > 0}
                        isExpanded={isSingleItemExpanded}
                        onToggleExpand={() => toggleGroup(singleItemId)}
                      />

                      {/* Render Clip Children (Intersected Gradients) for Single Item */}
                      {isSingleItemExpanded && clipKids.map((child, idx) => {
                        const childIndex = globalIndex++;
                        const isLastChild = idx === clipKids.length - 1;

                        return (
                          <div key={child.id} className="relative flex items-center pl-5">
                            {/* Vertical Line Segment */}
                            {/* If last child, stop at 50% (Elbow). If not, go full height (T-junction or continuous) */}
                            <div
                              className="absolute left-[8px] top-0 w-[1px]"
                              style={{
                                height: isLastChild ? '50%' : '100%',
                                borderLeft: '1.5px dashed rgba(251,146,60,0.35)'
                              }}
                            />
                            {/* Horizontal Line Segment */}
                            <div className="absolute left-[8px] top-1/2 w-3 h-px"
                              style={{ background: 'rgba(251,146,60,0.35)', top: '50%' }}
                            />

                            <div className="flex-1">
                              <OutlinerItem
                                region={child}
                                index={childIndex}
                                onSelect={(multi, shift) => {
                                  handleSelectRegion(child.id, multi, shift!);
                                  if (!multi && !shift) {
                                    onActivateRegion?.(child.id);
                                  }
                                }}
                                onActivate={() => onActivateRegion?.(child.id)}
                                onToggleVis={() => onToggleVisibility(child.id)}
                                onDelete={() => onDeleteRegion(child.id)}
                                onDragStart={(e) => handleDragStart(e, child.id, child.type)}
                                onDragEnd={handleGlobalDragEnd}
                                onDragOver={(e) => handleDragOverItem(e, child.id, false, child.type)}
                                onDrop={(e) => handleDropItem(e, child.id, child.type)}
                                isClipChild={true}
                              />
                            </div>
                          </div>
                        );
                      })}


                      {isDropTarget && dropTarget.position === 'bottom' && (
                        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                      )}
                    </div>
                  );
                }

              })
            )}
          </div>
        </div>


        {showMaskImage && (
          <div className="mt-4 pb-10">
            <SliderPanelContent
              regions={regions.filter(r => r.selected)}
              onUpdateAdjustments={(adjustments) => onUpdateAdjustments?.(adjustments)}
              onApplyEdits={onApplyEdits}
            />
          </div>
        )}

        {/* Line 238 - Divider */}
        <div className="h-[1px] w-[344px] bg-[#111111]" />
      </div>
    </>
  );
}

// ----------------------------------------------------------------------
// SUB-COMPONENT: Outliner Item
// ----------------------------------------------------------------------

function OutlinerItem({
  region,
  index,
  onSelect,
  onActivate,
  onToggleVis,
  onDelete,
  onInvert,
  onDragStart,
  onDrop,
  isChild = false,
  onDragOver,
  dropTarget,
  onDragEnd,
  isIntersectTarget = false,
  isIntersectHover = false,
  isDraggingGradient = false,
  isDragSource = false,
  dragIntent = null,
  clipChildCount = 0,
  isClipChild = false,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
}: {
  region: Region;
  index: number;
  onSelect: (multi: boolean, shift?: boolean) => void;
  onActivate?: () => void;
  onToggleVis: () => void;
  onDelete?: () => void;
  onInvert?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isChild?: boolean;
  dropTarget?: 'top' | 'bottom' | 'inside' | null;
  /** True when this row is the active intersect drop target (gradient held over it) */
  isIntersectTarget?: boolean;
  /** True immediately when a gradient first enters this row (before the 600ms hold) */
  isIntersectHover?: boolean;
  /** True while ANY gradient is being dragged (suppresses group-ring hint) */
  isDraggingGradient?: boolean;
  /** True while this row is the item being dragged */
  isDragSource?: boolean;
  /** Current drag operation intent for the source item */
  dragIntent?: 'group' | 'intersect' | null;
  /** Number of clip-children attached to this mask row */
  clipChildCount?: number;
  /** True if this row is a gradient clipped to a parent mask */
  isClipChild?: boolean;
  /** If true, renders an expand/collapse toggle inside the item */
  hasChildren?: boolean;
  /** Current expansion state */
  isExpanded?: boolean;
  /** Toggle callback */
  onToggleExpand?: () => void;
}) {
  const Icon = getRegionIcon(region.type);

  const isGradientType = region.type === 'linear-gradient' || region.type === 'radial-gradient';
  // Show blue group ring when drop target is 'inside' — unless amber clip mode is committed
  const showGroupRing = dropTarget === 'inside' && !isIntersectTarget;

  // Memoised mask preview — must be at component top level (Rules of Hooks)
  const generatedPreview = useMemo(() => {
    if (!region.maskData || !region.maskWidth || !region.maskHeight) return null;
    return generateMaskPreview(region.maskData, region.maskWidth, region.maskHeight, region.color);
  }, [region.maskData, region.maskWidth, region.maskHeight, region.color]);

  return (
    <div
      className="relative overflow-hidden"
      style={{ isolation: 'isolate' }}
    >
      {/* ── Blue hover tint (Group Phase) ───────────────────────── */}
      {isIntersectHover && !isIntersectTarget && !isGradientType && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ background: 'rgba(59,130,246,0.10)' }}
        />
      )}

      {/* ── INTERSECT STATE: Full Amber Styling ─────────────────── */}
      {isIntersectTarget && !isGradientType && (
        <>
          {/* Full Amber Background Wash */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: 'linear-gradient(90deg, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0.3) 60%, transparent 100%)',
              animation: 'intersect-wipe 0.4s cubic-bezier(0.22,1,0.36,1) forwards',
            }}
          />
          {/* Pulsing borders */}
          <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20 bg-orange-400"
            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
          <div className="absolute inset-x-0 bottom-0 h-[2px] pointer-events-none z-20 bg-orange-400"
            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
        </>
      )}

      {/* ── Clip-child accent line ──────────────────────────────── */}
      {isClipChild && (
        <>
          {/* Subtle Left-to-Right Gradient for Clip Children */}
          <div
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background: 'linear-gradient(90deg, rgba(251,146,60,0.1) 0%, transparent 100%)',
            }}
          />
          <div className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none z-20 bg-orange-400/60" />
        </>
      )}

      {/* ── Drag Source intent overlay ─────────────────────────── */}
      {isDragSource && dragIntent === 'group' && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ background: 'rgba(59,130,246,0.15)', borderLeft: '2px solid rgba(59,130,246,0.7)' }}
        />
      )}
      {isDragSource && dragIntent === 'intersect' && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ background: 'rgba(251,146,60,0.15)', borderLeft: '2px solid rgba(251,146,60,0.7)' }}
        />
      )}

      <div
        draggable={!!onDragStart}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (onDragOver) { onDragOver(e); return; }
          if (onDrop) e.preventDefault();
        }}
        onDrop={onDrop}
        onClick={(e) => onSelect(e.metaKey || e.ctrlKey, e.shiftKey)}
        onDoubleClick={(e) => { e.stopPropagation(); onActivate?.(); }}
        className={`
          group flex items-center justify-between
          h-[35px] px-2 cursor-pointer select-none
          transition-colors relative z-20
          ${showGroupRing ? 'ring-2 ring-blue-500 ring-inset' : ''}
          ${isIntersectTarget && !isGradientType ? 'ring-2 ring-orange-400 ring-inset' : ''}
          ${region.selected ? 'bg-[#04395E] text-white' : index % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]'}
          ${!region.selected && !isIntersectTarget && 'hover:bg-[#353535] text-[#ABABAB]'}
          ${isChild ? 'pl-6' : ''}
          ${isClipChild ? 'pl-3' : ''}
        `}
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0">

          {/* CHEVRON TOGGLE (Group-like behavior) */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              className="p-0.5 hover:bg-white/10 rounded mr-[-2px]"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 opacity-70" />
              ) : (
                <ChevronRight className="h-3 w-3 opacity-70" />
              )}
            </button>
          )}

          {isClipChild && (
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="text-orange-400 flex-shrink-0 opacity-80">
              <path d="M5.5 8.5C5.5 8.5 6 10 8 10H10C11.657 10 13 8.657 13 7C13 5.343 11.657 4 10 4H8C6.343 4 5 5.343 5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M8.5 5.5C8.5 5.5 8 4 6 4H4C2.343 4 1 5.343 1 7C1 8.657 2.343 10 4 10H6C7.657 10 9 8.657 9 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}

          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center bg-black/20 rounded-sm">
            {region.previewUrl
              ? <img src={region.previewUrl} className="w-full h-full object-contain" alt="" />
              : generatedPreview
                ? <img src={generatedPreview} className="w-full h-full object-contain" alt="" />
                : Icon}
          </div>

          <span className={`text-[13px] truncate ${isClipChild ? 'text-orange-300/90' : ''}`}>
            {region.label || formatType(region.type)}
          </span>

          {clipChildCount > 0 && (
            <span
              className="flex-shrink-0 ml-0.5 text-[9px] font-bold px-1 py-0 rounded-full leading-4"
              style={{ background: 'rgba(251,146,60,0.25)', color: 'rgba(251,146,60,0.9)', border: '1px solid rgba(251,146,60,0.35)' }}
            >
              {clipChildCount}
            </span>
          )}
        </div>

        {isIntersectHover && !isIntersectTarget && !isGradientType && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            style={{ animation: 'intersect-badge-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          >
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: 'rgba(59,130,246,0.85)', backdropFilter: 'blur(4px)' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-white">
                <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                <rect x="8" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1.5" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                <rect x="8" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span className="text-[11px] font-bold text-white tracking-wide">Add to Group</span>
            </div>
          </div>
        )}

        {isIntersectTarget && !isGradientType && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            style={{ animation: 'intersect-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          >
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: 'rgba(251,146,60,0.9)', backdropFilter: 'blur(4px)' }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                <path d="M3 10V5.5C3 3.567 4.567 2 6.5 2H7.5C9.433 2 11 3.567 11 5.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="2" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="text-[11px] font-bold text-white tracking-wide">Clip to Mask</span>
            </div>
          </div>
        )}

        {!isIntersectTarget && !isIntersectHover && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {onInvert && (
              <button onClick={(e) => { e.stopPropagation(); onInvert(); }}
                className="p-1 text-[#ABABAB] hover:text-white transition-colors" title="Invert Mask">
                <Contrast className="h-3 w-3" />
              </button>
            )}
            {onDelete && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); onToggleVis(); }}
              className={`p-1 hover:text-white ${!region.visible ? 'text-white/40' : ''}`}>
              {region.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


function getRegionIcon(type: Region['type']) {
  const className = "h-3.5 w-3.5 opacity-70";
  switch (type) {
    case 'manual': return <Brush className={className} />;
    case 'linear-gradient': return (
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className={className}>
        <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" stroke="currentColor" />
      </svg>
    );
    case 'radial-gradient': return (
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className={className}>
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" />
      </svg>
    );
    case 'person': return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M8 8C9.65685 8 11 6.65685 11 5C11 3.34315 9.65685 2 8 2C6.34315 2 5 3.34315 5 5C5 6.65685 6.34315 8 8 8Z" stroke="currentColor" />
        <path d="M8 9C5.33333 9 3 11 3 14H13C13 11 10.6667 9 8 9Z" stroke="currentColor" />
      </svg>
    );
    case 'background': return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <path d="M2 12L5 8L8 11L11 6L14 12H2Z" stroke="currentColor" />
      </svg>
    );
    default: return <div className="w-3.5 h-3.5 border border-dashed border-current rounded-sm opacity-50" />;
  }
}

function formatType(type: string) {
  return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
