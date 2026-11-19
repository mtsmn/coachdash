import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Footprints,
  Users,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AICoachingInsight, Athlete, Workout } from '../../types/coaching';
import {
  computeWeeklyVolumeSeries,
  daysUntilDate,
  formatDuration,
  formatPace,
} from '../../utils/analytics';
import { computeDailyAndWeeklyLoadSeries } from '../../utils/lthrAnalytics';

interface CoachDashboardProps {
  athletes: Athlete[];
  insightsByAthlete: Record<string, AICoachingInsight>;
  onSelectAthlete: (athleteId: string, openAiTab?: boolean) => void;
}

export const CoachDashboard: React.FC<CoachDashboardProps> = ({
  athletes,
  insightsByAthlete,
  onSelectAthlete,
}) => {
  const summary = useMemo(() => {
    let week11Actual = 0;
    let week11Planned = 0;
    let week12Actual = 0;
    let complianceSum = 0;
    let ctlSum = 0;
    let tsbSum = 0;
    let integrityFlagCount = 0;

    const weekAgg = Array.from({ length: 12 }, (_, idx) => ({
      weekIndex: idx + 1,
      weekLabel: '',
      actualMiles: 0,
      plannedMiles: 0,
      complianceSum: 0,
    }));

    const attentionList: Array<{ athlete: Athlete; insight: AICoachingInsight }> = [];

    for (const athlete of athletes) {
      const series = computeWeeklyVolumeSeries(athlete.workouts);
      const lastFull = series[series.length - 2];
      const current = series[series.length - 1];

      week11Actual += lastFull.actualMiles;
      week11Planned += lastFull.plannedMiles;
      week12Actual += current.actualMiles;
      complianceSum += lastFull.compliancePct;

      const load = computeDailyAndWeeklyLoadSeries(athlete.workouts);
      const lastDay = load.daily[load.daily.length - 1];
      ctlSum += lastDay?.ctl ?? 0;
      tsbSum += lastDay?.tsb ?? 0;

      integrityFlagCount += athlete.workouts.filter(
        (w) => w.hrDataState === 'invalid' || w.hrDataState === 'missing'
      ).length;

      series.forEach((pt, idx) => {
        weekAgg[idx].weekLabel = pt.weekLabel;
        weekAgg[idx].actualMiles += pt.actualMiles;
        weekAgg[idx].plannedMiles += pt.plannedMiles;
        weekAgg[idx].complianceSum += pt.compliancePct;
      });

      const insight = insightsByAthlete[athlete.id];
      if (insight && insight.attentionAreas.length > 0) {
        attentionList.push({ athlete, insight });
      }
    }

    attentionList.sort((a, b) => {
      const rank = (ins: AICoachingInsight) =>
        ins.attentionAreas.some((f) => f.severity === 'high') ? 2 : 1;
      return rank(b.insight) - rank(a.insight) || b.insight.acwr - a.insight.acwr;
    });

    const chartData = weekAgg.map((w) => ({
      weekLabel: w.weekLabel,
      actualMiles: Math.round(w.actualMiles),
      plannedMiles: Math.round(w.plannedMiles),
      avgCompliance: Math.round(w.complianceSum / Math.max(1, athletes.length)),
    }));

    const upcomingRaces = athletes
      .map((a) => ({
        athlete: a,
        daysLeft: daysUntilDate(a.goal.raceDate),
      }))
      .filter((x) => x.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 7);

    const recentActivities: Array<{ athlete: Athlete; workout: Workout }> = [];
    for (const a of athletes) {
      const latest = a.workouts
        .filter((w) => w.date <= '2026-11-18' && w.type !== 'Rest')
        .sort((x, y) => y.date.localeCompare(x.date))[0];
      if (latest) recentActivities.push({ athlete: a, workout: latest });
    }
    recentActivities.sort((a, b) => b.workout.date.localeCompare(a.workout.date));

    return {
      totalAthletes: athletes.length,
      attentionList,
      week11Actual: Math.round(week11Actual),
      week11Planned: Math.round(week11Planned),
      week12Actual: Math.round(week12Actual),
      avgCompliance: Math.round(complianceSum / Math.max(1, athletes.length)),
      avgCtl: (ctlSum / Math.max(1, athletes.length)).toFixed(1),
      avgTsb: (tsbSum / Math.max(1, athletes.length)).toFixed(1),
      integrityFlagCount,
      chartData,
      upcomingRaces,
      recentActivities: recentActivities.slice(0, 8),
    };
  }, [athletes, insightsByAthlete]);

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Active Athletes</span>
            <Users className="h-4 w-4 text-navy-900" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {summary.totalAthletes}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Roster mean CTL {summary.avgCtl} · TSB {summary.avgTsb}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Athletes Requiring Attention</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-amber-600 tabular-nums">
            {summary.attentionList.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Includes {summary.integrityFlagCount} flagged/missing HR sessions
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Weekly Roster Mileage</span>
            <Footprints className="h-4 w-4 text-sky-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {summary.week11Actual.toLocaleString()}{' '}
            <span className="text-sm font-medium text-slate-400">
              / {summary.week11Planned.toLocaleString()} mi
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Last full week · {summary.week12Actual.toLocaleString()} mi logged Nov 16–18
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Training Compliance</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-3xl font-bold text-navy-900 tabular-nums">
            {summary.avgCompliance}%
          </p>
          <p className="mt-1 text-xs text-slate-500">Roster-wide session & volume adherence</p>
        </div>
      </div>

      {/* Main Chart + Attention Queue */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-navy-900">
                12-Week Roster Mileage & Compliance
              </h2>
              <p className="text-xs text-slate-500">
                Completed vs. planned weekly miles across all 30 runners
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-navy-900" /> Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> Planned
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-sky-500" /> Compliance %
              </span>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={summary.chartData}
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
                  name="Actual Miles"
                  fill="#0A1628"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="avgCompliance"
                  name="Compliance %"
                  stroke="#0284C7"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Athletes Requiring Attention */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3">
            <h2 className="font-display text-base font-bold text-navy-900">Attention Queue</h2>
            <p className="text-xs text-slate-500">
              Prioritized by LTHR load, HR drift, verification & data integrity
            </p>
          </div>

          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {summary.attentionList.map(({ athlete, insight }) => {
              const primaryFlag = insight.attentionAreas[0];
              const isHigh = primaryFlag.severity === 'high';
              return (
                <button
                  key={athlete.id}
                  type="button"
                  onClick={() => onSelectAthlete(athlete.id, true)}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="truncate font-semibold text-navy-900">{athlete.name}</span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={`text-xs font-semibold whitespace-nowrap ${
                          isHigh ? 'text-rose-700' : 'text-amber-700'
                        }`}
                      >
                        {primaryFlag.category}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500 tabular-nums">
                      {primaryFlag.metricDetail}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Upcoming Races & Recent Activities */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-navy-900">Upcoming Races</h2>
              <p className="text-xs text-slate-500">Next goal events on the team calendar</p>
            </div>
            <Calendar className="h-4 w-4 text-slate-400" />
          </div>
          <div className="divide-y divide-slate-100">
            {summary.upcomingRaces.map(({ athlete, daysLeft }) => (
              <div key={athlete.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectAthlete(athlete.id)}
                    className="text-sm font-semibold text-navy-900 hover:text-sky-700"
                  >
                    {athlete.name}
                  </button>
                  <p className="truncate text-xs text-slate-500 tabular-nums">
                    {athlete.goal.raceName} · {athlete.goal.distanceLabel} · Target{' '}
                    {formatDuration(athlete.goal.targetTimeSeconds)}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p className="text-xs font-bold text-navy-900">{daysLeft}d out</p>
                  <p className="text-xs text-slate-400">{athlete.goal.raceDate}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-navy-900">
                Recent Athlete Activities
              </h2>
              <p className="text-xs text-slate-500">
                Latest logged sessions with HR-derived stress & LTHR provenance
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {summary.recentActivities.map(({ athlete, workout }) => (
              <div key={workout.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => onSelectAthlete(athlete.id)}
                      className="font-semibold text-navy-900 hover:text-sky-700"
                    >
                      {athlete.name}
                    </button>
                    <span className="text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-xs font-medium text-slate-600">{workout.type}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500 tabular-nums">
                    {workout.title} · {workout.date} · LTHR v{workout.provenance.thresholdVersion}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  {workout.status === 'Missed' ? (
                    <span className="text-xs font-semibold text-rose-700">
                      Missed ({workout.plannedMiles.toFixed(1)} mi)
                    </span>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-navy-900">
                        {workout.actualMiles.toFixed(1)} mi @ {formatPace(workout.avgPaceSecPerMile)}
                        /mi
                      </p>
                      <p className="text-xs text-slate-400">
                        {workout.hrDataState === 'invalid'
                          ? 'Invalid HR Flagged'
                          : workout.hrDataState === 'missing'
                          ? 'Missing HR'
                          : `${workout.avgHrBpm} bpm · ${workout.stress.hrStress ?? '--'} hrRSS`}
                      </p>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
