import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from './supabaseAdmin.ts';
import {
  getOAuthPersistenceStore,
  type OAuthPersistenceStore,
  type PersistedProviderConnection,
} from './oauthStore.ts';

export type WorkoutTypeCanonical =
  | 'Easy'
  | 'Long Run'
  | 'Tempo'
  | 'Intervals'
  | 'Recovery'
  | 'Race'
  | 'Rest';

export type TargetZoneCanonical = 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5';

export interface FinalSurgeFeedEntryEncrypted {
  athleteId: string;
  feedUrl: string;
  externalAthleteId: string | null;
  label: string | null;
  addedAt: string;
  lastVerifiedAt: string | null;
  lastEventCount: number | null;
}

interface EncryptedFinalSurgeVault {
  feedsByAthleteId: Record<string, FinalSurgeFeedEntryEncrypted>;
}

export interface FinalSurgeParsedPlannedEvent {
  uid: string;
  workoutDate: string;
  plannedStartTime: string | null;
  title: string;
  description: string;
  categories: string[];
  cancelled: boolean;
  lastModified: string | null;
  workoutType: WorkoutTypeCanonical;
  plannedMiles: number;
  plannedDurationMin: number;
  targetPaceSecPerMile: number | null;
  targetZone: TargetZoneCanonical | null;
  originalDistanceValue: number | null;
  originalDistanceUnit: 'mi' | 'km' | 'm' | null;
  originalDurationText: string | null;
  originalPaceText: string | null;
  structuredSteps: string[];
  rawLines: string[];
}

export interface FinalSurgeIntegrationMetadata {
  officialLiveMethod: string;
  officialExportMethod: string;
  partnerOAuthAvailable: boolean;
  partnerOAuthNotice: string;
  references: Array<{ title: string; summary: string }>;
  limitations: string[];
}

export interface FinalSurgeMappedAthleteView {
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

export interface FinalSurgeStatusResponse {
  ok: boolean;
  configured: boolean;
  connected: boolean;
  authMode: string;
  connectionState:
    | 'Connected (Read-Only Calendar Sync)'
    | 'Configured (Verification Pending)'
    | 'Disconnected'
    | 'Partner OAuth Unavailable';
  metadata: FinalSurgeIntegrationMetadata;
  lastVerifiedAt: string | null;
  lastSynchronizedAt: string | null;
  mappedAthletes: FinalSurgeMappedAthleteView[];
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

export interface FinalSurgeFeedTestResult {
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
    workoutType: WorkoutTypeCanonical;
    plannedMiles: number;
    plannedDurationMin: number;
    originalDistanceLabel: string | null;
  }>;
  warnings: string[];
  errorMessage: string | null;
  verifiedAt: string;
}

export interface FinalSurgeSyncResult {
  ok: boolean;
  statusCode: number;
  status: 'Succeeded' | 'Partial' | 'Failed' | 'Blocked (Unauthorized)';
  syncLogId: string | null;
  jobType: 'backfill_12w' | 'daily_activity_import' | 'finalsurge_csv_import';
  mode: 'initial' | 'incremental' | 'import_ics' | 'import_csv';
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

const DEFAULT_FETCH_TIMEOUT_MS = 12000;

export function getFinalSurgeIntegrationMetadata(): FinalSurgeIntegrationMetadata {
  const hasPartnerOAuth = Boolean(
    process.env.FINALSURGE_CLIENT_ID?.trim() && process.env.FINALSURGE_CLIENT_SECRET?.trim()
  );
  return {
    officialLiveMethod: 'Official Final Surge Calendar Sync (Read-Only iCalendar .ics Feed)',
    officialExportMethod: 'Official Final Surge Workout Export (.ics File or Coach CSV)',
    partnerOAuthAvailable: hasPartnerOAuth,
    partnerOAuthNotice: hasPartnerOAuth
      ? 'Partner OAuth credentials detected alongside official iCalendar feed support.'
      : 'Final Surge does not publish an open self-serve REST API or public OAuth 2.0 developer portal; Partner OAuth requires direct commercial Final Surge approval. Official iCalendar (.ics) Calendar Sync and Coach Export (.ics / CSV) are used instead.',
    references: [
      {
        title: 'Final Surge Calendar Sync (Official Read-Only iCalendar .ics Feed)',
        summary:
          'Generated in Final Surge under Settings → Calendar Sync → Turn On. Provides a unique private per-athlete .ics feed URL for scheduled workouts that updates automatically when the coach changes or deletes workouts.',
      },
      {
        title: 'Final Surge Export Workflow (Official .ics / CSV Historical Backfill)',
        summary:
          'Exports historical or offline planned schedules cleanly when a calendar feed only exposes a rolling horizon.',
      },
    ],
    limitations: [
      'Each official Calendar Sync URL is scoped to a single Final Surge athlete and must be treated as a private secret URL.',
      'iCalendar (.ics) feeds expose workout dates, times, titles, and coach descriptions/instructions; device-level FIT/JSON multi-step watch targets remain proprietary to watch sync.',
      'Historical months outside the rolling calendar feed window require an exported .ics or CSV upload.',
      'Workout completion & HR telemetry continue to come from Intervals.icu / watch summaries.',
    ],
  };
}

function isBlockedPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((n) => Number(n));
    if (octets.some((o) => o < 0 || o > 255)) return true;
    const [a, b] = octets;
    if (a === 127) return true; // Loopback 127.0.0.0/8
    if (a === 10) return true; // RFC 1918 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918 172.16.0.0/12
    if (a === 192 && b === 168) return true; // RFC 1918 192.168.0.0/16
    if (a === 169 && b === 254) return true; // Link-local / Cloud Metadata 169.254.0.0/16
    if (a === 0) return true;
  }

  // IPv6 ULA / link-local
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  return false;
}

export function normalizeAndValidateFinalSurgeFeedUrl(
  rawUrl: string,
  options?: { allowCustomHostForTesting?: boolean }
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'Final Surge Calendar Sync URL is required.' };
  }

  const candidate = trimmed.replace(/^webcal:\/\//i, 'https://');
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'Invalid Final Surge Calendar Sync URL format.' };
  }

  if (parsed.protocol !== 'https:' && !(options?.allowCustomHostForTesting && parsed.protocol === 'http:')) {
    return {
      ok: false,
      error: 'Final Surge Calendar Sync URL must use HTTPS (or webcal:// which upgrades to HTTPS).',
    };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Feed URL must not embed credentials in userinfo.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!options?.allowCustomHostForTesting) {
    if (isBlockedPrivateOrLoopbackHost(hostname)) {
      return { ok: false, error: 'Private, loopback, or metadata network addresses are not permitted.' };
    }
    const isFinalSurgeDomain = hostname === 'finalsurge.com' || hostname.endsWith('.finalsurge.com');
    if (!isFinalSurgeDomain) {
      return {
        ok: false,
        error: 'Calendar Sync URL must point to an official finalsurge.com domain.',
      };
    }
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

export function maskFeedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.replace(/^webcal:\/\//i, 'https://'));
    const pathTail = parsed.pathname.slice(-4);
    const suffix = pathTail.length >= 4 ? `****${pathTail}` : '****';
    return `${parsed.protocol}//${parsed.host}/.../${suffix}`;
  } catch {
    return 'https://finalsurge.com/.../****';
  }
}

