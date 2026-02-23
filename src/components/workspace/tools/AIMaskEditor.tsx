import { useEffect, useRef, useState } from 'react';
import type { Region } from '@/types/workspace';

interface AIMaskEditorProps {
    activeRegions: Region[]; // explicit selection
    /** All person regions in the tile — needed to redirect group edits */
    allPersonRegions: Region[];
    /** Background region — always a Voronoi neighbor so it retreats/advances with person edits */
    backgroundRegion: Region | null;
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

const GROUP_VIRTUAL_ID = '__group_union__';

// ── Voronoi ownership map ────────────────────────────────────────────────────
// For every pixel, stores the index into `persons` that "owns" it.
// Pixels with existing coverage → highest-value person wins.
// Empty pixels → BFS expansion from covered pixels (nearest-neighbor Voronoi).
function buildOwnershipMap(
    persons: Array<{ maskData: Uint8Array; maskWidth: number; maskHeight: number }>,
    maskWidth: number,
    maskHeight: number
): Int16Array {
    const size = maskWidth * maskHeight;
    const ownerMap = new Int16Array(size).fill(-1);

    // Pass 1: assign pixels where a person has coverage
    for (let i = 0; i < size; i++) {
        let bestIdx = -1;
        let bestVal = 0;
        for (let pi = 0; pi < persons.length; pi++) {
            const v = persons[pi].maskData[i];
            if (v > bestVal) { bestVal = v; bestIdx = pi; }
        }
        if (bestIdx >= 0) ownerMap[i] = bestIdx;
    }

    // Pass 2: BFS outward from owned pixels to fill empty space (Voronoi)
    const queue: number[] = [];
    for (let i = 0; i < size; i++) {
        if (ownerMap[i] >= 0) queue.push(i);
    }

    const neighbors = [-1, 1, -maskWidth, maskWidth];
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        const owner = ownerMap[idx];
        const x = idx % maskWidth;

        for (const offset of neighbors) {
            const ni = idx + offset;
            if (ni < 0 || ni >= size) continue;
            if (offset === -1 && x === 0) continue;
            if (offset === 1 && x === maskWidth - 1) continue;
            if (ownerMap[ni] === -1) {
                ownerMap[ni] = owner;
                queue.push(ni);
            }
        }
    }

    // Fallback: if still unassigned (no persons at all), default to 0
    for (let i = 0; i < size; i++) {
        if (ownerMap[i] === -1) ownerMap[i] = 0;
    }

    return ownerMap;
}

// ── Person entry ─────────────────────────────────────────────────────────────
interface PersonEntry {
    id: string;
    maskData: Uint8Array;
    maskWidth: number;
    maskHeight: number;
    isActive: boolean; // true = the one being directly edited
}

