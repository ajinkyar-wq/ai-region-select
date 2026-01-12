import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ScanAnimationProps {
  isActive: boolean;
}

export function ScanAnimation({ isActive }: ScanAnimationProps) {
  const [scanPosition, setScanPosition] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setScanPosition(0);
      return;
    }

    const interval = setInterval(() => {
      setScanPosition(prev => {
        if (prev >= 100) return 0;
        return prev + 4;
      });
    }, 16);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg z-20">
      {/* Scan line */}
      <div
        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-80"
        style={{
          top: `${scanPosition}%`,
          boxShadow: '0 0 20px 4px hsl(var(--primary) / 0.5)',
        }}
      />
      
      {/* Scan glow effect */}
      <div
        className="absolute left-0 right-0 h-16 pointer-events-none"
        style={{
          top: `calc(${scanPosition}% - 32px)`,
          background: 'linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.1) 50%, transparent 100%)',
        }}
      />
      
      {/* Corner markers */}
      <div className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-primary/60 rounded-tl" />
      <div className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-primary/60 rounded-tr" />
      <div className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-primary/60 rounded-bl" />
      <div className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-primary/60 rounded-br" />
      
      {/* Status text */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 bg-card/90 backdrop-blur-sm rounded-full border border-border">
        <p className="text-xs font-medium text-muted-foreground">
          Understanding image...
        </p>
      </div>
    </div>
  );
}
