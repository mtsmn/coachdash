import {
  Athlete,
  DailyLoadPoint,
  IntensityDistributionItem,
  WeeklyAthleteReport,
  WeeklyLoadPoint,
  WeeklyVolumePoint,
} from '../types/coaching';
import {
  computeIntensityDistribution,
  computePaceHrTrends,
  computeWeeklyVolumeSeries,
  daysUntilDate,
  formatDuration,
  formatPace,
} from './analytics';
import { computeDailyAndWeeklyLoadSeries, getTsbFormLabel } from './lthrAnalytics';

export const COMMAND_ANCHOR_DATE = '2026-11-18';

export type CommandAlertCategory =
  | 'Load (CTL/ATL/TSB)'
  | 'LTHR & HR Zones'
  | 'Compliance & Volume'
  | 'Taper & Race Prep'
  | 'Data Hygiene & Sync';

export interface CommandCenterAlert {
  id: string;
  athleteId: string;
  athleteName: string;
  category: CommandAlertCategory;
  severity: 'high' | 'moderate' | 'low';
  title: string;
  explanation: string;
  supportingData: string[];
  weight: number;
}

export interface PositiveDevelopment {
  id: string;
  athleteId: string;
  athleteName: string;
  trainingGroup: Athlete['trainingGroup'];
  category:
    | 'Aerobic Efficiency Gain'
    | 'Peaking / Taper Execution'
    | 'Sustainable CTL Growth'
    | 'Tune-Up PR & LTHR Progression';
  headline: string;
  explanation: string;
  baselineComparison: string;
  supportingData: string[];
  score: number;
}

export interface DataHygieneIssue {
  id: string;
  athleteId: string;
  athleteName: string;
  trainingGroup: Athlete['trainingGroup'];
  issueType:
    | 'Outdated Garmin Sync'
    | 'Invalid HR Telemetry'
    | 'Missing HR Telemetry'
    | 'Missing Garmin LTHR'
    | 'Unverified / Aging LTHR';
  severity: 'high' | 'moderate' | 'low';
  summary: string;
  supportingData: string[];
  lastSyncedDate: string;
  daysSinceSync: number;
}

export interface AthleteCommandSummary {
  athlete: Athlete;
  attentionScore: number;
  priorityTier: 'Immediate Review' | 'Watch List' | 'On Track';
  alerts: CommandCenterAlert[];
  loadAlerts: CommandCenterAlert[];
  positiveDevelopments: PositiveDevelopment[];
  dataHygieneIssues: DataHygieneIssue[];

  // Current & baseline load metrics
  ctl: number;
  atl: number;
  tsb: number;
  atlCtlRatio: number;
  tsbFormLabel: string;
  tsbFormTone: 'emerald' | 'sky' | 'amber' | 'rose';
  ctlDelta14d: number;
  baselineCtlMean: number;
  baselineMeanTsb: number;
  baselineMinTsb: number;
  lastFullWeekHrStress: number;
  baselineWeeklyHrStress: number;
  weeklyStressDeltaPct: number;

  // Mileage & compliance
  lastFullWeekActualMiles: number;
  lastFullWeekPlannedMiles: number;
  lastFullWeekCompliancePct: number;
  fourWkAvgMiles: number;
  baseline4WkAvgMiles: number;
  fourWkCompliancePct: number;
  baselineCompliancePct: number;
  currentWeekActualMiles: number;
  missedSessions14d: number;
  modifiedSessions14d: number;
  completedSessions14d: number;
  plannedSessions14d: number;

  // LTHR & HR Zone monitoring
  lthrBpm: number;
  lthrVersion: number;
  lthrSource: Athlete['lthrHistory'][number]['source'];
  lthrVerified: boolean;
  lthrAgeDays: number;
  recentEasyPctLthr: number | null;
  baselineEasyPctLthr: number | null;
  easyPctLthrShift: number;
  efRecent4Wk: number | null;
  efBaseline4Wk: number | null;
  efChangePct: number;
  z12Pct4Wk: number;
  z12PctBaseline: number;
  z3Pct4Wk: number;
  z45Pct4Wk: number;
  zoneDistribution4Wk: IntensityDistributionItem[];

  // Sync & data integrity
  lastSyncedDate: string;
  daysSinceGarminSync: number;
  missingHrCount: number;
  invalidHrCount: number;

  // Race timeline
  daysToRace: number;

  // Precomputed series for instant inline drill-down
  weeklyVolume: WeeklyVolumePoint[];
  dailyLoad: DailyLoadPoint[];
  weeklyLoad: WeeklyLoadPoint[];
}

export interface RosterCommandCenterSnapshot {
  rosterCount: number;
  rankedAthletes: AthleteCommandSummary[];
  allAlerts: CommandCenterAlert[];
  loadAlerts: CommandCenterAlert[];
  positiveDevelopments: PositiveDevelopment[];
  dataHygieneIssues: DataHygieneIssue[];
  upcomingRaces: Array<{
    summary: AthleteCommandSummary;
    daysLeft: number;
    taperStatus: 'Fresh / Peaking' | 'Building Into Race' | 'Elevated Fatigue';
  }>;
  weeklyMileageTrend: Array<{
    weekLabel: string;
    weekIndex: number;
    actualMiles: number;
    plannedMiles: number;
    avgCompliancePct: number;
    totalHrStress: number;
    meanCtl: number;
    meanTsb: number;
  }>;
  rosterMeans: {
    meanCtl: number;
    meanAtl: number;
    meanTsb: number;
    highFatigueCount: number;
    freshCount: number;
    lastFullWeekActualMiles: number;
    lastFullWeekPlannedMiles: number;
    currentWeekActualMiles: number;
    avgCompliancePct: number;
    z12MeanPct: number;
    z3MeanPct: number;
    z45MeanPct: number;
    garminAutoLthrCount: number;
    manualFallbackLthrCount: number;
    unverifiedLthrCount: number;
    immediateReviewCount: number;
    watchListCount: number;
  };
}

function parseIsoDatePart(raw: string | null | undefined): string {
  if (!raw) return COMMAND_ANCHOR_DATE;
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : COMMAND_ANCHOR_DATE;
}

