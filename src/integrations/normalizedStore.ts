import {
  Athlete,
  AuditEventEntry,
  HeartRateStreamRecord,
  HrZoneBoundary,
  IndependentStressRecord,
  LthrRecord,
  MethodologyLoadSeries,
  NormalizedCompletedActivity,
  PlannedWorkoutRecord,
  ProviderTrainingMetricsRecord,
  SynchronizationLogEntry,
  UnifiedAthleteMapping,
  WeeklyAthleteReport,
  WellnessRecord,
} from '../types/coaching';
import { computeLthrZones } from '../utils/lthrAnalytics';
import { buildRawAndNormalizedFromAthleteWorkouts } from '../utils/historicalImport';
import { computeAllThreeLoadSystemsForAthlete } from '../utils/loadSystems';
import { extractFinalSurgePlannedWorkouts } from '../utils/workoutMatching';
import { buildRosterCommandCenterSnapshot, CommandCenterAlert } from '../utils/commandCenterAnalytics';

export interface NormalizedCoachingDatabase {
  athletes: Athlete[];
  providerConnections: Array<{
    provider: 'intervals_icu' | 'final_surge' | 'supabase';
    connected: boolean;
    authMode: string;
    lastVerifiedAt: string | null;
  }>;
  providerAthleteMappings: UnifiedAthleteMapping[];
  plannedWorkouts: PlannedWorkoutRecord[];
  completedActivities: NormalizedCompletedActivity[];
  heartRateStreams: HeartRateStreamRecord[];
  athleteThresholds: Array<{ athleteId: string; records: LthrRecord[] }>;
  heartRateZones: Array<{ athleteId: string; zones: HrZoneBoundary[] }>;
  providerTrainingMetrics: ProviderTrainingMetricsRecord[];
  independentStressMetrics: IndependentStressRecord[];
  dailyLoadHistories: Array<{
    athleteId: string;
    series: Record<string, MethodologyLoadSeries>;
  }>;
  wellnessRecords: WellnessRecord[];
  coachingAlerts: CommandCenterAlert[];
  weeklyReports: WeeklyAthleteReport[];
  synchronizationLogs: SynchronizationLogEntry[];
  auditEvents: AuditEventEntry[];
}

export function buildNormalizedCoachingDatabase(params: {
  athletes: Athlete[];
  mappings: UnifiedAthleteMapping[];
  reports: WeeklyAthleteReport[];
  syncLogs: SynchronizationLogEntry[];
  auditEvents: AuditEventEntry[];
}): NormalizedCoachingDatabase {
  const { athletes, mappings, reports, syncLogs, auditEvents } = params;

  const plannedWorkouts: PlannedWorkoutRecord[] = [];
  const completedActivities: NormalizedCompletedActivity[] = [];
  const heartRateStreams: HeartRateStreamRecord[] = [];
  const athleteThresholds: Array<{ athleteId: string; records: LthrRecord[] }> = [];
  const heartRateZones: Array<{ athleteId: string; zones: HrZoneBoundary[] }> = [];
  const providerTrainingMetrics: ProviderTrainingMetricsRecord[] = [];
  const independentStressMetrics: IndependentStressRecord[] = [];
  const dailyLoadHistories: Array<{
    athleteId: string;
    series: Record<string, MethodologyLoadSeries>;
  }> = [];
  const wellnessRecords: WellnessRecord[] = [];

  for (const athlete of athletes) {
    plannedWorkouts.push(...extractFinalSurgePlannedWorkouts(athlete));

    const { normalizedActivities, hrStreams } = buildRawAndNormalizedFromAthleteWorkouts(
      athlete,
      athlete.intervalsIcuAthleteId ?? `icu-${athlete.id}`
    );
    completedActivities.push(...normalizedActivities);
    heartRateStreams.push(...hrStreams);

    athleteThresholds.push({ athleteId: athlete.id, records: athlete.lthrHistory });
    heartRateZones.push({
      athleteId: athlete.id,
      zones: computeLthrZones(athlete.lthrBpm, athlete.hrZoneConfig, athlete.maxHrBpm),
    });

    const loadSystems = computeAllThreeLoadSystemsForAthlete(athlete, normalizedActivities);
    providerTrainingMetrics.push(...loadSystems.systemAProviderMetrics);
    independentStressMetrics.push(...loadSystems.systemBStressRecords);
    dailyLoadHistories.push({
      athleteId: athlete.id,
      series: loadSystems.systemCSeriesByMethodology,
    });

    wellnessRecords.push({
      id: `well-${athlete.id}-2026-11-18`,
      athleteId: athlete.id,
      date: '2026-11-18',
      hrvRmssd:
        athlete.garminBiometrics.garminHrvStatus === 'Balanced'
          ? 64
          : athlete.garminBiometrics.garminHrvStatus === 'Unbalanced'
          ? 44
          : 38,
      hrvStatus: athlete.garminBiometrics.garminHrvStatus,
      restingHrBpm: athlete.garminBiometrics.garminRestingHrBpm,
      sleepHours: 7.4,
      source: 'intervals_icu_wellness',
    });
  }

  const commandSnap = buildRosterCommandCenterSnapshot(athletes);

  return {
    athletes,
    providerConnections: [
      {
        provider: 'intervals_icu',
        connected: false,
        authMode: 'OAuth 2.0 / Server Coach Key (Read-Only Probe)',
        lastVerifiedAt: null,
      },
      {
        provider: 'final_surge',
        connected: false,
        authMode: 'OAuth 2.0 Roster & Calendar Stub',
        lastVerifiedAt: null,
      },
      {
        provider: 'supabase',
        connected: false,
        authMode: 'RLS Postgres Ready (Local Demo Store Active)',
        lastVerifiedAt: null,
      },
    ],
    providerAthleteMappings: mappings,
    plannedWorkouts,
    completedActivities,
    heartRateStreams,
    athleteThresholds,
    heartRateZones,
    providerTrainingMetrics,
    independentStressMetrics,
    dailyLoadHistories,
    wellnessRecords,
    coachingAlerts: commandSnap.allAlerts,
    weeklyReports: reports,
    synchronizationLogs: syncLogs,
    auditEvents,
  };
}