export function redactSensitiveText(text: string, secretsToMask: Array<string | null | undefined> = []): string {
  let out = text;
  for (const s of secretsToMask) {
    if (s && s.trim().length > 4) {
      out = out.split(s).join('[REDACTED_FEED_URL]');
    }
  }
  out = out.replace(/https?:\/\/[^\s"'<>]*finalsurge\.com[^\s"'<>]*/gi, (m) => maskFeedUrl(m) ?? '[REDACTED_URL]');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
  out = out.replace(/([?&](?:token|key|id|auth|secret|sig)=)[^&\s]+/gi, '$1[REDACTED]');
  return out;
}

function sha256Hex(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function unescapeIcsText(raw: string): string {
  return raw
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDateTime(rawKey: string, rawVal: string): { dateIso: string; timeIso: string | null } | null {
  const val = rawVal.trim();
  const isDateOnly = /VALUE=DATE\b/i.test(rawKey) || /^\d{8}$/.test(val);
  const dateMatch = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?/);
  if (!dateMatch) return null;

  const [, y, m, d, hh, mm, ss] = dateMatch;
  const dateIso = `${y}-${m}-${d}`;
  if (isDateOnly || hh === undefined) {
    return { dateIso, timeIso: null };
  }
  return { dateIso, timeIso: `${hh}:${mm}:${ss}` };
}

function parseIsoDurationMinutes(raw: string): number | null {
  const m = raw.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const mins = Number(m[3] ?? 0);
  const secs = Number(m[4] ?? 0);
  const total = days * 1440 + hours * 60 + mins + secs / 60;
  return total > 0 ? Number(total.toFixed(2)) : null;
}

function inferWorkoutType(title: string, description: string, categories: string[]): WorkoutTypeCanonical {
  const hay = `${categories.join(' ')} ${title} ${description}`.toLowerCase();
  if (/\brest\s*day\b|\boff\s*day\b|^rest$/i.test(title.trim()) || /\brest\b/.test(categories.join(' ').toLowerCase())) {
    return 'Rest';
  }
  if (/\brace\b|\b5k\s*race\b|\b10k\s*race\b|\bhalf\s*marathon\s*race\b|\bmarathon\s*race\b/.test(hay)) {
    return 'Race';
  }
  if (
    /\binterval\b|\brepeat\b|\btrack\b|\bfartlek\b|\bvo2\b|\bstrides\b|\b\d+\s*x\s*\d+\s*(?:m|km|mi|min|sec)\b/.test(
      hay
    )
  ) {
    return 'Intervals';
  }
  if (/\btempo\b|\bthreshold\b|\blt\b|\blactate\b|\bcruise\b|\bsteady\s*state\b/.test(hay)) {
    return 'Tempo';
  }
  if (/\blong\s*run\b|\blsd\b|\bprogression\s*long\b/.test(hay)) {
    return 'Long Run';
  }
  if (/\brecovery\b|\bshakeout\b/.test(hay)) {
    return 'Recovery';
  }
  return 'Easy';
}

function extractDistanceInfo(text: string): {
  plannedMiles: number;
  originalDistanceValue: number | null;
  originalDistanceUnit: 'mi' | 'km' | 'm' | null;
} {
  // Match miles first (e.g., "8 mi", "8.5 miles", "10mi")
  const mileMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (mileMatch) {
    const val = Number(mileMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 200) {
      return {
        plannedMiles: Number(val.toFixed(2)),
        originalDistanceValue: val,
        originalDistanceUnit: 'mi',
      };
    }
  }

  // Match kilometers (e.g., "10 km", "16.1km", "5k")
  const kmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kilometers?|km)\b/i) ?? text.match(/\b(\d+(?:\.\d+)?)k\b/i);
  if (kmMatch) {
    const val = Number(kmMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 350) {
      return {
        plannedMiles: Number((val * 0.621371).toFixed(2)),
        originalDistanceValue: val,
        originalDistanceUnit: 'km',
      };
    }
  }

  // Match explicit meters only if > 200m and not HR/pace context
  const mMatch = text.match(/total\s*(\d{3,5})\s*m\b/i);
  if (mMatch) {
    const val = Number(mMatch[1]);
    if (Number.isFinite(val) && val >= 400 && val <= 100000) {
      return {
        plannedMiles: Number((val / 1609.344).toFixed(2)),
        originalDistanceValue: val,
        originalDistanceUnit: 'm',
      };
    }
  }

  return {
    plannedMiles: 0,
    originalDistanceValue: null,
    originalDistanceUnit: null,
  };
}

function extractDurationInfo(text: string, fallbackSpanMinutes: number | null): {
  plannedDurationMin: number;
  originalDurationText: string | null;
} {
  const hmMatch = text.match(/\b(\d+)\s*(?:hr|hrs|hour|hours|h)\s*(\d{1,2})\s*(?:min|mins|m)\b/i);
  if (hmMatch) {
    const total = Number(hmMatch[1]) * 60 + Number(hmMatch[2]);
    return { plannedDurationMin: total, originalDurationText: hmMatch[0] };
  }

  const minMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins|min)\b/i);
  if (minMatch) {
    const val = Number(minMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 1440) {
      return { plannedDurationMin: Number(val.toFixed(1)), originalDurationText: minMatch[0] };
    }
  }

  const hrOnlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs|hr)\b/i);
  if (hrOnlyMatch) {
    const val = Number(hrOnlyMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 24) {
      return {
        plannedDurationMin: Number((val * 60).toFixed(1)),
        originalDurationText: hrOnlyMatch[0],
      };
    }
  }

  if (fallbackSpanMinutes !== null && fallbackSpanMinutes > 0 && fallbackSpanMinutes <= 360) {
    return {
      plannedDurationMin: fallbackSpanMinutes,
      originalDurationText: `${fallbackSpanMinutes} min (calendar span)`,
    };
  }

  return { plannedDurationMin: 0, originalDurationText: null };
}

function extractTargetPaceAndZone(text: string): {
  targetPaceSecPerMile: number | null;
  originalPaceText: string | null;
  targetZone: TargetZoneCanonical | null;
} {
  let targetPaceSecPerMile: number | null = null;
  let originalPaceText: string | null = null;

  const paceMatch = text.match(/(\d{1,2}):([0-5]\d)\s*(?:\/\s*(mi|mile|km)|per\s*(mile|mi|km))?/i);
  if (paceMatch && (/\/|pace|@|per\s*(?:mi|km)/i.test(text))) {
    const min = Number(paceMatch[1]);
    const sec = Number(paceMatch[2]);
    if (min >= 3 && min <= 20) {
      const rawSec = min * 60 + sec;
      const unit = (paceMatch[3] ?? paceMatch[4] ?? 'mi').toLowerCase();
      originalPaceText = paceMatch[0].trim();
      targetPaceSecPerMile = unit === 'km' ? Math.round(rawSec * 1.609344) : rawSec;
    }
  }

  let targetZone: TargetZoneCanonical | null = null;
  const zoneMatch = text.match(/\b(?:zone\s*|z)\s*([1-5])\b/i);
  if (zoneMatch) {
    targetZone = `Z${zoneMatch[1]}` as TargetZoneCanonical;
  }

  return { targetPaceSecPerMile, originalPaceText, targetZone };
}

export function parseFinalSurgeIcsFeed(
  icsText: string
): {
  ok: boolean;
  events: FinalSurgeParsedPlannedEvent[];
  warnings: string[];
  errorMessage: string | null;
} {
  const normalized = icsText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!/BEGIN:VCALENDAR/i.test(normalized)) {
    return {
      ok: false,
      events: [],
      warnings: [],
      errorMessage: 'Response is not a valid iCalendar (.ics) feed (missing BEGIN:VCALENDAR).',
    };
  }

  // RFC 5545 line unfolding (lines starting with space or tab continue previous line)
  const unfolded = normalized.replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');

  const events: FinalSurgeParsedPlannedEvent[] = [];
  const warnings: string[] = [];
  let inEvent = false;
  let currentProps: Array<{ key: string; baseKey: string; value: string; rawLine: string }> = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      inEvent = true;
      currentProps = [];
      continue;
    }

    if (line.toUpperCase() === 'END:VEVENT') {
      if (inEvent) {
        const getProp = (name: string) => currentProps.find((p) => p.baseKey === name);
        const uidProp = getProp('UID');
        const dtStartProp = getProp('DTSTART');
        const dtEndProp = getProp('DTEND');
        const durProp = getProp('DURATION');
        const summaryProp = getProp('SUMMARY');
        const descProp = getProp('DESCRIPTION');
        const catProp = getProp('CATEGORIES');
        const statusProp = getProp('STATUS');
        const modProp = getProp('LAST-MODIFIED');

        const parsedStart = dtStartProp
          ? parseIcsDateTime(dtStartProp.key, dtStartProp.value)
          : null;

        if (!parsedStart) {
          warnings.push('Skipped a calendar VEVENT missing valid DTSTART.');
        } else {
          const title = unescapeIcsText(summaryProp?.value ?? '') || 'Planned Run';
          const description = unescapeIcsText(descProp?.value ?? '');
          const categories = catProp
            ? unescapeIcsText(catProp.value)
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean)
            : [];
          const cancelled = (statusProp?.value ?? '').trim().toUpperCase() === 'CANCELLED';

          let fallbackSpanMinutes: number | null = null;
          if (durProp) {
            fallbackSpanMinutes = parseIsoDurationMinutes(durProp.value);
          } else if (dtEndProp && parsedStart.timeIso) {
            const parsedEnd = parseIcsDateTime(dtEndProp.key, dtEndProp.value);
            if (parsedEnd?.timeIso) {
              const startMs = Date.parse(`${parsedStart.dateIso}T${parsedStart.timeIso}Z`);
              const endMs = Date.parse(`${parsedEnd.dateIso}T${parsedEnd.timeIso}Z`);
              if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
                fallbackSpanMinutes = Math.round((endMs - startMs) / 60000);
              }
            }
          }

          const combinedText = `${title}\n${description}`;
          const workoutType = inferWorkoutType(title, description, categories);
          const titleDistInfo = extractDistanceInfo(title);
          const distInfo =
            titleDistInfo.plannedMiles > 0 ? titleDistInfo : extractDistanceInfo(description);
          const durInfo = extractDurationInfo(combinedText, fallbackSpanMinutes);
          const paceZoneInfo = extractTargetPaceAndZone(combinedText);

          const structuredSteps = description
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);

          const uid =
            uidProp?.value.trim() ||
            `fs-ics-${parsedStart.dateIso}-${crypto
              .createHash('sha1')
              .update(`${parsedStart.dateIso}|${title}`)
              .digest('hex')
              .slice(0, 12)}`;

          events.push({
            uid,
            workoutDate: parsedStart.dateIso,
            plannedStartTime: parsedStart.timeIso,
            title,
            description,
            categories,
            cancelled,
            lastModified: modProp?.value.trim() ?? null,
            workoutType,
            plannedMiles: distInfo.plannedMiles,
            plannedDurationMin: durInfo.plannedDurationMin,
            targetPaceSecPerMile: paceZoneInfo.targetPaceSecPerMile,
            targetZone: paceZoneInfo.targetZone,
            originalDistanceValue: distInfo.originalDistanceValue,
            originalDistanceUnit: distInfo.originalDistanceUnit,
            originalDurationText: durInfo.originalDurationText,
            originalPaceText: paceZoneInfo.originalPaceText,
            structuredSteps,
            rawLines: currentProps.map((p) => p.rawLine),
          });
        }
      }
      inEvent = false;
      currentProps = [];
      continue;
    }

    if (inEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const baseKey = key.split(';')[0].toUpperCase();
        const value = line.slice(colonIdx + 1);
        currentProps.push({ key, baseKey, value, rawLine: line });
      }
    }
  }

  return { ok: true, events, warnings, errorMessage: null };
}

function splitCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseFinalSurgePlannedCsv(csvText: string): {
  ok: boolean;
  events: FinalSurgeParsedPlannedEvent[];
  warnings: string[];
  errorMessage: string | null;
} {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      ok: false,
      events: [],
      warnings: [],
      errorMessage: 'CSV export must include a header row and at least one planned workout row.',
    };
  }

  const headers = splitCsvRow(lines[0]).map((h) => h.toLowerCase());
  const idx = (candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const iDate = idx(['date']);
  const iTime = idx(['time', 'start']);
  const iTitle = idx(['title', 'workout', 'name']);
  const iType = idx(['type', 'category']);
  const iDist = idx(['distance', 'miles', 'km']);
  const iUnit = idx(['unit']);
  const iDur = idx(['duration', 'minutes', 'mins']);
  const iPace = idx(['pace']);
  const iZone = idx(['zone']);
  const iDesc = idx(['description', 'notes', 'instructions', 'details']);
  const iUid = idx(['external', 'uid', 'id']);

  const events: FinalSurgeParsedPlannedEvent[] = [];
  const warnings: string[] = [];

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvRow(lines[r]);
    const dateVal = iDate >= 0 ? cols[iDate] ?? '' : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      warnings.push(`Row ${r + 1}: skipped missing/invalid YYYY-MM-DD date ("${dateVal}").`);
      continue;
    }

    const title = (iTitle >= 0 && cols[iTitle]) || 'Planned Workout';
    const description = (iDesc >= 0 && cols[iDesc]) || '';
    const rawType = iType >= 0 ? cols[iType] ?? '' : '';
    const workoutType = inferWorkoutType(title, description, rawType ? [rawType] : []);

    let plannedMiles = 0;
    let originalDistanceValue: number | null = null;
    let originalDistanceUnit: 'mi' | 'km' | 'm' | null = null;
    if (iDist >= 0 && cols[iDist]) {
      const distNum = Number(cols[iDist]);
      const unitStr = (iUnit >= 0 ? cols[iUnit] : '').toLowerCase();
      if (Number.isFinite(distNum) && distNum > 0) {
        originalDistanceValue = distNum;
        if (unitStr.includes('km') || headers[iDist]?.includes('km')) {
          originalDistanceUnit = 'km';
          plannedMiles = Number((distNum * 0.621371).toFixed(2));
        } else {
          originalDistanceUnit = 'mi';
          plannedMiles = Number(distNum.toFixed(2));
        }
      }
    }

    const durNum = iDur >= 0 && cols[iDur] ? Number(cols[iDur]) : 0;
    const plannedDurationMin = Number.isFinite(durNum) && durNum > 0 ? Number(durNum.toFixed(1)) : 0;

    const paceRaw = iPace >= 0 ? cols[iPace] ?? '' : '';
    const zoneRaw = iZone >= 0 ? cols[iZone] ?? '' : '';
    const paceZone = extractTargetPaceAndZone(`${paceRaw} ${zoneRaw} ${description}`);

    const uid =
      (iUid >= 0 && cols[iUid]) ||
      `fs-csv-${dateVal}-${crypto
        .createHash('sha1')
        .update(`${dateVal}|${title}|${r}`)
        .digest('hex')
        .slice(0, 10)}`;

    const rawTime = iTime >= 0 ? cols[iTime] ?? '' : '';
    const timeIso = /^\d{2}:\d{2}(?::\d{2})?$/.test(rawTime)
      ? rawTime.length === 5
        ? `${rawTime}:00`
        : rawTime
      : null;

    events.push({
      uid,
      workoutDate: dateVal,
      plannedStartTime: timeIso,
      title,
      description,
      categories: rawType ? [rawType] : [],
      cancelled: false,
      lastModified: null,
      workoutType,
      plannedMiles,
      plannedDurationMin,
      targetPaceSecPerMile: paceZone.targetPaceSecPerMile,
      targetZone: paceZone.targetZone,
      originalDistanceValue,
      originalDistanceUnit,
      originalDurationText: plannedDurationMin > 0 ? `${plannedDurationMin} min` : null,
      originalPaceText: paceZone.originalPaceText,
      structuredSteps: description
        .split(/\n+|;\s*/)
        .map((s) => s.trim())
        .filter(Boolean),
      rawLines: [lines[r]],
    });
  }

  return { ok: true, events, warnings, errorMessage: null };
}

