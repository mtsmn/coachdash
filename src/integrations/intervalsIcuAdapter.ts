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

  async fetchServerIntegrationStatus(): Promise<ServerIntervalsStatus | null> {
    try {
      const res = await fetch('/api/integrations/status');
      if (!res.ok) return null;
      const json = (await res.json()) as { intervalsIcu?: ServerIntervalsStatus };
      return json.intervalsIcu ?? null;
    } catch {
      return null;
    }
  }

  async runPilotConnectionTest(pilotAthleteId?: string): Promise<ServerPilotConnectionTestResult> {
    try {
      const res = await fetch('/api/integrations/intervals/pilot-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pilotAthleteId: pilotAthleteId?.trim() || undefined,
        }),
      });
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
            detail: 'Backend endpoint unreachable.',
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
          'Backend pilot endpoint unreachable or unconfigured. Continuing safely in demo mode.',
        ],
        checkedAt: new Date().toISOString(),
        modeLabel: 'Disconnected · Demo Mode Active',
      };
    }
  }

  async runReadOnlyConnectionTest(): Promise<ServerIntervalsProbeResult> {
    try {
      const res = await fetch('/api/integrations/intervals/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
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
          'Server endpoint unreachable or unconfigured. Continuing in offline sample mode.',
        ],
        athletePermissions: [],
        requestedScopes: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
        modeLabel: 'Disconnected · Backend Probe Unavailable',
      };
    }
  }

  async runFullRosterDeepTelemetryValidation(
    pilotAthleteId?: string,
    windowDays = 90
  ): Promise<RosterDeepTelemetryValidationReport> {
    try {
      const res = await fetch('/api/integrations/intervals/validate-roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pilotAthleteId: pilotAthleteId?.trim() || undefined,
          windowDays,
        }),
      });
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

  async getOAuthAuthorizeUrl(): Promise<{
    configured: boolean;
    authorizeUrl: string | null;
    missingVars: string[];
  }> {
    try {
      const res = await fetch('/api/integrations/intervals/oauth/url');
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

  async disconnectOAuthSession(): Promise<void> {
    try {
      await fetch('/api/integrations/intervals/disconnect', { method: 'POST' });
    } catch {
      // Ignore network errors on disconnect
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
