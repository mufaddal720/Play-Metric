import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHostReview, applyScoreEvent, computeOutcome, computeStandings, computeTotals, validateScoreEvent } from './ruleEngine';
import { computeAchievements } from './achievements';
import type { Evidence, MatchRecord, ScoreEvent } from './types';
import { formatUaeDateTime, formatUaeTime, formatClock } from '../lib/time';
import { nextPhase, phaseDuration, DEFAULT_TIMING, validateTiming, chaosSchedule, targetAt } from '../games/freeze/roundMachine';
import { validateSetup } from '../screens/Setup';

const base = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  id: 'm1', gameId: 'freeze', createdAt: '2026-10-29T08:00:00Z', status: 'active', mode: 'individual', judging: 'live', config: {},
  players: [{ id: 'a', name: 'Aisha' }, { id: 'o', name: 'Omar' }], teams: [], rounds: [], evidence: [], scoreEvents: [], achievements: [], ...over,
});
const ev = (id: string, subjectId: string, points: number, roundId = 'r1'): ScoreEvent => ({ id, roundId, subjectId, points, component: 'x', evidenceIds: [], at: '2026-10-29T08:00:00Z' });

describe('rules engine', () => {
  it('applies a valid score and updates totals', () => {
    const r = applyScoreEvent(base(), ev('e1', 'a', 80), 100);
    expect(r.applied).toBe(true);
    expect(computeTotals(r.match)).toEqual({ a: 80, o: 0 });
  });
  it('never applies the same event twice (duplicate prevention)', () => {
    let m = applyScoreEvent(base(), ev('e1', 'a', 80), 100).match;
    const again = applyScoreEvent(m, ev('e1', 'a', 80), 100);
    expect(again.applied).toBe(false);
    expect(again.reason).toMatch(/Duplicate/);
    m = again.match;
    expect(computeTotals(m).a).toBe(80);
  });
  it('rejects invalid events', () => {
    expect(validateScoreEvent(base(), ev('e', 'zz', 1), 100)).toMatch(/Unknown/);
    expect(validateScoreEvent(base(), ev('e', 'a', -1), 100)).toMatch(/negative/);
    expect(validateScoreEvent(base(), ev('e', 'a', 101), 100)).toMatch(/exceed/);
    expect(validateScoreEvent(base(), ev('e', 'a', NaN), 100)).toMatch(/number/);
    expect(validateScoreEvent(base({ status: 'completed' }), ev('e', 'a', 1), 100)).toMatch(/not active/);
  });
  it('ranks with ties sharing a rank and reports draws', () => {
    let m = base({ players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] });
    m = applyScoreEvent(m, ev('1', 'a', 50), 100).match;
    m = applyScoreEvent(m, ev('2', 'b', 50), 100).match;
    m = applyScoreEvent(m, ev('3', 'c', 20), 100).match;
    expect(computeStandings(m).map((s) => s.rank)).toEqual([1, 1, 3]);
    expect(computeOutcome(m)).toEqual({ kind: 'draw', subjectIds: ['a', 'b'] });
    m = applyScoreEvent(m, ev('4', 'c', 40), 100).match;
    expect(computeOutcome(m)).toEqual({ kind: 'winner', subjectId: 'c' });
  });
  it('credits player events to their team in team mode', () => {
    let m = base({ mode: 'team', teams: [{ id: 't1', name: 'Falcons', color: '' }, { id: 't2', name: 'Oryx', color: '' }], players: [{ id: 'a', name: 'A', teamId: 't1' }, { id: 'o', name: 'O', teamId: 't2' }] });
    m = applyScoreEvent(m, ev('1', 'a', 15), 15).match;
    m = applyScoreEvent(m, ev('2', 't2', 1), 1).match;
    expect(computeTotals(m)).toEqual({ t1: 15, t2: 1 });
  });
});

