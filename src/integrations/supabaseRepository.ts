import { CoachingRepository } from './types';
import {
  Athlete,
  HrZoneConfig,
  IntegrationConnectionState,
  LthrRecord,
  StressSnapshotRecord,
  WeeklyAthleteReport,
} from '../types/coaching';
import { generateDemoRoster } from '../data/mockRosterGenerator';
import { recalculateAthleteWithThreshold } from '../utils/lthrAnalytics';

const STORAGE_KEYS = {
  COACH_NOTES: 'rcai_demo_coach_notes_v1',
  REPORTS: 'rcai_demo_weekly_reports_v1',
  PHYSIOLOGY_OVERRIDES: 'rcai_demo_physiology_v1',
};

interface SavedAthletePhysiology {
  lthrHistory: LthrRecord[];
  activeThresholdVersion: number;
  lthrBpm: number;
  hrZoneConfig: HrZoneConfig;
  recalculationLog: StressSnapshotRecord[];
}

export class LocalDemoRepository implements CoachingRepository {
  getConnectionInfo(): IntegrationConnectionState {
    return {
      id: 'supabase',
      name: 'Supabase Postgres & Auth',
      role: 'Threshold History, Recalculation Snapshots, Notes & Report Approvals',
      connected: false,
      modeLabel: 'Disconnected · Browser Local Storage',
      description:
        'Persists versioned LTHR threshold history, stress recalculation snapshots, coach notes, and pre-email report approvals.',
      requiredConfig: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    };
  }

  async loadRoster(): Promise<Athlete[]> {
    const baseRoster = generateDemoRoster();
    try {
      const savedNotesRaw = localStorage.getItem(STORAGE_KEYS.COACH_NOTES);
      const savedNotes = savedNotesRaw ? (JSON.parse(savedNotesRaw) as Record<string, string>) : {};
      const physRaw = localStorage.getItem(STORAGE_KEYS.PHYSIOLOGY_OVERRIDES);
      const physMap = physRaw
        ? (JSON.parse(physRaw) as Record<string, SavedAthletePhysiology>)
        : {};

      return baseRoster.map((athlete) => {
        const phys = physMap[athlete.id];
        let hydrated: Athlete = {
          ...athlete,
          coachNotes: savedNotes[athlete.id] ?? athlete.coachNotes,
        };
        const hasValidLthrHistory =
          Array.isArray(phys?.lthrHistory) &&
          phys.lthrHistory.length > 0 &&
          phys.lthrHistory.every(
            (r) =>
              typeof r?.recordedDate === 'string' &&
              (r?.source === 'Garmin Auto-Detected' || r?.source === 'Coach-Approved Manual Fallback')
          );

        if (phys && hasValidLthrHistory) {
          hydrated = recalculateAthleteWithThreshold({
            athlete: {
              ...hydrated,
              lthrHistory: phys.lthrHistory,
              activeThresholdVersion: phys.activeThresholdVersion,
              lthrBpm: phys.lthrBpm,
              hrZoneConfig: phys.hrZoneConfig,
              recalculationLog: phys.recalculationLog ?? [],
            },
            scope: 'all_history',
          });
          // Preserve stored recalculationLog cleanly without duplicating an entry on load
          hydrated.recalculationLog = phys.recalculationLog ?? [];
        }
        return hydrated;
      });
    } catch {
      return baseRoster;
    }
  }

  async saveCoachNotes(athleteId: string, notes: string): Promise<void> {
    try {
      const existingRaw = localStorage.getItem(STORAGE_KEYS.COACH_NOTES);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, string>) : {};
      existing[athleteId] = notes;
      localStorage.setItem(STORAGE_KEYS.COACH_NOTES, JSON.stringify(existing));
    } catch {
      // Ignore storage quota errors
    }
  }

  saveAthletePhysiology(athlete: Athlete): void {
    try {
      const existingRaw = localStorage.getItem(STORAGE_KEYS.PHYSIOLOGY_OVERRIDES);
      const existing = existingRaw
        ? (JSON.parse(existingRaw) as Record<string, SavedAthletePhysiology>)
        : {};
      existing[athlete.id] = {
        lthrHistory: athlete.lthrHistory,
        activeThresholdVersion: athlete.activeThresholdVersion,
        lthrBpm: athlete.lthrBpm,
        hrZoneConfig: athlete.hrZoneConfig,
        recalculationLog: athlete.recalculationLog,
      };
      localStorage.setItem(STORAGE_KEYS.PHYSIOLOGY_OVERRIDES, JSON.stringify(existing));
    } catch {
      // Ignore storage quota errors
    }
  }

  async saveReportDrafts(reports: WeeklyAthleteReport[]): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEYS.REPORTS, JSON.stringify(reports));
    } catch {
      // Ignore storage quota errors
    }
  }

  loadSavedReportDrafts(): WeeklyAthleteReport[] | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REPORTS);
      return raw ? (JSON.parse(raw) as WeeklyAthleteReport[]) : null;
    } catch {
      return null;
    }
  }
}

export const coachingRepository = new LocalDemoRepository();
