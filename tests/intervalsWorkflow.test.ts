import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoRoster } from '../src/data/mockRosterGenerator.ts';
import { finalSurgeAdapter } from '../src/integrations/finalSurgeAdapter.ts';
import { intervalsIcuAdapter } from '../src/integrations/intervalsIcuAdapter.ts';
import { matchProviderIdentities } from '../src/utils/identityMatching.ts';
import {
  deduplicateActivities,
  previewHistoricalImportBatch,
  workoutToNormalizedSample,
} from '../src/utils/historicalImport.ts';
import {
  computeAllThreeLoadSystemsForAthlete,
  computeIndependentStressForActivity,
  computeSystemCLoadSeries,
  RUNNING_STRESS_METHODOLOGY_DOCS,
} from '../src/utils/loadSystems.ts';
import {
  extractFinalSurgePlannedWorkouts,
  matchPlannedAndCompletedWorkouts,
} from '../src/utils/workoutMatching.ts';
import { aiCoachingEngine } from '../src/integrations/aiEngine.ts';
import {
  buildNormalizedCoachingDatabase,
  INITIAL_AUDIT_EVENTS,
  INITIAL_SYNC_LOGS,
  prepareNormalizedImportArchitecture,
} from '../src/integrations/normalizedStore.ts';
import {
  isFullRosterSyncAllowed,
  resetPilotGateForTesting,
  runFullRosterDeepTelemetryValidation,
  runIntervalsPilotConnectionTest,
} from '../server/intervalsClient.ts';
import { NormalizedCompletedActivity } from '../src/types/coaching.ts';

test('Identity matching: links verified email matches, blocks name-only auto-merge, and honors coach overrides', () => {
  const roster = generateDemoRoster();
  const candidates = intervalsIcuAdapter.getPilotSampleCandidates();

  const mappings = matchProviderIdentities(roster, candidates);
  assert.equal(mappings.length, 30);

  // Exact email + Authorized (Read-Only)
  const maya = mappings.find((m) => m.athleteName === 'Maya Lin');
  assert.ok(maya);
  assert.equal(maya.matchStatus, 'Verified Match');
  assert.equal(maya.matchMethod, 'Exact Email Match');
  assert.equal(maya.intervalsIcuAthleteId, 'icu-i20491');

  // Exact email + Coach View Only must NOT verify for live import
  const devon = mappings.find((m) => m.athleteName === 'Devon Brooks');
  assert.ok(devon);
  assert.equal(devon.authorizationStatus, 'Coach View Only (No API Scope)');
  assert.equal(devon.matchStatus, 'Candidate Review Required');

  // Name-only candidate (email: null) MUST NOT auto-merge
  const priya = mappings.find((m) => m.athleteName === 'Priya Patel');
  assert.ok(priya);
  assert.equal(priya.intervalsIcuAthleteId, null);
  assert.equal(priya.matchStatus, 'Candidate Review Required');
  assert.equal(priya.matchMethod, 'Name-Only Blocked (Manual Review Required)');

  // Coach manual confirm / reject override
  const overridden = matchProviderIdentities(roster, candidates, {
    [priya.internalAthleteId]: { intervalsId: 'icu-i20588', rejected: false },
    [maya.internalAthleteId]: { intervalsId: null, rejected: true },
  });
  const priyaConfirmed = overridden.find((m) => m.athleteName === 'Priya Patel');
  const mayaRejected = overridden.find((m) => m.athleteName === 'Maya Lin');
  assert.equal(priyaConfirmed?.matchStatus, 'Verified Match');
  assert.equal(priyaConfirmed?.matchMethod, 'Coach Manual Match');
  assert.equal(priyaConfirmed?.intervalsIcuAthleteId, 'icu-i20588');
  assert.equal(mayaRejected?.matchStatus, 'Unmapped');
  assert.equal(mayaRejected?.intervalsIcuAthleteId, null);
});

