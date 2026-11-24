import type { SupabaseClient } from '@supabase/supabase-js';
import { isTokenEncryptionConfigured, redactSensitiveText } from './crypto.ts';
import {
  fetchCompleteIntervalsRoster,
  fetchIntervalsJson,
  isCoachSelfAthleteId,
  resolveAuthHeaderForCoach,
} from './intervalsClient.ts';
import { getOAuthPersistenceStore, type OAuthPersistenceStore } from './oauthStore.ts';
import { getSupabaseAdminClient, isSupabaseServerConfigured } from './supabaseAdmin.ts';
import { getIntervalsRosterOverview } from './pilotIngestion.ts';
import { getCoachingIntelligence } from './coachingIntelligence.ts';

export const ALL_PUBLIC_TABLES = [
  'coaches',
  'provider_connections',
  'provider_connection_credentials',
  'oauth_states',
  'athletes',
  'provider_athlete_mappings',
  'raw_provider_payloads',
  'planned_workouts',
  'completed_activities',
  'heart_rate_streams',
  'athlete_thresholds',
  'heart_rate_zones',
  'threshold_recalculation_logs',
  'provider_training_metrics',
  'independent_stress_metrics',
  'daily_load_histories',
  'wellness_records',
  'workout_matches',
  'coaching_alerts',
  'weekly_reports',
  'synchronization_logs',
  'audit_events',
] as const;

export interface TablePermissionCheck {
  table: string;
  accessible: boolean;
  rowCount: number | null;
  error: string | null;
}

export interface SharedAthleteLiveProbe {
  externalAthleteId: string;
  name: string;
  email: string | null;
  location: string | null;
  permissionHintFromRoster: 'authorized' | 'denied' | 'unknown';
  settingsStatus: number;
  sportSettingsStatus: number | null;
  activitiesStatus: number;
  activitiesCount30d: number;
  wellnessStatus: number;
  wellnessCount30d: number;
  canShareSettings: boolean;
  canShareActivities: boolean;
  canShareWellness: boolean;
  deniedCapabilities: Array<'settings' | 'activities' | 'wellness'>;
  overallPermissionState: 'Authorized (Read-Only)' | 'Partial Permissions' | 'Permission unavailable';
  existingMapping: {
    mappingId: string;
    internalAthleteId: string;
    internalAthleteName: string | null;
    matchStatus: string;
    matchMethod: string;
    authorizationStatus: string;
  } | null;
  proposedMappingClassification:
    | 'Already Mapped (Verified)'
    | 'Already Mapped (Review/Other)'
    | 'Unambiguous Email Match Candidate'
    | 'Candidate Review Required (Name-Only / Ambiguous)'
    | 'Unmapped';
  proposedCandidateAthletes: Array<{
    athleteId: string;
    fullName: string;
    email: string | null;
    reason: string;
  }>;
}

