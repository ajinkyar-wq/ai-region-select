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
        // FIX B10: Only include real region IDs — never pseudo expansion-state keys like 'single-${id}'.
        // Group header IDs are kept as anchors but filtered out during range selection.
        const items: string[] = [];
        topLevelItems.forEach(item => {
            if ('type' in item && item.type === 'group') {
                items.push(item.id); // Group Header (filtered out later in range selection)
                // Default to expanded (true) if undefined.
                if (expandedGroups[item.id] !== false) {
                    // Only push member region IDs — clip children are shown under their parent
                    // but are NOT independently selectable via range-select
                    item.regions.forEach(r => items.push(r.id));
                }
            } else {
                items.push((item as Region).id);
            }
        });
        return items;
    }, [topLevelItems, expandedGroups]);

    const handleSelectRegion = useCallback((id: string, multi: boolean, shift: boolean) => {
        setLastSelectedId(id);

        if (shift && lastSelectedId) {
            // Find range
            const visibleItems = getVisibleItems();
            const lastIdx = visibleItems.indexOf(lastSelectedId);
            const currIdx = visibleItems.indexOf(id);

            if (lastIdx !== -1 && currIdx !== -1) {
                const start = Math.min(lastIdx, currIdx);
                const end = Math.max(lastIdx, currIdx);
                const rangeIds = visibleItems.slice(start, end + 1);

                // Filter out groups from selection if we only select regions
                const regionsToSelect = rangeIds.filter(rid =>
                    !topLevelItems.find(i => 'type' in i && i.type === 'group' && i.id === rid)
                );

                onSelectBatchRegions?.(regionsToSelect, multi, id);
                return;
            }
        }

        onSelectRegion(id, multi);
    }, [getVisibleItems, lastSelectedId, onSelectRegion, onSelectBatchRegions, topLevelItems]);

    return {
        lastSelectedId,
        setLastSelectedId,
        handleSelectRegion
    };
}
