import { IntegrationConnectionState, IntervalsCandidateProfile } from '../types/coaching';

export interface ServerIntervalsStatus {
  hasOAuthClient: boolean;
  hasApiKey: boolean;
  hasActiveSession: boolean;
  authMethod: 'oauth2' | 'api_key' | 'unconfigured';
  authMechanism?: 'coach_app_oauth' | 'coach_api_key' | 'unconfigured';
  authPriority?: string;
  oauthRequired?: boolean;
  onlyRequiredCredential?: string;
  readOnlyMode?: boolean;
  requiresIndividualAthleteKeys?: boolean;
  pilotTestSucceeded?: boolean;
  verifiedPilotAthleteId?: string | null;
  fullRosterSyncAllowed?: boolean;
  lastPilotCheckAt?: string | null;
  requestedScopes: string[];
  coachAccountIdentity: string | null;
  coachAthleteId: string | null;
  lastSynchronizedAt: string | null;
  recentSyncErrors: string[];
  connected: boolean;
  directGarminAuthRequired: boolean;
  garminNote: string;
}

export interface PilotVerificationStep {
  id:
    | 'coach_auth'
    | 'coaching_roster'
    | 'shared_athlete_access'
    | 'running_activities'
    | 'hr_and_lthr'
    | 'training_load';
  label: string;
  endpoint: string;
  status: 'Passed' | 'Failed' | 'Blocked';
  detail: string;
}

export interface IntervalsDataPermissionItem {
  permissionKey:
    | 'coach_account_info'
    | 'shared_athlete_roster'
    | 'pilot_completed_activities'
    | 'pilot_heart_rate'
    | 'pilot_lthr_and_zones'
    | 'pilot_wellness_and_load'
    | 'pilot_calendar_events';
  label: string;
  available: boolean;
  accessState: 'Verified Read-Only' | 'Denied / Unavailable' | 'Unverified';
  detail: string;
}

export interface CoachedAthleteVerificationItem {
  id: string;
  name: string;
  verificationStatus:
    | 'Verified Read-Only'
    | 'Permission Denied'
    | 'Unverified (Demo Mode Retained)';
}

export interface ServerPilotConnectionTestResult {
  configured: boolean;
  connected: boolean;
  authMechanism: 'coach_app_oauth' | 'coach_api_key' | 'unconfigured';
  oauthRequired: false;
  readOnlyMode: true;
  demoModeFallbackActive: boolean;
  requiresIndividualAthleteKeys: false;
  pilotTestSucceeded: boolean;
  fullRosterSyncAllowed: boolean;
  coachAccountIdentity: string | null;
  coachAthleteId: string | null;
  coachAccountInfo: {
    id: string;
    name: string;
    email: string | null;
    timezone: string | null;
  } | null;
  rosterCount: number;
  coachedAthletes: CoachedAthleteVerificationItem[];
  selectedPilotAthlete: {
    id: string;
    name: string;
    authorizationMethod: string;
  } | null;
  steps: PilotVerificationStep[];
  dataPermissions: IntervalsDataPermissionItem[];
  pilotMetricsSummary: {
    totalCompletedActivityCount: number;
    runningActivityCount: number;
    latestRunDate: string | null;
    latestRunType: string | null;
    activitiesWithHrCount: number;
    latestAvgHrBpm: number | null;
    detectedLthrBpm: number | null;
    lthrSource: string | null;
    hrZoneCount: number;
    latestIcuTrainingLoad: number | null;
    latestIcuCtl: number | null;
    latestIcuAtl: number | null;
    recentRuns: Array<{
      id: string;
      date: string;
      name: string;
      type: string;
      distanceMiles: number;
      durationMinutes: number;
      avgHrBpm: number | null;
      maxHrBpm: number | null;
      icuTrainingLoad: number | null;
    }>;
  };
  errors: string[];
  checkedAt: string;
  modeLabel: string;
}

