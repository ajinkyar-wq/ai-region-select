import { useEffect, useRef, useState } from 'react';
import { Paintbrush, Eraser } from 'lucide-react';

function LinearGradientIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id="wlg" x1="0" y1="10" x2="20" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="4" width="16" height="12" rx="1" fill="url(#wlg)" />
    </svg>
  );
}

function RadialGradientIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <defs>
        <radialGradient id="wrg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="16" height="16" rx="8" fill="url(#wrg)" />
    </svg>
  );
}

export type WheelTool = 'brush' | 'eraser' | 'linear-gradient' | 'radial-gradient';

interface ToolWheelProps {
  x: number;
  y: number;
  hasMaskSelected: boolean;
  brushMode: 'add' | 'erase';
  onSelectTool: (tool: WheelTool, mode: 'add' | 'erase') => void;
  onToggleBrushMode: () => void;
  onHoverChange?: (idx: number) => void;
}

// No-mask: 4 sectors × 90° — pure tool picker, no add/subtract
const SIMPLE_SECTORS = [
  { tool: 'brush'           as WheelTool, label: 'Brush',   angle: -90  }, // top
  { tool: 'linear-gradient' as WheelTool, label: 'Linear',  angle: 0    }, // right
  { tool: 'eraser'          as WheelTool, label: 'Eraser',  angle: 90   }, // bottom
  { tool: 'radial-gradient' as WheelTool, label: 'Radial',  angle: 180  }, // left
];

// Mask selected: 8 sectors × 45° — left half = add, right half = subtract
// Left half (add): 90°→270°, centers at 112.5, 157.5, 202.5, 247.5
// Right half (sub): -90°→90°, centers at -67.5, -22.5, 22.5, 67.5
const SPLIT_SECTORS = [
  { tool: 'brush'           as WheelTool, label: 'Brush',   angle: 112.5, mode: 'add'   as const },
  { tool: 'linear-gradient' as WheelTool, label: 'Linear',  angle: 157.5, mode: 'add'   as const },
  { tool: 'radial-gradient' as WheelTool, label: 'Radial',  angle: 202.5, mode: 'add'   as const },
  { tool: 'eraser'          as WheelTool, label: 'Eraser',  angle: 247.5, mode: 'add'   as const },
  { tool: 'brush'           as WheelTool, label: 'Brush',   angle: -67.5, mode: 'erase' as const },
  { tool: 'linear-gradient' as WheelTool, label: 'Linear',  angle: -22.5, mode: 'erase' as const },
  { tool: 'radial-gradient' as WheelTool, label: 'Radial',  angle:  22.5, mode: 'erase' as const },
  { tool: 'eraser'          as WheelTool, label: 'Eraser',  angle:  67.5, mode: 'erase' as const },
];

const OUTER_R = 140;
const VISUAL_INNER_R = 20;
const ICON_R = 88;
const LABEL_R = 118;
const OUTER_LABEL_R = 158; // ADD / SUB labels

