import {
  Athlete,
  IntensityDistributionItem,
  IntensityZone,
  PaceHrTrendPoint,
  RacePrediction,
  WeeklyVolumePoint,
  Workout,
} from '../types/coaching';
import { computeLthrZones } from './lthrAnalytics';

export function formatPace(secPerMile: number | null | undefined): string {
  if (!secPerMile || !Number.isFinite(secPerMile)) return '--:--';
  const rounded = Math.round(secPerMile);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDuration(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function daysUntilDate(isoDate: string, anchorDate = '2026-11-18'): number {
  const target = new Date(isoDate + 'T00:00:00Z').getTime();
  const anchor = new Date(anchorDate + 'T00:00:00Z').getTime();
  return Math.round((target - anchor) / (1000 * 60 * 60 * 24));
}

const WEEK_LABELS = [
  'Aug 31',
  'Sep 7',
  'Sep 14',
  'Sep 21',
  'Sep 28',
  'Oct 5',
  'Oct 12',
  'Oct 19',
  'Oct 26',
  'Nov 2',
  'Nov 9',
  'Nov 16',
];

export function computeWeeklyVolumeSeries(workouts: Workout[]): WeeklyVolumePoint[] {
  const byWeek = new Map<number, Workout[]>();
  for (let w = 1; w <= 12; w++) byWeek.set(w, []);
  for (const workout of workouts) {
    const arr = byWeek.get(workout.weekIndex);
    if (arr) arr.push(workout);
  }

  const series: WeeklyVolumePoint[] = [];
  for (let w = 1; w <= 12; w++) {
    const list = byWeek.get(w) ?? [];
    const plannedMiles = list.reduce((sum, item) => sum + item.plannedMiles, 0);
    const actualMiles = list.reduce((sum, item) => sum + item.actualMiles, 0);
    const longRuns = list.filter((item) => item.type === 'Long Run' || item.type === 'Race');
    const longRunMiles = longRuns.reduce((max, item) => Math.max(max, item.actualMiles), 0);

    const scheduledToDate = list.filter(
      (item) => item.type !== 'Rest' && item.plannedMiles > 0 && item.status !== 'Planned'
    );
    const plannedToDateMiles = scheduledToDate.reduce((sum, item) => sum + item.plannedMiles, 0);
    const completedSessions = scheduledToDate.filter(
      (item) => item.status === 'Completed' || item.status === 'Modified'
    );

    const volumeCompliance =
      plannedToDateMiles > 0 ? (actualMiles / plannedToDateMiles) * 100 : 100;
    const sessionCompliance =
      scheduledToDate.length > 0
        ? (completedSessions.length / scheduledToDate.length) * 100
        : 100;
    const compliancePct = Math.min(
      100,
      Math.round(volumeCompliance * 0.55 + sessionCompliance * 0.45)
    );

    series.push({
      weekLabel: WEEK_LABELS[w - 1] ?? `Wk ${w}`,
      weekIndex: w,
      plannedMiles: Number(plannedMiles.toFixed(1)),
      actualMiles: Number(actualMiles.toFixed(1)),
      longRunMiles: Number(longRunMiles.toFixed(1)),
      compliancePct,
      workoutCountCompleted: completedSessions.length,
      workoutCountPlanned: scheduledToDate.length,
    });
  }
  return series;
}

export function computeACWR(weekly: WeeklyVolumePoint[]): number {
  if (weekly.length < 5) return 1.0;
  const week11 = weekly[weekly.length - 2];
  const week12 = weekly[weekly.length - 1];
  const acute =
    week12.actualMiles > week11.actualMiles * 0.7 ? week12.actualMiles : week11.actualMiles;
  const chronicSlice = weekly.slice(-6, -2);
  const chronic =
    chronicSlice.reduce((sum, w) => sum + w.actualMiles, 0) / Math.max(1, chronicSlice.length);
  if (chronic <= 0) return 1.0;
  return Number((acute / chronic).toFixed(2));
}

export function computePaceHrTrends(
  workouts: Workout[],
  activeLthrBpm?: number
): PaceHrTrendPoint[] {
  const series: PaceHrTrendPoint[] = [];
  for (let w = 1; w <= 12; w++) {
    const wkWorkouts = workouts.filter(
      (item) => item.weekIndex === w && item.avgPaceSecPerMile !== null && item.actualMiles > 0
    );
    const easy = wkWorkouts.filter(
      (item) => item.type === 'Easy' || item.type === 'Long Run' || item.type === 'Recovery'
    );
    const quality = wkWorkouts.filter(
      (item) => item.type === 'Tempo' || item.type === 'Intervals' || item.type === 'Race'
    );

    const easyAvgPaceSec =
      easy.length > 0
        ? Math.round(easy.reduce((s, x) => s + (x.avgPaceSecPerMile ?? 0), 0) / easy.length)
        : null;
    const easyWithValidHr = easy.filter(
      (x) => x.hrDataState === 'valid' && x.avgHrBpm !== null
    );
    const easyAvgHr =
      easyWithValidHr.length > 0
        ? Math.round(
            easyWithValidHr.reduce((s, x) => s + (x.avgHrBpm ?? 0), 0) / easyWithValidHr.length
          )
        : null;

    const easyPctLthr =
      easyAvgHr && activeLthrBpm && activeLthrBpm > 0
        ? Number(((easyAvgHr / activeLthrBpm) * 100).toFixed(1))
        : null;

    const qualityAvgPaceSec =
      quality.length > 0
        ? Math.round(quality.reduce((s, x) => s + (x.avgPaceSecPerMile ?? 0), 0) / quality.length)
        : null;

    const efficiencyFactor =
      easyAvgPaceSec && easyAvgHr
        ? Number((((1760 / (easyAvgPaceSec / 60)) / easyAvgHr) * 10).toFixed(2))
        : null;

    series.push({
      weekLabel: WEEK_LABELS[w - 1] ?? `Wk ${w}`,
      weekIndex: w,
      easyAvgPaceSec,
      easyAvgHr,
      easyPctLthr,
      qualityAvgPaceSec,
      efficiencyFactor,
    });
  }
  return series;
}

export function computeIntensityDistribution(
  athleteOrWorkouts: Athlete | Workout[],
  lastWeeks = 4
): IntensityDistributionItem[] {
  const workouts = Array.isArray(athleteOrWorkouts)
    ? athleteOrWorkouts
    : athleteOrWorkouts.workouts;

  const zones = Array.isArray(athleteOrWorkouts)
    ? [
        { zone: 'Z1' as IntensityZone, name: 'Z1 Recovery', minBpm: 90, maxBpm: 140, color: '#94A3B8' },
        { zone: 'Z2' as IntensityZone, name: 'Z2 Aerobic', minBpm: 141, maxBpm: 152, color: '#0EA5E9' },
        { zone: 'Z3' as IntensityZone, name: 'Z3 Tempo', minBpm: 153, maxBpm: 162, color: '#F59E0B' },
        { zone: 'Z4' as IntensityZone, name: 'Z4 Threshold', minBpm: 163, maxBpm: 171, color: '#F97316' },
        { zone: 'Z5' as IntensityZone, name: 'Z5 VO2 / Speed', minBpm: 172, maxBpm: 195, color: '#EF4444' },
      ]
    : computeLthrZones(
        athleteOrWorkouts.lthrBpm,
        athleteOrWorkouts.hrZoneConfig,
        athleteOrWorkouts.maxHrBpm
      );

  const minWeek = Math.max(1, 13 - lastWeeks);
  const filtered = workouts.filter(
    (w) =>
      w.weekIndex >= minWeek &&
      w.durationMinutes > 0 &&
      w.status !== 'Missed' &&
      w.status !== 'Planned'
  );

  const totals: Record<IntensityZone, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let totalMinutes = 0;

  for (const w of filtered) {
    totalMinutes += w.durationMinutes;
    (Object.keys(totals) as IntensityZone[]).forEach((z) => {
      totals[z] += (w.durationMinutes * (w.zoneBreakdown[z] ?? 0)) / 100;
    });
  }

  return zones.map((z) => ({
    zone: z.zone,
    label: z.name,
    color: z.color,
    minutes: Math.round(totals[z.zone]),
    percentage: totalMinutes > 0 ? Number(((totals[z.zone] / totalMinutes) * 100).toFixed(1)) : 0,
    bpmRange: `${z.minBpm}–${z.maxBpm} bpm`,
  }));
}

export function estimateRacePerformances(athlete: Athlete): RacePrediction[] {
  const thresholdSec = athlete.thresholdPaceSecPerMile;
  const weekly = computeWeeklyVolumeSeries(athlete.workouts);
  const avg4WkMiles = weekly.slice(-5, -1).reduce((s, w) => s + w.actualMiles, 0) / 4;

  const tenKAnchor = thresholdSec * 6.2137 * 0.995;

  const distances: Array<{
    distanceLabel: '5K' | '10K' | 'Half Marathon' | 'Marathon';
    miles: number;
  }> = [
    { distanceLabel: '5K', miles: 3.10686 },
    { distanceLabel: '10K', miles: 6.21371 },
    { distanceLabel: 'Half Marathon', miles: 13.1094 },
    { distanceLabel: 'Marathon', miles: 26.2188 },
  ];

  const volumeAdjustment = avg4WkMiles >= 55 ? 1.055 : avg4WkMiles >= 40 ? 1.065 : 1.082;

  return distances.map((d) => {
    const ratio = d.miles / 6.21371;
    const exp = d.distanceLabel === 'Marathon' ? volumeAdjustment + 0.012 : volumeAdjustment;
    const estimatedSeconds = Math.round(tenKAnchor * Math.pow(ratio, exp));
    const margin = d.distanceLabel === 'Marathon' ? 0.025 : 0.016;
    return {
      distanceLabel: d.distanceLabel,
      estimatedSeconds,
      rangeLowSeconds: Math.round(estimatedSeconds * (1 - margin)),
      rangeHighSeconds: Math.round(estimatedSeconds * (1 + margin)),
      estimatedPaceSecPerMile: Math.round(estimatedSeconds / d.miles),
    };
  });
}