export interface AthleteDeepTelemetryValidation {
  athleteId: string;
  athleteName: string;
  isPilotAthlete: boolean;
  profileAccessible: boolean;
  sportSettingsFound: boolean;
  lthrAvailable: boolean;
  detectedLthrBpm: number | null;
  lthrSource: string | null;
  hrZonesAvailable: boolean;
  hrZoneCount: number;
  hrZones: number[];
  thresholdPaceAvailable: boolean;
  thresholdPowerAvailable: boolean;
  windowStartDate: string;
  windowEndDate: string;
  totalActivitiesCount: number;
  runningActivitiesCount: number;
  earliestRunDate: string | null;
  latestRunDate: string | null;
  coverageDays: number;
  coverageWeeks: number;
  runsWithAvgHrCount: number;
  runsWithMaxHrCount: number;
  hrCoveragePct: number;
  latestAvgHrBpm: number | null;
  latestMaxHrBpm: number | null;
  hrStreamCheckedActivityId: string | null;
  hrStreamAvailable: boolean;
  hrStreamSampleCount: number;
  hrStreamStatus: 'Verified Read-Only' | 'Unavailable / Empty' | 'Not Checked (No Runs)' | 'Blocked';
  hrStreamDetail: string;
  trainingLoadAvailable: boolean;
  runsWithLoadCount: number;
  latestIcuTrainingLoad: number | null;
  wellnessAvailable: boolean;
  wellnessRecordsCount: number;
  ctlAtlAvailable: boolean;
  latestCtl: number | null;
  latestAtl: number | null;
  nativeTsb: number | null;
  hrvAvailable: boolean;
  latestHrv: number | null;
  restingHrAvailable: boolean;
  latestRestingHr: number | null;
  sleepAvailable: boolean;
  latestSleepHours: number | null;
  missingFields: string[];
  dataQualityTier:
    | 'Full Telemetry Ready'
    | 'Partial Telemetry (Usable)'
    | 'Limited / Missing Critical Telemetry'
    | 'Permission Denied';
  verificationStatus:
    | 'Verified Read-Only · Pilot Baseline'
    | 'Verified Read-Only · Full Telemetry'
    | 'Verified Read-Only · Partial Telemetry'
    | 'Verified Read-Only · Missing Critical Telemetry'
    | 'Permission Denied';
  independentLoadEngineReadiness: {
    hrDerivedStressReady: boolean;
    paceDerivedStressReady: boolean;
    ewmaLoadModelReady: boolean;
    hrStreamAuditReady: boolean;
  };
  lastSyncedAt: string;
  notes: string[];
}

export interface RosterDeepTelemetryValidationReport {
  configured: boolean;
  connected: boolean;
  readOnlyMode: true;
  oauthRequired: false;
  windowDays: number;
  windowStartDate: string;
  windowEndDate: string;
  coachAccountInfo: {
    id: string;
    name: string;
    email: string | null;
    timezone: string | null;
  } | null;
  totalCoachedAthletes: number;
  summary: {
    fullTelemetryReadyCount: number;
    partialTelemetryCount: number;
    limitedTelemetryCount: number;
    permissionDeniedCount: number;
    lthrAvailableCount: number;
    hrStreamsAvailableCount: number;
    trainingLoadAvailableCount: number;
    wellnessAvailableCount: number;
    totalRunningActivities: number;
    hrDerivedEngineReadyCount: number;
  };
  athletes: AthleteDeepTelemetryValidation[];
  checkedAt: string;
  errors: string[];
}

export interface ServerIntervalsProbeResult {
  configured: boolean;
  connected: boolean;
  authMethod: 'oauth2' | 'api_key' | 'unconfigured';
  coachAccountIdentity: string | null;
  coachAthleteId: string | null;
  authorizedAthleteCount: number;
  visibleCoachAthletesCount: number;
  lastSynchronizedAt: string | null;
  syncErrors: string[];
  permissionIssues: string[];
  athletePermissions: Array<{
    athleteId: string;
    athleteName: string;
    email: string | null;
    activityRead: boolean;
    wellnessRead: boolean;
    calendarRead: boolean;
    authorizationState:
      | 'Authorized (Read-Only)'
      | 'Coach View Only (No API Scope)'
      | 'Permission Denied';
    diagnosticMessage: string;
  }>;
  requestedScopes: string[];
  modeLabel: string;
}

export interface ServerFullStatusEnvelope {
  auth?: {
    supabaseConfigured: boolean;
    tokenEncryptionConfigured: boolean;
    authenticated: boolean;
    coach: {
      id: string;
      email: string;
      fullName: string;
      organizationName: string;
      role: 'owner_coach';
    } | null;
  };
  intervalsIcu?: ServerIntervalsStatus;
  database?: {
    configured: boolean;
    connected: boolean;
    detail?: string;
    mode: string;
  };
}

export interface PilotSyncResponse {
  ok: boolean;
  statusCode: number;
  blockedByPilotGate: boolean;
  status:
    | 'Queued'
    | 'Running'
    | 'Succeeded'
    | 'Partial'
    | 'Retried & Queued'
    | 'Blocked (Unauthorized)'
    | 'Failed';
  syncLogId: string | null;
  jobType: string;
  syncMode: 'initial' | 'incremental';
  pilotAthleteId: string | null;
  internalAthleteId: string | null;
  athleteName: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  chunksQueried: number;
  activitiesFetched: number;
  activitiesProcessed: number;
  duplicatesSkipped: number;
  streamsImported: number;
  streamsMissing: number;
  streamsUnavailable: number;
  wellnessProcessed: number;
  dailyLoadPointsWritten: number;
  warnings: string[];
  errorMessage: string | null;
  synchronizedAt: string;
}

