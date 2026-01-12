import { Eye, EyeOff, User, Layers, Mountain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Region, RegionType } from '@/types/workspace';
import { REGION_LABELS, REGION_COLORS } from '@/types/workspace';

interface RegionPanelProps {
  regions: Region[];
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
  onToggleVisibility: (regionId: string) => void;
}

const REGION_ICONS: Record<RegionType, typeof User> = {
  people: User,
  foreground: Layers,
  background: Mountain,
};

export function RegionPanel({ 
  regions, 
  selectedRegionId, 
  onSelectRegion,
  onToggleVisibility,
}: RegionPanelProps) {
  if (regions.length === 0) {
    return (
      <div className="p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <Layers className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          Drop an image to see detected regions
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Detected Regions
      </h3>
      
      {regions.map(region => {
        const Icon = REGION_ICONS[region.type];
        const colors = REGION_COLORS[region.type];
        const isSelected = region.id === selectedRegionId;
        
        return (
          <div
            key={region.id}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150',
              isSelected 
                ? 'bg-primary/10 border border-primary/30' 
                : 'hover:bg-muted border border-transparent',
              !region.visible && 'opacity-50'
            )}
            onClick={() => onSelectRegion(region.id)}
          >
            {/* Color indicator */}
            <div
              className="w-3 h-3 rounded-full ring-2 ring-offset-2 ring-offset-background"
              style={{ 
                backgroundColor: colors.selected.replace('0.25', '1'),
                // Using boxShadow for ring effect since ringColor isn't a valid CSS property
                boxShadow: `0 0 0 2px ${colors.selected.replace('0.25', '0.5')}`,
              }}
            />
            
            {/* Icon */}
            <Icon className="w-4 h-4 text-muted-foreground" />
            
            {/* Label */}
            <span className={cn(
              'flex-1 text-sm font-medium',
              isSelected ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {REGION_LABELS[region.type]}
            </span>
            
            {/* Visibility toggle */}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(region.id);
              }}
            >
              {region.visible ? (
                <Eye className="h-4 w-4 text-muted-foreground" />
              ) : (
                <EyeOff className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        );
      })}
      
      {/* Placeholder for future features */}
      <div className="mt-6 pt-6 border-t border-border">
        <div className="p-4 rounded-lg bg-muted/50 border border-dashed border-muted-foreground/20">
          <p className="text-xs text-muted-foreground text-center">
            Editing controls coming in v0.2
          </p>
        </div>
      </div>
    </div>
  );
}
