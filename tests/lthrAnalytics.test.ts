import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATL_ALPHA,
  calculateHrRunningStress,
  classifyHrIntoZone,
  computeDailyAndWeeklyLoadSeries,
  computeLthrZones,
  CTL_ALPHA,
  getTsbFormLabel,
  HR_ZONE_METHODOLOGIES,
  recalculateAthleteWithThreshold,
  resolveThresholdForDate,
  validateHeartRateReading,
  validateZoneBoundaries,
} from '../src/utils/lthrAnalytics.ts';
import { generateDemoRoster } from '../src/data/mockRosterGenerator.ts';

test('Zone calculations: computes 5 individualized LTHR zones for methodologies and custom bounds', () => {
  const zones = computeLthrZones(
    170,
    { methodology: 'friel_running', updatedAt: '2026-11-18T00:00:00Z' },
    190
  );

  assert.equal(zones.length, 5);
  assert.equal(zones[0].zone, 'Z1');
  assert.equal(zones[0].minBpm, Math.round(170 * 0.5));
  assert.equal(zones[0].maxBpm, Math.round(170 * 0.84));
  for (let i = 1; i < zones.length; i++) {
    assert.ok(zones[i].minBpm > zones[i - 1].maxBpm);
  }
  assert.equal(classifyHrIntoZone(135, zones), 'Z1');
  assert.equal(classifyHrIntoZone(170, zones), 'Z5');
  assert.equal(classifyHrIntoZone(null, zones), null);

  const polarized = computeLthrZones(
    170,
    { methodology: 'polarized_seiler', updatedAt: '2026-11-18T00:00:00Z' },
    190
  );
  assert.equal(polarized[1].maxBpm, Math.round(170 * 0.82));

  const invalidBounds = HR_ZONE_METHODOLOGIES.friel_running.boundaries.map((b) => ({ ...b }));
  invalidBounds[1].minPctLthr = 80;
  const validation = validateZoneBoundaries(invalidBounds);
  assert.equal(validation.valid, false);
  assert.ok(validation.error?.includes('overlaps'));
});

test('Workout stress calculations: normalizes 60m at LTHR to 100 hrRSS and distinguishes missing/invalid HR from zero', () => {
  const validAtThreshold = calculateHrRunningStress({
    durationMinutes: 60,
    avgHrBpm: 170,
    lthrBpm: 170,
    hrDataState: 'valid',
    avgPaceSecPerMile: 400,
    thresholdPaceSecPerMile: 390,
    avgPowerWatts: 300,
    thresholdPowerWatts: 310,
    thresholdVersion: 2,
  });

  assert.equal(validAtThreshold.hrStress, 100);
  assert.equal(validAtThreshold.hrIntensityFactor, 1);
  assert.equal(validAtThreshold.isTssEquivalent, false);
  assert.equal(validAtThreshold.methodologyLabel, 'HR-Derived Running Stress (hrRSS)');
  assert.ok(validAtThreshold.paceStressProxy !== null);
  assert.ok(validAtThreshold.powerStressProxy !== null);
  assert.notEqual(validAtThreshold.paceStressProxy, validAtThreshold.hrStress);

  const restCheck = validateHeartRateReading({
    avgHrBpm: null,
    maxHrBpm: null,
    athleteMaxHrBpm: 190,
    workoutType: 'Rest',
    status: 'Completed',
    durationMinutes: 0,
  });
  assert.equal(restCheck.hrDataState, 'rest_zero');
  const restStress = calculateHrRunningStress({
    durationMinutes: 0,
    avgHrBpm: null,
    lthrBpm: 170,
    hrDataState: restCheck.hrDataState,
    thresholdVersion: 2,
  });
  assert.equal(restStress.hrStress, 0);

  const missingCheck = validateHeartRateReading({
    avgHrBpm: null,
    maxHrBpm: null,
    athleteMaxHrBpm: 190,
    workoutType: 'Easy',
    status: 'Completed',
    durationMinutes: 45,
  });
  assert.equal(missingCheck.hrDataState, 'missing');
  const missingStress = calculateHrRunningStress({
    durationMinutes: 45,
    avgHrBpm: null,
    lthrBpm: 170,
    hrDataState: missingCheck.hrDataState,
    thresholdVersion: 2,
  });
  assert.equal(missingStress.hrStress, null);

  const spikeCheck = validateHeartRateReading({
    avgHrBpm: 236,
    maxHrBpm: 241,
    athleteMaxHrBpm: 186,
    workoutType: 'Recovery',
    status: 'Completed',
    durationMinutes: 35,
  });
  assert.equal(spikeCheck.hrDataState, 'invalid');
  assert.ok(spikeCheck.flags.length > 0);
  const spikeStress = calculateHrRunningStress({
    durationMinutes: 35,
    avgHrBpm: 236,
    lthrBpm: 168,
    hrDataState: spikeCheck.hrDataState,
    thresholdVersion: 2,
  });
  assert.equal(spikeStress.hrStress, null);
});

