import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  onFileDrop: (file: File) => void;
}

export function DropZone({ onFileDrop }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = Array.from(e.dataTransfer.files).find(f =>
        f.type.startsWith('image/')
      );
      if (file) onFileDrop(file);
    },
    [onFileDrop]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.[0]) {
        onFileDrop(e.target.files[0]);
      }
      e.target.value = '';
    },
    [onFileDrop]
  );

  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center transition-colors',
        isDragging && 'bg-muted/40'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        id="file-upload"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileInput}
      />

      <label
        htmlFor="file-upload"
        className={cn(
          'flex cursor-pointer flex-col items-center gap-4 text-center',
          isDragging && 'scale-[1.02]'
        )}
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
<p className="text-lg font-medium text-white">
  Drop an image to test the edit protoype
</p>
<p className="text-sm text-muted-foreground">
  or click to browse
</p>
      </label>
    </div>
  );
}
