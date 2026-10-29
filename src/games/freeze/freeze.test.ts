import { describe, expect, it } from 'vitest';
import { POSES, poseById, NEUTRAL_POSE } from './poses';
import { evaluateFreeze, mirrorPose, teamFreezeScore, TEAM_UNITY_BONUS } from './evaluator';
import { bodyFromAngles, PROPORTIONS } from './kinematics';
import { seededRandom } from './roundMachine';
import type { Body } from '../../perception/body';
import type { SegmentId } from '../../perception/body';

function frames(angles: Record<SegmentId, number>, n = 45, opts: { jitter?: number; drift?: number; scale?: number; prop?: typeof PROPORTIONS; seed?: string } = {}): Body[] {
  const rnd = seededRandom(opts.seed ?? 'x');
  const out: Body[] = [];
  for (let i = 0; i < n; i++) {
    const b = bodyFromAngles(angles, opts.scale ?? 0.25, 0.9 + (opts.drift ?? 0) * Math.sin(i / 3), 0.55, opts.prop);
    for (const k of Object.keys(b) as (keyof Body)[]) {
      b[k] = { ...b[k], x: b[k].x + ((rnd() - 0.5) * (opts.jitter ?? 0.002)), y: b[k].y + ((rnd() - 0.5) * (opts.jitter ?? 0.002)) };
    }
    out.push(b);
  }
  return out;
}

