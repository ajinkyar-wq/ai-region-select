import { useCallback } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';

interface UseRegionManagerProps {
    image: ImageTileData | null;
    setImage: React.Dispatch<React.SetStateAction<ImageTileData | null>>;
    activeMask: Region | null;
    setActiveMask: React.Dispatch<React.SetStateAction<Region | null>>;
    setBrushActive: React.Dispatch<React.SetStateAction<boolean>>;
    setDrawingTool: React.Dispatch<React.SetStateAction<'linear-gradient' | 'radial-gradient' | null>>;
}

export function useRegionManager({
    image,
    setImage,
    activeMask,
    setActiveMask,
    setBrushActive,
    setDrawingTool
}: UseRegionManagerProps) {

    const autoDissolveGroups = useCallback((regions: Region[]): Region[] => {
        const groupCounts: Record<string, number> = {};
        regions.forEach(r => {
            if (r.groupId && !r.clipParentId) {
                groupCounts[r.groupId] = (groupCounts[r.groupId] || 0) + 1;
            }
        });

        const dissolving: Record<string, string | null> = {};
        Object.entries(groupCounts).forEach(([gId, count]) => {
            if (count <= 1) {
                const survivor = regions.find(r => r.groupId === gId);
                dissolving[gId] = survivor?.id ?? null;
            }
        });

        if (Object.keys(dissolving).length === 0) return regions;

        return regions.map(r => {
            if (r.groupId && Object.prototype.hasOwnProperty.call(dissolving, r.groupId)) {
                return { ...r, groupId: undefined };
            }
            // We intentionally do NOT transfer clipParentId to the survivor.
            // If the group dissolves, its group-level gradient becomes orphaned and is
            // naturally cleaned up by removeOrphanedClipChildren.
            return r;
        });
    }, []);

    const removeOrphanedClipChildren = useCallback((regions: Region[]): Region[] => {
        const validIds = new Set(regions.map(r => r.id));
        const validGroupIds = new Set<string>();
        regions.forEach(r => { if (r.groupId) validGroupIds.add(r.groupId); });

        return regions.filter(r => {
            if (!r.clipParentId) return true;
            return validIds.has(r.clipParentId) || validGroupIds.has(r.clipParentId);
        });
    }, []);

    const handleMoveRegion = useCallback((id: string, targetGroupId: string | undefined, anchorId?: string) => {
        if (!image) return;

        let movingRegionIds: string[] = [];
        const isGroupDrag = !image.regions.find(r => r.id === id) && image.regions.some(r => r.groupId === id);
        const draggedRegion = image.regions.find(r => r.id === id);

        if (!draggedRegion) {
            // Dragging a whole group — collect its members
            const regionsInGroup = image.regions.filter(r => r.groupId === id);
            if (regionsInGroup.length > 0) {
                movingRegionIds = regionsInGroup.map(r => r.id);
            } else {
                return;
            }
        } else {
            movingRegionIds = draggedRegion.selected
                ? image.regions.filter(r => r.selected && !r.clipParentId).map(r => r.id)
                : [id];
        }

        const targetIsRegion = image.regions.find(r => r.id === targetGroupId);

        if (targetIsRegion) {
            // Create a brand new group between the dragged item(s) and the target
            const newGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

            setImage(prev => {
                if (!prev) return prev;

                let newRegions = [...prev.regions];
                const movingRegionsData = newRegions.filter(r => movingRegionIds.includes(r.id));
                newRegions = newRegions.filter(r => !movingRegionIds.includes(r.id));
                const targetIdx = newRegions.findIndex(r => r.id === targetGroupId);
                const updatedMoving = movingRegionsData.map(r => ({ ...r, groupId: newGroupId }));

                if (targetIdx !== -1) {
                    newRegions[targetIdx] = { ...newRegions[targetIdx], groupId: newGroupId };
                    newRegions.splice(targetIdx + 1, 0, ...updatedMoving);
                } else {
                    newRegions.push(...updatedMoving);
                }

                newRegions = autoDissolveGroups(newRegions);
                return { ...prev, regions: newRegions };
            });
        } else {
            setImage(prev => {
                if (!prev) return prev;

                let newRegions = [...prev.regions];
                const movingRegions = newRegions.filter(r => movingRegionIds.includes(r.id));

                newRegions = newRegions.filter(r => !movingRegionIds.includes(r.id));

                const updatedMovingRegions = movingRegions.map(r => {
                    if (isGroupDrag) {
                        // Moving a whole group as a unit — preserve internal groupIds
                        return { ...r };
                    }
                    // FIX: Gradients are strictly clip children, they can never join a group themselves.
                    if (r.type === 'linear-gradient' || r.type === 'radial-gradient') {
                        return { ...r, groupId: undefined };
                    }
                    return { ...r, groupId: targetGroupId };
                });

                if (anchorId) {
                    const insertIndex = newRegions.findIndex(r => r.id === anchorId);
                    if (insertIndex !== -1) {
                        // Insert keeping the dragged items in their current internal relative order
                        newRegions.splice(insertIndex, 0, ...updatedMovingRegions);
                    } else {
                        newRegions.push(...updatedMovingRegions);
                    }
                } else {
                    newRegions.push(...updatedMovingRegions);
                }

                newRegions = autoDissolveGroups(newRegions);
                newRegions = removeOrphanedClipChildren(newRegions);

                return { ...prev, regions: newRegions };
            });
        }
    }, [image, setImage, autoDissolveGroups, removeOrphanedClipChildren]);

    /**
     * Sets groupId on all currently-selected regions in one atomic update.
     * Used when multi-select batch drops into a group or onto another item.
     * `targetGroupId` is the UUID already shared by that group's members.
     */
    const handleGroupSelected = useCallback((targetGroupId: string) => {
        if (!image) return;
        setImage(prev => {
            if (!prev) return prev;
            const newRegions = prev.regions.map(r => {
                if (!r.selected) return r;
                // Skip clip-children (intersected gradients) — they belong to their parent
                if (r.clipParentId) return r;
                return { ...r, groupId: targetGroupId };
            });
            return { ...prev, regions: autoDissolveGroups(newRegions) };
        });
    }, [image, setImage, autoDissolveGroups]);

    const handleDeleteGroup = useCallback((groupId: string) => {
        if (!image) return;

        setImage(prev => {
            if (!prev) return prev;

            const groupRegions = prev.regions.filter(r => r.groupId === groupId);
            const clippedToGroup = prev.regions.filter(r => r.clipParentId === groupId);
            const memberIds = new Set(groupRegions.map(r => r.id));
            const clippedToMembers = prev.regions.filter(r =>
                r.clipParentId && memberIds.has(r.clipParentId)
            );

            const allAffected = [...groupRegions, ...clippedToGroup, ...clippedToMembers];

            const manualToDelete = allAffected.filter(r =>
                r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient'
            );

            const aiToReset = allAffected.filter(r =>
                !manualToDelete.includes(r)
            );

            let newRegions = prev.regions.filter(r => !manualToDelete.some(d => d.id === r.id));

            newRegions = newRegions.map(r => {
                if (aiToReset.some(reset => reset.id === r.id)) {
                    return {
                        ...r,
                        groupId: undefined,
                        hasEdits: false,
                        selected: false,
                        visible: true,
                        clipParentId: undefined
                    };
                }
                return r;
            });

            newRegions = removeOrphanedClipChildren(newRegions);

            return {
                ...prev,
                regions: newRegions
            };
        });

        const preDeleteMemberIds = new Set(image.regions.filter(r => r.groupId === groupId).map(r => r.id));
        const affectedIds = new Set(image.regions.filter(r =>
            r.groupId === groupId ||
            r.clipParentId === groupId ||
            (r.clipParentId && preDeleteMemberIds.has(r.clipParentId))
        ).map(r => r.id));

        if (activeMask && affectedIds.has(activeMask.id)) {
            setActiveMask(null);
            setBrushActive(false);
            setDrawingTool(null);
        }
    }, [image, setImage, activeMask, setActiveMask, setBrushActive, setDrawingTool, removeOrphanedClipChildren]);

    return { autoDissolveGroups, removeOrphanedClipChildren, handleMoveRegion, handleGroupSelected, handleDeleteGroup };

}
