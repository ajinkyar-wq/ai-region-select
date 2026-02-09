import { useState } from 'react';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ChevronDown, ChevronRight, RotateCcw, Eye, EyeOff } from 'lucide-react';

export function SliderPanelContent({ onApplyEdits }: { onApplyEdits?: () => void }) {
    // --- STATE ---
    // In a real app, these would come from the active Region's properties.
    // Using local state for UI demonstration.

    const [expanded, setExpanded] = useState({
        whiteBalance: true,
        light: true,
        presence: true,
        detail: false,
        noise: false,
    });

    const [values, setValues] = useState({
        // White Balance
        temp: 7000,
        tint: 0,
        // Light
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        // Presence
        texture: 0,
        clarity: 0,
        dehaze: 0,
        vibrance: 0,
        saturation: 0,
        // Detail
        sharpening: 0,
        radius: 1.0,
        detail: 25,
        masking: 0,
        // Noise
        luminance: 0,
        color: 0
    });

    const handleChange = (key: keyof typeof values, val: number) => {
        // onApplyEdits?.(); // Call on change as well? Maybe interaction start is enough. 
        // User asked "moving the slider... should add said mask as a group".
        setValues(prev => ({ ...prev, [key]: val }));
    };

    const toggleSection = (key: keyof typeof expanded) => {
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const SectionHeader = ({
        label,
        subLabel,
        isOpen,
        onToggle,
        showReset = true,
        showEye = true
    }: {
        label: string;
        subLabel?: string;
        isOpen: boolean;
        onToggle: () => void;
        showReset?: boolean;
        showEye?: boolean;
    }) => (
        <div className="flex items-center justify-between py-2 mt-2 cursor-pointer group" onClick={onToggle}>
            <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-3 w-3 text-[#9E9E9E]" /> : <ChevronRight className="h-3 w-3 text-[#9E9E9E]" />}
                <span className="text-[11px] font-bold text-[#D9D9D9] uppercase tracking-wider">{label}</span>
                {subLabel && <span className="text-[10px] text-[#555] font-medium">{subLabel}</span>}
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                {showEye && (
                    <button className="text-[#757575] hover:text-[#D9D9D9]">
                        <Eye className="h-3.5 w-3.5" />
                    </button>
                )}
                {showReset && (
                    <button className="text-[#757575] hover:text-[#D9D9D9]">
                        <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col w-full pb-8">
            {/* WHITE BALANCE */}
            <div className="px-4 border-t border-[#2A2A2A]">
                <SectionHeader
                    label="WHITE BALANCE"
                    isOpen={expanded.whiteBalance}
                    onToggle={() => toggleSection('whiteBalance')}
                />
                {expanded.whiteBalance && (
                    <div className="flex flex-col pb-2">
                        <AdjustmentSlider
                            label="Temp"
                            value={values.temp}
                            min={2000}
                            max={50000}
                            onChange={(v) => handleChange('temp', v)}
                            gradient="linear-gradient(90deg, #4A6E99 0%, #E6E19C 100%)"
                            onInteractionStart={onApplyEdits}
                        />
                        <AdjustmentSlider
                            label="Tint"
                            value={values.tint}
                            min={-150}
                            max={150}
                            onChange={(v) => handleChange('tint', v)}
                            gradient="linear-gradient(90deg, #4A9955 0%, #AF4A99 100%)"
                            onInteractionStart={onApplyEdits}
                        />
                    </div>
                )}
            </div>

            {/* LIGHT */}
            <div className="px-4 border-t border-[#2A2A2A]">
                <SectionHeader
                    label="LIGHT"
                    isOpen={expanded.light}
                    onToggle={() => toggleSection('light')}
                />
                {expanded.light && (
                    <div className="flex flex-col pb-2">
                        <AdjustmentSlider label="Exposure" value={values.exposure} min={-5} max={5} onChange={(v) => handleChange('exposure', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Contrast" value={values.contrast} onChange={(v) => handleChange('contrast', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Highlights" value={values.highlights} onChange={(v) => handleChange('highlights', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Shadows" value={values.shadows} onChange={(v) => handleChange('shadows', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Whites" value={values.whites} onChange={(v) => handleChange('whites', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Blacks" value={values.blacks} onChange={(v) => handleChange('blacks', v)} onInteractionStart={onApplyEdits} />
                    </div>
                )}
            </div>

            {/* PRESENCE */}
            <div className="px-4 border-t border-[#2A2A2A]">
                <SectionHeader
                    label="PRESENCE"
                    isOpen={expanded.presence}
                    onToggle={() => toggleSection('presence')}
                />
                {expanded.presence && (
                    <div className="flex flex-col pb-2">
                        <AdjustmentSlider label="Texture" value={values.texture} onChange={(v) => handleChange('texture', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Clarity" value={values.clarity} onChange={(v) => handleChange('clarity', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Dehaze" value={values.dehaze} onChange={(v) => handleChange('dehaze', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider
                            label="Vibrance"
                            value={values.vibrance}
                            onChange={(v) => handleChange('vibrance', v)}
                            gradient="linear-gradient(90deg, #51506B 0%, #9E4F32 100%)"
                            onInteractionStart={onApplyEdits}
                        />
                        <AdjustmentSlider
                            label="Saturation"
                            value={values.saturation}
                            onChange={(v) => handleChange('saturation', v)}
                            gradient="linear-gradient(90deg, #52526B 0%, #9F8232 100%)"
                            onInteractionStart={onApplyEdits}
                        />
                    </div>
                )}
            </div>

            {/* DETAIL */}
            <div className="px-4 border-t border-[#2A2A2A]">
                <SectionHeader
                    label="DETAIL"
                    isOpen={expanded.detail}
                    onToggle={() => toggleSection('detail')}
                />
                {expanded.detail && (
                    <div className="flex flex-col pb-2">
                        <div className="py-1 text-[10px] font-bold text-[#757575] uppercase tracking-wider">SHARPENING</div>
                        <AdjustmentSlider label="Amount" value={values.sharpening} min={0} max={150} onChange={(v) => handleChange('sharpening', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Radius" value={values.radius} min={0.5} max={3.0} onChange={(v) => handleChange('radius', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Detail" value={values.detail} min={0} max={100} onChange={(v) => handleChange('detail', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Masking" value={values.masking} min={0} max={100} onChange={(v) => handleChange('masking', v)} onInteractionStart={onApplyEdits} />
                    </div>
                )}
            </div>

            {/* NOISE REDUCTION */}
            <div className="px-4 border-t border-[#2A2A2A]">
                <SectionHeader
                    label="MANUAL NOISE REDUCTION"
                    isOpen={expanded.noise}
                    onToggle={() => toggleSection('noise')}
                />
                {expanded.noise && (
                    <div className="flex flex-col pb-2">
                        <AdjustmentSlider label="Luminance" value={values.luminance} min={0} max={100} onChange={(v) => handleChange('luminance', v)} onInteractionStart={onApplyEdits} />
                        <AdjustmentSlider label="Color" value={values.color} min={0} max={100} onChange={(v) => handleChange('color', v)} onInteractionStart={onApplyEdits} />
                    </div>
                )}
            </div>
        </div>
    );
}
