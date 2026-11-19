import {
  AICoachingInsight,
  Athlete,
  IntegrationConnectionState,
  WeeklyAthleteReport,
  Workout,
} from '../types/coaching';

export interface SyncStatusResult {
  connected: boolean;
  provider: string;
  message: string;
  syncedAt: string | null;
  recordsFetched: number;
}

export interface FinalSurgeSource {
  getConnectionInfo(): IntegrationConnectionState;
  fetchAthletes(): Promise<Athlete[]>;
  syncPlannedAndCompletedWorkouts(athleteId: string): Promise<SyncStatusResult>;
}

export interface GarminWearableSource {
  getConnectionInfo(): IntegrationConnectionState;
  fetchBiometricSummaries(athleteId: string): Promise<{
    connected: boolean;
    restingHrBpm?: number;
    hrvStatus?: string;
    sleepScore?: number;
    note: string;
  }>;
  syncActivityStreams(workoutId: string): Promise<SyncStatusResult>;
}

export interface CoachingRepository {
  getConnectionInfo(): IntegrationConnectionState;
  loadRoster(): Promise<Athlete[]>;
  saveCoachNotes(athleteId: string, notes: string): Promise<void>;
  saveReportDrafts(reports: WeeklyAthleteReport[]): Promise<void>;
}

export interface AICoachingEngine {
  getConnectionInfo(): IntegrationConnectionState;
  analyzeAthlete(athlete: Athlete, recentWorkouts?: Workout[]): AICoachingInsight;
}
