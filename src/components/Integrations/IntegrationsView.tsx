import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  FileCheck2,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unplug,
  UserCheck,
} from 'lucide-react';
import {
  Athlete,
  AuditEventEntry,
  IntervalsCandidateProfile,
  StressMethodologyId,
  SynchronizationLogEntry,
  ThresholdApprovalCandidate,
  UnifiedAthleteMapping,
  WeeklyAthleteReport,
} from '../../types/coaching';
import {
  finalSurgeAdapter,
  FinalSurgeFeedTestDto,
  FinalSurgeServerStatusDto,
  FinalSurgeSyncDto,
} from '../../integrations/finalSurgeAdapter';
import { garminAdapter } from '../../integrations/garminAdapter';
import { coachingRepository } from '../../integrations/supabaseRepository';
import { aiCoachingEngine } from '../../integrations/aiEngine';
import {
  FullRosterSyncResponse,
  intervalsIcuAdapter,
  IntervalsRosterAthleteRowDto,
  IntervalsRosterOverviewDto,
  PilotSyncResponse,
  RosterDeepTelemetryValidationReport,
  RosterDisplayStatusDto,
  ServerIntervalsProbeResult,
  ServerIntervalsStatus,
  ServerPilotConnectionTestResult,
} from '../../integrations/intervalsIcuAdapter';
import { CoachAuthStatus } from '../Auth/CoachAuthPanel';
import { previewHistoricalImportBatch } from '../../utils/historicalImport';
import {
  computeAllThreeLoadSystemsForAthlete,
  computeIndependentStressForActivity,
  RUNNING_STRESS_METHODOLOGY_DOCS,
} from '../../utils/loadSystems';
import { buildAthleteWorkoutMatchesFromDemo } from '../../utils/workoutMatching';
import {
  buildNormalizedCoachingDatabase,
  prepareNormalizedImportArchitecture,
} from '../../integrations/normalizedStore';
import {
  classifyHrIntoZone,
  computeLthrZones,
  recalculateAthleteWithThreshold,
} from '../../utils/lthrAnalytics';
import { formatPace } from '../../utils/analytics';

const SAMPLE_FINALSURGE_CSV = [
  'Date,Title,Type,DistanceMiles,DurationMinutes,AvgPace,AvgHR,MaxHR',
  '2026-11-16,Aerobic Base 8mi,Easy,8.0,63,7:52,147,156',
  '2026-11-17,Threshold Cruise 6mi,Tempo,6.2,43,6:56,170,178',
  '2026-11-18,Recovery Shakeout 4mi,Recovery,4.0,34,8:30,136,144',
].join('\n');

type OpsSubTab = 'connections' | 'identity' | 'imports_matching' | 'loads_automation';

