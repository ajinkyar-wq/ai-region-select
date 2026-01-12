export type RegionType = 'people' | 'foreground' | 'background';

export interface Region {
  id: string;
  type: RegionType;
  pathData: string; // SVG path data
  visible: boolean;
  selected: boolean;
}

export interface ImageTileData {
  id: string;
  file: File;
  imageUrl: string;
  regions: Region[];
  isProcessing: boolean;
  selectedRegionId: string | null;
}

export const REGION_COLORS: Record<RegionType, { fill: string; selected: string }> = {
  people: {
    fill: 'hsla(340, 82%, 52%, 0.08)',
    selected: 'hsla(340, 82%, 52%, 0.25)',
  },
  foreground: {
    fill: 'hsla(142, 71%, 45%, 0.08)',
    selected: 'hsla(142, 71%, 45%, 0.25)',
  },
  background: {
    fill: 'hsla(217, 91%, 60%, 0.08)',
    selected: 'hsla(217, 91%, 60%, 0.25)',
  },
};

export const REGION_LABELS: Record<RegionType, string> = {
  people: 'People',
  foreground: 'Foreground',
  background: 'Background',
};
