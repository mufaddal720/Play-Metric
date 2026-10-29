import type { Evidence, HostReview, MatchRecord, RoundRecord, ScoreEvent } from './types';

/**
 * Shared rules infrastructure (§23). Game evaluators extract observations and compute their
 * game-specific points; this module validates and applies awards, prevents duplicates,
 * and derives totals and rankings deterministically from the stored score events.
 */

export type ApplyResult = { match: MatchRecord; applied: boolean; reason?: string };

export function subjectIds(match: MatchRecord): string[] {
  return match.mode === 'team' ? match.teams.map((t) => t.id) : match.players.map((p) => p.id);
}

export function validateScoreEvent(match: MatchRecord, ev: ScoreEvent, maxPoints: number): string | null {
  if (match.status !== 'active') return 'Match is not active';
  const known = new Set([...match.players.map((p) => p.id), ...match.teams.map((t) => t.id)]);
  if (!known.has(ev.subjectId)) return `Unknown player or team ${ev.subjectId}`;
  if (!Number.isFinite(ev.points)) return 'Points must be a number';
  if (ev.points < 0) return 'Points cannot be negative';
  if (ev.points > maxPoints) return `Points exceed the maximum (${maxPoints}) for ${ev.component}`;
  if (match.scoreEvents.some((s) => s.id === ev.id)) return 'Duplicate event ignored';
  return null;
}

/** Idempotent: applying the same event id twice never changes the score twice. */
export function applyScoreEvent(match: MatchRecord, ev: ScoreEvent, maxPoints: number): ApplyResult {
  const err = validateScoreEvent(match, ev, maxPoints);
  if (err) return { match, applied: false, reason: err };
  return { match: { ...match, scoreEvents: [...match.scoreEvents, ev] }, applied: true };
}

export function removeScoreEventsForEvidence(match: MatchRecord, evidenceId: string): MatchRecord {
  return { ...match, scoreEvents: match.scoreEvents.filter((s) => !s.evidenceIds.includes(evidenceId)) };
}

export function addEvidence(match: MatchRecord, items: Evidence[]): MatchRecord {
  const existing = new Set(match.evidence.map((e) => e.id));
  return { ...match, evidence: [...match.evidence, ...items.filter((e) => !existing.has(e.id))] };
}

export function upsertRound(match: MatchRecord, round: RoundRecord): MatchRecord {
  const rounds = match.rounds.some((r) => r.id === round.id)
    ? match.rounds.map((r) => (r.id === round.id ? round : r))
    : [...match.rounds, round];
  return { ...match, rounds };
}

/** Totals are always recomputed from score events — never stored separately — so they cannot drift. */
export function computeTotals(match: MatchRecord): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const id of subjectIds(match)) totals[id] = 0;
  const teamOf = new Map(match.players.map((p) => [p.id, p.teamId]));
  for (const ev of match.scoreEvents) {
    let id = ev.subjectId;
    if (match.mode === 'team' && !(id in totals)) id = teamOf.get(id) ?? id;
    if (id in totals) totals[id] = Math.round((totals[id] + ev.points) * 10) / 10;
  }
  return totals;
}

export interface Standing { subjectId: string; points: number; rank: number }

/** Standard competition ranking: equal points share a rank (1, 1, 3). */
export function computeStandings(match: MatchRecord): Standing[] {
  const totals = computeTotals(match);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return sorted.map(([subjectId, points]) => ({
    subjectId,
    points,
    rank: 1 + sorted.filter(([, p]) => p > points).length,
  }));
}

export type Outcome = { kind: 'winner'; subjectId: string } | { kind: 'draw'; subjectIds: string[] } | { kind: 'none' };

export function computeOutcome(match: MatchRecord): Outcome {
  const st = computeStandings(match);
  if (!st.length) return { kind: 'none' };
  const top = st.filter((s) => s.rank === 1);
  return top.length === 1 ? { kind: 'winner', subjectId: top[0].subjectId } : { kind: 'draw', subjectIds: top.map((s) => s.subjectId) };
}

/**
 * Host review never silently overwrites: the original AI score and status are kept in `hostReview`,
 * and any previous award for this evidence is removed before the reviewed award is applied.
 */
export function applyHostReview(
  match: MatchRecord,
  evidenceId: string,
  decision: HostReview['decision'],
  newScore: number | null,
  note: string,
  scoreEventId: string,
): ApplyResult {
  const ev = match.evidence.find((e) => e.id === evidenceId);
  if (!ev) return { match, applied: false, reason: 'Evidence not found' };
  if (ev.hostReview) return { match, applied: false, reason: 'This decision has already been reviewed' };
  if (!note.trim()) return { match, applied: false, reason: 'A short review note is required' };
  if (newScore !== null && (newScore < 0 || newScore > ev.maxScore)) {
    return { match, applied: false, reason: `Score must be between 0 and ${ev.maxScore}` };
  }
  const review: HostReview = {
    originalScore: ev.scoreAwarded, originalStatus: ev.status, decision, newScore, note: note.trim(),
    at: new Date().toISOString(),
  };
  const finalScore = decision === 'confirm' ? (newScore ?? ev.scoreAwarded) : decision === 'set_score' ? newScore : null;
  let m = removeScoreEventsForEvidence(match, evidenceId);
  m = {
    ...m,
    evidence: m.evidence.map((e) => e.id === evidenceId
      ? { ...e, hostReview: review, status: decision === 'retake' || finalScore === null ? 'not_scored' : 'host_reviewed', scoreAwarded: finalScore }
      : e),
  };
  if (finalScore !== null && finalScore > 0) {
    const res = applyScoreEvent(m, {
      id: scoreEventId, roundId: ev.roundId, subjectId: ev.subjectId, points: finalScore,
      component: `${ev.scoreComponent} (host reviewed)`, evidenceIds: [evidenceId], at: review.at,
    }, ev.maxScore);
    if (!res.applied) return res;
    m = res.match;
  }
  return { match: m, applied: true };
}

export function nameOf(match: MatchRecord, subjectId: string): string {
  return match.players.find((p) => p.id === subjectId)?.name
    ?? match.teams.find((t) => t.id === subjectId)?.name
    ?? 'Unknown';
}
