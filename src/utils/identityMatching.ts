import {
  Athlete,
  IntervalsCandidateProfile,
  UnifiedAthleteMapping,
} from '../types/coaching';

/**
 * Computes Levenshtein-free token similarity for advisory flagging only.
 * CRITICAL RULE: Never auto-merge athletes based solely on similar names.
 */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function matchProviderIdentities(
  athletes: Athlete[],
  candidates: IntervalsCandidateProfile[],
  manualOverrides: Record<string, { intervalsId: string | null; rejected?: boolean }> = {}
): UnifiedAthleteMapping[] {
  const candidateById = new Map(candidates.map((c) => [c.intervalsAthleteId, c]));
  const candidateByEmail = new Map<string, IntervalsCandidateProfile>();
  for (const c of candidates) {
    if (c.email) {
      candidateByEmail.set(normalizeText(c.email), c);
    }
  }

  return athletes.map((athlete) => {
    const override = manualOverrides[athlete.id];
    const nowIso = '2026-11-18T14:55:00Z';

    if (override?.rejected) {
      return {
        internalAthleteId: athlete.id,
        athleteName: athlete.name,
        email: athlete.email,
        finalSurgeId: athlete.finalSurgeId,
        intervalsIcuAthleteId: null,
        authorizationStatus: 'Unlinked',
        matchStatus: 'Unmapped',
        matchMethod: 'Unmatched',
        matchConfidencePct: 0,
        candidateIntervalsProfile: null,
        note: 'Candidate match explicitly rejected by coach; athlete remains unlinked.',
        updatedAt: nowIso,
      };
    }

    if (override?.intervalsId) {
      const matched = candidateById.get(override.intervalsId) ?? null;
      return {
        internalAthleteId: athlete.id,
        athleteName: athlete.name,
        email: athlete.email,
        finalSurgeId: athlete.finalSurgeId,
        intervalsIcuAthleteId: override.intervalsId,
        authorizationStatus: matched?.authorizationState ?? 'Authorized (Read-Only)',
        matchStatus: 'Verified Match',
        matchMethod: 'Coach Manual Match',
        matchConfidencePct: 100,
        candidateIntervalsProfile: matched,
        note: `Manually verified and linked by coach to Intervals.icu ID ${override.intervalsId}.`,
        updatedAt: nowIso,
      };
    }

    // 1. Existing verified external ID match
    if (athlete.intervalsIcuAthleteId) {
      const matched = candidateById.get(athlete.intervalsIcuAthleteId) ?? null;
      return {
        internalAthleteId: athlete.id,
        athleteName: athlete.name,
        email: athlete.email,
        finalSurgeId: athlete.finalSurgeId,
        intervalsIcuAthleteId: athlete.intervalsIcuAthleteId,
        authorizationStatus:
          matched?.authorizationState ?? athlete.dataAuthorizationStatus ?? 'Demo Sample',
        matchStatus: 'Verified Match',
        matchMethod: 'External ID Match',
        matchConfidencePct: 100,
        candidateIntervalsProfile: matched,
        note: 'Linked via stored Intervals.icu athlete ID.',
        updatedAt: nowIso,
      };
    }

    // 2. Exact email match (high confidence)
    const emailMatch = candidateByEmail.get(normalizeText(athlete.email));
    if (emailMatch) {
      const isAuthorized = emailMatch.authorizationState === 'Authorized (Read-Only)';
      return {
        internalAthleteId: athlete.id,
        athleteName: athlete.name,
        email: athlete.email,
        finalSurgeId: athlete.finalSurgeId,
        intervalsIcuAthleteId: emailMatch.intervalsAthleteId,
        authorizationStatus: emailMatch.authorizationState,
        matchStatus: isAuthorized ? 'Verified Match' : 'Candidate Review Required',
        matchMethod: 'Exact Email Match',
        matchConfidencePct: 98,
        candidateIntervalsProfile: emailMatch,
        note: isAuthorized
          ? `Exact email match (${athlete.email}) with verified read-only API access.`
          : `Email matched (${athlete.email}), but API scope is "${emailMatch.authorizationState}". Do not import live data until athlete opts in.`,
        updatedAt: nowIso,
      };
    }

    // 3. Name similarity check -> NEVER auto-merge! Block and flag for manual coach verification
    const nameMatch = candidates.find(
      (c) => normalizeText(c.name) === normalizeText(athlete.name)
    );
    if (nameMatch) {
      return {
        internalAthleteId: athlete.id,
        athleteName: athlete.name,
        email: athlete.email,
        finalSurgeId: athlete.finalSurgeId,
        intervalsIcuAthleteId: null, // Explicitly NOT merged!
        authorizationStatus: nameMatch.authorizationState,
        matchStatus: 'Candidate Review Required',
        matchMethod: 'Name-Only Blocked (Manual Review Required)',
        matchConfidencePct: 62,
        candidateIntervalsProfile: nameMatch,
        note: `Candidate ${nameMatch.intervalsAthleteId} shares name "${nameMatch.name}" without verified email match. Auto-merge blocked; manual coach confirmation required.`,
        updatedAt: nowIso,
      };
    }

    return {
      internalAthleteId: athlete.id,
      athleteName: athlete.name,
      email: athlete.email,
      finalSurgeId: athlete.finalSurgeId,
      intervalsIcuAthleteId: null,
      authorizationStatus: athlete.dataAuthorizationStatus ?? 'Demo Sample',
      matchStatus: 'Unmapped',
      matchMethod: 'Unmatched',
      matchConfidencePct: 0,
      candidateIntervalsProfile: null,
      note: 'Using Final Surge local sample identity; no Intervals.icu profile mapped yet.',
      updatedAt: nowIso,
    };
  });
}
