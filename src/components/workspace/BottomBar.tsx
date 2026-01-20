import { Eye, Images, Star, History, Search, Info, Keyboard } from 'lucide-react';

interface BottomBarProps {
  imageName?: string;
  currentImage?: number;
  totalVisibleImages?: number;
  totalImages?: number;
  rating?: number;
  zoomLevel?: string;
  onZoomChange?: (zoom: string) => void;
}

export function BottomBar({
  imageName = 'Evan',
  currentImage = 1,
  totalVisibleImages = 23,
  totalImages = 1562,
  rating = 0,
  zoomLevel = '100%',
  onZoomChange,
}: BottomBarProps) {
  return (
    <div className="flex h-[40px] w-full items-center justify-between gap-2 bg-[#1C1C1C] px-3 py-1.5">
      {/* Left - Image Counter */}
      <div className="flex w-[180px] items-center gap-3">
        <span className="text-sm font-normal text-[#E2E2E2]">{imageName}</span>
        
        <div className="h-3 w-px bg-[rgba(226,226,226,0.1)]" />
        
        <div className="flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-white" />
          <span className="text-xs text-[#ABABAB]">
            {currentImage} / {totalVisibleImages}
          </span>
        </div>
        
        <div className="h-3 w-px bg-[rgba(226,226,226,0.1)]" />
        
        <div className="flex items-center gap-1.5">
          <Images className="h-3.5 w-3.5 text-white" />
          <span className="text-xs text-[#ABABAB]">{totalImages}</span>
        </div>
      </div>

      {/* Center - Rating Bar */}
      <div className="flex items-center gap-1 px-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            className="group p-1 transition-transform hover:scale-110"
          >
            <Star
              className={`h-4 w-4 transition-colors ${
                star <= rating
                  ? 'fill-[#15803D] text-[#15803D]'
                  : 'fill-transparent text-[#ABABAB] group-hover:text-[#15803D]'
              }`}
            />
          </button>
        ))}
      </div>

      {/* Right - Controls */}
      <div className="flex w-[180px] items-center justify-end gap-3">
        <div className="flex items-center gap-1">
          <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-[rgba(226,226,226,0.05)] transition-colors">
            <History className="h-3 w-3 text-white" />
          </button>
          <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-[rgba(226,226,226,0.05)] transition-colors">
            <Search className="h-3 w-3 text-white" />
          </button>
        </div>
        
        <div className="h-3 w-px bg-[rgba(226,226,226,0.1)]" />

        {/* Zoom Control */}
        <div className="flex items-center gap-1">
          <button className="flex h-6 items-center justify-center rounded bg-[rgba(226,226,226,0.05)] px-2 text-xs text-[#E2E2E2] hover:bg-[rgba(226,226,226,0.1)]">
            Fit
          </button>
          <button className="flex h-6 items-center justify-center rounded bg-[rgba(226,226,226,0.1)] px-2 text-xs text-[#777777] hover:bg-[rgba(226,226,226,0.15)]">
            {zoomLevel}
          </button>
          <button className="flex h-6 w-5 items-center justify-center rounded bg-[rgba(226,226,226,0.1)] hover:bg-[rgba(226,226,226,0.15)]">
            <Search className="h-3.5 w-3.5 text-[#777777]" />
          </button>
        </div>

        <div className="h-3 w-px bg-[rgba(226,226,226,0.1)]" />

        <div className="flex items-center gap-1">
          <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-[rgba(226,226,226,0.05)] transition-colors">
            <Info className="h-3 w-3 text-white" />
          </button>
          <button className="flex h-6 w-6 items-center justify-center rounded hover:bg-[rgba(226,226,226,0.05)] transition-colors">
            <Keyboard className="h-3 w-3 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
