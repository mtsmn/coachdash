import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'running-coach-ai', timestamp: new Date().toISOString() });
  });

  app.get('/api/integrations/status', (_req, res) => {
    const intervals = getSanitizedIntervalsConfigSummary();
    const hasFinalSurge = Boolean(
      process.env.FINALSURGE_CLIENT_ID?.trim() && process.env.FINALSURGE_CLIENT_SECRET?.trim()
    );
    const hasSupabase = Boolean(
      process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    );

    res.json({
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
        configured: hasSupabase,
        connected: false,
        mode: 'Normalized Browser Store + SQL-Ready 16-Table Schema',
      },
    });
  });

  app.get('/api/integrations/intervals/oauth/url', (req, res) => {
    const appBase =
      process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;
    res.json(buildIntervalsOAuthUrl(appBase));
  });

  app.get('/api/integrations/intervals/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const appBase =
      process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;

    if (!code) {
      res.status(400).send('Missing authorization code from Intervals.icu.');
      return;
    }

    const result = await exchangeIntervalsOAuthCode(code, appBase);
    if (!result.ok) {
      res.status(400).send(`Intervals.icu OAuth error: ${result.message}`);
      return;
    }

    res.redirect('/?intervals_oauth=connected');
  });

  app.post('/api/integrations/intervals/test', async (_req, res) => {
    const diagnostics = await runIntervalsReadOnlyConnectionTest();
    res.json(diagnostics);
  });

  app.post('/api/integrations/intervals/pilot-test', async (req, res) => {
    const pilotAthleteId =
      req.body && typeof req.body.pilotAthleteId === 'string'
        ? req.body.pilotAthleteId
        : undefined;
    const result = await runIntervalsPilotConnectionTest({ pilotAthleteId });
    res.json(result);
  });

  app.post('/api/integrations/intervals/validate-roster', async (req, res) => {
    const pilotAthleteId =
      req.body && typeof req.body.pilotAthleteId === 'string'
        ? req.body.pilotAthleteId
        : undefined;
    const windowDays =
      req.body && typeof req.body.windowDays === 'number' ? req.body.windowDays : 90;
    const report = await runFullRosterDeepTelemetryValidation({
      pilotAthleteId,
      windowDays,
    });
    res.json(report);
  });

  app.post('/api/integrations/intervals/roster-sync', (_req, res) => {
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
      message: 'Pilot gate passed. Roster synchronization is unlocked for verified shared athletes.',
    });
  });

  app.post('/api/integrations/intervals/disconnect', (_req, res) => {
    clearIntervalsSession();
    res.json({ ok: true, connected: false });
  });

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

  app.listen(port, '0.0.0.0', () => {
    console.log(`Running Coach AI server listening on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err instanceof Error ? err.message : 'Unknown error');
  process.exit(1);
});
