import 'dotenv/config';
import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CoachTokenVerifier,
  createOptionalCoachAuth,
  createRequireCoachAuth,
} from './server/authMiddleware.ts';
import { isTokenEncryptionConfigured } from './server/crypto.ts';
import {
  buildIntervalsOAuthUrl,
  checkPersistedRosterSyncAuthorization,
  clearIntervalsSession,
  exchangeIntervalsOAuthCode,
  getIntervalsStatusForCoach,
  loadPersistedIntervalsConnectionsOnStartup,
  runFullRosterDeepTelemetryValidation,
  runIntervalsPilotConnectionTest,
  runIntervalsReadOnlyConnectionTest,
} from './server/intervalsClient.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getOAuthPersistenceStore, type OAuthPersistenceStore } from './server/oauthStore.ts';
import {
  getIntervalsRosterOverview,
  getProductionPilotDashboardData,
  resolveIntervalsAthleteMapping,
  synchronizeFullRoster,
  synchronizePilotAthlete,
} from './server/pilotIngestion.ts';
import {
  addPlannedWorkoutsForAthlete,
  getCoachingIntelligence,
  updateCoachingAlertStatus,
  updateWeeklyReportCoachState,
} from './server/coachingIntelligence.ts';
import {
  checkSupabaseDatabaseReachable,
  isSupabaseServerConfigured,
} from './server/supabaseAdmin.ts';
import { runLiveReadOnlyValidation } from './server/liveValidation.ts';
import {
  connectAndVerifyFinalSurgeFeed,
  disconnectFinalSurgeForCoach,
  getFinalSurgeIntegrationMetadata,
  getFinalSurgeStatusForCoach,
  importFinalSurgePlannedWorkouts,
  synchronizeFinalSurgePlannedWorkouts,
  testSavedFinalSurgeConnection,
  upsertFinalSurgeAthleteMapping,
} from './server/finalSurgeClient.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppOptions {
  authVerifier?: CoachTokenVerifier;
  oauthStore?: OAuthPersistenceStore;
  supabaseClient?: SupabaseClient | null;
  intervalsFetcher?: typeof fetch;
  finalSurgeFetcher?: typeof fetch;
  allowCustomFinalSurgeHostForTesting?: boolean;
  databaseChecker?: () => Promise<{ configured: boolean; connected: boolean; detail: string }>;
  mountFrontend?: boolean;
  deferStartupWork?: boolean;
}

function resolveAppBaseUrl(req: express.Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
}

