import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileText,
  HeartPulse,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  FullRosterSyncResponse,
  intervalsIcuAdapter,
  PilotSyncResponse,
  ProductionPilotDashboardResponse,
} from '../../integrations/intervalsIcuAdapter';
import {
  CoachingFindingDto,
  PersistedWeeklyReportDto,
  ProductionCoachingIntelligenceDto,
  productionIntelligenceAdapter,
} from '../../integrations/productionIntelligenceAdapter';
import { formatPace } from '../../utils/analytics';
import { NavTab } from '../Layout/Sidebar';

type WorkspaceSection = 'overview' | 'load' | 'intelligence' | 'reports';

interface ProductionPilotDashboardProps {
  accessToken: string | null;
  verifiedCoachEmail: string | null;
  pilotTestSucceeded: boolean;
  activeNavTab?: NavTab;
  onAuthError: (status: 401 | 403, message: string) => void;
  onOpenIntegrations: () => void;
  onSwitchToDemoMode: () => void;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '--';
  return iso.slice(0, 19).replace('T', ' ') + ' UTC';
}

function formatNumberOrDash(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '--';
  return decimals === 0 ? String(Math.round(val)) : val.toFixed(decimals);
}

function syncStatusClasses(status: string): string {
  if (status === 'Succeeded') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'Partial') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Blocked (Unauthorized)') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'Failed') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function streamBadgeClasses(status: string): string {
  if (status === 'imported') return 'bg-emerald-50 text-emerald-700';
  if (status === 'unavailable') return 'bg-amber-50 text-amber-800';
  if (status === 'not_applicable') return 'bg-slate-100 text-slate-500';
  return 'bg-slate-100 text-slate-600';
}

function classificationClasses(classification: CoachingFindingDto['classification']): string {
  if (classification === 'High priority: Coach review recommended') {
    return 'border-rose-200 bg-rose-50 text-rose-900';
  }
  if (classification === 'Moderate priority: Monitor') {
    return 'border-amber-200 bg-amber-50 text-amber-900';
  }
  if (classification === 'Positive development') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  return 'border-slate-200 bg-slate-50 text-slate-800';
}

function plannedSourceLabel(
  source: 'final_surge_api' | 'final_surge_csv' | 'coach_entry' | null | undefined
): string | null {
  if (source === 'final_surge_api') return 'Final Surge Sync';
  if (source === 'final_surge_csv') return 'Final Surge Export';
  if (source === 'coach_entry') return 'Manual Coach Entry';
  return null;
}

function methodologyLabel(id: string): string {
  if (id === 'hr_derived_stress') return 'HR-Derived Stress (hrRSS)';
  if (id === 'running_tss_pace') return 'Pace-Derived Stress (rTSS)';
  if (id === 'running_power_stress') return 'Running Power Stress';
  if (id === 'session_rpe_stress') return 'Session RPE Stress';
  return id;
}

function mapNavTabToSection(tab?: NavTab): WorkspaceSection {
  if (tab === 'ai') return 'intelligence';
  if (tab === 'reports') return 'reports';
  return 'overview';
}

