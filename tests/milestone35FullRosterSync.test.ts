import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../server.ts';
import type { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { SupabaseOAuthStore } from '../server/oauthStore.ts';
import { resetPilotGateForTesting } from '../server/intervalsClient.ts';
import {
  getIntervalsRosterOverview,
  getProductionPilotDashboardData,
  resetRosterSyncLocksForTesting,
  resolveIntervalsAthleteMapping,
  synchronizeFullRoster,
} from '../server/pilotIngestion.ts';
import { getCoachingIntelligence } from '../server/coachingIntelligence.ts';

const OWNER_COACH = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'mtschmitt@gmail.com',
  fullName: 'Mythical Mile Coach',
  organizationName: 'Mythical Mile Coaching',
  role: 'owner_coach' as const,
};

const OTHER_COACH = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'othercoach@example.com',
  fullName: 'Other Coach',
  organizationName: 'Other Club',
  role: 'owner_coach' as const,
};

function startTestServer(app: Awaited<ReturnType<typeof createApp>>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
  });
}

function createAuthVerifier(): CoachTokenVerifier {
  return async (token: string) => {
    if (token === 'valid-owner-jwt') return { ok: true, coach: OWNER_COACH };
    if (token === 'other-coach-jwt') return { ok: true, coach: OTHER_COACH };
    return { ok: false, status: 401, error: 'Invalid token' };
  };
}