export async function createApp(options?: CreateAppOptions): Promise<Express> {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const mountFrontend = options?.mountFrontend ?? true;
  const deferStartupWork = Boolean(options?.deferStartupWork);
  const oauthStore = options?.oauthStore ?? getOAuthPersistenceStore();
  const intervalsFetcher = options?.intervalsFetcher;
  const finalSurgeFetcher = options?.finalSurgeFetcher;
  const allowCustomFinalSurgeHostForTesting = Boolean(options?.allowCustomFinalSurgeHostForTesting);
  const databaseChecker = options?.databaseChecker ?? checkSupabaseDatabaseReachable;
  const requireCoachAuth = createRequireCoachAuth(options?.authVerifier);
  const optionalCoachAuth = createOptionalCoachAuth(options?.authVerifier);

  // Load persisted Intervals.icu provider connections on server startup (non-blocking when starting live server).
  if (deferStartupWork) {
    void loadPersistedIntervalsConnectionsOnStartup(oauthStore).catch(() => []);
  } else {
    await loadPersistedIntervalsConnectionsOnStartup(oauthStore);
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'running-coach-ai', timestamp: new Date().toISOString() });
  });

  // Verifies caller JWT and returns server-authoritative single-owner coach identity.
  app.get('/api/auth/me', requireCoachAuth, (req, res) => {
    res.json({
      ok: true,
      coach: req.coach,
    });
  });

  // Exposes safe, non-sensitive config flags anonymously; private coach details & persisted status require auth.
  app.get('/api/integrations/status', optionalCoachAuth, async (req, res) => {
    try {
      const isAuthenticated = Boolean(req.coach);
      const intervals = await getIntervalsStatusForCoach({
        coachId: req.coach?.id,
        includeSensitiveCoachDetails: isAuthenticated,
        store: oauthStore,
      });
      const finalSurgeStatus = await getFinalSurgeStatusForCoach({
        coachId: req.coach?.id,
        includeSensitiveDetails: isAuthenticated,
        oauthStore,
        supabaseClient: options?.supabaseClient,
      });
      const fsMetadata = getFinalSurgeIntegrationMetadata();
      const dbReachability = await databaseChecker();

      res.json({
        auth: {
          supabaseConfigured: isSupabaseServerConfigured(),
          tokenEncryptionConfigured: isTokenEncryptionConfigured(),
          authenticated: isAuthenticated,
          coach: isAuthenticated ? req.coach : null,
        },
        finalSurge: {
          priority: 'primary',
          mandatory: true,
          configured: finalSurgeStatus.configured,
          connected: finalSurgeStatus.connected,
          authMode: finalSurgeStatus.authMode,
          connectionState: finalSurgeStatus.connectionState,
          mappedAthleteCount: finalSurgeStatus.mappedAthletes.length,
          lastVerifiedAt: isAuthenticated ? finalSurgeStatus.lastVerifiedAt : null,
          lastSynchronizedAt: isAuthenticated ? finalSurgeStatus.lastSynchronizedAt : null,
          role: 'Primary Source · Planned Workouts (Official Calendar Sync .ics & Export Import)',
          apiAvailability: fsMetadata.officialLiveMethod,
          partnerOAuthAvailable: fsMetadata.partnerOAuthAvailable,
          programmaticHrTimeSeries:
            'Not exposed via public REST API (website HR graphs parse uploaded FIT/TCX files; programmatic streams require FIT/TCX export or authorized middleware).',
          runningPowerRequired: false,
        },
        intervalsIcu: {
          ...intervals,
          priority: 'optional_future',
          mandatory: false,
          connected: intervals.hasActiveSession,
          directGarminAuthRequired: false,
          garminNote:
            'Optional secondary source: Garmin device data and HR streams can be connected later if desired, but Final Surge + independent stress analytics work without Intervals.icu.',
        },
        database: {
          configured: dbReachability.configured,
          connected: dbReachability.connected,
          detail: isAuthenticated ? dbReachability.detail : undefined,
          mode: dbReachability.connected
            ? 'Supabase Postgres Connected (Single-Coach RLS Active)'
            : 'Demo Browser Store Active (Supabase Offline or Unconfigured)',
        },
      });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to load persisted integration status.',
      });
    }
  });

  app.get('/api/integrations/intervals/oauth/url', requireCoachAuth, async (req, res) => {
    try {
      const appBase = resolveAppBaseUrl(req);
      const result = await buildIntervalsOAuthUrl(appBase, {
        coachId: req.coach!.id,
        store: oauthStore,
      });
      res.json(result);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to initialize OAuth authorization URL.',
      });
    }
  });

  const handleIntervalsOAuthCallback: express.RequestHandler = async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const appBase = resolveAppBaseUrl(req);

    if (!code) {
      res.status(400).send('Missing authorization code from Intervals.icu.');
      return;
    }

    if (!state) {
      res.status(400).send('Missing OAuth state parameter.');
      return;
    }

    const result = await exchangeIntervalsOAuthCode({
      code,
      state,
      appBaseUrl: appBase,
      store: oauthStore,
      fetcher: intervalsFetcher,
    });

    if (!result.ok) {
      res.status(result.statusCode ?? 400).send(`Intervals.icu OAuth error: ${result.message}`);
      return;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html>
  <body>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'INTERVALS_OAUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/?intervals_oauth=connected';
      }
    </script>
    <p>Intervals.icu authorization complete. You may close this window.</p>
  </body>
