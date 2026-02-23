import { useState, useRef, useCallback } from 'react';
import type { Region } from '@/types/workspace';

interface UseSliderDragDropProps {
    editedRegions: Region[];
    topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[];
    onMoveRegion?: (id: string, targetGroupId: string | undefined, targetIndex?: number) => void;
    onIntersectGradient?: (gradientId: string, targetId: string) => void;
}

export function useSliderDragDrop({
    editedRegions,
    topLevelItems,
    onMoveRegion,
    onIntersectGradient
}: UseSliderDragDropProps) {
    const [dropTarget, setDropTarget] = useState<{ id: string | null; position: 'top' | 'bottom' | 'inside' | null }>({ id: null, position: null });
    const [intersectTarget, setIntersectTarget] = useState<string | null>(null);
    const [intersectHoverTarget, setIntersectHoverTarget] = useState<string | null>(null);
    const [draggingGradientId, setDraggingGradientId] = useState<string | null>(null);
    const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

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
                setDropTarget({ id, position: y < h / 2 ? 'top' : 'bottom' });
                return;
            }

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

        clearAllIntersect();

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const y = e.clientY - rect.top;
        const height = rect.height;

        if (isGroup) {
            const edgeThreshold = height * 0.3;
            if (y < edgeThreshold) setDropTarget({ id, position: 'top' });
            else if (y > height - edgeThreshold) setDropTarget({ id, position: 'bottom' });
            else setDropTarget({ id, position: 'inside' });
        } else {
            setDropTarget({ id, position: y < height / 2 ? 'top' : 'bottom' });
        }
    }, [draggingGradientId, editedRegions, intersectHoverTarget, clearAllIntersect, clearIntersectHold]);

    const handleDragLeave = useCallback(() => {
        setDropTarget({ id: null, position: null });
        clearAllIntersect();
    }, [clearAllIntersect]);

    const handleGlobalDragEnd = useCallback(() => {
        setDraggingGradientId(null);
        setDraggingItemId(null);
        clearAllIntersect();
        setDropTarget({ id: null, position: null });
    }, [clearAllIntersect]);

    const handleDropItem = useCallback((e: React.DragEvent, targetId: string, targetRegionType?: string) => {
        e.preventDefault(); e.stopPropagation();
        clearIntersectHold();
        setDraggingGradientId(null);
        setDraggingItemId(null);
        setIntersectHoverTarget(null);

        const gradId = e.dataTransfer.getData('gradient-intersect');
        const isValidTarget = targetRegionType &&
            targetRegionType !== 'linear-gradient' &&
            targetRegionType !== 'radial-gradient';

        if (gradId && isValidTarget && dropTarget.position === 'inside') {
            if (intersectTarget === targetId) {
                onIntersectGradient?.(gradId, targetId);
            } else {
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
    }, [clearIntersectHold, dropTarget, intersectTarget, onIntersectGradient, handleDrop, editedRegions, topLevelItems]);

    return {
        dropTarget,
        setDropTarget,
        intersectTarget,
        intersectHoverTarget,
        draggingItemSourceGroupId,
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