test('EWMA load calculations: 42-day CTL, 7-day ATL, TSB = CTL - ATL, and weekly stress totals', () => {
  const roster = generateDemoRoster();
  const athlete = roster[0];

  const { daily, weekly } = computeDailyAndWeeklyLoadSeries(
    athlete.workouts,
    '2026-08-31',
    '2026-11-18',
    40,
    40
  );

  assert.equal(daily.length, 80);
  assert.equal(weekly.length, 12);

  const day1 = daily[0];
  const expectedCtl1 = 40 + (day1.hrStress - 40) * CTL_ALPHA;
  const expectedAtl1 = 40 + (day1.hrStress - 40) * ATL_ALPHA;
  assert.ok(Math.abs(day1.ctl - Number(expectedCtl1.toFixed(1))) <= 0.1);
  assert.ok(Math.abs(day1.atl - Number(expectedAtl1.toFixed(1))) <= 0.1);

  for (const pt of daily) {
    assert.ok(Math.abs(pt.tsb - (pt.ctl - pt.atl)) <= 0.11);
  }

  const week1DailySum = daily.slice(0, 7).reduce((s, d) => s + d.hrStress, 0);
  assert.ok(Math.abs(weekly[0].weeklyHrStress - week1DailySum) <= 0.2);
  assert.ok(weekly[0].weeklyPaceStressProxy > 0);
  assert.equal(getTsbFormLabel(8).label, 'Fresh / Race Taper');
  assert.equal(getTsbFormLabel(-25).label, 'High Acute Fatigue');
});

test('Threshold history: prefers Garmin auto-detected LTHR, supports coach-approved manual fallback, preserves snapshots and Garmin metrics', () => {
  const roster = generateDemoRoster();
  const garminAthlete = roster[0];
  const fallbackAthlete = roster[7]; // Devon Brooks uses coach-approved manual fallback

  assert.equal(garminAthlete.lthrHistory[0].source, 'Garmin Auto-Detected');
  assert.ok(garminAthlete.garminBiometrics.garminDetectedLthrBpm !== null);
  assert.equal(fallbackAthlete.lthrHistory[0].source, 'Coach-Approved Manual Fallback');
  assert.equal(fallbackAthlete.garminBiometrics.garminDetectedLthrBpm, null);

  const earlyRec = resolveThresholdForDate(garminAthlete.lthrHistory, '2026-09-15');
  const lateRec = resolveThresholdForDate(garminAthlete.lthrHistory, '2026-10-20');
  assert.equal(earlyRec.version, 1);
  assert.equal(lateRec.version, 2);

  const targetWorkoutBefore = garminAthlete.workouts.find((w) => w.date === '2026-11-10');
  assert.ok(targetWorkoutBefore);
  const originalGarminLoad = targetWorkoutBefore.garminMetrics?.garminTrainingLoad;
  const originalStressBefore = targetWorkoutBefore.stress.hrStress;

  // Apply coach-approved manual fallback effective Nov 1
  const withFallback = recalculateAthleteWithThreshold({
    athlete: garminAthlete,
    newRecordInput: {
      lthrBpm: garminAthlete.lthrBpm + 6,
      recordedDate: '2026-11-18',
      effectiveDate: '2026-11-01',
      source: 'Coach-Approved Manual Fallback',
      coachVerified: true,
    },
    scope: 'from_effective_date',
  });

  assert.equal(withFallback.activeThresholdVersion, 3);
  assert.equal(withFallback.lthrHistory[2].source, 'Coach-Approved Manual Fallback');
  assert.equal(withFallback.recalculationLog.length, 1);

  // Early workout keeps v1 Garmin Auto-Detected provenance
  const earlyWorkoutAfter = withFallback.workouts.find((w) => w.date === '2026-09-15');
  assert.equal(earlyWorkoutAfter?.provenance.thresholdVersion, 1);
  assert.equal(earlyWorkoutAfter?.provenance.thresholdSource, 'Garmin Auto-Detected');

  // Nov 10 workout uses v3 manual fallback, lower HR-stress, and preserved Garmin Training Load
  const targetWorkoutAfter = withFallback.workouts.find((w) => w.date === '2026-11-10');
  assert.equal(targetWorkoutAfter?.provenance.thresholdVersion, 3);
  assert.equal(targetWorkoutAfter?.provenance.thresholdSource, 'Coach-Approved Manual Fallback');
  assert.equal(targetWorkoutAfter?.garminMetrics?.garminTrainingLoad, originalGarminLoad);
  if (originalStressBefore !== null && targetWorkoutAfter?.stress.hrStress !== null) {
    assert.ok(targetWorkoutAfter.stress.hrStress < originalStressBefore);
  }
});
