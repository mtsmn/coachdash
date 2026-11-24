import { FinalSurgeSource, SyncStatusResult } from './types';
import {
  Athlete,
  IntegrationConnectionState,
  NormalizedCompletedActivity,
} from '../types/coaching';
import { validateHeartRateReading } from '../utils/lthrAnalytics';

export interface FinalSurgeCapabilityItem {
  field: string;
  visibleInWebUi: boolean;
  publicRestApiAvailable: boolean;
  accessPathway: string;
  notes: string;
}

export interface FinalSurgeParsedWorkoutRow {
  date: string;
  title: string;
  activityType: NormalizedCompletedActivity['activityType'];
  distanceMiles: number;
  durationMinutes: number;
  avgPaceSecPerMile: number | null;
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  hrDataState: NormalizedCompletedActivity['hrDataState'];
  hrValidationFlags: string[];
}

export interface FinalSurgeMappedAthleteDto {
  athleteId: string;
  athleteName: string;
  athleteEmail: string | null;
  externalAthleteId: string | null;
  matchStatus: string;
  matchMethod: string;
  authorizationStatus: string;
  matchConfidencePct: number;
  hasFeedUrl: boolean;
  maskedFeedUrl: string | null;
  lastFeedVerifiedAt: string | null;
  lastFeedEventCount: number | null;
  plannedWorkoutsCount: number;
}

export interface FinalSurgeServerStatusDto {
  ok: boolean;
  configured: boolean;
  connected: boolean;
  authMode: string;
  connectionState:
    | 'Connected (Read-Only Calendar Sync)'
    | 'Configured (Verification Pending)'
    | 'Disconnected'
    | 'Partner OAuth Unavailable';
  metadata: {
    officialLiveMethod: string;
    officialExportMethod: string;
    partnerOAuthAvailable: boolean;
    partnerOAuthNotice: string;
    references: Array<{ title: string; summary: string }>;
    limitations: string[];
  };
  lastVerifiedAt: string | null;
  lastSynchronizedAt: string | null;
  mappedAthletes: FinalSurgeMappedAthleteDto[];
  availableAthletes: Array<{
    id: string;
    fullName: string;
    email: string | null;
    intervalsAthleteId: string | null;
  }>;
  syncLogs: Array<{
    id: string;
    jobType: string;
    status: string;
    attemptNumber: number;
    recordsProcessed: number;
    duplicatesSkipped: number;
    errorMessage: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
}

export interface FinalSurgeFeedTestDto {
  ok: boolean;
  statusCode: number;
  connected: boolean;
  athleteId: string | null;
  maskedFeedUrl: string | null;
  eventCount: number;
  activePlannedCount: number;
  cancelledCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  sampleWorkouts: Array<{
    workoutDate: string;
    title: string;
    workoutType: string;
    plannedMiles: number;
    plannedDurationMin: number;
    originalDistanceLabel: string | null;
  }>;
  warnings: string[];
  errorMessage: string | null;
  verifiedAt: string;
}

export interface FinalSurgeSyncDto {
  ok: boolean;
  statusCode: number;
  status: 'Succeeded' | 'Partial' | 'Failed' | 'Blocked (Unauthorized)';
  syncLogId: string | null;
  jobType: string;
  mode: string;
  athleteId: string;
  athleteName: string;
  eventsFetched: number;
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  duplicatesSkipped: number;
  preservedManualCount: number;
  windowStart: string | null;
  windowEnd: string | null;
  warnings: string[];
  errorMessage: string | null;
  synchronizedAt: string;
}

function buildFsHeaders(
  accessToken?: string | null,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (accessToken?.trim()) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }
  return headers;
}

export class FinalSurgeAdapter implements FinalSurgeSource {
  getConnectionInfo(serverStatus?: FinalSurgeServerStatusDto | null): IntegrationConnectionState {
    const isConnected = Boolean(serverStatus?.connected);
    return {
      id: 'finalsurge',
      name: 'Final Surge Coaching Platform (Primary Source)',
      role: 'Primary Training Data Source · Planned Workouts (Official Calendar Sync .ics & Export)',
      connected: isConnected,
      modeLabel: isConnected
        ? `Connected Read-Only · Official iCalendar Sync (${serverStatus?.mappedAthletes.length ?? 0} athlete feed)`
        : 'Read-Only Calendar Sync (.ics) & Coach Export Ready (No Self-Serve REST API)',
      description:
        'Final Surge does not publish a public self-serve REST API or open OAuth portal. Live planned-workout sync uses Official Final Surge Calendar Sync (private per-athlete .ics feed) plus official .ics / CSV export backfills. Running power is never required.',
      requiredConfig: [
        'Official Final Surge Calendar Sync URL (.ics / webcal://)',
        'Official Final Surge Export (.ics or CSV Fallback)',
        'FINALSURGE_CLIENT_ID / SECRET (Partner OAuth Only — Optional)',
      ],
    };
  }