</html>`);
  };

  app.get(
    ['/api/integrations/intervals/oauth/callback', '/api/integrations/intervals/oauth/callback/'],
    handleIntervalsOAuthCallback
  );

  app.post('/api/integrations/intervals/test', requireCoachAuth, async (req, res) => {
    try {
      const diagnostics = await runIntervalsReadOnlyConnectionTest({
        coachId: req.coach!.id,
        store: oauthStore,
        fetcher: intervalsFetcher,
      });
      res.json(diagnostics);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to complete Intervals.icu connection probe.',
      });
    }
  });

  app.post('/api/integrations/intervals/pilot-test', requireCoachAuth, async (req, res) => {
    try {
      const pilotAthleteId =
        req.body && typeof req.body.pilotAthleteId === 'string'
          ? req.body.pilotAthleteId
          : undefined;
      const result = await runIntervalsPilotConnectionTest({
        pilotAthleteId,
        coachId: req.coach!.id,
        store: oauthStore,
        fetcher: intervalsFetcher,
      });
      res.json(result);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to complete or persist pilot verification test.',
      });
    }
  });

  app.post('/api/integrations/intervals/validate-roster', requireCoachAuth, async (req, res) => {
    try {
      const pilotAthleteId =
        req.body && typeof req.body.pilotAthleteId === 'string'
          ? req.body.pilotAthleteId
          : undefined;
      const windowDays =
        req.body && typeof req.body.windowDays === 'number' ? req.body.windowDays : 90;
      const report = await runFullRosterDeepTelemetryValidation({
        pilotAthleteId,
        windowDays,
        coachId: req.coach!.id,
        store: oauthStore,
        fetcher: intervalsFetcher,
      });
      res.json(report);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to complete roster telemetry validation.',
      });
    }
  });

  app.post('/api/integrations/intervals/pilot-sync', requireCoachAuth, async (req, res) => {
    try {
      const requestedAthleteId =
        req.body && typeof req.body.pilotAthleteId === 'string'
          ? req.body.pilotAthleteId
          : req.body && typeof req.body.athleteId === 'string'
          ? req.body.athleteId
          : undefined;
      const rawMode = req.body && typeof req.body.mode === 'string' ? req.body.mode : 'auto';
      const mode: 'auto' | 'initial' | 'incremental' =
        rawMode === 'initial' || rawMode === 'incremental' ? rawMode : 'auto';

      const result = await synchronizePilotAthlete({
        coachId: req.coach!.id,
        requestedAthleteId,
        mode,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: intervalsFetcher,
      });

      if (result.ok && result.internalAthleteId) {
        try {
          await getCoachingIntelligence({
            coachId: req.coach!.id,
            athleteId: result.internalAthleteId,
            persist: true,
            supabaseClient: options?.supabaseClient,
            oauthStore,
          });
        } catch {
          // Non-fatal: sync succeeded even if intelligence refresh skipped
        }
      }

      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        status: 'Failed',
        errorMessage: 'Unable to execute pilot athlete synchronization.',
      });
    }
  });

  app.get('/api/production/pilot', requireCoachAuth, async (req, res) => {
    try {
      const requestedAthleteId =
        typeof req.query.athleteId === 'string' && req.query.athleteId.trim()
          ? req.query.athleteId.trim()
          : undefined;
      const dashboard = await getProductionPilotDashboardData({
        coachId: req.coach!.id,
        requestedAthleteId,
        supabaseClient: options?.supabaseClient,
        oauthStore,
      });
      res.json(dashboard);
    } catch {
      res.status(503).json({
        configured: false,
        hasPersistedPilot: false,
        error: 'Unable to load persisted pilot athlete data from Supabase.',
      });
    }
  });

  app.get('/api/production/live-validation', requireCoachAuth, async (req, res) => {
    try {
      const report = await runLiveReadOnlyValidation({
        coachId: req.coach!.id,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: intervalsFetcher,
      });
      res.json(report);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to execute read-only live validation report.',
      });
    }
  });

  app.get('/api/production/intelligence', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        typeof req.query.athleteId === 'string' && req.query.athleteId.trim()
          ? req.query.athleteId.trim()
          : undefined;
      const persist = req.query.persist === '1' || req.query.persist === 'true';
      const report = await getCoachingIntelligence({
        coachId: req.coach!.id,
        athleteId,
        persist,
        supabaseClient: options?.supabaseClient,
        oauthStore,
      });
      res.status(report.statusCode).json(report);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        configured: false,
        hasPersistedAthlete: false,
        error: 'Unable to compute coaching intelligence from Supabase.',
      });
    }
  });

  app.post('/api/production/intelligence/analyze', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' && req.body.athleteId.trim()
          ? req.body.athleteId.trim()
          : undefined;
      const report = await getCoachingIntelligence({
        coachId: req.coach!.id,
        athleteId,
        persist: true,
        supabaseClient: options?.supabaseClient,
        oauthStore,
      });
      res.status(report.statusCode).json(report);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        configured: false,
        hasPersistedAthlete: false,
        error: 'Unable to persist coaching intelligence analysis.',
      });
    }
  });

  app.post(
    '/api/production/athletes/:athleteId/planned-workouts',
    requireCoachAuth,
    async (req, res) => {
      try {
        const athleteId = req.params.athleteId?.trim();
        if (!athleteId) {
          res.status(400).json({ ok: false, error: 'Missing athleteId parameter.' });
          return;
        }
        const workouts = Array.isArray(req.body?.workouts)
          ? req.body.workouts
          : req.body && typeof req.body === 'object'
          ? [req.body]
          : [];
        const addRes = await addPlannedWorkoutsForAthlete({
          coachId: req.coach!.id,
          athleteId,
          workouts,
          supabaseClient: options?.supabaseClient,
        });
        if (!addRes.ok) {
          res.status(addRes.statusCode).json({ ok: false, error: addRes.error });
          return;
        }
        const intelligence = await getCoachingIntelligence({
          coachId: req.coach!.id,
          athleteId,
          persist: true,
          supabaseClient: options?.supabaseClient,
          oauthStore,
        });
        res.status(201).json({
          ok: true,
          insertedCount: addRes.insertedCount,
          intelligence,
        });
      } catch {
        res.status(503).json({
          ok: false,
          error: 'Unable to save planned workouts.',
        });
      }
    }
  );

  app.patch('/api/production/alerts/:alertId', requireCoachAuth, async (req, res) => {
    try {
      const alertId = req.params.alertId?.trim();
      const status = req.body?.status;
      if (!alertId || (status !== 'active' && status !== 'acknowledged' && status !== 'resolved')) {
        res.status(400).json({ ok: false, error: 'Valid alertId and status required.' });
        return;
      }
      const result = await updateCoachingAlertStatus({
        coachId: req.coach!.id,
        alertId,
        status,
        supabaseClient: options?.supabaseClient,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({ ok: false, error: 'Unable to update coaching alert status.' });
    }
  });

  app.post('/api/production/reports/update', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' ? req.body.athleteId.trim() : '';
      const weekStartDate =
        req.body && typeof req.body.weekStartDate === 'string'
          ? req.body.weekStartDate.trim()
          : '';
      if (!athleteId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) {
        res.status(400).json({
          ok: false,
          error: 'Valid athleteId and YYYY-MM-DD weekStartDate are required.',
        });
        return;
      }
      const result = await updateWeeklyReportCoachState({
        coachId: req.coach!.id,
        athleteId,
        weekStartDate,
        coachNote: typeof req.body.coachNote === 'string' ? req.body.coachNote : undefined,
        status:
          req.body.status === 'Approved' || req.body.status === 'Draft'
            ? req.body.status
            : undefined,
        supabaseClient: options?.supabaseClient,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({ ok: false, error: 'Unable to update weekly report.' });
    }
  });

  app.get('/api/integrations/intervals/roster', requireCoachAuth, async (req, res) => {
    try {
      const probePermissions =
        req.query.probePermissions === '1' || req.query.probePermissions === 'true';
      const result = await getIntervalsRosterOverview({
        coachId: req.coach!.id,
        probePermissions,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: intervalsFetcher,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        errorMessage: 'Unable to retrieve Intervals.icu shared roster overview.',
        athletes: [],
        existingAthletes: [],
        warnings: [],
      });
    }
  });

  app.post('/api/integrations/intervals/roster/mappings', requireCoachAuth, async (req, res) => {
    try {
      const action = req.body?.action;
      const externalAthleteId =
        typeof req.body?.externalAthleteId === 'string' ? req.body.externalAthleteId.trim() : '';
      const athleteId =
        typeof req.body?.athleteId === 'string' ? req.body.athleteId.trim() : undefined;

      if (
        action !== 'link_existing' &&
        action !== 'create_and_link' &&
        action !== 'confirm_candidate' &&
        action !== 'leave_unmapped'
      ) {
        res.status(400).json({
          ok: false,
          statusCode: 400,
          message:
            'action must be one of link_existing, create_and_link, confirm_candidate, or leave_unmapped.',
        });
        return;
      }

      if (!externalAthleteId) {
        res.status(400).json({
          ok: false,
          statusCode: 400,
          message: 'externalAthleteId is required.',
        });
        return;
      }

      const result = await resolveIntervalsAthleteMapping({
        coachId: req.coach!.id,
        action,
        externalAthleteId,
        athleteId,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: intervalsFetcher,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        message: 'Unable to update Intervals.icu athlete mapping.',
      });
    }
  });

  app.post('/api/integrations/intervals/roster-sync', requireCoachAuth, async (req, res) => {
    try {
      const rawMode = req.body && typeof req.body.mode === 'string' ? req.body.mode : 'auto';
      const mode: 'auto' | 'initial' | 'incremental' =
        rawMode === 'initial' || rawMode === 'incremental' ? rawMode : 'auto';
      const athleteIds = Array.isArray(req.body?.athleteIds)
        ? (req.body.athleteIds as unknown[])
            .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            .map((v) => v.trim())
        : undefined;
      const retryFailedOnly = Boolean(req.body?.retryFailedOnly);
      const concurrency =
        typeof req.body?.concurrency === 'number' && Number.isFinite(req.body.concurrency)
          ? req.body.concurrency
          : undefined;

      const result = await synchronizeFullRoster({
        coachId: req.coach!.id,
        mode,
        athleteIds,
        retryFailedOnly,
        concurrency,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: intervalsFetcher,
      });

      if (result.ok && result.athleteResults.length > 0) {
        for (const outcome of result.athleteResults) {
          if (
            outcome.internalAthleteId &&
            (outcome.status === 'Succeeded' || outcome.status === 'Partial')
          ) {
            try {
              await getCoachingIntelligence({
                coachId: req.coach!.id,
                athleteId: outcome.internalAthleteId,
                persist: true,
                supabaseClient: options?.supabaseClient,
                oauthStore,
              });
            } catch {
              // Non-fatal: synced telemetry persisted even if intelligence refresh skipped
            }
          }
        }
      }

      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        statusCode: 503,
        blockedByPilotGate: false,
        status: 'Failed',
        errorMessage: 'Unable to execute full-roster synchronization.',
      });
    }
  });

  app.post('/api/integrations/intervals/disconnect', requireCoachAuth, async (req, res) => {
    try {
      await clearIntervalsSession(req.coach!.id, oauthStore);
      res.json({ ok: true, connected: false, pilotTestSucceeded: false });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to persist Intervals.icu disconnection.',
      });
    }
  });

  // Final Surge Official Calendar Sync (.ics) & Export Import Routes
  app.get('/api/integrations/final-surge/status', requireCoachAuth, async (req, res) => {
    try {
      const status = await getFinalSurgeStatusForCoach({
        coachId: req.coach!.id,
        includeSensitiveDetails: true,
        oauthStore,
        supabaseClient: options?.supabaseClient,
      });
      res.json(status);
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to load persisted Final Surge integration status.',
      });
    }
  });

  app.post('/api/integrations/final-surge/connect-feed', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' ? req.body.athleteId.trim() : '';
      const feedUrl =
        req.body && typeof req.body.feedUrl === 'string' ? req.body.feedUrl.trim() : '';
      if (!athleteId || !feedUrl) {
        res.status(400).json({
          ok: false,
          connected: false,
          errorMessage: 'athleteId and Official Final Surge Calendar Sync URL are required.',
        });
        return;
      }

      const result = await connectAndVerifyFinalSurgeFeed({
        coachId: req.coach!.id,
        athleteId,
        feedUrl,
        externalAthleteId:
          typeof req.body.externalAthleteId === 'string' ? req.body.externalAthleteId : undefined,
        label: typeof req.body.label === 'string' ? req.body.label : undefined,
        confirmMapping: req.body.confirmMapping !== false,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: finalSurgeFetcher,
        allowCustomHostForTesting: allowCustomFinalSurgeHostForTesting,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        connected: false,
        errorMessage: 'Unable to verify Final Surge Calendar Sync feed.',
      });
    }
  });

  app.post('/api/integrations/final-surge/test', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' && req.body.athleteId.trim()
          ? req.body.athleteId.trim()
          : undefined;
      const result = await testSavedFinalSurgeConnection({
        coachId: req.coach!.id,
        athleteId,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: finalSurgeFetcher,
        allowCustomHostForTesting: allowCustomFinalSurgeHostForTesting,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        connected: false,
        errorMessage: 'Unable to test Final Surge Calendar Sync feed.',
      });
    }
  });

  app.post('/api/integrations/final-surge/mappings', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' ? req.body.athleteId.trim() : '';
      const rawAction = req.body && typeof req.body.action === 'string' ? req.body.action : 'confirm';
      const action: 'confirm' | 'auto_match' | 'unlink' =
        rawAction === 'auto_match' || rawAction === 'unlink' ? rawAction : 'confirm';

      if (!athleteId) {
        res.status(400).json({ ok: false, error: 'athleteId is required.' });
        return;
      }

      const result = await upsertFinalSurgeAthleteMapping({
        coachId: req.coach!.id,
        athleteId,
        externalAthleteId:
          typeof req.body.externalAthleteId === 'string' ? req.body.externalAthleteId : undefined,
        externalEmail:
          typeof req.body.externalEmail === 'string' ? req.body.externalEmail : undefined,
        externalName:
          typeof req.body.externalName === 'string' ? req.body.externalName : undefined,
        action,
        supabaseClient: options?.supabaseClient,
        oauthStore,
      });
      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({ ok: false, error: 'Unable to update Final Surge athlete mapping.' });
    }
  });

  app.post('/api/integrations/final-surge/sync', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' ? req.body.athleteId.trim() : '';
      if (!athleteId) {
        res.status(400).json({
          ok: false,
          status: 'Failed',
          errorMessage: 'athleteId is required for Final Surge synchronization.',
        });
        return;
      }
      const mode = req.body?.mode === 'initial' ? 'initial' : 'incremental';
      const startDate =
        typeof req.body?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate)
          ? req.body.startDate
          : undefined;
      const endDate =
        typeof req.body?.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.endDate)
          ? req.body.endDate
          : undefined;

      const result = await synchronizeFinalSurgePlannedWorkouts({
        coachId: req.coach!.id,
        athleteId,
        mode,
        startDate,
        endDate,
        supabaseClient: options?.supabaseClient,
        oauthStore,
        fetcher: finalSurgeFetcher,
        allowCustomHostForTesting: allowCustomFinalSurgeHostForTesting,
      });

      if (result.ok) {
        try {
          await getCoachingIntelligence({
            coachId: req.coach!.id,
            athleteId,
            persist: true,
            supabaseClient: options?.supabaseClient,
            oauthStore,
          });
        } catch {
          // Non-fatal: planned workouts already persisted cleanly
        }
      }

      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        status: 'Failed',
        errorMessage: 'Unable to execute Final Surge synchronization.',
      });
    }
  });

  app.post('/api/integrations/final-surge/import', requireCoachAuth, async (req, res) => {
    try {
      const athleteId =
        req.body && typeof req.body.athleteId === 'string' ? req.body.athleteId.trim() : '';
      const format = req.body?.format === 'csv' ? 'csv' : 'ics';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!athleteId || !content.trim()) {
        res.status(400).json({
          ok: false,
          status: 'Failed',
          errorMessage: 'athleteId and non-empty ICS/CSV export content are required.',
        });
        return;
      }

      const startDate =
        typeof req.body?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.startDate)
          ? req.body.startDate
          : undefined;
      const endDate =
        typeof req.body?.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.endDate)
          ? req.body.endDate
          : undefined;

      const result = await importFinalSurgePlannedWorkouts({
        coachId: req.coach!.id,
        athleteId,
        format,
        content,
        startDate,
        endDate,
        supabaseClient: options?.supabaseClient,
        oauthStore,
      });

      if (result.ok) {
        try {
          await getCoachingIntelligence({
            coachId: req.coach!.id,
            athleteId,
            persist: true,
            supabaseClient: options?.supabaseClient,
            oauthStore,
          });
        } catch {
          // Non-fatal
        }
      }

      res.status(result.statusCode).json(result);
    } catch {
      res.status(503).json({
        ok: false,
        status: 'Failed',
        errorMessage: 'Unable to import Final Surge export.',
      });
    }
  });

  app.post('/api/integrations/final-surge/disconnect', requireCoachAuth, async (req, res) => {
    try {
      await disconnectFinalSurgeForCoach({
        coachId: req.coach!.id,
        oauthStore,
        supabaseClient: options?.supabaseClient,
      });
      res.json({ ok: true, connected: false });
    } catch {
      res.status(503).json({
        ok: false,
        error: 'Unable to disconnect Final Surge.',
      });
    }
  });

  if (mountFrontend) {
    if (!isProd) {
      const disableHmr = process.env.DISABLE_HMR === 'true';
      let vitePromise: Promise<import('vite').ViteDevServer> | null = null;
      const getViteServer = () => {
        if (!vitePromise) {
          vitePromise = import('vite')
            .then(({ createServer: createViteServer }) =>
              createViteServer({
                server: {
                  middlewareMode: true,
                  ...(disableHmr ? { hmr: false, ws: false } : {}),
                },
                appType: 'spa',
              })
            )
            .catch((err) => {
              vitePromise = null;
              throw err;
            });
        }
        return vitePromise;
      };

      app.locals.warmupVite = () => {
        void getViteServer().catch((err) => {
          console.error(
            'Vite dev middleware initialization warning:',
            err instanceof Error ? err.message : 'Unknown error'
          );
        });
      };

      if (deferStartupWork) {
        app.use((req, res, next) => {
          getViteServer()
            .then((vite) => vite.middlewares(req, res, next))
            .catch(next);
        });
      } else {
        const vite = await getViteServer();
        app.use(vite.middlewares);
      }
    } else {
      const distDir = path.resolve(__dirname, 'dist');
      if (fs.existsSync(distDir)) {
        app.use(express.static(distDir));
        app.get('*', (_req, res) => {
          res.sendFile(path.join(distDir, 'index.html'));
        });
      }
    }
  }

  return app;
}

function resolveCliPortArg(): number | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    }
  }
  return null;
}

function resolveDefaultServerPort(): number {
  const cliPort = resolveCliPortArg();
  if (cliPort !== null) return cliPort;
  const envPort = process.env.PORT ? Number(process.env.PORT) : 3000;
  if (process.env.NODE_ENV !== 'production' && (!Number.isInteger(envPort) || envPort === 8080)) {
    return 3000;
  }
  return Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : 3000;
}

async function startServer() {
  const app = await createApp({ mountFrontend: true, deferStartupWork: true });
  const port = resolveDefaultServerPort();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Running Coach AI server listening on port ${port}`);
    if (typeof app.locals.warmupVite === 'function') {
      setImmediate(() => {
        app.locals.warmupVite();
      });
    }
  });
  server.on('error', (err) => {
    console.error('Server listen error:', err instanceof Error ? err.message : 'Unknown error');
    process.exit(1);
  });
}

function resolveEntryPath(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

const isMainEntry =
  Boolean(process.argv[1]) && resolveEntryPath(process.argv[1]) === resolveEntryPath(__filename);

if (isMainEntry) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err instanceof Error ? err.message : 'Unknown error');
    process.exit(1);
  });
}

