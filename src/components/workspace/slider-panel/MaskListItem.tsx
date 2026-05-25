import { useMemo } from 'react';
import { generateMaskPreview } from '@/lib/mask-preview';
import { ChevronDown, ChevronRight, Brush, Eye, EyeOff, Trash2, Contrast, Ungroup } from 'lucide-react';
import type { Region } from '@/types/workspace';

// ----------------------------------------------------------------------
// SUB-COMPONENT: Mask List Item (Row)
// ----------------------------------------------------------------------

export function MaskListItem({
    region,
    index,
    onSelect,
    onActivate,
    onToggleVis,
    onDelete,
    onInvert,
    onDragStart,
    onDrop,
    isChild = false,
    onDragOver,
    onDragLeave,
    onDragEnd,
    onMouseEnter,
    onMouseLeave,
    dropTarget,
    isIntersectTarget = false,
    isIntersectHover = false,
    isGroupingHover = false,
    isDraggingGradient = false,
    isDragSource = false,
    dragIntent = null,
    clipChildCount = 0,
    isClipChild = false,
    hasChildren = false,
    isExpanded = false,
    onToggleExpand,
    onUngroup,
}: {
    region: Region;
    index: number;
    onSelect: (multi: boolean, shift?: boolean) => void;
    onActivate?: () => void;
    onToggleVis: () => void;
    onDelete?: () => void;
    onInvert?: () => void;
    onDragStart?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    onDragOver?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    isChild?: boolean;
    dropTarget?: 'top' | 'bottom' | 'inside' | null;
    isIntersectTarget?: boolean;
    isIntersectHover?: boolean;
    isGroupingHover?: boolean;
    isDraggingGradient?: boolean;
    isDragSource?: boolean;
    dragIntent?: 'group' | 'intersect' | null;
    clipChildCount?: number;
    isClipChild?: boolean;
    hasChildren?: boolean;
    isExpanded?: boolean;
    onToggleExpand?: () => void;
    onUngroup?: () => void;
}) {
    const Icon = getRegionIcon(region.type);

    const isGradientType = region.type === 'linear-gradient' || region.type === 'radial-gradient';
    // Show blue group ring when drop target is 'inside' — unless amber clip mode is committed
    const showGroupRing = (dropTarget === 'inside' && !isIntersectTarget) || isGroupingHover;

    // Memoised mask preview — must be at component top level (Rules of Hooks)
    const generatedPreview = useMemo(() => {
        if (!region.maskData || !region.maskWidth || !region.maskHeight) return null;
        return generateMaskPreview(region.maskData, region.maskWidth, region.maskHeight, region.color);
    }, [region.maskData, region.maskWidth, region.maskHeight, region.color]);

    return (
        <div
            className="relative overflow-hidden"
            style={{ isolation: 'isolate' }}
        >
            {/* ── Blue hover tint (Group Phase) ───────────────────────── */}
            {(isIntersectHover || isGroupingHover) && !isIntersectTarget && !isGradientType && (
                <div
                    className="absolute inset-0 pointer-events-none z-10"
                    style={{ background: 'rgba(59,130,246,0.12)' }}
                />
            )}

            {/* ── INTERSECT STATE: Full Amber Styling ─────────────────── */}
            {isIntersectTarget && !isGradientType && (
                <>
                    {/* Full Amber Background Wash */}
                    <div
                        className="absolute inset-0 pointer-events-none z-10"
                        style={{
                            background: 'linear-gradient(90deg, rgba(251,146,60,0.55) 0%, rgba(251,146,60,0.3) 60%, transparent 100%)',
                            animation: 'intersect-wipe 0.4s cubic-bezier(0.22,1,0.36,1) forwards',
                        }}
                    />
                    {/* Pulsing borders */}
                    <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none z-20 bg-orange-400"
                        style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
                    <div className="absolute inset-x-0 bottom-0 h-[2px] pointer-events-none z-20 bg-orange-400"
                        style={{ animation: 'intersect-border-pulse 0.7s ease-in-out infinite alternate' }} />
                </>
            )}

            {/* ── Clip-child accent line ──────────────────────────────── */}
            {isClipChild && (
                <>
                    {/* Subtle Left-to-Right Gradient for Clip Children */}
                    <div
                        className="absolute inset-0 pointer-events-none z-0"
                        style={{
                            background: 'linear-gradient(90deg, rgba(251,146,60,0.1) 0%, transparent 100%)',
                        }}
                    />
                    <div className="absolute left-0 top-0 bottom-0 w-[2px] pointer-events-none z-20 bg-orange-400/60" />
                </>
            )}

            {/* ── Drag Source intent overlay ─────────────────────────── */}
            {isDragSource && dragIntent === 'group' && (
                <div
                    className="absolute inset-0 pointer-events-none z-10"
                    style={{ background: 'rgba(59,130,246,0.15)', borderLeft: '2px solid rgba(59,130,246,0.7)' }}
                />
            )}
            {isDragSource && dragIntent === 'intersect' && (
                <div
                    className="absolute inset-0 pointer-events-none z-10"
                    style={{ background: 'rgba(251,146,60,0.15)', borderLeft: '2px solid rgba(251,146,60,0.7)' }}
                />
            )}

            <div
                draggable={!!onDragStart}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={(e) => {
                    if (onDragOver) { onDragOver(e); return; }
                    if (onDrop) e.preventDefault();
                }}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={(e) => {
                    // Skip the click that's part of a double-click sequence (detail === 2).
                    // The browser fires dblclick after the second click; suppressing detail >= 2
                    // ensures only true single clicks toggle selection.
                    if (e.detail >= 2) return;
                    onSelect(e.metaKey || e.ctrlKey, e.shiftKey);
                }}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    onActivate?.();
                }}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                className={`
          group flex items-center justify-between
          h-[35px] px-2 select-none
          ${onDragStart ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
          transition-colors relative z-20
          ${isDragSource ? 'opacity-50' : 'opacity-100'}
          ${showGroupRing ? 'ring-2 ring-blue-500 ring-inset' : ''}
          ${isIntersectTarget && !isGradientType ? 'ring-2 ring-orange-400 ring-inset' : ''}
          ${region.selected ? 'bg-[#04395E] text-white' : index % 2 === 0 ? 'bg-[#222222]' : 'bg-[#272727]'}
          ${!region.selected && !isIntersectTarget && 'hover:bg-[#353535] text-[#ABABAB]'}
          ${isChild ? 'pl-6' : ''}
          ${isClipChild ? 'pl-3' : ''}
          [&>*]:pointer-events-none [&_button]:pointer-events-auto
        `}
            >
                <div className="flex items-center gap-2 overflow-hidden min-w-0">

                    {/* CHEVRON TOGGLE (Group-like behavior) */}
                    {hasChildren && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand?.();
                            }}
                            className="p-0.5 hover:bg-white/10 rounded mr-[-2px]"
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-3 w-3 opacity-70" />
                            ) : (
                                <ChevronRight className="h-3 w-3 opacity-70" />
                            )}
                        </button>
                    )}

                    {isClipChild && (
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="text-orange-400 flex-shrink-0 opacity-80">
                            <path d="M5.5 8.5C5.5 8.5 6 10 8 10H10C11.657 10 13 8.657 13 7C13 5.343 11.657 4 10 4H8C6.343 4 5 5.343 5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            <path d="M8.5 5.5C8.5 5.5 8 4 6 4H4C2.343 4 1 5.343 1 7C1 8.657 2.343 10 4 10H6C7.657 10 9 8.657 9 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    )}

                    <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center bg-black/20 rounded-sm">
                        {region.previewUrl
                            ? <img src={region.previewUrl} className="w-full h-full object-contain" alt="" />
                            : generatedPreview
                                ? <img src={generatedPreview} className="w-full h-full object-contain" alt="" />
                                : Icon}
                    </div>

                    <span className={`text-[13px] truncate ${isClipChild ? 'text-orange-300/90' : ''}`}>
                        {region.label || formatType(region.type)}
                    </span>

                    {clipChildCount > 0 && (
                        <span
                            className="flex-shrink-0 ml-0.5 text-[9px] font-bold px-1 py-0 rounded-full leading-4"
                            style={{ background: 'rgba(251,146,60,0.25)', color: 'rgba(251,146,60,0.9)', border: '1px solid rgba(251,146,60,0.35)' }}
                        >
                            {clipChildCount}
                        </span>
                    )}
                </div>

                {(isIntersectHover || isGroupingHover) && !isIntersectTarget && !isGradientType && (
                    <div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                        style={{ animation: 'intersect-badge-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
                    >
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                            style={{ background: 'rgba(59,130,246,0.85)', backdropFilter: 'blur(4px)' }}>
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-white">
                                <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                                <rect x="8" y="1.5" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                                <rect x="1.5" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                                <rect x="8" y="8" width="4.5" height="4.5" rx="0.8" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                            <span className="text-[11px] font-bold text-white tracking-wide">Group</span>
                        </div>
                    </div>
                )}

                {isIntersectTarget && !isGradientType && (
                    <div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
                        style={{ animation: 'intersect-badge-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
                    >
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
                            style={{ background: 'rgba(251,146,60,0.9)', backdropFilter: 'blur(4px)' }}>
                            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                                <path d="M3 10V5.5C3 3.567 4.567 2 6.5 2H7.5C9.433 2 11 3.567 11 5.5V10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                <line x1="2" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                            <span className="text-[11px] font-bold text-white tracking-wide">Clip to Mask</span>
                        </div>
                    </div>
                )}

                {!isIntersectTarget && !isIntersectHover && !isGroupingHover && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {onInvert && (
                            <button onClick={(e) => { e.stopPropagation(); onInvert(); }}
                                className="p-1 text-[#ABABAB] opacity-0 group-hover:opacity-100 hover:text-white transition-colors" title="Invert Mask">
                                <Contrast className="h-3 w-3" />
                            </button>
                        )}
                        {onDelete && (
                            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); onToggleVis(); }}
                            className={`p-1 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity ${!region.visible ? 'text-white/40' : ''}`}>
                            {region.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function getRegionIcon(type: Region['type']) {
    const className = "h-3.5 w-3.5 opacity-70";
    switch (type) {
        case 'manual': return <Brush className={className} />;
        case 'linear-gradient': return (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className={className}>
                <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" stroke="currentColor" />
            </svg>
        );
        case 'radial-gradient': return (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" className={className}>
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" />
            </svg>
        );
        case 'person': return (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
                <path d="M8 8C9.65685 8 11 6.65685 11 5C11 3.34315 9.65685 2 8 2C6.34315 2 5 3.34315 5 5C5 6.65685 6.34315 8 8 8Z" stroke="currentColor" />
                <path d="M8 9C5.33333 9 3 11 3 14H13C13 11 10.6667 9 8 9Z" stroke="currentColor" />
            </svg>
        );
        case 'background': return (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
                <path d="M2 12L5 8L8 11L11 6L14 12H2Z" stroke="currentColor" />
            </svg>
        );
        default: return <div className="w-3.5 h-3.5 border border-dashed border-current rounded-sm opacity-50" />;
    }
}

function formatType(type: string) {
    return type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
