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

export class FinalSurgeAdapter implements FinalSurgeSource {
  getConnectionInfo(): IntegrationConnectionState {
    return {
      id: 'finalsurge',
      name: 'Final Surge Coaching Platform (Primary Source)',
      role: 'Primary Training Data Source · Roster, Planned & Completed Workouts, Pace, Distance, Duration, Avg/Max HR',
      connected: false,
      modeLabel: 'Primary Source · Partner API Unconfigured (Demo & CSV Import Ready)',
      description:
        'Final Surge does not publish an open public self-serve REST API. Live sync requires authorized Final Surge partner credentials or coach CSV/FIT exports; website HR graphs do not automatically expose raw second-by-second HR arrays via API. Running Coach AI independently computes hrRSS, Pace rTSS, CTL/ATL/TSB, and LTHR zones from completed summary metrics without requiring running power.',
      requiredConfig: [
        'FINALSURGE_CLIENT_ID (Partner API Approval)',
        'FINALSURGE_CLIENT_SECRET (Partner API Approval)',
        'Coach CSV / FIT-TCX Export (Available Immediately)',
      ],
    };
  }

  getCapabilityAudit(): FinalSurgeCapabilityItem[] {
    return [
      {
        field: 'Athlete Roster & Profiles',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Authorized Partner API / Coach Roster Export',
        notes: 'No open self-serve OAuth portal; partner approval required for live REST pulls.',
      },
      {
        field: 'Planned & Completed Workouts',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Authorized Partner API / Coach Calendar CSV Export',
        notes: 'Supports planned vs. completed distance, duration, type, and pace summaries.',
      },
      {
        field: 'Average HR & Maximum HR',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Workout Summary Payload / Coach CSV Export',
        notes: 'Sufficient for Running Coach AI independent hrRSS (using athlete LTHR + duration).',
      },
      {
        field: 'Detailed HR Time-Series Graphs',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Individual .FIT / .TCX File Export Only (or Aggregator Middleware)',
        notes:
          'Verified limitation: HR graphs shown in the Final Surge website are rendered from device files and are NOT programmatically exposed via a public Final Surge REST endpoint.',
      },
      {
        field: 'Running Pace, Distance & Duration',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Workout Summary Payload / Coach CSV Export',
        notes: 'Drives independent Pace-derived rTSS when athlete threshold pace is set.',
      },
      {
        field: 'Running Power (Watts)',
        visibleInWebUi: true,
        publicRestApiAvailable: false,
        accessPathway: 'Optional Only (Not Required)',
        notes: 'Running Coach AI never requires running power to compute stress, CTL, ATL, or TSB.',
      },
    ];
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
        'Final Surge Partner API credentials are not configured. Use local 30-athlete demo data or Coach CSV Export parser.',
      syncedAt: null,
      recordsFetched: 0,
    };
  }
}

export const finalSurgeAdapter = new FinalSurgeAdapter();
