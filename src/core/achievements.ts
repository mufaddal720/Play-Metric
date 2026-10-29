import type { Achievement, MatchRecord } from './types';
import { computeOutcome } from './ruleEngine';

/** Achievements are derived only from recorded evidence and score events — never chosen at random. */
export function computeAchievements(m: MatchRecord): Achievement[] {
  const out: Achievement[] = [];
  const scored = m.evidence.filter((e) => e.scoreAwarded !== null && (e.status === 'automatic' || e.status === 'host_reviewed'));
  const num = (v: unknown) => (typeof v === 'number' ? v : NaN);

  if (m.gameId === 'freeze') {
    const indiv = scored.filter((e) => e.subjectType === 'player' && e.evidenceType === 'pose_landmarks');
    for (const p of m.players) {
      const mine = indiv.filter((e) => e.subjectId === p.id).map((e) => num(e.measurements.individualScore ?? e.scoreAwarded));
      if (mine.length >= 3) {
        const avg = mine.reduce((a, b) => a + b, 0) / mine.length;
        if (avg >= 85) out.push({ id: 'pose-master', title: 'Pose Master', subjectId: p.id, reason: `Average pose score ${avg.toFixed(1)} over ${mine.length} rounds (needs 85+ over 3+ rounds).` });
      }
      const perfect = indiv.find((e) => e.subjectId === p.id && e.status === 'automatic' && num(e.measurements.stabilityPts) === 15 && num(e.measurements.similarityPts) >= 50);
      if (perfect) out.push({ id: 'perfect-freeze', title: 'Perfect Freeze', subjectId: p.id, reason: `Full 15/15 stability with a strong pose match (${perfect.measurements.similarityPts}/60) in ${perfect.measurements.roundLabel ?? 'a round'}.` });
    }
    if (m.mode === 'team') {
      for (const t of m.teams) {
        const unity = scored.filter((e) => e.subjectId === t.id && num(e.measurements.unityBonus) > 0).length;
        if (unity >= 2) out.push({ id: 'teamwork-champion', title: 'Teamwork Champion', subjectId: t.id, reason: `Earned the team unity bonus in ${unity} rounds.` });
      }
    }
  }

  if (m.gameId === 'football') {
    const goals = m.scoreEvents.slice().sort((a, b) => a.at.localeCompare(b.at));
    const outcome = computeOutcome(m);
    if (outcome.kind === 'winner' && goals.length) {
      const score: Record<string, number> = Object.fromEntries(m.teams.map((t) => [t.id, 0]));
      let golden: string | null = null;
      for (const g of goals) {
        score[g.subjectId] = (score[g.subjectId] ?? 0) + g.points;
        const w = score[outcome.subjectId], others = Math.max(...Object.entries(score).filter(([k]) => k !== outcome.subjectId).map(([, v]) => v), 0);
        if (g.subjectId === outcome.subjectId && w > others && golden === null) golden = g.id;
        if (w <= others) golden = null;
      }
      if (golden) out.push({ id: 'golden-goal', title: 'Golden Goal', subjectId: outcome.subjectId, reason: 'Scored the goal that gave the winners a lead they never lost.' });
    }
    for (const t of m.teams) {
      const auto = m.evidence.filter((e) => e.subjectId === t.id && e.status === 'automatic' && (e.scoreAwarded ?? 0) > 0).length;
      if (auto >= 3) out.push({ id: 'sharp-shooter', title: 'Sharp Shooter', subjectId: t.id, reason: `${auto} goals verified automatically by the AI.` });
    }
  }

  if (m.gameId === 'action') {
    for (const e of scored) {
      if (e.scoreComponent === 'AI action match' && (e.scoreAwarded ?? 0) >= 50) {
        out.push({ id: 'master-actor', title: 'Master Actor', subjectId: e.subjectId, reason: `Action match ${e.scoreAwarded}/60 for “${e.measurements.assignedName ?? 'an action'}”.` });
      }
      if (e.evidenceType.startsWith('guess') && (e.scoreAwarded ?? 0) > 0 && num(e.measurements.elapsedFraction) <= 0.25) {
        out.push({ id: 'quick-guess', title: 'Quick Guess', subjectId: e.subjectId, reason: `Correct guess after only ${e.measurements.elapsedSec} s.` });
      }
    }
    if (m.mode === 'team') {
      for (const t of m.teams) {
        const ids = new Set(m.players.filter((p) => p.teamId === t.id).map((p) => p.id));
        const correct = scored.filter((e) => e.evidenceType.startsWith('guess') && ids.has(e.subjectId) && (e.scoreAwarded ?? 0) > 0).length;
        if (correct >= 3) out.push({ id: 'teamwork-champion', title: 'Teamwork Champion', subjectId: t.id, reason: `${correct} correct team guesses.` });
      }
    }
  }
  // de-duplicate (same achievement for the same subject once)
  const seen = new Set<string>();
  return out.filter((a) => { const k = `${a.id}:${a.subjectId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
