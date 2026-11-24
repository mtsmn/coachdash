import type { SupabaseClient } from '@supabase/supabase-js';
import { redactSensitiveText, sha256Hex } from './crypto.ts';
import {
  checkPersistedRosterSyncAuthorization,
  fetchCompleteIntervalsRoster,
  type FetchIntervalsRetryOptions,
  type FetchLike,
  fetchIntervalsJson,
  isCoachSelfAthleteId,
  isRunningActivityType,
  type NormalizedRosterEntryWithMeta,
  normalizeRosterEntries,
} from './intervalsClient.ts';
import { getOAuthPersistenceStore, type OAuthPersistenceStore } from './oauthStore.ts';
import {
  fetchAllPagedRows,
  getSupabaseAdminClient,
  upsertRowsInChunks,
} from './supabaseAdmin.ts';

export type SyncJobStatus =
  | 'Queued'
  | 'Running'
  | 'Succeeded'
  | 'Partial'
  | 'Retried & Queued'
  | 'Blocked (Unauthorized)'
  | 'Failed';

export type SyncJobType =
  | 'daily_activity_import'
  | 'daily_metric_update'
  | 'backfill_12w'
  | 'retry_sync'
  | 'finalsurge_csv_import';

export type StreamAvailabilityState =
  | 'imported'
  | 'missing'
  | 'unavailable'
  | 'not_applicable';

export interface PilotSyncOptions {
  coachId: string;
  requestedAthleteId?: string | null;
  mode?: 'auto' | 'initial' | 'incremental';
  nowIso?: string;
  initialLookbackDays?: number;
  overlapDays?: number;
  chunkDays?: number;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}

export interface PilotSyncSummary {
  ok: boolean;
  statusCode: 200 | 403 | 409 | 502 | 503;
  blockedByPilotGate: boolean;
  status: SyncJobStatus;
  syncLogId: string | null;
  jobType: SyncJobType;
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

export type RosterAthleteSyncStatus =
  | 'Succeeded'
  | 'Partial'
  | 'Permission Denied'
  | 'Failed'
  | 'Not mapped'
  | 'Awaiting coach review';

export type RosterDisplayStatus =
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
  status: RosterAthleteSyncStatus;
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

export interface FullRosterSyncOptions {
  coachId: string;
  mode?: 'auto' | 'initial' | 'incremental';
  athleteIds?: string[];
  retryFailedOnly?: boolean;
  concurrency?: number;
  nowIso?: string;
  initialLookbackDays?: number;
  overlapDays?: number;
  chunkDays?: number;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}

export interface FullRosterSyncSummary {
  ok: boolean;
  statusCode: 200 | 403 | 409 | 502 | 503;
  blockedByPilotGate: boolean;
  status: SyncJobStatus;
  syncLogId: string | null;
  jobType: SyncJobType;
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

export interface IntervalsAthleteSyncHistoryEntry {
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

export interface IntervalsRosterCandidateMatch {
  athleteId: string;
  fullName: string;
  email: string | null;
  reason: string;
}

export interface IntervalsPermissionCapabilities {
  settings: 'granted' | 'denied' | 'unknown';
  activities: 'granted' | 'denied' | 'unknown';
  wellness: 'granted' | 'denied' | 'unknown';
}

export interface IntervalsRosterAthleteOverviewRow {
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
  permissionCapabilities?: IntervalsPermissionCapabilities;
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  activitiesImportedCount: number;
  hrStreamsImportedCount: number;
  wellnessRecordsImportedCount: number;
  currentSyncStatus: RosterDisplayStatus;
  mostRecentError: string | null;
  eligibleForSync: boolean;
  candidateMatches: IntervalsRosterCandidateMatch[];
  syncHistory: IntervalsAthleteSyncHistoryEntry[];
}

export interface RosterLiveProgressSnapshot {
  running: boolean;
  mode: string;
  totalSelected: number;
  completedCount: number;
  activeAthleteIds: string[];
  startedAt: string;
}

export interface IntervalsRosterOverviewResponse {
  ok: boolean;
  statusCode: 200 | 409 | 502 | 503;
  blockedByPilotGate: boolean;
  errorMessage: string | null;
  verifiedPilotAthleteId: string | null;
  externalCoachId: string | null;
  excludedCoachIds: string[];
  pagesFetched: number;
  fetchedAt: string;
  lastFullRosterSyncAt: string | null;
  liveProgress: RosterLiveProgressSnapshot | null;
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
  athletes: IntervalsRosterAthleteOverviewRow[];
  existingAthletes: Array<{
    id: string;
    fullName: string;
    email: string | null;
    alreadyMappedToExternalId: string | null;
  }>;
  warnings: string[];
}

export interface ResolveIntervalsMappingOptions {
  coachId: string;
  action: 'link_existing' | 'create_and_link' | 'confirm_candidate' | 'leave_unmapped';
  externalAthleteId: string;
  athleteId?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}

export interface ResolveIntervalsMappingResult {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404 | 409 | 502 | 503;
  action: ResolveIntervalsMappingOptions['action'];
  externalAthleteId: string;
  internalAthleteId: string | null;
  athleteName: string | null;
  mappingStatus: 'Verified Match' | 'Candidate Review Required' | 'Unmapped';
  message: string;
}

export interface ProductionPilotDashboardData {
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
  availableAthletes: Array<{
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
    liveProgress: RosterLiveProgressSnapshot | null;
    athletes: Array<{
      internalAthleteId: string;
      externalAthleteId: string | null;
      fullName: string;
      isPilotAthlete: boolean;
      mappingStatus: string;
      authorizationStatus: string;
      currentSyncStatus: RosterDisplayStatus;
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
    streamStatus: StreamAvailabilityState;
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
}

const DEFAULT_INITIAL_LOOKBACK_DAYS = 1825; // 5 years
const DEFAULT_OVERLAP_DAYS = 14;
const DEFAULT_CHUNK_DAYS = 180;
const MIN_HISTORICAL_FLOOR_DATE = '2015-01-01';
const CTL_ALPHA = 1 - Math.exp(-1 / 42);
const ATL_ALPHA = 1 - Math.exp(-1 / 7);

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso.slice(0, 10);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function isIsoDateString(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim());
}

function finiteOrNull(val: unknown): number | null {
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function intInRangeOrNull(val: unknown, min: number, max: number): number | null {
  const n = finiteOrNull(val);
  if (n === null) return null;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : null;
}

function floatInRangeOrNull(val: unknown, min: number, max: number, decimals = 2): number | null {
  const n = finiteOrNull(val);
  if (n === null) return null;
  const rounded = Number(n.toFixed(decimals));
  return rounded >= min && rounded <= max ? rounded : null;
}

export function sanitizeProviderPayloadForStorage(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderPayloadForStorage(item));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(access_?token|refresh_?token|client_?secret|api_?key|authorization|password|cookie)/i.test(k)) {
        continue;
      }
      out[k] = sanitizeProviderPayloadForStorage(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    return redactSensitiveText(value);
  }
  return value;
}

async function storeRawPayload(params: {
  client: SupabaseClient;
  coachId: string;
  athleteId: string | null;
  entityType: 'athlete_profile' | 'activity' | 'streams' | 'wellness';
  externalId: string;
  sourceDevice?: string | null;
  payload: unknown;
  fetchedAt: string;
  cache?: Map<string, string>;
}): Promise<string | null> {
  const sanitized = sanitizeProviderPayloadForStorage(params.payload);
  const serialized = JSON.stringify(sanitized ?? {});
  const payloadSha256 = sha256Hex(serialized);
  const cacheKey = `${params.entityType}::${params.externalId}::${payloadSha256}`;

  const cachedId = params.cache?.get(cacheKey);
  if (cachedId) {
    return cachedId;
  }

  const { data: existing } = await params.client
    .from('raw_provider_payloads')
    .select('id')
    .eq('coach_id', params.coachId)
    .eq('provider', 'intervals_icu')
    .eq('entity_type', params.entityType)
    .eq('external_id', params.externalId)
    .eq('payload_sha256', payloadSha256)
    .maybeSingle();

  if (existing?.id) {
    const id = String(existing.id);
    params.cache?.set(cacheKey, id);
    return id;
  }

  const { data: inserted, error } = await params.client
    .from('raw_provider_payloads')
    .insert({
      coach_id: params.coachId,
      athlete_id: params.athleteId,
      provider: 'intervals_icu',
      entity_type: params.entityType,
      external_id: params.externalId,
      source_device: params.sourceDevice ?? null,
      payload: sanitized,
      payload_sha256: payloadSha256,
      fetched_at: params.fetchedAt,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      const { data: raced } = await params.client
        .from('raw_provider_payloads')
        .select('id')
        .eq('coach_id', params.coachId)
        .eq('provider', 'intervals_icu')
        .eq('entity_type', params.entityType)
        .eq('external_id', params.externalId)
        .eq('payload_sha256', payloadSha256)
        .maybeSingle();
      if (raced?.id) {
        const id = String(raced.id);
        params.cache?.set(cacheKey, id);
        return id;
      }
      return null;
    }
    throw new Error(`Failed to store raw provider payload: ${error.message}`);
  }

  if (inserted?.id) {
    const id = String(inserted.id);
    params.cache?.set(cacheKey, id);
    return id;
  }
  return null;
}

function normalizeGender(raw: unknown): 'F' | 'M' | 'NB' | null {
  if (typeof raw !== 'string') return null;
  const g = raw.trim().toLowerCase();
  if (g === 'f' || g === 'female') return 'F';
  if (g === 'm' || g === 'male') return 'M';
  if (g === 'nb' || g === 'non-binary' || g === 'nonbinary' || g === 'other') return 'NB';
  return null;
}

function computeAgeFromDob(dob: unknown, nowIso: string): number | null {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const birth = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  const ref = new Date(nowIso);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getUTCFullYear() - birth.getUTCFullYear();
  const mDiff = ref.getUTCMonth() - birth.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && ref.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return age >= 12 && age <= 110 ? age : null;
}

function normalizeThresholdPaceSecPerMile(rawThresholdPace: unknown): number | null {
  const val = finiteOrNull(rawThresholdPace);
  if (val === null || val <= 0) return null;
  // Intervals.icu stores threshold_pace in m/s (typical running values ~2.0 to ~6.5 m/s).
  if (val < 15) {
    const secPerMile = Math.round(1609.34 / val);
    return secPerMile > 180 && secPerMile < 2400 ? secPerMile : null;
  }
  // If already in seconds per mile (> 180)
  const rounded = Math.round(val);
  return rounded > 180 && rounded < 2400 ? rounded : null;
}

function classifyActivityType(raw: Record<string, unknown>, distanceMiles: number, durationMinutes: number): 'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race' | 'Rest' {
  const rawType = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
  const name = typeof raw.name === 'string' ? raw.name.toLowerCase() : '';

  if (rawType === 'rest' || rawType === 'note') {
    return 'Rest';
  }
  if (raw.race === true || /\brace\b|\b5k\b|\b10k\b|half marathon|marathon/i.test(name)) {
    return 'Race';
  }
  if (/interval|track|repeat|vo2|fartlek|speed|strides/i.test(name)) {
    return 'Intervals';
  }
  if (/tempo|threshold|lactate|cruise|progression/i.test(name)) {
    return 'Tempo';
  }
  if (/recovery|shakeout|easy spin|mobility|walk/i.test(name)) {
    return 'Recovery';
  }
  if (
    isRunningActivityType(raw.type) &&
    (distanceMiles >= 11 || durationMinutes >= 90 || /\blong\b/i.test(name))
  ) {
    return 'Long Run';
  }
  return 'Easy';
}

function extractActivitySourceDevice(raw: Record<string, unknown>): string | null {
  const candidate = raw.device_name ?? raw.source ?? raw.external_source;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return null;
}

function validateImportedActivityHr(params: {
  rawAvgHr: unknown;
  rawMaxHr: unknown;
  athleteMaxHrBpm: number | null;
  isRest: boolean;
  durationMinutes: number;
  distanceMiles: number;
}): {
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  hrDataState: 'valid' | 'missing' | 'invalid' | 'rest_zero';
  flags: string[];
} {
  const flags: string[] = [];

  if (params.isRest && params.durationMinutes === 0 && params.distanceMiles === 0) {
    return {
      avgHrBpm: null,
      maxHrBpm: null,
      hrDataState: 'rest_zero',
      flags,
    };
  }

  const rawAvg = finiteOrNull(params.rawAvgHr);
  const rawMax = finiteOrNull(params.rawMaxHr);

  if (rawAvg === null) {
    return {
      avgHrBpm: null,
      maxHrBpm: intInRangeOrNull(rawMax, 25, 255),
      hrDataState: 'missing',
      flags: ['hr_telemetry_missing'],
    };
  }

  const roundedAvg = Math.round(rawAvg);
  let roundedMax = rawMax !== null ? Math.round(rawMax) : null;

  const ceiling = params.athleteMaxHrBpm ? Math.min(235, params.athleteMaxHrBpm + 15) : 230;
  if (roundedAvg <= 0 || roundedAvg < 25 || roundedAvg > 250) {
    flags.push(`invalid_avg_hr_out_of_bounds:${roundedAvg}`);
  } else if (roundedAvg < 40) {
    flags.push(`implausibly_low_hr:${roundedAvg}`);
  } else if (roundedAvg > ceiling) {
    flags.push(`hr_exceeds_ceiling:${roundedAvg}`);
  }

  if (roundedMax !== null) {
    if (roundedMax < 25 || roundedMax > 255) {
      flags.push(`invalid_max_hr_out_of_bounds:${roundedMax}`);
      roundedMax = null;
    } else if (roundedAvg >= 25 && roundedMax < roundedAvg) {
      flags.push(`max_hr_below_avg_hr:${roundedMax}<${roundedAvg}`);
    }
  }

  if (flags.length > 0) {
    return {
      // Schema requires avg_hr_bpm NULL or BETWEEN 25 AND 250; store valid numeric or NULL on extreme out-of-range
      avgHrBpm: roundedAvg >= 25 && roundedAvg <= 250 ? roundedAvg : null,
      maxHrBpm: roundedMax,
      hrDataState: 'invalid',
      flags,
    };
  }

  return {
    avgHrBpm: roundedAvg,
    maxHrBpm: roundedMax,
    hrDataState: 'valid',
    flags: [],
  };
}

function buildDateChunks(
  startDate: string,
  endDate: string,
  chunkDays: number
): Array<{ oldest: string; newest: string }> {
  const chunks: Array<{ oldest: string; newest: string }> = [];
  let cursor = startDate;
  const safeSpan = Math.max(7, Math.min(365, chunkDays));

  while (cursor <= endDate) {
    const chunkEnd = addDaysIso(cursor, safeSpan - 1);
    const boundedEnd = chunkEnd < endDate ? chunkEnd : endDate;
    chunks.push({ oldest: cursor, newest: boundedEnd });
    if (boundedEnd >= endDate) break;
    cursor = addDaysIso(boundedEnd, 1);
  }
  return chunks;
}

async function fetchIntervalsArrayChunked(params: {
  endpointPath: string; // e.g. `/athlete/${encoded}/activities`
  oldest: string;
  newest: string;
  chunkDays: number;
  authHeader: string;
  fetcher: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}): Promise<{
  ok: boolean;
  items: Array<Record<string, unknown>>;
  chunksQueried: number;
  chunkErrors: string[];
}> {
  const initialChunks = buildDateChunks(params.oldest, params.newest, params.chunkDays);
  const queue = [...initialChunks];
  const items: Array<Record<string, unknown>> = [];
  const chunkErrors: string[] = [];
  let chunksQueried = 0;

  while (queue.length > 0) {
    const chunk = queue.shift()!;
    chunksQueried++;
    const res = await fetchIntervalsJson(
      `${params.endpointPath}?oldest=${chunk.oldest}&newest=${chunk.newest}`,
      params.authHeader,
      params.fetcher,
      params.retryOptions
    );

    if (!res.ok) {
      // Subdivide large chunk into 30-day slices if payload too large (413/400)
      const spanDays =
        Math.round(
          (Date.parse(`${chunk.newest}T00:00:00Z`) - Date.parse(`${chunk.oldest}T00:00:00Z`)) /
            86400000
        ) + 1;
      if ((res.status === 413 || res.status === 400) && spanDays > 30) {
        const subChunks = buildDateChunks(chunk.oldest, chunk.newest, Math.max(14, Math.floor(spanDays / 3)));
        queue.unshift(...subChunks);
        continue;
      }
      chunkErrors.push(
        `Chunk ${chunk.oldest}..${chunk.newest} failed (${res.errorText ?? `HTTP ${res.status}`})`
      );
      continue;
    }

    if (Array.isArray(res.data)) {
      for (const entry of res.data) {
        if (entry && typeof entry === 'object') {
          items.push(entry as Record<string, unknown>);
        }
      }
    }
  }

  return {
    ok: chunkErrors.length === 0,
    items,
    chunksQueried,
    chunkErrors,
  };
}

function extractStreamsFromResponse(payload: unknown): {
  timeArr: number[] | null;
  hrArr: Array<number | null> | null;
} {
  if (Array.isArray(payload)) {
    const timeStream = (payload as Array<{ type?: string; data?: unknown[] }>).find(
      (s) => s?.type === 'time'
    );
    const hrStream = (payload as Array<{ type?: string; data?: unknown[] }>).find(
      (s) => s?.type === 'heartrate' || s?.type === 'hr'
    );
    const timeArr = Array.isArray(timeStream?.data)
      ? timeStream.data.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
      : null;
    const hrArr = Array.isArray(hrStream?.data)
      ? hrStream.data.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null))
      : null;
    return { timeArr, hrArr };
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const rawTime = Array.isArray(obj.time) ? obj.time : null;
    const rawHr = Array.isArray(obj.heartrate) ? obj.heartrate : null;
    return {
      timeArr: rawTime
        ? rawTime.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
        : null,
      hrArr: rawHr
        ? rawHr.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null))
        : null,
    };
  }

  return { timeArr: null, hrArr: null };
}

function computeMedianSampleIntervalSec(timeArr: number[] | null): number {
  if (!timeArr || timeArr.length < 2) return 1;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(timeArr.length, 200); i++) {
    const d = timeArr[i] - timeArr[i - 1];
    if (Number.isFinite(d) && d > 0 && d <= 300) {
      deltas.push(Math.round(d));
    }
  }
  if (deltas.length === 0) return 1;
  deltas.sort((a, b) => a - b);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)]);
}

function stripStreamFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags
    .filter((f): f is string => typeof f === 'string')
    .filter((f) => !f.startsWith('stream_status:'));
}

