import { describe, expect, it } from 'vitest';
import { ACTIONS, actionById } from './actions';
import { evaluateAction, scoreAction } from './evaluator';
import { extractActionFeatures, type TimedBody } from './features';
import { isCorrectGuess, normalise } from './answerMatch';
import { bodyFromAngles } from '../freeze/kinematics';
import { NEUTRAL_POSE } from '../freeze/poses';
import { seededRandom } from '../freeze/roundMachine';
import type { Body, LmName } from '../../perception/body';

type Rel = Partial<Record<LmName, [number, number]>>;
const S = 0.25, OX = 0.9, OY = 0.55;

/** Synthetic performer: neutral body, with selected joints driven by a function of time (body-relative units). */
function perform(fn: (t: number) => { set?: Rel; hip?: [number, number]; tiltDeg?: number }, seconds = 8, fps = 20, seed = 's'): TimedBody[] {
  const rnd = seededRandom(seed);
  const out: TimedBody[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const m = fn(t);
    const [hx, hy] = m.hip ?? [0, 0];
    const b = bodyFromAngles(NEUTRAL_POSE, S, OX + hx * S, OY + hy * S) as Body;
    if (m.tiltDeg) {
      const a = (m.tiltDeg * Math.PI) / 180;
      for (const k of ['lShoulder', 'rShoulder'] as const) {
        const dx = b[k].x - b.shoulderMid.x, dy = b[k].y - b.shoulderMid.y;
        b[k] = { ...b[k], x: b.shoulderMid.x + dx * Math.cos(a) - dy * Math.sin(a), y: b.shoulderMid.y + dx * Math.sin(a) + dy * Math.cos(a) };
      }
    }
    for (const [k, [x, y]] of Object.entries(m.set ?? {}) as [LmName, [number, number]][]) b[k] = { x: b.hipMid.x + x * S, y: b.hipMid.y + y * S, v: 1 };
    for (const k of Object.keys(b) as LmName[]) b[k] = { ...b[k], x: b[k].x + (rnd() - 0.5) * 0.004, y: b[k].y + (rnd() - 0.5) * 0.004 };
    out.push({ t, body: b });
  }
  return out;
}
const W = (hz: number, t: number, ph = 0) => Math.sin(2 * Math.PI * hz * t + ph);
const C = (hz: number, t: number, ph = 0) => Math.cos(2 * Math.PI * hz * t + ph);

