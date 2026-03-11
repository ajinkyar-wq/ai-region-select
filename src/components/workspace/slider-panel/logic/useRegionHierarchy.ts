import { useMemo } from 'react';
import type { Region } from '@/types/workspace';

export function useRegionHierarchy(regions: Region[]) {
    return useMemo(() => {
        // 1. Filter regions: Show masks with edits OR default system masks (Background/People Group) - UNLESS hasEdits is explicitly false (deleted)
        const editedRegions = regions.filter(r => {
            if (r.type === 'people-group') {
                const personCount = regions.filter(p => p.type === 'person').length;
                if (personCount <= 1) return false;
                return r.hasEdits !== false;
            }
            // When only 1 person, show that person by default (no hasEdits required)
            if (r.type === 'person') {
                const personCount = regions.filter(p => p.type === 'person').length;
                if (personCount === 1) return r.hasEdits !== false;
                return r.hasEdits;
            }
            if (r.type !== 'background') return r.hasEdits;
            return r.hasEdits !== false;
        });

        // 2. Build Render List respecting original order
        const topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[] = [];
        const processedGroupIds = new Set<string>();

        // Pre-group regions for checks
        const regionsByGroup: Record<string, Region[]> = {};
        editedRegions.forEach(r => {
            // Exclude clip children from group membership (they exclusively belong to their parent)
            if (r.clipParentId) return;

            if (r.groupId) {
                if (!regionsByGroup[r.groupId]) regionsByGroup[r.groupId] = [];
                regionsByGroup[r.groupId].push(r);
            }
        });

        // Build map: parentId -> clip-children (gradients clipped to that mask)
        const clipChildrenByParent: Record<string, Region[]> = {};
        editedRegions.forEach(r => {
            if (r.clipParentId) {
                if (!clipChildrenByParent[r.clipParentId]) clipChildrenByParent[r.clipParentId] = [];
                clipChildrenByParent[r.clipParentId].push(r);
            }
        });

        editedRegions.forEach(r => {
            // Exclude clip-children from root list — they appear under their parent
            if (r.clipParentId) return;

            if (r.groupId) {
                // It's in a group
                if (!processedGroupIds.has(r.groupId)) {
                    // First time encountering this group -> Render the Whole Group here
                    processedGroupIds.add(r.groupId);
                    topLevelItems.push({
                        type: 'group',
                        id: r.groupId,
                        regions: regionsByGroup[r.groupId] || []
                    });
                }
            } else {
                // Root Item
                topLevelItems.push(r);
            }
        });

        return {
            editedRegions,
            topLevelItems,
            clipChildrenByParent,
            regionsByGroup
        };
    }, [regions]);
}
