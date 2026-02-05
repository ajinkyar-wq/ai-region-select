
import { useEffect, useRef } from 'react';
import type { Region, ImageTileData } from '@/types/workspace';
import { getMaskCenter } from '@/lib/mask-analysis';
import { Brush } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LinearGradientTool } from '../tools/LinearGradientTool';
import { RadialGradientTool } from '../tools/RadialGradientTool';

interface ToolLayerProps {
    width: number;
    height: number;
    imageTransform: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
    } | null;
    regions: Region[];
    excludedRegionId?: string | null;
    editingRegionId?: string | null;
    onUpdateTile?: (updates: Partial<ImageTileData>) => void;
    onEditRegion?: (regionId: string) => void;
}

export function ToolLayer({
    width,
    height,
    imageTransform,
    regions,
    excludedRegionId,
    editingRegionId,
    onUpdateTile,
    onEditRegion,
}: ToolLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Render mask
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Filter for manual & gradient masks
        // IMPORTANT: Exclude SELECTED gradients because they are rendered live by the tool
        const manualRegions = regions.filter(r =>
            (r.type === 'manual' || ((r.type === 'linear-gradient' || r.type === 'radial-gradient') && !r.selected)) &&
            r.visible &&
            r.id !== excludedRegionId
        );

        manualRegions.forEach(region => {
            const imageData = new ImageData(region.maskWidth, region.maskHeight);
            const data = region.maskData;

            // Color logic: Manual = Green, Linear/Radial Gradient = Red
            for (let i = 0; i < data.length; i++) {
                if (data[i] > 10) {
                    const idx = i * 4;
                    // Use alpha from mask for gradients
                    const opacity = data[i] / 255;

                    if (region.type === 'linear-gradient' || region.type === 'radial-gradient') {
                        imageData.data[idx] = 255;     // R
                        imageData.data[idx + 1] = 50;  // G
                        imageData.data[idx + 2] = 50;  // B
                    } else {
                        imageData.data[idx] = 50;     // R
                        imageData.data[idx + 1] = 255; // G
                        imageData.data[idx + 2] = 50;  // B
                    }
                    // Standard overlay is semi-transparent.
                    imageData.data[idx + 3] = Math.floor(opacity * 100);
                }
            }

            // Draw to canvas
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = region.maskWidth;
            tempCanvas.height = region.maskHeight;
            tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

            ctx.drawImage(tempCanvas, 0, 0, width, height);
        });

    }, [regions, width, height, excludedRegionId]);

    if (!imageTransform) return null;

    // Filter valid manual regions for interaction (Brush Icons)
    const interactiveRegions = regions
        .filter(r => r.type === 'manual' && r.visible && r.maskData && r.id !== excludedRegionId)
        .map(r => ({
            ...r,
            center: getMaskCenter(r.maskData, r.maskWidth, r.maskHeight)
        }))
        .filter(r => r.center !== null);

    const handleIconClick = (e: React.MouseEvent, region: Region) => {
        e.stopPropagation(); // prevent background deselect
        if (!onUpdateTile) return;

        const isMultiToggle = e.ctrlKey || e.metaKey;

        const updatedRegions = regions.map(r => {
            if (isMultiToggle) {
                if (r.id === region.id) {
                    return { ...r, selected: !r.selected };
                }
                return r; // Don't touch others
            }

            // Single select
            return {
                ...r,
                selected: r.id === region.id
            };
        });

        onUpdateTile({ regions: updatedRegions });
    };

    return (
        <div
            className="absolute inset-0 z-20 pointer-events-none"
            style={{
                left: imageTransform.x,
                top: imageTransform.y,
                width: imageTransform.width,
                height: imageTransform.height
            }}
        >
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="absolute inset-0 pointer-events-none"
                style={{ width: '100%', height: '100%' }}
            />

            {/* Interactive Brush Icons */}
            {interactiveRegions.map(region => {
                const scaleX = imageTransform.width / region.maskWidth;
                const scaleY = imageTransform.height / region.maskHeight;

                const x = region.center!.x * scaleX;
                const y = region.center!.y * scaleY;

                return (
                    <div
                        key={region.id}
                        className={cn(
                            "absolute pointer-events-auto cursor-pointer rounded-full p-1.5 transition-all transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 flex items-center justify-center",
                            region.selected
                                ? "bg-blue-600 text-white ring-2 ring-white shadow-lg z-50"
                                : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-white z-40"
                        )}
                        style={{
                            left: x,
                            top: y,
                        }}
                        onClick={(e) => handleIconClick(e, region)}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            onEditRegion?.(region.id);
                        }}
                    >
                        <Brush className="w-4 h-4" />
                    </div>
                );
            })}

            {/* Gradient Tools - Render all (selected will be full UI) */}
            {regions
                .filter(r => (r.type === 'linear-gradient' || r.type === 'radial-gradient') && r.visible && r.id !== excludedRegionId)
                .map(region => {
                    if (region.type === 'radial-gradient') {
                        return (
                            <RadialGradientTool
                                key={region.id}
                                imageTransform={imageTransform}
                                region={region}
                                isSelected={region.selected}
                                isEditing={region.id === editingRegionId}
                                onUpdate={(updates) => {
                                    if (!onUpdateTile) return;
                                    const updatedRegions = regions.map(r =>
                                        r.id === region.id ? { ...r, ...updates } : r
                                    );
                                    onUpdateTile({ regions: updatedRegions });
                                }}
                                onSelect={(e) => handleIconClick(e, region)}
                                onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    onEditRegion?.(region.id);
                                }}
                            />
                        );
                    }

                    return (
                        <LinearGradientTool
                            key={region.id}
                            imageTransform={imageTransform}
                            region={region}
                            isSelected={region.selected}
                            isEditing={region.id === editingRegionId}
                            onUpdate={(updates) => {
                                if (!onUpdateTile) return;
                                const updatedRegions = regions.map(r =>
                                    r.id === region.id ? { ...r, ...updates } : r
                                );
                                onUpdateTile({ regions: updatedRegions });
                            }}
                            onSelect={(e) => {
                                // Use common handle logic
                                handleIconClick(e, region);
                            }}
                            onDoubleClick={(e) => {
                                // Enter Edit Mode (Double Click)
                                e.stopPropagation();
                                onEditRegion?.(region.id);
                            }}
                        />
                    )
                })}
        </div>
    );
}
