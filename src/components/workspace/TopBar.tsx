import { Button } from '@/components/ui/button';

interface TopBarProps {
  activeTab?: 'import' | 'cull' | 'edit' | 'retouch';
  onTabChange?: (tab: 'import' | 'cull' | 'edit' | 'retouch') => void;
}

export function TopBar({ activeTab = 'edit', onTabChange }: TopBarProps) {
  const tabs = [
    { id: 'import' as const, label: 'IMPORT' },
    { id: 'cull' as const, label: 'CULL' },
    { id: 'edit' as const, label: 'EDIT' },
    { id: 'retouch' as const, label: 'RETOUCH' },
  ];

  return (
    <div className="flex w-full items-center justify-between bg-[#1C1C1C] py-1.5 pr-3 pb-1.5 pl-2" style={{ gap: '173px' }}>
      {/* Left Side Controls */}
      <div className="flex w-[400px] items-center gap-2.5">
        {/* Icon Stack 1 */}
        <div className="flex items-center gap-1">
          <button className="flex items-center justify-center p-1 rounded hover:bg-[#303030] transition-colors">
            <img src="/figma/icon-grid.svg" alt="Grid" className="w-6 h-6" />
          </button>
          <button className="flex items-center justify-center p-1 rounded hover:bg-[#303030] transition-colors">
            <img src="/figma/icon-monitor.svg" alt="Monitor" className="w-6 h-6" />
          </button>
          <button className="flex items-center justify-center p-1 rounded hover:bg-[#303030] transition-colors">
            <img src="/figma/icon-split.svg" alt="Split" className="w-6 h-6" />
          </button>
        </div>

        {/* Divider 1 */}
        <div className="h-4 w-px bg-[rgba(226,226,226,0.1)]" />

        {/* Icon Stack 2 */}
        <div className="flex items-center gap-1">
          <button className="flex items-center justify-center p-1 rounded hover:bg-[#303030] transition-colors">
            <img src="/figma/icon-filter.svg" alt="Filter" className="w-6 h-6" />
          </button>
          <button className="flex items-center justify-center p-1 rounded hover:bg-[#303030] transition-colors">
            <img src="/figma/icon-sort.svg" alt="Sort" className="w-6 h-6" />
          </button>
        </div>

        {/* Divider 2 */}
        <div className="h-4 w-px bg-[rgba(226,226,226,0.1)]" />

        {/* Add Images Button */}
        <button className="px-0.5 py-0.5 text-xs font-medium text-[#ABABAB] hover:text-white transition-colors">
          Add Images
        </button>
      </div>

      {/* Center - Tabs */}
      <div className="flex items-center gap-0.5 rounded-md bg-[#171717] p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange?.(tab.id)}
            className={`
              flex h-7 w-24 items-center justify-center rounded px-3 py-2
              text-[10px] font-semibold tracking-[0.5px] transition-all
              ${
                activeTab === tab.id
                  ? 'bg-[#303030] text-white'
                  : 'text-[#ABABAB] hover:bg-[#303030]/50 hover:text-white'
              }
            `}
            style={{ width: '96px', height: '28px' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Right Side Controls */}
      <div className="flex w-[400px] items-center justify-end">
        <button 
          className="flex h-8 items-center justify-center rounded-md bg-[#2563EB] px-3 text-xs font-medium text-white hover:bg-[#2563EB]/90 transition-colors"
        >
          Export
        </button>
      </div>
    </div>
  );
}
