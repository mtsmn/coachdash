export interface IntervalsPermissionCheck {
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
}

export interface IntervalsConnectionDiagnostics {
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
  athletePermissions: IntervalsPermissionCheck[];
  requestedScopes: string[];
  modeLabel: string;
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

export interface PilotRunSummary {
  id: string;
  date: string;
  name: string;
  type: string;
  distanceMiles: number;
  durationMinutes: number;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  icuTrainingLoad: number | null;
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

export interface PilotConnectionTestResult {
  configured: boolean;
  connected: boolean;
  authMechanism: 'coach_api_key' | 'coach_app_oauth' | 'unconfigured';
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
    recentRuns: PilotRunSummary[];
  };
  errors: string[];
  checkedAt: string;
  modeLabel: string;
}

import { redactSensitiveText } from './crypto.ts';
import { getOAuthPersistenceStore, OAuthPersistenceStore } from './oauthStore.ts';

interface OAuthSessionState {
  coachId?: string;
  accessToken?: string;
  refreshToken?: string;
  scope?: string;
  expiresAtMs?: number;
  coachAthleteId?: string;
  coachName?: string;
}

const REQUESTED_SCOPES = ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'];

let serverOAuthSession: OAuthSessionState | null = null;
let lastSyncTimestamp: string | null = null;
let recentSyncErrors: string[] = [];
let pilotTestSucceededState = false;
let verifiedPilotAthleteIdState: string | null = null;
let lastPilotCheckAtState: string | null = null;

export function getAuthHeader(apiKeyOverride?: string): {
  header: string;
  method: 'oauth2' | 'api_key';
  mechanism: 'coach_api_key' | 'coach_app_oauth';
} | null {
  // Support Personal API-Key authentication (INTERVALS_ICU_API_KEY) without requiring OAuth variables
  const apiKey = (apiKeyOverride ?? process.env.INTERVALS_ICU_API_KEY)?.trim();
  if (apiKey && !serverOAuthSession?.accessToken) {
    const encoded = Buffer.from(`API_KEY:${apiKey}`).toString('base64');
    return {
      header: `Basic ${encoded}`,
      method: 'api_key',
      mechanism: 'coach_api_key',
    };
  }
  if (serverOAuthSession && serverOAuthSession.accessToken) {
    return {
      header: `Bearer ${serverOAuthSession.accessToken}`,
      method: 'oauth2',
      mechanism: 'coach_app_oauth',
    };
  }
  return null;
}

export async function resolveAuthHeaderForCoach(
  coachId?: string,
  store: OAuthPersistenceStore = getOAuthPersistenceStore()
): Promise<{
  header: string;
  method: 'oauth2' | 'api_key';
  mechanism: 'coach_api_key' | 'coach_app_oauth';
} | null> {
  if (coachId) {
    try {
      const stored = await store.getDecryptedCredentials(coachId, 'intervals_icu');
      if (stored?.accessToken) {
        return {
          header: `Bearer ${stored.accessToken}`,
          method: 'oauth2',
          mechanism: 'coach_app_oauth',
        };
      }
    } catch {
      // Fall back to API key if encrypted token unavailable/unreadable
    }
  }
  return getAuthHeader();
}

export function getSanitizedIntervalsConfigSummary(includeSensitiveCoachDetails = true) {
  const hasOAuthClient = Boolean(
    process.env.INTERVALS_ICU_CLIENT_ID?.trim() &&
      process.env.INTERVALS_ICU_CLIENT_SECRET?.trim()
  );
  const hasApiKey = Boolean(process.env.INTERVALS_ICU_API_KEY?.trim());
  const auth = getAuthHeader();

  return {
    hasOAuthClient,
    hasApiKey,
    hasActiveSession: Boolean(auth),
    authMethod: auth ? auth.method : 'unconfigured',
    authMechanism: auth ? auth.mechanism : 'unconfigured',
    authPriority: 'Personal API Key (INTERVALS_ICU_API_KEY) · OAuth 2.0 Optional',
    oauthRequired: false as const,
    onlyRequiredCredential: 'INTERVALS_ICU_API_KEY',
    readOnlyMode: true as const,
    requiresIndividualAthleteKeys: false as const,
    pilotTestSucceeded: pilotTestSucceededState,
    verifiedPilotAthleteId: includeSensitiveCoachDetails ? verifiedPilotAthleteIdState : null,
    fullRosterSyncAllowed: pilotTestSucceededState,
    lastPilotCheckAt: lastPilotCheckAtState,
    requestedScopes: REQUESTED_SCOPES,
    coachAccountIdentity: includeSensitiveCoachDetails
      ? serverOAuthSession?.coachName ?? null
      : null,
    coachAthleteId: includeSensitiveCoachDetails
      ? serverOAuthSession?.coachAthleteId ?? null
      : null,
    lastSynchronizedAt: lastSyncTimestamp,
    recentSyncErrors: includeSensitiveCoachDetails
      ? recentSyncErrors.map(redactSensitiveText)
      : [],
  };
}

export async function clearIntervalsSession(
  coachId?: string,
  store: OAuthPersistenceStore = getOAuthPersistenceStore()
) {
  serverOAuthSession = null;
  pilotTestSucceededState = false;
  verifiedPilotAthleteIdState = null;
  if (coachId) {
    await store.clearCredentials(coachId, 'intervals_icu');
  }
}

export function resetPilotGateForTesting() {
  pilotTestSucceededState = false;
  verifiedPilotAthleteIdState = null;
  lastPilotCheckAtState = null;
}

export function isFullRosterSyncAllowed(): boolean {
  return pilotTestSucceededState;
}

export async function buildIntervalsOAuthUrl(
  appBaseUrl: string,
  options?: {
    coachId?: string;
    store?: OAuthPersistenceStore;
    ttlSeconds?: number;
  }
): Promise<{
  configured: boolean;
  authorizeUrl: string | null;
  missingVars: string[];
}> {
  const clientId = process.env.INTERVALS_ICU_CLIENT_ID?.trim();
  const clientSecret = process.env.INTERVALS_ICU_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.INTERVALS_ICU_REDIRECT_URI?.trim() ||
    `${appBaseUrl.replace(/\/$/, '')}/api/integrations/intervals/oauth/callback`;

  const missingVars: string[] = [];
  if (!clientId) missingVars.push('INTERVALS_ICU_CLIENT_ID');
  if (!clientSecret) missingVars.push('INTERVALS_ICU_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    return {
      configured: false,
      authorizeUrl: null,
      missingVars,
    };
  }

  if (!options?.coachId) {
    throw new Error('Authenticated coachId is required to initiate OAuth state.');
  }

  const store = options.store ?? getOAuthPersistenceStore();
  const { state } = await store.createOAuthState({
    coachId: options.coachId,
    provider: 'intervals_icu',
    ttlSeconds: options.ttlSeconds ?? 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: REQUESTED_SCOPES.join(','),
    state,
  });

  return {
    configured: true,
    authorizeUrl: `https://intervals.icu/oauth/authorize?${params.toString()}`,
    missingVars: [],
  };
}

export async function exchangeIntervalsOAuthCode(params: {
  code: string;
  state: string;
  appBaseUrl: string;
  store?: OAuthPersistenceStore;
  fetcher?: typeof fetch;
  nowMs?: number;
}): Promise<{
  ok: boolean;
  statusCode?: 400 | 502;
  message: string;
  coachIdentity?: string;
  coachId?: string;
  persistedToDatabase?: boolean;
}> {
  const { code, state, appBaseUrl, store = getOAuthPersistenceStore(), fetcher = fetch, nowMs } = params;

  const stateCheck = await store.consumeOAuthState({
    state,
    provider: 'intervals_icu',
    nowMs,
  });

  if (!stateCheck.ok) {
    const reasonMap: Record<typeof stateCheck.reason, string> = {
      missing: 'Missing OAuth state parameter.',
      unknown: 'Invalid or unrecognized OAuth state parameter.',
      expired: 'OAuth state has expired. Please restart authorization.',
      reused: 'OAuth state has already been used.',
      provider_mismatch: 'OAuth state provider mismatch.',
    };
    return {
      ok: false,
      statusCode: 400,
      message: reasonMap[stateCheck.reason],
    };
  }

  const clientId = process.env.INTERVALS_ICU_CLIENT_ID?.trim();
  const clientSecret = process.env.INTERVALS_ICU_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.INTERVALS_ICU_REDIRECT_URI?.trim() ||
    `${appBaseUrl.replace(/\/$/, '')}/api/integrations/intervals/oauth/callback`;

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Intervals.icu OAuth client credentials are not configured on the server.',
    };
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const resp = await fetcher('https://intervals.icu/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    return {
      ok: false,
      statusCode: 502,
      message: `Intervals.icu token exchange returned HTTP ${resp.status}.`,
    };
  }

  const payload = (await resp.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    athlete?: { id?: string; name?: string };
  };

  if (!payload.access_token) {
    return {
      ok: false,
      statusCode: 502,
      message: 'Token response did not contain an access token.',
    };
  }

  const expiresAtIso = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : undefined;

  const saved = await store.saveEncryptedCredentials({
    coachId: stateCheck.coachId,
    provider: 'intervals_icu',
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scope: payload.scope,
    expiresAtIso,
    externalCoachId: payload.athlete?.id,
    externalCoachName: payload.athlete?.name,
  });

  serverOAuthSession = {
    coachId: stateCheck.coachId,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    scope: payload.scope,
    expiresAtMs: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
    coachAthleteId: payload.athlete?.id,
    coachName: payload.athlete?.name,
  };

  return {
    ok: true,
    message: 'Intervals.icu OAuth authorization established and stored encrypted on server.',
    coachIdentity: payload.athlete?.name ?? payload.athlete?.id ?? 'Authenticated Coach',
    coachId: stateCheck.coachId,
    persistedToDatabase: saved.persistedToDatabase,
  };
}