async function createSyncLog(params: {
  client: SupabaseClient;
  coachId: string;
  jobType: SyncJobType;
  status: SyncJobStatus;
  startedAt: string;
  errorMessage?: string | null;
  finishedAt?: string | null;
}): Promise<string | null> {
  const { data, error } = await params.client
    .from('synchronization_logs')
    .insert({
      coach_id: params.coachId,
      job_type: params.jobType,
      provider: 'intervals_icu',
      status: params.status,
      attempt_number: 1,
      records_processed: 0,
      duplicates_skipped: 0,
      error_message: params.errorMessage ?? null,
      started_at: params.startedAt,
      finished_at: params.finishedAt ?? null,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to write synchronization log: ${error.message}`);
  }
  return data?.id ? String(data.id) : null;
}

async function finalizeSyncLog(params: {
  client: SupabaseClient;
  coachId: string;
  syncLogId: string | null;
  status: SyncJobStatus;
  recordsProcessed: number;
  duplicatesSkipped: number;
  errorMessage: string | null;
  finishedAt: string;
}): Promise<void> {
  if (!params.syncLogId) return;
  await params.client
    .from('synchronization_logs')
    .update({
      status: params.status,
      records_processed: params.recordsProcessed,
      duplicates_skipped: params.duplicatesSkipped,
      error_message: params.errorMessage,
      finished_at: params.finishedAt,
    })
    .eq('id', params.syncLogId)
    .eq('coach_id', params.coachId);
}

async function appendAuditEvent(params: {
  client: SupabaseClient;
  coachId: string;
  action: string;
  targetEntity: string;
  targetId?: string | null;
  athleteIdSnapshot?: string | null;
  detail: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await params.client.from('audit_events').insert({
    coach_id: params.coachId,
    actor_role: 'owner_coach',
    action: params.action,
    target_entity: params.targetEntity,
    target_id: params.targetId ?? null,
    athlete_id_snapshot: params.athleteIdSnapshot ?? null,
    detail: params.detail,
    metadata: params.metadata ?? {},
  });
}

async function recomputeAndPersistDailyLoadHistories(params: {
  client: SupabaseClient;
  coachId: string;
  athleteId: string;
  activeLthrBpm: number | null;
  thresholdPaceSecPerMile: number | null;
  optionalThresholdPowerWatts: number | null;
  activeThresholdVersion: number;
  computedAt: string;
}): Promise<number> {
  const { data: allActivities, error } = await fetchAllPagedRows(() =>
    params.client
      .from('completed_activities')
      .select(
        'id, activity_date, activity_type, status, duration_minutes, avg_pace_sec_per_mile, avg_hr_bpm, avg_power_watts, rpe, hr_data_state'
      )
      .eq('coach_id', params.coachId)
      .eq('athlete_id', params.athleteId)
      .order('activity_date', { ascending: true })
      .order('id', { ascending: true })
  );

  if (error || !Array.isArray(allActivities) || allActivities.length === 0) {
    return 0;
  }

  type ActivityLoadRow = {
    id: string;
    activity_date: string;
    activity_type: string;
    status: string;
    duration_minutes: number;
    avg_pace_sec_per_mile: number | null;
    avg_hr_bpm: number | null;
    avg_power_watts: number | null;
    rpe: number | null;
    hr_data_state: 'valid' | 'missing' | 'invalid' | 'rest_zero';
  };

  const rows = [...(allActivities as ActivityLoadRow[])].sort((a, b) =>
    a.activity_date.localeCompare(b.activity_date)
  );
  const minDate = rows[0].activity_date.slice(0, 10);
  const maxDate = rows[rows.length - 1].activity_date.slice(0, 10);

  const byDate = new Map<string, ActivityLoadRow[]>();
  for (const r of rows) {
    const d = r.activity_date.slice(0, 10);
    const arr = byDate.get(d) ?? [];
    arr.push(r);
    byDate.set(d, arr);
  }

  const methodologies: Array<{
    id: 'hr_derived_stress' | 'running_tss_pace' | 'running_power_stress' | 'session_rpe_stress';
    enabled: boolean;
  }> = [
    { id: 'hr_derived_stress', enabled: Boolean(params.activeLthrBpm && params.activeLthrBpm > 0) },
    {
      id: 'running_tss_pace',
      enabled: Boolean(params.thresholdPaceSecPerMile && params.thresholdPaceSecPerMile > 0),
    },
    {
      id: 'running_power_stress',
      enabled: Boolean(
        params.optionalThresholdPowerWatts &&
          params.optionalThresholdPowerWatts > 0 &&
          rows.some((r) => (r.avg_power_watts ?? 0) > 0)
      ),
    },
    {
      id: 'session_rpe_stress',
      enabled: rows.some((r) => r.rpe !== null && r.rpe >= 1 && r.rpe <= 10),
    },
  ];

  const loadRowsToUpsert: Array<Record<string, unknown>> = [];

  for (const m of methodologies) {
    if (!m.enabled) continue;
    let ctl = 0;
    let atl = 0;
    let cursor = minDate;

    while (cursor <= maxDate) {
      const dayActs = byDate.get(cursor) ?? [];
      let dayStress = 0;
      let hasMissingOrInvalidHr = false;

      for (const act of dayActs) {
        if (act.hr_data_state === 'missing' || act.hr_data_state === 'invalid') {
          hasMissingOrInvalidHr = true;
        }
        const durMin = Number(act.duration_minutes ?? 0);
        if (durMin <= 0 || act.activity_type === 'Rest') continue;

        if (m.id === 'hr_derived_stress') {
          if (
            act.hr_data_state === 'valid' &&
            act.avg_hr_bpm !== null &&
            params.activeLthrBpm
          ) {
            const intensity = act.avg_hr_bpm / params.activeLthrBpm;
            dayStress += (durMin / 60) * Math.pow(intensity, 2) * 100;
          }
        } else if (m.id === 'running_tss_pace') {
          if (act.avg_pace_sec_per_mile && params.thresholdPaceSecPerMile) {
            const intensity = params.thresholdPaceSecPerMile / act.avg_pace_sec_per_mile;
            dayStress += (durMin / 60) * Math.pow(intensity, 2) * 100;
          }
        } else if (m.id === 'running_power_stress') {
          if (act.avg_power_watts && params.optionalThresholdPowerWatts) {
            const intensity = act.avg_power_watts / params.optionalThresholdPowerWatts;
            dayStress += (durMin / 60) * Math.pow(intensity, 2) * 100;
          }
        } else if (m.id === 'session_rpe_stress') {
          if (act.rpe !== null && act.rpe >= 1 && act.rpe <= 10) {
            const intensity = act.rpe / 7.5;
            dayStress += (durMin / 60) * Math.pow(intensity, 2) * 100;
          }
        }
      }

      const roundedStress = Number(dayStress.toFixed(2));
      ctl = ctl + (roundedStress - ctl) * CTL_ALPHA;
      atl = atl + (roundedStress - atl) * ATL_ALPHA;
      const tsb = ctl - atl;

      loadRowsToUpsert.push({
        coach_id: params.coachId,
        athlete_id: params.athleteId,
        methodology: m.id,
        load_date: cursor,
        daily_stress: roundedStress,
        ctl: Number(ctl.toFixed(2)),
        atl: Number(atl.toFixed(2)),
        tsb: Number(tsb.toFixed(2)),
        ctl_time_constant_days: 42,
        atl_time_constant_days: 7,
        threshold_version_used: params.activeThresholdVersion,
        has_missing_or_invalid_hr: hasMissingOrInvalidHr,
        computed_at: params.computedAt,
      });

      cursor = addDaysIso(cursor, 1);
    }
  }

  if (loadRowsToUpsert.length === 0) return 0;

  const { error: upsertErr } = await upsertRowsInChunks(
    params.client,
    'daily_load_histories',
    loadRowsToUpsert,
    'athlete_id,methodology,load_date',
    500
  );

  if (upsertErr) {
    throw new Error(`Failed to persist daily load histories: ${upsertErr.message}`);
  }

  return loadRowsToUpsert.length;
}

async function recomputeAndPersistIndependentStressMetrics(params: {
  client: SupabaseClient;
  coachId: string;
  athleteId: string;
  activeLthrBpm: number | null;
  thresholdPaceSecPerMile: number | null;
  optionalThresholdPowerWatts: number | null;
  activeThresholdVersion: number;
  computedAt: string;
}): Promise<number> {
  const { data: allActivities, error } = await fetchAllPagedRows(() =>
    params.client
      .from('completed_activities')
      .select(
        'id, activity_date, activity_type, status, duration_minutes, avg_pace_sec_per_mile, avg_hr_bpm, avg_power_watts, rpe, hr_data_state'
      )
      .eq('coach_id', params.coachId)
      .eq('athlete_id', params.athleteId)
      .order('id', { ascending: true })
  );

  if (error) {
    throw new Error(`Failed to query activities for independent stress: ${error.message}`);
  }
  if (!Array.isArray(allActivities) || allActivities.length === 0) {
    return 0;
  }

  const rowsToUpsert: Array<Record<string, unknown>> = [];
  for (const act of allActivities as Array<Record<string, unknown>>) {
    const actId = String(act.id);
    const metricDate = String(act.activity_date).slice(0, 10);
    const durMin = Number(act.duration_minutes ?? 0);
    const isRest = String(act.activity_type) === 'Rest' || durMin <= 0;
    const hrState = String(act.hr_data_state ?? 'missing');
    const avgHr = typeof act.avg_hr_bpm === 'number' ? act.avg_hr_bpm : null;
    const avgPace = typeof act.avg_pace_sec_per_mile === 'number' ? act.avg_pace_sec_per_mile : null;
    const avgPower = typeof act.avg_power_watts === 'number' ? act.avg_power_watts : null;
    const rpe = typeof act.rpe === 'number' ? act.rpe : null;

    if (params.activeLthrBpm && params.activeLthrBpm > 0) {
      const hrValid = !isRest && hrState === 'valid' && avgHr !== null && avgHr > 0;
      const intensity = hrValid ? avgHr! / params.activeLthrBpm : null;
      const stress =
        isRest
          ? 0
          : intensity !== null
          ? Number(((durMin / 60) * Math.pow(intensity, 2) * 100).toFixed(2))
          : null;
      rowsToUpsert.push({
        coach_id: params.coachId,
        athlete_id: params.athleteId,
        activity_id: actId,
        metric_date: metricDate,
        methodology: 'hr_derived_stress',
        stress_value: stress,
        intensity_factor: intensity !== null ? Number(intensity.toFixed(4)) : null,
        is_zero_rest: isRest,
        threshold_id: null,
        threshold_version_used: params.activeThresholdVersion,
        lthr_bpm_used: params.activeLthrBpm,
        threshold_pace_sec_used: null,
        threshold_power_watts_used: null,
        methodology_label: 'Independent HR-Derived Stress (hrRSS)',
        is_tss_equivalent: false,
        calculated_at: params.computedAt,
      });
    }

    if (params.thresholdPaceSecPerMile && params.thresholdPaceSecPerMile > 0 && (isRest || (avgPace && avgPace > 0))) {
      const intensity = !isRest && avgPace && avgPace > 0 ? params.thresholdPaceSecPerMile / avgPace : null;
      const stress =
        isRest
          ? 0
          : intensity !== null
          ? Number(((durMin / 60) * Math.pow(intensity, 2) * 100).toFixed(2))
          : null;
      rowsToUpsert.push({
        coach_id: params.coachId,
        athlete_id: params.athleteId,
        activity_id: actId,
        metric_date: metricDate,
        methodology: 'running_tss_pace',
        stress_value: stress,
        intensity_factor: intensity !== null ? Number(intensity.toFixed(4)) : null,
        is_zero_rest: isRest,
        threshold_id: null,
        threshold_version_used: params.activeThresholdVersion,
        lthr_bpm_used: null,
        threshold_pace_sec_used: params.thresholdPaceSecPerMile,
        threshold_power_watts_used: null,
        methodology_label: 'Independent Running Pace Stress (rTSS)',
        is_tss_equivalent: false,
        calculated_at: params.computedAt,
      });
    }

    if (params.optionalThresholdPowerWatts && params.optionalThresholdPowerWatts > 0 && avgPower && avgPower > 0) {
      const intensity = avgPower / params.optionalThresholdPowerWatts;
      const stress = Number(((durMin / 60) * Math.pow(intensity, 2) * 100).toFixed(2));
      rowsToUpsert.push({
        coach_id: params.coachId,
        athlete_id: params.athleteId,
        activity_id: actId,
        metric_date: metricDate,
        methodology: 'running_power_stress',
        stress_value: isRest ? 0 : stress,
        intensity_factor: isRest ? null : Number(intensity.toFixed(4)),
        is_zero_rest: isRest,
        threshold_id: null,
        threshold_version_used: params.activeThresholdVersion,
        lthr_bpm_used: null,
        threshold_pace_sec_used: null,
        threshold_power_watts_used: params.optionalThresholdPowerWatts,
        methodology_label: 'Independent Running Power Stress',
        is_tss_equivalent: false,
        calculated_at: params.computedAt,
      });
    }

    if (rpe !== null && rpe >= 1 && rpe <= 10) {
      const intensity = rpe / 7.5;
      const stress = isRest ? 0 : Number(((durMin / 60) * Math.pow(intensity, 2) * 100).toFixed(2));
      rowsToUpsert.push({
        coach_id: params.coachId,
        athlete_id: params.athleteId,
        activity_id: actId,
        metric_date: metricDate,
        methodology: 'session_rpe_stress',
        stress_value: stress,
        intensity_factor: isRest ? null : Number(intensity.toFixed(4)),
        is_zero_rest: isRest,
        threshold_id: null,
        threshold_version_used: params.activeThresholdVersion,
        lthr_bpm_used: null,
        threshold_pace_sec_used: null,
        threshold_power_watts_used: null,
        methodology_label: 'Session RPE Stress',
        is_tss_equivalent: false,
        calculated_at: params.computedAt,
      });
    }
  }

  if (rowsToUpsert.length === 0) return 0;

  const { error: upsertErr } = await upsertRowsInChunks(
    params.client,
    'independent_stress_metrics',
    rowsToUpsert,
    'activity_id,methodology,threshold_version_used',
    500
  );

  if (upsertErr) {
    throw new Error(`Failed to persist independent stress metrics: ${upsertErr.message}`);
  }
  return rowsToUpsert.length;
}

const activeRosterJobsByCoach = new Map<string, RosterLiveProgressSnapshot>();
const activeAthleteLocksByCoach = new Map<string, Set<string>>();

export function resetRosterSyncLocksForTesting(): void {
  activeRosterJobsByCoach.clear();
  activeAthleteLocksByCoach.clear();
}

export function getActiveRosterProgressForCoach(coachId: string): RosterLiveProgressSnapshot | null {
  const job = activeRosterJobsByCoach.get(coachId);
  return job
    ? {
        ...job,
        activeAthleteIds: [...job.activeAthleteIds],
      }
    : null;
}

function acquireAthleteSyncLock(coachId: string, externalAthleteId: string): boolean {
  let set = activeAthleteLocksByCoach.get(coachId);
  if (!set) {
    set = new Set<string>();
    activeAthleteLocksByCoach.set(coachId, set);
  }
  if (set.has(externalAthleteId)) return false;
  set.add(externalAthleteId);
  return true;
}

function releaseAthleteSyncLock(coachId: string, externalAthleteId: string): void {
  const set = activeAthleteLocksByCoach.get(coachId);
  if (!set) return;
  set.delete(externalAthleteId);
  if (set.size === 0) activeAthleteLocksByCoach.delete(coachId);
}

interface SingleAthleteIngestionParams {
  client: SupabaseClient;
  coachId: string;
  targetExternalAthleteId: string;
  fallbackAthleteName?: string | null;
  fallbackEmail?: string | null;
  externalCoachId: string;
  isPilotAthlete: boolean;
  requireExplicitMapping?: boolean;
  overviewMappingStatus?: IntervalsRosterAthleteOverviewRow['mappingStatus'];
  mappingNote: string;
  authHeader: string;
  mode: 'auto' | 'initial' | 'incremental';
  startedAt: string;
  initialLookbackDays?: number;
  overlapDays?: number;
  chunkDays?: number;
  fetcher: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}

interface SingleAthleteIngestionInternalResult {
  ok: boolean;
  blockedSelf: boolean;
  coreFetchFailed: boolean;
  httpFailureCode: 403 | 502 | 503;
  resolvedSyncMode: 'initial' | 'incremental';
  outcome: RosterAthleteSyncOutcome;
}

async function ingestSingleIntervalsAthlete(
  params: SingleAthleteIngestionParams
): Promise<SingleAthleteIngestionInternalResult> {
  const { client, coachId, targetExternalAthleteId, externalCoachId, isPilotAthlete, startedAt } =
    params;
  const todayDate = startedAt.slice(0, 10);
  const warnings: string[] = [];

  if (isCoachSelfAthleteId(targetExternalAthleteId, externalCoachId)) {
    const selfMsg = 'Target athlete ID cannot match the coach own athlete ID.';
    return {
      ok: false,
      blockedSelf: true,
      coreFetchFailed: false,
      httpFailureCode: 403,
      resolvedSyncMode: 'incremental',
      outcome: {
        externalAthleteId: targetExternalAthleteId,
        internalAthleteId: null,
        athleteName: params.fallbackAthleteName ?? null,
        isPilotAthlete,
        status: 'Failed',
        syncMode: 'incremental',
        authorizationStatus: 'Permission Denied',
        windowStart: null,
        windowEnd: null,
        chunksQueried: 0,
        activitiesFetched: 0,
        activitiesProcessed: 0,
        activitiesRemoved: 0,
        duplicatesSkipped: 0,
        streamsImported: 0,
        streamsMissing: 0,
        streamsUnavailable: 0,
        wellnessProcessed: 0,
        dailyLoadPointsWritten: 0,
        warnings: [],
        errorMessage: selfMsg,
      },
    };
  }

  // Look up existing mapping & history to decide initial vs incremental sync mode
  const { data: existingMapping } = await client
    .from('provider_athlete_mappings')
    .select('id, athlete_id, external_athlete_id, match_status, match_method, authorization_status')
    .eq('coach_id', coachId)
    .eq('provider', 'intervals_icu')
    .eq('external_athlete_id', targetExternalAthleteId)
    .maybeSingle();

  let existingAthleteId: string | null = existingMapping?.athlete_id
    ? String(existingMapping.athlete_id)
    : null;

  // Enforce explicit persisted mapping before ingesting non-pilot athletes
  if (params.requireExplicitMapping && !isPilotAthlete) {
    if (
      (existingMapping && existingMapping.match_status === 'Candidate Review Required') ||
      params.overviewMappingStatus === 'Candidate Review Required'
    ) {
      return {
        ok: false,
        blockedSelf: false,
        coreFetchFailed: false,
        httpFailureCode: 403,
        resolvedSyncMode: 'incremental',
        outcome: {
          externalAthleteId: targetExternalAthleteId,
          internalAthleteId: existingAthleteId,
          athleteName: params.fallbackAthleteName ?? null,
          isPilotAthlete,
          status: 'Awaiting coach review',
          syncMode: 'incremental',
          authorizationStatus: String(existingMapping?.authorization_status ?? 'Pending Athlete Opt-In'),
          windowStart: null,
          windowEnd: null,
          chunksQueried: 0,
          activitiesFetched: 0,
          activitiesProcessed: 0,
          activitiesRemoved: 0,
          duplicatesSkipped: 0,
          streamsImported: 0,
          streamsMissing: 0,
          streamsUnavailable: 0,
          wellnessProcessed: 0,
          dailyLoadPointsWritten: 0,
          warnings: [],
          errorMessage: 'Candidate match requires coach confirmation before ingestion.',
        },
      };
    }

    if (!existingMapping || existingMapping.match_status !== 'Verified Match') {
      return {
        ok: false,
        blockedSelf: false,
        coreFetchFailed: false,
        httpFailureCode: 403,
        resolvedSyncMode: 'incremental',
        outcome: {
          externalAthleteId: targetExternalAthleteId,
          internalAthleteId: null,
          athleteName: params.fallbackAthleteName ?? null,
          isPilotAthlete,
          status: 'Not mapped',
          syncMode: 'incremental',
          authorizationStatus: 'Unlinked',
          windowStart: null,
          windowEnd: null,
          chunksQueried: 0,
          activitiesFetched: 0,
          activitiesProcessed: 0,
          activitiesRemoved: 0,
          duplicatesSkipped: 0,
          streamsImported: 0,
          streamsMissing: 0,
          streamsUnavailable: 0,
          wellnessProcessed: 0,
          dailyLoadPointsWritten: 0,
          warnings: [],
          errorMessage: 'Athlete is not mapped. Link to an existing athlete or create a new record in Full Roster Sync.',
        },
      };
    }
  }

  let existingActivityCount = 0;
  let latestExistingActivityDate: string | null = null;
  let latestExistingWellnessDate: string | null = null;

  if (existingAthleteId) {
    const { data: actDateRows } = await client
      .from('completed_activities')
      .select('activity_date')
      .eq('coach_id', coachId)
      .eq('athlete_id', existingAthleteId)
      .eq('provider', 'intervals_icu')
      .order('activity_date', { ascending: false })
      .limit(1);

    if (Array.isArray(actDateRows) && actDateRows.length > 0) {
      existingActivityCount = actDateRows.length;
      latestExistingActivityDate = String(actDateRows[0].activity_date).slice(0, 10);
    }

    const { data: wellDateRows } = await client
      .from('wellness_records')
      .select('record_date')
      .eq('coach_id', coachId)
      .eq('athlete_id', existingAthleteId)
      .eq('source', 'intervals_icu_wellness')
      .order('record_date', { ascending: false })
      .limit(1);

    if (Array.isArray(wellDateRows) && wellDateRows.length > 0) {
      latestExistingWellnessDate = String(wellDateRows[0].record_date).slice(0, 10);
    }
  }

  const syncMode: 'initial' | 'incremental' =
    params.mode === 'initial'
      ? 'initial'
      : params.mode === 'incremental'
      ? 'incremental'
      : existingActivityCount > 0
      ? 'incremental'
      : 'initial';

  // Fetch athlete profile from Intervals.icu
  const encodedId = encodeURIComponent(targetExternalAthleteId);
  const profileRes = await fetchIntervalsJson(
    `/athlete/${encodedId}`,
    params.authHeader,
    params.fetcher,
    params.retryOptions
  );

  if (!profileRes.ok || !profileRes.data || typeof profileRes.data !== 'object') {
    const isPermissionError = profileRes.status === 401 || profileRes.status === 403;
    const errMsg = `Failed to retrieve athlete profile (${targetExternalAthleteId}): ${
      profileRes.errorText ?? `HTTP ${profileRes.status}`
    }.`;

    if (isPermissionError && existingMapping?.id) {
      await client
        .from('provider_athlete_mappings')
        .update({
          authorization_status: 'Permission Denied',
          reviewed_at: startedAt,
          note: redactSensitiveText(errMsg),
        })
        .eq('id', existingMapping.id)
        .eq('coach_id', coachId);
    }

    return {
      ok: false,
      blockedSelf: false,
      coreFetchFailed: true,
      httpFailureCode: 502,
      resolvedSyncMode: syncMode,
      outcome: {
        externalAthleteId: targetExternalAthleteId,
        internalAthleteId: existingAthleteId,
        athleteName: params.fallbackAthleteName ?? null,
        isPilotAthlete,
        status: isPermissionError ? 'Permission Denied' : 'Failed',
        syncMode,
        authorizationStatus: isPermissionError ? 'Permission Denied' : 'Unlinked',
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
        errorMessage: redactSensitiveText(errMsg),
      },
    };
  }

  const rawProfile = profileRes.data as Record<string, unknown>;
  const resolvedRemoteId =
    rawProfile.id !== undefined && rawProfile.id !== null
      ? String(rawProfile.id)
      : targetExternalAthleteId;

  if (isCoachSelfAthleteId(resolvedRemoteId, externalCoachId)) {
    const selfErr = `Intervals.icu athlete profile (${targetExternalAthleteId}) resolved to the coach own athlete ID; aborted.`;
    return {
      ok: false,
      blockedSelf: true,
      coreFetchFailed: false,
      httpFailureCode: 403,
      resolvedSyncMode: syncMode,
      outcome: {
        externalAthleteId: targetExternalAthleteId,
        internalAthleteId: existingAthleteId,
        athleteName: params.fallbackAthleteName ?? null,
        isPilotAthlete,
        status: 'Failed',
        syncMode,
        authorizationStatus: 'Permission Denied',
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
        errorMessage: selfErr,
      },
    };
  }

  const sportSettings = Array.isArray(rawProfile.sportSettings)
    ? (rawProfile.sportSettings as Array<Record<string, unknown>>)
    : [];
  const runSetting =
    sportSettings.find((s) =>
      Array.isArray(s.types)
        ? s.types.some((t) => typeof t === 'string' && t.toLowerCase().includes('run'))
        : false
    ) ?? sportSettings[0];

  const incomingEmail =
    typeof rawProfile.email === 'string' && rawProfile.email.trim()
      ? rawProfile.email.trim().toLowerCase()
      : params.fallbackEmail?.trim().toLowerCase() ?? null;

  if (!existingAthleteId && incomingEmail) {
    const [{ data: emailMatches }, { data: existingMappings }] = await Promise.all([
      client
        .from('athletes')
        .select('id')
        .eq('coach_id', coachId)
        .ilike('email', incomingEmail),
      client
        .from('provider_athlete_mappings')
        .select('athlete_id, external_athlete_id')
        .eq('coach_id', coachId)
        .eq('provider', 'intervals_icu'),
    ]);
    const matchingRows = Array.isArray(emailMatches)
      ? (emailMatches as Array<{ id?: string }>)
      : [];
    if (matchingRows.length === 1 && matchingRows[0]?.id) {
      const candidateId = String(matchingRows[0].id);
      const conflictMap = Array.isArray(existingMappings)
        ? (existingMappings as Array<{ athlete_id?: string; external_athlete_id?: string }>).find(
            (m) =>
              String(m.athlete_id) === candidateId &&
              m.external_athlete_id &&
              m.external_athlete_id !== targetExternalAthleteId
          )
        : undefined;
      if (!conflictMap) {
        existingAthleteId = candidateId;
      }
    }
  }

  let existingAthleteRow: Record<string, unknown> | null = null;
  if (existingAthleteId) {
    const { data: fetchedAth } = await client
      .from('athletes')
      .select('*')
      .eq('id', existingAthleteId)
      .eq('coach_id', coachId)
      .maybeSingle();
    existingAthleteRow = (fetchedAth as Record<string, unknown> | null) ?? null;
  }

  const incomingName =
    typeof rawProfile.name === 'string' && rawProfile.name.trim()
      ? rawProfile.name.trim()
      : null;
  const resolvedFullName =
    incomingName ??
    (typeof existingAthleteRow?.full_name === 'string' && existingAthleteRow.full_name.trim()
      ? existingAthleteRow.full_name.trim()
      : params.fallbackAthleteName?.trim() || targetExternalAthleteId);

  const incomingAge =
    intInRangeOrNull(rawProfile.age, 12, 110) ?? computeAgeFromDob(rawProfile.dob, startedAt);
  const incomingGender = normalizeGender(rawProfile.sex ?? rawProfile.gender);
  const locationParts = [rawProfile.city, rawProfile.state, rawProfile.country]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  const incomingLocation =
    locationParts.length > 0
      ? locationParts.join(', ')
      : typeof rawProfile.timezone === 'string' && rawProfile.timezone.trim()
      ? rawProfile.timezone.trim()
      : null;

  const incomingRestingHr = intInRangeOrNull(
    rawProfile.icu_resting_hr ?? rawProfile.restingHR,
    28,
    120
  );
  const incomingMaxHr = intInRangeOrNull(runSetting?.max_hr ?? rawProfile.max_hr, 110, 235);
  const incomingLthr = intInRangeOrNull(runSetting?.lthr ?? rawProfile.lthr, 90, 220);
  const incomingThresholdPace = normalizeThresholdPaceSecPerMile(runSetting?.threshold_pace);
  const incomingThresholdPower = intInRangeOrNull(
    runSetting?.run_ftp ?? runSetting?.ftp,
    50,
    1500
  );

  const athletePayload: Record<string, unknown> = {
    coach_id: coachId,
    full_name: resolvedFullName,
    email: incomingEmail ?? existingAthleteRow?.email ?? null,
    age: incomingAge ?? existingAthleteRow?.age ?? null,
    gender: incomingGender ?? existingAthleteRow?.gender ?? null,
    location: incomingLocation ?? existingAthleteRow?.location ?? null,
    training_group: (existingAthleteRow?.training_group as string) ?? 'Marathon',
    current_phase: (existingAthleteRow?.current_phase as string) ?? 'Build',
    experience_years: existingAthleteRow?.experience_years ?? null,
    resting_hr_bpm: incomingRestingHr ?? existingAthleteRow?.resting_hr_bpm ?? null,
    max_hr_bpm: incomingMaxHr ?? existingAthleteRow?.max_hr_bpm ?? null,
    // Preserve coach-approved / existing active LTHR if already present; seed if null
    active_lthr_bpm: existingAthleteRow?.active_lthr_bpm ?? incomingLthr ?? null,
    active_threshold_version: Number(existingAthleteRow?.active_threshold_version ?? 1),
    threshold_pace_sec_per_mile:
      existingAthleteRow?.threshold_pace_sec_per_mile ?? incomingThresholdPace ?? null,
    optional_threshold_power_watts:
      existingAthleteRow?.optional_threshold_power_watts ?? incomingThresholdPower ?? null,
    sport_specialization:
      (typeof existingAthleteRow?.sport_specialization === 'string' &&
        existingAthleteRow.sport_specialization) ||
      'Running',
    data_origin: (existingAthleteRow?.data_origin as string) ?? 'live',
  };

  let internalAthleteId: string;
  if (existingAthleteRow?.id) {
    const { data: updatedAth, error: updateErr } = await client
      .from('athletes')
      .update(athletePayload)
      .eq('id', existingAthleteRow.id)
      .eq('coach_id', coachId)
      .select('id')
      .single();
    if (updateErr || !updatedAth?.id) {
      throw new Error(`Failed to update athlete ${targetExternalAthleteId}: ${updateErr?.message ?? 'unknown'}`);
    }
    internalAthleteId = String(updatedAth.id);
  } else {
    const { data: insertedAth, error: insertErr } = await client
      .from('athletes')
      .insert(athletePayload)
      .select('id')
      .single();
    if (insertErr || !insertedAth?.id) {
      throw new Error(`Failed to insert athlete ${targetExternalAthleteId}: ${insertErr?.message ?? 'unknown'}`);
    }
    internalAthleteId = String(insertedAth.id);
  }

  // Re-check activity history if matched via email before creating mapping
  if (!existingMapping?.id && existingAthleteRow?.id) {
    const { data: actDateRows } = await client
      .from('completed_activities')
      .select('activity_date')
      .eq('coach_id', coachId)
      .eq('athlete_id', internalAthleteId)
      .eq('provider', 'intervals_icu')
      .order('activity_date', { ascending: false })
      .limit(1);
    if (Array.isArray(actDateRows) && actDateRows.length > 0) {
      latestExistingActivityDate = String(actDateRows[0].activity_date).slice(0, 10);
    }
  }

  // Store raw athlete profile snapshot in raw_provider_payloads
  await storeRawPayload({
    client,
    coachId,
    athleteId: internalAthleteId,
    entityType: 'athlete_profile',
    externalId: targetExternalAthleteId,
    payload: rawProfile,
    fetchedAt: startedAt,
  });

  // Upsert unique provider_athlete_mappings without duplicating
  const { data: existingAthProvMap } = await client
    .from('provider_athlete_mappings')
    .select('id')
    .eq('coach_id', coachId)
    .eq('athlete_id', internalAthleteId)
    .eq('provider', 'intervals_icu')
    .maybeSingle();

  const mappingFields = {
    coach_id: coachId,
    athlete_id: internalAthleteId,
    provider: 'intervals_icu' as const,
    external_athlete_id: targetExternalAthleteId,
    authorization_status: 'Authorized (Read-Only)',
    match_status: 'Verified Match',
    match_method: 'External ID Match',
    match_confidence_pct: 100,
    candidate_profile_snapshot: sanitizeProviderPayloadForStorage({
      id: resolvedRemoteId,
      name: resolvedFullName,
      email: incomingEmail,
    }),
    reviewed_at: startedAt,
    note: params.mappingNote,
  };

  if (existingAthProvMap?.id) {
    const { error: mapUpdErr } = await client
      .from('provider_athlete_mappings')
      .update(mappingFields)
      .eq('id', existingAthProvMap.id)
      .eq('coach_id', coachId);
    if (mapUpdErr) {
      throw new Error(`Failed to update athlete mapping: ${mapUpdErr.message}`);
    }
  } else {
    const { error: mapInsErr } = await client
      .from('provider_athlete_mappings')
      .upsert(mappingFields, { onConflict: 'athlete_id,provider' });
    if (mapInsErr) {
      throw new Error(`Failed to insert athlete mapping: ${mapInsErr.message}`);
    }
  }

  // Compute date-chunked historical or overlapping incremental sync windows
  const chunkDays = params.chunkDays ?? DEFAULT_CHUNK_DAYS;
  const overlapDays = params.overlapDays ?? DEFAULT_OVERLAP_DAYS;

  let windowStart: string;
  if (syncMode === 'incremental' && latestExistingActivityDate) {
    windowStart = addDaysIso(latestExistingActivityDate, -overlapDays);
    if (latestExistingWellnessDate) {
      const wellOverlapStart = addDaysIso(latestExistingWellnessDate, -overlapDays);
      if (wellOverlapStart < windowStart) {
        windowStart = wellOverlapStart;
      }
    }
  } else {
    const defaultLookbackStart = addDaysIso(
      todayDate,
      -(params.initialLookbackDays ?? DEFAULT_INITIAL_LOOKBACK_DAYS)
    );
    const rawCreated =
      typeof rawProfile.icu_created === 'string'
        ? rawProfile.icu_created
        : typeof rawProfile.created === 'string'
        ? rawProfile.created
        : null;
    const createdStart =
      rawCreated && /^\d{4}-\d{2}-\d{2}/.test(rawCreated)
        ? addDaysIso(rawCreated.slice(0, 10), -365)
        : null;
    windowStart =
      createdStart && createdStart < defaultLookbackStart
        ? createdStart > MIN_HISTORICAL_FLOOR_DATE
          ? createdStart
          : MIN_HISTORICAL_FLOOR_DATE
        : defaultLookbackStart;
  }
  if (windowStart > todayDate) {
    windowStart = todayDate;
  }

  // Retrieve chunked completed activities & wellness records
  const activitiesChunkRes = await fetchIntervalsArrayChunked({
    endpointPath: `/athlete/${encodedId}/activities`,
    oldest: windowStart,
    newest: todayDate,
    chunkDays,
    authHeader: params.authHeader,
    fetcher: params.fetcher,
    retryOptions: params.retryOptions,
  });

  if (!activitiesChunkRes.ok) {
    warnings.push(...activitiesChunkRes.chunkErrors.map((e) => `Activities: ${e}`));
  }

  const wellnessChunkRes = await fetchIntervalsArrayChunked({
    endpointPath: `/athlete/${encodedId}/wellness`,
    oldest: windowStart,
    newest: todayDate,
    chunkDays,
    authHeader: params.authHeader,
    fetcher: params.fetcher,
    retryOptions: params.retryOptions,
  });

  if (!wellnessChunkRes.ok) {
    warnings.push(...wellnessChunkRes.chunkErrors.map((e) => `Wellness: ${e}`));
  }

  // Index wellness by date so activity training metrics can attach CTL/ATL if omitted on activity
  const wellnessByDate = new Map<string, Record<string, unknown>>();
  for (const w of wellnessChunkRes.items) {
    const dateStr = typeof w.id === 'string' ? w.id.slice(0, 10) : null;
    if (isIsoDateString(dateStr)) {
      wellnessByDate.set(dateStr, w);
    }
  }

  // Deduplicate activities within fetched chunks by external activity ID
  const uniqueActivitiesMap = new Map<string, Record<string, unknown>>();
  for (const act of activitiesChunkRes.items) {
    if (act.id === undefined || act.id === null) continue;
    const extId = String(act.id).trim();
    if (!extId) continue;
    uniqueActivitiesMap.set(extId, act);
  }
  const fetchedActivities = Array.from(uniqueActivitiesMap.values());

  // Fetch existing activities to preserve valid non-null fields & count unchanged duplicates
  const existingActivitiesByExtId = new Map<string, Record<string, unknown>>();
  if (fetchedActivities.length > 0) {
    const { data: existingActRows } = await fetchAllPagedRows(() =>
      client
        .from('completed_activities')
        .select('*')
        .eq('coach_id', coachId)
        .eq('athlete_id', internalAthleteId)
        .eq('provider', 'intervals_icu')
        .order('id', { ascending: true })
    );

    if (Array.isArray(existingActRows)) {
      for (const row of existingActRows as Array<Record<string, unknown>>) {
        if (typeof row.external_activity_id === 'string') {
          existingActivitiesByExtId.set(row.external_activity_id, row);
        }
      }
    }
  }

  // Pre-load existing HR streams, raw payload hashes, and System A provider metrics across 1,000-row pages
  const rawPayloadCache = new Map<string, string>();
  const existingProviderMetricsByKey = new Map<string, Record<string, unknown>>();
  const existingStreamActivityIds = new Set<string>();

  const [{ data: existingStreams }, { data: existingRawRows }, { data: existingProvMetricRows }] =
    await Promise.all([
      fetchAllPagedRows(() =>
        client
          .from('heart_rate_streams')
          .select('activity_id')
          .eq('coach_id', coachId)
          .eq('athlete_id', internalAthleteId)
          .order('activity_id', { ascending: true })
      ),
      fetchAllPagedRows(() =>
        client
          .from('raw_provider_payloads')
          .select('id, entity_type, external_id, payload_sha256')
          .eq('coach_id', coachId)
          .eq('athlete_id', internalAthleteId)
          .eq('provider', 'intervals_icu')
          .order('id', { ascending: true })
      ),
      fetchAllPagedRows(() =>
        client
          .from('provider_training_metrics')
          .select('activity_id, metric_date, icu_training_load, icu_fitness, icu_fatigue, icu_form')
          .eq('coach_id', coachId)
          .eq('athlete_id', internalAthleteId)
          .eq('provider', 'intervals_icu')
          .order('id', { ascending: true })
      ),
    ]);

  if (Array.isArray(existingStreams)) {
    for (const s of existingStreams as Array<{ activity_id?: string }>) {
      if (s.activity_id) existingStreamActivityIds.add(String(s.activity_id));
    }
  }
  if (Array.isArray(existingRawRows)) {
    for (const r of existingRawRows as Array<Record<string, unknown>>) {
      if (r.id && r.entity_type && r.external_id && r.payload_sha256) {
        rawPayloadCache.set(
          `${String(r.entity_type)}::${String(r.external_id)}::${String(r.payload_sha256)}`,
          String(r.id)
        );
      }
    }
  }
  if (Array.isArray(existingProvMetricRows)) {
    for (const m of existingProvMetricRows as Array<Record<string, unknown>>) {
      if (m.activity_id && m.metric_date) {
        existingProviderMetricsByKey.set(`${String(m.activity_id)}::${String(m.metric_date).slice(0, 10)}`, m);
      }
    }
  }

  let activitiesProcessed = 0;
  let duplicatesSkipped = 0;
  let streamsImported = 0;
  let streamsMissing = 0;
  let streamsUnavailable = 0;
  const providerMetricsToUpsert: Array<Record<string, unknown>> = [];

  const athleteMaxHr =
    typeof athletePayload.max_hr_bpm === 'number' ? athletePayload.max_hr_bpm : null;

  // Persist completed activities, raw payloads, HR streams & native training metrics
  for (const rawAct of fetchedActivities) {
    const extActId = String(rawAct.id).trim();
    const rawDate = String(rawAct.start_date_local ?? rawAct.start_date ?? '').slice(0, 10);
    if (!isIsoDateString(rawDate)) {
      warnings.push(`Skipped activity ${extActId}: invalid or missing activity_date.`);
      continue;
    }

    const existingAct = existingActivitiesByExtId.get(extActId) ?? null;
    const startTimeCandidate = String(rawAct.start_date_local ?? '').slice(11, 19);
    const startTimeLocal = /^\d{2}:\d{2}:\d{2}$/.test(startTimeCandidate)
      ? startTimeCandidate
      : (existingAct?.start_time_local as string | null) ?? null;

    const movingSec = finiteOrNull(rawAct.moving_time) ?? finiteOrNull(rawAct.elapsed_time);
    const distMeters = finiteOrNull(rawAct.distance);
    const elevMeters = finiteOrNull(rawAct.total_elevation_gain ?? rawAct.elevation_gain);

    const incomingDurMin =
      movingSec !== null && movingSec >= 0 ? Number((movingSec / 60).toFixed(2)) : null;
    const incomingDistMiles =
      distMeters !== null && distMeters >= 0 ? Number((distMeters / 1609.34).toFixed(3)) : null;

    const existingDurMin =
      typeof existingAct?.duration_minutes === 'number' && existingAct.duration_minutes > 0
        ? existingAct.duration_minutes
        : null;
    const existingDistMiles =
      typeof existingAct?.distance_miles === 'number' && existingAct.distance_miles > 0
        ? existingAct.distance_miles
        : null;

    const resolvedDurationMin =
      incomingDurMin !== null
        ? incomingDurMin === 0 && existingDurMin !== null
          ? existingDurMin
          : incomingDurMin
        : existingDurMin ?? 0;

    const resolvedDistMiles =
      incomingDistMiles !== null
        ? incomingDistMiles === 0 && existingDistMiles !== null
          ? existingDistMiles
          : incomingDistMiles
        : existingDistMiles ?? 0;

    const activityType = classifyActivityType(rawAct, resolvedDistMiles, resolvedDurationMin);
    const isRest = activityType === 'Rest';

    const avgSpeed = finiteOrNull(rawAct.average_speed);
    const computedPace =
      resolvedDistMiles > 0 && resolvedDurationMin > 0
        ? Math.round((resolvedDurationMin * 60) / resolvedDistMiles)
        : avgSpeed !== null && avgSpeed > 0
        ? Math.round(1609.34 / avgSpeed)
        : null;

    const resolvedPaceSecPerMile =
      computedPace && computedPace > 0
        ? computedPace
        : (existingAct?.avg_pace_sec_per_mile as number | null) ?? null;

    const incomingElevFt =
      elevMeters !== null && elevMeters >= 0 ? Math.round(elevMeters * 3.28084) : null;
    const resolvedElevFt =
      incomingElevFt !== null
        ? incomingElevFt
        : (existingAct?.elevation_gain_ft as number | null) ?? null;

    const incomingAvgPower = intInRangeOrNull(
      rawAct.average_watts ?? rawAct.weighted_average_watts ?? rawAct.icu_average_watts,
      1,
      3000
    );
    const resolvedPowerWatts =
      incomingAvgPower ?? (existingAct?.avg_power_watts as number | null) ?? null;

    const incomingRpe = intInRangeOrNull(
      rawAct.session_rpe ?? rawAct.perceived_exertion ?? rawAct.feel,
      1,
      10
    );
    const resolvedRpe = incomingRpe ?? (existingAct?.rpe as number | null) ?? null;

    const rawAvgHrCandidate = rawAct.average_heartrate ?? rawAct.average_hr;
    const rawMaxHrCandidate = rawAct.max_heartrate ?? rawAct.max_hr;

    let hrValidation = validateImportedActivityHr({
      rawAvgHr: rawAvgHrCandidate,
      rawMaxHr: rawMaxHrCandidate,
      athleteMaxHrBpm: athleteMaxHr,
      isRest,
      durationMinutes: resolvedDurationMin,
      distanceMiles: resolvedDistMiles,
    });

    // Do NOT overwrite valid existing HR with missing HR from incomplete responses
    if (
      hrValidation.hrDataState === 'missing' &&
      existingAct &&
      existingAct.hr_data_state === 'valid' &&
      typeof existingAct.avg_hr_bpm === 'number'
    ) {
      hrValidation = {
        avgHrBpm: existingAct.avg_hr_bpm,
        maxHrBpm: (existingAct.max_hr_bpm as number | null) ?? hrValidation.maxHrBpm,
        hrDataState: 'valid',
        flags: [],
      };
    }

    if (incomingDurMin === null && existingDurMin === null && !isRest) {
      hrValidation.flags.push('missing_duration');
    }
    if (incomingDistMiles === null && existingDistMiles === null && !isRest) {
      hrValidation.flags.push('missing_distance');
    }

    const sourceDevice =
      extractActivitySourceDevice(rawAct) ??
      (existingAct?.source_device as string | null) ??
      null;

    const rawPayloadId = await storeRawPayload({
      client,
      coachId,
      athleteId: internalAthleteId,
      entityType: 'activity',
      externalId: extActId,
      sourceDevice,
      payload: rawAct,
      fetchedAt: startedAt,
      cache: rawPayloadCache,
    });

    const resolvedTitle =
      typeof rawAct.name === 'string' && rawAct.name.trim()
        ? rawAct.name.trim()
        : (existingAct?.title as string | undefined) ??
          (typeof rawAct.type === 'string' && rawAct.type.trim()
            ? rawAct.type.trim()
            : 'Completed Activity');

    const existingStreamFlags = Array.isArray(existingAct?.hr_validation_flags)
      ? existingAct.hr_validation_flags.filter(
          (f): f is string => typeof f === 'string' && f.startsWith('stream_status:')
        )
      : [];

    const mergedFlags = Array.from(new Set([...hrValidation.flags, ...existingStreamFlags]));

    const activityUpsertRow = {
      coach_id: coachId,
      athlete_id: internalAthleteId,
      provider: 'intervals_icu' as const,
      external_activity_id: extActId,
      source_device: sourceDevice,
      activity_date: rawDate,
      start_time_local: startTimeLocal,
      title: resolvedTitle,
      activity_type: activityType,
      status: isRest ? ('Rest' as const) : ('Completed' as const),
      duration_minutes: resolvedDurationMin,
      distance_miles: resolvedDistMiles,
      avg_pace_sec_per_mile: resolvedPaceSecPerMile,
      avg_hr_bpm: hrValidation.avgHrBpm,
      max_hr_bpm: hrValidation.maxHrBpm,
      avg_power_watts: resolvedPowerWatts,
      elevation_gain_ft: resolvedElevFt,
      rpe: resolvedRpe,
      hr_data_state: hrValidation.hrDataState,
      hr_validation_flags: mergedFlags,
      raw_payload_id: rawPayloadId ?? (existingAct?.raw_payload_id as string | null) ?? null,
    };

    const isIdenticalToExisting =
      Boolean(existingAct?.id) &&
      existingAct!.title === activityUpsertRow.title &&
      existingAct!.activity_date === activityUpsertRow.activity_date &&
      existingAct!.activity_type === activityUpsertRow.activity_type &&
      Number(existingAct!.duration_minutes) === activityUpsertRow.duration_minutes &&
      Number(existingAct!.distance_miles) === activityUpsertRow.distance_miles &&
      (existingAct!.avg_pace_sec_per_mile ?? null) === activityUpsertRow.avg_pace_sec_per_mile &&
      (existingAct!.avg_hr_bpm ?? null) === activityUpsertRow.avg_hr_bpm &&
      (existingAct!.max_hr_bpm ?? null) === activityUpsertRow.max_hr_bpm &&
      (existingAct!.elevation_gain_ft ?? null) === activityUpsertRow.elevation_gain_ft &&
      existingAct!.hr_data_state === activityUpsertRow.hr_data_state;

    let persistedActivityId: string;
    if (isIdenticalToExisting && existingAct?.id) {
      persistedActivityId = String(existingAct.id);
      duplicatesSkipped++;
    } else {
      const { data: persistedAct, error: actUpsertErr } = await client
        .from('completed_activities')
        .upsert(activityUpsertRow, {
          onConflict: 'athlete_id,provider,external_activity_id',
        })
        .select('id')
        .single();

      if (actUpsertErr || !persistedAct?.id) {
        warnings.push(
          `Failed to persist activity ${extActId}: ${actUpsertErr?.message ?? 'unknown error'}`
        );
        continue;
      }
      persistedActivityId = String(persistedAct.id);
      activitiesProcessed++;
    }

    // Preserve native Intervals.icu training load / CTL / ATL / Form verbatim (System A)
    const wSameDay = wellnessByDate.get(rawDate);
    const icuTrainingLoad = finiteOrNull(rawAct.icu_training_load);
    const icuFitness = finiteOrNull(rawAct.icu_ctl ?? wSameDay?.ctl ?? wSameDay?.icu_ctl);
    const icuFatigue = finiteOrNull(rawAct.icu_atl ?? wSameDay?.atl ?? wSameDay?.icu_atl);
    const icuForm =
      icuFitness !== null && icuFatigue !== null
        ? Number((icuFitness - icuFatigue).toFixed(2))
        : null;

    if (icuTrainingLoad !== null || icuFitness !== null || icuFatigue !== null) {
      const existingMetric =
        existingProviderMetricsByKey.get(`${persistedActivityId}::${rawDate}`) ?? null;

      const resolvedLoad =
        icuTrainingLoad !== null
          ? Number(icuTrainingLoad.toFixed(2))
          : (existingMetric?.icu_training_load as number | null) ?? null;
      const resolvedFit =
        icuFitness !== null
          ? Number(icuFitness.toFixed(2))
          : (existingMetric?.icu_fitness as number | null) ?? null;
      const resolvedFat =
        icuFatigue !== null
          ? Number(icuFatigue.toFixed(2))
          : (existingMetric?.icu_fatigue as number | null) ?? null;
      const resolvedForm =
        icuForm ??
        (resolvedFit !== null && resolvedFat !== null
          ? Number((resolvedFit - resolvedFat).toFixed(2))
          : (existingMetric?.icu_form as number | null) ?? null);

      const metricUnchanged =
        Boolean(existingMetric) &&
        Number(existingMetric?.icu_training_load ?? NaN) === Number(resolvedLoad ?? NaN) &&
        Number(existingMetric?.icu_fitness ?? NaN) === Number(resolvedFit ?? NaN) &&
        Number(existingMetric?.icu_fatigue ?? NaN) === Number(resolvedFat ?? NaN) &&
        Number(existingMetric?.icu_form ?? NaN) === Number(resolvedForm ?? NaN);

      if (!metricUnchanged) {
        providerMetricsToUpsert.push({
          coach_id: coachId,
          athlete_id: internalAthleteId,
          activity_id: persistedActivityId,
          provider: 'intervals_icu',
          metric_date: rawDate,
          icu_training_load: resolvedLoad,
          icu_fitness: resolvedFit,
          icu_fatigue: resolvedFat,
          icu_form: resolvedForm,
          raw_payload_id: rawPayloadId,
          original_values_preserved: true,
        });
      }
    }

    // Fetch & persist HR stream only if not already persisted (preserves existing stream rows!)
    if (isRest) {
      await client
        .from('completed_activities')
        .update({
          hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:not_applicable'],
        })
        .eq('id', persistedActivityId)
        .eq('coach_id', coachId);
      continue;
    }

    if (existingStreamActivityIds.has(persistedActivityId)) {
      streamsImported++;
      if (!mergedFlags.includes('stream_status:imported')) {
        await client
          .from('completed_activities')
          .update({
            hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:imported'],
          })
          .eq('id', persistedActivityId)
          .eq('coach_id', coachId);
      }
      continue;
    }

    const streamRes = await fetchIntervalsJson(
      `/activity/${encodeURIComponent(extActId)}/streams.json?types=time,heartrate`,
      params.authHeader,
      params.fetcher,
      params.retryOptions
    );

    if (!streamRes.ok) {
      if (streamRes.status === 404) {
        streamsMissing++;
        await client
          .from('completed_activities')
          .update({
            hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:missing'],
          })
          .eq('id', persistedActivityId)
          .eq('coach_id', coachId);
      } else {
        streamsUnavailable++;
        warnings.push(
          `HR stream unavailable for activity ${extActId} (${streamRes.errorText ?? 'HTTP error'}).`
        );
        await client
          .from('completed_activities')
          .update({
            hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:unavailable'],
          })
          .eq('id', persistedActivityId)
          .eq('coach_id', coachId);
      }
      continue;
    }

    const { timeArr, hrArr } = extractStreamsFromResponse(streamRes.data);
    if (!hrArr || hrArr.length === 0) {
      streamsMissing++;
      await client
        .from('completed_activities')
        .update({
          hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:missing'],
        })
        .eq('id', persistedActivityId)
        .eq('coach_id', coachId);
      continue;
    }

    let validCount = 0;
    let dropoutCount = 0;
    let spikeCount = 0;
    const normalizedHrStream = hrArr.map((v) => {
      if (v === null || v <= 0) {
        dropoutCount++;
        return null;
      }
      if (v > 235) {
        spikeCount++;
        if (v > 255) {
          return null;
        }
        return v;
      }
      if (v >= 25) {
        validCount++;
      } else {
        dropoutCount++;
      }
      return v;
    });

    if (validCount === 0) {
      streamsMissing++;
      await client
        .from('completed_activities')
        .update({
          hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:missing'],
        })
        .eq('id', persistedActivityId)
        .eq('coach_id', coachId);
      continue;
    }

    const streamRawId = await storeRawPayload({
      client,
      coachId,
      athleteId: internalAthleteId,
      entityType: 'streams',
      externalId: extActId,
      sourceDevice,
      payload: { time: timeArr, heartrate: hrArr, raw: streamRes.data },
      fetchedAt: startedAt,
      cache: rawPayloadCache,
    });

    const sampleIntervalSec = computeMedianSampleIntervalSec(timeArr);
    const validPct = Number(((validCount / normalizedHrStream.length) * 100).toFixed(2));

    const { error: streamErr } = await client.from('heart_rate_streams').upsert(
      {
        activity_id: persistedActivityId,
        coach_id: coachId,
        athlete_id: internalAthleteId,
        sample_interval_sec: sampleIntervalSec,
        hr_bpm_stream: normalizedHrStream,
        sample_count: normalizedHrStream.length,
        valid_sample_pct: validPct,
        dropout_count: dropoutCount,
        spike_count: spikeCount,
        raw_payload_id: streamRawId,
      },
      { onConflict: 'activity_id' }
    );

    if (streamErr) {
      streamsUnavailable++;
      warnings.push(`Failed to save HR stream for ${extActId}: ${streamErr.message}`);
      await client
        .from('completed_activities')
        .update({
          hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:unavailable'],
        })
        .eq('id', persistedActivityId)
        .eq('coach_id', coachId);
    } else {
      streamsImported++;
      existingStreamActivityIds.add(persistedActivityId);
      await client
        .from('completed_activities')
        .update({
          hr_validation_flags: [...stripStreamFlags(mergedFlags), 'stream_status:imported'],
        })
        .eq('id', persistedActivityId)
        .eq('coach_id', coachId);
    }
  }

  if (providerMetricsToUpsert.length > 0) {
    const { error: provBulkErr } = await upsertRowsInChunks(
      client,
      'provider_training_metrics',
      providerMetricsToUpsert,
      'activity_id,provider,metric_date',
      500
    );
    if (provBulkErr) {
      warnings.push(`Failed to save System A provider metrics: ${provBulkErr.message}`);
    }
  }

  // Persist wellness records (preserving existing non-null fields and keeping missing values NULL)
  const { data: existingWellnessRows } = await fetchAllPagedRows(() =>
    client
      .from('wellness_records')
      .select('*')
      .eq('coach_id', coachId)
      .eq('athlete_id', internalAthleteId)
      .eq('source', 'intervals_icu_wellness')
      .order('id', { ascending: true })
  );

  const existingWellnessByDate = new Map<string, Record<string, unknown>>();
  if (Array.isArray(existingWellnessRows)) {
    for (const row of existingWellnessRows as Array<Record<string, unknown>>) {
      if (typeof row.record_date === 'string') {
        existingWellnessByDate.set(row.record_date.slice(0, 10), row);
      }
    }
  }

  let wellnessProcessed = 0;
  const wellnessToUpsert: Array<Record<string, unknown>> = [];
  for (const [dateStr, rawWell] of wellnessByDate.entries()) {
    const existingWell = existingWellnessByDate.get(dateStr) ?? null;

    const rawWellnessPayloadId = await storeRawPayload({
      client,
      coachId,
      athleteId: internalAthleteId,
      entityType: 'wellness',
      externalId: dateStr,
      payload: rawWell,
      fetchedAt: startedAt,
      cache: rawPayloadCache,
    });

    const incomingRestingHrWell = intInRangeOrNull(rawWell.restingHR, 28, 130);
    const incomingHrvRaw =
      finiteOrNull(rawWell.hrv) ?? finiteOrNull(rawWell.rmssd) ?? finiteOrNull(rawWell.hrvSDNN);
    const incomingHrv =
      incomingHrvRaw !== null && incomingHrvRaw > 0 ? Number(incomingHrvRaw.toFixed(2)) : null;
    const incomingHrvStatus =
      typeof rawWell.hrvStatus === 'string' && rawWell.hrvStatus.trim()
        ? rawWell.hrvStatus.trim()
        : null;
    const sleepSecs = finiteOrNull(rawWell.sleepSecs);
    const incomingSleepHours =
      sleepSecs !== null && sleepSecs > 0
        ? floatInRangeOrNull(sleepSecs / 3600, 0, 24, 2)
        : floatInRangeOrNull(rawWell.sleepHours, 0, 24, 2);
    const incomingCtl = finiteOrNull(rawWell.ctl ?? rawWell.icu_ctl);
    const incomingAtl = finiteOrNull(rawWell.atl ?? rawWell.icu_atl);

    const resolvedHrv = incomingHrv ?? (existingWell?.hrv_rmssd as number | null) ?? null;
    const resolvedHrvStatus = incomingHrvStatus ?? (existingWell?.hrv_status as string | null) ?? null;
    const resolvedRestingHr =
      incomingRestingHrWell ?? (existingWell?.resting_hr_bpm as number | null) ?? null;
    const resolvedSleepHours =
      incomingSleepHours ?? (existingWell?.sleep_hours as number | null) ?? null;
    const resolvedCtl =
      incomingCtl !== null
        ? Number(incomingCtl.toFixed(2))
        : (existingWell?.icu_ctl as number | null) ?? null;
    const resolvedAtl =
      incomingAtl !== null
        ? Number(incomingAtl.toFixed(2))
        : (existingWell?.icu_atl as number | null) ?? null;

    const wellnessUnchanged =
      Boolean(existingWell) &&
      (existingWell?.hrv_rmssd ?? null) === resolvedHrv &&
      (existingWell?.hrv_status ?? null) === resolvedHrvStatus &&
      (existingWell?.resting_hr_bpm ?? null) === resolvedRestingHr &&
      (existingWell?.sleep_hours ?? null) === resolvedSleepHours &&
      (existingWell?.icu_ctl ?? null) === resolvedCtl &&
      (existingWell?.icu_atl ?? null) === resolvedAtl;

    if (wellnessUnchanged) {
      wellnessProcessed++;
    } else {
      wellnessToUpsert.push({
        coach_id: coachId,
        athlete_id: internalAthleteId,
        record_date: dateStr,
        source: 'intervals_icu_wellness',
        hrv_rmssd: resolvedHrv,
        hrv_status: resolvedHrvStatus,
        resting_hr_bpm: resolvedRestingHr,
        sleep_hours: resolvedSleepHours,
        icu_ctl: resolvedCtl,
        icu_atl: resolvedAtl,
        raw_payload_id:
          rawWellnessPayloadId ?? (existingWell?.raw_payload_id as string | null) ?? null,
        recorded_at: startedAt,
      });
    }
  }

  if (wellnessToUpsert.length > 0) {
    const { error: wellErr } = await upsertRowsInChunks(
      client,
      'wellness_records',
      wellnessToUpsert,
      'athlete_id,source,record_date',
      500
    );
    if (wellErr) {
      warnings.push(`Failed to save wellness records: ${wellErr.message}`);
    } else {
      wellnessProcessed += wellnessToUpsert.length;
    }
  }

  // Incremental deletion detection strictly when all activity chunks succeeded cleanly
  let activitiesRemoved = 0;
  if (syncMode === 'incremental' && activitiesChunkRes.ok && existingActivitiesByExtId.size > 0) {
    for (const [extId, row] of existingActivitiesByExtId.entries()) {
      const actDate = typeof row.activity_date === 'string' ? row.activity_date.slice(0, 10) : '';
      if (actDate >= windowStart && actDate <= todayDate && !uniqueActivitiesMap.has(extId)) {
        const { error: delErr } = await client
          .from('completed_activities')
          .delete()
          .eq('id', row.id)
          .eq('coach_id', coachId);
        if (!delErr) {
          activitiesRemoved++;
        }
      }
    }
  }

  // Persist System B independent_stress_metrics and System C daily_load_histories
  await recomputeAndPersistIndependentStressMetrics({
    client,
    coachId,
    athleteId: internalAthleteId,
    activeLthrBpm: (athletePayload.active_lthr_bpm as number | null) ?? null,
    thresholdPaceSecPerMile:
      (athletePayload.threshold_pace_sec_per_mile as number | null) ?? null,
    optionalThresholdPowerWatts:
      (athletePayload.optional_threshold_power_watts as number | null) ?? null,
    activeThresholdVersion: Number(athletePayload.active_threshold_version ?? 1),
    computedAt: startedAt,
  }).catch((err) => {
    warnings.push(
      `System B independent stress metrics skipped: ${err instanceof Error ? err.message : 'unknown error'}`
    );
  });

  const dailyLoadPointsWritten = await recomputeAndPersistDailyLoadHistories({
    client,
    coachId,
    athleteId: internalAthleteId,
    activeLthrBpm: (athletePayload.active_lthr_bpm as number | null) ?? null,
    thresholdPaceSecPerMile:
      (athletePayload.threshold_pace_sec_per_mile as number | null) ?? null,
    optionalThresholdPowerWatts:
      (athletePayload.optional_threshold_power_watts as number | null) ?? null,
    activeThresholdVersion: Number(athletePayload.active_threshold_version ?? 1),
    computedAt: startedAt,
  });

  const coreFetchFailed =
    !activitiesChunkRes.ok && fetchedActivities.length === 0 && !wellnessChunkRes.ok;
  const athleteStatus: RosterAthleteSyncStatus = coreFetchFailed
    ? 'Failed'
    : warnings.length > 0
    ? 'Partial'
    : 'Succeeded';
  const warningSummary = warnings.length > 0 ? warnings.slice(0, 5).join(' | ') : null;

  return {
    ok: !coreFetchFailed,
    blockedSelf: false,
    coreFetchFailed,
    httpFailureCode: coreFetchFailed ? 502 : 502,
    resolvedSyncMode: syncMode,
    outcome: {
      externalAthleteId: targetExternalAthleteId,
      internalAthleteId,
      athleteName: resolvedFullName,
      isPilotAthlete,
      status: athleteStatus,
      syncMode,
      authorizationStatus: 'Authorized (Read-Only)',
      windowStart,
      windowEnd: todayDate,
      chunksQueried: activitiesChunkRes.chunksQueried,
      activitiesFetched: fetchedActivities.length,
      activitiesProcessed,
      activitiesRemoved,
      duplicatesSkipped,
      streamsImported,
      streamsMissing,
      streamsUnavailable,
      wellnessProcessed,
      dailyLoadPointsWritten,
      warnings,
      errorMessage: warningSummary,
    },
  };
}

export async function synchronizePilotAthlete(
  options: PilotSyncOptions
): Promise<PilotSyncSummary> {
  const startedAt = options.nowIso ?? new Date().toISOString();
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();
  const fetcher = options.fetcher ?? fetch;

  const baseFailure = (
    statusCode: PilotSyncSummary['statusCode'],
    status: SyncJobStatus,
    blockedByPilotGate: boolean,
    errorMessage: string,
    syncLogId: string | null = null,
    jobType: SyncJobType = 'daily_activity_import',
    syncMode: 'initial' | 'incremental' = 'incremental',
    pilotAthleteId: string | null = null
  ): PilotSyncSummary => ({
    ok: false,
    statusCode,
    blockedByPilotGate,
    status,
    syncLogId,
    jobType,
    syncMode,
    pilotAthleteId,
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
    errorMessage: redactSensitiveText(errorMessage),
    synchronizedAt: startedAt,
  });

  if (!client) {
    return baseFailure(
      503,
      'Failed',
      false,
      'Supabase admin client is not configured on the server.'
    );
  }

  // 1. Enforce Milestone 3.1 database-authoritative pilot gate & live coach identity match.
  const authCheck = await checkPersistedRosterSyncAuthorization({
    coachId: options.coachId,
    store: oauthStore,
    fetcher,
    verifyLiveCoachAccount: true,
  });

  if (!authCheck.allowed || !authCheck.connection || !authCheck.authHeader) {
    const blockedMsg =
      authCheck.reason ??
      'Pilot synchronization is locked until Milestone 3.1 pilot verification succeeds.';
    const syncLogId = await createSyncLog({
      client,
      coachId: options.coachId,
      jobType: 'daily_activity_import',
      status: 'Blocked (Unauthorized)',
      startedAt,
      errorMessage: blockedMsg,
      finishedAt: new Date().toISOString(),
    }).catch(() => null);
    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action: 'PILOT_SYNC_BLOCKED',
      targetEntity: 'provider_connections',
      detail: blockedMsg,
    }).catch(() => undefined);

    return baseFailure(409, 'Blocked (Unauthorized)', true, blockedMsg, syncLogId);
  }

  const verifiedPilotAthleteId = authCheck.connection.verifiedPilotAthleteId!;
  const externalCoachId = authCheck.connection.externalCoachId ?? '0';
  const authHeader = authCheck.authHeader;

  // 2. Reject any requested athlete ID that is missing or does not strictly match persisted verified pilot ID
  const requestedId = options.requestedAthleteId?.trim();
  if (requestedId && requestedId !== verifiedPilotAthleteId) {
    const rejectMsg = `Rejected non-pilot athlete ID "${requestedId}". Milestone 3.2 only allows synchronizing the verified pilot athlete (${verifiedPilotAthleteId}).`;
    const syncLogId = await createSyncLog({
      client,
      coachId: options.coachId,
      jobType: 'daily_activity_import',
      status: 'Blocked (Unauthorized)',
      startedAt,
      errorMessage: rejectMsg,
      finishedAt: new Date().toISOString(),
    }).catch(() => null);
    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action: 'NON_PILOT_SYNC_REJECTED',
      targetEntity: 'athletes',
      targetId: requestedId,
      detail: rejectMsg,
      metadata: { requestedId, verifiedPilotAthleteId },
    }).catch(() => undefined);

    return baseFailure(
      403,
      'Blocked (Unauthorized)',
      true,
      rejectMsg,
      syncLogId,
      'daily_activity_import',
      'incremental',
      verifiedPilotAthleteId
    );
  }

  if (isCoachSelfAthleteId(verifiedPilotAthleteId, externalCoachId)) {
    const selfMsg = 'Verified pilot athlete ID cannot match the coach own athlete ID.';
    return baseFailure(403, 'Blocked (Unauthorized)', true, selfMsg);
  }

  // Determine sync mode & create sync log before running athlete ingestion
  const { data: existingMapping } = await client
    .from('provider_athlete_mappings')
    .select('athlete_id')
    .eq('coach_id', options.coachId)
    .eq('provider', 'intervals_icu')
    .eq('external_athlete_id', verifiedPilotAthleteId)
    .maybeSingle();

  let existingActivityCount = 0;
  if (existingMapping?.athlete_id) {
    const { data: actDateRows } = await client
      .from('completed_activities')
      .select('id')
      .eq('coach_id', options.coachId)
      .eq('athlete_id', String(existingMapping.athlete_id))
      .eq('provider', 'intervals_icu')
      .limit(1);
    existingActivityCount = Array.isArray(actDateRows) ? actDateRows.length : 0;
  }

  const syncMode: 'initial' | 'incremental' =
    options.mode === 'initial'
      ? 'initial'
      : options.mode === 'incremental'
      ? 'incremental'
      : existingActivityCount > 0
      ? 'incremental'
      : 'initial';

  const jobType: SyncJobType = syncMode === 'initial' ? 'backfill_12w' : 'daily_activity_import';
  const syncLogId = await createSyncLog({
    client,
    coachId: options.coachId,
    jobType,
    status: 'Running',
    startedAt,
  });

  try {
    const ingested = await ingestSingleIntervalsAthlete({
      client,
      coachId: options.coachId,
      targetExternalAthleteId: verifiedPilotAthleteId,
      externalCoachId,
      isPilotAthlete: true,
      mappingNote: 'Verified single pilot athlete mapping (Milestone 3.2).',
      authHeader,
      mode: syncMode,
      startedAt,
      initialLookbackDays: options.initialLookbackDays,
      overlapDays: options.overlapDays,
      chunkDays: options.chunkDays,
      fetcher,
      retryOptions: options.retryOptions,
    });

    const finishedAt = new Date().toISOString();
    const out = ingested.outcome;

    if (ingested.blockedSelf) {
      await finalizeSyncLog({
        client,
        coachId: options.coachId,
        syncLogId,
        status: 'Blocked (Unauthorized)',
        recordsProcessed: 0,
        duplicatesSkipped: 0,
        errorMessage: out.errorMessage ?? 'Coach own athlete ID rejected.',
        finishedAt,
      });
      return baseFailure(
        403,
        'Blocked (Unauthorized)',
        true,
        out.errorMessage ?? 'Intervals.icu pilot profile resolved to coach own athlete ID.',
        syncLogId,
        jobType,
        syncMode
      );
    }

    if (!ingested.ok && !out.internalAthleteId) {
      await finalizeSyncLog({
        client,
        coachId: options.coachId,
        syncLogId,
        status: 'Failed',
        recordsProcessed: 0,
        duplicatesSkipped: 0,
        errorMessage: out.errorMessage ?? 'Failed to retrieve pilot athlete profile.',
        finishedAt,
      });
      return baseFailure(
        502,
        'Failed',
        false,
        out.errorMessage ?? 'Failed to retrieve pilot athlete profile.',
        syncLogId,
        jobType,
        syncMode,
        verifiedPilotAthleteId
      );
    }

    if (ingested.ok) {
      await oauthStore.upsertProviderConnection({
        coachId: options.coachId,
        provider: 'intervals_icu',
        authMode: authCheck.connection.authMode,
        connected: true,
        readOnlyMode: true,
        pilotTestSucceeded: true,
        verifiedPilotAthleteId,
        externalCoachId: authCheck.connection.externalCoachId,
        externalCoachName: authCheck.connection.externalCoachName,
        grantedScopes: authCheck.connection.grantedScopes,
        lastVerifiedAt: authCheck.connection.lastVerifiedAt,
        lastSynchronizedAt: finishedAt,
      });
    }

    const finalStatus: SyncJobStatus = ingested.coreFetchFailed
      ? 'Failed'
      : out.status === 'Partial'
      ? 'Partial'
      : out.status === 'Failed' || out.status === 'Permission Denied'
      ? 'Failed'
      : 'Succeeded';

    await finalizeSyncLog({
      client,
      coachId: options.coachId,
      syncLogId,
      status: finalStatus,
      recordsProcessed: out.activitiesProcessed + out.wellnessProcessed,
      duplicatesSkipped: out.duplicatesSkipped,
      errorMessage: out.errorMessage,
      finishedAt,
    });

    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action:
        finalStatus === 'Succeeded'
          ? 'PILOT_SYNC_COMPLETED'
          : finalStatus === 'Partial'
          ? 'PILOT_SYNC_PARTIAL'
          : 'PILOT_SYNC_FAILED',
      targetEntity: 'athletes',
      targetId: out.internalAthleteId,
      athleteIdSnapshot: out.internalAthleteId,
      detail: `${out.syncMode} pilot sync (${verifiedPilotAthleteId}) finished with status ${finalStatus}: ${out.activitiesProcessed} activities processed, ${out.duplicatesSkipped} duplicates skipped, ${out.streamsImported} HR streams imported, ${out.wellnessProcessed} wellness records saved.`,
      metadata: {
        pilotAthleteId: verifiedPilotAthleteId,
        syncMode: out.syncMode,
        windowStart: out.windowStart,
        windowEnd: out.windowEnd,
      },
    }).catch(() => undefined);

    return {
      ok: finalStatus !== 'Failed',
      statusCode: finalStatus === 'Failed' ? 502 : 200,
      blockedByPilotGate: false,
      status: finalStatus,
      syncLogId,
      jobType,
      syncMode: out.syncMode,
      pilotAthleteId: verifiedPilotAthleteId,
      internalAthleteId: out.internalAthleteId,
      athleteName: out.athleteName,
      windowStart: out.windowStart,
      windowEnd: out.windowEnd,
      chunksQueried: out.chunksQueried,
      activitiesFetched: out.activitiesFetched,
      activitiesProcessed: out.activitiesProcessed,
      duplicatesSkipped: out.duplicatesSkipped,
      streamsImported: out.streamsImported,
      streamsMissing: out.streamsMissing,
      streamsUnavailable: out.streamsUnavailable,
      wellnessProcessed: out.wellnessProcessed,
      dailyLoadPointsWritten: out.dailyLoadPointsWritten,
      warnings: out.warnings,
      errorMessage: out.errorMessage,
      synchronizedAt: finishedAt,
    };
  } catch (err) {
    const errMsg = redactSensitiveText(
      err instanceof Error ? err.message : 'Unexpected pilot synchronization error.'
    );
    const finishedAt = new Date().toISOString();
    await finalizeSyncLog({
      client,
      coachId: options.coachId,
      syncLogId,
      status: 'Failed',
      recordsProcessed: 0,
      duplicatesSkipped: 0,
      errorMessage: errMsg,
      finishedAt,
    }).catch(() => undefined);

    return {
      ...baseFailure(
        503,
        'Failed',
        false,
        errMsg,
        syncLogId,
        jobType,
        syncMode,
        verifiedPilotAthleteId
      ),
      synchronizedAt: finishedAt,
    };
  }
}

async function buildRosterOverviewFromDb(params: {
  client: SupabaseClient;
  coachId: string;
  verifiedPilotAthleteId: string | null;
  sharedRoster: NormalizedRosterEntryWithMeta[];
  probedPermissions?: Map<
    string,
    {
      status: 'Authorized (Read-Only)' | 'Partial Permissions' | 'Permission unavailable';
      capabilities: IntervalsPermissionCapabilities;
    }
  >;
  autoPersistSafeEmailMatches?: boolean;
}): Promise<{
  athletes: IntervalsRosterAthleteOverviewRow[];
  existingAthletes: IntervalsRosterOverviewResponse['existingAthletes'];
  lastFullRosterSyncAt: string | null;
}> {
  const [
    { data: athRows },
    { data: mapRows },
    { data: actRows },
    { data: streamRows },
    { data: wellRows },
    { data: auditRows },
    { data: syncLogRows },
  ] = await Promise.all([
    params.client
      .from('athletes')
      .select('id, full_name, email')
      .eq('coach_id', params.coachId)
      .order('full_name', { ascending: true }),
    params.client
      .from('provider_athlete_mappings')
      .select('*')
      .eq('coach_id', params.coachId)
      .eq('provider', 'intervals_icu'),
    fetchAllPagedRows(() =>
      params.client
        .from('completed_activities')
        .select('athlete_id')
        .eq('coach_id', params.coachId)
        .eq('provider', 'intervals_icu')
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      params.client
        .from('heart_rate_streams')
        .select('athlete_id')
        .eq('coach_id', params.coachId)
        .order('activity_id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      params.client
        .from('wellness_records')
        .select('athlete_id')
        .eq('coach_id', params.coachId)
        .eq('source', 'intervals_icu_wellness')
        .order('id', { ascending: true })
    ),
    params.client
      .from('audit_events')
      .select('id, action, target_id, athlete_id_snapshot, detail, metadata, created_at')
      .eq('coach_id', params.coachId)
      .order('created_at', { ascending: false })
      .limit(300),
    params.client
      .from('synchronization_logs')
      .select('status, finished_at, started_at')
      .eq('coach_id', params.coachId)
      .eq('provider', 'intervals_icu')
      .order('started_at', { ascending: false })
      .limit(20),
  ]);

  const athletesList = Array.isArray(athRows) ? (athRows as Array<Record<string, unknown>>) : [];
  const mappingsList = Array.isArray(mapRows) ? (mapRows as Array<Record<string, unknown>>) : [];

  const actCountByAth = new Map<string, number>();
  for (const r of (actRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      actCountByAth.set(k, (actCountByAth.get(k) ?? 0) + 1);
    }
  }
  const streamCountByAth = new Map<string, number>();
  for (const r of (streamRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      streamCountByAth.set(k, (streamCountByAth.get(k) ?? 0) + 1);
    }
  }
  const wellCountByAth = new Map<string, number>();
  for (const r of (wellRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      wellCountByAth.set(k, (wellCountByAth.get(k) ?? 0) + 1);
    }
  }

  const mapByExternalId = new Map<string, Record<string, unknown>>();
  const extIdByAthleteId = new Map<string, string>();
  for (const m of mappingsList) {
    if (typeof m.external_athlete_id === 'string' && m.external_athlete_id) {
      mapByExternalId.set(m.external_athlete_id, m);
      if (m.athlete_id) {
        extIdByAthleteId.set(String(m.athlete_id), m.external_athlete_id);
      }
    }
  }

  const historyByExternalId = new Map<string, IntervalsAthleteSyncHistoryEntry[]>();
  const lastSuccessByExt = new Map<string, string>();
  const lastAttemptByExt = new Map<string, string>();
  const latestOutcomeByExt = new Map<string, { status: string; errorMessage: string | null }>();
  let lastFullRosterSyncAt: string | null = null;

  for (const ev of (auditRows ?? []) as Array<Record<string, unknown>>) {
    const action = String(ev.action ?? '');
    if (
      !lastFullRosterSyncAt &&
      (action === 'ROSTER_SYNC_COMPLETED' || action === 'ROSTER_SYNC_PARTIAL')
    ) {
      lastFullRosterSyncAt = String(ev.created_at);
    }
    if (action !== 'ROSTER_ATHLETE_SYNC' && !action.startsWith('PILOT_SYNC_')) continue;
    const extId = typeof ev.target_id === 'string' ? ev.target_id : null;
    if (!extId) continue;
    const meta = (ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : {}) as Record<
      string,
      unknown
    >;
    const status = String(
      meta.status ??
        (action === 'PILOT_SYNC_COMPLETED'
          ? 'Succeeded'
          : action === 'PILOT_SYNC_PARTIAL'
          ? 'Partial'
          : 'Failed')
    );
    const occurredAt = String(ev.created_at);
    const errorMsg = typeof meta.errorMessage === 'string' ? meta.errorMessage : null;

    if (!lastAttemptByExt.has(extId)) {
      lastAttemptByExt.set(extId, occurredAt);
      latestOutcomeByExt.set(extId, { status, errorMessage: errorMsg });
    }
    if ((status === 'Succeeded' || status === 'Partial') && !lastSuccessByExt.has(extId)) {
      lastSuccessByExt.set(extId, occurredAt);
    }

    const list = historyByExternalId.get(extId) ?? [];
    if (list.length < 10) {
      list.push({
        id: String(ev.id),
        syncLogId: typeof meta.syncLogId === 'string' ? meta.syncLogId : null,
        status,
        syncMode: String(meta.syncMode ?? 'incremental'),
        activitiesProcessed: Number(meta.activitiesProcessed ?? 0),
        duplicatesSkipped: Number(meta.duplicatesSkipped ?? 0),
        streamsImported: Number(meta.streamsImported ?? 0),
        wellnessProcessed: Number(meta.wellnessProcessed ?? 0),
        windowStart: typeof meta.windowStart === 'string' ? meta.windowStart : null,
        windowEnd: typeof meta.windowEnd === 'string' ? meta.windowEnd : null,
        errorMessage: errorMsg,
        occurredAt,
      });
      historyByExternalId.set(extId, list);
    }
  }

  if (!lastFullRosterSyncAt && Array.isArray(syncLogRows)) {
    const succeededLog = (syncLogRows as Array<Record<string, unknown>>).find(
      (l) => l.status === 'Succeeded' || l.status === 'Partial'
    );
    if (succeededLog) {
      lastFullRosterSyncAt = String(succeededLog.finished_at ?? succeededLog.started_at);
    }
  }

  // Safely auto-link ONLY unambiguous exact email matches if requested
  if (params.autoPersistSafeEmailMatches) {
    const emailIndex = new Map<string, Array<Record<string, unknown>>>();
    for (const a of athletesList) {
      if (typeof a.email === 'string' && a.email.trim()) {
        const em = a.email.trim().toLowerCase();
        const arr = emailIndex.get(em) ?? [];
        arr.push(a);
        emailIndex.set(em, arr);
      }
    }

    for (const entry of params.sharedRoster) {
      if (mapByExternalId.has(entry.id) || !entry.email) continue;
      const matches = emailIndex.get(entry.email.trim().toLowerCase()) ?? [];
      const unlinkedMatches = matches.filter((a) => !extIdByAthleteId.has(String(a.id)));
      if (matches.length === 1 && unlinkedMatches.length === 1) {
        const matchedAth = unlinkedMatches[0];
        const athId = String(matchedAth.id);
        const nowIso = new Date().toISOString();
        const payload = {
          coach_id: params.coachId,
          athlete_id: athId,
          provider: 'intervals_icu' as const,
          external_athlete_id: entry.id,
          authorization_status:
            entry.permissionHint === 'denied' ? 'Permission Denied' : 'Authorized (Read-Only)',
          match_status: 'Verified Match',
          match_method: 'Exact Email Match',
          match_confidence_pct: 100,
          candidate_profile_snapshot: sanitizeProviderPayloadForStorage({
            id: entry.id,
            name: entry.name,
            email: entry.email,
          }),
          reviewed_at: nowIso,
          note: 'Safely matched by unambiguous exact email address.',
        };
        const { data: upserted } = await params.client
          .from('provider_athlete_mappings')
          .upsert(payload, { onConflict: 'athlete_id,provider' })
          .select('*')
          .single();
        if (upserted) {
          mapByExternalId.set(entry.id, upserted as Record<string, unknown>);
          extIdByAthleteId.set(athId, entry.id);
        }
      }
    }
  }

  const activeLocks = activeAthleteLocksByCoach.get(params.coachId) ?? new Set<string>();
  const rows: IntervalsRosterAthleteOverviewRow[] = [];
  const seenExternalIds = new Set<string>();

  const buildRow = (
    extId: string,
    name: string,
    email: string | null,
    location: string | null,
    permissionHint: 'authorized' | 'denied' | 'unknown'
  ): IntervalsRosterAthleteOverviewRow => {
    seenExternalIds.add(extId);
    const mapRow = mapByExternalId.get(extId) ?? null;
    const internalId = mapRow?.athlete_id ? String(mapRow.athlete_id) : null;
    const isPilot = Boolean(
      params.verifiedPilotAthleteId && extId === params.verifiedPilotAthleteId
    );
    const rawMatchStatus = mapRow?.match_status
      ? String(mapRow.match_status)
      : 'Unmapped';
    const matchMethod = mapRow?.match_method ? String(mapRow.match_method) : 'Unmatched';
    const authStatus = mapRow?.authorization_status
      ? String(mapRow.authorization_status)
      : 'Unlinked';

    // Candidate review detection (ambiguous email OR same name without email — NEVER auto-merge by name)
    const candidateMatches: IntervalsRosterCandidateMatch[] = [];
    if (!mapRow) {
      const cleanEmail = email?.trim().toLowerCase() ?? null;
      const cleanName = name.trim().toLowerCase();
      for (const a of athletesList) {
        const aId = String(a.id);
        const aEmail = typeof a.email === 'string' ? a.email.trim().toLowerCase() : null;
        const aName = String(a.full_name ?? '').trim().toLowerCase();
        if (cleanEmail && aEmail && cleanEmail === aEmail) {
          candidateMatches.push({
            athleteId: aId,
            fullName: String(a.full_name),
            email: typeof a.email === 'string' ? a.email : null,
            reason: extIdByAthleteId.has(aId)
              ? 'Exact email matches an athlete already mapped to another ID'
              : 'Exact email candidate match (confirm to link)',
          });
        } else if (cleanName && aName && cleanName === aName) {
          candidateMatches.push({
            athleteId: aId,
            fullName: String(a.full_name),
            email: typeof a.email === 'string' ? a.email : null,
            reason: 'Name-only match blocked from auto-merge — coach confirmation required',
          });
        }
      }
    }

    const mappingStatus: IntervalsRosterAthleteOverviewRow['mappingStatus'] =
      rawMatchStatus === 'Verified Match'
        ? 'Verified Match'
        : rawMatchStatus === 'Candidate Review Required' || candidateMatches.length > 0
        ? 'Candidate Review Required'
        : 'Unmapped';

    const probed = params.probedPermissions?.get(extId);
    const isDenied =
      probed?.status === 'Permission unavailable' ||
      permissionHint === 'denied' ||
      authStatus === 'Permission Denied';

    const sharingPermissionStatus: IntervalsRosterAthleteOverviewRow['sharingPermissionStatus'] =
      isDenied
        ? 'Permission unavailable'
        : probed?.status === 'Partial Permissions'
        ? 'Partial Permissions'
        : mappingStatus === 'Candidate Review Required'
        ? 'Pending Review'
        : probed?.status === 'Authorized (Read-Only)' ||
          permissionHint === 'authorized' ||
          authStatus === 'Authorized (Read-Only)'
        ? 'Authorized (Read-Only)'
        : 'Unknown (Not Yet Probed)';

    const latestOutcome = latestOutcomeByExt.get(extId) ?? null;
    const isSyncingNow = activeLocks.has(extId);

    let currentSyncStatus: RosterDisplayStatus;
    if (isSyncingNow) {
      currentSyncStatus = 'Synchronizing';
    } else if (isDenied) {
      currentSyncStatus = 'Permission unavailable';
    } else if (mappingStatus === 'Unmapped') {
      currentSyncStatus = 'Not mapped';
    } else if (mappingStatus === 'Candidate Review Required') {
      currentSyncStatus = 'Awaiting coach review';
    } else if (latestOutcome?.status === 'Succeeded') {
      currentSyncStatus = 'Succeeded';
    } else if (latestOutcome?.status === 'Partial') {
      currentSyncStatus = 'Partially succeeded';
    } else if (latestOutcome?.status === 'Failed') {
      currentSyncStatus = 'Failed';
    } else if (latestOutcome?.status === 'Permission Denied') {
      currentSyncStatus = 'Permission unavailable';
    } else {
      currentSyncStatus = 'Ready to sync';
    }

    const activitiesImportedCount = internalId ? actCountByAth.get(internalId) ?? 0 : 0;
    const hrStreamsImportedCount = internalId ? streamCountByAth.get(internalId) ?? 0 : 0;
    const wellnessRecordsImportedCount = internalId ? wellCountByAth.get(internalId) ?? 0 : 0;

    return {
      externalAthleteId: extId,
      athleteName: name,
      email,
      location,
      internalAthleteId: internalId,
      isPilotAthlete: isPilot,
      mappingStatus,
      matchMethod,
      sharingPermissionStatus,
      ...(probed?.capabilities ? { permissionCapabilities: probed.capabilities } : {}),
      lastSuccessfulSyncAt: lastSuccessByExt.get(extId) ?? null,
      lastAttemptedSyncAt: lastAttemptByExt.get(extId) ?? null,
      activitiesImportedCount,
      hrStreamsImportedCount,
      wellnessRecordsImportedCount,
      currentSyncStatus,
      mostRecentError: latestOutcome?.errorMessage ?? null,
      eligibleForSync: mappingStatus === 'Verified Match' && !isDenied,
      candidateMatches,
      syncHistory: historyByExternalId.get(extId) ?? [],
    };
  };

  for (const entry of params.sharedRoster) {
    rows.push(buildRow(entry.id, entry.name, entry.email, entry.location, entry.permissionHint));
  }

  // Also include any previously mapped Intervals athletes if omitted from a filtered roster snapshot
  for (const m of mappingsList) {
    const extId = typeof m.external_athlete_id === 'string' ? m.external_athlete_id : null;
    if (!extId || seenExternalIds.has(extId)) continue;
    const ath = athletesList.find((a) => String(a.id) === String(m.athlete_id));
    rows.push(
      buildRow(
        extId,
        ath ? String(ath.full_name) : `Athlete ${extId}`,
        ath && typeof ath.email === 'string' ? ath.email : null,
        null,
        'unknown'
      )
    );
  }

  rows.sort((a, b) => {
    if (a.isPilotAthlete && !b.isPilotAthlete) return -1;
    if (!a.isPilotAthlete && b.isPilotAthlete) return 1;
    return a.athleteName.localeCompare(b.athleteName);
  });

  const existingAthletes = athletesList.map((a) => ({
    id: String(a.id),
    fullName: String(a.full_name),
    email: typeof a.email === 'string' ? a.email : null,
    alreadyMappedToExternalId: extIdByAthleteId.get(String(a.id)) ?? null,
  }));

  return { athletes: rows, existingAthletes, lastFullRosterSyncAt };
}

export async function getIntervalsRosterOverview(options: {
  coachId: string;
  probePermissions?: boolean;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: FetchLike;
  retryOptions?: FetchIntervalsRetryOptions;
}): Promise<IntervalsRosterOverviewResponse> {
  const fetchedAt = new Date().toISOString();
  const todayDate = fetchedAt.slice(0, 10);
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();
  const fetcher = options.fetcher ?? fetch;

  const failOut = (
    statusCode: IntervalsRosterOverviewResponse['statusCode'],
    blockedByPilotGate: boolean,
    errorMessage: string,
    verifiedPilotAthleteId: string | null = null,
    externalCoachId: string | null = null
  ): IntervalsRosterOverviewResponse => ({
    ok: false,
    statusCode,
    blockedByPilotGate,
    errorMessage: redactSensitiveText(errorMessage),
    verifiedPilotAthleteId,
    externalCoachId,
    excludedCoachIds: [],
    pagesFetched: 0,
    fetchedAt,
    lastFullRosterSyncAt: null,
    liveProgress: getActiveRosterProgressForCoach(options.coachId),
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
  });

  if (!client) {
    return failOut(503, false, 'Supabase admin client is not configured on the server.');
  }

  const authCheck = await checkPersistedRosterSyncAuthorization({
    coachId: options.coachId,
    store: oauthStore,
    fetcher,
    verifyLiveCoachAccount: true,
  });

  if (!authCheck.allowed || !authCheck.connection || !authCheck.authHeader) {
    return failOut(
      409,
      true,
      authCheck.reason ??
        'Intervals.icu roster access is locked until Milestone 3.1 pilot verification succeeds.',
      authCheck.connection?.verifiedPilotAthleteId ?? null,
      authCheck.connection?.externalCoachId ?? null
    );
  }

  const verifiedPilotAthleteId = authCheck.connection.verifiedPilotAthleteId!;
  const externalCoachId = authCheck.connection.externalCoachId ?? '0';

  const rosterRes = await fetchCompleteIntervalsRoster({
    authHeader: authCheck.authHeader,
    externalCoachId,
    todayDate,
    fetcher,
    retryOptions: options.retryOptions,
  });

  if (!rosterRes.ok) {
    return failOut(
      502,
      false,
      `Failed to retrieve shared roster from Intervals.icu (${rosterRes.errorText ?? 'HTTP error'}).`,
      verifiedPilotAthleteId,
      externalCoachId
    );
  }

  const probedPermissions = new Map<
    string,
    {
      status: 'Authorized (Read-Only)' | 'Partial Permissions' | 'Permission unavailable';
      capabilities: IntervalsPermissionCapabilities;
    }
  >();
  if (options.probePermissions && rosterRes.sharedRoster.length > 0) {
    const queue = [...rosterRes.sharedRoster];
    const probeWorker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (!entry) break;
        const encoded = encodeURIComponent(entry.id);
        const [prof, act, well] = await Promise.all([
          fetchIntervalsJson(`/athlete/${encoded}`, authCheck.authHeader!, fetcher, options.retryOptions),
          fetchIntervalsJson(
            `/athlete/${encoded}/activities?oldest=${todayDate}&newest=${todayDate}`,
            authCheck.authHeader!,
            fetcher,
            options.retryOptions
          ),
          fetchIntervalsJson(
            `/athlete/${encoded}/wellness?oldest=${todayDate}&newest=${todayDate}`,
            authCheck.authHeader!,
            fetcher,
            options.retryOptions
          ),
        ]);
        const settingsState: IntervalsPermissionCapabilities['settings'] = prof.ok
          ? 'granted'
          : prof.status === 401 || prof.status === 403
          ? 'denied'
          : 'unknown';
        const activitiesState: IntervalsPermissionCapabilities['activities'] = act.ok
          ? 'granted'
          : act.status === 401 || act.status === 403
          ? 'denied'
          : 'unknown';
        const wellnessState: IntervalsPermissionCapabilities['wellness'] = well.ok
          ? 'granted'
          : well.status === 401 || well.status === 403
          ? 'denied'
          : 'unknown';
        const capabilities: IntervalsPermissionCapabilities = {
          settings: settingsState,
          activities: activitiesState,
          wellness: wellnessState,
        };
        const allDenied =
          settingsState === 'denied' &&
          activitiesState === 'denied' &&
          wellnessState === 'denied';
        const coreDenied = settingsState === 'denied' && activitiesState === 'denied';
        const anyDenied =
          settingsState === 'denied' ||
          activitiesState === 'denied' ||
          wellnessState === 'denied';

        if (allDenied || coreDenied) {
          probedPermissions.set(entry.id, {
            status: 'Permission unavailable',
            capabilities,
          });
        } else if (anyDenied) {
          probedPermissions.set(entry.id, {
            status: 'Partial Permissions',
            capabilities,
          });
        } else if (prof.ok || act.ok || well.ok) {
          probedPermissions.set(entry.id, {
            status: 'Authorized (Read-Only)',
            capabilities,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, rosterRes.sharedRoster.length) }, () => probeWorker())
    );
  }

  const { athletes, existingAthletes, lastFullRosterSyncAt } = await buildRosterOverviewFromDb({
    client,
    coachId: options.coachId,
    verifiedPilotAthleteId,
    sharedRoster: rosterRes.sharedRoster,
    probedPermissions,
    autoPersistSafeEmailMatches: true,
  });

  return {
    ok: true,
    statusCode: 200,
    blockedByPilotGate: false,
    errorMessage: null,
    verifiedPilotAthleteId,
    externalCoachId,
    excludedCoachIds: rosterRes.excludedCoachIds,
    pagesFetched: rosterRes.pagesFetched,
    fetchedAt,
    lastFullRosterSyncAt,
    liveProgress: getActiveRosterProgressForCoach(options.coachId),
    summary: {
      totalSharedAthletes: athletes.length,
      mappedAthletes: athletes.filter((a) => a.mappingStatus === 'Verified Match').length,
      unmappedAthletes: athletes.filter((a) => a.mappingStatus === 'Unmapped').length,
      awaitingReviewCount: athletes.filter(
        (a) => a.mappingStatus === 'Candidate Review Required'
      ).length,
      eligibleAthletes: athletes.filter((a) => a.eligibleForSync).length,
      succeededCount: athletes.filter((a) => a.currentSyncStatus === 'Succeeded').length,
      partialCount: athletes.filter((a) => a.currentSyncStatus === 'Partially succeeded').length,
      failedCount: athletes.filter((a) => a.currentSyncStatus === 'Failed').length,
      permissionUnavailableCount: athletes.filter(
        (a) => a.currentSyncStatus === 'Permission unavailable'
      ).length,
      synchronizingCount: athletes.filter((a) => a.currentSyncStatus === 'Synchronizing').length,
    },
    athletes,
    existingAthletes,
    warnings: rosterRes.warnings,
  };
}

export async function resolveIntervalsAthleteMapping(
  options: ResolveIntervalsMappingOptions
): Promise<ResolveIntervalsMappingResult> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();
  const fetcher = options.fetcher ?? fetch;
  const externalId = options.externalAthleteId.trim();

  const fail = (
    statusCode: ResolveIntervalsMappingResult['statusCode'],
    message: string,
    mappingStatus: ResolveIntervalsMappingResult['mappingStatus'] = 'Unmapped'
  ): ResolveIntervalsMappingResult => ({
    ok: false,
    statusCode,
    action: options.action,
    externalAthleteId: externalId,
    internalAthleteId: null,
    athleteName: null,
    mappingStatus,
    message: redactSensitiveText(message),
  });

  if (!externalId) {
    return fail(400, 'externalAthleteId is required.');
  }
  if (!client) {
    return fail(503, 'Supabase admin client is not configured.');
  }

  const authCheck = await checkPersistedRosterSyncAuthorization({
    coachId: options.coachId,
    store: oauthStore,
    fetcher,
    verifyLiveCoachAccount: true,
  });

  if (!authCheck.allowed || !authCheck.connection || !authCheck.authHeader) {
    return fail(
      409,
      authCheck.reason ?? 'Pilot verification must pass before modifying Intervals.icu mappings.'
    );
  }

  const externalCoachId = authCheck.connection.externalCoachId ?? '0';
  if (isCoachSelfAthleteId(externalId, externalCoachId)) {
    return fail(403, 'Cannot map coach own Intervals.icu athlete ID as a coached athlete.');
  }

  const nowIso = new Date().toISOString();

  if (options.action === 'leave_unmapped') {
    const { data: existingMap } = await client
      .from('provider_athlete_mappings')
      .select('id, athlete_id')
      .eq('coach_id', options.coachId)
      .eq('provider', 'intervals_icu')
      .eq('external_athlete_id', externalId)
      .maybeSingle();

    if (existingMap?.id) {
      await client
        .from('provider_athlete_mappings')
        .delete()
        .eq('id', existingMap.id)
        .eq('coach_id', options.coachId);
      await appendAuditEvent({
        client,
        coachId: options.coachId,
        action: 'ROSTER_MAPPING_UNLINKED',
        targetEntity: 'provider_athlete_mappings',
        targetId: externalId,
        athleteIdSnapshot: existingMap.athlete_id ? String(existingMap.athlete_id) : null,
        detail: `Coach left Intervals.icu athlete ${externalId} unmapped.`,
      }).catch(() => undefined);
    }

    return {
      ok: true,
      statusCode: 200,
      action: options.action,
      externalAthleteId: externalId,
      internalAthleteId: null,
      athleteName: null,
      mappingStatus: 'Unmapped',
      message: `Intervals.icu athlete ${externalId} left unmapped; existing athlete records remain intact.`,
    };
  }

  // Validate external athlete is present in coach's live shared roster
  const rosterRes = await fetchCompleteIntervalsRoster({
    authHeader: authCheck.authHeader,
    externalCoachId,
    todayDate: nowIso.slice(0, 10),
    fetcher,
    retryOptions: options.retryOptions,
  });

  if (!rosterRes.ok) {
    return fail(502, `Unable to validate live shared roster (${rosterRes.errorText ?? 'error'}).`);
  }

  const rosterEntry = rosterRes.sharedRoster.find((r) => r.id === externalId);
  if (!rosterEntry) {
    return fail(
      403,
      `Intervals.icu athlete ${externalId} is not present in the authenticated coach's shared roster.`
    );
  }

  if (options.action === 'link_existing' || options.action === 'confirm_candidate') {
    const targetAthleteId = options.athleteId?.trim();
    if (!targetAthleteId) {
      return fail(400, 'athleteId is required to link or confirm an athlete mapping.');
    }

    const { data: targetAth } = await client
      .from('athletes')
      .select('id, full_name, email')
      .eq('id', targetAthleteId)
      .eq('coach_id', options.coachId)
      .maybeSingle();

    if (!targetAth?.id) {
      return fail(404, 'Target athlete does not exist for the authenticated coach.');
    }

    // Prevent duplicate external mappings across different athletes
    const { data: existingForExt } = await client
      .from('provider_athlete_mappings')
      .select('id, athlete_id')
      .eq('coach_id', options.coachId)
      .eq('provider', 'intervals_icu')
      .eq('external_athlete_id', externalId)
      .maybeSingle();

    if (existingForExt?.athlete_id && String(existingForExt.athlete_id) !== targetAthleteId) {
      return fail(
        409,
        `Intervals.icu athlete ${externalId} is already linked to another athlete record.`
      );
    }

    const { data: existingForAth } = await client
      .from('provider_athlete_mappings')
      .select('id, external_athlete_id')
      .eq('coach_id', options.coachId)
      .eq('athlete_id', targetAthleteId)
      .eq('provider', 'intervals_icu')
      .maybeSingle();

    if (
      existingForAth?.external_athlete_id &&
      String(existingForAth.external_athlete_id) !== externalId
    ) {
      return fail(
        409,
        `Athlete ${String(targetAth.full_name)} is already linked to Intervals.icu ID ${String(
          existingForAth.external_athlete_id
        )}.`
      );
    }

    const mappingPayload = {
      coach_id: options.coachId,
      athlete_id: targetAthleteId,
      provider: 'intervals_icu' as const,
      external_athlete_id: externalId,
      authorization_status:
        rosterEntry.permissionHint === 'denied' ? 'Permission Denied' : 'Authorized (Read-Only)',
      match_status: 'Verified Match',
      match_method: 'Coach Manual Match',
      match_confidence_pct: 100,
      candidate_profile_snapshot: sanitizeProviderPayloadForStorage(rosterEntry),
      reviewed_at: nowIso,
      note:
        options.action === 'confirm_candidate'
          ? 'Coach reviewed and confirmed candidate mapping.'
          : 'Coach manually linked Intervals.icu athlete.',
    };

    const { error: upErr } = await client
      .from('provider_athlete_mappings')
      .upsert(mappingPayload, { onConflict: 'athlete_id,provider' });

    if (upErr) {
      return fail(503, `Failed to persist athlete mapping: ${upErr.message}`);
    }

    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action: 'ROSTER_MAPPING_UPDATED',
      targetEntity: 'provider_athlete_mappings',
      targetId: externalId,
      athleteIdSnapshot: targetAthleteId,
      detail: `Coach linked Intervals.icu athlete ${externalId} (${rosterEntry.name}) to ${String(
        targetAth.full_name
      )}.`,
    }).catch(() => undefined);

    return {
      ok: true,
      statusCode: 200,
      action: options.action,
      externalAthleteId: externalId,
      internalAthleteId: targetAthleteId,
      athleteName: String(targetAth.full_name),
      mappingStatus: 'Verified Match',
      message: `Linked ${rosterEntry.name} (${externalId}) to ${String(targetAth.full_name)}.`,
    };
  }

  // action === 'create_and_link'
  const { data: existingExt } = await client
    .from('provider_athlete_mappings')
    .select('id, athlete_id')
    .eq('coach_id', options.coachId)
    .eq('provider', 'intervals_icu')
    .eq('external_athlete_id', externalId)
    .maybeSingle();

  if (existingExt?.athlete_id) {
    const { data: existingAth } = await client
      .from('athletes')
      .select('id, full_name')
      .eq('id', existingExt.athlete_id)
      .eq('coach_id', options.coachId)
      .maybeSingle();
    return {
      ok: true,
      statusCode: 200,
      action: options.action,
      externalAthleteId: externalId,
      internalAthleteId: String(existingExt.athlete_id),
      athleteName: existingAth?.full_name ? String(existingAth.full_name) : rosterEntry.name,
      mappingStatus: 'Verified Match',
      message: `${rosterEntry.name} (${externalId}) is already linked.`,
    };
  }

  // Fetch profile metadata if permitted (never fail creation solely if optional fields omitted)
  const profRes = await fetchIntervalsJson(
    `/athlete/${encodeURIComponent(externalId)}`,
    authCheck.authHeader,
    fetcher,
    options.retryOptions
  );
  const prof =
    profRes.ok && profRes.data && typeof profRes.data === 'object'
      ? (profRes.data as Record<string, unknown>)
      : {};

  const resolvedEmail =
    typeof prof.email === 'string' && prof.email.trim()
      ? prof.email.trim().toLowerCase()
      : rosterEntry.email?.trim().toLowerCase() ?? null;

  if (resolvedEmail) {
    const { data: emailDup } = await client
      .from('athletes')
      .select('id, full_name')
      .eq('coach_id', options.coachId)
      .ilike('email', resolvedEmail)
      .maybeSingle();
    if (emailDup?.id) {
      return fail(
        409,
        `An athlete with email ${resolvedEmail} (${String(
          emailDup.full_name
        )}) already exists. Link to the existing athlete instead of creating a duplicate.`
      );
    }
  }

  const sportSettings = Array.isArray(prof.sportSettings)
    ? (prof.sportSettings as Array<Record<string, unknown>>)
    : [];
  const runSetting =
    sportSettings.find((s) =>
      Array.isArray(s.types)
        ? s.types.some((t) => typeof t === 'string' && t.toLowerCase().includes('run'))
        : false
    ) ?? sportSettings[0];

  const resolvedName =
    typeof prof.name === 'string' && prof.name.trim() ? prof.name.trim() : rosterEntry.name;

  const { data: createdAth, error: createErr } = await client
    .from('athletes')
    .insert({
      coach_id: options.coachId,
      full_name: resolvedName,
      email: resolvedEmail,
      age: intInRangeOrNull(prof.age, 12, 110) ?? computeAgeFromDob(prof.dob, nowIso),
      gender: normalizeGender(prof.sex ?? prof.gender ?? rosterEntry.gender),
      location: rosterEntry.location,
      training_group: 'Marathon',
      current_phase: 'Build',
      resting_hr_bpm: intInRangeOrNull(prof.icu_resting_hr ?? prof.restingHR, 28, 120),
      max_hr_bpm: intInRangeOrNull(runSetting?.max_hr ?? prof.max_hr, 110, 235),
      active_lthr_bpm: intInRangeOrNull(runSetting?.lthr ?? prof.lthr, 90, 220),
      active_threshold_version: 1,
      threshold_pace_sec_per_mile: normalizeThresholdPaceSecPerMile(runSetting?.threshold_pace),
      optional_threshold_power_watts: intInRangeOrNull(runSetting?.run_ftp ?? runSetting?.ftp, 50, 1500),
      sport_specialization: 'Running',
      data_origin: 'live',
    })
    .select('id, full_name')
    .single();

  if (createErr || !createdAth?.id) {
    return fail(503, `Failed to create athlete record: ${createErr?.message ?? 'unknown error'}`);
  }

  const newInternalId = String(createdAth.id);
  const authStatus =
    profRes.status === 401 || profRes.status === 403 || rosterEntry.permissionHint === 'denied'
      ? 'Permission Denied'
      : 'Authorized (Read-Only)';

  await client.from('provider_athlete_mappings').upsert(
    {
      coach_id: options.coachId,
      athlete_id: newInternalId,
      provider: 'intervals_icu',
      external_athlete_id: externalId,
      authorization_status: authStatus,
      match_status: 'Verified Match',
      match_method: 'External ID Match',
      match_confidence_pct: 100,
      candidate_profile_snapshot: sanitizeProviderPayloadForStorage(rosterEntry),
      reviewed_at: nowIso,
      note: 'Coach created and linked athlete from Intervals.icu shared roster.',
    },
    { onConflict: 'athlete_id,provider' }
  );

  await appendAuditEvent({
    client,
    coachId: options.coachId,
    action: 'ROSTER_ATHLETE_CREATED_AND_LINKED',
    targetEntity: 'athletes',
    targetId: externalId,
    athleteIdSnapshot: newInternalId,
    detail: `Created athlete ${resolvedName} and linked to Intervals.icu ID ${externalId}.`,
  }).catch(() => undefined);

  return {
    ok: true,
    statusCode: 200,
    action: options.action,
    externalAthleteId: externalId,
    internalAthleteId: newInternalId,
    athleteName: resolvedName,
    mappingStatus: 'Verified Match',
    message: `Created ${resolvedName} and linked to Intervals.icu ID ${externalId}.`,
  };
}

