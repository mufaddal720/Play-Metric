import { describe, expect, it } from 'vitest';
import { GoalDetector, DEFAULT_GOAL_RULES, type GoalDef, type BallObs } from './goalDetector';
import { crossingParam, pointInPolygon } from './geometry';
import { findBlobs, learnColour, pickBall } from '../../perception/colorBall';

// Goal on the right edge: posts at x=600 from y=150 to y=250, inside is x>600.
const goalR: GoalDef = { id: 'R', label: 'Right goal', p1: { x: 600, y: 150 }, p2: { x: 600, y: 250 }, inside: { x: 640, y: 200 }, awardTo: 'teamA' };
const goalL: GoalDef = { id: 'L', label: 'Left goal', p1: { x: 40, y: 150 }, p2: { x: 40, y: 250 }, inside: { x: 0, y: 200 }, awardTo: 'teamB' };
const obs = (t: number, x: number, y = 200): BallObs => ({ t, x, y, conf: 0.9, source: 'colour' });

function run(det: GoalDetector, path: ([number, number, number?] | [number, null])[]) {
  const evs = [];
  for (const [t, x, y] of path) evs.push(...det.push(t, x === null ? null : obs(t, x, y ?? 200)));
  return evs;
}

describe('geometry', () => {
  it('computes where a path crosses the goal line', () => {
    expect(crossingParam({ x: 600, y: 150 }, { x: 600, y: 250 }, { x: 590, y: 200 }, { x: 610, y: 200 })).toBeCloseTo(0.5);
  });
  it('point in polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
});

describe('goal verification', () => {
  it('confirms a clean, tracked shot into the goal', () => {
    const d = new GoalDetector([goalR, goalL]);
    const evs = run(d, [[0, 500], [0.033, 530], [0.066, 560], [0.1, 590], [0.133, 615], [0.166, 630]]);
    expect(evs).toHaveLength(1);
    expect(evs[0].decision).toBe('confirmed');
    expect(evs[0].awardTo).toBe('teamA');
  });

  it('does not count a ball that stays near (but outside) the goal', () => {
    const d = new GoalDetector([goalR]);
    const evs = run(d, Array.from({ length: 60 }, (_, i) => [i / 30, 590 + (i % 5)] as [number, number]));
    expect(evs).toHaveLength(0);
  });

  it('does not count a ball passing wide of the posts', () => {
    const d = new GoalDetector([goalR]);
    const evs = run(d, [[0, 500, 320], [0.033, 560, 320], [0.066, 590, 320], [0.1, 615, 320], [0.133, 630, 320]]);
    expect(evs).toHaveLength(0);
  });

  it('ignores a ball leaving the goal (wrong direction)', () => {
    const d = new GoalDetector([goalR]);
    const evs = run(d, [[0, 640], [0.033, 620], [0.066, 590], [0.1, 560]]);
    expect(evs).toHaveLength(0);
  });

  it('marks a goal uncertain when the ball is hidden at the line', () => {
    const d = new GoalDetector([goalR]);
    const evs = run(d, [[0, 520], [0.033, 550], [0.066, 580], [0.1, null], [0.3, null], [0.5, null], [0.6, 630], [0.633, 635]]);
    expect(evs).toHaveLength(1);
    expect(evs[0].decision).toBe('uncertain');
    expect(evs[0].reasons.join(' ')).toMatch(/hidden/);
  });

  it('marks a ball that appears inside without a tracked approach as uncertain', () => {
    const d = new GoalDetector([goalR]);
    const evs = run(d, [[0, 590], [0.033, 615], [0.066, 625]]);
    expect(evs[0].decision).toBe('uncertain');
  });

  it('never counts the same goal twice (ball bouncing around inside the net)', () => {
    const d = new GoalDetector([goalR]);
    const path: [number, number][] = [[0, 500], [0.033, 540], [0.066, 580], [0.1, 610], [0.133, 625]];
    // bounce back over the line and in again, repeatedly
    for (let i = 0; i < 20; i++) path.push([0.2 + i * 0.033, i % 2 ? 610 : 595]);
    const evs = run(d, path);
    expect(evs.filter((e) => e.decision === 'confirmed')).toHaveLength(1);
    expect(evs).toHaveLength(1);
  });

  it('re-arms after the ball returns to play for long enough (auto restart)', () => {
    const d = new GoalDetector([goalR], { ...DEFAULT_GOAL_RULES, restart: 'auto' });
    const evs1 = run(d, [[0, 500], [0.033, 540], [0.066, 580], [0.1, 610], [0.133, 625]]);
    expect(evs1).toHaveLength(1);
    expect(d.isArmed).toBe(false);
    run(d, Array.from({ length: 60 }, (_, i) => [1 + i / 30, 300] as [number, number]));
    expect(d.isArmed).toBe(true);
    const evs2 = run(d, [[4, 500], [4.033, 540], [4.066, 580], [4.1, 610], [4.133, 625]]);
    expect(evs2).toHaveLength(1);
    expect(evs2[0].id).not.toBe(evs1[0].id);
  });

  it('host restart mode waits for the host', () => {
    const d = new GoalDetector([goalR], { ...DEFAULT_GOAL_RULES, restart: 'host' });
    run(d, [[0, 500], [0.033, 540], [0.066, 580], [0.1, 610], [0.133, 625]]);
    run(d, Array.from({ length: 90 }, (_, i) => [1 + i / 30, 300] as [number, number]));
    expect(d.isArmed).toBe(false);
    d.restart();
    expect(d.isArmed).toBe(true);
  });
});

describe('colour ball tracker', () => {
  function frame(w: number, h: number, ball: { x: number; y: number; r: number } | null, rgb = [255, 120, 0]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grass = 90 + ((x * 7 + y * 13) % 20);
      data[i] = 30; data[i + 1] = grass; data[i + 2] = 40; data[i + 3] = 255;
      if (ball && (x - ball.x) ** 2 + (y - ball.y) ** 2 <= ball.r ** 2) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; }
    }
    return data;
  }
  it('learns the ball colour from a tap and finds the ball in later frames', () => {
    const m = learnColour(frame(160, 90, { x: 40, y: 40, r: 5 }), 160, 90, 40, 40)!;
    expect(m.lowSat).toBe(false);
    expect(m.radius).toBeGreaterThan(3);
    const blobs = findBlobs(frame(160, 90, { x: 100, y: 60, r: 5 }), 160, 90, m);
    const b = pickBall(blobs, m, null, 100)!;
    expect(b.x).toBeCloseTo(100, 0);
    expect(b.y).toBeCloseTo(60, 0);
  });
  it('rejects a calibration tap on the background (grass) instead of the ball', () => {
    expect(learnColour(frame(160, 90, { x: 40, y: 40, r: 5 }), 160, 90, 100, 70)).toBeNull();
  });
  it('reports nothing when the ball is absent', () => {
    const m = learnColour(frame(160, 90, { x: 40, y: 40, r: 5 }), 160, 90, 40, 40)!;
    expect(pickBall(findBlobs(frame(160, 90, null), 160, 90, m), m, null, 100)).toBeNull();
  });
  it('supports a white ball (low saturation)', () => {
    const m = learnColour(frame(160, 90, { x: 40, y: 40, r: 6 }, [245, 245, 245]), 160, 90, 40, 40)!;
    expect(m.lowSat).toBe(true);
    const b = pickBall(findBlobs(frame(160, 90, { x: 120, y: 30, r: 6 }, [245, 245, 245]), 160, 90, m), m, null, 200);
    expect(b?.x).toBeCloseTo(120, 0);
  });
});