type FetchLike = typeof fetch;

async function fetchIntervalsJson(
  path: string,
  authHeader: string,
  fetcher: FetchLike = fetch
): Promise<{ ok: boolean; status: number; data: unknown; errorText?: string }> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetcher(`https://intervals.icu/api/v1${path}`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      });
      if (resp.status === 429 && attempt < maxAttempts) {
        const retryAfterSec = Number(resp.headers?.get?.('Retry-After') ?? '0');
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, 3000)
            : 500 * attempt;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!resp.ok) {
        return {
          ok: false,
          status: resp.status,
          data: null,
          errorText: `HTTP ${resp.status}`,
        };
      }
      const data = await resp.json();
      return { ok: true, status: resp.status, data };
    } catch (err) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
        continue;
      }
      return {
        ok: false,
        status: 0,
        data: null,
        errorText: redactSensitiveText(err instanceof Error ? err.message : 'Network error'),
      };
    }
  }
  return { ok: false, status: 429, data: null, errorText: 'HTTP 429' };
}

interface RawRosterItem {
  id?: string | number;
  athlete_id?: string | number;
  name?: string;
  athlete_name?: string;
  email?: string;
}

function normalizeRosterEntries(
  payload: unknown
): Array<{ id: string; name: string; email: string | null }> {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; email: string | null }> = [];
  for (const item of payload as RawRosterItem[]) {
    const rawId = item.athlete_id ?? item.id;
    if (rawId === undefined || rawId === null) continue;
    const id = String(rawId);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(item.athlete_name ?? item.name ?? `Athlete ${id}`),
      email: typeof item.email === 'string' ? item.email : null,
    });
  }
  return out;
}

function isRunningActivityType(typeValue: unknown): boolean {
  const t = typeof typeValue === 'string' ? typeValue.toLowerCase() : '';
  return (
    t === 'run' ||
    t === 'virtualrun' ||
    t === 'trailrun' ||
    t === 'treadmill' ||
    t.includes('run')
  );
}

/**
 * 6-Step Pilot Connection Test
 * Verifies:
 * 1. Coach account authentication
 * 2. Access to coaching roster
 * 3. Access to an authorized shared athlete (using ONLY coach OAuth or coach API key; NO individual athlete API keys)
 * 4. Retrieval of that athlete's running activities
 * 5. Retrieval of available heart-rate and LTHR data
 * 6. Retrieval of training load metrics (icu_training_load, CTL, ATL)
 *
 * Full roster synchronization remains strictly blocked until this pilot test succeeds.
 */
