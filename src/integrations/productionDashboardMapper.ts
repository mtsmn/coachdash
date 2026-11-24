import {
  AICoachingInsight,
  Athlete,
  AttentionFlag,
  CoachingFinding,
  DataAuthorizationStatus,
  GarminAthleteBiometrics,
  HrZoneConfig,
  IntensityZone,
  IntelligenceFindingClassification,
  LthrRecord,
  TrainingGroup,
  WeeklyAthleteReport,
  Workout,
  WorkoutType,
} from '../types/coaching';
import {
  intervalsIcuAdapter,
  ProductionPilotDashboardResponse,
} from './intervalsIcuAdapter';
import {
  CoachingFindingDto,
  PersistedWeeklyReportDto,
  ProductionCoachingIntelligenceDto,
  productionIntelligenceAdapter,
} from './productionIntelligenceAdapter';
import {
  buildTwelveWeekWindow,
  computeACWR,
  computeWeeklyVolumeSeries,
  estimateRacePerformances,
  formatPace,
} from '../utils/analytics';
import { classifyHrIntoZone, computeLthrZones } from '../utils/lthrAnalytics';

export interface ProductionWorkspaceBundle {
  configured: boolean;
  connection: ProductionPilotDashboardResponse['connection'];
  rosterOverview: ProductionPilotDashboardResponse['rosterOverview'] | null;
  availableAthletes: NonNullable<ProductionPilotDashboardResponse['availableAthletes']>;
  athletes: Athlete[];
  insights: Record<string, AICoachingInsight>;
  reports: WeeklyAthleteReport[];
  syncLogs: ProductionPilotDashboardResponse['syncLogs'];
  defaultAthleteId: string | null;
}

const DEFAULT_HR_ZONE_CONFIG: HrZoneConfig = {
  methodology: 'friel_running',
  updatedAt: new Date().toISOString().slice(0, 10),
};

function normalizeTrainingGroup(raw: string | null | undefined): TrainingGroup {
  const val = (raw ?? '').toLowerCase();
  if (val.includes('half')) return 'Half Marathon';
  if (val.includes('10k') || val.includes('5k') || val.includes('track')) return '10K / 5K Track';
  if (val.includes('ultra') || val.includes('trail')) return 'Ultra / Trail';
  if (val.includes('base') || val.includes('return')) return 'Base / Return';
  return 'Marathon';
}

function normalizePhase(
  raw: string | null | undefined
): Athlete['currentPhase'] {
  const val = (raw ?? '').toLowerCase();
  if (val === 'base') return 'Base';
  if (val === 'peak') return 'Peak';
  if (val === 'taper') return 'Taper';
  if (val === 'recovery') return 'Recovery';
  return 'Build';
}

function normalizeWorkoutType(raw: string | null | undefined): WorkoutType {
  const val = (raw ?? '').toLowerCase();
  if (val.includes('long')) return 'Long Run';
  if (val.includes('tempo') || val.includes('threshold')) return 'Tempo';
  if (val.includes('interval') || val.includes('track') || val.includes('speed')) return 'Intervals';
  if (val.includes('recovery')) return 'Recovery';
  if (val.includes('race')) return 'Race';
  if (val.includes('rest')) return 'Rest';
  return 'Easy';
}

function normalizeAuthorizationStatus(
  raw: string | null | undefined
): DataAuthorizationStatus {
  if (raw === 'Authorized (Read-Only)') return 'Authorized (Read-Only)';
  if (raw === 'Pending Athlete Opt-In') return 'Pending Athlete Opt-In';
  if (raw === 'Coach View Only (No API Scope)') return 'Coach View Only (No API Scope)';
  return 'Unlinked';
}

function normalizeHrvStatus(
  raw: string | null | undefined
): GarminAthleteBiometrics['garminHrvStatus'] {
  const v = (raw ?? '').toLowerCase();
  if (v.includes('unbalanced') || v.includes('poor')) return 'Unbalanced';
  if (v.includes('low')) return 'Low';
  if (v.includes('strain')) return 'Strained';
  return 'Balanced';
}

