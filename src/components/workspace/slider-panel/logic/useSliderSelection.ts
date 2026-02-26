import { useState, useCallback } from 'react';
import type { Region } from '@/types/workspace';

interface UseSliderSelectionProps {
    topLevelItems: (Region | { type: 'group'; id: string; regions: Region[] })[];
    expandedGroups: Record<string, boolean>;
    onSelectRegion: (id: string, multi: boolean) => void;
    onSelectBatchRegions?: (ids: string[], multi: boolean, activeId?: string) => void;
}

export function useSliderSelection({
    topLevelItems,
    expandedGroups,
    onSelectRegion,
    onSelectBatchRegions
}: UseSliderSelectionProps) {
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

    const getVisibleItems = useCallback(() => {
        const items: string[] = [];
        topLevelItems.forEach(item => {
            if ('type' in item && item.type === 'group') {
                items.push(item.id); // Group Header
                // Default to expanded (true) if undefined.
                if (expandedGroups[item.id] !== false) {
                    item.regions.forEach(r => items.push(r.id));
                }
            } else {
                items.push((item as Region).id);
            }
        });
        return items;
    }, [topLevelItems, expandedGroups]);

    const handleSelectRegion = useCallback((id: string, multi: boolean, shift: boolean, batchIds?: string[]) => {
        // Always track the primary clicked item for range selection
        setLastSelectedId(id);

        if (shift && lastSelectedId) {
            // Compute range between lastSelectedId and current
            const visibleItems = getVisibleItems();
            const lastIdx = visibleItems.indexOf(lastSelectedId);
            const currIdx = visibleItems.indexOf(id);

            if (lastIdx !== -1 && currIdx !== -1) {
                const start = Math.min(lastIdx, currIdx);
                const end = Math.max(lastIdx, currIdx);
                const rangeIds = visibleItems.slice(start, end + 1).filter(rid =>
                    // Exclude group-header pseudo-IDs from selection
                    !topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === rid)
                );
                onSelectBatchRegions?.(rangeIds, true, id);
                return;
            }
        }

        // Non-range: select the item + any related items (clip kids, group members)
        const allIds = batchIds && batchIds.length > 0 ? batchIds : [id];
        onSelectBatchRegions?.(allIds, multi, id);
    }, [getVisibleItems, lastSelectedId, onSelectBatchRegions, topLevelItems]);


    return {
        lastSelectedId,
        setLastSelectedId,
        handleSelectRegion
    };
}
