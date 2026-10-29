import { clamp, round1 } from '../../lib/math';
import { ACTIONS, type ActionSpec } from './actions';
import { type ActionFeatures, type TimedBody, extractActionFeatures } from './features';

/**
 * Action Detective judging (§19–20). Deterministic, documented scoring:
 *
 *   Cue degree dᵢ ∈ [0,1] is measured for every cue of every action in the library.
 *   Action score  S = (Σ wᵢ·dᵢ / Σ wᵢ) × (0.5 + 0.5 × min required dᵢ)    w = 1 required, 0.5 optional
 *   The observed action is the library action with the highest S (if S ≥ RECOGNISED_MIN).
 *
 *   Performer — AI action match (60) = 60 × S_assigned × D
 *       D = 1 if the assigned action ranks first, otherwise max(0.5, 1 − 2 × (S_top − S_assigned)).
 *   Performer — cue completion (25) = 25 × (assigned cues with dᵢ ≥ 0.6) / (number of assigned cues)
 *   Guessers  — correct answer (15) = 15 to the first player whose guess matches within the time limit.
 *
 * If the performer was not tracked well enough, or no movement pattern from the library is
 * recognised at all, the AI does not score the performance: the round is marked uncertain and
 * the host can review it or the performer can retry.
 */
export const CUE_PASS = 0.6;
export const RECOGNISED_MIN = 0.4;
export const MIN_DURATION = 3;
export const MIN_TRACKED = 0.6;

export interface CueResult { id: string; label: string; required: boolean; degree: number; passed: boolean }
export interface ActionEvaluation {
  uncertain: boolean;
  reasons: string[];
  assignedId: string;
  assignedScore: number | null;
  observedId: string | null;
  ranking: { id: string; name: string; score: number }[];
  cues: CueResult[];
  matchPoints: number | null;   // /60
  cuePoints: number | null;     // /25
  confidence: number;
  explanation: string;
  measurements: Record<string, number | string | boolean>;
  features: ActionFeatures | null;
}

export function scoreAction(a: ActionSpec, f: ActionFeatures): { score: number; cues: CueResult[] } {
  const cues = a.cues.map((c) => {
    const d = clamp(c.eval(f));
    const degree = Number.isFinite(d) ? Math.round(d * 100) / 100 : 0;
    return { id: c.id, label: c.label, required: c.required, degree, passed: degree >= CUE_PASS };
  });
  let num = 0, den = 0, minReq = 1;
  for (const c of cues) {
    const w = c.required ? 1 : 0.5;
    num += w * c.degree; den += w;
    if (c.required) minReq = Math.min(minReq, c.degree);
  }
  return { score: den ? Math.round((num / den) * (0.5 + 0.5 * minReq) * 1000) / 1000 : 0, cues };
}

export function evaluateAction(assigned: ActionSpec, seq: TimedBody[], library: ActionSpec[] = ACTIONS): ActionEvaluation {
  const f = extractActionFeatures(seq);
  const duration = seq.length ? seq[seq.length - 1].t - seq[0].t : 0;
  const reasons: string[] = [];
  const base = { assignedId: assigned.id, features: f };
  if (!f) {
    reasons.push('the performer was not detected clearly enough by the camera');
  } else {
    if (f.duration < MIN_DURATION) reasons.push(`only ${f.duration.toFixed(1)} s of movement was recorded (need ${MIN_DURATION} s)`);
    if (f.trackedRatio < MIN_TRACKED) reasons.push(`the performer was tracked in only ${Math.round(f.trackedRatio * 100)}% of frames`);
  }
  if (!f || reasons.length) {
    return {
      ...base, uncertain: true, reasons, assignedScore: null, observedId: null, ranking: [], cues: [], matchPoints: null, cuePoints: null,
      confidence: 0, explanation: `No AI score: ${reasons.join('; ')}. The host can review, or the performer can try again.`,
      measurements: { durationSec: round1(duration), framesAnalysed: seq.length },
    };
  }

  const all = library.map((a) => ({ a, ...scoreAction(a, f) }));
  const ranking = all.map((r) => ({ id: r.a.id, name: r.a.name, score: r.score })).sort((x, y) => y.score - x.score);
  const mine = all.find((r) => r.a.id === assigned.id) ?? { a: assigned, ...scoreAction(assigned, f) };
  const top = ranking[0];
  const recognised = top.score >= RECOGNISED_MIN;
  const measurements: Record<string, number | string | boolean> = {
    durationSec: round1(f.duration), trackedPercent: Math.round(f.trackedRatio * 100), assignedScore: mine.score,
    topAction: top.id, topScore: top.score, secondAction: ranking[1]?.id ?? '', secondScore: ranking[1]?.score ?? 0,
    activeHand: f.domSide, handRhythmHz: round1(Math.max(f.dom.oscX.freq, f.dom.oscY.freq)),
  };
  if (!recognised) {
    return {
      ...base, uncertain: true, reasons: ['no movement pattern from the action library was recognised with confidence'],
      assignedScore: mine.score, observedId: null, ranking, cues: mine.cues, matchPoints: null, cuePoints: null, confidence: top.score,
      explanation: `No AI score: the movement did not clearly match any action the AI knows (best guess ${top.name} at ${Math.round(top.score * 100)}%, below the ${RECOGNISED_MIN * 100}% threshold). The host can review, or the performer can try again.`,
      measurements,
    };
  }
  const isTop = top.id === assigned.id;
  const D = isTop ? 1 : Math.max(0.5, 1 - 2 * (top.score - mine.score));
  const matchPoints = round1(60 * mine.score * D);
  const cuePoints = round1((25 * mine.cues.filter((c) => c.passed).length) / mine.cues.length);
  const margin = ranking[1] ? top.score - ranking[1].score : top.score;
  const confidence = Math.round(clamp(top.score * (0.6 + margin) * f.trackedRatio) * 100) / 100;

  const passed = mine.cues.filter((c) => c.passed).map((c) => c.label.toLowerCase());
  const missed = mine.cues.filter((c) => !c.passed).map((c) => `${c.label.toLowerCase()} (${Math.round(c.degree * 100)}%)`);
  const parts = [
    isTop
      ? `The movement matched “${assigned.name}” best of all ${library.length} actions (${Math.round(mine.score * 100)}% match${ranking[1] ? `; next closest: ${ranking[1].name} at ${Math.round(ranking[1].score * 100)}%` : ''}).`
      : `The movement looked more like “${top.name}” (${Math.round(top.score * 100)}%) than the assigned “${assigned.name}” (${Math.round(mine.score * 100)}%), so the match score was reduced.`,
    passed.length ? `Cues seen: ${passed.join('; ')}.` : 'None of the key movement cues were clearly seen.',
    missed.length ? `Not clearly seen: ${missed.join('; ')}.` : 'Every movement cue for this action was seen.',
  ];
  if (margin < 0.08) parts.push('Two actions scored very close together, so treat this verdict with caution.');
  return {
    ...base, uncertain: false, reasons: [], assignedScore: mine.score, observedId: top.id, ranking, cues: mine.cues,
    matchPoints, cuePoints, confidence, explanation: parts.join(' '), measurements,
  };
}

export const GUESS_POINTS = 15;
export const QUICK_GUESS_FRACTION = 0.25;
