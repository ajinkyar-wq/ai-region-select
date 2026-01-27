export type RegionType = 'person' | 'background' | 'manual' | 'people-group';

export interface Region {
  id: string;
  type: RegionType;
  label: string;
  // Bitmap mask data
  maskData: Uint8Array;
  innerMaskData?: Uint8Array; // Eroded mask for inner selection zone
  maskWidth: number;
  maskHeight: number;
  // Display properties
  color: string;
  visible: boolean;
  selected: boolean;
  hovered: boolean;
}

export interface ImageTileData {
  id: string;
  file: File;
  imageUrl: string;
  regions: Region[];
  isProcessing: boolean;
  selectedRegionId: string | null;
}

export const REGION_COLORS: Record<string, string> = {
  person: '#FF5050',
  background: '#5050FF',
  manual: '#50FF50',
  'people-group': '#FF5050',
};