test('Historical import & deduplication: separates raw payloads, blocks unauthorized athletes, skips duplicates, and flags LTHR shifts for approval', () => {
  const roster = generateDemoRoster();
  const candidates = intervalsIcuAdapter.getPilotSampleCandidates();
  const mappings = matchProviderIdentities(roster, candidates);

  const preview = previewHistoricalImportBatch({
    athletes: roster,
    mappings,
    mode: 'backfill_12_week',
  });

  // 3 authorized email-matched athletes (Maya, Jordan, Elena); Priya & Devon blocked
  assert.ok(preview.report.unauthorizedBlocked >= 2);
  assert.ok(preview.rawActivities.length > 0);
  assert.equal(preview.rawActivities.length, preview.acceptedActivities.length);
  assert.equal(preview.hrStreams.length, preview.acceptedActivities.length);

  // Jordan Vance has +3 bpm candidate shift flagged without overwriting athlete.lthrBpm
  const jordan = roster.find((a) => a.name === 'Jordan Vance');
  assert.ok(jordan);
  const jordanBeforeLthr = jordan.lthrBpm;
  const jordanCand = preview.report.lthrChangeCandidates.find(
    (c) => c.athleteId === jordan.id
  );
  assert.ok(jordanCand);
  assert.equal(jordanCand.status, 'Pending Coach Approval');
  assert.equal(jordan.lthrBpm, jordanBeforeLthr);

  // Deduplication: exact ID + fuzzy near-duplicate (within 5 min & 0.15 mi)
  const sampleAct = preview.acceptedActivities[0];
  const nearDuplicate: NormalizedCompletedActivity = {
    ...sampleAct,
    id: 'norm-fuzzy-dup',
    externalActivityId: 'icu-act-different-id',
    startTimeLocal: sampleAct.startTimeLocal,
    distanceMiles: Number((sampleAct.distanceMiles + 0.05).toFixed(2)),
  };
  const deduped = deduplicateActivities([sampleAct], [sampleAct, nearDuplicate]);
  assert.equal(deduped.accepted.length, 0);
  assert.equal(deduped.duplicatesSkipped.length, 2);
});

test('Three independent training load systems: preserves System A native load and isolates Systems B & C by methodology', () => {
  const roster = generateDemoRoster();
  const athlete = roster[0];
  const completed = athlete.workouts
    .filter((w) => w.type !== 'Rest' && w.status !== 'Missed' && w.status !== 'Planned')
    .map((w) => workoutToNormalizedSample(athlete, w));

  const systems = computeAllThreeLoadSystemsForAthlete(athlete, completed);

  assert.ok(systems.systemAProviderMetrics.length > 0);
  assert.ok(systems.systemAProviderMetrics.every((m) => m.originalValuesPreserved === true));

  // Missing HR yields null hrRunningStress (distinct from rest_zero = 0)
  const missingHrAct: NormalizedCompletedActivity = {
    ...completed[0],
    id: 'act-missing-hr',
    avgHrBpm: null,
    hrDataState: 'missing',
    avgPowerWatts: 295,
    rpe: 6,
  };
  const missingStress = computeIndependentStressForActivity({
    activity: missingHrAct,
    lthrBpm: athlete.lthrBpm,
    thresholdPaceSecPerMile: athlete.thresholdPaceSecPerMile,
    thresholdPowerWatts: 310,
  });
  assert.equal(missingStress.hrRunningStress, null);
  assert.ok(missingStress.paceRunningStress !== null && missingStress.paceRunningStress > 0);
  assert.ok(missingStress.powerRunningStress !== null && missingStress.powerRunningStress > 0);
  assert.ok(missingStress.sessionRpeStress !== null && missingStress.sessionRpeStress > 0);

  // System C methodologies remain completely isolated
  const hrSeries = systems.systemCSeriesByMethodology.hr_derived_stress;
  const paceSeries = systems.systemCSeriesByMethodology.running_tss_pace;
  const rpeSeries = systems.systemCSeriesByMethodology.session_rpe_stress;
  assert.equal(hrSeries.ctlTimeConstantDays, 42);
  assert.equal(hrSeries.atlTimeConstantDays, 7);
  assert.equal(
    Number((hrSeries.latestCtl - hrSeries.latestAtl).toFixed(1)),
    Number(hrSeries.latestTsb.toFixed(1))
  );
  assert.notEqual(hrSeries.latestCtl, rpeSeries.latestCtl);
  assert.ok(paceSeries.daily.length > 60);
});