export const ProductionPilotDashboard: React.FC<ProductionPilotDashboardProps> = ({
  accessToken,
  verifiedCoachEmail,
  pilotTestSucceeded,
  activeNavTab,
  onAuthError,
  onOpenIntegrations,
  onSwitchToDemoMode,
}) => {
  const [dashboard, setDashboard] = useState<ProductionPilotDashboardResponse | null>(null);
  const [intelligence, setIntelligence] = useState<ProductionCoachingIntelligenceDto | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(() =>
    mapNavTabToSection(activeNavTab)
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [rosterSyncing, setRosterSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<PilotSyncResponse | null>(null);
  const [rosterSyncFeedback, setRosterSyncFeedback] = useState<FullRosterSyncResponse | null>(
    null
  );
  const [selectedActivityWindow, setSelectedActivityWindow] = useState<'25' | '100' | 'all'>('25');
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterFilter, setRosterFilter] = useState<string>('all');

  // Planned workout quick-entry state
  const [showAddPlanForm, setShowAddPlanForm] = useState(false);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planTitle, setPlanTitle] = useState('Aerobic Base Run');
  const [planType, setPlanType] = useState<
    'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race'
  >('Easy');
  const [planMiles, setPlanMiles] = useState('6');
  const [planDuration, setPlanDuration] = useState('52');
  const [planZone, setPlanZone] = useState<'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'>('Z2');
  const [planError, setPlanError] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  // Weekly report coach note drafts
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingReportWeek, setSavingReportWeek] = useState<string | null>(null);

  useEffect(() => {
    if (activeNavTab === 'ai') setActiveSection('intelligence');
    else if (activeNavTab === 'reports') setActiveSection('reports');
  }, [activeNavTab]);

  const loadWorkspace = useCallback(
    async (athleteOverride?: string | null) => {
      setLoading(true);
      const targetId = athleteOverride !== undefined ? athleteOverride : selectedAthleteId;
      const [pilotRes, intelRes] = await Promise.all([
        intervalsIcuAdapter.fetchProductionPilotDashboard(accessToken, onAuthError, targetId),
        productionIntelligenceAdapter.fetchIntelligence({
          accessToken,
          athleteId: targetId,
          onAuthError,
        }),
      ]);
      setDashboard(pilotRes);
      setIntelligence(intelRes);
      const resolvedId = pilotRes?.athlete?.id ?? intelRes?.athlete?.id ?? null;
      if (resolvedId) {
        setSelectedAthleteId(resolvedId);
      }
      if (intelRes?.weeklyReports) {
        const nextDrafts: Record<string, string> = {};
        for (const rep of intelRes.weeklyReports) {
          nextDrafts[rep.weekStartDate] = rep.coachNote;
        }
        setNoteDrafts(nextDrafts);
      }
      setLoading(false);
    },
    [accessToken, onAuthError, selectedAthleteId]
  );

  useEffect(() => {
    void loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const handleRunPilotSync = async (mode: 'auto' | 'initial' | 'incremental' = 'auto') => {
    setSyncing(true);
    setRosterSyncFeedback(null);
    const res = await intervalsIcuAdapter.runPilotSynchronization({
      accessToken,
      pilotAthleteId: dashboard?.connection?.verifiedPilotAthleteId ?? undefined,
      mode,
      onAuthError,
    });
    setSyncFeedback(res);
    await loadWorkspace(res.internalAthleteId ?? selectedAthleteId);
    setSyncing(false);
  };

  const handleRunFullRosterSync = async (
    mode: 'auto' | 'initial' | 'incremental' = 'auto',
    options?: { athleteIds?: string[]; retryFailedOnly?: boolean }
  ) => {
    setRosterSyncing(true);
    setSyncFeedback(null);
    const res = await intervalsIcuAdapter.runFullRosterSynchronization({
      accessToken,
      mode,
      athleteIds: options?.athleteIds,
      retryFailedOnly: options?.retryFailedOnly,
      onAuthError,
    });
    setRosterSyncFeedback(res);
    const nextAthlete =
      options?.athleteIds?.length === 1
        ? res.athleteResults[0]?.internalAthleteId ?? selectedAthleteId
        : selectedAthleteId ??
          res.athleteResults.find((a) => a.internalAthleteId)?.internalAthleteId ??
          null;
    await loadWorkspace(nextAthlete);
    setRosterSyncing(false);
  };

  const handleRunIntelligenceAnalysis = async () => {
    setAnalyzing(true);
    const persisted = await productionIntelligenceAdapter.runAndPersistAnalysis({
      accessToken,
      athleteId: intelligence?.athlete?.id ?? selectedAthleteId,
      onAuthError,
    });
    if (persisted) {
      setIntelligence(persisted);
      const nextDrafts: Record<string, string> = {};
      for (const rep of persisted.weeklyReports) {
        nextDrafts[rep.weekStartDate] = rep.coachNote;
      }
      setNoteDrafts(nextDrafts);
    }
    setAnalyzing(false);
  };

  const handleSavePlannedWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intelligence?.athlete?.id) return;
    setSavingPlan(true);
    setPlanError(null);
    const res = await productionIntelligenceAdapter.addPlannedWorkout({
      accessToken,
      athleteId: intelligence.athlete.id,
      workout: {
        workoutDate: planDate,
        title: planTitle,
        workoutType: planType,
        plannedMiles: Number(planMiles) || 0,
        plannedDurationMin: Number(planDuration) || 0,
        targetZone: planZone,
      },
      onAuthError,
    });
    setSavingPlan(false);
    if (!res.ok) {
      setPlanError(res.error ?? 'Failed to add planned workout.');
      return;
    }
    if (res.intelligence) {
      setIntelligence(res.intelligence);
    } else {
      await loadWorkspace();
    }
    setShowAddPlanForm(false);
  };

  const handleUpdateAlertStatus = async (
    alertId: string | null,
    status: 'active' | 'acknowledged' | 'resolved'
  ) => {
    if (!alertId) {
      await handleRunIntelligenceAnalysis();
      return;
    }
    const ok = await productionIntelligenceAdapter.updateAlertStatus({
      accessToken,
      alertId,
      status,
      onAuthError,
    });
    if (ok) {
      await loadWorkspace();
    }
  };

  const handleSaveReport = async (
    rep: PersistedWeeklyReportDto,
    nextStatus?: 'Draft' | 'Approved'
  ) => {
    if (!intelligence?.athlete?.id) return;
    setSavingReportWeek(rep.weekStartDate);
    if (!rep.id) {
      await productionIntelligenceAdapter.runAndPersistAnalysis({
        accessToken,
        athleteId: intelligence.athlete.id,
        onAuthError,
      });
    }
    await productionIntelligenceAdapter.updateWeeklyReport({
      accessToken,
      athleteId: intelligence.athlete.id,
      weekStartDate: rep.weekStartDate,
      coachNote: noteDrafts[rep.weekStartDate] ?? rep.coachNote,
      status: nextStatus,
      onAuthError,
    });
    await loadWorkspace();
    setSavingReportWeek(null);
  };

  const latestWellness = dashboard?.wellnessRecords?.[0] ?? null;
  const latestLog = dashboard?.syncLogs?.[0] ?? null;
  const effectivePilotGate = dashboard?.connection
    ? dashboard.connection.pilotTestSucceeded
    : pilotTestSucceeded;

  const latestSystemCByMethod = React.useMemo(() => {
    if (!dashboard?.dailyLoadHistories?.length) return [];
    const seen = new Set<string>();
    const out: ProductionPilotDashboardResponse['dailyLoadHistories'] = [];
    for (const row of dashboard.dailyLoadHistories) {
      if (!seen.has(row.methodology)) {
        seen.add(row.methodology);
        out.push(row);
      }
    }
    return out;
  }, [dashboard]);

  const displayedActivities = React.useMemo(() => {
    const acts = dashboard?.activities ?? [];
    if (selectedActivityWindow === 'all') return acts;
    return acts.slice(0, selectedActivityWindow === '100' ? 100 : 25);
  }, [dashboard, selectedActivityWindow]);

  const loadIntel = intelligence?.loadIntelligence ?? null;
  const activeAlertCount =
    intelligence?.alerts.filter((a) => a.status === 'active').length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-xl bg-navy-900 p-5 text-white">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Production Mode · Owner Coach ({verifiedCoachEmail ?? 'Verified'})
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-200">
                {(dashboard?.availableAthletes?.length ?? 0) > 1
                  ? `Full Roster Synced (${dashboard!.availableAthletes!.length} Athletes)`
                  : 'Pilot Scope Only (Single Verified Athlete)'}
              </span>
            </div>
            <h2 className="mt-2 font-display text-lg font-bold">
              {dashboard?.athlete
                ? `${dashboard.athlete.fullName} — Live Coaching Intelligence & Workspace`
                : 'Intervals.icu Production Roster & Pilot Workspace'}
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              Supabase-backed training load intelligence, planned workouts, classified coaching
              alerts, and weekly coach reports. Demo athletes are never substituted here.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const athleteChoices =
                dashboard?.availableAthletes && dashboard.availableAthletes.length > 0
                  ? dashboard.availableAthletes
                  : intelligence?.availableAthletes ?? [];
              if (athleteChoices.length <= 1) return null;
              return (
                <select
                  value={selectedAthleteId ?? dashboard?.athlete?.id ?? intelligence?.athlete?.id ?? ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedAthleteId(id);
                    void loadWorkspace(id);
                  }}
                  aria-label="Select persisted athlete"
                  className="rounded-lg border border-white/25 bg-navy-800 px-2.5 py-2 text-xs font-semibold text-white"
                >
                  {athleteChoices.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fullName} ({a.externalAthleteId ?? a.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
              );
            })()}
            <button
              type="button"
              onClick={() => void handleRunPilotSync('auto')}
              disabled={syncing || rosterSyncing || !effectivePilotGate}
              title={
                effectivePilotGate
                  ? 'Synchronize verified pilot athlete from Intervals.icu into Supabase'
                  : 'Complete the 6-step Pilot Connection Test in Integrations first'
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Synchronizing Pilot...' : 'Sync Pilot Athlete'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunFullRosterSync('auto')}
              disabled={rosterSyncing || syncing || !effectivePilotGate}
              title={
                effectivePilotGate
                  ? 'Synchronize all shared Intervals.icu coached athletes into Supabase'
                  : 'Complete the 6-step Pilot Connection Test in Integrations first'
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rosterSyncing ? 'animate-spin' : ''}`} />
              <span>{rosterSyncing ? 'Syncing Full Roster...' : 'Sync Full Roster'}</span>
            </button>
            <button
              type="button"
              onClick={() => void handleRunIntelligenceAnalysis()}
              disabled={analyzing || loading || !dashboard?.hasPersistedPilot}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              <BrainCircuit className={`h-3.5 w-3.5 ${analyzing ? 'animate-pulse' : ''}`} />
              <span>{analyzing ? 'Analyzing...' : 'Persist Intelligence'}</span>
            </button>
            <button
              type="button"
              onClick={() => void loadWorkspace()}
              disabled={loading || syncing}
              className="rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              Refresh View
            </button>
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
            >
              Integrations
            </button>
          </div>
        </div>

        {/* Persisted Connection & Sync Strip */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs sm:grid-cols-4">
          <div>
            <p className="text-[11px] text-slate-400">Verified Pilot Athlete ID</p>
            <p className="mt-0.5 font-mono font-semibold text-white">
              {dashboard?.connection?.verifiedPilotAthleteId ?? 'Not Verified'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">Intervals.icu Coach Account</p>
            <p className="mt-0.5 font-semibold text-white">
              {dashboard?.connection?.externalCoachName ??
                dashboard?.connection?.externalCoachId ??
                '--'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">Last Synchronized At</p>
            <p className="mt-0.5 font-mono text-white tabular-nums">
              {formatTimestamp(dashboard?.connection?.lastSynchronizedAt)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-400">Latest Sync Status</p>
            <p className="mt-0.5 font-mono font-semibold text-sky-200">
              {latestLog
                ? latestLog.status
                : effectivePilotGate
                ? 'Ready for Initial Sync'
                : 'Locked (Pilot Unverified)'}
            </p>
          </div>
        </div>
      </div>

      {/* Sync Operation Outcome Banner */}
      {rosterSyncFeedback && (
        <div
          className={`space-y-2.5 rounded-xl border p-4 text-xs ${
            rosterSyncFeedback.status === 'Succeeded'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : rosterSyncFeedback.status === 'Partial'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              {rosterSyncFeedback.status === 'Succeeded' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : rosterSyncFeedback.status === 'Partial' ? (
                <AlertTriangle className="h-4 w-4 text-amber-700" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-rose-700" />
              )}
              <span>
                Full Roster Sync {rosterSyncFeedback.status} ({rosterSyncFeedback.athletesSucceededCount}{' '}
                succeeded
                {rosterSyncFeedback.athletesPartialCount > 0
                  ? `, ${rosterSyncFeedback.athletesPartialCount} partial`
                  : ''}
                {rosterSyncFeedback.permissionDeniedCount > 0
                  ? `, ${rosterSyncFeedback.permissionDeniedCount} permission denied`
                  : ''}
                {rosterSyncFeedback.athletesFailedCount > 0
                  ? `, ${rosterSyncFeedback.athletesFailedCount} failed`
                  : ''}
                )
              </span>
            </div>
            <span className="font-mono text-[11px]">
              Activities: {rosterSyncFeedback.totalActivitiesProcessed} saved /{' '}
              {rosterSyncFeedback.totalDuplicatesSkipped} unchanged · HR Streams:{' '}
              {rosterSyncFeedback.totalStreamsImported} · Wellness:{' '}
              {rosterSyncFeedback.totalWellnessProcessed}
            </span>
          </div>
          {rosterSyncFeedback.errorMessage && (
            <p className="font-mono text-[11px]">{rosterSyncFeedback.errorMessage}</p>
          )}
          {rosterSyncFeedback.athleteResults.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {rosterSyncFeedback.athleteResults.map((ar) => (
                <button
                  key={ar.externalAthleteId}
                  type="button"
                  disabled={!ar.internalAthleteId}
                  onClick={() => {
                    if (ar.internalAthleteId) {
                      setSelectedAthleteId(ar.internalAthleteId);
                      void loadWorkspace(ar.internalAthleteId);
                    }
                  }}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-left font-mono text-[11px] text-navy-900 hover:bg-slate-50 disabled:cursor-default disabled:opacity-70"
                >
                  {ar.athleteName ?? ar.externalAthleteId}: {ar.status} ({ar.activitiesProcessed}{' '}
                  act / {ar.wellnessProcessed} well)
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {syncFeedback && (
        <div
          className={`rounded-xl border p-4 text-xs ${
            syncFeedback.status === 'Succeeded'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : syncFeedback.status === 'Partial'
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              {syncFeedback.status === 'Succeeded' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              ) : syncFeedback.status === 'Partial' ? (
                <AlertTriangle className="h-4 w-4 text-amber-700" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-rose-700" />
              )}
              <span>
                Pilot Sync {syncFeedback.status} ({syncFeedback.syncMode} ·{' '}
                {syncFeedback.windowStart ?? '--'} to {syncFeedback.windowEnd ?? '--'})
              </span>
            </div>
            <span className="font-mono text-[11px]">
              Activities: {syncFeedback.activitiesProcessed} saved / {syncFeedback.duplicatesSkipped}{' '}
              unchanged · HR Streams: {syncFeedback.streamsImported} imported (
              {syncFeedback.streamsMissing} missing, {syncFeedback.streamsUnavailable} unavailable) ·
              Wellness: {syncFeedback.wellnessProcessed}
            </span>
          </div>
          {syncFeedback.errorMessage && (
            <p className="mt-2 font-mono text-[11px]">{syncFeedback.errorMessage}</p>
          )}
          {syncFeedback.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px]">
              {syncFeedback.warnings.slice(0, 6).map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Roster-Level Overview (Milestone 3.5) */}
      {dashboard?.configured && dashboard.rosterOverview && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
            <div>
              <h3 className="font-display text-base font-bold text-navy-900">
                Roster-Level Synchronization Overview
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Inspect sync coverage across all persisted athletes and drill into any athlete dashboard.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleRunFullRosterSync('auto', { retryFailedOnly: true })}
                disabled={
                  rosterSyncing ||
                  syncing ||
                  !effectivePilotGate ||
                  (dashboard.rosterOverview.failedCount === 0 &&
                    dashboard.rosterOverview.partialCount === 0)
                }
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Retry Failed
              </button>
              <button
                type="button"
                onClick={onOpenIntegrations}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
              >
                Manage Roster Mappings
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-3 lg:grid-cols-9 tabular-nums">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Total Roster</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                {dashboard.rosterOverview.totalSharedAthletes}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Mapped</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-emerald-700">
                {dashboard.rosterOverview.mappedAthletes}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Unmapped</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-slate-700">
                {dashboard.rosterOverview.unmappedAthletes}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Eligible</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                {dashboard.rosterOverview.eligibleAthletes}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Succeeded</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-emerald-700">
                {dashboard.rosterOverview.succeededCount}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Partial</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-amber-700">
                {dashboard.rosterOverview.partialCount}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Failed</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-rose-700">
                {dashboard.rosterOverview.failedCount}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Last Roster Sync</p>
              <p className="mt-0.5 truncate font-mono text-[11px] font-semibold text-navy-900">
                {dashboard.rosterOverview.lastFullRosterSyncAt
                  ? dashboard.rosterOverview.lastFullRosterSyncAt.slice(0, 16).replace('T', ' ')
                  : '--'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <p className="text-[10px] text-slate-500">Live Progress</p>
              <p className="mt-0.5 font-mono text-[11px] font-semibold text-navy-900">
                {dashboard.rosterOverview.liveProgress?.running
                  ? `${dashboard.rosterOverview.liveProgress.completedCount}/${dashboard.rosterOverview.liveProgress.totalSelected}`
                  : rosterSyncing
                  ? 'Syncing...'
                  : 'Idle'}
              </p>
            </div>
          </div>

          {dashboard.rosterOverview.athletes.length > 0 && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  placeholder="Filter roster athletes by name or Intervals ID..."
                  aria-label="Filter dashboard roster overview"
                  className="w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-navy-900"
                />
                <select
                  value={rosterFilter}
                  onChange={(e) => setRosterFilter(e.target.value)}
                  aria-label="Filter dashboard roster by status"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900"
                >
                  <option value="all">All Statuses</option>
                  <option value="Succeeded">Succeeded</option>
                  <option value="Partially succeeded">Partially succeeded</option>
                  <option value="Failed">Failed</option>
                  <option value="Permission unavailable">Permission unavailable</option>
                  <option value="Not mapped">Not mapped</option>
                </select>
              </div>

              <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Athlete</th>
                      <th className="px-3 py-2 font-semibold">Mapping / Auth</th>
                      <th className="px-3 py-2 font-semibold">Sync Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Activities / HR / Well</th>
                      <th className="px-3 py-2 font-semibold">Last Success</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboard.rosterOverview.athletes
                      .filter((a) => {
                        const q = rosterSearch.trim().toLowerCase();
                        if (
                          q &&
                          !a.fullName.toLowerCase().includes(q) &&
                          !(a.externalAthleteId ?? '').toLowerCase().includes(q)
                        ) {
                          return false;
                        }
                        if (rosterFilter !== 'all' && a.currentSyncStatus !== rosterFilter) {
                          return false;
                        }
                        return true;
                      })
                      .map((a) => (
                        <tr
                          key={a.internalAthleteId}
                          className={
                            selectedAthleteId === a.internalAthleteId
                              ? 'bg-sky-50/60'
                              : 'hover:bg-slate-50'
                          }
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <p className="font-semibold text-navy-900">
                              {a.fullName}
                              {a.isPilotAthlete && (
                                <span className="ml-1 font-mono text-[10px] text-sky-700">
                                  [Pilot]
                                </span>
                              )}
                            </p>
                            <p className="font-mono text-[10px] text-slate-500">
                              {a.externalAthleteId ?? 'No Intervals ID'}
                            </p>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <p className="font-semibold text-navy-900">{a.mappingStatus}</p>
                            <p className="text-[10px] text-slate-500">{a.authorizationStatus}</p>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span
                              className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${syncStatusClasses(
                                a.currentSyncStatus
                              )}`}
                            >
                              {a.currentSyncStatus}
                            </span>
                            {a.mostRecentError && (
                              <p
                                className="mt-0.5 max-w-xs truncate text-[10px] text-rose-700"
                                title={a.mostRecentError}
                              >
                                {a.mostRecentError}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                            {a.activitiesCount} / {a.hrStreamsCount} / {a.wellnessCount}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {a.lastSuccessfulSyncAt
                              ? a.lastSuccessfulSyncAt.slice(0, 16).replace('T', ' ')
                              : '--'}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <div className="inline-flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAthleteId(a.internalAthleteId);
                                  setActiveSection('overview');
                                  void loadWorkspace(a.internalAthleteId);
                                }}
                                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-900 hover:bg-slate-50"
                              >
                                Open Dashboard
                              </button>
                              {a.externalAthleteId && (
                                <button
                                  type="button"
                                  disabled={rosterSyncing || !effectivePilotGate}
                                  onClick={() =>
                                    void handleRunFullRosterSync('auto', {
                                      athleteIds: [a.externalAthleteId!],
                                    })
                                  }
                                  className="rounded bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800 disabled:opacity-40"
                                >
                                  Sync Athlete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workspace Sub-Navigation */}
      {dashboard?.hasPersistedPilot && dashboard.athlete && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
          {(
            [
              { id: 'overview', label: 'Overview & Telemetry', icon: Database },
              { id: 'load', label: 'Training Load Intelligence', icon: Activity },
              {
                id: 'intelligence',
                label: `AI Coaching Findings (${activeAlertCount})`,
                icon: BrainCircuit,
              },
              {
                id: 'reports',
                label: `Weekly Reports (${intelligence?.weeklyReports.length ?? 0})`,
                icon: FileText,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-navy-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading / Unconfigured / Unpersisted States */}
      {loading && !dashboard ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-600">
          Loading persisted Supabase pilot workspace...
        </div>
      ) : !dashboard || !dashboard.configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-xs text-amber-950">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h3 className="font-display text-sm font-bold">
                Supabase Production Persistence Not Configured on Server
              </h3>
              <p className="mt-1 leading-relaxed text-amber-900">
                Configure <code className="font-mono">SUPABASE_URL</code>,{' '}
                <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, and{' '}
                <code className="font-mono">INTERVALS_ICU_API_KEY</code> on the server to synchronize
                and persist live pilot athlete telemetry. Demo athletes are strictly isolated and
                never displayed in Production Mode.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onOpenIntegrations}
                  className="rounded-lg bg-navy-900 px-3 py-1.5 font-semibold text-white hover:bg-navy-800"
                >
                  Open Integrations Setup
                </button>
                <button
                  type="button"
                  onClick={onSwitchToDemoMode}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Switch to Demo Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : !dashboard.hasPersistedPilot || !dashboard.athlete ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-base font-bold text-navy-900">
              {effectivePilotGate
                ? 'Pilot Verified — Ready for Initial Data Import'
                : 'Pilot Athlete Verification Required'}
            </h3>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-600">
              {effectivePilotGate
                ? `Milestone 3.1 verified pilot athlete "${dashboard.connection?.verifiedPilotAthleteId}" in Supabase. Click "Sync Pilot Athlete" above to import historical completed activities, heart-rate streams, wellness records, and independent load metrics.`
                : 'Run and pass the 6-step Pilot Athlete Connection Test in Integrations first. Full-roster and pilot data ingestion remain locked until the pilot athlete is verified.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {effectivePilotGate ? (
                <button
                  type="button"
                  onClick={() => void handleRunPilotSync('initial')}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                  <span>{syncing ? 'Running Initial Pilot Import...' : 'Run Initial Pilot Import'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenIntegrations}
                  className="rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-navy-800"
                >
                  Go to Integrations & Verify Pilot
                </button>
              )}
            </div>
          </div>

          {dashboard.syncLogs.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-base font-bold text-navy-900">
                Synchronization Logs ({dashboard.syncLogs.length})
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Server-recorded audit trail of pilot sync runs, skipped duplicates, and failures.
              </p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs tabular-nums">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2.5 py-2 font-semibold">Started</th>
                      <th className="px-2.5 py-2 font-semibold">Job Type</th>
                      <th className="px-2.5 py-2 font-semibold">Status</th>
                      <th className="px-2.5 py-2 text-right font-semibold">Saved / Dup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboard.syncLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-2.5 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {log.startedAt.slice(0, 19).replace('T', ' ')}
                        </td>
                        <td className="px-2.5 py-2 font-mono text-[11px] text-navy-900">
                          {log.jobType}
                        </td>
                        <td className="px-2.5 py-2">
                          <span
                            className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${syncStatusClasses(
                              log.status
                            )}`}
                          >
                            {log.status}
                          </span>
                          {log.errorMessage && (
                            <p className="mt-1 max-w-md text-[11px] text-slate-500">
                              {log.errorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-2.5 py-2 text-right font-mono">
                          {log.recordsProcessed} / {log.duplicatesSkipped}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* SECTION 1: OVERVIEW & TELEMETRY */}
          {activeSection === 'overview' && (
            <div className="space-y-6">
              {/* Executive Intelligence Snapshot Strip */}
              {loadIntel && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      System C EWMA Load
                    </p>
                    <p className="mt-1 font-mono text-xl font-bold text-navy-900 tabular-nums">
                      {loadIntel.systemC.available
                        ? `${loadIntel.systemC.ctl?.toFixed(1)} / ${loadIntel.systemC.atl?.toFixed(
                            1
                          )} / ${
                            (loadIntel.systemC.tsb ?? 0) >= 0 ? '+' : ''
                          }${loadIntel.systemC.tsb?.toFixed(1)}`
                        : '-- / -- / --'}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {loadIntel.systemC.available
                        ? `CTL / ATL / TSB · ${loadIntel.systemC.formLabel}`
                        : 'Set LTHR or threshold pace to compute'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      4-Week Volume & Consistency
                    </p>
                    <p className="mt-1 font-mono text-xl font-bold text-navy-900 tabular-nums">
                      {loadIntel.volumeAndConsistency.fourWeekAvgMiles.toFixed(1)} mi/wk
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {loadIntel.volumeAndConsistency.fourWeekAvgRunsPerWeek.toFixed(1)} runs/wk ·{' '}
                      {Math.round(loadIntel.volumeAndConsistency.fourWeekAvgDurationMinutes)} min/wk
                      ({loadIntel.volumeAndConsistency.consistencyLevel})
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Planned Workouts On File
                    </p>
                    <p className="mt-1 font-mono text-xl font-bold text-navy-900 tabular-nums">
                      {intelligence?.plannedWorkouts.length ?? 0}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Manual coach entries &amp; synced calendar workouts
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Coaching Findings
                    </p>
                    <p className="mt-1 font-mono text-xl font-bold text-navy-900 tabular-nums">
                      {intelligence?.alerts.length ?? 0} total
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {activeAlertCount} active ·{' '}
                      {
                        (intelligence?.alerts ?? []).filter(
                          (a) => a.classification === 'High priority: Coach review recommended'
                        ).length
                      }{' '}
                      high priority
                    </p>
                  </div>
                </div>
              )}

              {/* Pilot Athlete Profile + System A vs System C Grid */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Profile Card */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Persisted Pilot Athlete
                      </p>
                      <h3 className="mt-0.5 font-display text-base font-bold text-navy-900">
                        {dashboard.athlete.fullName}
                      </h3>
                      <p className="font-mono text-[11px] text-slate-500">
                        Intervals ID: {dashboard.athlete.externalAthleteId ?? '--'} · Origin:{' '}
                        {dashboard.athlete.dataOrigin}
                      </p>
                    </div>
                    <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-700">
                      {dashboard.athlete.matchStatus ?? 'Verified'}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-[11px] text-slate-500">Email</dt>
                      <dd className="truncate font-mono text-navy-900">
                        {dashboard.athlete.email ?? '--'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Age / Gender</dt>
                      <dd className="font-mono text-navy-900">
                        {dashboard.athlete.age ?? '--'} / {dashboard.athlete.gender ?? '--'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Resting HR / Max HR</dt>
                      <dd className="font-mono font-semibold text-navy-900 tabular-nums">
                        {dashboard.athlete.restingHrBpm ?? '--'} /{' '}
                        {dashboard.athlete.maxHrBpm ?? '--'} bpm
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Active LTHR</dt>
                      <dd className="font-mono font-semibold text-navy-900 tabular-nums">
                        {dashboard.athlete.activeLthrBpm
                          ? `${dashboard.athlete.activeLthrBpm} bpm`
                          : '--'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Threshold Pace</dt>
                      <dd className="font-mono text-navy-900 tabular-nums">
                        {dashboard.athlete.thresholdPaceSecPerMile
                          ? `${formatPace(dashboard.athlete.thresholdPaceSecPerMile)}/mi`
                          : '--'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-slate-500">Latest Weight</dt>
                      <dd className="font-mono text-navy-900 tabular-nums">
                        {dashboard.athlete.latestWeightKg !== null
                          ? `${dashboard.athlete.latestWeightKg.toFixed(1)} kg`
                          : '--'}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* Provider-Native Load (System A) */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        System A · Provider Native (Verbatim)
                      </p>
                      <h3 className="mt-0.5 font-display text-base font-bold text-navy-900">
                        Intervals.icu Wellness & Fitness
                      </h3>
                    </div>
                    <HeartPulse className="h-4 w-4 text-sky-700" />
                  </div>

                  {latestWellness ? (
                    <div className="mt-3 space-y-3 text-xs">
                      <p className="font-mono text-[11px] text-slate-500">
                        Latest Wellness Record: {latestWellness.recordDate}
                      </p>
                      <div className="grid grid-cols-3 gap-2 tabular-nums">
                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                          <p className="text-[10px] text-slate-500">ICU CTL</p>
                          <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                            {formatNumberOrDash(latestWellness.icuCtl, 1)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                          <p className="text-[10px] text-slate-500">ICU ATL</p>
                          <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                            {formatNumberOrDash(latestWellness.icuAtl, 1)}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                          <p className="text-[10px] text-slate-500">ICU Form</p>
                          <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                            {formatNumberOrDash(latestWellness.icuTsb, 1)}
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 tabular-nums">
                        <div>
                          <p className="text-[11px] text-slate-500">Resting HR</p>
                          <p className="font-mono font-semibold text-navy-900">
                            {latestWellness.restingHrBpm !== null
                              ? `${latestWellness.restingHrBpm} bpm`
                              : '--'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">HRV (rMSSD)</p>
                          <p className="font-mono font-semibold text-navy-900">
                            {formatNumberOrDash(latestWellness.hrvRmssd, 1)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-500">Sleep</p>
                          <p className="font-mono font-semibold text-navy-900">
                            {latestWellness.sleepHours !== null
                              ? `${latestWellness.sleepHours.toFixed(1)} h`
                              : '--'}
                          </p>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Native Intervals.icu load values are preserved verbatim without equating them
                        to TSS.
                      </p>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-slate-500">
                      No wellness records returned for the synced window.
                    </p>
                  )}
                </div>

                {/* Independent Load Engine (System C) */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        System C · Methodology-Isolated
                      </p>
                      <h3 className="mt-0.5 font-display text-base font-bold text-navy-900">
                        Independent EWMA Load Engine
                      </h3>
                    </div>
                    <Activity className="h-4 w-4 text-emerald-700" />
                  </div>

                  {latestSystemCByMethod.length > 0 ? (
                    <div className="mt-3 space-y-2.5 text-xs">
                      {latestSystemCByMethod.map((m) => (
                        <div
                          key={m.methodology}
                          className="rounded-lg border border-slate-100 bg-slate-50 p-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-navy-900">
                              {methodologyLabel(m.methodology)}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">{m.loadDate}</span>
                          </div>
                          <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono tabular-nums">
                            <div>
                              <span className="text-[10px] text-slate-500">CTL </span>
                              <span className="font-bold text-navy-900">{m.ctl.toFixed(1)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500">ATL </span>
                              <span className="font-bold text-navy-900">{m.atl.toFixed(1)}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500">TSB </span>
                              <span className="font-bold text-navy-900">{m.tsb.toFixed(1)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-slate-500">
                      Set an active LTHR or threshold pace on the pilot athlete profile to compute
                      isolated System C EWMA load histories.
                    </p>
                  )}
                </div>
              </div>

              {/* Completed Activities Table */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Persisted Completed Activities ({dashboard.activities.length})
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Missing fields remain NULL (shown as --). HR stream availability and
                      provider-native training load are shown alongside each imported activity.
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                    {(['25', '100', 'all'] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setSelectedActivityWindow(opt)}
                        className={`rounded-md px-2.5 py-1 font-semibold ${
                          selectedActivityWindow === opt
                            ? 'bg-navy-900 text-white'
                            : 'text-slate-600 hover:text-navy-900'
                        }`}
                      >
                        {opt === 'all' ? 'All' : `Latest ${opt}`}
                      </button>
                    ))}
                  </div>
                </div>

                {displayedActivities.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No completed activities imported yet.
                  </p>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs tabular-nums">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold">Workout / Type</th>
                          <th className="px-3 py-2 text-right font-semibold">Distance</th>
                          <th className="px-3 py-2 text-right font-semibold">Duration</th>
                          <th className="px-3 py-2 text-right font-semibold">Avg Pace</th>
                          <th className="px-3 py-2 text-right font-semibold">Elev Gain</th>
                          <th className="px-3 py-2 text-right font-semibold">Avg / Max HR</th>
                          <th className="px-3 py-2 font-semibold">HR Stream</th>
                          <th className="px-3 py-2 text-right font-semibold">
                            Intervals Load (Native)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {displayedActivities.map((act) => (
                          <tr key={act.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {act.activityDate}
                            </td>
                            <td className="px-3 py-2">
                              <p className="font-semibold text-navy-900">{act.title}</p>
                              <p className="font-mono text-[11px] text-slate-500">
                                {act.activityType} · {act.sourceDevice ?? act.externalActivityId}
                              </p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-navy-900 whitespace-nowrap">
                              {act.distanceMiles > 0 ? `${act.distanceMiles.toFixed(2)} mi` : '--'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-navy-900 whitespace-nowrap">
                              {act.durationMinutes > 0
                                ? `${Math.round(act.durationMinutes)} min`
                                : '--'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-navy-900 whitespace-nowrap">
                              {act.avgPaceSecPerMile
                                ? `${formatPace(act.avgPaceSecPerMile)}/mi`
                                : '--'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-navy-900 whitespace-nowrap">
                              {act.elevationGainFt !== null ? `${act.elevationGainFt} ft` : '--'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                              <span
                                className={
                                  act.hrDataState === 'valid'
                                    ? 'font-semibold text-navy-900'
                                    : act.hrDataState === 'invalid'
                                    ? 'text-rose-700'
                                    : 'text-slate-500'
                                }
                              >
                                {act.avgHrBpm ?? '--'} / {act.maxHrBpm ?? '--'}
                              </span>
                              <p className="text-[10px] text-slate-400">{act.hrDataState}</p>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span
                                className={`inline-block rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${streamBadgeClasses(
                                  act.streamStatus
                                )}`}
                              >
                                {act.streamStatus === 'imported'
                                  ? `Imported (${act.hrStreamSampleCount ?? 0} pts${
                                      act.hrStreamValidPct !== null
                                        ? `, ${act.hrStreamValidPct}%`
                                        : ''
                                    })`
                                  : act.streamStatus}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-navy-900 whitespace-nowrap">
                              {act.icuTrainingLoad !== null ? act.icuTrainingLoad.toFixed(1) : '--'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Wellness Records & Synchronization History Grid */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Recent Wellness Records ({dashboard.wellnessRecords.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Persisted daily wellness markers and verbatim Intervals.icu CTL/ATL.
                  </p>

                  {dashboard.wellnessRecords.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      No wellness records stored yet.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-xs tabular-nums">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-2.5 py-2 font-semibold">Date</th>
                            <th className="px-2.5 py-2 text-right font-semibold">RHR</th>
                            <th className="px-2.5 py-2 text-right font-semibold">HRV</th>
                            <th className="px-2.5 py-2 text-right font-semibold">Sleep</th>
                            <th className="px-2.5 py-2 text-right font-semibold">Wt (kg)</th>
                            <th className="px-2.5 py-2 text-right font-semibold">CTL / ATL</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dashboard.wellnessRecords.slice(0, 20).map((w) => (
                            <tr key={w.id}>
                              <td className="px-2.5 py-2 font-mono text-[11px] text-slate-600">
                                {w.recordDate}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {w.restingHrBpm ?? '--'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {formatNumberOrDash(w.hrvRmssd, 1)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {w.sleepHours !== null ? `${w.sleepHours.toFixed(1)}h` : '--'}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {formatNumberOrDash(w.weightKg, 1)}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {formatNumberOrDash(w.icuCtl, 1)} / {formatNumberOrDash(w.icuAtl, 1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Synchronization Logs */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Synchronization Logs ({dashboard.syncLogs.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Server-recorded audit trail of pilot sync runs, skipped duplicates, and
                    failures.
                  </p>

                  {dashboard.syncLogs.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      No synchronization runs logged yet.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-xs tabular-nums">
                        <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-2.5 py-2 font-semibold">Started</th>
                            <th className="px-2.5 py-2 font-semibold">Job Type</th>
                            <th className="px-2.5 py-2 font-semibold">Status</th>
                            <th className="px-2.5 py-2 text-right font-semibold">Saved / Dup</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dashboard.syncLogs.map((log) => (
                            <tr key={log.id}>
                              <td className="px-2.5 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                                {log.startedAt.slice(0, 19).replace('T', ' ')}
                              </td>
                              <td className="px-2.5 py-2 font-mono text-[11px] text-navy-900">
                                {log.jobType}
                              </td>
                              <td className="px-2.5 py-2">
                                <span
                                  className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${syncStatusClasses(
                                    log.status
                                  )}`}
                                >
                                  {log.status}
                                </span>
                                {log.errorMessage && (
                                  <p
                                    className="mt-1 max-w-xs truncate text-[11px] text-slate-500"
                                    title={log.errorMessage}
                                  >
                                    {log.errorMessage}
                                  </p>
                                )}
                              </td>
                              <td className="px-2.5 py-2 text-right font-mono">
                                {log.recordsProcessed} / {log.duplicatesSkipped}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: TRAINING LOAD INTELLIGENCE */}
          {activeSection === 'load' && loadIntel && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-display text-base font-bold text-navy-900">
                  Training Load Intelligence Summary
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-700">
                  {loadIntel.coachingSummary}
                </p>
                {loadIntel.trendInsights.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
                    {loadIntel.trendInsights.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {loadIntel.missingDataFlags.length > 0 && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    <p className="font-semibold">Data Sufficiency & Missing Telemetry Notes</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
                      {loadIntel.missingDataFlags.map((flag, i) => (
                        <li key={i}>{flag}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* System C vs Provider Native Separation */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        System C · Independent EWMA Model
                      </p>
                      <h4 className="font-display text-sm font-bold text-navy-900">
                        {loadIntel.systemC.primaryMethodologyLabel ?? 'No System C Series'}
                      </h4>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      {loadIntel.systemC.historyDays}d history
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs tabular-nums">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">CTL (42d)</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {formatNumberOrDash(loadIntel.systemC.ctl, 1)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        14d Δ:{' '}
                        {loadIntel.systemC.ctlDelta14d !== null
                          ? `${loadIntel.systemC.ctlDelta14d >= 0 ? '+' : ''}${loadIntel.systemC.ctlDelta14d.toFixed(1)}`
                          : '--'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">ATL (7d)</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {formatNumberOrDash(loadIntel.systemC.atl, 1)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        ATL/CTL: {formatNumberOrDash(loadIntel.systemC.atlCtlRatio, 2)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">TSB (Form)</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {loadIntel.systemC.tsb !== null
                          ? `${loadIntel.systemC.tsb >= 0 ? '+' : ''}${loadIntel.systemC.tsb.toFixed(1)}`
                          : '--'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {loadIntel.systemC.formLabel ?? '--'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        System A · Provider Native (Non-TSS)
                      </p>
                      <h4 className="font-display text-sm font-bold text-navy-900">
                        Intervals.icu Native Load & Wellness
                      </h4>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500">
                      {loadIntel.providerNative.latestDate ?? '--'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-xs tabular-nums">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">ICU Fitness</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {formatNumberOrDash(loadIntel.providerNative.icuCtl, 1)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">ICU Fatigue</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {formatNumberOrDash(loadIntel.providerNative.icuAtl, 1)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-500">7d Native Load</p>
                      <p className="mt-0.5 font-mono text-lg font-bold text-navy-900">
                        {formatNumberOrDash(loadIntel.providerNative.recent7dNativeLoad, 0)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-500">
                    {loadIntel.providerNative.separationNotice}
                  </p>
                </div>
              </div>

              {/* 12-Week Mileage, Duration & Load Progression Table */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h4 className="font-display text-base font-bold text-navy-900">
                  12-Week Mileage, Duration & Load Progression
                </h4>
                <p className="mt-0.5 text-xs text-slate-500">
                  Monday–Sunday training weeks with System C stress isolated from Intervals.icu native
                  load. Missing values are rendered as --.
                </p>
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Week</th>
                        <th className="px-3 py-2 text-right font-semibold">Runs</th>
                        <th className="px-3 py-2 text-right font-semibold">Miles</th>
                        <th className="px-3 py-2 text-right font-semibold">WoW Δ</th>
                        <th className="px-3 py-2 text-right font-semibold">Duration</th>
                        <th className="px-3 py-2 text-right font-semibold">Long Run</th>
                        <th className="px-3 py-2 text-right font-semibold">System C Stress</th>
                        <th className="px-3 py-2 text-right font-semibold">End CTL / TSB</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          ICU Native Load
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loadIntel.weeklySeries.map((wk) => (
                        <tr key={wk.weekStartDate} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-[11px] text-navy-900 whitespace-nowrap">
                            {wk.weekLabel}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{wk.completedRunCount}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-navy-900">
                            {wk.actualMiles.toFixed(1)} mi
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {wk.weekOverWeekMileagePct !== null
                              ? `${wk.weekOverWeekMileagePct >= 0 ? '+' : ''}${wk.weekOverWeekMileagePct.toFixed(
                                  1
                                )}%`
                              : '--'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {Math.round(wk.actualDurationMinutes)} min
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {wk.longRunMiles > 0 ? `${wk.longRunMiles.toFixed(1)} mi` : '--'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatNumberOrDash(wk.systemCWeeklyStress, 0)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {wk.ctlEnd !== null
                              ? `${wk.ctlEnd.toFixed(1)} / ${
                                  (wk.tsbEnd ?? 0) >= 0 ? '+' : ''
                                }${wk.tsbEnd?.toFixed(1)}`
                              : '--'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">
                            {formatNumberOrDash(wk.providerNativeWeeklyLoad, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PLANNED WORKOUTS SCHEDULE (INDEPENDENT OF COMPLIANCE) */}
          {activeSection === 'overview' && intelligence && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Planned Workouts ({intelligence.plannedWorkouts.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Stored training schedule entries from manual coach input and synced feeds.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddPlanForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{showAddPlanForm ? 'Cancel' : 'Add Planned Workout'}</span>
                </button>
              </div>

              {showAddPlanForm && (
                <form
                  onSubmit={(e) => void handleSavePlannedWorkout(e)}
                  className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-6"
                >
                  <div>
                    <label className="block font-semibold text-slate-700">Date</label>
                    <input
                      type="date"
                      value={planDate}
                      onChange={(e) => setPlanDate(e.target.value)}
                      required
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-slate-700">Title</label>
                    <input
                      type="text"
                      value={planTitle}
                      onChange={(e) => setPlanTitle(e.target.value)}
                      required
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">Type</label>
                    <select
                      value={planType}
                      onChange={(e) =>
                        setPlanType(
                          e.target.value as
                            | 'Easy'
                            | 'Long Run'
                            | 'Tempo'
                            | 'Intervals'
                            | 'Recovery'
                            | 'Race'
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      {['Easy', 'Long Run', 'Tempo', 'Intervals', 'Recovery', 'Race'].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700">Miles / Min</label>
                    <div className="mt-1 flex gap-1">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        value={planMiles}
                        onChange={(e) => setPlanMiles(e.target.value)}
                        className="w-1/2 rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={planDuration}
                        onChange={(e) => setPlanDuration(e.target.value)}
                        className="w-1/2 rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <select
                      value={planZone}
                      onChange={(e) =>
                        setPlanZone(e.target.value as 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5')
                      }
                      aria-label="Target zone"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                    >
                      {['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={savingPlan}
                      className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {savingPlan ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  {planError && (
                    <p className="sm:col-span-6 text-rose-700 font-semibold">{planError}</p>
                  )}
                </form>
              )}

              {intelligence.plannedWorkouts.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Workout</th>
                        <th className="px-3 py-2 font-semibold">Type / Zone</th>
                        <th className="px-3 py-2 text-right font-semibold">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {intelligence.plannedWorkouts.slice(0, 15).map((pw) => (
                        <tr key={pw.id}>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {pw.workoutDate}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold text-navy-900">{pw.title}</span>
                            {plannedSourceLabel(pw.sourceProvider) && (
                              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                {plannedSourceLabel(pw.sourceProvider)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {pw.workoutType} · {pw.targetZone}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-navy-900">
                            {pw.plannedMiles.toFixed(1)} mi · {Math.round(pw.plannedDurationMin)}m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 4: AI COACHING FINDINGS & ALERTS */}
          {activeSection === 'intelligence' && intelligence && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-700">
                <p className="font-semibold text-navy-900">Coaching Intelligence Guardrails</p>
                <p className="mt-1 text-slate-600">{intelligence.guardrails.notice}</p>
              </div>

              {intelligence.alerts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                  No coaching alerts or findings generated yet.
                </div>
              ) : (
                intelligence.alerts.map((alert, idx) => (
                  <div
                    key={alert.id ?? `${alert.category}-${idx}`}
                    className={`rounded-xl border p-5 ${classificationClasses(alert.classification)}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide">
                          {alert.classification} · {alert.category} · Status: {alert.status}
                        </p>
                        <h4 className="mt-1 font-display text-sm font-bold">{alert.title}</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        {alert.status !== 'acknowledged' && (
                          <button
                            type="button"
                            onClick={() => void handleUpdateAlertStatus(alert.id, 'acknowledged')}
                            className="rounded border border-current/25 bg-white/80 px-2.5 py-1 text-[11px] font-semibold hover:bg-white"
                          >
                            Acknowledge
                          </button>
                        )}
                        {alert.status !== 'resolved' && (
                          <button
                            type="button"
                            onClick={() => void handleUpdateAlertStatus(alert.id, 'resolved')}
                            className="rounded border border-current/25 bg-white/80 px-2.5 py-1 text-[11px] font-semibold hover:bg-white"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed">{alert.explanation}</p>
                    {alert.supportingData.length > 0 && (
                      <ul className="mt-2 list-disc space-y-0.5 pl-4 font-mono text-[11px]">
                        {alert.supportingData.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* SECTION 5: WEEKLY REPORTS */}
          {activeSection === 'reports' && intelligence && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                <p className="font-semibold">Pre-Email Approval Gate Enforced</p>
                <p className="mt-0.5">
                  Automated athlete email dispatch is strictly disabled in Supabase (
                  <code className="font-mono">email_dispatch_blocked = true</code>). Coach review
                  and approval are required for every weekly report.
                </p>
              </div>

              {intelligence.weeklyReports.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
                  No weekly report drafts available yet. Run Persist Intelligence above.
                </div>
              ) : (
                intelligence.weeklyReports.map((rep) => (
                  <div
                    key={rep.weekStartDate}
                    className="rounded-xl border border-slate-200 bg-white p-5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <h4 className="font-display text-sm font-bold text-navy-900">
                          Week of {rep.weekLabel} ({rep.weekStartDate})
                        </h4>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          Actual: {rep.actualMiles.toFixed(1)} mi · Planned:{' '}
                          {rep.plannedMiles > 0 ? `${rep.plannedMiles.toFixed(1)} mi` : '--'} ·
                          Weekly hrRSS: {(rep.weeklyHrStress ?? 0).toFixed(0)} · System C CTL/TSB:{' '}
                          {rep.ctl !== null ? `${rep.ctl.toFixed(1)} / ${rep.tsb?.toFixed(1)}` : '--'}
                        </p>
                      </div>
                      <span
                        className={`rounded px-2.5 py-1 font-mono text-[11px] font-semibold ${
                          rep.status === 'Approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {rep.status}
                      </span>
                    </div>

                    <p className="mt-3 leading-relaxed text-slate-700">{rep.aiSummary}</p>

                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-600">
                        Coach Note (persisted in Supabase)
                      </label>
                      <textarea
                        rows={2}
                        value={noteDrafts[rep.weekStartDate] ?? rep.coachNote}
                        onChange={(e) =>
                          setNoteDrafts((prev) => ({
                            ...prev,
                            [rep.weekStartDate]: e.target.value,
                          }))
                        }
                        placeholder="Add coaching context before approving..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-navy-900"
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-slate-500">
                        {rep.emailDeliveryNote}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={savingReportWeek === rep.weekStartDate}
                          onClick={() => void handleSaveReport(rep)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Save Note
                        </button>
                        <button
                          type="button"
                          disabled={savingReportWeek === rep.weekStartDate}
                          onClick={() =>
                            void handleSaveReport(
                              rep,
                              rep.status === 'Approved' ? 'Draft' : 'Approved'
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50 ${
                            rep.status === 'Approved'
                              ? 'bg-slate-600 hover:bg-slate-700'
                              : 'bg-emerald-700 hover:bg-emerald-800'
                          }`}
                        >
                          {rep.status === 'Approved' ? 'Revert to Draft' : 'Approve Report'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
