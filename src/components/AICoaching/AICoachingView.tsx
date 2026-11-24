import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  HeartPulse,
  Info,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { AICoachingInsight, Athlete } from '../../types/coaching';
import { formatDuration, formatPace } from '../../utils/analytics';

interface AICoachingViewProps {
  athletes: Athlete[];
  selectedAthlete: Athlete;
  insight: AICoachingInsight;
  insightsByAthlete: Record<string, AICoachingInsight>;
  onSelectAthlete: (athleteId: string) => void;
  onUpdateAlertStatus?: (alertId: string, status: 'acknowledged' | 'resolved') => void;
}

export const AICoachingView: React.FC<AICoachingViewProps> = ({
  athletes,
  selectedAthlete,
  insight,
  insightsByAthlete,
  onSelectAthlete,
  onUpdateAlertStatus,
}) => {
  const flaggedAthletes = athletes.filter(
    (a) => (insightsByAthlete[a.id]?.attentionAreas.length ?? 0) > 0
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl bg-navy-900 p-5 text-white lg:flex-row lg:items-center">
        <div>
          <p className="text-xs font-semibold text-sky-300">{insight.engineLabel}</p>
          <h2 className="mt-1 font-display text-xl font-bold">
            LTHR-Centered Coaching Analysis — {selectedAthlete.name}
          </h2>
          <p className="mt-1 text-xs text-slate-300">{insight.lthrContextNote}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedAthlete.id}
            onChange={(e) => onSelectAthlete(e.target.value)}
            aria-label="Choose athlete for AI analysis"
            className="rounded-lg border border-white/20 bg-navy-800 px-3 py-2 text-sm font-semibold text-white focus:outline-none"
          >
            {athletes.map((a) => {
              const flagCount = insightsByAthlete[a.id]?.attentionAreas.length ?? 0;
              return (
                <option key={a.id} value={a.id}>
                  {a.name} {flagCount > 0 ? `(${flagCount} alert)` : ''}
                </option>
              );
            })}
          </select>

          <div className="rounded-lg bg-navy-800 px-4 py-2 text-right tabular-nums">
            <p className="text-xs text-slate-400">Classification</p>
            <p className="text-xs font-bold text-sky-300">
              {insight.primaryClassification ?? insight.readinessStatus}
            </p>
          </div>
        </div>
      </div>

      {/* Explicit Non-Diagnostic & Non-Prescriptive Guardrail Notice */}
      <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-navy-700" />
        <p>{insight.guardrailNotice}</p>
      </div>

      {insight.findings && insight.findings.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-sm font-bold text-navy-900">
            Classified Findings &amp; Supporting Evidence ({insight.findings.length})
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {insight.findings.map((f) => (
              <div key={f.id} className="rounded-lg border border-slate-200 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold ${
                      f.classification.startsWith('High')
                        ? 'text-rose-700'
                        : f.classification.startsWith('Moderate')
                        ? 'text-amber-700'
                        : f.classification === 'Positive development'
                        ? 'text-emerald-700'
                        : 'text-sky-700'
                    }`}
                  >
                    {f.classification}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {f.domain}
                    {f.status ? ` · ${f.status}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-navy-900">{f.headline}</p>
                <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-slate-600 tabular-nums">
                  {f.evidence.map((ev, idx) => (
                    <li key={idx}>• {ev}</li>
                  ))}
                </ul>
                {f.alertId && onUpdateAlertStatus && (
                  <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2">
                    {f.status !== 'acknowledged' && (
                      <button
                        type="button"
                        onClick={() => onUpdateAlertStatus(f.alertId!, 'acknowledged')}
                        className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-navy-900 hover:bg-slate-100"
                      >
                        Acknowledge
                      </button>
                    )}
                    {f.status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => onUpdateAlertStatus(f.alertId!, 'resolved')}
                        className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4 Core Observations */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
            <TrendingUp className="h-4 w-4 text-sky-600" />
            Training Progression vs. History
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
            {insight.trainingProgression}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
            <Activity className="h-4 w-4 text-emerald-600" />
            Workout Execution Relative to LTHR
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
            {insight.workoutExecution}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
              <Gauge className="h-4 w-4 text-amber-600" />
              EWMA Load & Workload Changes
            </div>
            <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
              CTL {insight.ctl.toFixed(1)} · ATL {insight.atl.toFixed(1)} · TSB{' '}
              {insight.tsb.toFixed(1)}
            </span>
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
            {insight.workloadChanges}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
            <HeartPulse className="h-4 w-4 text-rose-600" />
            Recovery & %LTHR Observations
          </div>
          <p className="mt-2.5 text-sm leading-relaxed text-slate-700">
            {insight.recoveryObservations}
          </p>
        </div>
      </div>

      {/* Coach Attention & Race Performance Estimates */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold text-navy-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Meaningful Changes & Areas for Coach Review
          </h3>

          {insight.attentionAreas.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              No workload spikes, %LTHR drift, or data-integrity anomalies detected for{' '}
              {selectedAthlete.name}.
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {insight.attentionAreas.map((flag) => (
                <div key={flag.id} className="py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`text-xs font-bold ${
                        flag.severity === 'high'
                          ? 'text-rose-700'
                          : flag.severity === 'moderate'
                          ? 'text-amber-700'
                          : 'text-sky-700'
                      }`}
                    >
                      {flag.category} ({flag.severity} priority)
                    </span>
                    <span className="font-mono text-xs font-medium text-slate-600 tabular-nums">
                      {flag.metricDetail}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{flag.summary}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-xs font-bold text-navy-900">Coach Review Prompt</p>
            <p className="mt-1 text-sm text-slate-700">{insight.coachReviewPrompt}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2">
            <Timer className="h-4 w-4 text-sky-600" />
            <h3 className="font-display text-sm font-bold text-navy-900">
              Race Performance Estimates
            </h3>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Riegel projections calibrated from threshold pace & volume
          </p>

          <div className="divide-y divide-slate-100">
            {insight.raceEstimates.length === 0 ? (
              <p className="py-4 text-xs text-slate-500">
                Configure threshold pace in athlete profile to compute Riegel performance projections.
              </p>
            ) : (
              insight.raceEstimates.map((est) => {
                const isGoalDist = est.distanceLabel === selectedAthlete.goal.distanceLabel;
                return (
                  <div key={est.distanceLabel} className="py-3 tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-navy-900">
                        {est.distanceLabel}
                        {isGoalDist && selectedAthlete.productionContext?.hasGoalRace !== false && (
                          <span className="ml-2 font-semibold text-sky-700">· Goal Distance</span>
                        )}
                      </span>
                      <span className="font-mono text-sm font-bold text-navy-900">
                        {formatDuration(est.estimatedSeconds)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>
                        Window {formatDuration(est.rangeLowSeconds)}–
                        {formatDuration(est.rangeHighSeconds)}
                      </span>
                      <span className="font-mono">{formatPace(est.estimatedPaceSecPerMile)}/mi</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Flagged Roster Quick Jump */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-display text-sm font-bold text-navy-900">
          Athletes with Review Flags ({flaggedAthletes.length})
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {flaggedAthletes.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAthlete(a.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                a.id === selectedAthlete.id
                  ? 'border-navy-900 bg-navy-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-navy-900 hover:bg-slate-100'
              }`}
            >
              {a.name} · {insightsByAthlete[a.id].attentionAreas[0].category}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
