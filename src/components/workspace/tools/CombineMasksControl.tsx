import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, Minus } from 'lucide-react';

interface CombineMasksControlProps {
    primaryLabel: string;
    secondaryCount: number;
    onAdd: () => void;
    onSubtract: () => void;
}

/**
 * Floating pill that anchors next to the cursor at the moment the secondary
 * selection changes, then stays put so the user can click it. Re-anchors only
 * when secondaryCount changes (new selection event) — not on mouse move.
 */
export function CombineMasksControl({
    primaryLabel,
    secondaryCount,
    onAdd,
    onSubtract,
}: CombineMasksControlProps) {
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const elRef = useRef<HTMLDivElement>(null);
    const mousePosRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    useLayoutEffect(() => {
        const track = (e: MouseEvent) => {
            mousePosRef.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener('mousemove', track);
        return () => window.removeEventListener('mousemove', track);
    }, []);

    useLayoutEffect(() => {
        const offsetX = 18;
        const offsetY = 18;
        const w = elRef.current?.offsetWidth ?? 240;
        const h = elRef.current?.offsetHeight ?? 36;
        const { x: mx, y: my } = mousePosRef.current;
        let x = mx + offsetX;
        let y = my + offsetY;
        if (x + w > window.innerWidth - 8) x = mx - w - offsetX;
        if (y + h > window.innerHeight - 8) y = my - h - offsetY;
        setPos({ x: Math.max(8, x), y: Math.max(8, y) });
    }, [secondaryCount]);

    return (
        <div
            ref={elRef}
            className="fixed z-[80] pointer-events-auto select-none"
            style={{
                left: pos?.x ?? -9999,
                top: pos?.y ?? -9999,
                visibility: pos ? 'visible' : 'hidden',
                fontFamily: 'Geist, sans-serif',
            }}
        >
            <div
                className="flex items-stretch gap-px rounded-md overflow-hidden"
                style={{
                    background: 'rgba(20,20,20,0.92)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <div
                    className="flex items-center px-2.5 text-[11px]"
                    style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                    <span className="truncate max-w-[120px]">{primaryLabel}</span>
                    <span className="mx-1.5 opacity-50">·</span>
                    <span>{secondaryCount}</span>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); onAdd(); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#1f6f3f] transition-colors"
                    style={{ background: 'rgba(34,197,94,0.18)' }}
                    title="Add selected masks to primary"
                >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onSubtract(); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#7a2a2a] transition-colors"
                    style={{ background: 'rgba(239,68,68,0.18)' }}
                    title="Subtract selected masks from primary"
                >
                    <Minus className="h-3.5 w-3.5" />
                    Subtract
                </button>
            </div>
        </div>
    );
}
