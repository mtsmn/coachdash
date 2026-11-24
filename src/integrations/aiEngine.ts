import { AICoachingEngine } from './types';
import {
  AICoachingInsight,
  Athlete,
  AttentionFlag,
  CoachingFinding,
  IntegrationConnectionState,
  IntelligenceFindingClassification,
} from '../types/coaching';
import {
  buildTwelveWeekWindow,
  computeACWR,
  computePaceHrTrends,
  computeWeeklyVolumeSeries,
  daysUntilDate,
  estimateRacePerformances,
  formatDuration,
  formatPace,
  resolveAnchorDateIso,
} from '../utils/analytics';
import { resolveAthleteLoadSeries } from '../utils/commandCenterAnalytics';

/**
 * Rules-Based Running Coaching Analysis Engine (Zero Paid AI APIs)
 * Evaluates training against each athlete's Garmin-detected LTHR (preferred) or
 * coach-approved manual fallback LTHR, historical baselines, CTL/ATL/TSB load curves,
 * and telemetry from Intervals.icu / Final Surge.
 *
 * Guardrails:
 * - Does NOT diagnose medical conditions or injuries.
 * - Does NOT predict injuries from training load ratios.
 * - Does NOT automatically prescribe training changes.
 */
export class LocalHeuristicAIEngine implements AICoachingEngine {
  getConnectionInfo(): IntegrationConnectionState {
    return {
      id: 'ai',
      name: 'Rules-Based Coaching Intelligence Engine',
      role: 'Baseline-Anchored LTHR, CTL/ATL/TSB & Training Intelligence',
      connected: true,
      modeLabel: 'Active Local Rules Engine · Zero Paid APIs',
      description:
        'Evaluates aerobic response relative to LTHR, historical personal baselines, and EWMA load (CTL/ATL/TSB) without medical diagnoses, load-ratio injury predictions, or automated prescriptions.',
      requiredConfig: ['None Required (Local Deterministic Rules Engine)'],
    };
  }

