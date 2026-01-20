import { Layers } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FilmstripProps {
  images?: Array<{
    id: string;
    url: string;
    selected?: boolean;
    hasDuplicates?: boolean;
    selections?: {
      people?: boolean;
      landscape?: boolean;
      objects?: boolean;
      other?: boolean;
    };
  }>;
  onImageSelect?: (id: string) => void;
}

export function Filmstrip({ images = [], onImageSelect }: FilmstripProps) {
  // Mock data if no images provided - using Figma images
  const displayImages = images.length > 0 ? images : Array(12).fill(null).map((_, i) => {
    const imageIndex = (i % 3) + 1;
    return {
      id: `image-${i}`,
      url: `/figma/filmstrip-thumb-${imageIndex}.png`,
      selected: i === 10,
      hasDuplicates: i === 10,
      selections: {
        people: true,
        landscape: i % 2 === 0,
        objects: i % 3 === 0,
        other: i % 4 === 0,
      },
    };
  });

  return (
    <div className="flex w-full flex-col bg-[#1C1C1C]">
      {/* Filmstrip Container */}
      <div className="overflow-x-auto overflow-y-hidden px-2 py-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="flex items-center gap-1 w-max">
          {displayImages.map((image, index) => (
            <div
              key={image.id}
              onClick={() => onImageSelect?.(image.id)}
              className={`
                group relative flex shrink-0 cursor-pointer flex-col items-center justify-center gap-1
                ${image.selected ? 'opacity-100' : 'opacity-75 hover:opacity-100'}
              `}
            >
              {/* Image Container */}
              <div className="p-1">
                <div
                  className={`
                    relative h-[67px] w-[101px] overflow-hidden rounded-[6px]
                    ${image.selected ? 'ring-1 ring-[#303030]' : ''}
                  `}
                >
                  <img
                    src={image.url}
                    alt={`Thumbnail ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  
                  {/* Duplicate Stack Indicator */}
                  {image.hasDuplicates && (
                    <div className="absolute left-0.5 top-0.5 flex items-center gap-1 rounded-[2px] bg-[rgba(17,17,17,0.85)] px-1.5 py-0.5">
                      <Layers className="h-3 w-3 text-white" strokeWidth={0.75} />
                      <span className="font-archivo text-[10px] leading-[1.6em] text-[#E2E2E2]">2</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Selection Indicator Pill */}
              <div className="flex justify-center gap-1">
                <div className="h-1 w-6 rounded-full bg-[#0060A9]" />
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Scrollbar */}
      <div className="flex items-center justify-center px-2 py-[3px]">
        <div className="h-1 w-14 rounded-full bg-[#777777]" />
      </div>
    </div>
  );
}
