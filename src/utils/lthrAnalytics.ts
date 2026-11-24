import {
  Athlete,
  DailyLoadPoint,
  HrDataState,
  HrZoneBoundary,
  HrZoneConfig,
  HrZoneMethodologyId,
  IntensityZone,
  LthrRecord,
  LthrSourceType,
  StressSnapshotRecord,
  WeeklyLoadPoint,
  Workout,
  WorkoutStatus,
  WorkoutStressMetrics,
  WorkoutType,
  ZonePctBound,
} from '../types/coaching';

export const CTL_TIME_CONSTANT_DAYS = 42;
export const ATL_TIME_CONSTANT_DAYS = 7;

export const CTL_ALPHA = 1 - Math.exp(-1 / CTL_TIME_CONSTANT_DAYS);
export const ATL_ALPHA = 1 - Math.exp(-1 / ATL_TIME_CONSTANT_DAYS);

export const HR_ZONE_METHODOLOGIES: Record<
  HrZoneMethodologyId,
  {
    label: string;
    description: string;
    boundaries: ZonePctBound[];
  }
> = {
  friel_running: {
    label: 'Joe Friel 5-Zone Running (LTHR)',
    description: 'Standard 5-zone LTHR boundaries (Z1 <85%, Z2 85–89%, Z3 90–94%, Z4 95–99%, Z5 ≥100%).',
    boundaries: [
      { zone: 'Z1', name: 'Z1 Recovery', minPctLthr: 50, maxPctLthr: 84, color: '#94A3B8' },
      { zone: 'Z2', name: 'Z2 Aerobic', minPctLthr: 85, maxPctLthr: 89, color: '#0EA5E9' },
      { zone: 'Z3', name: 'Z3 Tempo', minPctLthr: 90, maxPctLthr: 94, color: '#F59E0B' },
      { zone: 'Z4', name: 'Z4 Sub-Threshold / Threshold', minPctLthr: 95, maxPctLthr: 99, color: '#F97316' },
      { zone: 'Z5', name: 'Z5 Supra-Threshold / VO2', minPctLthr: 100, maxPctLthr: 115, color: '#EF4444' },
    ],
  },
  coggan_endurance: {
    label: 'Endurance 5-Zone Threshold Model',
    description: 'Broader aerobic Z2 floor and classic 95–103% threshold band.',
    boundaries: [
      { zone: 'Z1', name: 'Z1 Active Recovery', minPctLthr: 50, maxPctLthr: 68, color: '#94A3B8' },
      { zone: 'Z2', name: 'Z2 Endurance', minPctLthr: 69, maxPctLthr: 83, color: '#0EA5E9' },
      { zone: 'Z3', name: 'Z3 Tempo', minPctLthr: 84, maxPctLthr: 94, color: '#F59E0B' },
      { zone: 'Z4', name: 'Z4 Lactate Threshold', minPctLthr: 95, maxPctLthr: 103, color: '#F97316' },
      { zone: 'Z5', name: 'Z5 VO2 Max', minPctLthr: 104, maxPctLthr: 118, color: '#EF4444' },
    ],
  },
  polarized_seiler: {
    label: 'Polarized 5-Zone (Low-Aerobic Ceiling)',
    description: 'Conservative Z1/Z2 cap at 82% LTHR to prevent grey-zone drift on easy days.',
    boundaries: [
      { zone: 'Z1', name: 'Z1 Very Easy', minPctLthr: 50, maxPctLthr: 72, color: '#94A3B8' },
      { zone: 'Z2', name: 'Z2 Low Aerobic', minPctLthr: 73, maxPctLthr: 82, color: '#0EA5E9' },
      { zone: 'Z3', name: 'Z3 Grey / Marathon', minPctLthr: 83, maxPctLthr: 93, color: '#F59E0B' },
      { zone: 'Z4', name: 'Z4 Threshold', minPctLthr: 94, maxPctLthr: 101, color: '#F97316' },
      { zone: 'Z5', name: 'Z5 High Intensity', minPctLthr: 102, maxPctLthr: 116, color: '#EF4444' },
    ],
  },
  custom: {
    label: 'Custom Coach Boundaries',
    description: 'Coach-defined % of LTHR percentages tailored to individual physiology.',
    boundaries: [
      { zone: 'Z1', name: 'Z1 Recovery', minPctLthr: 50, maxPctLthr: 84, color: '#94A3B8' },
      { zone: 'Z2', name: 'Z2 Aerobic', minPctLthr: 85, maxPctLthr: 89, color: '#0EA5E9' },
      { zone: 'Z3', name: 'Z3 Tempo', minPctLthr: 90, maxPctLthr: 94, color: '#F59E0B' },
      { zone: 'Z4', name: 'Z4 Threshold', minPctLthr: 95, maxPctLthr: 99, color: '#F97316' },
      { zone: 'Z5', name: 'Z5 VO2 / Speed', minPctLthr: 100, maxPctLthr: 115, color: '#EF4444' },
    ],
  },
};