function createStatefulMockSupabaseClient() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    provider_connections: [],
    provider_connection_credentials: [],
    athletes: [],
    provider_athlete_mappings: [],
    raw_provider_payloads: [],
    completed_activities: [],
    heart_rate_streams: [],
    provider_training_metrics: [],
    independent_stress_metrics: [],
    wellness_records: [],
    daily_load_histories: [],
    planned_workouts: [],
    workout_matches: [],
    coaching_alerts: [],
    weekly_reports: [],
    synchronization_logs: [],
    audit_events: [],
  };

  function conflictColsFor(table: string, onConflict?: string): string[] {
    if (onConflict) {
      return onConflict.split(',').map((s) => s.trim());
    }
    if (table === 'provider_connections' || table === 'provider_connection_credentials') {
      return ['coach_id', 'provider'];
    }
    if (table === 'provider_athlete_mappings') return ['athlete_id', 'provider'];
    if (table === 'completed_activities') {
      return ['athlete_id', 'provider', 'external_activity_id'];
    }
    if (table === 'heart_rate_streams') return ['activity_id'];
    if (table === 'provider_training_metrics') return ['activity_id', 'provider', 'metric_date'];
    if (table === 'independent_stress_metrics') {
      return ['activity_id', 'methodology', 'threshold_version_used'];
    }
    if (table === 'wellness_records') return ['athlete_id', 'source', 'record_date'];
    if (table === 'daily_load_histories') return ['athlete_id', 'methodology', 'load_date'];
    if (table === 'weekly_reports') return ['athlete_id', 'week_start_date'];
    if (table === 'coaching_alerts') return ['athlete_id', 'alert_type', 'created_at'];
    return ['id'];
  }

  function upsertRow(
    table: string,
    payload: Record<string, unknown>,
    onConflict?: string,
    forceInsert = false
  ): { row: Record<string, unknown> | null; error: { message: string; code?: string } | null } {
    const list = tables[table];
    if (!list) {
      return { row: null, error: { message: `Unknown table ${table}` } };
    }
    const cols = conflictColsFor(table, onConflict);
    const existingIdx = forceInsert
      ? -1
      : list.findIndex((r) => cols.every((c) => r[c] === payload[c]));
    const now = new Date().toISOString();
    const existing = existingIdx >= 0 ? list[existingIdx] : undefined;

    if (table === 'raw_provider_payloads') {
      const dup = list.find(
        (r) =>
          r.coach_id === payload.coach_id &&
          r.provider === payload.provider &&
          r.entity_type === payload.entity_type &&
          r.external_id === payload.external_id &&
          r.payload_sha256 === payload.payload_sha256
      );
      if (dup) {
        return { row: null, error: { message: 'duplicate raw payload', code: '23505' } };
      }
    }

    const merged: Record<string, unknown> = {
      id: existing?.id ?? `${table.slice(0, 4)}-${crypto.randomUUID()}`,
      created_at: existing?.created_at ?? now,
      ...existing,
      ...payload,
      updated_at: now,
    };

    if (existingIdx >= 0) {
      list[existingIdx] = merged;
    } else {
      list.push(merged);
    }
    return { row: { ...merged }, error: null };
  }

  type QueryFilter = {
    col: string;
    val: unknown;
    mode: 'eq' | 'ilike' | 'in' | 'gte' | 'lte';
  };

  const client = {
    from: (table: string) => {
      if (!tables[table]) {
        throw new Error(`Unexpected table access in test mock: ${table}`);
      }

      const executeQuery = (
        filters: QueryFilter[],
        orderBy: { col: string; ascending: boolean } | null,
        limitCount: number | null
      ) => {
        let rows = tables[table].filter((r) =>
          filters.every((f) => {
            if (f.mode === 'ilike') {
              return String(r[f.col] ?? '').toLowerCase() === String(f.val ?? '').toLowerCase();
            }
            if (f.mode === 'in' && Array.isArray(f.val)) {
              return f.val.includes(r[f.col]);
            }
            if (f.mode === 'gte') {
              return String(r[f.col] ?? '') >= String(f.val ?? '');
            }
            if (f.mode === 'lte') {
              return String(r[f.col] ?? '') <= String(f.val ?? '');
            }
            return r[f.col] === f.val;
          })
        );
        if (orderBy) {
          rows = [...rows].sort((a, b) => {
            const va = String(a[orderBy.col] ?? '');
            const vb = String(b[orderBy.col] ?? '');
            return orderBy.ascending ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
        if (limitCount !== null) {
          rows = rows.slice(0, limitCount);
        }
        return rows.map((r) => structuredClone(r));
      };

      return {
        select: (_cols?: string) => {
          const filters: QueryFilter[] = [];
          let orderBy: { col: string; ascending: boolean } | null = null;
          let limitCount: number | null = null;

          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val, mode: 'eq' });
              return chain;
            },
            ilike: (col: string, val: unknown) => {
              filters.push({ col, val, mode: 'ilike' });
              return chain;
            },
            in: (col: string, val: unknown[]) => {
              filters.push({ col, val, mode: 'in' });
              return chain;
            },
            gte: (col: string, val: unknown) => {
              filters.push({ col, val, mode: 'gte' });
              return chain;
            },
            lte: (col: string, val: unknown) => {
              filters.push({ col, val, mode: 'lte' });
              return chain;
            },
            order: (col: string, opts?: { ascending?: boolean }) => {
              orderBy = { col, ascending: opts?.ascending ?? true };
              return chain;
            },
            limit: (n: number) => {
              limitCount = n;
              return chain;
            },
            maybeSingle: async () => {
              const rows = executeQuery(filters, orderBy, 1);
              return { data: rows[0] ?? null, error: null };
            },
            single: async () => {
              const rows = executeQuery(filters, orderBy, 1);
              return {
                data: rows[0] ?? null,
                error: rows[0] ? null : { message: 'Row not found' },
              };
            },
            then: (
              onFulfilled: (value: { data: Record<string, unknown>[]; error: null }) => unknown
            ) => {
              const rows = executeQuery(filters, orderBy, limitCount);
              return Promise.resolve(onFulfilled({ data: rows, error: null }));
            },
          };
          return chain;
        },

        insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted: Array<Record<string, unknown>> = [];
          let lastError: { message: string; code?: string } | null = null;
          for (const item of items) {
            const res = upsertRow(table, item, undefined, true);
            if (res.error) {
              lastError = res.error;
              break;
            }
            if (res.row) inserted.push(res.row);
          }
          const resultObj = {
            data: lastError ? null : Array.isArray(payload) ? inserted : inserted[0],
            error: lastError,
          };
          return {
            select: (_cols?: string) => ({
              single: async () => ({
                data: lastError ? null : inserted[0] ?? null,
                error: lastError,
              }),
              then: (onFulfilled: (v: typeof resultObj) => unknown) =>
                Promise.resolve(onFulfilled(resultObj)),
            }),
            then: (onFulfilled: (v: typeof resultObj) => unknown) =>
              Promise.resolve(onFulfilled(resultObj)),
          };
        },

        upsert: (
          payload: Record<string, unknown> | Array<Record<string, unknown>>,
          opts?: { onConflict?: string }
        ) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const upserted: Array<Record<string, unknown>> = [];
          let lastError: { message: string; code?: string } | null = null;
          for (const item of items) {
            const res = upsertRow(table, item, opts?.onConflict);
            if (res.error) {
              lastError = res.error;
              break;
            }
            if (res.row) upserted.push(res.row);
          }
          const resultObj = {
            data: lastError ? null : Array.isArray(payload) ? upserted : upserted[0],
            error: lastError,
          };
          return {
            select: (_cols?: string) => ({
              single: async () => ({
                data: lastError ? null : upserted[0] ?? null,
                error: lastError,
              }),
              then: (onFulfilled: (v: typeof resultObj) => unknown) =>
                Promise.resolve(onFulfilled(resultObj)),
            }),
            then: (onFulfilled: (v: typeof resultObj) => unknown) =>
              Promise.resolve(onFulfilled(resultObj)),
          };
        },

        update: (patch: Record<string, unknown>) => {
          const filters: Array<{ col: string; val: unknown }> = [];
          const applyUpdate = () => {
            const matched: Array<Record<string, unknown>> = [];
            for (let i = 0; i < tables[table].length; i++) {
              const row = tables[table][i];
              if (filters.every((f) => row[f.col] === f.val)) {
                const updated = { ...row, ...patch, updated_at: new Date().toISOString() };
                tables[table][i] = updated;
                matched.push(structuredClone(updated));
              }
            }
            return { data: matched, error: null };
          };

          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val });
              return chain;
            },
            select: (_cols?: string) => ({
              single: async () => {
                const res = applyUpdate();
                return {
                  data: res.data?.[0] ?? null,
                  error: res.error ?? (!res.data?.[0] ? { message: 'Not found' } : null),
                };
              },
              then: (onFulfilled: (v: ReturnType<typeof applyUpdate>) => unknown) =>
                Promise.resolve(onFulfilled(applyUpdate())),
            }),
            then: (onFulfilled: (v: ReturnType<typeof applyUpdate>) => unknown) =>
              Promise.resolve(onFulfilled(applyUpdate())),
          };
          return chain;
        },

        delete: () => {
          const filters: Array<{ col: string; val: unknown }> = [];
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val });
              return chain;
            },
            then: (onFulfilled: (value: { error: null }) => unknown) => {
              tables[table] = tables[table].filter(
                (r) => !filters.every((f) => r[f.col] === f.val)
              );
              return Promise.resolve(onFulfilled({ error: null }));
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, tables };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function seedVerifiedPilotGate(store: SupabaseOAuthStore, coachId = OWNER_COACH.id) {
  await store.upsertProviderConnection({
    coachId,
    provider: 'intervals_icu',
    authMode: 'api_key',
    connected: true,
    readOnlyMode: true,
    pilotTestSucceeded: true,
    verifiedPilotAthleteId: 'iPilot1',
    externalCoachId: 'iCoachSelf',
    externalCoachName: 'Coach Test',
    grantedScopes: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ'],
    lastVerifiedAt: '2026-11-18T10:00:00.000Z',
    lastSynchronizedAt: null,
  });
}