interface IntegrationsViewProps {
  athletes: Athlete[];
  reports: WeeklyAthleteReport[];
  mappings: UnifiedAthleteMapping[];
  candidates: IntervalsCandidateProfile[];
  syncLogs: SynchronizationLogEntry[];
  auditEvents: AuditEventEntry[];
  reviewedMatchIds: Set<string>;
  coachRole: 'Head Coach' | 'Assistant Coach';
  pilotTestSucceeded: boolean;
  accessToken?: string | null;
  appMode?: 'demo' | 'production';
  authStatus?: CoachAuthStatus;
  onAuthError?: (status: 401 | 403, message: string) => void;
  onPilotTestRecorded: (passed: boolean, pilotLabel?: string) => void;
  onChangeCoachRole: (role: 'Head Coach' | 'Assistant Coach') => void;
  onManualMatchAthlete: (athleteId: string, intervalsId: string | null, rejected?: boolean) => void;
  onApproveThresholdCandidate: (updatedAthlete: Athlete, cand: ThresholdApprovalCandidate) => void;
  onMarkMatchReviewed: (matchId: string) => void;
  onRunSyncJob: (jobType: SynchronizationLogEntry['jobType'], provider: SynchronizationLogEntry['provider']) => void;
  onDeleteAthleteData: (athleteId: string) => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  athletes,
  reports,
  mappings,
  candidates,
  syncLogs,
  auditEvents,
  reviewedMatchIds,
  coachRole,
  pilotTestSucceeded,
  accessToken = null,
  appMode = 'demo',
  authStatus = 'signed_out',
  onAuthError,
  onPilotTestRecorded,
  onChangeCoachRole,
  onManualMatchAthlete,
  onApproveThresholdCandidate,
  onMarkMatchReviewed,
  onRunSyncJob,
  onDeleteAthleteData,
}) => {
  const [subTab, setSubTab] = useState<OpsSubTab>('connections');
  const [serverStatus, setServerStatus] = useState<ServerIntervalsStatus | null>(null);
  const [probeResult, setProbeResult] = useState<ServerIntervalsProbeResult | null>(null);
  const [pilotResult, setPilotResult] = useState<ServerPilotConnectionTestResult | null>(null);
  const [rosterValidation, setRosterValidation] =
    useState<RosterDeepTelemetryValidationReport | null>(null);
  const [pilotAthleteIdInput, setPilotAthleteIdInput] = useState<string>('');
  const [pilotTesting, setPilotTesting] = useState(false);
  const [pilotSyncing, setPilotSyncing] = useState(false);
  const [pilotSyncResult, setPilotSyncResult] = useState<PilotSyncResponse | null>(null);
  const [rosterSyncing, setRosterSyncing] = useState(false);
  const [rosterSyncResult, setRosterSyncResult] = useState<FullRosterSyncResponse | null>(null);
  const [rosterOverview, setRosterOverview] = useState<IntervalsRosterOverviewDto | null>(null);
  const [loadingRosterOverview, setLoadingRosterOverview] = useState(false);
  const [probingRosterPermissions, setProbingRosterPermissions] = useState(false);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [rosterSyncMode, setRosterSyncMode] = useState<'auto' | 'initial' | 'incremental'>('auto');
  const [rosterSearchQuery, setRosterSearchQuery] = useState('');
  const [rosterStatusFilter, setRosterStatusFilter] = useState<string>('all');
  const [expandedMappingExtId, setExpandedMappingExtId] = useState<string | null>(null);
  const [expandedHistoryExtId, setExpandedHistoryExtId] = useState<string | null>(null);
  const [mappingSelectionByExtId, setMappingSelectionByExtId] = useState<Record<string, string>>({});
  const [rosterBusyExtId, setRosterBusyExtId] = useState<string | null>(null);
  const [rosterActionNotice, setRosterActionNotice] = useState<string | null>(null);
  const [validatingRoster, setValidatingRoster] = useState(false);
  const [probing, setProbing] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  const [importMode, setImportMode] = useState<'incremental' | 'backfill_12_week'>('backfill_12_week');
  const [dismissedCandidates, setDismissedCandidates] = useState<Set<string>>(new Set());

  const [selectedMatchAthleteId, setSelectedMatchAthleteId] = useState<string>(
    athletes[0]?.id ?? 'ath-01'
  );
  const [selectedLoadAthleteId, setSelectedLoadAthleteId] = useState<string>(
    athletes[0]?.id ?? 'ath-01'
  );
  const [selectedMethodology, setSelectedMethodology] =
    useState<StressMethodologyId>('hr_derived_stress');
  const [deleteTargetId, setDeleteTargetId] = useState<string>('');
  const [deleteConfirmName, setDeleteConfirmName] = useState<string>('');
  const [finalSurgeCsvText, setFinalSurgeCsvText] = useState<string>(SAMPLE_FINALSURGE_CSV);
  const [csvAthleteId, setCsvAthleteId] = useState<string>(athletes[0]?.id ?? 'ath-01');
  const [showOptionalIntervals, setShowOptionalIntervals] = useState<boolean>(false);

  // Milestone 3.4: Production Final Surge Calendar Sync (.ics) & Historical Export state
  const [fsStatus, setFsStatus] = useState<FinalSurgeServerStatusDto | null>(null);
  const [fsSelectedAthleteId, setFsSelectedAthleteId] = useState<string>('');
  const [fsFeedUrlInput, setFsFeedUrlInput] = useState<string>('');
  const [fsExternalIdInput, setFsExternalIdInput] = useState<string>('');
  const [fsStartDate, setFsStartDate] = useState<string>('');
  const [fsEndDate, setFsEndDate] = useState<string>('');
  const [fsTestResult, setFsTestResult] = useState<FinalSurgeFeedTestDto | null>(null);
  const [fsSyncResult, setFsSyncResult] = useState<FinalSurgeSyncDto | null>(null);
  const [fsBusyAction, setFsBusyAction] = useState<string | null>(null);
  const [fsNotice, setFsNotice] = useState<string | null>(null);
  const [fsExportFormat, setFsExportFormat] = useState<'ics' | 'csv'>('ics');
  const [fsExportContent, setFsExportContent] = useState<string>('');

  const loadRosterOverview = async (probePermissions = false) => {
    if (!accessToken || appMode !== 'production') return;
    if (probePermissions) setProbingRosterPermissions(true);
    else setLoadingRosterOverview(true);
    const overview = await intervalsIcuAdapter.fetchIntervalsRosterOverview(
      accessToken,
      { probePermissions },
      onAuthError
    );
    setRosterOverview(overview);
    if (probePermissions) setProbingRosterPermissions(false);
    else setLoadingRosterOverview(false);
  };

  useEffect(() => {
    void intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken).then((status) => {
      setServerStatus(status);
      if (status?.hasApiKey || status?.connected || status?.pilotTestSucceeded) {
        setShowOptionalIntervals(true);
      }
      if (status?.verifiedPilotAthleteId) {
        setPilotAthleteIdInput((prev) =>
          prev.trim() ? prev : status.verifiedPilotAthleteId ?? ''
        );
      }
      if (accessToken && appMode === 'production' && status?.pilotTestSucceeded) {
        void intervalsIcuAdapter
          .fetchIntervalsRosterOverview(accessToken, { probePermissions: false }, onAuthError)
          .then((ov) => setRosterOverview(ov));
      }
    });
  }, [accessToken, appMode]);

  useEffect(() => {
    if (!accessToken) {
      setFsStatus(null);
      return;
    }
    void finalSurgeAdapter.fetchServerStatus(accessToken).then((status) => {
      setFsStatus(status);
      if (status?.availableAthletes?.length) {
        setFsSelectedAthleteId((prev) => {
          if (prev && status.availableAthletes.some((a) => a.id === prev)) return prev;
          const pilotMatch = status.availableAthletes.find((a) => Boolean(a.intervalsAthleteId));
          return (pilotMatch ?? status.availableAthletes[0]).id;
        });
      }
    });
  }, [accessToken]);

  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'INTERVALS_OAUTH_SUCCESS') return;
      const isTrustedOrigin =
        event.origin === window.location.origin ||
        event.origin.endsWith('.run.app') ||
        event.origin.includes('localhost') ||
        event.origin.includes('127.0.0.1');
      if (!isTrustedOrigin) return;

      setOauthNotice(
        'Intervals.icu OAuth authorization completed and tokens were encrypted on the server.'
      );
      void intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken).then((status) => {
        if (status) {
          setServerStatus(status);
          onPilotTestRecorded(Boolean(status.pilotTestSucceeded));
        }
      });
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [accessToken, onPilotTestRecorded]);

  const handleRunReadOnlyTest = async () => {
    setProbing(true);
    const res = await intervalsIcuAdapter.runReadOnlyConnectionTest(accessToken, onAuthError);
    setProbeResult(res);
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    if (refreshed) {
      setServerStatus(refreshed);
      onPilotTestRecorded(Boolean(refreshed.pilotTestSucceeded));
    }
    setProbing(false);
  };

  const handleRunPilotTest = async () => {
    setPilotTesting(true);
    const res = await intervalsIcuAdapter.runPilotConnectionTest(
      pilotAthleteIdInput,
      accessToken,
      onAuthError
    );
    setPilotResult(res);
    onPilotTestRecorded(
      res.pilotTestSucceeded,
      res.selectedPilotAthlete ? `${res.selectedPilotAthlete.name} (${res.selectedPilotAthlete.id})` : undefined
    );
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    if (refreshed) {
      setServerStatus(refreshed);
      if (refreshed.verifiedPilotAthleteId) {
        setPilotAthleteIdInput(refreshed.verifiedPilotAthleteId);
      }
    }
    setPilotTesting(false);
  };

  const handleRunPilotSync = async () => {
    setPilotSyncing(true);
    const syncRes = await intervalsIcuAdapter.runPilotSynchronization({
      accessToken,
      pilotAthleteId:
        serverStatus?.verifiedPilotAthleteId ??
        pilotResult?.selectedPilotAthlete?.id ??
        (pilotAthleteIdInput.trim() || undefined),
      mode: 'auto',
      onAuthError,
    });
    setPilotSyncResult(syncRes);
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    if (refreshed) {
      setServerStatus(refreshed);
    }
    setPilotSyncing(false);
  };

  const handleRunFullRosterSync = async (
    mode: 'auto' | 'initial' | 'incremental' = rosterSyncMode,
    options?: { athleteIds?: string[]; retryFailedOnly?: boolean }
  ) => {
    setRosterSyncing(true);
    setRosterActionNotice(null);
    const rosterRes = await intervalsIcuAdapter.runFullRosterSynchronization({
      accessToken,
      mode,
      athleteIds: options?.athleteIds,
      retryFailedOnly: options?.retryFailedOnly,
      onAuthError,
    });
    setRosterSyncResult(rosterRes);
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    if (refreshed) {
      setServerStatus(refreshed);
    }
    await loadRosterOverview(false);
    setRosterSyncing(false);
  };

  const handleResolveRosterMapping = async (payload: {
    action: 'link_existing' | 'create_and_link' | 'confirm_candidate' | 'leave_unmapped';
    externalAthleteId: string;
    athleteId?: string;
  }) => {
    setRosterBusyExtId(payload.externalAthleteId);
    setRosterActionNotice(null);
    const res = await intervalsIcuAdapter.resolveIntervalsAthleteMapping(
      accessToken,
      payload,
      onAuthError
    );
    setRosterActionNotice(res.message);
    if (res.ok) {
      setExpandedMappingExtId(null);
      await loadRosterOverview(false);
    }
    setRosterBusyExtId(null);
  };

  const toggleRosterRowSelection = (extId: string) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(extId)) next.delete(extId);
      else next.add(extId);
      return next;
    });
  };

  const filteredRosterRows = useMemo(() => {
    const rows = rosterOverview?.athletes ?? [];
    const q = rosterSearchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hit =
          r.athleteName.toLowerCase().includes(q) ||
          r.externalAthleteId.toLowerCase().includes(q) ||
          (r.email ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (rosterStatusFilter === 'needs_mapping') {
        return r.currentSyncStatus === 'Not mapped' || r.currentSyncStatus === 'Awaiting coach review';
      }
      if (rosterStatusFilter === 'eligible') {
        return r.eligibleForSync;
      }
      if (rosterStatusFilter === 'failed_partial') {
        return r.currentSyncStatus === 'Failed' || r.currentSyncStatus === 'Partially succeeded';
      }
      if (rosterStatusFilter !== 'all') {
        return r.currentSyncStatus === rosterStatusFilter;
      }
      return true;
    });
  }, [rosterOverview, rosterSearchQuery, rosterStatusFilter]);

  const rosterStatusBadgeCls = (status: RosterDisplayStatusDto): string => {
    switch (status) {
      case 'Succeeded':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Partially succeeded':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Failed':
      case 'Permission unavailable':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Synchronizing':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'Awaiting coach review':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Ready to sync':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const handleRunFullRosterValidation = async () => {
    setValidatingRoster(true);
    const report = await intervalsIcuAdapter.runFullRosterDeepTelemetryValidation(
      pilotAthleteIdInput,
      90,
      accessToken,
      onAuthError
    );
    setRosterValidation(report);
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    if (refreshed) {
      setServerStatus(refreshed);
      onPilotTestRecorded(Boolean(refreshed.pilotTestSucceeded));
    }
    setValidatingRoster(false);
  };

  const handleStartOAuth = async () => {
    const res = await intervalsIcuAdapter.getOAuthAuthorizeUrl(accessToken, onAuthError);
    if (res.authError) {
      setOauthNotice(res.authError);
      return;
    }
    if (!res.configured || !res.authorizeUrl) {
      setOauthNotice(
        `OAuth server setup required: configure ${res.missingVars.join(', ')} in server environment variables before opening intervals.icu/oauth/authorize.`
      );
      return;
    }
    const popup = window.open(
      res.authorizeUrl,
      'intervals_oauth',
      'width=620,height=720,noopener=false'
    );
    if (!popup) {
      setOauthNotice(
        'Popup blocked by browser. Allow popups for this preview to complete optional Intervals.icu OAuth.'
      );
    } else {
      setOauthNotice('Waiting for Intervals.icu OAuth authorization in popup window...');
    }
  };

  const handleDisconnectOAuth = async () => {
    await intervalsIcuAdapter.disconnectOAuthSession(accessToken, onAuthError);
    const refreshed = await intervalsIcuAdapter.fetchServerIntegrationStatus(accessToken);
    setServerStatus(refreshed);
    setProbeResult(null);
    setPilotResult(null);
    onPilotTestRecorded(false);
    setOauthNotice('Server OAuth session cleared. Full roster sync locked until pilot test passes.');
  };

  const refreshFinalSurgeStatus = async () => {
    if (!accessToken) return;
    const status = await finalSurgeAdapter.fetchServerStatus(accessToken, onAuthError);
    if (status) {
      setFsStatus(status);
      if (status.availableAthletes.length > 0 && !fsSelectedAthleteId) {
        const pilotMatch = status.availableAthletes.find((a) => Boolean(a.intervalsAthleteId));
        setFsSelectedAthleteId((pilotMatch ?? status.availableAthletes[0]).id);
      }
    }
  };

  const handleConnectAndVerifyFsFeed = async () => {
    if (!accessToken || !fsSelectedAthleteId) return;
    setFsBusyAction('connect');
    setFsNotice(null);
    const res = await finalSurgeAdapter.connectAndVerifyFeed({
      accessToken,
      athleteId: fsSelectedAthleteId,
      feedUrl: fsFeedUrlInput,
      externalAthleteId: fsExternalIdInput,
      onAuthError,
    });
    setFsTestResult(res);
    if (res.ok) {
      setFsFeedUrlInput('');
      setFsNotice(
        `Verified Final Surge Calendar Sync feed (${res.maskedFeedUrl ?? 'masked'}) with ${res.activePlannedCount} active planned workouts.`
      );
    } else {
      setFsNotice(res.errorMessage ?? 'Unable to verify Final Surge Calendar Sync URL.');
    }
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const handleTestSavedFsFeed = async () => {
    if (!accessToken) return;
    setFsBusyAction('test');
    setFsNotice(null);
    const res = await finalSurgeAdapter.testConnection({
      accessToken,
      athleteId: fsSelectedAthleteId || undefined,
      onAuthError,
    });
    setFsTestResult(res);
    setFsNotice(
      res.ok
        ? `Live Calendar Sync feed verified (${res.activePlannedCount} active planned events).`
        : res.errorMessage ?? 'Saved Final Surge feed verification failed.'
    );
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const handleSyncFsWorkouts = async (athleteId: string, mode: 'initial' | 'incremental') => {
    if (!accessToken || !athleteId) return;
    setFsBusyAction(`sync_${mode}_${athleteId}`);
    setFsNotice(null);
    const res = await finalSurgeAdapter.syncPlannedWorkouts({
      accessToken,
      athleteId,
      mode,
      startDate: fsStartDate.trim() || undefined,
      endDate: fsEndDate.trim() || undefined,
      onAuthError,
    });
    setFsSyncResult(res);
    setFsNotice(
      res.ok
        ? `Final Surge ${mode} sync succeeded for ${res.athleteName}: ${res.insertedCount} inserted, ${res.updatedCount} updated, ${res.deletedCount} removed, ${res.duplicatesSkipped} unchanged (${res.preservedManualCount} manual workouts preserved).`
        : res.errorMessage ?? 'Final Surge synchronization failed.'
    );
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const handleImportFsExport = async () => {
    if (!accessToken || !fsSelectedAthleteId || !fsExportContent.trim()) return;
    setFsBusyAction('import');
    setFsNotice(null);
    const res = await finalSurgeAdapter.importPlannedExport({
      accessToken,
      athleteId: fsSelectedAthleteId,
      format: fsExportFormat,
      content: fsExportContent,
      startDate: fsStartDate.trim() || undefined,
      endDate: fsEndDate.trim() || undefined,
      onAuthError,
    });
    setFsSyncResult(res);
    setFsNotice(
      res.ok
        ? `Historical ${fsExportFormat.toUpperCase()} import succeeded for ${res.athleteName}: ${res.insertedCount} inserted, ${res.updatedCount} updated, ${res.duplicatesSkipped} unchanged (${res.preservedManualCount} manual workouts preserved).`
        : res.errorMessage ?? 'Final Surge export import failed.'
    );
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const handleUnlinkFsAthlete = async (athleteId: string) => {
    if (!accessToken) return;
    setFsBusyAction(`unlink_${athleteId}`);
    const res = await finalSurgeAdapter.updateAthleteMapping({
      accessToken,
      athleteId,
      action: 'unlink',
      onAuthError,
    });
    setFsNotice(
      res.ok
        ? 'Final Surge athlete feed mapping removed. Manual planned workouts remain intact.'
        : res.error ?? 'Failed to unlink athlete feed.'
    );
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const handleDisconnectFs = async () => {
    if (!accessToken) return;
    setFsBusyAction('disconnect');
    const ok = await finalSurgeAdapter.disconnect(accessToken, onAuthError);
    setFsTestResult(null);
    setFsSyncResult(null);
    setFsNotice(
      ok
        ? 'Final Surge Calendar Sync credentials cleared and connection marked Disconnected.'
        : 'Unable to disconnect Final Surge session.'
    );
    await refreshFinalSurgeStatus();
    setFsBusyAction(null);
  };

  const connectors = [
    finalSurgeAdapter.getConnectionInfo(fsStatus),
    aiCoachingEngine.getConnectionInfo(),
    coachingRepository.getConnectionInfo(),
    intervalsIcuAdapter.getConnectionInfo(serverStatus),
    garminAdapter.getConnectionInfo(),
  ];

  const finalSurgeCapabilities = useMemo(() => finalSurgeAdapter.getCapabilityAudit(), []);
  const csvTargetAthlete = athletes.find((a) => a.id === csvAthleteId) ?? athletes[0];
  const parsedCsvStress = useMemo(() => {
    if (!csvTargetAthlete) return { rows: [], warnings: [] as string[] };
    const parsed = finalSurgeAdapter.parseCoachCsvExport(
      finalSurgeCsvText,
      csvTargetAthlete.maxHrBpm
    );
    const zones = computeLthrZones(
      csvTargetAthlete.lthrBpm,
      csvTargetAthlete.hrZoneConfig,
      csvTargetAthlete.maxHrBpm
    );
    const enriched = parsed.rows.map((row, idx) => {
      const stress = computeIndependentStressForActivity({
        activity: {
          id: `fs-csv-${idx}`,
          athleteId: csvTargetAthlete.id,
          externalActivityId: `fs-csv-${idx}`,
          provider: 'final_surge',
          sourceDevice: 'Final Surge Summary Export',
          date: row.date,
          startTimeLocal: '07:00',
          title: row.title,
          activityType: row.activityType,
          durationMinutes: row.durationMinutes,
          distanceMiles: row.distanceMiles,
          avgPaceSecPerMile: row.avgPaceSecPerMile,
          avgHrBpm: row.avgHrBpm,
          maxHrBpm: row.maxHrBpm,
          avgPowerWatts: null,
          elevationGainFt: 0,
          rpe: null,
          hrDataState: row.hrDataState,
          hrValidationFlags: row.hrValidationFlags,
          rawRecordId: `fs-raw-${idx}`,
        },
        lthrBpm: csvTargetAthlete.lthrBpm,
        thresholdPaceSecPerMile: csvTargetAthlete.thresholdPaceSecPerMile,
        thresholdPowerWatts: null,
      });
      return {
        ...row,
        zone: classifyHrIntoZone(row.avgHrBpm, zones),
        hrRunningStress: stress.hrRunningStress,
        paceRunningStress: stress.paceRunningStress,
      };
    });
    return { rows: enriched, warnings: parsed.warnings };
  }, [finalSurgeCsvText, csvTargetAthlete]);

  // Stage 4: Historical import preview across verified pilot mappings
  const importPreview = useMemo(
    () =>
      previewHistoricalImportBatch({
        athletes,
        mappings,
        mode: importMode,
      }),
    [athletes, mappings, importMode]
  );

  // Stage 6: Workout matching for selected athlete
  const matchAthlete = athletes.find((a) => a.id === selectedMatchAthleteId) ?? athletes[0];
  const workoutMatches = useMemo(
    () =>
      matchAthlete
        ? buildAthleteWorkoutMatchesFromDemo(matchAthlete, reviewedMatchIds).slice(0, 18)
        : [],
    [matchAthlete, reviewedMatchIds]
  );

  // Stage 5: 3-System Load comparison for selected athlete
  const loadAthlete = athletes.find((a) => a.id === selectedLoadAthleteId) ?? athletes[0];
  const threeLoadSystems = useMemo(() => {
    if (!loadAthlete) return null;
    const dbNorm = buildNormalizedCoachingDatabase({
      athletes: [loadAthlete],
      mappings: mappings.filter((m) => m.internalAthleteId === loadAthlete.id),
      reports: reports.filter((r) => r.athleteId === loadAthlete.id),
      syncLogs,
      auditEvents,
    });
    return {
      dbNorm,
      systems: computeAllThreeLoadSystemsForAthlete(loadAthlete, dbNorm.completedActivities),
    };
  }, [loadAthlete, mappings, reports, syncLogs, auditEvents]);

  // Stage 12: 16-table normalized store counts across full roster
  const fullNormalizedDb = useMemo(
    () =>
      buildNormalizedCoachingDatabase({
        athletes,
        mappings,
        reports,
        syncLogs,
        auditEvents,
      }),
    [athletes, mappings, reports, syncLogs, auditEvents]
  );

  const importArchitecturePlan = useMemo(
    () =>
      prepareNormalizedImportArchitecture({
        validationAthletes: rosterValidation?.athletes ?? [],
        normalizedDb: fullNormalizedDb,
      }),
    [rosterValidation, fullNormalizedDb]
  );

  const effectivePilotSucceeded = serverStatus
    ? Boolean(serverStatus.pilotTestSucceeded)
    : pilotTestSucceeded;
  const verifiedMappingCount = mappings.filter((m) => m.matchStatus === 'Verified Match').length;
  const reviewRequiredCount = mappings.filter(
    (m) => m.matchStatus === 'Candidate Review Required'
  ).length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-xl bg-navy-900 p-5 text-white">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-medium text-sky-300">
              Primary Source: Final Surge (Roster, Plans & Completed Summaries) · Optional Future Source: Intervals.icu
            </p>
            <h2 className="mt-1 font-display text-lg font-bold">
              Final Surge Primary Architecture, Independent Load Analytics & Sync Operations
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
              Running Coach AI independently computes hrRSS, Pace-derived rTSS, CTL (42d), ATL (7d), TSB, and individualized LTHR zones without requiring running power or a mandatory Intervals.icu link.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {appMode === 'production' ? (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                <span>
                  {authStatus === 'signed_in'
                    ? 'Owner Coach · Verified by JWT'
                    : 'Owner Sign-In Required'}
                </span>
              </div>
            ) : (
              <>
                <label className="text-xs text-slate-300 whitespace-nowrap" htmlFor="coach-role-select">
                  Demo UI Role (Preview Only):
                </label>
                <select
                  id="coach-role-select"
                  value={coachRole}
                  onChange={(e) => onChangeCoachRole(e.target.value as 'Head Coach' | 'Assistant Coach')}
                  className="rounded-lg border border-white/20 bg-navy-800 px-3 py-1.5 text-xs font-semibold text-white focus:outline-none"
                >
                  <option value="Head Coach">Head Coach (Full Access)</option>
                  <option value="Assistant Coach">Assistant Coach (Read / Review)</option>
                </select>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            { id: 'connections', label: '01. Final Surge (Primary) & Optional Intervals.icu' },
            {
              id: 'identity',
              label: `02. Identity Matching (${verifiedMappingCount} linked / ${reviewRequiredCount} review)`,
            },
            { id: 'imports_matching', label: '03. Historical Import & Workout Matching' },
            { id: 'loads_automation', label: '04. Stress Methodology, Sync & Audit' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              subTab === tab.id
                ? 'bg-navy-900 text-white'
                : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: FINAL SURGE PRIMARY SOURCE AUDIT + OPTIONAL INTERVALS.ICU */}
      {subTab === 'connections' && (
        <div className="space-y-6">
          {/* Final Surge Verified API & Export Capability Audit */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Final Surge Primary Source — Verified API & Export Capabilities
                  </h3>
                  <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Primary Source · Power Not Required
                  </span>
                </div>
                <p className="mt-1 max-w-4xl text-xs text-slate-600">
                  Verification finding: Final Surge does <strong>not</strong> offer an open self-serve REST API. Detailed HR graphs visible on the Final Surge website come from uploaded watch files and are <strong>not</strong> programmatically exposed via a public API—programmatic HR time-series streams require individual <code className="font-mono">.FIT/.TCX</code> exports or partner middleware. Summary metrics (duration, distance, pace, avg HR, max HR) are sufficient for all independent stress calculations below.
                </p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Final Surge Data Field</th>
                    <th className="px-3 py-2 font-semibold">Web UI</th>
                    <th className="px-3 py-2 font-semibold">Public REST API</th>
                    <th className="px-3 py-2 font-semibold">Authorized Access Pathway</th>
                    <th className="px-3 py-2 font-semibold">Engineering Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {finalSurgeCapabilities.map((cap) => (
                    <tr key={cap.field}>
                      <td className="px-3 py-2 font-semibold text-navy-900">{cap.field}</td>
                      <td className="px-3 py-2 text-emerald-700 font-semibold">
                        {cap.visibleInWebUi ? 'Yes' : 'No'}
                      </td>
                      <td className="px-3 py-2 text-amber-700 font-semibold">
                        {cap.publicRestApiAvailable ? 'Yes' : 'No (Partner / Export)'}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-navy-900">
                        {cap.accessPathway}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{cap.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Interactive Final Surge Coach CSV Export Stress Calculator */}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-navy-900">
                    Final Surge Coach Export Preview & Independent Stress Calculator (Zero Power Required)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Paste or edit Final Surge CSV summary rows (Date, Title, Type, DistanceMiles, DurationMinutes, AvgPace, AvgHR, MaxHR) to compute independent hrRSS, Pace rTSS, and LTHR zone.
                  </p>
                </div>
                <select
                  value={csvAthleteId}
                  onChange={(e) => setCsvAthleteId(e.target.value)}
                  aria-label="Select athlete threshold reference for Final Surge CSV preview"
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900"
                >
                  {athletes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} (LTHR {a.lthrBpm} bpm · {formatPace(a.thresholdPaceSecPerMile)}/mi)
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <textarea
                  value={finalSurgeCsvText}
                  onChange={(e) => setFinalSurgeCsvText(e.target.value)}
                  rows={5}
                  aria-label="Final Surge CSV export input"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-navy-900"
                />
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs tabular-nums">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Date / Run</th>
                        <th className="px-3 py-2 text-right font-semibold">Avg HR / Zone</th>
                        <th className="px-3 py-2 text-right font-semibold">hrRSS</th>
                        <th className="px-3 py-2 text-right font-semibold">Pace rTSS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedCsvStress.rows.map((r, i) => (
                        <tr key={`${r.date}-${i}`}>
                          <td className="px-3 py-2">
                            <span className="font-mono text-[11px] text-slate-500">{r.date}</span>{' '}
                            <span className="font-semibold text-navy-900">{r.title}</span>
                            <p className="text-[11px] text-slate-500">
                              {r.distanceMiles} mi · {r.durationMinutes}m @{' '}
                              {r.avgPaceSecPerMile ? `${formatPace(r.avgPaceSecPerMile)}/mi` : '--'}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {r.avgHrBpm ?? '--'} bpm · {r.zone ?? '--'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-navy-900">
                            {r.hrRunningStress ?? '--'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-sky-700">
                            {r.paceRunningStress ?? '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {parsedCsvStress.warnings.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-700">
                  {parsedCsvStress.warnings.join(' ')}
                </p>
              )}
            </div>
          </div>

          {/* Milestone 3.4: Production Final Surge Calendar Sync (.ics) & Historical Export */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Final Surge Production Sync — Official Calendar Sync (.ics) &amp; Historical Export
                  </h3>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      fsStatus?.connected
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {accessToken
                      ? fsStatus?.connectionState ?? 'Loading Status...'
                      : 'Sign In Required for Live Persistence'}
                  </span>
                </div>
                <p className="mt-1 max-w-4xl text-xs text-slate-600">
                  {fsStatus?.metadata.officialLiveMethod ??
                    'Official Final Surge Calendar Sync (Read-Only iCalendar .ics Feed)'}
                  . {fsStatus?.metadata.partnerOAuthNotice ??
                    'Partner OAuth requires direct commercial approval; no username/password scraping is ever used. Private feed URLs are encrypted server-side and never returned unmasked to the browser.'}
                </p>
              </div>
              {accessToken && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTestSavedFsFeed}
                    disabled={Boolean(fsBusyAction) || !fsStatus?.mappedAthletes.some((m) => m.hasFeedUrl)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${fsBusyAction === 'test' ? 'animate-spin' : ''}`} />
                    <span>{fsBusyAction === 'test' ? 'Testing Feed...' : 'Test Saved Feed'}</span>
                  </button>
                  {fsStatus?.configured && (
                    <button
                      type="button"
                      onClick={handleDisconnectFs}
                      disabled={Boolean(fsBusyAction)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      <span>Disconnect Final Surge</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!accessToken ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                Sign in with your Supabase coach account in Production Mode to connect an athlete&apos;s official Final Surge Calendar Sync URL (<code className="font-mono">Settings → Calendar Sync</code>) or import historical <code className="font-mono">.ics</code> / CSV exports into Supabase. Demo Mode analytics above remain active.
              </div>
            ) : (
              <div className="mt-4 space-y-5">
                {fsNotice && (
                  <div
                    className={`rounded-lg border px-4 py-2.5 text-xs ${
                      fsTestResult?.ok === false || fsSyncResult?.ok === false
                        ? 'border-rose-200 bg-rose-50 text-rose-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    }`}
                  >
                    {fsNotice}
                  </div>
                )}

                {/* Connect & Verify Athlete Calendar Sync URL */}
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 lg:grid-cols-12">
                  <div className="lg:col-span-3">
                    <label
                      htmlFor="fs-athlete-select"
                      className="block text-[11px] font-semibold text-slate-600"
                    >
                      Target Persisted Athlete
                    </label>
                    <select
                      id="fs-athlete-select"
                      value={fsSelectedAthleteId}
                      onChange={(e) => setFsSelectedAthleteId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-navy-900"
                    >
                      {(!fsStatus || fsStatus.availableAthletes.length === 0) && (
                        <option value="">No persisted athletes yet — run Pilot Sync first</option>
                      )}
                      {(fsStatus?.availableAthletes ?? []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.fullName}
                          {a.intervalsAthleteId ? ` (Intervals ${a.intervalsAthleteId})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-4">
                    <label
                      htmlFor="fs-feed-url-input"
                      className="block text-[11px] font-semibold text-slate-600"
                    >
                      Final Surge Calendar Sync URL (Settings → Calendar Sync)
                    </label>
                    <input
                      id="fs-feed-url-input"
                      type="password"
                      value={fsFeedUrlInput}
                      onChange={(e) => setFsFeedUrlInput(e.target.value)}
                      placeholder="https://www.finalsurge.com/...ics or webcal://..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-navy-900"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label
                      htmlFor="fs-external-id-input"
                      className="block text-[11px] font-semibold text-slate-600"
                    >
                      Final Surge Athlete ID (Opt.)
                    </label>
                    <input
                      id="fs-external-id-input"
                      type="text"
                      value={fsExternalIdInput}
                      onChange={(e) => setFsExternalIdInput(e.target.value)}
                      placeholder="fs-athlete-id"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-navy-900"
                    />
                  </div>

                  <div className="flex items-end lg:col-span-3">
                    <button
                      type="button"
                      onClick={handleConnectAndVerifyFsFeed}
                      disabled={
                        Boolean(fsBusyAction) || !fsSelectedAthleteId || !fsFeedUrlInput.trim()
                      }
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-3 py-2 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      <span>
                        {fsBusyAction === 'connect'
                          ? 'Verifying Feed...'
                          : 'Connect & Verify Feed'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Date Range + Sync Actions */}
                <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label
                        htmlFor="fs-start-date"
                        className="block text-[11px] font-semibold text-slate-600"
                      >
                        Sync Window Start (Opt.)
                      </label>
                      <input
                        id="fs-start-date"
                        type="date"
                        value={fsStartDate}
                        onChange={(e) => setFsStartDate(e.target.value)}
                        className="mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-navy-900"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="fs-end-date"
                        className="block text-[11px] font-semibold text-slate-600"
                      >
                        Sync Window End (Opt.)
                      </label>
                      <input
                        id="fs-end-date"
                        type="date"
                        value={fsEndDate}
                        onChange={(e) => setFsEndDate(e.target.value)}
                        className="mt-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-xs text-navy-900"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        fsSelectedAthleteId &&
                        void handleSyncFsWorkouts(fsSelectedAthleteId, 'initial')
                      }
                      disabled={
                        Boolean(fsBusyAction) ||
                        !fsSelectedAthleteId ||
                        !fsStatus?.mappedAthletes.some(
                          (m) => m.athleteId === fsSelectedAthleteId && m.hasFeedUrl
                        )
                      }
                      className="rounded-lg bg-navy-900 px-3 py-2 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                    >
                      Initial Backfill Sync
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        fsSelectedAthleteId &&
                        void handleSyncFsWorkouts(fsSelectedAthleteId, 'incremental')
                      }
                      disabled={
                        Boolean(fsBusyAction) ||
                        !fsSelectedAthleteId ||
                        !fsStatus?.mappedAthletes.some(
                          (m) => m.athleteId === fsSelectedAthleteId && m.hasFeedUrl
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Incremental Refresh
                    </button>
                  </div>
                </div>

                {/* Mapped Final Surge Athletes */}
                {fsStatus && fsStatus.mappedAthletes.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Athlete</th>
                          <th className="px-3 py-2 font-semibold">Mapping &amp; Status</th>
                          <th className="px-3 py-2 font-semibold">Encrypted Feed (Masked)</th>
                          <th className="px-3 py-2 font-semibold">Verified / Synced</th>
                          <th className="px-3 py-2 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {fsStatus.mappedAthletes.map((m) => (
                          <tr key={m.athleteId}>
                            <td className="px-3 py-2 font-semibold text-navy-900">
                              {m.athleteName}
                              {m.externalAthleteId && (
                                <p className="font-mono text-[11px] font-normal text-slate-500">
                                  ID: {m.externalAthleteId}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-semibold text-emerald-700">{m.matchStatus}</span>
                              <p className="text-[11px] text-slate-500">{m.matchMethod}</p>
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-700">
                              {m.maskedFeedUrl ?? 'No live URL'}
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-600 tabular-nums">
                              {m.plannedWorkoutsCount} planned saved
                              {m.lastFeedVerifiedAt && (
                                <p className="font-mono text-slate-400">
                                  {m.lastFeedVerifiedAt.slice(0, 16).replace('T', ' ')}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <div className="inline-flex gap-1.5">
                                {m.hasFeedUrl && (
                                  <button
                                    type="button"
                                    onClick={() => void handleSyncFsWorkouts(m.athleteId, 'incremental')}
                                    disabled={Boolean(fsBusyAction)}
                                    className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Sync
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleUnlinkFsAthlete(m.athleteId)}
                                  disabled={Boolean(fsBusyAction)}
                                  className="rounded border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                >
                                  Unlink
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Historical Export Import (.ics / CSV) */}
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-navy-900">
                        Historical Final Surge Export Import (.ics File or Official Coach CSV)
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Backfills historical planned workouts outside the rolling Calendar Sync horizon. Manual coach entries (<code className="font-mono">coach_entry</code>) are never overwritten.
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setFsExportFormat('ics')}
                        className={`rounded-md px-2.5 py-1 ${
                          fsExportFormat === 'ics' ? 'bg-navy-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        .ICS Calendar
                      </button>
                      <button
                        type="button"
                        onClick={() => setFsExportFormat('csv')}
                        className={`rounded-md px-2.5 py-1 ${
                          fsExportFormat === 'csv' ? 'bg-navy-900 text-white' : 'text-slate-600'
                        }`}
                      >
                        Planned CSV
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={fsExportContent}
                    onChange={(e) => setFsExportContent(e.target.value)}
                    rows={4}
                    aria-label="Final Surge historical export content"
                    placeholder={
                      fsExportFormat === 'ics'
                        ? 'Paste exported Final Surge .ics contents (BEGIN:VCALENDAR ... END:VCALENDAR)'
                        : 'Date,Title,Type,DistanceMiles,DurationMinutes,TargetPace,TargetZone,Description'
                    }
                    className="mt-3 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-navy-900"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleImportFsExport}
                      disabled={
                        Boolean(fsBusyAction) || !fsSelectedAthleteId || !fsExportContent.trim()
                      }
                      className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                    >
                      {fsBusyAction === 'import'
                        ? 'Importing Export...'
                        : `Import ${fsExportFormat.toUpperCase()} Into Supabase`}
                    </button>
                  </div>
                </div>

                {/* Final Surge Persisted Sync Logs */}
                {fsStatus && fsStatus.syncLogs.length > 0 && (
                  <div className="rounded-lg border border-slate-200 p-4">
                    <h4 className="text-xs font-bold text-navy-900">
                      Recent Final Surge Synchronization History
                    </h4>
                    <div className="mt-2 divide-y divide-slate-100 text-[11px] tabular-nums">
                      {fsStatus.syncLogs.slice(0, 6).map((log) => (
                        <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                          <span className="font-mono text-slate-600">
                            {log.startedAt.slice(0, 19).replace('T', ' ')} · {log.jobType} (Attempt #{log.attemptNumber})
                          </span>
                          <span className="text-slate-600">
                            {log.recordsProcessed} saved · {log.duplicatesSkipped} skipped
                            {log.errorMessage ? ` · ${log.errorMessage}` : ''}
                          </span>
                          <span
                            className={`font-semibold ${
                              log.status.startsWith('Succeeded')
                                ? 'text-emerald-700'
                                : log.status.startsWith('Partial')
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {log.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Optional Source Toggle: Intervals.icu Personal API-Key Auth */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Intervals.icu Read-Only Connector (Personal API Key · OAuth Optional)
                  </h3>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      serverStatus?.hasApiKey || serverStatus?.connected
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {serverStatus?.hasApiKey || serverStatus?.connected
                      ? 'Server API Key Detected · Read-Only'
                      : 'Optional · Demo Mode Active'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  Uses only server-side <code className="font-mono">INTERVALS_ICU_API_KEY</code>. <code className="font-mono">INTERVALS_ICU_CLIENT_ID</code>, <code className="font-mono">CLIENT_SECRET</code>, and <code className="font-mono">REDIRECT_URI</code> are optional and never block connecting.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOptionalIntervals((v) => !v)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50"
              >
                {showOptionalIntervals ? 'Hide Intervals.icu Panel' : 'Open Intervals.icu Verification'}
              </button>
            </div>
          </div>

          {showOptionalIntervals && (
            <>
          {/* Pilot Athlete Verification Test (Personal API Key · 6-Step Read-Only Gate) */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Personal API-Key Verification & Pilot Athlete Gate (Read-Only)
                  </h3>
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      effectivePilotSucceeded
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {effectivePilotSucceeded
                      ? 'Pilot Athlete Verified · Read-Only'
                      : 'Demo Mode Retained Until Verified'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Authenticates with server-side <code className="font-mono">INTERVALS_ICU_API_KEY</code> only (no OAuth env vars and no individual athlete API keys required). Never assumes access to untested athletes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={pilotAthleteIdInput}
                  onChange={(e) => setPilotAthleteIdInput(e.target.value)}
                  placeholder="Pilot Athlete ID (auto-picks if blank)"
                  aria-label="Optional Intervals.icu Pilot Athlete ID"
                  className="w-56 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-navy-900 placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={handleRunPilotTest}
                  disabled={pilotTesting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-800 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${pilotTesting ? 'animate-spin' : ''}`} />
                  <span>{pilotTesting ? 'Testing Personal API Key...' : 'Test Personal API Key (Read-Only)'}</span>
                </button>
                {appMode === 'production' && effectivePilotSucceeded && (
                  <>
                    <button
                      type="button"
                      onClick={handleRunPilotSync}
                      disabled={pilotSyncing || rosterSyncing}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 whitespace-nowrap hover:bg-emerald-100 disabled:opacity-60"
                    >
                      <Database className="h-3.5 w-3.5" />
                      <span>{pilotSyncing ? 'Syncing Pilot...' : 'Sync Pilot Athlete Now'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRunFullRosterSync('auto')}
                      disabled={rosterSyncing || pilotSyncing}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-emerald-800 disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${rosterSyncing ? 'animate-spin' : ''}`} />
                      <span>{rosterSyncing ? 'Syncing Full Roster...' : 'Sync Full Roster'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {pilotSyncResult && (
              <div
                className={`mt-4 rounded-lg border px-4 py-3 text-xs ${
                  pilotSyncResult.status === 'Succeeded'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : pilotSyncResult.status === 'Partial'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-rose-200 bg-rose-50 text-rose-900'
                }`}
              >
                <p className="font-semibold">
                  Pilot Ingestion {pilotSyncResult.status} ({pilotSyncResult.athleteName ?? pilotSyncResult.pilotAthleteId ?? 'Pilot'}):{' '}
                  {pilotSyncResult.activitiesProcessed} activities saved, {pilotSyncResult.duplicatesSkipped} unchanged,{' '}
                  {pilotSyncResult.streamsImported} HR streams imported, {pilotSyncResult.wellnessProcessed} wellness records persisted.
                </p>
                {pilotSyncResult.errorMessage && (
                  <p className="mt-1 font-mono text-[11px]">{pilotSyncResult.errorMessage}</p>
                )}
              </div>
            )}

            {rosterSyncResult && (
              <div
                className={`mt-4 space-y-3 rounded-lg border px-4 py-3 text-xs ${
                  rosterSyncResult.status === 'Succeeded'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : rosterSyncResult.status === 'Partial'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-rose-200 bg-rose-50 text-rose-900'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    Full Roster Sync {rosterSyncResult.status}: {rosterSyncResult.athletesSucceededCount} succeeded
                    {rosterSyncResult.athletesPartialCount > 0
                      ? `, ${rosterSyncResult.athletesPartialCount} partial`
                      : ''}
                    {rosterSyncResult.permissionDeniedCount > 0
                      ? `, ${rosterSyncResult.permissionDeniedCount} permission denied`
                      : ''}
                    {rosterSyncResult.athletesFailedCount > 0
                      ? `, ${rosterSyncResult.athletesFailedCount} failed`
                      : ''}{' '}
                    ({rosterSyncResult.athletesAttempted}/{rosterSyncResult.totalAthletesInRoster} shared athletes)
                  </p>
                  <span className="font-mono text-[11px]">
                    {rosterSyncResult.totalActivitiesProcessed} saved / {rosterSyncResult.totalDuplicatesSkipped}{' '}
                    unchanged · {rosterSyncResult.totalStreamsImported} HR streams ·{' '}
                    {rosterSyncResult.totalWellnessProcessed} wellness ·{' '}
                    {rosterSyncResult.dailyLoadPointsWritten} load pts
                  </span>
                </div>
                {rosterSyncResult.errorMessage && (
                  <p className="font-mono text-[11px]">{rosterSyncResult.errorMessage}</p>
                )}
                {rosterSyncResult.athleteResults.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white text-slate-800">
                    <table className="w-full text-left text-[11px] tabular-nums">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-2.5 py-1.5 font-semibold">Athlete</th>
                          <th className="px-2.5 py-1.5 font-semibold">Status</th>
                          <th className="px-2.5 py-1.5 font-semibold">Mode</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">Saved / Dup</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">HR Streams</th>
                          <th className="px-2.5 py-1.5 text-right font-semibold">Wellness</th>
                          <th className="px-2.5 py-1.5 font-semibold">Detail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rosterSyncResult.athleteResults.map((ar) => (
                          <tr key={ar.externalAthleteId}>
                            <td className="px-2.5 py-1.5 font-semibold text-navy-900 whitespace-nowrap">
                              {ar.athleteName ?? ar.externalAthleteId}{' '}
                              <span className="font-mono text-[10px] font-normal text-slate-500">
                                ({ar.externalAthleteId})
                              </span>
                              {ar.isPilotAthlete && (
                                <span className="ml-1 font-mono text-[10px] text-sky-700">
                                  [Pilot]
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-1.5 font-mono font-semibold whitespace-nowrap">
                              <span
                                className={
                                  ar.status === 'Succeeded'
                                    ? 'text-emerald-700'
                                    : ar.status === 'Partial'
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                                }
                              >
                                {ar.status}
                              </span>
                            </td>
                            <td className="px-2.5 py-1.5 font-mono text-slate-600">
                              {ar.syncMode}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {ar.activitiesProcessed} / {ar.duplicatesSkipped}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {ar.streamsImported}
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono">
                              {ar.wellnessProcessed}
                            </td>
                            <td className="px-2.5 py-1.5 text-slate-600">
                              {ar.errorMessage ?? ar.authorizationStatus}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {pilotResult ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
                  <span>
                    <strong className="text-navy-900">Status:</strong> {pilotResult.modeLabel}
                  </span>
                  <span className="font-mono text-slate-600">
                    Auth: {pilotResult.authMechanism} · OAuth Required: No · Read-Only: Yes
                  </span>
                </div>

                {pilotResult.coachAccountInfo && (
                  <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs sm:grid-cols-4">
                    <div>
                      <p className="text-[11px] text-slate-500">Coach Account Name</p>
                      <p className="mt-0.5 font-semibold text-navy-900">
                        {pilotResult.coachAccountInfo.name}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Coach ID</p>
                      <p className="mt-0.5 font-mono font-semibold text-navy-900">
                        {pilotResult.coachAccountInfo.id}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Email</p>
                      <p className="mt-0.5 truncate font-mono text-navy-900">
                        {pilotResult.coachAccountInfo.email ?? 'Not exposed by API'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500">Timezone</p>
                      <p className="mt-0.5 font-mono text-navy-900">
                        {pilotResult.coachAccountInfo.timezone ?? 'Not exposed'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                  {pilotResult.steps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-slate-200 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-navy-900">{step.label}</span>
                        <span
                          className={`font-mono text-[11px] font-bold ${
                            step.status === 'Passed'
                              ? 'text-emerald-700'
                              : step.status === 'Failed'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {step.status}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">{step.endpoint}</p>
                      <p className="mt-1 text-slate-600">{step.detail}</p>
                    </div>
                  ))}
                </div>

                {/* Exact Available Data Permissions Matrix */}
                {pilotResult.dataPermissions.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Data Permission Scope</th>
                          <th className="px-3 py-2 font-semibold">Verified Access State</th>
                          <th className="px-3 py-2 font-semibold">Observed Evidence</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pilotResult.dataPermissions.map((perm) => (
                          <tr key={perm.permissionKey}>
                            <td className="px-3 py-2 font-semibold text-navy-900">{perm.label}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`font-mono text-[11px] font-bold ${
                                  perm.accessState === 'Verified Read-Only'
                                    ? 'text-emerald-700'
                                    : perm.accessState === 'Denied / Unavailable'
                                    ? 'text-rose-700'
                                    : 'text-amber-700'
                                }`}
                              >
                                {perm.accessState}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">{perm.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {pilotResult.selectedPilotAthlete && (
                  <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Completed Runs (Pilot)</p>
                      <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                        {pilotResult.pilotMetricsSummary.runningActivityCount} /{' '}
                        {pilotResult.pilotMetricsSummary.totalCompletedActivityCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Retrieved LTHR / Avg HR</p>
                      <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                        {pilotResult.pilotMetricsSummary.detectedLthrBpm ?? '--'} /{' '}
                        {pilotResult.pilotMetricsSummary.latestAvgHrBpm ?? '--'} bpm
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Latest Native Load</p>
                      <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                        {pilotResult.pilotMetricsSummary.latestIcuTrainingLoad ?? '--'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className="text-[11px] text-slate-500">Intervals.icu CTL / ATL</p>
                      <p className="mt-1 font-mono text-sm font-bold text-navy-900 tabular-nums">
                        {pilotResult.pilotMetricsSummary.latestIcuCtl ?? '--'} /{' '}
                        {pilotResult.pilotMetricsSummary.latestIcuAtl ?? '--'}
                      </p>
                    </div>
                  </div>
                )}

                {pilotResult.coachedAthletes.length > 0 && (
                  <div className="space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                    <p className="font-semibold text-navy-900">
                      Shared Roster Verification Status (Click any athlete ID to test individually — access is never assumed for untested athletes):
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {pilotResult.coachedAthletes.slice(0, 12).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setPilotAthleteIdInput(a.id)}
                          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] hover:bg-slate-100 ${
                            a.verificationStatus === 'Verified Read-Only'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : a.verificationStatus === 'Permission Denied'
                              ? 'border-rose-200 bg-rose-50 text-rose-800'
                              : 'border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          <span>
                            {a.name} ({a.id})
                          </span>
                          <span className="font-sans text-[10px] font-semibold">
                            · {a.verificationStatus}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : serverStatus?.pilotTestSucceeded && serverStatus.verifiedPilotAthleteId ? (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
                  <span>
                    <strong className="font-semibold">Persisted Verification Active:</strong>{' '}
                    Full Roster Sync Gate Unlocked (survives server restarts until a test fails, coach account changes, or session is disconnected).
                  </span>
                  <span className="font-mono text-emerald-800">
                    Auth: {serverStatus.authMechanism ?? serverStatus.authMethod} · Read-Only: Yes
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-[11px] text-slate-500">Verified Pilot Athlete ID</p>
                    <p className="mt-0.5 font-mono font-semibold text-navy-900">
                      {serverStatus.verifiedPilotAthleteId}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-[11px] text-slate-500">Intervals.icu Coach Account</p>
                    <p className="mt-0.5 font-semibold text-navy-900">
                      {serverStatus.coachAccountIdentity ?? 'Verified Coach'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <p className="text-[11px] text-slate-500">Last Verified At</p>
                    <p className="mt-0.5 font-mono text-navy-900 tabular-nums">
                      {serverStatus.lastPilotCheckAt
                        ? serverStatus.lastPilotCheckAt.slice(0, 19).replace('T', ' ')
                        : 'Persisted'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {serverStatus?.lastPilotCheckAt && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                    Previous pilot verification is inactive or invalidated (last check:{' '}
                    <span className="font-mono">
                      {serverStatus.lastPilotCheckAt.slice(0, 19).replace('T', ' ')}
                    </span>
                    ). Re-run the 6-step pilot test with a shared/coached athlete to unlock full roster sync.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    1. Verify Coach Auth via <code className="font-mono">INTERVALS_ICU_API_KEY</code> (<code className="font-mono">/athlete/0</code>)
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    2. Retrieve Shared Roster (<code className="font-mono">/athlete-summary.json</code>)
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    3. Verify One Pilot Athlete (Untested athletes stay in Demo Mode)
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    4. Retrieve Pilot Completed Activities (Read-Only)
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    5. Verify Available Heart-Rate & LTHR / Zone Data
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                    6. Report Exact Data Permissions Available
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dedicated Full Roster Sync Workspace (Milestone 3.5) */}
          {appMode === 'production' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-bold text-navy-900">
                      Full Roster Sync Workspace — Intervals.icu Shared Athletes
                    </h3>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-navy-900">
                      Explicit Coach Mapping Required · Bounded Concurrency
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Retrieves all coached athletes shared with your Intervals.icu coach account (coach own ID excluded), lets you explicitly link or create athletes without risky name-only auto-merges, and synchronizes eligible athletes on demand.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadRosterOverview(false)}
                    disabled={!accessToken || loadingRosterOverview || probingRosterPermissions}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loadingRosterOverview ? 'animate-spin' : ''}`}
                    />
                    <span>{loadingRosterOverview ? 'Refreshing...' : 'Refresh Roster'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadRosterOverview(true)}
                    disabled={
                      !accessToken ||
                      !effectivePilotSucceeded ||
                      probingRosterPermissions ||
                      loadingRosterOverview
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <ShieldCheck
                      className={`h-3.5 w-3.5 ${probingRosterPermissions ? 'animate-pulse' : ''}`}
                    />
                    <span>
                      {probingRosterPermissions ? 'Probing Scopes...' : 'Probe Permissions'}
                    </span>
                  </button>
                  <select
                    value={rosterSyncMode}
                    onChange={(e) =>
                      setRosterSyncMode(e.target.value as 'auto' | 'initial' | 'incremental')
                    }
                    aria-label="Roster synchronization mode"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900"
                  >
                    <option value="auto">Mode: Auto (Initial / Incremental)</option>
                    <option value="incremental">Mode: Incremental (Overlap)</option>
                    <option value="initial">Mode: Initial Full Backfill</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      void handleRunFullRosterSync(rosterSyncMode, {
                        athleteIds: Array.from(selectedRosterIds),
                      })
                    }
                    disabled={
                      rosterSyncing ||
                      pilotSyncing ||
                      !effectivePilotSucceeded ||
                      selectedRosterIds.size === 0
                    }
                    className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                  >
                    Sync Selected ({selectedRosterIds.size})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleRunFullRosterSync(rosterSyncMode, {
                        athleteIds: (rosterOverview?.athletes ?? [])
                          .filter((a) => a.eligibleForSync)
                          .map((a) => a.externalAthleteId),
                      })
                    }
                    disabled={
                      rosterSyncing ||
                      pilotSyncing ||
                      !effectivePilotSucceeded ||
                      (rosterOverview?.summary.eligibleAthletes ?? 0) === 0
                    }
                    className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                  >
                    Sync All Eligible ({rosterOverview?.summary.eligibleAthletes ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleRunFullRosterSync('auto', { retryFailedOnly: true })
                    }
                    disabled={
                      rosterSyncing ||
                      pilotSyncing ||
                      !effectivePilotSucceeded ||
                      ((rosterOverview?.summary.failedCount ?? 0) === 0 &&
                        (rosterOverview?.summary.partialCount ?? 0) === 0)
                    }
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Retry Failed Athletes
                  </button>
                </div>
              </div>

              {!accessToken ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  Sign in as the owner coach to inspect the shared Intervals.icu roster and manage explicit athlete mappings.
                </div>
              ) : !effectivePilotSucceeded ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  Full Roster Sync Workspace is locked until Milestone 3.1 pilot verification passes above.
                </div>
              ) : (
                <div className="mt-4 space-y-4">
                  {rosterActionNotice && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
                      {rosterActionNotice}
                    </div>
                  )}

                  {rosterOverview?.liveProgress?.running && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
                      <strong className="font-semibold">Synchronizing in Progress:</strong>{' '}
                      {rosterOverview.liveProgress.completedCount}/
                      {rosterOverview.liveProgress.totalSelected} completed · Active:{' '}
                      {rosterOverview.liveProgress.activeAthleteIds.join(', ') || 'initializing'}
                    </div>
                  )}

                  {rosterOverview && !rosterOverview.ok && rosterOverview.errorMessage && (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-900">
                      {rosterOverview.errorMessage}
                    </div>
                  )}

                  {/* Summary Strip */}
                  {rosterOverview && (
                    <div className="grid grid-cols-2 gap-2.5 text-xs sm:grid-cols-4 lg:grid-cols-8 tabular-nums">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Shared Roster</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-navy-900">
                          {rosterOverview.summary.totalSharedAthletes}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Mapped</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-emerald-700">
                          {rosterOverview.summary.mappedAthletes}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Not Mapped</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-slate-700">
                          {rosterOverview.summary.unmappedAthletes}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Awaiting Review</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-amber-700">
                          {rosterOverview.summary.awaitingReviewCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Succeeded</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-emerald-700">
                          {rosterOverview.summary.succeededCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Partial</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-amber-700">
                          {rosterOverview.summary.partialCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Failed</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-rose-700">
                          {rosterOverview.summary.failedCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                        <p className="text-[10px] text-slate-500">Permission Unavail.</p>
                        <p className="mt-0.5 font-mono text-sm font-bold text-rose-700">
                          {rosterOverview.summary.permissionUnavailableCount}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Search & Filter Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={rosterSearchQuery}
                        onChange={(e) => setRosterSearchQuery(e.target.value)}
                        placeholder="Search athlete name, email, or Intervals ID..."
                        aria-label="Filter shared roster athletes"
                        className="w-64 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-navy-900 placeholder:text-slate-400"
                      />
                      <select
                        value={rosterStatusFilter}
                        onChange={(e) => setRosterStatusFilter(e.target.value)}
                        aria-label="Filter by roster sync status"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-900"
                      >
                        <option value="all">All Statuses</option>
                        <option value="eligible">Eligible to Sync</option>
                        <option value="needs_mapping">Needs Mapping / Review</option>
                        <option value="Succeeded">Succeeded</option>
                        <option value="failed_partial">Failed / Partial</option>
                        <option value="Permission unavailable">Permission unavailable</option>
                      </select>
                    </div>
                    {rosterOverview?.lastFullRosterSyncAt && (
                      <span className="font-mono text-[11px] text-slate-500">
                        Last Full Sync:{' '}
                        {rosterOverview.lastFullRosterSyncAt.slice(0, 19).replace('T', ' ')} UTC ·
                        Pages: {rosterOverview.pagesFetched}
                      </span>
                    )}
                  </div>

                  {/* 11-Column Roster Table */}
                  {rosterOverview && rosterOverview.athletes.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-[11px] tabular-nums">
                        <thead className="border-b border-slate-200 bg-navy-900 text-slate-200">
                          <tr>
                            <th className="px-2.5 py-2.5 font-semibold">Select / Athlete</th>
                            <th className="px-2.5 py-2.5 font-semibold">Intervals ID</th>
                            <th className="px-2.5 py-2.5 font-semibold">Mapping Status</th>
                            <th className="px-2.5 py-2.5 font-semibold">Sharing / Permission</th>
                            <th className="px-2.5 py-2.5 font-semibold">Last Success</th>
                            <th className="px-2.5 py-2.5 font-semibold">Last Attempt</th>
                            <th className="px-2.5 py-2.5 text-right font-semibold">Activities</th>
                            <th className="px-2.5 py-2.5 text-right font-semibold">HR Streams</th>
                            <th className="px-2.5 py-2.5 text-right font-semibold">Wellness</th>
                            <th className="px-2.5 py-2.5 font-semibold">Sync Status</th>
                            <th className="px-2.5 py-2.5 font-semibold">Error &amp; Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRosterRows.map((row: IntervalsRosterAthleteRowDto) => {
                            const isMapOpen = expandedMappingExtId === row.externalAthleteId;
                            const isHistOpen = expandedHistoryExtId === row.externalAthleteId;
                            const defaultTargetId =
                              mappingSelectionByExtId[row.externalAthleteId] ??
                              row.candidateMatches[0]?.athleteId ??
                              rosterOverview.existingAthletes.find(
                                (ea) => !ea.alreadyMappedToExternalId
                              )?.id ??
                              '';
                            return (
                              <React.Fragment key={row.externalAthleteId}>
                                <tr className="hover:bg-slate-50">
                                  <td className="px-2.5 py-2 whitespace-nowrap">
                                    <label className="inline-flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={selectedRosterIds.has(row.externalAthleteId)}
                                        onChange={() =>
                                          toggleRosterRowSelection(row.externalAthleteId)
                                        }
                                        disabled={!row.eligibleForSync}
                                        className="rounded border-slate-300"
                                      />
                                      <div>
                                        <p className="font-semibold text-navy-900">
                                          {row.athleteName}
                                          {row.isPilotAthlete && (
                                            <span className="ml-1 font-mono text-[10px] text-sky-700">
                                              [Pilot]
                                            </span>
                                          )}
                                        </p>
                                        {(row.email || row.location) && (
                                          <p className="text-[10px] text-slate-500">
                                            {row.email ?? row.location}
                                          </p>
                                        )}
                                      </div>
                                    </label>
                                  </td>
                                  <td className="px-2.5 py-2 font-mono text-slate-700 whitespace-nowrap">
                                    {row.externalAthleteId}
                                  </td>
                                  <td className="px-2.5 py-2 whitespace-nowrap">
                                    <p
                                      className={`font-semibold ${
                                        row.mappingStatus === 'Verified Match'
                                          ? 'text-emerald-700'
                                          : row.mappingStatus === 'Candidate Review Required'
                                          ? 'text-amber-700'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {row.mappingStatus}
                                    </p>
                                    <p className="text-[10px] text-slate-500">{row.matchMethod}</p>
                                  </td>
                                  <td className="px-2.5 py-2 whitespace-nowrap">
                                    <span
                                      className={`font-semibold ${
                                        row.sharingPermissionStatus === 'Authorized (Read-Only)'
                                          ? 'text-emerald-700'
                                          : row.sharingPermissionStatus === 'Partial Permissions'
                                          ? 'text-amber-700'
                                          : row.sharingPermissionStatus === 'Permission unavailable'
                                          ? 'text-rose-700'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {row.sharingPermissionStatus}
                                    </span>
                                    {row.permissionCapabilities && (
                                      <p className="mt-0.5 font-mono text-[9px] text-slate-500">
                                        S:{row.permissionCapabilities.settings === 'granted' ? '✓' : row.permissionCapabilities.settings === 'denied' ? '✕' : '?'} ·{' '}
                                        A:{row.permissionCapabilities.activities === 'granted' ? '✓' : row.permissionCapabilities.activities === 'denied' ? '✕' : '?'} ·{' '}
                                        W:{row.permissionCapabilities.wellness === 'granted' ? '✓' : row.permissionCapabilities.wellness === 'denied' ? '✕' : '?'}
                                      </p>
                                    )}
                                  </td>
                                  <td className="px-2.5 py-2 font-mono text-slate-600 whitespace-nowrap">
                                    {row.lastSuccessfulSyncAt
                                      ? row.lastSuccessfulSyncAt.slice(0, 16).replace('T', ' ')
                                      : '--'}
                                  </td>
                                  <td className="px-2.5 py-2 font-mono text-slate-600 whitespace-nowrap">
                                    {row.lastAttemptedSyncAt
                                      ? row.lastAttemptedSyncAt.slice(0, 16).replace('T', ' ')
                                      : '--'}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono font-semibold text-navy-900">
                                    {row.activitiesImportedCount}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono text-slate-700">
                                    {row.hrStreamsImportedCount}
                                  </td>
                                  <td className="px-2.5 py-2 text-right font-mono text-slate-700">
                                    {row.wellnessRecordsImportedCount}
                                  </td>
                                  <td className="px-2.5 py-2 whitespace-nowrap">
                                    <span
                                      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${rosterStatusBadgeCls(
                                        row.currentSyncStatus
                                      )}`}
                                    >
                                      {row.currentSyncStatus}
                                    </span>
                                  </td>
                                  <td className="px-2.5 py-2">
                                    {row.mostRecentError && (
                                      <p
                                        className="mb-1 max-w-xs truncate text-[10px] text-rose-700"
                                        title={row.mostRecentError}
                                      >
                                        {row.mostRecentError}
                                      </p>
                                    )}
                                    <div className="flex flex-wrap gap-1 whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedMappingExtId(
                                            isMapOpen ? null : row.externalAthleteId
                                          )
                                        }
                                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-navy-900 hover:bg-slate-100"
                                      >
                                        {row.mappingStatus === 'Verified Match'
                                          ? 'Manage Map'
                                          : 'Map / Review'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          !row.eligibleForSync ||
                                          rosterSyncing ||
                                          rosterBusyExtId === row.externalAthleteId
                                        }
                                        onClick={() =>
                                          void handleRunFullRosterSync(rosterSyncMode, {
                                            athleteIds: [row.externalAthleteId],
                                          })
                                        }
                                        className="rounded bg-navy-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-navy-800 disabled:opacity-40"
                                      >
                                        Sync
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedHistoryExtId(
                                            isHistOpen ? null : row.externalAthleteId
                                          )
                                        }
                                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                                      >
                                        History ({row.syncHistory.length})
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {/* Explicit Mapping & Candidate Review Drawer */}
                                {isMapOpen && (
                                  <tr className="bg-slate-50/90">
                                    <td colSpan={11} className="px-4 py-3">
                                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="space-y-1">
                                          <p className="font-semibold text-navy-900">
                                            Athlete Identity Mapping — {row.athleteName} (
                                            {row.externalAthleteId})
                                          </p>
                                          {row.candidateMatches.length > 0 && (
                                            <div className="space-y-1 text-[11px] text-amber-800">
                                              {row.candidateMatches.map((cm) => (
                                                <div
                                                  key={cm.athleteId}
                                                  className="flex flex-wrap items-center gap-2"
                                                >
                                                  <span>
                                                    Candidate: <strong>{cm.fullName}</strong> (
                                                    {cm.email ?? 'no email'}) — {cm.reason}
                                                  </span>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      rosterBusyExtId === row.externalAthleteId
                                                    }
                                                    onClick={() =>
                                                      void handleResolveRosterMapping({
                                                        action: 'confirm_candidate',
                                                        externalAthleteId: row.externalAthleteId,
                                                        athleteId: cm.athleteId,
                                                      })
                                                    }
                                                    className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-800"
                                                  >
                                                    Confirm Candidate
                                                  </button>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                          <select
                                            value={defaultTargetId}
                                            onChange={(e) =>
                                              setMappingSelectionByExtId((prev) => ({
                                                ...prev,
                                                [row.externalAthleteId]: e.target.value,
                                              }))
                                            }
                                            aria-label={`Select existing athlete for ${row.athleteName}`}
                                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-navy-900"
                                          >
                                            <option value="">Select existing athlete...</option>
                                            {rosterOverview.existingAthletes.map((ea) => (
                                              <option
                                                key={ea.id}
                                                value={ea.id}
                                                disabled={
                                                  Boolean(ea.alreadyMappedToExternalId) &&
                                                  ea.alreadyMappedToExternalId !==
                                                    row.externalAthleteId
                                                }
                                              >
                                                {ea.fullName}
                                                {ea.email ? ` (${ea.email})` : ''}
                                                {ea.alreadyMappedToExternalId
                                                  ? ` [Linked: ${ea.alreadyMappedToExternalId}]`
                                                  : ''}
                                              </option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            disabled={
                                              !defaultTargetId ||
                                              rosterBusyExtId === row.externalAthleteId
                                            }
                                            onClick={() =>
                                              void handleResolveRosterMapping({
                                                action: 'link_existing',
                                                externalAthleteId: row.externalAthleteId,
                                                athleteId: defaultTargetId,
                                              })
                                            }
                                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-navy-900 hover:bg-slate-100 disabled:opacity-50"
                                          >
                                            Link to Existing
                                          </button>
                                          <button
                                            type="button"
                                            disabled={
                                              Boolean(row.internalAthleteId) ||
                                              rosterBusyExtId === row.externalAthleteId
                                            }
                                            onClick={() =>
                                              void handleResolveRosterMapping({
                                                action: 'create_and_link',
                                                externalAthleteId: row.externalAthleteId,
                                              })
                                            }
                                            className="rounded bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                                          >
                                            Create New Athlete &amp; Link
                                          </button>
                                          <button
                                            type="button"
                                            disabled={rosterBusyExtId === row.externalAthleteId}
                                            onClick={() =>
                                              void handleResolveRosterMapping({
                                                action: 'leave_unmapped',
                                                externalAthleteId: row.externalAthleteId,
                                              })
                                            }
                                            className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                                          >
                                            Leave Unmapped Until Later
                                          </button>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}

                                {/* Per-Athlete Sync History Drawer */}
                                {isHistOpen && (
                                  <tr className="bg-slate-50/70">
                                    <td colSpan={11} className="px-4 py-3">
                                      <p className="font-semibold text-navy-900">
                                        Per-Athlete Sync History — {row.athleteName} (
                                        {row.externalAthleteId})
                                      </p>
                                      {row.syncHistory.length === 0 ? (
                                        <p className="mt-1 text-[11px] text-slate-500">
                                          No athlete-level sync attempts recorded yet.
                                        </p>
                                      ) : (
                                        <div className="mt-2 space-y-1 font-mono text-[11px]">
                                          {row.syncHistory.map((h) => (
                                            <div
                                              key={h.id}
                                              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-1"
                                            >
                                              <span className="text-slate-600">
                                                {h.occurredAt.slice(0, 19).replace('T', ' ')} ·{' '}
                                                {h.status} ({h.syncMode})
                                              </span>
                                              <span className="text-slate-700">
                                                {h.activitiesProcessed} saved /{' '}
                                                {h.duplicatesSkipped} dup · {h.streamsImported} HR
                                                streams · {h.wellnessProcessed} well
                                                {h.windowStart && h.windowEnd
                                                  ? ` · ${h.windowStart}→${h.windowEnd}`
                                                  : ''}
                                              </span>
                                              {h.errorMessage && (
                                                <span className="text-rose-700">
                                                  {h.errorMessage}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="py-4 text-center text-xs text-slate-500">
                      Click <strong>Refresh Roster</strong> to load all athletes shared with your
                      Intervals.icu coach account.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Roster-Wide Deep Telemetry Validation & Data Quality Dashboard */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Roster-Wide Data Quality Dashboard & Load Engine Import Readiness (12+ Weeks · Read-Only)
                  </h3>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-navy-900">
                    GET Requests Only · Zero Mutations
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Validates profile & sportSettings, LTHR, HR zones, 90-day running history, Avg/Max HR, HR streams, native training load, and wellness (CTL/ATL/HRV/Sleep) for every coached athlete without inventing missing metrics.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunFullRosterValidation}
                disabled={validatingRoster}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 py-2 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-800 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${validatingRoster ? 'animate-spin' : ''}`} />
                <span>
                  {validatingRoster
                    ? 'Validating All Coached Athletes...'
                    : 'Run Full-Roster Deep Telemetry Validation'}
                </span>
              </button>
            </div>

            {rosterValidation ? (
              <div className="mt-4 space-y-5">
                {rosterValidation.errors.length > 0 && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
                    {rosterValidation.errors.join(' ')}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">Coached Athletes Checked</p>
                    <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Window: {rosterValidation.windowStartDate} → {rosterValidation.windowEndDate}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">Full Telemetry Ready</p>
                    <p className="mt-1 font-mono text-base font-bold text-emerald-700 tabular-nums">
                      {rosterValidation.summary.fullTelemetryReadyCount}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Partial: {rosterValidation.summary.partialTelemetryCount} · Limited:{' '}
                      {rosterValidation.summary.limitedTelemetryCount}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">Historical Running Runs</p>
                    <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                      {rosterValidation.summary.totalRunningActivities}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Load Available: {rosterValidation.summary.trainingLoadAvailableCount}/
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">LTHR & HR Zones</p>
                    <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                      {rosterValidation.summary.lthrAvailableCount}/
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                    <p className="text-[11px] text-slate-500">From Intervals sportSettings</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">HR Streams Verified</p>
                    <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                      {rosterValidation.summary.hrStreamsAvailableCount}/
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                    <p className="text-[11px] text-slate-500">Time-series heartrate</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-[11px] text-slate-500">hrRSS Engine Ready</p>
                    <p className="mt-1 font-mono text-base font-bold text-sky-700 tabular-nums">
                      {rosterValidation.summary.hrDerivedEngineReadyCount}/
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Wellness: {rosterValidation.summary.wellnessAvailableCount}/
                      {rosterValidation.totalCoachedAthletes}
                    </p>
                  </div>
                </div>

                {/* Roster-Wide Data Quality Table */}
                {rosterValidation.athletes.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-navy-900 text-slate-200">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold">Athlete Name</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Running Runs</th>
                          <th className="px-3 py-2.5 font-semibold">Historical Coverage</th>
                          <th className="px-3 py-2.5 font-semibold">LTHR & Zones</th>
                          <th className="px-3 py-2.5 font-semibold">HR & Stream</th>
                          <th className="px-3 py-2.5 font-semibold">Training Load</th>
                          <th className="px-3 py-2.5 font-semibold">Wellness & CTL/ATL</th>
                          <th className="px-3 py-2.5 font-semibold">Last Sync</th>
                          <th className="px-3 py-2.5 font-semibold">Verification & Missing Fields</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {rosterValidation.athletes.map((a) => (
                          <tr key={a.athleteId} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <p className="font-semibold text-navy-900">
                                {a.athleteName}{' '}
                                {a.isPilotAthlete && (
                                  <span className="font-mono text-[10px] text-sky-700">
                                    [Pilot]
                                  </span>
                                )}
                              </p>
                              <p className="font-mono text-[11px] text-slate-500">{a.athleteId}</p>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">
                              <p className="font-semibold text-navy-900">
                                {a.runningActivitiesCount} runs
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {a.totalActivitiesCount} total
                              </p>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {a.earliestRunDate && a.latestRunDate ? (
                                <>
                                  <p className="font-mono text-[11px] text-navy-900">
                                    {a.earliestRunDate} → {a.latestRunDate}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {a.coverageWeeks} wks ({a.coverageDays}d)
                                  </p>
                                </>
                              ) : (
                                <span className="text-rose-700">Missing (0 runs)</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {a.lthrAvailable ? (
                                <>
                                  <p className="font-mono font-semibold text-emerald-700">
                                    {a.detectedLthrBpm} bpm ({a.hrZoneCount} zones)
                                  </p>
                                  <p className="text-[11px] text-slate-500">{a.lthrSource}</p>
                                </>
                              ) : (
                                <span className="font-semibold text-rose-700">Missing LTHR</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <p
                                className={`font-mono font-semibold ${
                                  a.runsWithAvgHrCount > 0 ? 'text-navy-900' : 'text-rose-700'
                                }`}
                              >
                                Avg HR: {a.runsWithAvgHrCount}/{a.runningActivitiesCount} (
                                {a.hrCoveragePct}%)
                              </p>
                              <p
                                className={`text-[11px] ${
                                  a.hrStreamAvailable ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                Stream:{' '}
                                {a.hrStreamAvailable
                                  ? `${a.hrStreamSampleCount} pts`
                                  : a.hrStreamStatus}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {a.trainingLoadAvailable ? (
                                <>
                                  <p className="font-mono font-semibold text-navy-900">
                                    Latest: {a.latestIcuTrainingLoad}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {a.runsWithLoadCount}/{a.runningActivitiesCount} runs
                                  </p>
                                </>
                              ) : (
                                <span className="font-semibold text-rose-700">Missing</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {a.wellnessAvailable ? (
                                <>
                                  <p className="font-mono text-navy-900">
                                    CTL {a.latestCtl ?? '--'} / ATL {a.latestAtl ?? '--'}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {a.wellnessRecordsCount}d · HRV{' '}
                                    {a.latestHrv ?? 'Missing'} · RHR{' '}
                                    {a.latestRestingHr ?? 'Missing'}
                                  </p>
                                </>
                              ) : (
                                <span className="font-semibold text-rose-700">Missing</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {a.lastSyncedAt.slice(0, 16).replace('T', ' ')}
                            </td>
                            <td className="px-3 py-2.5">
                              <p
                                className={`font-semibold ${
                                  a.dataQualityTier === 'Full Telemetry Ready'
                                    ? 'text-emerald-700'
                                    : a.dataQualityTier === 'Partial Telemetry (Usable)'
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {a.verificationStatus}
                              </p>
                              {a.missingFields.length > 0 ? (
                                <p className="mt-0.5 text-[11px] text-slate-500">
                                  Missing: {a.missingFields.join(', ')}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-[11px] text-emerald-700">
                                  All target telemetry fields present
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Prepared Database & Import Architecture for Independent Training Load Engine */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div>
                      <h4 className="text-xs font-bold text-navy-900">
                        Prepared Database & Import Staging Architecture ({importArchitecturePlan.tableCoverageCount} Normalized Tables)
                      </h4>
                      <p className="text-[11px] text-slate-600">
                        Ready for Independent Running Coach AI Training Load Engine · Synthetic Fallback: Disabled · Automated Athlete Emails: Disabled
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {importArchitecturePlan.pipelineStages.map((st) => (
                      <div key={st.stage} className="rounded border border-slate-200 bg-white p-3 text-xs">
                        <p className="font-semibold text-navy-900">{st.stage}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-sky-700">
                          Tables: {st.targetTables.join(', ')}
                        </p>
                        <p className="mt-1 text-slate-600">{st.guardrail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-500">
                Click <strong>Run Full-Roster Deep Telemetry Validation</strong> to audit all coached athletes across 90 days (profile, sportSettings, LTHR, HR zones, running activities, Avg/Max HR, HR streams, native load, and wellness) via read-only GET calls.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-center">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Server Auth Status, Optional OAuth 2.0 & Per-Athlete Scope Probe
                </h3>
                <p className="text-xs text-slate-500">
                  Personal API Key (<code className="font-mono">INTERVALS_ICU_API_KEY</code>) is sufficient for read-only access. OAuth variables (<code className="font-mono">CLIENT_ID</code>, <code className="font-mono">CLIENT_SECRET</code>, <code className="font-mono">REDIRECT_URI</code>) are strictly optional.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRunReadOnlyTest}
                  disabled={probing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-navy-900 whitespace-nowrap hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
                  <span>{probing ? 'Probing Roster Scopes...' : 'Probe Shared Roster (Read-Only)'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleStartOAuth}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>Connect Optional OAuth 2.0</span>
                </button>
                {(serverStatus?.connected || serverStatus?.pilotTestSucceeded || pilotTestSucceeded) && (
                  <button
                    type="button"
                    onClick={handleDisconnectOAuth}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 whitespace-nowrap hover:bg-rose-50"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    <span>Clear Session</span>
                  </button>
                )}
              </div>
            </div>

            {oauthNotice && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {oauthNotice}
              </div>
            )}

            {/* Diagnostics Grid */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Connection Status</p>
                <p
                  className={`mt-1 text-xs font-bold ${
                    probeResult?.connected || serverStatus?.connected || pilotResult?.connected
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {probeResult?.connected || serverStatus?.connected || pilotResult?.connected
                    ? 'Connected (Read-Only)'
                    : 'Disconnected'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Auth Mechanism</p>
                <p className="mt-1 font-mono text-xs font-semibold text-navy-900">
                  {pilotResult?.authMechanism ?? serverStatus?.authMechanism ?? serverStatus?.authMethod ?? 'unconfigured'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Coach Account</p>
                <p className="mt-1 truncate text-xs font-semibold text-navy-900">
                  {pilotResult?.coachAccountIdentity ?? probeResult?.coachAccountIdentity ?? serverStatus?.coachAccountIdentity ?? 'Not verified'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Full Roster Sync</p>
                <p
                  className={`mt-1 text-xs font-bold ${
                    effectivePilotSucceeded ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {effectivePilotSucceeded ? 'Unlocked (Pilot OK)' : 'Locked (Pilot Req.)'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Last Sync</p>
                <p className="mt-1 truncate font-mono text-xs text-slate-700 tabular-nums">
                  {probeResult?.lastSynchronizedAt?.slice(0, 16).replace('T', ' ') ??
                    serverStatus?.lastSynchronizedAt?.slice(0, 16).replace('T', ' ') ??
                    'None'}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] font-medium text-slate-500">Athlete Keys Req.</p>
                <p className="mt-1 font-mono text-xs font-semibold text-emerald-700">
                  No (Coach Auth Only)
                </p>
              </div>
            </div>

            {probeResult && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold text-navy-900">
                  Probe Result: <span className="font-normal text-slate-700">{probeResult.modeLabel}</span>
                </p>
                {probeResult.permissionIssues.map((issue, idx) => (
                  <p key={idx} className="text-xs text-amber-800">
                    • {issue}
                  </p>
                ))}
                {probeResult.syncErrors.map((err, idx) => (
                  <p key={idx} className="text-xs text-rose-700">
                    • {err}
                  </p>
                ))}
                {probeResult.athletePermissions.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Intervals Athlete</th>
                          <th className="px-3 py-2 font-semibold">API Auth State</th>
                          <th className="px-3 py-2 font-semibold">ACTIVITY:READ</th>
                          <th className="px-3 py-2 font-semibold">WELLNESS:READ</th>
                          <th className="px-3 py-2 font-semibold">CALENDAR:READ</th>
                          <th className="px-3 py-2 font-semibold">Diagnostic</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {probeResult.athletePermissions.map((p) => (
                          <tr key={p.athleteId}>
                            <td className="px-3 py-2 font-semibold text-navy-900">
                              {p.athleteName} ({p.athleteId})
                            </td>
                            <td className="px-3 py-2 font-semibold text-navy-900">
                              {p.authorizationState}
                            </td>
                            <td className="px-3 py-2">{p.activityRead ? 'Verified' : 'Denied'}</td>
                            <td className="px-3 py-2">{p.wellnessRead ? 'Verified' : 'Denied'}</td>
                            <td className="px-3 py-2">{p.calendarRead ? 'Verified' : 'Denied'}</td>
                            <td className="px-3 py-2 text-slate-600">{p.diagnosticMessage}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
          </>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {connectors.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-base font-bold text-navy-900">{c.name}</h3>
                    <p className="text-xs font-medium text-slate-500">{c.role}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      c.connected ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {c.connected ? 'Active' : 'Disconnected'}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-700">{c.description}</p>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <Database className="h-3.5 w-3.5" />
                    Runtime Mode
                  </p>
                  <p className="mt-1 text-xs font-semibold text-navy-900">{c.modeLabel}</p>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                    <KeyRound className="h-3.5 w-3.5" />
                    Server-Side Configuration Keys
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {c.requiredConfig.map((envKey) => (
                      <code
                        key={envKey}
                        className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700"
                      >
                        {envKey}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: UNIFIED ATHLETE IDENTITY & MANUAL MATCHING */}
      {subTab === 'identity' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Unified Athlete Identity & Provider Mapping ({athletes.length} Roster Athletes)
                </h3>
                <p className="text-xs text-slate-500">
                  Safety rule: athletes are never merged solely on similar names. Uncertain matches require manual coach confirmation.
                </p>
              </div>
              <div className="font-mono text-xs text-slate-600 tabular-nums">
                Pilot Candidates: {candidates.length} · Verified: {verifiedMappingCount} · Review Queue: {reviewRequiredCount}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-navy-900 text-slate-200">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Internal & Final Surge ID</th>
                    <th className="px-3 py-2.5 font-semibold">Athlete</th>
                    <th className="px-3 py-2.5 font-semibold">Intervals.icu ID</th>
                    <th className="px-3 py-2.5 font-semibold">Match Rule & Confidence</th>
                    <th className="px-3 py-2.5 font-semibold">API Auth Status</th>
                    <th className="px-3 py-2.5 font-semibold">Coach Manual Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {mappings.map((m) => (
                    <tr key={m.internalAthleteId} className="hover:bg-slate-50">
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        <p className="font-semibold text-navy-900">{m.internalAthleteId}</p>
                        <p className="text-[11px] text-slate-500">{m.finalSurgeId}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <p className="font-semibold text-navy-900">{m.athleteName}</p>
                        <p className="text-[11px] text-slate-500">{m.email}</p>
                      </td>
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        {m.intervalsIcuAthleteId ?? (
                          <span className="text-slate-400">
                            {m.candidateIntervalsProfile
                              ? `Candidate: ${m.candidateIntervalsProfile.intervalsAthleteId}`
                              : 'Unlinked'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p
                          className={`font-semibold ${
                            m.matchStatus === 'Verified Match'
                              ? 'text-emerald-700'
                              : m.matchStatus === 'Candidate Review Required'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {m.matchMethod} ({m.matchConfidencePct}%)
                        </p>
                        <p className="max-w-xs text-[11px] text-slate-500">{m.note}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            m.authorizationStatus === 'Authorized (Read-Only)'
                              ? 'text-emerald-700'
                              : m.authorizationStatus === 'Coach View Only (No API Scope)' ||
                                m.authorizationStatus === 'Pending Athlete Opt-In'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {m.authorizationStatus}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {m.candidateIntervalsProfile && m.matchStatus === 'Candidate Review Required' ? (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                onManualMatchAthlete(
                                  m.internalAthleteId,
                                  m.candidateIntervalsProfile!.intervalsAthleteId,
                                  false
                                )
                              }
                              className="inline-flex items-center gap-1 rounded bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800"
                            >
                              <UserCheck className="h-3 w-3" />
                              Confirm Link
                            </button>
                            <button
                              type="button"
                              onClick={() => onManualMatchAthlete(m.internalAthleteId, null, true)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Reject
                            </button>
                          </div>
                        ) : m.intervalsIcuAthleteId ? (
                          <button
                            type="button"
                            onClick={() => onManualMatchAthlete(m.internalAthleteId, null, true)}
                            className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Unlink
                          </button>
                        ) : (
                          <select
                            aria-label={`Manually map ${m.athleteName} to Intervals.icu candidate`}
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                onManualMatchAthlete(m.internalAthleteId, e.target.value, false);
                              }
                            }}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-navy-900"
                          >
                            <option value="">Manual link...</option>
                            {candidates.map((c) => (
                              <option key={c.intervalsAthleteId} value={c.intervalsAthleteId}>
                                {c.name} ({c.intervalsAthleteId})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: HISTORICAL IMPORT PREVIEW, LTHR APPROVAL GATE & WORKOUT MATCHING */}
      {subTab === 'imports_matching' && (
        <div className="space-y-6">
          {/* Import Preview & Validation Report */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Historical Activity Import Preview & Validation Report
                </h3>
                <p className="text-xs text-slate-500">
                  Preserves raw Intervals.icu payloads separately from normalized activities and HR streams. Blocks unauthorized profiles and skips duplicates.
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setImportMode('incremental')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                    importMode === 'incremental'
                      ? 'bg-navy-900 text-white'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  Incremental (7d)
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('backfill_12_week')}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                    importMode === 'backfill_12_week'
                      ? 'bg-navy-900 text-white'
                      : 'text-slate-600 hover:text-navy-900'
                  }`}
                >
                  12-Week Backfill
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Window</p>
                <p className="mt-1 font-mono text-xs font-bold text-navy-900 tabular-nums">
                  {importPreview.report.windowStart} → {importPreview.report.windowEnd}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Raw Payloads</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {importPreview.rawActivities.length}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Normalized + Streams</p>
                <p className="mt-1 font-mono text-base font-bold text-emerald-700 tabular-nums">
                  {importPreview.report.newNormalizedCount} / {importPreview.hrStreams.length}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Duplicates Skipped</p>
                <p className="mt-1 font-mono text-base font-bold text-navy-900 tabular-nums">
                  {importPreview.report.duplicatesSkipped}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Unauthorized Blocked</p>
                <p className="mt-1 font-mono text-base font-bold text-amber-700 tabular-nums">
                  {importPreview.report.unauthorizedBlocked}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-[11px] text-slate-500">Missing / Invalid HR</p>
                <p className="mt-1 font-mono text-base font-bold text-rose-700 tabular-nums">
                  {importPreview.report.missingHrCount} / {importPreview.report.invalidHrQuarantined}
                </p>
              </div>
            </div>

            {/* LTHR Change Approval Gate */}
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-navy-900">
                <ShieldCheck className="h-4 w-4 text-sky-600" />
                Incoming Garmin-Detected LTHR Shifts (Coach Approval Required Before Replacement)
              </h4>
              {importPreview.report.lthrChangeCandidates.filter(
                (c) => !dismissedCandidates.has(c.id)
              ).length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  No pending LTHR threshold replacement candidates in this batch.
                </p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {importPreview.report.lthrChangeCandidates
                    .filter((c) => !dismissedCandidates.has(c.id))
                    .map((cand) => {
                      const targetAth = athletes.find((a) => a.id === cand.athleteId);
                      return (
                        <div
                          key={cand.id}
                          className="flex flex-col justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3.5 sm:flex-row sm:items-center"
                        >
                          <div>
                            <p className="text-xs font-bold text-navy-900">
                              {cand.athleteName}: {cand.currentLthrBpm} bpm → {cand.proposedLthrBpm} bpm ({cand.deltaBpm >= 0 ? '+' : ''}{cand.deltaBpm} bpm)
                            </p>
                            <p className="mt-0.5 text-xs text-slate-600">{cand.reason}</p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!targetAth) return;
                                const updated = recalculateAthleteWithThreshold({
                                  athlete: targetAth,
                                  newRecordInput: {
                                    lthrBpm: cand.proposedLthrBpm,
                                    recordedDate: cand.detectedDate,
                                    effectiveDate: cand.detectedDate,
                                    source: 'Garmin Auto-Detected',
                                    garminDeviceLabel: cand.sourceDevice,
                                    coachVerified: true,
                                    notes: `Coach-approved incoming Garmin LTHR shift via Intervals.icu (${cand.deltaBpm >= 0 ? '+' : ''}${cand.deltaBpm} bpm).`,
                                  },
                                  scope: 'from_effective_date',
                                });
                                onApproveThresholdCandidate(updated, cand);
                                setDismissedCandidates((prev) => new Set(prev).add(cand.id));
                              }}
                              className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap hover:bg-navy-800"
                            >
                              Approve & Update Threshold
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedCandidates((prev) => new Set(prev).add(cand.id))
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap hover:bg-slate-50"
                            >
                              Keep Current
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>

          {/* Planned (Final Surge) vs Completed (Intervals.icu) Matching Engine */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-display text-base font-bold text-navy-900">
                  Final Surge Planned vs. Intervals.icu Completed Activity Matching
                </h3>
                <p className="text-xs text-slate-500">
                  Matches athlete ID, date, start time, duration, distance &amp; type for calendar visibility.
                </p>
              </div>
              <select
                value={selectedMatchAthleteId}
                onChange={(e) => setSelectedMatchAthleteId(e.target.value)}
                aria-label="Select athlete for workout matching"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-navy-900"
              >
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.finalSurgeId})
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Planned (Final Surge)</th>
                    <th className="px-4 py-3 font-semibold">Completed (Intervals.icu)</th>
                    <th className="px-4 py-3 font-semibold">Match Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Dist / Dur / Pace Δ</th>
                    <th className="px-4 py-3 font-semibold">Intensity Comparison</th>
                    <th className="px-4 py-3 text-right font-semibold">Review</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {workoutMatches.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono whitespace-nowrap text-slate-500">
                        {m.date}
                      </td>
                      <td className="px-4 py-3">
                        {m.plannedWorkout ? (
                          <>
                            <p className="font-semibold text-navy-900">{m.plannedWorkout.title}</p>
                            <p className="text-[11px] text-slate-500">
                              {m.plannedWorkout.plannedMiles.toFixed(1)} mi · {m.plannedWorkout.plannedDurationMin}m · {m.plannedWorkout.targetZone}
                            </p>
                          </>
                        ) : (
                          <span className="text-slate-400">None scheduled</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {m.completedActivity ? (
                          <>
                            <p className="font-semibold text-navy-900">{m.completedActivity.title}</p>
                            <p className="text-[11px] text-slate-500">
                              {m.completedActivity.distanceMiles.toFixed(1)} mi · {m.completedActivity.durationMinutes}m @{' '}
                              {formatPace(m.completedActivity.avgPaceSecPerMile)}/mi ·{' '}
                              {m.completedActivity.hrDataState === 'valid'
                                ? `${m.completedActivity.avgHrBpm} bpm`
                                : `HR ${m.completedActivity.hrDataState}`}
                            </p>
                          </>
                        ) : (
                          <span className="text-rose-700 font-medium">No activity synced</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            m.matchStatus === 'Auto-Matched'
                              ? 'text-emerald-700'
                              : m.matchStatus === 'Needs Coach Review'
                              ? 'text-amber-700'
                              : m.matchStatus === 'Missing Telemetry'
                              ? 'text-sky-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {m.matchStatus}
                        </span>
                        <p className="font-mono text-[11px] text-slate-500">Score {m.matchScore}/100</p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-slate-700">
                        {m.distanceDeltaMiles !== null ? `${m.distanceDeltaMiles >= 0 ? '+' : ''}${m.distanceDeltaMiles} mi` : '--'} /{' '}
                        {m.durationDeltaMin !== null ? `${m.durationDeltaMin >= 0 ? '+' : ''}${m.durationDeltaMin}m` : '--'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.intensityComparison}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {m.matchStatus === 'Needs Coach Review' && !m.coachReviewed ? (
                          <button
                            type="button"
                            onClick={() => onMarkMatchReviewed(m.id)}
                            className="rounded bg-navy-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-navy-800"
                          >
                            Confirm Match
                          </button>
                        ) : m.coachReviewed ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <FileCheck2 className="h-3.5 w-3.5" />
                            Reviewed
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Verified</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: 3 LOAD SYSTEMS, SCHEDULED SYNC AUTOMATION, 16-TABLE SCHEMA, AUDIT & DELETION */}
      {subTab === 'loads_automation' && (
        <div className="space-y-6">
          {/* Three Independent Training Load Systems (A, B, C) */}
          {threeLoadSystems && loadAthlete && (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Three Independent Training Load Systems (A, B & C)
                  </h3>
                  <p className="text-xs text-slate-500">
                    System A preserves Intervals.icu native values untouched. System B isolates HR, pace, power & Session RPE stress. System C tracks 42d CTL / 7d ATL / TSB per methodology without mixing scores.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedLoadAthleteId}
                    onChange={(e) => setSelectedLoadAthleteId(e.target.value)}
                    aria-label="Select athlete for load systems comparison"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900"
                  >
                    {athletes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedMethodology}
                    onChange={(e) => setSelectedMethodology(e.target.value as StressMethodologyId)}
                    aria-label="Select System C methodology"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900"
                  >
                    <option value="hr_derived_stress">System C: HR-Derived Stress (hrRSS)</option>
                    <option value="running_tss_pace">System C: Pace Running TSS</option>
                    <option value="running_power_stress">System C: Running Power Stress</option>
                    <option value="session_rpe_stress">System C: Session RPE Stress</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-navy-900">
                    System A · Intervals.icu Native (Preserved)
                  </p>
                  {(() => {
                    const lastNative =
                      threeLoadSystems.systems.systemAProviderMetrics[
                        threeLoadSystems.systems.systemAProviderMetrics.length - 1
                      ];
                    return (
                      <div className="mt-2 space-y-1 font-mono text-xs tabular-nums">
                        <p>
                          Fitness / Fatigue / Form:{' '}
                          <strong className="text-navy-900">
                            {lastNative?.icuFitness ?? '--'} / {lastNative?.icuFatigue ?? '--'} /{' '}
                            {lastNative?.icuForm ?? '--'}
                          </strong>
                        </p>
                        <p className="text-slate-500">
                          Last Activity Load: {lastNative?.icuTrainingLoad ?? '--'} (Untouched Provider Value)
                        </p>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-navy-900">
                    System B · Independent Activity Stress (Latest Run)
                  </p>
                  {(() => {
                    const lastB =
                      threeLoadSystems.systems.systemBStressRecords[
                        threeLoadSystems.systems.systemBStressRecords.length - 1
                      ];
                    return (
                      <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs tabular-nums">
                        <span>hrRSS: {lastB?.hrRunningStress ?? '--'}</span>
                        <span>Pace rTSS: {lastB?.paceRunningStress ?? '--'}</span>
                        <span>Power (Opt.): {lastB?.powerRunningStress ?? 'Not Req.'}</span>
                        <span>sRPE: {lastB?.sessionRpeStress ?? '--'}</span>
                      </div>
                    );
                  })()}
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-navy-900">
                    System C · Methodology-Isolated EWMA (42d/7d)
                  </p>
                  {(() => {
                    const c = threeLoadSystems.systems.systemCSeriesByMethodology[selectedMethodology];
                    return (
                      <div className="mt-2 space-y-1 font-mono text-xs tabular-nums">
                        <p className="text-sky-700 font-semibold">{c.label}</p>
                        <p>
                          CTL {c.latestCtl} · ATL {c.latestAtl} · TSB {c.latestTsb >= 0 ? '+' : ''}
                          {c.latestTsb}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Documented Running TSS & Independent Stress Methodology */}
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 md:grid-cols-3">
                {Object.values(RUNNING_STRESS_METHODOLOGY_DOCS).map((doc) => (
                  <div key={doc.name} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <p className="font-bold text-navy-900">{doc.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-sky-800">{doc.formula}</p>
                    <p className="mt-1 text-[11px] text-slate-600">{doc.requirements}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{doc.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Automation Scheduler & 16-Table DB Summary */}
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="font-display text-base font-bold text-navy-900">
                    Scheduled Synchronization & Retry Queue
                  </h3>
                  <p className="text-xs text-slate-500">
                    Daily imports, metric updates, 12-week backfills & retry tracking (no paid cron APIs required)
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRunSyncJob('daily_activity_import', 'intervals_icu')}
                    className="rounded-lg bg-navy-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-navy-800"
                  >
                    {pilotTestSucceeded ? 'Run Daily Import' : 'Test Sync Gate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRunSyncJob('retry_sync', 'intervals_icu')}
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-navy-900 hover:bg-slate-50"
                  >
                    Retry Queue
                  </button>
                </div>
              </div>

              {!pilotTestSucceeded && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                  <strong>Pilot Gate Active:</strong> Full roster synchronization is blocked until the 6-step Pilot Athlete Connection Test passes on Tab 01. Demo mode remains intact.
                </div>
              )}

              <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto text-xs tabular-nums">
                {syncLogs.map((log) => (
                  <div key={log.id} className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy-900">
                        {log.provider} · {log.jobType} (Attempt #{log.attemptNumber})
                      </span>
                      <span
                        className={`font-semibold ${
                          log.status.startsWith('Succeeded')
                            ? 'text-emerald-700'
                            : log.status.startsWith('Blocked')
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {log.finishedAt} · {log.recordsProcessed} processed · {log.duplicatesSkipped} duplicates skipped
                      {log.errorMessage ? ` — ${log.errorMessage}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="font-display text-base font-bold text-navy-900">
                  Normalized 16-Table Schema & Security Audit
                </h3>
                <p className="text-xs text-slate-500">
                  Separated logical structures with audit logging, coach access control, and athlete deletion
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums sm:grid-cols-4">
                <div className="rounded border border-slate-200 p-2">athletes: {fullNormalizedDb.athletes.length}</div>
                <div className="rounded border border-slate-200 p-2">connections: {fullNormalizedDb.providerConnections.length}</div>
                <div className="rounded border border-slate-200 p-2">mappings: {fullNormalizedDb.providerAthleteMappings.length}</div>
                <div className="rounded border border-slate-200 p-2">planned: {fullNormalizedDb.plannedWorkouts.length}</div>
                <div className="rounded border border-slate-200 p-2">completed: {fullNormalizedDb.completedActivities.length}</div>
                <div className="rounded border border-slate-200 p-2">hr_streams: {fullNormalizedDb.heartRateStreams.length}</div>
                <div className="rounded border border-slate-200 p-2">thresholds: {fullNormalizedDb.athleteThresholds.length}</div>
                <div className="rounded border border-slate-200 p-2">hr_zones: {fullNormalizedDb.heartRateZones.length}</div>
                <div className="rounded border border-slate-200 p-2">icu_metrics: {fullNormalizedDb.providerTrainingMetrics.length}</div>
                <div className="rounded border border-slate-200 p-2">stress_sys_b: {fullNormalizedDb.independentStressMetrics.length}</div>
                <div className="rounded border border-slate-200 p-2">ewma_sys_c: {fullNormalizedDb.dailyLoadHistories.length}</div>
                <div className="rounded border border-slate-200 p-2">wellness: {fullNormalizedDb.wellnessRecords.length}</div>
                <div className="rounded border border-slate-200 p-2">alerts: {fullNormalizedDb.coachingAlerts.length}</div>
                <div className="rounded border border-slate-200 p-2">reports: {fullNormalizedDb.weeklyReports.length}</div>
                <div className="rounded border border-slate-200 p-2">sync_logs: {fullNormalizedDb.synchronizationLogs.length}</div>
                <div className="rounded border border-slate-200 p-2">audit_events: {fullNormalizedDb.auditEvents.length}</div>
              </div>

              {/* Athlete Data Deletion (Role-Restricted to Head Coach) */}
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="flex items-center gap-1.5 text-xs font-bold text-rose-800">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Athlete Data Deletion (Head Coach Only · Logged in Audit Trail)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    value={deleteTargetId}
                    onChange={(e) => setDeleteTargetId(e.target.value)}
                    aria-label="Select athlete to delete"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-navy-900"
                  >
                    <option value="">Choose athlete...</option>
                    {athletes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder='Type "DELETE" to confirm'
                    className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-navy-900"
                  />
                  <button
                    type="button"
                    disabled={
                      coachRole !== 'Head Coach' ||
                      !deleteTargetId ||
                      deleteConfirmName.trim().toUpperCase() !== 'DELETE'
                    }
                    onClick={() => {
                      onDeleteAthleteData(deleteTargetId);
                      setDeleteTargetId('');
                      setDeleteConfirmName('');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Athlete Records
                  </button>
                </div>
              </div>

              {/* Audit Events */}
              <div className="mt-4 max-h-36 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 pt-2 text-[11px]">
                {auditEvents.map((ev) => (
                  <div key={ev.id} className="py-1.5 text-slate-600">
                    <span className="font-mono font-semibold text-navy-900">{ev.action}</span> ·{' '}
                    <span>{ev.actorRole}</span> · <span>{ev.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
