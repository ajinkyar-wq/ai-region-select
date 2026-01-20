import { useCallback, useState } from 'react';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import { TitleBar } from './TitleBar';
import { TopBar } from './TopBar';
import { Filmstrip } from './Filmstrip';
import { BottomBar } from './BottomBar';
import { SliderPanel } from './SliderPanel';
import type { ImageTileData } from '@/types/workspace';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled, setPeopleEnabled] = useState(false);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  

  const handleFileDrop = useCallback((file: File) => {
    const imageUrl = URL.createObjectURL(file);

    setImage({
      id: 'single-image',
      file,
      imageUrl,
      isProcessing: true,
      regions: [],
      selectedRegionId: null,
    });
  }, []);

  const [hoveredRegion, setHoveredRegion] =
  useState<'people' | 'background' | null>(null);

const [editRegionType, setEditRegionType] =
  useState<'people' | 'background' | null>(null);


const selectRegionByType = (
  type: 'people' | 'background' | null,
  edit = false
) => {
  setHoveredRegion(type);

  if (!type || !image) return;

  // SINGLE CLICK = TOGGLE SELECTION (same as canvas)
  if (!edit) {
    const isAlreadySelected = image.regions.some(
      r => r.type === type && r.selected
    );

    setImage(prev =>
      prev
        ? {
            ...prev,
            regions: prev.regions.map(r => ({
              ...r,
              selected: isAlreadySelected ? false : r.type === type,
            })),
          }
        : prev
    );
    return;
  }

  // DOUBLE CLICK = EDIT
  setEditRegionType(type);
};


  return (
    <div
      className="relative h-screen w-screen bg-[#111111] overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Empty state */}
      {!image && (
        <div className="flex h-full w-full items-center justify-center">
          <DropZone onFileDrop={handleFileDrop} />
        </div>
      )}

      {/* Full interface with image */}
      {image && (
        <div className="flex h-screen w-screen flex-col">
          {/* Title Bar */}
          <TitleBar />

          {/* Top Bar */}
          <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

{/* Main Content Area - with side panel overlay */}
<div className="relative flex flex-1 overflow-hidden">
  {/* Left side - Main content (image, filmstrip, bottom bar) */}
  <div
    className="relative flex flex-1 flex-col overflow-hidden"
    style={{ marginRight: isPanelOpen ? 344 : 0 }}
  >
    {/* Image Tile - with bottom padding for filmstrip + bottom bar */}
    <div className="relative flex-1 pb-[128px]">
<ImageTile
  tile={image}
  selectionMode={selectionMode}
  hoveredRegionOverride={hoveredRegion}
  editRegionType={editRegionType}
  peopleEnabled={peopleEnabled}
  backgroundEnabled={backgroundEnabled}
  onUpdateTile={(updates) => {
    setEditRegionType(null);
    setImage((prev) => (prev ? { ...prev, ...updates } : prev));
  }}
/>
              </div>

              {/* Filmstrip - absolutely positioned above bottom bar */}
              <div className="absolute bottom-[42px] left-0 right-Í0 z-10">
                <Filmstrip />
              </div>

              {/* Bottom Bar - absolutely positioned at bottom */}
              <div className="absolute bottom-0 left-0 right-0 z-10">
                <BottomBar />
              </div>
            </div>

            {/* Slider Panel - Overlays on the right, full height */}
            <SliderPanel 
              isOpen={isPanelOpen} 
              onToggle={() => setIsPanelOpen(!isPanelOpen)} 
              onSelectRegion={selectRegionByType}
              peopleEnabled={peopleEnabled}
              setPeopleEnabled={setPeopleEnabled}
              backgroundEnabled={backgroundEnabled}
              setBackgroundEnabled={setBackgroundEnabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
