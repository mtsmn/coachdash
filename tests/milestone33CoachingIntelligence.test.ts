import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../server.ts';
import type { CoachTokenVerifier } from '../server/authMiddleware.ts';
import { SupabaseOAuthStore } from '../server/oauthStore.ts';
import {
  addPlannedWorkoutsForAthlete,
  getCoachingIntelligence,
  updateCoachingAlertStatus,
  updateWeeklyReportCoachState,
} from '../server/coachingIntelligence.ts';
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

function createIntelligenceMockSupabase() {
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
    if (table === 'weekly_reports') return ['athlete_id', 'week_start_date'];
    if (table === 'daily_load_histories') return ['athlete_id', 'methodology', 'load_date'];
    return ['id'];
  }

  function validateConstraints(table: string, row: Record<string, unknown>): string | null {
    if (table === 'weekly_reports') {
      if (row.email_dispatch_blocked !== true) {
        return 'weekly_reports.email_dispatch_blocked must be true';
      }
      if (
        row.compliance_pct !== null &&
        row.compliance_pct !== undefined &&
        (Number(row.compliance_pct) < 0 || Number(row.compliance_pct) > 200)
      ) {
        return 'weekly_reports.compliance_pct out of range';
      }
    }
    if (table === 'coaching_alerts') {
      const allowed = [
        'High priority: Coach review recommended',
        'Moderate priority: Monitor',
        'Positive development',
        'Insufficient data',
      ];
      if (!allowed.includes(String(row.classification))) {
        return `Invalid classification ${String(row.classification)}`;
      }
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
      if (!tables[table]) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
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
            then: (cb: (res: { data: Record<string, unknown>[]; error: { message: string } | null }) => unknown) => {
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
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    tables,
  };
}

test('Milestone 3.3: resolves athlete strictly by ID and coach ownership (never by roster order)', async () => {
  const db = createIntelligenceMockSupabase();
  const athOtherId = 'aaaa0000-0000-4000-8000-000000000001';
  const athPilotId = 'bbbb0000-0000-4000-8000-000000000002';
  const athForeignId = 'cccc0000-0000-4000-8000-000000000003';

  // Insert another athlete first in roster order, and the verified pilot athlete second
  db.tables.athletes.push(
    {
      id: athOtherId,
      coach_id: OWNER_COACH.id,
      full_name: 'First In Roster Athlete',
      training_group: '10K',
      current_phase: 'Base',
      data_origin: 'live',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: athPilotId,
      coach_id: OWNER_COACH.id,
      full_name: 'Pbutterworth Pilot',
      training_group: 'Marathon',
      current_phase: 'Build',
      active_lthr_bpm: 168,
      data_origin: 'live',
      created_at: '2026-01-02T00:00:00Z',
    },
    {
      id: athForeignId,
      coach_id: OTHER_COACH.id,
      full_name: 'Other Coach Athlete',
      training_group: 'Marathon',
      current_phase: 'Base',
      data_origin: 'live',
      created_at: '2026-01-03T00:00:00Z',
    }
  );

  db.tables.provider_connections.push({
    coach_id: OWNER_COACH.id,
    provider: 'intervals_icu',
    auth_mode: 'api_key',
    connected: true,
    pilot_test_succeeded: true,
    verified_pilot_athlete_id: 'i509214',
  });
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athPilotId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
  });

  const store = new SupabaseOAuthStore(() => db.client);

  // Default call resolves strictly to verified pilot mapping (NOT first athlete in roster)
  const pilotRes = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    supabaseClient: db.client,
    oauthStore: store,
    nowIso: '2026-11-18T12:00:00Z',
  });
  assert.equal(pilotRes.ok, true);
  assert.equal(pilotRes.athlete?.id, athPilotId);
  assert.equal(pilotRes.athlete?.externalAthleteId, 'i509214');

  // Explicit athleteId owned by coach resolves that exact athlete
  const explicitRes = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athOtherId,
    supabaseClient: db.client,
    oauthStore: store,
    nowIso: '2026-11-18T12:00:00Z',
  });
  assert.equal(explicitRes.ok, true);
  assert.equal(explicitRes.athlete?.id, athOtherId);

  // Requesting another coach's athleteId must return 404 (strict ownership isolation)
  const crossCoachRes = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athForeignId,
    supabaseClient: db.client,
    oauthStore: store,
    nowIso: '2026-11-18T12:00:00Z',
  });
  assert.equal(crossCoachRes.ok, false);
  assert.equal(crossCoachRes.statusCode, 404);
});

