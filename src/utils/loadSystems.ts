import {
  Athlete,
  DailyMethodologyLoadPoint,
  IndependentStressRecord,
  MethodologyLoadSeries,
  NormalizedCompletedActivity,
  ProviderTrainingMetricsRecord,
  StressMethodologyId,
} from '../types/coaching';
import { ATL_ALPHA, CTL_ALPHA, resolveThresholdForDate } from './lthrAnalytics';

/**
 * SYSTEM A: Intervals.icu Native Provider Metrics
 * Preserves original provider training load, fitness, fatigue, and form values untouched.
 * Never overwrites provider values with local stress calculations.
 */
export function extractSystemAProviderMetrics(athlete: Athlete): ProviderTrainingMetricsRecord[] {
  const results: ProviderTrainingMetricsRecord[] = [];
  let icuFitness = 42;
  let icuFatigue = 42;

  const sorted = [...athlete.workouts].sort((a, b) => a.date.localeCompare(b.date));
  for (const w of sorted) {
    const nativeLoad = w.garminMetrics?.garminTrainingLoad ?? null;
    if (nativeLoad !== null) {
      icuFitness = Number((icuFitness + (nativeLoad - icuFitness) * CTL_ALPHA).toFixed(1));
      icuFatigue = Number((icuFatigue + (nativeLoad - icuFatigue) * ATL_ALPHA).toFixed(1));
    }

    if (w.type !== 'Rest' && w.status === 'Completed') {
      results.push({
        activityId: `norm-${w.id}`,
        athleteId: athlete.id,
        date: w.date,
        provider: 'intervals_icu',
        icuTrainingLoad: nativeLoad,
        icuFitness: nativeLoad !== null ? icuFitness : null,
        icuFatigue: nativeLoad !== null ? icuFatigue : null,
        icuForm:
          nativeLoad !== null ? Number((icuFitness - icuFatigue).toFixed(1)) : null,
        originalValuesPreserved: true,
      });
    }
  }
  return results;
}

/**
 * SYSTEM B: Independent Running Stress Analytics
 * Computes pace-based, HR-derived, running-power-based, and Session RPE stress
 * strictly isolated by calculation method.
 */
export function computeIndependentStressForActivity(params: {
  activity: NormalizedCompletedActivity;
  lthrBpm: number;
  thresholdPaceSecPerMile: number;
  thresholdPowerWatts: number | null;
}): IndependentStressRecord {
  const { activity, lthrBpm, thresholdPaceSecPerMile, thresholdPowerWatts } = params;
  const durMin = activity.durationMinutes;

  // B1: HR-Derived Running Stress (hrRSS) — explicitly distinct from official TrainingPeaks TSS
  let hrRunningStress: number | null = null;
  if (
    activity.hrDataState === 'valid' &&
    activity.avgHrBpm !== null &&
    durMin > 0 &&
    lthrBpm > 0
  ) {
    const hrIf = activity.avgHrBpm / lthrBpm;
    hrRunningStress = Number(((durMin / 60) * Math.pow(hrIf, 2) * 100).toFixed(1));
  } else if (activity.hrDataState === 'rest_zero') {
    hrRunningStress = 0;
  }

  // B2: Pace-Based Running TSS (Threshold-pace anchored)
  let paceRunningStress: number | null = null;
  if (
    durMin > 0 &&
    activity.avgPaceSecPerMile &&
    activity.avgPaceSecPerMile > 0 &&
    thresholdPaceSecPerMile > 0
  ) {
    const paceIf = thresholdPaceSecPerMile / activity.avgPaceSecPerMile;
    paceRunningStress = Number(((durMin / 60) * Math.pow(paceIf, 2) * 100).toFixed(1));
  }

  // B3: Running-Power-Based Stress (when power stream/average & threshold power exist)
  let powerRunningStress: number | null = null;
  if (
    durMin > 0 &&
    activity.avgPowerWatts &&
    activity.avgPowerWatts > 0 &&
    thresholdPowerWatts &&
    thresholdPowerWatts > 0
  ) {
    const powerIf = activity.avgPowerWatts / thresholdPowerWatts;
    powerRunningStress = Number(((durMin / 60) * Math.pow(powerIf, 2) * 100).toFixed(1));
  }

  // B4: Session RPE-Based Stress (Foster duration-by-RPE normalized to 100 at 60m RPE 7.5)
  let sessionRpeStress: number | null = null;
  if (durMin > 0 && activity.rpe !== null && activity.rpe >= 1 && activity.rpe <= 10) {
    const rpeRatio = activity.rpe / 7.5;
    sessionRpeStress = Number(((durMin / 60) * Math.pow(rpeRatio, 2) * 100).toFixed(1));
  }

  return {
    activityId: activity.id,
    athleteId: activity.athleteId,
    date: activity.date,
    hrRunningStress,
    paceRunningStress,
    powerRunningStress,
    sessionRpeStress,
    rpeMethodLabel: 'Session RPE (Duration × RPE)',
  };
}

/**
 * SYSTEM C: TrainingPeaks-Style EWMA Load Histories (CTL 42d, ATL 7d, TSB = CTL - ATL)
 * Maintains completely independent load histories per methodology. Never mixes scores.
 */
