import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapProductionAthleteToDashboardModel,
  mapProductionIntelligenceToAICoachingInsight,
  mapProductionReportToWeeklyAthleteReport,
} from '../src/integrations/productionDashboardMapper.ts';
import type { ProductionPilotDashboardResponse } from '../src/integrations/intervalsIcuAdapter.ts';
import type { ProductionCoachingIntelligenceDto } from '../src/integrations/productionIntelligenceAdapter.ts';

function buildBasePilotData(
  overrides?: Partial<ProductionPilotDashboardResponse>
): ProductionPilotDashboardResponse {
  return {
    configured: true,
    hasPersistedPilot: true,
    connection: {
      connected: true,
      authMode: 'api_key',
      pilotTestSucceeded: true,
      verifiedPilotAthleteId: 'i509214',
      externalCoachId: 'i81059',
      externalCoachName: 'Coach Mike',
      lastVerifiedAt: '2026-11-18T11:55:00Z',
      lastSynchronizedAt: '2026-11-18T12:00:00Z',
    },
    athlete: {
      id: 'prod-ath-1',
      fullName: 'Pbutterworth',
      email: 'pb@example.com',
      age: null,
      gender: null,
      location: null,
      trainingGroup: 'Marathon',
      currentPhase: 'Build',
      restingHrBpm: 49,
      maxHrBpm: 186,
      activeLthrBpm: 168,
      thresholdPaceSecPerMile: 410,
      optionalThresholdPowerWatts: null,
      sportSpecialization: 'Running',
      dataOrigin: 'live',
      externalAthleteId: 'i509214',
      authorizationStatus: 'Authorized (Read-Only)',
      matchStatus: 'Verified Match',
      latestWeightKg: 68.5,
      updatedAt: '2026-11-18T12:00:00Z',
    },
    availableAthletes: [
      {
        id: 'prod-ath-1',
        fullName: 'Pbutterworth',
        externalAthleteId: 'i509214',
        authorizationStatus: 'Authorized (Read-Only)',
        matchStatus: 'Verified Match',
        isPilotAthlete: true,
        dataOrigin: 'live',
      },
    ],
    activities: [
      {
        id: 'act-2',
        externalActivityId: 'icu-2',
        provider: 'intervals_icu',
        sourceDevice: 'Garmin Forerunner 965',
        activityDate: '2026-11-17',
        startTimeLocal: '07:10:00',
        title: 'Threshold Cruise',
        activityType: 'Tempo',
        status: 'Completed',
        durationMinutes: 58,
        distanceMiles: 8.2,
        avgPaceSecPerMile: 424,
        avgHrBpm: 166,
        maxHrBpm: 178,
        avgPowerWatts: null,
        elevationGainFt: 240,
        rpe: 7,
        hrDataState: 'valid',
        hrValidationFlags: [],
        streamStatus: 'imported',
        hrStreamSampleCount: 3480,
        hrStreamValidPct: 99.5,
        hrStreamSampleIntervalSec: 1,
        icuTrainingLoad: 91,
        icuFitness: 48.4,
        icuFatigue: 55.2,
        icuForm: -6.8,
        hrRunningStress: 84.5,
        paceRunningStress: 88.2,
        powerRunningStress: null,
        sessionRpeStress: 76.0,
      },
      {
        id: 'act-1',
        externalActivityId: 'icu-1',
        provider: 'intervals_icu',
        sourceDevice: 'Garmin Forerunner 965',
        activityDate: '2026-11-14',
        startTimeLocal: '08:00:00',
        title: 'Easy Aerobic Run (No Strap)',
        activityType: 'Easy',
        status: 'Completed',
        durationMinutes: 51,
        distanceMiles: 6.0,
        avgPaceSecPerMile: 510,
        avgHrBpm: null,
        maxHrBpm: null,
        avgPowerWatts: null,
        elevationGainFt: 110,
        rpe: null,
        hrDataState: 'missing',
        hrValidationFlags: ['Missing average heart rate'],
        streamStatus: 'missing',
        hrStreamSampleCount: 0,
        hrStreamValidPct: null,
        hrStreamSampleIntervalSec: null,
        icuTrainingLoad: 47,
        icuFitness: 47.0,
        icuFatigue: 50.1,
        icuForm: -3.1,
        hrRunningStress: null,
        paceRunningStress: 54.0,
        powerRunningStress: null,
        sessionRpeStress: null,
      },
    ],
    wellnessRecords: [
      {
        id: 'well-1',
        recordDate: '2026-11-18',
        source: 'intervals_icu',
        restingHrBpm: 48,
        hrvRmssd: 66.2,
        hrvStatus: 'Balanced',
        sleepHours: 7.8,
        icuCtl: 49.1,
        icuAtl: 54.0,
        icuTsb: -4.9,
        weightKg: 68.5,
        fatigue: null,
        soreness: null,
        mood: null,
        motivation: null,
        stress: null,
        sleepScore: 84,
        readiness: null,
        rampRate: null,
      },
    ],
    dailyLoadHistories: [
      {
        loadDate: '2026-11-16',
        methodology: 'hr_derived_stress',
        dailyStress: 55,
        ctl: 44.1,
        atl: 51.2,
        tsb: -7.1,
        hasMissingOrInvalidHr: false,
      },
      {
        loadDate: '2026-11-17',
        methodology: 'hr_derived_stress',
        dailyStress: 84.5,
        ctl: 45.1,
        atl: 55.9,
        tsb: -10.8,
        hasMissingOrInvalidHr: false,
      },
    ],
    plannedWorkouts: [
      {
        id: 'pw-1',
        workoutDate: '2026-11-19',
        title: 'Easy Shakeout 5',
        workoutType: 'Easy',
        plannedMiles: 5.0,
        plannedDurationMin: 44,
        targetPaceSecPerMile: 528,
        targetZone: 'Z2',
        sourceProvider: 'coach_entry',
      },
    ],
    syncLogs: [],
    ...overrides,
  };
}

