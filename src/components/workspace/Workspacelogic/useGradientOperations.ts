import { useCallback, MutableRefObject } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { generateRadialGradientMask } from '@/lib/mask-analysis';
import { generateMaskPreview } from '@/lib/mask-preview';

interface UseGradientOperationsProps {
    image: ImageTileData | null;
    setImage: React.Dispatch<React.SetStateAction<ImageTileData | null>>;
    setActiveMask: React.Dispatch<React.SetStateAction<Region | null>>;
    setBrushActive: React.Dispatch<React.SetStateAction<boolean>>;
    drawingTool: 'linear-gradient' | 'radial-gradient' | null;
    setDrawingTool: React.Dispatch<React.SetStateAction<'linear-gradient' | 'radial-gradient' | null>>;
    selectionSnapshotRef: MutableRefObject<string[]>;
}

export function useGradientOperations({
    image,
    setImage,
    setActiveMask,
    setBrushActive,
    drawingTool,
    setDrawingTool,
    selectionSnapshotRef
}: UseGradientOperationsProps) {

    const handleCreateLinearGradient = useCallback(() => {
        if (!image) return;

        selectionSnapshotRef.current = image.regions.filter(r => r.selected).map(r => r.id);

        setDrawingTool('linear-gradient');
        setImage(prev => prev ? {
            ...prev,
            regions: prev.regions.map(r => ({ ...r, selected: false }))
        } : prev);
        setBrushActive(false);
        setActiveMask(null);
    }, [image, setImage, setDrawingTool, setBrushActive, setActiveMask, selectionSnapshotRef]);

    const handleCreateRadialGradient = useCallback(() => {
        if (!image) return;

        selectionSnapshotRef.current = image.regions.filter(r => r.selected).map(r => r.id);

        setDrawingTool('radial-gradient');
        setImage(prev => prev ? {
            ...prev,
            regions: prev.regions.map(r => ({ ...r, selected: false }))
        } : prev);
        setBrushActive(false);
        setActiveMask(null);
    }, [image, setImage, setDrawingTool, setBrushActive, setActiveMask, selectionSnapshotRef]);

    const handleDrawComplete = useCallback((start: { x: number, y: number }, end: { x: number, y: number }) => {
        if (!image) return;
        const tool = drawingTool;
        setDrawingTool(null);

        const width = image.width ?? 640;
        const height = image.height ?? 640;

        const snapshotIds = selectionSnapshotRef.current;
        const selectedRegions = snapshotIds.length > 0
            ? image.regions.filter(r => snapshotIds.includes(r.id))
            : [];

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

        selectionSnapshotRef.current = [];

        if (tool === 'radial-gradient') {
            const normCenter = start;
            const radiusX = Math.abs(end.x - start.x);
            const radiusY = Math.abs(end.y - start.y);

            const rX_px = radiusX * width;
            const rY_px = radiusY * height;

            if (rX_px < 5 || rY_px < 5) {
                setDrawingTool(null);
                return;
            }

            const maskData = generateRadialGradientMask(
                width,
                height,
                normCenter,
                { x: radiusX, y: radiusY },
                0.5,
                false
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

        if (tool === 'linear-gradient') {
            const p1_px = { x: start.x * width, y: start.y * height };
            const p2_px = { x: end.x * width, y: end.y * height };

            const dx = p2_px.x - p1_px.x;
            const dy = p2_px.y - p1_px.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len < 5) {
                setDrawingTool(null);
                return;
            }

            const normStart = start;
            const normEnd = end;

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
    }, [image, drawingTool, setImage, setActiveMask, setDrawingTool, selectionSnapshotRef]);

    const handleIntersectGradient = useCallback((gradientId: string, targetId: string) => {
        if (!image) return;

        setImage(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                regions: prev.regions.map(r =>
                    r.id === gradientId
                        ? { ...r, clipParentId: targetId, groupId: undefined }
                        : r
                )
            };
        });
    }, [image, setImage]);

    return {
        handleCreateLinearGradient,
        handleCreateRadialGradient,
        handleDrawComplete,
        handleIntersectGradient
    };
}