export type RosterDisplayStatusDto =
  | 'Not mapped'
  | 'Awaiting coach review'
  | 'Ready to sync'
  | 'Synchronizing'
  | 'Succeeded'
  | 'Partially succeeded'
  | 'Failed'
  | 'Permission unavailable';

export interface RosterAthleteSyncOutcome {
  externalAthleteId: string;
  internalAthleteId: string | null;
  athleteName: string | null;
  isPilotAthlete: boolean;
  status:
    | 'Succeeded'
    | 'Partial'
    | 'Permission Denied'
    | 'Failed'
    | 'Not mapped'
    | 'Awaiting coach review';
  syncMode: 'initial' | 'incremental';
  authorizationStatus: string;
  windowStart: string | null;
  windowEnd: string | null;
  chunksQueried: number;
  activitiesFetched: number;
  activitiesProcessed: number;
  activitiesRemoved?: number;
  duplicatesSkipped: number;
  streamsImported: number;
  streamsMissing: number;
  streamsUnavailable: number;
  wellnessProcessed: number;
  dailyLoadPointsWritten: number;
  warnings: string[];
  errorMessage: string | null;
}

export interface FullRosterSyncResponse {
  ok: boolean;
  statusCode: number;
  blockedByPilotGate: boolean;
  status:
    | 'Queued'
    | 'Running'
    | 'Succeeded'
    | 'Partial'
    | 'Retried & Queued'
    | 'Blocked (Unauthorized)'
    | 'Failed';
  syncLogId: string | null;
  jobType: string;
  syncModeRequested: 'auto' | 'initial' | 'incremental';
  verifiedPilotAthleteId: string | null;
  externalCoachId: string | null;
  totalAthletesInRoster: number;
  athletesAttempted: number;
  athletesSucceededCount: number;
  athletesPartialCount: number;
  permissionDeniedCount: number;
  athletesFailedCount: number;
  unmappedSkippedCount?: number;
  totalActivitiesFetched: number;
  totalActivitiesProcessed: number;
  totalActivitiesRemoved?: number;
  totalDuplicatesSkipped: number;
  totalStreamsImported: number;
  totalStreamsMissing: number;
  totalStreamsUnavailable: number;
  totalWellnessProcessed: number;
  dailyLoadPointsWritten: number;
  athleteResults: RosterAthleteSyncOutcome[];
  warnings: string[];
  errorMessage: string | null;
  synchronizedAt: string;
}

export interface IntervalsAthleteSyncHistoryDto {
  id: string;
  syncLogId: string | null;
  status: string;
  syncMode: string;
  activitiesProcessed: number;
  duplicatesSkipped: number;
  streamsImported: number;
  wellnessProcessed: number;
  windowStart: string | null;
  windowEnd: string | null;
  errorMessage: string | null;
  occurredAt: string;
}

export interface IntervalsRosterCandidateMatchDto {
  athleteId: string;
  fullName: string;
  email: string | null;
  reason: string;
}

export interface IntervalsPermissionCapabilitiesDto {
  settings: 'granted' | 'denied' | 'unknown';
  activities: 'granted' | 'denied' | 'unknown';
  wellness: 'granted' | 'denied' | 'unknown';
}

export interface IntervalsRosterAthleteRowDto {
  externalAthleteId: string;
  athleteName: string;
  email: string | null;
  location: string | null;
  internalAthleteId: string | null;
  isPilotAthlete: boolean;
  mappingStatus: 'Verified Match' | 'Candidate Review Required' | 'Unmapped';
  matchMethod: string;
  sharingPermissionStatus:
    | 'Authorized (Read-Only)'
    | 'Partial Permissions'
    | 'Permission unavailable'
    | 'Pending Review'
    | 'Unknown (Not Yet Probed)';
  permissionCapabilities?: IntervalsPermissionCapabilitiesDto;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  activitiesImportedCount: number;
  hrStreamsImportedCount: number;
  wellnessRecordsImportedCount: number;
  currentSyncStatus: RosterDisplayStatusDto;
  mostRecentError: string | null;
  eligibleForSync: boolean;
  candidateMatches: IntervalsRosterCandidateMatchDto[];
  syncHistory: IntervalsAthleteSyncHistoryDto[];
}

export interface RosterLiveProgressDto {
  running: boolean;
  mode: string;
  totalSelected: number;
  completedCount: number;
  activeAthleteIds: string[];
  startedAt: string;
}

export interface IntervalsRosterOverviewDto {
  ok: boolean;
  statusCode: number;
  blockedByPilotGate: boolean;
  errorMessage: string | null;
  verifiedPilotAthleteId: string | null;
  externalCoachId: string | null;
  excludedCoachIds: string[];
  pagesFetched: number;
  fetchedAt: string;
  lastFullRosterSyncAt: string | null;
  liveProgress: RosterLiveProgressDto | null;
  summary: {
    totalSharedAthletes: number;
    mappedAthletes: number;
    unmappedAthletes: number;
    awaitingReviewCount: number;
    eligibleAthletes: number;
    succeededCount: number;
    partialCount: number;
    failedCount: number;
    permissionUnavailableCount: number;
    synchronizingCount: number;
  };
  athletes: IntervalsRosterAthleteRowDto[];
  existingAthletes: Array<{
    id: string;
    fullName: string;
    email: string | null;
    alreadyMappedToExternalId: string | null;
  }>;
  warnings: string[];
}