export interface LiveValidationReport {
  generatedAt: string;
  readOnly: true;
  environment: {
    INTERVALS_ICU_API_KEY: boolean;
    SUPABASE_URL: boolean;
    SUPABASE_SERVICE_ROLE_KEY: boolean;
    TOKEN_ENCRYPTION_KEY: boolean;
    VITE_SUPABASE_URL: boolean;
    VITE_SUPABASE_ANON_KEY: boolean;
    OWNER_COACH_EMAIL_SET: boolean;
    ownerCoachEmailConfiguredValue: string | null;
  };
  supabase: {
    configured: boolean;
    connected: boolean;
    tableChecks: TablePermissionCheck[];
    inaccessibleTables: string[];
    authUsers: Array<{
      id: string;
      email: string | null;
      emailConfirmed: boolean;
      matchesOwnerCoachEmail: boolean;
      lastSignInAt: string | null;
    }>;
    coaches: Array<{
      id: string;
      email: string;
      fullName: string;
      organizationName: string;
      role: string;
      isActive: boolean;
    }>;
    intervalsConnection: {
      coachId: string;
      authMode: string;
      connected: boolean;
      pilotTestSucceeded: boolean;
      verifiedPilotAthleteId: string | null;
      externalCoachId: string | null;
      externalCoachName: string | null;
      grantedScopes: string[];
      lastVerifiedAt: string | null;
      lastSynchronizedAt: string | null;
    } | null;
    finalSurgeConnectionSummary: {
      connected: boolean;
      authMode: string;
    } | null;
    existingAthletes: Array<{
      id: string;
      fullName: string;
      email: string | null;
      trainingGroup: string;
      currentPhase: string;
      dataOrigin: string;
      activeLthrBpm: number | null;
      completedActivitiesCount: number;
      hrStreamsCount: number;
      wellnessRecordsCount: number;
      independentStressCount: number;
      providerMetricsCount: number;
      dailyLoadCount: number;
      coachingAlertsCount: number;
      weeklyReportsCount: number;
    }>;
    existingIntervalsMappings: Array<{
      id: string;
      athleteId: string;
      externalAthleteId: string | null;
      matchStatus: string;
      matchMethod: string;
      authorizationStatus: string;
      note: string | null;
      presentInLiveSharedRoster: boolean;
    }>;
    recentSyncLogs: Array<{
      id: string;
      jobType: string;
      provider: string;
      status: string;
      recordsProcessed: number;
      duplicatesSkipped: number;
      errorMessage: string | null;
      startedAt: string;
      finishedAt: string | null;
    }>;
    recentAuditEvents: Array<{
      id: string;
      action: string;
      targetEntity: string;
      targetId: string | null;
      detail: string;
      createdAt: string;
    }>;
  };
  intervalsIcu: {
    authConfigured: boolean;
    authMethod: 'api_key' | 'oauth2' | 'unconfigured';
    coachProbeOk: boolean;
    coachProbeStatus: number;
    externalCoachId: string | null;
    externalCoachName: string | null;
    externalCoachEmail: string | null;
    rawEndpoints: {
      athletesListStatus: number;
      athletesListPagesFetched: number;
      athletesListShape: string;
      athletesListCount: number;
      athletesSummaryStatus: number;
      athletesSummaryShape: string;
      athletesSummaryCount: number;
      athletesSummarySampleKeys: string[];
      athletesListSampleKeys: string[];
    };
    completeRoster: {
      ok: boolean;
      status: number;
      totalSharedAthletes: number;
      excludedCoachIds: string[];
      coachSelfLeakedIntoRoster: boolean;
      pagesFetched: number;
      warnings: string[];
      errorText: string | null;
    };
    sharedAthletes: SharedAthleteLiveProbe[];
    athletesWithDeniedCapabilities: Array<{
      externalAthleteId: string;
      name: string;
      deniedCapabilities: Array<'settings' | 'activities' | 'wellness'>;
      statuses: {
        settings: number;
        activities: number;
        wellness: number;
      };
    }>;
  };
  productionEndpointChecks?: {
    rosterOverviewOk: boolean;
    rosterOverviewAthleteCounts: Array<{
      externalAthleteId: string;
      athleteName: string;
      activitiesImportedCount: number;
      hrStreamsImportedCount: number;
      wellnessRecordsImportedCount: number;
      sharingPermissionStatus: string;
      permissionCapabilities?: {
        settings: string;
        activities: string;
        wellness: string;
      };
    }>;
    pbutterworthIntelligenceCheck: {
      ok: boolean;
      historyDays: number;
      latestSystemCDate: string | null;
      latestCtl: number | null;
      latestAtl: number | null;
      latestTsb: number | null;
      completedRunCountLast12Weeks: number;
    } | null;
    angelaLiveProfileLthrCheck: {
      rawLthr: unknown;
      runSettingLthr: unknown;
      runSettingMaxHr: unknown;
      sportSettingCount: number;
    } | null;
  };
  findings: string[];
}

function describePayloadShape(payload: unknown): {
  shape: string;
  count: number;
  sampleKeys: string[];
} {
  if (Array.isArray(payload)) {
    const first = payload[0];
    const sampleKeys =
      first && typeof first === 'object' ? Object.keys(first as Record<string, unknown>).slice(0, 25) : [];
    return { shape: 'array', count: payload.length, sampleKeys };
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const topKeys = Object.keys(obj);
    const listCandidate = obj.athletes ?? obj.data ?? obj.items ?? obj.results;
    if (Array.isArray(listCandidate)) {
      const first = listCandidate[0];
      const itemKeys =
        first && typeof first === 'object'
          ? Object.keys(first as Record<string, unknown>).slice(0, 20)
          : [];
      return {
        shape: `object(${topKeys.join(',')})`,
        count: listCandidate.length,
        sampleKeys: itemKeys,
      };
    }
    return { shape: `object(${topKeys.join(',')})`, count: 0, sampleKeys: topKeys.slice(0, 25) };
  }
  return { shape: typeof payload, count: 0, sampleKeys: [] };
}

