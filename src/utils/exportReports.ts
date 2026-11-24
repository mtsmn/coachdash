import { Athlete, WeeklyAthleteReport } from '../types/coaching';
import { formatDuration, formatPace } from './analytics';

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadRosterBriefingMarkdown(
  reports: WeeklyAthleteReport[],
  athletes: Athlete[],
  weekLabel: string
) {
  const athleteMap = new Map(athletes.map((a) => [a.id, a]));
  const totalActual = reports.reduce((s, r) => s + r.actualMiles, 0);
  const totalPlanned = reports.reduce((s, r) => s + r.plannedMiles, 0);
  const approvedCount = reports.filter((r) => r.status === 'Approved').length;
  const generatedLabel = athletes.some((a) => a.productionContext?.isProduction)
    ? new Date().toISOString().slice(0, 10)
    : 'November 18, 2026';

  const lines: string[] = [
    `# Running Coach AI — Roster Weekly Coaching Briefing`,
    `**Week:** ${weekLabel}  `,
    `**Generated:** ${generatedLabel}  `,
    `**Active Roster:** ${athletes.length} Athletes  `,
    totalPlanned > 0
      ? `**Roster Mileage:** ${totalActual.toFixed(1)} actual / ${totalPlanned.toFixed(1)} planned mi  `
      : `**Roster Mileage:** ${totalActual.toFixed(1)} mi  `,
    `**Coach-Approved Reports:** ${approvedCount} / ${reports.length}`,
    ``,
    `> Note: Stress metrics use HR-Derived Running Stress (hrRSS) anchored to individualized LTHR. They are distinct from pace/power TrainingPeaks TSS and Intervals.icu native load.`,
    ``,
    `---`,
    ``,
    `## Individual Athlete Summaries`,
    ``,
  ];

  for (const r of reports) {
    const a = athleteMap.get(r.athleteId);
    if (!a) continue;
    const lthrLabel = a.lthrBpm > 0 ? `${a.lthrBpm} bpm (v${a.activeThresholdVersion})` : 'Not set';
    const goalLabel =
      a.productionContext?.hasGoalRace === false || !a.goal.raceDate
        ? 'No goal race configured'
        : `${a.goal.raceName} (${a.goal.raceDate}, Target ${formatDuration(a.goal.targetTimeSeconds)})`;
    lines.push(`### ${a.name} (${a.trainingGroup} · ${a.currentPhase})`);
    lines.push(
      `- **LTHR Reference:** ${lthrLabel} · CTL ${r.ctl.toFixed(1)} / ATL ${r.atl.toFixed(1)} / TSB ${r.tsb.toFixed(1)}`
    );
    lines.push(`- **Goal Race:** ${goalLabel}`);
    lines.push(
      `- **Weekly Volume & Stress:** ${r.actualMiles.toFixed(1)} mi${
        r.plannedMiles > 0 ? ` (${r.plannedMiles.toFixed(1)} mi planned)` : ''
      } · ${r.weeklyHrStress.toFixed(1)} HR-Stress`
    );
    lines.push(`- **Approval Status:** ${r.status}`);
    lines.push(`- **Coaching Summary:** ${r.aiSummary}`);
    if (r.coachNote.trim()) {
      lines.push(`- **Coach Note:** ${r.coachNote}`);
    }
    lines.push(``);
  }

  triggerDownload(
    `roster-briefing-${weekLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`,
    lines.join('\n'),
    'text/markdown'
  );
}

export function downloadRosterCsv(reports: WeeklyAthleteReport[], athletes: Athlete[]) {
  const athleteMap = new Map(athletes.map((a) => [a.id, a]));
  const header = [
    'Athlete',
    'Group',
    'Phase',
    'LTHR (bpm)',
    'LTHR Version',
    'Weekly HR-Stress',
    'CTL (42d)',
    'ATL (7d)',
    'TSB (CTL-ATL)',
    'Goal Race',
    'Race Date',
    'Actual Miles',
    'Planned Miles',
    'Approval Status',
    'Coach Note',
  ].join(',');

  const rows = reports.map((r) => {
    const a = athleteMap.get(r.athleteId);
    const cols = [
      `"${(a?.name ?? r.athleteId).replace(/"/g, '""')}"`,
      `"${a?.trainingGroup ?? ''}"`,
      `"${a?.currentPhase ?? ''}"`,
      a && a.lthrBpm > 0 ? String(a.lthrBpm) : '',
      String(a?.activeThresholdVersion ?? ''),
      r.weeklyHrStress.toFixed(1),
      r.ctl.toFixed(1),
      r.atl.toFixed(1),
      r.tsb.toFixed(1),
      `"${(a?.productionContext?.hasGoalRace === false ? '' : a?.goal.raceName ?? '').replace(/"/g, '""')}"`,
      a?.productionContext?.hasGoalRace === false ? '' : a?.goal.raceDate ?? '',
      r.actualMiles.toFixed(1),
      r.plannedMiles.toFixed(1),
      r.status,
      `"${(r.coachNote || '').replace(/"/g, '""')}"`,
    ];
    return cols.join(',');
  });

  triggerDownload('running-coach-ai-weekly-roster.csv', [header, ...rows].join('\n'), 'text/csv');
}

