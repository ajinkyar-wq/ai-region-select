import { useState } from 'react';
import {
  SlidersHorizontal, Crop, ChevronDown, ChevronRight, Plus, PlusCircle,
  Brush,
  Eye,
  EyeOff,
  Trash2,
  Layers
} from 'lucide-react';
import type { Region } from '@/types/workspace';

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
  onApplyEdits?: () => void;
  onSelectBatchRegions?: (ids: string[], multi: boolean) => void;
  onMoveRegion?: (id: string, targetGroupId: string | undefined) => void;
  showMaskImage: boolean;
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
  onApplyEdits,
  onSelectBatchRegions,
  onMoveRegion,
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
  // 1. Filter only regions that have edits (Manual masks have edits by default)
  const editedRegions = regions.filter(r => r.hasEdits);

  // 2. Group by groupId
  const topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[] = [];
  const groups: Record<string, Region[]> = {};

  editedRegions.forEach(r => {
    if (r.groupId) {
      if (!groups[r.groupId]) {
        groups[r.groupId] = [];
      }
      groups[r.groupId].push(r);
    } else {
      topLevelItems.push(r);
    }
  });

  // 3. Insert Groups into topLevelItems
  Object.entries(groups).forEach(([groupId, groupRegions]) => {
    topLevelItems.push({ type: 'group', id: groupId, regions: groupRegions });
  });

  // Helper for DnD
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetGroupId: string | undefined) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) {
      onMoveRegion?.(id, targetGroupId);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
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
            <div className="absolute right-0 top-9 z-50 w-[132px] rounded-lg bg-[#242424] p-1 shadow-xl border border-[#5E5E5E]">
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
        <div className="flex flex-col w-full flex-1 px-4"
          onDragOver={handleDragOver}
          onDrop={(e) => {
            // Drop on empty space = root
            e.stopPropagation();
            handleDrop(e, undefined);
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

                  // Consume index for the group header itself
                  const groupHeaderIndex = globalIndex++;

                  return (
                    <div
                      key={groupId}
                      className="flex flex-col"
                      onDragOver={handleDragOver}
                      onDrop={(e) => {
                        e.stopPropagation();
                        handleDrop(e, groupId);
                      }}
                    >
                      <div
                        className={`
                            group flex items-center justify-between
                            h-[35px] px-2 cursor-pointer select-none
                            transition-colors
                            ${groupHeaderIndex % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]'}
                            hover:bg-[#353535]
                          `}
                        onClick={(e) => {
                          const multi = e.metaKey || e.ctrlKey;
                          // Batch select all items in group
                          onSelectBatchRegions?.(groupRegions.map(r => r.id), multi);
                        }}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
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

                      {/* Group Children */}
                      {isExpanded && (
                        <div className="flex flex-col">
                          {groupRegions.map((region) => {
                            const itemIndex = globalIndex++;
                            return (
                              <OutlinerItem
                                key={region.id}
                                region={region}
                                index={itemIndex}
                                onSelect={(multi) => onSelectRegion(region.id, multi)}
                                onToggleVis={() => onToggleVisibility(region.id)}
                                onDelete={() => onDeleteRegion(region.id)}
                                onDragStart={(e) => handleDragStart(e, region.id)}
                                isChild={true}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                } else {
                  // RENDER SINGLE ITEM
                  const region = item as Region;
                  const itemIndex = globalIndex++;
                  return (
                    <OutlinerItem
                      key={region.id}
                      region={region}
                      index={itemIndex}
                      onSelect={(multi) => onSelectRegion(region.id, multi)}
                      onToggleVis={() => onToggleVisibility(region.id)}
                      onDelete={() => onDeleteRegion(region.id)}
                      onDragStart={(e) => handleDragStart(e, region.id)}
                    />
                  );
                }
              })
            )}
          </div>
        </div>

        {showMaskImage && (
          <div className="mt-4">
            <img
              src="/slider-panel.png"
              alt="Mask adjustment preview"
              className="w-full border-t border-b border-[#2A2A2A] cursor-pointer active:scale-[0.99] transition-transform"
              onClick={() => onApplyEdits?.()}
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
  onToggleVis,
  onDelete,
  onDragStart,
  isChild = false
}: {
  region: Region;
  index: number;
  onSelect: (multi: boolean) => void;
  onToggleVis: () => void;
  onDelete?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  isChild?: boolean;
}) {
  const Icon = getRegionIcon(region.type);

  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={(e) => {
        // prevent triggering selection when clicking controls
        onSelect(e.metaKey || e.ctrlKey);
      }}
      className={`
        group flex items-center justify-between
        h-[35px] px-2 cursor-pointer select-none
        transition-colors
        ${region.selected ? 'bg-[#04395E] text-white' : index % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]'}
        ${!region.selected && 'hover:bg-[#353535] text-[#ABABAB]'}
        ${isChild ? 'pl-6' : ''}
      `}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        {/* Preview Thumbnail or Icon */}
        <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center bg-black/20 rounded-sm">
          {region.previewUrl ? (
            <img src={region.previewUrl} className="w-full h-full object-contain" alt="" />
          ) : (
            Icon
          )}
        </div>
        <span className="text-[13px] truncate">{region.label || formatType(region.type)}</span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVis();
          }}
          className={`p-1 hover:text-white ${!region.visible ? 'text-white/40' : ''}`}
        >
          {region.visible ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
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
