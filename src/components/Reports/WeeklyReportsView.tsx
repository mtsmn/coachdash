import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  Lock,
  MailWarning,
  ShieldCheck,
} from 'lucide-react';
import { Athlete, WeeklyAthleteReport } from '../../types/coaching';
import { formatDuration } from '../../utils/analytics';
import { buildRosterCommandCenterSnapshot } from '../../utils/commandCenterAnalytics';
import {
  downloadAthleteReportHtml,
  downloadAthleteReportMarkdown,
  downloadAttentionReportMarkdown,
  downloadRacePrepSummaryMarkdown,
  downloadRosterBriefingMarkdown,
  downloadRosterCsv,
  downloadTrainingLoadSummaryMarkdown,
} from '../../utils/exportReports';

interface WeeklyReportsViewProps {
  athletes: Athlete[];
  reports: WeeklyAthleteReport[];
  onToggleApprove: (athleteId: string) => void;
  onApproveAllOnTrack: () => void;
  onUpdateCoachNote: (athleteId: string, note: string) => void;
}

type ReportSubTab = 'briefing' | 'individual' | 'load' | 'race_prep' | 'attention';

export const WeeklyReportsView: React.FC<WeeklyReportsViewProps> = ({
  athletes,
  reports,
  onToggleApprove,
  onApproveAllOnTrack,
  onUpdateCoachNote,
}) => {
  const [subTab, setSubTab] = useState<ReportSubTab>('briefing');
  const [selectedReportId, setSelectedReportId] = useState<string>(reports[0]?.athleteId ?? '');
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  const athleteMap = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const snapshot = useMemo(() => buildRosterCommandCenterSnapshot(athletes), [athletes]);

  const approvedCount = reports.filter((r) => r.status === 'Approved').length;
  const totalActual = reports.reduce((s, r) => s + r.actualMiles, 0);
  const totalPlanned = reports.reduce((s, r) => s + r.plannedMiles, 0);
  const avgCompliance = Math.round(
    reports.reduce((s, r) => s + r.compliancePct, 0) / Math.max(1, reports.length)
  );

  const activeReport = reports.find((r) => r.athleteId === selectedReportId) ?? reports[0];
  const activeAthlete = activeReport ? athleteMap.get(activeReport.athleteId) : undefined;

  const flaggedAthletes = useMemo(
    () =>
      snapshot.rankedAthletes
        .filter((r) => r.alerts.length > 0)
        .map((r) => ({
          athleteName: r.athlete.name,
          tier: r.priorityTier,
          score: r.attentionScore,
          alerts: r.alerts.map((a) => ({
            title: a.title,
            explanation: a.explanation,
            supportingData: a.supportingData,
          })),
        })),
    [snapshot.rankedAthletes]
  );

  const handleAttemptEmailDispatch = () => {
    if (approvedCount === 0) {
      setDispatchNotice(
        'Blocked: At least one athlete report requires explicit coach approval before athlete email dispatch.'
      );
      return;
    }
    setDispatchNotice(
      `${approvedCount} coach-approved report(s) staged. Outbound email delivery is disabled in local sample mode—use the download buttons to export reports.`
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-navy-900 p-5 text-white">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
              <ShieldCheck className="h-4 w-4" />
              <span>Coach Approval Required Before Athlete Emails</span>
            </div>
            <h2 className="mt-1 font-display text-lg font-bold">
              Weekly Coaching Reports · Nov 9–15, 2026
            </h2>
            <p className="mt-1 text-xs text-slate-300 tabular-nums">
              {approvedCount} of {reports.length} individual athlete reports approved
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadRosterBriefingMarkdown(reports, athletes, 'Nov 9-15 2026')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-100"
            >
              <Download className="h-3.5 w-3.5" />
              Briefing (.md)
            </button>
            <button
              type="button"
              onClick={() => downloadRosterCsv(reports, athletes)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-navy-800 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-700"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Roster CSV
            </button>
            <button
              type="button"
              onClick={onApproveAllOnTrack}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-navy-950 whitespace-nowrap hover:bg-sky-400"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve ≥85% Compliance
            </button>
            <button
              type="button"
              onClick={handleAttemptEmailDispatch}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/20 px-3.5 py-2 text-xs font-semibold text-amber-200 whitespace-nowrap hover:bg-amber-500/30"
            >
              <Lock className="h-3.5 w-3.5" />
              Stage Emails ({approvedCount})
            </button>
          </div>
        </div>

        {dispatchNotice && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-navy-800 px-3.5 py-2.5 text-xs text-amber-200">
            <MailWarning className="h-4 w-4 shrink-0 text-amber-400" />
            <span>{dispatchNotice}</span>
          </div>
        )}
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            { id: 'briefing', label: 'Roster Briefing' },
            { id: 'individual', label: 'Individual Summaries' },
            { id: 'load', label: 'Training Load Summary' },
            { id: 'race_prep', label: 'Race Prep Summary' },
            { id: 'attention', label: `Attention Report (${flaggedAthletes.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subTab === tab.id
                ? 'bg-navy-900 text-white'
                : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'briefing' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Roster Weekly Miles</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
                {totalActual.toFixed(1)}{' '}
                <span className="text-xs font-normal text-slate-400">
                  / {totalPlanned.toFixed(1)} mi
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Average Compliance</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
                {avgCompliance}%
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Approved for Email</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-emerald-700 tabular-nums">
                {approvedCount} / {reports.length}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-navy-900 text-slate-200">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Athlete</th>
                    <th className="px-4 py-3 text-right font-semibold">Miles</th>
                    <th className="px-4 py-3 text-right font-semibold">HR-Stress</th>
                    <th className="px-4 py-3 text-right font-semibold">CTL / TSB</th>
                    <th className="px-4 py-3 text-right font-semibold">Compliance</th>
                    <th className="px-4 py-3 font-semibold">Coaching Summary</th>
                    <th className="px-4 py-3 font-semibold">Coach Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {reports.map((rep) => {
                    const ath = athleteMap.get(rep.athleteId);
                    if (!ath) return null;
                    return (
                      <tr key={rep.athleteId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-semibold text-navy-900">{ath.name}</p>
                          <p className="text-[11px] text-slate-500">
                            LTHR {ath.lthrBpm} bpm (v{ath.activeThresholdVersion})
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">
                          {rep.actualMiles.toFixed(1)} / {rep.plannedMiles.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-navy-900">
                          {rep.weeklyHrStress.toFixed(0)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700 whitespace-nowrap">
                          {rep.ctl.toFixed(0)} / {rep.tsb >= 0 ? '+' : ''}
                          {rep.tsb.toFixed(0)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-navy-900">
                          {rep.compliancePct}%
                        </td>
                        <td className="max-w-md px-4 py-3 text-slate-600">{rep.aiSummary}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onToggleApprove(rep.athleteId)}
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

      {subTab === 'individual' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="max-h-[540px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {reports.map((rep) => {
              const ath = athleteMap.get(rep.athleteId);
              if (!ath) return null;
              const selected = activeReport?.athleteId === rep.athleteId;
              return (
                <button
                  key={rep.athleteId}
                  type="button"
                  onClick={() => setSelectedReportId(rep.athleteId)}
                  className={`flex w-full items-center justify-between px-4 py-3 text-left text-xs transition-colors ${
                    selected ? 'bg-navy-900 text-white' : 'text-navy-900 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <p className="font-semibold">{ath.name}</p>
                    <p className={`tabular-nums ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {rep.actualMiles.toFixed(1)} mi · {rep.weeklyHrStress.toFixed(0)} hrRSS ·{' '}
                      {rep.compliancePct}%
                    </p>
                  </div>
                  <span
                    className={`font-semibold ${
                      rep.status === 'Approved'
                        ? selected
                          ? 'text-emerald-300'
                          : 'text-emerald-700'
                        : selected
                        ? 'text-slate-300'
                        : 'text-slate-500'
                    }`}
                  >
                    {rep.status}
                  </span>
                </button>
              );
            })}
          </div>

          {activeReport && activeAthlete && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-display text-lg font-bold text-navy-900">
                    {activeAthlete.name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {activeAthlete.email} · LTHR {activeAthlete.lthrBpm} bpm (v
                    {activeAthlete.activeThresholdVersion}) · {activeAthlete.goal.raceName}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => downloadAthleteReportMarkdown(activeAthlete, activeReport)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Markdown
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadAthleteReportHtml(activeAthlete, activeReport)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Printable HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleApprove(activeReport.athleteId)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                      activeReport.status === 'Approved'
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'bg-navy-900 text-white hover:bg-navy-800'
                    }`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {activeReport.status === 'Approved' ? 'Approved for Email' : 'Approve Report'}
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div className="border-b border-slate-100 pb-4">
                  <p className="text-xs font-bold text-slate-500">
                    LTHR-Centered Training Summary
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-800">
                    {activeReport.aiSummary}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500">
                    Coach Message to Athlete (Included in Email & Download)
                  </label>
                  <textarea
                    value={activeReport.coachNote}
                    onChange={(e) => onUpdateCoachNote(activeReport.athleteId, e.target.value)}
                    rows={4}
                    placeholder="Add personalized feedback before approving..."
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-navy-900 focus:border-navy-900 focus:outline-none"
                  />
                </div>

                <p className="text-xs text-slate-500">{activeReport.emailDeliveryNote}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === 'load' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-navy-900">
                <Gauge className="h-4 w-4 text-sky-600" />
                <span>Training Load Summary (CTL / ATL / TSB / hrRSS)</span>
              </h3>
              <p className="text-xs text-slate-500">
                42-day CTL, 7-day ATL, TSB = CTL - ATL vs. each runner&apos;s personal 8-week baseline
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadTrainingLoadSummaryMarkdown(reports, athletes)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download Load Summary (.md)
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Athlete</th>
                  <th className="px-4 py-3 text-right font-semibold">LTHR</th>
                  <th className="px-4 py-3 text-right font-semibold">Wk 11 hrRSS</th>
                  <th className="px-4 py-3 text-right font-semibold">CTL (42d)</th>
                  <th className="px-4 py-3 text-right font-semibold">ATL (7d)</th>
                  <th className="px-4 py-3 text-right font-semibold">TSB</th>
                  <th className="px-4 py-3 text-right font-semibold">8-Wk Base TSB</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {snapshot.rankedAthletes.map((row) => (
                  <tr key={row.athlete.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-navy-900">{row.athlete.name}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.lthrBpm} bpm</td>
                    <td className="px-4 py-3 text-right font-mono">{row.lastFullWeekHrStress.toFixed(0)}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.ctl.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.atl.toFixed(1)}</td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-bold ${
                        row.tsb < -15 ? 'text-rose-700' : row.tsb >= 2 ? 'text-emerald-700' : 'text-navy-900'
                      }`}
                    >
                      {row.tsb >= 0 ? '+' : ''}
                      {row.tsb.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">
                      {row.baselineMeanTsb.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'race_prep' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-navy-900">
                <Calendar className="h-4 w-4 text-sky-600" />
                <span>Race Preparation Summary</span>
              </h3>
              <p className="text-xs text-slate-500">
                Upcoming events sorted chronologically with CTL/TSB taper readiness and goal targets
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadRacePrepSummaryMarkdown(reports, athletes)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download Race Prep (.md)
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Days Out</th>
                  <th className="px-4 py-3 font-semibold">Athlete</th>
                  <th className="px-4 py-3 font-semibold">Goal Race</th>
                  <th className="px-4 py-3 text-right font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Phase</th>
                  <th className="px-4 py-3 text-right font-semibold">CTL / TSB</th>
                  <th className="px-4 py-3 font-semibold">Taper Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {snapshot.upcomingRaces.map(({ summary, daysLeft, taperStatus }) => (
                  <tr key={summary.athlete.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-navy-900">{daysLeft}d</td>
                    <td className="px-4 py-3 font-semibold text-navy-900">{summary.athlete.name}</td>
                    <td className="px-4 py-3">
                      {summary.athlete.goal.raceName} ({summary.athlete.goal.raceDate})
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatDuration(summary.athlete.goal.targetTimeSeconds)}
                    </td>
                    <td className="px-4 py-3">{summary.athlete.currentPhase}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {summary.ctl.toFixed(0)} / {summary.tsb >= 0 ? '+' : ''}
                      {summary.tsb.toFixed(1)}
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold ${
                        taperStatus === 'Fresh / Peaking'
                          ? 'text-emerald-700'
                          : taperStatus === 'Elevated Fatigue'
                          ? 'text-rose-700'
                          : 'text-sky-700'
                      }`}
                    >
                      {taperStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'attention' && (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-navy-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span>Coaching Attention Report ({flaggedAthletes.length} Athletes)</span>
              </h3>
              <p className="text-xs text-slate-500">
                Ranked findings with supporting baseline evidence. Non-diagnostic and non-prescriptive.
              </p>
            </div>
            <button
              type="button"
              onClick={() => downloadAttentionReportMarkdown(flaggedAthletes)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download Attention Report (.md)
            </button>
          </div>
          <div className="space-y-3">
            {flaggedAthletes.map((item) => (
              <div key={item.athleteName} className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-bold text-navy-900">
                  {item.athleteName}{' '}
                  <span className="font-mono text-xs font-medium text-slate-500">
                    ({item.tier} · Score {item.score})
                  </span>
                </p>
                <div className="mt-2 space-y-2">
                  {item.alerts.map((al, i) => (
                    <div key={i} className="border-t border-slate-100 pt-2 text-xs">
                      <p className="font-semibold text-navy-900">{al.title}</p>
                      <p className="mt-0.5 text-slate-600">{al.explanation}</p>
                      <p className="mt-1 font-mono text-[11px] text-slate-500">
                        {al.supportingData.join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
