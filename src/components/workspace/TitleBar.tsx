import { Home, Wand2, Store } from 'lucide-react';

export function TitleBar() {
  return (
    <div className="flex h-[32px] w-full items-center justify-between bg-[#1C1C1C] px-4">
      {/* Left Side - Logo and Navigation */}
      <div className="flex items-center gap-3">
        {/* Traffic Lights from Figma */}
        <div className="flex items-center">
          <img src="/figma/traffic-lights.svg" alt="Traffic Lights" className="h-6 w-[72px]" />
        </div>

        {/* Logo with Pro Badge */}
        <div className="flex items-center gap-3 ml-3">
          <div className="flex items-center gap-1 px-1.5 py-0.5">
            <div className="w-3.5 h-3.5 rounded bg-gradient-to-br from-purple-500 via-blue-500 via-green-500 via-yellow-500 via-orange-500 to-red-500" />
          </div>
          <div className="flex items-center gap-1">
            <div className="px-1.5 py-0.5 bg-[rgba(224,198,9,0.1)] border border-[#E0C609] rounded-sm">
              <span className="text-[8px] font-semibold text-[#E2E2E2] tracking-wider uppercase">Pro</span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-[#474747]" />

        {/* Navigation Links */}
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#303030] transition-colors">
            <Home className="w-4 h-4 text-[#ABABAB]" />
            <span className="text-xs text-[#ABABAB]">Home</span>
          </button>
          <button className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#303030] transition-colors">
            <Wand2 className="w-4 h-4 text-[#ABABAB]" />
            <span className="text-xs text-[#ABABAB]">AI Profiles</span>
          </button>
          <button className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#303030] transition-colors">
            <Store className="w-4 h-4 text-[#ABABAB]" />
            <span className="text-xs text-[#ABABAB]">Marketplace</span>
          </button>
        </div>
      </div>

      {/* Right Side - Actions */}
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#303030] transition-colors">
          <div className="w-4 h-4 rounded bg-[#2AA76B]" />
        </button>
        <button className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#303030] transition-colors">
          <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-500 via-blue-500 to-green-500 border border-white/20" />
          <div className="flex items-center gap-0.5">
            <span className="text-xs text-[#E0C609]">0</span>
            <span className="text-xs text-[#E2E2E2]">Credits</span>
          </div>
        </button>
      </div>
    </div>
  );
}