describe('host review', () => {
  const evidence = (over: Partial<Evidence> = {}): Evidence => ({
    id: 'ev1', matchId: 'm1', gameId: 'football', roundId: 'r', subjectId: 't1', subjectType: 'team', timestamp: '2026-10-29T08:00:00Z',
    evidenceType: 'ball_track', observation: '', measurements: {}, confidence: 0.4, uncertain: true, rule: '', scoreComponent: 'Goal',
    scoreAwarded: null, maxScore: 1, explanation: '', status: 'pending_review', ...over,
  });
  const fm = () => base({ gameId: 'football', mode: 'team', teams: [{ id: 't1', name: 'F', color: '' }, { id: 't2', name: 'O', color: '' }], players: [], evidence: [evidence()] });

  it('records the original AI result and labels the decision', () => {
    const r = applyHostReview(fm(), 'ev1', 'set_score', 1, 'Clear on replay', 'rv1');
    expect(r.applied).toBe(true);
    const e = r.match.evidence[0];
    expect(e.status).toBe('host_reviewed');
    expect(e.hostReview).toMatchObject({ originalScore: null, originalStatus: 'pending_review', newScore: 1, note: 'Clear on replay' });
    expect(computeTotals(r.match).t1).toBe(1);
  });
  it('requires a note and cannot be applied twice', () => {
    expect(applyHostReview(fm(), 'ev1', 'set_score', 1, '  ', 'rv1').applied).toBe(false);
    const once = applyHostReview(fm(), 'ev1', 'reject', null, 'No goal', 'rv1').match;
    expect(once.evidence[0].status).toBe('not_scored');
    expect(applyHostReview(once, 'ev1', 'set_score', 1, 'changed mind', 'rv2').applied).toBe(false);
  });
  it('withdraws an automatic award when the host rejects it', () => {
    let m = base({ evidence: [evidence({ id: 'e2', subjectId: 'a', subjectType: 'player', uncertain: false, scoreAwarded: 70, maxScore: 100, status: 'automatic' })] });
    m = applyScoreEvent(m, { ...ev('s1', 'a', 70), evidenceIds: ['e2'] }, 100).match;
    expect(computeTotals(m).a).toBe(70);
    m = applyHostReview(m, 'e2', 'reject', null, 'Wrong player tracked', 'rv').match;
    expect(computeTotals(m).a).toBe(0);
    expect(m.evidence[0].hostReview?.originalScore).toBe(70);
  });
  it('rejects a reviewed score outside the component range', () => {
    expect(applyHostReview(fm(), 'ev1', 'set_score', 2, 'x', 'rv').applied).toBe(false);
  });
});

describe('Freeze & Fool timer transitions', () => {
  it('follows READY → PREPARE → COPY → FREEZE → ANALYSE → VERDICT', () => {
    const seq = ['READY'];
    let p = 'READY' as Parameters<typeof nextPhase>[0];
    for (let i = 0; i < 5; i++) { p = nextPhase(p, 0, 3); seq.push(p); }
    expect(seq).toEqual(['READY', 'PREPARE', 'COPY', 'FREEZE', 'ANALYSE', 'VERDICT']);
  });
  it('goes to the next round, or completes after the last round', () => {
    expect(nextPhase('VERDICT', 0, 3)).toBe('READY');
    expect(nextPhase('VERDICT', 2, 3)).toBe('COMPLETE');
    expect(nextPhase('COMPLETE', 2, 3)).toBe('COMPLETE');
  });
  it('uses the default timings 5 / 8 / 3 and validates custom ones', () => {
    expect([phaseDuration('PREPARE', DEFAULT_TIMING), phaseDuration('COPY', DEFAULT_TIMING), phaseDuration('FREEZE', DEFAULT_TIMING)]).toEqual([5, 8, 3]);
    expect(phaseDuration('ANALYSE', DEFAULT_TIMING)).toBeNull();
    expect(validateTiming({ prepare: 1, copy: 8, freeze: 3 })).not.toBeNull();
    expect(validateTiming(DEFAULT_TIMING)).toBeNull();
  });
  it('chaos mode: the target showing when FREEZE starts is the judged one, and schedules are reproducible', () => {
    const s = chaosSchedule('round-x', ['a', 'b', 'c'], 6);
    expect(chaosSchedule('round-x', ['a', 'b', 'c'], 6)).toEqual(s);
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(targetAt(s, 6)).toBe(s[s.length - 1].poseId);
    expect(targetAt(s, 0)).toBe(s[0].poseId);
  });
});