export interface ResolveIntervalsMappingPayload {
  action: 'link_existing' | 'create_and_link' | 'confirm_candidate' | 'leave_unmapped';
  externalAthleteId: string;
  athleteId?: string;
}

export interface ResolveIntervalsMappingResponseDto {
  ok: boolean;
  statusCode: number;
  action: ResolveIntervalsMappingPayload['action'];
  externalAthleteId: string;
  internalAthleteId: string | null;
  athleteName: string | null;
  mappingStatus: 'Verified Match' | 'Candidate Review Required' | 'Unmapped';
  message: string;
}

export interface ProductionPilotDashboardResponse {
  configured: boolean;
  hasPersistedPilot: boolean;
  connection: {
    connected: boolean;
    authMode: string;
    pilotTestSucceeded: boolean;
    verifiedPilotAthleteId: string | null;
    externalCoachId: string | null;
    externalCoachName: string | null;
    lastVerifiedAt: string | null;
    lastSynchronizedAt: string | null;
  } | null;
  availableAthletes?: Array<{
    id: string;
    fullName: string;
    externalAthleteId: string | null;
    authorizationStatus: string | null;
    matchStatus: string | null;
    isPilotAthlete: boolean;
    dataOrigin: string;
  }>;
  rosterOverview?: {
    totalSharedAthletes: number;
    mappedAthletes: number;
    unmappedAthletes: number;
    awaitingReviewCount: number;
    eligibleAthletes: number;
    succeededCount: number;
    partialCount: number;
    failedCount: number;
    permissionUnavailableCount: number;
    lastFullRosterSyncAt: string | null;
    liveProgress: RosterLiveProgressDto | null;
    athletes: Array<{
      internalAthleteId: string;
      externalAthleteId: string | null;
      fullName: string;
      isPilotAthlete: boolean;
      mappingStatus: string;
      authorizationStatus: string;
      currentSyncStatus: RosterDisplayStatusDto;
      lastSuccessfulSyncAt: string | null;
      lastAttemptedSyncAt: string | null;
      activitiesCount: number;
      hrStreamsCount: number;
      wellnessCount: number;
      mostRecentError: string | null;
    }>;
  };
  athlete: {
    id: string;
    fullName: string;
    email: string | null;
    age: number | null;
    gender: string | null;
    location: string | null;
    trainingGroup: string;
    currentPhase: string;
    restingHrBpm: number | null;
    maxHrBpm: number | null;
    activeLthrBpm: number | null;
    thresholdPaceSecPerMile: number | null;
    optionalThresholdPowerWatts: number | null;
    sportSpecialization: string | null;
    dataOrigin: string;
    externalAthleteId: string | null;
    authorizationStatus: string | null;
    matchStatus: string | null;
    latestWeightKg: number | null;
    updatedAt: string | null;
  } | null;
  activities: Array<{
    id: string;
    externalActivityId: string;
    provider: string;
    sourceDevice: string | null;
    activityDate: string;
    startTimeLocal: string | null;
    title: string;
    activityType: string;
    status: string;
    durationMinutes: number;
    distanceMiles: number;
    avgPaceSecPerMile: number | null;
    avgHrBpm: number | null;
    maxHrBpm: number | null;
    avgPowerWatts: number | null;
    elevationGainFt: number | null;
    rpe: number | null;
    hrDataState: 'valid' | 'missing' | 'invalid' | 'rest_zero';
    hrValidationFlags: string[];
    streamStatus: 'imported' | 'missing' | 'unavailable' | 'not_applicable';
    hrStreamSampleCount: number | null;
    hrStreamValidPct: number | null;
    hrStreamSampleIntervalSec: number | null;
    icuTrainingLoad: number | null;
    icuFitness: number | null;
    icuFatigue: number | null;
    icuForm: number | null;
    hrRunningStress: number | null;
    paceRunningStress: number | null;
    powerRunningStress: number | null;
    sessionRpeStress: number | null;
  }>;
  plannedWorkouts?: Array<{
    id: string;
    workoutDate: string;
    title: string;
    workoutType: string;
    plannedMiles: number;
    plannedDurationMin: number;
    targetPaceSecPerMile: number | null;
    targetZone: string | null;
    sourceProvider: string | null;
  }>;
  wellnessRecords: Array<{
    id: string;
    recordDate: string;
    source: string;
    restingHrBpm: number | null;
    hrvRmssd: number | null;
    hrvStatus: string | null;
    sleepHours: number | null;
    icuCtl: number | null;
    icuAtl: number | null;
    icuTsb: number | null;
    weightKg: number | null;
    fatigue: number | null;
    soreness: number | null;
    mood: number | null;
    motivation: number | null;
    stress: number | null;
    sleepScore: number | null;
    readiness: number | null;
    rampRate: number | null;
  }>;
  dailyLoadHistories: Array<{
    methodology: string;
    loadDate: string;
    dailyStress: number;
    ctl: number;
    atl: number;
    tsb: number;
    hasMissingOrInvalidHr: boolean;
  }>;
  syncLogs: Array<{
    id: string;
    jobType: string;
    provider: string;
    status: string;
    attemptNumber: number;
    recordsProcessed: number;
    duplicatesSkipped: number;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
  error?: string;
}

function buildAuthHeaders(
  accessToken?: string | null,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (accessToken?.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

export class IntervalsIcuAdapter {
  getConnectionInfo(serverStatus?: ServerIntervalsStatus | null): IntegrationConnectionState {
    const isConnected = Boolean(serverStatus?.connected);
    return {
      id: 'intervals',
      name: 'Intervals.icu API (Optional · Personal API Key)',
      role: 'Optional Read-Only Source · Completed Runs, HR Telemetry, LTHR & Native Load',
      connected: isConnected,
      modeLabel: isConnected
        ? `Connected Read-Only (${
            serverStatus?.authMethod === 'oauth2'
              ? 'Optional OAuth 2.0'
              : 'Personal API Key · No OAuth Required'
          })`
        : 'Optional Read-Only · Set INTERVALS_ICU_API_KEY (Demo Mode Active)',
      description:
        'Connects read-only with your server-side INTERVALS_ICU_API_KEY without requiring OAuth client IDs, secrets, or redirect URIs. Unverified athletes stay in Demo Mode.',
      requiredConfig: [
        'INTERVALS_ICU_API_KEY (Only Required Credential)',
        'INTERVALS_ICU_CLIENT_ID (Optional OAuth)',
        'INTERVALS_ICU_CLIENT_SECRET (Optional OAuth)',
      ],
    };
  }

  async fetchServerStatusEnvelope(
    accessToken?: string | null
  ): Promise<ServerFullStatusEnvelope | null> {
    try {
      const res = await fetch('/api/integrations/status', {
        headers: buildAuthHeaders(accessToken),
      });
      if (!res.ok) return null;
      return (await res.json()) as ServerFullStatusEnvelope;
    } catch {
      return null;
    }
  }

  async fetchServerIntegrationStatus(
    accessToken?: string | null
  ): Promise<ServerIntervalsStatus | null> {
    const env = await this.fetchServerStatusEnvelope(accessToken);
    return env?.intervalsIcu ?? null;
  }

  async runPilotConnectionTest(
    pilotAthleteId?: string,
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<ServerPilotConnectionTestResult> {
    try {
      const res = await fetch('/api/integrations/intervals/pilot-test', {
        method: 'POST',
        headers: buildAuthHeaders(accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          pilotAthleteId: pilotAthleteId?.trim() || undefined,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: authenticated user is not the Mythical Mile owner coach (HTTP 403).';
        onAuthError?.(res.status, msg);
        throw new Error(msg);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as ServerPilotConnectionTestResult;
    } catch (err) {
      return {
        configured: false,
        connected: false,
        authMechanism: 'unconfigured',
        oauthRequired: false,
        readOnlyMode: true,
        demoModeFallbackActive: true,
        requiresIndividualAthleteKeys: false,
        pilotTestSucceeded: false,
        fullRosterSyncAllowed: false,
        coachAccountIdentity: null,
        coachAthleteId: null,
        coachAccountInfo: null,
        rosterCount: 0,
        coachedAthletes: [],
        selectedPilotAthlete: null,
        steps: [
          {
            id: 'coach_auth',
            label: '1. Coach account authentication',
            endpoint: 'GET /api/v1/athlete/0',
            status: 'Failed',
            detail:
              err instanceof Error
                ? err.message
                : 'Unable to reach /api/integrations/intervals/pilot-test',
          },
          {
            id: 'coaching_roster',
            label: '2. Access to coaching roster',
            endpoint: 'GET /api/v1/athlete/0/athlete-summary.json',
            status: 'Blocked',
            detail: 'Blocked.',
          },
          {
            id: 'shared_athlete_access',
            label: '3. Access to an authorized shared athlete',
            endpoint: 'GET /api/v1/athlete/{pilotAthleteId}',
            status: 'Blocked',
            detail: 'Blocked.',
          },
          {
            id: 'running_activities',
            label: '4. Retrieval of completed running activities',
            endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/activities',
            status: 'Blocked',
            detail: 'Blocked.',
          },
          {
            id: 'hr_and_lthr',
            label: '5. Retrieval of heart-rate and LTHR data',
            endpoint: 'GET /api/v1/athlete/{pilotAthleteId} + activities',
            status: 'Blocked',
            detail: 'Blocked.',
          },
          {
            id: 'training_load',
            label: '6. Retrieval of training load metrics',
            endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/wellness + activities',
            status: 'Blocked',
            detail: 'Blocked.',
          },
        ],
        dataPermissions: [
          {
            permissionKey: 'coach_account_info',
            label: 'Coach Account Information',
            available: false,
            accessState: 'Unverified',
            detail: err instanceof Error ? err.message : 'Backend endpoint unreachable.',
          },
        ],
        pilotMetricsSummary: {
          totalCompletedActivityCount: 0,
          runningActivityCount: 0,
          latestRunDate: null,
          latestRunType: null,
          activitiesWithHrCount: 0,
          latestAvgHrBpm: null,
          detectedLthrBpm: null,
          lthrSource: null,
          hrZoneCount: 0,
          latestIcuTrainingLoad: null,
          latestIcuCtl: null,
          latestIcuAtl: null,
          recentRuns: [],
        },
        errors: [
          err instanceof Error
            ? err.message
            : 'Backend pilot endpoint unreachable or unconfigured.',
        ],
        checkedAt: new Date().toISOString(),
        modeLabel: 'Disconnected · Coach Sign-In Required or Backend Unconfigured',
      };
    }
  }

  async runReadOnlyConnectionTest(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<ServerIntervalsProbeResult> {
    try {
      const res = await fetch('/api/integrations/intervals/test', {
        method: 'POST',
        headers: buildAuthHeaders(accessToken, { 'Content-Type': 'application/json' }),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: authenticated user is not the Mythical Mile owner coach (HTTP 403).';
        onAuthError?.(res.status, msg);
        throw new Error(msg);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as ServerIntervalsProbeResult;
    } catch (err) {
      return {
        configured: false,
        connected: false,
        authMethod: 'unconfigured',
        coachAccountIdentity: null,
        coachAthleteId: null,
        authorizedAthleteCount: 0,
        visibleCoachAthletesCount: 0,
        lastSynchronizedAt: null,
        syncErrors: [
          err instanceof Error ? err.message : 'Unable to reach backend /api/integrations/intervals/test',
        ],
        permissionIssues: [
          err instanceof Error
            ? err.message
            : 'Server endpoint unreachable or unconfigured.',
        ],
        athletePermissions: [],
        requestedScopes: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
        modeLabel: 'Disconnected · Authentication Required or Probe Unavailable',
      };
    }
  }

  async runFullRosterDeepTelemetryValidation(
    pilotAthleteId?: string,
    windowDays = 90,
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<RosterDeepTelemetryValidationReport> {
    try {
      const res = await fetch('/api/integrations/intervals/validate-roster', {
        method: 'POST',
        headers: buildAuthHeaders(accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          pilotAthleteId: pilotAthleteId?.trim() || undefined,
          windowDays,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: authenticated user is not the Mythical Mile owner coach (HTTP 403).';
        onAuthError?.(res.status, msg);
        throw new Error(msg);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as RosterDeepTelemetryValidationReport;
    } catch (err) {
      const today = new Date().toISOString().slice(0, 10);
      return {
        configured: false,
        connected: false,
        readOnlyMode: true,
        oauthRequired: false,
        windowDays,
        windowStartDate: today,
        windowEndDate: today,
        coachAccountInfo: null,
        totalCoachedAthletes: 0,
        summary: {
          fullTelemetryReadyCount: 0,
          partialTelemetryCount: 0,
          limitedTelemetryCount: 0,
          permissionDeniedCount: 0,
          lthrAvailableCount: 0,
          hrStreamsAvailableCount: 0,
          trainingLoadAvailableCount: 0,
          wellnessAvailableCount: 0,
          totalRunningActivities: 0,
          hrDerivedEngineReadyCount: 0,
        },
        athletes: [],
        checkedAt: new Date().toISOString(),
        errors: [
          err instanceof Error
            ? err.message
            : 'Unable to reach /api/integrations/intervals/validate-roster.',
        ],
      };
    }
  }

  async getOAuthAuthorizeUrl(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<{
    configured: boolean;
    authorizeUrl: string | null;
    missingVars: string[];
    authError?: string;
  }> {
    try {
      const res = await fetch('/api/integrations/intervals/oauth/url', {
        headers: buildAuthHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Please sign in as the owner coach before initiating OAuth.'
            : 'Forbidden: owner-coach authorization required.';
        onAuthError?.(res.status, msg);
        return {
          configured: false,
          authorizeUrl: null,
          missingVars: [],
          authError: msg,
        };
      }
      if (!res.ok) {
        return {
          configured: false,
          authorizeUrl: null,
          missingVars: ['INTERVALS_ICU_CLIENT_ID', 'INTERVALS_ICU_CLIENT_SECRET'],
        };
      }
      return (await res.json()) as {
        configured: boolean;
        authorizeUrl: string | null;
        missingVars: string[];
      };
    } catch {
      return {
        configured: false,
        authorizeUrl: null,
        missingVars: ['INTERVALS_ICU_CLIENT_ID', 'INTERVALS_ICU_CLIENT_SECRET'],
      };
    }
  }

  async disconnectOAuthSession(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<void> {
    try {
      const res = await fetch('/api/integrations/intervals/disconnect', {
        method: 'POST',
        headers: buildAuthHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        onAuthError?.(res.status, 'Coach authentication required to disconnect session.');
      }
    } catch {
      // Ignore network errors on disconnect
    }
  }

  async fetchProductionPilotDashboard(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void,
    athleteId?: string | null
  ): Promise<ProductionPilotDashboardResponse | null> {
    try {
      const qs = athleteId?.trim()
        ? `?athleteId=${encodeURIComponent(athleteId.trim())}`
        : '';
      const res = await fetch(`/api/production/pilot${qs}`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: owner-coach authorization required (HTTP 403).';
        onAuthError?.(res.status, msg);
        return null;
      }
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as ProductionPilotDashboardResponse;
    } catch {
      return null;
    }
  }

  async runPilotSynchronization(params: {
    accessToken?: string | null;
    pilotAthleteId?: string;
    mode?: 'auto' | 'initial' | 'incremental';
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<PilotSyncResponse> {
    try {
      const res = await fetch('/api/integrations/intervals/pilot-sync', {
        method: 'POST',
        headers: buildAuthHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          pilotAthleteId: params.pilotAthleteId?.trim() || undefined,
          mode: params.mode ?? 'auto',
        }),
      });
      if (res.status === 401) {
        const msg = 'Coach sign-in required or session expired (HTTP 401).';
        params.onAuthError?.(401, msg);
        throw new Error(msg);
      }
      const data = (await res.json()) as PilotSyncResponse;
      if (res.status === 403 && !data.blockedByPilotGate) {
        params.onAuthError?.(403, data.errorMessage ?? 'Forbidden (HTTP 403).');
      }
      return data;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        status: 'Failed',
        syncLogId: null,
        jobType: 'daily_activity_import',
        syncMode: 'incremental',
        pilotAthleteId: params.pilotAthleteId ?? null,
        internalAthleteId: null,
        athleteName: null,
        windowStart: null,
        windowEnd: null,
        chunksQueried: 0,
        activitiesFetched: 0,
        activitiesProcessed: 0,
        duplicatesSkipped: 0,
        streamsImported: 0,
        streamsMissing: 0,
        streamsUnavailable: 0,
        wellnessProcessed: 0,
        dailyLoadPointsWritten: 0,
        warnings: [],
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Unable to reach /api/integrations/intervals/pilot-sync.',
        synchronizedAt: new Date().toISOString(),
      };
    }
  }

  async fetchIntervalsRosterOverview(
    accessToken?: string | null,
    options?: { probePermissions?: boolean },
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<IntervalsRosterOverviewDto> {
    try {
      const qs = options?.probePermissions ? '?probePermissions=1' : '';
      const res = await fetch(`/api/integrations/intervals/roster${qs}`, {
        headers: buildAuthHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        const msg =
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: owner-coach authorization required (HTTP 403).';
        onAuthError?.(res.status, msg);
        throw new Error(msg);
      }
      return (await res.json()) as IntervalsRosterOverviewDto;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Unable to reach /api/integrations/intervals/roster.',
        verifiedPilotAthleteId: null,
        externalCoachId: null,
        excludedCoachIds: [],
        pagesFetched: 0,
        fetchedAt: new Date().toISOString(),
        lastFullRosterSyncAt: null,
        liveProgress: null,
        summary: {
          totalSharedAthletes: 0,
          mappedAthletes: 0,
          unmappedAthletes: 0,
          awaitingReviewCount: 0,
          eligibleAthletes: 0,
          succeededCount: 0,
          partialCount: 0,
          failedCount: 0,
          permissionUnavailableCount: 0,
          synchronizingCount: 0,
        },
        athletes: [],
        existingAthletes: [],
        warnings: [],
      };
    }
  }

  async resolveIntervalsAthleteMapping(
    accessToken: string | null | undefined,
    payload: ResolveIntervalsMappingPayload,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<ResolveIntervalsMappingResponseDto> {
    try {
      const res = await fetch('/api/integrations/intervals/roster/mappings', {
        method: 'POST',
        headers: buildAuthHeaders(accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        const msg = 'Coach sign-in required or session expired (HTTP 401).';
        onAuthError?.(401, msg);
        throw new Error(msg);
      }
      const data = (await res.json()) as ResolveIntervalsMappingResponseDto;
      if (res.status === 403) {
        onAuthError?.(403, data.message ?? 'Forbidden (HTTP 403).');
      }
      return data;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        action: payload.action,
        externalAthleteId: payload.externalAthleteId,
        internalAthleteId: null,
        athleteName: null,
        mappingStatus: 'Unmapped',
        message:
          err instanceof Error
            ? err.message
            : 'Unable to update Intervals.icu athlete mapping.',
      };
    }
  }

  async runFullRosterSynchronization(params: {
    accessToken?: string | null;
    mode?: 'auto' | 'initial' | 'incremental';
    athleteIds?: string[];
    retryFailedOnly?: boolean;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<FullRosterSyncResponse> {
    try {
      const res = await fetch('/api/integrations/intervals/roster-sync', {
        method: 'POST',
        headers: buildAuthHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mode: params.mode ?? 'auto',
          athleteIds: params.athleteIds,
          retryFailedOnly: Boolean(params.retryFailedOnly),
        }),
      });
      if (res.status === 401) {
        const msg = 'Coach sign-in required or session expired (HTTP 401).';
        params.onAuthError?.(401, msg);
        throw new Error(msg);
      }
      const data = (await res.json()) as FullRosterSyncResponse;
      if (res.status === 403 && !data.blockedByPilotGate) {
        params.onAuthError?.(403, data.errorMessage ?? 'Forbidden (HTTP 403).');
      }
      return data;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        status: 'Failed',
        syncLogId: null,
        jobType: params.retryFailedOnly ? 'retry_sync' : 'daily_activity_import',
        syncModeRequested: params.mode ?? 'auto',
        verifiedPilotAthleteId: null,
        externalCoachId: null,
        totalAthletesInRoster: 0,
        athletesAttempted: 0,
        athletesSucceededCount: 0,
        athletesPartialCount: 0,
        permissionDeniedCount: 0,
        athletesFailedCount: 0,
        unmappedSkippedCount: 0,
        totalActivitiesFetched: 0,
        totalActivitiesProcessed: 0,
        totalActivitiesRemoved: 0,
        totalDuplicatesSkipped: 0,
        totalStreamsImported: 0,
        totalStreamsMissing: 0,
        totalStreamsUnavailable: 0,
        totalWellnessProcessed: 0,
        dailyLoadPointsWritten: 0,
        athleteResults: [],
        warnings: [],
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Unable to reach /api/integrations/intervals/roster-sync.',
        synchronizedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Builds 5 fictional pilot Intervals.icu candidate profiles (including a blocked
   * name-only candidate and a coach-view-only athlete without API scope) strictly
   * labeled as local sample candidates until real server authorization is verified.
   */
  getPilotSampleCandidates(): IntervalsCandidateProfile[] {
    return [
      {
        intervalsAthleteId: 'icu-i20491',
        name: 'Maya Lin',
        email: 'maya.lin@example.com',
        sport: 'Running · Marathon',
        authorizationState: 'Authorized (Read-Only)',
        detectedDevice: 'Garmin Forerunner 965',
        detectedLthrBpm: 173,
        lastActivityDate: '2026-11-18',
      },
      {
        intervalsAthleteId: 'icu-i20512',
        name: 'Jordan Vance',
        email: 'jordan.vance@example.com',
        sport: 'Running · Marathon',
        authorizationState: 'Authorized (Read-Only)',
        detectedDevice: 'Garmin Forerunner 265',
        detectedLthrBpm: 171, // +3 bpm shift to test LTHR coach approval gate
        lastActivityDate: '2026-11-18',
      },
      {
        intervalsAthleteId: 'icu-i20544',
        name: 'Elena Rostova',
        email: 'elena.rostova@example.com',
        sport: 'Running · Half Marathon',
        authorizationState: 'Authorized (Read-Only)',
        detectedDevice: 'Garmin Epix Pro (Gen 2)',
        detectedLthrBpm: 171,
        lastActivityDate: '2026-11-18',
      },
      {
        intervalsAthleteId: 'icu-i20588',
        name: 'Priya Patel',
        email: null, // Tests name-only matching block!
        sport: 'Running · Half Marathon',
        authorizationState: 'Pending Athlete Opt-In',
        detectedDevice: 'Garmin Forerunner 265',
        detectedLthrBpm: 164,
        lastActivityDate: '2026-11-17',
      },
      {
        intervalsAthleteId: 'icu-i20603',
        name: 'Devon Brooks',
        email: 'devon.brooks@example.com',
        sport: 'Running · Marathon',
        authorizationState: 'Coach View Only (No API Scope)',
        detectedDevice: null,
        detectedLthrBpm: null,
        lastActivityDate: '2026-11-16',
      },
    ];
  }
}

export const intervalsIcuAdapter = new IntervalsIcuAdapter();
