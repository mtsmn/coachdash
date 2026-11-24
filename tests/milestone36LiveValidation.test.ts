import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../server.ts';
import type { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { fetchAllPagedRows, upsertRowsInChunks } from '../server/supabaseAdmin.ts';
import { getIntervalsRosterOverview, resetRosterSyncLocksForTesting } from '../server/pilotIngestion.ts';
import { ALL_PUBLIC_TABLES, runLiveReadOnlyValidation } from '../server/liveValidation.ts';
import { resetPilotGateForTesting } from '../server/intervalsClient.ts';
import type { OAuthPersistenceStore, PersistedProviderConnection } from '../server/oauthStore.ts';

const OWNER_COACH = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'mythicalmilecoaching@gmail.com',
  fullName: 'Mythical Mile Coach',
  organizationName: 'Mythical Mile Coaching',
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
    return { ok: false, status: 401, error: 'Invalid token' };
  };
}

test('fetchAllPagedRows iterates across 1,000-row range pages and supports legacy mocks without range()', async () => {
  // 1. Multi-page PostgREST simulation with 2,450 rows
  const allRows = Array.from({ length: 2450 }, (_, i) => ({ id: `row-${i + 1}`, idx: i }));
  let rangeCalls = 0;

  const pagedResult = await fetchAllPagedRows<{ id: string; idx: number }>(() => ({
    range: async (from: number, to: number) => {
      rangeCalls++;
      return { data: allRows.slice(from, to + 1), error: null };
    },
    then: (onfulfilled) => Promise.resolve({ data: allRows.slice(0, 1000), error: null }).then(onfulfilled),
  }));

  assert.equal(pagedResult.error, null);
  assert.equal(pagedResult.data.length, 2450);
  assert.equal(pagedResult.data[0].id, 'row-1');
  assert.equal(pagedResult.data[2449].id, 'row-2450');
  assert.equal(rangeCalls, 3);

  // 2. Simple unit-test mock without `.range()`
  const mockResult = await fetchAllPagedRows<{ id: string }>(() => ({
    then: (onfulfilled) =>
      Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }).then(onfulfilled),
  }));
  assert.equal(mockResult.error, null);
  assert.deepEqual(mockResult.data, [{ id: 'a' }, { id: 'b' }]);
});

test('upsertRowsInChunks splits large batches into 500-row chunks without truncation', async () => {
  const chunkSizes: number[] = [];
  const mockClient = {
    from: (_table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        chunkSizes.push(rows.length);
        return { error: null };
      },
    }),
  } as unknown as SupabaseClient;

  const rows = Array.from({ length: 1240 }, (_, i) => ({ id: i }));
  const res = await upsertRowsInChunks(mockClient, 'daily_load_histories', rows, 'id', 500);
  assert.equal(res.error, null);
  assert.deepEqual(chunkSizes, [500, 500, 240]);
});

