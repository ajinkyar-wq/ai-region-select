import { useRef, useEffect, useState } from 'react';

interface AdjustmentSliderProps {
    label: string;
    value: number;
    min?: number;
    max?: number;
    onChange: (val: number) => void;
    gradient?: string; // CSS background gradient for the track
    disabled?: boolean;
    onInteractionStart?: () => void;
}

export function AdjustmentSlider({
    label,
    value,
    min = -100,
    max = 100,
    onChange,
    gradient,
    disabled = false,
    onInteractionStart
}: AdjustmentSliderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);

    // Calculate percentage for position
    // Maps value from [min, max] to [0, 100]
    const percentage = ((value - min) / (max - min)) * 100;

    const handlePointerDown = (e: React.PointerEvent) => {
        if (disabled) return;
        onInteractionStart?.();
        setIsDragging(true);
        updateValue(e.clientX);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isDragging && !disabled) {
            updateValue(e.clientX);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (isDragging) {
            setIsDragging(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
    };

    const updateValue = (clientX: number) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const percent = x / rect.width;
        const newValue = Math.round(min + percent * (max - min));
        onChange(newValue);
    };

    return (
        <div className="flex items-center justify-between py-1.5 gap-3 select-none group">
            {/* Label */}
            <span className="text-[#9E9E9E] text-[11px] font-medium w-20 truncate shrink-0">
                {label}
            </span>

            {/* Slider Track Area */}
            <div
                className="relative flex-1 h-6 flex items-center cursor-ew-resize touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                <div
                    ref={trackRef}
                    className="relative w-full h-[2px] bg-[#3E3E3E] rounded-full overflow-visible"
                >
                    {/* Gradient Overlay if provided */}
                    {gradient && (
                        <div
                            className="absolute inset-0 rounded-full opacity-60"
                            style={{ background: gradient }}
                        />
                    )}

                    {/* Center Tick */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[1px] h-2 bg-[#1C1C1C] z-10" />

                    {/* Active Tick/Thumb */}
                    <div
                        className="absolute top-1/2 -translate-y-1/2 w-[2px] h-3 bg-[#D9D9D9] shadow-sm transform -translate-x-1/2 transition-transform duration-75 ease-out group-hover:scale-y-110 group-active:scale-y-125"
                        style={{ left: `${percentage}%` }}
                    />

                    {/* Colored Fill (optional - if we want to show 'fill' from center) */}
                    {/* For now closely matching Figma which just shows the thumb on a track */}
                </div>
            </div>

            {/* Value Display */}
            <span className={`text-[11px] font-medium w-8 text-right tabular-nums ${value !== 0 ? 'text-[#D9D9D9]' : 'text-[#757575]'}`}>
                {value}
            </span>
        </div>
    );
}