test('Milestone 3.5: Full roster sync is strictly blocked when pilot gate has not passed', async () => {
  resetPilotGateForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client, tables } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);

  const result = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore: store,
    fetcher: async () => jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 409);
  assert.equal(result.blockedByPilotGate, true);
  assert.equal(result.status, 'Blocked (Unauthorized)');
  assert.equal(tables.athletes.length, 0);
  assert.equal(tables.synchronization_logs[0]?.status, 'Blocked (Unauthorized)');
  assert.ok(tables.audit_events.some((e) => e.action === 'ROSTER_SYNC_BLOCKED'));
});

test('Milestone 3.5: Full roster sync excludes coach self ID and rejects explicit self-only requests', async () => {
  resetPilotGateForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotGate(store);

  const selfOnlyRes = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    athleteIds: ['0', 'iCoachSelf'],
    supabaseClient: client,
    oauthStore: store,
    fetcher: async () => jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' }),
  });

  assert.equal(selfOnlyRes.ok, false);
  assert.equal(selfOnlyRes.statusCode, 403);
  assert.equal(selfOnlyRes.blockedByPilotGate, true);
});

test('Milestone 3.5: Syncs explicitly mapped and email-matched athletes without duplicates, skips unmapped/candidate-review athletes, and isolates permission/fetch failures', async () => {
  resetPilotGateForTesting();
  resetRosterSyncLocksForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client, tables } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotGate(store);

  const streamRequestUrls: string[] = [];

  // Pre-seed one unlinked athlete matching Maya Lin by exact email -> safe email match
  tables.athletes.push({
    id: 'ath-maya-existing',
    coach_id: OWNER_COACH.id,
    full_name: 'Maya Lin',
    email: 'maya@example.com',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: 174,
    active_threshold_version: 1,
    data_origin: 'live',
  });

  // Pre-seed another athlete sharing ONLY a name with iAthNameOnly (no email) -> must require coach review, NEVER auto-merge
  tables.athletes.push({
    id: 'ath-sam-existing',
    coach_id: OWNER_COACH.id,
    full_name: 'Sam Rivera',
    email: 'sam.different@example.com',
    training_group: 'Half Marathon',
    current_phase: 'Base',
    active_lthr_bpm: 168,
    active_threshold_version: 1,
    data_origin: 'live',
  });

  const mockFetcher: typeof fetch = async (urlInput): Promise<Response> => {
    const url = typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url;
    if (url.endsWith('/athlete/0')) {
      return jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' });
    }
    if (url.includes('/athlete/0/athlete-summary.json')) {
      return jsonResponse([
        { athlete_id: 'iCoachSelf', athlete_name: 'Coach Self (Exclude)' },
        { athlete_id: 'iPilot1', athlete_name: 'Pbutterworth', email: 'pilot@example.com' },
        { athlete_id: 'iAth2', athlete_name: 'Maya Lin', email: 'maya@example.com' },
        { athlete_id: 'iAthNameOnly', athlete_name: 'Sam Rivera' },
        { athlete_id: 'iAthUnmapped', athlete_name: 'Brand New Unlinked' },
        { athlete_id: 'iAthDenied', athlete_name: 'Blocked Athlete' },
        { athlete_id: 'iAthError', athlete_name: 'Errored Athlete' },
      ]);
    }
    if (url.endsWith('/athletes')) {
      return jsonResponse([
        { id: 'iAth2', name: 'Maya Lin', email: 'maya@example.com' },
        { id: '0', name: 'Coach Alias Zero' },
      ]);
    }

    if (url.endsWith('/athlete/iAthDenied')) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    if (url.endsWith('/athlete/iAthError')) {
      return jsonResponse({ error: 'Upstream server failure' }, 500);
    }

    if (url.endsWith('/athlete/iPilot1')) {
      return jsonResponse({
        id: 'iPilot1',
        name: 'Pbutterworth',
        email: 'pilot@example.com',
        sportSettings: [{ types: ['Run'], lthr: 168, max_hr: 192, threshold_pace: 3.9 }],
      });
    }
    if (url.endsWith('/athlete/iAth2')) {
      return jsonResponse({
        id: 'iAth2',
        name: 'Maya Lin',
        email: 'maya@example.com',
        sportSettings: [{ types: ['Run'], lthr: 174, max_hr: 196, threshold_pace: 4.1 }],
      });
    }

    if (url.includes('/athlete/iPilot1/activities')) {
      return jsonResponse([
        {
          id: 'act-p1',
          start_date_local: '2026-11-16T07:00:00',
          name: 'Pilot Steady Run',
          type: 'Run',
          moving_time: 2700,
          distance: 8046.7,
          average_heartrate: 152,
          max_heartrate: 166,
          icu_training_load: 64,
        },
      ]);
    }
    if (url.includes('/athlete/iAth2/activities')) {
      return jsonResponse([
        {
          id: 'act-m1',
          start_date_local: '2026-11-17T06:30:00',
          name: 'Maya Tempo 8mi',
          type: 'Run',
          moving_time: 3120,
          distance: 12874.7,
          average_heartrate: 171,
          max_heartrate: 184,
          icu_training_load: 88,
        },
      ]);
    }

    if (url.includes('/athlete/iPilot1/wellness')) {
      return jsonResponse([
        { id: '2026-11-16', restingHR: 48, hrv: 65, sleepSecs: 27000, ctl: 54.2, atl: 61.1 },
      ]);
    }
    if (url.includes('/athlete/iAth2/wellness')) {
      return jsonResponse([
        { id: '2026-11-17', restingHR: 45, hrv: 72, sleepSecs: 28800, ctl: 68.5, atl: 74.0 },
      ]);
    }

    if (url.includes('/streams.json')) {
      streamRequestUrls.push(url);
      return jsonResponse([
        { type: 'time', data: [0, 1, 2, 3] },
        { type: 'heartrate', data: [148, 152, 155, 154] },
      ]);
    }

    return jsonResponse({}, 404);
  };

  // Explicit link/create for iAthDenied & iAthError so they are attempted during sync
  await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'create_and_link',
    externalAthleteId: 'iAthDenied',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });
  await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'create_and_link',
    externalAthleteId: 'iAthError',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });

  // Check roster overview before sync: iAth2 auto-matched by email, iAthNameOnly flagged for coach review, iAthUnmapped is Unmapped
  const overviewBefore = await getIntervalsRosterOverview({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });
  assert.equal(overviewBefore.ok, true);
  assert.equal(overviewBefore.summary.totalSharedAthletes, 6);
  const samRow = overviewBefore.athletes.find((a) => a.externalAthleteId === 'iAthNameOnly');
  const unmappedRow = overviewBefore.athletes.find((a) => a.externalAthleteId === 'iAthUnmapped');
  const mayaRow = overviewBefore.athletes.find((a) => a.externalAthleteId === 'iAth2');
  assert.equal(samRow?.mappingStatus, 'Candidate Review Required');
  assert.equal(unmappedRow?.mappingStatus, 'Unmapped');
  assert.equal(mayaRow?.mappingStatus, 'Verified Match');

  const firstRun = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'auto',
    nowIso: '2026-11-18T12:00:00.000Z',
    initialLookbackDays: 30,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });

  assert.equal(firstRun.ok, true);
  assert.equal(firstRun.statusCode, 200);
  assert.equal(firstRun.status, 'Partial');
  assert.equal(firstRun.totalAthletesInRoster, 6); // coach self excluded!
  assert.equal(firstRun.athletesAttempted, 6);
  assert.equal(firstRun.athletesSucceededCount, 2);
  assert.equal(firstRun.permissionDeniedCount, 1);
  assert.equal(firstRun.athletesFailedCount, 1);
  assert.equal(firstRun.unmappedSkippedCount, 2); // iAthNameOnly + iAthUnmapped skipped safely!
  assert.equal(firstRun.totalActivitiesProcessed, 2);
  assert.equal(firstRun.totalStreamsImported, 2);
  assert.equal(firstRun.totalWellnessProcessed, 2);
  assert.ok(firstRun.dailyLoadPointsWritten >= 2);
  assert.equal(
    firstRun.athleteResults.find((a) => a.externalAthleteId === 'iAthNameOnly')?.status,
    'Awaiting coach review'
  );
  assert.equal(
    firstRun.athleteResults.find((a) => a.externalAthleteId === 'iAthUnmapped')?.status,
    'Not mapped'
  );

  // Verify System B independent_stress_metrics & System C daily_load_histories persisted
  assert.equal(tables.independent_stress_metrics.length, 4);
  assert.equal(
    tables.independent_stress_metrics.filter((m) => m.methodology === 'hr_derived_stress').length,
    2
  );
  assert.ok(tables.independent_stress_metrics.every((m) => m.is_tss_equivalent === false));
  assert.equal(tables.completed_activities.length, 2);
  assert.equal(tables.heart_rate_streams.length, 2);
  assert.equal(tables.wellness_records.length, 2);
  assert.equal(streamRequestUrls.length, 2);

  // Re-run incrementally across all mapped athletes — unchanged activities skip duplicates & preserve streams
  const secondRun = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'auto',
    nowIso: '2026-11-18T14:00:00.000Z',
    initialLookbackDays: 30,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });

  assert.equal(secondRun.ok, true);
  assert.equal(secondRun.totalActivitiesProcessed, 0);
  assert.equal(secondRun.totalDuplicatesSkipped, 2);
  assert.equal(secondRun.totalStreamsImported, 2);
  assert.equal(streamRequestUrls.length, 2);

  // Verify getProductionPilotDashboardData returns rosterOverview and isolates by athleteId & coachId
  const mayaAthlete = tables.athletes.find((a) => a.full_name === 'Maya Lin')!;
  const dashboardDefault = await getProductionPilotDashboardData({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore: store,
  });
  assert.ok(dashboardDefault.rosterOverview);
  assert.equal(dashboardDefault.athlete?.fullName, 'Pbutterworth');

  const dashboardMaya = await getProductionPilotDashboardData({
    coachId: OWNER_COACH.id,
    requestedAthleteId: String(mayaAthlete.id),
    supabaseClient: client,
    oauthStore: store,
  });
  assert.equal(dashboardMaya.hasPersistedPilot, true);
  assert.equal(dashboardMaya.athlete?.fullName, 'Maya Lin');
  assert.equal(dashboardMaya.activities[0]?.title, 'Maya Tempo 8mi');

  // Cross-coach isolation check: OTHER_COACH cannot read OWNER_COACH's athlete
  const dashboardOtherCoach = await getProductionPilotDashboardData({
    coachId: OTHER_COACH.id,
    requestedAthleteId: String(mayaAthlete.id),
    supabaseClient: client,
    oauthStore: store,
  });
  assert.equal(dashboardOtherCoach.hasPersistedPilot, false);
  assert.equal(dashboardOtherCoach.athlete, null);
});

