import { EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HideButtonProps {
  position: { x: number; y: number };
  onHide: () => void;
}

export function HideButton({ position, onHide }: HideButtonProps) {
  return (
    <div
      className="absolute z-30 animate-in fade-in zoom-in-95 duration-150"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -120%)',
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 rounded-full shadow-lg border border-border bg-card hover:bg-destructive hover:text-destructive-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
          >
            <EyeOff className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Hide region
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