export function validateZoneBoundaries(boundaries: ZonePctBound[]): {
  valid: boolean;
  error?: string;
} {
  if (boundaries.length !== 5) {
    return { valid: false, error: 'Exactly 5 heart-rate zones (Z1–Z5) are required.' };
  }
  const expectedOrder: IntensityZone[] = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (b.zone !== expectedOrder[i]) {
      return { valid: false, error: `Zones must be ordered Z1 through Z5.` };
    }
    if (b.minPctLthr >= b.maxPctLthr) {
      return {
        valid: false,
        error: `${b.zone} min (${b.minPctLthr}%) must be strictly less than max (${b.maxPctLthr}%).`,
      };
    }
    if (i > 0 && b.minPctLthr <= boundaries[i - 1].maxPctLthr - 1) {
      return {
        valid: false,
        error: `${b.zone} minimum (${b.minPctLthr}%) overlaps ${boundaries[i - 1].zone} maximum (${boundaries[i - 1].maxPctLthr}%).`,
      };
    }
  }
  return { valid: true };
}

export function computeLthrZones(
  lthrBpm: number,
  config: HrZoneConfig,
  athleteMaxHrBpm?: number
): HrZoneBoundary[] {
  const baseBounds =
    config.methodology === 'custom' && config.customBoundaries?.length === 5
      ? config.customBoundaries
      : HR_ZONE_METHODOLOGIES[config.methodology].boundaries;

  const boundaries: HrZoneBoundary[] = [];
  for (let i = 0; i < baseBounds.length; i++) {
    const b = baseBounds[i];
    const computedMin = Math.round((lthrBpm * b.minPctLthr) / 100);
    const prevMax = i > 0 ? boundaries[i - 1].maxBpm : 0;
    const minBpm = i > 0 ? Math.max(computedMin, prevMax + 1) : computedMin;
    let maxBpm = Math.round((lthrBpm * b.maxPctLthr) / 100);
    if (i === baseBounds.length - 1 && athleteMaxHrBpm && athleteMaxHrBpm > minBpm) {
      maxBpm = Math.max(maxBpm, athleteMaxHrBpm);
    }
    if (maxBpm <= minBpm) {
      maxBpm = minBpm + 1;
    }
    boundaries.push({
      ...b,
      minBpm,
      maxBpm,
    });
  }
  return boundaries;
}

export function classifyHrIntoZone(
  hrBpm: number | null,
  zones: HrZoneBoundary[]
): IntensityZone | null {
  if (hrBpm === null || !Number.isFinite(hrBpm) || hrBpm <= 0) return null;
  for (let i = 0; i < zones.length; i++) {
    if (hrBpm <= zones[i].maxBpm || i === zones.length - 1) {
      return zones[i].zone;
    }
  }
  return 'Z5';
}