export function downloadAthleteReportMarkdown(athlete: Athlete, report: WeeklyAthleteReport) {
  const lthrLabel =
    athlete.lthrBpm > 0 ? `${athlete.lthrBpm} bpm (Version ${athlete.activeThresholdVersion})` : 'Not set';
  const goalLabel =
    athlete.productionContext?.hasGoalRace === false || !athlete.goal.raceDate
      ? 'No goal race configured'
      : `${athlete.goal.raceName} on ${athlete.goal.raceDate} (Target: ${formatDuration(athlete.goal.targetTimeSeconds)})`;
  const datasetNote = athlete.productionContext?.isProduction
    ? 'Generated by Running Coach AI (Intervals.icu & Supabase Production Data — HR-Derived Stress is anchored to LTHR and distinct from TrainingPeaks pace/power TSS).'
    : 'Generated by Running Coach AI (Local Sample Dataset — HR-Derived Stress is anchored to LTHR and distinct from TrainingPeaks pace/power TSS).';

  const md = [
    `# Weekly Training Summary — ${athlete.name}`,
    `**Week:** ${report.weekLabel}  `,
    `**Training Group:** ${athlete.trainingGroup} (${athlete.currentPhase} Phase)  `,
    `**LTHR Reference:** ${lthrLabel}  `,
    `**Goal Race:** ${goalLabel}  `,
    `**Approval Status:** ${report.status}`,
    ``,
    `## Weekly Snapshot`,
    `- **Mileage:** ${report.actualMiles.toFixed(1)} completed${
      report.plannedMiles > 0 ? ` / ${report.plannedMiles.toFixed(1)} planned` : ''
    } miles`,
    `- **HR-Derived Running Stress (hrRSS):** ${report.weeklyHrStress.toFixed(1)}`,
    `- **Load Balance:** CTL ${report.ctl.toFixed(1)} · ATL ${report.atl.toFixed(1)} · TSB ${report.tsb.toFixed(1)}`,
    `- **Threshold Pace Benchmark:** ${formatPace(athlete.thresholdPaceSecPerMile)}/mi`,
    ``,
    `## Coaching Analysis`,
    report.aiSummary,
    ``,
    `## Coach Feedback`,
    report.coachNote || '_No additional coach notes added yet._',
    ``,
    `---`,
    `*${datasetNote}*`,
  ].join('\n');

  const slug = athlete.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  triggerDownload(`${slug}-weekly-report.md`, md, 'text/markdown');
}

export function downloadAthleteReportHtml(athlete: Athlete, report: WeeklyAthleteReport) {
  const lthrLabel =
    athlete.lthrBpm > 0 ? `LTHR ${athlete.lthrBpm} bpm (v${athlete.activeThresholdVersion})` : 'LTHR Not set';
  const goalFooter =
    athlete.productionContext?.hasGoalRace === false || !athlete.goal.raceDate
      ? 'No target event configured'
      : `Target Event: ${athlete.goal.raceName} (${athlete.goal.raceDate})`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Weekly Training Summary — ${athlete.name}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0A1628; max-width: 720px; margin: 40px auto; padding: 0 24px; line-height: 1.6; }
  .header { border-bottom: 2px solid #0A1628; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; font-weight: 700; }
  h1 { margin: 6px 0 4px; font-size: 24px; }
  .meta { color: #475569; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
  .stat { border: 1px solid #CBD5E1; border-radius: 8px; padding: 12px; }
  .stat-label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: 600; }
  .stat-val { font-size: 18px; font-weight: 700; margin-top: 4px; }
  .section { margin-top: 24px; }
  .section h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; border-bottom: 1px solid #E2E8F0; padding-bottom: 6px; }
  .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #E2E8F0; font-size: 12px; color: #64748B; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">Running Coach AI · Weekly Athlete Report</div>
    <h1>${athlete.name}</h1>
    <div class="meta">${report.weekLabel} · ${lthrLabel} · Approval: <strong>${report.status}</strong></div>
  </div>
  <div class="grid">
    <div class="stat"><div class="stat-label">Mileage</div><div class="stat-val">${report.actualMiles.toFixed(1)}${report.plannedMiles > 0 ? ` / ${report.plannedMiles.toFixed(1)}` : ''} mi</div></div>
    <div class="stat"><div class="stat-label">HR-Stress</div><div class="stat-val">${report.weeklyHrStress.toFixed(1)}</div></div>
    <div class="stat"><div class="stat-label">CTL / ATL / TSB</div><div class="stat-val">${report.ctl.toFixed(0)} / ${report.atl.toFixed(0)} / ${report.tsb.toFixed(0)}</div></div>
  </div>
  <div class="section">
    <h2>Training & Recovery Analysis</h2>
    <p>${report.aiSummary}</p>
  </div>
  <div class="section">
    <h2>Coach Feedback</h2>
    <p>${report.coachNote ? report.coachNote.replace(/\n/g, '<br/>') : 'No additional coach notes added.'}</p>
  </div>
  <div class="footer">${goalFooter} · HR-Derived Stress is anchored to LTHR and distinct from TrainingPeaks TSS.</div>
</body>
</html>`;

  const slug = athlete.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  triggerDownload(`${slug}-weekly-report.html`, html, 'text/html');
}

export function downloadTrainingLoadSummaryMarkdown(
  reports: WeeklyAthleteReport[],
  athletes: Athlete[]
) {
  const athleteMap = new Map(athletes.map((a) => [a.id, a]));
  const anchorLabel = athletes.some((a) => a.productionContext?.isProduction)
    ? athletes.find((a) => a.productionContext?.anchorDateIso)?.productionContext?.anchorDateIso ?? new Date().toISOString().slice(0, 10)
    : 'November 18, 2026';
  const lines = [
    `# Running Coach AI — Roster Training Load Summary`,
    `**Anchor Date:** ${anchorLabel} · **Athletes:** ${athletes.length}`,
    `> Stress uses LTHR-anchored hrRSS (42d CTL / 7d ATL / TSB = CTL - ATL). Distinct from official TrainingPeaks TSS and native Intervals.icu load.`,
    ``,
    `| Athlete | LTHR (bpm) | Weekly hrRSS | CTL (42d) | ATL (7d) | TSB |`,
    `| :--- | ---: | ---: | ---: | ---: | ---: |`,
    ...reports.map((r) => {
      const a = athleteMap.get(r.athleteId);
      const lthr = a && a.lthrBpm > 0 ? String(a.lthrBpm) : '--';
      return `| ${a?.name ?? r.athleteId} | ${lthr} | ${r.weeklyHrStress.toFixed(0)} | ${r.ctl.toFixed(1)} | ${r.atl.toFixed(1)} | ${r.tsb >= 0 ? '+' : ''}${r.tsb.toFixed(1)} |`;
    }),
  ];
  triggerDownload('running-coach-ai-load-summary.md', lines.join('\n'), 'text/markdown');
}

