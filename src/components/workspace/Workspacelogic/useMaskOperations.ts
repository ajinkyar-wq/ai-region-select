import { useCallback } from 'react';
import type { ImageTileData, Region, RegionAdjustments } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { generateInvertedMask, generateUnionMask } from '@/lib/mask-analysis';
import { generateMaskPreview } from '@/lib/mask-preview';

interface UseMaskOperationsProps {
    image: ImageTileData | null;
    setImage: React.Dispatch<React.SetStateAction<ImageTileData | null>>;
    activeMask: Region | null;
    setActiveMask: React.Dispatch<React.SetStateAction<Region | null>>;
    setBrushActive: React.Dispatch<React.SetStateAction<boolean>>;
    setDrawingTool: React.Dispatch<React.SetStateAction<'linear-gradient' | 'radial-gradient' | null>>;
    setBrushMode: React.Dispatch<React.SetStateAction<'add' | 'erase'>>;
}

export function useMaskOperations({
    image,
    setImage,
    activeMask,
    setActiveMask,
    setBrushActive,
    setDrawingTool,
    setBrushMode
}: UseMaskOperationsProps) {

    const handleCreateManualMask = useCallback(() => {
        if (!image) return;

        const backgroundRegion = image.regions.find(r => r.type === 'background');
        let width = image.width;
        let height = image.height;

        if (backgroundRegion) {
            width = backgroundRegion.maskWidth;
            height = backgroundRegion.maskHeight;
        } else if (!width || !height) {
            if (image.regions.length > 0) {
                width = Math.max(...image.regions.map(r => r.maskWidth + (r.offset?.x || 0)));
                height = Math.max(...image.regions.map(r => r.maskHeight + (r.offset?.y || 0)));
            } else {
                width = 640;
                height = 640;
            }
        }
        const maskData = new Uint8Array(width * height);

        const newMask: Region = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
            type: 'manual',
            label: 'My Mask',
            maskData,
            maskWidth: width,
            maskHeight: height,
            color: REGION_COLORS.manual,
            visible: true,
            selected: true,
            hovered: false,
            hasEdits: true,
            previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
        };

        setImage(prev =>
            prev ? {
                ...prev,
                regions: [
                    ...prev.regions.map(r => ({ ...r, selected: false })),
                    newMask
                ]
            } : prev
        );

        setActiveMask(newMask);
        setBrushActive(true);
        setBrushMode('add');
        setDrawingTool(null);
    }, [image, setImage, setActiveMask, setBrushActive, setBrushMode, setDrawingTool]);

    const handleApplyEdits = useCallback(() => {
        if (!image) return;

        setImage(prev => {
            if (!prev) return prev;

            const selectedRegions = prev.regions.filter(r => r.selected);
            const existingGroup = selectedRegions.find(r => r.groupId)?.groupId;
            let targetGroupId: string | undefined = existingGroup;

            if (!targetGroupId && selectedRegions.length > 1) {
                targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
            }

            const newRegions = prev.regions.map(r => {
                if (r.selected) {
                    const previewUrl = r.previewUrl || generateMaskPreview(r.maskData, r.maskWidth, r.maskHeight, r.color);
                    return { ...r, hasEdits: true, previewUrl, groupId: targetGroupId !== undefined ? targetGroupId : r.groupId };
                }
                return r;
            });
            return { ...prev, regions: newRegions };
        });
    }, [image, setImage]);

    const handleResetMasks = useCallback(() => {
        if (!image) return;

        setImage(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                regions: prev.regions.map(r => {
                    if ((r.selected || r.id === activeMask?.id) && r.originalMaskData) {
                        return {
                            ...r,
                            maskData: new Uint8Array(r.originalMaskData),
                        };
                    }
                    return r;
                }),
            };
        });
    }, [image, setImage]);

    const handleInvertMask = useCallback((targetId?: string) => {
        if (!image) return;

        let selectedRegions: Region[] = [];
        let sourceLabel = 'Selection';
        let insertionIndex = -1;
        let targetGroupId: string | undefined = undefined;

        if (targetId) {
            const isTargetSelected = image.regions.some(r => r.id === targetId && r.selected);

            if (!isTargetSelected) {
                const groupRegions = image.regions.filter(r => r.groupId === targetId);
                if (groupRegions.length > 0) {
                    selectedRegions = groupRegions;
                    sourceLabel = 'Group';
                    let lastGroupIndex = -1;
                    for (let i = image.regions.length - 1; i >= 0; i--) {
                        if (image.regions[i].groupId === targetId) {
                            lastGroupIndex = i;
                            break;
                        }
                    }
                    insertionIndex = lastGroupIndex + 1;
                    targetGroupId = undefined;
                } else {
                    const region = image.regions.find(r => r.id === targetId);
                    if (region) {
                        selectedRegions = [region];
                        sourceLabel = region.label;
                        const idx = image.regions.findIndex(r => r.id === targetId);
                        insertionIndex = idx + 1;
                        targetGroupId = region.groupId;
                    }
                }
            }
        }

        if (selectedRegions.length === 0) {
            selectedRegions = image.regions.filter(r => r.selected);
            if (selectedRegions.length === 1) {
                sourceLabel = selectedRegions[0].label;
                const idx = image.regions.findIndex(r => r.id === selectedRegions[0].id);
                insertionIndex = idx + 1;
                targetGroupId = selectedRegions[0].groupId;
            }
            else if (selectedRegions.length > 1) {
                sourceLabel = `${selectedRegions.length} Masks`;
                let lastIdx = -1;
                for (let i = image.regions.length - 1; i >= 0; i--) {
                    if (image.regions[i].selected) {
                        lastIdx = i;
                        break;
                    }
                }
                insertionIndex = lastIdx + 1;
                const firstGroup = selectedRegions[0].groupId;
                const allSameGroup = selectedRegions.every(r => r.groupId === firstGroup);
                targetGroupId = allSameGroup ? firstGroup : undefined;
            }
        }

        if (selectedRegions.length === 0) return;

        let width = image.width;
        let height = image.height;

        if (!width || !height) {
            if (image.regions.length > 0) {
                width = Math.max(...image.regions.map(r => r.maskWidth + (r.offset?.x || 0)));
                height = Math.max(...image.regions.map(r => r.maskHeight + (r.offset?.y || 0)));
            } else {
                width = 640;
                height = 640;
            }
        }

        let newMaskData: Uint8Array;
        let labelOverride: string | undefined;

        const isPurelyAISelection = selectedRegions.every(r =>
            r.type === 'person' ||
            r.type === 'background' ||
            r.type === 'people-group'
        );

        const allAIMasks = image.regions.filter(r =>
            r.type === 'person' ||
            r.type === 'background'
        );

        if (isPurelyAISelection) {
            const selectedIds = new Set<string>();
            selectedRegions.forEach(r => {
                selectedIds.add(r.id);
                if (r.type === 'people-group') {
                    image.regions.filter(child => child.groupId === r.groupId).forEach(c => selectedIds.add(c.id));
                }
            });

            const unselectedAIMasks = allAIMasks.filter(r => !selectedIds.has(r.id));

            if (unselectedAIMasks.length > 0) {
                const maskInputs = unselectedAIMasks.map(r => ({
                    data: r.maskData,
                    width: r.maskWidth,
                    height: r.maskHeight,
                    offset: r.offset
                }));
                newMaskData = generateUnionMask(maskInputs, width, height);
                labelOverride = 'Background Mask (Generated)';
            } else {
                const maskInputs = selectedRegions.map(r => ({
                    data: r.maskData,
                    width: r.maskWidth,
                    height: r.maskHeight,
                    offset: r.offset
                }));
                newMaskData = generateInvertedMask(maskInputs, width, height);
                labelOverride = `Invert of ${sourceLabel}`;
            }
        } else {
            const maskInputs = selectedRegions.map(r => ({
                data: r.maskData,
                width: r.maskWidth,
                height: r.maskHeight,
                offset: r.offset
            }));
            newMaskData = generateInvertedMask(maskInputs, width, height);
        }

        const finalLabel = labelOverride || `Invert of ${sourceLabel}`;

        const newMask: Region = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
            type: 'manual',
            label: finalLabel,
            maskData: newMaskData,
            maskWidth: width,
            maskHeight: height,
            color: labelOverride ? REGION_COLORS['people-group'] : REGION_COLORS.manual,
            visible: true,
            selected: true,
            hovered: false,
            hasEdits: true,
            previewUrl: generateMaskPreview(newMaskData, width, height, labelOverride ? REGION_COLORS['people-group'] : REGION_COLORS.manual),
            groupId: targetGroupId,
        };

        setImage(prev => {
            if (!prev) return prev;

            const newRegions = [...prev.regions.map(r => ({ ...r, selected: false }))];

            if (insertionIndex !== -1 && insertionIndex <= newRegions.length) {
                newRegions.splice(insertionIndex, 0, newMask);
            } else {
                newRegions.push(newMask);
            }

            return {
                ...prev,
                regions: newRegions
            };
        });

        setActiveMask(newMask);
        setBrushActive(!labelOverride);
    }, [image, setImage, setActiveMask, setBrushActive]);

    const handleEditManualMask = useCallback((regionId: string) => {
        if (!image) return;

        const targetRegion = image.regions.find(r => r.id === regionId);
        if (!targetRegion) return;

        const isAI = targetRegion.type === 'person' || targetRegion.type === 'background' || targetRegion.type === 'people-group';

        setImage(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                regions: prev.regions.map(r => {
                    if (r.id === regionId) return { ...r, selected: true };

                    if (isAI) {
                        const rIsAI = r.type === 'person' || r.type === 'background' || r.type === 'people-group';
                        if (rIsAI && r.selected) return r;
                    }

                    return { ...r, selected: false };
                })
            };
        });

        if (targetRegion.type === 'manual') {
            setActiveMask(targetRegion);
            setBrushActive(true);
            setBrushMode('add');
            setDrawingTool(null);
        } else {
            setActiveMask(targetRegion);
            setBrushActive(false);
            setDrawingTool(null);
        }
    }, [image, setImage, setActiveMask, setBrushActive, setBrushMode, setDrawingTool]);

    const handleUpdateAdjustments = useCallback((adjustments: RegionAdjustments) => {
        if (!image) return;
        setImage(prev => {
            if (!prev) return prev;
            const newRegions = prev.regions.map(r => {
                if (r.selected) {
                    return { ...r, adjustments, hasEdits: true };
                }
                return r;
            });
            return { ...prev, regions: newRegions };
        });
    }, [image, setImage]);

    return {
        handleCreateManualMask,
        handleApplyEdits,
        handleResetMasks,
        handleInvertMask,
        handleEditManualMask,
        handleUpdateAdjustments
    };
}
