
export function TitleBar() {
  return (
    <div className="flex h-[44px] w-full items-center justify-between bg-[#1C1C1C] px-2 border-b-[1px] border-[#000000] select-none">
      {/* Left Side - Traffic Lights & Navigation */}
      <div className="flex items-center h-full gap-4">
        {/* Traffic Lights & Logo Area */}
        <div className="flex items-center gap-3">
          {/* Traffic Lights */}
          <div className="flex gap-2">
            <img src="/figma/close.svg" alt="Close" className="w-3 h-3" />
            <img src="/figma/minimize.svg" alt="Minimize" className="w-3 h-3" />
            <img src="/figma/fullscreen.svg" alt="Fullscreen" className="w-3 h-3" />
          </div>

          {/* Logo & PRO Badge */}
          <div className="flex items-center gap-2">
            <img src="/figma/Vector.svg" alt="Logo" className="h-4 w-auto" />
            <div className="flex items-center justify-center px-1 py-0.5 rounded bg-[#E0C609]/10 border border-[#E0C609]/20">
              <span className="text-[#E0C609] text-[9px] font-bold tracking-wider leading-none">PRO</span>
            </div>
          </div>
        </div>

        {/* Vertical Separator */}
        <div className="h-4 w-px bg-[#474747]" />

        {/* Navigation Items */}
        <div className="flex items-center gap-1">
          <NavButton icon="/figma/home.svg" label="Home" />
          <NavButton icon="/figma/magic-wand.svg" label="AI Profiles" />
          <NavButton icon="/figma/storefront.svg" label="Marketplace" />
        </div>
      </div>

      {/* Right Side - Actions & Profile */}
      <div className="flex items-center h-full gap-2">
        {/* Actions */}
        <div className="flex items-center">
          <IconButton icon="/figma/message-circle.svg" label="Feedback" />
          <IconButton icon="/figma/monitor-play.svg" label="Tutorials" />
          <IconButton icon="/figma/settings.svg" label="Settings" />
          <IconButton icon="/figma/leaf.svg" label="Impact" />

          <div className="mx-2 h-4 w-px bg-[#474747]" />

          <button className="p-2 rounded hover:bg-[#2C2C2C] transition-colors group" title="Apps">
            <img src="/figma/grid.svg" className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" alt="Apps" />
          </button>
        </div>

        {/* Credits */}
        <div className="flex items-center px-3 py-1 bg-[#1A1A1A] rounded-full border border-[#333333]">
          <div className="w-4 h-4 rounded-full border border-[#E0C609] flex items-center justify-center mr-2">
            <span className="text-[#E0C609] text-[10px] font-serif">$</span>
          </div>
          <span className="text-xs font-medium text-[#E2E2E2]">0 Credits</span>
        </div>

        {/* Profile */}
        <button className="mr-2 w-6 h-6 rounded-full overflow-hidden border border-[#474747] hover:border-[#E2E2E2] transition-colors">
          <img
            src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"
            alt="User"
            className="w-full h-full object-cover"
          />
        </button>
      </div>
    </div>
  );
}

function NavButton({ icon, label, active = false }: { icon: string, label: string, active?: boolean }) {
  return (
    <button
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-md transition-all group
        ${active ? 'bg-[#2C2C2C]' : 'hover:bg-[#2C2C2C]'}
      `}
    >
      <img
        src={icon}
        alt={label}
        className={`w-4 h-4 ${active ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'} transition-opacity`}
      />
      <span className={`text-xs font-medium ${active ? 'text-[#E2E2E2]' : 'text-[#888888] group-hover:text-[#E2E2E2]'} transition-colors`}>
        {label}
      </span>
    </button>
  );
}

function IconButton({ icon, label }: { icon: string, label: string }) {
  return (
    <button className="p-2 rounded hover:bg-[#2C2C2C] transition-colors group" title={label}>
      <img
        src={icon}
        alt={label}
        className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity"
      />
    </button>
  );
}
