import { useCallback, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import { RegionPanel } from './RegionPanel';
import type { Region, ImageTileData } from '@/types/workspace';
import { cn } from '@/lib/utils';

export function Workspace() {
  const { tiles, activeTileId, addImage, removeImage, updateTile, selectTile, getActiveTile } = useWorkspace();
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  const handleFileDrop = useCallback((file: File) => {
    addImage(file);
  }, [addImage]);

  const handleRegionSelect = useCallback((region: Region | null) => {
    setSelectedRegion(region);
  }, []);

  const handlePanelRegionSelect = useCallback((regionId: string) => {
    const activeTile = getActiveTile();
    if (!activeTile) return;
    
    // Toggle visibility if hidden, then select
    const region = activeTile.regions.find(r => r.id === regionId);
    if (region && !region.visible) {
      updateTile(activeTile.id, {
        regions: activeTile.regions.map(r => 
          r.id === regionId ? { ...r, visible: true } : r
        ),
      });
    }
    
    updateTile(activeTile.id, {
      selectedRegionId: regionId,
      regions: activeTile.regions.map(r => ({
        ...r,
        selected: r.id === regionId,
      })),
    });
  }, [getActiveTile, updateTile]);

  const handleToggleVisibility = useCallback((regionId: string) => {
    const activeTile = getActiveTile();
    if (!activeTile) return;
    
    updateTile(activeTile.id, {
      regions: activeTile.regions.map(r => 
        r.id === regionId ? { ...r, visible: !r.visible } : r
      ),
    });
  }, [getActiveTile, updateTile]);

  const activeTile = getActiveTile();
  const showPanel = activeTile && activeTile.regions.length > 0;

  return (
    <div className="flex h-screen bg-background">
      {/* Main workspace area */}
      <div 
        className={cn(
          'flex-1 p-6 overflow-auto transition-all duration-300',
          showPanel ? 'pr-80' : ''
        )}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <header className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground">
              AI Image Workspace
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Drop an image to see what AI understands
            </p>
          </header>

          {/* Empty state or grid */}
          {tiles.length === 0 ? (
            <DropZone onFileDrop={handleFileDrop} isEmpty={true} />
          ) : (
            <>
              {/* Image grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {tiles.map(tile => (
                  <ImageTile
                    key={tile.id}
                    tile={tile}
                    isActive={tile.id === activeTileId}
                    onSelect={() => selectTile(tile.id)}
                    onRemove={() => removeImage(tile.id)}
                    onRegionSelect={handleRegionSelect}
                    onUpdateTile={(updates) => updateTile(tile.id, updates)}
                  />
                ))}
              </div>
              
              {/* Drop zone overlay for adding more */}
              <DropZone onFileDrop={handleFileDrop} isEmpty={false} />
              
              {/* Add more hint */}
              <p className="text-center text-xs text-muted-foreground mt-6">
                Drag & drop more images to add them to the workspace
              </p>
            </>
          )}
        </div>
      </div>

      {/* Right panel */}
      <aside
        className={cn(
          'fixed right-0 top-0 h-full w-72 bg-card border-l border-border shadow-lg transition-transform duration-300 z-10',
          showPanel ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Regions</h2>
        </div>
        
        {activeTile && (
          <RegionPanel
            regions={activeTile.regions}
            selectedRegionId={activeTile.selectedRegionId}
            onSelectRegion={handlePanelRegionSelect}
            onToggleVisibility={handleToggleVisibility}
          />
        )}
      </aside>
    </div>
  );
}