describe('Freeze & Fool pose library', () => {
  it('has at least 12 unique poses with complete reference skeletons', () => {
    expect(POSES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(POSES.map((p) => p.id)).size).toBe(POSES.length);
    for (const p of POSES) {
      expect(Object.keys(p.angles)).toHaveLength(9);
      expect(p.required).toContain('torso');
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('every reference skeleton passes its own required-position checks (definitions are self-consistent)', () => {
    for (const p of POSES) {
      const r = evaluateFreeze(p, frames(p.angles), { difficulty: 'medium', expectedFrames: 45 });
      expect(r.uncertain, `${p.id}: ${r.uncertaintyReasons.join(',')}`).toBe(false);
      expect(r.checks.filter((c) => !c.passed).map((c) => c.label), p.id).toEqual([]);
      expect(r.total!, p.id).toBeGreaterThanOrEqual(99);
    }
  });
});

describe('Freeze scoring boundaries', () => {
  const star = poseById('star-shape')!;

  it('a perfect, still copy scores 100 and stays within 0..100', () => {
    const r = evaluateFreeze(star, frames(star.angles), { difficulty: 'medium', expectedFrames: 45 });
    expect(r.similarity).toBe(60);
    expect(r.positions).toBe(25);
    expect(r.stability).toBe(15);
    expect(r.total).toBe(100);
  });

  it('a completely different pose scores low similarity and misses required positions', () => {
    const r = evaluateFreeze(star, frames(NEUTRAL_POSE), { difficulty: 'medium', expectedFrames: 45 });
    expect(r.uncertain).toBe(false);
    expect(r.similarity!).toBeLessThan(30);
    expect(r.positions).toBe(0);
    expect(r.total!).toBeGreaterThanOrEqual(0);
  });

  it('is not affected by body proportions or size', () => {
    const tall = evaluateFreeze(star, frames(star.angles, 45, { scale: 0.3, prop: { ...PROPORTIONS, thigh: 1.1, shin: 1.05, upperArm: 0.7 } }), { difficulty: 'medium', expectedFrames: 45 });
    const small = evaluateFreeze(star, frames(star.angles, 45, { scale: 0.15, prop: { ...PROPORTIONS, thigh: 0.75, shin: 0.7, forearm: 0.45 } }), { difficulty: 'medium', expectedFrames: 45 });
    expect(tall.total).toBe(100);
    expect(small.total).toBe(100);
  });

  it('does not penalise breathing-level movement but does penalise real movement', () => {
    const breathing = evaluateFreeze(star, frames(star.angles, 45, { jitter: 0.004, drift: 0.002 }), { difficulty: 'medium', expectedFrames: 45 });
    expect(breathing.stability).toBe(15);
    const wobbly = evaluateFreeze(star, frames(star.angles, 45, { drift: 0.05 }), { difficulty: 'medium', expectedFrames: 45 });
    expect(wobbly.stability!).toBeLessThan(15);
    const moving = evaluateFreeze(star, frames(star.angles, 45, { drift: 0.2 }), { difficulty: 'medium', expectedFrames: 45 });
    expect(moving.stability).toBe(0);
  });

  it('partial credit grows monotonically as angular error grows', () => {
    const totals = [0, 20, 35, 50, 80].map((d) => {
      const a = { ...star.angles, lUpperArm: star.angles.lUpperArm + d, lForearm: star.angles.lForearm + d };
      return evaluateFreeze(star, frames(a), { difficulty: 'medium', expectedFrames: 45 }).similarity!;
    });
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    expect(totals[0]).toBe(60);
    expect(totals[4]).toBeLessThan(totals[0]);
  });
});

describe('Freeze uncertainty handling', () => {
  const star = poseById('star-shape')!;
  it('marks the result uncertain (no score) when too few frames were tracked', () => {
    const r = evaluateFreeze(star, frames(star.angles, 3), { difficulty: 'medium', expectedFrames: 45 });
    expect(r.uncertain).toBe(true);
    expect(r.total).toBeNull();
  });
  it('marks the result uncertain when a required landmark is hidden', () => {
    const f = frames(star.angles).map((b) => ({ ...b, lWrist: { ...b.lWrist, v: 0.1 } }));
    const r = evaluateFreeze(star, f, { difficulty: 'medium', expectedFrames: 45 });
    expect(r.uncertain).toBe(true);
    expect(r.total).toBeNull();
    expect(r.explanation).toMatch(/No score/);
  });
  it('flags a possible identity switch as uncertain', () => {
    const r = evaluateFreeze(star, frames(star.angles), { difficulty: 'medium', expectedFrames: 45, identitySwitch: true });
    expect(r.uncertain).toBe(true);
  });
});

describe('Left-right mirroring', () => {
  it('accepts the opposite side only when the pose allows it', () => {
    const det = poseById('curious-detective')!;
    const swapped = mirrorPose(det);
    const r = evaluateFreeze(det, frames(swapped.angles), { difficulty: 'medium', expectedFrames: 45 });
    expect(r.orientation).toBe('mirrored');
    expect(r.total!).toBeGreaterThanOrEqual(99);

    const champ = poseById('mirror-champion')!;
    const wrongSide = evaluateFreeze(champ, frames(mirrorPose(champ).angles), { difficulty: 'medium', expectedFrames: 45 });
    expect(wrongSide.total!).toBeLessThan(60);
  });
  it('mirrorPose is an involution', () => {
    const p = poseById('invisible-wall')!;
    const twice = mirrorPose(mirrorPose(p));
    for (const k of Object.keys(p.angles) as SegmentId[]) expect(Math.round(twice.angles[k])).toBe(Math.round(p.angles[k]));
  });
});

describe('Team scoring', () => {
  it('averages valid scores, adds the unity bonus, and caps at 100', () => {
    expect(teamFreezeScore([80, 70]).score).toBe(75 + TEAM_UNITY_BONUS);
    expect(teamFreezeScore([100, 98]).score).toBe(100);
    expect(teamFreezeScore([80, 40]).score).toBe(60);
  });
  it('does not reward bigger teams', () => {
    expect(teamFreezeScore([70, 70, 70, 70]).score).toBe(teamFreezeScore([70, 70]).score);
  });
  it('is uncertain when fewer than half of the members have valid scores', () => {
    expect(teamFreezeScore([null, null, 90]).uncertain).toBe(true);
    expect(teamFreezeScore([null, 90]).uncertain).toBe(false);
    expect(teamFreezeScore([null, 90]).bonus).toBe(0);
  });
});
