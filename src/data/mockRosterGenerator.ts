import {
  Athlete,
  GarminActivityMetrics,
  GarminAthleteBiometrics,
  HrZoneConfig,
  IntensityZone,
  LthrRecord,
  RaceResult,
  TrainingGroup,
  Workout,
  WorkoutStatus,
  WorkoutType,
} from '../types/coaching';
import {
  calculateHrRunningStress,
  resolveThresholdForDate,
  validateHeartRateReading,
} from '../utils/lthrAnalytics';

function createSeededRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface AthleteSeedSpec {
  name: string;
  age: number;
  gender: 'F' | 'M' | 'NB';
  location: string;
  group: TrainingGroup;
  phase: Athlete['currentPhase'];
  baseWeeklyMiles: number;
  thresholdPaceSec: number;
  restingHr: number;
  maxHr: number;
  lthrBpm: number;
  useManualFallback?: boolean; // Demonstrates coach-approved manual fallback when Garmin detection unavailable
  lthrVerified: boolean;
  optionalPowerWatts: number | null;
  raceName: string;
  raceDate: string;
  raceDist: Athlete['goal']['distanceLabel'];
  raceMiles: number;
  targetSec: number;
  profileTrait: 'consistent' | 'spike' | 'hrDrift' | 'lowCompliance' | 'taper';
}

