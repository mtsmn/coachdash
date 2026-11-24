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

export const DEMO_ANCHOR_DATE = '2026-11-18';

export function formatPace(secPerMile: number | null | undefined): string {
  if (!secPerMile || !Number.isFinite(secPerMile) || secPerMile <= 0) return '--:--';
  const rounded = Math.round(secPerMile);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '--:--';
  }
  const rounded = Math.round(totalSeconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const dt = new Date(isoDate + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function getMondayIso(isoDate: string): string {
  const dt = new Date(isoDate + 'T00:00:00Z');
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diffToMonday);
  return dt.toISOString().slice(0, 10);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShortMonthDay(isoDate: string): string {
  const dt = new Date(isoDate + 'T00:00:00Z');
  return `${SHORT_MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function buildTwelveWeekWindow(anchorDateIso = DEMO_ANCHOR_DATE): {
  startDateIso: string;
  endDateIso: string;
  anchorDateIso: string;
  weekMondays: string[];
  weekLabels: string[];
} {
  const endMonday = getMondayIso(anchorDateIso);
  const startDateIso = addDaysIso(endMonday, -11 * 7);
  const weekMondays: string[] = [];
  const weekLabels: string[] = [];
  for (let w = 0; w < 12; w++) {
    const mon = addDaysIso(startDateIso, w * 7);
    weekMondays.push(mon);
    weekLabels.push(formatShortMonthDay(mon));
  }
  return {
    startDateIso,
    endDateIso: anchorDateIso,
    anchorDateIso,
    weekMondays,
    weekLabels,
  };
}

export function resolveAnchorDateIso(athlete?: Athlete | null): string {
  if (athlete?.productionContext?.anchorDateIso) {
    return athlete.productionContext.anchorDateIso;
  }
  return DEMO_ANCHOR_DATE;
}

export function resolveRosterAnchorDateIso(athletes: Athlete[]): string {
  const prodAnchors = athletes
    .map((a) => a.productionContext?.anchorDateIso)
    .filter((d): d is string => Boolean(d));
  if (prodAnchors.length > 0) {
    return prodAnchors.sort()[prodAnchors.length - 1];
  }
  return DEMO_ANCHOR_DATE;
}

export function daysUntilDate(isoDate: string, anchorDate = DEMO_ANCHOR_DATE): number {
  if (!isoDate) return -1;
  const target = new Date(isoDate + 'T00:00:00Z').getTime();
  const anchor = new Date(anchorDate + 'T00:00:00Z').getTime();
  if (!Number.isFinite(target) || !Number.isFinite(anchor)) return -1;
  return Math.round((target - anchor) / (1000 * 60 * 60 * 24));
}

export function computeWeeklyVolumeSeries(
  workouts: Workout[],
  anchorDateIso = DEMO_ANCHOR_DATE
): WeeklyVolumePoint[] {
  const { weekLabels } = buildTwelveWeekWindow(anchorDateIso);
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

    const plannedSessions = list.filter(
      (item) => item.type !== 'Rest' && item.plannedMiles > 0
    );
    const completedSessions = list.filter(
      (item) => item.type !== 'Rest' && item.status === 'Completed'
    );

    series.push({
      weekLabel: weekLabels[w - 1] ?? `Wk ${w}`,
      weekIndex: w,
      plannedMiles: Number(plannedMiles.toFixed(1)),
      actualMiles: Number(actualMiles.toFixed(1)),
      longRunMiles: Number(longRunMiles.toFixed(1)),
      workoutCountCompleted: completedSessions.length,
      workoutCountPlanned: plannedSessions.length,
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
  activeLthrBpm?: number,
  anchorDateIso = DEMO_ANCHOR_DATE
): PaceHrTrendPoint[] {
  const { weekLabels } = buildTwelveWeekWindow(anchorDateIso);
  const series: PaceHrTrendPoint[] = [];
  for (let w = 1; w <= 12; w++) {
    const wkWorkouts = workouts.filter(
      (item) =>
        item.weekIndex === w &&
        item.status === 'Completed' &&
        item.avgPaceSecPerMile !== null &&
        item.actualMiles > 0
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
      easyAvgPaceSec && easyAvgHr && easyAvgPaceSec > 0 && easyAvgHr > 0
        ? Number((((1760 / (easyAvgPaceSec / 60)) / easyAvgHr) * 10).toFixed(2))
        : null;

    series.push({
      weekLabel: weekLabels[w - 1] ?? `Wk ${w}`,
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

  const hasValidLthr =
    Array.isArray(athleteOrWorkouts) || athleteOrWorkouts.lthrBpm > 0;

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
      w.status === 'Completed'
  );

  const totals: Record<IntensityZone, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let totalMinutes = 0;

  for (const w of filtered) {
    const zSum =
      (w.zoneBreakdown.Z1 ?? 0) +
      (w.zoneBreakdown.Z2 ?? 0) +
      (w.zoneBreakdown.Z3 ?? 0) +
      (w.zoneBreakdown.Z4 ?? 0) +
      (w.zoneBreakdown.Z5 ?? 0);
    if (zSum <= 0) continue;
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
    bpmRange: hasValidLthr ? `${z.minBpm}–${z.maxBpm} bpm` : 'LTHR not set',
  }));
}

export function estimateRacePerformances(athlete: Athlete): RacePrediction[] {
  const thresholdSec = athlete.thresholdPaceSecPerMile;
  if (!thresholdSec || !Number.isFinite(thresholdSec) || thresholdSec <= 0) {
    return [];
  }

  const anchor = resolveAnchorDateIso(athlete);
  const weekly = computeWeeklyVolumeSeries(athlete.workouts, anchor);
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