test('Milestone 3.3: separates System C vs Provider Native load, preserves missing data, and leaves compliance_pct null on reports', async () => {
  const db = createIntelligenceMockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000010';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: null, // Intentionally missing LTHR
    threshold_pace_sec_per_mile: null,
    data_origin: 'live',
  });
  db.tables.provider_connections.push({
    coach_id: OWNER_COACH.id,
    provider: 'intervals_icu',
    auth_mode: 'api_key',
    connected: true,
    pilot_test_succeeded: true,
    verified_pilot_athlete_id: 'i509214',
  });
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
  });

  // Two persisted runs: one missing HR, one valid HR, plus native Intervals.icu load
  db.tables.completed_activities.push(
    {
      id: 'act-1',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      activity_date: '2026-11-10',
      title: 'Tuesday Easy Run',
      activity_type: 'Easy',
      status: 'Completed',
      duration_minutes: 45,
      distance_miles: 5.5,
      avg_pace_sec_per_mile: 491,
      avg_hr_bpm: 145,
      max_hr_bpm: 158,
      hr_data_state: 'valid',
    },
    {
      id: 'act-2',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      activity_date: '2026-11-14',
      title: 'Saturday Long Run (No Strap)',
      activity_type: 'Long Run',
      status: 'Completed',
      duration_minutes: 95,
      distance_miles: 11.2,
      avg_pace_sec_per_mile: 509,
      avg_hr_bpm: null,
      max_hr_bpm: null,
      hr_data_state: 'missing',
    }
  );

  db.tables.provider_training_metrics.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    activity_id: 'act-1',
    metric_date: '2026-11-10',
    icu_training_load: 62,
    icu_fitness: 41.2,
    icu_fatigue: 48.0,
    icu_form: -6.8,
  });
  db.tables.wellness_records.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    record_date: '2026-11-15',
    resting_hr_bpm: 51,
    hrv_rmssd: 64.5,
    hrv_status: 'Balanced',
    sleep_hours: 7.4,
    icu_ctl: 42.1,
    icu_atl: 47.5,
  });

  const store = new SupabaseOAuthStore(() => db.client);
  const res = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    persist: true,
    nowIso: '2026-11-18T12:00:00Z',
    supabaseClient: db.client,
    oauthStore: store,
  });

  assert.equal(res.ok, true);
  assert.ok(res.loadIntelligence);
  assert.deepEqual(res.plannedWorkouts, []);

  // System C must report unavailable honestly rather than substituting Intervals.icu CTL/ATL
  assert.equal(res.loadIntelligence.systemC.available, false);
  assert.equal(res.loadIntelligence.systemC.ctl, null);
  assert.equal(res.loadIntelligence.systemC.atl, null);
  assert.equal(res.loadIntelligence.systemC.tsb, null);

  // Provider native kept separate and explicitly marked non-TSS
  assert.equal(res.loadIntelligence.providerNative.available, true);
  assert.equal(res.loadIntelligence.providerNative.icuCtl, 42.1);
  assert.equal(res.loadIntelligence.providerNative.isTssEquivalent, false);

  // Persisted weekly reports omit compliancePct on DTO and keep compliance_pct = null in DB + email_dispatch_blocked = true
  assert.ok(res.weeklyReports.length >= 1);
  for (const rep of res.weeklyReports) {
    assert.equal('compliancePct' in rep, false);
    assert.equal(rep.emailDispatchBlocked, true);
  }
  assert.ok(db.tables.weekly_reports.every((r) => r.compliance_pct === null));

  // Insufficient data findings generated for load without compliance findings
  assert.equal(
    res.alerts.some((a) => a.domain === 'compliance' || a.category === 'Workout Compliance'),
    false
  );
  assert.ok(
    res.alerts.some((a) => a.classification === 'Insufficient data' && a.domain === 'load')
  );
});

