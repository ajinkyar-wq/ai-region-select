import { useEffect, useRef, useState } from 'react';
import { Paintbrush, Eraser, X, Plus, Minus } from 'lucide-react';

function LinearGradientIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <defs>
        <linearGradient id="wlg" x1="0" y1="10" x2="20" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="5" width="16" height="10" rx="2" fill="url(#wlg)" />
      <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
    </svg>
  );
}

function RadialGradientIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <defs>
        <radialGradient id="wrg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="10" cy="10" r="8" fill="url(#wrg)" />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
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

type SectorDef = {
  tool: WheelTool;
  label: string;
  angle: number;
  mode: 'add' | 'erase';
};

// No mask → 3 tools (no eraser — nothing to erase yet).
// Evenly spaced: top, lower-right, lower-left.
export const SIMPLE_SECTORS: SectorDef[] = [
  { tool: 'brush',           label: 'Brush',  angle:  -90, mode: 'add' },
  { tool: 'radial-gradient', label: 'Radial', angle:   30, mode: 'add' },
  { tool: 'linear-gradient', label: 'Linear', angle:  150, mode: 'add' },
];

// Mask selected → left half ADD (green), right half ERASE (red).
// 3 tools per side, evenly spaced across the half-circle.
// Left half centers (clockwise from top): -120, 180, 120
// Right half centers (clockwise from top):  -60,   0,  60
export const SPLIT_SECTORS: SectorDef[] = [
  { tool: 'brush',           label: 'Brush',  angle: -120, mode: 'add'   },
  { tool: 'linear-gradient', label: 'Linear', angle:  180, mode: 'add'   },
  { tool: 'radial-gradient', label: 'Radial', angle:  120, mode: 'add'   },
  { tool: 'eraser',          label: 'Eraser', angle:  -60, mode: 'erase' },
  { tool: 'linear-gradient', label: 'Linear', angle:    0, mode: 'erase' },
  { tool: 'radial-gradient', label: 'Radial', angle:   60, mode: 'erase' },
];

const OUTER_R = 132;
const INNER_R = 38;
const ICON_R = 92;
const LABEL_R = 116;
const CANCEL_R = 28;
const HEADER_R = OUTER_R + 22;

const ADD_FILL_IDLE   = 'rgba(22,32,26,0.92)';
const ADD_FILL_HOVER  = 'rgba(74,222,128,0.18)';
const ADD_STROKE      = 'rgba(74,222,128,0.55)';
const ADD_TEXT        = '#4ade80';

const ERASE_FILL_IDLE  = 'rgba(34,20,22,0.92)';
const ERASE_FILL_HOVER = 'rgba(248,113,113,0.18)';
const ERASE_STROKE     = 'rgba(248,113,113,0.55)';
const ERASE_TEXT       = '#f87171';

const NEUTRAL_FILL_IDLE  = 'rgba(20,20,22,0.92)';
const NEUTRAL_FILL_HOVER = 'rgba(255,255,255,0.10)';
const NEUTRAL_STROKE     = 'rgba(255,255,255,0.55)';

function getHoveredSector(dx: number, dy: number, sectors: SectorDef[]): number {
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

function renderToolIcon(tool: WheelTool, size = 22) {
  switch (tool) {
    case 'brush':           return <Paintbrush width={size} height={size} strokeWidth={1.6} />;
    case 'eraser':          return <Eraser width={size} height={size} strokeWidth={1.6} />;
    case 'linear-gradient': return <LinearGradientIcon size={size} />;
    case 'radial-gradient': return <RadialGradientIcon size={size} />;
  }
}

export function ToolWheel({ x, y, hasMaskSelected, onHoverChange }: ToolWheelProps) {
  const sectors = hasMaskSelected ? SPLIT_SECTORS : SIMPLE_SECTORS;
  const sliceSize = hasMaskSelected ? 60 : 120;
  const sliceGap  = 1.2;

  const [hovered, setHovered] = useState<number>(0);
  const originRef = useRef({ x, y });

  useEffect(() => { originRef.current = { x, y }; }, [x, y]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - originRef.current.x;
      const dy = e.clientY - originRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CANCEL_R) {
        setHovered(-1);
        onHoverChange?.(-1);
      } else {
        const next = getHoveredSector(dx, dy, sectors);
        setHovered(next);
        onHoverChange?.(next);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [sectors, onHoverChange]);

  const size = (HEADER_R + 40) * 2;
  const center = size / 2;

  const activeSector = hovered >= 0 ? sectors[hovered] : null;

  return (
    <div
      className="fixed z-[9999]"
      style={{ left: x - center, top: y - center, width: size, height: size, pointerEvents: 'none' }}
    >
      <svg width={size} height={size} style={{ overflow: 'visible' }}>
        <defs>
          <filter id="wheelShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="4" stdDeviation="12" floodColor="#000" floodOpacity="0.5" />
          </filter>
          <radialGradient id="wheelBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(28,28,32,0.95)" />
            <stop offset="100%" stopColor="rgba(14,14,16,0.95)" />
          </radialGradient>
        </defs>

        <g transform={`translate(${center}, ${center})`} filter="url(#wheelShadow)">

          {/* Backplate */}
          <circle cx={0} cy={0} r={OUTER_R + 6} fill="url(#wheelBg)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

          {/* Sectors */}
          {sectors.map((sector, i) => {
            const startAngle = sector.angle - sliceSize / 2 + sliceGap / 2;
            const endAngle   = sector.angle + sliceSize / 2 - sliceGap / 2;
            const isActive   = hovered === i;
            const isAdd      = sector.mode === 'add';

            const fillIdle  = hasMaskSelected ? (isAdd ? ADD_FILL_IDLE  : ERASE_FILL_IDLE)  : NEUTRAL_FILL_IDLE;
            const fillHover = hasMaskSelected ? (isAdd ? ADD_FILL_HOVER : ERASE_FILL_HOVER) : NEUTRAL_FILL_HOVER;
            const strokeCol = hasMaskSelected ? (isAdd ? ADD_STROKE     : ERASE_STROKE)     : NEUTRAL_STROKE;

            return (
              <path
                key={`sector-${i}`}
                d={sectorPath(OUTER_R, INNER_R, startAngle, endAngle)}
                fill={isActive ? fillHover : fillIdle}
                stroke={isActive ? strokeCol : 'rgba(255,255,255,0.04)'}
                strokeWidth={isActive ? 1.5 : 1}
                style={{ transition: 'fill 80ms ease-out, stroke 80ms ease-out' }}
              />
            );
          })}

          {/* Mode tabs (ADD / ERASE) — small bumps physically attached to each
              half of the wheel. The tab's flat side sits flush with the outer
              ring so it reads as an extension of the wheel, not floating text. */}
          {hasMaskSelected && (() => {
            // Tab geometry: a rectangle that starts at the outer ring and
            // extends outward, with rounded outer corners.
            const tabH = 22;          // height along the vertical axis
            const tabW = 18;          // how far it extends out from the ring
            const innerX = OUTER_R + 6; // sits just past the backplate edge
            const outerX = innerX + tabW;
            const r = 6;              // outer corner radius

            // Left tab path (mirrored): flat edge on the right (touching wheel),
            // rounded corners on the left (outer side).
            const leftTab = [
              `M ${-innerX} ${-tabH / 2}`,
              `H ${-(outerX - r)}`,
              `Q ${-outerX} ${-tabH / 2} ${-outerX} ${-tabH / 2 + r}`,
              `V ${tabH / 2 - r}`,
              `Q ${-outerX} ${tabH / 2} ${-(outerX - r)} ${tabH / 2}`,
              `H ${-innerX}`,
              'Z',
            ].join(' ');

            const rightTab = [
              `M ${innerX} ${-tabH / 2}`,
              `H ${outerX - r}`,
              `Q ${outerX} ${-tabH / 2} ${outerX} ${-tabH / 2 + r}`,
              `V ${tabH / 2 - r}`,
              `Q ${outerX} ${tabH / 2} ${outerX - r} ${tabH / 2}`,
              `H ${innerX}`,
              'Z',
            ].join(' ');

            return (
              <>
                {/* ADD tab — left */}
                <path d={leftTab}
                  fill="rgba(74,222,128,0.18)"
                  stroke="rgba(74,222,128,0.5)"
                  strokeWidth={1} />
                <g transform={`translate(${-(innerX + tabW / 2)}, 0)`} style={{ color: ADD_TEXT }}>
                  <g transform="translate(-4, -4)">
                    <Plus width={8} height={8} strokeWidth={3} />
                  </g>
                </g>

                {/* ERASE tab — right */}
                <path d={rightTab}
                  fill="rgba(248,113,113,0.18)"
                  stroke="rgba(248,113,113,0.5)"
                  strokeWidth={1} />
                <g transform={`translate(${innerX + tabW / 2}, 0)`} style={{ color: ERASE_TEXT }}>
                  <g transform="translate(-4, -4)">
                    <Minus width={8} height={8} strokeWidth={3} />
                  </g>
                </g>
              </>
            );
          })()}

          {/* Icons + labels per sector */}
          {sectors.map((sector, i) => {
            const rad = (sector.angle * Math.PI) / 180;
            const ix = Math.cos(rad) * ICON_R;
            const iy = Math.sin(rad) * ICON_R;
            const lx = Math.cos(rad) * LABEL_R;
            const ly = Math.sin(rad) * LABEL_R;
            const isActive = hovered === i;
            const isAdd    = sector.mode === 'add';

            const accent = hasMaskSelected ? (isAdd ? ADD_TEXT : ERASE_TEXT) : '#fff';
            const iconColor  = isActive ? accent : 'rgba(255,255,255,0.55)';
            const labelColor = isActive ? accent : 'rgba(255,255,255,0.4)';

            return (
              <g key={`sector-ui-${i}`}>
                <g transform={`translate(${ix}, ${iy})`}>
                  <g transform="translate(-11, -11)"
                    style={{ color: iconColor, transition: 'color 80ms ease-out' }}>
                    {renderToolIcon(sector.tool, 22)}
                  </g>
                </g>
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  fontSize="10" fontWeight={isActive ? 600 : 500}
                  fill={labelColor}
                  style={{
                    pointerEvents: 'none',
                    transition: 'fill 80ms ease-out, font-weight 80ms ease-out',
                    fontFamily: 'Geist, sans-serif',
                    letterSpacing: '0.02em',
                  }}>
                  {sector.label}
                </text>
              </g>
            );
          })}

          {/* Inner hub */}
          <circle cx={0} cy={0} r={INNER_R - 2}
            fill={hovered === -1 ? 'rgba(248,113,113,0.15)' : 'rgba(10,10,12,0.85)'}
            stroke={hovered === -1 ? 'rgba(248,113,113,0.55)' : 'rgba(255,255,255,0.08)'}
            strokeWidth="1"
            style={{ transition: 'fill 80ms ease-out, stroke 80ms ease-out' }} />

          {/* Center cancel icon / active tool preview */}
          {hovered === -1 ? (
            <g transform="translate(-9, -9)" style={{ color: ERASE_TEXT }}>
              <X width={18} height={18} strokeWidth={2} />
            </g>
          ) : activeSector ? (
            <g transform="translate(-10, -10)" style={{
              color: hasMaskSelected
                ? (activeSector.mode === 'add' ? ADD_TEXT : ERASE_TEXT)
                : 'rgba(255,255,255,0.85)',
              transition: 'color 80ms ease-out',
            }}>
              {renderToolIcon(activeSector.tool, 20)}
            </g>
          ) : null}

        </g>
      </svg>
    </div>
  );
}
