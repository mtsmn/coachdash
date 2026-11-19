export type TrainingGroup =
  | 'Marathon'
  | 'Half Marathon'
  | '10K / 5K Track'
  | 'Ultra / Trail'
  | 'Base / Return';

export type WorkoutType =
  | 'Easy'
  | 'Long Run'
  | 'Tempo'
  | 'Intervals'
  | 'Recovery'
  | 'Race'
  | 'Rest';

export type WorkoutStatus = 'Completed' | 'Modified' | 'Missed' | 'Planned';

export type IntensityZone = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';

export type AttentionSeverity = 'high' | 'moderate' | 'low';

export type LthrSourceType =
  | 'Garmin Auto-Detected'
  | 'Coach-Approved Manual Fallback';

export interface LthrRecord {
  id: string;
  version: number;
  lthrBpm: number;
  recordedDate: string; // YYYY-MM-DD (Garmin detection date or coach fallback entry date)
  effectiveDate: string; // YYYY-MM-DD
  source: LthrSourceType;
  garminDeviceLabel?: string;
  coachVerified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  optionalThresholdPaceSecPerMile?: number | null;
  optionalThresholdPowerWatts?: number | null;
  notes?: string;
}

export type HrZoneMethodologyId =
  | 'friel_running'
  | 'coggan_endurance'
  | 'polarized_seiler'
  | 'custom';

export interface ZonePctBound {
  zone: IntensityZone;
  name: string;
  minPctLthr: number;
  maxPctLthr: number;
  color: string;
}

export interface HrZoneBoundary extends ZonePctBound {
  minBpm: number;
  maxBpm: number;
}

export interface HrZoneConfig {
  methodology: HrZoneMethodologyId;
  customBoundaries?: ZonePctBound[];
  updatedAt: string;
}

export type HrDataState = 'valid' | 'missing' | 'invalid' | 'rest_zero';

export interface DataProvenance {
  sourceProvider: 'Final Surge (Local Sample)' | 'Garmin (Local Sample)' | 'Coach Entry';
  ingestedAt: string;
  calculationMethod: string;
  thresholdVersion: number;
  thresholdSource: LthrSourceType;
  lthrBpmUsed: number;
  recalculatedAt?: string;
  originalValuesPreserved: boolean;
}

export interface GarminActivityMetrics {
  garminTrainingLoad: number | null;
  aerobicTrainingEffect: number | null;
  anaerobicTrainingEffect: number | null;
  vo2MaxEstimate: number | null;
  recoveryTimeHours: number | null;
  providerLabel: 'Garmin Connect (Original Metric)';
}

export interface GarminAthleteBiometrics {
  garminDetectedLthrBpm: number | null;
  garminLthrDetectedDate: string | null;
  garminLthrDevice: string | null;
  garminVo2Max: number;
  garminHrvStatus: 'Balanced' | 'Unbalanced' | 'Low' | 'Strained';
  garminTrainingStatus: 'Productive' | 'Maintaining' | 'Peaking' | 'Recovery' | 'Strained';
  garminRestingHrBpm: number;
  garmin7DayLoad: number;
  garminAcuteLoad: number;
  garminChronicLoad: number;
  garminLoadFocus: 'Low Aerobic' | 'High Aerobic' | 'Anaerobic' | 'Balanced';
  lastSyncedAt: string;
  providerNote: string;
}

export interface WorkoutStressMetrics {
  hrStress: number | null;
  hrIntensityFactor: number | null;
  paceStressProxy: number | null;
  powerStressProxy: number | null;
  methodologyLabel: 'HR-Derived Running Stress (hrRSS)';
  isTssEquivalent: false;
  thresholdVersionUsed: number;
  lthrBpmUsed: number;
  calculatedAt: string;
}

export interface StressSnapshotRecord {
  id: string;
  recalculatedAt: string;
  previousThresholdVersion: number;
  newThresholdVersion: number;
  previousLthrBpm: number;
  newLthrBpm: number;
  scope: 'all_history' | 'from_effective_date';
  effectiveFromDate: string;
  affectedWorkouts: number;
  previousLastFullWeekStress: number;
  newLastFullWeekStress: number;
  note: string;
}

export interface DailyLoadPoint {
  date: string;
  dayLabel: string;
  hrStress: number;
  garminTrainingLoad: number;
  ctl: number;
  atl: number;
  tsb: number;
  hasMissingOrInvalidHr: boolean;
}

export interface WeeklyLoadPoint {
  weekLabel: string;
  weekIndex: number;
  weeklyHrStress: number;
  weeklyPaceStressProxy: number;
  weeklyPowerStressProxy: number;
  weeklyGarminLoad: number;
  ctlEnd: number;
  atlEnd: number;
  tsbEnd: number;
}