export async function runLiveReadOnlyValidation(options?: {
  coachId?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: typeof fetch;
}): Promise<LiveValidationReport> {
  const generatedAt = new Date().toISOString();
  const todayDate = generatedAt.slice(0, 10);
  const thirtyDaysAgoDt = new Date(`${todayDate}T00:00:00Z`);
  thirtyDaysAgoDt.setUTCDate(thirtyDaysAgoDt.getUTCDate() - 30);
  const thirtyDaysAgo = thirtyDaysAgoDt.toISOString().slice(0, 10);

  const client =
    options?.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options?.oauthStore ?? getOAuthPersistenceStore();
  const fetcher = options?.fetcher ?? fetch;
  const ownerCoachEmailRaw = process.env.OWNER_COACH_EMAIL?.trim() ?? '';
  const ownerCoachEmailNorm = ownerCoachEmailRaw.toLowerCase();

  const environment = {
    INTERVALS_ICU_API_KEY: Boolean(process.env.INTERVALS_ICU_API_KEY?.trim()),
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL?.trim()),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    TOKEN_ENCRYPTION_KEY: isTokenEncryptionConfigured(),
    VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL?.trim()),
    VITE_SUPABASE_ANON_KEY: Boolean(process.env.VITE_SUPABASE_ANON_KEY?.trim()),
    OWNER_COACH_EMAIL_SET: Boolean(ownerCoachEmailRaw),
    ownerCoachEmailConfiguredValue: ownerCoachEmailRaw || null,
  };

  const findings: string[] = [];

  if (!environment.INTERVALS_ICU_API_KEY) {
    findings.push('INTERVALS_ICU_API_KEY is missing in the server runtime environment.');
  }
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    findings.push('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in the server runtime.');
  }
  if (!environment.TOKEN_ENCRYPTION_KEY) {
    findings.push('TOKEN_ENCRYPTION_KEY is missing in the server runtime.');
  }
  if (!environment.VITE_SUPABASE_URL || !environment.VITE_SUPABASE_ANON_KEY) {
    findings.push('VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing for frontend auth.');
  }
  if (!environment.OWNER_COACH_EMAIL_SET) {
    findings.push('OWNER_COACH_EMAIL is not set in the server runtime environment.');
  }

  const tableChecks: TablePermissionCheck[] = [];
  const authUsers: LiveValidationReport['supabase']['authUsers'] = [];
  let coaches: LiveValidationReport['supabase']['coaches'] = [];
  let intervalsConnection: LiveValidationReport['supabase']['intervalsConnection'] = null;
  let finalSurgeConnectionSummary: LiveValidationReport['supabase']['finalSurgeConnectionSummary'] =
    null;
  let existingAthletes: LiveValidationReport['supabase']['existingAthletes'] = [];
  let existingMappingsRaw: Array<Record<string, unknown>> = [];
  let recentSyncLogs: LiveValidationReport['supabase']['recentSyncLogs'] = [];
  let recentAuditEvents: LiveValidationReport['supabase']['recentAuditEvents'] = [];

  let activeCoachId: string | undefined = options?.coachId;

  if (client) {
    for (const table of ALL_PUBLIC_TABLES) {
      try {
        const pkCol =
          table === 'oauth_states'
            ? 'state'
            : table === 'provider_connection_credentials'
            ? 'connection_id'
            : table === 'heart_rate_streams'
            ? 'activity_id'
            : 'id';
        const { count, error } = await client
          .from(table)
          .select(pkCol, { count: 'exact', head: true });
        if (error) {
          tableChecks.push({
            table,
            accessible: false,
            rowCount: null,
            error: redactSensitiveText(error.message),
          });
        } else {
          tableChecks.push({
            table,
            accessible: true,
            rowCount: count ?? 0,
            error: null,
          });
        }
      } catch (err) {
        tableChecks.push({
          table,
          accessible: false,
          rowCount: null,
          error: redactSensitiveText(err instanceof Error ? err.message : 'Query error'),
        });
      }
    }

    try {
      const { data: usersData, error: usersErr } = await client.auth.admin.listUsers({
        page: 1,
        perPage: 50,
      });
      if (!usersErr && Array.isArray(usersData?.users)) {
        for (const u of usersData.users) {
          const em = u.email?.trim().toLowerCase() ?? null;
          authUsers.push({
            id: u.id,
            email: em,
            emailConfirmed: Boolean(u.email_confirmed_at),
            matchesOwnerCoachEmail: Boolean(ownerCoachEmailNorm && em && em === ownerCoachEmailNorm),
            lastSignInAt: u.last_sign_in_at ?? null,
          });
        }
      } else if (usersErr) {
        findings.push(`Supabase auth.admin.listUsers error: ${redactSensitiveText(usersErr.message)}`);
      }
    } catch (err) {
      findings.push(
        `Supabase auth.admin.listUsers exception: ${redactSensitiveText(
          err instanceof Error ? err.message : 'Unknown'
        )}`
      );
    }

    const { data: coachRows } = await client
      .from('coaches')
      .select('id, email, full_name, organization_name, role, is_active')
      .order('created_at', { ascending: true });

    if (Array.isArray(coachRows)) {
      coaches = coachRows.map((c) => ({
        id: String(c.id),
        email: String(c.email),
        fullName: String(c.full_name),
        organizationName: String(c.organization_name),
        role: String(c.role),
        isActive: Boolean(c.is_active),
      }));
      if (!activeCoachId && coaches.length > 0) {
        activeCoachId = coaches[0].id;
      }
    }

    if (activeCoachId) {
      const { data: connRows } = await client
        .from('provider_connections')
        .select(
          'coach_id, provider, auth_mode, connected, pilot_test_succeeded, verified_pilot_athlete_id, external_coach_id, external_coach_name, granted_scopes, last_verified_at, last_synchronized_at'
        )
        .eq('coach_id', activeCoachId);

      for (const c of (connRows ?? []) as Array<Record<string, unknown>>) {
        if (c.provider === 'intervals_icu') {
          intervalsConnection = {
            coachId: String(c.coach_id),
            authMode: String(c.auth_mode ?? 'unconfigured'),
            connected: Boolean(c.connected),
            pilotTestSucceeded: Boolean(c.pilot_test_succeeded),
            verifiedPilotAthleteId:
              typeof c.verified_pilot_athlete_id === 'string' ? c.verified_pilot_athlete_id : null,
            externalCoachId: typeof c.external_coach_id === 'string' ? c.external_coach_id : null,
            externalCoachName:
              typeof c.external_coach_name === 'string' ? c.external_coach_name : null,
            grantedScopes: Array.isArray(c.granted_scopes)
              ? c.granted_scopes.map((s) => String(s))
              : [],
            lastVerifiedAt: typeof c.last_verified_at === 'string' ? c.last_verified_at : null,
            lastSynchronizedAt:
              typeof c.last_synchronized_at === 'string' ? c.last_synchronized_at : null,
          };
        } else if (c.provider === 'final_surge') {
          finalSurgeConnectionSummary = {
            connected: Boolean(c.connected),
            authMode: String(c.auth_mode ?? 'unconfigured'),
          };
        }
      }

      const [
        { data: athRows },
        { data: mapRows },
        { data: logRows },
        { data: auditRows },
      ] = await Promise.all([
        client
          .from('athletes')
          .select('id, full_name, email, training_group, current_phase, data_origin, active_lthr_bpm')
          .eq('coach_id', activeCoachId)
          .order('full_name', { ascending: true }),
        client
          .from('provider_athlete_mappings')
          .select('*')
          .eq('coach_id', activeCoachId)
          .eq('provider', 'intervals_icu'),
        client
          .from('synchronization_logs')
          .select('id, job_type, provider, status, records_processed, duplicates_skipped, error_message, started_at, finished_at')
          .eq('coach_id', activeCoachId)
          .order('started_at', { ascending: false })
          .limit(10),
        client
          .from('audit_events')
          .select('id, action, target_entity, target_id, detail, created_at')
          .eq('coach_id', activeCoachId)
          .order('created_at', { ascending: false })
          .limit(15),
      ]);

      const countForAthleteTable = async (
        table: string,
        athleteId: string,
        pkCol = 'id'
      ): Promise<number> => {
        const { count } = await client
          .from(table)
          .select(pkCol, { count: 'exact', head: true })
          .eq('coach_id', activeCoachId!)
          .eq('athlete_id', athleteId);
        return count ?? 0;
      };

      existingAthletes = await Promise.all(
        ((athRows ?? []) as Array<Record<string, unknown>>).map(async (a) => {
          const id = String(a.id);
          const [
            completedActivitiesCount,
            hrStreamsCount,
            wellnessRecordsCount,
            independentStressCount,
            providerMetricsCount,
            dailyLoadCount,
            coachingAlertsCount,
            weeklyReportsCount,
          ] = await Promise.all([
            countForAthleteTable('completed_activities', id),
            countForAthleteTable('heart_rate_streams', id, 'activity_id'),
            countForAthleteTable('wellness_records', id),
            countForAthleteTable('independent_stress_metrics', id),
            countForAthleteTable('provider_training_metrics', id),
            countForAthleteTable('daily_load_histories', id),
            countForAthleteTable('coaching_alerts', id),
            countForAthleteTable('weekly_reports', id),
          ]);
          return {
            id,
            fullName: String(a.full_name),
            email: typeof a.email === 'string' ? a.email : null,
            trainingGroup: String(a.training_group ?? ''),
            currentPhase: String(a.current_phase ?? ''),
            dataOrigin: String(a.data_origin ?? ''),
            activeLthrBpm: typeof a.active_lthr_bpm === 'number' ? a.active_lthr_bpm : null,
            completedActivitiesCount,
            hrStreamsCount,
            wellnessRecordsCount,
            independentStressCount,
            providerMetricsCount,
            dailyLoadCount,
            coachingAlertsCount,
            weeklyReportsCount,
          };
        })
      );

      existingMappingsRaw = (mapRows ?? []) as Array<Record<string, unknown>>;

      recentSyncLogs = ((logRows ?? []) as Array<Record<string, unknown>>).map((l) => ({
        id: String(l.id),
        jobType: String(l.job_type),
        provider: String(l.provider),
        status: String(l.status),
        recordsProcessed: Number(l.records_processed ?? 0),
        duplicatesSkipped: Number(l.duplicates_skipped ?? 0),
        errorMessage: typeof l.error_message === 'string' ? l.error_message : null,
        startedAt: String(l.started_at),
        finishedAt: typeof l.finished_at === 'string' ? l.finished_at : null,
      }));

      recentAuditEvents = ((auditRows ?? []) as Array<Record<string, unknown>>).map((e) => ({
        id: String(e.id),
        action: String(e.action),
        targetEntity: String(e.target_entity),
        targetId: typeof e.target_id === 'string' ? e.target_id : null,
        detail: String(e.detail),
        createdAt: String(e.created_at),
      }));
    }
  }

  const inaccessibleTables = tableChecks.filter((t) => !t.accessible).map((t) => t.table);
  if (inaccessibleTables.length > 0) {
    findings.push(`Supabase service_role cannot query tables: ${inaccessibleTables.join(', ')}`);
  }

  const authResolved = await resolveAuthHeaderForCoach(activeCoachId, oauthStore);
  let coachProbeOk = false;
  let coachProbeStatus = 0;
  let externalCoachId: string | null = null;
  let externalCoachName: string | null = null;
  let externalCoachEmail: string | null = null;

  let athletesListStatus = 0;
  let athletesListShape = 'not_called';
  let athletesListCount = 0;
  let athletesListSampleKeys: string[] = [];
  let athletesSummaryStatus = 0;
  let athletesSummaryShape = 'not_called';
  let athletesSummaryCount = 0;
  let athletesSummarySampleKeys: string[] = [];

  let completeRosterRes: Awaited<ReturnType<typeof fetchCompleteIntervalsRoster>> | null = null;
  const sharedAthletes: SharedAthleteLiveProbe[] = [];

  if (authResolved) {
    const coachRes = await fetchIntervalsJson('/athlete/0', authResolved.header, fetcher);
    coachProbeStatus = coachRes.status;
    coachProbeOk = coachRes.ok;
    if (coachRes.ok && coachRes.data && typeof coachRes.data === 'object') {
      const cObj = coachRes.data as Record<string, unknown>;
      externalCoachId = cObj.id !== undefined && cObj.id !== null ? String(cObj.id) : null;
      externalCoachName = typeof cObj.name === 'string' ? cObj.name : null;
      externalCoachEmail = typeof cObj.email === 'string' ? cObj.email : null;
    } else {
      findings.push(`Intervals.icu GET /api/v1/athlete/0 failed (${coachRes.status}: ${coachRes.errorText ?? 'error'}).`);
    }

    const startDt = new Date(`${todayDate}T00:00:00Z`);
    startDt.setUTCDate(startDt.getUTCDate() - 90);
    const oldest90 = startDt.toISOString().slice(0, 10);

    const [rawListRes, rawSummaryRes] = await Promise.all([
      fetchIntervalsJson('/athletes', authResolved.header, fetcher),
      fetchIntervalsJson(
        `/athlete/0/athlete-summary.json?start=${oldest90}&end=${todayDate}`,
        authResolved.header,
        fetcher
      ),
    ]);

    athletesListStatus = rawListRes.status;
    if (rawListRes.ok) {
      const d = describePayloadShape(rawListRes.data);
      athletesListShape = d.shape;
      athletesListCount = d.count;
      athletesListSampleKeys = d.sampleKeys;
    } else {
      athletesListShape = `error_${rawListRes.status}`;
    }

    athletesSummaryStatus = rawSummaryRes.status;
    if (rawSummaryRes.ok) {
      const d = describePayloadShape(rawSummaryRes.data);
      athletesSummaryShape = d.shape;
      athletesSummaryCount = d.count;
      athletesSummarySampleKeys = d.sampleKeys;
    } else {
      athletesSummaryShape = `error_${rawSummaryRes.status}`;
    }

    completeRosterRes = await fetchCompleteIntervalsRoster({
      authHeader: authResolved.header,
      externalCoachId: externalCoachId ?? '0',
      todayDate,
      fetcher,
    });

    if (completeRosterRes.ok) {
      const mapByExternalId = new Map<string, Record<string, unknown>>();
      const extIdByAthleteId = new Map<string, string>();
      for (const m of existingMappingsRaw) {
        if (typeof m.external_athlete_id === 'string' && m.external_athlete_id) {
          mapByExternalId.set(m.external_athlete_id, m);
          if (m.athlete_id) {
            extIdByAthleteId.set(String(m.athlete_id), m.external_athlete_id);
          }
        }
      }

      const athleteById = new Map(existingAthletes.map((a) => [a.id, a]));
      const queue = [...completeRosterRes.sharedRoster];
      const probeWorker = async () => {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry) break;
          const encoded = encodeURIComponent(entry.id);
          const [profRes, sportRes, actRes, wellRes] = await Promise.all([
            fetchIntervalsJson(`/athlete/${encoded}`, authResolved.header, fetcher),
            fetchIntervalsJson(`/athlete/${encoded}/sport-settings`, authResolved.header, fetcher),
            fetchIntervalsJson(
              `/athlete/${encoded}/activities?oldest=${thirtyDaysAgo}&newest=${todayDate}`,
              authResolved.header,
              fetcher
            ),
            fetchIntervalsJson(
              `/athlete/${encoded}/wellness?oldest=${thirtyDaysAgo}&newest=${todayDate}`,
              authResolved.header,
              fetcher
            ),
          ]);

          const canShareSettings = profRes.ok;
          const canShareActivities = actRes.ok;
          const canShareWellness = wellRes.ok;
          const deniedCapabilities: Array<'settings' | 'activities' | 'wellness'> = [];
          if (!canShareSettings) deniedCapabilities.push('settings');
          if (!canShareActivities) deniedCapabilities.push('activities');
          if (!canShareWellness) deniedCapabilities.push('wellness');

          const overallPermissionState: SharedAthleteLiveProbe['overallPermissionState'] =
            deniedCapabilities.length === 0
              ? 'Authorized (Read-Only)'
              : deniedCapabilities.length === 3
              ? 'Permission unavailable'
              : 'Partial Permissions';

          const mapRow = mapByExternalId.get(entry.id) ?? null;
          const mappedAth = mapRow?.athlete_id
            ? athleteById.get(String(mapRow.athlete_id)) ?? null
            : null;

          const cleanEmail = entry.email?.trim().toLowerCase() ?? null;
          const cleanName = entry.name.trim().toLowerCase();
          const emailMatches = cleanEmail
            ? existingAthletes.filter((a) => a.email?.trim().toLowerCase() === cleanEmail)
            : [];
          const nameMatches = cleanName
            ? existingAthletes.filter((a) => a.fullName.trim().toLowerCase() === cleanName)
            : [];

          const proposedCandidateAthletes: SharedAthleteLiveProbe['proposedCandidateAthletes'] = [];
          if (!mapRow) {
            for (const a of emailMatches) {
              proposedCandidateAthletes.push({
                athleteId: a.id,
                fullName: a.fullName,
                email: a.email,
                reason: extIdByAthleteId.has(a.id)
                  ? 'Exact email matches an athlete already linked to another Intervals ID'
                  : 'Exact email match',
              });
            }
            for (const a of nameMatches) {
              if (proposedCandidateAthletes.some((c) => c.athleteId === a.id)) continue;
              proposedCandidateAthletes.push({
                athleteId: a.id,
                fullName: a.fullName,
                email: a.email,
                reason: 'Name-only match (blocked from auto-merge — coach confirmation required)',
              });
            }
          }

          let proposedMappingClassification: SharedAthleteLiveProbe['proposedMappingClassification'] =
            'Unmapped';
          if (mapRow) {
            proposedMappingClassification =
              mapRow.match_status === 'Verified Match'
                ? 'Already Mapped (Verified)'
                : 'Already Mapped (Review/Other)';
          } else if (
            emailMatches.length === 1 &&
            !extIdByAthleteId.has(emailMatches[0].id)
          ) {
            proposedMappingClassification = 'Unambiguous Email Match Candidate';
          } else if (proposedCandidateAthletes.length > 0) {
            proposedMappingClassification = 'Candidate Review Required (Name-Only / Ambiguous)';
          }

          sharedAthletes.push({
            externalAthleteId: entry.id,
            name: entry.name,
            email: entry.email,
            location: entry.location,
            permissionHintFromRoster: entry.permissionHint,
            settingsStatus: profRes.status,
            sportSettingsStatus: sportRes.status,
            activitiesStatus: actRes.status,
            activitiesCount30d: Array.isArray(actRes.data) ? actRes.data.length : 0,
            wellnessStatus: wellRes.status,
            wellnessCount30d: Array.isArray(wellRes.data) ? wellRes.data.length : 0,
            canShareSettings,
            canShareActivities,
            canShareWellness,
            deniedCapabilities,
            overallPermissionState,
            existingMapping: mapRow
              ? {
                  mappingId: String(mapRow.id),
                  internalAthleteId: String(mapRow.athlete_id),
                  internalAthleteName: mappedAth?.fullName ?? null,
                  matchStatus: String(mapRow.match_status ?? ''),
                  matchMethod: String(mapRow.match_method ?? ''),
                  authorizationStatus: String(mapRow.authorization_status ?? ''),
                }
              : null,
            proposedMappingClassification,
            proposedCandidateAthletes,
          });
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(3, Math.max(1, completeRosterRes.sharedRoster.length)) },
          () => probeWorker()
        )
      );
      sharedAthletes.sort((a, b) => a.name.localeCompare(b.name));
    }
  } else {
    findings.push('Unable to resolve Intervals.icu authentication header.');
  }

  const liveExtIds = new Set(sharedAthletes.map((a) => a.externalAthleteId));
  const existingIntervalsMappings = existingMappingsRaw.map((m) => {
    const extId = typeof m.external_athlete_id === 'string' ? m.external_athlete_id : null;
    return {
      id: String(m.id),
      athleteId: String(m.athlete_id),
      externalAthleteId: extId,
      matchStatus: String(m.match_status ?? ''),
      matchMethod: String(m.match_method ?? ''),
      authorizationStatus: String(m.authorization_status ?? ''),
      note: typeof m.note === 'string' ? m.note : null,
      presentInLiveSharedRoster: Boolean(extId && liveExtIds.has(extId)),
    };
  });

  const athletesWithDeniedCapabilities = sharedAthletes
    .filter((a) => a.deniedCapabilities.length > 0)
    .map((a) => ({
      externalAthleteId: a.externalAthleteId,
      name: a.name,
      deniedCapabilities: a.deniedCapabilities,
      statuses: {
        settings: a.settingsStatus,
        activities: a.activitiesStatus,
        wellness: a.wellnessStatus,
      },
    }));

  const coachSelfLeakedIntoRoster = Boolean(
    externalCoachId &&
      sharedAthletes.some((a) => isCoachSelfAthleteId(a.externalAthleteId, externalCoachId!))
  );

  if (coachSelfLeakedIntoRoster) {
    findings.push('CRITICAL: Coach own athlete ID leaked into sharedRoster!');
  }

  if (coaches.length === 0) {
    findings.push(
      'public.coaches has 0 rows (owner coach has not yet completed initial authenticated sign-in provisioning or /api/auth/me).'
    );
  }

  if (!intervalsConnection || !intervalsConnection.pilotTestSucceeded) {
    findings.push(
      'provider_connections does not show a persisted pilot_test_succeeded = true row for intervals_icu yet.'
    );
  }

  let productionEndpointChecks: LiveValidationReport['productionEndpointChecks'];
  if (activeCoachId && client && authResolved) {
    try {
      const rosterOverview = await getIntervalsRosterOverview({
        coachId: activeCoachId,
        probePermissions: true,
        supabaseClient: client,
        oauthStore,
        fetcher,
      });
      const pbutterworth = existingAthletes.find((a) => a.fullName === 'Pbutterworth');
      let pbutterworthIntelligenceCheck: NonNullable<
        LiveValidationReport['productionEndpointChecks']
      >['pbutterworthIntelligenceCheck'] = null;
      if (pbutterworth) {
        const intel = await getCoachingIntelligence({
          coachId: activeCoachId,
          athleteId: pbutterworth.id,
          persist: false,
          supabaseClient: client,
          oauthStore,
        });
        if (intel.ok && intel.loadIntelligence) {
          pbutterworthIntelligenceCheck = {
            ok: true,
            historyDays: intel.loadIntelligence.systemC.historyDays,
            latestSystemCDate: intel.loadIntelligence.systemC.latestDate,
            latestCtl: intel.loadIntelligence.systemC.ctl,
            latestAtl: intel.loadIntelligence.systemC.atl,
            latestTsb: intel.loadIntelligence.systemC.tsb,
            completedRunCountLast12Weeks: intel.loadIntelligence.weeklySeries.reduce(
              (s, w) => s + w.completedRunCount,
              0
            ),
          };
        }
      }
      let angelaLiveProfileLthrCheck: NonNullable<
        LiveValidationReport['productionEndpointChecks']
      >['angelaLiveProfileLthrCheck'] = null;
      const angelaProf = await fetchIntervalsJson('/athlete/i779423', authResolved.header, fetcher);
      if (angelaProf.ok && angelaProf.data && typeof angelaProf.data === 'object') {
        const raw = angelaProf.data as Record<string, unknown>;
        const ss = Array.isArray(raw.sportSettings)
          ? (raw.sportSettings as Array<Record<string, unknown>>)
          : [];
        const runS =
          ss.find((s) =>
            Array.isArray(s.types)
              ? s.types.some((t) => typeof t === 'string' && t.toLowerCase().includes('run'))
              : false
          ) ?? ss[0];
        angelaLiveProfileLthrCheck = {
          rawLthr: raw.lthr ?? null,
          runSettingLthr: runS?.lthr ?? null,
          runSettingMaxHr: runS?.max_hr ?? null,
          sportSettingCount: ss.length,
        };
      }
      productionEndpointChecks = {
        rosterOverviewOk: rosterOverview.ok,
        rosterOverviewAthleteCounts: rosterOverview.athletes.map((a) => ({
          externalAthleteId: a.externalAthleteId,
          athleteName: a.athleteName,
          activitiesImportedCount: a.activitiesImportedCount,
          hrStreamsImportedCount: a.hrStreamsImportedCount,
          wellnessRecordsImportedCount: a.wellnessRecordsImportedCount,
          sharingPermissionStatus: a.sharingPermissionStatus,
          permissionCapabilities: a.permissionCapabilities,
        })),
        pbutterworthIntelligenceCheck,
        angelaLiveProfileLthrCheck,
      };
    } catch {
      // Non-fatal in diagnostic
    }
  }

  return {
    generatedAt,
    readOnly: true,
    environment,
    supabase: {
      configured: isSupabaseServerConfigured(),
      connected: tableChecks.some((t) => t.accessible),
      tableChecks,
      inaccessibleTables,
      authUsers,
      coaches,
      intervalsConnection,
      finalSurgeConnectionSummary,
      existingAthletes,
      existingIntervalsMappings,
      recentSyncLogs,
      recentAuditEvents,
    },
    intervalsIcu: {
      authConfigured: Boolean(authResolved),
      authMethod: authResolved?.method ?? 'unconfigured',
      coachProbeOk,
      coachProbeStatus,
      externalCoachId,
      externalCoachName,
      externalCoachEmail,
      rawEndpoints: {
        athletesListStatus,
        athletesListPagesFetched: completeRosterRes?.pagesFetched ?? 0,
        athletesListShape,
        athletesListCount,
        athletesListSampleKeys,
        athletesSummaryStatus,
        athletesSummaryShape,
        athletesSummaryCount,
        athletesSummarySampleKeys,
      },
      completeRoster: {
        ok: Boolean(completeRosterRes?.ok),
        status: completeRosterRes?.status ?? 0,
        totalSharedAthletes: sharedAthletes.length,
        excludedCoachIds: completeRosterRes?.excludedCoachIds ?? [],
        coachSelfLeakedIntoRoster,
        pagesFetched: completeRosterRes?.pagesFetched ?? 0,
        warnings: completeRosterRes?.warnings ?? [],
        errorText: completeRosterRes?.errorText ?? null,
      },
      sharedAthletes,
      athletesWithDeniedCapabilities,
    },
    productionEndpointChecks,
    findings,
  };
}
