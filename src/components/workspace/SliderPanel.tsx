import { useState } from 'react';
import { SlidersHorizontal, Crop, ChevronDown, ChevronRight, Plus,
  Brush,
  User,
  Slash,
  Circle
 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';

interface SliderPanelProps {
  isOpen?: boolean;
  onToggle?: () => void;
  onSelectRegion: (type: 'people' | 'background' | null, edit?: boolean) => void;
  onCreateManualMask: () => void; 
  peopleEnabled: boolean;
  setPeopleEnabled: (v: boolean) => void;
  backgroundEnabled: boolean;
  setBackgroundEnabled: (v: boolean) => void;
  showMaskImage: boolean;
}

export function SliderPanel({ 
  isOpen = true, 
  onToggle,
  onSelectRegion,
  showMaskImage,
  peopleEnabled,
  setPeopleEnabled,
  backgroundEnabled,
  setBackgroundEnabled,
  onCreateManualMask,
 }: SliderPanelProps) {
  const [activeTab, setActiveTab] = useState<'sliders' | 'crop' | 'masking'>('masking');
  const [showAddMaskMenu, setShowAddMaskMenu] = useState(false);
  const [selectedMaskMode, setSelectedMaskMode] = useState<'brush' | 'linear' | 'radial' | 'range'>('brush');
  const [accordionStates, setAccordionStates] = useState({
    people: true,
    landscape: false,
    objects: false,
  });

  const toggleAccordion = (key: keyof typeof accordionStates) => {
    setAccordionStates(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay gradient at bottom */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-[344px] z-30">
        <div className="h-20 bg-gradient-to-t from-[#1C1C1C] to-transparent" />
      </div>

      {/* Panel - Full height overlay on right */}
      <div className="absolute right-0 top-0 z-40 flex h-full w-[344px] flex-col gap-[18px] overflow-y-auto bg-[#1C1C1C]/95 px-4 pt-3 pb-0 shadow-2xl backdrop-blur-[120px]">
        {/* Tab Selector */}
        <div className="flex items-end w-full gap-3">
          {/* SLIDERS TAB */}
          <button
            onClick={() => setActiveTab('sliders')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'sliders' ? 'text-white' : 'text-[#777777]'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Sliders
            </span>
            {activeTab === 'sliders' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>

          {/* CROP TAB */}
          <button
            onClick={() => setActiveTab('crop')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'crop' ? 'text-white' : 'text-[#777777]'}`}
          >
            <Crop className="h-4 w-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Crop
            </span>
            {activeTab === 'crop' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>

          {/* MASKING TAB */}
          <button
            onClick={() => setActiveTab('masking')}
            className={`relative flex items-center justify-center gap-[6px] px-1 py-2 ${activeTab === 'masking' ? 'text-[#E2E2E2]' : 'text-[#777777]'}`}
          >
            {/* Mask Icon - 16x16 with dashed border pattern */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" fillOpacity="0.1"/>
              <rect x="2.5" y="2.5" width="11" height="11" rx="0.5" stroke="currentColor" strokeDasharray="1 2"/>
            </svg>
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] leading-[1.6]">
              Masking
            </span>
            {activeTab === 'masking' && (
              <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-white" />
            )}
          </button>
        </div>

        {/* Line 237 - Divider */}
        <div className="h-[1px] w-[344px] bg-[#111111]" />

        {/* Masks Header */}
        <div className="relative flex w-[312px] items-center justify-end gap-2">
          <h2 className="flex-1 text-[14px] font-semibold leading-[1.4285714285714286] text-[#E2E2E2]" style={{ fontFamily: 'Google Sans, sans-serif' }}>Masks</h2>

          <button
            onClick={() => setShowAddMaskMenu(v => !v)}
            className="flex h-4 w-4 items-center justify-center text-white hover:opacity-80"
            aria-label="Add mask"
          >
            <Plus className="h-4 w-4" />
          </button>

          {showAddMaskMenu && (
            <div className="absolute right-0 top-9 z-50 w-[132px] rounded-lg bg-[#242424] p-1 shadow-xl border border-[#5E5E5E]">
              {/* Brush */}
<button
  onClick={() => {
    onCreateManualMask();   // ✅ CREATE MASK
    setShowAddMaskMenu(false);
  }}
  className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
>
  <Brush className="h-3 w-3 text-white" />
  <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">
    Brush
  </span>
</button>

              {/* Object */}
              <button
                onClick={() => setShowAddMaskMenu(false)}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-white">
                  <rect x="0.5" y="0.5" width="6" height="6" rx="0.5" stroke="currentColor"/>
                  <rect x="9.5" y="0.5" width="6" height="6" rx="0.5" stroke="currentColor"/>
                  <rect x="0.5" y="9.5" width="6" height="6" rx="0.5" stroke="currentColor"/>
                  <rect x="9.5" y="9.5" width="6" height="6" rx="0.5" stroke="currentColor"/>
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Object</span>
              </button>

              {/* Linear Gradient */}
              <button
                onClick={() => setShowAddMaskMenu(false)}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" stroke="#ABABAB"/>
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Linear Gradient</span>
              </button>

              {/* Radial Gradient */}
              <button
                onClick={() => setShowAddMaskMenu(false)}
                className="flex w-full items-center gap-[6px] px-2 py-2 text-left hover:bg-white/10 rounded"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="6" cy="6" r="4.5" stroke="#ABABAB"/>
                </svg>
                <span className="text-[12px] font-normal leading-[1.33] text-[#ABABAB]">Radial Gradient</span>
              </button>
            </div>
          )}
        </div>

        {/* People Accordion - Expanded */}
        <div className="flex w-[321px] flex-col justify-center gap-2">
          <button
            onClick={() => toggleAccordion('people')}
            className="flex w-full items-center gap-2"
          >
            {accordionStates.people ? (
              <ChevronDown className="h-4 w-4 text-white" />
            ) : (
              <ChevronRight className="h-4 w-4 text-white" />
            )}
            <div className="flex flex-1 items-center gap-[6px]">
              <Checkbox 
                id="people" 
                className="h-4 w-4 border-[#474747]"
                checked={peopleEnabled}
                onCheckedChange={(checked) => setPeopleEnabled(checked as boolean)}
                onClick={(e) => e.stopPropagation()}
              />
              <label htmlFor="people" className="text-[14px] font-normal leading-[1.14] text-[#E2E2E2] cursor-pointer">
                People
              </label>
            </div>
          </button>

          {accordionStates.people && (
            <div className={`flex flex-wrap gap-1 pl-6 transition-all ${
              peopleEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
            }`}>
{[
  { label: 'All People', real: true },
  {
    label: 'Person 2',
    image: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&h=200&q=80',
  },
  {
    label: 'Person 3',
    image: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=200&h=200&q=80',
  },
  {
    label: 'Person 4',
    image: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=200&h=200&q=80',
  },
].map((item, i) => (
  <div
    key={i}
    onMouseEnter={() => item.real && onSelectRegion('people')}
    onMouseLeave={() => item.real && onSelectRegion(null)}
    onClick={() => item.real && onSelectRegion('people')}
    onDoubleClick={() => item.real && onSelectRegion('people', true)}
    className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full
      ${item.real ? 'cursor-pointer bg-[#3A3A3A]' : 'bg-[#303030]'}`}
    title={item.label}
  >
    {item.real ? (
      <User className="h-4 w-4 text-white opacity-80" />
    ) : (
      <img
        src={item.image}
        alt={item.label}
        className="h-full w-full object-cover"
      />
    )}
  </div>
))}
            </div>
          )}
        </div>

        {/* Landscape Accordion - Collapsed */}
        <div className="flex w-[321px] flex-col justify-center gap-2">
          <button
            onClick={() => toggleAccordion('landscape')}
            className="flex w-full items-center gap-2"
          >
            {accordionStates.landscape ? (
              <ChevronDown className="h-4 w-4 text-white" />
            ) : (
              <ChevronRight className="h-4 w-4 text-white" />
            )}
            <div className="flex flex-1 items-center gap-[6px]">
              <Checkbox 
                id="landscape" 
                className="h-4 w-4 border-[#474747]"
                checked={backgroundEnabled}
                onCheckedChange={(checked) => setBackgroundEnabled(checked as boolean)}
                onClick={(e) => e.stopPropagation()}
              />
              <label htmlFor="landscape" className="text-[14px] font-normal leading-[1.14] text-[#ABABAB] cursor-pointer">
                Landscape
              </label>
            </div>
          </button>

          {accordionStates.landscape && (
            <div className="flex flex-col gap-6 pl-6">
              <div className={`flex flex-wrap gap-1 transition-all ${
                backgroundEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'
              }`}>
{[
  { label: 'Background', real: true },
  {
    label: 'Landscape 2',
    image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=200&h=200&q=80',
  },
  {
    label: 'Landscape 3',
    image: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=200&h=200&q=80',
  },
  {
    label: 'Landscape 4',
    image: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=200&h=200&q=80',
  },
].map((item, i) => (
  <div
    key={i}
    onMouseEnter={() => item.real && onSelectRegion('background')}
    onMouseLeave={() => item.real && onSelectRegion(null)}
    onClick={() => item.real && onSelectRegion('background')}
    onDoubleClick={() => item.real && onSelectRegion('background', true)}
    className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full
      ${item.real ? 'cursor-pointer bg-[#3A3A3A]' : 'bg-[#303030]'}`}
    title={item.label}
  >
    {item.real ? (
      <Circle className="h-4 w-4 text-white opacity-80" />
    ) : (
      <img
        src={item.image}
        alt={item.label}
        className="h-full w-full object-cover"
      />
    )}
  </div>
))}
              </div>
            </div>
          )}
        </div>

        {/* Objects Accordion - Collapsed */}
        <div className="flex w-[321px] flex-col justify-center gap-2">
          <button
            onClick={() => toggleAccordion('objects')}
            className="flex w-full items-center gap-2"
          >
            {accordionStates.objects ? (
              <ChevronDown className="h-4 w-4 text-white" />
            ) : (
              <ChevronRight className="h-4 w-4 text-white" />
            )}
            <div className="flex flex-1 items-center gap-[6px]">
              <Checkbox id="objects" className="h-4 w-4 border-[#474747]" />
              <label htmlFor="objects" className="text-[14px] font-normal leading-[1.14] text-[#E2E2E2] cursor-pointer">
                Objects
              </label>
            </div>
          </button>

          {accordionStates.objects && (
            <div className="flex flex-wrap gap-1 pl-6">
              {[
                { url: '/placeholder.svg', label: 'Object 1' },
                { url: '/placeholder.svg', label: 'Object 2' },
                { url: '/placeholder.svg', label: 'Object 3' },
                { url: '/placeholder.svg', label: 'Object 4' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[56px] bg-[#303030] p-1"
                >
                  <img src={item.url} alt={item.label} className="h-full w-full rounded-full object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>

                {showMaskImage && (
          <div className="mt-4 -mx-4">
            <img
              src="/Slider%20Panel.png"
              alt="Mask adjustment preview"
              className="w-full rounded-md border border-[#2A2A2A]"
            />
          </div>
        )}


        {/* Line 238 - Divider */}
        <div className="h-[1px] w-[344px] bg-[#111111]" />
      </div>
    </>
    
  );
}