test('Milestone 3.3: preserves planned workouts, persists load/recovery alerts, and supports coach report approval', async () => {
  const db = createIntelligenceMockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000020';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: 170,
    threshold_pace_sec_per_mile: 405,
    data_origin: 'live',
  });
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
  });

  // Seed 20 days of System C daily load with elevated acute fatigue (TSB -21.5)
  for (let d = 1; d <= 20; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    if (date > '2026-11-18') break;
    db.tables.daily_load_histories.push({
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      methodology: 'hr_derived_stress',
      load_date: date,
      daily_stress: d >= 14 ? 95 : 48,
      ctl: 44.0 + d * 0.4,
      atl: d === 18 ? 72.7 : 55.0,
      tsb: d === 18 ? -21.5 : -7.0,
      has_missing_or_invalid_hr: false,
    });
  }

  // Planned workouts in week Nov 9–15, 2026:
  // 1) Nov 10 Easy 6mi -> completed as planned (6.1mi)
  // 2) Nov 12 Tempo 8mi -> completed modified (5.0mi)
  // 3) Nov 14 Long Run 14mi -> missed (no activity)
  // Plus unplanned Nov 15 Recovery 3mi
  db.tables.planned_workouts.push(
    {
      id: 'plan-1',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      source_provider: 'coach_entry',
      workout_date: '2026-11-10',
      title: 'Easy Aerobic 6',
      workout_type: 'Easy',
      planned_miles: 6.0,
      planned_duration_min: 52,
      target_pace_sec_per_mile: 520,
      target_zone: 'Z2',
    },
    {
      id: 'plan-2',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      source_provider: 'coach_entry',
      workout_date: '2026-11-12',
      title: 'Lactate Tempo 8',
      workout_type: 'Tempo',
      planned_miles: 8.0,
      planned_duration_min: 58,
      target_pace_sec_per_mile: 415,
      target_zone: 'Z4',
    },
    {
      id: 'plan-3',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      source_provider: 'coach_entry',
      workout_date: '2026-11-14',
      title: 'Saturday Long Run 14',
      workout_type: 'Long Run',
      planned_miles: 14.0,
      planned_duration_min: 118,
      target_pace_sec_per_mile: 505,
      target_zone: 'Z2',
    }
  );

  db.tables.completed_activities.push(
    {
      id: 'act-10',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      activity_date: '2026-11-10',
      title: 'Morning Easy 6',
      activity_type: 'Easy',
      status: 'Completed',
      duration_minutes: 53,
      distance_miles: 6.1,
      avg_pace_sec_per_mile: 521,
      avg_hr_bpm: 146,
      max_hr_bpm: 157,
      hr_data_state: 'valid',
    },
    {
      id: 'act-12',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      activity_date: '2026-11-12',
      title: 'Shortened Tempo',
      activity_type: 'Tempo',
      status: 'Completed',
      duration_minutes: 37,
      distance_miles: 5.0,
      avg_pace_sec_per_mile: 425,
      avg_hr_bpm: 168,
      max_hr_bpm: 176,
      hr_data_state: 'valid',
    },
    {
      id: 'act-15',
      coach_id: OWNER_COACH.id,
      athlete_id: athId,
      activity_date: '2026-11-15',
      title: 'Unplanned Shakeout',
      activity_type: 'Recovery',
      status: 'Completed',
      duration_minutes: 28,
      distance_miles: 3.0,
      avg_pace_sec_per_mile: 560,
      avg_hr_bpm: 132,
      max_hr_bpm: 140,
      hr_data_state: 'valid',
    }
  );

  const store = new SupabaseOAuthStore(() => db.client);
  const res = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    persist: true,
    nowIso: '2026-11-18T12:00:00Z',
    supabaseClient: db.client,
    oauthStore: store,
  });

  assert.equal(res.ok, true);
  assert.equal(res.plannedWorkouts.length, 3);
  assert.equal(
    res.alerts.some((a) => a.domain === 'compliance' || a.category === 'Workout Compliance'),
    false
  );

  // High priority alert generated for TSB <= -20
  const loadAlert = res.alerts.find(
    (a) =>
      a.classification === 'High priority: Coach review recommended' &&
      a.domain === 'load'
  );
  assert.ok(loadAlert && loadAlert.id);

  // Acknowledge alert and verify status persists across re-analysis
  const ackRes = await updateCoachingAlertStatus({
    coachId: OWNER_COACH.id,
    alertId: loadAlert.id!,
    status: 'acknowledged',
    supabaseClient: db.client,
  });
  assert.equal(ackRes.ok, true);

  // Save coach note & approve weekly report for 2026-11-09 week
  const targetWeekRep = res.weeklyReports.find((r) => r.weekStartDate === '2026-11-09');
  assert.ok(targetWeekRep);
  assert.equal('compliancePct' in targetWeekRep, false);

  const repUpdate = await updateWeeklyReportCoachState({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    weekStartDate: '2026-11-09',
    coachNote: 'Reduce Thursday intensity; prioritize sleep.',
    status: 'Approved',
    supabaseClient: db.client,
  });
  assert.equal(repUpdate.ok, true);

  // Re-run analysis and confirm alert acknowledged status & report approval/note survived
  const rerun = await getCoachingIntelligence({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    persist: true,
    nowIso: '2026-11-18T12:00:00Z',
    supabaseClient: db.client,
    oauthStore: store,
  });
  const rerunAlert = rerun.alerts.find((a) => a.id === loadAlert.id);
  assert.equal(rerunAlert?.status, 'acknowledged');
  const rerunRep = rerun.weeklyReports.find((r) => r.weekStartDate === '2026-11-09');
  assert.equal(rerunRep?.status, 'Approved');
  assert.equal(rerunRep?.coachNote, 'Reduce Thursday intensity; prioritize sleep.');
  assert.equal(rerunRep?.emailDispatchBlocked, true);
});

