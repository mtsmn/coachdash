import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../server.ts';
import type { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { SupabaseOAuthStore } from '../server/oauthStore.ts';
import {
  connectAndVerifyFinalSurgeFeed,
  disconnectFinalSurgeForCoach,
  getFinalSurgeIntegrationMetadata,
  getFinalSurgeStatusForCoach,
  importFinalSurgePlannedWorkouts,
  maskFeedUrl,
  normalizeAndValidateFinalSurgeFeedUrl,
  parseFinalSurgeIcsFeed,
  parseFinalSurgePlannedCsv,
  redactSensitiveText,
  synchronizeFinalSurgePlannedWorkouts,
  testSavedFinalSurgeConnection,
  upsertFinalSurgeAthleteMapping,
} from '../server/finalSurgeClient.ts';
import {
  addPlannedWorkoutsForAthlete,
  getCoachingIntelligence,
} from '../server/coachingIntelligence.ts';

const PREV_TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
}
test.after(() => {
  if (PREV_TOKEN_KEY === undefined) {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  } else {
    process.env.TOKEN_ENCRYPTION_KEY = PREV_TOKEN_KEY;
  }
});

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

function createAuthVerifier(): CoachTokenVerifier {
  return async (token: string) => {
    if (token === 'valid-owner-jwt') return { ok: true, coach: OWNER_COACH };
    if (token === 'other-coach-jwt') return { ok: true, coach: OTHER_COACH };
    return { ok: false, status: 401, error: 'Invalid token' };
  };
}

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

