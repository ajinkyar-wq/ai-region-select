export type RegionType = 'people' | 'background' | 'hair' | 'body-skin' | 'face-skin' | 'clothes' | 'foreground' | 'manual';
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
    fill: 'rgba(0, 255, 0, 0.3)',
    selected: 'rgba(0, 255, 0, 0.5)',
  },
  background: {
    fill: 'rgba(0, 0, 255, 0.3)',
    selected: 'rgba(0, 0, 255, 0.5)',
  },
  foreground: {
    fill: 'rgba(255, 255, 0, 0.3)',
    selected: 'rgba(255, 255, 0, 0.5)',
  },
  hair: {
    fill: 'rgba(147, 51, 234, 0.3)',
    selected: 'rgba(147, 51, 234, 0.5)',
  },
  'body-skin': {
    fill: 'rgba(249, 115, 22, 0.3)',
    selected: 'rgba(249, 115, 22, 0.5)',
  },
  'face-skin': {
    fill: 'rgba(236, 72, 153, 0.3)',
    selected: 'rgba(236, 72, 153, 0.5)',
  },
  clothes: {
    fill: 'rgba(6, 182, 212, 0.3)',
    selected: 'rgba(6, 182, 212, 0.5)',
  },
  manual: {
  fill: '#00ff6440',
  selected: '#00ff6480',
},

};
export const REGION_LABELS: Record<RegionType, string> = {
  people: 'People',
  background: 'Background',
  foreground: 'Foreground',
  hair: 'Hair',
  'body-skin': 'Body Skin',
  'face-skin': 'Face Skin',
  clothes: 'Clothes',
  manual: 'My Mask',

};