function resolveProductionAnchorDate(
  pilotData: ProductionPilotDashboardResponse,
  intelligenceData: ProductionCoachingIntelligenceDto | null
): string {
  const candidates: string[] = [];
  if (intelligenceData?.loadIntelligence?.systemC?.latestDate) {
    candidates.push(intelligenceData.loadIntelligence.systemC.latestDate);
  }
  if (pilotData.activities.length > 0) {
    candidates.push(pilotData.activities[0].activityDate);
  }
  if (pilotData.dailyLoadHistories.length > 0) {
    candidates.push(
      pilotData.dailyLoadHistories[pilotData.dailyLoadHistories.length - 1].loadDate
    );
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  candidates.push(todayIso);
  const valid = candidates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return valid[valid.length - 1] ?? todayIso;
}

function computeWeekIndexInWindow(dateIso: string, weekMondays: string[]): number {
  for (let i = weekMondays.length - 1; i >= 0; i--) {
    if (dateIso >= weekMondays[i]) {
      return i + 1;
    }
  }
  return 0;
}

function computeSingleActivityZoneBreakdown(
  avgHrBpm: number | null,
  hrDataState: Workout['hrDataState'],
  lthrBpm: number,
  maxHrBpm: number
): Record<IntensityZone, number> {
  const empty: Record<IntensityZone, number> = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  if (hrDataState !== 'valid' || avgHrBpm === null || lthrBpm <= 0) {
    return empty;
  }
  const zones = computeLthrZones(lthrBpm, DEFAULT_HR_ZONE_CONFIG, maxHrBpm || undefined);
  const dominant = classifyHrIntoZone(avgHrBpm, zones);
  if (!dominant) return empty;
  return {
    ...empty,
    [dominant]: 100,
  };
}

export function mapProductionAthleteToDashboardModel(params: {
  pilotData: ProductionPilotDashboardResponse;
  intelligenceData: ProductionCoachingIntelligenceDto | null;
}): Athlete | null {
  const { pilotData, intelligenceData } = params;
  const dbAthlete = pilotData.athlete;
  if (!dbAthlete) return null;

  const anchorDateIso = resolveProductionAnchorDate(pilotData, intelligenceData);
  const window = buildTwelveWeekWindow(anchorDateIso);

  const lthrBpm =
    dbAthlete.activeLthrBpm && dbAthlete.activeLthrBpm > 0
      ? Math.round(dbAthlete.activeLthrBpm)
      : 0;
  const hasActiveLthr = lthrBpm > 0;
  const maxHrBpm = dbAthlete.maxHrBpm && dbAthlete.maxHrBpm > 0 ? Math.round(dbAthlete.maxHrBpm) : 0;
  const restingHrBpm =
    dbAthlete.restingHrBpm && dbAthlete.restingHrBpm > 0 ? Math.round(dbAthlete.restingHrBpm) : 0;
  const thresholdPaceSecPerMile =
    dbAthlete.thresholdPaceSecPerMile && dbAthlete.thresholdPaceSecPerMile > 0
      ? Math.round(dbAthlete.thresholdPaceSecPerMile)
      : 0;

  const lthrHistory: LthrRecord[] = hasActiveLthr
    ? [
        {
          id: `${dbAthlete.id}-lthr-v1`,
          version: 1,
          lthrBpm,
          recordedDate: (dbAthlete.updatedAt ?? anchorDateIso).slice(0, 10),
          effectiveDate: window.startDateIso,
          source: 'Garmin Auto-Detected',
          garminDeviceLabel:
            pilotData.activities.find((a) => a.sourceDevice)?.sourceDevice ?? 'Intervals.icu',
          coachVerified: true,
          optionalThresholdPaceSecPerMile:
            thresholdPaceSecPerMile > 0 ? thresholdPaceSecPerMile : null,
          optionalThresholdPowerWatts: dbAthlete.optionalThresholdPowerWatts ?? null,
          notes: 'Active threshold synchronized from Supabase / Intervals.icu profile.',
        },
      ]
    : [];

  const rosterRow = pilotData.rosterOverview?.athletes?.find(
    (r) => r.internalAthleteId === dbAthlete.id
  );
  const lastSyncedAt =
    rosterRow?.lastSuccessfulSyncAt ??
    pilotData.connection?.lastSynchronizedAt ??
    dbAthlete.updatedAt ??
    null;

  const wellnessLatest = pilotData.wellnessRecords[0] ?? null;
  const wellnessReadiness = intelligenceData?.loadIntelligence?.wellnessReadiness ?? {
    hasWellnessData: pilotData.wellnessRecords.length > 0,
    latestDate: wellnessLatest?.recordDate ?? null,
    restingHrBpm: wellnessLatest?.restingHrBpm ?? (restingHrBpm > 0 ? restingHrBpm : null),
    hrvRmssd: wellnessLatest?.hrvRmssd ?? null,
    hrvStatus: wellnessLatest?.hrvStatus ?? null,
    sleepHours: wellnessLatest?.sleepHours ?? null,
  };

  const providerNative = intelligenceData?.loadIntelligence?.providerNative ?? {
    available:
      pilotData.activities.some((a) => a.icuTrainingLoad !== null || a.icuFitness !== null) ||
      pilotData.wellnessRecords.some((w) => w.icuCtl !== null),
    latestDate: wellnessLatest?.recordDate ?? pilotData.activities[0]?.activityDate ?? null,
    icuCtl: wellnessLatest?.icuCtl ?? pilotData.activities[0]?.icuFitness ?? null,
    icuAtl: wellnessLatest?.icuAtl ?? pilotData.activities[0]?.icuFatigue ?? null,
    icuForm: wellnessLatest?.icuTsb ?? pilotData.activities[0]?.icuForm ?? null,
    recent7dNativeLoad: null,
  };

  const sysC = intelligenceData?.loadIntelligence?.systemC ?? {
    available: pilotData.dailyLoadHistories.length > 0,
    primaryMethodology: 'hr_derived_stress',
    primaryMethodologyLabel: 'HR-Derived Running Stress (hrRSS)',
    latestDate:
      pilotData.dailyLoadHistories[pilotData.dailyLoadHistories.length - 1]?.loadDate ?? null,
    ctl: pilotData.dailyLoadHistories[pilotData.dailyLoadHistories.length - 1]?.ctl ?? null,
    atl: pilotData.dailyLoadHistories[pilotData.dailyLoadHistories.length - 1]?.atl ?? null,
    tsb: pilotData.dailyLoadHistories[pilotData.dailyLoadHistories.length - 1]?.tsb ?? null,
    historyDays: pilotData.dailyLoadHistories.length,
    historySufficiency: (pilotData.dailyLoadHistories.length >= 42
      ? 'full_42d'
      : pilotData.dailyLoadHistories.length >= 14
      ? 'short_14d'
      : pilotData.dailyLoadHistories.length > 0
      ? 'insufficient'
      : 'none') as 'full_42d' | 'short_14d' | 'insufficient' | 'none',
    ctlDelta14d: null,
    note: '',
    methodologies: [],
  };

  const plannedList =
    intelligenceData?.plannedWorkouts ??
    pilotData.plannedWorkouts?.map((pw) => ({
      ...pw,
      sourceProvider: (pw.sourceProvider as 'coach_entry' | 'final_surge_api' | 'final_surge_csv' | null) ?? null,
      description: null,
      structuredSteps: [],
      originalDistanceLabel: null,
    })) ??
    [];

  // Map completed Intervals.icu activities (strictly preserving System A vs System B separation)
  const completedWorkouts: Workout[] = pilotData.activities.map((act) => {
    const wkIdx = computeWeekIndexInWindow(act.activityDate, window.weekMondays);
    const hrState = act.hrDataState;
    const hrIf =
      hrState === 'valid' && act.avgHrBpm && lthrBpm > 0
        ? Number((act.avgHrBpm / lthrBpm).toFixed(3))
        : null;

    return {
      id: act.id,
      athleteId: dbAthlete.id,
      date: act.activityDate,
      weekIndex: wkIdx,
      title: act.title,
      type: normalizeWorkoutType(act.activityType),
      status: 'Completed',
      plannedMiles: 0,
      actualMiles: Number(act.distanceMiles.toFixed(2)),
      durationMinutes: Number(act.durationMinutes.toFixed(1)),
      avgPaceSecPerMile: act.avgPaceSecPerMile,
      avgHrBpm: act.avgHrBpm,
      maxHrBpm: act.maxHrBpm,
      avgPowerWatts: act.avgPowerWatts,
      rpe: act.rpe,
      elevationGainFt: Math.round(act.elevationGainFt ?? 0),
      zoneBreakdown: computeSingleActivityZoneBreakdown(
        act.avgHrBpm,
        hrState,
        lthrBpm,
        maxHrBpm
      ),
      hrDataState: hrState,
      hrValidationFlags: act.hrValidationFlags ?? [],
      // System B metrics strictly from independent_stress_metrics (never overwritten with System A!)
      stress: {
        hrStress: act.hrRunningStress,
        hrIntensityFactor: hrIf,
        paceStressProxy: act.paceRunningStress,
        powerStressProxy: act.powerRunningStress,
        sessionRpeStress: act.sessionRpeStress,
        methodologyLabel: 'HR-Derived Running Stress (hrRSS)',
        isTssEquivalent: false,
        thresholdVersionUsed: hasActiveLthr ? 1 : 0,
        lthrBpmUsed: lthrBpm,
        calculatedAt: lastSyncedAt ?? `${anchorDateIso}T00:00:00Z`,
      },
      // System A Intervals.icu native values untouched
      garminMetrics: {
        garminTrainingLoad: act.icuTrainingLoad,
        aerobicTrainingEffect: null,
        anaerobicTrainingEffect: null,
        vo2MaxEstimate: null,
        recoveryTimeHours: null,
        providerLabel: 'Garmin Connect (Original Metric)',
      },
      systemALoad: act.icuTrainingLoad,
      systemAFitness: act.icuFitness,
      systemAFatigue: act.icuFatigue,
      systemAForm: act.icuForm,
      provenance: {
        sourceProvider: 'Garmin (Local Sample)',
        ingestedAt: lastSyncedAt ?? `${anchorDateIso}T00:00:00Z`,
        calculationMethod: 'System B Independent Stress + System A Intervals.icu Native Preserved',
        thresholdVersion: hasActiveLthr ? 1 : 0,
        thresholdSource: 'Garmin Auto-Detected',
        lthrBpmUsed: lthrBpm,
        originalValuesPreserved: true,
      },
      source: 'Intervals.icu (Supabase)',
    };
  });

  // Include planned workouts cleanly as status: 'Planned' (actualMiles: 0) so mileage totals & calendars show planned workouts without compliance scoring
  const plannedWorkoutRows: Workout[] = plannedList.map((pw) => ({
    id: `planned-${pw.id}`,
    athleteId: dbAthlete.id,
    date: pw.workoutDate,
    weekIndex: computeWeekIndexInWindow(pw.workoutDate, window.weekMondays),
    title: pw.title,
    type: normalizeWorkoutType(pw.workoutType),
    status: 'Planned',
    plannedMiles: Number((pw.plannedMiles ?? 0).toFixed(2)),
    actualMiles: 0,
    durationMinutes: pw.plannedDurationMin ?? 0,
    avgPaceSecPerMile: pw.targetPaceSecPerMile ?? null,
    avgHrBpm: null,
    maxHrBpm: null,
    avgPowerWatts: null,
    rpe: null,
    elevationGainFt: 0,
    zoneBreakdown: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 },
    hrDataState: 'rest_zero',
    hrValidationFlags: [],
    stress: {
      hrStress: null,
      hrIntensityFactor: null,
      paceStressProxy: null,
      powerStressProxy: null,
      sessionRpeStress: null,
      methodologyLabel: 'HR-Derived Running Stress (hrRSS)',
      isTssEquivalent: false,
      thresholdVersionUsed: hasActiveLthr ? 1 : 0,
      lthrBpmUsed: lthrBpm,
      calculatedAt: `${pw.workoutDate}T00:00:00Z`,
    },
    provenance: {
      sourceProvider: 'Coach Entry',
      ingestedAt: `${pw.workoutDate}T00:00:00Z`,
      calculationMethod: 'Planned workout record (Supabase planned_workouts)',
      thresholdVersion: hasActiveLthr ? 1 : 0,
      thresholdSource: 'Coach-Approved Manual Fallback',
      lthrBpmUsed: lthrBpm,
      originalValuesPreserved: true,
    },
    source: 'Intervals.icu (Supabase)',
  }));

  const workouts = [...completedWorkouts, ...plannedWorkoutRows].sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  const garminTrainingStatus: GarminAthleteBiometrics['garminTrainingStatus'] =
    sysC.tsb !== null && sysC.tsb >= 4
      ? 'Peaking'
      : sysC.tsb !== null && sysC.tsb <= -18
      ? 'Strained'
      : sysC.atl !== null && sysC.ctl !== null && sysC.atl < sysC.ctl * 0.85
      ? 'Recovery'
      : 'Productive';

  return {
    id: dbAthlete.id,
    finalSurgeId: dbAthlete.externalAthleteId ? `fs-${dbAthlete.externalAthleteId}` : '',
    intervalsIcuAthleteId: dbAthlete.externalAthleteId,
    dataAuthorizationStatus: normalizeAuthorizationStatus(dbAthlete.authorizationStatus),
    sportSpecialization: dbAthlete.sportSpecialization ?? undefined,
    name: dbAthlete.fullName,
    email: dbAthlete.email ?? '',
    age: dbAthlete.age ?? 0,
    gender: dbAthlete.gender === 'F' ? 'F' : dbAthlete.gender === 'NB' ? 'NB' : 'M',
    location: dbAthlete.location ?? '',
    trainingGroup: normalizeTrainingGroup(dbAthlete.trainingGroup),
    experienceYears: 0,
    restingHrBpm: wellnessReadiness.restingHrBpm ?? restingHrBpm,
    maxHrBpm,
    lthrBpm,
    activeThresholdVersion: hasActiveLthr ? 1 : 0,
    lthrHistory,
    hrZoneConfig: DEFAULT_HR_ZONE_CONFIG,
    thresholdPaceSecPerMile,
    optionalThresholdPowerWatts: dbAthlete.optionalThresholdPowerWatts ?? null,
    currentPhase: normalizePhase(dbAthlete.currentPhase),
    goal: {
      raceName: 'No goal race configured',
      raceDate: '',
      distanceLabel: 'Marathon',
      distanceMiles: 0,
      targetTimeSeconds: 0,
      priority: 'A',
    },
    coachNotes: '',
    garminBiometrics: {
      garminDetectedLthrBpm: hasActiveLthr ? lthrBpm : null,
      garminLthrDetectedDate: hasActiveLthr ? (dbAthlete.updatedAt ?? anchorDateIso).slice(0, 10) : null,
      garminLthrDevice:
        pilotData.activities.find((a) => a.sourceDevice)?.sourceDevice ?? 'Intervals.icu',
      garminVo2Max: 0,
      garminHrvStatus: normalizeHrvStatus(wellnessReadiness.hrvStatus),
      garminTrainingStatus,
      garminRestingHrBpm: wellnessReadiness.restingHrBpm ?? restingHrBpm,
      garmin7DayLoad: Math.round(providerNative.recent7dNativeLoad ?? 0),
      garminAcuteLoad: Math.round(providerNative.icuAtl ?? 0),
      garminChronicLoad: Math.round(providerNative.icuCtl ?? 0),
      garminLoadFocus: 'Balanced',
      lastSyncedAt: lastSyncedAt ?? '',
      providerNote:
        'Synchronized read-only from Intervals.icu into Supabase. Native load metrics are preserved separately from System B/C.',
    },
    recalculationLog: [],
    workouts,
    raceHistory: [],
    productionContext: {
      isProduction: true,
      anchorDateIso,
      hasGoalRace: false,
      hasActiveLthr,
      hasThresholdPace: thresholdPaceSecPerMile > 0,
      hasMaxHr: maxHrBpm > 0,
      hasRestingHr: (wellnessReadiness.restingHrBpm ?? restingHrBpm) > 0,
      activitiesCount: rosterRow?.activitiesCount ?? pilotData.activities.length,
      hrStreamsCount: rosterRow?.hrStreamsCount ?? 0,
      wellnessCount: rosterRow?.wellnessCount ?? pilotData.wellnessRecords.length,
      plannedWorkoutsCount: plannedList.length,
      syncStatus: rosterRow?.currentSyncStatus ?? 'Ready',
      lastSyncedAt,
      latestWeightKg: dbAthlete.latestWeightKg ?? null,
      wellnessReadiness: {
        hasWellnessData: wellnessReadiness.hasWellnessData,
        latestDate: wellnessReadiness.latestDate,
        restingHrBpm: wellnessReadiness.restingHrBpm,
        hrvRmssd: wellnessReadiness.hrvRmssd,
        hrvStatus: wellnessReadiness.hrvStatus,
        sleepHours: wellnessReadiness.sleepHours,
      },
      providerNative: {
        available: providerNative.available,
        latestDate: providerNative.latestDate,
        icuCtl: providerNative.icuCtl,
        icuAtl: providerNative.icuAtl,
        icuForm: providerNative.icuForm,
        recent7dNativeLoad: providerNative.recent7dNativeLoad,
      },
      systemC: {
        available: sysC.available,
        primaryMethodology: sysC.primaryMethodology,
        primaryMethodologyLabel: sysC.primaryMethodologyLabel,
        latestDate: sysC.latestDate,
        ctl: sysC.ctl,
        atl: sysC.atl,
        tsb: sysC.tsb,
        historyDays: sysC.historyDays,
        historySufficiency: sysC.historySufficiency,
        ctlDelta14d: sysC.ctlDelta14d,
        note: sysC.note,
        methodologies: sysC.methodologies,
      },
      dailyLoadHistories: pilotData.dailyLoadHistories,
      plannedWorkouts: plannedList.map((pw) => ({
        id: pw.id,
        workoutDate: pw.workoutDate,
        title: pw.title,
        workoutType: pw.workoutType,
        plannedMiles: pw.plannedMiles,
        plannedDurationMin: pw.plannedDurationMin,
        targetPaceSecPerMile: pw.targetPaceSecPerMile,
        targetZone: pw.targetZone,
        sourceProvider: pw.sourceProvider,
      })),
      weeklySeriesFromBackend: intelligenceData?.loadIntelligence?.weeklySeries,
    },
  };
}