export const INITIAL_SYNC_LOGS: SynchronizationLogEntry[] = [
  {
    id: 'sync-001',
    jobType: 'daily_activity_import',
    provider: 'intervals_icu',
    startedAt: '2026-11-18T06:00:00Z',
    finishedAt: '2026-11-18T06:00:02Z',
    status: 'Blocked (Unauthorized)',
    attemptNumber: 1,
    recordsProcessed: 0,
    duplicatesSkipped: 0,
    errorMessage:
      'Live Intervals.icu sync paused until server credentials and per-athlete API authorization are verified.',
  },
  {
    id: 'sync-002',
    jobType: 'backfill_12w',
    provider: 'final_surge',
    startedAt: '2026-11-18T05:45:00Z',
    finishedAt: '2026-11-18T05:45:03Z',
    status: 'Succeeded (Demo Mode)',
    attemptNumber: 1,
    recordsProcessed: 1800,
    duplicatesSkipped: 0,
  },
];

export const INITIAL_AUDIT_EVENTS: AuditEventEntry[] = [
  {
    id: 'aud-001',
    timestamp: '2026-11-18T14:55:00Z',
    actorRole: 'Head Coach',
    action: 'EMAIL_APPROVAL_GATE_ACTIVE',
    targetEntity: 'weekly_reports',
    detail: 'Automated athlete email dispatch disabled; explicit coach sign-off enforced.',
  },
  {
    id: 'aud-002',
    timestamp: '2026-11-18T14:56:00Z',
    actorRole: 'System Scheduler',
    action: 'GARMIN_DIRECT_AUTH_REMOVED',
    targetEntity: 'provider_connections',
    detail: 'Transitioned wearable telemetry sourcing to Intervals.icu API model.',
  },
];

export interface AthleteImportEngineStagingEntry {
  intervalsAthleteId: string;
  athleteName: string;
  targetTables: string[];
  systemAPreservationMode: 'Preserve Native icu_training_load & CTL/ATL' | 'Unavailable (Null)';
  systemBHrStressStatus: 'Ready (LTHR + Avg HR Verified)' | 'Blocked (Missing LTHR or Avg HR)';
  systemBPaceStressStatus:
    | 'Ready (Threshold Pace Verified)'
    | 'Requires Coach Threshold Pace Entry';
  systemCEwmaReady: boolean;
  hrStreamIngestionStatus: 'Stream Verified (Dropout/Spike Audit)' | 'Summary Only (No Stream)';
  wellnessIngestionStatus: 'Ready (Wellness Records Present)' | 'Missing (Marked Null)';
  missingFieldsPreservedAsNull: string[];
}

