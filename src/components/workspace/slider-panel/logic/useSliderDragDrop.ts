import { useState, useRef, useCallback } from 'react';
import type { Region } from '@/types/workspace';

interface UseSliderDragDropProps {
    editedRegions: Region[];
    topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[];
    onMoveRegion?: (id: string, targetGroupId: string | undefined, targetIndex?: number) => void;
    onGroupSelected?: (targetGroupId: string) => void;
    onIntersectGradient?: (gradientId: string, targetId: string) => void;
}

export function useSliderDragDrop({
    editedRegions,
    topLevelItems,
    onMoveRegion,
    onGroupSelected,
    onIntersectGradient
}: UseSliderDragDropProps) {
    const [dropTarget, setDropTarget] = useState<{ id: string | null; position: 'top' | 'bottom' | 'inside' | null }>({ id: null, position: null });
    const [intersectTarget, setIntersectTarget] = useState<string | null>(null);
    const [intersectHoverTarget, setIntersectHoverTarget] = useState<string | null>(null);
    const [draggingGradientId, setDraggingGradientId] = useState<string | null>(null);
    const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
    const [draggingItemType, setDraggingItemType] = useState<string | null>(null);
    // Track items actively hovered in 'inside' zone during a non-gradient drag
    const [groupingHoverTarget, setGroupingHoverTarget] = useState<string | null>(null);

    const intersectHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const INTERSECT_HOLD_MS = 800;

    const draggingItemSourceGroupId = draggingItemId
        ? editedRegions.find(r => r.id === draggingItemId)?.groupId
        : undefined;

    const clearIntersectHold = useCallback(() => {
        if (intersectHoldTimerRef.current) {
            clearTimeout(intersectHoldTimerRef.current);
            intersectHoldTimerRef.current = null;
        }
    }, []);

    const clearAllIntersect = useCallback(() => {
        clearIntersectHold();
        setIntersectTarget(null);
        setIntersectHoverTarget(null);
    }, [clearIntersectHold]);

    const handleDragStart = useCallback((e: React.DragEvent, id: string, regionType?: string) => {
        e.dataTransfer.setData('text/plain', id);
        setDraggingItemId(id);
        setDraggingItemType(regionType ?? null);
        if (regionType === 'linear-gradient' || regionType === 'radial-gradient') {
            e.dataTransfer.setData('gradient-intersect', id);
            setDraggingGradientId(id);
        } else {
            setDraggingGradientId(null);
        }
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, targetGroupId: string | undefined, targetIndex?: number) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) {
            onMoveRegion?.(id, targetGroupId, targetIndex);
        }
    }, [onMoveRegion]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDragOverItem = useCallback((e: React.DragEvent, id: string, isGroup: boolean, targetRegionType?: string) => {
        e.preventDefault();
        e.stopPropagation();

        const isGradientDrag = !!draggingGradientId;
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
            const edgeThreshold = h * 0.3;

            if (y < edgeThreshold || y > h - edgeThreshold) {
                clearAllIntersect();
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: y < h / 2 ? 'top' : 'bottom' });
                return;
            }

            setDropTarget({ id, position: 'inside' });
            if (intersectHoverTarget !== id) {
                setIntersectHoverTarget(id);
                clearIntersectHold();
                setIntersectTarget(null);
                // Show grouping badge immediately; switch to amber after hold
                setGroupingHoverTarget(id);
                intersectHoldTimerRef.current = setTimeout(() => {
                    setGroupingHoverTarget(null);
                    setIntersectTarget(id);
                }, INTERSECT_HOLD_MS);
            }
            return;
        }

        clearAllIntersect();
        setGroupingHoverTarget(null);

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        const isPlainItemDrag = !draggingGradientId;
        // Any typed item can be a group target — gradients included
        const isPlainMaskTarget = !!targetRegionType;
        // Gradient dragged over another gradient — allow grouping via center zone
        const isGradientOverGradient = isGradientDrag &&
            (targetRegionType === 'linear-gradient' || targetRegionType === 'radial-gradient');

        if (isGroup) {
            const edgeThreshold = height * 0.3;
            if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
            else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
            else setDropTarget({ id, position: 'inside' });
        } else if (isGradientOverGradient && id !== draggingItemId) {
            // Gradient dragged over another gradient — allow grouping
            const edgeThreshold = height * 0.25;
            if (y < edgeThreshold) {
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: 'top' });
            } else if (y > height - edgeThreshold) {
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: 'bottom' });
            } else {
                setGroupingHoverTarget(id);
                setDropTarget({ id, position: 'inside' });
            }
        } else if ((isPlainItemDrag || isGradientDrag) && isPlainMaskTarget && id !== draggingItemId) {
            const draggedAlreadyInGroup = !!draggingItemSourceGroupId;
            const targetRegionGroupId = editedRegions.find(r => r.id === id)?.groupId;
            const targetAlreadyInGroup = !!targetRegionGroupId;

            if (!draggedAlreadyInGroup) {
                // Standalone item being dragged — can join groups OR create new groups
                const edgeThreshold = height * 0.25;
                if (y < edgeThreshold) {
                    setGroupingHoverTarget(null);
                    setDropTarget({ id, position: 'top' });
                } else if (y > height - edgeThreshold) {
                    setGroupingHoverTarget(null);
                    setDropTarget({ id, position: 'bottom' });
                } else {
                    // Center zone: join existing group or create new group
                    setGroupingHoverTarget(id);
                    setDropTarget({ id, position: 'inside' });
                }
            } else if (!targetAlreadyInGroup) {
                // Grouped item dragged onto standalone — just reorder
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
            } else {
                // Both already in groups — no nested groups, just reorder
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
            }
        } else {
            setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
        }
    }, [draggingGradientId, draggingItemId, draggingItemSourceGroupId, editedRegions, intersectHoverTarget, clearAllIntersect, clearIntersectHold]);

    const handleDragLeave = useCallback(() => {
        setDropTarget({ id: null, position: null });
        setGroupingHoverTarget(null);
        clearAllIntersect();
    }, [clearAllIntersect]);

    const handleGlobalDragEnd = useCallback(() => {
        setDraggingGradientId(null);
        setDraggingItemId(null);
        setDraggingItemType(null);
        setGroupingHoverTarget(null);
        clearAllIntersect();
        setDropTarget({ id: null, position: null });
    }, [clearAllIntersect]);

    const handleDropItem = useCallback((e: React.DragEvent, targetId: string, targetRegionType?: string) => {
        e.preventDefault(); e.stopPropagation();
        clearIntersectHold();
        setDraggingGradientId(null);
        setDraggingItemId(null);
        setDraggingItemType(null);
        setGroupingHoverTarget(null);
        setIntersectHoverTarget(null);

        const gradId = e.dataTransfer.getData('gradient-intersect');
        const draggedId = e.dataTransfer.getData('text/plain');
        // isValidTarget: only non-gradient targets are valid for INTERSECT
        const isValidTarget = targetRegionType &&
            targetRegionType !== 'linear-gradient' &&
            targetRegionType !== 'radial-gradient';
        // isAnyTarget: any typed target is valid for GROUPING (including gradients)
        const isAnyTarget = !!targetRegionType;

        // ── Gradient drag ──────────────────────────────────────────────────────────
        if (gradId && dropTarget.position === 'inside') {
            if (isValidTarget && intersectTarget === targetId) {
                // INTERSECT: amber hold fired — clip gradient to target (or its group)
                const targetGroupId = editedRegions.find(r => r.id === targetId)?.groupId;
                onIntersectGradient?.(gradId, targetGroupId ?? targetId);
            } else {
                // GROUP: quick drop (no amber) or gradient-over-gradient — group them
                handleDrop(e, targetId);
            }
            setIntersectTarget(null);
            setDropTarget({ id: null, position: null });
            return;
        }

        // ── Plain item (or gradient) dropped in center of any item ─────────────────
        const draggedAlreadyInGroup = !!editedRegions.find(r => r.id === draggedId)?.groupId;
        const anyOtherSelected = editedRegions.some(r => r.selected && r.id !== draggedId && !r.clipParentId);

        if (isAnyTarget && dropTarget.position === 'inside' && draggedId && draggedId !== targetId
            && !draggedAlreadyInGroup) {
            const targetExistingGroupId = editedRegions.find(r => r.id === targetId)?.groupId;

            if (targetExistingGroupId) {
                // Target is already in a group — join that group
                if (anyOtherSelected) {
                    onGroupSelected?.(targetExistingGroupId);
                } else {
                    onMoveRegion?.(draggedId, targetExistingGroupId);
                }
            } else {
                // Target is standalone — create a new group between dragged + target
                onMoveRegion?.(draggedId, targetId);
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
            handleDrop(e, targetId);
        } else {
            let targetIndex = editedRegions.findIndex(r => r.id === targetId || r.groupId === targetId);

            if (targetIndex !== -1) {
                if (position === 'bottom') {
                    const targetIsGroup = topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === targetId);
                    if (targetIsGroup) {
                        const groupMembers = editedRegions.filter(r => r.groupId === targetId);
                        targetIndex += groupMembers.length;
                    } else {
                        targetIndex += 1;
                    }
                }
            }

            const targetIsGroupHeader = topLevelItems.some(i => 'type' in i && i.type === 'group' && i.id === targetId);
            const newGroupId = targetIsGroupHeader
                ? undefined
                : editedRegions.find(r => r.id === targetId)?.groupId;

            handleDrop(e, newGroupId, targetIndex);
        }
    }, [clearIntersectHold, dropTarget, intersectTarget, onIntersectGradient, onMoveRegion, handleDrop, editedRegions, topLevelItems]);

    return {
        dropTarget,
        setDropTarget,
        intersectTarget,
        intersectHoverTarget,
        draggingItemSourceGroupId,
        draggingItemType,
        groupingHoverTarget,
        handleDragStart,
        handleDrop,
        handleDragOver,
        handleDragOverItem,
        handleDragLeave,
        handleGlobalDragEnd,
        handleDropItem,
        clearAllIntersect,
        draggingItemId,
        setDraggingItemId,
        draggingGradientId,
        setDraggingGradientId
    };
}
