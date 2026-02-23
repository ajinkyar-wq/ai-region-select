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
            if (r.groupId) groupCounts[r.groupId] = (groupCounts[r.groupId] || 0) + 1;
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
            if (r.clipParentId && Object.prototype.hasOwnProperty.call(dissolving, r.clipParentId)) {
                const survivorId = dissolving[r.clipParentId];
                return { ...r, clipParentId: survivorId ?? undefined };
            }
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

    const handleMoveRegion = useCallback((id: string, targetGroupId: string | undefined, targetIndex?: number) => {
        if (!image) return;

        let movingRegionIds: string[] = [];
        const isGroup = image.regions.some(r => r.groupId === id);
        const draggedRegion = image.regions.find(r => r.id === id);

        if (!draggedRegion) {
            const regionsInGroup = image.regions.filter(r => r.groupId === id);
            if (regionsInGroup.length > 0) {
                movingRegionIds = regionsInGroup.map(r => r.id);
            } else {
                return;
            }
        } else {
            movingRegionIds = (draggedRegion.selected)
                ? image.regions.filter(r => r.selected).map(r => r.id)
                : [id];
        }

        const targetIsRegion = image.regions.find(r => r.id === targetGroupId);

        if (targetIsRegion) {
            const newGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

            setImage(prev => {
                if (!prev) return prev;

                let newRegions = [...prev.regions];
                const movingRegionsData = newRegions.filter(r => movingRegionIds.includes(r.id));
                newRegions = newRegions.filter(r => !movingRegionIds.includes(r.id));
                const targetIndex = newRegions.findIndex(r => r.id === targetGroupId);
                const updatedMoving = movingRegionsData.map(r => ({ ...r, groupId: newGroupId }));

                if (targetIndex !== -1) {
                    newRegions[targetIndex] = { ...newRegions[targetIndex], groupId: newGroupId };
                    newRegions.splice(targetIndex + 1, 0, ...updatedMoving);
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
                    if (isGroup && targetGroupId === undefined) {
                        return { ...r };
                    }
                    return {
                        ...r,
                        groupId: targetGroupId
                    };
                });

                if (typeof targetIndex === 'number') {
                    const allVisibleRegions = prev.regions.filter(r => {
                        if (r.type !== 'people-group' && r.type !== 'background') return r.hasEdits;
                        return r.hasEdits !== false;
                    });
                    const remainingVisibleRegions = newRegions.filter(r => r.hasEdits);

                    let insertIndex = newRegions.length;

                    if (targetIndex < allVisibleRegions.length) {
                        const anchorRegion = allVisibleRegions[targetIndex];
                        const idx = anchorRegion ? newRegions.findIndex(r => r.id === anchorRegion.id) : -1;
                        if (idx !== -1) {
                            insertIndex = idx;
                        } else {
                            if (remainingVisibleRegions.length > 0) {
                                const lastVisible = remainingVisibleRegions[remainingVisibleRegions.length - 1];
                                insertIndex = newRegions.findIndex(r => r.id === lastVisible.id) + 1;
                            }
                        }
                    } else {
                        if (remainingVisibleRegions.length > 0) {
                            const lastVisible = remainingVisibleRegions[remainingVisibleRegions.length - 1];
                            insertIndex = newRegions.findIndex(r => r.id === lastVisible.id) + 1;
                        }
                    }

                    newRegions.splice(insertIndex, 0, ...updatedMovingRegions);
                } else {
                    newRegions.push(...updatedMovingRegions);
                }

                newRegions = autoDissolveGroups(newRegions);
                return {
                    ...prev,
                    regions: newRegions
                };
            });
        }
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

    return { autoDissolveGroups, removeOrphanedClipChildren, handleMoveRegion, handleDeleteGroup };

}
