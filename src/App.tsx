import { useEffect, useMemo, useState } from 'react';
import { Sidebar, NavTab } from './components/Layout/Sidebar';
import { TopBar } from './components/Layout/TopBar';
import { CoachCommandCenter } from './components/CommandCenter/CoachCommandCenter';
import { CoachDashboard } from './components/Dashboard/CoachDashboard';
import { AthleteRoster } from './components/Roster/AthleteRoster';
import { AthleteAnalysis } from './components/AthleteDetail/AthleteAnalysis';
import { AICoachingView } from './components/AICoaching/AICoachingView';
import { WeeklyReportsView } from './components/Reports/WeeklyReportsView';
import { IntegrationsView } from './components/Integrations/IntegrationsView';
import { coachingRepository } from './integrations/supabaseRepository';
import { aiCoachingEngine } from './integrations/aiEngine';
import { intervalsIcuAdapter } from './integrations/intervalsIcuAdapter';
import {
  INITIAL_AUDIT_EVENTS,
  INITIAL_SYNC_LOGS,
} from './integrations/normalizedStore';
import {
  AICoachingInsight,
  Athlete,
  AuditEventEntry,
  SynchronizationLogEntry,
  ThresholdApprovalCandidate,
  WeeklyAthleteReport,
} from './types/coaching';
import { computeWeeklyVolumeSeries } from './utils/analytics';
import { computeDailyAndWeeklyLoadSeries } from './utils/lthrAnalytics';
import { matchProviderIdentities } from './utils/identityMatching';

function buildReportForAthlete(ath: Athlete): WeeklyAthleteReport {
  const insight = aiCoachingEngine.analyzeAthlete(ath);
  const weekly = computeWeeklyVolumeSeries(ath.workouts);
  const lastFull = weekly[weekly.length - 2];
  const load = computeDailyAndWeeklyLoadSeries(ath.workouts);
  const latestDay = load.daily[load.daily.length - 1];
  const lastFullWeekLoad = load.weekly[load.weekly.length - 2];

  return {
    athleteId: ath.id,
    weekLabel: 'Nov 9–15, 2026',
    compliancePct: lastFull.compliancePct,
    actualMiles: lastFull.actualMiles,
    plannedMiles: lastFull.plannedMiles,
    weeklyHrStress: lastFullWeekLoad?.weeklyHrStress ?? 0,
    ctl: latestDay?.ctl ?? 0,
    atl: latestDay?.atl ?? 0,
    tsb: latestDay?.tsb ?? 0,
    aiSummary: `${insight.trainingProgression} ${insight.recoveryObservations}`,
    coachNote: ath.coachNotes,
    status: 'Draft',
    emailDeliveryNote:
      'Coach approval required before athlete email dispatch. Outbound email is offline in local sample mode.',
  };
}

