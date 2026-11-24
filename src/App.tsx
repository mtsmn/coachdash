import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar, NavTab } from './components/Layout/Sidebar';
import { TopBar } from './components/Layout/TopBar';
import { CoachCommandCenter } from './components/CommandCenter/CoachCommandCenter';
import { CoachDashboard } from './components/Dashboard/CoachDashboard';
import { AthleteRoster } from './components/Roster/AthleteRoster';
import { AthleteAnalysis } from './components/AthleteDetail/AthleteAnalysis';
import { AICoachingView } from './components/AICoaching/AICoachingView';
import { WeeklyReportsView } from './components/Reports/WeeklyReportsView';
import { IntegrationsView } from './components/Integrations/IntegrationsView';
import { ProductionWorkspaceBar } from './components/Production/ProductionWorkspaceBar';
import {
  CoachAuthPanel,
  CoachAuthStatus,
  VerifiedCoachIdentity,
} from './components/Auth/CoachAuthPanel';
import { coachingRepository } from './integrations/supabaseRepository';
import { aiCoachingEngine } from './integrations/aiEngine';
import {
  FullRosterSyncResponse,
  intervalsIcuAdapter,
  PilotSyncResponse,
} from './integrations/intervalsIcuAdapter';
import {
  loadProductionWorkspaceData,
  loadSingleProductionAthleteBundle,
  ProductionWorkspaceBundle,
} from './integrations/productionDashboardMapper';
import { productionIntelligenceAdapter } from './integrations/productionIntelligenceAdapter';
import {
  getActiveSession,
  getSupabaseBrowserClient,
} from './integrations/supabaseClient';
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
import { computeWeeklyVolumeSeries, resolveAnchorDateIso } from './utils/analytics';
import { resolveAthleteLoadSeries } from './utils/commandCenterAnalytics';
import { matchProviderIdentities } from './utils/identityMatching';