const SCENES: Record<string, (t: number) => { set?: Rel; hip?: [number, number]; tiltDeg?: number }> = {
  waving: (t) => ({ set: { rElbow: [0.7, -1.5], rWrist: [0.75 + 0.28 * W(2, t), -2.0] } }),
  clapping: (t) => { const d = 0.06 + 0.2 * (1 + W(2, t)); return { set: { lWrist: [-d, -1.2], rWrist: [d, -1.2], lElbow: [-0.6, -0.8], rElbow: [0.6, -0.8] } }; },
  swimming: (t) => ({ set: { lWrist: [-0.45 + 0.3 * C(0.8, t), -1 + 1.1 * W(0.8, t)], rWrist: [0.45 + 0.3 * C(0.8, t, Math.PI), -1 + 1.1 * W(0.8, t, Math.PI)] } }),
  'jumping-jacks': (t) => {
    const p = (1 - C(1, t)) / 2;
    const aL = ((100 + 125 * p) * Math.PI) / 180, aR = ((80 - 125 * p) * Math.PI) / 180;
    return {
      hip: [0, -0.1 * Math.abs(W(1, t))],
      set: { lWrist: [-0.4 + 1.15 * Math.cos(aL), -1 + 1.15 * Math.sin(aL)], rWrist: [0.4 + 1.15 * Math.cos(aR), -1 + 1.15 * Math.sin(aR)], lAnkle: [-0.3 - 0.45 * p, 1.75], rAnkle: [0.3 + 0.45 * p, 1.75] },
    };
  },
  'brushing-teeth': (t) => ({ set: { rElbow: [0.5, -0.8], rWrist: [0.05 + 0.1 * W(3, t), -1.3] } }),
  'combing-hair': (t) => ({ set: { rElbow: [0.75, -1.4], rWrist: [0.25 + 0.04 * C(1.1, t), -1.8 + 0.18 * W(1.1, t)] } }),
  aeroplane: (t) => ({ hip: [0.6 * W(0.15, t), 0], tiltDeg: 14 * W(0.4, t), set: { lWrist: [-1.5, -1 - 0.35 * W(0.4, t)], rWrist: [1.5, -1 + 0.35 * W(0.4, t)], lElbow: [-0.95, -1], rElbow: [0.95, -1] } }),
  cycling: (t) => ({ set: { lWrist: [-0.3, -0.85], rWrist: [0.3, -0.85], lAnkle: [-0.3, 1.75 - 0.45 * Math.max(0, W(1, t))], rAnkle: [0.3, 1.75 - 0.45 * Math.max(0, -W(1, t))], lKnee: [-0.27, 0.9 - 0.3 * Math.max(0, W(1, t))], rKnee: [0.27, 0.9 - 0.3 * Math.max(0, -W(1, t))] } }),
  penguin: (t) => ({ hip: [0.09 * W(1.2, t), 0], tiltDeg: 9 * W(1.2, t), set: { lWrist: [-0.55, 0.05], rWrist: [0.55, 0.05], lElbow: [-0.5, -0.45], rElbow: [0.5, -0.45], lAnkle: [-0.25, 1.75 - 0.08 * Math.max(0, W(1.2, t))], rAnkle: [0.25, 1.75 - 0.08 * Math.max(0, -W(1.2, t))] } }),
  drumming: (t) => ({ set: { lWrist: [-0.35, -0.6 + 0.2 * W(2.5, t)], rWrist: [0.35, -0.6 + 0.2 * W(2.5, t, Math.PI)], lElbow: [-0.6, -0.5], rElbow: [0.6, -0.5] } }),
  stirring: (t) => ({ set: { lWrist: [-0.08 + 0.3 * C(0.8, t), -0.5 + 0.2 * W(0.8, t)], rWrist: [0.08 + 0.3 * C(0.8, t), -0.5 + 0.2 * W(0.8, t)], lElbow: [-0.5, -0.5], rElbow: [0.5, -0.5] } }),
  'washing-car': (t) => ({ set: { rElbow: [0.7, -0.9], rWrist: [0.9 + 0.3 * C(1, t), -1.0 + 0.3 * W(1, t)] } }),
};

describe('action library', () => {
  it('has at least 20 actions with complete definitions', () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    for (const a of ACTIONS) {
      expect(a.cues.some((c) => c.required)).toBe(true);
      expect(a.acceptedAnswers.length).toBeGreaterThan(0);
      expect(a.timeLimit).toBeGreaterThan(0);
      expect(a.safety.length).toBeGreaterThan(0);
      // the action's own name is always an accepted answer
      expect(isCorrectGuess(a.name, a).correct, a.name).toBe(true);
    }
  });
  it('covers all three difficulty levels', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) expect(ACTIONS.filter((a) => a.difficulty === d).length).toBeGreaterThanOrEqual(5);
  });
});

describe('temporal features', () => {
  it('measures rhythm (frequency) of a repeated movement', () => {
    const f = extractActionFeatures(perform(SCENES.waving))!;
    expect(f.dom.oscX.freq).toBeGreaterThan(1.6);
    expect(f.dom.oscX.freq).toBeLessThan(2.5);
    expect(f.domSide).toBe('right');
  });
  it('distinguishes alternating from synchronised arms', () => {
    expect(extractActionFeatures(perform(SCENES.swimming))!.corrY).toBeLessThan(-0.5);
    expect(extractActionFeatures(perform(SCENES['jumping-jacks']))!.corrY).toBeGreaterThan(0.5);
  });
});