async function fetchFeedWithRetry(params: {
  url: string;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<{ ok: true; body: string } | { ok: false; statusCode: number; error: string }> {
  const fetcher = params.fetcher ?? fetch;
  const sleep = params.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = params.maxAttempts ?? 3;

  let lastError = 'Unable to reach Final Surge calendar feed.';
  let lastStatus = 502;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
      const res = await fetcher(params.url, {
        method: 'GET',
        headers: {
          Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
          'User-Agent': 'MythicalMileCoaching-CalendarSync/1.0',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const body = await res.text();
        return { ok: true, body };
      }

      lastStatus = res.status;
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return {
          ok: false,
          statusCode: res.status,
          error: `Final Surge returned HTTP ${res.status}. Verify that Calendar Sync is turned ON in Final Surge and the feed URL is current.`,
        };
      }

      lastError = `Final Surge calendar feed returned HTTP ${res.status}.`;
    } catch (err) {
      lastStatus = 503;
      lastError = err instanceof Error ? err.message : 'Network failure while fetching Final Surge feed.';
    }

    if (attempt < maxAttempts) {
      const backoffMs = 250 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }
  }

  return {
    ok: false,
    statusCode: lastStatus,
    error: redactSensitiveText(lastError, [params.url]),
  };
}

async function loadVault(coachId: string, store: OAuthPersistenceStore): Promise<EncryptedFinalSurgeVault> {
  const creds = await store.getDecryptedCredentials(coachId, 'final_surge').catch(() => null);
  if (!creds?.accessToken) {
    return { feedsByAthleteId: {} };
  }
  try {
    const parsed = JSON.parse(creds.accessToken) as Partial<EncryptedFinalSurgeVault>;
    return {
      feedsByAthleteId:
        parsed && parsed.feedsByAthleteId && typeof parsed.feedsByAthleteId === 'object'
          ? parsed.feedsByAthleteId
          : {},
    };
  } catch {
    return { feedsByAthleteId: {} };
  }
}

async function saveVault(params: {
  coachId: string;
  vault: EncryptedFinalSurgeVault;
  store: OAuthPersistenceStore;
  externalCoachId?: string | null;
  externalCoachName?: string | null;
}): Promise<void> {
  await params.store.saveEncryptedCredentials({
    coachId: params.coachId,
    provider: 'final_surge',
    authMode: 'api_key',
    accessToken: JSON.stringify(params.vault),
    scope: 'CALENDAR:READ_ICS',
    externalCoachId: params.externalCoachId ?? 'finalsurge_calendar_sync',
    externalCoachName: params.externalCoachName ?? 'Final Surge Calendar Sync (Read-Only)',
  });
}

async function appendAuditEvent(
  client: SupabaseClient,
  payload: {
    coachId: string;
    action: string;
    targetEntity: string;
    targetId?: string | null;
    athleteIdSnapshot?: string | null;
    detail: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client
    .from('audit_events')
    .insert({
      coach_id: payload.coachId,
      actor_role: 'owner_coach',
      action: payload.action,
      target_entity: payload.targetEntity,
      target_id: payload.targetId ?? null,
      athlete_id_snapshot: payload.athleteIdSnapshot ?? null,
      detail: redactSensitiveText(payload.detail),
      metadata: payload.metadata ?? {},
    })
    .then(() => undefined, () => undefined);
}

export async function getFinalSurgeStatusForCoach(options: {
  coachId?: string;
  includeSensitiveDetails?: boolean;
  oauthStore?: OAuthPersistenceStore;
  supabaseClient?: SupabaseClient | null;
}): Promise<FinalSurgeStatusResponse> {
  const store = options.oauthStore ?? getOAuthPersistenceStore();
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const metadata = getFinalSurgeIntegrationMetadata();

  if (!options.coachId || !options.includeSensitiveDetails) {
    return {
      ok: true,
      configured: false,
      connected: false,
      authMode: 'unconfigured',
      connectionState: 'Disconnected',
      metadata,
      lastVerifiedAt: null,
      lastSynchronizedAt: null,
      mappedAthletes: [],
      availableAthletes: [],
      syncLogs: [],
    };
  }

  let conn: PersistedProviderConnection | null = null;
  try {
    conn = await store.getProviderConnection(options.coachId, 'final_surge');
  } catch {
    conn = null;
  }

  const vault = await loadVault(options.coachId, store);
  const feedEntries = Object.values(vault.feedsByAthleteId);
  const configured = feedEntries.length > 0 || metadata.partnerOAuthAvailable;
  const connected = Boolean(conn?.connected && feedEntries.length > 0);

  let mappedAthletes: FinalSurgeMappedAthleteView[] = [];
  let availableAthletes: FinalSurgeStatusResponse['availableAthletes'] = [];
  let syncLogs: FinalSurgeStatusResponse['syncLogs'] = [];

  if (client) {
    const [athRes, mapRes, plannedRes, logsRes] = await Promise.all([
      client
        .from('athletes')
        .select('id, full_name, email')
        .eq('coach_id', options.coachId)
        .order('full_name', { ascending: true }),
      client
        .from('provider_athlete_mappings')
        .select('*')
        .eq('coach_id', options.coachId),
      client
        .from('planned_workouts')
        .select('athlete_id, source_provider')
        .eq('coach_id', options.coachId),
      client
        .from('synchronization_logs')
        .select('id, job_type, status, attempt_number, records_processed, duplicates_skipped, error_message, started_at, finished_at')
        .eq('coach_id', options.coachId)
        .eq('provider', 'final_surge')
        .order('started_at', { ascending: false })
        .limit(15),
    ]);

    const athletesList = Array.isArray(athRes.data) ? (athRes.data as Array<Record<string, unknown>>) : [];
    const allMappings = Array.isArray(mapRes.data) ? (mapRes.data as Array<Record<string, unknown>>) : [];
    const fsMappings = allMappings.filter((m) => m.provider === 'final_surge');
    const icuMappings = allMappings.filter((m) => m.provider === 'intervals_icu');

    const icuIdByAth = new Map<string, string>();
    for (const m of icuMappings) {
      if (m.athlete_id && typeof m.external_athlete_id === 'string') {
        icuIdByAth.set(String(m.athlete_id), m.external_athlete_id);
      }
    }

    const fsPlannedCountByAth = new Map<string, number>();
    if (Array.isArray(plannedRes.data)) {
      for (const pw of plannedRes.data as Array<Record<string, unknown>>) {
        if (pw.athlete_id && (pw.source_provider === 'final_surge_api' || pw.source_provider === 'final_surge_csv')) {
          const id = String(pw.athlete_id);
          fsPlannedCountByAth.set(id, (fsPlannedCountByAth.get(id) ?? 0) + 1);
        }
      }
    }

    const fsMappingByAth = new Map<string, Record<string, unknown>>();
    for (const m of fsMappings) {
      if (m.athlete_id) {
        fsMappingByAth.set(String(m.athlete_id), m);
      }
    }

    availableAthletes = athletesList.map((a) => ({
      id: String(a.id),
      fullName: String(a.full_name),
      email: typeof a.email === 'string' ? a.email : null,
      intervalsAthleteId: icuIdByAth.get(String(a.id)) ?? null,
    }));

    mappedAthletes = athletesList
      .filter((a) => fsMappingByAth.has(String(a.id)) || Boolean(vault.feedsByAthleteId[String(a.id)]))
      .map((a) => {
        const athId = String(a.id);
        const mapping = fsMappingByAth.get(athId);
        const feed = vault.feedsByAthleteId[athId];
        return {
          athleteId: athId,
          athleteName: String(a.full_name),
          athleteEmail: typeof a.email === 'string' ? a.email : null,
          externalAthleteId:
            typeof mapping?.external_athlete_id === 'string'
              ? mapping.external_athlete_id
              : feed?.externalAthleteId ?? null,
          matchStatus: typeof mapping?.match_status === 'string' ? mapping.match_status : 'Unmapped',
          matchMethod: typeof mapping?.match_method === 'string' ? mapping.match_method : 'Unmatched',
          authorizationStatus:
            typeof mapping?.authorization_status === 'string'
              ? mapping.authorization_status
              : 'Unlinked',
          matchConfidencePct: Number(mapping?.match_confidence_pct ?? 0),
          hasFeedUrl: Boolean(feed?.feedUrl),
          maskedFeedUrl: maskFeedUrl(feed?.feedUrl),
          lastFeedVerifiedAt: feed?.lastVerifiedAt ?? null,
          lastFeedEventCount: feed?.lastEventCount ?? null,
          plannedWorkoutsCount: fsPlannedCountByAth.get(athId) ?? 0,
        };
      });

    syncLogs = Array.isArray(logsRes.data)
      ? (logsRes.data as Array<Record<string, unknown>>).map((l) => ({
          id: String(l.id),
          jobType: String(l.job_type),
          status: String(l.status),
          attemptNumber: Number(l.attempt_number ?? 1),
          recordsProcessed: Number(l.records_processed ?? 0),
          duplicatesSkipped: Number(l.duplicates_skipped ?? 0),
          errorMessage:
            typeof l.error_message === 'string' ? redactSensitiveText(l.error_message) : null,
          startedAt: String(l.started_at),
          finishedAt: typeof l.finished_at === 'string' ? l.finished_at : null,
        }))
      : [];
  }

  const connectionState: FinalSurgeStatusResponse['connectionState'] = connected
    ? 'Connected (Read-Only Calendar Sync)'
    : configured
    ? 'Configured (Verification Pending)'
    : 'Disconnected';

  return {
    ok: true,
    configured,
    connected,
    authMode: conn?.authMode ?? 'unconfigured',
    connectionState,
    metadata,
    lastVerifiedAt: conn?.lastVerifiedAt ?? null,
    lastSynchronizedAt: conn?.lastSynchronizedAt ?? null,
    mappedAthletes,
    availableAthletes,
    syncLogs,
  };
}

export async function upsertFinalSurgeAthleteMapping(options: {
  coachId: string;
  athleteId: string;
  externalAthleteId?: string | null;
  externalEmail?: string | null;
  externalName?: string | null;
  action: 'confirm' | 'auto_match' | 'unlink';
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
}): Promise<{
  ok: boolean;
  statusCode: number;
  matchStatus?: string;
  matchMethod?: string;
  error?: string;
}> {
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const store = options.oauthStore ?? getOAuthPersistenceStore();
  if (!client) {
    return { ok: false, statusCode: 503, error: 'Supabase admin client is not configured.' };
  }

  const { data: athlete } = await client
    .from('athletes')
    .select('id, full_name, email')
    .eq('id', options.athleteId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!athlete) {
    return { ok: false, statusCode: 404, error: 'Athlete not found for the authenticated coach.' };
  }

  const cleanExternalId = options.externalAthleteId?.trim() || null;

  if (options.action === 'unlink') {
    await client
      .from('provider_athlete_mappings')
      .upsert(
        {
          coach_id: options.coachId,
          athlete_id: options.athleteId,
          provider: 'final_surge',
          external_athlete_id: null,
          authorization_status: 'Unlinked',
          match_status: 'Unmapped',
          match_method: 'Unmatched',
          match_confidence_pct: 0,
          candidate_profile_snapshot: null,
        },
        { onConflict: 'athlete_id,provider' }
      );

    // Also remove any stored private feed URL for this athlete
    const vault = await loadVault(options.coachId, store);
    if (vault.feedsByAthleteId[options.athleteId]) {
      delete vault.feedsByAthleteId[options.athleteId];
      if (Object.keys(vault.feedsByAthleteId).length === 0) {
        await store.clearCredentials(options.coachId, 'final_surge').catch(() => undefined);
      } else {
        await saveVault({ coachId: options.coachId, vault, store });
      }
    }

    await appendAuditEvent(client, {
      coachId: options.coachId,
      action: 'FINAL_SURGE_MAPPING_UNLINKED',
      targetEntity: 'provider_athlete_mappings',
      targetId: options.athleteId,
      athleteIdSnapshot: options.athleteId,
      detail: `Unlinked Final Surge profile mapping for ${String(athlete.full_name)}.`,
    });

    return { ok: true, statusCode: 200, matchStatus: 'Unmapped', matchMethod: 'Unmatched' };
  }

  // Prevent duplicate external_athlete_id collisions within the same coach
  if (cleanExternalId) {
    const { data: allMappings } = await client
      .from('provider_athlete_mappings')
      .select('athlete_id, external_athlete_id, provider')
      .eq('coach_id', options.coachId)
      .eq('provider', 'final_surge');

    const conflict = Array.isArray(allMappings)
      ? (allMappings as Array<Record<string, unknown>>).find(
          (m) =>
            m.external_athlete_id === cleanExternalId && String(m.athlete_id) !== options.athleteId
        )
      : null;

    if (conflict) {
      return {
        ok: false,
        statusCode: 409,
        error: `Final Surge external ID "${cleanExternalId}" is already mapped to another athlete.`,
      };
    }
  }

  let matchStatus = 'Candidate Review Required';
  let matchMethod = 'Name-Only Blocked (Manual Review Required)';
  let authorizationStatus = 'Pending Athlete Opt-In';
  let confidence = 65;

  if (options.action === 'confirm') {
    matchStatus = 'Verified Match';
    matchMethod = cleanExternalId ? 'Coach Manual Match' : 'Coach Manual Match';
    authorizationStatus = 'Authorized (Read-Only)';
    confidence = 100;
  } else {
    // auto_match: only allow exact unique email match; name-only MUST be blocked pending coach review!
    const extEmail = options.externalEmail?.trim().toLowerCase() || null;
    const athEmail = typeof athlete.email === 'string' ? athlete.email.trim().toLowerCase() : null;
    if (extEmail && athEmail && extEmail === athEmail) {
      const { data: sameEmail } = await client
        .from('athletes')
        .select('id')
        .eq('coach_id', options.coachId)
        .eq('email', athlete.email);
      const uniqueEmail = !Array.isArray(sameEmail) || sameEmail.length <= 1;
      if (uniqueEmail) {
        matchStatus = 'Verified Match';
        matchMethod = 'Exact Email Match';
        authorizationStatus = 'Authorized (Read-Only)';
        confidence = 100;
      }
    }
  }

  // Never put private feed URLs into candidate_profile_snapshot
  const safeSnapshot = {
    externalName: options.externalName?.trim() || String(athlete.full_name),
    externalEmail: options.externalEmail?.trim() || null,
    externalAthleteId: cleanExternalId,
  };

  const { error: mapErr } = await client
    .from('provider_athlete_mappings')
    .upsert(
      {
        coach_id: options.coachId,
        athlete_id: options.athleteId,
        provider: 'final_surge',
        external_athlete_id: cleanExternalId,
        authorization_status: authorizationStatus,
        match_status: matchStatus,
        match_method: matchMethod,
        match_confidence_pct: confidence,
        candidate_profile_snapshot: safeSnapshot,
      },
      { onConflict: 'athlete_id,provider' }
    );

  if (mapErr) {
    return { ok: false, statusCode: 500, error: `Failed to save mapping: ${mapErr.message}` };
  }

  await appendAuditEvent(client, {
    coachId: options.coachId,
    action:
      matchStatus === 'Verified Match'
        ? 'FINAL_SURGE_MAPPING_VERIFIED'
        : 'FINAL_SURGE_MAPPING_CANDIDATE_QUEUED',
    targetEntity: 'provider_athlete_mappings',
    targetId: options.athleteId,
    athleteIdSnapshot: options.athleteId,
    detail: `Final Surge mapping for ${String(athlete.full_name)}: ${matchStatus} (${matchMethod}).`,
  });

  return { ok: true, statusCode: 200, matchStatus, matchMethod };
}

export async function connectAndVerifyFinalSurgeFeed(options: {
  coachId: string;
  athleteId: string;
  feedUrl: string;
  externalAthleteId?: string | null;
  label?: string | null;
  confirmMapping?: boolean;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  allowCustomHostForTesting?: boolean;
}): Promise<FinalSurgeFeedTestResult> {
  const verifiedAt = new Date().toISOString();
  const store = options.oauthStore ?? getOAuthPersistenceStore();
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;

  if (!client) {
    return {
      ok: false,
      statusCode: 503,
      connected: false,
      athleteId: options.athleteId,
      maskedFeedUrl: null,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: [],
      errorMessage: 'Supabase admin client is not configured.',
      verifiedAt,
    };
  }

  const { data: athlete } = await client
    .from('athletes')
    .select('id, full_name')
    .eq('id', options.athleteId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!athlete) {
    return {
      ok: false,
      statusCode: 404,
      connected: false,
      athleteId: options.athleteId,
      maskedFeedUrl: null,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: [],
      errorMessage: 'Target athlete was not found for the authenticated coach.',
      verifiedAt,
    };
  }

  const urlCheck = normalizeAndValidateFinalSurgeFeedUrl(options.feedUrl, {
    allowCustomHostForTesting: options.allowCustomHostForTesting,
  });
  if (!urlCheck.ok) {
    return {
      ok: false,
      statusCode: 400,
      connected: false,
      athleteId: options.athleteId,
      maskedFeedUrl: null,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: [],
      errorMessage: urlCheck.error,
      verifiedAt,
    };
  }

  const normalizedUrl = urlCheck.normalizedUrl;
  const maskedUrl = maskFeedUrl(normalizedUrl);
  const fetchRes = await fetchFeedWithRetry({
    url: normalizedUrl,
    fetcher: options.fetcher,
    sleep: options.sleep,
  });

  if (!fetchRes.ok) {
    const existingConn = await store.getProviderConnection(options.coachId, 'final_surge').catch(() => null);
    await store.upsertProviderConnection({
      coachId: options.coachId,
      provider: 'final_surge',
      authMode: existingConn?.authMode ?? 'unconfigured',
      connected: false,
      readOnlyMode: true,
      pilotTestSucceeded: false,
      verifiedPilotAthleteId: null,
      lastVerifiedAt: verifiedAt,
      lastSynchronizedAt: existingConn?.lastSynchronizedAt ?? null,
    });

    await client.from('synchronization_logs').insert({
      coach_id: options.coachId,
      job_type: 'daily_activity_import',
      provider: 'final_surge',
      status: 'Failed',
      attempt_number: 1,
      records_processed: 0,
      duplicates_skipped: 0,
      error_message: redactSensitiveText(fetchRes.error, [normalizedUrl]),
      started_at: verifiedAt,
      finished_at: verifiedAt,
    });

    return {
      ok: false,
      statusCode: fetchRes.statusCode,
      connected: false,
      athleteId: options.athleteId,
      maskedFeedUrl: maskedUrl,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: [],
      errorMessage: fetchRes.error,
      verifiedAt,
    };
  }

  const parsed = parseFinalSurgeIcsFeed(fetchRes.body);
  if (!parsed.ok) {
    return {
      ok: false,
      statusCode: 422,
      connected: false,
      athleteId: options.athleteId,
      maskedFeedUrl: maskedUrl,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: parsed.warnings,
      errorMessage: parsed.errorMessage,
      verifiedAt,
    };
  }

  const activeEvents = parsed.events.filter((e) => !e.cancelled);
  const cancelledEvents = parsed.events.filter((e) => e.cancelled);
  const dates = activeEvents.map((e) => e.workoutDate).sort();

  // Save feed URL encrypted in provider_connection_credentials
  const vault = await loadVault(options.coachId, store);
  const derivedExtId =
    options.externalAthleteId?.trim() ||
    `fs-feed-${crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 12)}`;

  vault.feedsByAthleteId[options.athleteId] = {
    athleteId: options.athleteId,
    feedUrl: normalizedUrl,
    externalAthleteId: derivedExtId,
    label: options.label?.trim() || `${String(athlete.full_name)} Calendar Sync`,
    addedAt: vault.feedsByAthleteId[options.athleteId]?.addedAt ?? verifiedAt,
    lastVerifiedAt: verifiedAt,
    lastEventCount: activeEvents.length,
  };

  await saveVault({ coachId: options.coachId, vault, store });

  const existingConn = await store.getProviderConnection(options.coachId, 'final_surge').catch(() => null);
  await store.upsertProviderConnection({
    coachId: options.coachId,
    provider: 'final_surge',
    authMode: 'api_key',
    connected: true,
    readOnlyMode: true,
    pilotTestSucceeded: true,
    verifiedPilotAthleteId: derivedExtId,
    externalCoachId: 'finalsurge_calendar_sync',
    externalCoachName: 'Final Surge Calendar Sync (Read-Only)',
    grantedScopes: ['CALENDAR:READ_ICS'],
    lastVerifiedAt: verifiedAt,
    lastSynchronizedAt: existingConn?.lastSynchronizedAt ?? null,
  });

  if (options.confirmMapping !== false) {
    await upsertFinalSurgeAthleteMapping({
      coachId: options.coachId,
      athleteId: options.athleteId,
      externalAthleteId: derivedExtId,
      externalName: String(athlete.full_name),
      action: 'confirm',
      supabaseClient: client,
      oauthStore: store,
    });
  }

  await appendAuditEvent(client, {
    coachId: options.coachId,
    action: 'FINAL_SURGE_FEED_VERIFIED',
    targetEntity: 'provider_connections',
    targetId: options.athleteId,
    athleteIdSnapshot: options.athleteId,
    detail: `Verified Final Surge iCalendar feed (${maskedUrl}) for ${String(athlete.full_name)}: ${activeEvents.length} active planned event(s).`,
  });

  return {
    ok: true,
    statusCode: 200,
    connected: true,
    athleteId: options.athleteId,
    maskedFeedUrl: maskedUrl,
    eventCount: parsed.events.length,
    activePlannedCount: activeEvents.length,
    cancelledCount: cancelledEvents.length,
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
    sampleWorkouts: activeEvents.slice(0, 6).map((e) => ({
      workoutDate: e.workoutDate,
      title: e.title,
      workoutType: e.workoutType,
      plannedMiles: e.plannedMiles,
      plannedDurationMin: e.plannedDurationMin,
      originalDistanceLabel:
        e.originalDistanceValue !== null && e.originalDistanceUnit
          ? `${e.originalDistanceValue} ${e.originalDistanceUnit}`
          : null,
    })),
    warnings: parsed.warnings,
    errorMessage: null,
    verifiedAt,
  };
}

export async function testSavedFinalSurgeConnection(options: {
  coachId: string;
  athleteId?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  allowCustomHostForTesting?: boolean;
}): Promise<FinalSurgeFeedTestResult> {
  const verifiedAt = new Date().toISOString();
  const store = options.oauthStore ?? getOAuthPersistenceStore();
  const vault = await loadVault(options.coachId, store);

  const entry = options.athleteId
    ? vault.feedsByAthleteId[options.athleteId]
    : Object.values(vault.feedsByAthleteId)[0];

  if (!entry?.feedUrl) {
    return {
      ok: false,
      statusCode: 400,
      connected: false,
      athleteId: options.athleteId ?? null,
      maskedFeedUrl: null,
      eventCount: 0,
      activePlannedCount: 0,
      cancelledCount: 0,
      earliestDate: null,
      latestDate: null,
      sampleWorkouts: [],
      warnings: [],
      errorMessage: 'No Final Surge Calendar Sync URL is configured for this athlete yet.',
      verifiedAt,
    };
  }

  return connectAndVerifyFinalSurgeFeed({
    coachId: options.coachId,
    athleteId: entry.athleteId,
    feedUrl: entry.feedUrl,
    externalAthleteId: entry.externalAthleteId,
    label: entry.label,
    confirmMapping: false,
    supabaseClient: options.supabaseClient,
    oauthStore: store,
    fetcher: options.fetcher,
    sleep: options.sleep,
    allowCustomHostForTesting: options.allowCustomHostForTesting,
  });
}

async function persistPlannedEventsBatch(params: {
  client: SupabaseClient;
  coachId: string;
  athleteId: string;
  athleteName: string;
  sourceProvider: 'final_surge_api' | 'final_surge_csv';
  events: FinalSurgeParsedPlannedEvent[];
  syncDeletionsInWindow: boolean;
  windowStart?: string | null;
  windowEnd?: string | null;
}): Promise<{
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  duplicatesSkipped: number;
  preservedManualCount: number;
  windowStart: string | null;
  windowEnd: string | null;
}> {
  const { client, coachId, athleteId, sourceProvider, events } = params;

  const filteredEvents = events.filter((ev) => {
    if (params.windowStart && ev.workoutDate < params.windowStart) return false;
    if (params.windowEnd && ev.workoutDate > params.windowEnd) return false;
    return true;
  });

  const activeEvents = filteredEvents.filter((e) => !e.cancelled);
  const cancelledUids = new Set(filteredEvents.filter((e) => e.cancelled).map((e) => e.uid));

  const { data: existingPlanned } = await client
    .from('planned_workouts')
    .select('*')
    .eq('coach_id', coachId)
    .eq('athlete_id', athleteId);

  const existingList = Array.isArray(existingPlanned)
    ? (existingPlanned as Array<Record<string, unknown>>)
    : [];

  const preservedManualCount = existingList.filter((r) => r.source_provider === 'coach_entry').length;

  const existingSameProvider = existingList.filter((r) => r.source_provider === sourceProvider);
  const existingByExternalId = new Map<string, Record<string, unknown>>();
  for (const row of existingSameProvider) {
    if (typeof row.external_workout_id === 'string') {
      existingByExternalId.set(row.external_workout_id, row);
    }
  }

  const { data: existingRawRows } = await client
    .from('raw_provider_payloads')
    .select('id, external_id, payload_sha256')
    .eq('coach_id', coachId)
    .eq('athlete_id', athleteId)
    .eq('provider', sourceProvider)
    .eq('entity_type', 'planned_workout');

  const rawIdByHash = new Map<string, string>();
  if (Array.isArray(existingRawRows)) {
    for (const rr of existingRawRows as Array<Record<string, unknown>>) {
      rawIdByHash.set(`${String(rr.external_id)}::${String(rr.payload_sha256)}`, String(rr.id));
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let duplicatesSkipped = 0;
  let deletedCount = 0;

  const activeUidsInFeed = new Set<string>();
  for (const ev of activeEvents) {
    activeUidsInFeed.add(ev.uid);

    const payloadBody = {
      uid: ev.uid,
      workoutDate: ev.workoutDate,
      plannedStartTime: ev.plannedStartTime,
      title: ev.title,
      description: ev.description,
      categories: ev.categories,
      workoutType: ev.workoutType,
      plannedMiles: ev.plannedMiles,
      plannedDurationMin: ev.plannedDurationMin,
      targetPaceSecPerMile: ev.targetPaceSecPerMile,
      targetZone: ev.targetZone,
      originalDistanceValue: ev.originalDistanceValue,
      originalDistanceUnit: ev.originalDistanceUnit,
      originalDurationText: ev.originalDurationText,
      originalPaceText: ev.originalPaceText,
      structuredSteps: ev.structuredSteps,
      lastModified: ev.lastModified,
    };
    const payloadSha = sha256Hex(payloadBody);
    const hashKey = `${ev.uid}::${payloadSha}`;

    let rawPayloadId = rawIdByHash.get(hashKey) ?? null;
    if (!rawPayloadId) {
      const { data: insertedRaw } = await client
        .from('raw_provider_payloads')
        .insert({
          coach_id: coachId,
          athlete_id: athleteId,
          provider: sourceProvider,
          entity_type: 'planned_workout',
          external_id: ev.uid,
          source_device: sourceProvider === 'final_surge_api' ? 'Final Surge Calendar Sync' : 'Final Surge Export',
          payload: payloadBody,
          payload_sha256: payloadSha,
        })
        .select('id')
        .single();
      if (insertedRaw?.id) {
        rawPayloadId = String(insertedRaw.id);
        rawIdByHash.set(hashKey, rawPayloadId);
      }
    }

    const existingRow = existingByExternalId.get(ev.uid);
    if (existingRow) {
      const changed =
        String(existingRow.workout_date).slice(0, 10) !== ev.workoutDate ||
        (existingRow.planned_start_time ?? null) !== ev.plannedStartTime ||
        String(existingRow.title) !== ev.title ||
        String(existingRow.workout_type) !== ev.workoutType ||
        Math.abs(Number(existingRow.planned_miles ?? 0) - ev.plannedMiles) > 0.005 ||
        Math.abs(Number(existingRow.planned_duration_min ?? 0) - ev.plannedDurationMin) > 0.05 ||
        (existingRow.target_pace_sec_per_mile ?? null) !== ev.targetPaceSecPerMile ||
        (existingRow.target_zone ?? null) !== ev.targetZone ||
        (rawPayloadId !== null && existingRow.raw_payload_id !== rawPayloadId);

      if (!changed) {
        duplicatesSkipped++;
        continue;
      }

      await client
        .from('planned_workouts')
        .update({
          workout_date: ev.workoutDate,
          planned_start_time: ev.plannedStartTime,
          title: ev.title,
          workout_type: ev.workoutType,
          planned_miles: ev.plannedMiles,
          planned_duration_min: ev.plannedDurationMin,
          target_pace_sec_per_mile: ev.targetPaceSecPerMile,
          target_zone: ev.targetZone,
          raw_payload_id: rawPayloadId,
        })
        .eq('id', existingRow.id)
        .eq('coach_id', coachId);

      updatedCount++;
    } else {
      await client.from('planned_workouts').insert({
        coach_id: coachId,
        athlete_id: athleteId,
        source_provider: sourceProvider,
        external_workout_id: ev.uid,
        workout_date: ev.workoutDate,
        planned_start_time: ev.plannedStartTime,
        title: ev.title,
        workout_type: ev.workoutType,
        planned_miles: ev.plannedMiles,
        planned_duration_min: ev.plannedDurationMin,
        target_pace_sec_per_mile: ev.targetPaceSecPerMile,
        target_zone: ev.targetZone,
        raw_payload_id: rawPayloadId,
      });
      insertedCount++;
    }
  }

  // Handle deleted or cancelled workouts ONLY for source_provider === 'final_surge_api' (never manual coach_entry!)
  const feedDates = filteredEvents.map((e) => e.workoutDate).sort();
  const effectiveStart = params.windowStart ?? feedDates[0] ?? null;
  const effectiveEnd = params.windowEnd ?? feedDates[feedDates.length - 1] ?? null;

  if (params.syncDeletionsInWindow && sourceProvider === 'final_surge_api') {
    for (const row of existingSameProvider) {
      const extId = typeof row.external_workout_id === 'string' ? row.external_workout_id : null;
      if (!extId) continue;
      const rowDate = String(row.workout_date).slice(0, 10);
      const inRange =
        (!effectiveStart || rowDate >= effectiveStart) && (!effectiveEnd || rowDate <= effectiveEnd);

      const isExplicitlyCancelled = cancelledUids.has(extId);
      const isMissingFromActiveFeed = inRange && !activeUidsInFeed.has(extId);

      if (isExplicitlyCancelled || isMissingFromActiveFeed) {
        await client
          .from('planned_workouts')
          .delete()
          .eq('id', row.id)
          .eq('coach_id', coachId);
        deletedCount++;
      }
    }
  }

  return {
    insertedCount,
    updatedCount,
    deletedCount,
    duplicatesSkipped,
    preservedManualCount,
    windowStart: effectiveStart,
    windowEnd: effectiveEnd,
  };
}

export async function synchronizeFinalSurgePlannedWorkouts(options: {
  coachId: string;
  athleteId: string;
  mode?: 'initial' | 'incremental';
  startDate?: string;
  endDate?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  allowCustomHostForTesting?: boolean;
}): Promise<FinalSurgeSyncResult> {
  const startedAt = new Date().toISOString();
  const mode = options.mode ?? 'incremental';
  const jobType: FinalSurgeSyncResult['jobType'] =
    mode === 'initial' ? 'backfill_12w' : 'daily_activity_import';

  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const store = options.oauthStore ?? getOAuthPersistenceStore();

  const failOut = (
    statusCode: number,
    status: FinalSurgeSyncResult['status'],
    errorMessage: string,
    athleteName = 'Unknown'
  ): FinalSurgeSyncResult => ({
    ok: false,
    statusCode,
    status,
    syncLogId: null,
    jobType,
    mode,
    athleteId: options.athleteId,
    athleteName,
    eventsFetched: 0,
    insertedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    duplicatesSkipped: 0,
    preservedManualCount: 0,
    windowStart: options.startDate ?? null,
    windowEnd: options.endDate ?? null,
    warnings: [],
    errorMessage,
    synchronizedAt: new Date().toISOString(),
  });

  if (!client) {
    return failOut(503, 'Failed', 'Supabase admin client is not configured.');
  }

  const { data: athlete } = await client
    .from('athletes')
    .select('id, full_name')
    .eq('id', options.athleteId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!athlete) {
    return failOut(404, 'Blocked (Unauthorized)', 'Athlete not found for authenticated coach.');
  }

  const athleteName = String(athlete.full_name);

  // Verify explicit Final Surge mapping before syncing
  const { data: mapping } = await client
    .from('provider_athlete_mappings')
    .select('match_status, authorization_status')
    .eq('coach_id', options.coachId)
    .eq('athlete_id', options.athleteId)
    .eq('provider', 'final_surge')
    .maybeSingle();

  if (!mapping || mapping.match_status !== 'Verified Match') {
    const err =
      'Final Surge athlete mapping is unverified. Confirm the Final Surge athlete link before synchronizing planned workouts.';
    await client.from('synchronization_logs').insert({
      coach_id: options.coachId,
      job_type: jobType,
      provider: 'final_surge',
      status: 'Blocked (Unauthorized)',
      attempt_number: 1,
      records_processed: 0,
      duplicates_skipped: 0,
      error_message: err,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    return failOut(409, 'Blocked (Unauthorized)', err, athleteName);
  }

  const vault = await loadVault(options.coachId, store);
  const feedEntry = vault.feedsByAthleteId[options.athleteId];
  if (!feedEntry?.feedUrl) {
    return failOut(
      400,
      'Failed',
      'No encrypted Final Surge Calendar Sync URL is configured for this athlete.',
      athleteName
    );
  }

  const urlCheck = normalizeAndValidateFinalSurgeFeedUrl(feedEntry.feedUrl, {
    allowCustomHostForTesting: options.allowCustomHostForTesting,
  });
  if (!urlCheck.ok) {
    return failOut(400, 'Failed', urlCheck.error, athleteName);
  }

  const { data: logRow } = await client
    .from('synchronization_logs')
    .insert({
      coach_id: options.coachId,
      job_type: jobType,
      provider: 'final_surge',
      status: 'Running',
      attempt_number: 1,
      records_processed: 0,
      duplicates_skipped: 0,
      started_at: startedAt,
    })
    .select('id')
    .single();
  const syncLogId = logRow?.id ? String(logRow.id) : null;

  const fetchRes = await fetchFeedWithRetry({
    url: urlCheck.normalizedUrl,
    fetcher: options.fetcher,
    sleep: options.sleep,
  });

  if (!fetchRes.ok) {
    const finishedAt = new Date().toISOString();
    const safeErr = redactSensitiveText(fetchRes.error, [urlCheck.normalizedUrl]);
    if (syncLogId) {
      await client
        .from('synchronization_logs')
        .update({ status: 'Failed', error_message: safeErr, finished_at: finishedAt })
        .eq('id', syncLogId)
        .eq('coach_id', options.coachId);
    }
    return {
      ...failOut(fetchRes.statusCode, 'Failed', safeErr, athleteName),
      syncLogId,
      synchronizedAt: finishedAt,
    };
  }

  const parsed = parseFinalSurgeIcsFeed(fetchRes.body);
  if (!parsed.ok) {
    const finishedAt = new Date().toISOString();
    if (syncLogId) {
      await client
        .from('synchronization_logs')
        .update({ status: 'Failed', error_message: parsed.errorMessage, finished_at: finishedAt })
        .eq('id', syncLogId)
        .eq('coach_id', options.coachId);
    }
    return {
      ...failOut(422, 'Failed', parsed.errorMessage ?? 'Invalid ICS payload.', athleteName),
      syncLogId,
      synchronizedAt: finishedAt,
    };
  }

  const batchRes = await persistPlannedEventsBatch({
    client,
    coachId: options.coachId,
    athleteId: options.athleteId,
    athleteName,
    sourceProvider: 'final_surge_api',
    events: parsed.events,
    syncDeletionsInWindow: true,
    windowStart: options.startDate ?? null,
    windowEnd: options.endDate ?? null,
  });

  const finishedAt = new Date().toISOString();
  const totalProcessed = batchRes.insertedCount + batchRes.updatedCount + batchRes.deletedCount;

  if (syncLogId) {
    await client
      .from('synchronization_logs')
      .update({
        status: 'Succeeded',
        records_processed: totalProcessed,
        duplicates_skipped: batchRes.duplicatesSkipped,
        error_message:
          parsed.warnings.length > 0 ? parsed.warnings.join(' | ').slice(0, 500) : null,
        finished_at: finishedAt,
      })
      .eq('id', syncLogId)
      .eq('coach_id', options.coachId);
  }

  // Update vault metadata & provider connection timestamp
  vault.feedsByAthleteId[options.athleteId] = {
    ...feedEntry,
    lastVerifiedAt: finishedAt,
    lastEventCount: parsed.events.filter((e) => !e.cancelled).length,
  };
  await saveVault({ coachId: options.coachId, vault, store });

  await store.upsertProviderConnection({
    coachId: options.coachId,
    provider: 'final_surge',
    authMode: 'api_key',
    connected: true,
    readOnlyMode: true,
    pilotTestSucceeded: true,
    verifiedPilotAthleteId: feedEntry.externalAthleteId,
    externalCoachId: 'finalsurge_calendar_sync',
    externalCoachName: 'Final Surge Calendar Sync (Read-Only)',
    grantedScopes: ['CALENDAR:READ_ICS'],
    lastVerifiedAt: finishedAt,
    lastSynchronizedAt: finishedAt,
  });

  await appendAuditEvent(client, {
    coachId: options.coachId,
    action: 'FINAL_SURGE_SYNC_COMPLETED',
    targetEntity: 'planned_workouts',
    targetId: options.athleteId,
    athleteIdSnapshot: options.athleteId,
    detail: `Synchronized Final Surge planned workouts (${mode}) for ${athleteName}: ${batchRes.insertedCount} inserted, ${batchRes.updatedCount} updated, ${batchRes.deletedCount} removed, ${batchRes.duplicatesSkipped} unchanged.`,
  });

  return {
    ok: true,
    statusCode: 200,
    status: 'Succeeded',
    syncLogId,
    jobType,
    mode,
    athleteId: options.athleteId,
    athleteName,
    eventsFetched: parsed.events.length,
    insertedCount: batchRes.insertedCount,
    updatedCount: batchRes.updatedCount,
    deletedCount: batchRes.deletedCount,
    duplicatesSkipped: batchRes.duplicatesSkipped,
    preservedManualCount: batchRes.preservedManualCount,
    windowStart: batchRes.windowStart,
    windowEnd: batchRes.windowEnd,
    warnings: parsed.warnings,
    errorMessage: null,
    synchronizedAt: finishedAt,
  };
}

export async function importFinalSurgePlannedWorkouts(options: {
  coachId: string;
  athleteId: string;
  format: 'ics' | 'csv';
  content: string;
  startDate?: string;
  endDate?: string;
  supabaseClient?: SupabaseClient | null;
  oauthStore?: OAuthPersistenceStore;
}): Promise<FinalSurgeSyncResult> {
  const startedAt = new Date().toISOString();
  const mode = options.format === 'ics' ? 'import_ics' : 'import_csv';
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;
  const store = options.oauthStore ?? getOAuthPersistenceStore();

  const failOut = (statusCode: number, errorMessage: string, athleteName = 'Unknown'): FinalSurgeSyncResult => ({
    ok: false,
    statusCode,
    status: statusCode === 404 ? 'Blocked (Unauthorized)' : 'Failed',
    syncLogId: null,
    jobType: 'finalsurge_csv_import',
    mode,
    athleteId: options.athleteId,
    athleteName,
    eventsFetched: 0,
    insertedCount: 0,
    updatedCount: 0,
    deletedCount: 0,
    duplicatesSkipped: 0,
    preservedManualCount: 0,
    windowStart: options.startDate ?? null,
    windowEnd: options.endDate ?? null,
    warnings: [],
    errorMessage,
    synchronizedAt: new Date().toISOString(),
  });

  if (!client) {
    return failOut(503, 'Supabase admin client is not configured.');
  }

  const { data: athlete } = await client
    .from('athletes')
    .select('id, full_name')
    .eq('id', options.athleteId)
    .eq('coach_id', options.coachId)
    .maybeSingle();

  if (!athlete) {
    return failOut(404, 'Athlete not found for authenticated coach.');
  }
  const athleteName = String(athlete.full_name);

  const parsed =
    options.format === 'ics'
      ? parseFinalSurgeIcsFeed(options.content)
      : parseFinalSurgePlannedCsv(options.content);

  if (!parsed.ok) {
    return failOut(400, parsed.errorMessage ?? 'Unable to parse Final Surge export.', athleteName);
  }

  // Ensure an explicit verified mapping exists or record coach manual selection on export import
  const { data: existingMap } = await client
    .from('provider_athlete_mappings')
    .select('match_status')
    .eq('coach_id', options.coachId)
    .eq('athlete_id', options.athleteId)
    .eq('provider', 'final_surge')
    .maybeSingle();

  if (!existingMap) {
    await upsertFinalSurgeAthleteMapping({
      coachId: options.coachId,
      athleteId: options.athleteId,
      externalName: athleteName,
      action: 'confirm',
      supabaseClient: client,
      oauthStore: store,
    });
  }

  const batchRes = await persistPlannedEventsBatch({
    client,
    coachId: options.coachId,
    athleteId: options.athleteId,
    athleteName,
    sourceProvider: 'final_surge_csv',
    events: parsed.events,
    syncDeletionsInWindow: false,
    windowStart: options.startDate ?? null,
    windowEnd: options.endDate ?? null,
  });

  const finishedAt = new Date().toISOString();
  const totalProcessed = batchRes.insertedCount + batchRes.updatedCount;
  const { data: logRow } = await client
    .from('synchronization_logs')
    .insert({
      coach_id: options.coachId,
      job_type: 'finalsurge_csv_import',
      provider: 'final_surge',
      status: 'Succeeded',
      attempt_number: 1,
      records_processed: totalProcessed,
      duplicates_skipped: batchRes.duplicatesSkipped,
      error_message:
        parsed.warnings.length > 0 ? parsed.warnings.join(' | ').slice(0, 500) : null,
      started_at: startedAt,
      finished_at: finishedAt,
    })
    .select('id')
    .single();

  await appendAuditEvent(client, {
    coachId: options.coachId,
    action: 'FINAL_SURGE_EXPORT_IMPORTED',
    targetEntity: 'planned_workouts',
    targetId: options.athleteId,
    athleteIdSnapshot: options.athleteId,
    detail: `Imported Final Surge ${options.format.toUpperCase()} export for ${athleteName}: ${batchRes.insertedCount} inserted, ${batchRes.updatedCount} updated, ${batchRes.duplicatesSkipped} duplicates skipped.`,
  });

  return {
    ok: true,
    statusCode: 200,
    status: 'Succeeded',
    syncLogId: logRow?.id ? String(logRow.id) : null,
    jobType: 'finalsurge_csv_import',
    mode,
    athleteId: options.athleteId,
    athleteName,
    eventsFetched: parsed.events.length,
    insertedCount: batchRes.insertedCount,
    updatedCount: batchRes.updatedCount,
    deletedCount: 0,
    duplicatesSkipped: batchRes.duplicatesSkipped,
    preservedManualCount: batchRes.preservedManualCount,
    windowStart: batchRes.windowStart,
    windowEnd: batchRes.windowEnd,
    warnings: parsed.warnings,
    errorMessage: null,
    synchronizedAt: finishedAt,
  };
}

export async function disconnectFinalSurgeForCoach(options: {
  coachId: string;
  oauthStore?: OAuthPersistenceStore;
  supabaseClient?: SupabaseClient | null;
}): Promise<void> {
  const store = options.oauthStore ?? getOAuthPersistenceStore();
  const client =
    options.supabaseClient === undefined ? getSupabaseAdminClient() : options.supabaseClient;

  await store.clearCredentials(options.coachId, 'final_surge');

  if (client) {
    await appendAuditEvent(client, {
      coachId: options.coachId,
      action: 'FINAL_SURGE_DISCONNECTED',
      targetEntity: 'provider_connections',
      targetId: options.coachId,
      detail: 'Disconnected Final Surge Calendar Sync and removed encrypted per-athlete feed URLs.',
    });
  }
}