const ATHLETE_SPECS: AthleteSeedSpec[] = [
  { name: 'Maya Lin', age: 29, gender: 'F', location: 'Boulder, CO', group: 'Marathon', phase: 'Peak', baseWeeklyMiles: 62, thresholdPaceSec: 382, restingHr: 46, maxHr: 191, lthrBpm: 173, lthrVerified: true, optionalPowerWatts: 285, raceName: 'California International Marathon', raceDate: '2026-12-06', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 10560, profileTrait: 'taper' },
  { name: 'Jordan Vance', age: 34, gender: 'M', location: 'Austin, TX', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 54, thresholdPaceSec: 405, restingHr: 50, maxHr: 186, lthrBpm: 168, lthrVerified: true, optionalPowerWatts: 312, raceName: 'Houston Marathon', raceDate: '2027-01-17', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 11400, profileTrait: 'spike' },
  { name: 'Elena Rostova', age: 31, gender: 'F', location: 'Portland, OR', group: 'Half Marathon', phase: 'Peak', baseWeeklyMiles: 48, thresholdPaceSec: 392, restingHr: 48, maxHr: 189, lthrBpm: 171, lthrVerified: true, optionalPowerWatts: 274, raceName: 'Seattle Half Marathon', raceDate: '2026-11-29', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5160, profileTrait: 'taper' },
  { name: 'Marcus Thorne', age: 27, gender: 'M', location: 'Flagstaff, AZ', group: '10K / 5K Track', phase: 'Build', baseWeeklyMiles: 52, thresholdPaceSec: 348, restingHr: 44, maxHr: 194, lthrBpm: 177, lthrVerified: true, optionalPowerWatts: 348, raceName: 'San Diego Holiday 10K', raceDate: '2026-12-19', raceDist: '10K', raceMiles: 6.2, targetSec: 2085, profileTrait: 'consistent' },
  { name: 'Priya Patel', age: 36, gender: 'F', location: 'Chicago, IL', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 38, thresholdPaceSec: 448, restingHr: 53, maxHr: 184, lthrBpm: 164, lthrVerified: false, optionalPowerWatts: null, raceName: 'Mesa Half Marathon', raceDate: '2027-02-13', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 6060, profileTrait: 'hrDrift' },
  { name: 'Caleb Mercer', age: 41, gender: 'M', location: 'Denver, CO', group: 'Ultra / Trail', phase: 'Build', baseWeeklyMiles: 64, thresholdPaceSec: 425, restingHr: 49, maxHr: 181, lthrBpm: 162, lthrVerified: true, optionalPowerWatts: 298, raceName: 'Bandera 50K', raceDate: '2027-01-09', raceDist: '50K', raceMiles: 31.1, targetSec: 16500, profileTrait: 'consistent' },
  { name: 'Hannah Okafor', age: 25, gender: 'F', location: 'Boston, MA', group: '10K / 5K Track', phase: 'Peak', baseWeeklyMiles: 44, thresholdPaceSec: 368, restingHr: 47, maxHr: 196, lthrBpm: 178, lthrVerified: true, optionalPowerWatts: 292, raceName: 'Cambridge Thanksgiving 5K', raceDate: '2026-11-26', raceDist: '5K', raceMiles: 3.1, targetSec: 1065, profileTrait: 'taper' },
  { name: 'Devon Brooks', age: 38, gender: 'M', location: 'Atlanta, GA', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 46, thresholdPaceSec: 438, restingHr: 54, maxHr: 183, lthrBpm: 164, useManualFallback: true, lthrVerified: true, optionalPowerWatts: null, raceName: 'Publix Atlanta Marathon', raceDate: '2027-02-28', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 12480, profileTrait: 'lowCompliance' },
  { name: 'Sofia Alvarez', age: 30, gender: 'F', location: 'San Diego, CA', group: 'Marathon', phase: 'Peak', baseWeeklyMiles: 58, thresholdPaceSec: 398, restingHr: 47, maxHr: 190, lthrBpm: 172, lthrVerified: true, optionalPowerWatts: 278, raceName: 'California International Marathon', raceDate: '2026-12-06', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 11100, profileTrait: 'consistent' },
  { name: 'Liam Gallagher', age: 44, gender: 'M', location: 'Minneapolis, MN', group: 'Half Marathon', phase: 'Base', baseWeeklyMiles: 34, thresholdPaceSec: 462, restingHr: 55, maxHr: 179, lthrBpm: 160, lthrVerified: true, optionalPowerWatts: null, raceName: '3M Half Marathon', raceDate: '2027-01-24', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 6300, profileTrait: 'consistent' },
  { name: 'Chloe Kim', age: 28, gender: 'F', location: 'Seattle, WA', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 42, thresholdPaceSec: 418, restingHr: 49, maxHr: 192, lthrBpm: 173, lthrVerified: true, optionalPowerWatts: 256, raceName: 'Houston Aramco Half', raceDate: '2027-01-17', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5640, profileTrait: 'spike' },
  { name: 'Nathaniel Cole', age: 33, gender: 'M', location: 'Raleigh, NC', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 51, thresholdPaceSec: 412, restingHr: 51, maxHr: 187, lthrBpm: 169, lthrVerified: true, optionalPowerWatts: 304, raceName: 'Jacksonville Marathon', raceDate: '2026-12-13', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 11520, profileTrait: 'hrDrift' },
  { name: 'Tessa Lindqvist', age: 35, gender: 'F', location: 'Salt Lake City, UT', group: 'Ultra / Trail', phase: 'Peak', baseWeeklyMiles: 59, thresholdPaceSec: 432, restingHr: 48, maxHr: 185, lthrBpm: 167, lthrVerified: true, optionalPowerWatts: 262, raceName: 'Moab Red Hot 50K', raceDate: '2027-02-20', raceDist: '50K', raceMiles: 31.1, targetSec: 16920, profileTrait: 'consistent' },
  { name: 'Owen Whitaker', age: 24, gender: 'M', location: 'Eugene, OR', group: '10K / 5K Track', phase: 'Base', baseWeeklyMiles: 49, thresholdPaceSec: 342, restingHr: 43, maxHr: 197, lthrBpm: 180, lthrVerified: true, optionalPowerWatts: 356, raceName: 'Portland Indoor 5K', raceDate: '2027-01-30', raceDist: '5K', raceMiles: 3.1, targetSec: 955, profileTrait: 'consistent' },
  { name: 'Amara Mensah', age: 32, gender: 'F', location: 'Washington, DC', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 36, thresholdPaceSec: 456, restingHr: 52, maxHr: 188, lthrBpm: 168, lthrVerified: true, optionalPowerWatts: null, raceName: 'Rock n Roll DC Half', raceDate: '2027-03-14', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 6180, profileTrait: 'consistent' },
  { name: 'Lucas Bennett', age: 39, gender: 'M', location: 'Madison, WI', group: 'Base / Return', phase: 'Base', baseWeeklyMiles: 26, thresholdPaceSec: 495, restingHr: 57, maxHr: 180, lthrBpm: 160, useManualFallback: true, lthrVerified: true, optionalPowerWatts: null, raceName: 'Madison Turkey Trot 10K', raceDate: '2026-11-26', raceDist: '10K', raceMiles: 6.2, targetSec: 3120, profileTrait: 'consistent' },
  { name: 'Rachel Goldstein', age: 37, gender: 'F', location: 'New York, NY', group: 'Marathon', phase: 'Recovery', baseWeeklyMiles: 40, thresholdPaceSec: 435, restingHr: 52, maxHr: 184, lthrBpm: 165, lthrVerified: true, optionalPowerWatts: null, raceName: 'Tokyo Marathon', raceDate: '2027-03-07', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 12300, profileTrait: 'lowCompliance' },
  { name: 'Mateo Silva', age: 29, gender: 'M', location: 'Miami, FL', group: 'Half Marathon', phase: 'Peak', baseWeeklyMiles: 45, thresholdPaceSec: 396, restingHr: 48, maxHr: 191, lthrBpm: 173, lthrVerified: true, optionalPowerWatts: 316, raceName: 'Miami Half Marathon', raceDate: '2027-01-24', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5280, profileTrait: 'hrDrift' },
  { name: 'Kendra Wallace', age: 42, gender: 'F', location: 'Bend, OR', group: 'Ultra / Trail', phase: 'Build', baseWeeklyMiles: 53, thresholdPaceSec: 444, restingHr: 50, maxHr: 180, lthrBpm: 161, lthrVerified: true, optionalPowerWatts: 248, raceName: 'Chuckanut 50K', raceDate: '2027-03-20', raceDist: '50K', raceMiles: 31.1, targetSec: 17400, profileTrait: 'consistent' },
  { name: 'Samir Haddad', age: 26, gender: 'M', location: 'Ann Arbor, MI', group: '10K / 5K Track', phase: 'Build', baseWeeklyMiles: 47, thresholdPaceSec: 364, restingHr: 46, maxHr: 195, lthrBpm: 177, lthrVerified: true, optionalPowerWatts: 336, raceName: 'Naples Winter 10K', raceDate: '2027-01-16', raceDist: '10K', raceMiles: 6.2, targetSec: 2180, profileTrait: 'spike' },
  { name: 'Grace Donovan', age: 33, gender: 'F', location: 'Charlotte, NC', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 50, thresholdPaceSec: 422, restingHr: 50, maxHr: 187, lthrBpm: 169, lthrVerified: true, optionalPowerWatts: null, raceName: 'Kiawah Island Marathon', raceDate: '2026-12-12', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 11880, profileTrait: 'consistent' },
  { name: 'Trevor Nguyen', age: 30, gender: 'M', location: 'San Jose, CA', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 41, thresholdPaceSec: 410, restingHr: 49, maxHr: 190, lthrBpm: 172, lthrVerified: true, optionalPowerWatts: 302, raceName: 'San Jose 408K Half', raceDate: '2027-02-28', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5520, profileTrait: 'consistent' },
  { name: 'Isabelle Moreau', age: 27, gender: 'F', location: 'Burlington, VT', group: 'Base / Return', phase: 'Base', baseWeeklyMiles: 24, thresholdPaceSec: 505, restingHr: 56, maxHr: 191, lthrBpm: 170, lthrVerified: true, optionalPowerWatts: null, raceName: 'Burlington Frostbite 5K', raceDate: '2026-12-19', raceDist: '5K', raceMiles: 3.1, targetSec: 1470, profileTrait: 'consistent' },
  { name: 'Victor Alvarez', age: 45, gender: 'M', location: 'Phoenix, AZ', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 48, thresholdPaceSec: 430, restingHr: 52, maxHr: 178, lthrBpm: 159, lthrVerified: true, optionalPowerWatts: 288, raceName: 'Mesa Marathon', raceDate: '2027-02-13', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 12120, profileTrait: 'consistent' },
  { name: 'Nadia Kowalski', age: 31, gender: 'F', location: 'Philadelphia, PA', group: '10K / 5K Track', phase: 'Peak', baseWeeklyMiles: 43, thresholdPaceSec: 386, restingHr: 48, maxHr: 190, lthrBpm: 173, lthrVerified: true, optionalPowerWatts: 276, raceName: 'Rothman 8K / 10K', raceDate: '2026-11-22', raceDist: '10K', raceMiles: 6.2, targetSec: 2340, profileTrait: 'taper' },
  { name: 'Ethan Gallagher', age: 35, gender: 'M', location: 'Columbus, OH', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 37, thresholdPaceSec: 440, restingHr: 53, maxHr: 185, lthrBpm: 166, useManualFallback: true, lthrVerified: false, optionalPowerWatts: null, raceName: 'Naples Daily News Half', raceDate: '2027-01-18', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5940, profileTrait: 'lowCompliance' },
  { name: 'Simone Baptiste', age: 29, gender: 'F', location: 'New Orleans, LA', group: 'Marathon', phase: 'Build', baseWeeklyMiles: 55, thresholdPaceSec: 404, restingHr: 48, maxHr: 189, lthrBpm: 171, lthrVerified: true, optionalPowerWatts: 280, raceName: 'Houston Marathon', raceDate: '2027-01-17', raceDist: 'Marathon', raceMiles: 26.2, targetSec: 11280, profileTrait: 'consistent' },
  { name: 'Garrett Flynn', age: 40, gender: 'M', location: 'Boise, ID', group: 'Ultra / Trail', phase: 'Base', baseWeeklyMiles: 50, thresholdPaceSec: 448, restingHr: 51, maxHr: 182, lthrBpm: 163, lthrVerified: true, optionalPowerWatts: 290, raceName: 'Way Too Cool 50K', raceDate: '2027-03-06', raceDist: '50K', raceMiles: 31.1, targetSec: 17700, profileTrait: 'consistent' },
  { name: 'Mei-Ling Zhou', age: 26, gender: 'F', location: 'San Francisco, CA', group: 'Half Marathon', phase: 'Build', baseWeeklyMiles: 44, thresholdPaceSec: 408, restingHr: 47, maxHr: 193, lthrBpm: 174, lthrVerified: true, optionalPowerWatts: 268, raceName: 'Kaiser Permanente Half', raceDate: '2027-02-07', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 5460, profileTrait: 'consistent' },
  { name: 'Derek Holloway', age: 47, gender: 'M', location: 'Nashville, TN', group: 'Base / Return', phase: 'Base', baseWeeklyMiles: 29, thresholdPaceSec: 488, restingHr: 56, maxHr: 177, lthrBpm: 158, lthrVerified: true, optionalPowerWatts: null, raceName: 'Nashville Holiday Half', raceDate: '2026-12-19', raceDist: 'Half Marathon', raceMiles: 13.1, targetSec: 6780, profileTrait: 'consistent' },
];

