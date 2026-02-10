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
  // Offset for manual masks
  offset?: { x: number; y: number };
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
  // Outliner state
  hasEdits?: boolean;
  groupId?: string;
  previewUrl?: string;
  adjustments?: RegionAdjustments;
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

export interface RegionAdjustments {
  // White Balance
  temp: number;
  tint: number;
  // Light
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  // Presence
  texture: number;
  clarity: number;
  dehaze: number;
  vibrance: number;
  saturation: number;
  // Detail
  sharpening: number;
  radius: number;
  detail: number;
  masking: number;
  // Noise
  luminance: number;
  color: number;
}

export const DEFAULT_ADJUSTMENTS: RegionAdjustments = {
  temp: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
  sharpening: 0,
  radius: 1.0,
  detail: 25,
  masking: 0,
  luminance: 0,
  color: 0
};

export const REGION_COLORS: Record<string, string> = {
  person: '#FF5050',
  background: '#5050FF',
  manual: '#50FF50',
  'people-group': '#FF5050',
};