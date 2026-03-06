import { useState, useMemo, useRef } from 'react';
import { SliderPanelContent } from './SliderPanelContent';
import { generateMaskPreview } from '@/lib/mask-preview';
import {
  SlidersHorizontal, Crop, ChevronDown, ChevronRight, Plus, PlusCircle,
  Brush, ToggleLeft, ToggleRight,
  Eye, EyeOff, Trash2, Contrast
} from 'lucide-react';
import type { Region, RegionAdjustments } from '@/types/workspace';
import { MaskListGroup } from './MaskListGroup';
import { MaskListRegion } from './MaskListRegion';
import { useRegionHierarchy } from './logic/useRegionHierarchy';
import { useSliderSelection } from './logic/useSliderSelection';
import { useSliderDragDrop } from './logic/useSliderDragDrop';

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
  onMoveRegion?: (id: string, targetGroupId: string | undefined, anchorId?: string) => void;
  onGroupSelected?: (targetGroupId: string) => void;
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
  onGroupSelected,
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

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const { editedRegions, topLevelItems, clipChildrenByParent } = useRegionHierarchy(regions);

  const {
    dropTarget,
    setDropTarget,
    intersectTarget,
    intersectHoverTarget,
    draggingItemSourceGroupId,
    draggingItemType,
    groupingHoverTarget,
    handleDragStart,
    handleDrop,
    handleDragOverItem,
    handleDragLeave,
    handleGlobalDragEnd,
    handleDropItem,
    clearAllIntersect,
    draggingItemId,
    setDraggingItemId,
    draggingGradientId,
    setDraggingGradientId
  } = useSliderDragDrop({
    editedRegions,
    topLevelItems,
    onMoveRegion,
    onGroupSelected,
    onIntersectGradient
  });

  const { handleSelectRegion } = useSliderSelection({
    topLevelItems,
    expandedGroups,
    onSelectRegion,
    onSelectBatchRegions
  });

  if (!isOpen) return null;

  // Global index for striping across groups
  const globalIndexRef = useRef(0);
  globalIndexRef.current = 0;

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

              {/* Object 
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
              </button>*/}

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
            handleDrop(e, undefined); // Omit targetIndex so it goes to the actual end of newRegions
          }}
        >
          {/* UNIFIED LIST RENDERING */}
          <div className="flex flex-col w-full min-h-[50px]">
            {topLevelItems.length === 0 ? (
              <div className="px-5 py-2 text-[11px] text-[#555] italic">No active masks</div>
            ) : (
              topLevelItems.map((item) => {
                if ('type' in item && item.type === 'group') {
                  return (
                    <MaskListGroup
                      key={item.id}
                      groupId={item.id}
                      groupRegions={item.regions}
                      expandedGroups={expandedGroups}
                      toggleGroup={toggleGroup}
                      clipChildrenByParent={clipChildrenByParent}
                      editedRegions={editedRegions}
                      globalIndexRef={globalIndexRef}

                      dropTarget={dropTarget}
                      setDropTarget={setDropTarget}
                      intersectTarget={intersectTarget}
                      intersectHoverTarget={intersectHoverTarget}
                      groupingHoverTarget={groupingHoverTarget}
                      draggingItemSourceGroupId={draggingItemSourceGroupId}
                      draggingItemId={draggingItemId}
                      draggingGradientId={draggingGradientId}
                      setDraggingItemId={setDraggingItemId}
                      setDraggingGradientId={setDraggingGradientId}

                      handleDragStart={handleDragStart}
                      handleDragOverItem={handleDragOverItem}
                      handleDragLeave={handleDragLeave}
                      handleGlobalDragEnd={handleGlobalDragEnd}
                      handleDropItem={handleDropItem}
                      clearAllIntersect={clearAllIntersect}
                      onMoveRegion={onMoveRegion}

                      handleSelectRegion={handleSelectRegion}
                      onSelectBatchRegions={onSelectBatchRegions}
                      onActivateRegion={onActivateRegion}
                      onToggleVisibility={onToggleVisibility}
                      onToggleBatchVisibility={onToggleBatchVisibility}
                      onDeleteRegion={onDeleteRegion}
                      onDeleteGroup={onDeleteGroup}
                      onInvertMask={onInvertMask}
                    />
                  );
                } else {
                  return (
                    <MaskListRegion
                      key={(item as Region).id}
                      region={item as Region}
                      clipChildrenByParent={clipChildrenByParent}
                      expandedGroups={expandedGroups}
                      toggleGroup={toggleGroup}
                      globalIndexRef={globalIndexRef}

                      dropTarget={dropTarget}
                      intersectTarget={intersectTarget}
                      intersectHoverTarget={intersectHoverTarget}
                      draggingItemId={draggingItemId}
                      draggingGradientId={draggingGradientId}

                      handleDragStart={handleDragStart}
                      handleDragOverItem={handleDragOverItem}
                      handleDragLeave={handleDragLeave}
                      handleGlobalDragEnd={handleGlobalDragEnd}
                      handleDropItem={handleDropItem}

                      onSelectBatchRegions={onSelectBatchRegions}
                      handleSelectRegion={handleSelectRegion}
                      onActivateRegion={onActivateRegion}
                      onToggleVisibility={onToggleVisibility}
                      onDeleteRegion={onDeleteRegion}
                      onInvertMask={onInvertMask}
                    />
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

// End of SliderPanel component
