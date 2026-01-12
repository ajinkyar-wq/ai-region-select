import { useCallback, useState } from 'react';
import { Upload, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  onFileDrop: (file: File) => void;
  isEmpty: boolean;
}

export function DropZone({ onFileDrop, isEmpty }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(f => f.type.startsWith('image/'));
    
    if (imageFile) {
      onFileDrop(imageFile);
    }
  }, [onFileDrop]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      onFileDrop(files[0]);
    }
    e.target.value = '';
  }, [onFileDrop]);

  if (!isEmpty) {
    return (
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm transition-opacity pointer-events-none opacity-0',
          isDragging && 'opacity-100 pointer-events-auto'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-dashed border-primary bg-card">
          <Upload className="w-12 h-12 text-primary animate-bounce" />
          <p className="text-lg font-medium text-foreground">Drop image to add</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center min-h-[60vh] p-12 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer',
        isDragging 
          ? 'border-primary bg-primary/5 scale-[1.02]' 
          : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        className="sr-only"
        id="file-upload"
      />
      <label htmlFor="file-upload" className="flex flex-col items-center gap-6 cursor-pointer">
        <div className={cn(
          'p-6 rounded-full transition-all duration-300',
          isDragging ? 'bg-primary/20' : 'bg-muted'
        )}>
          {isDragging ? (
            <Upload className="w-10 h-10 text-primary animate-bounce" />
          ) : (
            <ImageIcon className="w-10 h-10 text-muted-foreground" />
          )}
        </div>
        <div className="text-center space-y-2">
          <p className="text-xl font-medium text-foreground">
            Drop an image here
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse
          </p>
        </div>
        <p className="text-xs text-muted-foreground/70 mt-4">
          AI will automatically understand what's in your image
        </p>
      </label>
    </div>
  );
}