export function AIMaskEditor({
    activeRegions,
    allPersonRegions,
    backgroundRegion,
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

    const isGroupEdit = activeRegions.some(r => r.type === 'people-group');

    // All person entries (active + neighbors). Used in both group and single-person mode.
    const personEntriesRef = useRef<PersonEntry[]>([]);
    // Voronoi ownership map — index into personEntriesRef
    const ownerMapRef = useRef<Int16Array>(new Int16Array(0));

    // For rendering preview
    // Group mode  → GROUP_VIRTUAL_ID → union mask
    // Normal mode → regionId → that region's mask data
    const maskDataRefs = useRef<Map<string, Uint8Array>>(new Map());

    // ── Build union from all person entries ──────────────────────────────────
    const buildUnion = (): Uint8Array => {
        const entries = personEntriesRef.current;
        if (entries.length === 0) return new Uint8Array(0);
        const size = entries[0].maskData.length;
        const union = new Uint8Array(size);
        for (const e of entries) {
            for (let i = 0; i < size; i++) {
                if (e.maskData[i] > union[i]) union[i] = e.maskData[i];
            }
        }
        return union;
    };

    // ── Initialize / sync ────────────────────────────────────────────────────
    useEffect(() => {
        maskDataRefs.current.clear();

        // Collect all person regions (persons only — background is never a Voronoi participant)
        const allPersons = allPersonRegions.length > 0
            ? allPersonRegions
            : activeRegions.filter(r => r.type === 'person');

        const activeIds = new Set(activeRegions.map(r => r.id));
        const isBackgroundEdit = activeRegions.some(r => r.type === 'background') && !isGroupEdit;

        if (isGroupEdit) {
            // Group mode: all persons are active targets
            personEntriesRef.current = allPersons.map(pr => ({
                id: pr.id,
                maskData: new Uint8Array(pr.maskData),
                maskWidth: pr.maskWidth,
                maskHeight: pr.maskHeight,
                isActive: true,
            }));

            const union = buildUnion();
            maskDataRefs.current.set(GROUP_VIRTUAL_ID, union);
        } else if (isBackgroundEdit) {
            // Background edit mode: we operate on person masks (background = 255 - union).
            // Load ALL persons as neighbors — brush modifies them, background is derived.
            // ADD on background → erase from nearest person (background claims space)
            // ERASE on background → add to nearest person (persons reclaim space)
            const bgPersonEntries = allPersons.map(pr => ({
                id: pr.id,
                maskData: new Uint8Array(pr.maskData),
                maskWidth: pr.maskWidth,
                maskHeight: pr.maskHeight,
                isActive: false,
            }));
            personEntriesRef.current = bgPersonEntries;

            // Always derive the background preview as 255 - union(persons).
            // Never use backgroundRegion.maskData directly — it may be stale or all-zeros.
            if (backgroundRegion && bgPersonEntries.length > 0) {
                const { maskWidth, maskHeight } = bgPersonEntries[0];
                const size = maskWidth * maskHeight;
                const bgPreview = new Uint8Array(size);
                for (let i = 0; i < size; i++) {
                    let maxPerson = 0;
                    for (const e of bgPersonEntries) {
                        if (e.maskData[i] > maxPerson) maxPerson = e.maskData[i];
                    }
                    bgPreview[i] = 255 - maxPerson;
                }
                maskDataRefs.current.set(backgroundRegion.id, bgPreview);
            }
        } else {
            // Single-person mode: active person(s) + all other persons as neighbors.
            // Background is NOT included — it's always recomputed by onMasksUpdate.
            const activeEntries = activeRegions
                .filter(r => r.type === 'person')
                .map(r => ({
                    id: r.id,
                    maskData: new Uint8Array(r.maskData),
                    maskWidth: r.maskWidth,
                    maskHeight: r.maskHeight,
                    isActive: true,
                }));

            const entries: PersonEntry[] = [...activeEntries];

            // Add all other persons as neighbors for pixel transfer
            for (const pr of allPersons) {
                if (!activeIds.has(pr.id)) {
                    entries.push({
                        id: pr.id,
                        maskData: new Uint8Array(pr.maskData),
                        maskWidth: pr.maskWidth,
                        maskHeight: pr.maskHeight,
                        isActive: false,
                    });
                }
            }

            personEntriesRef.current = entries;

            // Render preview only for active regions
            for (const e of entries) {
                if (e.isActive) {
                    maskDataRefs.current.set(e.id, e.maskData);
                }
            }
        }

        // Build Voronoi map from all persons (active + neighbors)
        if (personEntriesRef.current.length > 0) {
            const { maskWidth, maskHeight } = personEntriesRef.current[0];
            ownerMapRef.current = buildOwnershipMap(personEntriesRef.current, maskWidth, maskHeight);
        } else {
            ownerMapRef.current = new Int16Array(0);
        }

        renderEditorCanvas();
    }, [activeRegions, allPersonRegions]);

    // ── Canvas rendering ─────────────────────────────────────────────────────
    const renderEditorCanvas = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const color = mode === 'erase' ? [255, 80, 80] : [34, 197, 94];

        maskDataRefs.current.forEach((data, id) => {
            let maskW: number, maskH: number;
            if (id === GROUP_VIRTUAL_ID) {
                if (personEntriesRef.current.length === 0) return;
                maskW = personEntriesRef.current[0].maskWidth;
                maskH = personEntriesRef.current[0].maskHeight;
            } else {
                const entry = personEntriesRef.current.find(e => e.id === id);
                if (entry) {
                    maskW = entry.maskWidth;
                    maskH = entry.maskHeight;
                } else if (backgroundRegion && id === backgroundRegion.id) {
                    // Background mask is not in personEntriesRef — use its own dimensions
                    maskW = backgroundRegion.maskWidth;
                    maskH = backgroundRegion.maskHeight;
                } else {
                    return; // unknown id, skip
                }
            }

            const imageData = new ImageData(maskW, maskH);
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
            tempCanvas.width = maskW;
            tempCanvas.height = maskH;
            tempCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
        });
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = imageTransform.width;
        canvas.height = imageTransform.height;
        renderEditorCanvas();
    }, [canvasWidth, canvasHeight, imageTransform]);

    useEffect(() => { renderEditorCanvas(); }, [mode]);

    const lastPosRef = useRef<{ x: number, y: number } | null>(null);

    // ── Core brush: ownership-aware, works for both group and single-person ──
    //
    // For every pixel in the brush footprint, look up the Voronoi owner.
    //
    // GROUP MODE (isGroupEdit):
    //   ADD   → paint the owner's mask
    //   ERASE → erase the owner's mask
    //
    // SINGLE-PERSON MODE (!isGroupEdit):
    //   ADD   → paint the active person's mask at this pixel
    //           AND subtract the same amount from the Voronoi owner if it's a neighbor
    //           (active person "claims" pixels from neighbors)
    //   ERASE → erase the active person's mask at this pixel
    //           AND add the same amount back to the Voronoi owner if it's a neighbor
    //           (neighbor "reclaims" pixels that were erased from active person)
    const applyOwnershipAwareBrush = (
        start: { x: number, y: number },
        end: { x: number, y: number }
    ) => {
        const entries = personEntriesRef.current;
        if (entries.length === 0) return;

        const { maskWidth, maskHeight } = entries[0];
        const scaleX = maskWidth / imageTransform.width;
        const scaleY = maskHeight / imageTransform.height;

        const x0 = start.x * scaleX;
        const y0 = start.y * scaleY;
        const x1 = end.x * scaleX;
        const y1 = end.y * scaleY;

        const rIdx = Math.ceil((brushSize / 2) * Math.max(scaleX, scaleY));
        const innerRadius = rIdx * (1 - softness / 100);
        const fadeDist = Math.max(rIdx - innerRadius, 0.001);
        const targetAlpha = Math.round((opacity / 100) * 255);

        const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        const stepSize = Math.max(1, rIdx * 0.25);
        const steps = Math.ceil(dist / stepSize);
        const ownerMap = ownerMapRef.current;

        for (let si = 0; si <= steps; si++) {
            const t = steps > 0 ? si / steps : 0;
            const cx = Math.round(x0 + (x1 - x0) * t);
            const cy = Math.round(y0 + (y1 - y0) * t);

            const minX = Math.max(0, cx - rIdx);
            const maxX = Math.min(maskWidth - 1, cx + rIdx);
            const minY = Math.max(0, cy - rIdx);
            const maxY = Math.min(maskHeight - 1, cy + rIdx);

            for (let py = minY; py <= maxY; py++) {
                for (let px = minX; px <= maxX; px++) {
                    const dx = px - cx;
                    const dy = py - cy;
                    const currDist = Math.sqrt(dx * dx + dy * dy);
                    if (currDist > rIdx) continue;

                    let alphaFactor = currDist <= innerRadius
                        ? 1
                        : 1 - (currDist - innerRadius) / fadeDist;
                    alphaFactor = Math.max(0, Math.min(1, alphaFactor));
                    alphaFactor = alphaFactor * alphaFactor * (3 - 2 * alphaFactor);
                    const brushStrength = Math.round(targetAlpha * alphaFactor);
                    if (brushStrength === 0) continue;

                    const idx = py * maskWidth + px;
                    const ownerIdx = ownerMap.length > idx ? ownerMap[idx] : 0;
                    const owner = entries[ownerIdx] ?? entries[0];

                    if (isGroupEdit) {
                        // Group mode: route to the Voronoi owner (always a person)
                        if (mode === 'add') {
                            owner.maskData[idx] = Math.max(owner.maskData[idx], brushStrength);
                        } else {
                            const limit = 255 - brushStrength;
                            owner.maskData[idx] = Math.min(owner.maskData[idx], limit);
                        }
                    } else if (entries.every(e => !e.isActive)) {
                        // Background edit mode: all entries are persons (none are "active").
                        // ADD on background = erase from the nearest person (background claims space)
                        // ERASE on background = add to the nearest person (persons reclaim space)
                        if (mode === 'add') {
                            const limit = 255 - brushStrength;
                            owner.maskData[idx] = Math.min(owner.maskData[idx], limit);
                        } else {
                            owner.maskData[idx] = Math.max(owner.maskData[idx], brushStrength);
                        }
                    } else {
                        // Single-person mode
                        const activeEntry = entries.find(e => e.isActive);
                        if (!activeEntry) continue;

                        if (mode === 'add') {
                            // ADD: active person gains, Voronoi owner (another person) loses
                            const oldVal = activeEntry.maskData[idx];
                            const newVal = Math.max(oldVal, brushStrength);
                            const gained = newVal - oldVal;
                            activeEntry.maskData[idx] = newVal;

                            // Take from the Voronoi owner if it's a different person
                            if (gained > 0 && owner !== activeEntry) {
                                owner.maskData[idx] = Math.max(0, owner.maskData[idx] - gained);
                            }
                        } else {
                            // ERASE: active person loses pixels.
                            // Give them to whichever OTHER person has the highest live value
                            // at this pixel. If no other person has coverage, pixels vanish
                            // and background fills automatically via onMasksUpdate.
                            const oldVal = activeEntry.maskData[idx];
                            const limit = 255 - brushStrength;
                            const newVal = Math.min(oldVal, limit);
                            const lost = oldVal - newVal;
                            activeEntry.maskData[idx] = newVal;

                            if (lost > 0) {
                                // Find the neighbor person with the highest live value
                                let bestNeighbor: PersonEntry | null = null;
                                let bestVal = -1;
                                for (const e of entries) {
                                    if (e === activeEntry) continue;
                                    if (e.maskData[idx] > bestVal) {
                                        bestVal = e.maskData[idx];
                                        bestNeighbor = e;
                                    }
                                }
                                // Only transfer if the neighbor actually has some coverage here
                                if (bestNeighbor && bestVal > 0) {
                                    bestNeighbor.maskData[idx] = Math.min(255, bestNeighbor.maskData[idx] + lost);
                                }
                                // If bestVal === 0, no person has coverage → background fills via onMasksUpdate
                            }
                        }
                    }
                }
            }
        }

        // Update preview
        if (isGroupEdit) {
            maskDataRefs.current.set(GROUP_VIRTUAL_ID, buildUnion());
        } else if (entries.every(e => !e.isActive)) {
            // Background edit mode: rebuild background preview as complement of updated persons
            if (backgroundRegion) {
                const size = entries.length > 0 ? entries[0].maskData.length : 0;
                const bgPreview = new Uint8Array(size);
                for (let i = 0; i < size; i++) {
                    let maxPerson = 0;
                    for (const e of entries) {
                        if (e.maskData[i] > maxPerson) maxPerson = e.maskData[i];
                    }
                    bgPreview[i] = Math.max(0, 255 - maxPerson);
                }
                maskDataRefs.current.set(backgroundRegion.id, bgPreview);
            }
        } else {
            // Refresh active mask previews
            for (const e of entries) {
                if (e.isActive && maskDataRefs.current.has(e.id)) {
                    maskDataRefs.current.set(e.id, e.maskData);
                }
            }
        }
    };

    const performBrushStroke = (start: { x: number, y: number }, end: { x: number, y: number }) => {
        applyOwnershipAwareBrush(start, end);
        renderEditorCanvas();
    };

    // ── Commit: emit all modified masks ──────────────────────────────────────
    const commitUpdates = () => {
        const updates: { id: string; maskData: Uint8Array }[] = [];
        // Always emit all person entries (active + neighbors) since any may have been modified
        for (const e of personEntriesRef.current) {
            updates.push({ id: e.id, maskData: new Uint8Array(e.maskData) });
        }
        onMasksUpdate(updates);
    };

    // ── Pointer handlers ─────────────────────────────────────────────────────
    const handlePointerDown = (e: React.PointerEvent) => {
        setIsDrawing(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        performBrushStroke(point, point);
        lastPosRef.current = point;
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setCursorPos({ x, y });
        if (isDrawing && lastPosRef.current) {
            performBrushStroke(lastPosRef.current, { x, y });
            lastPosRef.current = { x, y };
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isDrawing) {
            setIsDrawing(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
            commitUpdates();
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
                <canvas ref={canvasRef} className="absolute inset-0" />

                <div
                    className="absolute pointer-events-none z-30 transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: cursorPos.x, top: cursorPos.y }}
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
                        style={{ backgroundColor: mode === 'erase' ? 'rgb(255, 80, 80)' : 'rgb(34, 197, 94)' }}
                    />
                </div>
            </div>
        </>
    );
}