test('Planned vs Completed workout matching: scores matches, flags uncertain matches for review, and distinguishes Missing Telemetry from Missed Workout', () => {
  const roster = generateDemoRoster();
  const athlete = roster[0];
  const planned = extractFinalSurgePlannedWorkouts(athlete).slice(0, 3);
  assert.equal(planned.length, 3);

  const act0 = workoutToNormalizedSample(athlete, athlete.workouts.find((w) => `plan-${w.id}` === planned[0].id)!);
  const act1 = workoutToNormalizedSample(athlete, athlete.workouts.find((w) => `plan-${w.id}` === planned[1].id)!);

  // Exact match with valid HR -> Auto-Matched
  const exactAct: NormalizedCompletedActivity = {
    ...act0,
    date: planned[0].date,
    startTimeLocal: planned[0].plannedStartTime,
    activityType: planned[0].workoutType,
    distanceMiles: planned[0].plannedMiles,
    durationMinutes: planned[0].plannedDurationMin,
    hrDataState: 'valid',
  };

  // Uncertain match (same date & morning start time, but swapped type + 22% shorter -> score ~67, Needs Coach Review)
  const uncertainAct: NormalizedCompletedActivity = {
    ...act1,
    id: 'act-uncertain',
    date: planned[1].date,
    startTimeLocal: planned[1].plannedStartTime,
    activityType: planned[1].workoutType === 'Easy' ? 'Tempo' : 'Easy',
    distanceMiles: Number((planned[1].plannedMiles * 0.78).toFixed(2)),
    durationMinutes: Math.round(planned[1].plannedDurationMin * 0.78),
    hrDataState: 'valid',
  };

  // Missing telemetry check on planned[0] if HR is missing
  const matches = matchPlannedAndCompletedWorkouts({
    athlete,
    plannedWorkouts: planned,
    completedActivities: [exactAct, uncertainAct],
  });

  const m0 = matches.find((m) => m.plannedWorkout?.id === planned[0].id);
  const m1 = matches.find((m) => m.plannedWorkout?.id === planned[1].id);
  const m2 = matches.find((m) => m.plannedWorkout?.id === planned[2].id);

  assert.equal(m0?.matchStatus, 'Auto-Matched');
  assert.equal(m1?.matchStatus, 'Needs Coach Review');
  assert.equal(m2?.matchStatus, 'Missed Workout');

  // After coach reviews uncertain match, status upgrades cleanly
  const reviewedMatches = matchPlannedAndCompletedWorkouts({
    athlete,
    plannedWorkouts: planned,
    completedActivities: [{ ...exactAct, avgHrBpm: null, hrDataState: 'missing' }, uncertainAct],
    reviewedIds: new Set([`match-${planned[1].id}`]),
  });
  const m0Missing = reviewedMatches.find((m) => m.plannedWorkout?.id === planned[0].id);
  const m1Reviewed = reviewedMatches.find((m) => m.plannedWorkout?.id === planned[1].id);
  assert.equal(m0Missing?.matchStatus, 'Missing Telemetry');
  assert.equal(m1Reviewed?.matchStatus, 'Auto-Matched');
  assert.equal(m1Reviewed?.coachReviewed, true);
});