function buildSampleIntelligence(): ProductionCoachingIntelligenceDto {
  return {
    ok: true,
    statusCode: 200,
    configured: true,
    hasPersistedAthlete: true,
    analyzedAt: '2026-11-18T12:00:00Z',
    athlete: {
      id: 'prod-ath-1',
      fullName: 'Pbutterworth',
      externalAthleteId: 'i509214',
      trainingGroup: 'Marathon',
      currentPhase: 'Build',
      activeLthrBpm: 168,
      thresholdPaceSecPerMile: 410,
      maxHrBpm: 186,
      restingHrBpm: 49,
      dataOrigin: 'live',
    },
    availableAthletes: [],
    guardrails: {
      nonDiagnostic: true,
      nonPrescriptive: true,
      providerLoadSeparation: true,
      emailDispatchBlocked: true,
      notice:
        'Advisory coaching intelligence only. Does not predict injuries or diagnose medical conditions.',
    },
    loadIntelligence: {
      systemC: {
        available: true,
        primaryMethodology: 'hr_derived_stress',
        primaryMethodologyLabel: 'HR-Derived Running Stress (hrRSS)',
        latestDate: '2026-11-17',
        ctl: 45.1,
        atl: 55.9,
        tsb: -10.8,
        atlCtlRatio: 1.24,
        formLabel: 'Fatigued (Productive)',
        formTone: 'amber',
        ctlDelta7d: 1.2,
        ctlDelta14d: null,
        ctlDelta28d: null,
        meanTsb14d: -8.2,
        minTsb28d: -10.8,
        historyDays: 2,
        historySufficiency: 'insufficient',
        note: 'Short System C history',
        methodologies: [],
      },
      providerNative: {
        available: true,
        latestDate: '2026-11-18',
        icuCtl: 49.1,
        icuAtl: 54.0,
        icuForm: -4.9,
        recent7dNativeLoad: 138,
        isTssEquivalent: false,
        separationNotice: 'Native Intervals.icu load preserved separately.',
      },
      weeklySeries: [],
      volumeAndConsistency: {
        last7dMiles: 14.2,
        last7dDurationMinutes: 109,
        last7dRunCount: 2,
        lastFullWeekMiles: 34.2,
        lastFullWeekDurationMinutes: 280,
        priorFullWeekMiles: 31.0,
        weekOverWeekMileagePct: 10.3,
        fourWeekAvgMiles: 32.5,
        fourWeekAvgDurationMinutes: 270,
        fourWeekAvgRunsPerWeek: 4.0,
        totalCompletedRuns: 16,
        totalCompletedMiles: 130.0,
        daysSinceLastRun: 1,
        longestGapDaysLast28d: 3,
        consistencyLevel: 'High',
      },
      telemetryAndEfficiency: {
        validHrRuns28d: 14,
        missingHrRuns28d: 1,
        invalidHrRuns28d: 0,
        recent28dEfficiencyFactor: 1.52,
        prior28dEfficiencyFactor: 1.49,
        efficiencyChangePct: 2.0,
      },
      wellnessReadiness: {
        hasWellnessData: true,
        latestDate: '2026-11-18',
        restingHrBpm: 48,
        restingHrBaseline28d: 49,
        hrvRmssd: 66.2,
        hrvBaseline28d: 64.0,
        hrvStatus: 'Balanced',
        sleepHours: 7.8,
        sleepBaseline28d: 7.5,
      },
      missingDataFlags: [],
      coachingSummary: 'Build phase progression with acute load rising.',
      trendInsights: ['4-week volume stable around 32.5 mi/wk.'],
    },
    plannedWorkouts: [
      {
        id: 'pw-1',
        workoutDate: '2026-11-19',
        title: 'Easy Shakeout 5',
        workoutType: 'Easy',
        plannedMiles: 5.0,
        plannedDurationMin: 44,
        targetPaceSecPerMile: 528,
        targetZone: 'Z2',
        sourceProvider: 'coach_entry',
        originalDistanceLabel: null,
        description: null,
        structuredSteps: [],
      },
    ],
    alerts: [
      {
        id: 'alert-load-1',
        severity: 'moderate',
        classification: 'Moderate priority: Monitor',
        domain: 'load',
        category: 'Fatigue / Form Trend',
        title: 'System C TSB at -10.8',
        explanation: 'Acute fatigue rising during Build phase.',
        supportingData: ['CTL 45.1', 'ATL 55.9', 'TSB -10.8'],
        status: 'active',
        resolvedAt: null,
        createdAt: '2026-11-18T12:00:00Z',
      },
      {
        id: 'alert-legacy-compliance',
        severity: 'moderate',
        classification: 'Moderate priority: Monitor',
        domain: 'compliance',
        category: 'Workout Compliance',
        title: 'Legacy compliance alert',
        explanation: 'Should be filtered out by mapper.',
        supportingData: [],
        status: 'active',
        resolvedAt: null,
        createdAt: '2026-11-18T12:00:00Z',
      },
    ],
    weeklyReports: [
      {
        id: 'rep-1',
        weekStartDate: '2026-11-09',
        weekLabel: 'Nov 9–15, 2026',
        actualMiles: 34.2,
        plannedMiles: 36.0,
        weeklyHrStress: 312,
        ctl: 44.1,
        atl: 51.2,
        tsb: -7.1,
        aiSummary: 'Strong aerobic consistency.',
        coachNote: 'Keep Tuesday easy.',
        status: 'Draft',
        approvedAt: null,
        emailDispatchBlocked: true,
        emailDeliveryNote: 'Approval required.',
      },
    ],
  };
}

