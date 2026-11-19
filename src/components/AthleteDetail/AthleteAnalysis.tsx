import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Award,
  BrainCircuit,
  Check,
  CheckCircle2,
  Info,
  RefreshCw,
  Save,
  ShieldCheck,
  Watch,
} from 'lucide-react';
import {
  AICoachingInsight,
  Athlete,
  HrZoneConfig,
  HrZoneMethodologyId,
  ZonePctBound,
} from '../../types/coaching';
import {
  computeIntensityDistribution,
  computePaceHrTrends,
  computeWeeklyVolumeSeries,
  daysUntilDate,
  formatDuration,
  formatPace,
} from '../../utils/analytics';
import {
  computeDailyAndWeeklyLoadSeries,
  computeLthrZones,
  getTsbFormLabel,
  HR_ZONE_METHODOLOGIES,
  recalculateAthleteWithThreshold,
  validateZoneBoundaries,
} from '../../utils/lthrAnalytics';

interface AthleteAnalysisProps {
  athletes: Athlete[];
  athlete: Athlete;
  insight: AICoachingInsight;
  onSelectAthlete: (athleteId: string) => void;
  onSaveCoachNotes: (athleteId: string, notes: string) => void;
  onUpdateAthletePhysiology: (updated: Athlete) => void;
  onOpenAiTab: () => void;
}

type AthleteSubTab = 'overview' | 'load' | 'lthr' | 'integrity';