export default function App() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [activeTab, setActiveTab] = useState<NavTab>('command');
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>('ath-01');
  const [reports, setReports] = useState<WeeklyAthleteReport[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [coachRole, setCoachRole] = useState<'Head Coach' | 'Assistant Coach'>('Head Coach');
  const [manualIdentityOverrides, setManualIdentityOverrides] = useState<
    Record<string, { intervalsId: string | null; rejected?: boolean }>
  >({});
  const [reviewedMatchIds, setReviewedMatchIds] = useState<Set<string>>(new Set());
  const [syncLogs, setSyncLogs] = useState<SynchronizationLogEntry[]>(INITIAL_SYNC_LOGS);
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>(INITIAL_AUDIT_EVENTS);
  const [pilotTestSucceeded, setPilotTestSucceeded] = useState<boolean>(false);

  const appendAudit = (action: string, targetEntity: string, detail: string) => {
    setAuditEvents((prev) => [
      {
        id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        actorRole: coachRole,
        action,
        targetEntity,
        detail,
      },
      ...prev,
    ]);
  };

  useEffect(() => {
    let mounted = true;
    coachingRepository.loadRoster().then((loaded) => {
      if (!mounted) return;
      setAthletes(loaded);
      if (loaded.length > 0) {
        setSelectedAthleteId(loaded[0].id);
      }

      const savedReports = coachingRepository.loadSavedReportDrafts();
      if (
        savedReports &&
        savedReports.length === loaded.length &&
        savedReports[0]?.weeklyHrStress !== undefined
      ) {
        setReports(savedReports);
      } else {
        setReports(loaded.map(buildReportForAthlete));
      }
    });

    void intervalsIcuAdapter.fetchServerIntegrationStatus().then((st) => {
      if (mounted && st?.pilotTestSucceeded) {
        setPilotTestSucceeded(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const candidates = useMemo(() => intervalsIcuAdapter.getPilotSampleCandidates(), []);
  const identityMappings = useMemo(
    () => matchProviderIdentities(athletes, candidates, manualIdentityOverrides),
    [athletes, candidates, manualIdentityOverrides]
  );

  const insightsByAthlete = useMemo(() => {
    const map: Record<string, AICoachingInsight> = {};
    for (const athlete of athletes) {
      map[athlete.id] = aiCoachingEngine.analyzeAthlete(athlete);
    }
    return map;
  }, [athletes]);

  const selectedAthlete =
    athletes.find((a) => a.id === selectedAthleteId) ?? athletes[0];

  const attentionCount = useMemo(
    () =>
      athletes.filter(
        (a) => (insightsByAthlete[a.id]?.attentionAreas.length ?? 0) > 0
      ).length,
    [athletes, insightsByAthlete]
  );

  const pendingApprovalCount = useMemo(
    () => reports.filter((r) => r.status !== 'Approved').length,
    [reports]
  );

  const handleSelectAthlete = (athleteId: string, openAiTab = false) => {
    setSelectedAthleteId(athleteId);
    setActiveTab(openAiTab ? 'ai' : 'athlete');
  };

  const handleSaveCoachNotes = (athleteId: string, notes: string) => {
    setAthletes((prev) =>
      prev.map((a) => (a.id === athleteId ? { ...a, coachNotes: notes } : a))
    );
    void coachingRepository.saveCoachNotes(athleteId, notes);
  };

  const handleUpdateAthletePhysiology = (updated: Athlete) => {
    setAthletes((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    coachingRepository.saveAthletePhysiology(updated);

    setReports((prev) => {
      const refreshed = buildReportForAthlete(updated);
      const next = prev.map((r) =>
        r.athleteId === updated.id
          ? {
              ...refreshed,
              coachNote: r.coachNote,
              status: r.status,
              approvedAt: r.approvedAt,
            }
          : r
      );
      void coachingRepository.saveReportDrafts(next);
      return next;
    });
  };

  const handleToggleApproveReport = (athleteId: string) => {
    setReports((prev) => {
      const next = prev.map((r) =>
        r.athleteId === athleteId
          ? {
              ...r,
              status: r.status === 'Approved' ? ('Draft' as const) : ('Approved' as const),
              approvedAt: r.status === 'Approved' ? undefined : new Date().toISOString(),
            }
          : r
      );
      void coachingRepository.saveReportDrafts(next);
      return next;
    });
    appendAudit('REPORT_APPROVAL_TOGGLED', athleteId, `Coach toggled pre-email report approval.`);
  };

  const handleApproveAllOnTrack = () => {
    setReports((prev) => {
      const next = prev.map((r) =>
        r.compliancePct >= 85
          ? { ...r, status: 'Approved' as const, approvedAt: new Date().toISOString() }
          : r
      );
      void coachingRepository.saveReportDrafts(next);
      return next;
    });
    appendAudit('REPORT_BATCH_APPROVED', 'weekly_reports', 'Approved reports >=85% compliance.');
  };

  const handleUpdateReportNote = (athleteId: string, note: string) => {
    setReports((prev) => {
      const next = prev.map((r) =>
        r.athleteId === athleteId ? { ...r, coachNote: note } : r
      );
      void coachingRepository.saveReportDrafts(next);
      return next;
    });
  };

  const handleManualMatchAthlete = (
    athleteId: string,
    intervalsId: string | null,
    rejected?: boolean
  ) => {
    setManualIdentityOverrides((prev) => ({
      ...prev,
      [athleteId]: { intervalsId, rejected },
    }));
    appendAudit(
      rejected ? 'IDENTITY_MATCH_REJECTED' : 'IDENTITY_MATCH_CONFIRMED',
      athleteId,
      rejected
        ? 'Coach rejected candidate identity mapping.'
        : `Coach confirmed Intervals.icu mapping to ${intervalsId}.`
    );
  };

  const handleApproveThresholdCandidate = (
    updatedAthlete: Athlete,
    cand: ThresholdApprovalCandidate
  ) => {
    handleUpdateAthletePhysiology(updatedAthlete);
    appendAudit(
      'THRESHOLD_CHANGE_APPROVED',
      updatedAthlete.id,
      `Approved LTHR shift ${cand.currentLthrBpm} -> ${cand.proposedLthrBpm} bpm (${cand.sourceDevice}).`
    );
  };

  const handleMarkMatchReviewed = (matchId: string) => {
    setReviewedMatchIds((prev) => new Set(prev).add(matchId));
    appendAudit('WORKOUT_MATCH_REVIEWED', matchId, 'Coach verified uncertain activity match.');
  };

  const handleRunSyncJob = (
    jobType: SynchronizationLogEntry['jobType'],
    provider: SynchronizationLogEntry['provider']
  ) => {
    const now = new Date().toISOString();
    const verifiedCount = identityMappings.filter((m) => m.matchStatus === 'Verified Match').length;
    const isBlockedByPilot = provider === 'intervals_icu' && !pilotTestSucceeded;
    setSyncLogs((prev) => [
      {
        id: `sync-${Date.now()}`,
        jobType,
        provider,
        startedAt: now,
        finishedAt: now,
        status: isBlockedByPilot ? 'Blocked (Unauthorized)' : 'Succeeded (Demo Mode)',
        attemptNumber: jobType === 'retry_sync' ? 2 : 1,
        recordsProcessed: isBlockedByPilot ? 0 : verifiedCount * 12,
        duplicatesSkipped: 0,
        errorMessage: isBlockedByPilot
          ? 'Full roster sync blocked: run and pass the 6-step Pilot Athlete Connection Test first (demo mode preserved).'
          : undefined,
      },
      ...prev,
    ]);
    appendAudit(
      isBlockedByPilot ? 'ROSTER_SYNC_BLOCKED_BY_PILOT_GATE' : 'SYNC_JOB_TRIGGERED',
      provider,
      isBlockedByPilot
        ? `Blocked ${jobType} (${provider}) until pilot athlete verification succeeds.`
        : `Triggered ${jobType} (${provider}).`
    );
  };

  const handlePilotTestRecorded = (passed: boolean, pilotLabel?: string) => {
    setPilotTestSucceeded(passed);
    appendAudit(
      passed ? 'PILOT_CONNECTION_TEST_PASSED' : 'PILOT_CONNECTION_TEST_INCOMPLETE',
      'intervals_icu',
      passed
        ? `6-step pilot test passed for ${pilotLabel ?? 'shared athlete'} (coach auth, roster, activities, HR/LTHR, load). Full roster sync gate unlocked.`
        : '6-step pilot test ran without full pass; full roster synchronization remains locked.'
    );
  };

  const handleDeleteAthleteData = (athleteId: string) => {
    if (coachRole !== 'Head Coach') return;
    const target = athletes.find((a) => a.id === athleteId);
    if (!target) return;
    setAthletes((prev) => {
      const remaining = prev.filter((a) => a.id !== athleteId);
      if (selectedAthleteId === athleteId && remaining.length > 0) {
        setSelectedAthleteId(remaining[0].id);
      }
      return remaining;
    });
    setReports((prev) => prev.filter((r) => r.athleteId !== athleteId));
    appendAudit(
      'ATHLETE_DATA_DELETED',
      athleteId,
      `Deleted normalized records, thresholds, and reports for ${target.name}.`
    );
  };

  if (athletes.length === 0 || !selectedAthlete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-900 text-sm font-medium text-white">
        Loading Running Coach AI...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        attentionCount={attentionCount}
        pendingApprovalCount={pendingApprovalCount}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeTab={activeTab}
          selectedAthleteName={selectedAthlete.name}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigateIntegrations={() => setActiveTab('integrations')}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {activeTab === 'command' && (
            <CoachCommandCenter
              athletes={athletes}
              reports={reports}
              onSelectAthlete={handleSelectAthlete}
              onToggleApproveReport={handleToggleApproveReport}
              onApproveAllOnTrack={handleApproveAllOnTrack}
              onOpenReportsTab={() => setActiveTab('reports')}
            />
          )}

          {activeTab === 'dashboard' && (
            <CoachDashboard
              athletes={athletes}
              insightsByAthlete={insightsByAthlete}
              onSelectAthlete={handleSelectAthlete}
            />
          )}

          {activeTab === 'roster' && (
            <AthleteRoster
              athletes={athletes}
              insightsByAthlete={insightsByAthlete}
              onSelectAthlete={(id) => handleSelectAthlete(id, false)}
            />
          )}

          {activeTab === 'athlete' && (
            <AthleteAnalysis
              athletes={athletes}
              athlete={selectedAthlete}
              insight={insightsByAthlete[selectedAthlete.id]}
              onSelectAthlete={(id) => setSelectedAthleteId(id)}
              onSaveCoachNotes={handleSaveCoachNotes}
              onUpdateAthletePhysiology={handleUpdateAthletePhysiology}
              onOpenAiTab={() => setActiveTab('ai')}
            />
          )}

          {activeTab === 'ai' && (
            <AICoachingView
              athletes={athletes}
              selectedAthlete={selectedAthlete}
              insight={insightsByAthlete[selectedAthlete.id]}
              insightsByAthlete={insightsByAthlete}
              onSelectAthlete={(id) => setSelectedAthleteId(id)}
            />
          )}

          {activeTab === 'reports' && (
            <WeeklyReportsView
              athletes={athletes}
              reports={reports}
              onToggleApprove={handleToggleApproveReport}
              onApproveAllOnTrack={handleApproveAllOnTrack}
              onUpdateCoachNote={handleUpdateReportNote}
            />
          )}

          {activeTab === 'integrations' && (
            <IntegrationsView
              athletes={athletes}
              reports={reports}
              mappings={identityMappings}
              candidates={candidates}
              syncLogs={syncLogs}
              auditEvents={auditEvents}
              reviewedMatchIds={reviewedMatchIds}
              coachRole={coachRole}
              pilotTestSucceeded={pilotTestSucceeded}
              onPilotTestRecorded={handlePilotTestRecorded}
              onChangeCoachRole={setCoachRole}
              onManualMatchAthlete={handleManualMatchAthlete}
              onApproveThresholdCandidate={handleApproveThresholdCandidate}
              onMarkMatchReviewed={handleMarkMatchReviewed}
              onRunSyncJob={handleRunSyncJob}
              onDeleteAthleteData={handleDeleteAthleteData}
            />
          )}
        </main>
      </div>
    </div>
  );
}
