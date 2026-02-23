import { Loader2 } from 'lucide-react';

interface ScanAnimationProps {
  isActive: boolean;
}

export function ScanAnimation({ isActive }: ScanAnimationProps) {
  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-lg z-20">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        <p className="text-sm font-medium text-white">
          Understanding image...
        </p>
      </div>
    </div>
  );
}