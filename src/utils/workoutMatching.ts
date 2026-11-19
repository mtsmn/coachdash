import {
  Athlete,
  IntensityZone,
  NormalizedCompletedActivity,
  PlannedWorkoutRecord,
  WorkoutMatchRecord,
} from '../types/coaching';
import { computeLthrZones, classifyHrIntoZone } from './lthrAnalytics';
import { workoutToNormalizedSample } from './historicalImport';

function targetZoneForType(type: PlannedWorkoutRecord['workoutType']): IntensityZone {
  switch (type) {
    case 'Recovery':
      return 'Z1';
    case 'Easy':
    case 'Long Run':
      return 'Z2';
    case 'Tempo':
      return 'Z4';
    case 'Intervals':
    case 'Race':
      return 'Z5';
    default:
      return 'Z1';
  }
}

export function extractFinalSurgePlannedWorkouts(athlete: Athlete): PlannedWorkoutRecord[] {
  const planned: PlannedWorkoutRecord[] = [];
  for (const w of athlete.workouts) {
    if (w.type === 'Rest' || w.plannedMiles <= 0) continue;
    const targetPace =
      w.type === 'Recovery'
        ? athlete.thresholdPaceSecPerMile + 120
        : w.type === 'Easy'
        ? athlete.thresholdPaceSecPerMile + 95
        : w.type === 'Long Run'
        ? athlete.thresholdPaceSecPerMile + 85
        : w.type === 'Tempo'
        ? athlete.thresholdPaceSecPerMile + 8
        : athlete.thresholdPaceSecPerMile - 14;

    planned.push({
      id: `plan-${w.id}`,
      athleteId: athlete.id,
      finalSurgeWorkoutId: `${athlete.finalSurgeId}-W${w.weekIndex}-D${w.date}`,
      date: w.date,
      plannedStartTime: w.type === 'Long Run' ? '06:30' : w.type === 'Intervals' ? '06:00' : '07:00',
      title: w.title,
      workoutType: w.type,
      plannedMiles: w.plannedMiles,
      plannedDurationMin: Math.round((w.plannedMiles * targetPace) / 60),
      targetPaceSecPerMile: targetPace,
      targetZone: targetZoneForType(w.type),
    });
  }
  return planned;
}

function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

