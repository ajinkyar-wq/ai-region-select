import { useCallback, useState } from 'react';
import { DropZone } from './DropZone';
import { ImageTile } from './ImageTile';
import type { ImageTileData } from '@/types/workspace';

export function Workspace() {
  const [image, setImage] = useState<ImageTileData | null>(null);

  const handleFileDrop = useCallback((file: File) => {
    const imageUrl = URL.createObjectURL(file);

    setImage({
      id: 'single-image',
      file,
      imageUrl,
      isProcessing: true,
      regions: [],
      selectedRegionId: null,
    });
  }, []);

  return (
    <div
      className="relative h-screen w-screen bg-background"
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Empty state */}
      {!image && (
        <div className="flex h-full w-full items-center justify-center">
          <DropZone onFileDrop={handleFileDrop} />
        </div>
      )}

      {/* Single image view */}
      {image && (
        <div className="absolute inset-0">
          <ImageTile
            tile={image}
            onUpdateTile={(updates) =>
              setImage((prev) => (prev ? { ...prev, ...updates } : prev))
            }
          />
        </div>
      )}
    </div>
  );
}