test('Production Dashboard Mapper: preserves System A/B/C isolation and maps workouts without demo data', () => {
  const pilotData = buildBasePilotData();
  const intelligenceData = buildSampleIntelligence();

  const mapped = mapProductionAthleteToDashboardModel({
    pilotData,
    intelligenceData,
  });

  assert.ok(mapped);
  assert.equal(mapped.id, 'prod-ath-1');
  assert.equal(mapped.productionContext?.isProduction, true);
  assert.equal(mapped.intervalsIcuAthleteId, 'i509214');
  assert.equal(mapped.lthrBpm, 168);

  // Never substitutes demo athlete IDs or synthetic VO2max / goal race
  assert.equal(mapped.id.startsWith('ath-'), false);
  assert.equal(mapped.productionContext?.hasGoalRace, false);
  assert.equal(mapped.productionContext?.hasMaxHr, true);

  // System A native metrics preserved independently from System C
  assert.equal(mapped.productionContext?.providerNative.icuCtl, 49.1);
  assert.equal(mapped.productionContext?.providerNative.icuAtl, 54.0);
  assert.equal(mapped.productionContext?.systemC.ctl, 45.1);
  assert.equal(mapped.productionContext?.systemC.atl, 55.9);
  assert.notEqual(
    mapped.productionContext?.providerNative.icuCtl,
    mapped.productionContext?.systemC.ctl
  );

  // System B per-workout stress preserved & missing HR stays hrDataState: 'missing' with null hrStress
  const tempo = mapped.workouts.find((w) => w.id === 'act-2');
  const noStrap = mapped.workouts.find((w) => w.id === 'act-1');
  const planned = mapped.workouts.find((w) => w.id === 'planned-pw-1');

  assert.equal(tempo?.systemALoad, 91);
  assert.equal(tempo?.stress.hrStress, 84.5);
  assert.equal(tempo?.stress.paceStressProxy, 88.2);
  assert.equal(tempo?.stress.sessionRpeStress, 76.0);
  assert.equal(tempo?.status, 'Completed');

  assert.equal(noStrap?.hrDataState, 'missing');
  assert.equal(noStrap?.stress.hrStress, null);
  assert.equal(noStrap?.stress.paceStressProxy, 54.0);

  assert.equal(planned?.status, 'Planned');
  assert.equal(planned?.actualMiles, 0);
  assert.equal(planned?.plannedMiles, 5.0);
});

