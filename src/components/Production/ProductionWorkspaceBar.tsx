import React, { useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  Plug,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  FullRosterSyncResponse,
  PilotSyncResponse,
} from '../../integrations/intervalsIcuAdapter';
import { ProductionWorkspaceBundle } from '../../integrations/productionDashboardMapper';
import { Athlete } from '../../types/coaching';

interface ProductionWorkspaceBarProps {
  verifiedCoachEmail: string | null;
  bundle: ProductionWorkspaceBundle | null;
  selectedAthlete: Athlete | undefined;
  pilotTestSucceeded: boolean;
  loading: boolean;
  syncing: boolean;
  rosterSyncing: boolean;
  analyzing: boolean;
  syncFeedback: PilotSyncResponse | null;
  rosterSyncFeedback: FullRosterSyncResponse | null;
  onSyncPilot: () => void;
  onSyncFullRoster: () => void;
  onRefreshWorkspace: () => void;
  onRunIntelligence: () => void;
  onSelectAthlete: (athleteId: string) => void;
  onAddPlannedWorkout: (workout: {
    athleteId: string;
    workoutDate: string;
    title: string;
    workoutType: 'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race';
    plannedMiles: number;
    plannedDurationMin: number;
    targetZone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  }) => Promise<{ ok: boolean; error?: string }>;
  onOpenIntegrations: () => void;
  onSwitchToDemoMode: () => void;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '--';
  return iso.slice(0, 19).replace('T', ' ') + ' UTC';
}