function createMilestone34MockSupabase() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    provider_connections: [],
    provider_connection_credentials: [],
    athletes: [],
    provider_athlete_mappings: [],
    completed_activities: [],
    planned_workouts: [],
    workout_matches: [],
    daily_load_histories: [],
    wellness_records: [],
    provider_training_metrics: [],
    coaching_alerts: [],
    weekly_reports: [],
    audit_events: [],
    synchronization_logs: [],
    heart_rate_streams: [],
    raw_provider_payloads: [],
  };

  function conflictCols(table: string, onConflict?: string): string[] {
    if (onConflict) return onConflict.split(',').map((s) => s.trim());
    if (table === 'provider_connections' || table === 'provider_connection_credentials') {
      return ['coach_id', 'provider'];
    }
    if (table === 'provider_athlete_mappings') return ['athlete_id', 'provider'];
    if (table === 'planned_workouts') return ['athlete_id', 'external_workout_id'];
    if (table === 'raw_provider_payloads') return ['provider', 'source_hash'];
    if (table === 'weekly_reports') return ['athlete_id', 'week_start_date'];
    if (table === 'daily_load_histories') return ['athlete_id', 'methodology', 'load_date'];
    return ['id'];
  }

  function validateConstraints(table: string, row: Record<string, unknown>): string | null {
    if (table === 'provider_connections' || table === 'provider_connection_credentials') {
      if (!['intervals_icu', 'final_surge'].includes(String(row.provider))) {
        return `Invalid provider ${String(row.provider)}`;
      }
    }
    if (table === 'planned_workouts') {
      if (!['final_surge_api', 'final_surge_csv', 'coach_entry'].includes(String(row.source_provider))) {
        return `Invalid source_provider ${String(row.source_provider)}`;
      }
    }
    if (table === 'weekly_reports' && row.email_dispatch_blocked !== true) {
      return 'weekly_reports.email_dispatch_blocked must be true';
    }
    return null;
  }

  function writeRow(
    table: string,
    payload: Record<string, unknown>,
    onConflict?: string,
    forceInsert = false
  ): { row: Record<string, unknown> | null; error: { message: string } | null } {
    const list = tables[table];
    if (!list) return { row: null, error: { message: `Unknown table ${table}` } };

    const cols = conflictCols(table, onConflict);
    const existingIdx = forceInsert
      ? -1
      : list.findIndex((r) => cols.every((c) => r[c] === payload[c]));

    if (forceInsert && table === 'raw_provider_payloads') {
      const dup = list.find(
        (r) => r.provider === payload.provider && r.source_hash === payload.source_hash
      );
      if (dup) return { row: null, error: { message: 'duplicate key value violates unique constraint' } };
    }

    const existing = existingIdx >= 0 ? list[existingIdx] : undefined;
    const now = new Date().toISOString();
    const merged: Record<string, unknown> = {
      id: existing?.id ?? `${table.slice(0, 4)}-${crypto.randomUUID()}`,
      created_at: existing?.created_at ?? now,
      ...existing,
      ...payload,
      updated_at: now,
    };

    const errMsg = validateConstraints(table, merged);
    if (errMsg) return { row: null, error: { message: errMsg } };

    if (existingIdx >= 0) list[existingIdx] = merged;
    else list.push(merged);
    return { row: structuredClone(merged), error: null };
  }

  const client = {
    from: (table: string) => {
      if (!tables[table]) throw new Error(`Unexpected table in mock: ${table}`);

      const runQuery = (
        filters: Array<{ col: string; val: unknown }>,
        orderBy: { col: string; ascending: boolean } | null,
        limitCount: number | null
      ) => {
        let rows = tables[table].filter((r) => filters.every((f) => r[f.col] === f.val));
        if (orderBy) {
          rows = [...rows].sort((a, b) => {
            const va = String(a[orderBy.col] ?? '');
            const vb = String(b[orderBy.col] ?? '');
            return orderBy.ascending ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
        if (limitCount !== null) rows = rows.slice(0, limitCount);
        return rows.map((r) => structuredClone(r));
      };

      return {
        select: (_cols?: string) => {
          const filters: Array<{ col: string; val: unknown }> = [];
          let orderBy: { col: string; ascending: boolean } | null = null;
          let limitCount: number | null = null;
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val });
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
              const rows = runQuery(filters, orderBy, 1);
              return { data: rows[0] ?? null, error: null };
            },
            single: async () => {
              const rows = runQuery(filters, orderBy, 1);
              return {
                data: rows[0] ?? null,
                error: rows[0] ? null : { message: 'Not found' },
              };
            },
            then: (cb: (res: { data: Record<string, unknown>[]; error: null }) => unknown) =>
              Promise.resolve(cb({ data: runQuery(filters, orderBy, limitCount), error: null })),
          };
          return chain;
        },
        insert: (payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const inserted: Array<Record<string, unknown>> = [];
          let lastError: { message: string } | null = null;
          for (const item of items) {
            const res = writeRow(table, item, undefined, true);
            if (res.error) {
              lastError = res.error;
              break;
            }
            if (res.row) inserted.push(res.row);
          }
          const out = {
            data: lastError ? null : Array.isArray(payload) ? inserted : inserted[0],
            error: lastError,
          };
          return {
            select: () => ({
              single: async () => ({
                data: lastError ? null : inserted[0] ?? null,
                error: lastError,
              }),
              then: (cb: (v: typeof out) => unknown) => Promise.resolve(cb(out)),
            }),
            then: (cb: (v: typeof out) => unknown) => Promise.resolve(cb(out)),
          };
        },
        upsert: (
          payload: Record<string, unknown> | Array<Record<string, unknown>>,
          opts?: { onConflict?: string }
        ) => {
          const items = Array.isArray(payload) ? payload : [payload];
          const upserted: Array<Record<string, unknown>> = [];
          let lastError: { message: string } | null = null;
          for (const item of items) {
            const res = writeRow(table, item, opts?.onConflict, false);
            if (res.error) {
              lastError = res.error;
              break;
            }
            if (res.row) upserted.push(res.row);
          }
          const out = {
            data: lastError ? null : Array.isArray(payload) ? upserted : upserted[0],
            error: lastError,
          };
          return {
            select: () => ({
              single: async () => ({
                data: lastError ? null : upserted[0] ?? null,
                error: lastError,
              }),
              then: (cb: (v: typeof out) => unknown) => Promise.resolve(cb(out)),
            }),
            then: (cb: (v: typeof out) => unknown) => Promise.resolve(cb(out)),
          };
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Array<{ col: string; val: unknown }> = [];
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val });
              return chain;
            },
            then: (
              cb: (res: { data: Record<string, unknown>[]; error: { message: string } | null }) => unknown
            ) => {
              const updated: Array<Record<string, unknown>> = [];
              let lastError: { message: string } | null = null;
              for (let i = 0; i < tables[table].length; i++) {
                const row = tables[table][i];
                if (filters.every((f) => row[f.col] === f.val)) {
                  const candidate = { ...row, ...patch, updated_at: new Date().toISOString() };
                  const errMsg = validateConstraints(table, candidate);
                  if (errMsg) {
                    lastError = { message: errMsg };
                    break;
                  }
                  tables[table][i] = candidate;
                  updated.push(structuredClone(candidate));
                }
              }
              return Promise.resolve(cb({ data: updated, error: lastError }));
            },
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
            then: (cb: (res: { data: null; error: null }) => unknown) => {
              tables[table] = tables[table].filter(
                (row) => !filters.every((f) => row[f.col] === f.val)
              );
              return Promise.resolve(cb({ data: null, error: null }));
            },
          };
          return chain;
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    tables,
  };
}

