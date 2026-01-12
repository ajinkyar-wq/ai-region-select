import { useState, useCallback } from 'react';
import type { ImageTileData, Region } from '@/types/workspace';
import { segmentImage } from '@/lib/segmentation';

export function useImageTile(tile: ImageTileData) {
  const [isProcessing, setIsProcessing] = useState(tile.isProcessing);
  const [regions, setRegions] = useState<Region[]>(tile.regions);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(tile.selectedRegionId);

  const processImage = useCallback(async (imageElement: HTMLImageElement, canvasWidth: number, canvasHeight: number) => {
    setIsProcessing(true);
    
    try {
      const detectedRegions = await segmentImage(imageElement, canvasWidth, canvasHeight);
      setRegions(detectedRegions);
    } catch (error) {
      console.error('Failed to process image:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const selectRegion = useCallback((regionId: string | null) => {
    setSelectedRegionId(regionId);
    setRegions(prev => prev.map(r => ({
      ...r,
      selected: r.id === regionId,
    })));
  }, []);

  const hideRegion = useCallback((regionId: string) => {
    setRegions(prev => prev.map(r => 
      r.id === regionId ? { ...r, visible: false, selected: false } : r
    ));
    setSelectedRegionId(null);
  }, []);

  const showRegion = useCallback((regionId: string) => {
    setRegions(prev => prev.map(r => 
      r.id === regionId ? { ...r, visible: true } : r
    ));
  }, []);

  const getSelectedRegion = useCallback((): Region | null => {
    return regions.find(r => r.id === selectedRegionId) || null;
  }, [regions, selectedRegionId]);

  return {
    isProcessing,
    regions,
    selectedRegionId,
    processImage,
    selectRegion,
    hideRegion,
    showRegion,
    getSelectedRegion,
  };
}