export async function runIntervalsPilotConnectionTest(options?: {
  pilotAthleteId?: string;
  fetcher?: FetchLike;
  apiKeyOverride?: string;
  coachId?: string;
  store?: OAuthPersistenceStore;
}): Promise<PilotConnectionTestResult> {
  const fetcher = options?.fetcher ?? fetch;
  const auth = options?.apiKeyOverride
    ? getAuthHeader(options.apiKeyOverride)
    : options?.coachId
    ? await resolveAuthHeaderForCoach(options.coachId, options.store)
    : getAuthHeader();
  const checkedAt = new Date().toISOString();
  const emptyMetrics: PilotConnectionTestResult['pilotMetricsSummary'] = {
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
  };

  const unverifiedPermissions: IntervalsDataPermissionItem[] = [
    {
      permissionKey: 'coach_account_info',
      label: 'Coach Account Information',
      available: false,
      accessState: 'Unverified',
      detail: 'Requires server-side INTERVALS_ICU_API_KEY (OAuth not required).',
    },
    {
      permissionKey: 'shared_athlete_roster',
      label: 'Shared Athlete Roster List',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested until coach authentication passes.',
    },
    {
      permissionKey: 'pilot_completed_activities',
      label: 'Pilot Athlete Completed Activities (Read-Only)',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested.',
    },
    {
      permissionKey: 'pilot_heart_rate',
      label: 'Heart-Rate Data (Avg / Max HR)',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested.',
    },
    {
      permissionKey: 'pilot_lthr_and_zones',
      label: 'LTHR & Heart-Rate Zones',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested.',
    },
    {
      permissionKey: 'pilot_wellness_and_load',
      label: 'Training Load & Wellness (CTL / ATL)',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested.',
    },
    {
      permissionKey: 'pilot_calendar_events',
      label: 'Training Calendar Events',
      available: false,
      accessState: 'Unverified',
      detail: 'Not tested.',
    },
  ];

  if (!auth) {
    pilotTestSucceededState = false;
    verifiedPilotAthleteIdState = null;
    lastPilotCheckAtState = checkedAt;

    const steps: PilotVerificationStep[] = [
      {
        id: 'coach_auth',
        label: '1. Coach account authentication',
        endpoint: 'GET /api/v1/athlete/0',
        status: 'Failed',
        detail:
          'INTERVALS_ICU_API_KEY is not set on the server. OAuth fields (CLIENT_ID/SECRET/REDIRECT_URI) are optional and not required.',
      },
      {
        id: 'coaching_roster',
        label: '2. Access to coaching roster',
        endpoint: 'GET /api/v1/athlete/0/athlete-summary.json',
        status: 'Blocked',
        detail: 'Blocked until personal API key authentication succeeds.',
      },
      {
        id: 'shared_athlete_access',
        label: '3. Access to an authorized shared athlete',
        endpoint: 'GET /api/v1/athlete/{pilotAthleteId}',
        status: 'Blocked',
        detail: 'Blocked until coaching roster is retrieved.',
      },
      {
        id: 'running_activities',
        label: '4. Retrieval of completed running activities',
        endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/activities',
        status: 'Blocked',
        detail: 'Blocked until shared athlete access is verified.',
      },
      {
        id: 'hr_and_lthr',
        label: '5. Retrieval of heart-rate and LTHR data',
        endpoint: 'GET /api/v1/athlete/{pilotAthleteId} + activities',
        status: 'Blocked',
        detail: 'Blocked until activities are retrieved.',
      },
      {
        id: 'training_load',
        label: '6. Retrieval of training load metrics',
        endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/wellness + activities',
        status: 'Blocked',
        detail: 'Blocked until pilot athlete activities are retrieved.',
      },
    ];

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
      steps,
      dataPermissions: unverifiedPermissions,
      pilotMetricsSummary: emptyMetrics,
      errors: [
        'INTERVALS_ICU_API_KEY is not configured on the server. Demo mode remains active for all athletes.',
      ],
      checkedAt,
      modeLabel: 'Disconnected · Set Server INTERVALS_ICU_API_KEY (OAuth Optional · Demo Mode Active)',
    };
  }

  const errors: string[] = [];

  // STEP 1: Verify Coach Account Authentication (/api/v1/athlete/0)
  const selfRes = await fetchIntervalsJson('/athlete/0', auth.header, fetcher);
  if (!selfRes.ok || !selfRes.data || typeof selfRes.data !== 'object') {
    const errMsg = `Authentication failed on /api/v1/athlete/0 (${selfRes.errorText ?? 'unknown'}).`;
    errors.push(errMsg);
    pilotTestSucceededState = false;
    verifiedPilotAthleteIdState = null;
    lastPilotCheckAtState = checkedAt;

    return {
      configured: true,
      connected: false,
      authMechanism: auth.mechanism,
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
          detail: errMsg,
        },
        {
          id: 'coaching_roster',
          label: '2. Access to coaching roster',
          endpoint: 'GET /api/v1/athlete/0/athlete-summary.json',
          status: 'Blocked',
          detail: 'Blocked by coach authentication failure.',
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
      dataPermissions: unverifiedPermissions.map((p) =>
        p.permissionKey === 'coach_account_info'
          ? { ...p, accessState: 'Denied / Unavailable', detail: errMsg }
          : p
      ),
      pilotMetricsSummary: emptyMetrics,
      errors,
      checkedAt,
      modeLabel: 'Authentication Failed · Demo Mode Retained',
    };
  }

  const selfProfile = selfRes.data as {
    id?: string | number;
    name?: string;
    email?: string;
    timezone?: string;
  };
  const coachAthleteId = selfProfile.id !== undefined ? String(selfProfile.id) : '0';
  const coachIdentity = `${selfProfile.name ?? 'Coach Account'} (${coachAthleteId})`;
  const coachAccountInfo = {
    id: coachAthleteId,
    name: selfProfile.name ?? 'Coach Account',
    email: typeof selfProfile.email === 'string' ? selfProfile.email : null,
    timezone: typeof selfProfile.timezone === 'string' ? selfProfile.timezone : null,
  };

  const step1: PilotVerificationStep = {
    id: 'coach_auth',
    label: '1. Coach account authentication',
    endpoint: 'GET /api/v1/athlete/0',
    status: 'Passed',
    detail: `Authenticated as ${coachIdentity} via ${
      auth.mechanism === 'coach_app_oauth'
        ? 'OAuth 2.0 Bearer Token'
        : 'Personal API Key (Basic API_KEY auth · OAuth not required)'
    }.`,
  };

  // STEP 2: Access Coaching Roster (/athlete/0/athlete-summary.json with /athletes fallback)
  const newestDate = checkedAt.slice(0, 10);
  const oldestDate90d = new Date(Date.now() - 84 * 86400000).toISOString().slice(0, 10);

  const summaryRes = await fetchIntervalsJson(
    `/athlete/0/athlete-summary.json?start=${oldestDate90d}&end=${newestDate}`,
    auth.header,
    fetcher
  );
  const athletesListRes = await fetchIntervalsJson('/athletes', auth.header, fetcher);

  const rosterFromSummary = summaryRes.ok ? normalizeRosterEntries(summaryRes.data) : [];
  const rosterFromList = athletesListRes.ok ? normalizeRosterEntries(athletesListRes.data) : [];

  const mergedRosterMap = new Map<string, { id: string; name: string; email: string | null }>();
  for (const r of [...rosterFromSummary, ...rosterFromList]) {
    mergedRosterMap.set(r.id, r);
  }
  const fullRoster = Array.from(mergedRosterMap.values());
  const sharedCoachedAthletes = fullRoster.filter((r) => r.id !== coachAthleteId);

  const rosterOk = (summaryRes.ok || athletesListRes.ok) && fullRoster.length > 0;
  const step2: PilotVerificationStep = {
    id: 'coaching_roster',
    label: '2. Access to coaching roster',
    endpoint: summaryRes.ok ? 'GET /api/v1/athlete/0/athlete-summary.json' : 'GET /api/v1/athletes',
    status: rosterOk ? 'Passed' : 'Failed',
    detail: rosterOk
      ? `Retrieved ${sharedCoachedAthletes.length} shared/coached athlete(s) (${fullRoster.length} total profiles). Access to untested athletes is never assumed until individually verified.`
      : `Unable to read coached roster (${summaryRes.errorText ?? athletesListRes.errorText ?? 'empty roster'}).`,
  };

  if (!rosterOk) {
    errors.push(step2.detail);
  }

  // Pick requested pilot athlete ID, or first shared coached athlete
  const requestedId = options?.pilotAthleteId?.trim();
  const targetCandidate = requestedId
    ? fullRoster.find((a) => a.id === requestedId) ?? {
        id: requestedId,
        name: `Pilot Athlete ${requestedId}`,
        email: null,
      }
    : sharedCoachedAthletes[0] ?? null;

  if (!targetCandidate) {
    const missingSharedMsg =
      'No shared/coached athlete found in roster to run the pilot test. Enter a shared Intervals.icu athlete ID or retain Demo Mode.';
    errors.push(missingSharedMsg);
    pilotTestSucceededState = false;
    verifiedPilotAthleteIdState = null;
    lastPilotCheckAtState = checkedAt;

    return {
      configured: true,
      connected: true,
      authMechanism: auth.mechanism,
      oauthRequired: false,
      readOnlyMode: true,
      demoModeFallbackActive: true,
      requiresIndividualAthleteKeys: false,
      pilotTestSucceeded: false,
      fullRosterSyncAllowed: false,
      coachAccountIdentity: coachIdentity,
      coachAthleteId,
      coachAccountInfo,
      rosterCount: fullRoster.length,
      coachedAthletes: fullRoster.map((a) => ({
        id: a.id,
        name: a.name,
        verificationStatus: 'Unverified (Demo Mode Retained)',
      })),
      selectedPilotAthlete: null,
      steps: [
        step1,
        step2,
        {
          id: 'shared_athlete_access',
          label: '3. Access to an authorized shared athlete',
          endpoint: 'GET /api/v1/athlete/{pilotAthleteId}',
          status: 'Failed',
          detail: missingSharedMsg,
        },
        {
          id: 'running_activities',
          label: '4. Retrieval of completed running activities',
          endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/activities',
          status: 'Blocked',
          detail: 'Blocked without a shared pilot athlete.',
        },
        {
          id: 'hr_and_lthr',
          label: '5. Retrieval of heart-rate and LTHR data',
          endpoint: 'GET /api/v1/athlete/{pilotAthleteId} + activities',
          status: 'Blocked',
          detail: 'Blocked without a shared pilot athlete.',
        },
        {
          id: 'training_load',
          label: '6. Retrieval of training load metrics',
          endpoint: 'GET /api/v1/athlete/{pilotAthleteId}/wellness + activities',
          status: 'Blocked',
          detail: 'Blocked without a shared pilot athlete.',
        },
      ],
      dataPermissions: [
        {
          permissionKey: 'coach_account_info',
          label: 'Coach Account Information',
          available: true,
          accessState: 'Verified Read-Only',
          detail: `Verified ${coachIdentity}`,
        },
        {
          permissionKey: 'shared_athlete_roster',
          label: 'Shared Athlete Roster List',
          available: rosterOk,
          accessState: rosterOk ? 'Verified Read-Only' : 'Denied / Unavailable',
          detail: step2.detail,
        },
        ...unverifiedPermissions.slice(2),
      ],
      pilotMetricsSummary: emptyMetrics,
      errors,
      checkedAt,
      modeLabel: 'Coach Authenticated · Awaiting Shared Athlete Verification (Demo Mode Active)',
    };
  }

  // STEP 3: Verify access to authorized shared pilot athlete
  const encodedPilotId = encodeURIComponent(targetCandidate.id);
  const pilotProfileRes = await fetchIntervalsJson(
    `/athlete/${encodedPilotId}`,
    auth.header,
    fetcher
  );
  const pilotEventsRes = await fetchIntervalsJson(
    `/athlete/${encodedPilotId}/events?oldest=${oldestDate90d}&newest=${newestDate}`,
    auth.header,
    fetcher
  );

  const pilotProfileData =
    pilotProfileRes.ok && pilotProfileRes.data && typeof pilotProfileRes.data === 'object'
      ? (pilotProfileRes.data as {
          id?: string | number;
          name?: string;
          lthr?: number;
          sportSettings?: Array<{
            types?: string[];
            lthr?: number;
            hr_zones?: number[];
          }>;
        })
      : null;

  const sharedAccessOk = Boolean(pilotProfileRes.ok && pilotProfileData);
  const resolvedPilotName = pilotProfileData?.name ?? targetCandidate.name;

  const step3: PilotVerificationStep = {
    id: 'shared_athlete_access',
    label: '3. Access to an authorized shared athlete',
    endpoint: `GET /api/v1/athlete/${targetCandidate.id}`,
    status: sharedAccessOk ? 'Passed' : 'Failed',
    detail: sharedAccessOk
      ? `Verified read access to shared athlete ${resolvedPilotName} (${targetCandidate.id})${
          pilotEventsRes.ok ? ' + calendar events' : ''
        } using coach credentials only.`
      : `Shared athlete access denied (${pilotProfileRes.errorText ?? '403'}). Athlete may need to enable Coach-App / Coach access in Intervals.icu.`,
  };

  if (!sharedAccessOk) {
    errors.push(step3.detail);
  }

  // STEP 4: Retrieval of that athlete's running activities
  const activitiesRes = await fetchIntervalsJson(
    `/athlete/${encodedPilotId}/activities?oldest=${oldestDate90d}&newest=${newestDate}`,
    auth.header,
    fetcher
  );

  const rawActivities =
    activitiesRes.ok && Array.isArray(activitiesRes.data)
      ? (activitiesRes.data as Array<Record<string, unknown>>)
      : [];

  const runningActivities = rawActivities
    .filter((a) => isRunningActivityType(a.type))
    .sort((a, b) =>
      String(b.start_date_local ?? '').localeCompare(String(a.start_date_local ?? ''))
    );

  const activitiesOk = activitiesRes.ok && runningActivities.length > 0;
  const latestRun = runningActivities[0] ?? null;

  const step4: PilotVerificationStep = {
    id: 'running_activities',
    label: '4. Retrieval of running activities',
    endpoint: `GET /api/v1/athlete/${targetCandidate.id}/activities`,
    status: activitiesOk ? 'Passed' : 'Failed',
    detail: activitiesRes.ok
      ? runningActivities.length > 0
        ? `Retrieved ${runningActivities.length} running activity(ies) in the last 84 days (latest: ${String(
            latestRun?.start_date_local ?? ''
          ).slice(0, 10)}).`
        : `Endpoint succeeded (${rawActivities.length} total activities), but 0 running activities found in the last 84 days.`
      : `Failed to retrieve activities (${activitiesRes.errorText ?? '403'}).`,
  };

  if (!activitiesOk) {
    errors.push(step4.detail);
  }

  // STEP 5: Retrieval of available heart-rate and LTHR data
  const runSportSetting = pilotProfileData?.sportSettings?.find((s) =>
    Array.isArray(s.types)
      ? s.types.some((t) => t.toLowerCase().includes('run'))
      : false
  ) ?? pilotProfileData?.sportSettings?.[0];

  const activityWithLthr = runningActivities.find(
    (a) => typeof a.lthr === 'number' && Number.isFinite(a.lthr)
  );
  const detectedLthrBpm =
    (typeof runSportSetting?.lthr === 'number' ? runSportSetting.lthr : null) ??
    (typeof pilotProfileData?.lthr === 'number' ? pilotProfileData.lthr : null) ??
    (typeof activityWithLthr?.lthr === 'number' ? activityWithLthr.lthr : null);

  const hrZonesArray = Array.isArray(runSportSetting?.hr_zones)
    ? runSportSetting.hr_zones
    : Array.isArray(latestRun?.icu_hr_zones)
    ? (latestRun.icu_hr_zones as number[])
    : [];

  const getAvgHr = (a: Record<string, unknown> | null | undefined): number | null => {
    if (!a) return null;
    if (typeof a.average_heartrate === 'number' && a.average_heartrate > 0) {
      return a.average_heartrate;
    }
    if (typeof a.average_hr === 'number' && a.average_hr > 0) {
      return a.average_hr;
    }
    return null;
  };
  const getMaxHr = (a: Record<string, unknown> | null | undefined): number | null => {
    if (!a) return null;
    if (typeof a.max_heartrate === 'number' && a.max_heartrate > 0) {
      return a.max_heartrate;
    }
    if (typeof a.max_hr === 'number' && a.max_hr > 0) {
      return a.max_hr;
    }
    return null;
  };

  const activitiesWithHr = runningActivities.filter((a) => getAvgHr(a) !== null);
  const latestAvgHrRaw = getAvgHr(activitiesWithHr[0]);
  const latestAvgHr = latestAvgHrRaw !== null ? Math.round(latestAvgHrRaw) : null;

  const stravaWithheldRuns = runningActivities.filter(
    (a) => String(a.source ?? '').toUpperCase() === 'STRAVA' && getAvgHr(a) === null
  ).length;
  const hasHeartrateFlagCount = runningActivities.filter((a) => a.has_heartrate === true).length;

  const hrAndLthrOk = activitiesWithHr.length > 0 && detectedLthrBpm !== null;
  const lthrSourceLabel = runSportSetting?.lthr
    ? 'Intervals.icu Run sportSettings.lthr'
    : pilotProfileData?.lthr
    ? 'Intervals.icu athlete.lthr'
    : activityWithLthr?.lthr
    ? 'Intervals.icu activity.lthr'
    : null;

  const step5: PilotVerificationStep = {
    id: 'hr_and_lthr',
    label: '5. Retrieval of heart-rate and LTHR data',
    endpoint: `GET /api/v1/athlete/${targetCandidate.id} (sportSettings) + activities`,
    status: hrAndLthrOk ? 'Passed' : 'Failed',
    detail: hrAndLthrOk
      ? `Verified HR telemetry on ${activitiesWithHr.length}/${runningActivities.length} run(s) (latest avg ${latestAvgHr} bpm) and LTHR ${detectedLthrBpm} bpm (${lthrSourceLabel}${
          hrZonesArray.length > 0 ? `, ${hrZonesArray.length} HR zones` : ''
        }).`
      : `Missing required telemetry — HR activities found: ${activitiesWithHr.length}/${runningActivities.length}${
          stravaWithheldRuns > 0
            ? ` (${stravaWithheldRuns} Strava-sourced run(s) withhold activity fields over API)`
            : hasHeartrateFlagCount > 0
            ? ` (${hasHeartrateFlagCount} marked has_heartrate=true without summary HR)`
            : ''
        }, LTHR: ${detectedLthrBpm ?? 'not set'}.`,
  };

  if (!hrAndLthrOk) {
    errors.push(step5.detail);
  }

  // STEP 6: Retrieval of training load metrics (icu_training_load + wellness CTL/ATL)
  const wellnessRes = await fetchIntervalsJson(
    `/athlete/${encodedPilotId}/wellness?oldest=${oldestDate90d}&newest=${newestDate}`,
    auth.header,
    fetcher
  );
  const wellnessRecords =
    wellnessRes.ok && Array.isArray(wellnessRes.data)
      ? (wellnessRes.data as Array<Record<string, unknown>>).sort((a, b) =>
          String(b.id ?? '').localeCompare(String(a.id ?? ''))
        )
      : [];

  const latestWellness = wellnessRecords[0] ?? null;
  const runWithLoad = runningActivities.find(
    (a) => typeof a.icu_training_load === 'number' && Number.isFinite(a.icu_training_load)
  );
  const latestIcuLoad =
    typeof runWithLoad?.icu_training_load === 'number'
      ? Math.round(runWithLoad.icu_training_load)
      : null;

  const latestCtlRaw =
    (typeof latestWellness?.ctl === 'number' ? latestWellness.ctl : null) ??
    (typeof latestWellness?.icu_ctl === 'number' ? latestWellness.icu_ctl : null) ??
    (typeof latestRun?.icu_ctl === 'number' ? latestRun.icu_ctl : null);
  const latestAtlRaw =
    (typeof latestWellness?.atl === 'number' ? latestWellness.atl : null) ??
    (typeof latestWellness?.icu_atl === 'number' ? latestWellness.icu_atl : null) ??
    (typeof latestRun?.icu_atl === 'number' ? latestRun.icu_atl : null);

  const latestIcuCtl = latestCtlRaw !== null ? Number(latestCtlRaw.toFixed(1)) : null;
  const latestIcuAtl = latestAtlRaw !== null ? Number(latestAtlRaw.toFixed(1)) : null;

  const trainingLoadOk = latestIcuLoad !== null || (latestIcuCtl !== null && latestIcuAtl !== null);
  const step6: PilotVerificationStep = {
    id: 'training_load',
    label: '6. Retrieval of training load metrics',
    endpoint: `GET /api/v1/athlete/${targetCandidate.id}/wellness + icu_training_load`,
    status: trainingLoadOk ? 'Passed' : 'Failed',
    detail: trainingLoadOk
      ? `Retrieved Intervals.icu native metrics — Activity Load: ${latestIcuLoad ?? '--'}, CTL: ${
          latestIcuCtl ?? '--'
        }, ATL: ${latestIcuAtl ?? '--'}.`
      : 'No icu_training_load or CTL/ATL wellness metrics available for the pilot athlete.',
  };

  if (!trainingLoadOk) {
    errors.push(step6.detail);
  }

  const allPassed =
    step1.status === 'Passed' &&
    step2.status === 'Passed' &&
    step3.status === 'Passed' &&
    step4.status === 'Passed' &&
    step5.status === 'Passed' &&
    step6.status === 'Passed';

  pilotTestSucceededState = allPassed;
  verifiedPilotAthleteIdState = allPassed ? targetCandidate.id : null;
  lastPilotCheckAtState = checkedAt;
  lastSyncTimestamp = checkedAt;
  recentSyncErrors = errors;

  const recentRuns: PilotRunSummary[] = runningActivities.slice(0, 3).map((r) => {
    const avgHr = getAvgHr(r);
    const maxHr = getMaxHr(r);
    return {
      id: String(r.id ?? ''),
      date: String(r.start_date_local ?? '').slice(0, 10),
      name: String(r.name ?? 'Run'),
      type: String(r.type ?? 'Run'),
      distanceMiles:
        typeof r.distance === 'number' ? Number((r.distance / 1609.34).toFixed(2)) : 0,
      durationMinutes:
        typeof r.moving_time === 'number' ? Math.round(r.moving_time / 60) : 0,
      avgHrBpm: avgHr !== null ? Math.round(avgHr) : null,
      maxHrBpm: maxHr !== null ? Math.round(maxHr) : null,
      icuTrainingLoad:
        typeof r.icu_training_load === 'number' ? Math.round(r.icu_training_load) : null,
    };
  });

  const dataPermissions: IntervalsDataPermissionItem[] = [
    {
      permissionKey: 'coach_account_info',
      label: 'Coach Account Information',
      available: true,
      accessState: 'Verified Read-Only',
      detail: `Verified ${coachIdentity}${coachAccountInfo.email ? ` · ${coachAccountInfo.email}` : ''}`,
    },
    {
      permissionKey: 'shared_athlete_roster',
      label: 'Shared Athlete Roster List',
      available: rosterOk,
      accessState: rosterOk ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail: rosterOk
        ? `${sharedCoachedAthletes.length} coached athlete(s) visible; untested athletes remain in demo mode.`
        : step2.detail,
    },
    {
      permissionKey: 'pilot_completed_activities',
      label: `Completed Activities (${resolvedPilotName})`,
      available: activitiesRes.ok,
      accessState: activitiesRes.ok ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail: activitiesRes.ok
        ? `${rawActivities.length} total completed activities (${runningActivities.length} running) retrieved read-only.`
        : step4.detail,
    },
    {
      permissionKey: 'pilot_heart_rate',
      label: `Heart-Rate Telemetry (${resolvedPilotName})`,
      available: activitiesWithHr.length > 0,
      accessState: activitiesWithHr.length > 0 ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail:
        activitiesWithHr.length > 0
          ? `${activitiesWithHr.length}/${runningActivities.length} run(s) contain average HR telemetry (latest avg ${latestAvgHr} bpm).`
          : stravaWithheldRuns > 0
          ? `${stravaWithheldRuns} run(s) originate from Strava and omit HR fields over third-party API.`
          : 'No average HR telemetry present on retrieved running activities.',
    },
    {
      permissionKey: 'pilot_lthr_and_zones',
      label: `LTHR & Heart-Rate Zones (${resolvedPilotName})`,
      available: detectedLthrBpm !== null,
      accessState: detectedLthrBpm !== null ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail:
        detectedLthrBpm !== null
          ? `LTHR ${detectedLthrBpm} bpm via ${lthrSourceLabel}${
              hrZonesArray.length > 0 ? ` (${hrZonesArray.length} HR zones)` : ''
            }.`
          : 'LTHR not configured or inaccessible in sportSettings/profile.',
    },
    {
      permissionKey: 'pilot_wellness_and_load',
      label: `Training Load & Wellness (${resolvedPilotName})`,
      available: trainingLoadOk,
      accessState: trainingLoadOk ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail: trainingLoadOk
        ? `Native Load ${latestIcuLoad ?? '--'} · CTL ${latestIcuCtl ?? '--'} · ATL ${latestIcuAtl ?? '--'}`
        : 'Wellness/load fields unavailable for pilot athlete.',
    },
    {
      permissionKey: 'pilot_calendar_events',
      label: `Training Calendar Events (${resolvedPilotName})`,
      available: pilotEventsRes.ok,
      accessState: pilotEventsRes.ok ? 'Verified Read-Only' : 'Denied / Unavailable',
      detail: pilotEventsRes.ok
        ? 'Calendar events endpoint verified read-only.'
        : `Calendar access unavailable (${pilotEventsRes.errorText ?? '403'}).`,
    },
  ];

  const coachedAthletes: CoachedAthleteVerificationItem[] = sharedCoachedAthletes.map((a) => {
    if (a.id === targetCandidate.id) {
      return {
        id: a.id,
        name: a.name,
        verificationStatus:
          sharedAccessOk && activitiesRes.ok ? 'Verified Read-Only' : 'Permission Denied',
      };
    }
    return {
      id: a.id,
      name: a.name,
      verificationStatus: 'Unverified (Demo Mode Retained)',
    };
  });

  return {
    configured: true,
    connected: true,
    authMechanism: auth.mechanism,
    oauthRequired: false,
    readOnlyMode: true,
    demoModeFallbackActive: !allPassed || sharedCoachedAthletes.length > 1,
    requiresIndividualAthleteKeys: false,
    pilotTestSucceeded: allPassed,
    fullRosterSyncAllowed: allPassed,
    coachAccountIdentity: coachIdentity,
    coachAthleteId,
    coachAccountInfo,
    rosterCount: fullRoster.length,
    coachedAthletes,
    selectedPilotAthlete: {
      id: targetCandidate.id,
      name: resolvedPilotName,
      authorizationMethod:
        auth.mechanism === 'coach_app_oauth'
          ? 'Optional OAuth 2.0 Scope (No Athlete API Key)'
          : 'Personal API Key (INTERVALS_ICU_API_KEY · Read-Only · No OAuth Required)',
    },
    steps: [step1, step2, step3, step4, step5, step6],
    dataPermissions,
    pilotMetricsSummary: {
      totalCompletedActivityCount: rawActivities.length,
      runningActivityCount: runningActivities.length,
      latestRunDate: latestRun ? String(latestRun.start_date_local ?? '').slice(0, 10) : null,
      latestRunType: latestRun ? String(latestRun.type ?? 'Run') : null,
      activitiesWithHrCount: activitiesWithHr.length,
      latestAvgHrBpm: latestAvgHr,
      detectedLthrBpm,
      lthrSource: lthrSourceLabel,
      hrZoneCount: hrZonesArray.length,
      latestIcuTrainingLoad: latestIcuLoad,
      latestIcuCtl,
      latestIcuAtl,
      recentRuns,
    },
    errors,
    checkedAt,
    modeLabel: allPassed
      ? `Personal API Key Verified (${resolvedPilotName}) · Read-Only · Unverified Athletes Stay in Demo Mode`
      : 'Pilot Verification Incomplete · Demo Mode Retained for Inaccessible Data',
  };
}

