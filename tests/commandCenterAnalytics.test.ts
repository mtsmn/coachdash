import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoRoster } from '../src/data/mockRosterGenerator.ts';
import {
  buildRosterCommandCenterSnapshot,
  buildWeeklyCommandBriefingText,
} from '../src/utils/commandCenterAnalytics.ts';
import { WeeklyAthleteReport } from '../src/types/coaching.ts';

test('Command Center rankings: sorts 30 athletes by baseline-anchored priority and attaches supporting data to every alert', () => {
  const roster = generateDemoRoster();
  const snapshot = buildRosterCommandCenterSnapshot(roster);

  assert.equal(snapshot.rosterCount, 30);
  assert.equal(snapshot.rankedAthletes.length, 30);

  for (let i = 1; i < snapshot.rankedAthletes.length; i++) {
    assert.ok(snapshot.rankedAthletes[i - 1].attentionScore >= snapshot.rankedAthletes[i].attentionScore);
  }

  assert.ok(snapshot.allAlerts.length > 0);
  for (const alert of snapshot.allAlerts) {
    assert.ok(alert.explanation.length > 15);
    assert.ok(alert.supportingData.length >= 2);
  }
});

test('Command Center load alerts & positive developments: uses CTL/ATL/TSB vs personal baselines', () => {
  const roster = generateDemoRoster();
  const snapshot = buildRosterCommandCenterSnapshot(roster);

  assert.ok(snapshot.loadAlerts.length > 0);
  const jordanAlert = snapshot.loadAlerts.find((a) => a.athleteName === 'Jordan Vance');
  assert.ok(jordanAlert);
  assert.ok(jordanAlert.supportingData.some((s) => s.includes('CTL') && s.includes('ATL') && s.includes('TSB')));
  assert.ok(jordanAlert.supportingData.some((s) => s.includes('Personal 8-wk baseline')));

  assert.ok(snapshot.positiveDevelopments.length > 0);
  for (const pos of snapshot.positiveDevelopments) {
    assert.ok(pos.baselineComparison.length > 0);
    assert.ok(pos.supportingData.length >= 2);
  }
});

test('Command Center data hygiene & weekly briefing: surfaces outdated syncs, missing/invalid HR, and enforces approval gate', () => {
  const roster = generateDemoRoster();
  const snapshot = buildRosterCommandCenterSnapshot(roster);

  const issueTypes = new Set(snapshot.dataHygieneIssues.map((i) => i.issueType));
  assert.ok(issueTypes.has('Outdated Garmin Sync'));
  assert.ok(issueTypes.has('Invalid HR Telemetry'));
  assert.ok(issueTypes.has('Missing HR Telemetry'));
  assert.ok(issueTypes.has('Missing Garmin LTHR'));
  assert.ok(issueTypes.has('Unverified / Aging LTHR'));

  const mockReports: WeeklyAthleteReport[] = roster.map((a, idx) => ({
    athleteId: a.id,
    weekLabel: 'Nov 9–15, 2026',
    compliancePct: 90,
    actualMiles: 40,
    plannedMiles: 44,
    weeklyHrStress: 380,
    ctl: 52,
    atl: 54,
    tsb: -2,
    aiSummary: 'Summary',
    coachNote: '',
    status: idx < 3 ? 'Approved' : 'Draft',
    emailDeliveryNote: 'Coach approval required.',
  }));

  const briefing = buildWeeklyCommandBriefingText(snapshot, mockReports);
  assert.ok(briefing.includes('3 of 30 individual athlete reports approved'));
  assert.ok(briefing.includes('Automated athlete email dispatch is strictly disabled'));
  assert.ok(briefing.includes('POSITIVE PERFORMANCE DEVELOPMENTS'));
});