test('Milestone 3.5 HTTP API: roster overview, explicit mapping, full roster sync, and ?athleteId= switch', async () => {
  resetPilotGateForTesting();
  resetRosterSyncLocksForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);

  const mockFetcher: typeof fetch = async (urlInput): Promise<Response> => {
    const url = typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url;
    if (url.endsWith('/athlete/0')) {
      return jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' });
    }
    if (url.includes('/athlete/0/athlete-summary.json')) {
      return jsonResponse([
        { athlete_id: 'iPilot1', athlete_name: 'Pbutterworth' },
        { athlete_id: 'iAth2', athlete_name: 'Jordan Vance' },
      ]);
    }
    if (url.endsWith('/athletes')) {
      return jsonResponse([]);
    }
    if (url.endsWith('/athlete/iPilot1')) {
      return jsonResponse({
        id: 'iPilot1',
        name: 'Pbutterworth',
        sportSettings: [{ types: ['Run'], lthr: 168 }],
      });
    }
    if (url.endsWith('/athlete/iAth2')) {
      return jsonResponse({
        id: 'iAth2',
        name: 'Jordan Vance',
        sportSettings: [{ types: ['Run'], lthr: 171 }],
      });
    }
    if (url.includes('/activities')) {
      const ath = url.includes('iPilot1') ? 'p1' : 'j1';
      return jsonResponse([
        {
          id: `act-${ath}`,
          start_date_local: '2026-11-17T07:00:00',
          name: ath === 'p1' ? 'Pilot Easy' : 'Jordan Long Run',
          type: 'Run',
          moving_time: 3600,
          distance: 11265,
          average_heartrate: 155,
          icu_training_load: 72,
        },
      ]);
    }
    if (url.includes('/wellness')) {
      return jsonResponse([{ id: '2026-11-17', ctl: 55, atl: 59 }]);
    }
    if (url.includes('/streams.json')) {
      return jsonResponse([
        { type: 'time', data: [0, 1] },
        { type: 'heartrate', data: [152, 156] },
      ]);
    }
    return jsonResponse({}, 404);
  };

  const app = await createApp({
    mountFrontend: false,
    authVerifier: createAuthVerifier(),
    oauthStore: store,
    supabaseClient: client,
    intervalsFetcher: mockFetcher,
  });

  const { baseUrl, close } = await startTestServer(app);

  try {
    // 1. Unauthenticated rejected (401)
    assert.equal((await fetch(`${baseUrl}/api/integrations/intervals/roster`)).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/integrations/intervals/roster/mappings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_and_link', externalAthleteId: 'iAth2' }),
        })
      ).status,
      401
    );
    assert.equal(
      (await fetch(`${baseUrl}/api/integrations/intervals/roster-sync`, { method: 'POST' })).status,
      401
    );

    // 2. Unverified pilot gate blocked (409)
    const gatedRes = await fetch(`${baseUrl}/api/integrations/intervals/roster-sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'initial' }),
    });
    assert.equal(gatedRes.status, 409);

    // 3. Verify pilot gate, inspect roster overview, explicitly create & link Jordan Vance, then sync
    await seedVerifiedPilotGate(store);

    const rosterOverviewRes = await fetch(`${baseUrl}/api/integrations/intervals/roster`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(rosterOverviewRes.status, 200);
    const rosterOverview = (await rosterOverviewRes.json()) as {
      ok: boolean;
      athletes: Array<{ externalAthleteId: string; mappingStatus: string }>;
    };
    assert.equal(rosterOverview.ok, true);
    assert.equal(
      rosterOverview.athletes.find((a) => a.externalAthleteId === 'iAth2')?.mappingStatus,
      'Unmapped'
    );

    const mapRes = await fetch(`${baseUrl}/api/integrations/intervals/roster/mappings`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_and_link', externalAthleteId: 'iAth2' }),
    });
    assert.equal(mapRes.status, 200);
    const mapBody = (await mapRes.json()) as { ok: boolean; internalAthleteId: string | null };
    assert.equal(mapBody.ok, true);
    assert.ok(mapBody.internalAthleteId);

    const syncRes = await fetch(`${baseUrl}/api/integrations/intervals/roster-sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'initial' }),
    });
    assert.equal(syncRes.status, 200);
    const syncBody = (await syncRes.json()) as {
      ok: boolean;
      status: string;
      athletesSucceededCount: number;
      athleteResults: Array<{ externalAthleteId: string; internalAthleteId: string | null }>;
    };
    assert.equal(syncBody.ok, true);
    assert.equal(syncBody.status, 'Succeeded');
    assert.equal(syncBody.athletesSucceededCount, 2);

    const jordanInternalId = syncBody.athleteResults.find(
      (a) => a.externalAthleteId === 'iAth2'
    )?.internalAthleteId;
    assert.equal(jordanInternalId, mapBody.internalAthleteId);

    // 4. Switch athlete via GET /api/production/pilot?athleteId=...
    const pilotSwitchRes = await fetch(
      `${baseUrl}/api/production/pilot?athleteId=${encodeURIComponent(jordanInternalId!)}`,
      { headers: { Authorization: 'Bearer valid-owner-jwt' } }
    );
    assert.equal(pilotSwitchRes.status, 200);
    const pilotSwitchBody = (await pilotSwitchRes.json()) as {
      athlete: { fullName: string } | null;
      availableAthletes: Array<{ id: string }>;
      activities: Array<{ title: string }>;
      rosterOverview: { succeededCount: number } | null;
    };
    assert.equal(pilotSwitchBody.availableAthletes.length, 2);
    assert.equal(pilotSwitchBody.athlete?.fullName, 'Jordan Vance');
    assert.equal(pilotSwitchBody.activities[0]?.title, 'Jordan Long Run');
    assert.equal(pilotSwitchBody.rosterOverview?.succeededCount, 2);

    // 5. Cross-coach isolation: OTHER_COACH cannot view OWNER_COACH's athletes
    const otherPilotRes = await fetch(
      `${baseUrl}/api/production/pilot?athleteId=${encodeURIComponent(jordanInternalId!)}`,
      { headers: { Authorization: 'Bearer other-coach-jwt' } }
    );
    assert.equal(otherPilotRes.status, 200);
    const otherPilotBody = (await otherPilotRes.json()) as {
      hasPersistedPilot: boolean;
      athlete: null | Record<string, unknown>;
    };
    assert.equal(otherPilotBody.hasPersistedPilot, false);
    assert.equal(otherPilotBody.athlete, null);
  } finally {
    await close();
  }
});

