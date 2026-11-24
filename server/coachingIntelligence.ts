import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPagedRows, getSupabaseAdminClient } from './supabaseAdmin.ts';
import { getOAuthPersistenceStore, type OAuthPersistenceStore } from './oauthStore.ts';

export type AlertSeverity = 'high' | 'moderate' | 'low';
export type AlertClassification =
  | 'High priority: Coach review recommended'
  | 'Moderate priority: Monitor'
  | 'Positive development'
  | 'Insufficient data';

export interface PlannedWorkoutItem {
  id: string;
  workoutDate: string;
  title: string;
  workoutType: string;
  plannedMiles: number;
  plannedDurationMin: number;
  targetPaceSecPerMile: number | null;
  targetZone: string | null;
  sourceProvider: 'final_surge_api' | 'final_surge_csv' | 'coach_entry' | null;
  description: string | null;
  structuredSteps: string[];
  originalDistanceLabel: string | null;
}

export interface WeeklyTrainingLoadPoint {
  weekStartDate: string;
  weekEndDate: string;
  weekLabel: string;
  actualMiles: number;
  actualDurationMinutes: number;
  completedRunCount: number;
  activeDays: number;
  longRunMiles: number;
  longRunSharePct: number | null;
  weekOverWeekMileagePct: number | null;
  systemCWeeklyStress: number | null;
  providerNativeWeeklyLoad: number | null;
  ctlEnd: number | null;
  atlEnd: number | null;
  tsbEnd: number | null;
}

export interface SystemCLoadSummary {
  available: boolean;
  primaryMethodology: string | null;
  primaryMethodologyLabel: string | null;
  latestDate: string | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  atlCtlRatio: number | null;
  formLabel: string | null;
  formTone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
  ctlDelta7d: number | null;
  ctlDelta14d: number | null;
  ctlDelta28d: number | null;
  meanTsb14d: number | null;
  minTsb28d: number | null;
  historyDays: number;
  historySufficiency: 'full_42d' | 'short_14d' | 'insufficient' | 'none';
  note: string;
  methodologies: Array<{
    methodology: string;
    label: string;
    latestDate: string;
    ctl: number;
    atl: number;
    tsb: number;
    historyDays: number;
  }>;
}

export interface ProviderNativeLoadSummary {
  available: boolean;
  latestDate: string | null;
  icuCtl: number | null;
  icuAtl: number | null;
  icuForm: number | null;
  recent7dNativeLoad: number | null;
  isTssEquivalent: false;
  separationNotice: string;
}

export interface TrainingLoadIntelligence {
  systemC: SystemCLoadSummary;
  providerNative: ProviderNativeLoadSummary;
  volumeAndConsistency: {
    last7dMiles: number;
    last7dDurationMinutes: number;
    last7dRunCount: number;
    lastFullWeekMiles: number;
    lastFullWeekDurationMinutes: number;
    priorFullWeekMiles: number;
    weekOverWeekMileagePct: number | null;
    fourWeekAvgMiles: number;
    fourWeekAvgDurationMinutes: number;
    fourWeekAvgRunsPerWeek: number;
    totalCompletedRuns: number;
    totalCompletedMiles: number;
    daysSinceLastRun: number | null;
    longestGapDaysLast28d: number | null;
    consistencyLevel: 'High' | 'Moderate' | 'Low' | 'Insufficient data';
  };
  telemetryAndEfficiency: {
    validHrRuns28d: number;
    missingHrRuns28d: number;
    invalidHrRuns28d: number;
    recent28dEfficiencyFactor: number | null;
    prior28dEfficiencyFactor: number | null;
    efficiencyChangePct: number | null;
  };
  wellnessReadiness: {
    hasWellnessData: boolean;
    latestDate: string | null;
    restingHrBpm: number | null;
    restingHrBaseline28d: number | null;
    hrvRmssd: number | null;
    hrvBaseline28d: number | null;
    hrvStatus: string | null;
    sleepHours: number | null;
    sleepBaseline28d: number | null;
  };
  weeklySeries: WeeklyTrainingLoadPoint[];
  missingDataFlags: string[];
  coachingSummary: string;
  trendInsights: string[];
}

export interface CoachingFindingItem {
  id: string | null;
  category: string;
  severity: AlertSeverity;
  classification: AlertClassification;
  domain: string;
  title: string;
  explanation: string;
  supportingData: string[];
  status: 'active' | 'acknowledged' | 'resolved';
  resolvedAt: string | null;
  createdAt: string | null;
}

export interface PersistedWeeklyReportItem {
  id: string | null;
  weekStartDate: string;
  weekLabel: string;
  actualMiles: number;
  plannedMiles: number;
  weeklyHrStress: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  aiSummary: string;
  coachNote: string;
  status: 'Draft' | 'Approved' | 'Blocked';
  approvedAt: string | null;
  emailDispatchBlocked: true;
  emailDeliveryNote: string;
}

