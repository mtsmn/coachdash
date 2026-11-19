import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApp } from '../server.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { verifySupabaseJwtAndCoach } from '../server/supabaseAdmin.ts';
import {
  decryptSecret,
  encryptSecret,
  redactSensitiveText,
} from '../server/crypto.ts';
import { InMemoryEncryptedOAuthStore } from '../server/oauthStore.ts';
import {
  buildIntervalsOAuthUrl,
  clearIntervalsSession,
  exchangeIntervalsOAuthCode,
  resetPilotGateForTesting,
  resolveAuthHeaderForCoach,
  runIntervalsPilotConnectionTest,
} from '../server/intervalsClient.ts';

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

test('AES-256-GCM encryption supports hex and base64 keys and detects tampering', () => {
  const hexKey = crypto.randomBytes(32).toString('hex');
  const b64Key = crypto.randomBytes(32).toString('base64');
  const wrongKey = crypto.randomBytes(32).toString('hex');

  const secret = 'icu-oauth-access-token-secret-12345';
  const encryptedHex = encryptSecret(secret, hexKey);
  assert.ok(encryptedHex.startsWith('v1:'));
  assert.notEqual(encryptedHex, secret);
  assert.equal(decryptSecret(encryptedHex, hexKey), secret);

  const encryptedB64 = encryptSecret(secret, b64Key);
  assert.equal(decryptSecret(encryptedB64, b64Key), secret);

  // Wrong key must fail GCM authentication
  assert.throws(() => decryptSecret(encryptedHex, wrongKey));

  // Tampered ciphertext must fail GCM authentication
  const parts = encryptedHex.split(':');
  const tamperedCiphertext = Buffer.from(parts[3], 'base64');
  tamperedCiphertext[0] = tamperedCiphertext[0] ^ 0xff;
  parts[3] = tamperedCiphertext.toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), hexKey));
});

test('redactSensitiveText strips Bearer, Basic, API keys, and JSON secrets', () => {
  const raw =
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig failed; Basic QVBJX0tFWTpzZWNyZXQ= ' +
    'https://api.example.com?api_key=abc123&access_token=tok999 {"refresh_token":"rt-secret-1"}';
  const redacted = redactSensitiveText(raw);

  assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9.secret.sig'));
  assert.ok(!redacted.includes('QVBJX0tFWTpzZWNyZXQ='));
  assert.ok(!redacted.includes('abc123'));
  assert.ok(!redacted.includes('tok999'));
  assert.ok(!redacted.includes('rt-secret-1'));
  assert.ok(redacted.includes('Bearer [REDACTED]'));
  assert.ok(redacted.includes('Basic [REDACTED]'));
});

