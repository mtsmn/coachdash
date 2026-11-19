import React from 'react';
import { Lock, Menu, Plug, ShieldCheck } from 'lucide-react';
import { NavTab } from './Sidebar';
import { CoachAuthStatus } from '../Auth/CoachAuthPanel';

interface TopBarProps {
  activeTab: NavTab;
  selectedAthleteName?: string;
  appMode?: 'demo' | 'production';
  authStatus?: CoachAuthStatus;
  verifiedCoachEmail?: string | null;
  onToggleMode?: (mode: 'demo' | 'production') => void;
  onOpenAuthModal?: () => void;
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
  appMode = 'demo',
  authStatus = 'signed_out',
  verifiedCoachEmail,
  onToggleMode,
  onOpenAuthModal,
  onOpenMobileMenu,
  onNavigateIntegrations,
}) => {
  const authLabel =
    authStatus === 'signed_in'
      ? verifiedCoachEmail ?? 'Owner Signed In'
      : authStatus === 'expired'
      ? 'Session Expired'
      : authStatus === 'unauthorized'
      ? 'Unauthorized'
      : 'Coach Sign In';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
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
            <span className="hidden font-semibold text-slate-500 whitespace-nowrap sm:inline">
              Running Coach AI
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
              /
            </span>
            <h1 className="truncate font-display text-base font-bold text-navy-900 sm:text-lg">
              {TAB_LABELS[activeTab]}
            </h1>
            {(activeTab === 'athlete' || activeTab === 'ai') && selectedAthleteName && (
              <>
                <span className="hidden text-slate-300 md:inline" aria-hidden="true">
                  /
                </span>
                <span className="hidden truncate font-medium text-slate-600 md:inline">
                  {selectedAthleteName}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onToggleMode && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => onToggleMode('demo')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                  appMode === 'demo'
                    ? 'bg-white text-navy-900 shadow-xs'
                    : 'text-slate-600 hover:text-navy-900'
                }`}
              >
                Demo Mode
              </button>
              <button
                type="button"
                onClick={() => onToggleMode('production')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                  appMode === 'production'
                    ? 'bg-navy-900 text-white'
                    : 'text-slate-600 hover:text-navy-900'
                }`}
              >
                Production
              </button>
            </div>
          )}

          {onOpenAuthModal && (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                authStatus === 'signed_in'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                  : authStatus === 'expired' || authStatus === 'unauthorized'
                  ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-slate-200 bg-white text-navy-900 hover:bg-slate-50'
              }`}
            >
              {authStatus === 'signed_in' ? (
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span className="max-w-44 truncate">{authLabel}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNavigateIntegrations}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-navy-900 whitespace-nowrap transition-colors hover:bg-slate-50"
          >
            <Plug className="h-3.5 w-3.5 text-slate-500" />
            <span>
              {appMode === 'production'
                ? 'Production Connectors'
                : 'Connectors: Offline (Sample Mode)'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