function daysBetweenIso(earlierIso: string, laterIso: string): number {
  const a = new Date(earlierIso + 'T00:00:00Z').getTime();
  const b = new Date(laterIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

function computeZoneSplitFromWorkouts(
  workouts: Athlete['workouts']
): { z12Pct: number; z3Pct: number; z45Pct: number } {
  let totalMin = 0;
  let z12Min = 0;
  let z3Min = 0;
  let z45Min = 0;
  for (const w of workouts) {
    if (w.durationMinutes <= 0 || w.status === 'Missed' || w.status === 'Planned') continue;
    totalMin += w.durationMinutes;
    z12Min += (w.durationMinutes * ((w.zoneBreakdown.Z1 ?? 0) + (w.zoneBreakdown.Z2 ?? 0))) / 100;
    z3Min += (w.durationMinutes * (w.zoneBreakdown.Z3 ?? 0)) / 100;
    z45Min += (w.durationMinutes * ((w.zoneBreakdown.Z4 ?? 0) + (w.zoneBreakdown.Z5 ?? 0))) / 100;
  }
  if (totalMin <= 0) return { z12Pct: 0, z3Pct: 0, z45Pct: 0 };
  return {
    z12Pct: Number(((z12Min / totalMin) * 100).toFixed(1)),
    z3Pct: Number(((z3Min / totalMin) * 100).toFixed(1)),
    z45Pct: Number(((z45Min / totalMin) * 100).toFixed(1)),
  };
}

export function evaluateAthleteForCommandCenter(athlete: Athlete): AthleteCommandSummary {
  const weeklyVolume = computeWeeklyVolumeSeries(athlete.workouts);
  const loadSeries = computeDailyAndWeeklyLoadSeries(athlete.workouts);
  const paceHr = computePaceHrTrends(athlete.workouts, athlete.lthrBpm);
  const zoneDistribution4Wk = computeIntensityDistribution(athlete, 4);

  const daily = loadSeries.daily;
  const weeklyLoad = loadSeries.weekly;
  const latestDay = daily[daily.length - 1];
  const day14Ago = daily[Math.max(0, daily.length - 15)];

  const ctl = latestDay?.ctl ?? 0;
  const atl = latestDay?.atl ?? 0;
  const tsb = latestDay?.tsb ?? 0;
  const atlCtlRatio = ctl > 0 ? Number((atl / ctl).toFixed(2)) : 1.0;
  const form = getTsbFormLabel(tsb);
  const ctlDelta14d = Number((ctl - (day14Ago?.ctl ?? ctl)).toFixed(1));

  // Athlete-specific 8-week historical load baseline (days 0..55)
  const baselineDays = daily.slice(0, 56);
  const baselineCtlMean =
    baselineDays.length > 0
      ? Number(
          (baselineDays.reduce((s, d) => s + d.ctl, 0) / baselineDays.length).toFixed(1)
        )
      : ctl;
  const baselineMeanTsb =
    baselineDays.length > 0
      ? Number(
          (baselineDays.reduce((s, d) => s + d.tsb, 0) / baselineDays.length).toFixed(1)
        )
      : tsb;
  const baselineMinTsb =
    baselineDays.length > 0
      ? Number(Math.min(...baselineDays.map((d) => d.tsb)).toFixed(1))
      : tsb;

  const lastFullWeekLoad = weeklyLoad[weeklyLoad.length - 2];
  const baselineLoadWeeks = weeklyLoad.slice(6, 10); // weeks 7-10
  const lastFullWeekHrStress = lastFullWeekLoad?.weeklyHrStress ?? 0;
  const baselineWeeklyHrStress =
    baselineLoadWeeks.length > 0
      ? Number(
          (
            baselineLoadWeeks.reduce((s, w) => s + w.weeklyHrStress, 0) /
            baselineLoadWeeks.length
          ).toFixed(1)
        )
      : lastFullWeekHrStress;
  const weeklyStressDeltaPct =
    baselineWeeklyHrStress > 0
      ? Number(
          (
            ((lastFullWeekHrStress - baselineWeeklyHrStress) / baselineWeeklyHrStress) *
            100
          ).toFixed(1)
        )
      : 0;

  // Mileage & compliance baselines
  const lastFullWeek = weeklyVolume[weeklyVolume.length - 2];
  const currentWeek = weeklyVolume[weeklyVolume.length - 1];
  const recent4Weeks = weeklyVolume.slice(7, 11); // Weeks 8-11
  const baseline4Weeks = weeklyVolume.slice(3, 7); // Weeks 4-7

  const fourWkAvgMiles = Number(
    (
      recent4Weeks.reduce((s, w) => s + w.actualMiles, 0) /
      Math.max(1, recent4Weeks.length)
    ).toFixed(1)
  );
  const baseline4WkAvgMiles = Number(
    (
      baseline4Weeks.reduce((s, w) => s + w.actualMiles, 0) /
      Math.max(1, baseline4Weeks.length)
    ).toFixed(1)
  );
  const fourWkCompliancePct = Math.round(
    recent4Weeks.reduce((s, w) => s + w.compliancePct, 0) / Math.max(1, recent4Weeks.length)
  );
  const baselineCompliancePct = Math.round(
    baseline4Weeks.reduce((s, w) => s + w.compliancePct, 0) / Math.max(1, baseline4Weeks.length)
  );

  const last14Workouts = athlete.workouts.filter(
    (w) =>
      w.date >= '2026-11-05' &&
      w.date <= COMMAND_ANCHOR_DATE &&
      w.type !== 'Rest' &&
      w.status !== 'Planned'
  );
  const missedSessions14d = last14Workouts.filter((w) => w.status === 'Missed').length;
  const modifiedSessions14d = last14Workouts.filter((w) => w.status === 'Modified').length;
  const completedSessions14d = last14Workouts.filter(
    (w) => w.status === 'Completed' || w.status === 'Modified'
  ).length;
  const plannedSessions14d = last14Workouts.length;

  // LTHR & cardiac zone baselines
  const activeRecord =
    athlete.lthrHistory.find((r) => r.version === athlete.activeThresholdVersion) ??
    athlete.lthrHistory[athlete.lthrHistory.length - 1];
  const lthrAgeDays = activeRecord
    ? Math.max(0, daysBetweenIso(activeRecord.recordedDate, COMMAND_ANCHOR_DATE))
    : 0;

  const recentEasy = athlete.workouts.filter(
    (w) =>
      w.weekIndex >= 11 &&
      (w.type === 'Easy' || w.type === 'Recovery') &&
      w.hrDataState === 'valid' &&
      w.avgHrBpm !== null
  );
  const baselineEasy = athlete.workouts.filter(
    (w) =>
      w.weekIndex <= 8 &&
      (w.type === 'Easy' || w.type === 'Recovery') &&
      w.hrDataState === 'valid' &&
      w.avgHrBpm !== null
  );

  const recentEasyPctLthr =
    recentEasy.length > 0
      ? Number(
          (
            (recentEasy.reduce((s, w) => s + (w.avgHrBpm ?? 0), 0) /
              recentEasy.length /
              athlete.lthrBpm) *
            100
          ).toFixed(1)
        )
      : null;
  const baselineEasyPctLthr =
    baselineEasy.length > 0
      ? Number(
          (
            (baselineEasy.reduce((s, w) => s + (w.avgHrBpm ?? 0), 0) /
              baselineEasy.length /
              athlete.lthrBpm) *
            100
          ).toFixed(1)
        )
      : null;
  const easyPctLthrShift =
    recentEasyPctLthr !== null && baselineEasyPctLthr !== null
      ? Number((recentEasyPctLthr - baselineEasyPctLthr).toFixed(1))
      : 0;

  const earlyEfPts = paceHr.slice(0, 4).filter((p) => p.efficiencyFactor !== null);
  const recentEfPts = paceHr.slice(-4).filter((p) => p.efficiencyFactor !== null);
  const efBaseline4Wk =
    earlyEfPts.length > 0
      ? Number(
          (
            earlyEfPts.reduce((s, p) => s + (p.efficiencyFactor ?? 0), 0) / earlyEfPts.length
          ).toFixed(2)
        )
      : null;
  const efRecent4Wk =
    recentEfPts.length > 0
      ? Number(
          (
            recentEfPts.reduce((s, p) => s + (p.efficiencyFactor ?? 0), 0) / recentEfPts.length
          ).toFixed(2)
        )
      : null;
  const efChangePct =
    efBaseline4Wk && efRecent4Wk && efBaseline4Wk > 0
      ? Number((((efRecent4Wk - efBaseline4Wk) / efBaseline4Wk) * 100).toFixed(1))
      : 0;

  const zSplit4Wk = computeZoneSplitFromWorkouts(
    athlete.workouts.filter((w) => w.weekIndex >= 9)
  );
  const zSplitBaseline = computeZoneSplitFromWorkouts(
    athlete.workouts.filter((w) => w.weekIndex <= 8)
  );

  // Sync & HR data integrity checks
  const lastSyncedDate = parseIsoDatePart(athlete.garminBiometrics.lastSyncedAt);
  const daysSinceGarminSync = Math.max(0, daysBetweenIso(lastSyncedDate, COMMAND_ANCHOR_DATE));
  const missingHrWorkouts = athlete.workouts.filter((w) => w.hrDataState === 'missing');
  const invalidHrWorkouts = athlete.workouts.filter((w) => w.hrDataState === 'invalid');

  const daysToRace = daysUntilDate(athlete.goal.raceDate, COMMAND_ANCHOR_DATE);

  // Build alerts with explicit supporting data & athlete-specific baseline comparisons
  const alerts: CommandCenterAlert[] = [];

  // 1. Training load alerts using CTL, ATL & TSB vs personal baseline
  const tsbDropBelowBaseline = tsb < baselineMinTsb - 2;
  if (tsb <= -14 || atlCtlRatio >= 1.24 || weeklyStressDeltaPct >= 22 || tsbDropBelowBaseline) {
    const isHigh =
      tsb <= -20 || atlCtlRatio >= 1.32 || weeklyStressDeltaPct >= 30 || tsbDropBelowBaseline;
    alerts.push({
      id: `${athlete.id}-cc-load-spike`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Load (CTL/ATL/TSB)',
      severity: isHigh ? 'high' : 'moderate',
      title:
        tsb <= -18
          ? `Acute fatigue elevated (TSB ${tsb.toFixed(1)})`
          : `Weekly HR-stress ramp +${weeklyStressDeltaPct.toFixed(0)}% above baseline`,
      explanation: `7-day ATL (${atl.toFixed(1)}) outpaced 42-day CTL (${ctl.toFixed(
        1
      )}), pushing TSB to ${tsb.toFixed(1)} compared with ${athlete.name}'s 8-week mean TSB of ${baselineMeanTsb.toFixed(
        1
      )}.`,
      supportingData: [
        `CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · TSB ${tsb.toFixed(1)} (ATL/CTL ${atlCtlRatio.toFixed(2)})`,
        `Personal 8-wk baseline: mean TSB ${baselineMeanTsb.toFixed(1)}, prior trough ${baselineMinTsb.toFixed(1)}`,
        `Week 11 hrRSS ${lastFullWeekHrStress.toFixed(0)} vs 4-wk baseline ${baselineWeeklyHrStress.toFixed(0)} (${weeklyStressDeltaPct >= 0 ? '+' : ''}${weeklyStressDeltaPct.toFixed(1)}%)`,
        `Garmin status: ${athlete.garminBiometrics.garminTrainingStatus} · 7d Load ${athlete.garminBiometrics.garmin7DayLoad}`,
      ],
      weight: isHigh ? 36 : 22,
    });
  } else if (ctl - baselineCtlMean <= -4.5 && fourWkCompliancePct < 82) {
    alerts.push({
      id: `${athlete.id}-cc-load-dip`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Load (CTL/ATL/TSB)',
      severity: 'moderate',
      title: `Chronic fitness CTL trending below personal baseline (-${(baselineCtlMean - ctl).toFixed(1)})`,
      explanation: `Reduced training continuity lowered 42-day CTL to ${ctl.toFixed(
        1
      )} versus ${athlete.name}'s 8-week baseline of ${baselineCtlMean.toFixed(1)}.`,
      supportingData: [
        `CTL ${ctl.toFixed(1)} vs 8-wk baseline ${baselineCtlMean.toFixed(1)} (14d delta ${ctlDelta14d >= 0 ? '+' : ''}${ctlDelta14d.toFixed(1)})`,
        `Week 11 hrRSS ${lastFullWeekHrStress.toFixed(0)} vs baseline ${baselineWeeklyHrStress.toFixed(0)} (${weeklyStressDeltaPct.toFixed(1)}%)`,
        `4-wk compliance ${fourWkCompliancePct}% vs earlier baseline ${baselineCompliancePct}%`,
      ],
      weight: 18,
    });
  }

  // 2. LTHR & Heart-Rate Zone drift
  if (easyPctLthrShift >= 2.8 || athlete.garminBiometrics.garminHrvStatus === 'Unbalanced') {
    const isHigh = easyPctLthrShift >= 4.5;
    alerts.push({
      id: `${athlete.id}-cc-lthr-drift`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'LTHR & HR Zones',
      severity: isHigh ? 'high' : 'moderate',
      title: `Easy-day %LTHR shifted +${easyPctLthrShift.toFixed(1)} pts above personal baseline`,
      explanation: `Aerobic runs in Weeks 11–12 averaged ${
        recentEasyPctLthr ?? '--'
      }% of LTHR (${athlete.lthrBpm} bpm) compared with ${
        baselineEasyPctLthr ?? '--'
      }% during Weeks 1–8 at comparable easy pacing.`,
      supportingData: [
        `Recent easy HR: ${recentEasyPctLthr ?? '--'}% LTHR vs early-block baseline ${baselineEasyPctLthr ?? '--'}%`,
        `4-wk Z1+Z2 share: ${zSplit4Wk.z12Pct}% (baseline ${zSplitBaseline.z12Pct}%) · Z3 grey zone ${zSplit4Wk.z3Pct}%`,
        `Garmin HRV status: ${athlete.garminBiometrics.garminHrvStatus} · Resting HR ${athlete.garminBiometrics.garminRestingHrBpm} bpm`,
      ],
      weight: isHigh ? 30 : 20,
    });
  } else if (zSplit4Wk.z3Pct >= 18 && athlete.currentPhase !== 'Taper') {
    alerts.push({
      id: `${athlete.id}-cc-zone-creep`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'LTHR & HR Zones',
      severity: 'low',
      title: `Elevated Z3 tempo share (${zSplit4Wk.z3Pct}% over last 4 wks)`,
      explanation: `Zone 3 minutes exceeded the athlete's early-block proportion (${zSplitBaseline.z3Pct}%), narrowing low-aerobic Z1/Z2 polarization.`,
      supportingData: [
        `4-wk zone mix: Z1+Z2 ${zSplit4Wk.z12Pct}% · Z3 ${zSplit4Wk.z3Pct}% · Z4+Z5 ${zSplit4Wk.z45Pct}%`,
        `Early-block baseline: Z1+Z2 ${zSplitBaseline.z12Pct}% · Z3 ${zSplitBaseline.z3Pct}%`,
      ],
      weight: 9,
    });
  }

  // 3. Planned vs. Completed Workout Compliance
  if (fourWkCompliancePct < 80 || missedSessions14d >= 2) {
    const isHigh = fourWkCompliancePct < 72 || missedSessions14d >= 3;
    alerts.push({
      id: `${athlete.id}-cc-compliance`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Compliance & Volume',
      severity: isHigh ? 'high' : 'moderate',
      title: `${missedSessions14d} missed runs in 14 days (${fourWkCompliancePct}% 4-wk compliance)`,
      explanation: `Execution dropped below ${athlete.name}'s prior 4-week compliance baseline of ${baselineCompliancePct}%, reducing actual volume to ${fourWkAvgMiles.toFixed(
        1
      )} mi/wk vs ${lastFullWeek.plannedMiles.toFixed(1)} mi planned last week.`,
      supportingData: [
        `Last 14d: ${completedSessions14d}/${plannedSessions14d} sessions completed · ${missedSessions14d} missed · ${modifiedSessions14d} modified`,
        `4-wk compliance ${fourWkCompliancePct}% vs baseline ${baselineCompliancePct}%`,
        `Week 11 volume: ${lastFullWeek.actualMiles.toFixed(1)} / ${lastFullWeek.plannedMiles.toFixed(1)} mi`,
      ],
      weight: isHigh ? 28 : 17,
    });
  }

  // 4. Taper & Race Prep Readiness
  if (daysToRace >= 0 && daysToRace <= 21 && tsb < -5 && athlete.currentPhase !== 'Taper') {
    alerts.push({
      id: `${athlete.id}-cc-taper`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Taper & Race Prep',
      severity: daysToRace <= 10 ? 'high' : 'moderate',
      title: `Goal race in ${daysToRace}d with negative TSB (${tsb.toFixed(1)})`,
      explanation: `${athlete.goal.raceName} is ${daysToRace} days away while acute load remains above chronic fitness (${athlete.currentPhase} phase).`,
      supportingData: [
        `Event: ${athlete.goal.raceName} (${athlete.goal.raceDate}, Target ${formatDuration(athlete.goal.targetTimeSeconds)})`,
        `Current CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · TSB ${tsb.toFixed(1)}`,
        `Phase: ${athlete.currentPhase} · Week 11 ${lastFullWeek.actualMiles.toFixed(1)} mi`,
      ],
      weight: daysToRace <= 10 ? 25 : 14,
    });
  }

  // 5. Missing or Outdated Data Watchlist
  const dataHygieneIssues: DataHygieneIssue[] = [];

  if (daysSinceGarminSync >= 3) {
    dataHygieneIssues.push({
      id: `${athlete.id}-hyg-sync`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      issueType: 'Outdated Garmin Sync',
      severity: daysSinceGarminSync >= 5 ? 'high' : 'moderate',
      summary: `Garmin telemetry is ${daysSinceGarminSync} days behind anchor (${lastSyncedDate}).`,
      supportingData: [
        `Last sync date: ${lastSyncedDate} (${daysSinceGarminSync}d stale vs ${COMMAND_ANCHOR_DATE})`,
        `Week 12 logged so far: ${currentWeek.actualMiles.toFixed(1)} mi (${currentWeek.workoutCountCompleted}/${currentWeek.workoutCountPlanned} sessions)`,
      ],
      lastSyncedDate,
      daysSinceSync: daysSinceGarminSync,
    });
    alerts.push({
      id: `${athlete.id}-cc-sync`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Data Hygiene & Sync',
      severity: daysSinceGarminSync >= 5 ? 'moderate' : 'low',
      title: `Watch sync ${daysSinceGarminSync}d outdated (${lastSyncedDate})`,
      explanation: `No fresh Garmin sync since ${lastSyncedDate}; recent ATL and current-week volume may under-represent completed workouts.`,
      supportingData: [
        `Last Garmin sync: ${lastSyncedDate} (${daysSinceGarminSync} days ago)`,
        `Current week-to-date logged: ${currentWeek.actualMiles.toFixed(1)} mi`,
      ],
      weight: daysSinceGarminSync >= 5 ? 16 : 8,
    });
  }

  if (invalidHrWorkouts.length > 0) {
    const sample = invalidHrWorkouts[0];
    dataHygieneIssues.push({
      id: `${athlete.id}-hyg-invalid-hr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      issueType: 'Invalid HR Telemetry',
      severity: 'moderate',
      summary: `${invalidHrWorkouts.length} completed run(s) excluded from hrRSS due to invalid HR sensor data.`,
      supportingData: [
        `${sample.date} (${sample.title}): avg ${sample.avgHrBpm ?? '--'} bpm · ${sample.hrValidationFlags[0] ?? 'Out-of-range HR'}`,
        `Excluded from HR-derived stress to protect CTL/ATL accuracy`,
      ],
      lastSyncedDate,
      daysSinceSync: daysSinceGarminSync,
    });
    alerts.push({
      id: `${athlete.id}-cc-invalid-hr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Data Hygiene & Sync',
      severity: 'low',
      title: `${invalidHrWorkouts.length} invalid HR reading(s) excluded from hrRSS`,
      explanation: `Sensor artifact (${sample.avgHrBpm ?? '--'} bpm on ${sample.date}) was quarantined from HR stress calculation.`,
      supportingData: [
        `${sample.date} ${sample.title}: ${sample.hrValidationFlags[0] ?? 'Invalid HR'}`,
        `Pace stress proxy preserved (${sample.stress.paceStressProxy ?? '--'})`,
      ],
      weight: 10,
    });
  }

  if (missingHrWorkouts.length > 0) {
    const sample = missingHrWorkouts[0];
    dataHygieneIssues.push({
      id: `${athlete.id}-hyg-missing-hr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      issueType: 'Missing HR Telemetry',
      severity: 'moderate',
      summary: `${missingHrWorkouts.length} completed run(s) recorded without heart-rate telemetry (not treated as zero stress).`,
      supportingData: [
        `${sample.date} (${sample.title}): ${sample.actualMiles.toFixed(1)} mi @ ${formatPace(sample.avgPaceSecPerMile)}/mi · HR null`,
        `Pace stress proxy recorded at ${sample.stress.paceStressProxy ?? '--'}; hrRSS set to null`,
      ],
      lastSyncedDate,
      daysSinceSync: daysSinceGarminSync,
    });
    alerts.push({
      id: `${athlete.id}-cc-missing-hr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      category: 'Data Hygiene & Sync',
      severity: 'low',
      title: `${missingHrWorkouts.length} run(s) missing HR telemetry`,
      explanation: `Completed run on ${sample.date} (${sample.actualMiles.toFixed(1)} mi) has no HR stream and is distinguished from zero-stress rest days.`,
      supportingData: [
        `${sample.date} ${sample.title}: avg HR missing (hrRSS = null)`,
        `42-day CTL unaffected by false zeros only if restored`,
      ],
      weight: 9,
    });
  }

  if (athlete.garminBiometrics.garminDetectedLthrBpm === null) {
    dataHygieneIssues.push({
      id: `${athlete.id}-hyg-no-garmin-lthr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      issueType: 'Missing Garmin LTHR',
      severity: 'low',
      summary: `No Garmin auto-detected LTHR on file; using Coach-Approved Manual Fallback (${athlete.lthrBpm} bpm).`,
      supportingData: [
        `Active threshold: ${athlete.lthrBpm} bpm (v${athlete.activeThresholdVersion}, ${activeRecord?.source ?? 'Manual Fallback'})`,
        `Recorded ${activeRecord?.recordedDate ?? '--'} (${lthrAgeDays}d ago)`,
      ],
      lastSyncedDate,
      daysSinceSync: daysSinceGarminSync,
    });
  }

  if (!activeRecord?.coachVerified || lthrAgeDays >= 60) {
    dataHygieneIssues.push({
      id: `${athlete.id}-hyg-lthr-review`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      issueType: 'Unverified / Aging LTHR',
      severity: !activeRecord?.coachVerified ? 'moderate' : 'low',
      summary: !activeRecord?.coachVerified
        ? `Active LTHR v${athlete.activeThresholdVersion} (${athlete.lthrBpm} bpm) is awaiting coach verification.`
        : `Active LTHR record is ${lthrAgeDays} days old (${activeRecord.recordedDate}).`,
      supportingData: [
        `LTHR ${athlete.lthrBpm} bpm · Source: ${activeRecord?.source ?? 'Unknown'}`,
        `Coach verified: ${activeRecord?.coachVerified ? 'Yes' : 'Pending'} · Recorded ${activeRecord?.recordedDate ?? '--'}`,
      ],
      lastSyncedDate,
      daysSinceSync: daysSinceGarminSync,
    });
    if (!activeRecord?.coachVerified) {
      alerts.push({
        id: `${athlete.id}-cc-lthr-unverified`,
        athleteId: athlete.id,
        athleteName: athlete.name,
        category: 'LTHR & HR Zones',
        severity: 'low',
        title: `LTHR v${athlete.activeThresholdVersion} (${athlete.lthrBpm} bpm) pending verification`,
        explanation: `Threshold update detected on ${activeRecord?.recordedDate ?? '--'} (${activeRecord?.source ?? ''}) requires coach confirmation.`,
        supportingData: [
          `Active LTHR: ${athlete.lthrBpm} bpm (v${athlete.activeThresholdVersion})`,
          `Source: ${activeRecord?.source ?? '--'} · ${activeRecord?.garminDeviceLabel ?? 'Manual entry'}`,
        ],
        weight: 7,
      });
    }
  }

  // Positive performance developments vs. athlete-specific historical baseline
  const positiveDevelopments: PositiveDevelopment[] = [];
  const hasHighSeverityFatigue = alerts.some(
    (a) => a.severity === 'high' && (a.category === 'Load (CTL/ATL/TSB)' || a.category === 'LTHR & HR Zones')
  );

  if (efChangePct >= 1.8 && !hasHighSeverityFatigue) {
    positiveDevelopments.push({
      id: `${athlete.id}-pos-ef`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      category: 'Aerobic Efficiency Gain',
      headline: `Aerobic efficiency improved +${efChangePct.toFixed(1)}% vs early-block baseline`,
      explanation: `Speed per heartbeat on valid easy/aerobic runs rose from ${efBaseline4Wk} (Weeks 1–4) to ${efRecent4Wk} (Weeks 9–12) while remaining anchored below LTHR.`,
      baselineComparison: `EF ${efRecent4Wk} vs personal Weeks 1–4 baseline ${efBaseline4Wk}`,
      supportingData: [
        `Efficiency Factor: ${efBaseline4Wk} → ${efRecent4Wk} (+${efChangePct.toFixed(1)}%)`,
        `Recent easy HR: ${recentEasyPctLthr ?? '--'}% LTHR (${easyPctLthrShift >= 0 ? '+' : ''}${easyPctLthrShift.toFixed(1)} pts vs baseline)`,
        `4-wk compliance ${fourWkCompliancePct}% · VO2max ${athlete.garminBiometrics.garminVo2Max}`,
      ],
      score: Math.round(efChangePct * 10 + fourWkCompliancePct * 0.2),
    });
  }

  if (
    daysToRace >= 0 &&
    daysToRace <= 28 &&
    tsb >= 1.0 &&
    fourWkCompliancePct >= 88 &&
    !hasHighSeverityFatigue
  ) {
    positiveDevelopments.push({
      id: `${athlete.id}-pos-taper`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      category: 'Peaking / Taper Execution',
      headline: `On-track race taper: TSB +${tsb.toFixed(1)} with ${daysToRace}d to ${athlete.goal.raceName}`,
      explanation: `Controlled volume reduction lifted TSB to +${tsb.toFixed(1)} (vs personal baseline mean ${baselineMeanTsb.toFixed(
        1
      )}) while preserving chronic fitness CTL ${ctl.toFixed(1)}.`,
      baselineComparison: `TSB +${tsb.toFixed(1)} vs 8-wk mean ${baselineMeanTsb.toFixed(1)} · CTL ${ctl.toFixed(1)}`,
      supportingData: [
        `CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · TSB +${tsb.toFixed(1)}`,
        `Garmin status: ${athlete.garminBiometrics.garminTrainingStatus} · HRV ${athlete.garminBiometrics.garminHrvStatus}`,
        `${daysToRace}d to ${athlete.goal.raceName} (Target ${formatDuration(athlete.goal.targetTimeSeconds)})`,
      ],
      score: 42 + Math.round(tsb * 2),
    });
  }

  if (
    ctl >= baselineCtlMean + 2.5 &&
    tsb >= -12 &&
    tsb <= 8 &&
    fourWkCompliancePct >= 90 &&
    !hasHighSeverityFatigue
  ) {
    positiveDevelopments.push({
      id: `${athlete.id}-pos-ctl`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      category: 'Sustainable CTL Growth',
      headline: `Chronic load +${(ctl - baselineCtlMean).toFixed(1)} above baseline with balanced TSB (${tsb >= 0 ? '+' : ''}${tsb.toFixed(1)})`,
      explanation: `Consistent execution (${fourWkCompliancePct}% 4-wk compliance) built 42-day CTL to ${ctl.toFixed(
        1
      )} without pushing acute fatigue into overload.`,
      baselineComparison: `CTL ${ctl.toFixed(1)} vs 8-wk mean ${baselineCtlMean.toFixed(1)}`,
      supportingData: [
        `CTL ${ctl.toFixed(1)} (+${(ctl - baselineCtlMean).toFixed(1)} vs baseline) · ATL ${atl.toFixed(1)} · TSB ${tsb.toFixed(1)}`,
        `4-wk volume ${fourWkAvgMiles.toFixed(1)} mi/wk vs prior block ${baseline4WkAvgMiles.toFixed(1)} mi/wk`,
        `4-wk compliance ${fourWkCompliancePct}% · Z1+Z2 ${zSplit4Wk.z12Pct}%`,
      ],
      score: Math.round((ctl - baselineCtlMean) * 6 + fourWkCompliancePct * 0.2),
    });
  }

  const firstLthr = athlete.lthrHistory[0];
  const lthrGainBpm = firstLthr ? athlete.lthrBpm - firstLthr.lthrBpm : 0;
  const recentPrRace = athlete.raceHistory.find((r) => r.isPR && r.date >= '2026-09-01');
  if ((recentPrRace || lthrGainBpm >= 2) && !hasHighSeverityFatigue) {
    positiveDevelopments.push({
      id: `${athlete.id}-pos-pr`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      trainingGroup: athlete.trainingGroup,
      category: 'Tune-Up PR & LTHR Progression',
      headline: recentPrRace
        ? `Autumn tune-up PR (${recentPrRace.raceName}) & +${lthrGainBpm} bpm LTHR shift`
        : `Garmin-detected LTHR progressed +${lthrGainBpm} bpm since v1`,
      explanation: `Threshold capacity rose from ${firstLthr?.lthrBpm ?? athlete.lthrBpm} bpm (v1) to ${
        athlete.lthrBpm
      } bpm (v${athlete.activeThresholdVersion}), corroborated by recent race execution.`,
      baselineComparison: `LTHR ${firstLthr?.lthrBpm ?? athlete.lthrBpm} → ${athlete.lthrBpm} bpm`,
      supportingData: [
        `LTHR v${athlete.activeThresholdVersion}: ${athlete.lthrBpm} bpm (${activeRecord?.source ?? 'Garmin Auto-Detected'})`,
        recentPrRace
          ? `${recentPrRace.raceName}: ${formatDuration(recentPrRace.finishTimeSeconds)} (${formatPace(recentPrRace.avgPaceSecPerMile)}/mi)`
          : `Garmin VO2max estimate: ${athlete.garminBiometrics.garminVo2Max}`,
        `4-wk compliance ${fourWkCompliancePct}% · CTL ${ctl.toFixed(1)}`,
      ],
      score: 26 + lthrGainBpm * 3,
    });
  }

  alerts.sort((a, b) => b.weight - a.weight);
  const attentionScore = alerts.reduce((s, a) => s + a.weight, 0);
  const hasHigh = alerts.some((a) => a.severity === 'high');
  const priorityTier: AthleteCommandSummary['priorityTier'] =
    hasHigh || attentionScore >= 32
      ? 'Immediate Review'
      : alerts.length > 0 || attentionScore >= 12
      ? 'Watch List'
      : 'On Track';

  return {
    athlete,
    attentionScore,
    priorityTier,
    alerts,
    loadAlerts: alerts.filter((a) => a.category === 'Load (CTL/ATL/TSB)'),
    positiveDevelopments,
    dataHygieneIssues,
    ctl,
    atl,
    tsb,
    atlCtlRatio,
    tsbFormLabel: form.label,
    tsbFormTone: form.tone,
    ctlDelta14d,
    baselineCtlMean,
    baselineMeanTsb,
    baselineMinTsb,
    lastFullWeekHrStress,
    baselineWeeklyHrStress,
    weeklyStressDeltaPct,
    lastFullWeekActualMiles: lastFullWeek.actualMiles,
    lastFullWeekPlannedMiles: lastFullWeek.plannedMiles,
    lastFullWeekCompliancePct: lastFullWeek.compliancePct,
    fourWkAvgMiles,
    baseline4WkAvgMiles,
    fourWkCompliancePct,
    baselineCompliancePct,
    currentWeekActualMiles: currentWeek.actualMiles,
    missedSessions14d,
    modifiedSessions14d,
    completedSessions14d,
    plannedSessions14d,
    lthrBpm: athlete.lthrBpm,
    lthrVersion: athlete.activeThresholdVersion,
    lthrSource: activeRecord?.source ?? 'Garmin Auto-Detected',
    lthrVerified: activeRecord?.coachVerified ?? true,
    lthrAgeDays,
    recentEasyPctLthr,
    baselineEasyPctLthr,
    easyPctLthrShift,
    efRecent4Wk,
    efBaseline4Wk,
    efChangePct,
    z12Pct4Wk: zSplit4Wk.z12Pct,
    z12PctBaseline: zSplitBaseline.z12Pct,
    z3Pct4Wk: zSplit4Wk.z3Pct,
    z45Pct4Wk: zSplit4Wk.z45Pct,
    zoneDistribution4Wk,
    lastSyncedDate,
    daysSinceGarminSync,
    missingHrCount: missingHrWorkouts.length,
    invalidHrCount: invalidHrWorkouts.length,
    daysToRace,
    weeklyVolume,
    dailyLoad: daily,
    weeklyLoad,
  };
}

export function buildRosterCommandCenterSnapshot(
  athletes: Athlete[]
): RosterCommandCenterSnapshot {
  const summaries = athletes.map(evaluateAthleteForCommandCenter);

  const rankedAthletes = [...summaries].sort(
    (a, b) =>
      b.attentionScore - a.attentionScore ||
      Math.abs(b.tsb) - Math.abs(a.tsb) ||
      a.athlete.name.localeCompare(b.athlete.name)
  );

  const severityRank = { high: 3, moderate: 2, low: 1 };
  const allAlerts = rankedAthletes
    .flatMap((s) => s.alerts)
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.weight - a.weight);

  const loadAlerts = allAlerts.filter((a) => a.category === 'Load (CTL/ATL/TSB)');

  const positiveDevelopments = summaries
    .flatMap((s) => s.positiveDevelopments)
    .sort((a, b) => b.score - a.score);

  const dataHygieneIssues = summaries
    .flatMap((s) => s.dataHygieneIssues)
    .sort(
      (a, b) =>
        severityRank[b.severity] - severityRank[a.severity] ||
        b.daysSinceSync - a.daysSinceSync
    );

  const upcomingRaces = summaries
    .filter((s) => s.daysToRace >= 0)
    .sort((a, b) => a.daysToRace - b.daysToRace)
    .map((s) => {
      const taperStatus: 'Fresh / Peaking' | 'Building Into Race' | 'Elevated Fatigue' =
        s.tsb >= 1
          ? 'Fresh / Peaking'
          : s.daysToRace <= 21 && s.tsb < -5
          ? 'Elevated Fatigue'
          : 'Building Into Race';
      return {
        summary: s,
        daysLeft: s.daysToRace,
        taperStatus,
      };
    });

  const weeklyMileageTrend = Array.from({ length: 12 }, (_, idx) => {
    let actualMiles = 0;
    let plannedMiles = 0;
    let complianceSum = 0;
    let totalHrStress = 0;
    let ctlSum = 0;
    let tsbSum = 0;
    let label = `Wk ${idx + 1}`;

    for (const s of summaries) {
      const vol = s.weeklyVolume[idx];
      const ld = s.weeklyLoad[idx];
      if (vol) {
        label = vol.weekLabel;
        actualMiles += vol.actualMiles;
        plannedMiles += vol.plannedMiles;
        complianceSum += vol.compliancePct;
      }
      if (ld) {
        totalHrStress += ld.weeklyHrStress;
        ctlSum += ld.ctlEnd;
        tsbSum += ld.tsbEnd;
      }
    }

    const n = Math.max(1, summaries.length);
    return {
      weekLabel: label,
      weekIndex: idx + 1,
      actualMiles: Math.round(actualMiles),
      plannedMiles: Math.round(plannedMiles),
      avgCompliancePct: Math.round(complianceSum / n),
      totalHrStress: Math.round(totalHrStress),
      meanCtl: Number((ctlSum / n).toFixed(1)),
      meanTsb: Number((tsbSum / n).toFixed(1)),
    };
  });

  const n = Math.max(1, summaries.length);
  const rosterMeans = {
    meanCtl: Number((summaries.reduce((s, a) => s + a.ctl, 0) / n).toFixed(1)),
    meanAtl: Number((summaries.reduce((s, a) => s + a.atl, 0) / n).toFixed(1)),
    meanTsb: Number((summaries.reduce((s, a) => s + a.tsb, 0) / n).toFixed(1)),
    highFatigueCount: summaries.filter((a) => a.tsb < -15 || a.atlCtlRatio >= 1.25).length,
    freshCount: summaries.filter((a) => a.tsb >= 2).length,
    lastFullWeekActualMiles: Math.round(
      summaries.reduce((s, a) => s + a.lastFullWeekActualMiles, 0)
    ),
    lastFullWeekPlannedMiles: Math.round(
      summaries.reduce((s, a) => s + a.lastFullWeekPlannedMiles, 0)
    ),
    currentWeekActualMiles: Math.round(
      summaries.reduce((s, a) => s + a.currentWeekActualMiles, 0)
    ),
    avgCompliancePct: Math.round(
      summaries.reduce((s, a) => s + a.fourWkCompliancePct, 0) / n
    ),
    z12MeanPct: Number((summaries.reduce((s, a) => s + a.z12Pct4Wk, 0) / n).toFixed(1)),
    z3MeanPct: Number((summaries.reduce((s, a) => s + a.z3Pct4Wk, 0) / n).toFixed(1)),
    z45MeanPct: Number((summaries.reduce((s, a) => s + a.z45Pct4Wk, 0) / n).toFixed(1)),
    garminAutoLthrCount: summaries.filter((a) => a.lthrSource === 'Garmin Auto-Detected')
      .length,
    manualFallbackLthrCount: summaries.filter(
      (a) => a.lthrSource === 'Coach-Approved Manual Fallback'
    ).length,
    unverifiedLthrCount: summaries.filter((a) => !a.lthrVerified).length,
    immediateReviewCount: summaries.filter((a) => a.priorityTier === 'Immediate Review')
      .length,
    watchListCount: summaries.filter((a) => a.priorityTier === 'Watch List').length,
  };

  return {
    rosterCount: summaries.length,
    rankedAthletes,
    allAlerts,
    loadAlerts,
    positiveDevelopments,
    dataHygieneIssues,
    upcomingRaces,
    weeklyMileageTrend,
    rosterMeans,
  };
}

export function buildWeeklyCommandBriefingText(
  snapshot: RosterCommandCenterSnapshot,
  reports: WeeklyAthleteReport[]
): string {
  const approvedCount = reports.filter((r) => r.status === 'Approved').length;
  const topPriority = snapshot.rankedAthletes
    .filter((a) => a.priorityTier === 'Immediate Review')
    .slice(0, 5);
  const topPositive = snapshot.positiveDevelopments.slice(0, 5);
  const nextRaces = snapshot.upcomingRaces.filter((r) => r.daysLeft <= 21);

  const lines: string[] = [
    `RUNNING COACH AI — WEEKLY COACH BRIEFING (Nov 9–15, 2026 · Anchor Nov 18)`,
    `Roster Scope: ${snapshot.rosterCount} active athletes · Mean CTL ${snapshot.rosterMeans.meanCtl} / ATL ${snapshot.rosterMeans.meanAtl} / TSB ${snapshot.rosterMeans.meanTsb}`,
    `Weekly Volume & Compliance: ${snapshot.rosterMeans.lastFullWeekActualMiles} / ${snapshot.rosterMeans.lastFullWeekPlannedMiles} mi (${snapshot.rosterMeans.avgCompliancePct}% 4-wk adherence)`,
    `LTHR Coverage: ${snapshot.rosterMeans.garminAutoLthrCount} Garmin Auto-Detected · ${snapshot.rosterMeans.manualFallbackLthrCount} Coach-Approved Manual Fallback · ${snapshot.rosterMeans.unverifiedLthrCount} Pending Verification`,
    ``,
    `1. PRIORITY ATTENTION RANKINGS (${snapshot.rosterMeans.immediateReviewCount} Immediate Review):`,
    ...topPriority.map((s) => {
      const lead = s.alerts[0];
      return `   - ${s.athlete.name} (Score ${s.attentionScore}): ${lead?.title ?? 'Monitor'} — ${lead?.supportingData[0] ?? ''}`;
    }),
    ``,
    `2. POSITIVE PERFORMANCE DEVELOPMENTS:`,
    ...topPositive.map(
      (p) => `   - ${p.athleteName} (${p.category}): ${p.headline} [${p.baselineComparison}]`
    ),
    ``,
    `3. UPCOMING RACES (NEXT 21 DAYS):`,
    ...(nextRaces.length > 0
      ? nextRaces.map(
          (r) =>
            `   - ${r.summary.athlete.name}: ${r.summary.athlete.goal.raceName} in ${r.daysLeft}d · CTL ${r.summary.ctl.toFixed(1)} / TSB ${r.summary.tsb.toFixed(1)} (${r.taperStatus})`
        )
      : ['   - No athletes racing within 21 days in current filter.']),
    ``,
    `4. MISSING / OUTDATED DATA AUDIT (${snapshot.dataHygieneIssues.length} items):`,
    ...snapshot.dataHygieneIssues
      .slice(0, 6)
      .map((d) => `   - ${d.athleteName} (${d.issueType}): ${d.summary}`),
    ``,
    `5. EMAIL APPROVAL GATE:`,
    `   ${approvedCount} of ${reports.length} individual athlete reports approved by coach. Automated athlete email dispatch is strictly disabled pending coach approval.`,
  ];

  return lines.join('\n');
}
