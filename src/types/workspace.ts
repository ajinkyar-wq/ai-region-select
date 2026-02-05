export type RegionType = 'person' | 'background' | 'manual' | 'people-group' | 'linear-gradient' | 'radial-gradient';

export interface Region {
  id: string;
  type: RegionType;
  label: string;
  // Bitmap mask data
  maskData: Uint8Array;
  originalMaskData?: Uint8Array;
  innerMaskData?: Uint8Array; // Eroded mask for inner selection zone
  maskWidth: number;
  maskHeight: number;
  // Gradient params
  gradient?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  radialGradient?: {
    center: { x: number; y: number }; // Normalized 0-1
    radius: { x: number; y: number }; // Normalized 0-1 (using x as radius for circle)
    feather: number; // 0-1 Ratio (Inner Radius / Outer Radius)
    invert: boolean;
  };
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
  width?: number;
  height?: number;
}

export const REGION_COLORS: Record<string, string> = {
  person: '#FF5050',
  background: '#5050FF',
  manual: '#50FF50',
  'people-group': '#FF5050',
};