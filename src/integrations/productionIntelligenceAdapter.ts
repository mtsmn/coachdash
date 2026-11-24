export interface WeeklyTrainingLoadPointDto {
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

export interface TrainingLoadIntelligenceDto {
  systemC: {
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
  };
  providerNative: {
    available: boolean;
    latestDate: string | null;
    icuCtl: number | null;
    icuAtl: number | null;
    icuForm: number | null;
    recent7dNativeLoad: number | null;
    isTssEquivalent: false;
    separationNotice: string;
  };
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
  weeklySeries: WeeklyTrainingLoadPointDto[];
  missingDataFlags: string[];
  coachingSummary: string;
  trendInsights: string[];
}

export interface PlannedWorkoutDto {
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

export interface CoachingFindingDto {
  id: string | null;
  category: string;
  severity: 'high' | 'moderate' | 'low';
  classification:
    | 'High priority: Coach review recommended'
    | 'Moderate priority: Monitor'
    | 'Positive development'
    | 'Insufficient data';
  domain: string;
  title: string;
  explanation: string;
  supportingData: string[];
  status: 'active' | 'acknowledged' | 'resolved';
  resolvedAt: string | null;
  createdAt: string | null;
}

export interface PersistedWeeklyReportDto {
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

export interface ProductionCoachingIntelligenceDto {
  ok: boolean;
  statusCode: number;
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
  loadIntelligence: TrainingLoadIntelligenceDto | null;
  plannedWorkouts: PlannedWorkoutDto[];
  alerts: CoachingFindingDto[];
  weeklyReports: PersistedWeeklyReportDto[];
  guardrails: {
    nonDiagnostic: true;
    nonPrescriptive: true;
    providerLoadSeparation: true;
    emailDispatchBlocked: true;
    notice: string;
  };
  analyzedAt: string;
}

function authHeaders(accessToken?: string | null, extra?: Record<string, string>) {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (accessToken?.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

export const productionIntelligenceAdapter = {
  async fetchIntelligence(params: {
    accessToken?: string | null;
    athleteId?: string | null;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<ProductionCoachingIntelligenceDto | null> {
    try {
      const qs = params.athleteId
        ? `?athleteId=${encodeURIComponent(params.athleteId)}`
        : '';
      const res = await fetch(`/api/production/intelligence${qs}`, {
        headers: authHeaders(params.accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(
          res.status,
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: owner-coach authorization required (HTTP 403).'
        );
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as ProductionCoachingIntelligenceDto;
    } catch {
      return null;
    }
  },

  async runAndPersistAnalysis(params: {
    accessToken?: string | null;
    athleteId?: string | null;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<ProductionCoachingIntelligenceDto | null> {
    try {
      const res = await fetch('/api/production/intelligence/analyze', {
        method: 'POST',
        headers: authHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId ?? undefined,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(
          res.status,
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: owner-coach authorization required (HTTP 403).'
        );
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as ProductionCoachingIntelligenceDto;
    } catch {
      return null;
    }
  },

  async addPlannedWorkout(params: {
    accessToken?: string | null;
    athleteId: string;
    workout: {
      workoutDate: string;
      title: string;
      workoutType: 'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race' | 'Rest';
      plannedMiles: number;
      plannedDurationMin: number;
      targetZone?: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | null;
    };
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<{ ok: boolean; error?: string; intelligence?: ProductionCoachingIntelligenceDto }> {
    try {
      const res = await fetch(
        `/api/production/athletes/${encodeURIComponent(params.athleteId)}/planned-workouts`,
        {
          method: 'POST',
          headers: authHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ workouts: [params.workout] }),
        }
      );
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
        return { ok: false, error: 'Authorization failed.' };
      }
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        intelligence?: ProductionCoachingIntelligenceDto;
      };
      if (!res.ok || !data.ok) {
        return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      }
      return { ok: true, intelligence: data.intelligence };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to save planned workout.',
      };
    }
  },

  async updateAlertStatus(params: {
    accessToken?: string | null;
    alertId: string;
    status: 'active' | 'acknowledged' | 'resolved';
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<boolean> {
    try {
      const res = await fetch(`/api/production/alerts/${encodeURIComponent(params.alertId)}`, {
        method: 'PATCH',
        headers: authHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: params.status }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  },

  async updateWeeklyReport(params: {
    accessToken?: string | null;
    athleteId: string;
    weekStartDate: string;
    coachNote?: string;
    status?: 'Draft' | 'Approved';
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<boolean> {
    try {
      const res = await fetch('/api/production/reports/update', {
        method: 'POST',
        headers: authHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId,
          weekStartDate: params.weekStartDate,
          coachNote: params.coachNote,
          status: params.status,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  },

};
