import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Search } from 'lucide-react';
import { AICoachingInsight, Athlete, TrainingGroup } from '../../types/coaching';
import {
  computeWeeklyVolumeSeries,
  daysUntilDate,
  formatDuration,
} from '../../utils/analytics';
import { computeDailyAndWeeklyLoadSeries } from '../../utils/lthrAnalytics';

interface AthleteRosterProps {
  athletes: Athlete[];
  insightsByAthlete: Record<string, AICoachingInsight>;
  onSelectAthlete: (athleteId: string) => void;
}

type SortField = 'name' | 'mileage' | 'compliance' | 'tsb' | 'raceDate';

export const AthleteRoster: React.FC<AthleteRosterProps> = ({
  athletes,
  insightsByAthlete,
  onSelectAthlete,
}) => {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<TrainingGroup | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Attention' | 'OnTrack'>('All');
  const [sortBy, setSortBy] = useState<SortField>('name');

  const enriched = useMemo(() => {
    return athletes
      .map((athlete) => {
        const weekly = computeWeeklyVolumeSeries(athlete.workouts);
        const fullWeeks = weekly.slice(-5, -1);
        const fourWkAvg =
          fullWeeks.reduce((s, w) => s + w.actualMiles, 0) / Math.max(1, fullWeeks.length);
        const fourWkCompliance = Math.round(
          fullWeeks.reduce((s, w) => s + w.compliancePct, 0) / Math.max(1, fullWeeks.length)
        );
        const load = computeDailyAndWeeklyLoadSeries(athlete.workouts);
        const latestLoad = load.daily[load.daily.length - 1];
        const lastFullWeekStress = load.weekly[load.weekly.length - 2]?.weeklyHrStress ?? 0;

        const activeRec = athlete.lthrHistory.find(
          (r) => r.version === athlete.activeThresholdVersion
        );
        const insight = insightsByAthlete[athlete.id];
        const flags = insight?.attentionAreas ?? [];
        const daysToRace = daysUntilDate(athlete.goal.raceDate);

        return {
          athlete,
          fourWkAvg,
          fourWkCompliance,
          flags,
          daysToRace,
          ctl: latestLoad?.ctl ?? 0,
          tsb: latestLoad?.tsb ?? 0,
          lastFullWeekStress,
          lthrSourceLabel:
            activeRec?.source === 'Coach-Approved Manual Fallback'
              ? 'Manual Fallback'
              : 'Garmin Auto',
          lthrVerified: activeRec?.coachVerified ?? false,
        };
      })
      .filter((item) => {
        const q = search.trim().toLowerCase();
        if (q) {
          const matches =
            item.athlete.name.toLowerCase().includes(q) ||
            item.athlete.goal.raceName.toLowerCase().includes(q) ||
            item.athlete.location.toLowerCase().includes(q);
          if (!matches) return false;
        }
        if (groupFilter !== 'All' && item.athlete.trainingGroup !== groupFilter) {
          return false;
        }
        if (statusFilter === 'Attention' && item.flags.length === 0) return false;
        if (statusFilter === 'OnTrack' && item.flags.length > 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'mileage') return b.fourWkAvg - a.fourWkAvg;
        if (sortBy === 'compliance') return a.fourWkCompliance - b.fourWkCompliance;
        if (sortBy === 'tsb') return a.tsb - b.tsb;
        if (sortBy === 'raceDate') return a.daysToRace - b.daysToRace;
        return a.athlete.name.localeCompare(b.athlete.name);
      });
  }, [athletes, insightsByAthlete, search, groupFilter, statusFilter, sortBy]);

  const groups: Array<TrainingGroup | 'All'> = [
    'All',
    'Marathon',
    'Half Marathon',
    '10K / 5K Track',
    'Ultra / Trail',
    'Base / Return',
  ];

  const clearFilters = () => {
    setSearch('');
    setGroupFilter('All');
    setStatusFilter('All');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="relative md:col-span-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search athlete, goal race, or city..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-navy-900 placeholder-slate-400 focus:border-navy-900 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as TrainingGroup | 'All')}
              aria-label="Filter by training group"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-navy-900 focus:border-navy-900 focus:bg-white focus:outline-none"
            >
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g === 'All' ? 'All Training Groups' : g}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 md:col-span-4">
            <div className="flex flex-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'All', label: 'All' },
                  { id: 'Attention', label: 'Flagged' },
                  { id: 'OnTrack', label: 'Nominal' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStatusFilter(opt.id)}
                  className={`flex-1 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                    statusFilter === opt.id
                      ? 'bg-white text-navy-900 shadow-sm'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setSortBy((prev) =>
                  prev === 'name'
                    ? 'mileage'
                    : prev === 'mileage'
                    ? 'compliance'
                    : prev === 'compliance'
                    ? 'tsb'
                    : prev === 'tsb'
                    ? 'raceDate'
                    : 'name'
                )
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="capitalize">Sort: {sortBy}</span>
            </button>
          </div>
        </div>
        <p className="mt-2.5 text-xs text-slate-500 tabular-nums">
          Showing {enriched.length} of {athletes.length} athletes
        </p>
      </div>

      {enriched.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="font-display text-base font-bold text-navy-900">
            No matching athletes found
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Adjust your search query or group/status filters to view the 30-runner roster.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-navy-900 text-xs font-semibold text-slate-200">
                  <tr>
                    <th className="px-4 py-3">Athlete</th>
                    <th className="px-4 py-3">Group / Phase</th>
                    <th className="px-4 py-3 text-right">LTHR Source</th>
                    <th className="px-4 py-3 text-right">4-Wk Avg</th>
                    <th className="px-4 py-3 text-right">CTL / TSB</th>
                    <th className="px-4 py-3 text-right">Compliance</th>
                    <th className="px-4 py-3">Goal Race & Target</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enriched.map(
                    ({
                      athlete,
                      fourWkAvg,
                      fourWkCompliance,
                      flags,
                      daysToRace,
                      ctl,
                      tsb,
                      lastFullWeekStress,
                      lthrSourceLabel,
                      lthrVerified,
                    }) => (
                      <tr
                        key={athlete.id}
                        onClick={() => onSelectAthlete(athlete.id)}
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-navy-900">{athlete.name}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {athlete.age}y · {athlete.location}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{athlete.trainingGroup}</p>
                          <p className="text-xs text-slate-500">{athlete.currentPhase} phase</p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <p className="font-mono font-semibold text-navy-900">
                            {athlete.lthrBpm} bpm
                          </p>
                          <p
                            className={`text-xs ${
                              lthrVerified ? 'text-slate-500' : 'text-amber-700 font-medium'
                            }`}
                          >
                            {lthrSourceLabel} · v{athlete.activeThresholdVersion}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <p className="font-semibold text-navy-900">
                            {fourWkAvg.toFixed(1)} mi/wk
                          </p>
                          <p className="text-xs text-slate-500">
                            {lastFullWeekStress.toFixed(0)} hrRSS/wk
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          <p className="font-semibold text-navy-900">{ctl.toFixed(1)} CTL</p>
                          <p
                            className={
                              tsb < -15 ? 'font-semibold text-rose-700' : 'text-slate-500'
                            }
                          >
                            {tsb >= 0 ? '+' : ''}
                            {tsb.toFixed(1)} TSB
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span
                            className={`font-mono text-xs font-semibold ${
                              fourWkCompliance >= 85
                                ? 'text-emerald-700'
                                : fourWkCompliance >= 75
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {fourWkCompliance}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-navy-900">{athlete.goal.raceName}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {athlete.goal.raceDate} ({daysToRace}d) ·{' '}
                            {formatDuration(athlete.goal.targetTimeSeconds)}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {flags.length > 0 ? (
                            <span
                              className={`text-xs font-semibold ${
                                flags.some((f) => f.severity === 'high')
                                  ? 'text-rose-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {flags[0].category}
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-emerald-700">On Track</span>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:hidden">
            {enriched.map(
              ({ athlete, fourWkAvg, fourWkCompliance, flags, daysToRace, tsb, lthrSourceLabel }) => (
                <button
                  key={athlete.id}
                  type="button"
                  onClick={() => onSelectAthlete(athlete.id)}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-navy-900">{athlete.name}</p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {athlete.trainingGroup} · LTHR {athlete.lthrBpm} bpm ({lthrSourceLabel})
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        flags.length > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {flags.length > 0 ? flags[0].category : 'On Track'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 tabular-nums">
                    {athlete.goal.raceName} · {daysToRace}d out
                  </p>
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs tabular-nums">
                    <span className="text-slate-600">
                      <strong className="text-navy-900">{fourWkAvg.toFixed(1)}</strong> mi/wk
                    </span>
                    <span className="text-slate-600">
                      TSB <strong className="text-navy-900">{tsb.toFixed(1)}</strong>
                    </span>
                    <span className="text-slate-600">
                      Compliance <strong className="text-navy-900">{fourWkCompliance}%</strong>
                    </span>
                  </div>
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
};
