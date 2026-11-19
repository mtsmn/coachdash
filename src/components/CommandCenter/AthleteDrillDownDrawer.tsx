import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Database,
  Lock,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { WeeklyAthleteReport } from '../../types/coaching';
import { formatDuration, formatPace } from '../../utils/analytics';
import { AthleteCommandSummary } from '../../utils/commandCenterAnalytics';

interface AthleteDrillDownDrawerProps {
  summary: AthleteCommandSummary | null;
  report?: WeeklyAthleteReport;
  onClose: () => void;
  onOpenFullAnalysis: (athleteId: string) => void;
  onOpenAiCoaching: (athleteId: string) => void;
  onToggleApproveReport: (athleteId: string) => void;
}

export const AthleteDrillDownDrawer: React.FC<AthleteDrillDownDrawerProps> = ({
  summary,
  report,
  onClose,
  onOpenFullAnalysis,
  onOpenAiCoaching,
  onToggleApproveReport,
}) => {
  if (!summary) return null;

  const { athlete } = summary;
  const recentWorkouts = athlete.workouts
    .filter((w) => w.date <= '2026-11-18' && w.type !== 'Rest')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  const loadChartData = summary.dailyLoad.slice(-42);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-navy-950/60 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Command drill-down for ${athlete.name}`}
    >
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <aside className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-navy-900 px-6 py-5 text-white">
          <div className="min-w-0">
            <p className="text-xs font-medium text-sky-300">
              Individual Command Drill-Down · {athlete.trainingGroup} · {athlete.currentPhase} Phase
            </p>
            <h2 className="mt-1 truncate font-display text-xl font-bold text-white">
              {athlete.name}
            </h2>
            <p className="mt-1 text-xs text-slate-300 tabular-nums">
              LTHR {summary.lthrBpm} bpm (v{summary.lthrVersion} · {summary.lthrSource}) ·{' '}
              {athlete.goal.raceName} ({summary.daysToRace}d out)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 p-2 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close drill-down"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {/* Action Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenFullAnalysis(athlete.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-navy-800"
              >
                <span>Open Full Athlete Analysis</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenAiCoaching(athlete.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap transition-colors hover:bg-slate-50"
              >
                <span>AI Coaching Review</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {report && (
              <button
                type="button"
                onClick={() => onToggleApproveReport(athlete.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                  report.status === 'Approved'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                }`}
              >
                {report.status === 'Approved' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Report Approved</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    <span>Approve Weekly Report</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Personal Baseline vs Current Grid */}
          <div>
            <h3 className="text-xs font-semibold text-slate-500">
              Current Status vs. Athlete Historical Baseline
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">CTL / ATL / TSB</p>
                <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                  {summary.ctl.toFixed(0)} / {summary.atl.toFixed(0)} /{' '}
                  <span
                    className={
                      summary.tsb < -15
                        ? 'text-rose-700'
                        : summary.tsb >= 2
                        ? 'text-emerald-700'
                        : 'text-navy-900'
                    }
                  >
                    {summary.tsb >= 0 ? '+' : ''}
                    {summary.tsb.toFixed(1)}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  8-wk mean TSB {summary.baselineMeanTsb.toFixed(1)}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Weekly Volume</p>
                <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                  {summary.lastFullWeekActualMiles.toFixed(1)} /{' '}
                  {summary.lastFullWeekPlannedMiles.toFixed(1)} mi
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  Prior 4-wk avg {summary.baseline4WkAvgMiles.toFixed(1)} mi
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">4-Wk Compliance</p>
                <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                  {summary.fourWkCompliancePct}%
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  Baseline {summary.baselineCompliancePct}% · {summary.missedSessions14d} missed/14d
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Easy %LTHR & EF</p>
                <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                  {summary.recentEasyPctLthr ?? '--'}%{' '}
                  <span className="text-xs font-normal text-slate-500">
                    ({summary.easyPctLthrShift >= 0 ? '+' : ''}
                    {summary.easyPctLthrShift} pts)
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                  EF {summary.efChangePct >= 0 ? '+' : ''}
                  {summary.efChangePct}% vs Wks 1–4
                </p>
              </div>
            </div>
          </div>

          {/* 42-Day CTL / ATL / TSB Chart */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-bold text-navy-900">
                  42-Day Load Trajectory (CTL / ATL / TSB)
                </h3>
                <p className="text-xs text-slate-500">
                  {summary.tsbFormLabel} · Garmin Status: {athlete.garminBiometrics.garminTrainingStatus} · HRV:{' '}
                  {athlete.garminBiometrics.garminHrvStatus}
                </p>
              </div>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={loadChartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="dayLabel" tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={16} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748B' }} />
                  <ReferenceLine y={0} stroke="#CBD5E1" strokeDasharray="2 2" />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      borderColor: '#CBD5E1',
                      fontSize: '11px',
                    }}
                  />
                  <Line type="monotone" dataKey="ctl" name="CTL (42d)" stroke="#0A1628" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="atl" name="ATL (7d)" stroke="#D97706" strokeWidth={1.75} dot={false} />
                  <Line type="monotone" dataKey="tsb" name="TSB" stroke="#0284C7" strokeWidth={1.75} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Supporting-Data Alerts */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-display text-sm font-bold text-navy-900">
                Active Coaching Alerts & Supporting Data ({summary.alerts.length})
              </h3>
            </div>
            {summary.alerts.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                No load, compliance, HR drift, or data integrity deviations flagged against{' '}
                {athlete.name}&apos;s historical baseline.
              </div>
            ) : (
              <div className="space-y-3">
                {summary.alerts.map((al) => (
                  <div key={al.id} className="rounded-lg border border-slate-200 bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-navy-900">{al.title}</p>
                      <span
                        className={`text-[11px] font-semibold whitespace-nowrap ${
                          al.severity === 'high'
                            ? 'text-rose-700'
                            : al.severity === 'moderate'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {al.severity.toUpperCase()} · {al.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{al.explanation}</p>
                    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600 tabular-nums">
                      {al.supportingData.map((line, i) => (
                        <li key={i}>• {line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Positive Developments */}
          {summary.positiveDevelopments.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                <h3 className="font-display text-sm font-bold text-navy-900">
                  Positive Performance Developments
                </h3>
              </div>
              <div className="space-y-2.5">
                {summary.positiveDevelopments.map((pos) => (
                  <div key={pos.id} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5">
                    <p className="text-xs font-bold text-emerald-900">{pos.headline}</p>
                    <p className="mt-1 text-xs text-slate-700">{pos.explanation}</p>
                    <p className="mt-1.5 font-mono text-[11px] text-emerald-800 tabular-nums">
                      {pos.supportingData.join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Hygiene Issues */}
          {summary.dataHygieneIssues.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-600" />
                <h3 className="font-display text-sm font-bold text-navy-900">
                  Missing or Outdated Data Flags
                </h3>
              </div>
              <div className="space-y-2">
                {summary.dataHygieneIssues.map((hyg) => (
                  <div key={hyg.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-navy-900">
                      {hyg.issueType}: <span className="font-normal text-slate-700">{hyg.summary}</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                      {hyg.supportingData.join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Sessions */}
          <div>
            <h3 className="mb-2 font-display text-sm font-bold text-navy-900">
              Recent Sessions (Planned vs. Completed & HR-Stress)
            </h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Workout</th>
                    <th className="px-3 py-2 text-right font-semibold">Actual / Plan</th>
                    <th className="px-3 py-2 text-right font-semibold">Pace / HR</th>
                    <th className="px-3 py-2 text-right font-semibold">hrRSS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {recentWorkouts.map((w) => (
                    <tr key={w.id}>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{w.date}</td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-navy-900">{w.title}</span>
                        <span className="ml-1.5 text-[11px] text-slate-500">({w.status})</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-slate-700">
                        {w.actualMiles.toFixed(1)} / {w.plannedMiles.toFixed(1)} mi
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-slate-700">
                        {w.status === 'Missed'
                          ? '--'
                          : `${formatPace(w.avgPaceSecPerMile)}/mi · ${
                              w.hrDataState === 'invalid'
                                ? 'Invalid HR'
                                : w.hrDataState === 'missing'
                                ? 'Missing HR'
                                : `${w.avgHrBpm} bpm`
                            }`}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-navy-900">
                        {w.stress.hrStress !== null ? w.stress.hrStress.toFixed(0) : 'null'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Goal Event: {athlete.goal.raceName} on {athlete.goal.raceDate} (Target{' '}
            {formatDuration(athlete.goal.targetTimeSeconds)}). Analytical outputs are derived from
            individualized LTHR and historical baselines; coach approval is required before any athlete email dispatch.
          </p>
        </div>
      </aside>
    </div>
  );
};