export const ProductionWorkspaceBar: React.FC<ProductionWorkspaceBarProps> = ({
  verifiedCoachEmail,
  bundle,
  selectedAthlete,
  pilotTestSucceeded,
  loading,
  syncing,
  rosterSyncing,
  analyzing,
  syncFeedback,
  rosterSyncFeedback,
  onSyncPilot,
  onSyncFullRoster,
  onRefreshWorkspace,
  onRunIntelligence,
  onSelectAthlete,
  onAddPlannedWorkout,
  onOpenIntegrations,
  onSwitchToDemoMode,
}) => {
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planTitle, setPlanTitle] = useState('Aerobic Base Run');
  const [planType, setPlanType] = useState<
    'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race'
  >('Easy');
  const [planMiles, setPlanMiles] = useState('6');
  const [planDuration, setPlanDuration] = useState('52');
  const [planZone, setPlanZone] = useState<'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5'>('Z2');
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSavedMsg, setPlanSavedMsg] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  const effectivePilotGate = bundle?.connection
    ? bundle.connection.pilotTestSucceeded
    : pilotTestSucceeded;
  const syncedCount = bundle?.athletes.length ?? 0;
  const latestLog = bundle?.syncLogs?.[0] ?? null;

  const handleSavePlannedWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAthlete) return;
    setSavingPlan(true);
    setPlanError(null);
    setPlanSavedMsg(null);
    const res = await onAddPlannedWorkout({
      athleteId: selectedAthlete.id,
      workoutDate: planDate,
      title: planTitle,
      workoutType: planType,
      plannedMiles: Number(planMiles) || 0,
      plannedDurationMin: Number(planDuration) || 0,
      targetZone: planZone,
    });
    setSavingPlan(false);
    if (!res.ok) {
      setPlanError(res.error ?? 'Failed to add planned workout.');
      return;
    }
    setPlanSavedMsg(`Saved "${planTitle}" (${planDate}) for ${selectedAthlete.name}.`);
    setShowPlanForm(false);
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Compact Production Header & Sync Strip */}
      <div className="rounded-xl bg-navy-900 p-4 text-white">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Live Production · {verifiedCoachEmail ?? 'Verified Owner Coach'}
              </span>
              <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-200">
                {syncedCount > 0
                  ? `${syncedCount} Synced Athlete${syncedCount === 1 ? '' : 's'} (Supabase)`
                  : 'No Athletes Synced Yet'}
              </span>
              {selectedAthlete && (
                <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                  Selected: <strong className="text-white">{selectedAthlete.name}</strong>
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-300">
              Intervals.icu Coach: {bundle?.connection?.externalCoachName ?? bundle?.connection?.externalCoachId ?? '--'} · Pilot ID:{' '}
              <span className="font-mono text-white">
                {bundle?.connection?.verifiedPilotAthleteId ?? 'Unverified'}
              </span>{' '}
              · Last Sync:{' '}
              <span className="font-mono text-white tabular-nums">
                {formatTimestamp(bundle?.connection?.lastSynchronizedAt)}
              </span>
              {latestLog ? ` (${latestLog.status})` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bundle && bundle.athletes.length > 1 && (
              <select
                value={selectedAthlete?.id ?? ''}
                onChange={(e) => onSelectAthlete(e.target.value)}
                aria-label="Select production athlete"
                className="rounded-lg border border-white/25 bg-navy-800 px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                {bundle.athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.intervalsIcuAthleteId ?? a.id.slice(0, 8)})
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={onSyncPilot}
              disabled={syncing || rosterSyncing || !effectivePilotGate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing Pilot...' : 'Sync Pilot'}</span>
            </button>

            <button
              type="button"
              onClick={onSyncFullRoster}
              disabled={rosterSyncing || syncing || !effectivePilotGate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rosterSyncing ? 'animate-spin' : ''}`} />
              <span>{rosterSyncing ? 'Syncing Roster...' : 'Sync Full Roster'}</span>
            </button>

            {selectedAthlete && (
              <>
                <button
                  type="button"
                  onClick={onRunIntelligence}
                  disabled={analyzing || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-50"
                >
                  <BrainCircuit className={`h-3.5 w-3.5 ${analyzing ? 'animate-pulse' : ''}`} />
                  <span>{analyzing ? 'Analyzing...' : 'Persist Intelligence'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlanSavedMsg(null);
                    setShowPlanForm((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{showPlanForm ? 'Close Plan Form' : 'Add Planned Workout'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onRefreshWorkspace}
              disabled={loading || syncing || rosterSyncing}
              className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>

            <button
              type="button"
              onClick={onOpenIntegrations}
              className="inline-flex items-center gap-1 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
            >
              <Plug className="h-3.5 w-3.5" />
              <span>Integrations</span>
            </button>
          </div>
        </div>

        {/* Inline Manual Planned Workout Entry (preserved independently of compliance) */}
        {showPlanForm && selectedAthlete && (
          <form
            onSubmit={(e) => void handleSavePlannedWorkout(e)}
            className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-white/15 bg-white p-4 text-xs text-slate-900 sm:grid-cols-6"
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
              <label className="block font-semibold text-slate-700">
                Title (for {selectedAthlete.name})
              </label>
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
                  aria-label="Planned miles"
                  className="w-1/2 rounded border border-slate-300 bg-white px-2 py-1.5 font-mono"
                />
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={planDuration}
                  onChange={(e) => setPlanDuration(e.target.value)}
                  aria-label="Planned duration minutes"
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
              <p className="sm:col-span-6 font-semibold text-rose-700">{planError}</p>
            )}
          </form>
        )}
      </div>

      {planSavedMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          <span>{planSavedMsg}</span>
        </div>
      )}

      {syncFeedback && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs ${
            syncFeedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-rose-200 bg-rose-50 text-rose-950'
          }`}
        >
          {syncFeedback.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
          )}
          <div>
            <p className="font-semibold">
              {syncFeedback.ok
                ? `Pilot sync ${syncFeedback.status}: ${syncFeedback.athleteName ?? syncFeedback.pilotAthleteId}`
                : `Pilot sync ${syncFeedback.status ?? 'Failed'}`}
            </p>
            <p className="mt-0.5 text-[11px]">
              {syncFeedback.ok
                ? `${syncFeedback.activitiesProcessed ?? 0} activities processed (${syncFeedback.duplicatesSkipped ?? 0} duplicates skipped).`
                : syncFeedback.errorMessage ?? 'Unknown error.'}
            </p>
          </div>
        </div>
      )}

      {rosterSyncFeedback && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs ${
            rosterSyncFeedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
              : 'border-rose-200 bg-rose-50 text-rose-950'
          }`}
        >
          {rosterSyncFeedback.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              Full Roster Sync ({rosterSyncFeedback.status}): {rosterSyncFeedback.athletesSucceededCount}/
              {rosterSyncFeedback.totalAthletesInRoster} athletes succeeded
            </p>
            {rosterSyncFeedback.errorMessage && (
              <p className="mt-0.5 text-[11px]">{rosterSyncFeedback.errorMessage}</p>
            )}
            {rosterSyncFeedback.athleteResults && rosterSyncFeedback.athleteResults.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {rosterSyncFeedback.athleteResults.slice(0, 12).map((item) => (
                  <button
                    key={item.externalAthleteId}
                    type="button"
                    disabled={!item.internalAthleteId}
                    onClick={() => item.internalAthleteId && onSelectAthlete(item.internalAthleteId)}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                      item.status === 'Succeeded'
                        ? 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100'
                        : 'border-rose-300 bg-white text-rose-800'
                    }`}
                  >
                    {item.athleteName ?? item.externalAthleteId} ({item.activitiesProcessed} act)
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Onboarding / Empty States — Demo athletes are NEVER shown in Production Mode */}
      {loading && syncedCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          Loading persisted Supabase roster, metrics, and coaching intelligence...
        </div>
      ) : !bundle?.configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-2 text-xs">
              <h3 className="font-display text-sm font-bold">
                Supabase Production Persistence Not Configured on Server
              </h3>
              <p>
                Configure <code className="font-mono">SUPABASE_URL</code>,{' '}
                <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>, and{' '}
                <code className="font-mono">OWNER_COACH_EMAIL</code> in server environment
                variables to activate production storage. Demo athletes are never substituted in
                Production Mode.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
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
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-950 hover:bg-amber-100"
                >
                  Switch to Demo Mode
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : syncedCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 font-display text-base font-bold text-navy-900">
            {effectivePilotGate
              ? 'Pilot Verified — Run Sync to Populate Production Dashboard'
              : 'No Production Athletes Synced Yet'}
          </h3>
          <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
            {effectivePilotGate
              ? `Your verified Intervals.icu connection (pilot ID ${bundle.connection?.verifiedPilotAthleteId ?? '--'}) is ready. Sync your pilot athlete or full roster to populate every dashboard view with live Supabase data.`
              : 'Verify your Intervals.icu Personal API Key and complete the 6-step Pilot Connection Test in Integrations first. Demo athletes are never displayed in Production Mode.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {effectivePilotGate ? (
              <>
                <button
                  type="button"
                  onClick={onSyncPilot}
                  disabled={syncing || rosterSyncing}
                  className="rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                >
                  {syncing ? 'Synchronizing Pilot...' : 'Run Pilot Ingestion'}
                </button>
                <button
                  type="button"
                  onClick={onSyncFullRoster}
                  disabled={rosterSyncing || syncing}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {rosterSyncing ? 'Syncing Full Roster...' : 'Sync Full Roster'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onOpenIntegrations}
                className="rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
              >
                Open Integrations &amp; Verify Pilot
              </button>
            )}
            <button
              type="button"
              onClick={onSwitchToDemoMode}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Switch to Demo Mode
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