export async function synchronizeFullRoster(
  options: FullRosterSyncOptions
): Promise<FullRosterSyncSummary> {
  const startedAt = options.nowIso ?? new Date().toISOString();
  const todayDate = startedAt.slice(0, 10);
  const modeRequested: 'auto' | 'initial' | 'incremental' =
    options.mode === 'initial' || options.mode === 'incremental' ? options.mode : 'auto';
  const jobType: SyncJobType = options.retryFailedOnly
    ? 'retry_sync'
    : modeRequested === 'initial'
    ? 'backfill_12w'
    : 'daily_activity_import';

  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();
  const fetcher = options.fetcher ?? fetch;

  const emptySummary = (
    statusCode: FullRosterSyncSummary['statusCode'],
    status: SyncJobStatus,
    blockedByPilotGate: boolean,
    errorMessage: string,
    syncLogId: string | null = null,
    verifiedPilotAthleteId: string | null = null,
    externalCoachId: string | null = null
  ): FullRosterSyncSummary => ({
    ok: false,
    statusCode,
    blockedByPilotGate,
    status,
    syncLogId,
    jobType,
    syncModeRequested: modeRequested,
    verifiedPilotAthleteId,
    externalCoachId,
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
    errorMessage: redactSensitiveText(errorMessage),
    synchronizedAt: startedAt,
  });

  if (!client) {
    return emptySummary(
      503,
      'Failed',
      false,
      'Supabase admin client is not configured on the server.'
    );
  }

  // Prevent accidental overlapping full-roster jobs for the same coach
  const requestedFilterIds = Array.isArray(options.athleteIds)
    ? options.athleteIds.map((id) => id.trim()).filter(Boolean)
    : null;
  const isBatchJob = !requestedFilterIds || requestedFilterIds.length !== 1;
  if (isBatchJob && activeRosterJobsByCoach.has(options.coachId)) {
    return emptySummary(
      409,
      'Failed',
      false,
      'A full-roster synchronization job is already running for this coach. Wait for completion before starting another.'
    );
  }

  // 1. Enforce Milestone 3.1 database-authoritative pilot gate before full roster sync
  const authCheck = await checkPersistedRosterSyncAuthorization({
    coachId: options.coachId,
    store: oauthStore,
    fetcher,
    verifyLiveCoachAccount: true,
  });

  if (!authCheck.allowed || !authCheck.connection || !authCheck.authHeader) {
    const blockedMsg =
      authCheck.reason ??
      'Full roster synchronization is locked until Milestone 3.1 pilot verification succeeds.';
    const syncLogId = await createSyncLog({
      client,
      coachId: options.coachId,
      jobType,
      status: 'Blocked (Unauthorized)',
      startedAt,
      errorMessage: blockedMsg,
      finishedAt: new Date().toISOString(),
    }).catch(() => null);
    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action: 'ROSTER_SYNC_BLOCKED',
      targetEntity: 'provider_connections',
      detail: blockedMsg,
    }).catch(() => undefined);

    return emptySummary(
      409,
      'Blocked (Unauthorized)',
      true,
      blockedMsg,
      syncLogId,
      authCheck.connection?.verifiedPilotAthleteId ?? null,
      authCheck.connection?.externalCoachId ?? null
    );
  }

  const verifiedPilotAthleteId = authCheck.connection.verifiedPilotAthleteId!;
  const externalCoachId = authCheck.connection.externalCoachId ?? '0';
  const authHeader = authCheck.authHeader;

  // Reject explicit coach-self requests before hitting athlete endpoints
  if (
    requestedFilterIds &&
    requestedFilterIds.length > 0 &&
    requestedFilterIds.every((id) => isCoachSelfAthleteId(id, externalCoachId))
  ) {
    const selfMsg =
      'Full roster synchronization rejected: coach own Intervals.icu athlete ID cannot be synced as a coached athlete.';
    const syncLogId = await createSyncLog({
      client,
      coachId: options.coachId,
      jobType,
      status: 'Blocked (Unauthorized)',
      startedAt,
      errorMessage: selfMsg,
      finishedAt: new Date().toISOString(),
    }).catch(() => null);
    return emptySummary(
      403,
      'Blocked (Unauthorized)',
      true,
      selfMsg,
      syncLogId,
      verifiedPilotAthleteId,
      externalCoachId
    );
  }

  // If syncing a single athlete, reject if that athlete is already synchronizing
  if (!isBatchJob && requestedFilterIds && requestedFilterIds.length === 1) {
    const singleId = requestedFilterIds[0];
    const locks = activeAthleteLocksByCoach.get(options.coachId);
    if (locks?.has(singleId)) {
      return emptySummary(
        409,
        'Failed',
        false,
        `Synchronization is already in progress for athlete ${singleId}.`,
        null,
        verifiedPilotAthleteId,
        externalCoachId
      );
    }
  }

  const syncLogId = await createSyncLog({
    client,
    coachId: options.coachId,
    jobType,
    status: 'Running',
    startedAt,
  });

  if (isBatchJob) {
    activeRosterJobsByCoach.set(options.coachId, {
      running: true,
      mode: options.retryFailedOnly ? 'retry_failed' : modeRequested,
      totalSelected: 0,
      completedCount: 0,
      activeAthleteIds: [],
      startedAt,
    });
  }

  try {
    // 2. Retrieve complete paginated shared roster (never include coach self athlete ID)
    const rosterRes = await fetchCompleteIntervalsRoster({
      authHeader,
      externalCoachId,
      todayDate,
      fetcher,
      retryOptions: options.retryOptions,
    });

    if (!rosterRes.ok) {
      const rosterErr = `Failed to retrieve Intervals.icu coached roster (${
        rosterRes.errorText ?? 'HTTP error'
      }).`;
      const finishedAt = new Date().toISOString();
      await finalizeSyncLog({
        client,
        coachId: options.coachId,
        syncLogId,
        status: 'Failed',
        recordsProcessed: 0,
        duplicatesSkipped: 0,
        errorMessage: rosterErr,
        finishedAt,
      });
      await appendAuditEvent({
        client,
        coachId: options.coachId,
        action: 'ROSTER_SYNC_FAILED',
        targetEntity: 'provider_connections',
        detail: rosterErr,
      }).catch(() => undefined);

      return {
        ...emptySummary(
          502,
          'Failed',
          false,
          rosterErr,
          syncLogId,
          verifiedPilotAthleteId,
          externalCoachId
        ),
        synchronizedAt: finishedAt,
      };
    }

    const sharedRoster = [...rosterRes.sharedRoster].sort((a, b) => {
      if (a.id === verifiedPilotAthleteId) return -1;
      if (b.id === verifiedPilotAthleteId) return 1;
      return a.name.localeCompare(b.name);
    });
    const rosterMap = new Map(sharedRoster.map((e) => [e.id, e]));
    const warnings: string[] = [...rosterRes.warnings];

    const overviewBefore = await buildRosterOverviewFromDb({
      client,
      coachId: options.coachId,
      verifiedPilotAthleteId,
      sharedRoster,
      autoPersistSafeEmailMatches: true,
    });
    const overviewByExtId = new Map(
      overviewBefore.athletes.map((a) => [a.externalAthleteId, a])
    );

    let targetAthletes = sharedRoster;
    if (requestedFilterIds && requestedFilterIds.length > 0) {
      const requestedSet = new Set(requestedFilterIds);
      targetAthletes = sharedRoster.filter((a) => requestedSet.has(a.id));
      for (const reqId of requestedFilterIds) {
        if (isCoachSelfAthleteId(reqId, externalCoachId)) {
          warnings.push(`Excluded coach own athlete ID (${reqId}) from roster sync.`);
        } else if (!rosterMap.has(reqId)) {
          warnings.push(`Requested athlete ID (${reqId}) is not in the shared coached roster.`);
        }
      }
    } else if (options.retryFailedOnly) {
      targetAthletes = sharedRoster.filter((a) => {
        const row = overviewByExtId.get(a.id);
        return (
          Boolean(row?.eligibleForSync || a.id === verifiedPilotAthleteId) &&
          (row?.currentSyncStatus === 'Failed' || row?.currentSyncStatus === 'Partially succeeded')
        );
      });
    }

    if (targetAthletes.length === 0) {
      const emptyWarn = options.retryFailedOnly
        ? 'No failed or partially synced eligible athletes to retry.'
        : 'No shared coached athletes available to synchronize in Intervals.icu roster.';
      warnings.push(emptyWarn);
      const finishedAt = new Date().toISOString();
      await finalizeSyncLog({
        client,
        coachId: options.coachId,
        syncLogId,
        status: options.retryFailedOnly ? 'Succeeded' : 'Partial',
        recordsProcessed: 0,
        duplicatesSkipped: 0,
        errorMessage: options.retryFailedOnly ? null : warnings.join(' | '),
        finishedAt,
      });

      return {
        ok: true,
        statusCode: 200,
        blockedByPilotGate: false,
        status: options.retryFailedOnly ? 'Succeeded' : 'Partial',
        syncLogId,
        jobType,
        syncModeRequested: modeRequested,
        verifiedPilotAthleteId,
        externalCoachId,
        totalAthletesInRoster: sharedRoster.length,
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
        warnings,
        errorMessage: options.retryFailedOnly ? null : warnings.join(' | '),
        synchronizedAt: finishedAt,
      };
    }

    if (isBatchJob) {
      const prog = activeRosterJobsByCoach.get(options.coachId);
      if (prog) {
        prog.totalSelected = targetAthletes.length;
      }
    }

    // 3. Synchronize shared athletes with bounded concurrency & strict per-athlete error isolation
    const boundedConcurrency = Math.min(
      3,
      Math.max(1, Math.floor(options.concurrency ?? 2), 1)
    );
    const athleteResults: RosterAthleteSyncOutcome[] = new Array(targetAthletes.length);
    let nextIdx = 0;

    const processNextAthlete = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= targetAthletes.length) break;
        const entry = targetAthletes[idx];
        const isPilot = entry.id === verifiedPilotAthleteId;
        const overviewRow = overviewByExtId.get(entry.id);

        if (!acquireAthleteSyncLock(options.coachId, entry.id)) {
          const lockMsg = `Skipped concurrent sync for ${entry.name} (${entry.id}): already synchronizing.`;
          athleteResults[idx] = {
            externalAthleteId: entry.id,
            internalAthleteId: overviewRow?.internalAthleteId ?? null,
            athleteName: entry.name,
            isPilotAthlete: isPilot,
            status: 'Failed',
            syncMode: modeRequested === 'initial' ? 'initial' : 'incremental',
            authorizationStatus: 'Unlinked',
            windowStart: null,
            windowEnd: null,
            chunksQueried: 0,
            activitiesFetched: 0,
            activitiesProcessed: 0,
            activitiesRemoved: 0,
            duplicatesSkipped: 0,
            streamsImported: 0,
            streamsMissing: 0,
            streamsUnavailable: 0,
            wellnessProcessed: 0,
            dailyLoadPointsWritten: 0,
            warnings: [lockMsg],
            errorMessage: lockMsg,
          };
          warnings.push(lockMsg);
          continue;
        }

        const prog = activeRosterJobsByCoach.get(options.coachId);
        if (prog && !prog.activeAthleteIds.includes(entry.id)) {
          prog.activeAthleteIds.push(entry.id);
        }

        try {
          const ingested = await ingestSingleIntervalsAthlete({
            client,
            coachId: options.coachId,
            targetExternalAthleteId: entry.id,
            fallbackAthleteName: entry.name,
            fallbackEmail: entry.email,
            externalCoachId,
            isPilotAthlete: isPilot,
            requireExplicitMapping: true,
            overviewMappingStatus: overviewRow?.mappingStatus,
            mappingNote: isPilot
              ? 'Verified pilot athlete synced via full roster sync.'
              : 'Synchronized shared coached athlete via Milestone 3.5 full roster sync.',
            authHeader,
            mode: modeRequested,
            startedAt,
            initialLookbackDays: options.initialLookbackDays,
            overlapDays: options.overlapDays,
            chunkDays: options.chunkDays,
            fetcher,
            retryOptions: options.retryOptions,
          });
          athleteResults[idx] = ingested.outcome;
          if (ingested.outcome.errorMessage) {
            warnings.push(`${entry.name} (${entry.id}): ${ingested.outcome.errorMessage}`);
          }

          if (
            ingested.outcome.status !== 'Not mapped' &&
            ingested.outcome.status !== 'Awaiting coach review'
          ) {
            await appendAuditEvent({
              client,
              coachId: options.coachId,
              action: 'ROSTER_ATHLETE_SYNC',
              targetEntity: 'athlete',
              targetId: entry.id,
              athleteIdSnapshot: ingested.outcome.internalAthleteId,
              detail: `${entry.name} (${entry.id}): ${ingested.outcome.status} (${ingested.outcome.activitiesProcessed} saved, ${ingested.outcome.duplicatesSkipped} dup, ${ingested.outcome.streamsImported} HR streams, ${ingested.outcome.wellnessProcessed} wellness).`,
              metadata: {
                syncLogId,
                status: ingested.outcome.status,
                syncMode: ingested.outcome.syncMode,
                authorizationStatus: ingested.outcome.authorizationStatus,
                activitiesProcessed: ingested.outcome.activitiesProcessed,
                activitiesRemoved: ingested.outcome.activitiesRemoved ?? 0,
                duplicatesSkipped: ingested.outcome.duplicatesSkipped,
                streamsImported: ingested.outcome.streamsImported,
                wellnessProcessed: ingested.outcome.wellnessProcessed,
                windowStart: ingested.outcome.windowStart,
                windowEnd: ingested.outcome.windowEnd,
                errorMessage: ingested.outcome.errorMessage,
              },
            }).catch(() => undefined);
          }
        } catch (athErr) {
          const athErrMsg = redactSensitiveText(
            athErr instanceof Error ? athErr.message : 'Unexpected per-athlete sync exception.'
          );
          athleteResults[idx] = {
            externalAthleteId: entry.id,
            internalAthleteId: overviewRow?.internalAthleteId ?? null,
            athleteName: entry.name,
            isPilotAthlete: isPilot,
            status: 'Failed',
            syncMode: modeRequested === 'initial' ? 'initial' : 'incremental',
            authorizationStatus: 'Unlinked',
            windowStart: null,
            windowEnd: null,
            chunksQueried: 0,
            activitiesFetched: 0,
            activitiesProcessed: 0,
            activitiesRemoved: 0,
            duplicatesSkipped: 0,
            streamsImported: 0,
            streamsMissing: 0,
            streamsUnavailable: 0,
            wellnessProcessed: 0,
            dailyLoadPointsWritten: 0,
            warnings: [athErrMsg],
            errorMessage: athErrMsg,
          };
          warnings.push(`${entry.name} (${entry.id}): ${athErrMsg}`);

          await appendAuditEvent({
            client,
            coachId: options.coachId,
            action: 'ROSTER_ATHLETE_SYNC',
            targetEntity: 'athlete',
            targetId: entry.id,
            athleteIdSnapshot: overviewRow?.internalAthleteId ?? null,
            detail: `${entry.name} (${entry.id}): Failed (${athErrMsg}).`,
            metadata: {
              syncLogId,
              status: 'Failed',
              syncMode: modeRequested === 'initial' ? 'initial' : 'incremental',
              errorMessage: athErrMsg,
            },
          }).catch(() => undefined);
        } finally {
          releaseAthleteSyncLock(options.coachId, entry.id);
          const liveProg = activeRosterJobsByCoach.get(options.coachId);
          if (liveProg) {
            liveProg.completedCount++;
            liveProg.activeAthleteIds = liveProg.activeAthleteIds.filter((id) => id !== entry.id);
          }
        }

        if (fetcher === fetch && idx < targetAthletes.length - 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(boundedConcurrency, targetAthletes.length) },
      () => processNextAthlete()
    );
    await Promise.all(workers);

    const athletesSucceededCount = athleteResults.filter((a) => a.status === 'Succeeded').length;
    const athletesPartialCount = athleteResults.filter((a) => a.status === 'Partial').length;
    const permissionDeniedCount = athleteResults.filter(
      (a) => a.status === 'Permission Denied'
    ).length;
    const athletesFailedCount = athleteResults.filter((a) => a.status === 'Failed').length;
    const unmappedSkippedCount = athleteResults.filter(
      (a) => a.status === 'Not mapped' || a.status === 'Awaiting coach review'
    ).length;

    const totalActivitiesFetched = athleteResults.reduce((s, a) => s + a.activitiesFetched, 0);
    const totalActivitiesProcessed = athleteResults.reduce((s, a) => s + a.activitiesProcessed, 0);
    const totalActivitiesRemoved = athleteResults.reduce(
      (s, a) => s + (a.activitiesRemoved ?? 0),
      0
    );
    const totalDuplicatesSkipped = athleteResults.reduce((s, a) => s + a.duplicatesSkipped, 0);
    const totalStreamsImported = athleteResults.reduce((s, a) => s + a.streamsImported, 0);
    const totalStreamsMissing = athleteResults.reduce((s, a) => s + a.streamsMissing, 0);
    const totalStreamsUnavailable = athleteResults.reduce((s, a) => s + a.streamsUnavailable, 0);
    const totalWellnessProcessed = athleteResults.reduce((s, a) => s + a.wellnessProcessed, 0);
    const dailyLoadPointsWritten = athleteResults.reduce(
      (s, a) => s + a.dailyLoadPointsWritten,
      0
    );

    const hasSuccessfulAthlete = athletesSucceededCount > 0 || athletesPartialCount > 0;
    const finalStatus: SyncJobStatus = !hasSuccessfulAthlete
      ? unmappedSkippedCount > 0 && athletesFailedCount === 0 && permissionDeniedCount === 0
        ? 'Partial'
        : 'Failed'
      : athletesPartialCount > 0 ||
        permissionDeniedCount > 0 ||
        athletesFailedCount > 0 ||
        unmappedSkippedCount > 0 ||
        warnings.length > 0
      ? 'Partial'
      : 'Succeeded';

    const finishedAt = new Date().toISOString();
    if (hasSuccessfulAthlete) {
      await oauthStore.upsertProviderConnection({
        coachId: options.coachId,
        provider: 'intervals_icu',
        authMode: authCheck.connection.authMode,
        connected: true,
        readOnlyMode: true,
        pilotTestSucceeded: true,
        verifiedPilotAthleteId,
        externalCoachId: authCheck.connection.externalCoachId,
        externalCoachName: authCheck.connection.externalCoachName,
        grantedScopes: authCheck.connection.grantedScopes,
        lastVerifiedAt: authCheck.connection.lastVerifiedAt,
        lastSynchronizedAt: finishedAt,
      });
    }

    const summaryNote = warnings.length > 0 ? warnings.slice(0, 5).join(' | ') : null;
    await finalizeSyncLog({
      client,
      coachId: options.coachId,
      syncLogId,
      status: finalStatus,
      recordsProcessed: totalActivitiesProcessed + totalWellnessProcessed,
      duplicatesSkipped: totalDuplicatesSkipped,
      errorMessage: summaryNote,
      finishedAt,
    });

    await appendAuditEvent({
      client,
      coachId: options.coachId,
      action:
        finalStatus === 'Succeeded'
          ? 'ROSTER_SYNC_COMPLETED'
          : finalStatus === 'Partial'
          ? 'ROSTER_SYNC_PARTIAL'
          : 'ROSTER_SYNC_FAILED',
      targetEntity: 'synchronization_logs',
      targetId: syncLogId,
      detail: `Full roster sync (${modeRequested}) finished with status ${finalStatus}: ${athletesSucceededCount} succeeded, ${athletesPartialCount} partial, ${permissionDeniedCount} permission denied, ${athletesFailedCount} failed, ${unmappedSkippedCount} unmapped across ${athleteResults.length} athletes.`,
      metadata: {
        modeRequested,
        totalAthletesInRoster: sharedRoster.length,
        athletesSucceededCount,
        athletesPartialCount,
        permissionDeniedCount,
        athletesFailedCount,
        unmappedSkippedCount,
        totalActivitiesProcessed,
        totalActivitiesRemoved,
        totalDuplicatesSkipped,
        totalStreamsImported,
        totalWellnessProcessed,
      },
    }).catch(() => undefined);

    return {
      ok: finalStatus !== 'Failed',
      statusCode: finalStatus === 'Failed' ? 502 : 200,
      blockedByPilotGate: false,
      status: finalStatus,
      syncLogId,
      jobType,
      syncModeRequested: modeRequested,
      verifiedPilotAthleteId,
      externalCoachId,
      totalAthletesInRoster: sharedRoster.length,
      athletesAttempted: athleteResults.length,
      athletesSucceededCount,
      athletesPartialCount,
      permissionDeniedCount,
      athletesFailedCount,
      unmappedSkippedCount,
      totalActivitiesFetched,
      totalActivitiesProcessed,
      totalActivitiesRemoved,
      totalDuplicatesSkipped,
      totalStreamsImported,
      totalStreamsMissing,
      totalStreamsUnavailable,
      totalWellnessProcessed,
      dailyLoadPointsWritten,
      athleteResults,
      warnings,
      errorMessage: summaryNote,
      synchronizedAt: finishedAt,
    };
  } catch (err) {
    const errMsg = redactSensitiveText(
      err instanceof Error ? err.message : 'Unexpected full roster synchronization error.'
    );
    const finishedAt = new Date().toISOString();
    await finalizeSyncLog({
      client,
      coachId: options.coachId,
      syncLogId,
      status: 'Failed',
      recordsProcessed: 0,
      duplicatesSkipped: 0,
      errorMessage: errMsg,
      finishedAt,
    }).catch(() => undefined);

    return {
      ...emptySummary(
        503,
        'Failed',
        false,
        errMsg,
        syncLogId,
        verifiedPilotAthleteId,
        externalCoachId
      ),
      synchronizedAt: finishedAt,
    };
  } finally {
    if (isBatchJob) {
      activeRosterJobsByCoach.delete(options.coachId);
    }
  }
}