test('getIntervalsRosterOverview(probePermissions=true) distinguishes full, partial (missing wellness), and denied permissions', async () => {
  resetPilotGateForTesting();
  resetRosterSyncLocksForTesting();
  const prevKey = process.env.INTERVALS_ICU_API_KEY;
  process.env.INTERVALS_ICU_API_KEY = 'test-secret-intervals-key';

  try {
    const conn: PersistedProviderConnection = {
      id: 'conn-1',
      coachId: OWNER_COACH.id,
      provider: 'intervals_icu',
      authMode: 'api_key',
      connected: true,
      readOnlyMode: true,
      pilotTestSucceeded: true,
      verifiedPilotAthleteId: 'i602234',
      externalCoachId: 'i81059',
      externalCoachName: 'Coach Test',
      grantedScopes: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
      lastVerifiedAt: new Date().toISOString(),
      lastSynchronizedAt: null,
      updatedAt: new Date().toISOString(),
    };

    const mockStore: OAuthPersistenceStore = {
      createOAuthState: async () => ({
        state: 'mock-state',
        expiresAtIso: new Date().toISOString(),
        persistedToDatabase: true,
      }),
      consumeOAuthState: async () => ({ ok: false, reason: 'missing' }),
      getProviderConnection: async () => conn,
      listProviderConnections: async () => [conn],
      upsertProviderConnection: async () => ({ connection: conn, persistedToDatabase: true }),
      saveEncryptedCredentials: async () => ({ persistedToDatabase: true }),
      getDecryptedCredentials: async () => null,
      clearCredentials: async () => {},
    };

    const makeEmptyChain = () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    };
    const mockClient = {
      from: () => makeEmptyChain(),
    } as unknown as SupabaseClient;

    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/athlete/0')) {
        return new Response(JSON.stringify({ id: 'i81059', name: 'Coach Test' }), { status: 200 });
      }
      if (url.includes('/athlete/0/athlete-summary.json')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith('/api/v1/athletes')) {
        return new Response(
          JSON.stringify([
            { id: 'i81059', name: 'Coach Test' },
            { id: 'i602234', name: 'Pilot Runner', email: null },
            { id: 'i900001', name: 'Partial Runner', email: null },
            { id: 'i900002', name: 'Denied Runner', email: null },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/athlete/i602234')) {
        return new Response(JSON.stringify(url.includes('/athlete/i602234/') ? [] : { id: 'i602234' }), {
          status: 200,
        });
      }
      if (url.includes('/athlete/i900001/wellness')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      }
      if (url.includes('/athlete/i900001')) {
        return new Response(JSON.stringify(url.includes('/athlete/i900001/') ? [] : { id: 'i900001' }), {
          status: 200,
        });
      }
      if (url.includes('/athlete/i900002')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      }
      return new Response('{}', { status: 404 });
    };

    const overview = await getIntervalsRosterOverview({
      coachId: OWNER_COACH.id,
      probePermissions: true,
      supabaseClient: mockClient,
      oauthStore: mockStore,
      fetcher,
    });

    assert.equal(overview.ok, true);
    assert.deepEqual(overview.excludedCoachIds, ['i81059']);
    assert.equal(overview.athletes.length, 3);

    const pilot = overview.athletes.find((a) => a.externalAthleteId === 'i602234');
    assert.equal(pilot?.sharingPermissionStatus, 'Authorized (Read-Only)');
    assert.deepEqual(pilot?.permissionCapabilities, {
      settings: 'granted',
      activities: 'granted',
      wellness: 'granted',
    });

    const partial = overview.athletes.find((a) => a.externalAthleteId === 'i900001');
    assert.equal(partial?.sharingPermissionStatus, 'Partial Permissions');
    assert.deepEqual(partial?.permissionCapabilities, {
      settings: 'granted',
      activities: 'granted',
      wellness: 'denied',
    });

    const denied = overview.athletes.find((a) => a.externalAthleteId === 'i900002');
    assert.equal(denied?.sharingPermissionStatus, 'Permission unavailable');
    assert.deepEqual(denied?.permissionCapabilities, {
      settings: 'denied',
      activities: 'denied',
      wellness: 'denied',
    });
  } finally {
    if (prevKey === undefined) delete process.env.INTERVALS_ICU_API_KEY;
    else process.env.INTERVALS_ICU_API_KEY = prevKey;
  }
});

test('runLiveReadOnlyValidation checks all 22 tables (including heart_rate_streams via activity_id) and enforces auth on GET /api/production/live-validation', async () => {
  const seenTables: Array<{ table: string; pkSelect: string }> = [];
  const makeMockTableChain = (table: string) => {
    const chain: Record<string, unknown> = {
      select: (cols: string) => {
        seenTables.push({ table, pkSelect: cols });
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (resolve: (v: { data: unknown[]; count: number; error: null }) => void) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    return chain;
  };

  const mockClient = {
    from: (table: string) => makeMockTableChain(table),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
  } as unknown as SupabaseClient;

  const mockStore: OAuthPersistenceStore = {
    createOAuthState: async () => ({
      state: 'mock-state',
      expiresAtIso: new Date().toISOString(),
      persistedToDatabase: true,
    }),
    consumeOAuthState: async () => ({ ok: false, reason: 'missing' }),
    getProviderConnection: async () => null,
    listProviderConnections: async () => [],
    upsertProviderConnection: async () => {
      throw new Error('Must never mutate connections during read-only live validation');
    },
    saveEncryptedCredentials: async () => {
      throw new Error('Must never save credentials during read-only live validation');
    },
    getDecryptedCredentials: async () => null,
    clearCredentials: async () => {
      throw new Error('Must never clear session during read-only live validation');
    },
  };

  const report = await runLiveReadOnlyValidation({
    coachId: OWNER_COACH.id,
    supabaseClient: mockClient,
    oauthStore: mockStore,
  });

  assert.equal(report.readOnly, true);
  assert.equal(report.supabase.tableChecks.length, ALL_PUBLIC_TABLES.length);
  assert.equal(report.supabase.inaccessibleTables.length, 0);
  const hrStreamCheck = seenTables.find((t) => t.table === 'heart_rate_streams');
  assert.equal(hrStreamCheck?.pkSelect, 'activity_id');

  // Verify HTTP endpoint auth enforcement
  const app = await createApp({
    authVerifier: createAuthVerifier(),
    oauthStore: mockStore,
    supabaseClient: mockClient,
    databaseChecker: async () => ({ configured: true, connected: true, detail: 'ok' }),
    mountFrontend: false,
  });
  const srv = await startTestServer(app);
  try {
    const unauth = await fetch(`${srv.baseUrl}/api/production/live-validation`);
    assert.equal(unauth.status, 401);

    const auth = await fetch(`${srv.baseUrl}/api/production/live-validation`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(auth.status, 200);
    const body = (await auth.json()) as { readOnly: boolean; supabase: { tableChecks: unknown[] } };
    assert.equal(body.readOnly, true);
    assert.equal(body.supabase.tableChecks.length, ALL_PUBLIC_TABLES.length);
  } finally {
    await srv.close();
  }
});