export function validateHeartRateReading(params: {
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  athleteMaxHrBpm: number;
  workoutType: WorkoutType;
  status: WorkoutStatus;
  durationMinutes: number;
}): { hrDataState: HrDataState; flags: string[] } {
  const { avgHrBpm, maxHrBpm, athleteMaxHrBpm, workoutType, status, durationMinutes } = params;

  if (workoutType === 'Rest' || status === 'Planned') {
    return { hrDataState: 'rest_zero', flags: [] };
  }

  if (avgHrBpm === null || avgHrBpm === undefined) {
    return {
      hrDataState: 'missing',
      flags: ['Heart-rate telemetry missing for completed run (not counted as zero stress).'],
    };
  }

  const flags: string[] = [];
  if (!Number.isFinite(avgHrBpm) || avgHrBpm <= 0) {
    flags.push(`Invalid HR value (${avgHrBpm} bpm) — sensor dropout.`);
  } else if (avgHrBpm < 45) {
    flags.push(`Implausibly low running HR (${avgHrBpm} bpm < 45 bpm).`);
  } else if (avgHrBpm > 225 || (athleteMaxHrBpm > 0 && avgHrBpm > athleteMaxHrBpm + 12)) {
    flags.push(
      `Invalid HR reading (${avgHrBpm} bpm exceeds physiological ceiling of ${
        athleteMaxHrBpm > 0 ? Math.min(225, athleteMaxHrBpm + 12) : 225
      } bpm; possible cadence lock).`
    );
  }

  if (maxHrBpm !== null && (maxHrBpm > 235 || (avgHrBpm > 0 && maxHrBpm < avgHrBpm))) {
    flags.push(`Peak HR (${maxHrBpm} bpm) inconsistent with average HR (${avgHrBpm} bpm).`);
  }

  if (durationMinutes <= 0) {
    flags.push('Duration is zero on a completed run.');
  }

  if (flags.length > 0) {
    return { hrDataState: 'invalid', flags };
  }

  return { hrDataState: 'valid', flags: [] };
}

export function calculateHrRunningStress(params: {
  durationMinutes: number;
  avgHrBpm: number | null;
  lthrBpm: number;
  hrDataState: HrDataState;
  avgPaceSecPerMile?: number | null;
  thresholdPaceSecPerMile?: number | null;
  avgPowerWatts?: number | null;
  thresholdPowerWatts?: number | null;
  thresholdVersion: number;
  calculatedAt?: string;
}): WorkoutStressMetrics {
  const {
    durationMinutes,
    avgHrBpm,
    lthrBpm,
    hrDataState,
    avgPaceSecPerMile,
    thresholdPaceSecPerMile,
    avgPowerWatts,
    thresholdPowerWatts,
    thresholdVersion,
    calculatedAt = '2026-11-18T14:28:00Z',
  } = params;

  let hrStress: number | null = null;
  let hrIntensityFactor: number | null = null;

  if (hrDataState === 'rest_zero') {
    hrStress = 0;
    hrIntensityFactor = 0;
  } else if (
    hrDataState === 'valid' &&
    avgHrBpm !== null &&
    durationMinutes > 0 &&
    lthrBpm > 0
  ) {
    const hrIf = avgHrBpm / lthrBpm;
    hrIntensityFactor = Number(hrIf.toFixed(3));
    hrStress = Number(((durationMinutes / 60) * Math.pow(hrIf, 2) * 100).toFixed(1));
  }

  let paceStressProxy: number | null = null;
  if (
    hrDataState !== 'rest_zero' &&
    durationMinutes > 0 &&
    avgPaceSecPerMile &&
    avgPaceSecPerMile > 0 &&
    thresholdPaceSecPerMile &&
    thresholdPaceSecPerMile > 0
  ) {
    const paceRatio = thresholdPaceSecPerMile / avgPaceSecPerMile;
    paceStressProxy = Number(((durationMinutes / 60) * Math.pow(paceRatio, 2) * 100).toFixed(1));
  }

  let powerStressProxy: number | null = null;
  if (
    hrDataState !== 'rest_zero' &&
    durationMinutes > 0 &&
    avgPowerWatts &&
    avgPowerWatts > 0 &&
    thresholdPowerWatts &&
    thresholdPowerWatts > 0
  ) {
    const powerRatio = avgPowerWatts / thresholdPowerWatts;
    powerStressProxy = Number(((durationMinutes / 60) * Math.pow(powerRatio, 2) * 100).toFixed(1));
  }

  return {
    hrStress,
    hrIntensityFactor,
    paceStressProxy,
    powerStressProxy,
    methodologyLabel: 'HR-Derived Running Stress (hrRSS)',
    isTssEquivalent: false,
    thresholdVersionUsed: thresholdVersion,
    lthrBpmUsed: lthrBpm,
    calculatedAt,
  };
}

export function resolveThresholdForDate(history: LthrRecord[], dateIso: string): LthrRecord {
  const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let matched = sorted[0];
  for (const rec of sorted) {
    if (rec.effectiveDate <= dateIso) {
      matched = rec;
    }
  }
  return matched;
}

