import { useStore } from './store';
import { addEvidence, applyHostReview, applyScoreEvent, upsertRound } from './ruleEngine';
import { computeAchievements } from './achievements';
import type { Evidence, HostReview, MatchRecord, RoundRecord, ScoreEvent } from './types';

export interface Award { event: ScoreEvent; max: number }

/**
 * Records one evaluated round atomically: evidence + round record + score awards.
 * Every award goes through the rules engine, which rejects duplicates by id.
 */
export function commitRound(matchId: string, round: RoundRecord, evidence: Evidence[], awards: Award[]): { applied: number; rejected: string[] } {
  let applied = 0;
  const rejected: string[] = [];
  useStore.getState().updateMatch(matchId, (m) => {
    let next: MatchRecord = addEvidence(upsertRound(m, round), evidence);
    for (const a of awards) {
      const r = applyScoreEvent(next, a.event, a.max);
      if (r.applied) { next = r.match; applied++; } else rejected.push(r.reason ?? 'rejected');
    }
    return next;
  });
  return { applied, rejected };
}

export function reviewEvidence(matchId: string, evidenceId: string, decision: HostReview['decision'], score: number | null, note: string): string | null {
  let err: string | null = null;
  useStore.getState().updateMatch(matchId, (m) => {
    const r = applyHostReview(m, evidenceId, decision, score, note, `review:${evidenceId}`);
    if (!r.applied) err = r.reason ?? 'Review failed';
    return r.match;
  });
  return err;
}

/** Retake: every award from this round is withdrawn (recorded as a host "retake" review) and the round is marked retaken. */
export function retakeRound(matchId: string, roundId: string, note = 'Round retaken'): void {
  useStore.getState().updateMatch(matchId, (m) => {
    let next = m;
    for (const e of m.evidence.filter((x) => x.roundId === roundId && !x.hostReview)) {
      const r = applyHostReview(next, e.id, 'retake', null, note, `retake:${e.id}`);
      if (r.applied) next = r.match;
    }
    return { ...next, rounds: next.rounds.map((r) => (r.id === roundId ? { ...r, info: { ...r.info, retaken: true } } : r)) };
  });
}

export function completeMatch(matchId: string): void {
  useStore.getState().updateMatch(matchId, (m) => (m.status !== 'active' ? m : {
    ...m, status: 'completed', finishedAt: new Date().toISOString(), achievements: computeAchievements(m),
  }));
  useStore.getState().setInFlight(null);
}