function buildReportForAthlete(ath: Athlete): WeeklyAthleteReport {
  const insight = aiCoachingEngine.analyzeAthlete(ath);
  const anchorIso = resolveAnchorDateIso(ath);
  const weekly = computeWeeklyVolumeSeries(ath.workouts, anchorIso);
  const lastFull = weekly[weekly.length - 2] ?? weekly[weekly.length - 1];
  const load = resolveAthleteLoadSeries(ath, anchorIso);
  const latestDay = load.daily[load.daily.length - 1];
  const lastFullWeekLoad = load.weekly[load.weekly.length - 2] ?? load.weekly[load.weekly.length - 1];

  return {
    athleteId: ath.id,
    weekLabel: lastFull?.weekLabel ?? anchorIso,
    actualMiles: lastFull?.actualMiles ?? 0,
    plannedMiles: lastFull?.plannedMiles ?? 0,
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

  const [appMode, setAppMode] = useState<'demo' | 'production'>('demo');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<CoachAuthStatus>('signed_out');
  const [verifiedCoach, setVerifiedCoach] = useState<VerifiedCoachIdentity | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [coachRole, setCoachRole] = useState<'Head Coach' | 'Assistant Coach'>('Head Coach');
  const [manualIdentityOverrides, setManualIdentityOverrides] = useState<
    Record<string, { intervalsId: string | null; rejected?: boolean }>
  >({});
  const [reviewedMatchIds, setReviewedMatchIds] = useState<Set<string>>(new Set());
  const [syncLogs, setSyncLogs] = useState<SynchronizationLogEntry[]>(INITIAL_SYNC_LOGS);
  const [auditEvents, setAuditEvents] = useState<AuditEventEntry[]>(INITIAL_AUDIT_EVENTS);
  const [pilotTestSucceeded, setPilotTestSucceeded] = useState<boolean>(false);

  // Live Production Workspace State (strictly isolated from Demo state)
  const [prodBundle, setProdBundle] = useState<ProductionWorkspaceBundle | null>(null);
  const [prodSelectedAthleteId, setProdSelectedAthleteId] = useState<string | null>(null);
  const [prodLoading, setProdLoading] = useState<boolean>(false);
  const [prodSyncing, setProdSyncing] = useState<boolean>(false);
  const [prodRosterSyncing, setProdRosterSyncing] = useState<boolean>(false);
  const [prodAnalyzing, setProdAnalyzing] = useState<boolean>(false);
  const [prodSyncFeedback, setProdSyncFeedback] = useState<PilotSyncResponse | null>(null);
  const [prodRosterSyncFeedback, setProdRosterSyncFeedback] =
    useState<FullRosterSyncResponse | null>(null);

  const inFlightVerificationRef = useRef<{
    token: string;
    promise: Promise<boolean>;
  } | null>(null);
  const verifiedTokenRef = useRef<string | null>(null);
  const latestVerificationTokenRef = useRef<string | null>(null);

  const verifyCoachSessionWithServer = useCallback(async (token: string): Promise<boolean> => {
    if (!token) {
      return false;
    }

    if (verifiedTokenRef.current === token) {
      return true;
    }

    if (inFlightVerificationRef.current?.token === token) {
      return inFlightVerificationRef.current.promise;
    }

    latestVerificationTokenRef.current = token;
    let promise: Promise<boolean> | null = null;

    const runVerification = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (latestVerificationTokenRef.current !== token) {
          return false;
        }

        if (res.status === 401) {
          verifiedTokenRef.current = null;
          setAuthStatus('expired');
          setVerifiedCoach(null);
          setAccessToken(null);
          setAuthErrorMessage(
            'Your coach session expired or is invalid (HTTP 401). Please sign in again.'
          );
          return false;
        }

        if (res.status === 403) {
          verifiedTokenRef.current = null;
          let serverError =
            'Forbidden: authenticated user is not the active owner coach (HTTP 403).';
          try {
            const payload = (await res.json()) as { error?: string };
            if (payload.error) serverError = payload.error;
          } catch {
            // Keep default 403 explanation
          }
          setAuthStatus('unauthorized');
          setVerifiedCoach(null);
          setAccessToken(null);
          setAuthErrorMessage(serverError);
          return false;
        }

        if (!res.ok) {
          verifiedTokenRef.current = null;
          setAuthStatus('signed_out');
          setVerifiedCoach(null);
          setAccessToken(null);
          setAuthErrorMessage(`Unable to verify coach session (HTTP ${res.status}).`);
          return false;
        }

        const payload = (await res.json()) as { ok: boolean; coach?: VerifiedCoachIdentity };
        if (!payload.ok || !payload.coach) {
          verifiedTokenRef.current = null;
          setAuthStatus('signed_out');
          setVerifiedCoach(null);
          setAccessToken(null);
          setAuthErrorMessage('Server did not return a verified owner-coach profile.');
          return false;
        }

        verifiedTokenRef.current = token;
        setAuthStatus('signed_in');
        setVerifiedCoach(payload.coach);
        setAccessToken(token);
        setAuthErrorMessage(null);

        const st = await intervalsIcuAdapter.fetchServerIntegrationStatus(token);
        if (latestVerificationTokenRef.current === token && st) {
          setPilotTestSucceeded(Boolean(st.pilotTestSucceeded));
        }
        return true;
      } catch {
        if (latestVerificationTokenRef.current !== token) {
          return false;
        }
        verifiedTokenRef.current = null;
        setAuthStatus('signed_out');
        setVerifiedCoach(null);
        setAccessToken(null);
        setAuthErrorMessage('Unable to contact server authentication endpoint.');
        return false;
      } finally {
        if (inFlightVerificationRef.current?.promise === promise) {
          inFlightVerificationRef.current = null;
        }
      }
    };

    promise = runVerification();
    inFlightVerificationRef.current = { token, promise };
    return promise;
  }, []);

  const handleSignedOut = useCallback(() => {
    latestVerificationTokenRef.current = null;
    verifiedTokenRef.current = null;
    inFlightVerificationRef.current = null;
    setAuthStatus('signed_out');
    setVerifiedCoach(null);
    setAccessToken(null);
    setAuthErrorMessage(null);
    setPilotTestSucceeded(false);
    setProdBundle(null);
    setProdSelectedAthleteId(null);
    setProdSyncFeedback(null);
    setProdRosterSyncFeedback(null);
  }, []);

  const handleAuthError = useCallback(
    (status: 401 | 403, message: string) => {
      latestVerificationTokenRef.current = null;
      verifiedTokenRef.current = null;
      inFlightVerificationRef.current = null;
      setAuthStatus(status === 401 ? 'expired' : 'unauthorized');
      setVerifiedCoach(null);
      setAccessToken(null);
      setAuthErrorMessage(message);
      if (appMode === 'demo') {
        setAuthModalOpen(true);
      }
    },
    [appMode]
  );

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

    void getActiveSession().then((session) => {
      if (!mounted || !session?.access_token) return;
      void verifyCoachSessionWithServer(session.access_token);
    });

    const client = getSupabaseBrowserClient();
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session?.access_token) {
        handleSignedOut();
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void verifyCoachSessionWithServer(session.access_token);
      }
    }).data.subscription;

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [verifyCoachSessionWithServer, handleSignedOut]);

  const refreshProductionWorkspace = useCallback(
    async (preferredId?: string | null) => {
      if (!accessToken || authStatus !== 'signed_in') return;
      setProdLoading(true);
      const bundle = await loadProductionWorkspaceData({
        accessToken,
        preferredAthleteId: preferredId ?? prodSelectedAthleteId,
        onAuthError: handleAuthError,
      });
      setProdBundle(bundle);
      if (bundle.connection) {
        setPilotTestSucceeded(Boolean(bundle.connection.pilotTestSucceeded));
      }
      setProdSelectedAthleteId((prev) => {
        if (preferredId && bundle.athletes.some((a) => a.id === preferredId)) return preferredId;
        if (prev && bundle.athletes.some((a) => a.id === prev)) return prev;
        return bundle.defaultAthleteId;
      });
      setProdLoading(false);
    },
    [accessToken, authStatus, handleAuthError, prodSelectedAthleteId]
  );

  useEffect(() => {
    if (appMode === 'production' && authStatus === 'signed_in' && accessToken) {
      void refreshProductionWorkspace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, authStatus, accessToken]);

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

  const isProductionSignedIn = appMode === 'production' && authStatus === 'signed_in';
  const activeAthletes = isProductionSignedIn ? prodBundle?.athletes ?? [] : athletes;
  const activeInsights = isProductionSignedIn ? prodBundle?.insights ?? {} : insightsByAthlete;
  const activeReports = isProductionSignedIn ? prodBundle?.reports ?? [] : reports;
  const activeSelectedAthlete = isProductionSignedIn
    ? activeAthletes.find((a) => a.id === prodSelectedAthleteId) ?? activeAthletes[0]
    : selectedAthlete;

  const attentionCount = useMemo(
    () =>
      appMode === 'production' && authStatus !== 'signed_in'
        ? 0
        : activeAthletes.filter(
            (a) => (activeInsights[a.id]?.attentionAreas.length ?? 0) > 0
          ).length,
    [appMode, authStatus, activeAthletes, activeInsights]
  );

  const pendingApprovalCount = useMemo(
    () =>
      appMode === 'production' && authStatus !== 'signed_in'
        ? 0
        : activeReports.filter((r) => r.status !== 'Approved').length,
    [appMode, authStatus, activeReports]
  );

  const handleSelectAthlete = (athleteId: string, openAiTab = false) => {
    if (appMode === 'production') {
      setProdSelectedAthleteId(athleteId);
    } else {
      setSelectedAthleteId(athleteId);
    }
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
      const next = prev.map((r) => {
        const hasHighPriority = (insightsByAthlete[r.athleteId]?.attentionAreas ?? []).some(
          (f) => f.severity === 'high'
        );
        return !hasHighPriority
          ? { ...r, status: 'Approved' as const, approvedAt: new Date().toISOString() }
          : r;
      });
      void coachingRepository.saveReportDrafts(next);
      return next;
    });
    appendAudit('REPORT_BATCH_APPROVED', 'weekly_reports', 'Approved ready draft reports.');
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

  // Production Mode Mutators (Supabase-backed)
  const refreshSingleProdAthleteInBundle = async (athleteId: string) => {
    if (!accessToken) return;
    const single = await loadSingleProductionAthleteBundle({
      accessToken,
      athleteId,
      onAuthError: handleAuthError,
    });
    if (!single) return;
    setProdBundle((prev) => {
      if (!prev) return prev;
      const nextAthletes = prev.athletes.map((a) => (a.id === athleteId ? single.athlete : a));
      const nextInsights = { ...prev.insights, [athleteId]: single.insight };
      const latestRep = single.reports[0];
      const nextReports = latestRep
        ? prev.reports.some((r) => r.athleteId === athleteId)
          ? prev.reports.map((r) => (r.athleteId === athleteId ? latestRep : r))
          : [...prev.reports, latestRep]
        : prev.reports;
      return {
        ...prev,
        athletes: nextAthletes,
        insights: nextInsights,
        reports: nextReports,
      };
    });
  };

  const handleProdSyncPilot = async () => {
    if (!accessToken) return;
    setProdSyncing(true);
    setProdRosterSyncFeedback(null);
    const res = await intervalsIcuAdapter.runPilotSynchronization({
      accessToken,
      pilotAthleteId: prodBundle?.connection?.verifiedPilotAthleteId ?? undefined,
      mode: 'auto',
      onAuthError: handleAuthError,
    });
    setProdSyncFeedback(res);
    await refreshProductionWorkspace(res.internalAthleteId ?? prodSelectedAthleteId);
    setProdSyncing(false);
  };

  const handleProdSyncFullRoster = async () => {
    if (!accessToken) return;
    setProdRosterSyncing(true);
    setProdSyncFeedback(null);
    const res = await intervalsIcuAdapter.runFullRosterSynchronization({
      accessToken,
      mode: 'auto',
      onAuthError: handleAuthError,
    });
    setProdRosterSyncFeedback(res);
    await refreshProductionWorkspace(prodSelectedAthleteId);
    setProdRosterSyncing(false);
  };

  const handleProdRunIntelligence = async () => {
    if (!accessToken || !activeSelectedAthlete) return;
    setProdAnalyzing(true);
    await productionIntelligenceAdapter.runAndPersistAnalysis({
      accessToken,
      athleteId: activeSelectedAthlete.id,
      onAuthError: handleAuthError,
    });
    await refreshSingleProdAthleteInBundle(activeSelectedAthlete.id);
    setProdAnalyzing(false);
  };

  const handleProdAddPlannedWorkout = async (workout: {
    athleteId: string;
    workoutDate: string;
    title: string;
    workoutType: 'Easy' | 'Long Run' | 'Tempo' | 'Intervals' | 'Recovery' | 'Race';
    plannedMiles: number;
    plannedDurationMin: number;
    targetZone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!accessToken) return { ok: false, error: 'Coach authentication required.' };
    const res = await productionIntelligenceAdapter.addPlannedWorkout({
      accessToken,
      athleteId: workout.athleteId,
      workout: {
        workoutDate: workout.workoutDate,
        title: workout.title,
        workoutType: workout.workoutType,
        plannedMiles: workout.plannedMiles,
        plannedDurationMin: workout.plannedDurationMin,
        targetZone: workout.targetZone,
      },
      onAuthError: handleAuthError,
    });
    if (res.ok) {
      await refreshSingleProdAthleteInBundle(workout.athleteId);
    }
    return { ok: res.ok, error: res.error };
  };

  const handleProdUpdateAlertStatus = async (
    alertId: string,
    status: 'acknowledged' | 'resolved'
  ) => {
    if (!accessToken || !activeSelectedAthlete) return;
    const ok = await productionIntelligenceAdapter.updateAlertStatus({
      accessToken,
      alertId,
      status,
      onAuthError: handleAuthError,
    });
    if (ok) {
      await refreshSingleProdAthleteInBundle(activeSelectedAthlete.id);
    }
  };

  const handleProdToggleApproveReport = async (athleteId: string) => {
    if (!accessToken || !prodBundle) return;
    const rep = prodBundle.reports.find((r) => r.athleteId === athleteId);
    if (!rep?.weekStartDate) return;
    let targetWeek = rep.weekStartDate;
    if (!rep.id) {
      await productionIntelligenceAdapter.runAndPersistAnalysis({
        accessToken,
        athleteId,
        onAuthError: handleAuthError,
      });
      const single = await loadSingleProductionAthleteBundle({
        accessToken,
        athleteId,
        onAuthError: handleAuthError,
      });
      if (single?.reports[0]?.weekStartDate) {
        targetWeek = single.reports[0].weekStartDate;
      }
    }
    const nextStatus = rep.status === 'Approved' ? 'Draft' : 'Approved';
    await productionIntelligenceAdapter.updateWeeklyReport({
      accessToken,
      athleteId,
      weekStartDate: targetWeek,
      coachNote: rep.coachNote,
      status: nextStatus,
      onAuthError: handleAuthError,
    });
    await refreshSingleProdAthleteInBundle(athleteId);
  };

  const handleProdApproveReadyReports = async () => {
    if (!accessToken || !prodBundle) return;
    const targets = prodBundle.reports.filter((r) => {
      if (r.status === 'Approved' || !r.weekStartDate) return false;
      const flags = prodBundle.insights[r.athleteId]?.attentionAreas ?? [];
      return !flags.some((f) => f.severity === 'high');
    });
    await Promise.all(
      targets.map(async (rep) => {
        if (!rep.id) {
          await productionIntelligenceAdapter.runAndPersistAnalysis({
            accessToken,
            athleteId: rep.athleteId,
            onAuthError: handleAuthError,
          });
        }
        await productionIntelligenceAdapter.updateWeeklyReport({
          accessToken,
          athleteId: rep.athleteId,
          weekStartDate: rep.weekStartDate!,
          coachNote: rep.coachNote,
          status: 'Approved',
          onAuthError: handleAuthError,
        });
      })
    );
    await refreshProductionWorkspace(prodSelectedAthleteId);
  };

  const handleProdUpdateReportNote = (athleteId: string, note: string) => {
    setProdBundle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reports: prev.reports.map((r) =>
          r.athleteId === athleteId ? { ...r, coachNote: note } : r
        ),
      };
    });
  };

  const handleProdPersistReportNote = async (athleteId: string, note: string) => {
    if (!accessToken || !prodBundle) return;
    const rep = prodBundle.reports.find((r) => r.athleteId === athleteId);
    if (!rep?.weekStartDate) return;
    if (!rep.id) {
      await productionIntelligenceAdapter.runAndPersistAnalysis({
        accessToken,
        athleteId,
        onAuthError: handleAuthError,
      });
    }
    await productionIntelligenceAdapter.updateWeeklyReport({
      accessToken,
      athleteId,
      weekStartDate: rep.weekStartDate,
      coachNote: note,
      status: rep.status === 'Approved' ? 'Approved' : 'Draft',
      onAuthError: handleAuthError,
    });
    await refreshSingleProdAthleteInBundle(athleteId);
  };

  const handleProdSaveCoachNotes = async (athleteId: string, notes: string) => {
    setProdBundle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        athletes: prev.athletes.map((a) =>
          a.id === athleteId ? { ...a, coachNotes: notes } : a
        ),
        reports: prev.reports.map((r) =>
          r.athleteId === athleteId ? { ...r, coachNote: notes } : r
        ),
      };
    });
    await handleProdPersistReportNote(athleteId, notes);
  };

  const handleProdUpdateAthletePhysiology = (updated: Athlete) => {
    setProdBundle((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        athletes: prev.athletes.map((a) => (a.id === updated.id ? updated : a)),
      };
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
    if (appMode === 'production' && authStatus === 'signed_in' && passed) {
      void refreshProductionWorkspace();
    }
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

  if (appMode === 'demo' && (athletes.length === 0 || !selectedAthlete)) {
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
        appMode={appMode}
        rosterCount={appMode === 'production' ? (authStatus === 'signed_in' ? activeAthletes.length : 0) : athletes.length}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeTab={activeTab}
          selectedAthleteName={
            appMode === 'production'
              ? authStatus === 'signed_in'
                ? activeSelectedAthlete?.name
                : undefined
              : selectedAthlete?.name
          }
          appMode={appMode}
          authStatus={authStatus}
          verifiedCoachEmail={verifiedCoach?.email ?? null}
          onToggleMode={(mode) => {
            setAppMode(mode);
            setAuthModalOpen(false);
          }}
          onOpenAuthModal={() => setAuthModalOpen(true)}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNavigateIntegrations={() => setActiveTab('integrations')}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {appMode === 'production' ? (
            authStatus !== 'signed_in' ? (
              <div className="py-8">
                <CoachAuthPanel
                  appMode="production"
                  authStatus={authStatus}
                  verifiedCoach={verifiedCoach}
                  authErrorMessage={authErrorMessage}
                  onAuthSessionEstablished={verifyCoachSessionWithServer}
                  onSignedOut={handleSignedOut}
                  onSwitchToDemoMode={() => setAppMode('demo')}
                />
              </div>
            ) : activeTab === 'integrations' ? (
              <IntegrationsView
                athletes={prodBundle?.athletes ?? []}
                reports={prodBundle?.reports ?? []}
                mappings={[]}
                candidates={[]}
                syncLogs={(prodBundle?.syncLogs ?? []).map((l) => ({
                  id: l.id,
                  jobType:
                    l.jobType === 'backfill_12w' ||
                    l.jobType === 'daily_activity_import' ||
                    l.jobType === 'daily_metric_update' ||
                    l.jobType === 'retry_sync'
                      ? l.jobType
                      : 'daily_activity_import',
                  provider:
                    l.provider === 'final_surge'
                      ? ('final_surge' as const)
                      : ('intervals_icu' as const),
                  startedAt: l.startedAt,
                  finishedAt: l.finishedAt ?? l.startedAt,
                  status: l.status as SynchronizationLogEntry['status'],
                  attemptNumber: l.attemptNumber,
                  recordsProcessed: l.recordsProcessed,
                  duplicatesSkipped: l.duplicatesSkipped,
                  errorMessage: l.errorMessage ?? undefined,
                }))}
                auditEvents={[]}
                reviewedMatchIds={new Set()}
                coachRole="Head Coach"
                pilotTestSucceeded={pilotTestSucceeded}
                accessToken={accessToken}
                appMode="production"
                authStatus={authStatus}
                onAuthError={handleAuthError}
                onPilotTestRecorded={handlePilotTestRecorded}
                onChangeCoachRole={() => undefined}
                onManualMatchAthlete={() => undefined}
                onApproveThresholdCandidate={() => undefined}
                onMarkMatchReviewed={() => undefined}
                onRunSyncJob={() => undefined}
                onDeleteAthleteData={() => undefined}
              />
            ) : (
              <>
                <ProductionWorkspaceBar
                  verifiedCoachEmail={verifiedCoach?.email ?? null}
                  bundle={prodBundle}
                  selectedAthlete={activeSelectedAthlete}
                  pilotTestSucceeded={pilotTestSucceeded}
                  loading={prodLoading}
                  syncing={prodSyncing}
                  rosterSyncing={prodRosterSyncing}
                  analyzing={prodAnalyzing}
                  syncFeedback={prodSyncFeedback}
                  rosterSyncFeedback={prodRosterSyncFeedback}
                  onSyncPilot={() => void handleProdSyncPilot()}
                  onSyncFullRoster={() => void handleProdSyncFullRoster()}
                  onRefreshWorkspace={() => void refreshProductionWorkspace()}
                  onRunIntelligence={() => void handleProdRunIntelligence()}
                  onSelectAthlete={(id) => setProdSelectedAthleteId(id)}
                  onAddPlannedWorkout={handleProdAddPlannedWorkout}
                  onOpenIntegrations={() => setActiveTab('integrations')}
                  onSwitchToDemoMode={() => setAppMode('demo')}
                />

                {activeAthletes.length > 0 && (
                  <>
                    {activeTab === 'command' && (
                      <CoachCommandCenter
                        athletes={activeAthletes}
                        reports={activeReports}
                        onSelectAthlete={handleSelectAthlete}
                        onToggleApproveReport={(id) => void handleProdToggleApproveReport(id)}
                        onApproveAllOnTrack={() => void handleProdApproveReadyReports()}
                        onOpenReportsTab={() => setActiveTab('reports')}
                      />
                    )}

                    {activeTab === 'dashboard' && (
                      <CoachDashboard
                        athletes={activeAthletes}
                        insightsByAthlete={activeInsights}
                        onSelectAthlete={handleSelectAthlete}
                      />
                    )}

                    {activeTab === 'roster' && (
                      <AthleteRoster
                        athletes={activeAthletes}
                        insightsByAthlete={activeInsights}
                        onSelectAthlete={(id) => handleSelectAthlete(id, false)}
                      />
                    )}

                    {activeTab === 'athlete' && activeSelectedAthlete && (
                      <AthleteAnalysis
                        athletes={activeAthletes}
                        athlete={activeSelectedAthlete}
                        insight={activeInsights[activeSelectedAthlete.id]}
                        onSelectAthlete={(id) => setProdSelectedAthleteId(id)}
                        onSaveCoachNotes={(id, notes) => void handleProdSaveCoachNotes(id, notes)}
                        onUpdateAthletePhysiology={handleProdUpdateAthletePhysiology}
                        onOpenAiTab={() => setActiveTab('ai')}
                      />
                    )}

                    {activeTab === 'ai' && activeSelectedAthlete && (
                      <AICoachingView
                        athletes={activeAthletes}
                        selectedAthlete={activeSelectedAthlete}
                        insight={activeInsights[activeSelectedAthlete.id]}
                        insightsByAthlete={activeInsights}
                        onSelectAthlete={(id) => setProdSelectedAthleteId(id)}
                        onUpdateAlertStatus={(alertId, status) =>
                          void handleProdUpdateAlertStatus(alertId, status)
                        }
                      />
                    )}

                    {activeTab === 'reports' && (
                      <WeeklyReportsView
                        athletes={activeAthletes}
                        reports={activeReports}
                        selectedAthleteId={activeSelectedAthlete?.id}
                        onToggleApprove={(id) => void handleProdToggleApproveReport(id)}
                        onApproveAllOnTrack={() => void handleProdApproveReadyReports()}
                        onUpdateCoachNote={handleProdUpdateReportNote}
                        onPersistCoachNote={(id, note) =>
                          void handleProdPersistReportNote(id, note)
                        }
                      />
                    )}
                  </>
                )}
              </>
            )
          ) : (
            <>
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

              {activeTab === 'athlete' && selectedAthlete && (
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

              {activeTab === 'ai' && selectedAthlete && (
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
                  accessToken={accessToken}
                  appMode="demo"
                  authStatus={authStatus}
                  onAuthError={handleAuthError}
                  onPilotTestRecorded={handlePilotTestRecorded}
                  onChangeCoachRole={setCoachRole}
                  onManualMatchAthlete={handleManualMatchAthlete}
                  onApproveThresholdCandidate={handleApproveThresholdCandidate}
                  onMarkMatchReviewed={handleMarkMatchReviewed}
                  onRunSyncJob={handleRunSyncJob}
                  onDeleteAthleteData={handleDeleteAthleteData}
                />
              )}
            </>
          )}
        </main>
      </div>

      {authModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Owner Coach Sign-In"
        >
          <div className="w-full max-w-lg">
            <CoachAuthPanel
              appMode={appMode}
              authStatus={authStatus}
              verifiedCoach={verifiedCoach}
              authErrorMessage={authErrorMessage}
              onAuthSessionEstablished={async (token) => {
                const verified = await verifyCoachSessionWithServer(token);
                if (verified) {
                  setAuthModalOpen(false);
                }
              }}
              onSignedOut={() => {
                handleSignedOut();
                setAuthModalOpen(false);
              }}
              onSwitchToDemoMode={
                appMode === 'production'
                  ? () => {
                      setAppMode('demo');
                      setAuthModalOpen(false);
                    }
                  : undefined
              }
              onClose={() => setAuthModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
