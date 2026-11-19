import React from 'react';
import { Menu, Plug } from 'lucide-react';
import { NavTab } from './Sidebar';

interface TopBarProps {
  activeTab: NavTab;
  selectedAthleteName?: string;
  onOpenMobileMenu: () => void;
  onNavigateIntegrations: () => void;
}

const TAB_LABELS: Record<NavTab, string> = {
  command: 'Coach Command Center',
  dashboard: 'Coach Dashboard',
  roster: 'Athlete Roster',
  athlete: 'Athlete Analysis',
  ai: 'AI Coaching',
  reports: 'Weekly Reports',
  integrations: 'Integrations',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  selectedAthleteName,
  onOpenMobileMenu,
  onNavigateIntegrations,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-semibold text-slate-500 whitespace-nowrap hidden sm:inline">
              Running Coach AI
            </span>
            <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
              /
            </span>
            <h1 className="truncate font-display text-base font-bold text-navy-900 sm:text-lg">
              {TAB_LABELS[activeTab]}
            </h1>
            {(activeTab === 'athlete' || activeTab === 'ai') && selectedAthleteName && (
              <>
                <span className="text-slate-300 hidden md:inline" aria-hidden="true">
                  /
                </span>
                <span className="hidden truncate font-medium text-slate-600 md:inline">
                  {selectedAthleteName}
                </span>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onNavigateIntegrations}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap transition-colors hover:bg-slate-50"
        >
          <Plug className="h-3.5 w-3.5 text-slate-500" />
          <span>Connectors: Offline (Sample Mode)</span>
        </button>
      </div>
    </header>
  );
};