test('OAuth state enforces coach binding, single-use, expiration, and encrypted token storage', async () => {
  const prevId = process.env.INTERVALS_ICU_CLIENT_ID;
  const prevSecret = process.env.INTERVALS_ICU_CLIENT_SECRET;
  const prevRedirect = process.env.INTERVALS_ICU_REDIRECT_URI;
  const encKey = crypto.randomBytes(32).toString('hex');

  process.env.INTERVALS_ICU_CLIENT_ID = 'client-test-id';
  process.env.INTERVALS_ICU_CLIENT_SECRET = 'client-test-secret';
  process.env.INTERVALS_ICU_REDIRECT_URI = 'http://localhost:3000/api/integrations/intervals/oauth/callback';

  try {
    const store = new InMemoryEncryptedOAuthStore(encKey);
    const coachId = '11111111-1111-4111-8111-111111111111';

    const authUrlRes = await buildIntervalsOAuthUrl('http://localhost:3000', {
      coachId,
      store,
      ttlSeconds: 300,
    });
    assert.equal(authUrlRes.configured, true);
    assert.ok(authUrlRes.authorizeUrl);

    const parsed = new URL(authUrlRes.authorizeUrl!);
    const issuedState = parsed.searchParams.get('state')!;
    assert.ok(issuedState.length >= 64);

    // Mismatched / unknown state rejected
    const badStateRes = await exchangeIntervalsOAuthCode({
      code: 'auth-code-1',
      state: 'unknown-forged-state',
      appBaseUrl: 'http://localhost:3000',
      store,
    });
    assert.equal(badStateRes.ok, false);
    assert.equal(badStateRes.statusCode, 400);

    // Valid state exchanges code once and encrypts tokens
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: 'live-oauth-access-token',
          refresh_token: 'live-oauth-refresh-token',
          scope: 'ACTIVITY:READ,WELLNESS:READ',
          expires_in: 3600,
          athlete: { id: 'icu-coach-1', name: 'Owner Coach' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const successRes = await exchangeIntervalsOAuthCode({
      code: 'auth-code-1',
      state: issuedState,
      appBaseUrl: 'http://localhost:3000',
      store,
      fetcher: mockFetch,
    });
    assert.equal(successRes.ok, true);
    assert.equal(successRes.coachId, coachId);

    // Verify raw storage is AES-256-GCM ciphertext, not plaintext
    const rawStored = store.getRawStoredEnvelopeForTesting(coachId, 'intervals_icu');
    assert.ok(rawStored);
    assert.ok(rawStored!.encryptedAccessToken.startsWith('v1:'));
    assert.ok(!rawStored!.encryptedAccessToken.includes('live-oauth-access-token'));
    assert.ok(rawStored!.encryptedRefreshToken?.startsWith('v1:'));

    // Verify coach-scoped resolution decrypts the token properly
    const resolvedHeader = await resolveAuthHeaderForCoach(coachId, store);
    assert.ok(resolvedHeader);
    assert.equal(resolvedHeader!.header, 'Bearer live-oauth-access-token');
    assert.equal(resolvedHeader!.method, 'oauth2');

    // Reusing the same state must fail with 400
    const replayRes = await exchangeIntervalsOAuthCode({
      code: 'auth-code-2',
      state: issuedState,
      appBaseUrl: 'http://localhost:3000',
      store,
      fetcher: mockFetch,
    });
    assert.equal(replayRes.ok, false);
    assert.equal(replayRes.statusCode, 400);
    assert.match(replayRes.message, /already been used/i);

    // Expired state must fail with 400
    const shortLivedUrl = await buildIntervalsOAuthUrl('http://localhost:3000', {
      coachId,
      store,
      ttlSeconds: 10,
    });
    const shortState = new URL(shortLivedUrl.authorizeUrl!).searchParams.get('state')!;
    const expiredRes = await exchangeIntervalsOAuthCode({
      code: 'auth-code-3',
      state: shortState,
      appBaseUrl: 'http://localhost:3000',
      store,
      fetcher: mockFetch,
      nowMs: Date.now() + 60_000,
    });
    assert.equal(expiredRes.ok, false);
    assert.equal(expiredRes.statusCode, 400);
    assert.match(expiredRes.message, /expired/i);
  } finally {
    await clearIntervalsSession();
    resetPilotGateForTesting();
    if (prevId === undefined) delete process.env.INTERVALS_ICU_CLIENT_ID;
    else process.env.INTERVALS_ICU_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.INTERVALS_ICU_CLIENT_SECRET;
    else process.env.INTERVALS_ICU_CLIENT_SECRET = prevSecret;
    if (prevRedirect === undefined) delete process.env.INTERVALS_ICU_REDIRECT_URI;
    else process.env.INTERVALS_ICU_REDIRECT_URI = prevRedirect;
  }
});

test('Express routes enforce 401/403 authentication and single-owner authorization', async () => {
  const OWNER_COACH = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'mtschmitt@gmail.com',
    fullName: 'Mythical Mile Coach',
    organizationName: 'Mythical Mile Coaching',
    role: 'owner_coach' as const,
  };

  const mockVerifier: CoachTokenVerifier = async (token) => {
    if (token === 'valid-owner-jwt') {
      return { ok: true, coach: OWNER_COACH };
    }
    if (token === 'other-user-jwt') {
      return {
        ok: false,
        status: 403,
        error: 'Forbidden: authenticated user is not the Mythical Mile owner coach.',
      };
    }
    return {
      ok: false,
      status: 401,
      error: 'Invalid or expired coach session token.',
    };
  };

  const store = new InMemoryEncryptedOAuthStore(crypto.randomBytes(32).toString('hex'));
  const app = await createApp({
    mountFrontend: false,
    authVerifier: mockVerifier,
    oauthStore: store,
    databaseChecker: async () => ({
      configured: false,
      connected: false,
      detail: 'Test DB mock (not connected)',
    }),
  });

  const { baseUrl, close } = await startTestServer(app);
  try {
    // 1. Public health check remains accessible
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as { ok: boolean };
    assert.equal(healthJson.ok, true);

    // 2. Unauthenticated /api/integrations/status redacts coach details
    const anonStatusRes = await fetch(`${baseUrl}/api/integrations/status`);
    assert.equal(anonStatusRes.status, 200);
    const anonStatus = (await anonStatusRes.json()) as {
      auth: { authenticated: boolean; coach: unknown };
      intervalsIcu: { coachAccountIdentity: unknown; coachAthleteId: unknown };
    };
    assert.equal(anonStatus.auth.authenticated, false);
    assert.equal(anonStatus.auth.coach, null);
    assert.equal(anonStatus.intervalsIcu.coachAccountIdentity, null);
    assert.equal(anonStatus.intervalsIcu.coachAthleteId, null);

    // 3. Protected endpoints fail closed with 401 when missing Bearer token
    const protectedEndpoints: Array<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'GET', path: '/api/auth/me' },
      { method: 'POST', path: '/api/integrations/intervals/test' },
      { method: 'POST', path: '/api/integrations/intervals/pilot-test' },
      { method: 'POST', path: '/api/integrations/intervals/validate-roster' },
      { method: 'POST', path: '/api/integrations/intervals/roster-sync' },
      { method: 'GET', path: '/api/integrations/intervals/oauth/url' },
      { method: 'POST', path: '/api/integrations/intervals/disconnect' },
    ];

    for (const ep of protectedEndpoints) {
      const noAuthRes = await fetch(`${baseUrl}${ep.path}`, { method: ep.method });
      assert.equal(noAuthRes.status, 401, `${ep.method} ${ep.path} must return 401 without token`);

      const expiredRes = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: { Authorization: 'Bearer expired-or-invalid-jwt' },
      });
      assert.equal(
        expiredRes.status,
        401,
        `${ep.method} ${ep.path} must return 401 for expired/invalid token`
      );

      // Even if caller spoofs coachId/role in headers & body, 403 user stays rejected
      const forbiddenRes = await fetch(`${baseUrl}${ep.path}`, {
        method: ep.method,
        headers: {
          Authorization: 'Bearer other-user-jwt',
          'Content-Type': 'application/json',
          'x-coach-id': OWNER_COACH.id,
          'x-coach-role': 'owner_coach',
        },
        body:
          ep.method === 'POST'
            ? JSON.stringify({ coachId: OWNER_COACH.id, role: 'Head Coach' })
            : undefined,
      });
      assert.equal(
        forbiddenRes.status,
        403,
        `${ep.method} ${ep.path} must return 403 for non-owner user`
      );
    }

    // 4. Valid owner-coach JWT passes /api/auth/me and authenticated /api/integrations/status
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(meRes.status, 200);
    const meJson = (await meRes.json()) as { ok: boolean; coach: typeof OWNER_COACH };
    assert.equal(meJson.ok, true);
    assert.equal(meJson.coach.id, OWNER_COACH.id);
    assert.equal(meJson.coach.role, 'owner_coach');

    const authStatusRes = await fetch(`${baseUrl}/api/integrations/status`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(authStatusRes.status, 200);
    const authStatus = (await authStatusRes.json()) as {
      auth: { authenticated: boolean; coach: typeof OWNER_COACH | null };
    };
    assert.equal(authStatus.auth.authenticated, true);
    assert.equal(authStatus.auth.coach?.email, OWNER_COACH.email);

    // 5. OAuth callback enforces state validation over HTTP
    const badCb = await fetch(
      `${baseUrl}/api/integrations/intervals/oauth/callback?code=abc&state=tampered`
    );
    assert.equal(badCb.status, 400);
  } finally {
    await close();
  }
});