function getHoveredSector(dx: number, dy: number, sectors: { angle: number }[]): number {
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const a = (angle + 360) % 360;
  let best = 0;
  let bestDiff = Infinity;
  sectors.forEach((s, i) => {
    const sAngle = (s.angle + 360) % 360;
    let diff = Math.abs(a - sAngle);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

function sectorPath(outerR: number, innerR: number, startDeg: number, endDeg: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = Math.cos(toRad(startDeg)) * outerR;
  const y1 = Math.sin(toRad(startDeg)) * outerR;
  const x2 = Math.cos(toRad(endDeg)) * outerR;
  const y2 = Math.sin(toRad(endDeg)) * outerR;
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  if (innerR <= 0) {
    return [`M 0 0`, `L ${x1} ${y1}`, `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`, 'Z'].join(' ');
  }
  const x3 = Math.cos(toRad(endDeg)) * innerR;
  const y3 = Math.sin(toRad(endDeg)) * innerR;
  const x4 = Math.cos(toRad(startDeg)) * innerR;
  const y4 = Math.sin(toRad(startDeg)) * innerR;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z'
  ].join(' ');
}

export function ToolWheel({ x, y, hasMaskSelected, onSelectTool, onHoverChange }: ToolWheelProps) {
  const sectors = hasMaskSelected ? SPLIT_SECTORS : SIMPLE_SECTORS;
  const sliceSize = hasMaskSelected ? 45 : 90;

  const [hovered, setHovered] = useState<number>(0);
  const originRef = useRef({ x, y });

  useEffect(() => { originRef.current = { x, y }; }, [x, y]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;
      const next = getHoveredSector(dx, dy, sectors);
      setHovered(next);
      onHoverChange?.(next);
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [sectors, onHoverChange]);

  const size = (OUTER_LABEL_R + 32) * 2;
  const center = size / 2;

  return (
    <div
      className="fixed z-[9999]"
      style={{ left: x - center, top: y - center, width: size, height: size, pointerEvents: 'none' }}
    >
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        <g transform={`translate(${center}, ${center})`}>

          {/* Sectors */}
          {sectors.map((sector, i) => {
            const startAngle = sector.angle - sliceSize / 2;
            const endAngle   = sector.angle + sliceSize / 2;
            const isActive   = hovered === i;
            const isAdd      = !hasMaskSelected || ('mode' in sector && sector.mode === 'add');
            const activeColor = hasMaskSelected
              ? (isAdd ? 'rgba(74,222,128,0.85)' : 'rgba(248,113,113,0.85)')
              : 'rgba(255,255,255,0.92)';
            const idleColor = hasMaskSelected
              ? (isAdd ? 'rgba(20,38,26,0.93)' : 'rgba(42,18,18,0.93)')
              : 'rgba(28,28,28,0.93)';
            return (
              <path
                key={`${sector.tool}-${i}`}
                d={sectorPath(OUTER_R, VISUAL_INNER_R, startAngle, endAngle)}
                fill={isActive ? activeColor : idleColor}
                stroke={isActive
                  ? (hasMaskSelected ? (isAdd ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)') : 'rgba(255,255,255,0.3)')
                  : 'rgba(255,255,255,0.07)'}
                strokeWidth="1"
                style={{ transition: 'fill 60ms' }}
              />
            );
          })}

          {/* ADD / SUB labels — only when mask selected */}
          {hasMaskSelected && <>
            <text x={-OUTER_LABEL_R} y={0} textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fontWeight="600" letterSpacing="0.08em"
              fill="rgba(74,222,128,0.65)"
              style={{ pointerEvents: 'none', fontFamily: 'Geist, sans-serif' }}>
              ADD
            </text>
            <text x={OUTER_LABEL_R} y={0} textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fontWeight="600" letterSpacing="0.08em"
              fill="rgba(248,113,113,0.65)"
              style={{ pointerEvents: 'none', fontFamily: 'Geist, sans-serif' }}>
              SUB
            </text>
            <line x1={0} y1={-OUTER_R - 4} x2={0} y2={OUTER_R + 4}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
          </>}

          {/* Icons + labels */}
          {sectors.map((sector, i) => {
            const rad = (sector.angle * Math.PI) / 180;
            const ix = Math.cos(rad) * ICON_R;
            const iy = Math.sin(rad) * ICON_R;
            const lx = Math.cos(rad) * LABEL_R;
            const ly = Math.sin(rad) * LABEL_R;
            const isActive = hovered === i;
            const isAdd    = !hasMaskSelected || ('mode' in sector && sector.mode === 'add');
            const iconColor = isActive
              ? (hasMaskSelected ? (isAdd ? '#4ade80' : '#f87171') : '#000')
              : 'rgba(255,255,255,0.45)';
            const labelColor = isActive
              ? (hasMaskSelected ? (isAdd ? '#4ade80' : '#f87171') : '#000')
              : 'rgba(255,255,255,0.35)';
            // In split mode, show icons only on add side to avoid cramped duplicates
            const showIcon = !hasMaskSelected || i < 4;
            return (
              <g key={`${sector.tool}-${i}-ui`}>
                {showIcon && (
                  <g transform={`translate(${ix - 10}, ${iy - 10})`}
                    style={{ color: iconColor, transition: 'color 60ms' }}>
                    {sector.tool === 'brush'           && <Paintbrush width={20} height={20} />}
                    {sector.tool === 'eraser'          && <Eraser width={20} height={20} />}
                    {sector.tool === 'linear-gradient' && <LinearGradientIcon />}
                    {sector.tool === 'radial-gradient' && <RadialGradientIcon />}
                  </g>
                )}
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize="10" fill={labelColor}
                  style={{ pointerEvents: 'none', transition: 'fill 60ms', fontFamily: 'Geist, sans-serif' }}>
                  {sector.label}
                </text>
              </g>
            );
          })}

          {/* Center hole */}
          <circle cx={0} cy={0} r={VISUAL_INNER_R}
            fill="rgba(10,10,10,0.95)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

          {/* Outer ring */}
          <circle cx={0} cy={0} r={OUTER_R + 1} fill="none"
            stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        </g>
      </svg>
    </div>
  );
}