export interface AttentionFlag {
  id: string;
  severity: AttentionSeverity;
  category:
    | 'Workload Spike'
    | 'Recovery / HR Drift'
    | 'Missed Sessions'
    | 'Taper / Race Prep'
    | 'Data Integrity / HR'
    | 'LTHR Source / Approval';
  summary: string;
  metricDetail: string;
}

export interface Workout {
  id: string;
  athleteId: string;
  date: string; // YYYY-MM-DD
  weekIndex: number; // 1 (oldest) to 12 (current week)
  title: string;
  type: WorkoutType;
  status: WorkoutStatus;
  plannedMiles: number;
  actualMiles: number;
  durationMinutes: number;
  avgPaceSecPerMile: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  avgPowerWatts?: number | null;
  rpe: number | null; // 1-10
  elevationGainFt: number;
  zoneBreakdown: Record<IntensityZone, number>;
  hrDataState: HrDataState;
  hrValidationFlags: string[];
  stress: WorkoutStressMetrics;
  garminMetrics?: GarminActivityMetrics;
  provenance: DataProvenance;
  athleteNotes?: string;
  source: 'Final Surge (Local Sample)' | 'Garmin (Local Sample)';
}

export interface RaceResult {
  id: string;
  date: string;
  raceName: string;
  distanceLabel: '5K' | '10K' | 'Half Marathon' | 'Marathon' | '50K';
  distanceMiles: number;
  finishTimeSeconds: number;
  avgPaceSecPerMile: number;
  avgHrBpm: number;
  placementNote: string;
  isPR: boolean;
}

export interface AthleteGoal {
  raceName: string;
  raceDate: string; // YYYY-MM-DD
  distanceLabel: '5K' | '10K' | 'Half Marathon' | 'Marathon' | '50K';
  distanceMiles: number;
  targetTimeSeconds: number;
  priority: 'A' | 'B';
}

export type DataAuthorizationStatus =
  | 'Authorized (Read-Only)'
  | 'Pending Athlete Opt-In'
  | 'Coach View Only (No API Scope)'
  | 'Unlinked'
  | 'Demo Sample';

export interface Athlete {
  id: string;
  finalSurgeId: string;
  intervalsIcuAthleteId?: string | null;
  dataAuthorizationStatus?: DataAuthorizationStatus;
  sportSpecialization?: string;
  name: string;
  email: string;
  age: number;
  gender: 'F' | 'M' | 'NB';
  location: string;
  trainingGroup: TrainingGroup;
  experienceYears: number;
  restingHrBpm: number;
  maxHrBpm: number;
  lthrBpm: number;
  activeThresholdVersion: number;
  lthrHistory: LthrRecord[];
  hrZoneConfig: HrZoneConfig;
  thresholdPaceSecPerMile: number;
  optionalThresholdPowerWatts: number | null;
  currentPhase: 'Base' | 'Build' | 'Peak' | 'Taper' | 'Recovery';
  goal: AthleteGoal;
  coachNotes: string;
  garminBiometrics: GarminAthleteBiometrics;
  recalculationLog: StressSnapshotRecord[];
  workouts: Workout[];
  raceHistory: RaceResult[];
}

export interface WeeklyVolumePoint {
  weekLabel: string;
  weekIndex: number;
  plannedMiles: number;
  actualMiles: number;
  longRunMiles: number;
  compliancePct: number;
  workoutCountCompleted: number;
  workoutCountPlanned: number;
}

export interface PaceHrTrendPoint {
  weekLabel: string;
  weekIndex: number;
  easyAvgPaceSec: number | null;
  easyAvgHr: number | null;
  easyPctLthr: number | null;
  qualityAvgPaceSec: number | null;
  efficiencyFactor: number | null;
}

export interface IntensityDistributionItem {
  zone: IntensityZone;
  label: string;
  percentage: number;
  minutes: number;
  color: string;
  bpmRange: string;
}

export interface RacePrediction {
  distanceLabel: '5K' | '10K' | 'Half Marathon' | 'Marathon';
  estimatedSeconds: number;
  rangeLowSeconds: number;
  rangeHighSeconds: number;
  estimatedPaceSecPerMile: number;
}

export type IntelligenceFindingClassification =
  | 'High priority: Coach review recommended'
  | 'Moderate priority: Monitor'
  | 'Positive development'
  | 'Insufficient data';