test('Rules-based intelligence & 16-table normalized store: enforces classifications, guardrails, and table completeness', () => {
  const roster = generateDemoRoster();
  const candidates = intervalsIcuAdapter.getPilotSampleCandidates();
  const mappings = matchProviderIdentities(roster, candidates);

  const validClasses = new Set([
    'High priority: Coach review recommended',
    'Moderate priority: Monitor',
    'Positive development',
    'Insufficient data',
  ]);

  for (const athlete of roster) {
    const insight = aiCoachingEngine.analyzeAthlete(athlete);
    assert.ok(insight.primaryClassification && validClasses.has(insight.primaryClassification));
    assert.ok(insight.guardrailNotice.includes('does not predict injuries from training load ratios'));
    for (const f of insight.findings ?? []) {
      assert.ok(validClasses.has(f.classification));
      assert.ok(f.evidence.length > 0);
    }
  }

  const db = buildNormalizedCoachingDatabase({
    athletes: roster,
    mappings,
    reports: [],
    syncLogs: INITIAL_SYNC_LOGS,
    auditEvents: INITIAL_AUDIT_EVENTS,
  });

  assert.equal(db.athletes.length, 30);
  assert.equal(db.providerConnections.length, 3);
  assert.equal(db.providerAthleteMappings.length, 30);
  assert.ok(db.plannedWorkouts.length > 100);
  assert.ok(db.completedActivities.length > 100);
  assert.equal(db.heartRateStreams.length, db.completedActivities.length);
  assert.equal(db.athleteThresholds.length, 30);
  assert.equal(db.heartRateZones.length, 30);
  assert.ok(db.providerTrainingMetrics.length > 100);
  assert.equal(db.independentStressMetrics.length, db.completedActivities.length);
  assert.equal(db.dailyLoadHistories.length, 30);
  assert.equal(db.wellnessRecords.length, 30);
  assert.ok(db.coachingAlerts.length > 0);
  assert.equal(db.synchronizationLogs.length, INITIAL_SYNC_LOGS.length);
  assert.equal(db.auditEvents.length, INITIAL_AUDIT_EVENTS.length);
});