export function scoreWorkoutMatch(
  planned: PlannedWorkoutRecord,
  completed: NormalizedCompletedActivity
): { score: number; reasons: string[] } {
  if (planned.athleteId !== completed.athleteId) {
    return { score: 0, reasons: ['Athlete ID mismatch'] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (planned.date === completed.date) {
    score += 35;
    reasons.push(`Same date (${planned.date})`);
  } else {
    const dayDiff = Math.abs(
      (new Date(planned.date + 'T00:00:00Z').getTime() -
        new Date(completed.date + 'T00:00:00Z').getTime()) /
        86400000
    );
    if (dayDiff <= 1) {
      score += 15;
      reasons.push(`Adjacent date (±1 day)`);
    } else {
      return { score: 0, reasons: ['Date difference > 1 day'] };
    }
  }

  const timeDiffMin = Math.abs(
    parseMinutes(planned.plannedStartTime) - parseMinutes(completed.startTimeLocal)
  );
  if (timeDiffMin <= 90) {
    score += 15;
    reasons.push(`Start time within ${timeDiffMin}m`);
  }

  if (planned.workoutType === completed.activityType) {
    score += 15;
    reasons.push(`Type matches (${planned.workoutType})`);
  }

  const distPctDiff =
    planned.plannedMiles > 0
      ? Math.abs(completed.distanceMiles - planned.plannedMiles) / planned.plannedMiles
      : 0;
  if (distPctDiff <= 0.12) {
    score += 20;
    reasons.push(`Distance within 12%`);
  } else if (distPctDiff <= 0.28) {
    score += 10;
    reasons.push(`Distance variance ${(distPctDiff * 100).toFixed(0)}%`);
  } else {
    reasons.push(`Large distance variance (${(distPctDiff * 100).toFixed(0)}%)`);
  }

  const durPctDiff =
    planned.plannedDurationMin > 0
      ? Math.abs(completed.durationMinutes - planned.plannedDurationMin) /
        planned.plannedDurationMin
      : 0;
  if (durPctDiff <= 0.15) {
    score += 15;
    reasons.push(`Duration within 15%`);
  } else if (durPctDiff <= 0.35) {
    score += 7;
  }

  return { score: Math.min(100, score), reasons };
}

export function matchPlannedAndCompletedWorkouts(params: {
  athlete: Athlete;
  plannedWorkouts: PlannedWorkoutRecord[];
  completedActivities: NormalizedCompletedActivity[];
  anchorDate?: string;
  reviewedIds?: Set<string>;
}): WorkoutMatchRecord[] {
  const {
    athlete,
    plannedWorkouts,
    completedActivities,
    anchorDate = '2026-11-18',
    reviewedIds = new Set<string>(),
  } = params;

  const zones = computeLthrZones(athlete.lthrBpm, athlete.hrZoneConfig, athlete.maxHrBpm);
  const completedPool = [...completedActivities];
  const matchedCompletedIds = new Set<string>();
  const records: WorkoutMatchRecord[] = [];

  for (const plan of plannedWorkouts) {
    if (plan.date > anchorDate) continue; // Future planned sessions are not missed

    let best: { activity: NormalizedCompletedActivity; score: number; reasons: string[] } | null =
      null;
    for (const act of completedPool) {
      if (matchedCompletedIds.has(act.id)) continue;
      const res = scoreWorkoutMatch(plan, act);
      if (res.score > (best?.score ?? 0)) {
        best = { activity: act, score: res.score, reasons: res.reasons };
      }
    }

    if (best && best.score >= 55) {
      matchedCompletedIds.add(best.activity.id);
      const act = best.activity;
      const distDelta = Number((act.distanceMiles - plan.plannedMiles).toFixed(2));
      const durDelta = Math.round(act.durationMinutes - plan.plannedDurationMin);
      const paceDelta =
        act.avgPaceSecPerMile !== null && plan.targetPaceSecPerMile !== null
          ? act.avgPaceSecPerMile - plan.targetPaceSecPerMile
          : null;

      const targetZoneObj = zones.find((z) => z.zone === plan.targetZone);
      const actualZone = classifyHrIntoZone(act.avgHrBpm, zones);
      const hrDelta =
        act.avgHrBpm !== null && act.hrDataState === 'valid' && targetZoneObj
          ? act.avgHrBpm - Math.round((targetZoneObj.minBpm + targetZoneObj.maxBpm) / 2)
          : null;

      const hasMissingTelemetry =
        act.hrDataState === 'missing' || act.hrDataState === 'invalid';

      const status = hasMissingTelemetry
        ? 'Missing Telemetry'
        : best.score >= 80 || reviewedIds.has(`match-${plan.id}`)
        ? 'Auto-Matched'
        : 'Needs Coach Review';

      const intensityComparison = hasMissingTelemetry
        ? `Target ${plan.targetZone} · HR telemetry ${act.hrDataState} (run completed)`
        : `Target ${plan.targetZone} vs Actual ${actualZone ?? '--'}${
            hrDelta !== null ? ` (${hrDelta >= 0 ? '+' : ''}${hrDelta} bpm vs zone midpoint)` : ''
          }`;

      records.push({
        id: `match-${plan.id}`,
        athleteId: athlete.id,
        athleteName: athlete.name,
        date: plan.date,
        plannedWorkout: plan,
        completedActivity: act,
        matchStatus: status,
        matchScore: best.score,
        matchReasons: best.reasons,
        distanceDeltaMiles: distDelta,
        durationDeltaMin: durDelta,
        paceDeltaSecPerMile: paceDelta,
        hrDeltaFromTargetZoneBpm: hrDelta,
        intensityComparison,
        coachReviewed: reviewedIds.has(`match-${plan.id}`),
      });
    } else {
      records.push({
        id: `match-${plan.id}`,
        athleteId: athlete.id,
        athleteName: athlete.name,
        date: plan.date,
        plannedWorkout: plan,
        completedActivity: null,
        matchStatus: 'Missed Workout',
        matchScore: 0,
        matchReasons: ['No Intervals.icu completed activity found on scheduled date'],
        distanceDeltaMiles: Number((-plan.plannedMiles).toFixed(2)),
        durationDeltaMin: -plan.plannedDurationMin,
        paceDeltaSecPerMile: null,
        hrDeltaFromTargetZoneBpm: null,
        intensityComparison: `Planned ${plan.targetZone} session not executed`,
        coachReviewed: reviewedIds.has(`match-${plan.id}`),
      });
    }
  }

  for (const act of completedPool) {
    if (matchedCompletedIds.has(act.id)) continue;
    records.push({
      id: `match-unplanned-${act.id}`,
      athleteId: athlete.id,
      athleteName: athlete.name,
      date: act.date,
      plannedWorkout: null,
      completedActivity: act,
      matchStatus: 'Unplanned Activity',
      matchScore: 0,
      matchReasons: ['Completed activity in Intervals.icu without matching Final Surge plan'],
      distanceDeltaMiles: act.distanceMiles,
      durationDeltaMin: act.durationMinutes,
      paceDeltaSecPerMile: null,
      hrDeltaFromTargetZoneBpm: null,
      intensityComparison: `Unscheduled ${act.activityType}`,
      coachReviewed: reviewedIds.has(`match-unplanned-${act.id}`),
    });
  }

  return records.sort((a, b) => b.date.localeCompare(a.date));
}

export function buildAthleteWorkoutMatchesFromDemo(
  athlete: Athlete,
  reviewedIds?: Set<string>
): WorkoutMatchRecord[] {
  const planned = extractFinalSurgePlannedWorkouts(athlete);
  const completed = athlete.workouts
    .filter((w) => w.type !== 'Rest' && w.status !== 'Missed' && w.status !== 'Planned')
    .map((w) => workoutToNormalizedSample(athlete, w));
  return matchPlannedAndCompletedWorkouts({
    athlete,
    plannedWorkouts: planned,
    completedActivities: completed,
    reviewedIds,
  });
}