export interface CoachingFinding {
  id: string;
  classification: IntelligenceFindingClassification;
  domain:
    | 'Training Load'
    | 'CTL / ATL / TSB'
    | 'Mileage & Consistency'
    | 'LTHR & HR Response'
    | 'Aerobic Efficiency'
    | 'Workout Execution'
    | 'Upcoming Race Demands'
    | 'Data Sufficiency';
  headline: string;
  evidence: string[];
}

export interface AICoachingInsight {
  athleteId: string;
  generatedAt: string;
  engineLabel: string;
  readinessStatus: 'Optimal' | 'Monitor Load' | 'Recovery Focus';
  primaryClassification?: IntelligenceFindingClassification;
  findings?: CoachingFinding[];
  acwr: number;
  ctl: number;
  atl: number;
  tsb: number;
  weekOverWeekChangePct: number;
  lthrContextNote: string;
  trainingProgression: string;
  workoutExecution: string;
  workloadChanges: string;
  recoveryObservations: string;
  attentionAreas: AttentionFlag[];
  raceEstimates: RacePrediction[];
  coachReviewPrompt: string;
  guardrailNotice: string;
}

export type ReportApprovalStatus = 'Draft' | 'Approved' | 'Blocked';

export interface WeeklyAthleteReport {
  athleteId: string;
  weekLabel: string;
  compliancePct: number;
  actualMiles: number;
  plannedMiles: number;
  weeklyHrStress: number;
  ctl: number;
  atl: number;
  tsb: number;
  aiSummary: string;
  coachNote: string;
  status: ReportApprovalStatus;
  approvedAt?: string;
  emailDeliveryNote: string;
}

export interface IntegrationConnectionState {
  id: 'intervals' | 'finalsurge' | 'garmin' | 'supabase' | 'ai';
  name: string;
  role: string;
  connected: boolean;
  modeLabel: string;
  description: string;
  requiredConfig: string[];
}

// --- Stage 3: Unified Identity & Provider Mappings ---
export interface IntervalsCandidateProfile {
  intervalsAthleteId: string;
  name: string;
  email: string | null;
  sport: string;
  authorizationState: DataAuthorizationStatus;
  detectedDevice?: string | null;
  detectedLthrBpm?: number | null;
  lastActivityDate?: string | null;
}

export interface UnifiedAthleteMapping {
  internalAthleteId: string;
  athleteName: string;
  email: string;
  finalSurgeId: string;
  intervalsIcuAthleteId: string | null;
  authorizationStatus: DataAuthorizationStatus;
  matchStatus: 'Verified Match' | 'Candidate Review Required' | 'Unmapped';
  matchMethod:
    | 'Exact Email Match'
    | 'External ID Match'
    | 'Coach Manual Match'
    | 'Name-Only Blocked (Manual Review Required)'
    | 'Unmatched';
  matchConfidencePct: number;
  candidateIntervalsProfile?: IntervalsCandidateProfile | null;
  note: string;
  updatedAt: string;
}

// --- Stage 4: Raw vs. Normalized Historical Import, HR Streams & Threshold Gate ---
export interface RawProviderActivity {
  rawId: string;
  provider: 'intervals_icu';
  externalActivityId: string;
  intervalsAthleteId: string;
  fetchedAt: string;
  sourceDevice: string;
  payload: {
    start_date_local: string;
    name: string;
    type: string;
    moving_time: number;
    distance: number; // meters
    average_hr: number | null;
    max_hr: number | null;
    average_watts: number | null;
    total_elevation_gain: number; // meters
    icu_training_load: number | null;
    icu_ctl: number | null;
    icu_atl: number | null;
    session_rpe: number | null;
    detected_lthr?: number | null;
  };
}

export interface HeartRateStreamRecord {
  activityId: string;
  athleteId: string;
  sampleIntervalSec: number;
  hrBpmStream: number[];
  validSamplePct: number;
  dropoutCount: number;
  spikeCount: number;
}

export interface NormalizedCompletedActivity {
  id: string;
  athleteId: string;
  externalActivityId: string;
  provider: 'final_surge' | 'intervals_icu';
  sourceDevice: string;
  date: string;
  startTimeLocal: string; // HH:MM
  title: string;
  activityType: WorkoutType;
  durationMinutes: number;
  distanceMiles: number;
  avgPaceSecPerMile: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  avgPowerWatts: number | null;
  elevationGainFt: number;
  rpe: number | null;
  hrDataState: HrDataState;
  hrValidationFlags: string[];
  rawRecordId: string;
}