describe('match configuration validation', () => {
  const p = (n: number, team?: string) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, teamId: team }));
  it('enforces per-game requirements', () => {
    expect(validateSetup('freeze', 'individual', [], [], { rounds: 3, timing: DEFAULT_TIMING })).toContain('Add at least one player.');
    expect(validateSetup('freeze', 'individual', p(5), [], { rounds: 3, timing: DEFAULT_TIMING }).join()).toMatch(/At most 4/);
    expect(validateSetup('freeze', 'individual', p(3), [], { freezeVariant: 'mirror', rounds: 3, timing: DEFAULT_TIMING }).join()).toMatch(/exactly 2/);
    expect(validateSetup('action', 'individual', p(1), [], { rounds: 1 }).join()).toMatch(/at least 2/);
    expect(validateSetup('football', 'team', [], [{ id: 't', name: 'T', color: '' }], { durationMin: 5 }).join()).toMatch(/two teams/);
    expect(validateSetup('freeze', 'individual', p(2), [], { rounds: 3, timing: DEFAULT_TIMING })).toEqual([]);
  });
  it('team mode requires every player on a team and two teams in use', () => {
    const teams = [{ id: 't1', name: 'A', color: '' }, { id: 't2', name: 'B', color: '' }];
    expect(validateSetup('freeze', 'team', p(2), teams, { rounds: 3, timing: DEFAULT_TIMING }).join()).toMatch(/Assign every player/);
    expect(validateSetup('freeze', 'team', p(2, 't1'), teams, { rounds: 3, timing: DEFAULT_TIMING }).join()).toMatch(/at least two teams/);
  });
});

describe('achievements come from recorded events', () => {
  it('awards Quick Guess and Master Actor only when the recorded numbers qualify', () => {
    const e = (over: Partial<Evidence>): Evidence => ({
      id: Math.random().toString(), matchId: 'm1', gameId: 'action', roundId: 'r', subjectId: 'a', subjectType: 'player', timestamp: '', evidenceType: 'guess_text',
      observation: '', measurements: {}, confidence: 1, uncertain: false, rule: '', scoreComponent: 'Correct guess', scoreAwarded: 15, maxScore: 15, explanation: '', status: 'automatic', ...over,
    });
    const m = base({ gameId: 'action', evidence: [
      e({ measurements: { elapsedFraction: 0.2, elapsedSec: 9 } }),
      e({ subjectId: 'o', measurements: { elapsedFraction: 0.5, elapsedSec: 22 } }),
      e({ subjectId: 'o', evidenceType: 'action_sequence', scoreComponent: 'AI action match', scoreAwarded: 52, maxScore: 60, measurements: { assignedName: 'Rowing' } }),
    ] });
    const ach = computeAchievements(m);
    expect(ach.map((a) => `${a.id}:${a.subjectId}`).sort()).toEqual(['master-actor:o', 'quick-guess:a']);
  });
});

describe('UAE time', () => {
  it('formats in Asia/Dubai (UTC+4) regardless of the device time zone', () => {
    expect(formatUaeDateTime('2026-10-29T20:30:00Z')).toMatch(/30 Oct 2026.*00:30 GST/);
    expect(formatUaeTime('2026-10-29T08:00:05Z')).toBe('12:00:05');
    expect(formatClock(125)).toBe('02:05');
  });
});

describe('score persistence', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) });
  });
  it('stores matches and score events so they survive a reload', async () => {
    vi.resetModules();
    const { useStore } = await import('./store');
    const { commitRound } = await import('./matchOps');
    useStore.getState().addPlayer('Aisha');
    const pid = useStore.getState().players[0].id;
    const id = useStore.getState().createMatch({ gameId: 'freeze', mode: 'individual', judging: 'live', config: {}, players: useStore.getState().players, teams: [] });
    const r1 = commitRound(id, { id: 'r1', index: 0, label: 'R1', startedAt: '', results: [], evidenceIds: [] }, [], [{ event: { ...ev('r1:a', pid, 77) }, max: 100 }]);
    const r2 = commitRound(id, { id: 'r1', index: 0, label: 'R1', startedAt: '', results: [], evidenceIds: [] }, [], [{ event: { ...ev('r1:a', pid, 77) }, max: 100 }]);
    expect([r1.applied, r2.applied]).toEqual([1, 0]);
    const raw = JSON.parse(localStorage.getItem('uae-ai-gameday-v1')!);
    expect(raw.state.matches[0].scoreEvents).toHaveLength(1);
    vi.resetModules();
    const again = (await import('./store')).useStore;
    await again.persist.rehydrate();
    const m = again.getState().matches.find((x) => x.id === id)!;
    expect(computeTotals(m)[pid]).toBe(77);
  });
});
