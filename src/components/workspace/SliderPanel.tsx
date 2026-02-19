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
}: SliderPanelProps) {
  const [activeTab, setActiveTab] = useState<'sliders' | 'crop' | 'masking'>('masking');
  const [showAddMaskMenu, setShowAddMaskMenu] = useState(false);

  // Group expansion states
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'smart-selections': true,
    'masks': true,
  });

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

  // Drag & Drop State
  const [dropTarget, setDropTarget] = useState<{ id: string | null; position: 'top' | 'bottom' | 'inside' | null }>({ id: null, position: null });
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // ── Intersect Drag State ──────────────────────────────────────────────────
  // Tracks when a gradient is being dragged and hovering over a valid intersect target.
  // After INTERSECT_HOLD_MS of hover, the row animates "ready to intersect".
  const [intersectTarget, setIntersectTarget] = useState<string | null>(null);
  const [intersectHoverTarget, setIntersectHoverTarget] = useState<string | null>(null);
  const [draggingGradientId, setDraggingGradientId] = useState<string | null>(null);
  const intersectHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const INTERSECT_HOLD_MS = 300;

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
    const isValidIntersectTarget = isGradientDrag &&
      targetRegionType &&
      targetRegionType !== 'linear-gradient' &&
      targetRegionType !== 'radial-gradient';

    if (isValidIntersectTarget) {
      // Always show the blue "inside" ring first — same as grouping
      setDropTarget({ id, position: 'inside' });

      // Only act when we first enter this row — dragover fires constantly, so
      // without this guard the timer gets reset on every tick and never completes.
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

    // Thresholds
    const edgeThreshold = height * 0.25; // Top/Bottom 25%

    if (isGroup) {
      if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
      else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
      else setDropTarget({ id, position: 'inside' });
    } else {
      if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
      else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
      else setDropTarget({ id, position: 'inside' });
    }
  };

  const handleDragLeave = () => {
    setDropTarget({ id: null, position: null });
    clearAllIntersect();
  };

  // Called when the drag ends globally (so we can reset dragging gradient state)
  const handleGlobalDragEnd = () => {
    setDraggingGradientId(null);
    clearAllIntersect();
    setDropTarget({ id: null, position: null });
  };

  const handleDropItem = (e: React.DragEvent, targetId: string, targetRegionType?: string) => {
    e.preventDefault();
    e.stopPropagation();

    clearIntersectHold();
    setDraggingGradientId(null);
    setIntersectHoverTarget(null);

    const gradId = e.dataTransfer.getData('gradient-intersect');
    const isValidTarget = targetRegionType &&
      targetRegionType !== 'linear-gradient' &&
      targetRegionType !== 'radial-gradient';

    if (gradId && isValidTarget) {
      if (intersectTarget === targetId) {
        // ── AMBER phase: CLIP the gradient to this mask ──────────────────────
        onIntersectGradient?.(gradId, targetId);
      } else {
        // ── BLUE phase: GROUP the gradient with this mask ─────────────────
        // Drop inside the mask → Workspace groups them (spreads existing region, clipParentId preserved)
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

          <button
            onClick={() => setShowAddMaskMenu(v => !v)}
            className="flex h-4 w-4 items-center justify-center text-white hover:opacity-80"
            aria-label="Add mask"
          >
            <PlusCircle className="h-4 w-4" />
          </button>

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
                  const isExpanded = expandedGroups[groupId];
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
                      {/* Insertion Lines for Group */}
                      {isDropTarget && dropTarget.position === 'top' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                      )}

                      <div
                        className={`
                            group flex items-center justify-between
                            h-[35px] px-2 cursor-pointer select-none
                            transition-colors relative
                            ${isGroupSelected ? 'bg-[#04395E] text-white' : (groupHeaderIndex % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]')}
                            ${!isGroupSelected && isDropTarget && dropTarget.position === 'inside' ? 'ring-2 ring-blue-500 ring-inset z-20' : ''}
                            ${intersectTarget === groupId ? 'ring-2 ring-amber-500 ring-inset z-20' : ''}
                            ${!isGroupSelected && 'hover:bg-[#353535]'}
                          `}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, groupId)}
                        onDragOver={(e) => handleDragOverItem(e, groupId, true, 'group')}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDropItem(e, groupId, 'group')}
                        onClick={(e) => {
                          const multi = e.metaKey || e.ctrlKey;
                          const shift = e.shiftKey;

                          if (shift) {
                            onSelectBatchRegions?.(groupRegions.map(r => r.id), true);
                          } else {
                            onSelectBatchRegions?.(groupRegions.map(r => r.id), multi);
                          }

                          // SmartMaskLayer handles intersection rendering when the group is selected.
                          // No need to activate individual clip-child gradients here.
                        }}
                      >
                        {/* ... Header Content ... */}
                        <div className="flex items-center gap-2 overflow-hidden">
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
                        </div>

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
                      </div>

                      {/* Group Children */}
                      {
                        isExpanded && (
                          <div className="flex flex-col">
                            {groupRegions.map((region) => {
                              const itemIndex = globalIndex++;
                              return (
                                <div key={region.id} className="relative">
                                  {/* Insertion Lines logic for children needed? Yes if we want to reorder within group */}
                                  {dropTarget.id === region.id && dropTarget.position === 'top' && (
                                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                                  )}

                                  <OutlinerItem
                                    region={region}
                                    index={itemIndex}
                                    onSelect={(multi, shift) => handleSelectRegion(region.id, multi, shift!)}
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
                                    isDraggingGradient={!!draggingGradientId}
                                  />

                                  {dropTarget.id === region.id && dropTarget.position === 'bottom' && (
                                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )
                      }
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

                  return (
                    <div key={region.id} className="relative">
                      {isDropTarget && dropTarget.position === 'top' && (
                        <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                      )}

                      <OutlinerItem
                        region={region}
                        index={itemIndex}
                        onSelect={(multi, shift) => {
                          handleSelectRegion(region.id, multi, shift!);
                          // SmartMaskLayer handles intersection rendering when the parent is selected.
                          // No need to activate individual clip-child gradients here.
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
                      />

                      {/* ── Clip-children: gradients locked to this mask ── */}
                      {clipKids.length > 0 && (
                        <div className="flex flex-col pl-5 relative">
                          {/* Dashed left border hinting hierarchy */}
                          <div
                            className="absolute left-[18px] top-0 bottom-0 w-[1px]"
                            style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.35)' }}
                          />
                          {clipKids.map((child) => {
                            const childIndex = globalIndex++;
                            return (
                              <div key={child.id} className="relative flex items-center">
                                {/* Elbow connector */}
                                <div className="absolute left-0 top-1/2 w-3 h-px"
                                  style={{ background: 'rgba(251,146,60,0.35)', top: '50%' }}
                                />
                                <div className="flex-1">
                                  <OutlinerItem
                                    region={child}
                                    index={childIndex}
                                    onSelect={(multi, shift) => {
                                      handleSelectRegion(child.id, multi, shift!);
                                      // Single-click on a clip-child gradient immediately activates it
                                      // so the gradient handles appear without needing a double-click.
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
                        </div>
                      )}

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
  clipChildCount = 0,
  isClipChild = false,
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
  /** Number of clip-children attached to this mask row */
  clipChildCount?: number;
  /** True if this row is a gradient clipped to a parent mask */
  isClipChild?: boolean;
}) {
  const Icon = getRegionIcon(region.type);

  const isGradientType = region.type === 'linear-gradient' || region.type === 'radial-gradient';
  // Show blue group ring when drop target is 'inside' — unless amber clip mode is committed
  const showGroupRing = dropTarget === 'inside' && !isIntersectTarget;

  return (
    <div
      className="relative overflow-hidden"
      style={{ isolation: 'isolate' }}
    >
      {/* ── Blue hover tint (gradient over mask, group phase 0-600ms) ────────── */}
      {isIntersectHover && !isIntersectTarget && !isGradientType && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{ background: 'rgba(59,130,246,0.10)' }}
        />
      )}

      {/* ── Full committed intersect animation ───────────────────────────── */}
      {isIntersectTarget && !isGradientType && (
        <>
          {/* Full-row amber flash that wipes in from left */}
          <div
            className="absolute inset-0 pointer-events-none z-10"
            style={{
              background: 'linear-gradient(90deg, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0.3) 60%, transparent 100%)',
              animation: 'intersect-wipe 0.4s cubic-bezier(0.22,1,0.36,1) forwards',
            }}
          />
          {/* Pulsing top+bottom amber borders */}
          <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20 bg-orange-400"
            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
          <div className="absolute inset-x-0 bottom-0 h-[2px] pointer-events-none z-20 bg-orange-400"
            style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
        </>
      )}

      {/* ── Clip-child accent line (left edge amber) ─────────────────────── */}
      {isClipChild && (
        <div className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none z-20 bg-orange-400/60" />
      )}

      {/* ── Inner row ──────────────────────────────────────────────────────── */}
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
          ${!region.selected && 'hover:bg-[#353535] text-[#ABABAB]'}
          ${isChild ? 'pl-6' : ''}
          ${isClipChild ? 'pl-3' : ''}
        `}
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
          {/* Clip-child chain icon */}
          {isClipChild && (
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="text-orange-400 flex-shrink-0 opacity-80">
              <path d="M5.5 8.5C5.5 8.5 6 10 8 10H10C11.657 10 13 8.657 13 7C13 5.343 11.657 4 10 4H8C6.343 4 5 5.343 5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M8.5 5.5C8.5 5.5 8 4 6 4H4C2.343 4 1 5.343 1 7C1 8.657 2.343 10 4 10H6C7.657 10 9 8.657 9 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}

          {/* Preview Thumbnail or Icon */}
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center bg-black/20 rounded-sm">
            {(() => {
              if (region.previewUrl) return <img src={region.previewUrl} className="w-full h-full object-contain" alt="" />;
              if (region.maskData && region.maskWidth && region.maskHeight) {
                const generatedPreview = useMemo(() =>
                  generateMaskPreview(region.maskData, region.maskWidth, region.maskHeight, region.color),
                  [region.maskData, region.maskWidth, region.maskHeight, region.color]);
                return <img src={generatedPreview} className="w-full h-full object-contain" alt="" />;
              }
              return Icon;
            })()}
          </div>

          <span className={`text-[13px] truncate ${isClipChild ? 'text-orange-300/90' : ''}`}>
            {region.label || formatType(region.type)}
          </span>

          {/* Clip-count badge on parent row */}
          {clipChildCount > 0 && (
            <span
              className="flex-shrink-0 ml-0.5 text-[9px] font-bold px-1 py-0 rounded-full leading-4"
              style={{ background: 'rgba(251,146,60,0.25)', color: 'rgba(251,146,60,0.9)', border: '1px solid rgba(251,146,60,0.35)' }}
            >
              {clipChildCount}
            </span>
          )}
        </div>

        {/* ── Blue hover badge \u2014 group phase (immediate) ────────────────── */}
        {isIntersectHover && !isIntersectTarget && !isGradientType && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            style={{ animation: 'intersect-badge-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          >
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: 'rgba(59,130,246,0.85)', backdropFilter: 'blur(4px)' }}>
              {/* Group icon */}
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

        {/* ── Amber clip badge \u2014 clip phase (after 600ms hold) ───────────── */}
        {isIntersectTarget && !isGradientType && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
            style={{ animation: 'intersect-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          >
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
              style={{ background: 'rgba(251,146,60,0.9)', backdropFilter: 'blur(4px)' }}>
              {/* ⊓ symbol */}
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                <path d="M3 10V5.5C3 3.567 4.567 2 6.5 2H7.5C9.433 2 11 3.567 11 5.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="2" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              <span className="text-[11px] font-bold text-white tracking-wide">Clip to Mask</span>
            </div>
          </div>
        )}

        {/* ── Normal controls ────────────────────────────────────────────── */}
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