test('Pilot connection test: verifies personal API key auth (OAuth optional), coach info, roster, pilot athlete, HR/LTHR, exact permissions, and unverified athlete isolation', async () => {
  resetPilotGateForTesting();
  assert.equal(isFullRosterSyncAllowed(), false);

  // 1. Unconfigured credentials -> blocked, never fabricates live pass, OAuth optional
  const unconf = await runIntervalsPilotConnectionTest();
  assert.equal(unconf.configured, false);
  assert.equal(unconf.oauthRequired, false);
  assert.equal(unconf.readOnlyMode, true);
  assert.equal(unconf.demoModeFallbackActive, true);
  assert.equal(unconf.pilotTestSucceeded, false);
  assert.equal(unconf.fullRosterSyncAllowed, false);
  assert.equal(unconf.requiresIndividualAthleteKeys, false);
  assert.equal(unconf.coachAccountInfo, null);
  assert.equal(unconf.steps.length, 6);
  assert.ok(unconf.dataPermissions.every((p) => p.accessState === 'Unverified'));
  assert.equal(isFullRosterSyncAllowed(), false);

  // 2. Single Coach Personal API key (no OAuth vars) + authorized pilot athlete + untested athlete -> verified pilot only
  const seenAuthHeaders: string[] = [];
  const mockPassFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.Authorization) seenAuthHeaders.push(headers.Authorization);

    if (url.endsWith('/athlete/0')) {
      return new Response(
        JSON.stringify({
          id: 'i1000',
          name: 'Coach Mike',
          email: 'coach.mike@example.com',
          timezone: 'America/New_York',
        }),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/0/athlete-summary.json')) {
      return new Response(
        JSON.stringify([
          { athlete_id: 'i1000', athlete_name: 'Coach Mike' },
          { athlete_id: 'i20491', athlete_name: 'Maya Lin' },
          { athlete_id: 'i99999', athlete_name: 'Untested Athlete' },
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith('/athletes')) {
      return new Response(
        JSON.stringify([
          { id: 'i20491', name: 'Maya Lin' },
          { id: 'i99999', name: 'Untested Athlete' },
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith('/athlete/i20491')) {
      return new Response(
        JSON.stringify({
          id: 'i20491',
          name: 'Maya Lin',
          sportSettings: [{ types: ['Run'], lthr: 173, hr_zones: [138, 154, 164, 173, 189] }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/i20491/events')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes('/athlete/i20491/activities')) {
      return new Response(
        JSON.stringify([
          {
            id: 'act-1',
            type: 'Run',
            name: 'Tempo 8mi',
            start_date_local: '2026-11-17T07:00:00',
            distance: 12874,
            moving_time: 3360,
            average_hr: 168,
            max_hr: 177,
            icu_training_load: 92,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/i20491/wellness')) {
      return new Response(
        JSON.stringify([{ id: '2026-11-17', ctl: 64.2, atl: 71.5 }]),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };

  const passResult = await runIntervalsPilotConnectionTest({
    apiKeyOverride: 'coach-secret-test-key',
    fetcher: mockPassFetch,
  });

  const expectedBasic = `Basic ${Buffer.from('API_KEY:coach-secret-test-key').toString('base64')}`;
  assert.ok(seenAuthHeaders.length >= 6);
  assert.ok(seenAuthHeaders.every((h) => h === expectedBasic));

  assert.equal(passResult.requiresIndividualAthleteKeys, false);
  assert.equal(passResult.oauthRequired, false);
  assert.equal(passResult.readOnlyMode, true);
  assert.equal(passResult.authMechanism, 'coach_api_key');
  assert.equal(passResult.pilotTestSucceeded, true);
  assert.equal(passResult.fullRosterSyncAllowed, true);
  assert.equal(isFullRosterSyncAllowed(), true);
  assert.deepEqual(passResult.coachAccountInfo, {
    id: 'i1000',
    name: 'Coach Mike',
    email: 'coach.mike@example.com',
    timezone: 'America/New_York',
  });
  assert.equal(passResult.selectedPilotAthlete?.id, 'i20491');
  assert.equal(passResult.steps.length, 6);
  assert.ok(passResult.steps.every((s) => s.status === 'Passed'));

  // Untested athlete i99999 MUST NOT be assumed accessible
  const verifiedAthlete = passResult.coachedAthletes.find((a) => a.id === 'i20491');
  const untestedAthlete = passResult.coachedAthletes.find((a) => a.id === 'i99999');
  assert.equal(verifiedAthlete?.verificationStatus, 'Verified Read-Only');
  assert.equal(untestedAthlete?.verificationStatus, 'Unverified (Demo Mode Retained)');
  assert.equal(passResult.demoModeFallbackActive, true);

  // Exact available data permissions reported cleanly
  assert.ok(passResult.dataPermissions.length === 7);
  assert.ok(passResult.dataPermissions.every((p) => p.accessState === 'Verified Read-Only'));

  assert.equal(passResult.pilotMetricsSummary.totalCompletedActivityCount, 1);
  assert.equal(passResult.pilotMetricsSummary.runningActivityCount, 1);
  assert.equal(passResult.pilotMetricsSummary.detectedLthrBpm, 173);
  assert.equal(passResult.pilotMetricsSummary.latestIcuTrainingLoad, 92);
  assert.equal(passResult.pilotMetricsSummary.latestIcuCtl, 64.2);
  assert.equal(passResult.pilotMetricsSummary.latestIcuAtl, 71.5);

  // 3. Shared athlete denies API scope (403) -> full roster sync locks back down & reports Denied permissions
  const mock403Fetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/athlete/0')) {
      return new Response(JSON.stringify({ id: 'i1000', name: 'Coach Mike' }), { status: 200 });
    }
    if (url.includes('/athlete/0/athlete-summary.json') || url.endsWith('/athletes')) {
      return new Response(JSON.stringify([{ id: 'i20603', name: 'Devon Brooks' }]), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  };

  const failResult = await runIntervalsPilotConnectionTest({
    pilotAthleteId: 'i20603',
    apiKeyOverride: 'coach-secret-test-key',
    fetcher: mock403Fetch,
  });
  assert.equal(failResult.pilotTestSucceeded, false);
  assert.equal(failResult.fullRosterSyncAllowed, false);
  assert.equal(failResult.demoModeFallbackActive, true);
  assert.equal(isFullRosterSyncAllowed(), false);
  assert.equal(failResult.steps.find((s) => s.id === 'shared_athlete_access')?.status, 'Failed');
  assert.equal(
    failResult.coachedAthletes.find((a) => a.id === 'i20603')?.verificationStatus,
    'Permission Denied'
  );
  assert.equal(
    failResult.dataPermissions.find((p) => p.permissionKey === 'coach_account_info')?.accessState,
    'Verified Read-Only'
  );
  assert.equal(
    failResult.dataPermissions.find((p) => p.permissionKey === 'pilot_completed_activities')?.accessState,
    'Denied / Unavailable'
  );
});

test('Final Surge primary source: audits API/HR stream limits and computes hrRSS, Pace rTSS, CTL/ATL/TSB without power or Intervals.icu', () => {
  const audit = finalSurgeAdapter.getCapabilityAudit();
  const hrGraphAudit = audit.find((c) => c.field.includes('Detailed HR Time-Series'));
  const powerAudit = audit.find((c) => c.field.includes('Running Power'));
  assert.ok(hrGraphAudit);
  assert.equal(hrGraphAudit.visibleInWebUi, true);
  assert.equal(hrGraphAudit.publicRestApiAvailable, false);
  assert.ok(powerAudit?.notes.includes('never requires running power'));

  assert.ok(RUNNING_STRESS_METHODOLOGY_DOCS.hrDerivedStress.formula.includes('Athlete_LTHR'));
  assert.ok(RUNNING_STRESS_METHODOLOGY_DOCS.ewmaLoadModel.formula.includes('1 - e^{-1/42}'));

  const csv = [
    'Date,Title,Type,DistanceMiles,DurationMinutes,AvgPace,AvgHR,MaxHR',
    '2026-11-17,Threshold 60m,Tempo,8.8,60,6:49,170,178',
    '2026-11-18,Easy 45m,Easy,5.5,45,8:11,145,154',
  ].join('\n');

  const parsed = finalSurgeAdapter.parseCoachCsvExport(csv, 192);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.rows.length, 2);

  const lthrBpm = 170;
  const thresholdPaceSecPerMile = 409; // 6:49/mi
  const stressRecords = parsed.rows.map((r, idx) =>
    computeIndependentStressForActivity({
      activity: {
        id: `fs-${idx}`,
        athleteId: 'ath-01',
        externalActivityId: `fs-${idx}`,
        provider: 'final_surge',
        sourceDevice: 'Final Surge Summary',
        date: r.date,
        startTimeLocal: '07:00',
        title: r.title,
        activityType: r.activityType,
        durationMinutes: r.durationMinutes,
        distanceMiles: r.distanceMiles,
        avgPaceSecPerMile: r.avgPaceSecPerMile,
        avgHrBpm: r.avgHrBpm,
        maxHrBpm: r.maxHrBpm,
        avgPowerWatts: null,
        elevationGainFt: 0,
        rpe: null,
        hrDataState: r.hrDataState,
        hrValidationFlags: r.hrValidationFlags,
        rawRecordId: `fs-raw-${idx}`,
      },
      lthrBpm,
      thresholdPaceSecPerMile,
      thresholdPowerWatts: null,
    })
  );

  // 60m @ 170 bpm with LTHR 170 -> exact 100.0 hrRSS and ~100.0 Pace rTSS, zero power required
  assert.equal(stressRecords[0].hrRunningStress, 100);
  assert.equal(stressRecords[0].paceRunningStress, 100);
  assert.equal(stressRecords[0].powerRunningStress, null);

  const ctlSeries = computeSystemCLoadSeries({
    stressRecords,
    methodology: 'hr_derived_stress',
    startDateIso: '2026-11-16',
    endDateIso: '2026-11-18',
    initialCtl: 40,
    initialAtl: 40,
  });
  assert.equal(ctlSeries.ctlTimeConstantDays, 42);
  assert.equal(ctlSeries.atlTimeConstantDays, 7);
  assert.ok(
    Math.abs(ctlSeries.latestCtl - ctlSeries.latestAtl - ctlSeries.latestTsb) <= 0.15
  );
});

test('Full-roster deep telemetry validation & import architecture: verifies LTHR, HR streams, wellness, missing-field honesty, and staging readiness', async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/athlete/0')) {
      return new Response(
        JSON.stringify({ id: 'i81059', name: 'Coach Test', email: 'coach@example.com' }),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/0/athlete-summary.json') || url.endsWith('/athletes')) {
      return new Response(
        JSON.stringify([
          { id: 'i1', name: 'Full Telemetry Runner' },
          { id: 'i2', name: 'Missing LTHR Runner' },
          { id: 'i3', name: 'Denied Athlete' },
        ]),
        { status: 200 }
      );
    }
    if (url.endsWith('/athlete/i1')) {
      return new Response(
        JSON.stringify({
          id: 'i1',
          name: 'Full Telemetry Runner',
          sportSettings: [{ types: ['Run'], lthr: 165, hr_zones: [130, 145, 155, 165, 180], threshold_pace: 4.1 }],
        }),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/i1/activities')) {
      return new Response(
        JSON.stringify([
          {
            id: 'act-full-1',
            type: 'Run',
            start_date_local: '2026-11-18T07:00:00',
            average_heartrate: 152,
            max_heartrate: 171,
            icu_training_load: 52,
          },
          {
            id: 'act-full-0',
            type: 'Run',
            start_date_local: '2026-09-01T07:00:00',
            average_heartrate: 149,
            max_heartrate: 166,
            icu_training_load: 44,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/activity/act-full-1/streams.json')) {
      return new Response(
        JSON.stringify([{ type: 'heartrate', data: [140, 148, 155, 162, 159] }]),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/i1/wellness')) {
      return new Response(
        JSON.stringify([{ id: '2026-11-18', ctl: 42.3, atl: 48.1, hrv: 62, restingHR: 48, sleepSecs: 27000 }]),
        { status: 200 }
      );
    }

    if (url.endsWith('/athlete/i2')) {
      return new Response(
        JSON.stringify({ id: 'i2', name: 'Missing LTHR Runner', sportSettings: [{ types: ['Run'] }] }),
        { status: 200 }
      );
    }
    if (url.includes('/athlete/i2/activities')) {
      return new Response(
        JSON.stringify([
          {
            id: 'act-part-1',
            type: 'Run',
            start_date_local: '2026-11-17T07:00:00',
            average_heartrate: 150,
            icu_training_load: 30,
          },
        ]),
        { status: 200 }
      );
    }
    if (url.includes('/activity/act-part-1/streams.json')) {
      return new Response(JSON.stringify([{ type: 'heartrate', data: [] }]), { status: 200 });
    }
    if (url.includes('/athlete/i2/wellness')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  };

  const report = await runFullRosterDeepTelemetryValidation({
    apiKeyOverride: 'test-key',
    fetcher: mockFetch,
    pilotAthleteId: 'i1',
    windowDays: 90,
  });

  assert.equal(report.readOnlyMode, true);
  assert.equal(report.totalCoachedAthletes, 3);
  assert.equal(report.summary.fullTelemetryReadyCount, 1);
  assert.equal(report.summary.partialTelemetryCount, 1);
  assert.equal(report.summary.permissionDeniedCount, 1);

  const a1 = report.athletes.find((a) => a.athleteId === 'i1')!;
  const a2 = report.athletes.find((a) => a.athleteId === 'i2')!;
  const a3 = report.athletes.find((a) => a.athleteId === 'i3')!;

  assert.equal(a1.detectedLthrBpm, 165);
  assert.equal(a1.hrStreamAvailable, true);
  assert.equal(a1.hrStreamSampleCount, 5);
  assert.equal(a1.latestCtl, 42.3);
  assert.equal(a1.latestHrv, 62);
  assert.equal(a1.independentLoadEngineReadiness.hrDerivedStressReady, true);

  assert.equal(a2.detectedLthrBpm, null);
  assert.equal(a2.hrStreamAvailable, false);
  assert.ok(a2.missingFields.includes('LTHR'));
  assert.ok(a2.missingFields.includes('HR Time-Series Stream'));
  assert.equal(a2.independentLoadEngineReadiness.hrDerivedStressReady, false);

  assert.equal(a3.dataQualityTier, 'Permission Denied');

  const roster = generateDemoRoster();
  const db = buildNormalizedCoachingDatabase({
    athletes: roster,
    mappings: matchProviderIdentities(roster, intervalsIcuAdapter.getPilotSampleCandidates()),
    reports: [],
    syncLogs: INITIAL_SYNC_LOGS,
    auditEvents: INITIAL_AUDIT_EVENTS,
  });
  const arch = prepareNormalizedImportArchitecture({
    validationAthletes: report.athletes,
    normalizedDb: db,
  });
  assert.equal(arch.automatedEmailDispatchEnabled, false);
  assert.equal(arch.syntheticFallbackAllowed, false);
  assert.equal(arch.tableCoverageCount, 16);
  assert.equal(arch.athleteStaging.length, 3);
  assert.equal(arch.athleteStaging[1].systemBHrStressStatus, 'Blocked (Missing LTHR or Avg HR)');
});