test('Milestone 3.5: Paginated roster discovery, permission probing, candidate/duplicate mapping safety, and leave_unmapped', async () => {
  resetPilotGateForTesting();
  resetRosterSyncLocksForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client, tables } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotGate(store);

  tables.athletes.push(
    {
      id: 'ath-existing-1',
      coach_id: OWNER_COACH.id,
      full_name: 'Alex Morgan',
      email: 'alex@example.com',
      training_group: '10K',
      current_phase: 'Build',
      active_threshold_version: 1,
      data_origin: 'live',
    },
    {
      id: 'ath-existing-2',
      coach_id: OWNER_COACH.id,
      full_name: 'Casey Twin A',
      email: 'twin@example.com',
      training_group: 'Marathon',
      current_phase: 'Base',
      active_threshold_version: 1,
      data_origin: 'live',
    },
    {
      id: 'ath-existing-3',
      coach_id: OWNER_COACH.id,
      full_name: 'Casey Twin B',
      email: 'twin@example.com',
      training_group: 'Marathon',
      current_phase: 'Base',
      active_threshold_version: 1,
      data_origin: 'live',
    }
  );

  const mockFetcher: typeof fetch = async (urlInput): Promise<Response> => {
    const url = typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url;
    if (url.endsWith('/athlete/0')) {
      return jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' });
    }
    if (url.includes('/athlete/0/athlete-summary.json')) {
      return jsonResponse([{ athlete_id: 'iPilot1', athlete_name: 'Pbutterworth' }]);
    }
    if (url.endsWith('/athletes')) {
      return jsonResponse({
        athletes: [{ id: 'iPage1Ath', name: 'Alex Morgan', email: 'alex.other@example.com' }],
        next: 'https://intervals.icu/api/v1/athletes?page=2',
      });
    }
    if (url.includes('/athletes?page=2')) {
      return jsonResponse({
        athletes: [
          { id: 'iTwinExt', name: 'Casey Twin', email: 'twin@example.com' },
          { id: 'iDeniedExt', name: 'Denied Athlete' },
        ],
      });
    }
    if (url.includes('/athlete/iDeniedExt')) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    if (url.includes('/athlete/')) {
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  };

  const overview = await getIntervalsRosterOverview({
    coachId: OWNER_COACH.id,
    probePermissions: true,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });

  assert.equal(overview.ok, true);
  assert.ok(overview.pagesFetched >= 2);
  assert.equal(overview.athletes.length, 4);

  const deniedRow = overview.athletes.find((a) => a.externalAthleteId === 'iDeniedExt');
  assert.equal(deniedRow?.currentSyncStatus, 'Permission unavailable');

  const alexRow = overview.athletes.find((a) => a.externalAthleteId === 'iPage1Ath');
  assert.equal(alexRow?.mappingStatus, 'Candidate Review Required');

  const twinRow = overview.athletes.find((a) => a.externalAthleteId === 'iTwinExt');
  assert.equal(twinRow?.mappingStatus, 'Candidate Review Required');

  // Coach confirms Alex Morgan candidate
  const confirmRes = await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'confirm_candidate',
    externalAthleteId: 'iPage1Ath',
    athleteId: 'ath-existing-1',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
  });
  assert.equal(confirmRes.ok, true);
  assert.equal(confirmRes.mappingStatus, 'Verified Match');

  // Linking another external ID to already-linked ath-existing-1 fails with 409 conflict
  const dupConflict = await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'link_existing',
    externalAthleteId: 'iTwinExt',
    athleteId: 'ath-existing-1',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
  });
  assert.equal(dupConflict.ok, false);
  assert.equal(dupConflict.statusCode, 409);

  // Leave unmapped removes mapping while preserving athlete record
  const unmapRes = await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'leave_unmapped',
    externalAthleteId: 'iPage1Ath',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
  });
  assert.equal(unmapRes.ok, true);
  assert.equal(unmapRes.mappingStatus, 'Unmapped');
  assert.ok(tables.athletes.some((a) => a.id === 'ath-existing-1'));
});

