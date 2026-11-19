import React from 'react';
import {
  Activity,
  BrainCircuit,
  FileText,
  Gauge,
  LayoutDashboard,
  Plug,
  Users,
  X,
} from 'lucide-react';

export type NavTab =
  | 'command'
  | 'dashboard'
  | 'roster'
  | 'athlete'
  | 'ai'
  | 'reports'
  | 'integrations';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  attentionCount: number;
  pendingApprovalCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  attentionCount,
  pendingApprovalCount,
  mobileOpen,
  onCloseMobile,
}) => {
  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    countLabel?: string;
  }> = [
    {
      id: 'command',
      label: 'Command Center',
      icon: <Gauge className="h-4 w-4" />,
      countLabel: attentionCount > 0 ? String(attentionCount) : undefined,
    },
    { id: 'dashboard', label: 'Coach Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'roster', label: 'Athlete Roster', icon: <Users className="h-4 w-4" /> },
    { id: 'athlete', label: 'Athlete Analysis', icon: <Activity className="h-4 w-4" /> },
    {
      id: 'ai',
      label: 'AI Coaching',
      icon: <BrainCircuit className="h-4 w-4" />,
      countLabel: attentionCount > 0 ? String(attentionCount) : undefined,
    },
    {
      id: 'reports',
      label: 'Weekly Reports',
      icon: <FileText className="h-4 w-4" />,
      countLabel: pendingApprovalCount > 0 ? String(pendingApprovalCount) : undefined,
    },
    { id: 'integrations', label: 'Integrations', icon: <Plug className="h-4 w-4" /> },
  ];

  const handleNav = (id: NavTab) => {
    onSelectTab(id);
    onCloseMobile();
  };

  const content = (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sky-300">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="font-display text-sm font-bold tracking-tight text-white">
              Running Coach AI
            </p>
            <p className="text-xs text-slate-400">Coaching Workspace</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-md p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Primary navigation">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNav(item.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-white text-navy-900'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-3">
                {item.icon}
                <span>{item.label}</span>
              </span>
              {item.countLabel !== undefined && (
                <span
                  className={`font-mono text-xs font-semibold tabular-nums ${
                    active ? 'text-navy-700' : 'text-slate-400'
                  }`}
                >
                  {item.countLabel}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-5 py-4 text-xs text-slate-400">
        <p className="font-semibold text-slate-200">Sample Dataset Active</p>
        <p className="mt-1 leading-relaxed">
          30 fictional runners loaded locally. External connectors disconnected.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 lg:block">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-navy-950/70 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-64">{content}</div>
        </div>
      )}
    </>
  );
};
