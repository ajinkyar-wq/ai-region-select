import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';
import { applyBrushStroke } from '@/lib/brush-engine';

interface AIMaskEditorProps {
    activeRegions: Region[]; // explicit selection
    dependencyRegions?: Region[]; // related masks (Background, Group, Children)
    imageTransform: {
        scale: number;
        x: number;
        y: number;
        width: number;
        height: number;
    };
    canvasWidth: number;
    canvasHeight: number;
    onMasksUpdate: (updates: { id: string; maskData: Uint8Array }[]) => void;
    onExit: () => void;

    mode?: 'add' | 'erase';
    brushSize?: number;
    softness?: number;
    opacity?: number;
}

export function AIMaskEditor({
    activeRegions,
    dependencyRegions = [],
    imageTransform,
    canvasWidth,
    canvasHeight,
    onMasksUpdate,
    mode = 'add',
    brushSize = 20,
    softness = 0,
    opacity = 100,
}: AIMaskEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

    // Store mask data for ALL involved regions (Active + Dependencies)
    // Map<RegionId, Uint8Array>
    const maskDataRefs = useRef<Map<string, Uint8Array>>(new Map());

    // Initialize/Sync Mask Data
    useEffect(() => {
        const allRegions = [...activeRegions, ...dependencyRegions];
        // Only update if missing or region changed (optimization chk?)
        // For safety, let's refresh if IDs change.

        // Simple sync:
        allRegions.forEach(r => {
            // Always update to match props (handling Un/Redo, Reset, or self-update)
            maskDataRefs.current.set(r.id, new Uint8Array(r.maskData));
        });

        // Cleanup old
        const currentIds = new Set(allRegions.map(r => r.id));
        for (const id of maskDataRefs.current.keys()) {
            if (!currentIds.has(id)) {
                maskDataRefs.current.delete(id);
            }
        }

        renderEditorCanvas();
    }, [activeRegions, dependencyRegions]);


    const renderEditorCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Render Dependencies first (faintly?)
        // Actually, user wants to see what they are editing.
        // Let's render ACTIVE regions clearly.
        // What about Dependencies? If I edit Person, and Background is being erased, do I see Background update?
        // Ideally yes.
        // Let's render ALL known regions in the editor? 
        // Or just the Active ones?
        // User said "Edit multiple masks...".
        // If I implicitly edit Background, seeing it change is good.
        // But rendering *everything* might be chaotic if not selected.
        // Strategy: Render Active Regions Highlighted. Render Dependencies Normal?
        // Or just Render Active.
        // Let's render Active Regions for now to keep focus. The "Smart" effect is backend logic.
        // ...Actually, looking at `ImageTile`, the `ToolLayer` is hidden/below? 
        // No, `AIMaskEditor` is on top.
        // If we don't render dependencies, the user won't see the "exclusion" happening live.
        // But maybe that's fine.

        // Color coding: Erase = Red, Add = Green.
        const color = mode === 'erase' ? [255, 80, 80] : [34, 197, 94];

        // Composite ACTIVE masks
        // We create a single buffer for preview? Or draw each?
        // Drawing each is easier.

        activeRegions.forEach(region => {
            const data = maskDataRefs.current.get(region.id);
            if (!data) return;

            const imageData = new ImageData(region.maskWidth, region.maskHeight);

            for (let i = 0; i < data.length; i++) {
                const alpha = data[i];
                if (alpha > 0) {
                    imageData.data[i * 4] = color[0];
                    imageData.data[i * 4 + 1] = color[1];
                    imageData.data[i * 4 + 2] = color[2];
                    imageData.data[i * 4 + 3] = Math.round(alpha * 0.6);
                }
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = region.maskWidth;
            tempCanvas.height = region.maskHeight;
            const tempCtx = tempCanvas.getContext('2d')!;
            tempCtx.putImageData(imageData, 0, 0);

            // Draw to main canvas (which is screen size/transform matched)
            // `imageTransform` provided is for the VIEW.
            // But `canvas` is sized to `imageTransform`?
            // In original code: `canvas.width = imageTransform.width`.
            // And `ctx.drawImage` draws full size.

            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        });
    };

    // Re-init canvas size
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = imageTransform.width;
        canvas.height = imageTransform.height;
        renderEditorCanvas();
    }, [canvasWidth, canvasHeight, imageTransform]);

    // Update preview on color change
    useEffect(() => {
        renderEditorCanvas();
    }, [mode]);

    const lastPosRef = useRef<{ x: number, y: number } | null>(null);

    const performbrushStroke = (start: { x: number, y: number }, end: { x: number, y: number }) => {
        const commonBrushOptions = {
            radius: brushSize / 2,
            softness,
            opacity,
            mode
        };

        // 1. ITERATE ACTIVE REGIONS (Explicit User Targets)
        activeRegions.forEach(activeRegion => {
            const activeData = maskDataRefs.current.get(activeRegion.id);
            if (!activeData) return;

            // Apply to Active
            applyBrushStroke(
                start,
                end,
                activeData,
                activeRegion.maskWidth,
                activeRegion.maskHeight,
                imageTransform,
                commonBrushOptions
            );

            // 2. SMART LOGIC: DEPENDENCIES
            // Determine relationships for this Active Region

            const isPerson = activeRegion.type === 'person';
            const isBackground = activeRegion.type === 'background';
            const isGroup = activeRegion.type === 'people-group';

            dependencyRegions.forEach(depRegion => {
                const depData = maskDataRefs.current.get(depRegion.id);
                if (!depData) return;

                // Mutually Exclusive Interaction (Person vs Background)
                // If Adding to Person -> Erase from Background
                // If Adding to Background -> Erase from Person

                // Note: We only check 'add' mode for exclusion usually. 
                // Erasing a person doesn't typically "restore" background (it becomes void).

                if (mode === 'add') {
                    let shouldEraseDep = false;

                    if ((isPerson || isGroup) && depRegion.type === 'background') {
                        shouldEraseDep = true;
                    } else if (isBackground && (depRegion.type === 'person' || depRegion.type === 'people-group')) {
                        shouldEraseDep = true;
                    }

                    if (shouldEraseDep) {
                        applyBrushStroke(
                            start, end, depData,
                            depRegion.maskWidth, depRegion.maskHeight,
                            imageTransform,
                            { ...commonBrushOptions, mode: 'erase', opacity: 100 } // Hard erase or shared opacity? 100 ensures cleanup.
                        );
                    }
                }

                // Group Synchronization (Bidirectional)
                // 1. Group -> Child
                // If Active is Group, and Dep is Child of that Group -> Apply SAME stroke
                if (isGroup && depRegion.type === 'person' && depRegion.groupId === activeRegion.id) {
                    applyBrushStroke(
                        start, end, depData,
                        depRegion.maskWidth, depRegion.maskHeight,
                        imageTransform,
                        commonBrushOptions // Same mode, same opacity
                    );
                }

                // 2. Child -> Group
                // If Active is Child, and Dep is GroupID matches -> Apply SAME stroke
                if (isPerson && depRegion.type === 'people-group' && activeRegion.groupId === depRegion.id) {
                    applyBrushStroke(
                        start, end, depData,
                        depRegion.maskWidth, depRegion.maskHeight,
                        imageTransform,
                        commonBrushOptions
                    );
                }
            });
        });

        renderEditorCanvas();
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDrawing(true);
        e.currentTarget.setPointerCapture(e.pointerId);

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const point = { x, y };
        performbrushStroke(point, point);
        lastPosRef.current = point;
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setCursorPos({ x, y });

        if (isDrawing && lastPosRef.current) {
            performbrushStroke(lastPosRef.current, { x, y });
            lastPosRef.current = { x, y };
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isDrawing) {
            setIsDrawing(false);
            e.currentTarget.releasePointerCapture(e.pointerId);

            // Commit Updates
            const updates: { id: string; maskData: Uint8Array }[] = [];
            maskDataRefs.current.forEach((data, id) => {
                // Determine if changed? 
                // Optimization: Track "dirty" refs.
                // For now, commit all involved seems safer to ensure sync.
                // Or just active + dependencies.
                updates.push({ id, maskData: new Uint8Array(data) });
            });

            onMasksUpdate(updates);
        }
    };

    return (
        <>
            <div
                className="absolute z-20 pointer-events-auto cursor-none"
                style={{
                    left: imageTransform.x,
                    top: imageTransform.y,
                    width: imageTransform.width,
                    height: imageTransform.height,
                    overflow: 'hidden',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onClick={(e) => e.stopPropagation()}
            >
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0"
                />

                <div
                    className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-1/2"
                    style={{
                        left: cursorPos.x,
                        top: cursorPos.y,
                    }}
                >
                    <div
                        className="rounded-full border-2 transition-all duration-75 ease-out"
                        style={{
                            width: brushSize,
                            height: brushSize,
                            borderColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.9)' : 'rgba(34, 197, 94, 0.9)',
                            backgroundColor: mode === 'erase' ? 'rgba(255, 80, 80, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                        }}
                    />
                    <div
                        className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full -translate-x-1/2 -translate-y-1/2"
                        style={{
                            backgroundColor: mode === 'erase' ? 'rgb(255, 80, 80)' : 'rgb(34, 197, 94)',
                        }}
                    />
                </div>
            </div>
        </>
    );
}
