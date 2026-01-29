import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  Paintbrush, Eraser, RotateCcw, Minimize2, Maximize2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { SliderVertical } from '@/components/ui/slider-vertical';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type Position = 'top' | 'bottom' | 'left' | 'right';

interface ToolbarItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

interface DraggableToolbarProps {
  items: {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
  }[];
  activeId?: string;
  onActiveChange?: (id: string) => void;
  containerRef: React.RefObject<HTMLElement>;

  // Brush Settings Props
  brushSize: number[];
  onBrushSizeChange: (value: number[]) => void;
  brushSoftness: number[];
  onBrushSoftnessChange: (value: number[]) => void;
  brushOpacity: number[];
  onBrushOpacityChange: (value: number[]) => void;
  // New
  onResetMask?: () => void;
}

export function DraggableToolbar({
  items,
  activeId,
  onActiveChange,
  containerRef,
  brushSize,
  onBrushSizeChange,
  brushSoftness,
  onBrushSoftnessChange,
  brushOpacity,
  onBrushOpacityChange,
  onResetMask
}: DraggableToolbarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // NOTE: Brush state is now controlled by parent (Workspace)
  // const [brushSize, setBrushSize] = useState([50]);
  // const [softness, setSoftness] = useState([20]);
  // const [opacity, setOpacity] = useState([70]);

  // We store the exact position. Initial position: Left edge, vertically centered-ish.
  const [pos, setPos] = useState({ x: 16, y: 100 });
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [edge, setEdge] = useState<'left' | 'right' | 'top' | 'bottom'>('left');

  const [isDragging, setIsDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Handle dragging
  useEffect(() => {
    if (!isDragging || !toolbarRef.current || !containerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const toolbarRect = toolbarRef.current!.getBoundingClientRect();
      const tbWidth = toolbarRect.width;
      const tbHeight = toolbarRect.height;

      // Margins
      const MARGIN = 16;
      const BOTTOM_MARGIN = 140; // Space for Filmstrip

      // Compare Button (top-3 right-3, size 9) -> 12px offset + 36px size
      const BTN_OFFSET = 12;
      const BTN_SIZE = 36;
      const BTN_GAP = 8; // "3-4 px before that"
      const RESERVED_CORNER_SIZE = BTN_OFFSET + BTN_SIZE + BTN_GAP; // ~52px

      // Container bounds for the toolbar center/anchor
      // Actually tracking top-left of toolbar is easier with bounds
      const bounds = {
        left: MARGIN,
        right: rect.width - MARGIN - tbWidth,
        top: MARGIN,
        bottom: rect.height - BOTTOM_MARGIN - tbHeight,
      };

      // Determine closest edge
      // Distances from mouse to the valid edge "rails"
      // Note: we want the toolbar to SNAP to the edge, but SLIDE along it.
      // We calculate the "snapped" position for each of the 4 edges and see which is closest to mouse.

      // 1. Left Edge (No interference with Top-Right button)
      const leftPos = { x: MARGIN, y: Math.max(bounds.top, Math.min(bounds.bottom, mouseY - tbHeight / 2)) };
      const distLeft = Math.abs(mouseX - leftPos.x);

      // 2. Right Edge (Must stay BELOW the button)
      const rightEdgeTopBound = Math.max(bounds.top, RESERVED_CORNER_SIZE);
      const rightPos = {
        x: rect.width - MARGIN - tbWidth,
        // Use rightEdgeTopBound instead of bounds.top
        y: Math.max(rightEdgeTopBound, Math.min(bounds.bottom, mouseY - tbHeight / 2))
      };
      const distRight = Math.abs(mouseX - (rightPos.x + tbWidth)); // distance to right edge

      // 3. Top Edge (Must stay LEFT of the button)
      const topEdgeRightBound = rect.width - RESERVED_CORNER_SIZE - tbWidth;
      // Constrain right bound
      const safeTopRight = Math.min(bounds.right, topEdgeRightBound);

      const topPos = {
        // Use safeTopRight instead of bounds.right
        x: Math.max(bounds.left, Math.min(safeTopRight, mouseX - tbWidth / 2)),
        y: MARGIN
      };
      const distTop = Math.abs(mouseY - topPos.y);

      // 4. Bottom Edge (No interference)
      const bottomPos = { x: Math.max(bounds.left, Math.min(bounds.right, mouseX - tbWidth / 2)), y: rect.height - BOTTOM_MARGIN - tbHeight };
      const distBottom = Math.abs(mouseY - (bottomPos.y + tbHeight));

      const minDist = Math.min(distLeft, distRight, distTop, distBottom);

      if (minDist === distLeft) {
        setPos(leftPos);
        setOrientation('vertical');
        setEdge('left');
      } else if (minDist === distRight) {
        setPos(rightPos);
        setOrientation('vertical');
        setEdge('right');
      } else if (minDist === distTop) {
        setPos(topPos);
        setOrientation('horizontal');
        setEdge('top');
      } else {
        setPos(bottomPos);
        setOrientation('horizontal');
        setEdge('bottom');
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, containerRef]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Check if the click is on a button or inside one
    const target = e.target as HTMLElement;
    const isButton = target.closest('button');

    // Allow dragging if we didn't click a button
    if (!isButton && e.button === 0) {
      setIsDragging(true);
      e.preventDefault(); // Prevent text selection
    }
  };

  const getPositionStyle = () => {
    return {
      left: pos.x,
      top: pos.y,
      cursor: isDragging ? 'grabbing' : 'grab',
    };
  };

  const containerClasses = cn(
    'flex items-center gap-[8px] p-[6px]',
    orientation === 'vertical' ? 'flex-col' : 'flex-row'
  );

  // Figma Icon Button: size-[36px] items-center justify-center rounded-[4px]
  // Active: bg-[#27272a] border border-transparent (or active border)
  // Inactive: bg-transparent
  const getItemClasses = (isActive: boolean) => cn(
    'flex items-center justify-center shrink-0 size-[36px] rounded-[4px] transition-colors cursor-pointer',
    isActive
      ? 'bg-[#27272a] text-white'
      : 'text-[#a1a1aa] hover:bg-white/5 hover:text-white'
  );

  const getCollapseIcon = () => {
    // If we use arrows based on position to point "in" (collapse) or "out" (expand)
    // Or just use a standard collapse icon. 
    // Figma shows "ArrowsInSimple" which usually means "Collapse".
    if (isCollapsed) return <Maximize2 className="h-4 w-4" />; // Expand
    return <Minimize2 className="h-4 w-4" />; // Collapse
  };

  const getSettingsStyle = (): React.CSSProperties => {
    // Offset from toolbar
    const GAP = 12;
    const PANEL_WIDTH = 240; // Approximate width based on Figma
    const PANEL_HEIGHT = 180; // Approximate height

    // Defaults
    let style: React.CSSProperties = { position: 'absolute' };

    switch (edge) {
      case 'left':
        style = {
          left: pos.x + 48 + GAP, // 48 is approx toolbar width
          top: pos.y,
        };
        break;
      case 'right':
        style = {
          left: pos.x - PANEL_WIDTH - GAP,
          top: pos.y,
        };
        break;
      case 'top':
        style = {
          left: pos.x,
          top: pos.y + 48 + GAP,
        };
        break;
      case 'bottom':
        style = {
          left: pos.x,
          top: pos.y - PANEL_HEIGHT - GAP,
        };
        break;
    }
    return style;
  };

  // When collapsed, we only show the active tool (or the first one if none active)
  // And dragging is still possible.
  const activeItem = items.find(i => i.id === activeId) || items[0];

  return (
    <>
      <div
        ref={toolbarRef}
        className={cn(
          "absolute z-40 bg-[#1c1c1c] shadow-lg transition-colors duration-200 select-none rounded-[8px]",
          // We use inline styles for position, but keep base classes here.
          // Remove the transition-all/ease-out for position since we are driving it with JS for drag, 
          // dragging needs to be instant. We could add transition when SNAP changes orientation though?
          // Let's keep it simple: no layout transitions for now to avoid jumpiness during drag.
        )}
        onMouseDown={handleMouseDown}
        style={getPositionStyle()}
      >
        <div className={containerClasses}>

          {/* If Collapsed: Show Active Tool + Toggle */}
          {isCollapsed ? (
            <>
              <button
                key={activeItem.id}
                className={getItemClasses(true)}
                onClick={(e) => {
                  e.stopPropagation();
                  // Clicking active tool in collapsed mode could also expand, 
                  // but Figma sidebar shows a distinct expand button below it.
                  // We'll keep this as just selection/indicator.
                  setIsCollapsed(false);
                }}
                title={activeItem.label}
              >
                {activeItem.icon}
              </button>

              {/* Expand Button (Figma: ArrowsOutSimple) */}
              <button
                className={getItemClasses(false)}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCollapsed(false);
                }}
                title="Expand"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {/* Tools */}
              {items.map((item) => (
                <button
                  key={item.id}
                  className={getItemClasses(activeId === item.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActiveChange?.(item.id);
                    item.onClick();
                  }}
                  title={item.label}
                >
                  {item.icon}
                </button>
              ))}

              {/* Separator / Size Indicator (from Figma) */}
              {/* Figma has a size circle "50" */}
              <div
                className="flex items-center justify-center size-[36px] shrink-0 cursor-pointer hover:bg-white/5 rounded-[4px]"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSettings(!showSettings);
                }}
              >
                <div className="size-[20px] rounded-full bg-[#d9d9d9] flex items-center justify-center text-[10px] font-medium text-black">
                  {brushSize[0]}
                </div>
              </div>

              {/* Reset Mask (was Undo) */}
              {onResetMask && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={getItemClasses(false)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onResetMask();
                      }}
                    >
                      <RotateCcw className="h-[20px] w-[20px]" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={orientation === 'vertical' ? (edge === 'right' ? 'left' : 'right') : 'top'}>
                    <p>Reset Mask</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Divider */}
              <div className={cn("bg-[#3f3f46] opacity-20 shrink-0", orientation === 'vertical' ? "h-[1px] w-full" : "w-[1px] h-full")} />

              {/* Collapse Toggle */}
              <button
                className={getItemClasses(false)}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCollapsed(true);
                  setShowSettings(false); // Close settings on collapse
                }}
                title="Collapse"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && !isCollapsed && (
        <div
          // Figma Bubble: gap-[12px] px-[10px] py-[8px] rounded-[4px] bg-[#1c1c1c]
          className="absolute z-50 bg-[#1c1c1c] rounded-[4px] p-[10px] py-[8px] flex flex-col gap-[12px] shadow-2xl border border-white/5 w-[240px]"
          style={getSettingsStyle()}
          onMouseDown={(e) => e.stopPropagation()} // Prevent drag
        >
          {/* Brush Size */}
          <div className="flex flex-col gap-[4px]">
            <div className="flex justify-between items-center">
              <span className="text-[12px] font-medium text-[#777] leading-[16px]">Brush Size</span>
              <span className="text-[12px] text-[#E2E2E2] leading-[16px]">{brushSize[0]}</span>
            </div>
            <SliderVertical
              value={brushSize}
              onValueChange={onBrushSizeChange}
              max={100}
              step={1}
            />
          </div>

          {/* Softness */}
          <div className="flex flex-col gap-[4px]">
            <div className="flex justify-between items-center">
              <span className="text-[12px] font-medium text-[#777] leading-[16px]">Softness</span>
              <span className="text-[12px] text-[#E2E2E2] leading-[16px]">{brushSoftness[0]}</span>
            </div>
            <SliderVertical
              value={brushSoftness}
              onValueChange={onBrushSoftnessChange}
              max={100}
              step={1}
            />
          </div>

          {/* Opacity */}
          <div className="flex flex-col gap-[4px]">
            <div className="flex justify-between items-center">
              <span className="text-[12px] font-medium text-[#777] leading-[16px]">Opacity</span>
              <span className="text-[12px] text-[#E2E2E2] leading-[16px]">{brushOpacity[0]}</span>
            </div>
            <SliderVertical
              value={brushOpacity}
              onValueChange={onBrushOpacityChange}
              max={100}
              step={1}
            />
          </div>
        </div>
      )}
    </>
  );
}