const SAMPLE_ICS_V1 = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Final Surge//Calendar Sync//EN',
  'BEGIN:VEVENT',
  'UID:fs-evt-001',
  'DTSTART:20261116T120000Z',
  'DTEND:20261116T130000Z',
  'SUMMARY:Threshold Cruise 10 km @ 6:50/mi Z4',
  'DESCRIPTION:2 mi warm up\\n3 x 2 mi @ Threshold (6:50/mi, Z4)\\n1 mi cool down',
  'CATEGORIES:Running,Tempo',
  'STATUS:CONFIRMED',
  'LAST-MODIFIED:20261115T100000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:fs-evt-002',
  'DTSTART;VALUE=DATE:20261117',
  'SUMMARY:Rest Day Mobility & Foam Roll',
  'DESCRIPTION:Complete rest from running; 20 min mobility.',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:fs-evt-003',
  'DTSTART;VALUE=DATE:20261118',
  'SUMMARY:Aerobic Base 8 mi',
  'DESCRIPTION:Easy Z2 effort @ 8:05/mi',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const SAMPLE_ICS_V2_UPDATED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:fs-evt-001',
  'DTSTART:20261116T120000Z',
  'DTEND:20261116T130500Z',
  'SUMMARY:Threshold Cruise 12 km @ 6:45/mi Z4',
  'DESCRIPTION:Updated by coach: 2 mi warm up\\n4 x 1.5 mi @ 6:45/mi',
  'CATEGORIES:Running,Tempo',
  'STATUS:CONFIRMED',
  'LAST-MODIFIED:20261115T180000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:fs-evt-002',
  'DTSTART;VALUE=DATE:20261117',
  'SUMMARY:Rest Day Mobility & Foam Roll',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('Milestone 3.4: SSRF protection, webcal normalization, and secret URL masking/redaction', () => {
  const metadata = getFinalSurgeIntegrationMetadata();
  assert.ok(metadata.officialLiveMethod.includes('iCalendar'));
  assert.equal(metadata.references.length >= 2, true);

  // webcal:// upgrades cleanly to https:// for official finalsurge.com hosts
  const okUrl = normalizeAndValidateFinalSurgeFeedUrl(
    'webcal://www.finalsurge.com/calendar/abc123SECRETtoken456.ics'
  );
  assert.equal(okUrl.ok, true);
  if (okUrl.ok) {
    assert.equal(
      okUrl.normalizedUrl,
      'https://www.finalsurge.com/calendar/abc123SECRETtoken456.ics'
    );
    const masked = maskFeedUrl(okUrl.normalizedUrl);
    assert.ok(masked && !masked.includes('abc123SECRETtoken456'));
    assert.ok(masked.endsWith('****.ics'));
    const redacted = redactSensitiveText(`Failed fetching ${okUrl.normalizedUrl}`, [
      okUrl.normalizedUrl,
    ]);
    assert.equal(redacted.includes('abc123SECRETtoken456'), false);
  }

  // Reject unsafe protocols, loopback/private/metadata IPs, userinfo, and third-party hosts
  const blockedUrls = [
    'http://www.finalsurge.com/calendar/feed.ics',
    'https://localhost/calendar/feed.ics',
    'https://127.0.0.1/calendar/feed.ics',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.5/feed.ics',
    'https://10.0.0.2/feed.ics',
    'https://user:pass@www.finalsurge.com/feed.ics',
    'https://evil.example.com/calendar/feed.ics',
  ];
  for (const bad of blockedUrls) {
    const res = normalizeAndValidateFinalSurgeFeedUrl(bad);
    assert.equal(res.ok, false, `Expected ${bad} to be rejected`);
  }
});

