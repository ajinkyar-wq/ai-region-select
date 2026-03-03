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
        // FIX F2: Only block intersect if the gradient is already clipped (clipParentId set), NOT just grouped
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
            // 20% top/bottom for reordering, 60% center for intersect
            const edgeThreshold = h * 0.2;

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
            // Group headers: 20% reorder, 60% group-join
            const edgeThreshold = height * 0.2;
            if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
            else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
            else {
                // FIX B7: Only show grouping hover for non-gradient drags on group headers
                if (!isGradientDrag) {
                    setGroupingHoverTarget(id);
                }
                setDropTarget({ id, position: 'inside' });
            }
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
                // FIX B7: Only show grouping hover badge for non-gradient items
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: 'inside' });
            }
        } else if ((isPlainItemDrag || isGradientDrag) && isPlainMaskTarget && id !== draggingItemId) {
            const draggedAlreadyInGroup = !!draggingItemSourceGroupId;
            const targetRegionGroupId = editedRegions.find(r => r.id === id)?.groupId;
            const targetAlreadyInGroup = !!targetRegionGroupId;

            if (!draggedAlreadyInGroup && !targetAlreadyInGroup) {
                // Standalone item dragged onto standalone item — can create new groups
                const edgeThreshold = height * 0.2;
                if (y < edgeThreshold) {
                    setGroupingHoverTarget(null);
                    setDropTarget({ id, position: 'top' });
                } else if (y > height - edgeThreshold) {
                    setGroupingHoverTarget(null);
                    setDropTarget({ id, position: 'bottom' });
                } else {
                    // Center zone: create new group
                    // FIX B7: Only show grouping hover for non-gradient drags
                    if (!isGradientDrag) {
                        setGroupingHoverTarget(id);
                    }
                    setDropTarget({ id, position: 'inside' });
                }
            } else {
                // Either dragged is already grouped, or target is already grouped.
                // Don't allow creating nested groups or swallowing standalone items via members.
                setGroupingHoverTarget(null);
                setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
            }
        } else {
            setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
        }
    }, [draggingGradientId, draggingItemId, draggingItemSourceGroupId, editedRegions, intersectHoverTarget, clearAllIntersect, clearIntersectHold]);

    // FIX B2 + B13: Only fire drag leave if cursor genuinely left the row element
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        const related = e.relatedTarget as Node | null;
        if (e.currentTarget && related && (e.currentTarget as HTMLElement).contains(related)) {
            // Still inside the element — ignore the bubbled leave
            return;
        }
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
                // INTERSECT: amber hold fired — clip gradient to exactly the target dropped on.
                // Do NOT escalate to groupId — if the user dropped on an individual member,
                // the clipParentId should be that member's id, not the group's id.
                onIntersectGradient?.(gradId, targetId);
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

        // ── Group header drop (inside) — join that group ───────────────────────────
        if (targetRegionType === 'group' && dropTarget.position === 'inside' && draggedId) {
            const targetGroupId = targetId; // group header id IS the groupId
            if (anyOtherSelected) {
                onGroupSelected?.(targetGroupId);
            } else {
                onMoveRegion?.(draggedId, targetGroupId);
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
            // FIX B1: Derive insert index from the display-ordered topLevelItems, not raw editedRegions
            // This correctly handles group headers whose ID != any region.id
            const flatDisplayOrder: string[] = [];
            topLevelItems.forEach(item => {
                if ('type' in item && item.type === 'group') {
                    flatDisplayOrder.push(item.id); // group header pseudo-id
                    item.regions.forEach(r => flatDisplayOrder.push(r.id));
                } else {
                    flatDisplayOrder.push((item as Region).id);
                }
            });

            const displayIdx = flatDisplayOrder.indexOf(targetId);

            let targetIndex: number;
            if (position === 'bottom') {
                // Insert after the target (and after all its group members if it's a group)
                const targetIsGroup = topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === targetId);
                if (targetIsGroup) {
                    // Insert after last member in flatDisplayOrder
                    const groupItem = targetIsGroup as { type: 'group'; id: string; regions: Region[] };
                    const lastMemberId = groupItem.regions.length > 0
                        ? groupItem.regions[groupItem.regions.length - 1].id
                        : targetId;
                    targetIndex = flatDisplayOrder.indexOf(lastMemberId) + 1;
                } else {
                    targetIndex = displayIdx !== -1 ? displayIdx + 1 : flatDisplayOrder.length;
                }
            } else {
                // top — insert before
                targetIndex = displayIdx !== -1 ? displayIdx : 0;
            }

            // Now map display index to editedRegions index for the move operation
            // We use the anchor region at flatDisplayOrder[targetIndex] (or end)
            let anchorId = flatDisplayOrder[targetIndex];

            // FIX: If the anchor ID is a group header, we must drop it right before the first member of that group
            // because group headers themselves aren't real items in `editedRegions`
            const anchorGroupNode = topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === anchorId) as { type: 'group'; id: string; regions: Region[] } | undefined;
            if (anchorGroupNode && anchorGroupNode.regions.length > 0) {
                anchorId = anchorGroupNode.regions[0].id;
            }

            const anchorRegionIdx = anchorId
                ? editedRegions.findIndex(r => r.id === anchorId)
                : -1;
            const insertIdx = anchorRegionIdx !== -1 ? anchorRegionIdx : editedRegions.length;

            // Determine what groupId the dragged item should inherit at the drop position
            const targetIsGroupHeader = topLevelItems.some(i => 'type' in i && i.type === 'group' && i.id === targetId);
            let newGroupId: string | undefined;
            if (targetIsGroupHeader) {
                // If dropping exactly on the group header...
                if (position === 'bottom') {
                    newGroupId = targetId; // Join the group
                } else {
                    newGroupId = undefined; // Drop before group
                }
            } else {
                newGroupId = editedRegions.find(r => r.id === targetId)?.groupId;
            }

            handleDrop(e, newGroupId, insertIdx);
        }
    }, [clearIntersectHold, dropTarget, intersectTarget, onIntersectGradient, onMoveRegion, onGroupSelected, handleDrop, editedRegions, topLevelItems]);

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