export interface ThresholdApprovalCandidate {
  id: string;
  athleteId: string;
  athleteName: string;
  currentLthrBpm: number;
  proposedLthrBpm: number;
  deltaBpm: number;
  detectedDate: string;
  sourceDevice: string;
  provider: 'Intervals.icu (Garmin LTHR)';
  status: 'Pending Coach Approval' | 'Approved' | 'Rejected';
  reason: string;
}

export interface ImportBatchReport {
  batchId: string;
  executedAt: string;
  windowStart: string;
  windowEnd: string;
  mode: 'incremental' | 'backfill_12_week';
  totalFetched: number;
  newNormalizedCount: number;
  duplicatesSkipped: number;
  unauthorizedBlocked: number;
  missingHrCount: number;
  invalidHrQuarantined: number;
  lthrChangeCandidates: ThresholdApprovalCandidate[];
  notes: string[];
}

// --- Stage 5: 3 Independent Training Load Systems (A, B, C) ---
export interface ProviderTrainingMetricsRecord {
  activityId: string;
  athleteId: string;
  date: string;
  provider: 'intervals_icu';
  icuTrainingLoad: number | null;
  icuFitness: number | null;
  icuFatigue: number | null;
  icuForm: number | null;
  originalValuesPreserved: true;
}

export type StressMethodologyId =
  | 'hr_derived_stress'
  | 'running_tss_pace'
  | 'running_power_stress'
  | 'session_rpe_stress';

export interface IndependentStressRecord {
  activityId: string;
  athleteId: string;
  date: string;
  hrRunningStress: number | null; // System B1: LTHR-anchored hrRSS (not official TP TSS)
  paceRunningStress: number | null; // System B2: Threshold-pace Running TSS
  powerRunningStress: number | null; // System B3: Threshold-power Running Stress
  sessionRpeStress: number | null; // System B4: Session RPE * duration stress
  rpeMethodLabel: 'Session RPE (Duration × RPE)';
}

export interface DailyMethodologyLoadPoint {
  date: string;
  dailyStress: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface MethodologyLoadSeries {
  methodology: StressMethodologyId;
  label: string;
  ctlTimeConstantDays: number;
  atlTimeConstantDays: number;
  daily: DailyMethodologyLoadPoint[];
  latestCtl: number;
  latestAtl: number;
  latestTsb: number;
}

export interface WellnessRecord {
  id: string;
  athleteId: string;
  date: string;
  hrvRmssd: number | null;
  hrvStatus: GarminAthleteBiometrics['garminHrvStatus'];
  restingHrBpm: number | null;
  sleepHours: number | null;
  source: 'intervals_icu_wellness';
}

// --- Stage 6: Final Surge Planned Workouts vs. Intervals.icu Completed Matching ---
export interface PlannedWorkoutRecord {
  id: string;
  athleteId: string;
  finalSurgeWorkoutId: string;
  date: string;
  plannedStartTime: string; // HH:MM
  title: string;
  workoutType: WorkoutType;
  plannedMiles: number;
  plannedDurationMin: number;
  targetPaceSecPerMile: number | null;
  targetZone: IntensityZone;
}

export type WorkoutMatchStatus =
  | 'Auto-Matched'
  | 'Needs Coach Review'
  | 'Missed Workout'
  | 'Missing Telemetry'
  | 'Unplanned Activity';

export interface WorkoutMatchRecord {
  id: string;
  athleteId: string;
  athleteName: string;
  date: string;
  plannedWorkout: PlannedWorkoutRecord | null;
  completedActivity: NormalizedCompletedActivity | null;
  matchStatus: WorkoutMatchStatus;
  matchScore: number; // 0-100
  matchReasons: string[];
  distanceDeltaMiles: number | null;
  durationDeltaMin: number | null;
  paceDeltaSecPerMile: number | null;
  hrDeltaFromTargetZoneBpm: number | null;
  intensityComparison: string;
  coachReviewed: boolean;
}

// --- Stage 7 & 11-12: Automation Logs, Audit Events & Normalized 16-Table Store ---
export interface SynchronizationLogEntry {
  id: string;
  jobType: 'daily_activity_import' | 'daily_metric_update' | 'backfill_12w' | 'retry_sync';
  provider: 'intervals_icu' | 'final_surge';
  startedAt: string;
  finishedAt: string;
  status: 'Succeeded (Demo Mode)' | 'Retried & Queued' | 'Blocked (Unauthorized)' | 'Failed';
  attemptNumber: number;
  recordsProcessed: number;
  duplicatesSkipped: number;
  errorMessage?: string;
}

export interface AuditEventEntry {
  id: string;
  timestamp: string;
  actorRole: 'Head Coach' | 'Assistant Coach' | 'System Scheduler';
  action: string;
  targetEntity: string;
  detail: string;
}