function mapDomain(raw: string): CoachingFinding['domain'] {
  switch (raw) {
    case 'training_load':
      return 'CTL / ATL / TSB';
    case 'mileage_consistency':
      return 'Mileage & Consistency';
    case 'lthr_zones':
      return 'LTHR & HR Response';
    case 'efficiency':
      return 'Aerobic Efficiency';
    case 'wellness_recovery':
      return 'Wellness & Readiness';
    case 'data_sufficiency':
    default:
      return 'Data Sufficiency';
  }
}

function mapAttentionCategory(raw: string): AttentionFlag['category'] {
  const lower = raw.toLowerCase();
  if (lower.includes('load') || lower.includes('ctl') || lower.includes('fatigue')) {
    return 'Workload Spike';
  }
  if (lower.includes('hrv') || lower.includes('recovery') || lower.includes('hr')) {
    return 'Recovery / HR Drift';
  }
  if (lower.includes('lthr')) {
    return 'LTHR Source / Approval';
  }
  return 'Data Integrity / HR';
}

function isComplianceDto(al: CoachingFindingDto): boolean {
  return (
    al.domain.toLowerCase() === 'compliance' ||
    al.category.toLowerCase().includes('compliance') ||
    al.title.toLowerCase().includes('missed workout')
  );
}