export const AthleteAnalysis: React.FC<AthleteAnalysisProps> = ({
  athletes,
  athlete,
  insight,
  onSelectAthlete,
  onSaveCoachNotes,
  onUpdateAthletePhysiology,
  onOpenAiTab,
}) => {
  const [subTab, setSubTab] = useState<AthleteSubTab>('overview');
  const [trendWindow, setTrendWindow] = useState<4 | 8 | 12>(12);
  const [loadGranularity, setLoadGranularity] = useState<'daily' | 'weekly'>('daily');
  const [logFilter, setLogFilter] = useState<'all' | 'flagged'>('all');

  const [notesDraft, setNotesDraft] = useState(athlete.coachNotes);
  const [savedNotice, setSavedNotice] = useState(false);

  // Coach-approved manual fallback state (used when Garmin LTHR is unavailable or overridden)
  const [showManualFallbackForm, setShowManualFallbackForm] = useState(false);
  const [manualLthrBpm, setManualLthrBpm] = useState(String(athlete.lthrBpm));
  const [manualEffectiveDate, setManualEffectiveDate] = useState('2026-11-18');
  const [manualPaceMin, setManualPaceMin] = useState(formatPace(athlete.thresholdPaceSecPerMile));
  const [manualPower, setManualPower] = useState(
    athlete.optionalThresholdPowerWatts ? String(athlete.optionalThresholdPowerWatts) : ''
  );
  const [manualCoachApproved, setManualCoachApproved] = useState(true);
  const [manualNotes, setManualNotes] = useState('');
  const [recalcScope, setRecalcScope] = useState<'from_effective_date' | 'all_history'>(
    'from_effective_date'
  );
  const [thresholdFeedback, setThresholdFeedback] = useState<string | null>(null);

  // HR Zone Config state
  const [zoneMethodology, setZoneMethodology] = useState<HrZoneMethodologyId>(
    athlete.hrZoneConfig.methodology
  );
  const [customZonesDraft, setCustomZonesDraft] = useState<ZonePctBound[]>(
    athlete.hrZoneConfig.customBoundaries ??
      HR_ZONE_METHODOLOGIES[athlete.hrZoneConfig.methodology].boundaries
  );
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneSavedMsg, setZoneSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    setNotesDraft(athlete.coachNotes);
    setSavedNotice(false);
    setManualLthrBpm(String(athlete.lthrBpm));
    setManualPaceMin(formatPace(athlete.thresholdPaceSecPerMile));
    setManualPower(
      athlete.optionalThresholdPowerWatts ? String(athlete.optionalThresholdPowerWatts) : ''
    );
    setZoneMethodology(athlete.hrZoneConfig.methodology);
    setCustomZonesDraft(
      athlete.hrZoneConfig.customBoundaries ??
        HR_ZONE_METHODOLOGIES[athlete.hrZoneConfig.methodology].boundaries
    );
    setZoneError(null);
    setZoneSavedMsg(null);
    setThresholdFeedback(null);
    setShowManualFallbackForm(false);
  }, [
    athlete.id,
    athlete.lthrBpm,
    athlete.hrZoneConfig,
    athlete.coachNotes,
    athlete.thresholdPaceSecPerMile,
    athlete.optionalThresholdPowerWatts,
  ]);

  const weeklyAll = useMemo(() => computeWeeklyVolumeSeries(athlete.workouts), [athlete.workouts]);
  const paceHrAll = useMemo(
    () => computePaceHrTrends(athlete.workouts, athlete.lthrBpm),
    [athlete.workouts, athlete.lthrBpm]
  );
  const intensityDist = useMemo(
    () => computeIntensityDistribution(athlete, trendWindow),
    [athlete, trendWindow]
  );
  const loadSeries = useMemo(
    () => computeDailyAndWeeklyLoadSeries(athlete.workouts),
    [athlete.workouts]
  );
  const activeZones = useMemo(
    () => computeLthrZones(athlete.lthrBpm, athlete.hrZoneConfig, athlete.maxHrBpm),
    [athlete.lthrBpm, athlete.hrZoneConfig, athlete.maxHrBpm]
  );

  const weeklyFiltered = weeklyAll.slice(-trendWindow);
  const paceHrFiltered = paceHrAll.slice(-trendWindow).map((p) => ({
    ...p,
    easyPaceMin: p.easyAvgPaceSec ? Number((p.easyAvgPaceSec / 60).toFixed(2)) : null,
  }));

  const currentWeek = weeklyAll[weeklyAll.length - 1];
  const lastFullWeek = weeklyAll[weeklyAll.length - 2];
  const avgComplianceWindow = Math.round(
    weeklyFiltered.reduce((s, w) => s + w.compliancePct, 0) / Math.max(1, weeklyFiltered.length)
  );
  const avgMilesWindow =
    weeklyFiltered.reduce((s, w) => s + w.actualMiles, 0) / Math.max(1, weeklyFiltered.length);

  const latestDailyLoad = loadSeries.daily[loadSeries.daily.length - 1];
  const lastFullWeekLoad = loadSeries.weekly[loadSeries.weekly.length - 2];
  const tsbForm = getTsbFormLabel(latestDailyLoad?.tsb ?? 0);

  const activeLthrRecord = athlete.lthrHistory.find(
    (r) => r.version === athlete.activeThresholdVersion
  );

  const integrityWorkouts = useMemo(
    () =>
      athlete.workouts.filter(
        (w) => w.hrDataState === 'invalid' || w.hrDataState === 'missing'
      ),
    [athlete.workouts]
  );

  const visibleTrainingLog = useMemo(() => {
    const base = athlete.workouts
      .filter((w) => w.date <= '2026-11-18' && w.type !== 'Rest')
      .sort((a, b) => b.date.localeCompare(a.date));
    if (logFilter === 'flagged') {
      return base.filter((w) => w.hrDataState === 'invalid' || w.hrDataState === 'missing');
    }
    return base.slice(0, 21);
  }, [athlete.workouts, logFilter]);

  const daysToRace = daysUntilDate(athlete.goal.raceDate);

  const handleSaveNotes = () => {
    onSaveCoachNotes(athlete.id, notesDraft);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const parsePaceInput = (val: string): number | null => {
    const parts = val.trim().split(':');
    if (parts.length !== 2) return null;
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs < 0 || secs >= 60) return null;
    return mins * 60 + secs;
  };

  const handleApplyManualFallback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCoachApproved) {
      setThresholdFeedback('Manual fallback LTHR requires explicit coach approval before saving.');
      return;
    }
    const bpm = Number(manualLthrBpm);
    if (!Number.isFinite(bpm) || bpm < 110 || bpm > 215) {
      setThresholdFeedback('Enter a valid physiological LTHR between 110 and 215 bpm.');
      return;
    }
    const parsedPace = manualPaceMin.trim() ? parsePaceInput(manualPaceMin) : null;
    const parsedPower = manualPower.trim() ? Number(manualPower) : null;

    const updated = recalculateAthleteWithThreshold({
      athlete,
      newRecordInput: {
        lthrBpm: Math.round(bpm),
        recordedDate: '2026-11-18',
        effectiveDate: manualEffectiveDate,
        source: 'Coach-Approved Manual Fallback',
        coachVerified: true,
        optionalThresholdPaceSecPerMile: parsedPace,
        optionalThresholdPowerWatts:
          parsedPower !== null && Number.isFinite(parsedPower) ? Math.round(parsedPower) : null,
        notes:
          manualNotes.trim() ||
          'Coach-approved manual LTHR fallback applied.',
      },
      scope: recalcScope,
    });
    onUpdateAthletePhysiology(updated);
    setShowManualFallbackForm(false);
    setManualNotes('');
    setThresholdFeedback(
      `Applied coach-approved manual fallback LTHR v${updated.activeThresholdVersion} (${updated.lthrBpm} bpm) and recalculated ${
        recalcScope === 'all_history' ? 'all 12 weeks' : `workouts from ${manualEffectiveDate}`
      }.`
    );
  };

  const handleAdoptGarminLthr = () => {
    const garminBpm = athlete.garminBiometrics.garminDetectedLthrBpm;
    if (!garminBpm) return;
    const updated = recalculateAthleteWithThreshold({
      athlete,
      newRecordInput: {
        lthrBpm: garminBpm,
        recordedDate: athlete.garminBiometrics.garminLthrDetectedDate ?? '2026-11-18',
        effectiveDate: '2026-11-18',
        source: 'Garmin Auto-Detected',
        garminDeviceLabel: athlete.garminBiometrics.garminLthrDevice ?? 'Garmin Connect',
        coachVerified: true,
        notes: 'Reverted to Garmin-detected LTHR as preferred threshold source.',
      },
      scope: 'from_effective_date',
    });
    onUpdateAthletePhysiology(updated);
    setThresholdFeedback(
      `Restored Garmin auto-detected LTHR (${garminBpm} bpm) as active v${updated.activeThresholdVersion}.`
    );
  };

  const handleToggleVerifyRecord = (recordId: string) => {
    const updated = recalculateAthleteWithThreshold({
      athlete,
      verifyRecordId: recordId,
      scope: 'from_effective_date',
    });
    onUpdateAthletePhysiology(updated);
  };

  const handleMethodologySelect = (method: HrZoneMethodologyId) => {
    setZoneMethodology(method);
    setZoneError(null);
    setZoneSavedMsg(null);
    if (method !== 'custom') {
      setCustomZonesDraft(HR_ZONE_METHODOLOGIES[method].boundaries.map((b) => ({ ...b })));
    }
  };

  const handleBoundaryPctChange = (
    idx: number,
    field: 'minPctLthr' | 'maxPctLthr',
    value: number
  ) => {
    setZoneMethodology('custom');
    setCustomZonesDraft((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
    setZoneError(null);
    setZoneSavedMsg(null);
  };

  const handleApplyZoneConfig = () => {
    const validation = validateZoneBoundaries(customZonesDraft);
    if (!validation.valid) {
      setZoneError(validation.error ?? 'Invalid zone boundaries.');
      return;
    }
    const nextConfig: HrZoneConfig = {
      methodology: zoneMethodology,
      customBoundaries:
        zoneMethodology === 'custom' ? customZonesDraft.map((z) => ({ ...z })) : undefined,
      updatedAt: '2026-11-18T14:35:00Z',
    };
    const updated = recalculateAthleteWithThreshold({
      athlete,
      newZoneConfig: nextConfig,
      scope: 'all_history',
    });
    onUpdateAthletePhysiology(updated);
    setZoneSavedMsg('HR zone configuration saved and applied to athlete profile.');
  };

  return (
    <div className="space-y-6">
      {/* Athlete Header */}
      <div className="rounded-xl bg-navy-900 p-5 text-white">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={athlete.id}
                onChange={(e) => onSelectAthlete(e.target.value)}
                aria-label="Select athlete"
                className="rounded-lg border border-white/20 bg-navy-800 px-3 py-1.5 font-display text-base font-bold text-white focus:outline-none"
              >
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.trainingGroup}
                  </option>
                ))}
              </select>
              <span className="text-xs font-semibold text-sky-300">
                LTHR {athlete.lthrBpm} bpm ({activeLthrRecord?.source ?? 'Garmin Auto-Detected'} ·
                v{athlete.activeThresholdVersion})
              </span>
              <span className="text-slate-500" aria-hidden="true">
                ·
              </span>
              <span className="text-xs text-slate-300 tabular-nums">
                {athlete.currentPhase} Phase · {athlete.location}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-300 tabular-nums">
              <span>
                Goal: <strong className="text-white">{athlete.goal.raceName}</strong> (
                {athlete.goal.raceDate}, {daysToRace}d)
              </span>
              <span>
                Target:{' '}
                <strong className="text-white">
                  {formatDuration(athlete.goal.targetTimeSeconds)}
                </strong>
              </span>
              <span>
                Opt. Threshold Pace:{' '}
                <strong className="text-white">
                  {formatPace(athlete.thresholdPaceSecPerMile)}/mi
                </strong>
              </span>
              <span>
                Opt. Power:{' '}
                <strong className="text-white">
                  {athlete.optionalThresholdPowerWatts
                    ? `${athlete.optionalThresholdPowerWatts} W`
                    : 'Not tracked'}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-lg bg-navy-800 p-1">
              {([4, 8, 12] as const).map((wks) => (
                <button
                  key={wks}
                  type="button"
                  onClick={() => setTrendWindow(wks)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    trendWindow === wks
                      ? 'bg-white text-navy-900'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {wks}W
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onOpenAiTab}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-navy-950 whitespace-nowrap transition-colors hover:bg-sky-400"
            >
              <BrainCircuit className="h-4 w-4" />
              Coaching Analysis
            </button>
          </div>
        </div>
      </div>

      {/* Athlete Sub-Navigation */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
        {(
          [
            { id: 'overview', label: 'Overview & Trends' },
            { id: 'load', label: 'Load Analytics (CTL / ATL / TSB)' },
            { id: 'lthr', label: 'LTHR Source & HR Zones' },
            {
              id: 'integrity',
              label:
                integrityWorkouts.length > 0
                  ? `Training Log & Integrity (${integrityWorkouts.length} Flagged)`
                  : 'Training Log & Data Integrity',
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subTab === tab.id
                ? 'bg-navy-900 text-white'
                : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Active LTHR Reference</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
            {athlete.lthrBpm} bpm
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {activeLthrRecord?.source === 'Coach-Approved Manual Fallback'
              ? 'Coach-Approved Manual Fallback'
              : 'Garmin Auto-Detected (Preferred)'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Last Full Week Stress / Miles</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
            {lastFullWeekLoad?.weeklyHrStress.toFixed(0) ?? 0}{' '}
            <span className="text-xs font-normal text-slate-500">hrRSS</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {lastFullWeek.actualMiles.toFixed(1)} mi · Current wk {currentWeek.actualMiles.toFixed(1)}{' '}
            mi
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">CTL (42d) / ATL (7d) / TSB</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
            {latestDailyLoad?.ctl.toFixed(1)}{' '}
            <span className="text-sm font-normal text-slate-400">/</span>{' '}
            {latestDailyLoad?.atl.toFixed(1)}{' '}
            <span
              className={`text-sm font-semibold ${
                (latestDailyLoad?.tsb ?? 0) < -15
                  ? 'text-rose-700'
                  : (latestDailyLoad?.tsb ?? 0) > 5
                  ? 'text-emerald-700'
                  : 'text-sky-700'
              }`}
            >
              ({(latestDailyLoad?.tsb ?? 0) >= 0 ? '+' : ''}
              {latestDailyLoad?.tsb.toFixed(1)})
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">{tsbForm.label}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">{trendWindow}-Week Avg & Compliance</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
            {avgMilesWindow.toFixed(1)}{' '}
            <span className="text-xs font-normal text-slate-400">mi/wk</span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {avgComplianceWindow}% compliance · {integrityWorkouts.length} HR flags
          </p>
        </div>
      </div>

      {/* TAB 1: OVERVIEW & TRENDS */}
      {subTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">
                {trendWindow}-Week Mileage & Workout Compliance
              </h3>
              <p className="mb-4 text-xs text-slate-500">
                Planned vs. actual miles with weekly compliance percentage
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={weeklyFiltered}
                    margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis yAxisId="mi" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      domain={[40, 105]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#0284C7' }}
                    />
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                    <Bar
                      yAxisId="mi"
                      dataKey="plannedMiles"
                      name="Planned (mi)"
                      fill="#CBD5E1"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      yAxisId="mi"
                      dataKey="actualMiles"
                      name="Actual (mi)"
                      fill="#0A1628"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="compliancePct"
                      name="Compliance (%)"
                      stroke="#0284C7"
                      strokeWidth={2}
                      dot={{ r: 2.5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">
                {trendWindow}-Week Pace & %LTHR Heart-Rate Trend
              </h3>
              <p className="mb-4 text-xs text-slate-500">
                Valid easy-run pace (min/mi) vs. % of individualized LTHR ({athlete.lthrBpm} bpm)
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={paceHrFiltered}
                    margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis
                      yAxisId="pace"
                      domain={['auto', 'auto']}
                      tickFormatter={(v) => `${Number(v).toFixed(1)}m`}
                      tick={{ fontSize: 11, fill: '#0A1628' }}
                    />
                    <YAxis
                      yAxisId="lthr"
                      orientation="right"
                      domain={[65, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fontSize: 11, fill: '#DC2626' }}
                    />
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                    <Line
                      yAxisId="pace"
                      type="monotone"
                      dataKey="easyPaceMin"
                      name="Easy Pace (min/mi)"
                      stroke="#0A1628"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      yAxisId="lthr"
                      type="monotone"
                      dataKey="easyPctLthr"
                      name="Easy HR (% LTHR)"
                      stroke="#DC2626"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">Long-Run Progression</h3>
              <p className="mb-4 text-xs text-slate-500">Longest weekly aerobic effort (miles)</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={weeklyFiltered}
                    margin={{ top: 5, right: 5, left: -15, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="longRunFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0284C7" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0284C7" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                    <Area
                      type="monotone"
                      dataKey="longRunMiles"
                      name="Long Run (mi)"
                      stroke="#0284C7"
                      strokeWidth={2.5}
                      fill="url(#longRunFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">
                LTHR Training Intensity Distribution ({trendWindow}W)
              </h3>
              <p className="mb-4 text-xs text-slate-500">
                {HR_ZONE_METHODOLOGIES[athlete.hrZoneConfig.methodology].label} · LTHR{' '}
                {athlete.lthrBpm} bpm
              </p>
              <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={intensityDist}
                        dataKey="percentage"
                        nameKey="label"
                        innerRadius={48}
                        outerRadius={80}
                        paddingAngle={2}
                      >
                        {intensityDist.map((entry) => (
                          <Cell key={entry.zone} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val) => `${val}%`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="divide-y divide-slate-100">
                  {intensityDist.map((item) => (
                    <div
                      key={item.zone}
                      className="flex items-center justify-between gap-2 py-2 text-xs tabular-nums"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="truncate font-medium text-slate-700">{item.label}</span>
                        </div>
                        <p className="pl-4.5 font-mono text-[11px] text-slate-400">
                          {item.bpmRange}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-navy-900">
                        {item.percentage}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">Coach Notes</h3>
              <p className="mb-3 text-xs text-slate-500">Saved locally in browser storage</p>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-navy-900 focus:border-navy-900 focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveNotes}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
              >
                {savedNotice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                {savedNotice ? 'Saved' : 'Save Note'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-sm font-bold text-navy-900">
                    Race Performance History
                  </h3>
                  <p className="text-xs text-slate-500">Past race benchmarks & HR effort</p>
                </div>
                <Award className="h-4 w-4 text-slate-400" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2 font-semibold">Date</th>
                      <th className="py-2 font-semibold">Race</th>
                      <th className="py-2 font-semibold">Dist</th>
                      <th className="py-2 text-right font-semibold">Finish</th>
                      <th className="py-2 text-right font-semibold">Pace</th>
                      <th className="py-2 text-right font-semibold">Avg HR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {athlete.raceHistory.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2.5 text-slate-500">{r.date}</td>
                        <td className="py-2.5 font-semibold text-navy-900">
                          {r.raceName}
                          {r.isPR && (
                            <span className="ml-2 text-[11px] font-bold text-sky-700">PR</span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-600">{r.distanceLabel}</td>
                        <td className="py-2.5 text-right font-mono font-semibold text-navy-900">
                          {formatDuration(r.finishTimeSeconds)}
                        </td>
                        <td className="py-2.5 text-right font-mono text-slate-600">
                          {formatPace(r.avgPaceSecPerMile)}/mi
                        </td>
                        <td className="py-2.5 text-right text-slate-600">{r.avgHrBpm} bpm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LOAD ANALYTICS (CTL / ATL / TSB, RUNNING STRESS vs TSS & GARMIN) */}
      {subTab === 'load' && (
        <div className="space-y-6">
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
            <p>
              <strong className="text-navy-900">Stress & TSS Distinction:</strong> Primary load
              analytics use <strong>HR-Derived Running Stress (hrRSS)</strong> ={' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
                (Duration_hr) × (AvgHR / LTHR)² × 100
              </code>
              . Optional pace-based and power-based TrainingPeaks-style TSS proxies and Garmin
              Training Load are tracked separately and are never treated as interchangeable with
              official TrainingPeaks TSS.
            </p>
          </div>

          {/* 4-Card Load & Stress Breakdown */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">CTL (42-Day Fitness EWMA)</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
                {latestDailyLoad?.ctl.toFixed(1)}
              </p>
              <p className="mt-1 text-xs text-slate-500">τ = 42 days · HR-Stress baseline</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">ATL (7-Day Fatigue EWMA)</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-amber-700 tabular-nums">
                {latestDailyLoad?.atl.toFixed(1)}
              </p>
              <p className="mt-1 text-xs text-slate-500">τ = 7 days · Acute HR-Stress</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">TSB (Form = CTL − ATL)</p>
              <p className="mt-1.5 font-display text-2xl font-bold text-navy-900 tabular-nums">
                {(latestDailyLoad?.tsb ?? 0) >= 0 ? '+' : ''}
                {latestDailyLoad?.tsb.toFixed(1)}
              </p>
              <p className="mt-1 text-xs font-semibold text-sky-700">{tsbForm.label}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Last Wk Stress Comparison</p>
              <p className="mt-1.5 font-mono text-sm font-bold text-navy-900 tabular-nums">
                {lastFullWeekLoad?.weeklyHrStress.toFixed(0)} hrRSS
              </p>
              <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
                Pace proxy: {lastFullWeekLoad?.weeklyPaceStressProxy.toFixed(0)} · Garmin:{' '}
                {lastFullWeekLoad?.weeklyGarminLoad.toFixed(0)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Performance Management Chart — CTL (42d) · ATL (7d) · TSB
                </h3>
                <p className="text-xs text-slate-500">
                  EWMA time constants: CTL τ = 42 days, ATL τ = 7 days, TSB = CTL − ATL
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setLoadGranularity('daily')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    loadGranularity === 'daily'
                      ? 'bg-white text-navy-900 shadow-sm'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  Daily Stress & EWMA
                </button>
                <button
                  type="button"
                  onClick={() => setLoadGranularity('weekly')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    loadGranularity === 'weekly'
                      ? 'bg-white text-navy-900 shadow-sm'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  Weekly HR-Stress vs. Pace Proxy vs. Garmin
                </button>
              </div>
            </div>

            <div className="h-80 w-full">
              {loadGranularity === 'daily' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={loadSeries.daily}
                    margin={{ top: 8, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="dayLabel"
                      interval={6}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                    />
                    <YAxis yAxisId="load" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis
                      yAxisId="tsb"
                      orientation="right"
                      tick={{ fontSize: 11, fill: '#0284C7' }}
                    />
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                    <ReferenceLine yAxisId="tsb" y={0} stroke="#94A3B8" strokeDasharray="3 3" />
                    <Bar yAxisId="load" dataKey="hrStress" name="Daily HR-Stress" fill="#CBD5E1" />
                    <Line
                      yAxisId="load"
                      type="monotone"
                      dataKey="ctl"
                      name="CTL (42d Fitness)"
                      stroke="#0A1628"
                      strokeWidth={2.5}
                      dot={false}
                    />
                    <Line
                      yAxisId="load"
                      type="monotone"
                      dataKey="atl"
                      name="ATL (7d Fatigue)"
                      stroke="#D97706"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="tsb"
                      type="monotone"
                      dataKey="tsb"
                      name="TSB (CTL - ATL)"
                      stroke="#0284C7"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={loadSeries.weekly}
                    margin={{ top: 8, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#64748B' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                    <Bar
                      dataKey="weeklyHrStress"
                      name="HR-Derived Running Stress (hrRSS)"
                      fill="#0A1628"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="weeklyPaceStressProxy"
                      name="Pace Stress Proxy (Separate)"
                      fill="#94A3B8"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="weeklyGarminLoad"
                      name="Garmin Training Load (Provider)"
                      fill="#0284C7"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Garmin Provider Telemetry (Preserved Separately) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-sm font-bold text-navy-900">
                  Garmin Connect Physiological Telemetry (Provider-Preserved)
                </h3>
                <p className="text-xs text-slate-500">{athlete.garminBiometrics.providerNote}</p>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {athlete.garminBiometrics.lastSyncedAt}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              <div>
                <p className="text-xs text-slate-500">Garmin LTHR</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {athlete.garminBiometrics.garminDetectedLthrBpm
                    ? `${athlete.garminBiometrics.garminDetectedLthrBpm} bpm`
                    : 'Not detected'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Training Status</p>
                <p className="mt-1 text-sm font-bold text-navy-900">
                  {athlete.garminBiometrics.garminTrainingStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Acute / Chronic Load</p>
                <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                  {athlete.garminBiometrics.garminAcuteLoad} /{' '}
                  {athlete.garminBiometrics.garminChronicLoad}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Garmin Load Focus</p>
                <p className="mt-1 text-sm font-bold text-navy-900">
                  {athlete.garminBiometrics.garminLoadFocus}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Garmin HRV Status</p>
                <p
                  className={`mt-1 text-sm font-bold ${
                    athlete.garminBiometrics.garminHrvStatus === 'Balanced'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {athlete.garminBiometrics.garminHrvStatus}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Garmin VO2max</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {athlete.garminBiometrics.garminVo2Max}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Resting HR</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {athlete.garminBiometrics.garminRestingHrBpm} bpm
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LTHR SOURCE HIERARCHY & CONFIGURABLE HR ZONES (NO TESTING WORKFLOW) */}
      {subTab === 'lthr' && (
        <div className="space-y-6">
          {thresholdFeedback && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>{thresholdFeedback}</span>
            </div>
          )}

          {/* Threshold Source Hierarchy: Garmin-Detected Preferred + Coach-Approved Manual Fallback */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  LTHR Source & Historical Threshold Versions
                </h3>
                <p className="text-xs text-slate-500">
                  Garmin auto-detected LTHR is the preferred threshold source. Coach-approved manual
                  entry serves as a fallback when Garmin detection is unavailable or requires
                  adjustment.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {athlete.garminBiometrics.garminDetectedLthrBpm &&
                  activeLthrRecord?.source === 'Coach-Approved Manual Fallback' && (
                    <button
                      type="button"
                      onClick={handleAdoptGarminLthr}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-900 whitespace-nowrap hover:bg-sky-100"
                    >
                      <Watch className="h-3.5 w-3.5" />
                      Use Garmin-Detected LTHR ({athlete.garminBiometrics.garminDetectedLthrBpm}{' '}
                      bpm)
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setShowManualFallbackForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-800"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {showManualFallbackForm ? 'Cancel' : 'Set Manual Fallback LTHR'}
                </button>
              </div>
            </div>

            {/* Preferred Garmin LTHR Summary Strip */}
            <div className="mt-4 grid grid-cols-1 gap-4 border-b border-slate-100 pb-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Preferred Source: Garmin Auto-Detected</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {athlete.garminBiometrics.garminDetectedLthrBpm
                    ? `${athlete.garminBiometrics.garminDetectedLthrBpm} bpm`
                    : 'Not Detected by Garmin'}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {athlete.garminBiometrics.garminLthrDevice
                    ? `${athlete.garminBiometrics.garminLthrDevice} · ${athlete.garminBiometrics.garminLthrDetectedDate}`
                    : 'Using coach-approved manual fallback'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Currently Active Reference</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {athlete.lthrBpm} bpm (v{athlete.activeThresholdVersion})
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{activeLthrRecord?.source}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Coach Approval Status</p>
                <p
                  className={`mt-1 text-sm font-bold ${
                    activeLthrRecord?.coachVerified ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {activeLthrRecord?.coachVerified
                    ? `Approved (${activeLthrRecord.verifiedAt ?? 'Verified'})`
                    : 'Pending Coach Verification'}
                </p>
              </div>
            </div>

            {/* Coach-Approved Manual Fallback Form */}
            {showManualFallbackForm && (
              <form
                onSubmit={handleApplyManualFallback}
                className="mt-4 grid grid-cols-1 gap-4 border-b border-slate-200 pb-5 sm:grid-cols-2 lg:grid-cols-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Fallback LTHR (bpm)
                  </label>
                  <input
                    type="number"
                    min={110}
                    max={215}
                    value={manualLthrBpm}
                    onChange={(e) => setManualLthrBpm(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Effective Date
                  </label>
                  <input
                    type="date"
                    value={manualEffectiveDate}
                    onChange={(e) => setManualEffectiveDate(e.target.value)}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Optional Threshold Pace (mm:ss/mi)
                  </label>
                  <input
                    type="text"
                    value={manualPaceMin}
                    onChange={(e) => setManualPaceMin(e.target.value)}
                    placeholder="6:30"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Optional Threshold Power (W)
                  </label>
                  <input
                    type="number"
                    value={manualPower}
                    onChange={(e) => setManualPower(e.target.value)}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Recalculation Scope
                  </label>
                  <select
                    value={recalcScope}
                    onChange={(e) =>
                      setRecalcScope(e.target.value as 'from_effective_date' | 'all_history')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  >
                    <option value="from_effective_date">From Effective Date Forward</option>
                    <option value="all_history">Recalculate All 12 Weeks</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    Fallback Rationale Note
                  </label>
                  <input
                    type="text"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    placeholder="e.g., Garmin watch missing strap data; using coach-reviewed steady effort anchor"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy-900"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-navy-900">
                    <input
                      type="checkbox"
                      checked={manualCoachApproved}
                      onChange={(e) => setManualCoachApproved(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    Coach-Approved Fallback
                  </label>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-navy-950 hover:bg-sky-400"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Apply Fallback & Recalculate
                  </button>
                </div>
              </form>
            )}

            {/* Historical LTHR Records Table */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Version</th>
                    <th className="px-3 py-2.5 font-semibold">Recorded</th>
                    <th className="px-3 py-2.5 font-semibold">Effective</th>
                    <th className="px-3 py-2.5 text-right font-semibold">LTHR</th>
                    <th className="px-3 py-2.5 font-semibold">Threshold Source</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Opt. Pace / Power</th>
                    <th className="px-3 py-2.5 font-semibold">Coach Approval</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {[...athlete.lthrHistory]
                    .sort((a, b) => b.version - a.version)
                    .map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-mono font-bold text-navy-900">
                          v{rec.version}
                          {rec.version === athlete.activeThresholdVersion && (
                            <span className="ml-2 font-sans text-[11px] font-semibold text-sky-700">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{rec.recordedDate}</td>
                        <td className="px-3 py-2.5 text-slate-600">{rec.effectiveDate}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-navy-900">
                          {rec.lthrBpm} bpm
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          <p className="font-medium">{rec.source}</p>
                          {rec.garminDeviceLabel && (
                            <p className="text-[11px] text-slate-400">{rec.garminDeviceLabel}</p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600">
                          {rec.optionalThresholdPaceSecPerMile
                            ? `${formatPace(rec.optionalThresholdPaceSecPerMile)}/mi`
                            : '—'}{' '}
                          /{' '}
                          {rec.optionalThresholdPowerWatts
                            ? `${rec.optionalThresholdPowerWatts}W`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleToggleVerifyRecord(rec.id)}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                              rec.coachVerified
                                ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                            }`}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {rec.coachVerified ? 'Approved' : 'Approve'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Configurable Five-Zone LTHR Model */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Individualized 5-Zone LTHR Model ({athlete.lthrBpm} bpm)
                </h3>
                <p className="text-xs text-slate-500">
                  Select an established methodology or customize %LTHR boundaries per athlete.
                </p>
              </div>
              <select
                value={zoneMethodology}
                onChange={(e) => handleMethodologySelect(e.target.value as HrZoneMethodologyId)}
                aria-label="Select HR zone methodology"
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-navy-900"
              >
                {(Object.keys(HR_ZONE_METHODOLOGIES) as HrZoneMethodologyId[]).map((key) => (
                  <option key={key} value={key}>
                    {HR_ZONE_METHODOLOGIES[key].label}
                  </option>
                ))}
              </select>
            </div>

            <p className="mt-2 text-xs text-slate-600">
              {HR_ZONE_METHODOLOGIES[zoneMethodology].description}
            </p>

            {zoneError && <p className="mt-3 text-xs font-semibold text-rose-700">{zoneError}</p>}
            {zoneSavedMsg && (
              <p className="mt-3 text-xs font-semibold text-emerald-700">{zoneSavedMsg}</p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Zone</th>
                    <th className="px-3 py-2.5 font-semibold">Min % LTHR</th>
                    <th className="px-3 py-2.5 font-semibold">Max % LTHR</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Target BPM Range</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {customZonesDraft.map((z, idx) => {
                    const previewBpm = computeLthrZones(
                      athlete.lthrBpm,
                      {
                        methodology: 'custom',
                        customBoundaries: customZonesDraft,
                        updatedAt: '',
                      },
                      athlete.maxHrBpm
                    )[idx];
                    return (
                      <tr key={z.zone}>
                        <td className="px-3 py-2.5 font-semibold text-navy-900">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ backgroundColor: z.color }}
                            />
                            {z.name}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={40}
                            max={115}
                            value={z.minPctLthr}
                            onChange={(e) =>
                              handleBoundaryPctChange(idx, 'minPctLthr', Number(e.target.value))
                            }
                            className="w-20 rounded border border-slate-200 px-2 py-1 font-mono text-xs text-navy-900"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={45}
                            max={125}
                            value={z.maxPctLthr}
                            onChange={(e) =>
                              handleBoundaryPctChange(idx, 'maxPctLthr', Number(e.target.value))
                            }
                            className="w-20 rounded border border-slate-200 px-2 py-1 font-mono text-xs text-navy-900"
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-navy-900">
                          {previewBpm
                            ? `${previewBpm.minBpm}–${previewBpm.maxBpm} bpm`
                            : `${activeZones[idx]?.minBpm}–${activeZones[idx]?.maxBpm} bpm`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={handleApplyZoneConfig}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-xs font-semibold text-white hover:bg-navy-800"
              >
                <Save className="h-3.5 w-3.5" />
                Apply Zone Model
              </button>
            </div>
          </div>

          {athlete.recalculationLog.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-sm font-bold text-navy-900">
                Preserved Recalculation Snapshots
              </h3>
              <p className="mb-3 text-xs text-slate-500">
                Historical stress values captured before threshold or zone updates
              </p>
              <div className="divide-y divide-slate-100 text-xs tabular-nums">
                {athlete.recalculationLog.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <div>
                      <p className="font-semibold text-navy-900">{snap.note}</p>
                      <p className="text-slate-500">
                        v{snap.previousThresholdVersion} ({snap.previousLthrBpm} bpm) → v
                        {snap.newThresholdVersion} ({snap.newLthrBpm} bpm) · Scope:{' '}
                        {snap.scope === 'all_history'
                          ? 'All history'
                          : `From ${snap.effectiveFromDate}`}{' '}
                        ({snap.affectedWorkouts} workouts)
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <p className="text-slate-700">
                        Last Wk Stress: {snap.previousLastFullWeekStress.toFixed(0)} →{' '}
                        {snap.newLastFullWeekStress.toFixed(0)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: TRAINING LOG & DATA INTEGRITY */}
      {subTab === 'integrity' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Workout Stress, TSS Proxies, Garmin Metrics & HR Integrity
                </h3>
                <p className="text-xs text-slate-500">
                  Keeps HR-Derived Running Stress (hrRSS) distinct from pace/power stress proxies
                  and original Garmin metrics. Excludes missing/invalid HR from stress totals.
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setLogFilter('all')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    logFilter === 'all'
                      ? 'bg-white text-navy-900 shadow-sm'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  Recent Workouts
                </button>
                <button
                  type="button"
                  onClick={() => setLogFilter('flagged')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                    logFilter === 'flagged'
                      ? 'bg-white text-navy-900 shadow-sm'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  Flagged HR ({integrityWorkouts.length})
                </button>
              </div>
            </div>

            {visibleTrainingLog.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-600">
                No missing or invalid HR readings detected across {athlete.name}&apos;s 12-week
                training log.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Workout</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Dist / Pace</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Avg HR</th>
                      <th className="px-3 py-2.5 text-right font-semibold">HR-Stress</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Pace / Power Proxy</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Garmin Load / TE</th>
                      <th className="px-3 py-2.5 font-semibold">Provenance</th>
                      <th className="px-3 py-2.5 font-semibold">Data Integrity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {visibleTrainingLog.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{w.date}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-navy-900">{w.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {w.type} · {w.status}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 whitespace-nowrap">
                          {w.actualMiles.toFixed(1)} mi · {formatPace(w.avgPaceSecPerMile)}/mi
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                          {w.avgHrBpm !== null ? `${w.avgHrBpm} bpm` : 'Missing'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-navy-900">
                          {w.stress.hrStress !== null ? w.stress.hrStress.toFixed(1) : 'Excluded'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-600 whitespace-nowrap">
                          {w.stress.paceStressProxy !== null
                            ? `${w.stress.paceStressProxy.toFixed(0)}`
                            : '—'}{' '}
                          /{' '}
                          {w.stress.powerStressProxy !== null
                            ? `${w.stress.powerStressProxy.toFixed(0)}W`
                            : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-sky-700 whitespace-nowrap">
                          {w.garminMetrics?.garminTrainingLoad ?? '—'}
                          {w.garminMetrics?.aerobicTrainingEffect !== null &&
                            w.garminMetrics?.aerobicTrainingEffect !== undefined && (
                              <span className="ml-1 text-[11px] text-slate-500">
                                ({w.garminMetrics.aerobicTrainingEffect.toFixed(1)}/
                                {w.garminMetrics.anaerobicTrainingEffect?.toFixed(1) ?? '0.0'})
                              </span>
                            )}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-600">
                          v{w.provenance.thresholdVersion} ({w.provenance.lthrBpmUsed} bpm) ·{' '}
                          {w.provenance.thresholdSource === 'Coach-Approved Manual Fallback'
                            ? 'Manual'
                            : 'Garmin'}
                        </td>
                        <td className="px-3 py-2.5">
                          {w.hrDataState === 'valid' ? (
                            <span className="font-semibold text-emerald-700">Valid HR</span>
                          ) : w.hrDataState === 'rest_zero' ? (
                            <span className="font-medium text-slate-500">Confirmed Zero</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              {w.hrDataState === 'missing' ? 'Missing HR' : 'Invalid HR'}
                            </span>
                          )}
                          {w.hrValidationFlags.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-rose-700">
                              {w.hrValidationFlags[0]}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
