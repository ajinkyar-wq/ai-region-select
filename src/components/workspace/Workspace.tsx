import { useCallback, useState } from 'react';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import { TitleBar } from './TitleBar';
import { TopBar } from './TopBar';
import { Filmstrip } from './Filmstrip';
import { BottomBar } from './BottomBar';
import { SliderPanel } from './SliderPanel';
import type { ImageTileData, Region } from '@/types/workspace';
import { REGION_COLORS } from '@/types/workspace';
import { Columns2 } from 'lucide-react'; // or any compare icon you want

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const [activeTab, setActiveTab] = useState<'import' | 'cull' | 'edit' | 'retouch'>('edit');
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [peopleEnabled, setPeopleEnabled] = useState(true);
  const [backgroundEnabled, setBackgroundEnabled] = useState(true);
  const [activeMask, setActiveMask] = useState<Region | null>(null);
  const [brushActive, setBrushActive] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<'person' | 'background' | null>(null);

  const showMaskImage = !!image?.regions.some(r => r.selected);

  const handleCreateManualMask = () => {
    if (!image) return;

    // Create empty 640x640 mask
    const newMask: Region = {
      id: crypto.randomUUID(),
      type: 'manual',
      label: 'My Mask',
      maskData: new Uint8Array(640 * 640),
      maskWidth: 640,
      maskHeight: 640,
      color: REGION_COLORS.manual,
      visible: true,
      selected: true,
      hovered: false,
    };

    setImage(prev =>
      prev ? { ...prev, regions: [...prev.regions, newMask] } : prev
    );

    setActiveMask(newMask);
    setBrushActive(true);
  };

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

  const selectRegionByType = (
    type: 'person' | 'background' | null,
    edit = false
  ) => {
    if (!type || !image) return;

    if (edit) {
      const region = image.regions.find(r => r.type === type);
      if (!region) return;

      // ✅ CLEAR ALL SELECTIONS
      setImage(prev =>
        prev
          ? {
            ...prev,
            regions: prev.regions.map(r => ({
              ...r,
              selected: false,
            })),
          }
          : prev
      );

      // ✅ ENTER EDIT MODE
      setActiveMask(region);
      setBrushActive(true);
      return;
    }

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
  };

  return (
    <div
      className="relative h-screen w-screen bg-[#111111] overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
    >
      {!image && (
        <div className="flex h-full w-full items-center justify-center">
          <DropZone onFileDrop={handleFileDrop} />
        </div>
      )}

      {image && (
        <div className="flex h-screen w-screen flex-col">
          <TitleBar />
          <TopBar activeTab={activeTab} onTabChange={setActiveTab} />

          <div className="relative flex flex-1 overflow-hidden">
            <div
              className="relative flex flex-1 flex-col overflow-hidden"
              style={{ marginRight: isPanelOpen ? 344 : 0 }}
            >

              <div className="absolute top-3 right-3 z-30 pointer-events-auto">
                <button
                  className="
                  h-9 w-9
                  rounded-md
                  bg-black/60
                  border border-white/10
                  text-white
                  flex items-center justify-center
                  hover:bg-black/80
                  transition
                  shadow-md
                 "
                  title="Compare"
                >
                  <Columns2 className="h-4 w-4 opacity-90" />
                </button>
              </div>

              <div className="relative flex-1 pb-[128px]">
                <ImageTile
                  tile={image}
                  selectionMode={selectionMode}
                  hoveredRegionOverride={hoveredRegion}
                  activeMask={activeMask}
                  brushActive={brushActive}
                  peopleEnabled={peopleEnabled}
                  backgroundEnabled={backgroundEnabled}
                  onUpdateTile={(updates) => {
                    setImage(prev => (prev ? { ...prev, ...updates } : prev));
                  }}
                />
              </div>

              <div className="absolute bottom-[42px] left-0 right-0 z-10">
                <Filmstrip />
              </div>

              <div className="absolute bottom-0 left-0 right-0 z-10">
                <BottomBar />
              </div>
            </div>

            <SliderPanel
              isOpen={isPanelOpen}
              onToggle={() => setIsPanelOpen(!isPanelOpen)}
              onSelectRegion={(type, edit) => {
                if (edit) {
                  selectRegionByType(type as 'person' | 'background', true);
                } else {
                  setHoveredRegion(type as 'person' | 'background');
                }
              }}
              peopleEnabled={peopleEnabled}
              showMaskImage={showMaskImage}
              setPeopleEnabled={setPeopleEnabled}
              backgroundEnabled={backgroundEnabled}
              onCreateManualMask={handleCreateManualMask}
              setBackgroundEnabled={setBackgroundEnabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}