test('Milestone 3.4: RFC 5545 ICS parser preserves units, missing distance/duration, structured steps, and folded lines', () => {
  const foldedIcs = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:fs-fold-1',
    'DTSTART:20261119T133000Z',
    'DURATION:PT55M',
    'SUMMARY:Track 800s \\, Progression (5 mi)',
    'DESCRIPTION:Warmup 1.5 mi\\n',
    ' 5 x 800m @ 6:05/mi Z5\\nCooldown 1 mi',
    'CATEGORIES:Intervals',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fs-nomedia-2',
    'DTSTART;VALUE=DATE:20261120',
    'SUMMARY:Core & Strength Session',
    'DESCRIPTION:General strength routine — no mileage target',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const parsed = parseFinalSurgeIcsFeed(foldedIcs);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.events.length, 2);

  const track = parsed.events[0];
  assert.equal(track.workoutDate, '2026-11-19');
  assert.equal(track.plannedStartTime, '13:30:00');
  assert.equal(track.workoutType, 'Intervals');
  assert.equal(track.plannedMiles, 5);
  assert.equal(track.plannedDurationMin, 55);
  assert.equal(track.targetPaceSecPerMile, 365);
  assert.equal(track.targetZone, 'Z5');
  assert.equal(track.structuredSteps.length, 3);

  const strength = parsed.events[1];
  assert.equal(strength.plannedMiles, 0);
  assert.equal(strength.plannedDurationMin, 0);

  // Unit conversion check (10 km -> 6.21 mi while keeping original km unit metadata)
  const kmParsed = parseFinalSurgeIcsFeed(SAMPLE_ICS_V1);
  assert.equal(kmParsed.ok, true);
  assert.equal(kmParsed.events[0].originalDistanceValue, 10);
  assert.equal(kmParsed.events[0].originalDistanceUnit, 'km');
  assert.equal(kmParsed.events[0].plannedMiles, 6.21);
});