test('Milestone 3.3: HTTP endpoints enforce coach auth & ownership, and Demo Mode remains intact', async () => {
  const db = createIntelligenceMockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000030';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    training_group: 'Marathon',
    current_phase: 'Build',
    active_lthr_bpm: 168,
    data_origin: 'live',
  });
  db.tables.provider_athlete_mappings.push({
    coach_id: OWNER_COACH.id,
    athlete_id: athId,
    provider: 'intervals_icu',
    external_athlete_id: 'i509214',
  });

  const store = new SupabaseOAuthStore(() => db.client);
  const app = await createApp({
    authVerifier: createAuthVerifier(),
    oauthStore: store,
    supabaseClient: db.client,
    mountFrontend: false,
  });
  const srv = await startTestServer(app);

  try {
    // 1. Unauthenticated intelligence request blocked (401)
    const unauthRes = await fetch(`${srv.baseUrl}/api/production/intelligence`);
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated coach can fetch intelligence
    const authRes = await fetch(`${srv.baseUrl}/api/production/intelligence`, {
      headers: { Authorization: 'Bearer valid-owner-jwt' },
    });
    assert.equal(authRes.status, 200);
    const body = (await authRes.json()) as { ok: boolean; athlete: { id: string } };
    assert.equal(body.ok, true);
    assert.equal(body.athlete.id, athId);

    // 3. Authenticated coach can add planned workout & persist it cleanly
    const addPlanRes = await fetch(
      `${srv.baseUrl}/api/production/athletes/${athId}/planned-workouts`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-owner-jwt',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workoutDate: '2026-11-16',
          title: 'Monday Easy Run',
          workoutType: 'Easy',
          plannedMiles: 5,
          plannedDurationMin: 45,
          targetZone: 'Z2',
        }),
      }
    );
    assert.equal(addPlanRes.status, 201);
    const addPlanBody = (await addPlanRes.json()) as {
      ok: boolean;
      insertedCount: number;
      intelligence: { plannedWorkouts: Array<{ title: string }> };
    };
    assert.equal(addPlanBody.ok, true);
    assert.equal(addPlanBody.insertedCount, 1);
    assert.ok(
      addPlanBody.intelligence.plannedWorkouts.some((pw) => pw.title === 'Monday Easy Run')
    );

    // 4. Another coach cannot access OWNER_COACH's athlete
    const otherRes = await fetch(
      `${srv.baseUrl}/api/production/intelligence?athleteId=${athId}`,
      { headers: { Authorization: 'Bearer other-coach-jwt' } }
    );
    assert.equal(otherRes.status, 404);

    // 5. Demo Mode repository remains completely preserved (30 fictional athletes)
    const demoRoster = await coachingRepository.loadRoster();
    assert.equal(demoRoster.length, 30);
  } finally {
    await srv.close();
  }
});

test('Milestone 3.3: planned workout validation rejects invalid payload inputs', async () => {
  const db = createIntelligenceMockSupabase();
  const athId = 'bbbb0000-0000-4000-8000-000000000040';
  db.tables.athletes.push({
    id: athId,
    coach_id: OWNER_COACH.id,
    full_name: 'Pbutterworth',
    training_group: 'Marathon',
    current_phase: 'Build',
    data_origin: 'live',
  });

  const badDate = await addPlannedWorkoutsForAthlete({
    coachId: OWNER_COACH.id,
    athleteId: athId,
    workouts: [
      {
        workoutDate: 'invalid-date',
        title: 'Run',
        workoutType: 'Easy',
        plannedMiles: 5,
        plannedDurationMin: 40,
      },
    ],
    supabaseClient: db.client,
  });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.statusCode, 400);
});