export function mapProductionIntelligenceToAICoachingInsight(params: {
  athlete: Athlete;
  intelligenceData: ProductionCoachingIntelligenceDto | null;
}): AICoachingInsight {
  const { athlete, intelligenceData } = params;
  const anchorDate = athlete.productionContext?.anchorDateIso ?? new Date().toISOString().slice(0, 10);
  const weekly = computeWeeklyVolumeSeries(athlete.workouts, anchorDate);
  const acwr = computeACWR(weekly);
  const raceEstimates = estimateRacePerformances(athlete);

  const loadInt = intelligenceData?.loadIntelligence;
  const ctl = loadInt?.systemC.ctl ?? athlete.productionContext?.systemC.ctl ?? 0;
  const atl = loadInt?.systemC.atl ?? athlete.productionContext?.systemC.atl ?? 0;
  const tsb = loadInt?.systemC.tsb ?? athlete.productionContext?.systemC.tsb ?? 0;

  const cleanAlerts = (intelligenceData?.alerts ?? []).filter((al) => !isComplianceDto(al));
  const findings: CoachingFinding[] = cleanAlerts.map((al, idx) => ({
    id: al.id ?? `${athlete.id}-finding-${idx}`,
    alertId: al.id,
    status: al.status,
    classification: al.classification,
    domain: mapDomain(al.domain),
    headline: al.title,
    evidence: al.supportingData,
  }));

  const attentionAreas: AttentionFlag[] = cleanAlerts
    .filter(
      (al) =>
        al.classification === 'High priority: Coach review recommended' ||
        al.classification === 'Moderate priority: Monitor'
    )
    .map((al, idx) => ({
      id: al.id ?? `${athlete.id}-flag-${idx}`,
      severity: al.severity,
      category: mapAttentionCategory(al.category),
      summary: al.explanation,
      metricDetail: al.supportingData[0] ?? al.category,
    }));

  const hasHigh = cleanAlerts.some(
    (al) => al.classification === 'High priority: Coach review recommended'
  );
  const hasModerate = cleanAlerts.some(
    (al) => al.classification === 'Moderate priority: Monitor'
  );

  const readinessStatus: AICoachingInsight['readinessStatus'] = hasHigh
    ? 'Recovery Focus'
    : hasModerate
    ? 'Monitor Load'
    : 'Optimal';

  const primaryClassification: IntelligenceFindingClassification = hasHigh
    ? 'High priority: Coach review recommended'
    : hasModerate
    ? 'Moderate priority: Monitor'
    : findings.some((f) => f.classification === 'Insufficient data') &&
      !findings.some((f) => f.classification === 'Positive development')
    ? 'Insufficient data'
    : 'Positive development';

  const vol = loadInt?.volumeAndConsistency;
  const weekOverWeekChangePct = vol?.weekOverWeekMileagePct ?? 0;
  const tel = loadInt?.telemetryAndEfficiency;
  const well = loadInt?.wellnessReadiness;
  const prov = loadInt?.providerNative;

  const lthrContextNote =
    athlete.lthrBpm > 0
      ? `Evaluated against active Supabase LTHR ${athlete.lthrBpm} bpm (${loadInt?.systemC.primaryMethodologyLabel ?? 'HR-Derived Running Stress'}).`
      : 'No active LTHR threshold configured in athlete profile; System B hrRSS requires an LTHR threshold or threshold pace.';

  const trainingProgression = vol
    ? `4-week rolling volume is ${vol.fourWeekAvgMiles.toFixed(1)} mi/wk (${
        vol.fourWeekAvgRunsPerWeek.toFixed(1)
      } runs/wk). Last full week totaled ${vol.lastFullWeekMiles.toFixed(1)} mi${
        vol.weekOverWeekMileagePct !== null
          ? ` (${vol.weekOverWeekMileagePct >= 0 ? '+' : ''}${vol.weekOverWeekMileagePct.toFixed(1)}% vs prior week)`
          : ''
      }.${
        tel?.efficiencyChangePct !== null && tel?.efficiencyChangePct !== undefined
          ? ` Aerobic efficiency shifted ${tel.efficiencyChangePct >= 0 ? '+' : ''}${tel.efficiencyChangePct.toFixed(1)}% vs prior 28-day block.`
          : ''
      }`
    : 'Synchronize historical activities to evaluate 4-week volume progression.';

  const workoutExecution = vol
    ? `${vol.last7dRunCount} completed run(s) logged over the last 7 days (${vol.last7dMiles.toFixed(
        1
      )} mi · ${Math.round(vol.last7dDurationMinutes)} min). ${
        athlete.productionContext?.plannedWorkoutsCount
          ? `${athlete.productionContext.plannedWorkoutsCount} planned workout record(s) stored in calendar.`
          : 'No planned workouts recorded yet.'
      }${
        athlete.thresholdPaceSecPerMile > 0
          ? ` Threshold pace benchmark: ${formatPace(athlete.thresholdPaceSecPerMile)}/mi.`
          : ''
      }`
    : 'No recent completed activity summary available.';

  const workloadChanges = loadInt?.systemC.available
    ? `System C (${loadInt.systemC.primaryMethodologyLabel}): 42-day CTL ${ctl.toFixed(
        1
      )}, 7-day ATL ${atl.toFixed(1)}, TSB ${tsb >= 0 ? '+' : ''}${tsb.toFixed(1)} (${
        loadInt.systemC.formLabel ?? 'Balanced'
      }, ${loadInt.systemC.historyDays}d history).${
        prov?.available
          ? ` Intervals.icu Native System A: CTL ${prov.icuCtl?.toFixed(1) ?? '--'} / ATL ${
              prov.icuAtl?.toFixed(1) ?? '--'
            } / Form ${prov.icuForm?.toFixed(1) ?? '--'}.`
          : ''
      }`
    : loadInt?.coachingSummary ?? 'System C load history unavailable pending telemetry.';

  const recoveryObservations = well?.hasWellnessData
    ? `Latest wellness (${well.latestDate ?? '--'}): Resting HR ${well.restingHrBpm ?? '--'} bpm (28d avg ${
        well.restingHrBaseline28d ?? '--'
      }), HRV rMSSD ${well.hrvRmssd ?? '--'} ms (status: ${well.hrvStatus ?? 'Not reported'}), Sleep ${
        well.sleepHours ?? '--'
      } hrs.`
    : 'No recent Intervals.icu wellness telemetry (resting HR / HRV / sleep) available.';

  const coachReviewPrompt =
    loadInt?.coachingSummary ??
    `Review ${athlete.name}'s Supabase-synced telemetry, LTHR configuration, and upcoming sessions.`;

  return {
    athleteId: athlete.id,
    generatedAt: intelligenceData?.analyzedAt ?? new Date().toISOString(),
    engineLabel: 'Production Coaching Intelligence (Supabase + Intervals.icu)',
    readinessStatus,
    primaryClassification,
    findings,
    acwr,
    ctl,
    atl,
    tsb,
    weekOverWeekChangePct,
    lthrContextNote,
    trainingProgression,
    workoutExecution,
    workloadChanges,
    recoveryObservations,
    attentionAreas,
    raceEstimates,
    coachReviewPrompt,
    guardrailNotice:
      intelligenceData?.guardrails?.notice ??
      'Analytical summary only: evaluates physiological trends against individualized LTHR and historical baselines. It does not diagnose injuries, does not predict injuries from training load ratios, and does not automatically prescribe training changes.',
  };
}

