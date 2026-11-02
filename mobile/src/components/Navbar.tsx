import { ClipboardCheck, Home, ScanLine, Settings } from 'lucide-react';

export type TabType = 'home' | 'price' | 'opname' | 'settings';

interface NavbarProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  pendingCount?: number;
}

export function Navbar({ currentTab, onChangeTab, pendingCount = 0 }: NavbarProps) {
  const tabs: Array<{ id: TabType; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }> = [
    { id: 'home', label: 'Beranda', icon: Home },
    { id: 'price', label: 'Cek Harga', icon: ScanLine },
    { id: 'opname', label: 'Opname', icon: ClipboardCheck, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 select-none pb-safe">
      <div className="grid grid-cols-4 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 transition-colors relative ${
                isActive ? 'text-emerald-700 font-semibold' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <Icon className={`size-5 ${isActive ? 'stroke-[2.2]' : 'stroke-[1.7]'}`} />
                {Boolean(tab.badge && tab.badge > 0) && (
                  <span className="absolute -top-1 -right-2 bg-amber-500 text-white text-[9px] font-bold px-1 rounded-full min-w-3.5 text-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