export interface ProductionCoachingIntelligenceResponse {
  ok: boolean;
  statusCode: 200 | 404 | 503;
  configured: boolean;
  hasPersistedAthlete: boolean;
  error?: string;
  athlete: {
    id: string;
    fullName: string;
    externalAthleteId: string | null;
    trainingGroup: string;
    currentPhase: string;
    activeLthrBpm: number | null;
    thresholdPaceSecPerMile: number | null;
    maxHrBpm: number | null;
    restingHrBpm: number | null;
    dataOrigin: string;
  } | null;
  availableAthletes: Array<{
    id: string;
    fullName: string;
    externalAthleteId: string | null;
  }>;
  loadIntelligence: TrainingLoadIntelligence | null;
  plannedWorkouts: PlannedWorkoutItem[];
  alerts: CoachingFindingItem[];
  weeklyReports: PersistedWeeklyReportItem[];
  guardrails: {
    nonDiagnostic: true;
    nonPrescriptive: true;
    providerLoadSeparation: true;
    emailDispatchBlocked: true;
    notice: string;
  };
  analyzedAt: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso.slice(0, 10);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(earlierIso: string, laterIso: string): number {
  const a = Date.parse(`${earlierIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${laterIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function getMondayIso(dateIso: string): string {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso.slice(0, 10);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMon);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(weekStartIso: string): string {
  const start = new Date(`${weekStartIso}T00:00:00Z`);
  const end = new Date(`${addDaysIso(weekStartIso, 6)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return weekStartIso;
  const sm = MONTH_NAMES[start.getUTCMonth()];
  const sd = start.getUTCDate();
  const em = MONTH_NAMES[end.getUTCMonth()];
  const ed = end.getUTCDate();
  return sm === em ? `${sm} ${sd}–${ed}` : `${sm} ${sd}–${em} ${ed}`;
}

function round1(val: number): number {
  return Number(val.toFixed(1));
}

function round2(val: number): number {
  return Number(val.toFixed(2));
}

function methodologyLabel(id: string): string {
  if (id === 'hr_derived_stress') return 'HR-Derived Stress (hrRSS)';
  if (id === 'running_tss_pace') return 'Pace-Derived Stress (rTSS)';
  if (id === 'running_power_stress') return 'Running Power Stress';
  if (id === 'session_rpe_stress') return 'Session RPE Stress';
  return id;
}

function getFormStatus(tsb: number): { label: string; tone: 'emerald' | 'sky' | 'amber' | 'rose' } {
  if (tsb >= 5) return { label: 'Fresh / Race Taper', tone: 'emerald' };
  if (tsb >= -10) return { label: 'Balanced / Maintenance', tone: 'sky' };
  if (tsb >= -22) return { label: 'Productive Overload', tone: 'amber' };
  return { label: 'High Acute Fatigue', tone: 'rose' };
}

function formatPaceDisplay(secPerMile: number | null | undefined): string {
  if (!secPerMile || !Number.isFinite(secPerMile)) return '--:--';
  const r = Math.round(secPerMile);
  const m = Math.floor(r / 60);
  const s = r % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function areTypesCompatible(plannedType: string, actualType: string): boolean {
  if (plannedType === actualType) return true;
  if (
    (plannedType === 'Easy' || plannedType === 'Recovery' || plannedType === 'Long Run') &&
    (actualType === 'Easy' || actualType === 'Recovery' || actualType === 'Long Run')
  ) {
    return true;
  }
  if (
    (plannedType === 'Tempo' || plannedType === 'Intervals' || plannedType === 'Race') &&
    (actualType === 'Tempo' || actualType === 'Intervals' || actualType === 'Race')
  ) {
    return true;
  }
  return false;
}

interface RawActivityRow {
  id: string;
  activity_date: string;
  title: string;
  activity_type: string;
  status: string;
  duration_minutes: number;
  distance_miles: number;
  avg_pace_sec_per_mile: number | null;
  avg_hr_bpm: number | null;
  max_hr_bpm: number | null;
  hr_data_state: 'valid' | 'missing' | 'invalid' | 'rest_zero';
}

interface RawPlannedRow {
  id: string;
  workout_date: string;
  source_provider?: 'final_surge_api' | 'final_surge_csv' | 'coach_entry' | string;
  raw_payload_id?: string | null;
  title: string;
  workout_type: string;
  planned_miles: number;
  planned_duration_min: number;
  target_pace_sec_per_mile: number | null;
  target_zone: string | null;
}

interface RawPlannedMeta {
  description: string | null;
  structuredSteps: string[];
  originalDistanceLabel: string | null;
}

interface RawDailyLoadRow {
  methodology: string;
  load_date: string;
  daily_stress: number;
  ctl: number;
  atl: number;
  tsb: number;
  has_missing_or_invalid_hr: boolean;
}

interface RawWellnessRow {
  record_date: string;
  resting_hr_bpm: number | null;
  hrv_rmssd: number | null;
  hrv_status: string | null;
  sleep_hours: number | null;
  icu_ctl: number | null;
  icu_atl: number | null;
}

interface RawProviderMetricRow {
  activity_id: string;
  metric_date: string;
  icu_training_load: number | null;
  icu_fitness: number | null;
  icu_fatigue: number | null;
  icu_form: number | null;
}

async function resolveScopedAthlete(params: {
  client: SupabaseClient;
  coachId: string;
  requestedAthleteId?: string | null;
  oauthStore: OAuthPersistenceStore;
}): Promise<{
  notFound: boolean;
  athlete: Record<string, unknown> | null;
  externalAthleteId: string | null;
  availableAthletes: Array<{ id: string; fullName: string; externalAthleteId: string | null }>;
}> {
  const { data: coachAthletes } = await params.client
    .from('athletes')
    .select('id, full_name, email, training_group, current_phase, active_lthr_bpm, threshold_pace_sec_per_mile, max_hr_bpm, resting_hr_bpm, data_origin')
    .eq('coach_id', params.coachId)
    .order('created_at', { ascending: true });

  const athleteList = Array.isArray(coachAthletes)
    ? (coachAthletes as Array<Record<string, unknown>>)
    : [];

  const { data: mappings } = await params.client
    .from('provider_athlete_mappings')
    .select('athlete_id, external_athlete_id, provider')
    .eq('coach_id', params.coachId)
    .eq('provider', 'intervals_icu');

  const externalByAthleteId = new Map<string, string>();
  if (Array.isArray(mappings)) {
    for (const m of mappings as Array<Record<string, unknown>>) {
      if (m.athlete_id && typeof m.external_athlete_id === 'string') {
        externalByAthleteId.set(String(m.athlete_id), m.external_athlete_id);
      }
    }
  }

  const availableAthletes = athleteList.map((a) => ({
    id: String(a.id),
    fullName: String(a.full_name),
    externalAthleteId: externalByAthleteId.get(String(a.id)) ?? null,
  }));

  const requested = params.requestedAthleteId?.trim();
  if (requested) {
    const matched = athleteList.find((a) => String(a.id) === requested);
    if (!matched) {
      return {
        notFound: true,
        athlete: null,
        externalAthleteId: null,
        availableAthletes,
      };
    }
    return {
      notFound: false,
      athlete: matched,
      externalAthleteId: externalByAthleteId.get(String(matched.id)) ?? null,
      availableAthletes,
    };
  }

  // Never guess by roster index: resolve strictly via persisted pilot connection mapping
  const conn = await params.oauthStore
    .getProviderConnection(params.coachId, 'intervals_icu')
    .catch(() => null);

  if (conn?.verifiedPilotAthleteId) {
    const mappingMatch = Array.isArray(mappings)
      ? (mappings as Array<Record<string, unknown>>).find(
          (m) => m.external_athlete_id === conn.verifiedPilotAthleteId
        )
      : undefined;
    if (mappingMatch?.athlete_id) {
      const ath = athleteList.find((a) => String(a.id) === String(mappingMatch.athlete_id));
      if (ath) {
        return {
          notFound: false,
          athlete: ath,
          externalAthleteId: conn.verifiedPilotAthleteId,
          availableAthletes,
        };
      }
    }
  }

  // Fallback only if there is an unambiguous single persisted mapping for this coach
  if (Array.isArray(mappings) && mappings.length === 1 && mappings[0].athlete_id) {
    const ath = athleteList.find((a) => String(a.id) === String(mappings[0].athlete_id));
    if (ath) {
      return {
        notFound: false,
        athlete: ath,
        externalAthleteId:
          typeof mappings[0].external_athlete_id === 'string'
            ? mappings[0].external_athlete_id
            : null,
        availableAthletes,
      };
    }
  }

  return {
    notFound: false,
    athlete: null,
    externalAthleteId: null,
    availableAthletes,
  };
}

function buildTrainingLoadIntelligence(params: {
  athlete: Record<string, unknown>;
  activities: RawActivityRow[];
  dailyLoads: RawDailyLoadRow[];
  wellness: RawWellnessRow[];
  providerMetrics: RawProviderMetricRow[];
  anchorDate: string;
}): TrainingLoadIntelligence {
  const { athlete, activities, dailyLoads, wellness, providerMetrics, anchorDate } = params;
  const runActivities = activities.filter(
    (a) => a.activity_type !== 'Rest' && a.status !== 'Rest'
  );

  // 1. System C (Methodology-Isolated) summary
  const byMethod = new Map<string, RawDailyLoadRow[]>();
  for (const row of dailyLoads) {
    const arr = byMethod.get(row.methodology) ?? [];
    arr.push(row);
    byMethod.set(row.methodology, arr);
  }
  for (const list of byMethod.values()) {
    list.sort((a, b) => a.load_date.localeCompare(b.load_date));
  }

  const preferredOrder = [
    'hr_derived_stress',
    'running_tss_pace',
    'running_power_stress',
    'session_rpe_stress',
  ];
  const primaryMethodId =
    preferredOrder.find((m) => (byMethod.get(m)?.length ?? 0) > 0) ??
    Array.from(byMethod.keys())[0] ??
    null;

  const primarySeries = primaryMethodId ? byMethod.get(primaryMethodId) ?? [] : [];
  const latestSysC = primarySeries.length > 0 ? primarySeries[primarySeries.length - 1] : null;
  const historyDays = primarySeries.length;

  let systemC: SystemCLoadSummary;
  if (!latestSysC || !primaryMethodId) {
    const activeLthr = athlete.active_lthr_bpm;
    const thresholdPace = athlete.threshold_pace_sec_per_mile;
    systemC = {
      available: false,
      primaryMethodology: null,
      primaryMethodologyLabel: null,
      latestDate: null,
      ctl: null,
      atl: null,
      tsb: null,
      atlCtlRatio: null,
      formLabel: null,
      formTone: 'slate',
      ctlDelta7d: null,
      ctlDelta14d: null,
      ctlDelta28d: null,
      meanTsb14d: null,
      minTsb28d: null,
      historyDays: 0,
      historySufficiency: 'none',
      note:
        !activeLthr && !thresholdPace
          ? 'System C EWMA load cannot be calculated yet because active LTHR and threshold pace are not set on the athlete profile.'
          : 'No persisted System C daily load history rows exist yet for this athlete.',
      methodologies: [],
    };
  } else {
    const findOnOrBefore = (targetDate: string): RawDailyLoadRow | null => {
      let match: RawDailyLoadRow | null = null;
      for (const r of primarySeries) {
        if (r.load_date <= targetDate) match = r;
        else break;
      }
      return match;
    };
    const row7 = findOnOrBefore(addDaysIso(latestSysC.load_date, -7));
    const row14 = findOnOrBefore(addDaysIso(latestSysC.load_date, -14));
    const row28 = findOnOrBefore(addDaysIso(latestSysC.load_date, -28));
    const last14 = primarySeries.filter(
      (r) => r.load_date >= addDaysIso(latestSysC.load_date, -13)
    );
    const last28 = primarySeries.filter(
      (r) => r.load_date >= addDaysIso(latestSysC.load_date, -27)
    );
    const form = getFormStatus(latestSysC.tsb);
    const historySufficiency: SystemCLoadSummary['historySufficiency'] =
      historyDays >= 42 ? 'full_42d' : historyDays >= 14 ? 'short_14d' : 'insufficient';

    systemC = {
      available: true,
      primaryMethodology: primaryMethodId,
      primaryMethodologyLabel: methodologyLabel(primaryMethodId),
      latestDate: latestSysC.load_date,
      ctl: round1(latestSysC.ctl),
      atl: round1(latestSysC.atl),
      tsb: round1(latestSysC.tsb),
      atlCtlRatio: latestSysC.ctl > 0 ? round2(latestSysC.atl / latestSysC.ctl) : null,
      formLabel: form.label,
      formTone: form.tone,
      ctlDelta7d: row7 ? round1(latestSysC.ctl - row7.ctl) : null,
      ctlDelta14d: row14 ? round1(latestSysC.ctl - row14.ctl) : null,
      ctlDelta28d: row28 ? round1(latestSysC.ctl - row28.ctl) : null,
      meanTsb14d:
        last14.length > 0
          ? round1(last14.reduce((s, r) => s + r.tsb, 0) / last14.length)
          : null,
      minTsb28d:
        last28.length > 0 ? round1(Math.min(...last28.map((r) => r.tsb))) : null,
      historyDays,
      historySufficiency,
      note:
        historySufficiency === 'full_42d'
          ? `Full 42-day chronic baseline available (${historyDays} daily points via ${methodologyLabel(primaryMethodId)}).`
          : `Partial load history (${historyDays} days). 42-day CTL reaches full stability after 42 days of continuous logging.`,
      methodologies: Array.from(byMethod.entries()).map(([mId, rows]) => {
        const last = rows[rows.length - 1];
        return {
          methodology: mId,
          label: methodologyLabel(mId),
          latestDate: last.load_date,
          ctl: round1(last.ctl),
          atl: round1(last.atl),
          tsb: round1(last.tsb),
          historyDays: rows.length,
        };
      }),
    };
  }

  // 2. System A Provider Native Metrics (strictly separated)
  const sortedWellness = [...wellness].sort((a, b) => b.record_date.localeCompare(a.record_date));
  const latestWellWithIcu = sortedWellness.find(
    (w) => w.icu_ctl !== null || w.icu_atl !== null
  );
  const window7Start = addDaysIso(anchorDate, -6);
  const metrics7d = providerMetrics.filter(
    (m) => m.metric_date >= window7Start && m.metric_date <= anchorDate && m.icu_training_load !== null
  );
  const recent7dNativeLoad =
    metrics7d.length > 0
      ? round1(metrics7d.reduce((s, m) => s + Number(m.icu_training_load ?? 0), 0))
      : null;

  const icuCtl = latestWellWithIcu?.icu_ctl !== null && latestWellWithIcu?.icu_ctl !== undefined
    ? round1(latestWellWithIcu.icu_ctl)
    : null;
  const icuAtl = latestWellWithIcu?.icu_atl !== null && latestWellWithIcu?.icu_atl !== undefined
    ? round1(latestWellWithIcu.icu_atl)
    : null;
  const icuForm =
    icuCtl !== null && icuAtl !== null ? round1(icuCtl - icuAtl) : null;

  const providerNative: ProviderNativeLoadSummary = {
    available: icuCtl !== null || icuAtl !== null || recent7dNativeLoad !== null,
    latestDate: latestWellWithIcu?.record_date ?? metrics7d[0]?.metric_date ?? null,
    icuCtl,
    icuAtl,
    icuForm,
    recent7dNativeLoad,
    isTssEquivalent: false,
    separationNotice:
      'Intervals.icu native load, fitness, and fatigue are stored verbatim and kept separate from System C EWMA calculations (not TSS-equivalent).',
  };

  // 3. Weekly Mileage, Duration & Load Series (12 weeks ending at anchorDate's week)
  const currentWeekStart = getMondayIso(anchorDate);
  const metricLoadByActivityId = new Map<string, number>();
  for (const m of providerMetrics) {
    if (m.icu_training_load !== null && m.icu_training_load !== undefined) {
      metricLoadByActivityId.set(m.activity_id, Number(m.icu_training_load));
    }
  }

  const sysCByDate = new Map<string, RawDailyLoadRow>();
  for (const r of primarySeries) {
    sysCByDate.set(r.load_date.slice(0, 10), r);
  }

  const weeklySeries: WeeklyTrainingLoadPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const wkStart = addDaysIso(currentWeekStart, -i * 7);
    const wkEnd = addDaysIso(wkStart, 6);
    const effectiveEnd = wkEnd > anchorDate ? anchorDate : wkEnd;

    const wkRuns = runActivities.filter(
      (a) => a.activity_date >= wkStart && a.activity_date <= effectiveEnd
    );
    const actualMiles = round1(wkRuns.reduce((s, a) => s + Number(a.distance_miles ?? 0), 0));
    const actualDurationMinutes = round1(
      wkRuns.reduce((s, a) => s + Number(a.duration_minutes ?? 0), 0)
    );
    const activeDays = new Set(wkRuns.map((a) => a.activity_date)).size;
    const longRunMiles = round1(
      wkRuns.reduce((max, a) => Math.max(max, Number(a.distance_miles ?? 0)), 0)
    );
    const longRunSharePct =
      actualMiles > 0 ? round1((longRunMiles / actualMiles) * 100) : null;

    let sysCStressSum = 0;
    let sysCPointCount = 0;
    let lastSysCRowInWeek: RawDailyLoadRow | null = null;
    for (let d = 0; d < 7; d++) {
      const dateIso = addDaysIso(wkStart, d);
      if (dateIso > effectiveEnd) break;
      const row = sysCByDate.get(dateIso);
      if (row) {
        sysCStressSum += Number(row.daily_stress ?? 0);
        sysCPointCount++;
        lastSysCRowInWeek = row;
      }
    }

    const nativeLoads = wkRuns
      .map((a) => metricLoadByActivityId.get(a.id))
      .filter((v): v is number => typeof v === 'number');
    const providerNativeWeeklyLoad =
      nativeLoads.length > 0 ? round1(nativeLoads.reduce((s, v) => s + v, 0)) : null;

    weeklySeries.push({
      weekStartDate: wkStart,
      weekEndDate: wkEnd,
      weekLabel: formatWeekLabel(wkStart),
      actualMiles,
      actualDurationMinutes,
      completedRunCount: wkRuns.length,
      activeDays,
      longRunMiles,
      longRunSharePct,
      weekOverWeekMileagePct: null,
      systemCWeeklyStress: sysCPointCount > 0 ? round1(sysCStressSum) : null,
      providerNativeWeeklyLoad,
      ctlEnd: lastSysCRowInWeek ? round1(lastSysCRowInWeek.ctl) : null,
      atlEnd: lastSysCRowInWeek ? round1(lastSysCRowInWeek.atl) : null,
      tsbEnd: lastSysCRowInWeek ? round1(lastSysCRowInWeek.tsb) : null,
    });
  }

  for (let i = 1; i < weeklySeries.length; i++) {
    const prev = weeklySeries[i - 1].actualMiles;
    const curr = weeklySeries[i].actualMiles;
    if (prev > 0) {
      weeklySeries[i].weekOverWeekMileagePct = round1(((curr - prev) / prev) * 100);
    }
  }

  const last7Runs = runActivities.filter(
    (a) => a.activity_date >= addDaysIso(anchorDate, -6) && a.activity_date <= anchorDate
  );
  const last7dMiles = round1(last7Runs.reduce((s, a) => s + Number(a.distance_miles ?? 0), 0));
  const last7dDurationMinutes = round1(
    last7Runs.reduce((s, a) => s + Number(a.duration_minutes ?? 0), 0)
  );

  const lastFullWeek = weeklySeries[weeklySeries.length - 2];
  const priorFullWeek = weeklySeries[weeklySeries.length - 3];
  const lastFullWeekMiles = lastFullWeek?.actualMiles ?? 0;
  const lastFullWeekDurationMinutes = lastFullWeek?.actualDurationMinutes ?? 0;
  const priorFullWeekMiles = priorFullWeek?.actualMiles ?? 0;
  const weekOverWeekMileagePct =
    priorFullWeekMiles > 0
      ? round1(((lastFullWeekMiles - priorFullWeekMiles) / priorFullWeekMiles) * 100)
      : null;

  const last4FullWeeks = weeklySeries.slice(-5, -1);
  const fourWeekAvgMiles = round1(
    last4FullWeeks.reduce((s, w) => s + w.actualMiles, 0) / Math.max(1, last4FullWeeks.length)
  );
  const fourWeekAvgDurationMinutes = round1(
    last4FullWeeks.reduce((s, w) => s + w.actualDurationMinutes, 0) /
      Math.max(1, last4FullWeeks.length)
  );
  const fourWeekAvgRunsPerWeek = round1(
    last4FullWeeks.reduce((s, w) => s + w.completedRunCount, 0) /
      Math.max(1, last4FullWeeks.length)
  );

  const totalCompletedMiles = round1(
    runActivities.reduce((s, a) => s + Number(a.distance_miles ?? 0), 0)
  );
  const latestRunDate =
    runActivities.length > 0
      ? runActivities[runActivities.length - 1].activity_date.slice(0, 10)
      : null;
  const daysSinceLastRun = latestRunDate ? Math.max(0, daysBetweenIso(latestRunDate, anchorDate)) : null;

  const runs28 = runActivities.filter(
    (a) => a.activity_date >= addDaysIso(anchorDate, -27) && a.activity_date <= anchorDate
  );
  const uniqueDates28 = Array.from(new Set(runs28.map((a) => a.activity_date.slice(0, 10)))).sort();
  let longestGapDaysLast28d: number | null = null;
  if (uniqueDates28.length >= 2) {
    let maxGap = 0;
    for (let i = 1; i < uniqueDates28.length; i++) {
      maxGap = Math.max(maxGap, Math.max(0, daysBetweenIso(uniqueDates28[i - 1], uniqueDates28[i]) - 1));
    }
    longestGapDaysLast28d = maxGap;
  }

  const consistencyLevel: TrainingLoadIntelligence['volumeAndConsistency']['consistencyLevel'] =
    runActivities.length < 3
      ? 'Insufficient data'
      : fourWeekAvgRunsPerWeek >= 4
      ? 'High'
      : fourWeekAvgRunsPerWeek >= 2.5
      ? 'Moderate'
      : 'Low';

  // 4. HR Telemetry & Aerobic Efficiency (EF)
  const validHrRuns28d = runs28.filter((a) => a.hr_data_state === 'valid').length;
  const missingHrRuns28d = runs28.filter((a) => a.hr_data_state === 'missing').length;
  const invalidHrRuns28d = runs28.filter((a) => a.hr_data_state === 'invalid').length;

  const computeEf = (list: RawActivityRow[]): number | null => {
    const eligible = list.filter(
      (a) =>
        (a.activity_type === 'Easy' ||
          a.activity_type === 'Long Run' ||
          a.activity_type === 'Recovery') &&
        a.hr_data_state === 'valid' &&
        a.avg_hr_bpm !== null &&
        a.avg_hr_bpm > 0 &&
        a.avg_pace_sec_per_mile !== null &&
        a.avg_pace_sec_per_mile > 0
    );
    if (eligible.length < 2) return null;
    const sum = eligible.reduce((s, a) => {
      const yardsPerMin = 1760 / (Number(a.avg_pace_sec_per_mile) / 60);
      return s + (yardsPerMin / Number(a.avg_hr_bpm)) * 10;
    }, 0);
    return round2(sum / eligible.length);
  };

  const prior28Runs = runActivities.filter(
    (a) =>
      a.activity_date >= addDaysIso(anchorDate, -55) &&
      a.activity_date <= addDaysIso(anchorDate, -28)
  );
  const recent28dEfficiencyFactor = computeEf(runs28);
  const prior28dEfficiencyFactor = computeEf(prior28Runs);
  const efficiencyChangePct =
    recent28dEfficiencyFactor !== null &&
    prior28dEfficiencyFactor !== null &&
    prior28dEfficiencyFactor > 0
      ? round1(
          ((recent28dEfficiencyFactor - prior28dEfficiencyFactor) / prior28dEfficiencyFactor) * 100
        )
      : null;

  // 5. Wellness & Readiness
  const latestWell = sortedWellness[0] ?? null;
  const well28 = sortedWellness.filter(
    (w) => w.record_date >= addDaysIso(anchorDate, -27) && w.record_date <= anchorDate
  );
  const avgField = (fn: (w: RawWellnessRow) => number | null, dec = 1): number | null => {
    const vals = well28.map(fn).filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length === 0) return null;
    const raw = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Number(raw.toFixed(dec));
  };

  const wellnessReadiness = {
    hasWellnessData: sortedWellness.length > 0,
    latestDate: latestWell?.record_date ?? null,
    restingHrBpm: latestWell?.resting_hr_bpm ?? null,
    restingHrBaseline28d: avgField((w) => w.resting_hr_bpm, 0),
    hrvRmssd: latestWell?.hrv_rmssd ?? null,
    hrvBaseline28d: avgField((w) => w.hrv_rmssd, 1),
    hrvStatus: latestWell?.hrv_status ?? null,
    sleepHours: latestWell?.sleep_hours ?? null,
    sleepBaseline28d: avgField((w) => w.sleep_hours, 1),
  };

  // 6. Honest Missing Data Flags & Plain-Language Coaching Narrative
  const missingDataFlags: string[] = [];
  if (!athlete.active_lthr_bpm && !athlete.threshold_pace_sec_per_mile) {
    missingDataFlags.push(
      'Active LTHR and threshold pace are unset; System C HR/pace stress cannot be computed.'
    );
  }
  if (systemC.available && systemC.historySufficiency !== 'full_42d') {
    missingDataFlags.push(
      `Only ${systemC.historyDays} days of System C load history available (42 days recommended for full CTL baseline).`
    );
  }
  if (missingHrRuns28d > 0 || invalidHrRuns28d > 0) {
    missingDataFlags.push(
      `${missingHrRuns28d} missing-HR and ${invalidHrRuns28d} invalid-HR run(s) in the last 28 days were excluded from HR stress rather than counted as zero.`
    );
  }
  if (!wellnessReadiness.hasWellnessData) {
    missingDataFlags.push('No persisted wellness records (RHR, HRV, sleep) available.');
  }
  if (runActivities.length === 0) {
    missingDataFlags.push('No completed running activities are persisted in Supabase yet.');
  }

  const trendInsights: string[] = [];
  if (runActivities.length > 0) {
    trendInsights.push(
      `4-week average volume is ${fourWeekAvgMiles.toFixed(1)} mi/wk (${Math.round(
        fourWeekAvgDurationMinutes
      )} min/wk across ${fourWeekAvgRunsPerWeek.toFixed(1)} runs/wk).`
    );
  }
  if (weekOverWeekMileagePct !== null) {
    trendInsights.push(
      `Last completed week logged ${lastFullWeekMiles.toFixed(1)} mi (${
        weekOverWeekMileagePct >= 0 ? '+' : ''
      }${weekOverWeekMileagePct.toFixed(1)}% vs prior week ${priorFullWeekMiles.toFixed(1)} mi).`
    );
  }
  if (systemC.available && systemC.ctl !== null && systemC.atl !== null && systemC.tsb !== null) {
    trendInsights.push(
      `System C (${systemC.primaryMethodologyLabel}) shows CTL ${systemC.ctl.toFixed(
        1
      )}, ATL ${systemC.atl.toFixed(1)}, TSB ${systemC.tsb >= 0 ? '+' : ''}${systemC.tsb.toFixed(
        1
      )} (${systemC.formLabel}).`
    );
  }
  if (efficiencyChangePct !== null) {
    trendInsights.push(
      `Easy-run aerobic efficiency shifted ${efficiencyChangePct >= 0 ? '+' : ''}${efficiencyChangePct.toFixed(
        1
      )}% over the last 28 days (${prior28dEfficiencyFactor} → ${recent28dEfficiencyFactor}).`
    );
  }

  const coachingSummary =
    runActivities.length === 0
      ? 'No completed running activities are currently persisted for this athlete. Run a pilot sync to populate load and mileage trends.'
      : [
          `${String(athlete.full_name)} has completed ${runActivities.length} persisted run(s) totaling ${totalCompletedMiles.toFixed(
            1
          )} mi, averaging ${fourWeekAvgMiles.toFixed(1)} mi/wk (${fourWeekAvgRunsPerWeek.toFixed(
            1
          )} runs/wk) over the past 4 completed weeks.`,
          systemC.available && systemC.ctl !== null && systemC.tsb !== null
            ? `System C EWMA load (${systemC.primaryMethodologyLabel}) sits at CTL ${systemC.ctl.toFixed(
                1
              )} / ATL ${systemC.atl?.toFixed(1)} / TSB ${systemC.tsb >= 0 ? '+' : ''}${systemC.tsb.toFixed(
                1
              )} (${systemC.formLabel}).`
            : 'System C EWMA metrics are currently unavailable until threshold parameters and activity telemetry are present.',
          providerNative.available && providerNative.icuCtl !== null
            ? `Intervals.icu native fitness/fatigue (${providerNative.icuCtl.toFixed(
                1
              )} / ${providerNative.icuAtl?.toFixed(1) ?? '--'}) is tracked separately and never mixed with System C stress.`
            : null,
        ]
          .filter(Boolean)
          .join(' ');

  return {
    systemC,
    providerNative,
    volumeAndConsistency: {
      last7dMiles,
      last7dDurationMinutes,
      last7dRunCount: last7Runs.length,
      lastFullWeekMiles,
      lastFullWeekDurationMinutes,
      priorFullWeekMiles,
      weekOverWeekMileagePct,
      fourWeekAvgMiles,
      fourWeekAvgDurationMinutes,
      fourWeekAvgRunsPerWeek,
      totalCompletedRuns: runActivities.length,
      totalCompletedMiles,
      daysSinceLastRun,
      longestGapDaysLast28d,
      consistencyLevel,
    },
    telemetryAndEfficiency: {
      validHrRuns28d,
      missingHrRuns28d,
      invalidHrRuns28d,
      recent28dEfficiencyFactor,
      prior28dEfficiencyFactor,
      efficiencyChangePct,
    },
    wellnessReadiness,
    weeklySeries,
    missingDataFlags,
    coachingSummary,
    trendInsights,
  };
}

function buildPlannedWorkoutItems(params: {
  plannedWorkouts: RawPlannedRow[];
  plannedMetaByRawId?: Map<string, RawPlannedMeta>;
}): PlannedWorkoutItem[] {
  const metaMap = params.plannedMetaByRawId ?? new Map<string, RawPlannedMeta>();
  const normSource = (
    val: string | undefined
  ): 'final_surge_api' | 'final_surge_csv' | 'coach_entry' | null =>
    val === 'final_surge_api' || val === 'final_surge_csv' || val === 'coach_entry' ? val : null;

  return [...params.plannedWorkouts]
    .sort((a, b) => b.workout_date.localeCompare(a.workout_date))
    .map((p) => {
      const meta = p.raw_payload_id ? metaMap.get(String(p.raw_payload_id)) : undefined;
      return {
        id: String(p.id),
        workoutDate: String(p.workout_date).slice(0, 10),
        title: String(p.title),
        workoutType: String(p.workout_type),
        plannedMiles: round1(Number(p.planned_miles ?? 0)),
        plannedDurationMin: round1(Number(p.planned_duration_min ?? 0)),
        targetPaceSecPerMile:
          typeof p.target_pace_sec_per_mile === 'number' ? p.target_pace_sec_per_mile : null,
        targetZone: typeof p.target_zone === 'string' ? p.target_zone : null,
        sourceProvider: normSource(p.source_provider),
        description: meta?.description ?? null,
        structuredSteps: meta?.structuredSteps ?? [],
        originalDistanceLabel: meta?.originalDistanceLabel ?? null,
      };
    });
}

function generateClassifiedFindings(params: {
  athleteName: string;
  load: TrainingLoadIntelligence;
}): CoachingFindingItem[] {
  const { athleteName, load } = params;
  const findings: CoachingFindingItem[] = [];

  // 1. Insufficient Data Checks (always honest, never fabricated)
  if (!load.systemC.available) {
    findings.push({
      id: null,
      category: 'Training Load',
      severity: 'low',
      classification: 'Insufficient data',
      domain: 'load',
      title: 'Threshold baseline needed for System C EWMA load',
      explanation: load.systemC.note,
      supportingData: [
        `System C histories: 0 points`,
        load.providerNative.available
          ? `Provider-native ICU CTL ${load.providerNative.icuCtl ?? '--'} / ATL ${load.providerNative.icuAtl ?? '--'} (not TSS-equivalent)`
          : 'No provider-native wellness CTL/ATL on file',
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  } else if (load.systemC.historySufficiency !== 'full_42d') {
    findings.push({
      id: null,
      category: 'Training Load',
      severity: 'low',
      classification: 'Insufficient data',
      domain: 'load',
      title: `Short System C load history (${load.systemC.historyDays}d of 42d)`,
      explanation: `System C CTL (${load.systemC.ctl?.toFixed(1) ?? '--'}) currently reflects ${load.systemC.historyDays} day(s) of persisted history. Interpret 42-day chronic trends cautiously until 6 weeks accumulate.`,
      supportingData: [
        `Methodology: ${load.systemC.primaryMethodologyLabel}`,
        `History span: ${load.systemC.historyDays} days (latest ${load.systemC.latestDate})`,
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  }

  // 2. Telemetry Quality
  const badHrTotal =
    load.telemetryAndEfficiency.missingHrRuns28d + load.telemetryAndEfficiency.invalidHrRuns28d;
  if (badHrTotal > 0) {
    findings.push({
      id: null,
      category: 'Telemetry & Data Quality',
      severity: load.telemetryAndEfficiency.invalidHrRuns28d > 0 ? 'moderate' : 'low',
      classification: 'Moderate priority: Monitor',
      domain: 'telemetry',
      title: `${badHrTotal} recent run(s) with missing or invalid HR telemetry`,
      explanation: `Completed runs without valid HR (${load.telemetryAndEfficiency.missingHrRuns28d} missing, ${load.telemetryAndEfficiency.invalidHrRuns28d} invalid) in the last 28 days are excluded from HR-derived stress rather than treated as zero-effort rest.`,
      supportingData: [
        `28d HR valid runs: ${load.telemetryAndEfficiency.validHrRuns28d}`,
        `28d HR missing: ${load.telemetryAndEfficiency.missingHrRuns28d} · invalid: ${load.telemetryAndEfficiency.invalidHrRuns28d}`,
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  }

  // 3. System C Training Load Alerts (non-diagnostic, non-prescriptive)
  if (load.systemC.available && load.systemC.tsb !== null && load.systemC.ctl !== null && load.systemC.atl !== null) {
    if (load.systemC.tsb <= -20) {
      findings.push({
        id: null,
        category: 'Training Load',
        severity: 'high',
        classification: 'High priority: Coach review recommended',
        domain: 'load',
        title: `Elevated acute fatigue in System C (TSB ${load.systemC.tsb.toFixed(1)})`,
        explanation: `7-day ATL (${load.systemC.atl.toFixed(1)}) exceeds 42-day CTL (${load.systemC.ctl.toFixed(1)}) by ${Math.abs(load.systemC.tsb).toFixed(1)} points. Consider reviewing upcoming session intensity and recovery context with ${athleteName}.`,
        supportingData: [
          `System C (${load.systemC.primaryMethodologyLabel}): CTL ${load.systemC.ctl.toFixed(1)} · ATL ${load.systemC.atl.toFixed(1)} · TSB ${load.systemC.tsb.toFixed(1)}`,
          `28d lowest TSB: ${load.systemC.minTsb28d?.toFixed(1) ?? '--'}`,
        ],
        status: 'active',
        resolvedAt: null,
        createdAt: null,
      });
    } else if (load.systemC.tsb <= -12) {
      findings.push({
        id: null,
        category: 'Training Load',
        severity: 'moderate',
        classification: 'Moderate priority: Monitor',
        domain: 'load',
        title: `Moderate overload window (TSB ${load.systemC.tsb.toFixed(1)})`,
        explanation: `Short-term load (ATL ${load.systemC.atl.toFixed(1)}) is moderately above chronic baseline (CTL ${load.systemC.ctl.toFixed(1)}). Monitor readiness markers over the next several days.`,
        supportingData: [
          `CTL ${load.systemC.ctl.toFixed(1)} · ATL ${load.systemC.atl.toFixed(1)} · TSB ${load.systemC.tsb.toFixed(1)}`,
          `14d mean TSB: ${load.systemC.meanTsb14d?.toFixed(1) ?? '--'}`,
        ],
        status: 'active',
        resolvedAt: null,
        createdAt: null,
      });
    }
  }

  // 4. Weekly Mileage Ramp Check
  if (
    load.volumeAndConsistency.weekOverWeekMileagePct !== null &&
    load.volumeAndConsistency.priorFullWeekMiles >= 10 &&
    load.volumeAndConsistency.weekOverWeekMileagePct >= 25
  ) {
    const jump = load.volumeAndConsistency.weekOverWeekMileagePct;
    findings.push({
      id: null,
      category: 'Training Load',
      severity: jump >= 35 ? 'high' : 'moderate',
      classification:
        jump >= 35
          ? 'High priority: Coach review recommended'
          : 'Moderate priority: Monitor',
      domain: 'load',
      title: `Weekly mileage jumped +${jump.toFixed(0)}% week-over-week`,
      explanation: `Completed mileage moved from ${load.volumeAndConsistency.priorFullWeekMiles.toFixed(1)} mi to ${load.volumeAndConsistency.lastFullWeekMiles.toFixed(1)} mi in the most recent full week. Review whether the progression was intentional (e.g., return from cutback).`,
      supportingData: [
        `Prior full week: ${load.volumeAndConsistency.priorFullWeekMiles.toFixed(1)} mi`,
        `Last full week: ${load.volumeAndConsistency.lastFullWeekMiles.toFixed(1)} mi (+${jump.toFixed(1)}%)`,
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  }

  // 5. Wellness Divergence Check (non-diagnostic)
  const w = load.wellnessReadiness;
  if (w.hasWellnessData && w.hrvRmssd !== null && w.hrvBaseline28d !== null && w.hrvBaseline28d > 0) {
    const hrvDropPct = ((w.hrvBaseline28d - w.hrvRmssd) / w.hrvBaseline28d) * 100;
    if (hrvDropPct >= 15 || (w.hrvStatus && /low|unbalanced|poor/i.test(w.hrvStatus))) {
      findings.push({
        id: null,
        category: 'Wellness & Readiness',
        severity: 'moderate',
        classification: 'Moderate priority: Monitor',
        domain: 'wellness',
        title: `HRV trending below 28-day baseline (${w.hrvRmssd.toFixed(1)} vs ${w.hrvBaseline28d.toFixed(1)})`,
        explanation: `Latest recorded HRV (${w.latestDate}) sits ${hrvDropPct.toFixed(0)}% below the athlete's 28-day average. Pair with subjective recovery notes and sleep context before adjusting load.`,
        supportingData: [
          `HRV rMSSD: ${w.hrvRmssd.toFixed(1)} (28d mean ${w.hrvBaseline28d.toFixed(1)})${w.hrvStatus ? ` · Status: ${w.hrvStatus}` : ''}`,
          `Resting HR: ${w.restingHrBpm ?? '--'} bpm (28d mean ${w.restingHrBaseline28d ?? '--'}) · Sleep: ${w.sleepHours ?? '--'} h`,
        ],
        status: 'active',
        resolvedAt: null,
        createdAt: null,
      });
    }
  }

  // 7. Positive Aerobic / Load Progression
  if (
    load.systemC.available &&
    load.systemC.ctlDelta14d !== null &&
    load.systemC.ctlDelta14d >= 1.5 &&
    (load.systemC.tsb ?? 0) >= -12 &&
    (load.systemC.tsb ?? 0) <= 10
  ) {
    findings.push({
      id: null,
      category: 'Aerobic Progression',
      severity: 'low',
      classification: 'Positive development',
      domain: 'progression',
      title: `Steady System C fitness build (+${load.systemC.ctlDelta14d.toFixed(1)} CTL over 14d)`,
      explanation: `Chronic load rose +${load.systemC.ctlDelta14d.toFixed(1)} points over the past 14 days while keeping TSB in a manageable range (${load.systemC.tsb?.toFixed(1)}).`,
      supportingData: [
        `CTL ${load.systemC.ctl?.toFixed(1)} · ATL ${load.systemC.atl?.toFixed(1)} · TSB ${load.systemC.tsb?.toFixed(1)}`,
        `4-wk consistency: ${load.volumeAndConsistency.fourWeekAvgRunsPerWeek.toFixed(1)} runs/wk (${load.volumeAndConsistency.consistencyLevel})`,
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  }

  if (
    load.telemetryAndEfficiency.efficiencyChangePct !== null &&
    load.telemetryAndEfficiency.efficiencyChangePct >= 2.0
  ) {
    findings.push({
      id: null,
      category: 'Aerobic Progression',
      severity: 'low',
      classification: 'Positive development',
      domain: 'progression',
      title: `Aerobic efficiency improved +${load.telemetryAndEfficiency.efficiencyChangePct.toFixed(1)}% (28d)`,
      explanation: `Speed per heartbeat on valid easy/aerobic runs rose from ${load.telemetryAndEfficiency.prior28dEfficiencyFactor} to ${load.telemetryAndEfficiency.recent28dEfficiencyFactor} over the past 28 days.`,
      supportingData: [
        `28d EF: ${load.telemetryAndEfficiency.recent28dEfficiencyFactor} vs prior 28d ${load.telemetryAndEfficiency.prior28dEfficiencyFactor}`,
        `Valid HR runs (28d): ${load.telemetryAndEfficiency.validHrRuns28d}`,
      ],
      status: 'active',
      resolvedAt: null,
      createdAt: null,
    });
  }

  return findings;
}

function buildWeeklyReportDrafts(params: {
  athleteName: string;
  load: TrainingLoadIntelligence;
  plannedWorkouts: PlannedWorkoutItem[];
  existingReports: Array<Record<string, unknown>>;
}): PersistedWeeklyReportItem[] {
  const { athleteName, load, plannedWorkouts, existingReports } = params;
  const existingByWeek = new Map<string, Record<string, unknown>>();
  for (const r of existingReports) {
    if (typeof r.week_start_date === 'string') {
      existingByWeek.set(r.week_start_date.slice(0, 10), r);
    }
  }

  // Build reports for recent weeks that have activity or planned workouts (at least latest full week + current week)
  const reports: PersistedWeeklyReportItem[] = [];
  const totalWeeks = load.weeklySeries.length;
  for (let i = Math.max(0, totalWeeks - 4); i < totalWeeks; i++) {
    const wkLoad = load.weeklySeries[i];
    const wkPlanned = plannedWorkouts.filter(
      (p) => p.workoutDate >= wkLoad.weekStartDate && p.workoutDate <= wkLoad.weekEndDate
    );
    const wkPlannedMiles = round1(
      wkPlanned.reduce((sum, p) => sum + Number(p.plannedMiles ?? 0), 0)
    );
    const hasData =
      wkLoad.completedRunCount > 0 || wkPlanned.length > 0 || i >= totalWeeks - 2;
    if (!hasData) continue;

    const existing = existingByWeek.get(wkLoad.weekStartDate);
    const scheduleNote =
      wkPlanned.length > 0
        ? `Scheduled workouts on file: ${wkPlanned.length} (${wkPlannedMiles.toFixed(1)} mi).`
        : '';

    const loadNote =
      wkLoad.systemCWeeklyStress !== null && wkLoad.ctlEnd !== null && wkLoad.tsbEnd !== null
        ? `System C weekly stress ${wkLoad.systemCWeeklyStress.toFixed(0)} · End-of-week CTL ${wkLoad.ctlEnd.toFixed(
            1
          )} / ATL ${wkLoad.atlEnd?.toFixed(1) ?? '--'} / TSB ${
            wkLoad.tsbEnd >= 0 ? '+' : ''
          }${wkLoad.tsbEnd.toFixed(1)}.`
        : wkLoad.providerNativeWeeklyLoad !== null
        ? `Intervals.icu native weekly load: ${wkLoad.providerNativeWeeklyLoad.toFixed(
            0
          )} (provider-native, not TSS-equivalent; System C thresholds unset).`
        : 'System C weekly stress unavailable for this week.';

    const aiSummary = `${athleteName} (${wkLoad.weekLabel}): Completed ${wkLoad.actualMiles.toFixed(
      1
    )} mi across ${wkLoad.completedRunCount} run(s) (${Math.round(
      wkLoad.actualDurationMinutes
    )} min, long run ${wkLoad.longRunMiles.toFixed(1)} mi). ${
      scheduleNote ? `${scheduleNote} ` : ''
    }${loadNote}`;

    reports.push({
      id: existing?.id ? String(existing.id) : null,
      weekStartDate: wkLoad.weekStartDate,
      weekLabel: wkLoad.weekLabel,
      actualMiles: wkLoad.actualMiles,
      plannedMiles: wkPlannedMiles,
      weeklyHrStress: wkLoad.systemCWeeklyStress,
      ctl: wkLoad.ctlEnd,
      atl: wkLoad.atlEnd,
      tsb: wkLoad.tsbEnd,
      aiSummary,
      coachNote: typeof existing?.coach_note === 'string' ? existing.coach_note : '',
      status:
        existing?.status === 'Approved' || existing?.status === 'Blocked'
          ? existing.status
          : 'Draft',
      approvedAt: typeof existing?.approved_at === 'string' ? existing.approved_at : null,
      emailDispatchBlocked: true,
      emailDeliveryNote:
        typeof existing?.email_delivery_note === 'string'
          ? existing.email_delivery_note
          : 'Coach approval required before athlete email dispatch.',
    });
  }

  return reports.sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
}

async function persistIntelligenceOutputs(params: {
  client: SupabaseClient;
  coachId: string;
  athleteId: string;
  dataOrigin: string;
  findings: CoachingFindingItem[];
  reports: PersistedWeeklyReportItem[];
  existingAlerts: Array<Record<string, unknown>>;
  existingReports: Array<Record<string, unknown>>;
}): Promise<{
  alerts: CoachingFindingItem[];
  reports: PersistedWeeklyReportItem[];
}> {
  const { client, coachId, athleteId, existingAlerts, existingReports } = params;
  const normalizedOrigin =
    params.dataOrigin === 'csv_import' || params.dataOrigin === 'mixed'
      ? params.dataOrigin
      : 'live';

  // 1. Sync coaching_alerts without duplicating or overwriting resolved/acknowledged states
  const nonComplianceAlerts = existingAlerts.filter(
    (a) => a.domain !== 'compliance' && a.category !== 'Workout Compliance'
  );
  const existingAlertByKey = new Map<string, Record<string, unknown>>();
  for (const a of nonComplianceAlerts) {
    const key = `${String(a.category)}::${String(a.domain ?? '')}::${String(a.title)}`;
    if (!existingAlertByKey.has(key)) {
      existingAlertByKey.set(key, a);
    }
  }

  const persistedAlerts: CoachingFindingItem[] = [];
  const activeFindingKeys = new Set<string>();

  for (const f of params.findings) {
    const key = `${f.category}::${f.domain}::${f.title}`;
    activeFindingKeys.add(key);
    const existing = existingAlertByKey.get(key);
    if (existing?.id) {
      const existingStatus =
        existing.status === 'acknowledged' || existing.status === 'resolved'
          ? existing.status
          : 'active';
      await client
        .from('coaching_alerts')
        .update({
          severity: f.severity,
          classification: f.classification,
          explanation: f.explanation,
          supporting_data: f.supportingData,
          data_origin: normalizedOrigin,
        })
        .eq('id', existing.id)
        .eq('coach_id', coachId);

      persistedAlerts.push({
        ...f,
        id: String(existing.id),
        status: existingStatus,
        resolvedAt: typeof existing.resolved_at === 'string' ? existing.resolved_at : null,
        createdAt: typeof existing.created_at === 'string' ? existing.created_at : null,
      });
    } else {
      const { data: ins } = await client
        .from('coaching_alerts')
        .insert({
          coach_id: coachId,
          athlete_id: athleteId,
          category: f.category,
          severity: f.severity,
          classification: f.classification,
          domain: f.domain,
          title: f.title,
          explanation: f.explanation,
          supporting_data: f.supportingData,
          data_origin: normalizedOrigin,
          status: 'active',
        })
        .select('id, created_at')
        .single();

      persistedAlerts.push({
        ...f,
        id: ins?.id ? String(ins.id) : null,
        status: 'active',
        createdAt: typeof ins?.created_at === 'string' ? ins.created_at : null,
      });
    }
  }

  // Keep any coach-acknowledged/resolved historical alerts visible in returned list if not regenerated
  for (const a of nonComplianceAlerts) {
    const key = `${String(a.category)}::${String(a.domain ?? '')}::${String(a.title)}`;
    if (!activeFindingKeys.has(key) && a.status !== 'active') {
      persistedAlerts.push({
        id: String(a.id),
        category: String(a.category),
        severity: (a.severity as AlertSeverity) ?? 'low',
        classification: (a.classification as AlertClassification) ?? 'Moderate priority: Monitor',
        domain: typeof a.domain === 'string' ? a.domain : 'general',
        title: String(a.title),
        explanation: String(a.explanation),
        supportingData: Array.isArray(a.supporting_data)
          ? a.supporting_data.map((s) => String(s))
          : [],
        status: (a.status as 'acknowledged' | 'resolved') ?? 'resolved',
        resolvedAt: typeof a.resolved_at === 'string' ? a.resolved_at : null,
        createdAt: typeof a.created_at === 'string' ? a.created_at : null,
      });
    }
  }

  // 2. Upsert weekly_reports (preserving coach_note, status, approved_at, and ALWAYS email_dispatch_blocked: true)
  const existingReportByWeek = new Map<string, Record<string, unknown>>();
  for (const r of existingReports) {
    if (typeof r.week_start_date === 'string') {
      existingReportByWeek.set(r.week_start_date.slice(0, 10), r);
    }
  }

  const persistedReports: PersistedWeeklyReportItem[] = [];
  for (const rep of params.reports) {
    const existing = existingReportByWeek.get(rep.weekStartDate);
    const payload = {
      coach_id: coachId,
      athlete_id: athleteId,
      week_start_date: rep.weekStartDate,
      week_label: rep.weekLabel,
      compliance_pct: null,
      actual_miles: rep.actualMiles,
      planned_miles: rep.plannedMiles,
      weekly_hr_stress: rep.weeklyHrStress,
      ctl: rep.ctl,
      atl: rep.atl,
      tsb: rep.tsb,
      ai_summary: rep.aiSummary,
      coach_note: existing && typeof existing.coach_note === 'string' ? existing.coach_note : rep.coachNote,
      status:
        existing?.status === 'Approved' || existing?.status === 'Blocked'
          ? existing.status
          : rep.status,
      approved_at: existing?.approved_at ?? rep.approvedAt,
      email_dispatch_blocked: true,
      email_delivery_note:
        existing && typeof existing.email_delivery_note === 'string'
          ? existing.email_delivery_note
          : rep.emailDeliveryNote,
      data_origin: normalizedOrigin,
    };

    const { data: upserted } = await client
      .from('weekly_reports')
      .upsert(payload, { onConflict: 'athlete_id,week_start_date' })
      .select('id, status, approved_at, coach_note')
      .single();

    persistedReports.push({
      ...rep,
      id: upserted?.id ? String(upserted.id) : existing?.id ? String(existing.id) : null,
      coachNote:
        typeof upserted?.coach_note === 'string' ? upserted.coach_note : payload.coach_note,
      status:
        upserted?.status === 'Approved' || upserted?.status === 'Blocked'
          ? upserted.status
          : payload.status,
      approvedAt:
        typeof upserted?.approved_at === 'string'
          ? upserted.approved_at
          : (payload.approved_at as string | null),
      emailDispatchBlocked: true,
    });
  }

  return {
    alerts: persistedAlerts,
    reports: persistedReports,
  };
}

export async function getCoachingIntelligence(options: {
  coachId: string;
  athleteId?: string | null;
  persist?: boolean;
  nowIso?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
}): Promise<ProductionCoachingIntelligenceResponse> {
  const analyzedAt = options.nowIso ?? new Date().toISOString();
  const anchorDate = analyzedAt.slice(0, 10);
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const oauthStore = options.oauthStore ?? getOAuthPersistenceStore();

  const guardrails = {
    nonDiagnostic: true as const,
    nonPrescriptive: true as const,
    providerLoadSeparation: true as const,
    emailDispatchBlocked: true as const,
    notice:
      'Coaching intelligence provides non-diagnostic, non-prescriptive decision support from persisted telemetry. Provider-native load is never treated as TSS-equivalent, and athlete email dispatch remains blocked until explicit coach approval.',
  };

  if (!client) {
    return {
      ok: false,
      statusCode: 503,
      configured: false,
      hasPersistedAthlete: false,
      error: 'Supabase admin client is not configured on the server.',
      athlete: null,
      availableAthletes: [],
      loadIntelligence: null,
      plannedWorkouts: [],
      alerts: [],
      weeklyReports: [],
      guardrails,
      analyzedAt,
    };
  }

  const resolved = await resolveScopedAthlete({
    client,
    coachId: options.coachId,
    requestedAthleteId: options.athleteId,
    oauthStore,
  });

  if (resolved.notFound) {
    return {
      ok: false,
      statusCode: 404,
      configured: true,
      hasPersistedAthlete: false,
      error: 'Requested athlete was not found for the authenticated coach.',
      athlete: null,
      availableAthletes: resolved.availableAthletes,
      loadIntelligence: null,
      plannedWorkouts: [],
      alerts: [],
      weeklyReports: [],
      guardrails,
      analyzedAt,
    };
  }

  if (!resolved.athlete) {
    return {
      ok: true,
      statusCode: 200,
      configured: true,
      hasPersistedAthlete: false,
      athlete: null,
      availableAthletes: resolved.availableAthletes,
      loadIntelligence: null,
      plannedWorkouts: [],
      alerts: [],
      weeklyReports: [],
      guardrails,
      analyzedAt,
    };
  }

  const ath = resolved.athlete;
  const athleteId = String(ath.id);

  const [
    activitiesRes,
    plannedRes,
    dailyLoadRes,
    wellnessRes,
    providerMetricsRes,
    alertsRes,
    reportsRes,
    plannedRawRes,
  ] = await Promise.all([
    fetchAllPagedRows(() =>
      client
        .from('completed_activities')
        .select(
          'id, activity_date, title, activity_type, status, duration_minutes, distance_miles, avg_pace_sec_per_mile, avg_hr_bpm, max_hr_bpm, hr_data_state'
        )
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('activity_date', { ascending: true })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('planned_workouts')
        .select(
          'id, workout_date, source_provider, raw_payload_id, title, workout_type, planned_miles, planned_duration_min, target_pace_sec_per_mile, target_zone'
        )
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('workout_date', { ascending: true })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('daily_load_histories')
        .select('methodology, load_date, daily_stress, ctl, atl, tsb, has_missing_or_invalid_hr')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('load_date', { ascending: true })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('wellness_records')
        .select('record_date, resting_hr_bpm, hrv_rmssd, hrv_status, sleep_hours, icu_ctl, icu_atl')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('record_date', { ascending: false })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('provider_training_metrics')
        .select('activity_id, metric_date, icu_training_load, icu_fitness, icu_fatigue, icu_form')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('coaching_alerts')
        .select('*')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('weekly_reports')
        .select('*')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .order('week_start_date', { ascending: false })
        .order('id', { ascending: true })
    ),
    fetchAllPagedRows(() =>
      client
        .from('raw_provider_payloads')
        .select('id, payload')
        .eq('coach_id', options.coachId)
        .eq('athlete_id', athleteId)
        .eq('entity_type', 'planned_workout')
        .order('id', { ascending: true })
    ),
  ]);

  const activities = (Array.isArray(activitiesRes.data) ? activitiesRes.data : []) as RawActivityRow[];
  const plannedWorkoutsRaw = (Array.isArray(plannedRes.data) ? plannedRes.data : []) as RawPlannedRow[];
  const dailyLoads = (Array.isArray(dailyLoadRes.data) ? dailyLoadRes.data : []) as RawDailyLoadRow[];
  const wellness = (Array.isArray(wellnessRes.data) ? wellnessRes.data : []) as RawWellnessRow[];
  const providerMetrics = (
    Array.isArray(providerMetricsRes.data) ? providerMetricsRes.data : []
  ) as RawProviderMetricRow[];
  const existingAlerts = (Array.isArray(alertsRes.data) ? alertsRes.data : []) as Array<
    Record<string, unknown>
  >;
  const existingReports = (Array.isArray(reportsRes.data) ? reportsRes.data : []) as Array<
    Record<string, unknown>
  >;

  const plannedMetaByRawId = new Map<string, RawPlannedMeta>();
  if (Array.isArray(plannedRawRes.data)) {
    for (const rr of plannedRawRes.data as Array<Record<string, unknown>>) {
      if (!rr.id || !rr.payload || typeof rr.payload !== 'object') continue;
      const p = rr.payload as Record<string, unknown>;
      const distVal = typeof p.originalDistanceValue === 'number' ? p.originalDistanceValue : null;
      const distUnit = typeof p.originalDistanceUnit === 'string' ? p.originalDistanceUnit : null;
      plannedMetaByRawId.set(String(rr.id), {
        description: typeof p.description === 'string' && p.description.trim() ? p.description : null,
        structuredSteps: Array.isArray(p.structuredSteps)
          ? p.structuredSteps.map((s) => String(s))
          : [],
        originalDistanceLabel: distVal !== null && distUnit ? `${distVal} ${distUnit}` : null,
      });
    }
  }

  const loadIntelligence = buildTrainingLoadIntelligence({
    athlete: ath,
    activities,
    dailyLoads,
    wellness,
    providerMetrics,
    anchorDate,
  });

  const plannedWorkouts = buildPlannedWorkoutItems({
    plannedWorkouts: plannedWorkoutsRaw,
    plannedMetaByRawId,
  });

  const rawFindings = generateClassifiedFindings({
    athleteName: String(ath.full_name),
    load: loadIntelligence,
  });

  let weeklyReports = buildWeeklyReportDrafts({
    athleteName: String(ath.full_name),
    load: loadIntelligence,
    plannedWorkouts,
    existingReports,
  });

  let finalAlerts: CoachingFindingItem[];

  if (options.persist) {
    const persisted = await persistIntelligenceOutputs({
      client,
      coachId: options.coachId,
      athleteId,
      dataOrigin: String(ath.data_origin ?? 'live'),
      findings: rawFindings,
      reports: weeklyReports,
      existingAlerts,
      existingReports,
    });
    finalAlerts = persisted.alerts;
    weeklyReports = persisted.reports;

    await client
      .from('audit_events')
      .insert({
        coach_id: options.coachId,
        actor_role: 'owner_coach',
        action: 'INTELLIGENCE_ANALYSIS_PERSISTED',
        target_entity: 'athletes',
        target_id: athleteId,
        athlete_id_snapshot: athleteId,
        detail: `Persisted coaching intelligence for ${String(ath.full_name)} (${finalAlerts.length} findings, ${weeklyReports.length} weekly report drafts).`,
      })
      .then(() => undefined, () => undefined);
  } else {
    const existingAlertByKey = new Map<string, Record<string, unknown>>();
    for (const a of existingAlerts) {
      if (a.domain === 'compliance' || a.category === 'Workout Compliance') continue;
      const key = `${String(a.category)}::${String(a.domain ?? '')}::${String(a.title)}`;
      if (!existingAlertByKey.has(key)) existingAlertByKey.set(key, a);
    }
    finalAlerts = rawFindings.map((f) => {
      const ex = existingAlertByKey.get(`${f.category}::${f.domain}::${f.title}`);
      if (!ex) return f;
      return {
        ...f,
        id: String(ex.id),
        status:
          ex.status === 'acknowledged' || ex.status === 'resolved' ? ex.status : 'active',
        resolvedAt: typeof ex.resolved_at === 'string' ? ex.resolved_at : null,
        createdAt: typeof ex.created_at === 'string' ? ex.created_at : null,
      };
    });
  }

  return {
    ok: true,
    statusCode: 200,
    configured: true,
    hasPersistedAthlete: true,
    athlete: {
      id: athleteId,
      fullName: String(ath.full_name),
      externalAthleteId: resolved.externalAthleteId,
      trainingGroup: String(ath.training_group ?? 'Marathon'),
      currentPhase: String(ath.current_phase ?? 'Build'),
      activeLthrBpm: typeof ath.active_lthr_bpm === 'number' ? ath.active_lthr_bpm : null,
      thresholdPaceSecPerMile:
        typeof ath.threshold_pace_sec_per_mile === 'number'
          ? ath.threshold_pace_sec_per_mile
          : null,
      maxHrBpm: typeof ath.max_hr_bpm === 'number' ? ath.max_hr_bpm : null,
      restingHrBpm: typeof ath.resting_hr_bpm === 'number' ? ath.resting_hr_bpm : null,
      dataOrigin: String(ath.data_origin ?? 'live'),
    },
    availableAthletes: resolved.availableAthletes,
    loadIntelligence,
    plannedWorkouts,
    alerts: finalAlerts,
    weeklyReports,
    guardrails,
    analyzedAt,
  };
}

export interface PlannedWorkoutInput {
  workoutDate: string;
  title: string;
  workoutType: 'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race' | 'Rest';
  plannedMiles: number;
  plannedDurationMin: number;
  targetPaceSecPerMile?: number | null;
  targetZone?: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | null;
  sourceProvider?: 'coach_entry' | 'final_surge_csv';
  externalWorkoutId?: string | null;
}

const VALID_WORKOUT_TYPES = new Set([
  'Easy',
  'Long Run',
  'Tempo',
  'Intervals',
  'Recovery',
  'Race',
  'Rest',
]);

const VALID_ZONES = new Set(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);

export async function addPlannedWorkoutsForAthlete(options: {
  coachId: string;
  athleteId: string;
  workouts: PlannedWorkoutInput[];
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; statusCode: number; insertedCount: number; error?: string }> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  if (!client) {
    return { ok: false, statusCode: 503, insertedCount: 0, error: 'Supabase not configured.' };
  }

  const { data: ath } = await client
    .from('athletes')
    .select('id')
    .eq('id', options.athleteId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!ath?.id) {
    return {
      ok: false,
      statusCode: 404,
      insertedCount: 0,
      error: 'Athlete not found for authenticated coach.',
    };
  }

  if (!Array.isArray(options.workouts) || options.workouts.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      insertedCount: 0,
      error: 'At least one planned workout is required.',
    };
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const w of options.workouts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.workoutDate ?? '').trim())) {
      return {
        ok: false,
        statusCode: 400,
        insertedCount: 0,
        error: 'Each planned workout requires a valid YYYY-MM-DD workoutDate.',
      };
    }
    if (!w.title || typeof w.title !== 'string' || !w.title.trim()) {
      return {
        ok: false,
        statusCode: 400,
        insertedCount: 0,
        error: 'Each planned workout requires a non-empty title.',
      };
    }
    if (!VALID_WORKOUT_TYPES.has(w.workoutType)) {
      return {
        ok: false,
        statusCode: 400,
        insertedCount: 0,
        error: `Unsupported workoutType "${String(w.workoutType)}".`,
      };
    }
    const miles = Number(w.plannedMiles ?? 0);
    const durMin = Number(w.plannedDurationMin ?? 0);
    if (!Number.isFinite(miles) || miles < 0 || !Number.isFinite(durMin) || durMin < 0) {
      return {
        ok: false,
        statusCode: 400,
        insertedCount: 0,
        error: 'Planned miles and duration must be non-negative numbers.',
      };
    }
    const zone = w.targetZone && VALID_ZONES.has(w.targetZone) ? w.targetZone : null;
    const targetPace =
      w.targetPaceSecPerMile && Number.isFinite(w.targetPaceSecPerMile) && w.targetPaceSecPerMile > 0
        ? Math.round(w.targetPaceSecPerMile)
        : null;

    rows.push({
      coach_id: options.coachId,
      athlete_id: options.athleteId,
      source_provider: w.sourceProvider === 'final_surge_csv' ? 'final_surge_csv' : 'coach_entry',
      external_workout_id: w.externalWorkoutId?.trim() || null,
      workout_date: w.workoutDate.trim(),
      title: w.title.trim(),
      workout_type: w.workoutType,
      planned_miles: round2(miles),
      planned_duration_min: round2(durMin),
      target_pace_sec_per_mile: targetPace,
      target_zone: zone,
    });
  }

  const { error } = await client.from('planned_workouts').insert(rows);
  if (error) {
    return { ok: false, statusCode: 500, insertedCount: 0, error: error.message };
  }

  await client
    .from('audit_events')
    .insert({
      coach_id: options.coachId,
      actor_role: 'owner_coach',
      action: 'PLANNED_WORKOUTS_ADDED',
      target_entity: 'planned_workouts',
      target_id: options.athleteId,
      athlete_id_snapshot: options.athleteId,
      detail: `Added ${rows.length} planned workout(s) for athlete ${options.athleteId}.`,
    })
    .then(() => undefined, () => undefined);

  return { ok: true, statusCode: 201, insertedCount: rows.length };
}

export async function updateCoachingAlertStatus(options: {
  coachId: string;
  alertId: string;
  status: 'active' | 'acknowledged' | 'resolved';
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  if (!client) {
    return { ok: false, statusCode: 503, error: 'Supabase not configured.' };
  }
  if (!['active', 'acknowledged', 'resolved'].includes(options.status)) {
    return { ok: false, statusCode: 400, error: 'Invalid alert status.' };
  }

  const { data: existing } = await client
    .from('coaching_alerts')
    .select('id, athlete_id')
    .eq('id', options.alertId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!existing?.id) {
    return { ok: false, statusCode: 404, error: 'Coaching alert not found for coach.' };
  }

  const { error } = await client
    .from('coaching_alerts')
    .update({
      status: options.status,
      resolved_at: options.status === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('id', options.alertId)
    .eq('coach_id', options.coachId);

  if (error) {
    return { ok: false, statusCode: 500, error: error.message };
  }

  await client
    .from('audit_events')
    .insert({
      coach_id: options.coachId,
      actor_role: 'owner_coach',
      action: 'COACHING_ALERT_STATUS_UPDATED',
      target_entity: 'coaching_alerts',
      target_id: options.alertId,
      athlete_id_snapshot: existing.athlete_id ? String(existing.athlete_id) : null,
      detail: `Alert status updated to ${options.status}.`,
    })
    .then(() => undefined, () => undefined);

  return { ok: true, statusCode: 200 };
}

export async function updateWeeklyReportCoachState(options: {
  coachId: string;
  athleteId: string;
  weekStartDate: string;
  coachNote?: string;
  status?: 'Draft' | 'Approved';
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  if (!client) {
    return { ok: false, statusCode: 503, error: 'Supabase not configured.' };
  }

  const { data: existing } = await client
    .from('weekly_reports')
    .select('id, status')
    .eq('coach_id', options.coachId)
    .eq('athlete_id', options.athleteId)
    .eq('week_start_date', options.weekStartDate)
    .maybeSingle();

  if (!existing?.id) {
    return {
      ok: false,
      statusCode: 404,
      error: 'Weekly report not found. Run intelligence analysis first.',
    };
  }

  const updates: Record<string, unknown> = {
    email_dispatch_blocked: true,
  };
  if (typeof options.coachNote === 'string') {
    updates.coach_note = options.coachNote;
  }
  if (options.status === 'Approved' || options.status === 'Draft') {
    updates.status = options.status;
    updates.approved_at = options.status === 'Approved' ? new Date().toISOString() : null;
  }

  const { error } = await client
    .from('weekly_reports')
    .update(updates)
    .eq('id', existing.id)
    .eq('coach_id', options.coachId);

  if (error) {
    return { ok: false, statusCode: 500, error: error.message };
  }

  await client
    .from('audit_events')
    .insert({
      coach_id: options.coachId,
      actor_role: 'owner_coach',
      action: 'WEEKLY_REPORT_UPDATED',
      target_entity: 'weekly_reports',
      target_id: String(existing.id),
      athlete_id_snapshot: options.athleteId,
      detail: `Weekly report (${options.weekStartDate}) updated by coach${
        options.status ? ` (status: ${options.status})` : ''
      }.`,
    })
    .then(() => undefined, () => undefined);

  return { ok: true, statusCode: 200 };
}

export async function markWorkoutMatchReviewed(options: {
  coachId: string;
  matchId: string;
  supabaseClient?: SupabaseClient | null;
}): Promise<{ ok: boolean; statusCode: number; error?: string }> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  if (!client) {
    return { ok: false, statusCode: 503, error: 'Supabase not configured.' };
  }

  const { data: existing } = await client
    .from('workout_matches')
    .select('id, athlete_id')
    .eq('id', options.matchId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!existing?.id) {
    return { ok: false, statusCode: 404, error: 'Workout match not found for coach.' };
  }

  const { error } = await client
    .from('workout_matches')
    .update({
      coach_reviewed: true,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', options.matchId)
    .eq('coach_id', options.coachId);

  if (error) {
    return { ok: false, statusCode: 500, error: error.message };
  }

  return { ok: true, statusCode: 200 };
}
