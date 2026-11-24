import {
  Athlete,
  HeartRateStreamRecord,
  ImportBatchReport,
  NormalizedCompletedActivity,
  RawProviderActivity,
  ThresholdApprovalCandidate,
  UnifiedAthleteMapping,
  Workout,
  WorkoutType,
} from '../types/coaching';
import { validateHeartRateReading } from './lthrAnalytics';

export function buildRawAndNormalizedFromAthleteWorkouts(
  athlete: Athlete,
  intervalsAthleteId: string
): {
  rawActivities: RawProviderActivity[];
  normalizedActivities: NormalizedCompletedActivity[];
  hrStreams: HeartRateStreamRecord[];
} {
  const rawActivities: RawProviderActivity[] = [];
  const normalizedActivities: NormalizedCompletedActivity[] = [];
  const hrStreams: HeartRateStreamRecord[] = [];

  for (const w of athlete.workouts) {
    if (w.type === 'Rest' || w.status !== 'Completed') {
      continue;
    }

    const startTimeLocal =
      w.type === 'Long Run' ? '06:30' : w.type === 'Intervals' ? '06:00' : '07:00';
    const externalId = `icu-act-${w.id}`;
    const rawId = `raw-${w.id}`;
    const sourceDevice = athlete.garminBiometrics.garminLthrDevice ?? 'Garmin Forerunner (via Intervals.icu)';

    const raw: RawProviderActivity = {
      rawId,
      provider: 'intervals_icu',
      externalActivityId: externalId,
      intervalsAthleteId,
      fetchedAt: `${w.date}T12:00:00Z`,
      sourceDevice,
      payload: {
        start_date_local: `${w.date}T${startTimeLocal}:00`,
        name: w.title,
        type: 'Run',
        moving_time: Math.max(0, Math.round(w.durationMinutes * 60)),
        distance: Math.round(w.actualMiles * 1609.34),
        average_hr: w.avgHrBpm,
        max_hr: w.maxHrBpm,
        average_watts: w.avgPowerWatts ?? null,
        total_elevation_gain: Math.round(w.elevationGainFt * 0.3048),
        icu_training_load: w.garminMetrics?.garminTrainingLoad ?? null,
        icu_ctl: null,
        icu_atl: null,
        session_rpe: w.rpe,
        detected_lthr: athlete.garminBiometrics.garminDetectedLthrBpm,
      },
    };
    rawActivities.push(raw);

    const validation = validateHeartRateReading({
      avgHrBpm: w.avgHrBpm,
      maxHrBpm: w.maxHrBpm,
      athleteMaxHrBpm: athlete.maxHrBpm,
      workoutType: w.type,
      status: w.status,
      durationMinutes: w.durationMinutes,
    });

    const normalized: NormalizedCompletedActivity = {
      id: `norm-${w.id}`,
      athleteId: athlete.id,
      externalActivityId: externalId,
      provider: 'intervals_icu',
      sourceDevice,
      date: w.date,
      startTimeLocal,
      title: w.title,
      activityType: w.type as WorkoutType,
      durationMinutes: w.durationMinutes,
      distanceMiles: w.actualMiles,
      avgPaceSecPerMile: w.avgPaceSecPerMile,
      avgHrBpm: w.avgHrBpm,
      maxHrBpm: w.maxHrBpm,
      avgPowerWatts: w.avgPowerWatts ?? null,
      elevationGainFt: w.elevationGainFt,
      rpe: w.rpe,
      hrDataState: validation.hrDataState,
      hrValidationFlags: validation.flags,
      rawRecordId: rawId,
    };
    normalizedActivities.push(normalized);

    // Compact 5-minute summary HR stream points representing recorded stream structure
    const sampleCount = Math.max(3, Math.min(24, Math.round(w.durationMinutes / 5)));
    const streamArr: number[] = [];
    let dropouts = 0;
    let spikes = 0;
    for (let i = 0; i < sampleCount; i++) {
      if (w.avgHrBpm === null || w.avgHrBpm === 0) {
        streamArr.push(0);
        dropouts++;
      } else {
        const ramp = Math.round(((i / Math.max(1, sampleCount - 1)) - 0.5) * 8);
        const val = Math.max(50, w.avgHrBpm + ramp);
        if (val > 220) spikes++;
        streamArr.push(val);
      }
    }

    hrStreams.push({
      activityId: normalized.id,
      athleteId: athlete.id,
      sampleIntervalSec: 300,
      hrBpmStream: streamArr,
      validSamplePct:
        w.avgHrBpm === null || w.avgHrBpm === 0
          ? 0
          : Math.round(((sampleCount - spikes) / sampleCount) * 100),
      dropoutCount: dropouts,
      spikeCount: spikes,
    });
  }

  return { rawActivities, normalizedActivities, hrStreams };
}

function parseMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

export function deduplicateActivities(
  existing: NormalizedCompletedActivity[],
  incoming: NormalizedCompletedActivity[]
): {
  accepted: NormalizedCompletedActivity[];
  duplicatesSkipped: NormalizedCompletedActivity[];
} {
  const existingKeys = new Set(existing.map((e) => `${e.provider}:${e.externalActivityId}`));
  const accepted: NormalizedCompletedActivity[] = [];
  const duplicatesSkipped: NormalizedCompletedActivity[] = [];

  for (const item of incoming) {
    const key = `${item.provider}:${item.externalActivityId}`;
    if (existingKeys.has(key)) {
      duplicatesSkipped.push(item);
      continue;
    }

    // Secondary fuzzy duplicate guard: same athlete + date + startTime within 5 min + distance within 0.15 mi
    const isNearDuplicate = [...existing, ...accepted].some((other) => {
      if (other.athleteId !== item.athleteId || other.date !== item.date) return false;
      const timeDiffMin = Math.abs(
        parseMinutesOfDay(other.startTimeLocal) - parseMinutesOfDay(item.startTimeLocal)
      );
      const distDiff = Math.abs(other.distanceMiles - item.distanceMiles);
      return timeDiffMin <= 5 && distDiff <= 0.15;
    });

    if (isNearDuplicate) {
      duplicatesSkipped.push(item);
      continue;
    }

    existingKeys.add(key);
    accepted.push(item);
  }

  return { accepted, duplicatesSkipped };
}

