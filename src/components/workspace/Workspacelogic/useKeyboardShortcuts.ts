import { useEffect } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';

interface UseKeyboardShortcutsProps {
    image: ImageTileData | null;
    setImage: React.Dispatch<React.SetStateAction<ImageTileData | null>>;
    activeMask: Region | null;
    setActiveMask: React.Dispatch<React.SetStateAction<Region | null>>;
    brushActive: boolean;
    setBrushActive: React.Dispatch<React.SetStateAction<boolean>>;
    isLocalEditing: boolean;
    onExitEditMode: () => void;
    drawingTool: 'linear-gradient' | 'radial-gradient' | null;
    setDrawingTool: React.Dispatch<React.SetStateAction<'linear-gradient' | 'radial-gradient' | null>>;
    clipboard: Region[];
    setClipboard: React.Dispatch<React.SetStateAction<Region[]>>;
    autoDissolveGroups: (regions: Region[]) => Region[];
    removeOrphanedClipChildren: (regions: Region[]) => Region[];
}

export function useKeyboardShortcuts({
    image,
    setImage,
    activeMask,
    setActiveMask,
    brushActive,
    setBrushActive,
    isLocalEditing,
    onExitEditMode,
    drawingTool,
    setDrawingTool,
    clipboard,
    setClipboard,
    autoDissolveGroups,
    removeOrphanedClipChildren
}: UseKeyboardShortcutsProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && image) {
                // Prevent deleting if typing in an input
                if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
                    return;
                }

                setImage(prev => {
                    if (!prev) return prev;

                    // 1. Identify masks to HARD delete (Manual/Gradient)
                    const manualToDelete = prev.regions.filter(r =>
                        (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.selected
                    );

                    // 2. Identify masks to SOFT delete/reset (AI Masks)
                    const aiToReset = prev.regions.filter(r =>
                        (r.type === 'person' || r.type === 'background' || r.type === 'people-group') && r.selected
                    );

                    if (manualToDelete.length === 0 && aiToReset.length === 0) return prev;

                    // 3. Clear Active Mask if it's being deleted/reset
                    const allAffected = [...manualToDelete, ...aiToReset];
                    if (activeMask && allAffected.some(r => r.id === activeMask.id)) {
                        setActiveMask(null);
                        setBrushActive(false);
                    }

                    // 4. Cascade: hard-delete gradients clipped to any region being removed,
                    //    and gradients clipped to groups that will be fully emptied.
                    const primaryDeleteIds = new Set(allAffected.map(r => r.id));

                    // Find groups that will have ALL their members deleted
                    const groupMemberIds: Record<string, string[]> = {};
                    prev.regions.forEach(r => {
                        if (r.groupId) {
                            if (!groupMemberIds[r.groupId]) groupMemberIds[r.groupId] = [];
                            groupMemberIds[r.groupId].push(r.id);
                        }
                    });
                    const fullyEmptiedGroups = new Set<string>();
                    Object.entries(groupMemberIds).forEach(([gId, mIds]) => {
                        if (mIds.every(mid => primaryDeleteIds.has(mid))) fullyEmptiedGroups.add(gId);
                    });

                    const cascadeDeletes = prev.regions.filter(r =>
                        r.clipParentId &&
                        (primaryDeleteIds.has(r.clipParentId) || fullyEmptiedGroups.has(r.clipParentId)) &&
                        (r.type === 'linear-gradient' || r.type === 'radial-gradient')
                    );
                    const allHardDeleteIds = new Set([...manualToDelete.map(r => r.id), ...cascadeDeletes.map(r => r.id)]);

                    // 5. Construct new state
                    // A. Filter out manual masks + cascaded clip-children
                    let newRegions = prev.regions.filter(r => !allHardDeleteIds.has(r.id));

                    // B. Reset AI masks
                    newRegions = newRegions.map(r => {
                        if (aiToReset.some(reset => reset.id === r.id)) {
                            return {
                                ...r,
                                hasEdits: false,
                                selected: false,
                                visible: true
                            };
                        }
                        return r;
                    });

                    // C. Dissolve groups that became singletons and clean up any remaining orphans
                    newRegions = autoDissolveGroups(newRegions);
                    newRegions = removeOrphanedClipChildren(newRegions);

                    return {
                        ...prev,
                        regions: newRegions
                    };
                });
            }

            // Handle Escape Key — two-step exit:
            // Step 1: if in edit/brush mode, exit edit but keep selection
            // Step 2: if already out of edit mode, deselect all
            if (e.key === 'Escape') {
                if (drawingTool) {
                    setDrawingTool(null);
                    return;
                }
                // Gradient selected — deselect it (gradient edit mode IS its selected state)
                const hasGradientSelected = image?.regions.some(r => r.selected && (r.type === 'linear-gradient' || r.type === 'radial-gradient'));
                if (hasGradientSelected) {
                    setActiveMask(null);
                    onExitEditMode();
                    if (image) {
                        setImage({ ...image, regions: image.regions.map(r => ({ ...r, selected: false })) });
                    }
                    return;
                }
                if (brushActive || isLocalEditing) {
                    setBrushActive(false);
                    onExitEditMode();
                    return;
                }
                // Not in edit mode — deselect all
                if (activeMask) setActiveMask(null);
                if (image) {
                    setImage({
                        ...image,
                        regions: image.regions.map(r => ({ ...r, selected: false })),
                    });
                }
            }


            // Handle Copy (Cmd+C)
            if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
                const selectedRegions = image.regions.filter(r => r.selected);
                if (selectedRegions.length > 0) {
                    e.preventDefault();
                    // Deep copy
                    const toCopy = selectedRegions.map(r => {
                        // Clone Uint8Array
                        const maskData = new Uint8Array(r.maskData);
                        const originalMaskData = r.originalMaskData ? new Uint8Array(r.originalMaskData) : undefined;
                        const innerMaskData = r.innerMaskData ? new Uint8Array(r.innerMaskData) : undefined;
                        return { ...r, maskData, originalMaskData, innerMaskData };
                    });
                    setClipboard(toCopy);
                    return;
                }
            }

            // Handle Paste (Cmd+V)
            if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
                if (clipboard.length > 0) {
                    e.preventDefault();

                    // 1. Prepare new items (Generate IDs and Offsets first)
                    const newItems = clipboard.map(item => {
                        const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
                        const offsetPx = 20;

                        // Clone Data
                        const maskData = new Uint8Array(item.maskData);
                        const originalMaskData = item.originalMaskData ? new Uint8Array(item.originalMaskData) : undefined;
                        const innerMaskData = item.innerMaskData ? new Uint8Array(item.innerMaskData) : undefined;

                        // Base Item
                        const newItem: Region = {
                            ...item,
                            id: newId,
                            selected: true,
                            maskData,
                            originalMaskData,
                            innerMaskData, // Preserved
                            visible: true,
                            groupId: undefined,
                        };

                        // Apply Offsets based on Image Dimensions (using current state)
                        const w = image?.width ?? 640;
                        const h = image?.height ?? 640;
                        const dx = offsetPx / w;
                        const dy = offsetPx / h;

                        if (item.type === 'linear-gradient' && item.gradient) {
                            newItem.gradient = {
                                start: { x: item.gradient.start.x + dx, y: item.gradient.start.y + dy },
                                end: { x: item.gradient.end.x + dx, y: item.gradient.end.y + dy }
                            };
                        } else if (item.type === 'radial-gradient' && item.radialGradient) {
                            newItem.radialGradient = {
                                ...item.radialGradient,
                                center: { x: item.radialGradient.center.x + dx, y: item.radialGradient.center.y + dy }
                            };
                        } else if (item.type === 'manual') {
                            newItem.offset = {
                                x: (item.offset?.x || 0) + offsetPx,
                                y: (item.offset?.y || 0) + offsetPx
                            };
                        }

                        return newItem;
                    });

                    // 2. Update Image State
                    setImage(prev => {
                        if (!prev) return prev;
                        // Deselect existing
                        const existingRegions = prev.regions.map(r => ({ ...r, selected: false }));
                        return {
                            ...prev,
                            regions: [...existingRegions, ...newItems]
                        };
                    });

                    // 3. Auto-Enter Edit Mode if Single Item
                    if (newItems.length === 1) {
                        const newItem = newItems[0];
                        setActiveMask(newItem);

                        if (newItem.type === 'manual') {
                            setBrushActive(true);
                            setDrawingTool(null);
                        } else {
                            setBrushActive(false);
                            setDrawingTool(null);
                        }
                    } else {
                        // Multi-paste: Just clear active mask to avoid confusion
                        setActiveMask(null);
                        setBrushActive(false);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [image, activeMask, brushActive, isLocalEditing, onExitEditMode, drawingTool, clipboard, setImage, setActiveMask, setBrushActive, setDrawingTool, setClipboard, autoDissolveGroups, removeOrphanedClipChildren]);
}