  analyzeAthlete(athlete: Athlete): AICoachingInsight {
    const anchorDate = resolveAnchorDateIso(athlete);
    const weekly = computeWeeklyVolumeSeries(athlete.workouts, anchorDate);
    const paceHr = computePaceHrTrends(athlete.workouts, athlete.lthrBpm, anchorDate);
    const acwr = computeACWR(weekly);
    const loadSeries = resolveAthleteLoadSeries(athlete, anchorDate);
    const latestLoad = loadSeries.daily[loadSeries.daily.length - 1];
    const raceEstimates = estimateRacePerformances(athlete);
    const isProd = Boolean(athlete.productionContext?.isProduction);

    const persistedSysC = athlete.productionContext?.systemC;
    const ctl =
      persistedSysC?.available && persistedSysC.ctl !== null
        ? persistedSysC.ctl
        : latestLoad?.ctl ?? 0;
    const atl =
      persistedSysC?.available && persistedSysC.atl !== null
        ? persistedSysC.atl
        : latestLoad?.atl ?? 0;
    const tsb =
      persistedSysC?.available && persistedSysC.tsb !== null
        ? persistedSysC.tsb
        : latestLoad?.tsb ?? 0;

    // Athlete-specific historical baselines
    const baselineDays = loadSeries.daily.slice(0, 56).filter((d) => d.ctl > 0 || !isProd);
    const baselineMeanTsb =
      baselineDays.length > 0
        ? baselineDays.reduce((s, d) => s + d.tsb, 0) / baselineDays.length
        : tsb;
    const baselineCtlMean =
      baselineDays.length > 0
        ? baselineDays.reduce((s, d) => s + d.ctl, 0) / baselineDays.length
        : ctl;

    const completedWeek = weekly[weekly.length - 2] ?? {
      actualMiles: 0,
      plannedMiles: 0,
      workoutCountCompleted: 0,
      workoutCountPlanned: 0,
    };
    const currentWeek = weekly[weekly.length - 1] ?? {
      actualMiles: 0,
      plannedMiles: 0,
      workoutCountCompleted: 0,
      workoutCountPlanned: 0,
    };
    const prevFullWeek = weekly[weekly.length - 3];
    const fourWeekSlice = weekly.slice(-5, -1);
    const priorFourSlice = weekly.slice(-9, -5);

    const avg4WkMiles =
      fourWeekSlice.reduce((s, w) => s + w.actualMiles, 0) / Math.max(1, fourWeekSlice.length);
    const avgPrior4WkMiles =
      priorFourSlice.reduce((s, w) => s + w.actualMiles, 0) / Math.max(1, priorFourSlice.length);
    const fourWkDeltaPct =
      avgPrior4WkMiles > 0 ? ((avg4WkMiles - avgPrior4WkMiles) / avgPrior4WkMiles) * 100 : 0;

    const weekOverWeekChangePct =
      prevFullWeek && prevFullWeek.actualMiles > 0
        ? ((completedWeek.actualMiles - prevFullWeek.actualMiles) / prevFullWeek.actualMiles) * 100
        : 0;

    const recentEasy = athlete.workouts.filter(
      (w) =>
        w.weekIndex >= 11 &&
        (w.type === 'Easy' || w.type === 'Recovery') &&
        w.hrDataState === 'valid' &&
        w.avgHrBpm !== null
    );
    const baselineEasy = athlete.workouts.filter(
      (w) =>
        w.weekIndex <= 8 &&
        (w.type === 'Easy' || w.type === 'Recovery') &&
        w.hrDataState === 'valid' &&
        w.avgHrBpm !== null
    );

    const recentEasyPctLthr =
      recentEasy.length > 0 && athlete.lthrBpm > 0
        ? (recentEasy.reduce((s, w) => s + (w.avgHrBpm ?? 0), 0) /
            recentEasy.length /
            athlete.lthrBpm) *
          100
        : null;
    const baselineEasyPctLthr =
      baselineEasy.length > 0 && athlete.lthrBpm > 0
        ? (baselineEasy.reduce((s, w) => s + (w.avgHrBpm ?? 0), 0) /
            baselineEasy.length /
            athlete.lthrBpm) *
          100
        : null;

    const pctLthrShift =
      recentEasyPctLthr !== null && baselineEasyPctLthr !== null
        ? recentEasyPctLthr - baselineEasyPctLthr
        : 0;

    const invalidOrMissingHr = athlete.workouts.filter(
      (w) => w.hrDataState === 'invalid' || w.hrDataState === 'missing'
    );
    const activeRecord = athlete.lthrHistory.find(
      (r) => r.version === athlete.activeThresholdVersion
    );

    const attentionAreas: AttentionFlag[] = [];
    const findings: CoachingFinding[] = [];

    if ((ctl > 0 || atl > 0) && (tsb < -16 || weekOverWeekChangePct > 22 || (ctl > 0 && atl / ctl > 1.28))) {
      const isHigh = tsb < -22 || (ctl > 0 && atl / ctl > 1.36);
      attentionAreas.push({
        id: `${athlete.id}-load`,
        severity: isHigh ? 'high' : 'moderate',
        category: 'Workload Spike',
        summary:
          'Recent 7-day ATL and HR-derived stress rose notably above the athlete’s 42-day chronic baseline.',
        metricDetail: `CTL ${ctl.toFixed(1)} · ATL ${atl.toFixed(1)} · TSB ${tsb.toFixed(1)} (baseline mean TSB ${baselineMeanTsb.toFixed(1)})`,
      });
      findings.push({
        id: `${athlete.id}-find-load`,
        classification: isHigh
          ? 'High priority: Coach review recommended'
          : 'Moderate priority: Monitor',
        domain: 'CTL / ATL / TSB',
        headline: `Acute fatigue elevated relative to personal baseline (TSB ${tsb.toFixed(1)})`,
        evidence: [
          `42-day CTL ${ctl.toFixed(1)} vs 7-day ATL ${atl.toFixed(1)} (TSB ${tsb.toFixed(1)})`,
          `Athlete historical mean TSB: ${baselineMeanTsb.toFixed(1)}`,
          `Week-over-week mileage change: ${weekOverWeekChangePct >= 0 ? '+' : ''}${weekOverWeekChangePct.toFixed(1)}%`,
        ],
      });
    }

    if (pctLthrShift >= 3.0 || athlete.garminBiometrics.garminHrvStatus === 'Unbalanced') {
      const isHigh = pctLthrShift >= 5.0;
      attentionAreas.push({
        id: `${athlete.id}-hr`,
        severity: isHigh ? 'high' : 'moderate',
        category: 'Recovery / HR Drift',
        summary:
          'Aerobic heart rate as a percentage of LTHR shifted upward compared with the early-block baseline.',
        metricDetail: `Easy %LTHR ${recentEasyPctLthr ? recentEasyPctLthr.toFixed(1) : '--'}% (${pctLthrShift >= 0 ? '+' : ''}${pctLthrShift.toFixed(1)} pts) · HRV: ${athlete.garminBiometrics.garminHrvStatus}`,
      });
      findings.push({
        id: `${athlete.id}-find-hr`,
        classification: isHigh
          ? 'High priority: Coach review recommended'
          : 'Moderate priority: Monitor',
        domain: 'LTHR & HR Response',
        headline:
          pctLthrShift >= 3.0
            ? `Easy-run cardiac cost rose +${pctLthrShift.toFixed(1)} percentage points of LTHR`
            : `Wellness HRV status flagged (${athlete.garminBiometrics.garminHrvStatus})`,
        evidence: [
          `Recent easy HR: ${recentEasyPctLthr ? recentEasyPctLthr.toFixed(1) : '--'}% of LTHR (${
            athlete.lthrBpm > 0 ? `${athlete.lthrBpm} bpm` : 'LTHR not set'
          })`,
          `Weeks 1–8 personal baseline: ${baselineEasyPctLthr ? baselineEasyPctLthr.toFixed(1) : '--'}% LTHR`,
          `Intervals wellness HRV status: ${athlete.garminBiometrics.garminHrvStatus}`,
        ],
      });
    }

    if (activeRecord && !activeRecord.coachVerified) {
      attentionAreas.push({
        id: `${athlete.id}-lthr-verify`,
        severity: 'low',
        category: 'LTHR Source / Approval',
        summary: `Active LTHR v${activeRecord.version} (${activeRecord.lthrBpm} bpm via ${activeRecord.source}) is awaiting coach approval.`,
        metricDetail: `Recorded ${activeRecord.recordedDate}`,
      });
    }

    if (invalidOrMissingHr.length > 0 || recentEasy.length === 0) {
      if (invalidOrMissingHr.length > 0) {
        attentionAreas.push({
          id: `${athlete.id}-integrity`,
          severity: 'low',
          category: 'Data Integrity / HR',
          summary:
            'One or more completed runs contain missing or flagged heart-rate readings excluded from HR-derived stress.',
          metricDetail: `${invalidOrMissingHr.length} workout(s) flagged`,
        });
      }
      findings.push({
        id: `${athlete.id}-find-data`,
        classification: 'Insufficient data',
        domain: 'Data Sufficiency',
        headline:
          recentEasy.length === 0
            ? 'Limited recent valid HR telemetry for easy-run baseline comparison'
            : `${invalidOrMissingHr.length} workout(s) excluded due to missing or invalid HR readings`,
        evidence: [
          `${invalidOrMissingHr.length} session(s) marked missing or invalid HR (not treated as zero stress)`,
          `Recent valid easy-run count: ${recentEasy.length}`,
        ],
      });
    }

    const hasGoalRace =
      athlete.productionContext?.hasGoalRace !== false && Boolean(athlete.goal.raceDate);
    const daysToRace = hasGoalRace ? daysUntilDate(athlete.goal.raceDate, anchorDate) : -1;
    if (hasGoalRace && daysToRace > 0 && daysToRace <= 21 && tsb < -8 && athlete.currentPhase !== 'Taper') {
      attentionAreas.push({
        id: `${athlete.id}-taper`,
        severity: 'low',
        category: 'Taper / Race Prep',
        summary:
          'Goal event is within 21 days while short-term fatigue remains elevated relative to CTL.',
        metricDetail: `${daysToRace}d to ${athlete.goal.raceName} · TSB ${tsb.toFixed(1)}`,
      });
      findings.push({
        id: `${athlete.id}-find-race`,
        classification: 'Moderate priority: Monitor',
        domain: 'Upcoming Race Demands',
        headline: `${athlete.goal.raceName} is ${daysToRace} days away with negative TSB (${tsb.toFixed(1)})`,
        evidence: [
          `Goal target: ${formatDuration(athlete.goal.targetTimeSeconds)} (${athlete.goal.distanceLabel})`,
          `Current CTL ${ctl.toFixed(1)} / ATL ${atl.toFixed(1)} / TSB ${tsb.toFixed(1)}`,
        ],
      });
    }

    const earlyEf = paceHr.slice(0, 4).filter((p) => p.efficiencyFactor !== null);
    const lateEf = paceHr.slice(-4).filter((p) => p.efficiencyFactor !== null);
    const avgEarlyEf =
      earlyEf.reduce((s, p) => s + (p.efficiencyFactor ?? 0), 0) / Math.max(1, earlyEf.length);
    const avgLateEf =
      lateEf.reduce((s, p) => s + (p.efficiencyFactor ?? 0), 0) / Math.max(1, lateEf.length);
    const efGainPct = avgEarlyEf > 0 ? ((avgLateEf - avgEarlyEf) / avgEarlyEf) * 100 : 0;

    if (efGainPct >= 1.8 && !attentionAreas.some((a) => a.severity === 'high')) {
      findings.push({
        id: `${athlete.id}-find-positive-ef`,
        classification: 'Positive development',
        domain: 'Aerobic Efficiency',
        headline: `Aerobic efficiency improved +${efGainPct.toFixed(1)}% over the 12-week block`,
        evidence: [
          `Early 4-week EF ${avgEarlyEf.toFixed(2)} -> Recent 4-week EF ${avgLateEf.toFixed(2)}`,
          `42-day CTL ${ctl.toFixed(1)} vs baseline mean ${baselineCtlMean.toFixed(1)}`,
          `4-week rolling volume: ${avg4WkMiles.toFixed(1)} mi/wk`,
        ],
      });
    }

    const firstLthr = athlete.lthrHistory[0];
    const lthrDelta =
      firstLthr && athlete.lthrBpm > 0 ? athlete.lthrBpm - firstLthr.lthrBpm : 0;
    const lthrContextNote =
      athlete.lthrBpm > 0
        ? `Evaluated against LTHR v${athlete.activeThresholdVersion} (${athlete.lthrBpm} bpm · ${
            activeRecord?.source ?? 'Manual Assessment'
          }${activeRecord?.coachVerified ? ', coach-approved' : ', pending coach review'}). Historical LTHR shifted ${
            lthrDelta >= 0 ? '+' : ''
          }${lthrDelta} bpm since v1 (${firstLthr?.lthrBpm ?? athlete.lthrBpm} bpm).`
        : 'No active LTHR threshold is configured for this athlete yet. Add or detect an LTHR threshold to unlock hrRSS zones.';

    const trainingProgression = `4-week rolling volume is ${avg4WkMiles.toFixed(1)} mi/wk (${
      fourWkDeltaPct >= 0 ? '+' : ''
    }${fourWkDeltaPct.toFixed(1)}% vs. prior 4-week block). Aerobic efficiency (speed per %LTHR heart-rate beat) changed ${
      efGainPct >= 0 ? '+' : ''
    }${efGainPct.toFixed(1)}% across the 12-week window (${buildTwelveWeekWindow(anchorDate).startDateIso} to ${anchorDate}).`;

    const latestEasyPace = paceHr[paceHr.length - 1]?.easyAvgPaceSec;
    const workoutExecution = `Current week includes ${
      currentWeek.workoutCountCompleted
    } completed session(s) (${currentWeek.actualMiles.toFixed(1)} mi) after ${completedWeek.actualMiles.toFixed(
      1
    )} mi last week. ${
      latestEasyPace
        ? `Recent valid easy-day pace averaged ${formatPace(latestEasyPace)}/mi at ${
            recentEasyPctLthr ? recentEasyPctLthr.toFixed(1) : '--'
          }% of LTHR.`
        : 'Limited valid easy-run telemetry available in the current week.'
    }`;

    const workloadChanges = `42-day CTL stands at ${ctl.toFixed(1)}, 7-day ATL at ${atl.toFixed(
      1
    )}, yielding TSB = ${tsb.toFixed(1)} (vs historical mean TSB ${baselineMeanTsb.toFixed(
      1
    )}). Provider status reads "${
      athlete.garminBiometrics.garminTrainingStatus
    }"${
      athlete.garminBiometrics.garmin7DayLoad > 0
        ? ` with 7-day Native Load ${athlete.garminBiometrics.garmin7DayLoad}`
        : ''
    }.`;

    const recoveryObservations =
      pctLthrShift >= 3.0
        ? `Valid easy-run HR rose ${pctLthrShift.toFixed(
            1
          )} percentage points relative to LTHR (${recentEasyPctLthr?.toFixed(
            1
          )}% vs. ${baselineEasyPctLthr?.toFixed(
            1
          )}% baseline). Wellness HRV status reads "${athlete.garminBiometrics.garminHrvStatus}".`
        : `Easy-run cardiac response reads ${
            recentEasyPctLthr ? `${recentEasyPctLthr.toFixed(1)}%` : '--'
          } of LTHR (${pctLthrShift >= 0 ? '+' : ''}${pctLthrShift.toFixed(
            1
          )} pts vs. baseline), with wellness HRV status "${
            athlete.garminBiometrics.garminHrvStatus
          }".`;

    const hasHigh = attentionAreas.some((f) => f.severity === 'high');
    const hasModerate = attentionAreas.some((f) => f.severity === 'moderate');
    const readinessStatus: AICoachingInsight['readinessStatus'] = hasHigh
      ? 'Recovery Focus'
      : hasModerate
      ? 'Monitor Load'
      : 'Optimal';

    const primaryClassification: IntelligenceFindingClassification = hasHigh
      ? 'High priority: Coach review recommended'
      : hasModerate
      ? 'Moderate priority: Monitor'
      : findings.some((f) => f.classification === 'Positive development')
      ? 'Positive development'
      : findings.some((f) => f.classification === 'Insufficient data')
      ? 'Insufficient data'
      : 'Positive development';

    const coachReviewPrompt =
      attentionAreas.length === 0
        ? `Observations remain aligned with ${athlete.name}'s LTHR baseline and ${athlete.currentPhase.toLowerCase()}-phase load trajectory. Review upcoming calendar milestones when convenient.`
        : `Coach review suggested: examine ${attentionAreas
            .map((a) => a.category.toLowerCase())
            .join(', ')} alongside athlete feedback${
            hasGoalRace ? ` and upcoming ${athlete.goal.raceName} timeline` : ''
          }.`;

    return {
      athleteId: athlete.id,
      generatedAt: `${anchorDate}T14:55:00Z`,
      engineLabel: isProd
        ? 'Production Coaching Intelligence Engine (Supabase + Intervals.icu)'
        : 'Rules-Based Coaching Intelligence Engine (Zero Paid APIs)',
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
        'Analytical summary only: evaluates physiological trends against individualized LTHR and historical baselines. It does not diagnose injuries, does not predict injuries from training load ratios, and does not automatically prescribe training changes.',
    };
  }
}

export const aiCoachingEngine = new LocalHeuristicAIEngine();