  getCapabilityAudit(): FinalSurgeCapabilityItem[] {
    return [
      {
        field: 'Planned Workouts & Schedule',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Official Calendar Sync (.ics Feed) + Export (.ics / CSV)',
        notes:
          'Officially supported read-only iCalendar feed auto-updates when coach adds, edits, or removes planned workouts on Final Surge.',
      },
      {
        field: 'Coach Instructions & Descriptions',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'VEVENT SUMMARY / DESCRIPTION in .ics Feed',
        notes: 'Preserves full workout title, coaching notes, and parsed interval/pace details.',
      },
      {
        field: 'Historical Schedules (Past Months)',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Exported .ics / CSV Historical Import',
        notes: 'Use official export import for workouts outside the calendar feed rolling horizon.',
      },
      {
        field: 'Athlete Roster & Profiles',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Explicit Coach Athlete Mapping (Safe No-Auto-Name-Merge)',
        notes: 'Each athlete feed is explicitly mapped to an existing Supabase athlete record.',
      },
      {
        field: 'Average HR & Maximum HR Summaries',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Intervals.icu Read-Only API or Final Surge CSV Export',
        notes: 'Sufficient for Running Coach AI independent hrRSS (using athlete LTHR + duration).',
      },
      {
        field: 'Detailed HR Time-Series & Watch FIT Targets',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Intervals.icu Telemetry / Individual .FIT Export',
        notes:
          'Verified limitation: .ics calendar feeds provide workout text/descriptions rather than binary watch FIT steps or raw HR second-by-second streams.',
      },
      {
        field: 'Running Power Metrics (Optional)',
        visibleInWebUi: false,
        publicRestApiAvailable: false,
        accessPathway: 'Optional Only (Optional FIT Power)',
        notes:
          'Running Coach AI never requires running power. Independent hrRSS and Pace-derived rTSS work with HR and pace alone.',
      },
    ];
  }

