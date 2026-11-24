import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../server.ts';
import type { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { SupabaseOAuthStore } from '../server/oauthStore.ts';
import { resetPilotGateForTesting } from '../server/intervalsClient.ts';

const OWNER_COACH = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'mtschmitt@gmail.com',
  fullName: 'Mythical Mile Coach',
  organizationName: 'Mythical Mile Coaching',
  role: 'owner_coach' as const,
};

const OTHER_COACH_ID = '22222222-2222-4222-8222-222222222222';

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

function createStatefulMockSupabaseClient() {
  const providerConnections = new Map<string, Record<string, unknown>>();
  const providerCredentials = new Map<string, Record<string, unknown>>();

  const otherTables = new Map<string, Array<Record<string, unknown>>>();
  const extraTables = new Set([
    'athletes',
    'provider_athlete_mappings',
    'raw_provider_payloads',
    'completed_activities',
    'heart_rate_streams',
    'provider_training_metrics',
    'independent_stress_metrics',
    'wellness_records',
    'daily_load_histories',
    'planned_workouts',
    'workout_matches',
    'coaching_alerts',
    'weekly_reports',
    'synchronization_logs',
    'audit_events',
  ]);
  for (const t of extraTables) otherTables.set(t, []);

  function genericConflictCols(table: string, onConflict?: string): string[] {
    if (onConflict) return onConflict.split(',').map((s) => s.trim());
    if (table === 'provider_athlete_mappings') return ['athlete_id', 'provider'];
    if (table === 'completed_activities') return ['athlete_id', 'provider', 'external_activity_id'];
    if (table === 'heart_rate_streams') return ['activity_id'];
    if (table === 'provider_training_metrics') return ['activity_id', 'provider', 'metric_date'];
    if (table === 'independent_stress_metrics') {
      return ['activity_id', 'methodology', 'threshold_version_used'];
    }
    if (table === 'wellness_records') return ['athlete_id', 'source', 'record_date'];
    if (table === 'daily_load_histories') return ['athlete_id', 'methodology', 'load_date'];
    if (table === 'weekly_reports') return ['athlete_id', 'week_start_date'];
    return ['id'];
  }

  function createGenericTableApi(table: string) {
    const list = otherTables.get(table)!;
    const write = (payload: Record<string, unknown>, onConflict?: string, forceInsert = false) => {
      const now = new Date().toISOString();
      if (table === 'raw_provider_payloads' && forceInsert) {
        const dup = list.find(
          (r) =>
            r.coach_id === payload.coach_id &&
            r.provider === payload.provider &&
            r.entity_type === payload.entity_type &&
            r.external_id === payload.external_id &&
            r.payload_sha256 === payload.payload_sha256
        );
        if (dup) return { row: null, error: { message: 'duplicate raw payload', code: '23505' } };
      }
      const cols = genericConflictCols(table, onConflict);
      const idx = forceInsert ? -1 : list.findIndex((r) => cols.every((c) => r[c] === payload[c]));
      const existing = idx >= 0 ? list[idx] : undefined;
      const merged: Record<string, unknown> = {
        id: existing?.id ?? `${table.slice(0, 4)}-${crypto.randomUUID()}`,
        created_at: existing?.created_at ?? now,
        ...existing,
        ...payload,
        updated_at: now,
      };
      if (idx >= 0) list[idx] = merged;
      else list.push(merged);
      return { row: { ...merged }, error: null };
    };

    return {
      select: (_cols?: string) => {
        const filters: Array<{ col: string; val: unknown; ilike?: boolean }> = [];
        let orderCol: string | null = null;
        let asc = true;
        let lim: number | null = null;
        const run = () => {
          let rows = list.filter((r) =>
            filters.every((f) =>
              f.ilike
                ? String(r[f.col] ?? '').toLowerCase() === String(f.val ?? '').toLowerCase()
                : r[f.col] === f.val
            )
          );
          if (orderCol) {
            const col = orderCol;
            rows = [...rows].sort((a, b) =>
              asc
                ? String(a[col] ?? '').localeCompare(String(b[col] ?? ''))
                : String(b[col] ?? '').localeCompare(String(a[col] ?? ''))
            );
          }
          if (lim !== null) rows = rows.slice(0, lim);
          return rows.map((r) => structuredClone(r));
        };
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return chain;
          },
          ilike: (col: string, val: unknown) => {
            filters.push({ col, val, ilike: true });
            return chain;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderCol = col;
            asc = opts?.ascending ?? true;
            return chain;
          },
          limit: (n: number) => {
            lim = n;
            return chain;
          },
          maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
          single: async () => {
            const row = run()[0] ?? null;
            return { data: row, error: row ? null : { message: 'Not found' } };
          },
          then: (onFulfilled: (v: { data: Record<string, unknown>[]; error: null }) => unknown) =>
            Promise.resolve(onFulfilled({ data: run(), error: null })),
        };
        return chain;
      },
      insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const items = Array.isArray(payload) ? payload : [payload];
        const inserted: Array<Record<string, unknown>> = [];
        let err: { message: string; code?: string } | null = null;
        for (const item of items) {
          const res = write(item, undefined, true);
          if (res.error) {
            err = res.error;
            break;
          }
          if (res.row) inserted.push(res.row);
        }
        const out = { data: err ? null : Array.isArray(payload) ? inserted : inserted[0], error: err };
        return {
          select: () => ({
            single: async () => ({ data: err ? null : inserted[0] ?? null, error: err }),
            then: (onFulfilled: (v: typeof out) => unknown) => Promise.resolve(onFulfilled(out)),
          }),
          then: (onFulfilled: (v: typeof out) => unknown) => Promise.resolve(onFulfilled(out)),
        };
      },
      upsert: (payload: Record<string, unknown> | Array<Record<string, unknown>>, opts?: { onConflict?: string }) => {
        const items = Array.isArray(payload) ? payload : [payload];
        const upserted: Array<Record<string, unknown>> = [];
        let err: { message: string; code?: string } | null = null;
        for (const item of items) {
          const res = write(item, opts?.onConflict, false);
          if (res.error) {
            err = res.error;
            break;
          }
          if (res.row) upserted.push(res.row);
        }
        const out = { data: err ? null : Array.isArray(payload) ? upserted : upserted[0], error: err };
        return {
          select: () => ({
            single: async () => ({ data: err ? null : upserted[0] ?? null, error: err }),
            then: (onFulfilled: (v: typeof out) => unknown) => Promise.resolve(onFulfilled(out)),
          }),
          then: (onFulfilled: (v: typeof out) => unknown) => Promise.resolve(onFulfilled(out)),
        };
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Array<{ col: string; val: unknown }> = [];
        const apply = () => {
          const matched: Array<Record<string, unknown>> = [];
          for (let i = 0; i < list.length; i++) {
            if (filters.every((f) => list[i][f.col] === f.val)) {
              list[i] = { ...list[i], ...patch, updated_at: new Date().toISOString() };
              matched.push(structuredClone(list[i]));
            }
          }
          return { data: matched, error: null };
        };
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push({ col, val });
            return chain;
          },
          select: () => ({
            single: async () => {
              const r = apply();
              return { data: r.data[0] ?? null, error: r.data[0] ? null : { message: 'Not found' } };
            },
            then: (onFulfilled: (v: ReturnType<typeof apply>) => unknown) => Promise.resolve(onFulfilled(apply())),
          }),
          then: (onFulfilled: (v: ReturnType<typeof apply>) => unknown) => Promise.resolve(onFulfilled(apply())),
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
          then: (onFulfilled: (v: { error: null }) => unknown) => {
            const remaining = list.filter((r) => !filters.every((f) => r[f.col] === f.val));
            otherTables.set(table, remaining);
            return Promise.resolve(onFulfilled({ error: null }));
          },
        };
        return chain;
      },
    };
  }

  const client = {
    from: (table: string) => {
      if (table === 'provider_connections') {
        return {
          select: (_cols: string) => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                const key = `${filters.coach_id}::${filters.provider}`;
                const row = providerConnections.get(key) ?? null;
                return { data: row ? { ...row } : null, error: null };
              },
              then: (
                onFulfilled: (value: { data: Record<string, unknown>[]; error: null }) => unknown
              ) => {
                const rows = Array.from(providerConnections.values())
                  .filter((r) =>
                    Object.entries(filters).every(([k, v]) => r[k] === v)
                  )
                  .map((r) => ({ ...r }));
                return Promise.resolve(onFulfilled({ data: rows, error: null }));
              },
            };
            return chain;
          },
          upsert: (payload: Record<string, unknown>, _opts?: { onConflict?: string }) => {
            const key = `${payload.coach_id}::${payload.provider}`;
            const existing = providerConnections.get(key);
            const now = new Date().toISOString();
            const merged: Record<string, unknown> = {
              id: existing?.id ?? `conn-${crypto.randomUUID()}`,
              created_at: existing?.created_at ?? now,
              granted_scopes: existing?.granted_scopes ?? [],
              external_coach_id: existing?.external_coach_id ?? null,
              external_coach_name: existing?.external_coach_name ?? null,
              last_verified_at: existing?.last_verified_at ?? null,
              last_synchronized_at: existing?.last_synchronized_at ?? null,
              ...existing,
              ...payload,
              updated_at: now,
            };
            providerConnections.set(key, merged);
            return {
              select: (_cols: string) => ({
                single: async () => ({ data: { ...merged }, error: null }),
              }),
            };
          },
        };
      }

      if (table === 'provider_connection_credentials') {
        return {
          select: (_cols: string) => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return chain;
              },
              maybeSingle: async () => {
                const key = `${filters.coach_id}::${filters.provider}`;
                const row = providerCredentials.get(key) ?? null;
                return { data: row ? { ...row } : null, error: null };
              },
            };
            return chain;
          },
          upsert: async (payload: Record<string, unknown>, _opts?: { onConflict?: string }) => {
            const key = `${payload.coach_id}::${payload.provider}`;
            providerCredentials.set(key, { ...payload, updated_at: new Date().toISOString() });
            return { data: null, error: null };
          },
          delete: () => {
            const filters: Record<string, unknown> = {};
            const chain = {
              eq: (col: string, val: unknown) => {
                filters[col] = val;
                return chain;
              },
              then: (onFulfilled: (value: { error: null }) => unknown) => {
                const key = `${filters.coach_id}::${filters.provider}`;
                providerCredentials.delete(key);
                return Promise.resolve(onFulfilled({ error: null }));
              },
            };
            return chain;
          },
        };
      }

      if (extraTables.has(table)) {
        return createGenericTableApi(table);
      }

      throw new Error(`Unexpected table access: ${table}`);
    },
  } as unknown as SupabaseClient;

  return {
    client,
    providerConnections,
    providerCredentials,
  };
}