test('Milestone 3.4: safe coach-scoped athlete mapping links to existing Intervals pilot without duplication and blocks name-only auto-merge', async () => {
  const db = createMilestone34MockSupabase();
  const athPilotId = 'bbbb0000-0000-4000-8000-000000000101';
  const athSecondId = 'bbbb0000-0000-4000-8000-000000000102';
  const athOtherCoachId = 'cccc0000-0000-4000-8000-000000000999';

  db.tables.athletes.push(
    {
      id: athPilotId,
      coach_id: OWNER_COACH.id,
      full_name: 'Pbutterworth',
      email: 'pbutterworth@example.com',
      training_group: 'Marathon',
      current_phase: 'Build',
      data_origin: 'live',
    },
    {
      id: athSecondId,
      coach_id: OWNER_COACH.id,
      full_name: 'Alex Runner',
      email: 'alex@example.com',
      training_group: 'Half',
      current_phase: 'Base',
      data_origin: 'live',
    },
    {
      id: athOtherCoachId,
      coach_id: OTHER_COACH.id,
      full_name: 'Foreign Athlete',
      email: 'foreign@example.com',
      training_group: '10K',
      current_phase: 'Base',
      data_origin: 'live',
    }
  );
  // Pre-existing Intervals.icu mapping on Pbutterworth
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athPilotId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
    authorization_status: 'Authorized (Read-Only)',
    match_status: 'Verified Match',
    match_method: 'Verified Pilot Match',
    match_confidence_pct: 100,
  });

  const store = new SupabaseOAuthStore(() => db.client);

  // Name-only auto_match MUST be blocked into Candidate Review Required
  const nameOnlyRes = await upsertFinalSurgeAthleteMapping({
    coachId: OWNER_COACH.id,
    athleteId: athSecondId,
    externalAthleteId: 'fs-999',
    externalName: 'Alex Runner',
    action: 'auto_match',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(nameOnlyRes.ok, true);
  assert.equal(nameOnlyRes.matchStatus, 'Candidate Review Required');
  assert.equal(nameOnlyRes.matchMethod, 'Name-Only Blocked (Manual Review Required)');

  // Exact unique email auto_match succeeds
  const emailRes = await upsertFinalSurgeAthleteMapping({
    coachId: OWNER_COACH.id,
    athleteId: athSecondId,
    externalAthleteId: 'fs-999',
    externalEmail: 'alex@example.com',
    action: 'auto_match',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(emailRes.ok, true);
  assert.equal(emailRes.matchStatus, 'Verified Match');
  assert.equal(emailRes.matchMethod, 'Exact Email Match');

  // Duplicate external_athlete_id across same coach MUST return 409 conflict
  const conflictRes = await upsertFinalSurgeAthleteMapping({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    externalAthleteId: 'fs-999',
    action: 'confirm',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(conflictRes.ok, false);
  assert.equal(conflictRes.statusCode, 409);

  // Explicit confirmation with unique external ID maps cleanly without duplicating athlete or overwriting Intervals.icu mapping
  const pilotConfirmRes = await upsertFinalSurgeAthleteMapping({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    externalAthleteId: 'fs-pbutterworth',
    action: 'confirm',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(pilotConfirmRes.ok, true);
  assert.equal(pilotConfirmRes.matchStatus, 'Verified Match');
  assert.equal(db.tables.athletes.length, 3);
  const icuMap = db.tables.provider_athlete_mappings.find(
    (m) => m.athlete_id === athPilotId && m.provider === 'intervals_icu'
  );
  assert.equal(icuMap?.external_athlete_id, 'i509214');

  // Cross-coach athlete access returns 404
  const crossRes = await upsertFinalSurgeAthleteMapping({
    coachId: OWNER_COACH.id,
    athleteId: athOtherCoachId,
    externalAthleteId: 'fs-hack',
    action: 'confirm',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(crossRes.ok, false);
  assert.equal(crossRes.statusCode, 404);
});

test('Milestone 3.4: live feed verification honesty, encrypted storage, restart survival, incremental sync updates/deletions, and manual coach_entry protection', async () => {
  const db = createMilestone34MockSupabase();
  const athPilotId = 'bbbb0000-0000-4000-8000-000000000201';
  db.tables.athletes.push({
    id: athPilotId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    email: 'pbutterworth@example.com',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: 168,
    threshold_pace_sec_per_mile: 410,
    data_origin: 'live',
  });

  const store1 = new SupabaseOAuthStore(() => db.client);
  const privateFeedUrl = 'https://www.finalsurge.com/Calendar/ics/PRIVATE_SECRET_FEED_TOKEN_8899.ics';

  // 1) Failed fetch (404) must NOT mark Final Surge connected
  const failFeed = await connectAndVerifyFinalSurgeFeed({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    feedUrl: privateFeedUrl,
    externalAthleteId: 'fs-pb-1',
    supabaseClient: db.client,
    oauthStore: store1,
    sleep: async () => undefined,
    fetcher: async () => new Response('Not found', { status: 404 }),
  });
  assert.equal(failFeed.ok, false);
  assert.equal(failFeed.connected, false);
  assert.equal(failFeed.errorMessage?.includes('PRIVATE_SECRET_FEED_TOKEN_8899'), false);

  const statusAfterFail = await getFinalSurgeStatusForCoach({
    coachId: OWNER_COACH.id,
    includeSensitiveDetails: true,
    supabaseClient: db.client,
    oauthStore: store1,
  });
  assert.equal(statusAfterFail.connected, false);

  // 2) Live verified feed marks connected = true and encrypts URL in provider_connection_credentials
  const okFeed = await connectAndVerifyFinalSurgeFeed({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    feedUrl: privateFeedUrl,
    externalAthleteId: 'fs-pb-1',
    supabaseClient: db.client,
    oauthStore: store1,
    sleep: async () => undefined,
    fetcher: async () => new Response(SAMPLE_ICS_V1, { status: 200 }),
  });
  assert.equal(okFeed.ok, true);
  assert.equal(okFeed.connected, true);
  assert.equal(okFeed.activePlannedCount, 3);
  assert.ok(okFeed.maskedFeedUrl && !okFeed.maskedFeedUrl.includes('PRIVATE_SECRET_FEED_TOKEN_8899'));

  // Raw URL must NEVER appear plaintext in credentials table, snapshots, sync logs, or audit events
  const serializedDb = JSON.stringify(db.tables);
  assert.equal(serializedDb.includes('PRIVATE_SECRET_FEED_TOKEN_8899'), false);
  assert.equal(db.tables.provider_connection_credentials.length, 1);

  // 3) Simulate server restart with fresh SupabaseOAuthStore backed by same DB
  const storeAfterRestart = new SupabaseOAuthStore(() => db.client);
  const statusRestart = await getFinalSurgeStatusForCoach({
    coachId: OWNER_COACH.id,
    includeSensitiveDetails: true,
    supabaseClient: db.client,
    oauthStore: storeAfterRestart,
  });
  assert.equal(statusRestart.connected, true);
  assert.equal(statusRestart.mappedAthletes[0].hasFeedUrl, true);
  assert.equal(statusRestart.mappedAthletes[0].maskedFeedUrl?.includes('PRIVATE_SECRET_FEED_TOKEN_8899'), false);

  // Add a manual coach_entry workout before syncing
  const manualRes = await addPlannedWorkoutsForAthlete({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    workouts: [
      {
        workoutDate: '2026-11-16',
        title: 'Coach Manual Strides Add-On',
        workoutType: 'Easy',
        plannedMiles: 2,
        plannedDurationMin: 16,
      },
    ],
    supabaseClient: db.client,
  });
  assert.equal(manualRes.ok, true);

  // 4) Initial sync inserts 3 Final Surge planned workouts and preserves manual entry
  let currentIcs = SAMPLE_ICS_V1;
  const dynamicFetcher: typeof fetch = async () => new Response(currentIcs, { status: 200 });

  const sync1 = await synchronizeFinalSurgePlannedWorkouts({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    mode: 'initial',
    supabaseClient: db.client,
    oauthStore: storeAfterRestart,
    fetcher: dynamicFetcher,
    sleep: async () => undefined,
  });
  assert.equal(sync1.ok, true);
  assert.equal(sync1.insertedCount, 3);
  assert.equal(sync1.updatedCount, 0);
  assert.equal(sync1.deletedCount, 0);
  assert.equal(sync1.preservedManualCount, 1);

  // 5) Immediate re-sync is idempotent (all unchanged -> duplicatesSkipped = 3)
  const sync2 = await synchronizeFinalSurgePlannedWorkouts({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    mode: 'incremental',
    supabaseClient: db.client,
    oauthStore: storeAfterRestart,
    fetcher: dynamicFetcher,
    sleep: async () => undefined,
  });
  assert.equal(sync2.ok, true);
  assert.equal(sync2.insertedCount, 0);
  assert.equal(sync2.updatedCount, 0);
  assert.equal(sync2.duplicatesSkipped, 3);

  // 6) Updated workout + cancelled workout + removed workout in feed window updates 1, deletes 2, leaves manual untouched
  currentIcs = SAMPLE_ICS_V2_UPDATED;
  const sync3 = await synchronizeFinalSurgePlannedWorkouts({
    coachId: OWNER_COACH.id,
    athleteId: athPilotId,
    mode: 'incremental',
    startDate: '2026-11-16',
    endDate: '2026-11-18',
    supabaseClient: db.client,
    oauthStore: storeAfterRestart,
    fetcher: dynamicFetcher,
    sleep: async () => undefined,
  });
  assert.equal(sync3.ok, true);
  assert.equal(sync3.updatedCount, 1);
  assert.equal(sync3.deletedCount, 2);
  assert.equal(sync3.preservedManualCount, 1);

  const manualStillThere = db.tables.planned_workouts.find(
    (w) => w.source_provider === 'coach_entry' && w.title === 'Coach Manual Strides Add-On'
  );
  assert.ok(manualStillThere, 'Manual coach_entry workout must NEVER be deleted or overwritten');

  const updatedFsRow = db.tables.planned_workouts.find(
    (w) => w.external_workout_id === 'fs-evt-001'
  );
  assert.equal(updatedFsRow?.title, 'Threshold Cruise 12 km @ 6:45/mi Z4');
  assert.equal(updatedFsRow?.planned_miles, 7.46);
});

test('Milestone 3.4: retry on transient 503 failure, disconnect invalidation, and historical CSV/ICS export import', async () => {
  const db = createMilestone34MockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000301';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    email: 'pb@example.com',
    training_group: 'Marathon',
    current_phase: 'Build',
    data_origin: 'live',
  });
  const store = new SupabaseOAuthStore(() => db.client);
  const url = 'https://www.finalsurge.com/Calendar/ics/RETRY_TOKEN_XYZ.ics';

  let attempts = 0;
  const flakyFetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts < 3) return new Response('Upstream busy', { status: 503 });
    return new Response(SAMPLE_ICS_V1, { status: 200 });
  };

  const connectRes = await connectAndVerifyFinalSurgeFeed({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    feedUrl: url,
    supabaseClient: db.client,
    oauthStore: store,
    fetcher: flakyFetcher,
    sleep: async () => undefined,
  });
  assert.equal(connectRes.ok, true);
  assert.equal(attempts, 3);

  // Re-test fails when upstream stays 503 -> marks disconnected honestly
  const failingTest = await testSavedFinalSurgeConnection({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    supabaseClient: db.client,
    oauthStore: store,
    fetcher: async () => new Response('Service down', { status: 503 }),
    sleep: async () => undefined,
  });
  assert.equal(failingTest.ok, false);
  assert.equal(failingTest.connected, false);

  // Import historical Final Surge CSV with date range filtering
  const csvContent = [
    'Date,Title,Type,DistanceMiles,DurationMinutes,TargetPace,TargetZone,Description',
    '2026-10-01,Out Of Range Run,Easy,5.0,42,8:24,Z2,Should be filtered out',
    '2026-10-15,Historical Tempo,Tempo,7.0,49,7:00,Z4,4 mi tempo inside 6 mi total',
    '2026-10-20,Historical Long Run,Long Run,16.0,128,8:00,Z2,Steady aerobic endurance',
  ].join('\n');

  const csvParsed = parseFinalSurgePlannedCsv(csvContent);
  assert.equal(csvParsed.events.length, 3);

  const importRes = await importFinalSurgePlannedWorkouts({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    format: 'csv',
    content: csvContent,
    startDate: '2026-10-10',
    endDate: '2026-10-31',
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(importRes.ok, true);
  assert.equal(importRes.insertedCount, 2);
  assert.equal(
    db.tables.planned_workouts.some((w) => w.workout_date === '2026-10-01'),
    false
  );

  // Disconnect clears credentials and resets connected state
  await disconnectFinalSurgeForCoach({
    coachId: OWNER_COACH.id,
    oauthStore: store,
    supabaseClient: db.client,
  });
  const afterDisconnect = await getFinalSurgeStatusForCoach({
    coachId: OWNER_COACH.id,
    includeSensitiveDetails: true,
    supabaseClient: db.client,
    oauthStore: store,
  });
  assert.equal(afterDisconnect.connected, false);
  assert.equal(db.tables.provider_connection_credentials.length, 0);
});

test('Milestone 3.4: end-to-end planned workout sync preserves Final Surge planned workouts without emitting compliance scores or alerts', async () => {
  const db = createMilestone34MockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000401';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    email: 'pb@example.com',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: 168,
    threshold_pace_sec_per_mile: 410,
    data_origin: 'live',
  });
  db.tables.provider_connections.push({
    coach_id: OWNER_COACH.id,
    provider: 'intervals_icu',
    auth_mode: 'api_key',
    connected: true,
    pilot_test_succeeded: true,
    verified_pilot_athlete_id: 'i509214',
    last_synchronized_at: '2026-11-16T22:00:00Z',
  });
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
    authorization_status: 'Authorized (Read-Only)',
    match_status: 'Verified Match',
    match_method: 'Verified Pilot Match',
    match_confidence_pct: 100,
  });

  // Completed activity on 2026-11-16 (synced from Intervals.icu)
  db.tables.completed_activities.push({
    id: 'act-1116',
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    external_activity_id: 'icu-act-1116',
    provider: 'intervals_icu',
    activity_date: '2026-11-16',
    start_time_local: '07:05:00',
    title: 'Morning Tempo Run',
    activity_type: 'Tempo',
    distance_miles: 6.2,
    duration_minutes: 45,
    avg_pace_sec_per_mile: 435,
    avg_hr_bpm: 164,
    max_hr_bpm: 176,
    hr_data_state: 'valid',
  });

  // Latest Intervals.icu sync ended on 2026-11-16, while current anchor is 2026-11-19
  db.tables.synchronization_logs.push({
    coach_id: OWNER_COACH.id,
    provider: 'intervals_icu',
    job_type: 'daily_activity_import',
    status: 'Failed',
    attempt_number: 1,
    records_processed: 0,
    duplicates_skipped: 0,
    started_at: '2026-11-18T10:00:00Z',
    finished_at: '2026-11-18T10:00:05Z',
  });

  const store = new SupabaseOAuthStore(() => db.client);
  await connectAndVerifyFinalSurgeFeed({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    feedUrl: 'https://www.finalsurge.com/Calendar/ics/MATCH_TEST_FEED.ics',
    externalAthleteId: 'fs-match-1',
    supabaseClient: db.client,
    oauthStore: store,
    fetcher: async () => new Response(SAMPLE_ICS_V1, { status: 200 }),
    sleep: async () => undefined,
  });

  const syncRes = await synchronizeFinalSurgePlannedWorkouts({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    mode: 'initial',
    supabaseClient: db.client,
    oauthStore: store,
    fetcher: async () => new Response(SAMPLE_ICS_V1, { status: 200 }),
    sleep: async () => undefined,
  });
  assert.equal(syncRes.ok, true);

  const intel = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    persist: true,
    supabaseClient: db.client,
    oauthStore: store,
    nowIso: '2026-11-19T12:00:00Z',
  });
  assert.equal(intel.ok, true);
  assert.ok(Array.isArray(intel.plannedWorkouts));

  const nov16 = intel.plannedWorkouts.find((p) => p.workoutDate === '2026-11-16');
  assert.ok(nov16);
  assert.equal(nov16.sourceProvider, 'final_surge_api');
  assert.equal(nov16.originalDistanceLabel, '10 km');

  const nov18 = intel.plannedWorkouts.find((p) => p.workoutDate === '2026-11-18');
  assert.ok(nov18);

  const complianceAlerts = intel.alerts.filter(
    (a) =>
      a.domain === 'compliance' ||
      a.category === 'Workout Compliance' ||
      a.title.includes('Missed planned workout')
  );
  assert.equal(complianceAlerts.length, 0);
});