describe('action recognition on synthetic movement sequences', () => {
  for (const id of Object.keys(SCENES)) {
    it(`recognises ${id} as the top match`, () => {
      const r = evaluateAction(actionById(id)!, perform(SCENES[id], 8, 20, id));
      expect(r.uncertain, `${id}: ${r.explanation}`).toBe(false);
      expect(r.observedId, `${id} ranking: ${r.ranking.slice(0, 3).map((x) => `${x.id}=${x.score}`).join(', ')}`).toBe(id);
      expect(r.matchPoints!).toBeGreaterThan(35);
      expect(r.matchPoints!).toBeLessThanOrEqual(60);
      expect(r.cuePoints!).toBeGreaterThan(12);
    });
  }

  it('brushing teeth and combing hair are told apart by hand height and rhythm', () => {
    const brushing = evaluateAction(actionById('combing-hair')!, perform(SCENES['brushing-teeth']));
    expect(brushing.observedId).toBe('brushing-teeth');
    expect(brushing.matchPoints!).toBeLessThan(30);
    expect(brushing.explanation).toMatch(/looked more like/);
  });

  it('standing still is not recognised as any action (no invented score)', () => {
    const r = evaluateAction(actionById('waving')!, perform(() => ({})));
    expect(r.uncertain).toBe(true);
    expect(r.matchPoints).toBeNull();
    expect(r.cuePoints).toBeNull();
  });

  it('is uncertain when the performer is mostly not tracked', () => {
    const seq = perform(SCENES.waving).map((s, i) => (i % 3 ? { ...s, body: null } : s));
    const r = evaluateAction(actionById('waving')!, seq);
    expect(r.uncertain).toBe(true);
    expect(r.matchPoints).toBeNull();
  });

  it('is uncertain when the performance is too short', () => {
    const r = evaluateAction(actionById('waving')!, perform(SCENES.waving, 2));
    expect(r.uncertain).toBe(true);
  });

  it('scores are deterministic', () => {
    const seq = perform(SCENES.clapping);
    expect(evaluateAction(actionById('clapping')!, seq)).toEqual(evaluateAction(actionById('clapping')!, seq));
    const f = extractActionFeatures(seq)!;
    expect(scoreAction(actionById('clapping')!, f).score).toBe(scoreAction(actionById('clapping')!, f).score);
  });
});

describe('answer matching', () => {
  const a = (id: string) => actionById(id)!;
  it('accepts natural variations and small typos', () => {
    expect(isCorrectGuess('Rowing a boat!', a('rowing')).correct).toBe(true);
    expect(isCorrectGuess('row', a('rowing')).correct).toBe(true);
    expect(isCorrectGuess('kayaking', a('rowing')).correct).toBe(true);
    expect(isCorrectGuess('swiming', a('swimming')).correct).toBe(true);
    expect(isCorrectGuess('she is brushing her teeth', a('brushing-teeth')).correct).toBe(true);
    expect(isCorrectGuess('tooth brush', a('brushing-teeth')).correct).toBe(true);
    expect(isCorrectGuess('PENGUIN', a('penguin')).correct).toBe(true);
    expect(isCorrectGuess('air-guitar', a('guitar')).correct).toBe(true);
  });
  it('rejects wrong or partial answers', () => {
    expect(isCorrectGuess('brushing hair', a('brushing-teeth')).correct).toBe(false);
    expect(isCorrectGuess('teeth', a('brushing-teeth')).correct).toBe(false);
    expect(isCorrectGuess('dancing', a('swimming')).correct).toBe(false);
    expect(isCorrectGuess('', a('swimming')).correct).toBe(false);
    expect(isCorrectGuess('throw', a('rowing')).correct).toBe(false);
  });
  it('normalises text', () => {
    expect(normalise('The Swimming!!')).toEqual(['swim']);
  });
});