const SHORT_MONTHS_LOAD = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildWeekLabelsFromStart(startDateIso: string, count = 12): string[] {
  const labels: string[] = [];
  const start = new Date(startDateIso + 'T00:00:00Z');
  for (let w = 0; w < count; w++) {
    const dt = new Date(start.getTime() + w * 7 * 86400000);
    labels.push(`${SHORT_MONTHS_LOAD[dt.getUTCMonth()]} ${dt.getUTCDate()}`);
  }
  return labels;
}

export function computeDailyAndWeeklyLoadSeries(
  workouts: Workout[],
  startDateIso = '2026-08-31',
  endDateIso = '2026-11-18',
  initialCtl = 38,
  initialAtl = 38
): { daily: DailyLoadPoint[]; weekly: WeeklyLoadPoint[] } {
  const byDate = new Map<string, Workout[]>();
  for (const w of workouts) {
    const arr = byDate.get(w.date) ?? [];
    arr.push(w);
    byDate.set(w.date, arr);
  }

  const daily: DailyLoadPoint[] = [];
  const start = new Date(startDateIso + 'T00:00:00Z');
  const end = new Date(endDateIso + 'T00:00:00Z');
  const weekLabels = buildWeekLabelsFromStart(startDateIso, 12);

  let ctl = initialCtl;
  let atl = initialAtl;

  const weeklyBuckets = new Map<
    number,
    {
      stress: number;
      paceStress: number;
      powerStress: number;
      garmin: number;
      ctlEnd: number;
      atlEnd: number;
      tsbEnd: number;
    }
  >();

  let dayIdx = 0;
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const dateIso = d.toISOString().slice(0, 10);
    const list = byDate.get(dateIso) ?? [];

    let dayStress = 0;
    let dayPaceStress = 0;
    let dayPowerStress = 0;
    let dayGarmin = 0;
    let hasMissingOrInvalidHr = false;

    for (const w of list) {
      if (w.hrDataState === 'missing' || w.hrDataState === 'invalid') {
        hasMissingOrInvalidHr = true;
      }
      if (w.stress.hrStress !== null) {
        dayStress += w.stress.hrStress;
      }
      if (w.stress.paceStressProxy !== null) {
        dayPaceStress += w.stress.paceStressProxy;
      }
      if (w.stress.powerStressProxy !== null) {
        dayPowerStress += w.stress.powerStressProxy;
      }
      if (
        w.garminMetrics?.garminTrainingLoad !== null &&
        w.garminMetrics?.garminTrainingLoad !== undefined
      ) {
        dayGarmin += w.garminMetrics.garminTrainingLoad;
      }
    }

    dayStress = Number(dayStress.toFixed(1));
    dayGarmin = Number(dayGarmin.toFixed(1));

    ctl = ctl + (dayStress - ctl) * CTL_ALPHA;
    atl = atl + (dayStress - atl) * ATL_ALPHA;
    const tsb = ctl - atl;

    daily.push({
      date: dateIso,
      dayLabel: dateIso.slice(5),
      hrStress: dayStress,
      garminTrainingLoad: dayGarmin,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number(tsb.toFixed(1)),
      hasMissingOrInvalidHr,
    });

    const weekIndex = Math.min(12, Math.floor(dayIdx / 7) + 1);
    const prevBucket = weeklyBuckets.get(weekIndex) ?? {
      stress: 0,
      paceStress: 0,
      powerStress: 0,
      garmin: 0,
      ctlEnd: 0,
      atlEnd: 0,
      tsbEnd: 0,
    };
    weeklyBuckets.set(weekIndex, {
      stress: Number((prevBucket.stress + dayStress).toFixed(1)),
      paceStress: Number((prevBucket.paceStress + dayPaceStress).toFixed(1)),
      powerStress: Number((prevBucket.powerStress + dayPowerStress).toFixed(1)),
      garmin: Number((prevBucket.garmin + dayGarmin).toFixed(1)),
      ctlEnd: Number(ctl.toFixed(1)),
      atlEnd: Number(atl.toFixed(1)),
      tsbEnd: Number(tsb.toFixed(1)),
    });

    dayIdx++;
  }

  const weekly: WeeklyLoadPoint[] = [];
  for (let w = 1; w <= 12; w++) {
    const b = weeklyBuckets.get(w);
    if (!b) continue;
    weekly.push({
      weekLabel: weekLabels[w - 1] ?? `Wk ${w}`,
      weekIndex: w,
      weeklyHrStress: b.stress,
      weeklyPaceStressProxy: b.paceStress,
      weeklyPowerStressProxy: b.powerStress,
      weeklyGarminLoad: b.garmin,
      ctlEnd: b.ctlEnd,
      atlEnd: b.atlEnd,
      tsbEnd: b.tsbEnd,
    });
  }

  return { daily, weekly };
}