test('Milestone 3.4: HTTP endpoints enforce auth, preserve Demo Mode status, and execute connect -> sync -> disconnect over Express', async () => {
  const db = createMilestone34MockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000501';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    email: 'pb@example.com',
    training_group: 'Marathon',
    current_phase: 'Build',
    data_origin: 'live',
  });

  const store = new SupabaseOAuthStore(() => db.client);
  const app = await createApp({
    mountFrontend: false,
    supabaseClient: db.client,
    oauthStore: store,
    authVerifier: createAuthVerifier(),
    finalSurgeFetcher: async () => new Response(SAMPLE_ICS_V1, { status: 200 }),
    allowCustomFinalSurgeHostForTesting: true,
  });

  const server = await startTestServer(app);
  try {
    // Public status preserves Demo-compatible response without auth
    const pubStatus = await fetch(`${server.baseUrl}/api/integrations/status`);
    assert.equal(pubStatus.status, 200);
    const pubJson = (await pubStatus.json()) as {
      finalSurge: { connected: boolean; apiAvailability: string };
      database: { mode: string };
    };
    assert.ok(pubJson.database.mode.includes('Demo'));
    assert.equal(pubJson.finalSurge.connected, false);
    assert.ok(pubJson.finalSurge.apiAvailability.includes('iCalendar'));

    // Unauthenticated call to Final Surge endpoints returns 401
    const unauth = await fetch(`${server.baseUrl}/api/integrations/final-surge/status`);
    assert.equal(unauth.status, 401);

    // Other coach cannot connect feed to owner coach's athlete (404)
    const crossFeed = await fetch(`${server.baseUrl}/api/integrations/final-surge/connect-feed`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer other-coach-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        athleteId: athId,
        feedUrl: 'https://www.finalsurge.com/Calendar/ics/CROSS_COACH.ics',
      }),
    });
    assert.equal(crossFeed.status, 404);

    // Owner coach connects verified feed and syncs planned workouts
    const connectResp = await fetch(`${server.baseUrl}/api/integrations/final-surge/connect-feed`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        athleteId: athId,
        feedUrl: 'https://www.finalsurge.com/Calendar/ics/OWNER_FEED_SECRET_777.ics',
        externalAthleteId: 'fs-owner-1',
      }),
    });
    assert.equal(connectResp.status, 200);
    const connectBody = (await connectResp.json()) as { ok: boolean; connected: boolean };
    assert.equal(connectBody.ok, true);
    assert.equal(connectBody.connected, true);

    const syncResp = await fetch(`${server.baseUrl}/api/integrations/final-surge/sync`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-owner-jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        athleteId: athId,
        mode: 'initial',
      }),
    });
    assert.equal(syncResp.status, 200);
    const syncBody = (await syncResp.json()) as { ok: boolean; insertedCount: number };
    assert.equal(syncBody.ok, true);
    assert.equal(syncBody.insertedCount, 3);

    // Authenticated status now reflects connected: true and masks URL
    const authStatusResp = await fetch(`${server.baseUrl}/api/integrations/final-surge/status`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(authStatusResp.status, 200);
    const authStatusBody = (await authStatusResp.json()) as {
      connected: boolean;
      mappedAthletes: Array<{ maskedFeedUrl: string | null }>;
    };
    assert.equal(authStatusBody.connected, true);
    assert.equal(
      authStatusBody.mappedAthletes[0].maskedFeedUrl?.includes('OWNER_FEED_SECRET_777'),
      false
    );

    // Disconnect invalidates Final Surge session cleanly
    const discResp = await fetch(`${server.baseUrl}/api/integrations/final-surge/disconnect`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(discResp.status, 200);

    const postDisc = await fetch(`${server.baseUrl}/api/integrations/final-surge/status`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    const postDiscBody = (await postDisc.json()) as { connected: boolean };
    assert.equal(postDiscBody.connected, false);
  } finally {
    await server.close();
  }
});
