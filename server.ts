import 'dotenv/config';
import express, { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CoachTokenVerifier,
  createOptionalCoachAuth,
  createRequireCoachAuth,
} from './server/authMiddleware.ts';
import { isTokenEncryptionConfigured } from './server/crypto.ts';
import {
  buildIntervalsOAuthUrl,
  clearIntervalsSession,
  exchangeIntervalsOAuthCode,
  getSanitizedIntervalsConfigSummary,
  isFullRosterSyncAllowed,
  runFullRosterDeepTelemetryValidation,
  runIntervalsPilotConnectionTest,
  runIntervalsReadOnlyConnectionTest,
} from './server/intervalsClient.ts';
import { getOAuthPersistenceStore, OAuthPersistenceStore } from './server/oauthStore.ts';
import {
  checkSupabaseDatabaseReachable,
  isSupabaseServerConfigured,
} from './server/supabaseAdmin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CreateAppOptions {
  authVerifier?: CoachTokenVerifier;
  oauthStore?: OAuthPersistenceStore;
  databaseChecker?: () => Promise<{ configured: boolean; connected: boolean; detail: string }>;
  mountFrontend?: boolean;
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
  const oauthStore = options?.oauthStore ?? getOAuthPersistenceStore();
  const databaseChecker = options?.databaseChecker ?? checkSupabaseDatabaseReachable;
  const requireCoachAuth = createRequireCoachAuth(options?.authVerifier);
  const optionalCoachAuth = createOptionalCoachAuth(options?.authVerifier);

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

  // Exposes safe, non-sensitive config flags anonymously; private coach details require auth.
  app.get('/api/integrations/status', optionalCoachAuth, async (req, res) => {
    const isAuthenticated = Boolean(req.coach);
    const intervals = getSanitizedIntervalsConfigSummary(isAuthenticated);
    const hasFinalSurge = Boolean(
      process.env.FINALSURGE_CLIENT_ID?.trim() && process.env.FINALSURGE_CLIENT_SECRET?.trim()
    );
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
        configured: hasFinalSurge,
        connected: false,
        role: 'Primary Source · Roster, Planned & Completed Workouts, Pace, Distance, Duration, Avg/Max HR',
        apiAvailability: 'Partner API Only (No Public Self-Serve Developer API)',
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
  });

  app.get('/api/integrations/intervals/oauth/url', requireCoachAuth, async (req, res) => {
    const appBase = resolveAppBaseUrl(req);
    const result = await buildIntervalsOAuthUrl(appBase, {
      coachId: req.coach!.id,
      store: oauthStore,
    });
    res.json(result);
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
    const diagnostics = await runIntervalsReadOnlyConnectionTest({
      coachId: req.coach!.id,
      store: oauthStore,
    });
    res.json(diagnostics);
  });

  app.post('/api/integrations/intervals/pilot-test', requireCoachAuth, async (req, res) => {
    const pilotAthleteId =
      req.body && typeof req.body.pilotAthleteId === 'string'
        ? req.body.pilotAthleteId
        : undefined;
    const result = await runIntervalsPilotConnectionTest({
      pilotAthleteId,
      coachId: req.coach!.id,
      store: oauthStore,
    });
    res.json(result);
  });

  app.post('/api/integrations/intervals/validate-roster', requireCoachAuth, async (req, res) => {
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
    });
    res.json(report);
  });

  app.post('/api/integrations/intervals/roster-sync', requireCoachAuth, (_req, res) => {
    if (!isFullRosterSyncAllowed()) {
      res.status(409).json({
        ok: false,
        blockedByPilotGate: true,
        message:
          'Full roster synchronization is locked until the 6-step Pilot Athlete Connection Test succeeds.',
      });
      return;
    }
    res.json({
      ok: true,
      blockedByPilotGate: false,
      liveIngestionImplemented: false,
      message:
        'Pilot gate passed. Authenticated coach verified; full live roster ingestion is scheduled for Phase 2.',
    });
  });

  app.post('/api/integrations/intervals/disconnect', requireCoachAuth, async (req, res) => {
    await clearIntervalsSession(req.coach!.id, oauthStore);
    res.json({ ok: true, connected: false });
  });

  if (mountFrontend) {
    if (!isProd) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
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

async function startServer() {
  const app = await createApp({ mountFrontend: true });
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Running Coach AI server listening on port ${port}`);
  });
}

const isMainEntry =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainEntry) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err instanceof Error ? err.message : 'Unknown error');
    process.exit(1);
  });
}