export function getTsbFormLabel(tsb: number): { label: string; tone: 'emerald' | 'sky' | 'amber' | 'rose' } {
  if (tsb >= 5) return { label: 'Fresh / Race Taper', tone: 'emerald' };
  if (tsb >= -10) return { label: 'Balanced / Maintenance', tone: 'sky' };
  if (tsb >= -22) return { label: 'Productive Overload', tone: 'amber' };
  return { label: 'High Acute Fatigue', tone: 'rose' };
}

export function recalculateAthleteWithThreshold(params: {
  athlete: Athlete;
  newRecordInput?: {
    lthrBpm: number;
    recordedDate: string;
    effectiveDate: string;
    source: LthrSourceType;
    garminDeviceLabel?: string;
    coachVerified: boolean;
    optionalThresholdPaceSecPerMile?: number | null;
    optionalThresholdPowerWatts?: number | null;
    notes?: string;
  };
  verifyRecordId?: string;
  newZoneConfig?: HrZoneConfig;
  scope: 'all_history' | 'from_effective_date';
  nowIso?: string;
}): Athlete {
  const {
    athlete,
    newRecordInput,
    verifyRecordId,
    newZoneConfig,
    scope,
    nowIso = '2026-11-18T14:35:00Z',
  } = params;

  const prevVersion = athlete.activeThresholdVersion;
  const prevLthr = athlete.lthrBpm;
  const prevLoad = computeDailyAndWeeklyLoadSeries(athlete.workouts);
  const prevLastFullWeekStress =
    prevLoad.weekly[prevLoad.weekly.length - 2]?.weeklyHrStress ?? 0;

  let nextHistory = [...athlete.lthrHistory];
  let nextActiveLthr = athlete.lthrBpm;
  let nextActiveVersion = athlete.activeThresholdVersion;
  let nextThresholdPace = athlete.thresholdPaceSecPerMile;
  let nextThresholdPower = athlete.optionalThresholdPowerWatts;
  let effectiveBoundaryDate = '2026-08-31';

  if (verifyRecordId) {
    nextHistory = nextHistory.map((rec) =>
      rec.id === verifyRecordId
        ? {
            ...rec,
            coachVerified: !rec.coachVerified,
            verifiedBy: !rec.coachVerified ? 'Head Coach' : undefined,
            verifiedAt: !rec.coachVerified ? nowIso.slice(0, 10) : undefined,
          }
        : rec
    );
  }

  if (newRecordInput) {
    const nextVer = Math.max(...nextHistory.map((r) => r.version), 0) + 1;
    const created: LthrRecord = {
      id: `${athlete.id}-lthr-v${nextVer}`,
      version: nextVer,
      lthrBpm: newRecordInput.lthrBpm,
      recordedDate: newRecordInput.recordedDate,
      effectiveDate: newRecordInput.effectiveDate,
      source: newRecordInput.source,
      garminDeviceLabel: newRecordInput.garminDeviceLabel,
      coachVerified: newRecordInput.coachVerified,
      verifiedBy: newRecordInput.coachVerified ? 'Head Coach' : undefined,
      verifiedAt: newRecordInput.coachVerified ? nowIso.slice(0, 10) : undefined,
      optionalThresholdPaceSecPerMile: newRecordInput.optionalThresholdPaceSecPerMile ?? null,
      optionalThresholdPowerWatts: newRecordInput.optionalThresholdPowerWatts ?? null,
      notes: newRecordInput.notes,
    };
    nextHistory.push(created);
    nextActiveLthr = created.lthrBpm;
    nextActiveVersion = created.version;
    if (created.optionalThresholdPaceSecPerMile) {
      nextThresholdPace = created.optionalThresholdPaceSecPerMile;
    }
    if (created.optionalThresholdPowerWatts !== undefined) {
      nextThresholdPower = created.optionalThresholdPowerWatts ?? null;
    }
    effectiveBoundaryDate = created.effectiveDate;
  }

  const nextZoneConfig = newZoneConfig ?? athlete.hrZoneConfig;
  const activeZones = computeLthrZones(nextActiveLthr, nextZoneConfig, athlete.maxHrBpm);

  let affectedWorkouts = 0;
  const recalculatedWorkouts = athlete.workouts.map((w) => {
    const shouldRecalculate =
      scope === 'all_history' || w.date >= effectiveBoundaryDate;

    if (!shouldRecalculate) {
      return w;
    }

    affectedWorkouts++;
    const resolved =
      scope === 'all_history' && newRecordInput
        ? nextHistory[nextHistory.length - 1]
        : resolveThresholdForDate(nextHistory, w.date);

    const validation = validateHeartRateReading({
      avgHrBpm: w.avgHrBpm,
      maxHrBpm: w.maxHrBpm,
      athleteMaxHrBpm: athlete.maxHrBpm,
      workoutType: w.type,
      status: w.status,
      durationMinutes: w.durationMinutes,
    });

    const stress = calculateHrRunningStress({
      durationMinutes: w.durationMinutes,
      avgHrBpm: w.avgHrBpm,
      lthrBpm: resolved.lthrBpm,
      hrDataState: validation.hrDataState,
      avgPaceSecPerMile: w.avgPaceSecPerMile,
      thresholdPaceSecPerMile:
        resolved.optionalThresholdPaceSecPerMile ?? nextThresholdPace,
      avgPowerWatts: w.avgPowerWatts,
      thresholdPowerWatts:
        resolved.optionalThresholdPowerWatts ?? nextThresholdPower,
      thresholdVersion: resolved.version,
      calculatedAt: nowIso,
    });

    const updatedZoneBreakdown = { ...w.zoneBreakdown };
    if (validation.hrDataState === 'valid' && w.avgHrBpm !== null) {
      const pctLthr = (w.avgHrBpm / resolved.lthrBpm) * 100;
      const dominant = activeZones.find((z) => pctLthr <= z.maxPctLthr)?.zone ?? 'Z5';
      if (w.type === 'Easy' && dominant === 'Z3') {
        updatedZoneBreakdown.Z3 = Math.max(updatedZoneBreakdown.Z3, 35);
      }
    }

    return {
      ...w,
      hrDataState: validation.hrDataState,
      hrValidationFlags: validation.flags,
      zoneBreakdown: updatedZoneBreakdown,
      stress,
      provenance: {
        ...w.provenance,
        thresholdVersion: resolved.version,
        thresholdSource: resolved.source,
        lthrBpmUsed: resolved.lthrBpm,
        recalculatedAt: nowIso,
        calculationMethod: 'HR-Derived Running Stress (hrRSS) · LTHR-Anchored',
      },
    };
  });

  const nextLoad = computeDailyAndWeeklyLoadSeries(recalculatedWorkouts);
  const newLastFullWeekStress =
    nextLoad.weekly[nextLoad.weekly.length - 2]?.weeklyHrStress ?? 0;

  const nextLog: StressSnapshotRecord[] = [...athlete.recalculationLog];
  if (newRecordInput || newZoneConfig) {
    nextLog.unshift({
      id: `${athlete.id}-snap-${Date.now()}`,
      recalculatedAt: nowIso,
      previousThresholdVersion: prevVersion,
      newThresholdVersion: nextActiveVersion,
      previousLthrBpm: prevLthr,
      newLthrBpm: nextActiveLthr,
      scope,
      effectiveFromDate: scope === 'all_history' ? '2026-08-31' : effectiveBoundaryDate,
      affectedWorkouts,
      previousLastFullWeekStress: prevLastFullWeekStress,
      newLastFullWeekStress: newLastFullWeekStress,
      note: newRecordInput
        ? `Threshold v${nextActiveVersion} (${nextActiveLthr} bpm, ${newRecordInput.source})`
        : `Zone methodology updated to ${HR_ZONE_METHODOLOGIES[nextZoneConfig!.methodology].label}`,
    });
  }

  return {
    ...athlete,
    lthrBpm: nextActiveLthr,
    activeThresholdVersion: nextActiveVersion,
    lthrHistory: nextHistory,
    hrZoneConfig: nextZoneConfig,
    thresholdPaceSecPerMile: nextThresholdPace,
    optionalThresholdPowerWatts: nextThresholdPower,
    recalculationLog: nextLog,
    workouts: recalculatedWorkouts,
  };
}