export async function runIntervalsReadOnlyConnectionTest(options?: {
  coachId?: string;
  store?: OAuthPersistenceStore;
}): Promise<IntervalsConnectionDiagnostics> {
  const auth = options?.coachId
    ? await resolveAuthHeaderForCoach(options.coachId, options.store)
    : getAuthHeader();
  const checkedAt = new Date().toISOString();

  if (!auth) {
    return {
      configured: false,
      connected: false,
      authMethod: 'unconfigured',
      coachAccountIdentity: null,
      coachAthleteId: null,
      authorizedAthleteCount: 0,
      visibleCoachAthletesCount: 0,
      lastSynchronizedAt: lastSyncTimestamp,
      syncErrors: [],
      permissionIssues: [
        'No server-side Intervals.icu credentials detected (Coach-App OAuth or INTERVALS_ICU_API_KEY). Running strictly in offline sample mode.',
      ],
      athletePermissions: [],
      requestedScopes: REQUESTED_SCOPES,
      modeLabel: 'Disconnected · Read-Only Probe Ready (No Credentials Set)',
    };
  }

  const syncErrors: string[] = [];
  const permissionIssues: string[] = [];

  // Step 1: Verify primary coach account identity (/api/v1/athlete/0)
  const selfRes = await fetchIntervalsJson('/athlete/0', auth.header);
  if (!selfRes.ok || !selfRes.data || typeof selfRes.data !== 'object') {
    const msg = `Primary coach identity check (/api/v1/athlete/0) failed (${selfRes.errorText ?? 'unknown error'}).`;
    syncErrors.push(msg);
    recentSyncErrors = syncErrors;
    return {
      configured: true,
      connected: false,
      authMethod: auth.method,
      coachAccountIdentity: null,
      coachAthleteId: null,
      authorizedAthleteCount: 0,
      visibleCoachAthletesCount: 0,
      lastSynchronizedAt: lastSyncTimestamp,
      syncErrors,
      permissionIssues: [
        'Authentication credentials were rejected or network access is restricted. Verify server-side Coach API key or Coach-App OAuth scopes.',
      ],
      athletePermissions: [],
      requestedScopes: REQUESTED_SCOPES,
      modeLabel: 'Authentication Failed · Read-Only Test',
    };
  }

  const selfProfile = selfRes.data as { id?: string; name?: string; email?: string };
  const coachIdentity = `${selfProfile.name ?? 'Coach Account'} (${selfProfile.id ?? '0'})`;

  // Step 2: Query coached athletes list (/athlete/0/athlete-summary.json + /athletes)
  const newest = checkedAt.slice(0, 10);
  const oldestDate = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  const summaryRes = await fetchIntervalsJson(
    `/athlete/0/athlete-summary.json?start=${oldestDate}&end=${newest}`,
    auth.header
  );
  const listRes = await fetchIntervalsJson('/athletes', auth.header);

  const combinedRoster = [
    ...(summaryRes.ok ? normalizeRosterEntries(summaryRes.data) : []),
    ...(listRes.ok ? normalizeRosterEntries(listRes.data) : []),
  ];
  const dedupedRosterMap = new Map(combinedRoster.map((r) => [r.id, r]));
  const rawList =
    dedupedRosterMap.size > 0
      ? Array.from(dedupedRosterMap.values())
      : [
          {
            id: selfProfile.id ?? '0',
            name: selfProfile.name ?? 'Coach Account',
            email: selfProfile.email ?? null,
          },
        ];

  if (!summaryRes.ok && !listRes.ok) {
    permissionIssues.push(
      `Coach roster endpoints (/athlete/0/athlete-summary.json & /athletes) failed (${listRes.errorText ?? summaryRes.errorText}).`
    );
  }

  // Step 3: Probe actual read permissions per shared athlete (never assume visibility == API authorization)
  const athletePermissions: IntervalsPermissionCheck[] = [];

  for (const ath of rawList.slice(0, 50)) {
    const id = ath.id ?? '0';
    const actProbe = await fetchIntervalsJson(
      `/athlete/${encodeURIComponent(id)}/activities?oldest=${oldestDate}&newest=${newest}`,
      auth.header
    );
    const wellProbe = await fetchIntervalsJson(
      `/athlete/${encodeURIComponent(id)}/wellness?oldest=${oldestDate}&newest=${newest}`,
      auth.header
    );
    const calProbe = await fetchIntervalsJson(
      `/athlete/${encodeURIComponent(id)}/events?oldest=${oldestDate}&newest=${newest}`,
      auth.header
    );

    const activityRead = actProbe.ok;
    const wellnessRead = wellProbe.ok;
    const calendarRead = calProbe.ok;

    let authorizationState: IntervalsPermissionCheck['authorizationState'] =
      'Authorized (Read-Only)';
    let diagnosticMessage =
      'Verified ACTIVITY:READ, WELLNESS:READ, CALENDAR:READ via coach credentials (no athlete key required).';

    if (!activityRead && !wellnessRead) {
      authorizationState =
        actProbe.status === 403 ? 'Coach View Only (No API Scope)' : 'Permission Denied';
      diagnosticMessage = `Blocked (${actProbe.errorText ?? '403'}): athlete must authorize coach/app access in Intervals.icu Settings.`;
      permissionIssues.push(`${ath.name ?? id}: ${diagnosticMessage}`);
    } else if (!activityRead || !wellnessRead || !calendarRead) {
      diagnosticMessage = `Partial read scope — Activities: ${activityRead ? 'OK' : actProbe.errorText}, Wellness: ${
        wellnessRead ? 'OK' : wellProbe.errorText
      }, Calendar: ${calendarRead ? 'OK' : calProbe.errorText}.`;
    }

    athletePermissions.push({
      athleteId: id,
      athleteName: ath.name ?? id,
      email: ath.email ?? null,
      activityRead,
      wellnessRead,
      calendarRead,
      authorizationState,
      diagnosticMessage,
    });
  }

  const authorizedCount = athletePermissions.filter(
    (p) => p.authorizationState === 'Authorized (Read-Only)' && p.activityRead
  ).length;

  lastSyncTimestamp = checkedAt;
  recentSyncErrors = syncErrors;

  return {
    configured: true,
    connected: true,
    authMethod: auth.method,
    coachAccountIdentity: coachIdentity,
    coachAthleteId: selfProfile.id ?? null,
    authorizedAthleteCount: authorizedCount,
    visibleCoachAthletesCount: rawList.length,
    lastSynchronizedAt: checkedAt,
    syncErrors,
    permissionIssues,
    athletePermissions,
    requestedScopes: REQUESTED_SCOPES,
    modeLabel: `Connected (Read-Only) · ${authorizedCount}/${rawList.length} Athletes Verified`,
  };
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

function getNumericActivityHr(
  act: Record<string, unknown> | null | undefined,
  kind: 'avg' | 'max'
): number | null {
  if (!act) return null;
  if (kind === 'avg') {
    if (typeof act.average_heartrate === 'number' && act.average_heartrate > 0) {
      return act.average_heartrate;
    }
    if (typeof act.average_hr === 'number' && act.average_hr > 0) {
      return act.average_hr;
    }
    return null;
  }
  if (typeof act.max_heartrate === 'number' && act.max_heartrate > 0) {
    return act.max_heartrate;
  }
  if (typeof act.max_hr === 'number' && act.max_hr > 0) {
    return act.max_hr;
  }
  return null;
}

export async function runFullRosterDeepTelemetryValidation(options?: {
  fetcher?: FetchLike;
  apiKeyOverride?: string;
  pilotAthleteId?: string;
  windowDays?: number;
  coachId?: string;
  store?: OAuthPersistenceStore;
}): Promise<RosterDeepTelemetryValidationReport> {
  const fetcher = options?.fetcher ?? fetch;
  const auth = options?.apiKeyOverride
    ? getAuthHeader(options.apiKeyOverride)
    : options?.coachId
    ? await resolveAuthHeaderForCoach(options.coachId, options.store)
    : getAuthHeader();
  const checkedAt = new Date().toISOString();
  const windowDays = Math.max(84, options?.windowDays ?? 90);
  const windowEndDate = checkedAt.slice(0, 10);
  const windowStartDate = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  const emptySummary = {
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
  };

  if (!auth) {
    return {
      configured: false,
      connected: false,
      readOnlyMode: true,
      oauthRequired: false,
      windowDays,
      windowStartDate,
      windowEndDate,
      coachAccountInfo: null,
      totalCoachedAthletes: 0,
      summary: emptySummary,
      athletes: [],
      checkedAt,
      errors: [
        'INTERVALS_ICU_API_KEY is not configured on the server. Full roster validation requires a valid server-side API key.',
      ],
    };
  }

  const errors: string[] = [];
  const selfRes = await fetchIntervalsJson('/athlete/0', auth.header, fetcher);
  if (!selfRes.ok || !selfRes.data || typeof selfRes.data !== 'object') {
    const err = `Coach authentication failed on /api/v1/athlete/0 (${selfRes.errorText ?? 'unknown'}).`;
    errors.push(err);
    return {
      configured: true,
      connected: false,
      readOnlyMode: true,
      oauthRequired: false,
      windowDays,
      windowStartDate,
      windowEndDate,
      coachAccountInfo: null,
      totalCoachedAthletes: 0,
      summary: emptySummary,
      athletes: [],
      checkedAt,
      errors,
    };
  }

  const selfProfile = selfRes.data as {
    id?: string | number;
    name?: string;
    email?: string;
    timezone?: string;
  };
  const coachId = selfProfile.id !== undefined ? String(selfProfile.id) : '0';
  const coachAccountInfo = {
    id: coachId,
    name: selfProfile.name ?? 'Coach Account',
    email: typeof selfProfile.email === 'string' ? selfProfile.email : null,
    timezone: typeof selfProfile.timezone === 'string' ? selfProfile.timezone : null,
  };

  const summaryRes = await fetchIntervalsJson(
    `/athlete/0/athlete-summary.json?start=${windowStartDate}&end=${windowEndDate}`,
    auth.header,
    fetcher
  );
  const athletesListRes = await fetchIntervalsJson('/athletes', auth.header, fetcher);
  const mergedRosterMap = new Map<string, { id: string; name: string; email: string | null }>();
  for (const r of [
    ...(summaryRes.ok ? normalizeRosterEntries(summaryRes.data) : []),
    ...(athletesListRes.ok ? normalizeRosterEntries(athletesListRes.data) : []),
  ]) {
    mergedRosterMap.set(r.id, r);
  }
  const coachedRoster = Array.from(mergedRosterMap.values()).filter((a) => a.id !== coachId);
  const pilotId = options?.pilotAthleteId ?? coachedRoster[0]?.id ?? null;

  const validateSingleAthlete = async (entry: {
    id: string;
    name: string;
  }): Promise<AthleteDeepTelemetryValidation> => {
    const encodedId = encodeURIComponent(entry.id);
    const syncedAt = new Date().toISOString();
    const notes: string[] = [];
    const missingFields: string[] = [];

    const [profileRes, activitiesRes, wellnessRes] = await Promise.all([
      fetchIntervalsJson(`/athlete/${encodedId}`, auth.header, fetcher),
      fetchIntervalsJson(
        `/athlete/${encodedId}/activities?oldest=${windowStartDate}&newest=${windowEndDate}`,
        auth.header,
        fetcher
      ),
      fetchIntervalsJson(
        `/athlete/${encodedId}/wellness?oldest=${windowStartDate}&newest=${windowEndDate}`,
        auth.header,
        fetcher
      ),
    ]);

    const profileObj =
      profileRes.ok && profileRes.data && typeof profileRes.data === 'object'
        ? (profileRes.data as {
            id?: string | number;
            name?: string;
            lthr?: number;
            sportSettings?: Array<{
              types?: string[];
              lthr?: number;
              hr_zones?: number[];
              threshold_pace?: number;
              ftp?: number;
              run_ftp?: number;
            }>;
          })
        : null;

    if (!profileRes.ok || !profileObj) {
      missingFields.push('Athlete Profile & Sport Settings (Permission Denied)');
    }

    const runSetting =
      profileObj?.sportSettings?.find((s) =>
        Array.isArray(s.types) ? s.types.some((t) => t.toLowerCase().includes('run')) : false
      ) ?? profileObj?.sportSettings?.[0];

    const rawActivities =
      activitiesRes.ok && Array.isArray(activitiesRes.data)
        ? (activitiesRes.data as Array<Record<string, unknown>>)
        : [];
    if (!activitiesRes.ok) {
      missingFields.push(`Activities Endpoint (${activitiesRes.errorText ?? 'Denied'})`);
    }

    const runningActivities = rawActivities
      .filter((a) => isRunningActivityType(a.type))
      .sort((a, b) =>
        String(b.start_date_local ?? '').localeCompare(String(a.start_date_local ?? ''))
      );

    const runDates = runningActivities
      .map((r) => String(r.start_date_local ?? '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    const earliestRunDate = runDates[0] ?? null;
    const latestRunDate = runDates[runDates.length - 1] ?? null;
    const coverageDays =
      earliestRunDate && latestRunDate
        ? Math.max(
            1,
            Math.round(
              (Date.parse(`${latestRunDate}T00:00:00Z`) -
                Date.parse(`${earliestRunDate}T00:00:00Z`)) /
                86400000
            ) + 1
          )
        : 0;
    const coverageWeeks = Number((coverageDays / 7).toFixed(1));

    const activityWithLthr = runningActivities.find(
      (a) => typeof a.lthr === 'number' && Number.isFinite(a.lthr)
    );
    const detectedLthrBpm =
      (typeof runSetting?.lthr === 'number' && runSetting.lthr > 0 ? runSetting.lthr : null) ??
      (typeof profileObj?.lthr === 'number' && profileObj.lthr > 0 ? profileObj.lthr : null) ??
      (typeof activityWithLthr?.lthr === 'number' && activityWithLthr.lthr > 0
        ? activityWithLthr.lthr
        : null);
    const lthrSource =
      typeof runSetting?.lthr === 'number' && runSetting.lthr > 0
        ? 'Run sportSettings.lthr'
        : typeof profileObj?.lthr === 'number' && profileObj.lthr > 0
        ? 'Athlete profile.lthr'
        : typeof activityWithLthr?.lthr === 'number' && activityWithLthr.lthr > 0
        ? 'Activity lthr'
        : null;

    const hrZones = Array.isArray(runSetting?.hr_zones)
      ? runSetting.hr_zones.filter((n) => typeof n === 'number')
      : Array.isArray(runningActivities[0]?.icu_hr_zones)
      ? (runningActivities[0].icu_hr_zones as number[]).filter((n) => typeof n === 'number')
      : [];

    const thresholdPaceAvailable =
      typeof runSetting?.threshold_pace === 'number' && runSetting.threshold_pace > 0;
    const thresholdPowerAvailable =
      (typeof runSetting?.run_ftp === 'number' && runSetting.run_ftp > 0) ||
      (typeof runSetting?.ftp === 'number' && runSetting.ftp > 0);

    const runsWithAvgHr = runningActivities.filter((a) => getNumericActivityHr(a, 'avg') !== null);
    const runsWithMaxHr = runningActivities.filter((a) => getNumericActivityHr(a, 'max') !== null);
    const latestAvgHrRaw = getNumericActivityHr(runsWithAvgHr[0], 'avg');
    const latestMaxHrRaw = getNumericActivityHr(runsWithMaxHr[0], 'max');
    const hrCoveragePct =
      runningActivities.length > 0
        ? Math.round((runsWithAvgHr.length / runningActivities.length) * 100)
        : 0;

    // Verify real HR stream availability on the athlete's latest running activity (preferring one with HR if available)
    const streamCandidate = runsWithAvgHr[0] ?? runningActivities[0] ?? null;
    const hrStreamCheckedActivityId = streamCandidate?.id ? String(streamCandidate.id) : null;
    let hrStreamAvailable = false;
    let hrStreamSampleCount = 0;
    let hrStreamStatus: AthleteDeepTelemetryValidation['hrStreamStatus'] = 'Not Checked (No Runs)';
    let hrStreamDetail = 'No running activities in 12-week window to verify HR stream.';

    if (hrStreamCheckedActivityId) {
      const streamRes = await fetchIntervalsJson(
        `/activity/${encodeURIComponent(hrStreamCheckedActivityId)}/streams.json?types=heartrate`,
        auth.header,
        fetcher
      );
      if (!streamRes.ok) {
        hrStreamStatus = streamRes.status === 403 ? 'Blocked' : 'Unavailable / Empty';
        hrStreamDetail = `Stream request ${streamRes.errorText ?? 'unavailable'} for activity ${hrStreamCheckedActivityId}.`;
      } else if (Array.isArray(streamRes.data)) {
        const hrStreamObj = (
          streamRes.data as Array<{ type?: string; data?: unknown[] }>
        ).find((s) => s.type === 'heartrate');
        const points = Array.isArray(hrStreamObj?.data) ? hrStreamObj.data : [];
        hrStreamSampleCount = points.filter((v) => typeof v === 'number' && v > 0).length;
        hrStreamAvailable = hrStreamSampleCount > 0;
        hrStreamStatus = hrStreamAvailable ? 'Verified Read-Only' : 'Unavailable / Empty';
        hrStreamDetail = hrStreamAvailable
          ? `${hrStreamSampleCount} HR stream sample points verified on ${hrStreamCheckedActivityId}.`
          : `Activity ${hrStreamCheckedActivityId} returned 0 heartrate stream points.`;
      } else {
        hrStreamStatus = 'Unavailable / Empty';
        hrStreamDetail = `Unexpected stream payload format on ${hrStreamCheckedActivityId}.`;
      }
    }

    const runsWithLoad = runningActivities.filter(
      (a) => typeof a.icu_training_load === 'number' && Number.isFinite(a.icu_training_load)
    );
    const latestIcuTrainingLoad =
      typeof runsWithLoad[0]?.icu_training_load === 'number'
        ? Math.round(runsWithLoad[0].icu_training_load)
        : null;

    const wellnessRecords =
      wellnessRes.ok && Array.isArray(wellnessRes.data)
        ? (wellnessRes.data as Array<Record<string, unknown>>).sort((a, b) =>
            String(b.id ?? '').localeCompare(String(a.id ?? ''))
          )
        : [];
    if (!wellnessRes.ok) {
      missingFields.push(`Wellness Endpoint (${wellnessRes.errorText ?? 'Denied'})`);
    }

    const latestWithCtl = wellnessRecords.find(
      (w) =>
        (typeof w.ctl === 'number' && Number.isFinite(w.ctl)) ||
        (typeof w.icu_ctl === 'number' && Number.isFinite(w.icu_ctl))
    );
    const latestCtlRaw =
      typeof latestWithCtl?.ctl === 'number'
        ? latestWithCtl.ctl
        : typeof latestWithCtl?.icu_ctl === 'number'
        ? latestWithCtl.icu_ctl
        : null;
    const latestAtlRaw =
      typeof latestWithCtl?.atl === 'number'
        ? latestWithCtl.atl
        : typeof latestWithCtl?.icu_atl === 'number'
        ? latestWithCtl.icu_atl
        : null;
    const latestCtl = latestCtlRaw !== null ? Number(latestCtlRaw.toFixed(1)) : null;
    const latestAtl = latestAtlRaw !== null ? Number(latestAtlRaw.toFixed(1)) : null;
    const nativeTsb =
      latestCtl !== null && latestAtl !== null
        ? Number((latestCtl - latestAtl).toFixed(1))
        : null;

    const latestWithHrv = wellnessRecords.find(
      (w) =>
        (typeof w.hrv === 'number' && w.hrv > 0) ||
        (typeof w.hrvSDNN === 'number' && w.hrvSDNN > 0) ||
        (typeof w.rmssd === 'number' && w.rmssd > 0)
    );
    const latestHrv =
      typeof latestWithHrv?.hrv === 'number'
        ? Number(latestWithHrv.hrv.toFixed(1))
        : typeof latestWithHrv?.rmssd === 'number'
        ? Number(latestWithHrv.rmssd.toFixed(1))
        : typeof latestWithHrv?.hrvSDNN === 'number'
        ? Number(latestWithHrv.hrvSDNN.toFixed(1))
        : null;

    const latestWithRhr = wellnessRecords.find(
      (w) => typeof w.restingHR === 'number' && w.restingHR > 0
    );
    const latestRestingHr =
      typeof latestWithRhr?.restingHR === 'number' ? Math.round(latestWithRhr.restingHR) : null;

    const latestWithSleep = wellnessRecords.find(
      (w) => typeof w.sleepSecs === 'number' && w.sleepSecs > 0
    );
    const latestSleepHours =
      typeof latestWithSleep?.sleepSecs === 'number'
        ? Number((latestWithSleep.sleepSecs / 3600).toFixed(1))
        : null;

    // Record missing fields transparently — never invent defaults
    if (runningActivities.length === 0) missingFields.push('Running Activities (0 in 12w)');
    if (detectedLthrBpm === null) missingFields.push('LTHR');
    if (hrZones.length === 0) missingFields.push('HR Zones');
    if (runningActivities.length > 0 && runsWithAvgHr.length === 0) {
      missingFields.push('Activity Avg/Max HR');
    } else if (runningActivities.length > 0 && runsWithAvgHr.length < runningActivities.length) {
      notes.push(
        `Partial HR coverage: ${runsWithAvgHr.length}/${runningActivities.length} running activities have HR.`
      );
    }
    if (!hrStreamAvailable) missingFields.push('HR Time-Series Stream');
    if (runsWithLoad.length === 0) missingFields.push('Activity Training Load (icu_training_load)');
    if (wellnessRecords.length === 0) missingFields.push('Wellness Records');
    if (latestCtl === null || latestAtl === null) missingFields.push('Wellness CTL/ATL');
    if (latestHrv === null) missingFields.push('Wellness HRV');
    if (latestRestingHr === null) missingFields.push('Wellness Resting HR');
    if (latestSleepHours === null) missingFields.push('Wellness Sleep');

    if (coverageWeeks > 0 && coverageWeeks < 8) {
      notes.push(`Short history window (${coverageWeeks} wks observed in last ${windowDays}d).`);
    }
    if (!thresholdPaceAvailable) {
      notes.push('Run threshold_pace not set in Intervals.icu sportSettings (Coach baseline needed for Pace rTSS).');
    }

    const hrDerivedStressReady = detectedLthrBpm !== null && runsWithAvgHr.length > 0;
    const ewmaLoadModelReady = runningActivities.length > 0 && (hrDerivedStressReady || thresholdPaceAvailable);

    const permissionDenied =
      (profileRes.status === 401 || profileRes.status === 403) &&
      (activitiesRes.status === 401 || activitiesRes.status === 403);
    let dataQualityTier: AthleteDeepTelemetryValidation['dataQualityTier'];
    let verificationStatus: AthleteDeepTelemetryValidation['verificationStatus'];

    if (permissionDenied) {
      dataQualityTier = 'Permission Denied';
      verificationStatus = 'Permission Denied';
    } else if (
      runningActivities.length > 0 &&
      detectedLthrBpm !== null &&
      hrZones.length > 0 &&
      runsWithAvgHr.length > 0 &&
      hrStreamAvailable &&
      runsWithLoad.length > 0 &&
      latestCtl !== null
    ) {
      dataQualityTier = 'Full Telemetry Ready';
      verificationStatus =
        entry.id === pilotId
          ? 'Verified Read-Only · Pilot Baseline'
          : 'Verified Read-Only · Full Telemetry';
    } else if (runningActivities.length > 0 && (runsWithAvgHr.length > 0 || runsWithLoad.length > 0)) {
      dataQualityTier = 'Partial Telemetry (Usable)';
      verificationStatus = 'Verified Read-Only · Partial Telemetry';
    } else {
      dataQualityTier = 'Limited / Missing Critical Telemetry';
      verificationStatus = 'Verified Read-Only · Missing Critical Telemetry';
    }

    return {
      athleteId: entry.id,
      athleteName: profileObj?.name ?? entry.name,
      isPilotAthlete: entry.id === pilotId,
      profileAccessible: Boolean(profileRes.ok && profileObj),
      sportSettingsFound: Boolean(runSetting),
      lthrAvailable: detectedLthrBpm !== null,
      detectedLthrBpm,
      lthrSource,
      hrZonesAvailable: hrZones.length > 0,
      hrZoneCount: hrZones.length,
      hrZones,
      thresholdPaceAvailable,
      thresholdPowerAvailable,
      windowStartDate,
      windowEndDate,
      totalActivitiesCount: rawActivities.length,
      runningActivitiesCount: runningActivities.length,
      earliestRunDate,
      latestRunDate,
      coverageDays,
      coverageWeeks,
      runsWithAvgHrCount: runsWithAvgHr.length,
      runsWithMaxHrCount: runsWithMaxHr.length,
      hrCoveragePct,
      latestAvgHrBpm: latestAvgHrRaw !== null ? Math.round(latestAvgHrRaw) : null,
      latestMaxHrBpm: latestMaxHrRaw !== null ? Math.round(latestMaxHrRaw) : null,
      hrStreamCheckedActivityId,
      hrStreamAvailable,
      hrStreamSampleCount,
      hrStreamStatus,
      hrStreamDetail,
      trainingLoadAvailable: runsWithLoad.length > 0,
      runsWithLoadCount: runsWithLoad.length,
      latestIcuTrainingLoad,
      wellnessAvailable: wellnessRecords.length > 0,
      wellnessRecordsCount: wellnessRecords.length,
      ctlAtlAvailable: latestCtl !== null && latestAtl !== null,
      latestCtl,
      latestAtl,
      nativeTsb,
      hrvAvailable: latestHrv !== null,
      latestHrv,
      restingHrAvailable: latestRestingHr !== null,
      latestRestingHr,
      sleepAvailable: latestSleepHours !== null,
      latestSleepHours,
      missingFields,
      dataQualityTier,
      verificationStatus,
      independentLoadEngineReadiness: {
        hrDerivedStressReady,
        paceDerivedStressReady: runningActivities.length > 0 && thresholdPaceAvailable,
        ewmaLoadModelReady,
        hrStreamAuditReady: hrStreamAvailable,
      },
      lastSyncedAt: syncedAt,
      notes,
    };
  };

  // Validate sequentially with polite spacing when calling live Intervals.icu to avoid HTTP 429 throttling
  const validatedAthletes: AthleteDeepTelemetryValidation[] = [];
  for (let i = 0; i < coachedRoster.length; i++) {
    validatedAthletes.push(await validateSingleAthlete(coachedRoster[i]));
    if (fetcher === fetch && i < coachedRoster.length - 1) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  lastSyncTimestamp = checkedAt;

  const summary = {
    fullTelemetryReadyCount: validatedAthletes.filter(
      (a) => a.dataQualityTier === 'Full Telemetry Ready'
    ).length,
    partialTelemetryCount: validatedAthletes.filter(
      (a) => a.dataQualityTier === 'Partial Telemetry (Usable)'
    ).length,
    limitedTelemetryCount: validatedAthletes.filter(
      (a) => a.dataQualityTier === 'Limited / Missing Critical Telemetry'
    ).length,
    permissionDeniedCount: validatedAthletes.filter(
      (a) => a.dataQualityTier === 'Permission Denied'
    ).length,
    lthrAvailableCount: validatedAthletes.filter((a) => a.lthrAvailable).length,
    hrStreamsAvailableCount: validatedAthletes.filter((a) => a.hrStreamAvailable).length,
    trainingLoadAvailableCount: validatedAthletes.filter((a) => a.trainingLoadAvailable).length,
    wellnessAvailableCount: validatedAthletes.filter((a) => a.wellnessAvailable).length,
    totalRunningActivities: validatedAthletes.reduce(
      (sum, a) => sum + a.runningActivitiesCount,
      0
    ),
    hrDerivedEngineReadyCount: validatedAthletes.filter(
      (a) => a.independentLoadEngineReadiness.hrDerivedStressReady
    ).length,
  };

  return {
    configured: true,
    connected: true,
    readOnlyMode: true,
    oauthRequired: false,
    windowDays,
    windowStartDate,
    windowEndDate,
    coachAccountInfo,
    totalCoachedAthletes: validatedAthletes.length,
    summary,
    athletes: validatedAthletes,
    checkedAt,
    errors,
  };
}

