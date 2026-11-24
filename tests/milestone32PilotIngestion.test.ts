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
  getProductionPilotDashboardData,
  synchronizePilotAthlete,
} from '../server/pilotIngestion.ts';
import { coachingRepository } from '../src/integrations/supabaseRepository.ts';

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

function createAuthVerifier(coach = OWNER_COACH): CoachTokenVerifier {
  return async (token: string) => {
    if (token === 'valid-owner-jwt') return { ok: true, coach };
    if (token === 'other-coach-jwt') return { ok: true, coach: OTHER_COACH };
    return { ok: false, status: 401, error: 'Invalid token' };
  };
}

function createFullStatefulMockSupabaseClient() {
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
    planned_workouts: [],
    wellness_records: [],
    daily_load_histories: [],
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
    return ['id'];
  }

  function validateRowConstraints(table: string, row: Record<string, unknown>): string | null {
    if (table === 'completed_activities') {
      const avgHr = row.avg_hr_bpm as number | null | undefined;
      const maxHr = row.max_hr_bpm as number | null | undefined;
      const state = row.hr_data_state as string;
      const dur = Number(row.duration_minutes ?? 0);
      const dist = Number(row.distance_miles ?? 0);
      if (avgHr !== null && avgHr !== undefined && (avgHr < 25 || avgHr > 250)) {
        return `avg_hr_bpm out of bounds (${avgHr})`;
      }
      if (maxHr !== null && maxHr !== undefined && (maxHr < 25 || maxHr > 255)) {
        return `max_hr_bpm out of bounds (${maxHr})`;
      }
      if (state === 'valid' && !(typeof avgHr === 'number' && avgHr > 0)) {
        return 'completed_activities_hr_state_consistency_chk failed for valid';
      }
      if (state === 'missing' && avgHr !== null && avgHr !== undefined) {
        return 'completed_activities_hr_state_consistency_chk failed for missing';
      }
      if (
        state === 'rest_zero' &&
        (dur !== 0 || dist !== 0 || (avgHr !== null && avgHr !== undefined))
      ) {
        return 'completed_activities_hr_state_consistency_chk failed for rest_zero';
      }
    }
    if (table === 'heart_rate_streams') {
      const arr = row.hr_bpm_stream as unknown[];
      if (!Array.isArray(arr) || arr.length !== row.sample_count) {
        return 'hr_streams_count_matches_array_chk failed';
      }
    }
    if (table === 'provider_training_metrics') {
      if (row.original_values_preserved !== true) {
        return 'original_values_preserved must be true';
      }
    }
    return null;
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

    const constraintError = validateRowConstraints(table, merged);
    if (constraintError) {
      return { row: null, error: { message: constraintError } };
    }

    if (existingIdx >= 0) {
      list[existingIdx] = merged;
    } else {
      list.push(merged);
    }
    return { row: { ...merged }, error: null };
  }

  const client = {
    from: (table: string) => {
      if (!tables[table]) {
        throw new Error(`Unexpected table access in test mock: ${table}`);
      }

      const executeQuery = (
        eqFilters: Array<{ col: string; val: unknown; mode: 'eq' | 'ilike' }>,
        orderBy: { col: string; ascending: boolean } | null,
        limitCount: number | null
      ) => {
        let rows = tables[table].filter((r) =>
          eqFilters.every((f) => {
            if (f.mode === 'ilike') {
              return String(r[f.col] ?? '').toLowerCase() === String(f.val ?? '').toLowerCase();
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
          const filters: Array<{ col: string; val: unknown; mode: 'eq' | 'ilike' }> = [];
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
            if (res.row) {
              inserted.push(res.row);
            }
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
                const err = validateRowConstraints(table, updated);
                if (err) {
                  return { data: null, error: { message: err } };
                }
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

async function seedVerifiedPilotConnection(
  oauthStore: SupabaseOAuthStore,
  coachId = OWNER_COACH.id,
  pilotAthleteId = 'Pbutterworth',
  externalCoachId = 'i1000'
) {
  await oauthStore.upsertProviderConnection({
    coachId,
    provider: 'intervals_icu',
    authMode: 'api_key',
    connected: true,
    readOnlyMode: true,
    pilotTestSucceeded: true,
    verifiedPilotAthleteId: pilotAthleteId,
    externalCoachId,
    externalCoachName: 'Coach Mike',
    grantedScopes: ['ACTIVITY:READ', 'WELLNESS:READ'],
    lastVerifiedAt: '2026-11-20T10:00:00.000Z',
    lastSynchronizedAt: null,
  });
}

test('Milestone 3.2: persists pilot athlete, maps cleanly without duplicates, preserves omitted fields, and enforces coach ownership isolation', async () => {
  process.env.INTERVALS_ICU_API_KEY = 'test-intervals-secret-key-abc';
  resetPilotGateForTesting();
  const { client, tables } = createFullStatefulMockSupabaseClient();
  const oauthStore = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotConnection(oauthStore, OWNER_COACH.id, 'Pbutterworth', 'i1000');

  let profileRound = 1;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(JSON.stringify({ id: 'i1000', name: 'Coach Mike' }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/Pbutterworth')) {
      if (profileRound === 1) {
        return new Response(
          JSON.stringify({
            id: 'Pbutterworth',
            name: 'Pat Butterworth',
            email: 'pbutterworth@example.com',
            dob: '1992-05-10',
            sex: 'F',
            city: 'Boulder',
            state: 'CO',
            icu_resting_hr: 48,
            created: '2026-08-01T00:00:00Z',
            sportSettings: [
              { types: ['Run'], lthr: 172, max_hr: 192, threshold_pace: 3.85 },
            ],
          }),
          { status: 200 }
        );
      }
      // Second sync omits optional fields (email, location, restingHR, sex, dob)
      return new Response(
        JSON.stringify({
          id: 'Pbutterworth',
          name: 'Pat Butterworth',
          sportSettings: [],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/activities')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/wellness')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  // Initial sync
  const res1 = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore,
    fetcher,
    nowIso: '2026-11-20T12:00:00.000Z',
    initialLookbackDays: 60,
    retryOptions: { baseDelayMs: 0 },
  });

  assert.equal(res1.ok, true);
  assert.equal(res1.status, 'Succeeded');
  assert.equal(tables.athletes.length, 1);
  assert.equal(tables.provider_athlete_mappings.length, 1);
  assert.equal(tables.athletes[0].full_name, 'Pat Butterworth');
  assert.equal(tables.athletes[0].email, 'pbutterworth@example.com');
  assert.equal(tables.athletes[0].location, 'Boulder, CO');
  assert.equal(tables.athletes[0].resting_hr_bpm, 48);
  assert.equal(tables.athletes[0].active_lthr_bpm, 172);
  assert.equal(tables.provider_athlete_mappings[0].external_athlete_id, 'Pbutterworth');

  // Second sync omitting optional fields preserves existing values and creates NO duplicates
  profileRound = 2;
  const res2 = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore,
    fetcher,
    nowIso: '2026-11-20T14:00:00.000Z',
    initialLookbackDays: 60,
    retryOptions: { baseDelayMs: 0 },
  });

  assert.equal(res2.ok, true);
  assert.equal(tables.athletes.length, 1);
  assert.equal(tables.provider_athlete_mappings.length, 1);
  assert.equal(tables.athletes[0].email, 'pbutterworth@example.com');
  assert.equal(tables.athletes[0].location, 'Boulder, CO');
  assert.equal(tables.athletes[0].resting_hr_bpm, 48);
  assert.equal(tables.athletes[0].active_lthr_bpm, 172);

  // Coach ownership isolation: another coach cannot see owner's pilot athlete
  const ownerDash = await getProductionPilotDashboardData({
    coachId: OWNER_COACH.id,
    supabaseClient: client,
    oauthStore,
  });
  const otherDash = await getProductionPilotDashboardData({
    coachId: OTHER_COACH.id,
    supabaseClient: client,
    oauthStore,
  });
  assert.equal(ownerDash.hasPersistedPilot, true);
  assert.equal(ownerDash.athlete?.fullName, 'Pat Butterworth');
  assert.equal(otherDash.hasPersistedPilot, false);
  assert.equal(otherDash.athlete, null);
});

test('Milestone 3.2: ingests chunked activities, preserves NULL for missing values, prevents duplicates, and handles incremental overlap preserving existing streams', async () => {
  process.env.INTERVALS_ICU_API_KEY = 'test-intervals-secret-key-abc';
  resetPilotGateForTesting();
  const { client, tables } = createFullStatefulMockSupabaseClient();
  const oauthStore = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotConnection(oauthStore, OWNER_COACH.id, 'Pbutterworth', 'i1000');

  const activityQueryWindows: string[] = [];
  let streamRequestsForAct1 = 0;
  let syncPhase: 'initial' | 'incremental' = 'initial';

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(JSON.stringify({ id: 'i1000', name: 'Coach Mike' }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/Pbutterworth')) {
      return new Response(
        JSON.stringify({
          id: 'Pbutterworth',
          name: 'Pbutterworth',
          sportSettings: [{ types: ['Run'], lthr: 170, max_hr: 190, threshold_pace: 4.0 }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/activities')) {
      activityQueryWindows.push(url);
      if (syncPhase === 'initial') {
        return new Response(
          JSON.stringify([
            {
              id: 'act-1',
              name: 'Morning Tempo',
              type: 'Run',
              start_date_local: '2026-11-10T07:15:00',
              moving_time: 2400,
              distance: 8046.7,
              total_elevation_gain: 100,
              average_heartrate: 165,
              max_heartrate: 178,
              icu_training_load: 74.5,
              icu_ctl: 52.1,
              icu_atl: 58.3,
              device_name: 'Garmin Forerunner 965',
            },
            {
              id: 'act-2-missing-telemetry',
              name: 'Easy Track Jog',
              type: 'Run',
              start_date_local: '2026-11-12T08:00:00',
              moving_time: 1800,
              distance: 4828.02,
              // intentionally missing elevation, HR, power, RPE, icu_training_load
            },
          ]),
          { status: 200 }
        );
      }
      // Incremental run returns act-1 (with omitted HR/elevation, must NOT overwrite!), existing act-2, plus new act-3
      return new Response(
        JSON.stringify([
          {
            id: 'act-1',
            name: 'Morning Tempo',
            type: 'Run',
            start_date_local: '2026-11-10T07:15:00',
            moving_time: 2400,
            distance: 8046.7,
          },
          {
            id: 'act-2-missing-telemetry',
            name: 'Easy Track Jog',
            type: 'Run',
            start_date_local: '2026-11-12T08:00:00',
            moving_time: 1800,
            distance: 4828.02,
          },
          {
            id: 'act-3-new',
            name: 'Long Progression',
            type: 'Run',
            start_date_local: '2026-11-18T06:30:00',
            moving_time: 5400,
            distance: 19312.08,
            average_heartrate: 158,
            max_heartrate: 174,
            icu_training_load: 112.0,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/streams.json')) {
      if (url.includes('act-1')) {
        streamRequestsForAct1++;
        return new Response(
          JSON.stringify([
            { type: 'time', data: [0, 1, 2, 3, 4] },
            { type: 'heartrate', data: [140, 152, 165, 171, 174] },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('act-2-missing-telemetry')) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      if (url.includes('act-3-new')) {
        return new Response(
          JSON.stringify({
            time: [0, 2, 4, 6],
            heartrate: [135, 148, 156, 162],
          }),
          { status: 200 }
        );
      }
    }
    if (url.includes('/wellness')) {
      return new Response(
        JSON.stringify([
          {
            id: '2026-11-10',
            restingHR: 47,
            hrv: 68.5,
            hrvStatus: 'Balanced',
            sleepSecs: 27000,
            ctl: 52.1,
            atl: 58.3,
            weight: 61.4,
          },
          {
            id: '2026-11-12',
            // missing HRV, sleep, weight, restingHR — must persist as NULL, never 0!
            ctl: 51.8,
            atl: 54.0,
          },
        ]),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  };

  // Run initial multi-chunk historical backfill (400 days across 180-day chunks = 3 chunks)
  const initialRes = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    mode: 'initial',
    nowIso: '2026-11-20T12:00:00.000Z',
    initialLookbackDays: 400,
    chunkDays: 180,
    supabaseClient: client,
    oauthStore,
    fetcher,
    retryOptions: { baseDelayMs: 0 },
  });

  assert.equal(initialRes.ok, true);
  assert.equal(initialRes.syncMode, 'initial');
  assert.equal(initialRes.jobType, 'backfill_12w');
  assert.ok(initialRes.chunksQueried >= 3, 'Expected multi-chunk date pagination');
  assert.equal(initialRes.activitiesProcessed, 2);
  assert.equal(initialRes.streamsImported, 1);
  assert.equal(initialRes.streamsMissing, 1);
  assert.equal(initialRes.wellnessProcessed, 2);
  assert.ok(initialRes.dailyLoadPointsWritten > 0);

  // Verify NULL handling for missing activity & wellness fields (never 0!)
  const missingAct = tables.completed_activities.find(
    (a) => a.external_activity_id === 'act-2-missing-telemetry'
  );
  assert.ok(missingAct);
  assert.equal(missingAct.avg_hr_bpm, null);
  assert.equal(missingAct.max_hr_bpm, null);
  assert.equal(missingAct.elevation_gain_ft, null);
  assert.equal(missingAct.avg_power_watts, null);
  assert.equal(missingAct.rpe, null);
  assert.equal(missingAct.hr_data_state, 'missing');

  const sparseWell = tables.wellness_records.find((w) => w.record_date === '2026-11-12');
  assert.ok(sparseWell);
  assert.equal(sparseWell.resting_hr_bpm, null);
  assert.equal(sparseWell.hrv_rmssd, null);
  assert.equal(sparseWell.sleep_hours, null);

  // Verify System A native load vs System C isolated load
  assert.equal(tables.provider_training_metrics.length, 2);
  const act1Metric = tables.provider_training_metrics.find((m) => m.metric_date === '2026-11-10');
  const act2Metric = tables.provider_training_metrics.find((m) => m.metric_date === '2026-11-12');
  assert.equal(act1Metric?.icu_training_load, 74.5);
  assert.equal(act1Metric?.original_values_preserved, true);
  assert.equal(act2Metric?.icu_training_load, null);
  assert.equal(act2Metric?.icu_fitness, 51.8);
  assert.ok(tables.daily_load_histories.some((d) => d.methodology === 'hr_derived_stress'));

  // Run auto/incremental sync
  activityQueryWindows.length = 0;
  syncPhase = 'incremental';
  const incRes = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    mode: 'auto',
    nowIso: '2026-11-20T18:00:00.000Z',
    overlapDays: 14,
    chunkDays: 180,
    supabaseClient: client,
    oauthStore,
    fetcher,
    retryOptions: { baseDelayMs: 0 },
  });

  assert.equal(incRes.ok, true);
  assert.equal(incRes.syncMode, 'incremental');
  assert.equal(incRes.jobType, 'daily_activity_import');
  assert.equal(incRes.chunksQueried, 1, 'Incremental sync uses bounded overlapping window');
  assert.ok(activityQueryWindows[0].includes('oldest=2026-10-29'));
  assert.equal(streamRequestsForAct1, 1, 'Incremental sync preserves existing HR stream without refetching');
  assert.equal(tables.completed_activities.length, 3, 'Duplicate act-1 was not duplicated');
  assert.equal(tables.heart_rate_streams.length, 2);

  // Confirm act-1 preserved valid HR and elevation when omitted in incremental response
  const preservedAct1 = tables.completed_activities.find((a) => a.external_activity_id === 'act-1');
  assert.equal(preservedAct1?.avg_hr_bpm, 165);
  assert.equal(preservedAct1?.elevation_gain_ft, 328);

  // Re-run identical incremental sync -> duplicates_skipped increments and 0 extra activities added
  const dupRes = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    mode: 'incremental',
    nowIso: '2026-11-20T19:00:00.000Z',
    supabaseClient: client,
    oauthStore,
    fetcher,
    retryOptions: { baseDelayMs: 0 },
  });
  assert.equal(dupRes.activitiesProcessed, 0);
  assert.equal(dupRes.duplicatesSkipped, 3);
});

test('Milestone 3.2: enforces pilot gate, rejects non-pilot IDs, invalidates on coach account mismatch, and never enables full roster sync', async () => {
  process.env.INTERVALS_ICU_API_KEY = 'test-intervals-secret-key-abc';
  resetPilotGateForTesting();
  const { client, tables } = createFullStatefulMockSupabaseClient();
  const oauthStore = new SupabaseOAuthStore(() => client);

  let remoteCoachId = 'i1000';
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(JSON.stringify({ id: remoteCoachId, name: 'Coach' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  const app = await createApp({
    authVerifier: createAuthVerifier(),
    oauthStore,
    supabaseClient: client,
    intervalsFetcher: fetcher,
    databaseChecker: async () => ({ configured: true, connected: true, detail: 'mock' }),
    mountFrontend: false,
  });
  const srv = await startTestServer(app);

  try {
    // 1. Blocked before Milestone 3.1 pilot verification succeeds
    const unverifiedRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(unverifiedRes.status, 409);
    const unverifiedJson = (await unverifiedRes.json()) as {
      blockedByPilotGate: boolean;
      status: string;
    };
    assert.equal(unverifiedJson.blockedByPilotGate, true);
    assert.equal(unverifiedJson.status, 'Blocked (Unauthorized)');

    // 2. Seed verified pilot = Pbutterworth, then attempt sync of non-pilot athlete 'i20491'
    await seedVerifiedPilotConnection(oauthStore, OWNER_COACH.id, 'Pbutterworth', 'i1000');

    const nonPilotRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pilotAthleteId: 'i20491' }),
    });
    assert.equal(nonPilotRes.status, 403);
    const nonPilotJson = (await nonPilotRes.json()) as {
      blockedByPilotGate: boolean;
      status: string;
    };
    assert.equal(nonPilotJson.blockedByPilotGate, true);
    assert.equal(nonPilotJson.status, 'Blocked (Unauthorized)');

    // 3. Full roster sync route passes the pilot gate cleanly (and reports upstream roster response)
    const rosterRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/roster-sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    const rosterJson = (await rosterRes.json()) as { blockedByPilotGate: boolean };
    assert.equal(rosterJson.blockedByPilotGate, false);

    // 4. Live coach account identity mismatch invalidates verification and blocks sync
    remoteCoachId = 'i9999-different-coach';
    const mismatchRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(mismatchRes.status, 409);
    const connAfter = await oauthStore.getProviderConnection(OWNER_COACH.id, 'intervals_icu');
    assert.equal(connAfter?.pilotTestSucceeded, false);
    assert.equal(connAfter?.verifiedPilotAthleteId, null);

    // Sync logs recorded every blocked attempt
    assert.ok(
      tables.synchronization_logs.filter((l) => l.status === 'Blocked (Unauthorized)').length >= 3
    );
  } finally {
    await srv.close();
  }
});

test('Milestone 3.2: retries 429/503 rate limits cleanly and handles partial failures without losing valid data', async () => {
  process.env.INTERVALS_ICU_API_KEY = 'test-intervals-secret-key-abc';
  resetPilotGateForTesting();
  const { client, tables } = createFullStatefulMockSupabaseClient();
  const oauthStore = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotConnection(oauthStore, OWNER_COACH.id, 'Pbutterworth', 'i1000');

  let activityCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(JSON.stringify({ id: 'i1000', name: 'Coach Mike' }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/Pbutterworth')) {
      return new Response(JSON.stringify({ id: 'Pbutterworth', name: 'Pbutterworth' }), {
        status: 200,
      });
    }
    if (url.includes('/activities')) {
      activityCalls++;
      if (activityCalls === 1) {
        return new Response('Rate limited', { status: 429, headers: { 'Retry-After': '0' } });
      }
      if (activityCalls === 2) {
        return new Response('Upstream transient 503', { status: 503 });
      }
      return new Response(
        JSON.stringify([
          {
            id: 'act-ok',
            name: 'Steady Run',
            type: 'Run',
            start_date_local: '2026-11-15T07:00:00',
            moving_time: 2100,
            distance: 6437.36,
            average_heartrate: 154,
            max_heartrate: 166,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/streams.json')) {
      // Simulate stream endpoint 403 permission failure -> Partial sync
      return new Response(JSON.stringify({ error: 'Stream forbidden' }), { status: 403 });
    }
    if (url.includes('/wellness')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  const result = await synchronizePilotAthlete({
    coachId: OWNER_COACH.id,
    mode: 'initial',
    nowIso: '2026-11-20T12:00:00.000Z',
    initialLookbackDays: 30,
    chunkDays: 60,
    supabaseClient: client,
    oauthStore,
    fetcher,
    retryOptions: { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 5 },
  });

  assert.equal(activityCalls, 3, 'Should recover after 429 and 503 retries');
  assert.equal(result.ok, true);
  assert.equal(result.status, 'Partial');
  assert.equal(result.activitiesProcessed, 1);
  assert.equal(result.streamsUnavailable, 1);
  assert.ok(result.warnings.some((w) => w.includes('HR stream unavailable')));
  assert.equal(tables.completed_activities.length, 1);
  assert.equal(tables.synchronization_logs[0].status, 'Partial');
  assert.ok(tables.raw_provider_payloads.length >= 2);
});

test('Milestone 3.2: HTTP GET /api/production/pilot returns authenticated coach data and preserves Demo Mode dataset', async () => {
  process.env.INTERVALS_ICU_API_KEY = 'test-intervals-secret-key-abc';
  resetPilotGateForTesting();
  const { client } = createFullStatefulMockSupabaseClient();
  const oauthStore = new SupabaseOAuthStore(() => client);
  await seedVerifiedPilotConnection(oauthStore, OWNER_COACH.id, 'Pbutterworth', 'i1000');

  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(JSON.stringify({ id: 'i1000', name: 'Coach Mike' }), { status: 200 });
    }
    if (url.endsWith('/api/v1/athlete/Pbutterworth')) {
      return new Response(
        JSON.stringify({
          id: 'Pbutterworth',
          name: 'Pbutterworth',
          sportSettings: [{ types: ['Run'], lthr: 169 }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/activities')) {
      return new Response(
        JSON.stringify([
          {
            id: 'act-dash-1',
            name: 'Base Miles',
            type: 'Run',
            start_date_local: '2026-11-19T07:00:00',
            moving_time: 2700,
            distance: 8046.7,
            average_heartrate: 148,
            icu_training_load: 62.5,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/streams.json')) {
      return new Response(
        JSON.stringify({ time: [0, 1, 2], heartrate: [142, 148, 151] }),
        { status: 200 }
      );
    }
    if (url.includes('/wellness')) {
      return new Response(
        JSON.stringify([{ id: '2026-11-19', restingHR: 49, hrv: 64.2, ctl: 48.0, atl: 51.0 }]),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 404 });
  };

  const app = await createApp({
    authVerifier: createAuthVerifier(),
    oauthStore,
    supabaseClient: client,
    intervalsFetcher: fetcher,
    databaseChecker: async () => ({ configured: true, connected: true, detail: 'mock' }),
    mountFrontend: false,
  });
  const srv = await startTestServer(app);

  try {
    // Unauthenticated rejected
    const anonRes = await fetch(`${srv.baseUrl}/api/production/pilot`);
    assert.equal(anonRes.status, 401);

    // Sync via HTTP
    const syncHttpRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'initial' }),
    });
    assert.equal(syncHttpRes.status, 200);

    // Fetch via HTTP
    const dashRes = await fetch(`${srv.baseUrl}/api/production/pilot`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(dashRes.status, 200);
    const dashJson = (await dashRes.json()) as {
      hasPersistedPilot: boolean;
      athlete: { fullName: string; externalAthleteId: string } | null;
      activities: Array<{ externalActivityId: string; streamStatus: string; icuTrainingLoad: number }>;
      wellnessRecords: Array<{ hrvRmssd: number }>;
      syncLogs: Array<{ status: string }>;
    };
    assert.equal(dashJson.hasPersistedPilot, true);
    assert.equal(dashJson.athlete?.fullName, 'Pbutterworth');
    assert.equal(dashJson.athlete?.externalAthleteId, 'Pbutterworth');
    assert.equal(dashJson.activities.length, 1);
    assert.equal(dashJson.activities[0].streamStatus, 'imported');
    assert.equal(dashJson.activities[0].icuTrainingLoad, 62.5);
    assert.equal(dashJson.wellnessRecords[0].hrvRmssd, 64.2);
    assert.equal(dashJson.syncLogs[0].status, 'Succeeded');

    // Verify Demo Mode LocalDemoRepository remains untouched (30 fictional athletes)
    const demoRoster = await coachingRepository.loadRoster();
    assert.equal(demoRoster.length, 30);
  } finally {
    await srv.close();
  }
});