  async fetchServerStatus(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<FinalSurgeServerStatusDto | null> {
    try {
      const res = await fetch('/api/integrations/final-surge/status', {
        headers: buildFsHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        onAuthError?.(
          res.status,
          res.status === 401
            ? 'Coach sign-in required or session expired (HTTP 401).'
            : 'Forbidden: owner-coach authorization required (HTTP 403).'
        );
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as FinalSurgeServerStatusDto;
    } catch {
      return null;
    }
  }

  async connectAndVerifyFeed(params: {
    accessToken?: string | null;
    athleteId: string;
    feedUrl: string;
    externalAthleteId?: string;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<FinalSurgeFeedTestDto> {
    try {
      const res = await fetch('/api/integrations/final-surge/connect-feed', {
        method: 'POST',
        headers: buildFsHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId,
          feedUrl: params.feedUrl,
          externalAthleteId: params.externalAthleteId?.trim() || undefined,
          confirmMapping: true,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
      }
      return (await res.json()) as FinalSurgeFeedTestDto;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        connected: false,
        athleteId: params.athleteId,
        maskedFeedUrl: null,
        eventCount: 0,
        activePlannedCount: 0,
        cancelledCount: 0,
        earliestDate: null,
        latestDate: null,
        sampleWorkouts: [],
        warnings: [],
        errorMessage: err instanceof Error ? err.message : 'Unable to reach Final Surge endpoint.',
        verifiedAt: new Date().toISOString(),
      };
    }
  }

  async testConnection(params: {
    accessToken?: string | null;
    athleteId?: string;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<FinalSurgeFeedTestDto> {
    try {
      const res = await fetch('/api/integrations/final-surge/test', {
        method: 'POST',
        headers: buildFsHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ athleteId: params.athleteId || undefined }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
      }
      return (await res.json()) as FinalSurgeFeedTestDto;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        connected: false,
        athleteId: params.athleteId ?? null,
        maskedFeedUrl: null,
        eventCount: 0,
        activePlannedCount: 0,
        cancelledCount: 0,
        earliestDate: null,
        latestDate: null,
        sampleWorkouts: [],
        warnings: [],
        errorMessage: err instanceof Error ? err.message : 'Unable to test Final Surge feed.',
        verifiedAt: new Date().toISOString(),
      };
    }
  }

  async updateAthleteMapping(params: {
    accessToken?: string | null;
    athleteId: string;
    externalAthleteId?: string;
    action: 'confirm' | 'auto_match' | 'unlink';
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/integrations/final-surge/mappings', {
        method: 'POST',
        headers: buildFsHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId,
          externalAthleteId: params.externalAthleteId?.trim() || undefined,
          action: params.action,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
      }
      return (await res.json()) as { ok: boolean; error?: string };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Mapping update failed.' };
    }
  }

  async syncPlannedWorkouts(params: {
    accessToken?: string | null;
    athleteId: string;
    mode: 'initial' | 'incremental';
    startDate?: string;
    endDate?: string;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<FinalSurgeSyncDto> {
    try {
      const res = await fetch('/api/integrations/final-surge/sync', {
        method: 'POST',
        headers: buildFsHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId,
          mode: params.mode,
          startDate: params.startDate || undefined,
          endDate: params.endDate || undefined,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
      }
      return (await res.json()) as FinalSurgeSyncDto;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        status: 'Failed',
        syncLogId: null,
        jobType: params.mode === 'initial' ? 'backfill_12w' : 'daily_activity_import',
        mode: params.mode,
        athleteId: params.athleteId,
        athleteName: 'Athlete',
        eventsFetched: 0,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        duplicatesSkipped: 0,
        preservedManualCount: 0,
        windowStart: params.startDate ?? null,
        windowEnd: params.endDate ?? null,
        warnings: [],
        errorMessage: err instanceof Error ? err.message : 'Unable to sync Final Surge workouts.',
        synchronizedAt: new Date().toISOString(),
      };
    }
  }

  async importPlannedExport(params: {
    accessToken?: string | null;
    athleteId: string;
    format: 'ics' | 'csv';
    content: string;
    startDate?: string;
    endDate?: string;
    onAuthError?: (status: 401 | 403, message: string) => void;
  }): Promise<FinalSurgeSyncDto> {
    try {
      const res = await fetch('/api/integrations/final-surge/import', {
        method: 'POST',
        headers: buildFsHeaders(params.accessToken, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          athleteId: params.athleteId,
          format: params.format,
          content: params.content,
          startDate: params.startDate || undefined,
          endDate: params.endDate || undefined,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        params.onAuthError?.(res.status, 'Coach authorization required.');
      }
      return (await res.json()) as FinalSurgeSyncDto;
    } catch (err) {
      return {
        ok: false,
        statusCode: 503,
        status: 'Failed',
        syncLogId: null,
        jobType: 'finalsurge_csv_import',
        mode: `import_${params.format}`,
        athleteId: params.athleteId,
        athleteName: 'Athlete',
        eventsFetched: 0,
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        duplicatesSkipped: 0,
        preservedManualCount: 0,
        windowStart: params.startDate ?? null,
        windowEnd: params.endDate ?? null,
        warnings: [],
        errorMessage: err instanceof Error ? err.message : 'Unable to import Final Surge export.',
        synchronizedAt: new Date().toISOString(),
      };
    }
  }

  async disconnect(
    accessToken?: string | null,
    onAuthError?: (status: 401 | 403, message: string) => void
  ): Promise<boolean> {
    try {
      const res = await fetch('/api/integrations/final-surge/disconnect', {
        method: 'POST',
        headers: buildFsHeaders(accessToken),
      });
      if (res.status === 401 || res.status === 403) {
        onAuthError?.(res.status, 'Coach authorization required.');
        return false;
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Parses coach-exported Final Surge CSV rows (or sample export format) into normalized
   * completed workout rows without requiring running power or raw time-series streams.
   * Expected CSV headers (flexible order): Date,Title,Type,DistanceMiles,DurationMinutes,AvgPace,AvgHR,MaxHR
   */
  parseCoachCsvExport(
    csvText: string,
    athleteMaxHrBpm = 190
  ): {
    rows: FinalSurgeParsedWorkoutRow[];
    warnings: string[];
  } {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) {
      return {
        rows: [],
        warnings: ['CSV must include a header row and at least one workout row.'],
      };
    }

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const colIndex = (candidates: string[]) =>
      headers.findIndex((h) => candidates.some((c) => h.includes(c)));

    const iDate = colIndex(['date']);
    const iTitle = colIndex(['title', 'workout', 'name']);
    const iType = colIndex(['type', 'category']);
    const iDist = colIndex(['distance', 'miles']);
    const iDur = colIndex(['duration', 'minutes', 'time']);
    const iPace = colIndex(['pace']);
    const iAvgHr = colIndex(['avghr', 'avg_hr', 'avg hr', 'average heart']);
    const iMaxHr = colIndex(['maxhr', 'max_hr', 'max hr', 'max heart']);

    const rows: FinalSurgeParsedWorkoutRow[] = [];
    const warnings: string[] = [];

    for (let r = 1; r < lines.length; r++) {
      const cols = lines[r].split(',').map((c) => c.trim());
      const date = iDate >= 0 ? cols[iDate] : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        warnings.push(`Row ${r + 1}: skipped invalid or missing YYYY-MM-DD date ("${date}").`);
        continue;
      }

      const rawType = (iType >= 0 ? cols[iType] : 'Easy').toLowerCase();
      const activityType: NormalizedCompletedActivity['activityType'] = rawType.includes('long')
        ? 'Long Run'
        : rawType.includes('tempo') || rawType.includes('threshold')
        ? 'Tempo'
        : rawType.includes('interval') || rawType.includes('track')
        ? 'Intervals'
        : rawType.includes('race')
        ? 'Race'
        : rawType.includes('rec')
        ? 'Recovery'
        : 'Easy';

      const distanceMiles = iDist >= 0 ? Number(cols[iDist]) || 0 : 0;
      const durationMinutes = iDur >= 0 ? Number(cols[iDur]) || 0 : 0;

      let avgPaceSecPerMile: number | null = null;
      if (iPace >= 0 && cols[iPace]) {
        const paceStr = cols[iPace];
        if (paceStr.includes(':')) {
          const [m, s] = paceStr.split(':').map(Number);
          if (Number.isFinite(m) && Number.isFinite(s)) {
            avgPaceSecPerMile = m * 60 + s;
          }
        } else {
          const sec = Number(paceStr);
          if (Number.isFinite(sec) && sec > 0) avgPaceSecPerMile = sec;
        }
      } else if (distanceMiles > 0 && durationMinutes > 0) {
        avgPaceSecPerMile = Math.round((durationMinutes * 60) / distanceMiles);
      }

      const avgHrRaw = iAvgHr >= 0 && cols[iAvgHr] !== '' ? Number(cols[iAvgHr]) : null;
      const maxHrRaw = iMaxHr >= 0 && cols[iMaxHr] !== '' ? Number(cols[iMaxHr]) : null;
      const avgHrBpm = avgHrRaw !== null && Number.isFinite(avgHrRaw) ? avgHrRaw : null;
      const maxHrBpm = maxHrRaw !== null && Number.isFinite(maxHrRaw) ? maxHrRaw : null;

      const hrCheck = validateHeartRateReading({
        avgHrBpm,
        maxHrBpm,
        athleteMaxHrBpm,
        workoutType: activityType,
        status: 'Completed',
        durationMinutes,
      });

      rows.push({
        date,
        title: (iTitle >= 0 && cols[iTitle]) || `${activityType} Run`,
        activityType,
        distanceMiles: Number(distanceMiles.toFixed(2)),
        durationMinutes: Math.round(durationMinutes),
        avgPaceSecPerMile,
        avgHrBpm,
        maxHrBpm,
        hrDataState: hrCheck.hrDataState,
        hrValidationFlags: hrCheck.flags,
      });
    }

    return { rows, warnings };
  }

  async fetchAthletes(): Promise<Athlete[]> {
    return [];
  }

  async syncPlannedAndCompletedWorkouts(_athleteId: string): Promise<SyncStatusResult> {
    return {
      connected: false,
      provider: 'Final Surge',
      message:
        'Connect an official athlete Calendar Sync (.ics) URL or upload a Final Surge .ics/CSV export in Integrations.',
      syncedAt: null,
      recordsFetched: 0,
    };
  }
}

export const finalSurgeAdapter = new FinalSurgeAdapter();