test('INTERVALS_ICU_API_KEY pilot read-only verification remains preserved without OAuth', async () => {
  resetPilotGateForTesting();
  const prevApiKey = process.env.INTERVALS_ICU_API_KEY;
  process.env.INTERVALS_ICU_API_KEY = 'unit-test-intervals-key';

  try {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/athlete/0')) {
        return new Response(JSON.stringify({ id: 'i-coach', name: 'Mythical Mile Coach' }), {
          status: 200,
        });
      }
      if (url.includes('/athlete-summary.json')) {
        return new Response(
          JSON.stringify([{ athlete_id: 'i-pilot-1', athlete_name: 'Pilot Runner' }]),
          { status: 200 }
        );
      }
      if (url.endsWith('/api/v1/athlete/i-pilot-1')) {
        return new Response(
          JSON.stringify({
            id: 'i-pilot-1',
            name: 'Pilot Runner',
            sportSettings: [{ types: ['Run'], lthr: 168, hr_zones: [130, 145, 158, 168, 178] }],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/activities')) {
        return new Response(
          JSON.stringify([
            {
              id: 'act-1',
              type: 'Run',
              name: 'Tempo 6mi',
              start_date_local: '2026-11-18T07:00:00',
              moving_time: 2640,
              distance: 9656,
              average_heartrate: 166,
              max_heartrate: 175,
              icu_training_load: 72,
            },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/wellness')) {
        return new Response(JSON.stringify([{ id: '2026-11-18', ctl: 54, atl: 61 }]), {
          status: 200,
        });
      }
      return new Response('[]', { status: 200 });
    };

    const pilot = await runIntervalsPilotConnectionTest({
      fetcher: mockFetch,
    });
    assert.equal(pilot.configured, true);
    assert.equal(pilot.authMechanism, 'coach_api_key');
    assert.equal(pilot.oauthRequired, false);
    assert.equal(pilot.pilotTestSucceeded, true);
    assert.equal(pilot.pilotMetricsSummary.detectedLthrBpm, 168);
  } finally {
    if (prevApiKey === undefined) delete process.env.INTERVALS_ICU_API_KEY;
    else process.env.INTERVALS_ICU_API_KEY = prevApiKey;
  }
});

interface MockCoachRow {
  id: string;
  email: string;
  full_name: string;
  organization_name: string;
  role: string;
  is_active: boolean;
}

function createMockSupabaseAdmin(options: {
  authUser: {
    id: string;
    email?: string;
    email_confirmed_at?: string | null;
    user_metadata?: Record<string, unknown>;
  } | null;
  coachesLookupSequence: Array<{ data: MockCoachRow | null; error: { message: string } | null }>;
  countResult?: { count: number | null; error: { message: string } | null };
  insertResult?: { data: MockCoachRow | null; error: { code?: string; message: string } | null };
  onInsertAttempt?: () => void;
}): SupabaseClient {
  let lookupIndex = 0;

  return {
    auth: {
      getUser: async () =>
        options.authUser
          ? { data: { user: options.authUser }, error: null }
          : { data: { user: null }, error: { message: 'Invalid token' } },
    },
    from: (table: string) => {
      assert.equal(table, 'coaches');
      return {
        select: (_columns: string, selectOpts?: { count?: string; head?: boolean }) => {
          if (selectOpts?.head) {
            return Promise.resolve(options.countResult ?? { count: 0, error: null });
          }
          return {
            eq: (_col: string, _val: string) => ({
              maybeSingle: async () => {
                const next =
                  options.coachesLookupSequence[
                    Math.min(lookupIndex, options.coachesLookupSequence.length - 1)
                  ];
                lookupIndex += 1;
                return next;
              },
            }),
          };
        },
        insert: () => {
          options.onInsertAttempt?.();
          return {
            select: () => ({
              single: async () =>
                options.insertResult ?? { data: null, error: { message: 'Not configured' } },
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

test('verifySupabaseJwtAndCoach requires confirmed email before initial owner-coach bootstrap', async () => {
  const prevOwner = process.env.OWNER_COACH_EMAIL;
  process.env.OWNER_COACH_EMAIL = 'owner@mythicalmile.com';

  try {
    let insertAttempted = false;
    const unconfirmedClient = createMockSupabaseAdmin({
      authUser: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'owner@mythicalmile.com',
        email_confirmed_at: null,
      },
      coachesLookupSequence: [{ data: null, error: null }],
      onInsertAttempt: () => {
        insertAttempted = true;
      },
    });

    const res = await verifySupabaseJwtAndCoach('valid-jwt', unconfirmedClient);
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.status, 403);
      assert.match(res.error, /confirmed/i);
    }
    assert.equal(insertAttempted, false);

    // Wrong email even with confirmed timestamp remains rejected with 403
    const otherUserClient = createMockSupabaseAdmin({
      authUser: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'intruder@example.com',
        email_confirmed_at: '2026-11-19T10:00:00Z',
      },
      coachesLookupSequence: [{ data: null, error: null }],
      onInsertAttempt: () => {
        insertAttempted = true;
      },
    });

    const otherRes = await verifySupabaseJwtAndCoach('other-jwt', otherUserClient);
    assert.equal(otherRes.ok, false);
    if (!otherRes.ok) {
      assert.equal(otherRes.status, 403);
    }
    assert.equal(insertAttempted, false);
  } finally {
    if (prevOwner === undefined) delete process.env.OWNER_COACH_EMAIL;
    else process.env.OWNER_COACH_EMAIL = prevOwner;
  }
});

test('verifySupabaseJwtAndCoach handles concurrent owner bootstrap 23505 and count races idempotently and fails closed for others', async () => {
  const prevOwner = process.env.OWNER_COACH_EMAIL;
  process.env.OWNER_COACH_EMAIL = 'owner@mythicalmile.com';

  const ownerId = '11111111-1111-4111-8111-111111111111';
  const ownerRow: MockCoachRow = {
    id: ownerId,
    email: 'owner@mythicalmile.com',
    full_name: 'Owner Coach',
    organization_name: 'Mythical Mile Coaching',
    role: 'owner_coach',
    is_active: true,
  };

  try {
    // Case 1: Concurrent insert triggers PostgreSQL 23505; re-query finds matching active owner_coach
    const conflictSameOwnerClient = createMockSupabaseAdmin({
      authUser: {
        id: ownerId,
        email: 'owner@mythicalmile.com',
        email_confirmed_at: '2026-11-19T10:00:00Z',
      },
      coachesLookupSequence: [
        { data: null, error: null },
        { data: ownerRow, error: null },
      ],
      countResult: { count: 0, error: null },
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value' } },
    });

    const conflictSameRes = await verifySupabaseJwtAndCoach('valid-jwt', conflictSameOwnerClient);
    assert.equal(conflictSameRes.ok, true);
    if (conflictSameRes.ok) {
      assert.equal(conflictSameRes.coach.id, ownerId);
      assert.equal(conflictSameRes.coach.role, 'owner_coach');
    }

    // Case 2: Count sees 1 after initial lookup returned null; re-query confirms same active owner_coach
    const countRaceSameOwnerClient = createMockSupabaseAdmin({
      authUser: {
        id: ownerId,
        email: 'owner@mythicalmile.com',
        email_confirmed_at: '2026-11-19T10:00:00Z',
      },
      coachesLookupSequence: [
        { data: null, error: null },
        { data: ownerRow, error: null },
      ],
      countResult: { count: 1, error: null },
    });

    const countRaceRes = await verifySupabaseJwtAndCoach('valid-jwt', countRaceSameOwnerClient);
    assert.equal(countRaceRes.ok, true);
    if (countRaceRes.ok) {
      assert.equal(countRaceRes.coach.id, ownerId);
    }

    // Case 3: 23505 email conflict where re-query by authUser.id returns null (different auth user) -> 403
    const differentIdConflictClient = createMockSupabaseAdmin({
      authUser: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'owner@mythicalmile.com',
        email_confirmed_at: '2026-11-19T10:00:00Z',
      },
      coachesLookupSequence: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      countResult: { count: 0, error: null },
      insertResult: { data: null, error: { code: '23505', message: 'coaches_email_key' } },
    });

    const diffIdRes = await verifySupabaseJwtAndCoach('valid-jwt', differentIdConflictClient);
    assert.equal(diffIdRes.ok, false);
    if (!diffIdRes.ok) {
      assert.equal(diffIdRes.status, 403);
    }

    // Case 4: 23505 where existing row for same ID is inactive -> 403
    const inactiveOwnerClient = createMockSupabaseAdmin({
      authUser: {
        id: ownerId,
        email: 'owner@mythicalmile.com',
        email_confirmed_at: '2026-11-19T10:00:00Z',
      },
      coachesLookupSequence: [
        { data: null, error: null },
        { data: { ...ownerRow, is_active: false }, error: null },
      ],
      countResult: { count: 0, error: null },
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value' } },
    });

    const inactiveRes = await verifySupabaseJwtAndCoach('valid-jwt', inactiveOwnerClient);
    assert.equal(inactiveRes.ok, false);
    if (!inactiveRes.ok) {
      assert.equal(inactiveRes.status, 403);
    }
  } finally {
    if (prevOwner === undefined) delete process.env.OWNER_COACH_EMAIL;
    else process.env.OWNER_COACH_EMAIL = prevOwner;
  }
});