export function previewHistoricalImportBatch(params: {
  athletes: Athlete[];
  mappings: UnifiedAthleteMapping[];
  existingActivities?: NormalizedCompletedActivity[];
  mode: 'incremental' | 'backfill_12_week';
  executedAt?: string;
}): {
  report: ImportBatchReport;
  acceptedActivities: NormalizedCompletedActivity[];
  rawActivities: RawProviderActivity[];
  hrStreams: HeartRateStreamRecord[];
} {
  const {
    athletes,
    mappings,
    existingActivities = [],
    mode,
    executedAt = '2026-11-18T15:00:00Z',
  } = params;

  const windowStart = mode === 'backfill_12_week' ? '2026-08-31' : '2026-11-12';
  const windowEnd = '2026-11-18';

  const mappingByAthlete = new Map(mappings.map((m) => [m.internalAthleteId, m]));
  const rawAll: RawProviderActivity[] = [];
  const candidateIncoming: NormalizedCompletedActivity[] = [];
  const streamsAll: HeartRateStreamRecord[] = [];
  const lthrCandidates: ThresholdApprovalCandidate[] = [];

  let unauthorizedBlocked = 0;

  for (const athlete of athletes) {
    const map = mappingByAthlete.get(athlete.id);
    if (!map || map.matchStatus !== 'Verified Match') {
      if (map?.matchStatus === 'Candidate Review Required') {
        unauthorizedBlocked++;
      }
      continue;
    }

    if (
      map.authorizationStatus !== 'Authorized (Read-Only)' &&
      map.authorizationStatus !== 'Demo Sample'
    ) {
      unauthorizedBlocked++;
      continue;
    }

    const { rawActivities, normalizedActivities, hrStreams } =
      buildRawAndNormalizedFromAthleteWorkouts(
        athlete,
        map.intervalsIcuAthleteId ?? `icu-${athlete.id}`
      );

    const windowedRaw = rawActivities.filter(
      (r) =>
        r.payload.start_date_local.slice(0, 10) >= windowStart &&
        r.payload.start_date_local.slice(0, 10) <= windowEnd
    );
    const windowedNorm = normalizedActivities.filter(
      (n) => n.date >= windowStart && n.date <= windowEnd
    );
    const normIds = new Set(windowedNorm.map((n) => n.id));
    const windowedStreams = hrStreams.filter((s) => normIds.has(s.activityId));

    rawAll.push(...windowedRaw);
    candidateIncoming.push(...windowedNorm);
    streamsAll.push(...windowedStreams);

    // Flag threshold changes from Intervals.icu / Garmin without auto-replacing approved thresholds
    const candidateLthr = map.candidateIntervalsProfile?.detectedLthrBpm;
    if (candidateLthr && Math.abs(candidateLthr - athlete.lthrBpm) >= 2) {
      lthrCandidates.push({
        id: `lthr-cand-${athlete.id}-${candidateLthr}`,
        athleteId: athlete.id,
        athleteName: athlete.name,
        currentLthrBpm: athlete.lthrBpm,
        proposedLthrBpm: candidateLthr,
        deltaBpm: candidateLthr - athlete.lthrBpm,
        detectedDate: map.candidateIntervalsProfile?.lastActivityDate ?? windowEnd,
        sourceDevice: map.candidateIntervalsProfile?.detectedDevice ?? 'Garmin via Intervals.icu',
        provider: 'Intervals.icu (Garmin LTHR)',
        status: 'Pending Coach Approval',
        reason: `Intervals.icu reported Garmin-detected LTHR of ${candidateLthr} bpm (${
          candidateLthr - athlete.lthrBpm >= 0 ? '+' : ''
        }${candidateLthr - athlete.lthrBpm} bpm vs active v${athlete.activeThresholdVersion} ${athlete.lthrBpm} bpm). Coach approval required before updating threshold.`,
      });
    }
  }

  const { accepted, duplicatesSkipped } = deduplicateActivities(
    existingActivities,
    candidateIncoming
  );

  const missingHrCount = accepted.filter((a) => a.hrDataState === 'missing').length;
  const invalidHrQuarantined = accepted.filter((a) => a.hrDataState === 'invalid').length;

  const report: ImportBatchReport = {
    batchId: `imp-${mode}-${executedAt.slice(0, 10)}`,
    executedAt,
    windowStart,
    windowEnd,
    mode,
    totalFetched: candidateIncoming.length,
    newNormalizedCount: accepted.length,
    duplicatesSkipped: duplicatesSkipped.length,
    unauthorizedBlocked,
    missingHrCount,
    invalidHrQuarantined,
    lthrChangeCandidates: lthrCandidates,
    notes: [
      `Original raw payloads (${rawAll.length}) preserved separately from normalized activities (${accepted.length}).`,
      unauthorizedBlocked > 0
        ? `${unauthorizedBlocked} athlete(s) blocked from import pending explicit Intervals.icu API authorization.`
        : 'All matched pilot athletes verified read-only prior to import preview.',
    ],
  };

  return {
    report,
    acceptedActivities: accepted,
    rawActivities: rawAll,
    hrStreams: streamsAll,
  };
}

export function workoutToNormalizedSample(athlete: Athlete, w: Workout): NormalizedCompletedActivity {
  return {
    id: `norm-${w.id}`,
    athleteId: athlete.id,
    externalActivityId: `icu-act-${w.id}`,
    provider: 'intervals_icu',
    sourceDevice: athlete.garminBiometrics.garminLthrDevice ?? 'Garmin Forerunner (via Intervals.icu)',
    date: w.date,
    startTimeLocal: w.type === 'Long Run' ? '06:30' : '07:00',
    title: w.title,
    activityType: w.type,
    durationMinutes: w.durationMinutes,
    distanceMiles: w.actualMiles,
    avgPaceSecPerMile: w.avgPaceSecPerMile,
    avgHrBpm: w.avgHrBpm,
    maxHrBpm: w.maxHrBpm,
    avgPowerWatts: w.avgPowerWatts ?? null,
    elevationGainFt: w.elevationGainFt,
    rpe: w.rpe,
    hrDataState: w.hrDataState,
    hrValidationFlags: w.hrValidationFlags,
    rawRecordId: `raw-${w.id}`,
  };
}
