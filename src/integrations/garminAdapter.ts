import { GarminWearableSource, SyncStatusResult } from './types';
import { GarminActivityMetrics, IntegrationConnectionState } from '../types/coaching';

/**
 * Garmin Connect Health & Activity Adapter (Stub / Future Connector)
 * Preferred source for auto-detected Lactate Threshold Heart Rate (LTHR),
 * original Garmin Training Load (EPOC), Training Status, Acute/Chronic Load,
 * Aerobic/Anaerobic Training Effect, VO2max estimate, and HRV status.
 */
export class GarminAdapter implements GarminWearableSource {
  getConnectionInfo(): IntegrationConnectionState {
    return {
      id: 'garmin',
      name: 'Garmin Device Telemetry (via Intervals.icu)',
      role: 'Hardware Source for LTHR Auto-Detection, HRV & Watch Metrics (No Direct Garmin Auth)',
      connected: false,
      modeLabel: 'No Direct Garmin Auth Required · Flows via Intervals.icu',
      description:
        'Direct Garmin Connect authentication has been removed. Garmin watch activities, LTHR auto-detection, and HRV sync into Intervals.icu where authorized, with device provenance preserved.',
      requiredConfig: ['Synced via INTERVALS_ICU_OAUTH / API (No Direct Garmin Key Needed)'],
    };
  }

  async fetchBiometricSummaries(_athleteId: string) {
    return {
      connected: false,
      note: 'Garmin Connect is not connected. Biometrics shown are local sample values preserving Garmin provider definitions.',
    };
  }

  async syncActivityStreams(_workoutId: string): Promise<SyncStatusResult> {
    return {
      connected: false,
      provider: 'Garmin Connect',
      message: 'Garmin Health API is not connected.',
      syncedAt: null,
      recordsFetched: 0,
    };
  }

  mapRawGarminPayload(raw: {
    trainingLoad?: number | null;
    aerobicTE?: number | null;
    anaerobicTE?: number | null;
    vo2Max?: number | null;
    recoveryHours?: number | null;
  }): GarminActivityMetrics {
    return {
      garminTrainingLoad: raw.trainingLoad ?? null,
      aerobicTrainingEffect: raw.aerobicTE ?? null,
      anaerobicTrainingEffect: raw.anaerobicTE ?? null,
      vo2MaxEstimate: raw.vo2Max ?? null,
      recoveryTimeHours: raw.recoveryHours ?? null,
      providerLabel: 'Garmin Connect (Original Metric)',
    };
  }
}

export const garminAdapter = new GarminAdapter();