export function mapProductionReportToWeeklyAthleteReport(
  athleteId: string,
  dto: PersistedWeeklyReportDto
): WeeklyAthleteReport {
  return {
    id: dto.id,
    athleteId,
    weekStartDate: dto.weekStartDate,
    weekLabel: dto.weekLabel,
    actualMiles: Number((dto.actualMiles ?? 0).toFixed(1)),
    plannedMiles: Number((dto.plannedMiles ?? 0).toFixed(1)),
    weeklyHrStress: dto.weeklyHrStress ?? 0,
    ctl: dto.ctl ?? 0,
    atl: dto.atl ?? 0,
    tsb: dto.tsb ?? 0,
    aiSummary: dto.aiSummary,
    coachNote: dto.coachNote ?? '',
    status: dto.status,
    approvedAt: dto.approvedAt ?? undefined,
    emailDeliveryNote:
      dto.emailDeliveryNote ??
      'Email dispatch is disabled until explicitly approved by the coach.',
    isProduction: true,
  };
}

export async function loadSingleProductionAthleteBundle(params: {
  accessToken: string;
  athleteId: string;
  onAuthError?: (status: 401 | 403, message: string) => void;
  existingPilotData?: ProductionPilotDashboardResponse | null;
}): Promise<{
  athlete: Athlete;
  insight: AICoachingInsight;
  reports: WeeklyAthleteReport[];
  pilotData: ProductionPilotDashboardResponse;
} | null> {
  const { accessToken, athleteId, onAuthError, existingPilotData } = params;
  const [pilotData, intelligenceData] = await Promise.all([
    existingPilotData && existingPilotData.athlete?.id === athleteId
      ? Promise.resolve(existingPilotData)
      : intervalsIcuAdapter.fetchProductionPilotDashboard(accessToken, onAuthError, athleteId),
    productionIntelligenceAdapter.fetchIntelligence({
      accessToken,
      athleteId,
      onAuthError,
    }),
  ]);

  if (!pilotData || !pilotData.athlete) {
    return null;
  }

  const athlete = mapProductionAthleteToDashboardModel({
    pilotData,
    intelligenceData,
  });
  if (!athlete) return null;

  const insight = mapProductionIntelligenceToAICoachingInsight({
    athlete,
    intelligenceData,
  });

  const reports = (intelligenceData?.weeklyReports ?? []).map((rep) =>
    mapProductionReportToWeeklyAthleteReport(athlete.id, rep)
  );

  return {
    athlete,
    insight,
    reports,
    pilotData,
  };
}

