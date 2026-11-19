import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  HeartPulse,
  Lock,
  MailWarning,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Athlete, TrainingGroup, WeeklyAthleteReport } from '../../types/coaching';
import { estimateRacePerformances, formatDuration } from '../../utils/analytics';
import {
  AthleteCommandSummary,
  buildRosterCommandCenterSnapshot,
  buildWeeklyCommandBriefingText,
} from '../../utils/commandCenterAnalytics';
import { downloadRosterBriefingMarkdown, downloadRosterCsv } from '../../utils/exportReports';
import { AthleteDrillDownDrawer } from './AthleteDrillDownDrawer';

type CommandSubView = 'rankings' | 'mileage_zones' | 'calendar_data' | 'briefing';

interface CoachCommandCenterProps {
  athletes: Athlete[];
  reports: WeeklyAthleteReport[];
  onSelectAthlete: (athleteId: string, openAiTab?: boolean) => void;
  onToggleApproveReport: (athleteId: string) => void;
  onApproveAllOnTrack: () => void;
  onOpenReportsTab: () => void;
}

const GROUPS: Array<'All' | TrainingGroup> = [
  'All',
  'Marathon',
  'Half Marathon',
  '10K / 5K Track',
  'Ultra / Trail',
  'Base / Return',
];

export const CoachCommandCenter: React.FC<CoachCommandCenterProps> = ({
  athletes,
  reports,
  onSelectAthlete,
  onToggleApproveReport,
  onApproveAllOnTrack,
  onOpenReportsTab,
}) => {
  const [subView, setSubView] = useState<CommandSubView>('rankings');
  const [groupFilter, setGroupFilter] = useState<'All' | TrainingGroup>('All');
  const [tierFilter, setTierFilter] = useState<'All' | 'Immediate Review' | 'Watch List' | 'On Track'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedAthleteId, setExpandedAthleteId] = useState<string | null>(null);
  const [drillDownAthleteId, setDrillDownAthleteId] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [briefingCopied, setBriefingCopied] = useState(false);

  const filteredAthletes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return athletes.filter((a) => {
      const matchesGroup = groupFilter === 'All' || a.trainingGroup === groupFilter;
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.goal.raceName.toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q);
      return matchesGroup && matchesSearch;
    });
  }, [athletes, groupFilter, searchQuery]);

  const snapshot = useMemo(
    () => buildRosterCommandCenterSnapshot(filteredAthletes),
    [filteredAthletes]
  );

  const fullRosterSnapshot = useMemo(
    () => buildRosterCommandCenterSnapshot(athletes),
    [athletes]
  );

  const reportsByAthleteId = useMemo(
    () => new Map(reports.map((r) => [r.athleteId, r])),
    [reports]
  );

  const filteredReports = useMemo(() => {
    const ids = new Set(filteredAthletes.map((a) => a.id));
    return reports.filter((r) => ids.has(r.athleteId));
  }, [filteredAthletes, reports]);

  const displayedRankings = useMemo(() => {
    if (tierFilter === 'All') return snapshot.rankedAthletes;
    return snapshot.rankedAthletes.filter((r) => r.priorityTier === tierFilter);
  }, [snapshot.rankedAthletes, tierFilter]);

  const drillDownSummary: AthleteCommandSummary | null = useMemo(() => {
    if (!drillDownAthleteId) return null;
    return (
      fullRosterSnapshot.rankedAthletes.find((s) => s.athlete.id === drillDownAthleteId) ?? null
    );
  }, [fullRosterSnapshot.rankedAthletes, drillDownAthleteId]);

  const approvedCount = filteredReports.filter((r) => r.status === 'Approved').length;
  const briefingText = useMemo(
    () => buildWeeklyCommandBriefingText(snapshot, filteredReports),
    [snapshot, filteredReports]
  );

  const handleStageEmailGate = () => {
    if (approvedCount === 0) {
      setEmailNotice(
        'Email dispatch blocked: no athlete reports have coach approval yet. Review and approve individual reports before staging outbound emails.'
      );
      return;
    }
    setEmailNotice(
      `Approval verified for ${approvedCount} of ${filteredReports.length} athletes. Automated sending remains off in local sample mode—export reports or review in Weekly Reports.`
    );
  };

  const handleCopyBriefing = async () => {
    try {
      await navigator.clipboard.writeText(briefingText);
      setBriefingCopied(true);
      setTimeout(() => setBriefingCopied(false), 2000);
    } catch {
      // Clipboard may be restricted in some sandbox contexts
    }
  };

  return (
    <div className="space-y-6">
      {/* Command Header + Roster Filters */}
      <section className="rounded-xl bg-navy-900 p-5 text-white">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-medium text-sky-300">
              Roster Operations · {athletes.length} Active Athletes · Historical Baseline Engine
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-white">
              Coach Command Center
            </h2>
            <p className="mt-1 text-xs text-slate-300">
              Ranked athlete attention, CTL/ATL/TSB load monitoring, LTHR zones, compliance, race readiness, and coach-gated briefings.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter athlete, race, city..."
                aria-label="Filter athletes in Command Center"
                className="w-52 rounded-lg border border-white/15 bg-navy-800 py-2 pr-3 pl-8 text-xs text-white placeholder-slate-400 focus:border-sky-400 focus:outline-none"
              />
            </div>

            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as 'All' | TrainingGroup)}
              aria-label="Filter by training group"
              className="rounded-lg border border-white/15 bg-navy-800 px-3 py-2 text-xs font-medium text-white focus:border-sky-400 focus:outline-none"
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g === 'All' ? 'All Training Groups' : g}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSubView('briefing')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap transition-colors hover:bg-slate-100"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Weekly Briefing ({approvedCount}/{filteredReports.length})</span>
            </button>
          </div>
        </div>
      </section>

      {/* 4-Column Roster Telemetry Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Attention Rankings</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {snapshot.rosterMeans.immediateReviewCount}{' '}
            <span className="text-sm font-medium text-slate-400">
              immediate / {snapshot.rosterMeans.watchListCount} watch
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {snapshot.allAlerts.length} baseline-anchored alerts across {snapshot.rosterCount} runners
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Roster Load (CTL / ATL / TSB)</span>
            <Activity className="h-4 w-4 text-sky-600" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold text-navy-900 tabular-nums">
            {snapshot.rosterMeans.meanCtl} / {snapshot.rosterMeans.meanAtl} /{' '}
            <span
              className={
                snapshot.rosterMeans.meanTsb < -10
                  ? 'text-amber-700'
                  : snapshot.rosterMeans.meanTsb >= 0
                  ? 'text-emerald-700'
                  : 'text-navy-900'
              }
            >
              {snapshot.rosterMeans.meanTsb >= 0 ? '+' : ''}
              {snapshot.rosterMeans.meanTsb}
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {snapshot.rosterMeans.highFatigueCount} high acute fatigue · {snapshot.rosterMeans.freshCount} fresh
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Volume & 4-Wk Compliance</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {snapshot.rosterMeans.avgCompliancePct}%{' '}
            <span className="text-sm font-medium text-slate-400">
              ({snapshot.rosterMeans.lastFullWeekActualMiles}/{snapshot.rosterMeans.lastFullWeekPlannedMiles} mi)
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Nov 9–15 completed · {snapshot.rosterMeans.currentWeekActualMiles} mi logged Nov 16–18
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>LTHR, Positive Gains & Hygiene</span>
            <HeartPulse className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {snapshot.positiveDevelopments.length}{' '}
            <span className="text-sm font-medium text-slate-400">
              gains · {snapshot.dataHygieneIssues.length} data flags
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {snapshot.rosterMeans.garminAutoLthrCount} Garmin LTHR · {snapshot.rosterMeans.manualFallbackLthrCount} manual fallback
          </p>
        </div>
      </section>

      {/* Sub-view Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              { id: 'rankings', label: '01. Rankings & Load Alerts' },
              { id: 'mileage_zones', label: '02. Mileage, Zones & Compliance' },
              { id: 'calendar_data', label: '03. Race Calendar & Data Integrity' },
              { id: 'briefing', label: '04. Weekly Coach Briefing' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubView(tab.id)}
              className={`rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
                subView === tab.id
                  ? 'bg-navy-900 text-white'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 tabular-nums">
          Showing {snapshot.rosterCount} of {athletes.length} athletes · Click any athlete for inline drill-down
        </p>
      </div>

      {/* Empty Filter State */}
      {snapshot.rosterCount === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="font-display text-base font-bold text-navy-900">
            No athletes match current Command Center filters
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Adjust the training group selector or clear your search query to restore roster telemetry.
          </p>
          <button
            type="button"
            onClick={() => {
              setGroupFilter('All');
              setSearchQuery('');
            }}
            className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* SUB-VIEW 1: ATHLETE ATTENTION RANKINGS, CTL/ATL/TSB LOAD ALERTS & POSITIVE DEVELOPMENTS */}
          {subView === 'rankings' && (
            <div className="space-y-6">
              {/* Attention Rankings Table */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Athlete Attention Rankings
                    </h3>
                    <p className="text-xs text-slate-500">
                      Ranked by deviation from each athlete&apos;s own 8-week CTL/TSB, LTHR cardiac, compliance & sync baselines
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                    {(['All', 'Immediate Review', 'Watch List', 'On Track'] as const).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setTierFilter(tier)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                          tierFilter === tier
                            ? 'bg-navy-900 text-white'
                            : 'text-slate-600 hover:text-navy-900'
                        }`}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Rank</th>
                        <th className="px-4 py-3 font-semibold">Athlete</th>
                        <th className="px-4 py-3 font-semibold">Priority</th>
                        <th className="px-4 py-3 text-right font-semibold">CTL / ATL / TSB</th>
                        <th className="px-4 py-3 text-right font-semibold">Wk 11 hrRSS vs Base</th>
                        <th className="px-4 py-3 text-right font-semibold">4-Wk Compl.</th>
                        <th className="px-4 py-3 text-right font-semibold">Easy %LTHR</th>
                        <th className="px-4 py-3 font-semibold">Lead Alert & Supporting Evidence</th>
                        <th className="px-4 py-3 text-right font-semibold">Drill-Down</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {displayedRankings.map((row, idx) => {
                        const leadAlert = row.alerts[0];
                        const isExpanded = expandedAthleteId === row.athlete.id;
                        return (
                          <React.Fragment key={row.athlete.id}>
                            <tr className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-mono font-semibold text-slate-500">
                                #{idx + 1}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setDrillDownAthleteId(row.athlete.id)}
                                  className="font-semibold text-navy-900 hover:text-sky-700"
                                >
                                  {row.athlete.name}
                                </button>
                                <p className="text-[11px] text-slate-500">
                                  {row.athlete.trainingGroup} · {row.athlete.currentPhase}
                                </p>
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span
                                  className={`font-semibold ${
                                    row.priorityTier === 'Immediate Review'
                                      ? 'text-rose-700'
                                      : row.priorityTier === 'Watch List'
                                      ? 'text-amber-700'
                                      : 'text-emerald-700'
                                  }`}
                                >
                                  {row.priorityTier}
                                </span>
                                <p className="font-mono text-[11px] text-slate-500">
                                  Score {row.attentionScore} · {row.alerts.length} alert(s)
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-navy-900">
                                {row.ctl.toFixed(0)} / {row.atl.toFixed(0)} /{' '}
                                <span
                                  className={
                                    row.tsb < -15
                                      ? 'font-bold text-rose-700'
                                      : row.tsb >= 2
                                      ? 'font-bold text-emerald-700'
                                      : 'font-semibold text-navy-900'
                                  }
                                >
                                  {row.tsb >= 0 ? '+' : ''}
                                  {row.tsb.toFixed(1)}
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  Base TSB {row.baselineMeanTsb.toFixed(1)}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                                <span className="font-semibold text-navy-900">
                                  {row.lastFullWeekHrStress.toFixed(0)}
                                </span>
                                <span
                                  className={`ml-1 text-[11px] ${
                                    row.weeklyStressDeltaPct >= 22
                                      ? 'font-semibold text-rose-700'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  ({row.weeklyStressDeltaPct >= 0 ? '+' : ''}
                                  {row.weeklyStressDeltaPct.toFixed(0)}%)
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  Base {row.baselineWeeklyHrStress.toFixed(0)}
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                                <span
                                  className={`font-semibold ${
                                    row.fourWkCompliancePct < 78 ? 'text-rose-700' : 'text-navy-900'
                                  }`}
                                >
                                  {row.fourWkCompliancePct}%
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  Base {row.baselineCompliancePct}%
                                </p>
                              </td>
                              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                                <span className="font-semibold text-navy-900">
                                  {row.recentEasyPctLthr ?? '--'}%
                                </span>
                                <p
                                  className={`text-[11px] ${
                                    row.easyPctLthrShift >= 2.8
                                      ? 'font-semibold text-amber-700'
                                      : row.easyPctLthrShift <= -1.0
                                      ? 'text-emerald-700'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {row.easyPctLthrShift >= 0 ? '+' : ''}
                                  {row.easyPctLthrShift} pts
                                </p>
                              </td>
                              <td className="max-w-xs px-4 py-3">
                                {leadAlert ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedAthleteId(isExpanded ? null : row.athlete.id)
                                    }
                                    className="flex w-full items-start justify-between gap-2 text-left"
                                  >
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-navy-900">
                                        {leadAlert.title}
                                      </p>
                                      <p className="truncate text-[11px] text-slate-500">
                                        {leadAlert.supportingData[0]}
                                      </p>
                                    </div>
                                    {isExpanded ? (
                                      <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    ) : (
                                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-slate-500">
                                    Aligned with 8-week baseline · {row.positiveDevelopments[0]?.headline ?? 'Steady trajectory'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setDrillDownAthleteId(row.athlete.id)}
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-100"
                                >
                                  <span>Inspect</span>
                                  <ArrowUpRight className="h-3 w-3" />
                                </button>
                              </td>
                            </tr>
                            {isExpanded && row.alerts.length > 0 && (
                              <tr className="bg-slate-50">
                                <td colSpan={9} className="px-6 py-4">
                                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    {row.alerts.map((al) => (
                                      <div
                                        key={al.id}
                                        className="rounded-lg border border-slate-200 bg-white p-3.5"
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="text-xs font-bold text-navy-900">
                                            {al.title}
                                          </p>
                                          <span
                                            className={`text-[11px] font-semibold ${
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
                                        <p className="mt-1 text-xs text-slate-600">
                                          {al.explanation}
                                        </p>
                                        <ul className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                                          {al.supportingData.map((line, i) => (
                                            <li key={i}>• {line}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Split: CTL/ATL/TSB Training Load Alerts + Positive Performance Developments */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* Training Load Alerts (CTL, ATL, TSB) */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-base font-bold text-navy-900">
                        Training Load Alerts (CTL / ATL / TSB)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Triggered against each runner&apos;s 8-week personal CTL, TSB & hrRSS baseline
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold text-navy-900 tabular-nums">
                      {snapshot.loadAlerts.length} active
                    </span>
                  </div>

                  {snapshot.loadAlerts.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                      No CTL/ATL/TSB overload or chronic dip alerts within the filtered cohort.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {snapshot.loadAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="rounded-lg border border-slate-200 p-4 transition-colors hover:bg-slate-50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <button
                                type="button"
                                onClick={() => setDrillDownAthleteId(alert.athleteId)}
                                className="text-sm font-bold text-navy-900 hover:text-sky-700"
                              >
                                {alert.athleteName}
                              </button>
                              <p className="mt-0.5 text-xs font-semibold text-navy-800">
                                {alert.title}
                              </p>
                            </div>
                            <span
                              className={`text-xs font-semibold whitespace-nowrap ${
                                alert.severity === 'high' ? 'text-rose-700' : 'text-amber-700'
                              }`}
                            >
                              {alert.severity === 'high' ? 'High Load Alert' : 'Moderate Load Alert'}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                            {alert.explanation}
                          </p>
                          <ul className="mt-2.5 space-y-1 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-600 tabular-nums">
                            {alert.supportingData.map((d, i) => (
                              <li key={i}>• {d}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Positive Performance Developments */}
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-base font-bold text-navy-900">
                        Positive Performance Developments
                      </h3>
                      <p className="text-xs text-slate-500">
                        Verified efficiency, CTL progression, taper freshness & threshold breakthroughs
                      </p>
                    </div>
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                  </div>

                  {snapshot.positiveDevelopments.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                      No positive performance milestones triggered under current filters.
                    </p>
                  ) : (
                    <div className="max-h-[540px] space-y-3 overflow-y-auto pr-1">
                      {snapshot.positiveDevelopments.slice(0, 10).map((pos) => (
                        <div
                          key={pos.id}
                          className="rounded-lg border border-slate-200 p-4 transition-colors hover:bg-slate-50"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <button
                                type="button"
                                onClick={() => setDrillDownAthleteId(pos.athleteId)}
                                className="text-sm font-bold text-navy-900 hover:text-sky-700"
                              >
                                {pos.athleteName}
                              </button>
                              <span className="ml-2 text-xs text-slate-500">
                                {pos.trainingGroup}
                              </span>
                            </div>
                            <span className="text-xs font-semibold text-emerald-700 whitespace-nowrap">
                              {pos.category}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-navy-900">{pos.headline}</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            {pos.explanation}
                          </p>
                          <p className="mt-2 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-600 tabular-nums">
                            {pos.supportingData.join(' · ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SUB-VIEW 2: WEEKLY MILEAGE TRENDS, LTHR & HEART-RATE ZONE MONITORING, PLANNED VS COMPLETED COMPLIANCE */}
          {subView === 'mileage_zones' && (
            <div className="space-y-6">
              {/* Charts Row: Roster Mileage Trend + Mean CTL/TSB Curve */}
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold text-navy-900">
                        12-Week Mileage Trends & Workout Compliance
                      </h3>
                      <p className="text-xs text-slate-500">
                        Planned vs. completed weekly miles and compliance % ({snapshot.rosterCount} runners)
                      </p>
                    </div>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={snapshot.weeklyMileageTrend}
                        margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                        <YAxis yAxisId="miles" tick={{ fontSize: 11, fill: '#64748B' }} />
                        <YAxis
                          yAxisId="pct"
                          orientation="right"
                          domain={[50, 105]}
                          tickFormatter={(v) => `${v}%`}
                          tick={{ fontSize: 11, fill: '#0284C7' }}
                        />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '8px',
                            borderColor: '#CBD5E1',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          yAxisId="miles"
                          dataKey="plannedMiles"
                          name="Planned Miles"
                          fill="#CBD5E1"
                          radius={[3, 3, 0, 0]}
                        />
                        <Bar
                          yAxisId="miles"
                          dataKey="actualMiles"
                          name="Completed Miles"
                          fill="#0A1628"
                          radius={[3, 3, 0, 0]}
                        />
                        <Line
                          yAxisId="pct"
                          type="monotone"
                          dataKey="avgCompliancePct"
                          name="Compliance %"
                          stroke="#0284C7"
                          strokeWidth={2.5}
                          dot={{ r: 3 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="mb-4">
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Roster Mean CTL, TSB & Weekly HR-Stress Trajectory
                    </h3>
                    <p className="text-xs text-slate-500">
                      Aggregate 12-week chronic fitness vs. training stress balance (hrRSS)
                    </p>
                  </div>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={snapshot.weeklyMileageTrend}
                        margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                        <YAxis yAxisId="stress" tick={{ fontSize: 11, fill: '#64748B' }} />
                        <YAxis yAxisId="ewma" orientation="right" tick={{ fontSize: 11, fill: '#0A1628' }} />
                        <ReferenceLine yAxisId="ewma" y={0} stroke="#CBD5E1" strokeDasharray="3 3" />
                        <Tooltip
                          contentStyle={{
                            borderRadius: '8px',
                            borderColor: '#CBD5E1',
                            fontSize: '12px',
                          }}
                        />
                        <Bar
                          yAxisId="stress"
                          dataKey="totalHrStress"
                          name="Roster hrRSS"
                          fill="#E2E8F0"
                          radius={[3, 3, 0, 0]}
                        />
                        <Line
                          yAxisId="ewma"
                          type="monotone"
                          dataKey="meanCtl"
                          name="Mean CTL (42d)"
                          stroke="#0A1628"
                          strokeWidth={2.25}
                          dot={{ r: 2.5 }}
                        />
                        <Line
                          yAxisId="ewma"
                          type="monotone"
                          dataKey="meanTsb"
                          name="Mean TSB"
                          stroke="#0284C7"
                          strokeWidth={2.25}
                          dot={{ r: 2.5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Roster Zone Summary Strip */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Roster LTHR & 5-Zone Polarization Summary (Last 4 Weeks)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Individualized LTHR anchors ({snapshot.rosterMeans.garminAutoLthrCount} Garmin Auto-Detected ·{' '}
                      {snapshot.rosterMeans.manualFallbackLthrCount} Coach-Approved Manual Fallback ·{' '}
                      {snapshot.rosterMeans.unverifiedLthrCount} Pending Verification)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-6 font-mono text-xs tabular-nums">
                    <div>
                      <span className="text-slate-500">Low Aerobic Z1+Z2: </span>
                      <span className="font-bold text-sky-700">{snapshot.rosterMeans.z12MeanPct}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Tempo Z3: </span>
                      <span className="font-bold text-amber-700">{snapshot.rosterMeans.z3MeanPct}%</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Threshold+VO2 Z4+Z5: </span>
                      <span className="font-bold text-rose-700">{snapshot.rosterMeans.z45MeanPct}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* LTHR, Zone Monitoring & Planned-vs-Completed Compliance Matrix */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    LTHR, Heart-Rate Zone & Workout Compliance Matrix
                  </h3>
                  <p className="text-xs text-slate-500">
                    Planned vs. completed runs (14d), 4-week volume vs. baseline, and individualized LTHR zone distribution
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-navy-900 text-slate-200">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Athlete</th>
                        <th className="px-4 py-3 font-semibold">Active LTHR & Source</th>
                        <th className="px-4 py-3 text-right font-semibold">Easy %LTHR (vs Base)</th>
                        <th className="px-4 py-3 text-right font-semibold">Z1+Z2 / Z3 / Z4+Z5</th>
                        <th className="px-4 py-3 text-right font-semibold">Wk 11 Miles</th>
                        <th className="px-4 py-3 text-right font-semibold">14d Sessions</th>
                        <th className="px-4 py-3 text-right font-semibold">4-Wk Compl.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {snapshot.rankedAthletes.map((row) => (
                        <tr key={row.athlete.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDrillDownAthleteId(row.athlete.id)}
                              className="font-semibold text-navy-900 hover:text-sky-700"
                            >
                              {row.athlete.name}
                            </button>
                            <p className="text-[11px] text-slate-500">
                              {row.athlete.trainingGroup} · {row.athlete.currentPhase}
                            </p>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono font-semibold text-navy-900">
                              {row.lthrBpm} bpm
                            </span>{' '}
                            <span className="text-slate-500">
                              (v{row.lthrVersion} · {row.lthrSource === 'Garmin Auto-Detected' ? 'Garmin Auto' : 'Manual Fallback'})
                            </span>
                            <p
                              className={`text-[11px] ${
                                row.lthrVerified ? 'text-emerald-700' : 'font-semibold text-amber-700'
                              }`}
                            >
                              {row.lthrVerified ? 'Coach verified' : 'Pending coach review'}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                            <span className="font-semibold text-navy-900">
                              {row.recentEasyPctLthr ?? '--'}%
                            </span>{' '}
                            <span
                              className={`text-[11px] ${
                                row.easyPctLthrShift >= 2.8
                                  ? 'font-semibold text-amber-700'
                                  : row.easyPctLthrShift <= -1.0
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                              }`}
                            >
                              ({row.easyPctLthrShift >= 0 ? '+' : ''}
                              {row.easyPctLthrShift} pts)
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-slate-700">
                            {row.z12Pct4Wk}% / {row.z3Pct4Wk}% / {row.z45Pct4Wk}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-navy-900">
                            {row.lastFullWeekActualMiles.toFixed(1)} / {row.lastFullWeekPlannedMiles.toFixed(1)} mi
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                            <span className="text-navy-900">
                              {row.completedSessions14d}/{row.plannedSessions14d}
                            </span>
                            {row.missedSessions14d > 0 && (
                              <span className="ml-1.5 font-semibold text-rose-700">
                                ({row.missedSessions14d} missed)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                            <span
                              className={`font-bold ${
                                row.fourWkCompliancePct < 78
                                  ? 'text-rose-700'
                                  : row.fourWkCompliancePct >= 92
                                  ? 'text-emerald-700'
                                  : 'text-navy-900'
                              }`}
                            >
                              {row.fourWkCompliancePct}%
                            </span>
                            <span className="ml-1 text-[11px] text-slate-500">
                              (base {row.baselineCompliancePct}%)
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SUB-VIEW 3: UPCOMING RACE CALENDAR & MISSING/OUTDATED DATA */}
          {subView === 'calendar_data' && (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              {/* Upcoming Race Calendar */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Upcoming Race Calendar ({snapshot.upcomingRaces.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Chronological goal events paired with CTL/TSB taper status & Riegel projections
                    </p>
                  </div>
                  <Calendar className="h-4 w-4 text-slate-400" />
                </div>

                <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
                  {snapshot.upcomingRaces.map(({ summary, daysLeft, taperStatus }) => {
                    const est = estimateRacePerformances(summary.athlete).find(
                      (r) => r.distanceLabel === summary.athlete.goal.distanceLabel
                    );
                    return (
                      <div
                        key={summary.athlete.id}
                        className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <button
                              type="button"
                              onClick={() => setDrillDownAthleteId(summary.athlete.id)}
                              className="font-bold text-navy-900 hover:text-sky-700"
                            >
                              {summary.athlete.name}
                            </button>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-xs text-slate-600">
                              {summary.athlete.goal.raceName}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                            {summary.athlete.goal.distanceLabel} · Target{' '}
                            {formatDuration(summary.athlete.goal.targetTimeSeconds)}
                            {est ? ` · Model ${formatDuration(est.estimatedSeconds)}` : ''} ·{' '}
                            {summary.athlete.currentPhase} Phase
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-slate-600 tabular-nums">
                            CTL {summary.ctl.toFixed(1)} · ATL {summary.atl.toFixed(1)} · TSB{' '}
                            {summary.tsb >= 0 ? '+' : ''}
                            {summary.tsb.toFixed(1)}
                          </p>
                        </div>

                        <div className="shrink-0 text-right tabular-nums">
                          <p className="font-mono text-sm font-bold text-navy-900">{daysLeft}d out</p>
                          <p className="text-[11px] text-slate-500">{summary.athlete.goal.raceDate}</p>
                          <p
                            className={`mt-0.5 text-[11px] font-semibold ${
                              taperStatus === 'Fresh / Peaking'
                                ? 'text-emerald-700'
                                : taperStatus === 'Elevated Fatigue'
                                ? 'text-rose-700'
                                : 'text-sky-700'
                            }`}
                          >
                            {taperStatus}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Missing or Outdated Data Watchlist */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Athletes with Missing or Outdated Data ({snapshot.dataHygieneIssues.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Stale watch syncs, missing HR telemetry, invalid sensor readings & unverified LTHR records
                    </p>
                  </div>
                  <Database className="h-4 w-4 text-slate-400" />
                </div>

                {snapshot.dataHygieneIssues.length === 0 ? (
                  <p className="p-6 text-xs text-slate-600">
                    All athletes in this filter have current watch syncs, valid HR streams, and verified Garmin-detected LTHR.
                  </p>
                ) : (
                  <div className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
                    {snapshot.dataHygieneIssues.map((issue) => (
                      <div key={issue.id} className="px-5 py-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <button
                              type="button"
                              onClick={() => setDrillDownAthleteId(issue.athleteId)}
                              className="text-sm font-bold text-navy-900 hover:text-sky-700"
                            >
                              {issue.athleteName}
                            </button>
                            <span className="ml-2 text-xs text-slate-500">
                              {issue.trainingGroup}
                            </span>
                          </div>
                          <span
                            className={`text-xs font-semibold whitespace-nowrap ${
                              issue.severity === 'high'
                                ? 'text-rose-700'
                                : issue.severity === 'moderate'
                                ? 'text-amber-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {issue.issueType}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-medium text-slate-700">{issue.summary}</p>
                        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          {issue.supportingData.map((line, i) => (
                            <li key={i}>• {line}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUB-VIEW 4: WEEKLY COACH BRIEFING & COACH APPROVAL EMAIL GATE */}
          {subView === 'briefing' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-navy-800">
                      <ShieldCheck className="h-4 w-4 text-sky-600" />
                      <span>Manual Coach Approval Required · Zero Automated Athlete Emails</span>
                    </div>
                    <h3 className="mt-1 font-display text-lg font-bold text-navy-900">
                      Weekly Coach Briefing · Nov 9–15, 2026
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      {approvedCount} of {filteredReports.length} filtered reports approved · Generated locally from athlete baselines
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleCopyBriefing}
                      className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
                    >
                      {briefingCopied ? 'Copied Briefing' : 'Copy Summary Text'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadRosterBriefingMarkdown(
                          filteredReports,
                          filteredAthletes,
                          'Nov 9-15 2026'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download Briefing (.md)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadRosterCsv(filteredReports, filteredAthletes)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      <span>Roster CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={onApproveAllOnTrack}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-800"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Approve ≥85% Compliance</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStageEmailGate}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 whitespace-nowrap hover:bg-amber-100"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      <span>Email Gate ({approvedCount})</span>
                    </button>
                  </div>
                </div>

                {emailNotice && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                    <MailWarning className="h-4 w-4 shrink-0 text-amber-700" />
                    <span>{emailNotice}</span>
                  </div>
                )}

                <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-navy-900">
                  {briefingText}
                </pre>
              </div>

              {/* Per-Athlete Pre-Email Approval Checklist */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Individual Report Approval Queue
                    </h3>
                    <p className="text-xs text-slate-500">
                      Coach approval is required before any athlete summary is cleared for email export
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenReportsTab}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900"
                  >
                    <span>Open Full Weekly Reports Editor</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Athlete</th>
                        <th className="px-4 py-3 text-right font-semibold">Priority</th>
                        <th className="px-4 py-3 text-right font-semibold">CTL / TSB</th>
                        <th className="px-4 py-3 text-right font-semibold">Wk 11 Miles</th>
                        <th className="px-4 py-3 text-right font-semibold">Compliance</th>
                        <th className="px-4 py-3 font-semibold">Approval Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {snapshot.rankedAthletes.map((row) => {
                        const rep = reportsByAthleteId.get(row.athlete.id);
                        if (!rep) return null;
                        return (
                          <tr key={row.athlete.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setDrillDownAthleteId(row.athlete.id)}
                                className="font-semibold text-navy-900 hover:text-sky-700"
                              >
                                {row.athlete.name}
                              </button>
                              <span className="ml-2 text-[11px] text-slate-500">
                                {row.athlete.trainingGroup}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <span
                                className={`font-semibold ${
                                  row.priorityTier === 'Immediate Review'
                                    ? 'text-rose-700'
                                    : row.priorityTier === 'Watch List'
                                    ? 'text-amber-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {row.priorityTier}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-slate-700">
                              {row.ctl.toFixed(0)} / {row.tsb >= 0 ? '+' : ''}
                              {row.tsb.toFixed(1)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-slate-700">
                              {rep.actualMiles.toFixed(1)} / {rep.plannedMiles.toFixed(1)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-navy-900">
                              {rep.compliancePct}%
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onToggleApproveReport(row.athlete.id)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                  rep.status === 'Approved'
                                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                {rep.status === 'Approved' ? 'Approved (Revoke)' : 'Draft · Approve'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Individual Athlete Drill-Down Drawer */}
      <AthleteDrillDownDrawer
        summary={drillDownSummary}
        report={drillDownSummary ? reportsByAthleteId.get(drillDownSummary.athlete.id) : undefined}
        onClose={() => setDrillDownAthleteId(null)}
        onOpenFullAnalysis={(id) => {
          setDrillDownAthleteId(null);
          onSelectAthlete(id, false);
        }}
        onOpenAiCoaching={(id) => {
          setDrillDownAthleteId(null);
          onSelectAthlete(id, true);
        }}
        onToggleApproveReport={onToggleApproveReport}
      />
    </div>
  );
};
