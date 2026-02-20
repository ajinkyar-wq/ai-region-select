
import { useCallback, useState, useRef, useEffect } from 'react';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import { TitleBar } from './TitleBar';
import { TopBar } from './TopBar';
import { Filmstrip } from './Filmstrip';
import { BottomBar } from './BottomBar';
import { SliderPanel } from './SliderPanel';
import { DraggableToolbar } from './DraggableToolbar';
import type { ImageTileData, Region, RegionAdjustments } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { Columns2, Paintbrush, Eraser } from 'lucide-react';
import { generateRadialGradientMask, generateInvertedMask, generateUnionMask, subtractMasks } from '@/lib/mask-analysis';
import { generateMaskPreview } from '@/lib/mask-preview';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled, setPeopleEnabled] = useState(true);
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [activeMask, setActiveMask] = useState<Region | null>(null);
  const [brushActive, setBrushActive] = useState(false);
  const [isLocalEditing, setIsLocalEditing] = useState(false); // For AI Mask Editor
  const [hoveredRegion, setHoveredRegion] = useState<'person' | 'background' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [brushMode, setBrushMode] = useState<'add' | 'erase'>('add');
  const [brushSize, setBrushSize] = useState([50]);
  const [brushSoftness, setBrushSoftness] = useState([20]);
  const [brushOpacity, setBrushOpacity] = useState([70]);

  // New Drawing Mode State
  const [drawingTool, setDrawingTool] = useState<'linear-gradient' | 'radial-gradient' | null>(null);

  // Clipboard State
  const [clipboard, setClipboard] = useState<Region[]>([]);

  // Selection Snapshot for Async Tools (Gradients)
  const selectionSnapshotRef = useRef<string[]>([]);

  const showMaskImage = !!image?.regions.some(r => r.selected);

  const handleCreateManualMask = () => {
    if (!image) return;

    // Use image dimensions if available, else default
    // Robust Dimension Logic (Parity with Invert)
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

    // Grouping Logic
    const selectedRegions = image.regions.filter(r => r.selected);
    let targetGroupId: string | undefined;
    const regionsToGroup: string[] = [];

    if (selectedRegions.length === 1) {
      // Single Item Selected
      if (selectedRegions[0].groupId) {
        // Add to existing group
        targetGroupId = selectedRegions[0].groupId;
      } else {
        // Create NEW group for this item + new mask
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        regionsToGroup.push(selectedRegions[0].id);
      }
    } else if (selectedRegions.length > 1) {
      // Multiple items selected
      const firstGroup = selectedRegions[0].groupId;
      const allSameGroup = selectedRegions.every(r => r.groupId === firstGroup);

      if (firstGroup && allSameGroup) {
        // All in same group -> Add to that group
        targetGroupId = firstGroup;
      } else {
        // Mixed or no group -> Create NEW group for all
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        selectedRegions.forEach(r => regionsToGroup.push(r.id));
      }
    }

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
      hasEdits: true, // Manual masks always listed
      previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
      groupId: targetGroupId,
    };

    setImage(prev =>
      prev ? {
        ...prev,
        regions: [
          ...prev.regions.map(r => {
            // Apply new Group ID to existing items if needed
            if (regionsToGroup.includes(r.id)) {
              return { ...r, groupId: targetGroupId, selected: false };
            }
            return { ...r, selected: false };
          }),
          newMask
        ]
      } : prev
    );

    setActiveMask(newMask);
    setBrushActive(true);
    setBrushMode('add'); // Default to add
    setDrawingTool(null); // Clear any other tool
  };

  const handleApplyEdits = () => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;

      const selectedRegions = prev.regions.filter(r => r.selected);

      // Grouping Logic:
      // 1. If any selected region is already in a group, we merge ALL selected regions into that group.
      //    (If multiple groups are involved, we pick the first one we encounter - "merging groups")
      // 2. If no group involved, but multiple items selected, create NEW group.
      // 3. If single item selected and no group, keep as is (or if it was in a group, it stays in it).

      const existingGroup = selectedRegions.find(r => r.groupId)?.groupId;

      let targetGroupId: string | undefined = existingGroup;

      if (!targetGroupId && selectedRegions.length > 1) {
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      }

      const newRegions = prev.regions.map(r => {
        if (r.selected) {
          const previewUrl = r.previewUrl || generateMaskPreview(r.maskData, r.maskWidth, r.maskHeight, r.color);
          // If we have a target group, enforce it. 
          // If we DON'T have a target group (single item, never grouped), keep existing groupId (undefined or whatever it was if we didn't want to ungroup).
          // Wait, if I select a grouped item and click edit, it should stay in group. 
          // This logic holds because `targetGroupId` will pick it up.
          // What if I select a grouped item AND an ungrouped item? `targetGroupId` will be the group. Both become grouped. Correct.
          return { ...r, hasEdits: true, previewUrl, groupId: targetGroupId !== undefined ? targetGroupId : r.groupId };
        }
        return r;
      });
      return { ...prev, regions: newRegions };
    });
  };

  const handleSelectBatchRegions = (ids: string[], multi: boolean, activeId?: string) => {
    if (!image) return;
    setImage({
      ...image,
      regions: image.regions.map(r => {
        // If ID is in list, select it.
        // If multi is false, deselect everything else.
        // If multi is true, keep others as they are.
        if (ids.includes(r.id)) return { ...r, selected: true };
        return multi ? r : { ...r, selected: false };
      })
    });

    // Sync Activation if activeId is provided (e.g. from single-click or Shift-Click)
    if (activeId) {
      const region = image.regions.find(r => r.id === activeId);
      if (region) {
        setActiveMask(region);
        setBrushActive(false); // Selection never activates brush — only double-click does
        setDrawingTool(null);
      }
    }
  };

  const handleMoveRegion = (id: string, targetGroupId: string | undefined, targetIndex?: number) => {
    if (!image) return;

    // Determine which regions to move
    let movingRegionIds: string[] = [];

    // Check if 'id' is a group ID first
    const isGroup = image.regions.some(r => r.groupId === id);
    // If it's a group header drag, 'id' will match a groupId but NOT a region ID (unless collision, unlikely)
    // Actually, we need to be careful. region IDs are UUIDs. group IDs are too.

    // Let's see if we find a region with this ID.
    const draggedRegion = image.regions.find(r => r.id === id);

    if (!draggedRegion) {
      // Might be a Group ID
      const regionsInGroup = image.regions.filter(r => r.groupId === id);
      if (regionsInGroup.length > 0) {
        movingRegionIds = regionsInGroup.map(r => r.id);
      } else {
        // Unknown ID
        return;
      }
    } else {
      // It's a region
      movingRegionIds = (draggedRegion.selected)
        ? image.regions.filter(r => r.selected).map(r => r.id)
        : [id];
    }

    const targetIsRegion = image.regions.find(r => r.id === targetGroupId);

    if (targetIsRegion) {
      // CASE 1: Dropped onto another region -> Create NEW Group
      const newGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

      setImage(prev => {
        if (!prev) return prev;

        let newRegions = [...prev.regions];

        // Find index of target region to insert source items there
        // We want the group to form AT the target location.
        // So we need to move movingRegions to be next to targetRegion.

        // 1. Remove moving regions
        // (Note: movingRegionIds might be multiple if multi-select merge? Assume yes)
        const movingRegionsData = newRegions.filter(r => movingRegionIds.includes(r.id));
        newRegions = newRegions.filter(r => !movingRegionIds.includes(r.id));

        // 2. Find target index (in potentially modified array? No, target is not moving)
        const targetIndex = newRegions.findIndex(r => r.id === targetGroupId);

        // 3. Update all to new group
        const updatedMoving = movingRegionsData.map(r => ({ ...r, groupId: newGroupId }));

        // 4. Update target to new group too
        if (targetIndex !== -1) {
          newRegions[targetIndex] = { ...newRegions[targetIndex], groupId: newGroupId };

          // Insert moving items AFTER target? or BEFORE?
          // "Drop onto" usually implies they become siblings.
          // Let's insert AFTER for now.
          newRegions.splice(targetIndex + 1, 0, ...updatedMoving);
        } else {
          // Fallback: just append (shouldn't happen if target found)
          newRegions.push(...updatedMoving);
        }

        // Auto-dissolve groups that now have 0 or 1 member (same as CASE 2)
        const groupCounts: Record<string, number> = {};
        newRegions.forEach(r => {
          if (r.groupId) groupCounts[r.groupId] = (groupCounts[r.groupId] || 0) + 1;
        });
        newRegions = newRegions.map(r => {
          if (r.groupId && (groupCounts[r.groupId] || 0) <= 1) {
            return { ...r, groupId: undefined };
          }
          return r;
        });

        return { ...prev, regions: newRegions };
      });
    } else {
      // CASE 2: Dropped into a Group OR Root
      // targetGroupId is the new Group ID (or undefined for Root)
      // targetIndex is the visual index in the list

      setImage(prev => {
        if (!prev) return prev;

        let newRegions = [...prev.regions];
        const movingRegions = newRegions.filter(r => movingRegionIds.includes(r.id));

        // Remove moving regions from array
        newRegions = newRegions.filter(r => !movingRegionIds.includes(r.id));

        // Update groupId for moving regions
        const updatedMovingRegions = movingRegions.map(r => {
          // If we are dragging a Group Header (isGroup is true for the DRAG SOURCE),
          // and we are simply reordering (not dropping into another group),
          // we should PRESERVE the existing groupId.

          // Logic:
          // if isGroupDrag and targetGroupId is undefined (Root), keep current groupId.
          // if isGroupDrag and targetGroupId is defined (Nested Group? Not supported yet), use target.

          // We detected `isGroup` at the top of function based on `id`.

          if (isGroup && targetGroupId === undefined) {
            return { ...r }; // Keep existing groupId
          }

          return {
            ...r,
            groupId: targetGroupId
          };
        });

        // Insert at targetIndex
        if (typeof targetIndex === 'number') {
          // Fix: targetIndex is based on "edited regions" (visible list), but regions contains everything.
          // We need to find the "Anchor Region" in the full list that corresponds to targetIndex in the filtered list.

          // 1. Get the list of regions that match the criteria used in SliderPanel (hasEdits)
          // Note: We use 'prev.regions' (BEFORE removal) to find the anchor? 
          // No, SliderPanel calculated index based on the list state *before* the drop? 
          // Usually yes. But we need to insert into `newRegions` (AFTER removal).
          // So we should find the anchor in `newRegions` (which currently lacks the moving items).

          // SliderPanel's `editedRegions` includes the moving item. 
          // If I drop at index 5, it means "I want to be at index 5".
          // If I remove the item, index 5 might shift.

          // Let's rely on finding the region that *should be after* our new position.
          // In SliderPanel, `editedRegions` is the snapshot.
          // `targetIndex` is where we want to insert.

          // Let's filter `newRegions` (which has moving items removed) to get `remainingVisibleRegions`.
          const remainingVisibleRegions = newRegions.filter(r => r.hasEdits);

          let insertIndex = newRegions.length; // Default to end

          if (targetIndex >= remainingVisibleRegions.length) {
            // Append to end of visible regions (which effectively means end of list or after last visible)
            if (remainingVisibleRegions.length > 0) {
              const lastVisible = remainingVisibleRegions[remainingVisibleRegions.length - 1];
              insertIndex = newRegions.findIndex(r => r.id === lastVisible.id) + 1;
            }
          } else {
            // Insert before the item at targetIndex
            const anchorRegion = remainingVisibleRegions[targetIndex];
            if (anchorRegion) {
              insertIndex = newRegions.findIndex(r => r.id === anchorRegion.id);
            }
          }

          newRegions.splice(insertIndex, 0, ...updatedMovingRegions);
        } else {
          // formatting fallback: append
          newRegions.push(...updatedMovingRegions);
        }

        // Auto-dissolve groups that now have 0 or 1 member
        const groupCounts: Record<string, number> = {};
        newRegions.forEach(r => {
          if (r.groupId) groupCounts[r.groupId] = (groupCounts[r.groupId] || 0) + 1;
        });
        newRegions = newRegions.map(r => {
          if (r.groupId && (groupCounts[r.groupId] || 0) <= 1) {
            return { ...r, groupId: undefined };
          }
          return r;
        });

        return {
          ...prev,
          regions: newRegions
        };
      });
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;

      // Identify masks in this group
      const groupRegions = prev.regions.filter(r => r.groupId === groupId);

      // Identify masks clipped to this group (Intersections)
      const clippedRegions = prev.regions.filter(r => r.clipParentId === groupId);

      // Combine all affected regions
      const allAffected = [...groupRegions, ...clippedRegions];

      // Separate into types for Hard vs Soft delete
      const manualToDelete = allAffected.filter(r =>
        r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient'
      );

      // AI Masks are only reset, never hard deleted via Group Delete (they return to pool)
      const aiToReset = allAffected.filter(r =>
        !manualToDelete.includes(r)
      );

      // 1. Remove Manual Masks (Hard Delete)
      // Filter out anything in manualToDelete
      let newRegions = prev.regions.filter(r => !manualToDelete.some(d => d.id === r.id));

      // 2. Reset AI Masks (Soft Delete: Ungroup, Remove Edits, Deselect)
      newRegions = newRegions.map(r => {
        if (aiToReset.some(reset => reset.id === r.id)) {
          return {
            ...r,
            groupId: undefined, // Ungroup
            hasEdits: false,    // Remove from List
            selected: false,    // Deselect
            visible: true,      // Keep on canvas
            clipParentId: undefined // Detach if it was clipped? (Unlikely for AI, but safe)
          };
        }
        return r;
      });

      return {
        ...prev,
        regions: newRegions
      };
    });
  };

  const handleEditManualMask = (regionId: string) => {
    if (!image) return;

    const targetRegion = image.regions.find(r => r.id === regionId);
    if (!targetRegion) return;

    const isAI = targetRegion.type === 'person' || targetRegion.type === 'background' || targetRegion.type === 'people-group';

    // Smart Selection Logic:
    // If AI Mask -> Preserve other SELECTED AI masks (Multi-Edit)
    // If Manual -> Enforce Single Selection (Strict Separation)

    setImage(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        regions: prev.regions.map(r => {
          // If match, ensure selected
          if (r.id === regionId) return { ...r, selected: true };

          // If we are editing AI, and 'r' is also AI and WAS selected -> Keep it.
          if (isAI) {
            const rIsAI = r.type === 'person' || r.type === 'background' || r.type === 'people-group';
            if (rIsAI && r.selected) return r;
          }

          // Otherwise deselect (Manual vs AI, or Manual vs Manual)
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
      // AI Mask / Gradient
      setActiveMask(targetRegion);
      // We DON'T toggle brush here for AI, ImageTile handles the editor overlay based on `activeMask` + Selection.
      // Actually `ImageTile` uses `onEnterLocalEdit` to set `editingRegion`.
      // `onDoubleEditRegion` calls this. 
      // We rely on `ImageTile` witnessing the selection update.
      setBrushActive(false);
      setDrawingTool(null);
    }
  };

  // Called when AI Mask Editor enters/exits in ImageTile
  const handleLocalEditChange = useCallback((isEditing: boolean) => {
    setIsLocalEditing(isEditing);
  }, []);

  const handleFileDrop = useCallback((file: File) => {
    const imageUrl = URL.createObjectURL(file);

    // Load image to get dimensions
    const img = new Image();
    img.onload = () => {
      setImage({
        id: 'single-image',
        file,
        imageUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        isProcessing: true,
        regions: [],
        selectedRegionId: null,
      });
    };
    img.src = imageUrl;
  }, []);

  // Handle Delete Key
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

          // 4. Construct new state
          // A. Filter out manual masks
          let newRegions = prev.regions.filter(r => !manualToDelete.some(del => del.id === r.id));

          // B. Reset AI masks
          newRegions = newRegions.map(r => {
            if (aiToReset.some(reset => reset.id === r.id)) {
              return {
                ...r,
                hasEdits: false,
                selected: false,
                visible: true // Reset visibility too
              };
            }
            return r;
          });

          return {
            ...prev,
            regions: newRegions
          };
        });
      }

      // Handle Escape Key (Exit Edit/Drawing Mode)
      if (e.key === 'Escape') {
        if (drawingTool) {
          setDrawingTool(null);
        }
        if (brushActive) {
          setBrushActive(false);
        }
        if (activeMask) {
          setActiveMask(null);
        }
        // Deselect all regions
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
            let newItem: Region = {
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
            // We need access to 'image' state here.
            // 'image' is in scope (closure).
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
  }, [image, activeMask, brushActive, drawingTool, clipboard]);

  const selectRegionByType = (
    type: 'person' | 'background' | null,
    edit = false
  ) => {
    if (!type || !image) return;

    if (edit) {
      const region = image.regions.find(r => r.type === type);
      if (!region) return;

      const isAI = type === 'person' || type === 'background';

      // ✅ SMART SELECTION: Preserve AI Multi-Select
      setImage(prev =>
        prev
          ? {
            ...prev,
            regions: prev.regions.map(r => {
              // If we are editing AI, and 'r' is also AI/Group and WAS selected -> Keep it.
              if (isAI) {
                const rIsAI = r.type === 'person' || r.type === 'background' || r.type === 'people-group';
                if (rIsAI && r.selected) return r;
              }
              return {
                ...r,
                selected: false,
              };
            }),
          }
          : prev
      );

      // ✅ ENTER EDIT MODE
      setActiveMask(region);
      setBrushActive(true);
      setDrawingTool(null);
      return;
    }

    const isAlreadySelected = image.regions.some(
      r => r.type === type && r.selected
    );

    setImage(prev =>
      prev
        ? {
          ...prev,
          regions: prev.regions.map(r => ({
            ...r,
            selected: isAlreadySelected ? false : r.type === type,
          })),
        }
        : prev
    );
  };

  const handleResetMasks = () => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        regions: prev.regions.map(r => {
          // Only reset selected regions that have original data
          if (r.selected && r.originalMaskData) {
            return {
              ...r,
              maskData: new Uint8Array(r.originalMaskData),
            };
          }
          return r;
        }),
      };
    });
  };

  const handleInvertMask = (targetId?: string) => {
    if (!image) return;

    let selectedRegions: Region[] = [];
    let sourceLabel = 'Selection';
    let insertionIndex = -1;
    let targetGroupId: string | undefined = undefined;

    if (targetId) {
      // Logic Update: Check if the targetId is part of the CURRENT selection.
      // If it is, we should respect the selection context and invert the WHOLE selection,
      // rather than isolating the clicked item.
      const isTargetSelected = image.regions.some(r => r.id === targetId && r.selected);
      // Also check if target is a group header that is "selected"?
      // Usually groups aren't "selected" in the region list property (children are).
      // But let's check if ALL children of the group are selected?
      // Actually, standard behavior: If I click "Invert" on a row that is SELECTED, I expect the SELECTION to be inverted.
      // If I click "Invert" on a row that is NOT selected, I expect JUST THAT ROW to be inverted.

      if (isTargetSelected) {
        // Fallback to extraction from 'selected' logic below
        selectedRegions = image.regions.filter(r => r.selected);
        // ... But we need to set sourceLabel etc.
        // Let the 'else' block handle it?
        // We can just skip this 'if (targetId)' block if it's selected.
        // But we need to be careful about `targetGroupId`.
        // If we use selection logic, `targetGroupId` is derived from selection.
        // If I click on Item A (Group X), and Item B (Group Y) is also selected.
        // Target Group? Undefined (Root).
        // This matches `else` block logic.
      } else {
        // Target is NOT selected -> Isolate it (Existing Logic)

        // Check if it's a group
        const groupRegions = image.regions.filter(r => r.groupId === targetId);
        if (groupRegions.length > 0) {
          selectedRegions = groupRegions;
          sourceLabel = 'Group';
          // Insert after the last member of the group
          // And it should be OUTSIDE the group (sibling to the group)
          let lastGroupIndex = -1;
          for (let i = image.regions.length - 1; i >= 0; i--) {
            if (image.regions[i].groupId === targetId) {
              lastGroupIndex = i;
              break;
            }
          }
          insertionIndex = lastGroupIndex + 1;
          targetGroupId = undefined; // Sibling to group = Root (or parent group? We only have 1 level for now)
        } else {
          // Check if it's a specific region
          const region = image.regions.find(r => r.id === targetId);
          if (region) {
            selectedRegions = [region];
            sourceLabel = region.label;
            // Insert after this region
            const idx = image.regions.findIndex(r => r.id === targetId);
            insertionIndex = idx + 1;
            // Sibling to region = Same Group
            targetGroupId = region.groupId;
          }
        }
      }
    }

    // specific check: if we skipped the block above because isTargetSelected was true,
    // selectedRegions is empty. We need to fill it using standard selection logic.
    if (selectedRegions.length === 0) {
      // Fallback to current selection
      selectedRegions = image.regions.filter(r => r.selected);
      if (selectedRegions.length === 1) {
        sourceLabel = selectedRegions[0].label;
        const idx = image.regions.findIndex(r => r.id === selectedRegions[0].id);
        insertionIndex = idx + 1;
        targetGroupId = selectedRegions[0].groupId;
      }
      else if (selectedRegions.length > 1) {
        sourceLabel = `${selectedRegions.length} Masks`;
        // Append to end of selection?
        let lastIdx = -1;
        for (let i = image.regions.length - 1; i >= 0; i--) {
          if (image.regions[i].selected) {
            lastIdx = i;
            break;
          }
        }
        insertionIndex = lastIdx + 1;
        // If all selected are in same group, keep in group. Else root.
        const firstGroup = selectedRegions[0].groupId;
        const allSameGroup = selectedRegions.every(r => r.groupId === firstGroup);
        targetGroupId = allSameGroup ? firstGroup : undefined;
      }
    }

    if (selectedRegions.length === 0) return;

    // Determine dimensions robustly
    // Always use the full image resolution to ensure high-fidelity inversions, especially for manual masks.
    // The mask analysis functions now handle scaling if AI masks are lower resolution.
    let width = image.width;
    let height = image.height;

    if (!width || !height) {
      // Fallback: Find max dimensions from existing regions
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

    // Smart Union Strategy:
    // If we are dealing with purely AI masks, the "Inverse" is effectively the UNION of all 
    // the UNSELECTED AI masks. This preserves the high-quality AI boundaries.
    const isPurelyAISelection = selectedRegions.every(r =>
      r.type === 'person' ||
      r.type === 'background' ||
      r.type === 'people-group'
    );

    // Get all AI masks in the image
    const allAIMasks = image.regions.filter(r =>
      r.type === 'person' ||
      r.type === 'background'
    );

    if (isPurelyAISelection) {
      // Pure AI Logic -> Always produce a "Smart" mask (Red, No Brush)

      // Find the unselected AI masks
      // IMPORTANT: If a Group is selected, its children are strictly "Selected" too.
      const selectedIds = new Set<string>();
      selectedRegions.forEach(r => {
        selectedIds.add(r.id);
        if (r.type === 'people-group') {
          // Find children of this group
          image.regions.filter(child => child.groupId === r.groupId).forEach(c => selectedIds.add(c.id));
          // Also, if the Group ITSELF is active, it might not track children via ID?
          // Actually, `groupId` links them. All persons with `groupId === selectedRegion.groupId` are selected.
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
        // Create a UNION of the unselected masks
        newMaskData = generateUnionMask(maskInputs, width, height);
        labelOverride = 'Background Mask (Generated)';
      } else {
        // Fallback: Invert Selected (e.g. Invert All People = Background)
        // Even here, we use the "Smart" appearance
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
      // Standard Inversion (Pixel-based) for Mixed/Manual selections
      const maskInputs = selectedRegions.map(r => ({
        data: r.maskData,
        width: r.maskWidth,
        height: r.maskHeight,
        offset: r.offset
      }));
      newMaskData = generateInvertedMask(maskInputs, width, height);
    }

    // Determine label
    const finalLabel = labelOverride || `Invert of ${sourceLabel}`;

    const newMask: Region = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      type: 'manual',
      label: finalLabel,
      maskData: newMaskData,
      maskWidth: width,
      maskHeight: height,
      // If it's a Smart Union (Background Mask), use a different color (e.g. Red/Group) to distinguish from Manual Green
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
    // Only activate brush if it was a standard manual invert, NOT a Smart Union
    setBrushActive(!labelOverride);
  };

  const handleCreateLinearGradient = () => {
    if (!image) return;

    // Snapshot Selection
    selectionSnapshotRef.current = image.regions.filter(r => r.selected).map(r => r.id);

    setDrawingTool('linear-gradient');
    // Clear selections while drawing
    setImage(prev => prev ? {
      ...prev,
      regions: prev.regions.map(r => ({ ...r, selected: false }))
    } : prev);
    setBrushActive(false);
    setActiveMask(null);
  };

  const handleCreateRadialGradient = () => {
    if (!image) return;

    // Snapshot Selection
    selectionSnapshotRef.current = image.regions.filter(r => r.selected).map(r => r.id);

    setDrawingTool('radial-gradient');
    // Clear selections while drawing
    setImage(prev => prev ? {
      ...prev,
      regions: prev.regions.map(r => ({ ...r, selected: false }))
    } : prev);
    setBrushActive(false);
    setActiveMask(null);
  };

  const handleUpdateAdjustments = (adjustments: RegionAdjustments) => {
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
  };

  // Callback when user finishes dragging to create gradient
  const handleDrawComplete = (start: { x: number, y: number }, end: { x: number, y: number }) => {
    if (!image) return;
    const tool = drawingTool;
    setDrawingTool(null);

    const width = image.width ?? 640;
    const height = image.height ?? 640;

    // Determine Grouping using Snapshot
    const snapshotIds = selectionSnapshotRef.current;
    const selectedRegions = snapshotIds.length > 0
      ? image.regions.filter(r => snapshotIds.includes(r.id))
      : []; // Only use snapshot for gradients as we cleared selection

    let targetGroupId: string | undefined;
    const regionsToGroup: string[] = [];

    if (selectedRegions.length === 1) {
      if (selectedRegions[0].groupId) {
        targetGroupId = selectedRegions[0].groupId;
      } else {
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        regionsToGroup.push(selectedRegions[0].id);
      }
    } else if (selectedRegions.length > 1) {
      const firstGroup = selectedRegions[0].groupId;
      const allSameGroup = selectedRegions.every(r => r.groupId === firstGroup);
      if (firstGroup && allSameGroup) {
        targetGroupId = firstGroup;
      } else {
        targetGroupId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
        selectedRegions.forEach(r => regionsToGroup.push(r.id));
      }
    }

    // Clear snapshot after use
    selectionSnapshotRef.current = [];

    if (tool === 'radial-gradient') {
      // Create Radial Gradient Region (Elliptical)
      const normCenter = start;
      const radiusX = Math.abs(end.x - start.x);
      const radiusY = Math.abs(end.y - start.y);

      // Width/Height helper
      const rX_px = radiusX * width;
      const rY_px = radiusY * height;

      // Minimum size check (5px)
      if (rX_px < 5 || rY_px < 5) {
        setDrawingTool(null);
        return;
      }

      // Generate Mask
      const maskData = generateRadialGradientMask(
        width,
        height,
        normCenter,
        { x: radiusX, y: radiusY },
        0.5, // Default Feather
        false // Not inverted
      );

      const newMask: Region = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        type: 'radial-gradient',
        label: 'Radial Gradient',
        maskData,
        maskWidth: width,
        maskHeight: height,
        color: REGION_COLORS.manual,
        radialGradient: {
          center: normCenter,
          radius: { x: radiusX, y: radiusY },
          feather: 0.5,
          invert: false
        },
        visible: true,
        selected: true,
        hovered: false,
        hasEdits: true,
        previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
        groupId: targetGroupId,
      };

      setImage(prev =>
        prev ? {
          ...prev,
          regions: [
            ...prev.regions.map(r => {
              if (regionsToGroup.includes(r.id)) {
                return { ...r, groupId: targetGroupId };
              }
              return r;
            }),
            newMask
          ]
        } : prev
      );
      setActiveMask(newMask);
      return;
    }

    // Linear Logic (Existing)
    // Linear Logic - Direct mapping (user drag IS gradient direction)
    if (tool === 'linear-gradient') {
      const p1_px = { x: start.x * width, y: start.y * height };
      const p2_px = { x: end.x * width, y: end.y * height };

      const dx = p2_px.x - p1_px.x;
      const dy = p2_px.y - p1_px.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      // Minimum drag distance check
      if (len < 5) {
        setDrawingTool(null);
        return;
      }

      // User's drag IS the gradient direction
      const normStart = start;  // 100% opacity here
      const normEnd = end;      // 0% opacity here

      // Generate mask data
      const maskData = new Uint8Array(width * height);

      const vPx = p2_px.x - p1_px.x;
      const vPy = p2_px.y - p1_px.y;
      const m2 = vPx * vPx + vPy * vPy;

      if (m2 > 0.0001) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const px = x - p1_px.x;
            const py = y - p1_px.y;
            const u = (px * vPx + py * vPy) / m2;

            let alpha = 0;
            if (u <= 0) alpha = 255;
            else if (u >= 1) alpha = 0;
            else alpha = Math.round((1 - u) * 255);

            if (alpha > 0) maskData[y * width + x] = alpha;
          }
        }
      }

      const newMask: Region = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
        type: 'linear-gradient',
        label: 'Linear Gradient',
        maskData,
        maskWidth: width,
        maskHeight: height,
        color: REGION_COLORS.manual,
        gradient: { start: normStart, end: normEnd },
        visible: true,
        selected: true,
        hovered: false,
        hasEdits: true,
        previewUrl: generateMaskPreview(maskData, width, height, REGION_COLORS.manual),
        groupId: targetGroupId,
      };

      setImage(prev =>
        prev ? {
          ...prev,
          regions: [
            ...prev.regions.map(r => {
              if (regionsToGroup.includes(r.id)) {
                return { ...r, groupId: targetGroupId };
              }
              return r;
            }),
            newMask
          ]
        } : prev
      );
      setActiveMask(newMask);
    }
  };
  /**
   * Clip a gradient to a parent mask (Intersect mode).
   *
   * The gradient is NOT deleted — it becomes a child of the target mask in the outliner.
   * Rendering is clipped live: gradient pixels are only visible where the parent mask is active.
   * The gradient can still be moved and edited independently.
   */
  const handleIntersectGradient = (gradientId: string, targetId: string) => {
    if (!image) return;

    setImage(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        regions: prev.regions.map(r =>
          r.id === gradientId
            ? { ...r, clipParentId: targetId }
            : r
        )
      };
    });
  };


  return (
    <div
      className="relative h-screen w-screen bg-[#111111] overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
    >
      {!image && (
        <div className="flex h-full w-full items-center justify-center">
          <DropZone onFileDrop={handleFileDrop} />
        </div>
      )}

      {image && (
        <div className="flex h-screen w-screen flex-col">
          <TitleBar />
          <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="relative flex flex-1 overflow-hidden">
            <div
              ref={containerRef}
              className="relative flex flex-1 flex-col overflow-hidden"
              style={{ marginRight: isPanelOpen ? 344 : 0 }}
            >

              <div className="absolute top-3 right-3 z-30 pointer-events-auto">
                <button
                  className="
                  h-9 w-9
                  rounded-md
                  bg-black/60
                  border border-white/10
                  text-white
                  flex items-center justify-center
                  hover:bg-black/80
                  transition
                  shadow-md
                 "
                  title="Compare"
                >
                  <Columns2 className="h-4 w-4 opacity-90" />
                </button>
              </div>

              {/* DraggableToolbar: Only shows when explicitly ACTIVATED (Double Click / Edit Mode) 
                  AND it's a Brush-based tool (Manual or AI Mask). Gradients use on-canvas handles. */}
              {image && (brushActive || (isLocalEditing && activeMask && activeMask.type !== 'linear-gradient' && activeMask.type !== 'radial-gradient')) && (
                <DraggableToolbar
                  containerRef={containerRef}
                  activeId={(brushActive && activeMask?.type === 'manual') ? (brushMode === 'erase' ? 'eraser' : 'brush') : 'move'}
                  onActiveChange={(id) => {
                    if (id === 'brush') {
                      setBrushActive(true);
                      setBrushMode('add');
                    } else if (id === 'eraser') {
                      setBrushActive(true);
                      setBrushMode('erase');
                    } else {
                      setBrushActive(false);
                    }
                  }}
                  // State Props
                  brushSize={brushSize}
                  onBrushSizeChange={setBrushSize}
                  brushSoftness={brushSoftness}
                  onBrushSoftnessChange={setBrushSoftness}
                  brushOpacity={brushOpacity}
                  onBrushOpacityChange={setBrushOpacity}

                  // Reset Handler
                  onResetMask={handleResetMasks}

                  items={[
                    {
                      id: 'brush',
                      icon: <Paintbrush className="h-[20px] w-[20px]" />, // aligned with 20px icon size in design
                      label: 'Brush',
                      onClick: () => {
                        setBrushActive(true);
                        setBrushMode('add');
                      },
                    },
                    {
                      id: 'eraser',
                      icon: <Eraser className="h-[20px] w-[20px]" />,
                      label: 'Eraser',
                      onClick: () => {
                        setBrushActive(true);
                        setBrushMode('erase');
                      },
                    },
                  ]}
                />
              )}

              <div className="relative flex-1 pb-[128px]">
                <ImageTile
                  tile={image}
                  selectionMode={selectionMode}
                  hoveredRegionOverride={hoveredRegion}
                  activeMask={activeMask}
                  brushActive={brushActive}
                  onBrushExit={() => setBrushActive(false)}

                  // Pass Brush State
                  brushMode={brushMode}
                  brushSize={brushSize[0]} // Pass number
                  brushSoftness={brushSoftness[0]}
                  brushOpacity={brushOpacity[0]}

                  // NEW PROPS
                  drawingTool={drawingTool}
                  onDrawComplete={handleDrawComplete}

                  peopleEnabled={peopleEnabled}
                  backgroundEnabled={backgroundEnabled}
                  onUpdateTile={(updates) => {
                    // Sync activeMask state if regions are being deselected
                    if (activeMask && updates.regions) {
                      const updatedActiveRegion = updates.regions.find(r => r.id === activeMask.id);
                      if (updatedActiveRegion && !updatedActiveRegion.selected) {
                        setActiveMask(null);
                        setBrushActive(false);
                      }
                    }

                    setImage(prev => {
                      if (!prev) return prev;

                      // Check if maskData changed for any region, if so regenerate preview
                      let regions = prev.regions;
                      if (updates.regions) {
                        regions = updates.regions.map(updatedRegion => {
                          const oldRegion = prev.regions.find(r => r.id === updatedRegion.id);
                          if (oldRegion && updatedRegion.maskData && updatedRegion.maskData !== oldRegion.maskData) {
                            // Mask changed, regenerate preview
                            const previewUrl = generateMaskPreview(
                              updatedRegion.maskData,
                              updatedRegion.maskWidth,
                              updatedRegion.maskHeight,
                              updatedRegion.color
                            );
                            return { ...updatedRegion, previewUrl };
                          }
                          return updatedRegion;
                        });
                      }

                      return { ...prev, ...updates, regions };
                    });
                  }}
                  onActivateBrush={handleEditManualMask}
                  onActivateRegion={(id) => {
                    if (!image) return;
                    const region = image.regions.find(r => r.id === id);
                    if (region) {
                      setActiveMask(region);
                      // Single-click: Select only. NEVER activate brush here.
                      // Brush is activated ONLY via double-click (onDoubleEditRegion).
                      setBrushActive(false);
                    }
                  }}
                  onEditingModeChange={handleLocalEditChange}
                />
              </div>

              <div className="absolute bottom-[42px] left-0 right-0 z-10">
                <Filmstrip />
              </div>

              <div className="absolute bottom-0 left-0 right-0 z-10">
                <BottomBar />
              </div>
            </div>

            <SliderPanel
              isOpen={isPanelOpen}
              onToggle={() => setIsPanelOpen(!isPanelOpen)}
              regions={image?.regions || []}
              onSelectRegion={(id, multi) => {
                if (!image) return;
                const newRegions = image.regions.map(r => {
                  if (r.id === id) return { ...r, selected: true };
                  return multi ? r : { ...r, selected: false };
                });
                // Only update selection state
                setImage({ ...image, regions: newRegions });

                // Sync Activation (Parity with Canvas)
                // When selecting in panel (Single Click), we set it as Active Mask but DO NOT enter edit mode (Brush).
                const region = image.regions.find(r => r.id === id);
                if (region) {
                  setActiveMask(region);
                  setBrushActive(false); // Single click = Select only

                  // Clear drawing tool if switching masks
                  setDrawingTool(null);
                }
              }}
              onActivateRegion={(id) => {
                if (!image) return;
                const region = image.regions.find(r => r.id === id);
                if (!region) return;

                // Explicit Activation -> Edit Mode
                setActiveMask(region);

                // Specific behavior per type
                if (region.type === 'manual') {
                  setBrushActive(true);
                  setBrushMode('add');
                } else if (region.type === 'person' || region.type === 'people-group' || region.type === 'background') {
                  // AI Masks: Signal Intent to Edit (ImageTile will pick up brushActive + AI type -> Enter Local Editor)
                  setBrushActive(true);
                  setBrushMode('add');
                }
                // For AI/Gradient, ImageTile's useEffect on activeMask will handle it
              }}
              onToggleVisibility={(id) => {
                if (!image) return;
                setImage({
                  ...image,
                  regions: image.regions.map(r => r.id === id ? { ...r, visible: !r.visible } : r)
                });
              }}
              onToggleBatchVisibility={(ids, visible) => {
                if (!image) return;
                setImage({
                  ...image,
                  regions: image.regions.map(r => ids.includes(r.id) ? { ...r, visible } : r)
                });
              }}
              onDeleteRegion={(id) => {
                if (!image) return;
                const region = image.regions.find(r => r.id === id);
                if (!region) return;

                const isManual = region.type === 'manual' ||
                  region.type === 'linear-gradient' ||
                  region.type === 'radial-gradient';

                setImage(prev => {
                  if (!prev) return prev;

                  // Identify the main region to delete
                  // AND any regions that are clipped to it (orphans)
                  const dependents = prev.regions.filter(r => r.clipParentId === id);
                  const regionsToDelete = [region, ...dependents];

                  // Filter sets
                  const manualToDelete = regionsToDelete.filter(r =>
                    r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient'
                  );

                  const aiToReset = regionsToDelete.filter(r =>
                    !manualToDelete.includes(r)
                  );

                  let newRegions: Region[];

                  // 1. Convert prev regions to a new list, filtering out HARD deletes
                  newRegions = prev.regions.filter(r => !manualToDelete.some(del => del.id === r.id));

                  // 2. Soft Reset AI masks
                  newRegions = newRegions.map(r => {
                    if (aiToReset.some(reset => reset.id === r.id)) {
                      return {
                        ...r,
                        hasEdits: false,
                        selected: false,
                        visible: true,
                        groupId: undefined, // Ungroup
                        clipParentId: undefined // Detach from the deleted parent
                      };
                    }
                    return r;
                  });

                  return { ...prev, regions: newRegions };
                });

                if (activeMask?.id === id) {
                  setActiveMask(null);
                  setBrushActive(false);
                }
              }}
              showMaskImage={showMaskImage}
              onCreateManualMask={handleCreateManualMask}
              onCreateLinearGradient={handleCreateLinearGradient}
              onCreateRadialGradient={handleCreateRadialGradient}
              onApplyEdits={handleApplyEdits}
              onSelectBatchRegions={handleSelectBatchRegions}
              onMoveRegion={handleMoveRegion}
              onDeleteGroup={handleDeleteGroup}
              onInvertMask={handleInvertMask}
              onIntersectGradient={handleIntersectGradient}
            />
          </div>
        </div>
      )}
    </div>
  );
}