export function computeSystemCLoadSeries(params: {
  stressRecords: IndependentStressRecord[];
  methodology: StressMethodologyId;
  startDateIso?: string;
  endDateIso?: string;
  ctlDays?: number;
  atlDays?: number;
  initialCtl?: number;
  initialAtl?: number;
}): MethodologyLoadSeries {
  const {
    stressRecords,
    methodology,
    startDateIso = '2026-08-31',
    endDateIso = '2026-11-18',
    ctlDays = 42,
    atlDays = 7,
    initialCtl = 38,
    initialAtl = 38,
  } = params;

  const ctlAlpha = 1 - Math.exp(-1 / ctlDays);
  const atlAlpha = 1 - Math.exp(-1 / atlDays);

  const byDate = new Map<string, number>();
  for (const rec of stressRecords) {
    const val =
      methodology === 'hr_derived_stress'
        ? rec.hrRunningStress
        : methodology === 'running_tss_pace'
        ? rec.paceRunningStress
        : methodology === 'running_power_stress'
        ? rec.powerRunningStress
        : rec.sessionRpeStress;

    if (val !== null) {
      byDate.set(rec.date, (byDate.get(rec.date) ?? 0) + val);
    }
  }

  const daily: DailyMethodologyLoadPoint[] = [];
  let ctl = initialCtl;
  let atl = initialAtl;

  const start = new Date(startDateIso + 'T00:00:00Z');
  const end = new Date(endDateIso + 'T00:00:00Z');

  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const dateIso = d.toISOString().slice(0, 10);
    const dayVal = Number((byDate.get(dateIso) ?? 0).toFixed(1));
    ctl = ctl + (dayVal - ctl) * ctlAlpha;
    atl = atl + (dayVal - atl) * atlAlpha;
    const tsb = ctl - atl;

    daily.push({
      date: dateIso,
      dailyStress: dayVal,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number(tsb.toFixed(1)),
    });
  }

  const latest = daily[daily.length - 1];
  const LABELS: Record<StressMethodologyId, string> = {
    hr_derived_stress: 'HR-Derived Running Stress (hrRSS · Distinct from TP TSS)',
    running_tss_pace: 'Pace-Based Running TSS (rTSS Proxy)',
    running_power_stress: 'Running Power Stress (Watts)',
    session_rpe_stress: 'Session RPE Load (Duration × RPE)',
  };

  return {
    methodology,
    label: LABELS[methodology],
    ctlTimeConstantDays: ctlDays,
    atlTimeConstantDays: atlDays,
    daily,
    latestCtl: latest?.ctl ?? 0,
    latestAtl: latest?.atl ?? 0,
    latestTsb: latest?.tsb ?? 0,
  };
}

export const RUNNING_STRESS_METHODOLOGY_DOCS = {
  hrDerivedStress: {
    name: 'Heart-Rate-Derived Running Stress (hrRSS)',
    formula: '(Duration_min / 60) × (Avg_HR / Athlete_LTHR)^2 × 100',
    requirements: 'Completed workout duration, valid average HR, and athlete individualized LTHR (no HR stream or power meter required).',
    notes: 'Distinct from official TrainingPeaks TSS; missing or invalid HR readings return null rather than zero.',
  },
  paceDerivedStress: {
    name: 'Pace-Based Running TSS (rTSS Proxy)',
    formula: '(Duration_min / 60) × (Threshold_Pace_sec_mi / Avg_Pace_sec_mi)^2 × 100',
    requirements: 'Completed workout duration, running pace, and valid athlete threshold pace.',
    notes: 'Computed independently from hrRSS; returns null if threshold pace is unavailable.',
  },
  ewmaLoadModel: {
    name: 'TrainingPeaks-Style EWMA Load Histories',
    formula: 'CTL_t = CTL_{t-1} + (TSS_t - CTL_{t-1}) × (1 - e^{-1/42}); ATL_t = ATL_{t-1} + (TSS_t - ATL_{t-1}) × (1 - e^{-1/7}); TSB = CTL - ATL',
    requirements: 'Independent daily series maintained per stress methodology without mixing scores.',
    notes: 'Running power is strictly optional and never required.',
  },
} as const;

export function computeAllThreeLoadSystemsForAthlete(
  athlete: Athlete,
  normalizedActivities: NormalizedCompletedActivity[]
): {
  systemAProviderMetrics: ProviderTrainingMetricsRecord[];
  systemBStressRecords: IndependentStressRecord[];
  systemCSeriesByMethodology: Record<StressMethodologyId, MethodologyLoadSeries>;
} {
  const systemAProviderMetrics = extractSystemAProviderMetrics(athlete);

  const systemBStressRecords = normalizedActivities.map((act) => {
    const thr = resolveThresholdForDate(athlete.lthrHistory, act.date);
    return computeIndependentStressForActivity({
      activity: act,
      lthrBpm: thr.lthrBpm,
      thresholdPaceSecPerMile:
        thr.optionalThresholdPaceSecPerMile ?? athlete.thresholdPaceSecPerMile,
      thresholdPowerWatts:
        thr.optionalThresholdPowerWatts ?? athlete.optionalThresholdPowerWatts,
    });
  });

  const methodologies: StressMethodologyId[] = [
    'hr_derived_stress',
    'running_tss_pace',
    'running_power_stress',
    'session_rpe_stress',
  ];

  const systemCSeriesByMethodology = {} as Record<StressMethodologyId, MethodologyLoadSeries>;
  for (const m of methodologies) {
    systemCSeriesByMethodology[m] = computeSystemCLoadSeries({
      stressRecords: systemBStressRecords,
      methodology: m,
    });
  }

  return {
    systemAProviderMetrics,
    systemBStressRecords,
    systemCSeriesByMethodology,
  };
}
