import React from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Trash2, Contrast } from 'lucide-react';
import type { Region } from '@/types/workspace';
import { MaskListItem } from './MaskListItem';

interface MaskListGroupProps {
    groupId: string;
    groupRegions: Region[];
    expandedGroups: Record<string, boolean>;
    toggleGroup: (key: string) => void;
    clipChildrenByParent: Record<string, Region[]>;
    editedRegions: Region[];
    globalIndexRef: { current: number };

    // Drag & drop state
    dropTarget: { id: string | null; position: 'top' | 'bottom' | 'inside' | null };
    setDropTarget: React.Dispatch<React.SetStateAction<{ id: string | null; position: 'top' | 'bottom' | 'inside' | null }>>;
    intersectTarget: string | null;
    intersectHoverTarget: string | null;
    draggingItemSourceGroupId: string | undefined;
    draggingItemId: string | null;
    draggingGradientId: string | null;
    setDraggingItemId: (id: string | null) => void;
    setDraggingGradientId: (id: string | null) => void;

    // Handlers
    handleDragStart: (e: React.DragEvent, id: string, type?: string) => void;
    handleDragOverItem: (e: React.DragEvent, id: string, isGroup: boolean, type?: string) => void;
    handleDragLeave: () => void;
    handleGlobalDragEnd: () => void;
    handleDropItem: (e: React.DragEvent, targetId: string, targetType?: string) => void;
    clearAllIntersect: () => void;
    onMoveRegion?: (id: string, targetGroupId: string | undefined, targetIndex?: number) => void;

    // Actions
    handleSelectRegion: (id: string, multi: boolean, shift: boolean) => void;
    onSelectBatchRegions?: (ids: string[], multi: boolean, activeId?: string) => void;
    onActivateRegion?: (id: string) => void;
    onToggleVisibility: (id: string) => void;
    onToggleBatchVisibility: (ids: string[], visible: boolean) => void;
    onDeleteRegion: (id: string) => void;
    onDeleteGroup?: (id: string) => void;
    onInvertMask?: (id?: string) => void;
}

export function MaskListGroup(props: MaskListGroupProps) {
    const {
        groupId, groupRegions, expandedGroups, toggleGroup, clipChildrenByParent, editedRegions,
        globalIndexRef, dropTarget, setDropTarget, intersectTarget, intersectHoverTarget,
        draggingItemSourceGroupId, draggingItemId, draggingGradientId, setDraggingItemId, setDraggingGradientId,
        handleDragStart, handleDragOverItem, handleDragLeave, handleGlobalDragEnd, handleDropItem,
        clearAllIntersect, onMoveRegion, handleSelectRegion, onSelectBatchRegions, onActivateRegion,
        onToggleVisibility, onToggleBatchVisibility, onDeleteRegion, onDeleteGroup, onInvertMask
    } = props;

    const isExpanded = expandedGroups[groupId] !== false; // Default to TRUE (Expanded)
    const isAllVisible = groupRegions.every(r => r.visible);
    const isGroupSelected = groupRegions.length > 0 && groupRegions.every(r => r.selected);

    // Consume index for the group header itself
    const groupHeaderIndex = globalIndexRef.current++;
    const isDropTarget = dropTarget.id === groupId;

    return (
        <div key={groupId} className="flex flex-col relative">
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
                }}
            >
                <div className="flex items-center gap-2 overflow-hidden min-w-0">
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
            {isExpanded && (
                <div className="flex flex-col">
                    {/* Standard Group Members */}
                    {groupRegions.map((region) => {
                        const itemIndex = globalIndexRef.current++;
                        const memberClipKids = clipChildrenByParent[region.id] || [];
                        const memberItemId = `single-${region.id}`;
                        const isMemberExpanded = expandedGroups[memberItemId] !== false;

                        return (
                            <div key={region.id} className="relative">
                                {dropTarget.id === region.id && dropTarget.position === 'top' && (
                                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
                                )}

                                <MaskListItem
                                    region={region}
                                    index={itemIndex}
                                    onSelect={(multi, shift) => {
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

                                {/* Clip children */}
                                {isMemberExpanded && memberClipKids.length > 0 && (
                                    <div
                                        className="relative ml-6"
                                        style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.4)' }}
                                    >
                                        {memberClipKids.map((child) => {
                                            const childIndex = globalIndexRef.current++;
                                            return (
                                                <div key={child.id} className="relative flex items-center">
                                                    <div
                                                        className="absolute left-0 top-1/2 w-3.5 flex-shrink-0"
                                                        style={{ height: '1px', background: 'rgba(251,146,60,0.4)' }}
                                                    />
                                                    <div className="flex-1 pl-3.5">
                                                        <MaskListItem
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
            )}

            {/* Intersected Gradients (Clip Children of the Group) */}
            {isExpanded && (clipChildrenByParent[groupId] || []).map((child) => {
                const childIndex = globalIndexRef.current++;
                return (
                    <div key={child.id} className="relative flex items-center pl-5">
                        <div className="absolute left-[18px] top-0 bottom-0 w-[1px]"
                            style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.35)' }}
                        />
                        <div className="absolute left-[18px] top-1/2 w-3 h-px"
                            style={{ background: 'rgba(251,146,60,0.35)', top: '50%' }}
                        />

                        <div className="flex-1">
                            <MaskListItem
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
            {isDropTarget && dropTarget.position === 'bottom' && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
            )}
        </div>
    );
}