const START_DATE = new Date('2026-08-31T00:00:00Z');
const GARMIN_DEVICES = [
  'Garmin Forerunner 965',
  'Garmin Forerunner 265',
  'Garmin Epix Pro (Gen 2)',
  'Garmin Fenix 8',
];

function addDaysIso(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function zoneMixForType(type: WorkoutType): Record<IntensityZone, number> {
  switch (type) {
    case 'Recovery':
      return { Z1: 55, Z2: 45, Z3: 0, Z4: 0, Z5: 0 };
    case 'Easy':
      return { Z1: 20, Z2: 75, Z3: 5, Z4: 0, Z5: 0 };
    case 'Long Run':
      return { Z1: 10, Z2: 72, Z3: 15, Z4: 3, Z5: 0 };
    case 'Tempo':
      return { Z1: 10, Z2: 30, Z3: 35, Z4: 25, Z5: 0 };
    case 'Intervals':
      return { Z1: 15, Z2: 35, Z3: 10, Z4: 22, Z5: 18 };
    case 'Race':
      return { Z1: 5, Z2: 15, Z3: 30, Z4: 38, Z5: 12 };
    default:
      return { Z1: 100, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  }
}

const WEEKLY_TEMPLATE: Array<{ dayOffset: number; type: WorkoutType; title: string; pct: number }> = [
  { dayOffset: 0, type: 'Rest', title: 'Rest / Mobility', pct: 0 },
  { dayOffset: 1, type: 'Easy', title: 'Aerobic Base + Strides', pct: 0.16 },
  { dayOffset: 2, type: 'Intervals', title: 'Track / VO2 Repeats', pct: 0.17 },
  { dayOffset: 3, type: 'Recovery', title: 'Recovery Shakeout', pct: 0.11 },
  { dayOffset: 4, type: 'Tempo', title: 'Threshold Cruise / Tempo', pct: 0.18 },
  { dayOffset: 5, type: 'Easy', title: 'Pre-Long Easy Aerobic', pct: 0.11 },
  { dayOffset: 6, type: 'Long Run', title: 'Progressive Long Run', pct: 0.27 },
];

export function generateDemoRoster(): Athlete[] {
  return ATHLETE_SPECS.map((spec, idx) => {
    const rng = createSeededRng(104729 + idx * 919);
    const athleteId = `ath-${String(idx + 1).padStart(2, '0')}`;
    const garminDevice = GARMIN_DEVICES[idx % GARMIN_DEVICES.length];

    // Garmin-detected LTHR is the preferred source; 3 athletes use coach-approved manual fallback
    const garminDetectedLthrBpm = spec.useManualFallback ? null : spec.lthrBpm;
    const garminLthrDetectedDate = spec.useManualFallback ? null : '2026-10-11';

    const lthrHistory: LthrRecord[] = spec.useManualFallback
      ? [
          {
            id: `${athleteId}-lthr-v1`,
            version: 1,
            lthrBpm: spec.lthrBpm,
            recordedDate: '2026-08-31',
            effectiveDate: '2026-08-31',
            source: 'Coach-Approved Manual Fallback',
            coachVerified: spec.lthrVerified,
            verifiedBy: spec.lthrVerified ? 'Head Coach' : undefined,
            verifiedAt: spec.lthrVerified ? '2026-08-31' : undefined,
            optionalThresholdPaceSecPerMile: spec.thresholdPaceSec,
            optionalThresholdPowerWatts: spec.optionalPowerWatts,
            notes: 'No Garmin chest-strap auto-detection available; coach-approved manual fallback.',
          },
        ]
      : [
          {
            id: `${athleteId}-lthr-v1`,
            version: 1,
            lthrBpm: spec.lthrBpm - 2,
            recordedDate: '2026-08-18',
            effectiveDate: '2026-08-31',
            source: 'Garmin Auto-Detected',
            garminDeviceLabel: garminDevice,
            coachVerified: true,
            verifiedBy: 'Head Coach',
            verifiedAt: '2026-08-19',
            optionalThresholdPaceSecPerMile: spec.thresholdPaceSec + 6,
            optionalThresholdPowerWatts: spec.optionalPowerWatts ? spec.optionalPowerWatts - 8 : null,
            notes: 'Garmin auto-detected LTHR from steady-state outdoor run.',
          },
          {
            id: `${athleteId}-lthr-v2`,
            version: 2,
            lthrBpm: spec.lthrBpm,
            recordedDate: '2026-10-11',
            effectiveDate: '2026-10-12',
            source: 'Garmin Auto-Detected',
            garminDeviceLabel: garminDevice,
            coachVerified: spec.lthrVerified,
            verifiedBy: spec.lthrVerified ? 'Head Coach' : undefined,
            verifiedAt: spec.lthrVerified ? '2026-10-12' : undefined,
            optionalThresholdPaceSecPerMile: spec.thresholdPaceSec,
            optionalThresholdPowerWatts: spec.optionalPowerWatts,
            notes: spec.lthrVerified
              ? 'Garmin auto-detected LTHR update confirmed by coach.'
              : 'Garmin auto-detected +2 bpm LTHR shift awaiting coach review.',
          },
        ];

    const hrZoneConfig: HrZoneConfig = {
      methodology:
        idx % 5 === 0
          ? 'polarized_seiler'
          : idx % 4 === 0
          ? 'coggan_endurance'
          : 'friel_running',
      updatedAt: '2026-10-12T09:00:00Z',
    };

    const workouts: Workout[] = [];
    let sevenDayGarminLoad = 0;

    for (let week = 1; week <= 12; week++) {
      let weekMultiplier = 0.86 + (week - 1) * 0.018;
      if (week === 4 || week === 8) weekMultiplier *= 0.85;

      if (spec.profileTrait === 'taper' && week >= 11) {
        weekMultiplier = week === 11 ? 0.78 : 0.62;
      }
      if (spec.profileTrait === 'spike' && week === 11) {
        weekMultiplier *= 1.34;
      }

      const plannedWeekMiles = spec.baseWeeklyMiles * weekMultiplier;

      for (const slot of WEEKLY_TEMPLATE) {
        const dayIndex = (week - 1) * 7 + slot.dayOffset;
        const date = addDaysIso(START_DATE, dayIndex);
        const isFutureDay = date > '2026-11-18';

        const plannedMiles =
          slot.type === 'Rest' ? 0 : Number((plannedWeekMiles * slot.pct).toFixed(1));

        let status: WorkoutStatus = 'Completed';
        let actualMiles = plannedMiles;

        if (slot.type === 'Rest') {
          status = 'Completed';
          actualMiles = 0;
        } else if (isFutureDay) {
          status = 'Planned';
          actualMiles = 0;
        } else {
          const roll = rng();
          const cutbackThreshold =
            spec.profileTrait === 'lowCompliance' && week >= 10
              ? 0.36
              : spec.profileTrait === 'lowCompliance'
              ? 0.18
              : 0.06;

          if (roll < cutbackThreshold) {
            status = 'Completed';
            actualMiles = Number((plannedMiles * (0.65 + rng() * 0.2)).toFixed(1));
          } else {
            actualMiles = Number((plannedMiles * (0.95 + rng() * 0.1)).toFixed(1));
          }
        }

        const resolvedThreshold = resolveThresholdForDate(lthrHistory, date);
        let paceSec: number | null = null;
        let avgHr: number | null = null;
        let maxHr: number | null = null;
        let avgPower: number | null = null;
        let rpe: number | null = null;
        let durationMinutes = 0;

        if (slot.type !== 'Rest' && actualMiles > 0) {
          const fitnessGainSec = Math.round((week - 1) * 0.9);
          const easyPaceBase = spec.thresholdPaceSec + 95 - fitnessGainSec;

          if (slot.type === 'Recovery') {
            paceSec = Math.round(easyPaceBase + 25 + (rng() * 14 - 7));
            avgHr = Math.round(resolvedThreshold.lthrBpm * (0.75 + rng() * 0.04));
            rpe = 3;
          } else if (slot.type === 'Easy') {
            paceSec = Math.round(easyPaceBase + (rng() * 16 - 8));
            avgHr = Math.round(resolvedThreshold.lthrBpm * (0.83 + rng() * 0.04));
            rpe = 4;
          } else if (slot.type === 'Long Run') {
            paceSec = Math.round(easyPaceBase - 8 + (rng() * 14 - 7));
            avgHr = Math.round(resolvedThreshold.lthrBpm * (0.87 + rng() * 0.04));
            rpe = 6;
          } else if (slot.type === 'Tempo') {
            paceSec = Math.round(
              spec.thresholdPaceSec + 10 - fitnessGainSec * 0.6 + (rng() * 10 - 5)
            );
            avgHr = Math.round(resolvedThreshold.lthrBpm * (0.95 + rng() * 0.04));
            rpe = 7;
          } else if (slot.type === 'Intervals') {
            paceSec = Math.round(
              spec.thresholdPaceSec - 14 - fitnessGainSec * 0.5 + (rng() * 12 - 6)
            );
            avgHr = Math.round(resolvedThreshold.lthrBpm * (0.99 + rng() * 0.04));
            rpe = 8;
          }

          if (
            spec.profileTrait === 'hrDrift' &&
            week >= 11 &&
            (slot.type === 'Easy' || slot.type === 'Recovery') &&
            avgHr !== null
          ) {
            avgHr += 9 + Math.round(rng() * 4);
            rpe = 6;
          }

          maxHr = avgHr ? Math.min(spec.maxHr, avgHr + 11 + Math.round(rng() * 7)) : null;
          durationMinutes = paceSec ? Math.round((actualMiles * paceSec) / 60) : 0;

          if (spec.optionalPowerWatts && paceSec) {
            const paceRatio = spec.thresholdPaceSec / paceSec;
            avgPower = Math.round(spec.optionalPowerWatts * Math.pow(paceRatio, 1.15));
          }

          if (idx === 1 && week === 11 && slot.dayOffset === 3) {
            avgHr = 236;
            maxHr = 241;
          } else if (idx === 4 && week === 11 && slot.dayOffset === 5) {
            avgHr = null;
            maxHr = null;
          } else if (idx === 7 && week === 12 && slot.dayOffset === 1) {
            avgHr = 0;
            maxHr = 0;
          }
        }

        const validation = validateHeartRateReading({
          avgHrBpm: avgHr,
          maxHrBpm: maxHr,
          athleteMaxHrBpm: spec.maxHr,
          workoutType: slot.type,
          status,
          durationMinutes,
        });

        const stress = calculateHrRunningStress({
          durationMinutes,
          avgHrBpm: avgHr,
          lthrBpm: resolvedThreshold.lthrBpm,
          hrDataState: validation.hrDataState,
          avgPaceSecPerMile: paceSec,
          thresholdPaceSecPerMile:
            resolvedThreshold.optionalThresholdPaceSecPerMile ?? spec.thresholdPaceSec,
          avgPowerWatts: avgPower,
          thresholdPowerWatts:
            resolvedThreshold.optionalThresholdPowerWatts ?? spec.optionalPowerWatts,
          thresholdVersion: resolvedThreshold.version,
          calculatedAt: `${date}T12:00:00Z`,
        });

        const garminLoadVal =
          status === 'Completed'
            ? slot.type === 'Rest'
              ? 0
              : Math.round(
                  (stress.hrStress ?? durationMinutes * 1.15) * (0.94 + rng() * 0.18)
                )
            : null;

        if (garminLoadVal && date >= '2026-11-11' && date <= '2026-11-18') {
          sevenDayGarminLoad += garminLoadVal;
        }

        const garminMetrics: GarminActivityMetrics | undefined =
          slot.type !== 'Rest' && status === 'Completed'
            ? {
                garminTrainingLoad: garminLoadVal,
                aerobicTrainingEffect:
                  slot.type === 'Recovery'
                    ? 2.1
                    : slot.type === 'Easy'
                    ? 2.9
                    : slot.type === 'Long Run'
                    ? 3.8
                    : 4.1,
                anaerobicTrainingEffect:
                  slot.type === 'Intervals' ? 3.2 : slot.type === 'Tempo' ? 1.8 : 0.4,
                vo2MaxEstimate: Math.round(52 + (460 - spec.thresholdPaceSec) * 0.08),
                recoveryTimeHours:
                  slot.type === 'Long Run' || slot.type === 'Intervals' ? 36 : 18,
                providerLabel: 'Garmin Connect (Original Metric)',
              }
            : undefined;

        const source =
          slot.dayOffset % 2 === 0
            ? ('Garmin (Local Sample)' as const)
            : ('Final Surge (Local Sample)' as const);

        workouts.push({
          id: `${athleteId}-w${week}-d${slot.dayOffset}`,
          athleteId,
          date,
          weekIndex: week,
          title: slot.title,
          type: slot.type,
          status,
          plannedMiles,
          actualMiles,
          durationMinutes,
          avgPaceSecPerMile: paceSec,
          avgHrBpm: avgHr,
          maxHrBpm: maxHr,
          avgPowerWatts: avgPower,
          rpe,
          elevationGainFt:
            actualMiles > 0
              ? Math.round(
                  actualMiles * (spec.group === 'Ultra / Trail' ? 145 : 38) * (0.7 + rng() * 0.6)
                )
              : 0,
          zoneBreakdown: zoneMixForType(slot.type),
          hrDataState: validation.hrDataState,
          hrValidationFlags: validation.flags,
          stress,
          garminMetrics,
          provenance: {
            sourceProvider: source,
            ingestedAt: `${date}T11:45:00Z`,
            calculationMethod: 'HR-Derived Running Stress (hrRSS) · LTHR-Anchored',
            thresholdVersion: resolvedThreshold.version,
            thresholdSource: resolvedThreshold.source,
            lthrBpmUsed: resolvedThreshold.lthrBpm,
            originalValuesPreserved: true,
          },
          athleteNotes:
            spec.profileTrait === 'hrDrift' && week >= 11 && slot.type === 'Easy'
              ? 'Legs felt heavy, HR climbed in final 2 miles.'
              : undefined,
          source,
        });
      }
    }

    const garminBiometrics: GarminAthleteBiometrics = {
      garminDetectedLthrBpm,
      garminLthrDetectedDate,
      garminLthrDevice: garminDetectedLthrBpm ? garminDevice : null,
      garminVo2Max: Math.round(52 + (460 - spec.thresholdPaceSec) * 0.08),
      garminHrvStatus:
        spec.profileTrait === 'hrDrift'
          ? 'Unbalanced'
          : spec.profileTrait === 'spike'
          ? 'Low'
          : 'Balanced',
      garminTrainingStatus:
        spec.profileTrait === 'spike'
          ? 'Strained'
          : spec.profileTrait === 'taper'
          ? 'Peaking'
          : spec.profileTrait === 'lowCompliance'
          ? 'Recovery'
          : spec.profileTrait === 'hrDrift'
          ? 'Maintaining'
          : 'Productive',
      garminRestingHrBpm: spec.restingHr,
      garmin7DayLoad: Math.round(sevenDayGarminLoad),
      garminAcuteLoad: Math.round(sevenDayGarminLoad),
      garminChronicLoad: Math.round(sevenDayGarminLoad * (spec.profileTrait === 'spike' ? 0.78 : 0.96)),
      garminLoadFocus:
        spec.profileTrait === 'spike'
          ? 'High Aerobic'
          : spec.group === '10K / 5K Track'
          ? 'Anaerobic'
          : 'Low Aerobic',
      lastSyncedAt:
        idx === 16
          ? '2026-11-12T08:15:00Z (Local Sample)'
          : idx === 25
          ? '2026-11-14T19:40:00Z (Local Sample)'
          : idx === 27
          ? '2026-11-15T07:10:00Z (Local Sample)'
          : '2026-11-18T11:30:00Z (Local Sample)',
      providerNote:
        'Original Garmin physiological values preserved; Garmin Connect API is disconnected.',
    };

    const raceHistory: RaceResult[] = [
      {
        id: `${athleteId}-r1`,
        date: '2026-09-27',
        raceName: `${spec.location.split(',')[0]} Autumn 10K Tune-Up`,
        distanceLabel: '10K',
        distanceMiles: 6.21,
        finishTimeSeconds: Math.round((spec.thresholdPaceSec + 4) * 6.21),
        avgPaceSecPerMile: spec.thresholdPaceSec + 4,
        avgHrBpm: Math.round(spec.lthrBpm * 1.01),
        placementNote: 'Top 15% AG',
        isPR: idx % 3 === 0,
      },
      {
        id: `${athleteId}-r2`,
        date: '2026-05-16',
        raceName: 'Spring Classic Half Marathon',
        distanceLabel: 'Half Marathon',
        distanceMiles: 13.11,
        finishTimeSeconds: Math.round((spec.thresholdPaceSec + 24) * 13.11),
        avgPaceSecPerMile: spec.thresholdPaceSec + 24,
        avgHrBpm: Math.round(spec.lthrBpm * 0.96),
        placementNote: 'Strong negative split',
        isPR: idx % 4 === 0,
      },
      {
        id: `${athleteId}-r3`,
        date: '2025-11-08',
        raceName: 'Midwest Fall 5K',
        distanceLabel: '5K',
        distanceMiles: 3.11,
        finishTimeSeconds: Math.round((spec.thresholdPaceSec - 14) * 3.11),
        avgPaceSecPerMile: spec.thresholdPaceSec - 14,
        avgHrBpm: Math.round(spec.lthrBpm * 1.04),
        placementNote: '3rd in Age Group',
        isPR: false,
      },
    ];

    const latestVersion = lthrHistory[lthrHistory.length - 1].version;

    return {
      id: athleteId,
      finalSurgeId: `FS-${40210 + idx}`,
      name: spec.name,
      email: `${spec.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      age: spec.age,
      gender: spec.gender,
      location: spec.location,
      trainingGroup: spec.group,
      experienceYears: 2 + (idx % 10),
      restingHrBpm: spec.restingHr,
      maxHrBpm: spec.maxHr,
      lthrBpm: spec.lthrBpm,
      activeThresholdVersion: latestVersion,
      lthrHistory,
      hrZoneConfig,
      thresholdPaceSecPerMile: spec.thresholdPaceSec,
      optionalThresholdPowerWatts: spec.optionalPowerWatts,
      currentPhase: spec.phase,
      goal: {
        raceName: spec.raceName,
        raceDate: spec.raceDate,
        distanceLabel: spec.raceDist,
        distanceMiles: spec.raceMiles,
        targetTimeSeconds: spec.targetSec,
        priority: 'A',
      },
      coachNotes:
        spec.profileTrait === 'spike'
          ? 'Watch acute load jump and verify HR sensor reading on Nov 12 shakeout.'
          : spec.profileTrait === 'hrDrift'
          ? 'Monitor aerobic %LTHR decoupling and hydration on mid-week easy runs.'
          : spec.profileTrait === 'lowCompliance'
          ? 'Check in on weekday schedule barriers before adding quality volume.'
          : `Responding well to ${spec.phase.toLowerCase()} block; prioritize sleep before long run.`,
      garminBiometrics,
      recalculationLog: [],
      workouts,
      raceHistory,
    };
  });
}