export async function loadProductionWorkspaceData(params: {
  accessToken: string;
  preferredAthleteId?: string | null;
  onAuthError?: (status: 401 | 403, message: string) => void;
}): Promise<ProductionWorkspaceBundle> {
  const { accessToken, preferredAthleteId, onAuthError } = params;

  const initialPilot = await intervalsIcuAdapter.fetchProductionPilotDashboard(
    accessToken,
    onAuthError,
    preferredAthleteId
  );

  if (!initialPilot) {
    return {
      configured: false,
      connection: null,
      rosterOverview: null,
      availableAthletes: [],
      athletes: [],
      insights: {},
      reports: [],
      syncLogs: [],
      defaultAthleteId: null,
    };
  }

  const available = initialPilot.availableAthletes ?? [];
  const athleteIdsToLoad =
    available.length > 0
      ? available.map((a) => a.id)
      : initialPilot.athlete
      ? [initialPilot.athlete.id]
      : [];

  const bundles = await Promise.all(
    athleteIdsToLoad.map((id) =>
      loadSingleProductionAthleteBundle({
        accessToken,
        athleteId: id,
        onAuthError,
        existingPilotData: initialPilot.athlete?.id === id ? initialPilot : null,
      })
    )
  );

  const athletes: Athlete[] = [];
  const insights: Record<string, AICoachingInsight> = {};
  const reports: WeeklyAthleteReport[] = [];

  for (const b of bundles) {
    if (!b) continue;
    athletes.push(b.athlete);
    insights[b.athlete.id] = b.insight;
    // Keep most recent full week report (index 0) per athlete for the roster Weekly Reports view
    if (b.reports.length > 0) {
      reports.push(b.reports[0]);
    }
  }

  const pilotVerified =
    available.find((a) => a.isPilotAthlete)?.id ??
    initialPilot.athlete?.id ??
    athletes[0]?.id ??
    null;

  return {
    configured: initialPilot.configured,
    connection: initialPilot.connection,
    rosterOverview: initialPilot.rosterOverview ?? null,
    availableAthletes: available,
    athletes,
    insights,
    reports,
    syncLogs: initialPilot.syncLogs ?? [],
    defaultAthleteId:
      preferredAthleteId && athletes.some((a) => a.id === preferredAthleteId)
        ? preferredAthleteId
        : pilotVerified,
  };
}