test('Production Dashboard Mapper: keeps missing LTHR/pace/wellness honest with zero synthetic backfill', () => {
  const pilotData = buildBasePilotData({
    athlete: {
      id: 'prod-ath-missing',
      fullName: 'Runner Missing Telemetry',
      email: null,
      age: null,
      gender: null,
      location: null,
      trainingGroup: '10K',
      currentPhase: 'Base',
      restingHrBpm: null,
      maxHrBpm: null,
      activeLthrBpm: null,
      thresholdPaceSecPerMile: null,
      optionalThresholdPowerWatts: null,
      sportSpecialization: null,
      dataOrigin: 'live',
      externalAthleteId: 'i999999',
      authorizationStatus: 'Authorized (Read-Only)',
      matchStatus: 'Verified Match',
      latestWeightKg: null,
      updatedAt: '2026-11-18T12:00:00Z',
    },
    wellnessRecords: [],
    dailyLoadHistories: [],
    plannedWorkouts: [],
  });

  const mapped = mapProductionAthleteToDashboardModel({
    pilotData,
    intelligenceData: null,
  });

  assert.ok(mapped);
  assert.equal(mapped.lthrBpm, 0);
  assert.equal(mapped.thresholdPaceSecPerMile, 0);
  assert.equal(mapped.restingHrBpm, 0);
  assert.equal(mapped.maxHrBpm, 0);
  assert.equal(mapped.garminBiometrics.garminVo2Max, 0);
  assert.equal(mapped.lthrHistory.length, 0);
  assert.equal(mapped.productionContext?.wellnessCount, 0);
  assert.equal(mapped.productionContext?.wellnessReadiness.hasWellnessData, false);
  assert.equal(mapped.productionContext?.systemC.available, false);
  assert.equal(mapped.raceHistory.length, 0);
});

test('Production Dashboard Mapper: filters out legacy compliance alerts and maps insights and reports cleanly', () => {
  const pilotData = buildBasePilotData();
  const intelligenceData = buildSampleIntelligence();
  const mapped = mapProductionAthleteToDashboardModel({
    pilotData,
    intelligenceData,
  })!;

  const insight = mapProductionIntelligenceToAICoachingInsight({
    athlete: mapped,
    intelligenceData,
  });

  assert.equal(insight.athleteId, 'prod-ath-1');
  assert.ok(insight.engineLabel.includes('Production'));
  assert.equal(insight.attentionAreas.length, 1);
  assert.equal(insight.attentionAreas[0].id, 'alert-load-1');
  assert.equal(insight.findings?.length, 1);
  assert.equal(insight.findings?.[0].alertId, 'alert-load-1');
  assert.equal(insight.findings?.[0].headline, 'System C TSB at -10.8');

  const mappedReport = mapProductionReportToWeeklyAthleteReport(
    mapped.id,
    intelligenceData.weeklyReports[0]
  );
  assert.equal(mappedReport.isProduction, true);
  assert.equal(mappedReport.weeklyHrStress, 312);
  assert.equal(mappedReport.ctl, 44.1);
  assert.equal(mappedReport.coachNote, 'Keep Tuesday easy.');
  assert.equal('compliancePct' in mappedReport, false);
});