test('Milestone 3.5: Concurrent lock protection, retryFailedOnly, incremental deletion detection, and coaching intelligence coach-state preservation', async () => {
  resetPilotGateForTesting();
  resetRosterSyncLocksForTesting();
  process.env.INTERVALS_ICU_API_KEY = 'secret_roster_key';
  const { client, tables } = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotGate(store);

  let failAth2 = true;
  let phase: 'initial' | 'afterDelete' = 'initial';
  const slowHold: { release: (() => void) | null } = { release: null };
  let holdPilotFetch = false;

  const mockFetcher: typeof fetch = async (urlInput): Promise<Response> => {
    const url = typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.toString() : urlInput.url;
    if (url.endsWith('/athlete/0')) {
      return jsonResponse({ id: 'iCoachSelf', name: 'Coach Test' });
    }
    if (url.includes('/athlete/0/athlete-summary.json')) {
      return jsonResponse([
        { athlete_id: 'iPilot1', athlete_name: 'Pbutterworth' },
        { athlete_id: 'iAth2', athlete_name: 'Maya Lin' },
      ]);
    }
    if (url.endsWith('/athletes')) {
      return jsonResponse([]);
    }
    if (url.endsWith('/athlete/iPilot1')) {
      if (holdPilotFetch) {
        await new Promise<void>((res) => {
          slowHold.release = res;
        });
      }
      return jsonResponse({
        id: 'iPilot1',
        name: 'Pbutterworth',
        sportSettings: [{ types: ['Run'], lthr: 168, max_hr: 192 }],
      });
    }
    if (url.endsWith('/athlete/iAth2')) {
      if (failAth2) return jsonResponse({ error: 'Temporary 500' }, 500);
      return jsonResponse({
        id: 'iAth2',
        name: 'Maya Lin',
        sportSettings: [{ types: ['Run'], lthr: 172, max_hr: 195 }],
      });
    }
    if (url.includes('/athlete/iPilot1/activities')) {
      const baseList = [
        {
          id: 'act-keep',
          start_date_local: '2026-11-15T07:00:00',
          name: 'Pilot Keep Run',
          type: 'Run',
          moving_time: 2400,
          distance: 8046.7,
          average_heartrate: 152,
          icu_training_load: 60,
        },
      ];
      if (phase === 'initial') {
        baseList.push({
          id: 'act-deleted-upstream',
          start_date_local: '2026-11-16T07:00:00',
          name: 'Deleted Upstream Run',
          type: 'Run',
          moving_time: 1800,
          distance: 4828,
          average_heartrate: 145,
          icu_training_load: 42,
        });
      }
      return jsonResponse(baseList);
    }
    if (url.includes('/athlete/iAth2/activities')) {
      return jsonResponse([
        {
          id: 'act-maya-no-hr',
          start_date_local: '2026-11-16T07:00:00',
          name: 'Watch Dead Run',
          type: 'Run',
          moving_time: 2100,
          distance: 6437.4,
          // Missing HR -> System B must keep NULL stress instead of fabricating 0
        },
      ]);
    }
    if (url.includes('/wellness')) {
      return jsonResponse([{ id: '2026-11-16', ctl: 55, atl: 60 }]);
    }
    if (url.includes('/streams.json')) {
      return jsonResponse([
        { type: 'time', data: [0, 1] },
        { type: 'heartrate', data: [148, 152] },
      ]);
    }
    return jsonResponse({}, 404);
  };

  await resolveIntervalsAthleteMapping({
    coachId: OWNER_COACH.id,
    action: 'create_and_link',
    externalAthleteId: 'iAth2',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });

  // 1. Overlapping batch job lock returns 409
  holdPilotFetch = true;
  const inflightSync = synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'initial',
    nowIso: '2026-11-18T12:00:00.000Z',
    initialLookbackDays: 30,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });
  await new Promise((r) => setTimeout(r, 20));
  const overlapRes = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'auto',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
  });
  assert.equal(overlapRes.ok, false);
  assert.equal(overlapRes.statusCode, 409);

  holdPilotFetch = false;
  slowHold.release?.();
  const initialRes = await inflightSync;
  assert.equal(initialRes.status, 'Partial');
  assert.equal(initialRes.athletesSucceededCount, 1);
  assert.equal(initialRes.athletesFailedCount, 1);
  assert.equal(tables.completed_activities.length, 2);

  // 2. Retry failed athletes only -> skips iPilot1 and retries iAth2 cleanly
  failAth2 = false;
  const retryRes = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'auto',
    retryFailedOnly: true,
    nowIso: '2026-11-18T13:00:00.000Z',
    initialLookbackDays: 30,
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });
  assert.equal(retryRes.ok, true);
  assert.equal(retryRes.jobType, 'retry_sync');
  assert.equal(retryRes.athletesAttempted, 1);
  assert.equal(retryRes.athleteResults[0]?.externalAthleteId, 'iAth2');
  assert.equal(retryRes.athleteResults[0]?.status, 'Succeeded');

  // Verify System B independent stress keeps NULL when HR is missing on act-maya-no-hr
  const mayaStress = tables.independent_stress_metrics.find((s) =>
    tables.completed_activities.some(
      (a) => a.id === s.activity_id && a.external_activity_id === 'act-maya-no-hr'
    )
  );
  assert.ok(mayaStress);
  assert.equal(mayaStress.stress_value, null);
  assert.equal(mayaStress.is_tss_equivalent, false);

  // 3. Seed coach-reviewed weekly report approval, then run incremental sync with upstream deletion
  const pilotAth = tables.athletes.find((a) => a.full_name === 'Pbutterworth')!;
  const intelBefore = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: String(pilotAth.id),
    persist: true,
    supabaseClient: client,
    oauthStore: store,
  });
  assert.ok(intelBefore.weeklyReports.length >= 1);
  const reportId = intelBefore.weeklyReports[0].id;
  await client
    .from('weekly_reports')
    .update({ status: 'Approved', coach_note: 'Coach approved note' })
    .eq('id', reportId)
    .eq('coach_id', OWNER_COACH.id);

  phase = 'afterDelete';
  const afterDelRes = await synchronizeFullRoster({
    coachId: OWNER_COACH.id,
    mode: 'incremental',
    athleteIds: ['iPilot1'],
    nowIso: '2026-11-18T15:00:00.000Z',
    supabaseClient: client,
    oauthStore: store,
    fetcher: mockFetcher,
    retryOptions: { maxAttempts: 1, baseDelayMs: 0 },
  });
  assert.equal(afterDelRes.ok, true);
  assert.equal(afterDelRes.totalActivitiesRemoved, 1);
  assert.ok(!tables.completed_activities.some((a) => a.external_activity_id === 'act-deleted-upstream'));

  await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: String(pilotAth.id),
    persist: true,
    supabaseClient: client,
    oauthStore: store,
  });
  const preservedReport = tables.weekly_reports.find((r) => r.id === reportId);
  assert.equal(preservedReport?.status, 'Approved');
  assert.equal(preservedReport?.coach_note, 'Coach approved note');
});