function createAuthVerifier(coach = OWNER_COACH): CoachTokenVerifier {
  return async (token: string) => {
    if (token === 'valid-owner-jwt') {
      return { ok: true, coach };
    }
    return {
      ok: false,
      status: 401,
      error: 'Invalid token',
    };
  };
}

function createIntervalsMockFetch(options: {
  coachId?: string;
  coachName?: string;
  roster?: Array<{ id: string; name: string }>;
  failSharedAthleteAccess?: boolean;
  throwOnPilotFetch?: boolean;
  deniedAthleteIds?: string[];
  onAthleteEndpointCall?: (url: string) => void;
}): typeof fetch {
  const coachId = options.coachId ?? 'i1000';
  const coachName = options.coachName ?? 'Coach Mike';
  const roster = options.roster ?? [
    { id: 'i20491', name: 'Maya Lin' },
    { id: 'Pbutterworth', name: 'Pbutterworth' },
  ];
  const denied = new Set(options.deniedAthleteIds ?? []);

  return async (input) => {
    const url = String(input);
    options.onAthleteEndpointCall?.(url);

    if (options.throwOnPilotFetch && url.includes('/athlete/')) {
      throw new Error('Simulated Intervals.icu transport failure');
    }

    if (url.endsWith('/api/v1/athlete/0')) {
      return new Response(
        JSON.stringify({
          id: coachId,
          name: coachName,
          email: 'coach@mythicalmile.com',
          timezone: 'America/Los_Angeles',
        }),
        { status: 200 }
      );
    }

    if (url.includes('/athlete/0/athlete-summary.json')) {
      return new Response(
        JSON.stringify([
          { athlete_id: coachId, athlete_name: coachName },
          ...roster.map((a) => ({ athlete_id: a.id, athlete_name: a.name })),
        ]),
        { status: 200 }
      );
    }

    if (url.endsWith('/api/v1/athletes')) {
      return new Response(
        JSON.stringify(roster.map((a) => ({ id: a.id, name: a.name }))),
        { status: 200 }
      );
    }

    for (const athlete of roster) {
      const encoded = encodeURIComponent(athlete.id);
      if (url.endsWith(`/api/v1/athlete/${encoded}`)) {
        if (options.failSharedAthleteAccess || denied.has(athlete.id)) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
        return new Response(
          JSON.stringify({
            id: athlete.id,
            name: athlete.name,
            sportSettings: [
              { types: ['Run'], lthr: 171, hr_zones: [136, 152, 162, 171, 186] },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes(`/api/v1/athlete/${encoded}/events`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes(`/api/v1/athlete/${encoded}/activities`)) {
        if (options.failSharedAthleteAccess || denied.has(athlete.id)) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
        return new Response(
          JSON.stringify([
            {
              id: `run-${athlete.id}`,
              type: 'Run',
              name: 'Threshold 7mi',
              start_date_local: '2026-11-18T07:00:00',
              distance: 11265,
              moving_time: 2940,
              average_heartrate: 168,
              max_heartrate: 177,
              icu_training_load: 84,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes(`/api/v1/athlete/${encoded}/wellness`)) {
        if (options.failSharedAthleteAccess || denied.has(athlete.id)) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
        return new Response(
          JSON.stringify([{ id: '2026-11-18', ctl: 58.4, atl: 63.1 }]),
          { status: 200 }
        );
      }
    }

    if (url.includes('/streams.json')) {
      return new Response(
        JSON.stringify([
          { type: 'time', data: [0, 1] },
          { type: 'heartrate', data: [164, 168] },
        ]),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };
}

test('Milestone 3.1: Personal API Key pilot verification persists in Supabase, survives server restarts without expiration, and authorizes sync', async () => {
  resetPilotGateForTesting();
  const prevApiKey = process.env.INTERVALS_ICU_API_KEY;
  process.env.INTERVALS_ICU_API_KEY = 'secret-personal-api-key-never-expose';

  const db = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => db.client);
  const fetcher = createIntervalsMockFetch({});

  try {
    // 1. Before any pilot verification, full-roster sync is blocked by database-authoritative gate
    const app1 = await createApp({
      mountFrontend: false,
      authVerifier: createAuthVerifier(),
      oauthStore: store,
      supabaseClient: db.client,
      intervalsFetcher: fetcher,
      databaseChecker: async () => ({ configured: true, connected: true, detail: 'Mock Supabase' }),
    });
    const srv1 = await startTestServer(app1);

    try {
      const blockedBeforeRes = await fetch(`${srv1.baseUrl}/api/integrations/intervals/roster-sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-owner-jwt' },
      });
      assert.equal(blockedBeforeRes.status, 409);
      const blockedBeforeJson = (await blockedBeforeRes.json()) as {
        ok: boolean;
        blockedByPilotGate: boolean;
      };
      assert.equal(blockedBeforeJson.ok, false);
      assert.equal(blockedBeforeJson.blockedByPilotGate, true);

      // 2. Run pilot test in Personal API Key mode selecting Pbutterworth
      const pilotRes = await fetch(`${srv1.baseUrl}/api/integrations/intervals/pilot-test`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-owner-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pilotAthleteId: 'Pbutterworth' }),
      });
      assert.equal(pilotRes.status, 200);
      const pilotJson = (await pilotRes.json()) as {
        pilotTestSucceeded: boolean;
        fullRosterSyncAllowed: boolean;
        authMechanism: string;
        selectedPilotAthlete: { id: string } | null;
      };
      assert.equal(pilotJson.pilotTestSucceeded, true);
      assert.equal(pilotJson.fullRosterSyncAllowed, true);
      assert.equal(pilotJson.authMechanism, 'coach_api_key');
      assert.equal(pilotJson.selectedPilotAthlete?.id, 'Pbutterworth');

      // Verify persisted Supabase row & zero plaintext API key storage
      const persistedRow = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`);
      assert.ok(persistedRow);
      assert.equal(persistedRow.auth_mode, 'api_key');
      assert.equal(persistedRow.connected, true);
      assert.equal(persistedRow.pilot_test_succeeded, true);
      assert.equal(persistedRow.verified_pilot_athlete_id, 'Pbutterworth');
      assert.equal(persistedRow.external_coach_id, 'i1000');
      assert.equal(persistedRow.external_coach_name, 'Coach Mike');
      assert.ok(typeof persistedRow.last_verified_at === 'string');
      assert.equal(db.providerCredentials.size, 0);
      assert.ok(!JSON.stringify(persistedRow).includes('secret-personal-api-key-never-expose'));
    } finally {
      await srv1.close();
    }

    // 3. Simulate full server restart: wipe all in-memory state and create a brand new Express app
    resetPilotGateForTesting();

    // Also prove no expiration: backdate last_verified_at by 180 days in persisted DB row
    const existingRow = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    existingRow.last_verified_at = new Date(Date.now() - 180 * 86400 * 1000).toISOString();

    const app2 = await createApp({
      mountFrontend: false,
      authVerifier: createAuthVerifier(),
      oauthStore: new SupabaseOAuthStore(() => db.client),
      supabaseClient: db.client,
      intervalsFetcher: fetcher,
      databaseChecker: async () => ({ configured: true, connected: true, detail: 'Mock Supabase' }),
    });
    const srv2 = await startTestServer(app2);

    try {
      // Status reflects persisted verification and never exposes API key
      const statusRes = await fetch(`${srv2.baseUrl}/api/integrations/status`, {
        headers: { Authorization: 'Bearer valid-owner-jwt' },
      });
      assert.equal(statusRes.status, 200);
      const statusRaw = await statusRes.text();
      assert.ok(!statusRaw.includes('secret-personal-api-key-never-expose'));
      const statusJson = JSON.parse(statusRaw) as {
        intervalsIcu: {
          connected: boolean;
          authMethod: string;
          pilotTestSucceeded: boolean;
          verifiedPilotAthleteId: string | null;
          fullRosterSyncAllowed: boolean;
          coachAccountIdentity: string | null;
        };
      };
      assert.equal(statusJson.intervalsIcu.connected, true);
      assert.equal(statusJson.intervalsIcu.authMethod, 'api_key');
      assert.equal(statusJson.intervalsIcu.pilotTestSucceeded, true);
      assert.equal(statusJson.intervalsIcu.verifiedPilotAthleteId, 'Pbutterworth');
      assert.equal(statusJson.intervalsIcu.fullRosterSyncAllowed, true);
      assert.equal(statusJson.intervalsIcu.coachAccountIdentity, 'Coach Mike (i1000)');

      // Another coach has zero access to owner coach's persisted verification
      const otherCoachConn = await store.getProviderConnection(OTHER_COACH_ID, 'intervals_icu');
      assert.equal(otherCoachConn, null);

      // Full-roster sync gate passes after server restart
      const syncRes = await fetch(`${srv2.baseUrl}/api/integrations/intervals/roster-sync`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-owner-jwt' },
      });
      assert.equal(syncRes.status, 200);
      const syncJson = (await syncRes.json()) as {
        ok: boolean;
        blockedByPilotGate: boolean;
        verifiedPilotAthleteId: string | null;
      };
      assert.equal(syncJson.ok, true);
      assert.equal(syncJson.blockedByPilotGate, false);
      assert.equal(syncJson.verifiedPilotAthleteId, 'Pbutterworth');

      // Re-testing without specifying pilotAthleteId preserves valid Pbutterworth selection
      const retestRes = await fetch(`${srv2.baseUrl}/api/integrations/intervals/pilot-test`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-owner-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(retestRes.status, 200);
      const retestJson = (await retestRes.json()) as {
        pilotTestSucceeded: boolean;
        selectedPilotAthlete: { id: string } | null;
      };
      assert.equal(retestJson.pilotTestSucceeded, true);
      assert.equal(retestJson.selectedPilotAthlete?.id, 'Pbutterworth');
    } finally {
      await srv2.close();
    }
  } finally {
    resetPilotGateForTesting();
    if (prevApiKey === undefined) delete process.env.INTERVALS_ICU_API_KEY;
    else process.env.INTERVALS_ICU_API_KEY = prevApiKey;
  }
});

test('Milestone 3.1: Failed re-test, exception, disconnect, coach change, invalid ID, and coach self-ID all invalidate persisted verification and block sync', async () => {
  resetPilotGateForTesting();
  const prevApiKey = process.env.INTERVALS_ICU_API_KEY;
  const prevEncKey = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.INTERVALS_ICU_API_KEY = 'secret-personal-api-key';
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

  const db = createStatefulMockSupabaseClient();
  const store = new SupabaseOAuthStore(() => db.client);

  let currentFetcher = createIntervalsMockFetch({});
  const dynamicFetcher: typeof fetch = (input, init) => currentFetcher(input, init);

  const app = await createApp({
    mountFrontend: false,
    authVerifier: createAuthVerifier(),
    oauthStore: store,
    supabaseClient: db.client,
    intervalsFetcher: dynamicFetcher,
    databaseChecker: async () => ({ configured: true, connected: true, detail: 'Mock Supabase' }),
  });
  const srv = await startTestServer(app);

  async function passPilot(pilotAthleteId = 'Pbutterworth') {
    currentFetcher = createIntervalsMockFetch({});
    const res = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-test`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pilotAthleteId }),
    });
    const json = (await res.json()) as { pilotTestSucceeded: boolean };
    assert.equal(json.pilotTestSucceeded, true);
  }

  async function assertSyncBlocked() {
    const syncRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/roster-sync`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(syncRes.status, 409);
    const syncJson = (await syncRes.json()) as { ok: boolean; blockedByPilotGate: boolean };
    assert.equal(syncJson.ok, false);
    assert.equal(syncJson.blockedByPilotGate, true);
  }

  try {
    // A. Invalid manual athlete ID not in shared roster -> rejected, never probed, invalidates prior success
    await passPilot('Pbutterworth');
    const calledUrls: string[] = [];
    currentFetcher = createIntervalsMockFetch({
      onAthleteEndpointCall: (url) => calledUrls.push(url),
    });
    const invalidIdRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-test`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pilotAthleteId: 'not-in-shared-roster-999' }),
    });
    assert.equal(invalidIdRes.status, 200);
    const invalidIdJson = (await invalidIdRes.json()) as {
      pilotTestSucceeded: boolean;
      fullRosterSyncAllowed: boolean;
      steps: Array<{ id: string; status: string }>;
    };
    assert.equal(invalidIdJson.pilotTestSucceeded, false);
    assert.equal(invalidIdJson.fullRosterSyncAllowed, false);
    assert.equal(
      invalidIdJson.steps.find((s) => s.id === 'shared_athlete_access')?.status,
      'Failed'
    );
    assert.ok(!calledUrls.some((u) => u.includes('not-in-shared-roster-999')));
    const rowAfterInvalid = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    assert.equal(rowAfterInvalid.pilot_test_succeeded, false);
    assert.equal(rowAfterInvalid.verified_pilot_athlete_id, null);
    await assertSyncBlocked();

    // B. Coach's own athlete ID ('i1000' and '0') -> rejected and invalidates prior success
    for (const selfId of ['i1000', '0']) {
      await passPilot('Pbutterworth');
      const selfRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-test`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-owner-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pilotAthleteId: selfId }),
      });
      const selfJson = (await selfRes.json()) as { pilotTestSucceeded: boolean };
      assert.equal(selfJson.pilotTestSucceeded, false);
      const rowAfterSelf = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
      assert.equal(rowAfterSelf.pilot_test_succeeded, false);
      assert.equal(rowAfterSelf.verified_pilot_athlete_id, null);
      await assertSyncBlocked();
    }

    // C. Failed re-test (403 permission denied) invalidates previous successful verification
    await passPilot('Pbutterworth');
    currentFetcher = createIntervalsMockFetch({ failSharedAthleteAccess: true });
    const failRetestRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-test`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pilotAthleteId: 'Pbutterworth' }),
    });
    const failRetestJson = (await failRetestRes.json()) as { pilotTestSucceeded: boolean };
    assert.equal(failRetestJson.pilotTestSucceeded, false);
    const rowAfterFail = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    assert.equal(rowAfterFail.pilot_test_succeeded, false);
    assert.equal(rowAfterFail.verified_pilot_athlete_id, null);
    await assertSyncBlocked();

    // D. Unexpected exception during pilot test invalidates previous successful verification
    await passPilot('Pbutterworth');
    currentFetcher = createIntervalsMockFetch({ throwOnPilotFetch: true });
    const excRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/pilot-test`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pilotAthleteId: 'Pbutterworth' }),
    });
    const excJson = (await excRes.json()) as { pilotTestSucceeded: boolean };
    assert.equal(excJson.pilotTestSucceeded, false);
    const rowAfterExc = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    assert.equal(rowAfterExc.pilot_test_succeeded, false);
    assert.equal(rowAfterExc.verified_pilot_athlete_id, null);
    await assertSyncBlocked();

    // E. Disconnect invalidates persisted verification & clears credentials even when API key env var remains set
    await passPilot('Pbutterworth');
    await store.saveEncryptedCredentials({
      coachId: OWNER_COACH.id,
      provider: 'intervals_icu',
      accessToken: 'dummy-oauth-token',
      externalCoachId: 'i1000',
      externalCoachName: 'Coach Mike',
    });
    const disconnectRes = await fetch(`${srv.baseUrl}/api/integrations/intervals/disconnect`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(disconnectRes.status, 200);
    assert.equal(db.providerCredentials.size, 0);
    const rowAfterDisconnect = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    assert.equal(rowAfterDisconnect.connected, false);
    assert.equal(rowAfterDisconnect.pilot_test_succeeded, false);
    assert.equal(rowAfterDisconnect.verified_pilot_athlete_id, null);
    await assertSyncBlocked();

    // F. Changing Intervals.icu coach account invalidates existing pilot verification
    await passPilot('Pbutterworth');
    currentFetcher = createIntervalsMockFetch({
      coachId: 'i2000-different-coach',
      coachName: 'Different Coach',
    });
    await assertSyncBlocked();
    const rowAfterCoachChange = db.providerConnections.get(`${OWNER_COACH.id}::intervals_icu`)!;
    assert.equal(rowAfterCoachChange.pilot_test_succeeded, false);
    assert.equal(rowAfterCoachChange.verified_pilot_athlete_id, null);
    assert.equal(rowAfterCoachChange.external_coach_id, 'i2000-different-coach');
  } finally {
    await srv.close();
    resetPilotGateForTesting();
    if (prevApiKey === undefined) delete process.env.INTERVALS_ICU_API_KEY;
    else process.env.INTERVALS_ICU_API_KEY = prevApiKey;
    if (prevEncKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = prevEncKey;
  }
});