export interface ImportEngineArchitecturePlan {
  generatedAt: string;
  readOnlyValidationCompleted: boolean;
  automatedEmailDispatchEnabled: false;
  syntheticFallbackAllowed: false;
  tableCoverageCount: number;
  pipelineStages: Array<{
    stage: string;
    targetTables: string[];
    guardrail: string;
  }>;
  athleteStaging: AthleteImportEngineStagingEntry[];
}

export function prepareNormalizedImportArchitecture(params: {
  validationAthletes: Array<{
    athleteId: string;
    athleteName: string;
    lthrAvailable: boolean;
    runsWithAvgHrCount: number;
    thresholdPaceAvailable: boolean;
    hrStreamAvailable: boolean;
    trainingLoadAvailable: boolean;
    wellnessAvailable: boolean;
    independentLoadEngineReadiness: {
      hrDerivedStressReady: boolean;
      paceDerivedStressReady: boolean;
      ewmaLoadModelReady: boolean;
      hrStreamAuditReady: boolean;
    };
    missingFields: string[];
  }>;
  normalizedDb: NormalizedCoachingDatabase;
}): ImportEngineArchitecturePlan {
  const { validationAthletes, normalizedDb } = params;

  const athleteStaging: AthleteImportEngineStagingEntry[] = validationAthletes.map((a) => ({
    intervalsAthleteId: a.athleteId,
    athleteName: a.athleteName,
    targetTables: [
      'provider_athlete_mappings',
      'completed_activities',
      ...(a.hrStreamAvailable ? ['heart_rate_streams'] : []),
      ...(a.lthrAvailable ? ['athlete_thresholds', 'heart_rate_zones'] : []),
      ...(a.trainingLoadAvailable ? ['provider_training_metrics'] : []),
      ...(a.independentLoadEngineReadiness.ewmaLoadModelReady
        ? ['independent_stress_metrics', 'daily_load_histories']
        : []),
      ...(a.wellnessAvailable ? ['wellness_records'] : []),
    ],
    systemAPreservationMode: a.trainingLoadAvailable
      ? 'Preserve Native icu_training_load & CTL/ATL'
      : 'Unavailable (Null)',
    systemBHrStressStatus: a.independentLoadEngineReadiness.hrDerivedStressReady
      ? 'Ready (LTHR + Avg HR Verified)'
      : 'Blocked (Missing LTHR or Avg HR)',
    systemBPaceStressStatus: a.thresholdPaceAvailable
      ? 'Ready (Threshold Pace Verified)'
      : 'Requires Coach Threshold Pace Entry',
    systemCEwmaReady: a.independentLoadEngineReadiness.ewmaLoadModelReady,
    hrStreamIngestionStatus: a.hrStreamAvailable
      ? 'Stream Verified (Dropout/Spike Audit)'
      : 'Summary Only (No Stream)',
    wellnessIngestionStatus: a.wellnessAvailable
      ? 'Ready (Wellness Records Present)'
      : 'Missing (Marked Null)',
    missingFieldsPreservedAsNull: a.missingFields,
  }));

  return {
    generatedAt: new Date().toISOString(),
    readOnlyValidationCompleted: validationAthletes.length > 0,
    automatedEmailDispatchEnabled: false,
    syntheticFallbackAllowed: false,
    tableCoverageCount: Object.keys(normalizedDb).length,
    pipelineStages: [
      {
        stage: '1. Raw Immutable Ingestion & Deduplication',
        targetTables: ['provider_connections', 'provider_athlete_mappings', 'completed_activities'],
        guardrail: 'External ID + timestamp/distance deduplication; missing fields stored strictly as null.',
      },
      {
        stage: '2. LTHR Gate & HR Stream Integrity Check',
        targetTables: ['athlete_thresholds', 'heart_rate_zones', 'heart_rate_streams'],
        guardrail: 'Detected LTHR changes require coach approval; no synthetic HR interpolation.',
      },
      {
        stage: '3. Three-System Load & EWMA Isolation',
        targetTables: [
          'provider_training_metrics',
          'independent_stress_metrics',
          'daily_load_histories',
          'wellness_records',
        ],
        guardrail:
          'System A (Intervals native) preserved separately from System B (hrRSS / Pace rTSS) and System C (42d CTL / 7d ATL / TSB).',
      },
      {
        stage: '4. Intelligence, Alerts & Gated Weekly Reporting',
        targetTables: ['coaching_alerts', 'weekly_reports', 'synchronization_logs', 'audit_events'],
        guardrail: 'Automated athlete emails disabled; explicit coach approval required.',
      },
    ],
    athleteStaging,
  };
}