export async function getProductionPilotDashboardData(options: {
  coachId: string;
  requestedAthleteId?: string | null;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
}): Promise<ProductionPilotDashboardData> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();

  const conn = await oauthStore.getProviderConnection(options.coachId, 'intervals_icu').catch(() => null);
  const connectionSummary = conn
    ? {
        connected: conn.connected,
        authMode: conn.authMode,
        pilotTestSucceeded: conn.pilotTestSucceeded,
        verifiedPilotAthleteId: conn.verifiedPilotAthleteId,
        externalCoachId: conn.externalCoachId,
        externalCoachName: conn.externalCoachName,
        lastVerifiedAt: conn.lastVerifiedAt,
        lastSynchronizedAt: conn.lastSynchronizedAt,
      }
    : null;

  if (!client) {
    return {
      configured: false,
      hasPersistedPilot: false,
      connection: connectionSummary,
      availableAthletes: [],
      athlete: null,
      activities: [],
      wellnessRecords: [],
      dailyLoadHistories: [],
      syncLogs: [],
    };
  }

  // Load recent sync logs & all coach-owned athletes/mappings for roster overview & switching
  const [
    { data: syncLogRows },
    { data: allMappingRows },
    { data: allAthleteRows },
    { data: allActRows },
    { data: allStreamRows },
    { data: allWellRows },
    { data: auditRows },
  ] = await Promise.all([
    client
      .from('synchronization_logs')
      .select(
        'id, job_type, provider, status, attempt_number, records_processed, duplicates_skipped, error_message, started_at, finished_at'
      )
      .eq('coach_id', options.coachId)
      .eq('provider', 'intervals_icu')
      .order('started_at', { ascending: false })
      .limit(20),
    client
      .from('provider_athlete_mappings')
      .select('athlete_id, external_athlete_id, authorization_status, match_status')
      .eq('coach_id', options.coachId)
      .eq('provider', 'intervals_icu'),
    client.from('athletes').select('*').eq('coach_id', options.coachId).order('full_name', {
      ascending: true,
    }),
    fetchAllPagedRows(() =>
      client
        .from('completed_activities')
        .select('athlete_id')
        .eq('coach_id', options.coachId)
        .eq('provider', 'intervals_icu')
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('heart_rate_streams')
        .select('athlete_id')
        .eq('coach_id', options.coachId)
        .order('activity_id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('wellness_records')
        .select('athlete_id')
        .eq('coach_id', options.coachId)
        .eq('source', 'intervals_icu_wellness')
        .order('id', { ascending: true })
    ),
    client
      .from('audit_events')
      .select('action, target_id, metadata, created_at')
      .eq('coach_id', options.coachId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const syncLogs = Array.isArray(syncLogRows)
    ? (syncLogRows as Array<Record<string, unknown>>).map((l) => ({
        id: String(l.id),
        jobType: String(l.job_type),
        provider: String(l.provider),
        status: String(l.status),
        attemptNumber: Number(l.attempt_number ?? 1),
        recordsProcessed: Number(l.records_processed ?? 0),
        duplicatesSkipped: Number(l.duplicates_skipped ?? 0),
        errorMessage: typeof l.error_message === 'string' ? l.error_message : null,
        startedAt: String(l.started_at),
        finishedAt: typeof l.finished_at === 'string' ? l.finished_at : null,
      }))
    : [];

  const mappingsList = Array.isArray(allMappingRows)
    ? (allMappingRows as Array<Record<string, unknown>>)
    : [];
  const athletesList = Array.isArray(allAthleteRows)
    ? (allAthleteRows as Array<Record<string, unknown>>)
    : [];

  const actCountByAth = new Map<string, number>();
  for (const r of (allActRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      actCountByAth.set(k, (actCountByAth.get(k) ?? 0) + 1);
    }
  }
  const streamCountByAth = new Map<string, number>();
  for (const r of (allStreamRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      streamCountByAth.set(k, (streamCountByAth.get(k) ?? 0) + 1);
    }
  }
  const wellCountByAth = new Map<string, number>();
  for (const r of (allWellRows ?? []) as Array<{ athlete_id?: string }>) {
    if (r.athlete_id) {
      const k = String(r.athlete_id);
      wellCountByAth.set(k, (wellCountByAth.get(k) ?? 0) + 1);
    }
  }

  const lastSuccessByExt = new Map<string, string>();
  const lastAttemptByExt = new Map<string, string>();
  const latestOutcomeByExt = new Map<string, { status: string; errorMessage: string | null }>();
  let lastFullRosterSyncAt: string | null = null;
  for (const ev of (auditRows ?? []) as Array<Record<string, unknown>>) {
    const action = String(ev.action ?? '');
    if (
      !lastFullRosterSyncAt &&
      (action === 'ROSTER_SYNC_COMPLETED' || action === 'ROSTER_SYNC_PARTIAL')
    ) {
      lastFullRosterSyncAt = String(ev.created_at);
    }
    if (action !== 'ROSTER_ATHLETE_SYNC' && !action.startsWith('PILOT_SYNC_')) continue;
    const extId = typeof ev.target_id === 'string' ? ev.target_id : null;
    if (!extId) continue;
    const meta = (ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : {}) as Record<
      string,
      unknown
    >;
    const status = String(meta.status ?? (action === 'PILOT_SYNC_COMPLETED' ? 'Succeeded' : 'Partial'));
    const occurredAt = String(ev.created_at);
    const errMsg = typeof meta.errorMessage === 'string' ? meta.errorMessage : null;
    if (!lastAttemptByExt.has(extId)) {
      lastAttemptByExt.set(extId, occurredAt);
      latestOutcomeByExt.set(extId, { status, errorMessage: errMsg });
    }
    if ((status === 'Succeeded' || status === 'Partial') && !lastSuccessByExt.has(extId)) {
      lastSuccessByExt.set(extId, occurredAt);
    }
  }
  if (!lastFullRosterSyncAt) {
    lastFullRosterSyncAt = conn?.lastSynchronizedAt ?? null;
  }

  const mappingByAthleteId = new Map<string, Record<string, unknown>>();
  for (const m of mappingsList) {
    if (m.athlete_id) {
      mappingByAthleteId.set(String(m.athlete_id), m);
    }
  }

  const availableAthletes = athletesList
    .map((a) => {
      const id = String(a.id);
      const map = mappingByAthleteId.get(id);
      const extId =
        typeof map?.external_athlete_id === 'string' ? map.external_athlete_id : null;
      return {
        id,
        fullName: String(a.full_name),
        externalAthleteId: extId,
        authorizationStatus:
          typeof map?.authorization_status === 'string' ? map.authorization_status : null,
        matchStatus: typeof map?.match_status === 'string' ? map.match_status : null,
        isPilotAthlete: Boolean(
          conn?.verifiedPilotAthleteId && extId === conn.verifiedPilotAthleteId
        ),
        dataOrigin: String(a.data_origin ?? 'live'),
      };
    })
    .sort((a, b) => {
      if (a.isPilotAthlete && !b.isPilotAthlete) return -1;
      if (!a.isPilotAthlete && b.isPilotAthlete) return 1;
      return a.fullName.localeCompare(b.fullName);
    });

  const activeLocks = activeAthleteLocksByCoach.get(options.coachId) ?? new Set<string>();
  const rosterOverviewAthletes = availableAthletes.map((a) => {
    const extId = a.externalAthleteId;
    const latest = extId ? latestOutcomeByExt.get(extId) : undefined;
    const isSyncingNow = Boolean(extId && activeLocks.has(extId));
    let currentSyncStatus: RosterDisplayStatus;
    if (isSyncingNow) {
      currentSyncStatus = 'Synchronizing';
    } else if (!extId || a.matchStatus === 'Unmapped' || !a.matchStatus) {
      currentSyncStatus = 'Not mapped';
    } else if (a.matchStatus === 'Candidate Review Required') {
      currentSyncStatus = 'Awaiting coach review';
    } else if (a.authorizationStatus === 'Permission Denied') {
      currentSyncStatus = 'Permission unavailable';
    } else if (latest?.status === 'Succeeded') {
      currentSyncStatus = 'Succeeded';
    } else if (latest?.status === 'Partial') {
      currentSyncStatus = 'Partially succeeded';
    } else if (latest?.status === 'Failed') {
      currentSyncStatus = 'Failed';
    } else if ((actCountByAth.get(a.id) ?? 0) > 0) {
      currentSyncStatus = 'Succeeded';
    } else {
      currentSyncStatus = 'Ready to sync';
    }
    return {
      internalAthleteId: a.id,
      externalAthleteId: extId,
      fullName: a.fullName,
      isPilotAthlete: a.isPilotAthlete,
      mappingStatus: a.matchStatus ?? 'Unmapped',
      authorizationStatus: a.authorizationStatus ?? 'Unlinked',
      currentSyncStatus,
      lastSuccessfulSyncAt: extId ? lastSuccessByExt.get(extId) ?? null : null,
      lastAttemptedSyncAt: extId ? lastAttemptByExt.get(extId) ?? null : null,
      activitiesCount: actCountByAth.get(a.id) ?? 0,
      hrStreamsCount: streamCountByAth.get(a.id) ?? 0,
      wellnessCount: wellCountByAth.get(a.id) ?? 0,
      mostRecentError: latest?.errorMessage ?? null,
    };
  });

  const rosterOverview: NonNullable<ProductionPilotDashboardData['rosterOverview']> = {
    totalSharedAthletes: rosterOverviewAthletes.length,
    mappedAthletes: rosterOverviewAthletes.filter((a) => a.mappingStatus === 'Verified Match').length,
    unmappedAthletes: rosterOverviewAthletes.filter((a) => a.mappingStatus === 'Unmapped').length,
    awaitingReviewCount: rosterOverviewAthletes.filter(
      (a) => a.mappingStatus === 'Candidate Review Required'
    ).length,
    eligibleAthletes: rosterOverviewAthletes.filter(
      (a) => a.mappingStatus === 'Verified Match' && a.authorizationStatus !== 'Permission Denied'
    ).length,
    succeededCount: rosterOverviewAthletes.filter((a) => a.currentSyncStatus === 'Succeeded').length,
    partialCount: rosterOverviewAthletes.filter(
      (a) => a.currentSyncStatus === 'Partially succeeded'
    ).length,
    failedCount: rosterOverviewAthletes.filter((a) => a.currentSyncStatus === 'Failed').length,
    permissionUnavailableCount: rosterOverviewAthletes.filter(
      (a) => a.currentSyncStatus === 'Permission unavailable'
    ).length,
    lastFullRosterSyncAt,
    liveProgress: getActiveRosterProgressForCoach(options.coachId),
    athletes: rosterOverviewAthletes,
  };

  // Resolve target athlete strictly within coach ownership
  const requestedId = options.requestedAthleteId?.trim() || null;
  let athleteRow: Record<string, unknown> | null = null;
  let selectedMapping: Record<string, unknown> | null = null;

  if (requestedId) {
    athleteRow =
      athletesList.find((a) => String(a.id) === requestedId) ??
      (() => {
        const byExt = mappingsList.find(
          (m) => typeof m.external_athlete_id === 'string' && m.external_athlete_id === requestedId
        );
        return byExt?.athlete_id
          ? athletesList.find((a) => String(a.id) === String(byExt.athlete_id)) ?? null
          : null;
      })();
    if (athleteRow) {
      selectedMapping = mappingByAthleteId.get(String(athleteRow.id)) ?? null;
    }
  } else {
    const pilotMap = conn?.verifiedPilotAthleteId
      ? mappingsList.find((m) => m.external_athlete_id === conn.verifiedPilotAthleteId) ?? null
      : mappingsList[0] ?? null;
    if (pilotMap?.athlete_id) {
      selectedMapping = pilotMap;
      athleteRow = athletesList.find((a) => String(a.id) === String(pilotMap.athlete_id)) ?? null;
    }
  }

  if (!athleteRow) {
    return {
      configured: true,
      hasPersistedPilot: false,
      connection: connectionSummary,
      availableAthletes,
      rosterOverview,
      athlete: null,
      activities: [],
      wellnessRecords: [],
      dailyLoadHistories: [],
      syncLogs,
    };
  }

  const athleteId = String(athleteRow.id);

  const [
    activitiesRes,
    streamsRes,
    metricsRes,
    stressRes,
    plannedRes,
    wellnessRes,
    dailyLoadRes,
    rawWellnessRes,
  ] = await Promise.all([
    fetchAllPagedRows(() =>
      client
        .from('completed_activities')
        .select('*')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('activity_date', { ascending: false })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('heart_rate_streams')
        .select('activity_id, sample_interval_sec, sample_count, valid_sample_pct')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('activity_id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('provider_training_metrics')
        .select('activity_id, icu_training_load, icu_fitness, icu_fatigue, icu_form')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('independent_stress_metrics')
        .select(
          'activity_id, hr_running_stress, pace_running_stress, power_running_stress, session_rpe_stress'
        )
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('planned_workouts')
        .select(
          'id, workout_date, title, workout_type, planned_miles, planned_duration_min, target_pace_sec_per_mile, target_zone, source_provider'
        )
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('workout_date', { ascending: false })
        .order('id', { ascending: true })
    ),
    client
      .from('wellness_records')
      .select('*')
      .eq('coach_id', options.coachId)
      .eq('athlete_id', athleteId)
      .order('record_date', { ascending: false })
      .limit(90),
    client
      .from('daily_load_histories')
      .select('methodology, load_date, daily_stress, ctl, atl, tsb, has_missing_or_invalid_hr')
      .eq('coach_id', options.coachId)
      .eq('athlete_id', athleteId)
      .order('load_date', { ascending: false })
      .limit(540),
    fetchAllPagedRows(() =>
      client
        .from('raw_provider_payloads')
        .select('id, payload')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .eq('entity_type', 'wellness')
        .order('id', { ascending: true })
    ),
  ]);

  const streamsByActId = new Map<
    string,
    { sampleIntervalSec: number; sampleCount: number; validPct: number | null }
  >();
  if (Array.isArray(streamsRes.data)) {
    for (const s of streamsRes.data as Array<Record<string, unknown>>) {
      if (s.activity_id) {
        streamsByActId.set(String(s.activity_id), {
          sampleIntervalSec: Number(s.sample_interval_sec ?? 1),
          sampleCount: Number(s.sample_count ?? 0),
          validPct: typeof s.valid_sample_pct === 'number' ? s.valid_sample_pct : null,
        });
      }
    }
  }

  const metricsByActId = new Map<
    string,
    { load: number | null; fit: number | null; fat: number | null; form: number | null }
  >();
  if (Array.isArray(metricsRes.data)) {
    for (const m of metricsRes.data as Array<Record<string, unknown>>) {
      if (m.activity_id) {
        metricsByActId.set(String(m.activity_id), {
          load: typeof m.icu_training_load === 'number' ? m.icu_training_load : null,
          fit: typeof m.icu_fitness === 'number' ? m.icu_fitness : null,
          fat: typeof m.icu_fatigue === 'number' ? m.icu_fatigue : null,
          form: typeof m.icu_form === 'number' ? m.icu_form : null,
        });
      }
    }
  }

  const stressByActId = new Map<
    string,
    { hr: number | null; pace: number | null; power: number | null; rpe: number | null }
  >();
  if (Array.isArray(stressRes.data)) {
    for (const s of stressRes.data as Array<Record<string, unknown>>) {
      if (s.activity_id) {
        stressByActId.set(String(s.activity_id), {
          hr: finiteOrNull(s.hr_running_stress),
          pace: finiteOrNull(s.pace_running_stress),
          power: finiteOrNull(s.power_running_stress),
          rpe: finiteOrNull(s.session_rpe_stress),
        });
      }
    }
  }

  const rawWellnessById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(rawWellnessRes.data)) {
    for (const r of rawWellnessRes.data as Array<{ id?: string; payload?: unknown }>) {
      if (r.id && r.payload && typeof r.payload === 'object') {
        rawWellnessById.set(String(r.id), r.payload as Record<string, unknown>);
      }
    }
  }

  const activities = Array.isArray(activitiesRes.data)
    ? (activitiesRes.data as Array<Record<string, unknown>>).map((a) => {
        const actId = String(a.id);
        const streamMeta = streamsByActId.get(actId);
        const metricMeta = metricsByActId.get(actId);
        const stressMeta = stressByActId.get(actId);
        const flags = Array.isArray(a.hr_validation_flags)
          ? a.hr_validation_flags.filter((f): f is string => typeof f === 'string')
          : [];
        let streamStatus: StreamAvailabilityState = 'missing';
        if (streamMeta) {
          streamStatus = 'imported';
        } else if (flags.includes('stream_status:unavailable')) {
          streamStatus = 'unavailable';
        } else if (flags.includes('stream_status:not_applicable')) {
          streamStatus = 'not_applicable';
        }
        return {
          id: actId,
          externalActivityId: String(a.external_activity_id),
          provider: String(a.provider),
          sourceDevice: typeof a.source_device === 'string' ? a.source_device : null,
          activityDate: String(a.activity_date).slice(0, 10),
          startTimeLocal: typeof a.start_time_local === 'string' ? a.start_time_local : null,
          title: String(a.title),
          activityType: String(a.activity_type),
          status: String(a.status),
          durationMinutes: Number(a.duration_minutes ?? 0),
          distanceMiles: Number(a.distance_miles ?? 0),
          avgPaceSecPerMile:
            typeof a.avg_pace_sec_per_mile === 'number' ? a.avg_pace_sec_per_mile : null,
          avgHrBpm: typeof a.avg_hr_bpm === 'number' ? a.avg_hr_bpm : null,
          maxHrBpm: typeof a.max_hr_bpm === 'number' ? a.max_hr_bpm : null,
          avgPowerWatts: typeof a.avg_power_watts === 'number' ? a.avg_power_watts : null,
          elevationGainFt: typeof a.elevation_gain_ft === 'number' ? a.elevation_gain_ft : null,
          rpe: typeof a.rpe === 'number' ? a.rpe : null,
          hrDataState: (a.hr_data_state as 'valid' | 'missing' | 'invalid' | 'rest_zero') ?? 'missing',
          hrValidationFlags: flags,
          streamStatus,
          hrStreamSampleCount: streamMeta?.sampleCount ?? null,
          hrStreamValidPct: streamMeta?.validPct ?? null,
          hrStreamSampleIntervalSec: streamMeta?.sampleIntervalSec ?? null,
          icuTrainingLoad: metricMeta?.load ?? null,
          icuFitness: metricMeta?.fit ?? null,
          icuFatigue: metricMeta?.fat ?? null,
          icuForm: metricMeta?.form ?? null,
          hrRunningStress: stressMeta?.hr ?? null,
          paceRunningStress: stressMeta?.pace ?? null,
          powerRunningStress: stressMeta?.power ?? null,
          sessionRpeStress: stressMeta?.rpe ?? null,
        };
      })
    : [];

  const plannedWorkouts = Array.isArray(plannedRes.data)
    ? (plannedRes.data as Array<Record<string, unknown>>).map((p) => ({
        id: String(p.id),
        workoutDate: String(p.workout_date).slice(0, 10),
        title: String(p.title),
        workoutType: String(p.workout_type),
        plannedMiles: Number(p.planned_miles ?? 0),
        plannedDurationMin: Number(p.planned_duration_min ?? 0),
        targetPaceSecPerMile:
          typeof p.target_pace_sec_per_mile === 'number' ? p.target_pace_sec_per_mile : null,
        targetZone: typeof p.target_zone === 'string' ? p.target_zone : null,
        sourceProvider: typeof p.source_provider === 'string' ? p.source_provider : null,
      }))
    : [];

  const wellnessRecords = Array.isArray(wellnessRes.data)
    ? (wellnessRes.data as Array<Record<string, unknown>>).map((w) => {
        const rawWell =
          typeof w.raw_payload_id === 'string'
            ? rawWellnessById.get(w.raw_payload_id)
            : undefined;
        const ctl = typeof w.icu_ctl === 'number' ? w.icu_ctl : null;
        const atl = typeof w.icu_atl === 'number' ? w.icu_atl : null;
        return {
          id: String(w.id),
          recordDate: String(w.record_date).slice(0, 10),
          source: String(w.source),
          restingHrBpm: typeof w.resting_hr_bpm === 'number' ? w.resting_hr_bpm : null,
          hrvRmssd: typeof w.hrv_rmssd === 'number' ? w.hrv_rmssd : null,
          hrvStatus: typeof w.hrv_status === 'string' ? w.hrv_status : null,
          sleepHours: typeof w.sleep_hours === 'number' ? w.sleep_hours : null,
          icuCtl: ctl,
          icuAtl: atl,
          icuTsb: ctl !== null && atl !== null ? Number((ctl - atl).toFixed(2)) : null,
          weightKg: finiteOrNull(rawWell?.weight ?? rawWell?.icu_weight),
          fatigue: finiteOrNull(rawWell?.fatigue),
          soreness: finiteOrNull(rawWell?.soreness),
          mood: finiteOrNull(rawWell?.mood),
          motivation: finiteOrNull(rawWell?.motivation),
          stress: finiteOrNull(rawWell?.stress),
          sleepScore: finiteOrNull(rawWell?.sleepScore ?? rawWell?.sleepQuality),
          readiness: finiteOrNull(rawWell?.readiness),
          rampRate: finiteOrNull(rawWell?.rampRate),
        };
      })
    : [];

  const latestWeightKg =
    wellnessRecords.find((w) => w.weightKg !== null)?.weightKg ?? null;

  const dailyLoadHistories = Array.isArray(dailyLoadRes.data)
    ? (dailyLoadRes.data as Array<Record<string, unknown>>).map((d) => ({
        methodology: String(d.methodology),
        loadDate: String(d.load_date).slice(0, 10),
        dailyStress: Number(d.daily_stress ?? 0),
        ctl: Number(d.ctl ?? 0),
        atl: Number(d.atl ?? 0),
        tsb: Number(d.tsb ?? 0),
        hasMissingOrInvalidHr: Boolean(d.has_missing_or_invalid_hr),
      }))
    : [];

  const ath = athleteRow;

  return {
    configured: true,
    hasPersistedPilot: true,
    connection: connectionSummary,
    availableAthletes,
    rosterOverview,
    athlete: {
      id: String(ath.id),
      fullName: String(ath.full_name),
      email: typeof ath.email === 'string' ? ath.email : null,
      age: typeof ath.age === 'number' ? ath.age : null,
      gender: typeof ath.gender === 'string' ? ath.gender : null,
      location: typeof ath.location === 'string' ? ath.location : null,
      trainingGroup: String(ath.training_group ?? 'Marathon'),
      currentPhase: String(ath.current_phase ?? 'Build'),
      restingHrBpm: typeof ath.resting_hr_bpm === 'number' ? ath.resting_hr_bpm : null,
      maxHrBpm: typeof ath.max_hr_bpm === 'number' ? ath.max_hr_bpm : null,
      activeLthrBpm: typeof ath.active_lthr_bpm === 'number' ? ath.active_lthr_bpm : null,
      thresholdPaceSecPerMile:
        typeof ath.threshold_pace_sec_per_mile === 'number'
          ? ath.threshold_pace_sec_per_mile
          : null,
      optionalThresholdPowerWatts:
        typeof ath.optional_threshold_power_watts === 'number'
          ? ath.optional_threshold_power_watts
          : null,
      sportSpecialization:
        typeof ath.sport_specialization === 'string' ? ath.sport_specialization : null,
      dataOrigin: String(ath.data_origin ?? 'live'),
      externalAthleteId:
        typeof selectedMapping?.external_athlete_id === 'string'
          ? selectedMapping.external_athlete_id
          : null,
      authorizationStatus:
        typeof selectedMapping?.authorization_status === 'string'
          ? selectedMapping.authorization_status
          : null,
      matchStatus:
        typeof selectedMapping?.match_status === 'string' ? selectedMapping.match_status : null,
      latestWeightKg,
      updatedAt: typeof ath.updated_at === 'string' ? ath.updated_at : null,
    },
    activities,
    plannedWorkouts,
    wellnessRecords,
    dailyLoadHistories,
    syncLogs,
  };
}
