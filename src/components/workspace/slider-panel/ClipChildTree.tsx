import React from 'react';
import type { Region } from '@/types/workspace';
import { MaskListItem } from './MaskListItem';

interface ClipChildTreeProps {
    parentId: string;
    level: number;
    isParentExpanded: boolean;
    clipChildrenByParent: Record<string, Region[]>;
    globalIndexRef: { current: number };
    expandedGroups: Record<string, boolean>;
    toggleGroup: (key: string) => void;
    handleSelectRegion: (id: string, multi: boolean, shift: boolean, batchIds?: string[]) => void;
    onActivateRegion?: (id: string) => void;
    onToggleVisibility: (id: string) => void;
    onDeleteRegion: (id: string) => void;
    handleDragStart: (e: React.DragEvent, id: string, type?: string) => void;
    handleGlobalDragEnd: () => void;
    handleDragOverItem: (e: React.DragEvent, id: string, isGroup: boolean, type?: string) => void;
    handleDragLeave: (e: React.DragEvent) => void;
    handleDropItem: (e: React.DragEvent, targetId: string, targetType?: string) => void;
    dropTarget: { id: string | null; position: 'top' | 'bottom' | 'inside' | null };
    intersectTarget: string | null;
    intersectHoverTarget: string | null;
    draggingItemId: string | null;
    draggingGradientId: string | null;
    isInsideGroupMember?: boolean; // Extra indentation if we are inside a group member
    onMaskItemHover?: (id: string | null) => void;
}

export function ClipChildTree(props: ClipChildTreeProps) {
    const {
        parentId, level, isParentExpanded, clipChildrenByParent, globalIndexRef,
        expandedGroups, toggleGroup, handleSelectRegion, onActivateRegion,
        onToggleVisibility, onDeleteRegion, handleDragStart, handleGlobalDragEnd,
        handleDragOverItem, handleDragLeave, handleDropItem, dropTarget,
        intersectTarget, intersectHoverTarget, draggingItemId, draggingGradientId,
        isInsideGroupMember, onMaskItemHover
    } = props;

    const clipKids = clipChildrenByParent[parentId] || [];

    if (!isParentExpanded || clipKids.length === 0) return null;

    return (
        <>
            {clipKids.map((child: Region, idx: number) => {
                const childIndex = globalIndexRef.current++;
                const isLastChild = idx === clipKids.length - 1;
                const childSingleId = `single-${child.id}`;
                const isChildExpanded = expandedGroups[childSingleId] !== false;
                const hasOwnKids = (clipChildrenByParent[child.id] || []).length > 0;

                return (
                    <div key={child.id} className="relative flex flex-col">
                        <div className={`relative flex items-center ${level === 1 && !isInsideGroupMember ? 'pl-5' : 'pl-5'}`}>
                            {/* Vertical Line Segment */}
                            <div
                                className="absolute left-[8px] top-0 w-[1px]"
                                style={{
                                    height: isLastChild && !hasOwnKids ? '50%' : '100%',
                                    borderLeft: '1.5px dashed rgba(251,146,60,0.35)'
                                }}
                            />
                            {/* Horizontal Line Segment */}
                            <div className="absolute left-[8px] top-1/2 w-3 h-px"
                                style={{ background: 'rgba(251,146,60,0.35)', top: '50%' }}
                            />

                            <div className="flex-1">
                                <MaskListItem
                                    region={child}
                                    index={childIndex}
                                    onSelect={(multi: boolean, shift: boolean) => {
                                        // FIX: NO onActivateRegion here. Single click only selects.
                                        handleSelectRegion(child.id, multi, shift);
                                    }}
                                    onActivate={() => onActivateRegion?.(child.id)}
                                    onToggleVis={() => onToggleVisibility(child.id)}
                                    onDelete={() => onDeleteRegion(child.id)}
                                    onDragStart={(e: React.DragEvent) => handleDragStart(e, child.id, child.type)}
                                    onDragEnd={handleGlobalDragEnd}
                                    onDragOver={(e: React.DragEvent) => handleDragOverItem(e, child.id, false, child.type)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e: React.DragEvent) => handleDropItem(e, child.id, child.type)}
                                    dropTarget={dropTarget.id === child.id ? dropTarget.position : null}
                                    isIntersectTarget={intersectTarget === child.id}
                                    isIntersectHover={intersectHoverTarget === child.id && intersectTarget !== child.id}
                                    clipChildCount={(clipChildrenByParent[child.id] || []).length}
                                    isDraggingGradient={!!draggingGradientId}
                                    isDragSource={draggingItemId === child.id}
                                    dragIntent={draggingItemId === child.id ? (
                                        draggingGradientId
                                            ? (intersectTarget ? 'intersect' : intersectHoverTarget ? 'group' : null)
                                            : (dropTarget.position === 'inside' ? 'group' : null)
                                    ) : null}
                                    isClipChild={true}
                                    hasChildren={hasOwnKids}
                                    isExpanded={isChildExpanded}
                                    onToggleExpand={() => toggleGroup(childSingleId)}
                                    onMouseEnter={() => onMaskItemHover?.(child.id)}
                                    onMouseLeave={() => onMaskItemHover?.(null)}
                                />
                            </div>
                        </div>
                        {hasOwnKids && (
                            <div className="relative ml-5">
                                {/* Continue vertical line extending down if parent wasn't last child */}
                                {!isLastChild && (
                                    <div className="absolute left-[8px] top-0 bottom-0 w-[1px]" style={{ borderLeft: '1.5px dashed rgba(251,146,60,0.35)' }} />
                                )}
                                <ClipChildTree
                                    {...props}
                                    parentId={child.id}
                                    level={level + 1}
                                    isParentExpanded={isChildExpanded}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
