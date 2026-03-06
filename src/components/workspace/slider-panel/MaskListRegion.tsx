import React from 'react';
import type { Region } from '@/types/workspace';
import { MaskListItem } from './MaskListItem';
import { ClipChildTree } from './ClipChildTree';

interface MaskListRegionProps {
    region: Region;
    clipChildrenByParent: Record<string, Region[]>;
    expandedGroups: Record<string, boolean>;
    toggleGroup: (key: string) => void;
    globalIndexRef: { current: number };

    // Drag & drop state
    dropTarget: { id: string | null; position: 'top' | 'bottom' | 'inside' | null };
    intersectTarget: string | null;
    intersectHoverTarget: string | null;
    draggingItemId: string | null;
    draggingGradientId: string | null;

    // Handlers
    handleDragStart: (e: React.DragEvent, id: string, type?: string) => void;
    handleDragOverItem: (e: React.DragEvent, id: string, isGroup: boolean, type?: string) => void;
    handleDragLeave: (e: React.DragEvent) => void;
    handleGlobalDragEnd: () => void;
    handleDropItem: (e: React.DragEvent, targetId: string, targetType?: string) => void;

    // Actions
    onSelectBatchRegions?: (ids: string[], multi: boolean, activeId?: string) => void;
    handleSelectRegion: (id: string, multi: boolean, shift: boolean, batchIds?: string[]) => void;
    onActivateRegion?: (id: string) => void;
    onToggleVisibility: (id: string) => void;
    onDeleteRegion: (id: string) => void;
    onInvertMask?: (id?: string) => void;
}

export function MaskListRegion(props: MaskListRegionProps) {
    const {
        region, clipChildrenByParent, expandedGroups, toggleGroup, globalIndexRef,
        dropTarget, intersectTarget, intersectHoverTarget, draggingItemId, draggingGradientId,
        handleDragStart, handleDragOverItem, handleDragLeave, handleGlobalDragEnd, handleDropItem,
        onSelectBatchRegions, handleSelectRegion, onActivateRegion,
        onToggleVisibility, onDeleteRegion, onInvertMask
    } = props;

    const itemIndex = globalIndexRef.current++;
    const isDropTarget = dropTarget.id === region.id;
    const clipKids = clipChildrenByParent[region.id] || [];

    const singleItemId = `single-${region.id}`;
    const isSingleItemExpanded = expandedGroups[singleItemId] !== false; // Default expanded

    return (
        <div key={region.id} className="relative">
            {isDropTarget && dropTarget.position === 'top' && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
            )}

            <MaskListItem
                region={region}
                index={itemIndex}
                onSelect={(multi, shift) => {
                    const allIds = [region.id, ...clipKids.map(c => c.id)];
                    handleSelectRegion(region.id, multi, shift!, allIds);
                }}
                onActivate={() => onActivateRegion?.(region.id)}
                onToggleVis={() => onToggleVisibility(region.id)}
                onDelete={() => onDeleteRegion(region.id)}
                onInvert={() => onInvertMask?.(region.id)}
                onDragStart={(e) => handleDragStart(e, region.id, region.type)}
                onDragEnd={handleGlobalDragEnd}
                onDragOver={(e) => handleDragOverItem(e, region.id, false, region.type)}
                onDragLeave={handleDragLeave}
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

            {/* Render Clip Children recursively */}
            <ClipChildTree
                parentId={region.id}
                level={1}
                isParentExpanded={isSingleItemExpanded}
                clipChildrenByParent={clipChildrenByParent}
                globalIndexRef={globalIndexRef}
                expandedGroups={expandedGroups}
                toggleGroup={toggleGroup}
                handleSelectRegion={handleSelectRegion}
                onActivateRegion={onActivateRegion}
                onToggleVisibility={onToggleVisibility}
                onDeleteRegion={onDeleteRegion}
                handleDragStart={handleDragStart}
                handleGlobalDragEnd={handleGlobalDragEnd}
                handleDragOverItem={handleDragOverItem}
                handleDragLeave={handleDragLeave}
                handleDropItem={handleDropItem}
                dropTarget={dropTarget}
                intersectTarget={intersectTarget}
                intersectHoverTarget={intersectHoverTarget}
                draggingItemId={draggingItemId}
                draggingGradientId={draggingGradientId}
            />

            {isDropTarget && dropTarget.position === 'bottom' && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-500 z-50" />
            )}
        </div>
    );
}