export function downloadRacePrepSummaryMarkdown(
  reports: WeeklyAthleteReport[],
  athletes: Athlete[]
) {
  const reportMap = new Map(reports.map((r) => [r.athleteId, r]));
  const anchorIso =
    athletes.find((a) => a.productionContext?.anchorDateIso)?.productionContext?.anchorDateIso ??
    '2026-11-18';
  const upcoming = [...athletes]
    .filter((a) => a.productionContext?.hasGoalRace !== false && Boolean(a.goal.raceDate))
    .map((a) => ({
      athlete: a,
      days: Math.round(
        (new Date(a.goal.raceDate + 'T00:00:00Z').getTime() -
          new Date(anchorIso + 'T00:00:00Z').getTime()) /
          86400000
      ),
    }))
    .filter((x) => x.days >= 0)
    .sort((a, b) => a.days - b.days);

  const lines = [
    `# Running Coach AI — Race Preparation Summary`,
    `**Anchor Date:** ${anchorIso}`,
    ``,
    `| Days Out | Athlete | Goal Race | Date | Target | Phase | CTL / TSB |`,
    `| ---: | :--- | :--- | :--- | ---: | :--- | ---: |`,
    ...upcoming.map(({ athlete, days }) => {
      const r = reportMap.get(athlete.id);
      return `| ${days}d | ${athlete.name} | ${athlete.goal.raceName} | ${athlete.goal.raceDate} | ${formatDuration(
        athlete.goal.targetTimeSeconds
      )} | ${athlete.currentPhase} | ${r ? `${r.ctl.toFixed(0)} / ${r.tsb >= 0 ? '+' : ''}${r.tsb.toFixed(1)}` : '--'} |`;
    }),
  ];
  triggerDownload('running-coach-ai-race-prep-summary.md', lines.join('\n'), 'text/markdown');
}

export function downloadAttentionReportMarkdown(
  items: Array<{
    athleteName: string;
    tier: string;
    score: number;
    alerts: Array<{ title: string; explanation: string; supportingData: string[] }>;
  }>
) {
  const generatedLabel = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Running Coach AI — Coaching Attention Report`,
    `**Generated:** ${generatedLabel} · **Flagged Athletes:** ${items.length}`,
    `> Analytical coaching alerts only. Does not diagnose injuries or predict injuries from load ratios.`,
    ``,
    ...items.flatMap((item) => [
      `## ${item.athleteName} (${item.tier} · Score ${item.score})`,
      ...item.alerts.flatMap((al) => [
        `- **${al.title}**: ${al.explanation}`,
        ...al.supportingData.map((d) => `  - ${d}`),
      ]),
      ``,
    ]),
  ];
  triggerDownload('running-coach-ai-attention-report.md', lines.join('\n'), 'text/markdown');
}

