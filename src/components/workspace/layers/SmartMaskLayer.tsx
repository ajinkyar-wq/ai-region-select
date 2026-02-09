import { useEffect, useRef, useState } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';

interface SmartMaskLayerProps {
    tile: ImageTileData;
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
    width: number;
    height: number;
    peopleEnabled: boolean;
    backgroundEnabled: boolean;
    hoveredRegionId: string | null;
    isEditing: boolean;
    onHoverChange: (id: string | null) => void;
    onUpdateTile: (updates: Partial<ImageTileData>) => void;
    onEditRegion: (region: Region) => void;
}

export function SmartMaskLayer({
    tile,
    imageTransform,
    width,
    height,
    peopleEnabled,
    backgroundEnabled,
    hoveredRegionId,
    isEditing,
    onHoverChange,
    onUpdateTile,
    onEditRegion,
}: SmartMaskLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Render masks to overlay canvas
    useEffect(() => {
        if (!canvasRef.current || !imageTransform) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Update canvas size matches props
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 🚫 DO NOT render ANY masks while editing
        if (isEditing) {
            return;
        }

        const visibleRegions = tile.regions.filter(r => {
            if (r.type === 'person' && !peopleEnabled) return false;
            if (r.type === 'background' && !backgroundEnabled) return false;
            // Manual masks are handled by Layer 3 (ToolLayer)
            if (r.type === 'manual' || r.type === 'linear-gradient' || r.type === 'radial-gradient') return false;
            return r.visible;
        });

        visibleRegions.forEach(region => {
            const isHovered = region.id === hoveredRegionId;
            const isSelected = region.selected;

            const mask = region.maskData;
            const inner = region.innerMaskData;

            const w = region.maskWidth;
            const h = region.maskHeight;

            // Base fill (UNCHANGED SHAPE)
            const imageData = new ImageData(w, h);

            const colorMatch = region.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
            const r = colorMatch ? parseInt(colorMatch[1], 16) : 255;
            const g = colorMatch ? parseInt(colorMatch[2], 16) : 80;
            const b = colorMatch ? parseInt(colorMatch[3], 16) : 80;

            const baseAlpha =
                region.type === 'manual' ? 200 : // Always visible
                    isSelected ? 110 :
                        isHovered ? 75 :
                            0;

            // ---- PASS 1: NORMAL MASK RENDER (NO DISTORTION)
            for (let i = 0; i < mask.length; i++) {
                const maskVal = mask[i];
                if (maskVal <= 0 || baseAlpha === 0) continue;

                const idx = i * 4;
                imageData.data[idx] = r;
                imageData.data[idx + 1] = g;
                imageData.data[idx + 2] = b;
                // Scale baseAlpha by mask value (maskVal / 255)
                imageData.data[idx + 3] = Math.round((maskVal / 255) * baseAlpha);
            }

            // ---- PASS 2: INNER↔OUTER SEPARATION LINE (ONLY)
            if ((isHovered || isSelected) && inner) {
                const lineAlpha = isSelected ? 220 : 170;

                for (let y = 1; y < h - 1; y++) {
                    for (let x = 1; x < w - 1; x++) {
                        const i = y * w + x;

                        // Must be OUTER pixel
                        if (mask[i] <= 0 || inner[i] > 0) continue;

                        // Check 4-neighbors for INNER
                        if (
                            inner[i - 1] > 0 ||
                            inner[i + 1] > 0 ||
                            inner[i - w] > 0 ||
                            inner[i + w] > 0
                        ) {
                            const idx = i * 4;
                            imageData.data[idx] = r;
                            imageData.data[idx + 1] = g;
                            imageData.data[idx + 2] = b;
                            imageData.data[idx + 3] = lineAlpha;
                        }
                    }
                }
            }

            // ---- DRAW
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

            // ---- PASS A: BASE TINT
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(
                tempCanvas,
                imageTransform.x,
                imageTransform.y,
                imageTransform.width,
                imageTransform.height
            );
            ctx.restore();

            // ---- PASS B: GLASS LIGHTING
            if (isHovered || isSelected) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.globalAlpha = 0.45;      // SAME AS GROUP
                ctx.shadowColor = region.color;
                ctx.shadowBlur = 16;         // SAME AS GROUP

                ctx.drawImage(
                    tempCanvas,
                    imageTransform.x,
                    imageTransform.y,
                    imageTransform.width,
                    imageTransform.height
                );
                ctx.restore();
            }
        });

        // ---- GROUP INNER CONTOURS (from individual people)
        const isGroupActive = tile.regions.some(
            r => r.type === 'people-group' &&
                (r.id === hoveredRegionId || r.selected)
        );

        if (isGroupActive) {
            const lineAlpha = 170;

            tile.regions
                .filter(r => r.type === 'person' && r.innerMaskData)
                .forEach(person => {
                    const w = person.maskWidth;
                    const h = person.maskHeight;
                    const mask = person.maskData;
                    const inner = person.innerMaskData!;

                    const imageData = new ImageData(w, h);

                    const colorMatch = person.color.match(/#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})/i);
                    const r = colorMatch ? parseInt(colorMatch[1], 16) : 255;
                    const g = colorMatch ? parseInt(colorMatch[2], 16) : 80;
                    const b = colorMatch ? parseInt(colorMatch[3], 16) : 80;

                    for (let y = 1; y < h - 1; y++) {
                        for (let x = 1; x < w - 1; x++) {
                            const i = y * w + x;

                            if (mask[i] <= 0 || inner[i] > 0) continue;

                            if (
                                inner[i - 1] > 0 ||
                                inner[i + 1] > 0 ||
                                inner[i - w] > 0 ||
                                inner[i + w] > 0
                            ) {
                                const idx = i * 4;
                                imageData.data[idx] = r;
                                imageData.data[idx + 1] = g;
                                imageData.data[idx + 2] = b;
                                imageData.data[idx + 3] = lineAlpha;
                            }
                        }
                    }

                    const temp = document.createElement('canvas');
                    temp.width = w;
                    temp.height = h;
                    temp.getContext('2d')!.putImageData(imageData, 0, 0);

                    ctx.drawImage(
                        temp,
                        imageTransform.x,
                        imageTransform.y,
                        imageTransform.width,
                        imageTransform.height
                    );
                    ctx.save();
                    ctx.globalCompositeOperation = 'screen';
                    ctx.globalAlpha = 0.45;
                    ctx.shadowColor = person.color;
                    ctx.shadowBlur = 16;

                    ctx.drawImage(
                        temp,
                        imageTransform.x,
                        imageTransform.y,
                        imageTransform.width,
                        imageTransform.height
                    );
                    ctx.restore();

                });
        }

    }, [
        tile.regions,
        imageTransform,
        hoveredRegionId,
        isEditing,
        peopleEnabled,
        backgroundEnabled,
        width,
        height
    ]);

    function hitTestPersonRegion(
        x: number,
        y: number,
        region: Region,
        imageTransform: {
            width: number;
            height: number;
        }
    ): 'inner' | 'outer' | null {
        const scaleX = region.maskWidth / imageTransform.width;
        const scaleY = region.maskHeight / imageTransform.height;

        const mx = Math.floor(x * scaleX);
        const my = Math.floor(y * scaleY);
        const idx = my * region.maskWidth + mx;

        if (idx < 0 || idx >= region.maskData.length) return null;

        if (region.maskData[idx] <= 128) return null;

        if (region.innerMaskData && region.innerMaskData[idx] > 128) {
            return 'inner';
        }

        return 'outer';
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isEditing) return;

        const canvas = canvasRef.current;
        if (!canvas || !imageTransform) return;

        const rect = canvas.getBoundingClientRect();
        const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
        const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

        const x = canvasX - imageTransform.x;
        const y = canvasY - imageTransform.y;

        if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) {
            onHoverChange(null);
            return;
        }

        // PERSONS FIRST
        for (let i = tile.regions.length - 1; i >= 0; i--) {
            const region = tile.regions[i];
            if (region.type !== 'person' || !peopleEnabled) continue;

            const hit = hitTestPersonRegion(x, y, region, imageTransform);
            if (!hit) continue;

            if (hit === 'inner') {
                onHoverChange(region.id);
            } else {
                const group = tile.regions.find(r => r.type === 'people-group');
                onHoverChange(group ? group.id : null);
            }
            return;
        }

        // BACKGROUND
        const bg = tile.regions.find(r => r.type === 'background');
        if (bg && backgroundEnabled) {
            const scaleX = bg.maskWidth / imageTransform.width;
            const scaleY = bg.maskHeight / imageTransform.height;
            const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);
            // Check bounds
            if (idx >= 0 && idx < bg.maskData.length && bg.maskData[idx] > 128) {
                onHoverChange(bg.id);
                return;
            }
        }

        onHoverChange(null);
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        const isMultiToggle = e.ctrlKey || e.metaKey || e.shiftKey;
        if (isEditing) {
            // Should probably not happen due to layer ordering or logic, but safety first
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas || !imageTransform) return;

        const rect = canvas.getBoundingClientRect();
        const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
        const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

        const x = canvasX - imageTransform.x;
        const y = canvasY - imageTransform.y;

        // Check if click is within image bounds
        if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) {
            onUpdateTile({ regions: tile.regions.map(r => ({ ...r, selected: false })) });
            return;
        }

        // Check which region was clicked
        let clickedRegion: Region | null = null;

        for (let i = tile.regions.length - 1; i >= 0; i--) {
            const region = tile.regions[i];
            if ((region.type === 'person' && !peopleEnabled) ||
                (region.type === 'background' && !backgroundEnabled)) {
                continue;
            }

            if (region.type === 'person') {
                const hit = hitTestPersonRegion(x, y, region, imageTransform);
                if (!hit) continue;

                if (hit === 'inner') {
                    clickedRegion = region;
                } else {
                    clickedRegion =
                        tile.regions.find(r => r.type === 'people-group') ?? null;
                }
                break;
            }

            if (!clickedRegion && backgroundEnabled) {
                const bg = tile.regions.find(r => r.type === 'background');
                if (bg) {
                    const scaleX = bg.maskWidth / imageTransform.width;
                    const scaleY = bg.maskHeight / imageTransform.height;

                    const mx = Math.floor(x * scaleX);
                    const my = Math.floor(y * scaleY);
                    const idx = my * bg.maskWidth + mx;

                    if (idx >= 0 && idx < bg.maskData.length && bg.maskData[idx] > 128) {
                        clickedRegion = bg;
                    }
                }
            }

        }

        if (clickedRegion) {
            const updatedRegions = tile.regions.map(r => {
                // ⌘ / Ctrl + click → toggle ONLY this region
                if (isMultiToggle) {
                    if (r.id === clickedRegion!.id) {
                        return { ...r, selected: !r.selected };
                    }
                    return r; // ← DO NOT TOUCH OTHERS
                }

                // Normal click → single select
                return {
                    ...r,
                    selected: r.id === clickedRegion!.id,
                };
            });

            onUpdateTile({ regions: updatedRegions });
        } else {
            // Clicked empty space → clear selection (ONLY if not multi-toggle)
            if (!isMultiToggle) {
                onUpdateTile({
                    regions: tile.regions.map(r => ({ ...r, selected: false })),
                });
            }
        }
    };

    const handleCanvasDoubleClick = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas || !imageTransform) return;

        const rect = canvas.getBoundingClientRect();
        const canvasX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
        const canvasY = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

        const x = canvasX - imageTransform.x;
        const y = canvasY - imageTransform.y;

        if (x < 0 || y < 0 || x >= imageTransform.width || y >= imageTransform.height) return;

        for (let i = tile.regions.length - 1; i >= 0; i--) {
            const region = tile.regions[i];
            if ((region.type === 'person' && !peopleEnabled) ||
                (region.type === 'background' && !backgroundEnabled)) {
                continue;
            }
            if (region.type === 'person') {
                const hit = hitTestPersonRegion(x, y, region, imageTransform);
                if (!hit) continue;

                if (hit === 'inner') {
                    onEditRegion(region);
                } else {
                    const group = tile.regions.find(r => r.type === 'people-group');
                    if (group) onEditRegion(group);
                }
                return;
            }
            const bg = tile.regions.find(r => r.type === 'background');
            if (bg && backgroundEnabled) {
                const scaleX = bg.maskWidth / imageTransform.width;
                const scaleY = bg.maskHeight / imageTransform.height;
                const idx = Math.floor(y * scaleY) * bg.maskWidth + Math.floor(x * scaleX);

                if (idx >= 0 && idx < bg.maskData.length && bg.maskData[idx] > 128) {
                    onEditRegion(bg);
                    return;
                }
            }
        }
    };

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 z-10 pointer-events-auto cursor-pointer"
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => onHoverChange(null)}
        />
    );
}
