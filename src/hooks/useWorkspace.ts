import { useState, useCallback } from 'react';
import type { ImageTileData } from '@/types/workspace';

export function useWorkspace() {
  const [tiles, setTiles] = useState<ImageTileData[]>([]);
  const [activeTileId, setActiveTileId] = useState<string | null>(null);

  const addImage = useCallback((file: File) => {
    const id = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const imageUrl = URL.createObjectURL(file);
    
    const newTile: ImageTileData = {
      id,
      file,
      imageUrl,
      regions: [],
      isProcessing: true,
      selectedRegionId: null,
    };
    
    setTiles(prev => [...prev, newTile]);
    setActiveTileId(id);
    
    return newTile;
  }, []);

  const removeImage = useCallback((id: string) => {
    setTiles(prev => {
      const tile = prev.find(t => t.id === id);
      if (tile) {
        URL.revokeObjectURL(tile.imageUrl);
      }
      return prev.filter(t => t.id !== id);
    });
    
    if (activeTileId === id) {
      setActiveTileId(null);
    }
  }, [activeTileId]);

  const updateTile = useCallback((id: string, updates: Partial<ImageTileData>) => {
    setTiles(prev => prev.map(tile => 
      tile.id === id ? { ...tile, ...updates } : tile
    ));
  }, []);

  const selectTile = useCallback((id: string | null) => {
    setActiveTileId(id);
  }, []);

  const getActiveTile = useCallback((): ImageTileData | null => {
    return tiles.find(t => t.id === activeTileId) || null;
  }, [tiles, activeTileId]);

  return {
    tiles,
    activeTileId,
    addImage,
    removeImage,
    updateTile,
    selectTile,
    getActiveTile,
  };
}
