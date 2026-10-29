import type { Difficulty } from '../../core/types';
import { angleDiff, circularMean, clamp, mean, median, ramp, round1 } from '../../lib/math';
import {
  type Body, type LmName, type SegmentId, SEGMENT_LABEL, VISIBILITY_MIN, dist, jointAngle, reflectAngle,
  segmentAngle, swapSide, torsoLength,
} from '../../perception/body';
import type { PoseSpec, PositionCheck } from './poses';

/**
 * Freeze & Fool evaluator — deterministic and documented (§10).
 *
 *   Pose similarity  (60) = 60 × Σ wᵢ·sᵢ / Σ wᵢ
 *       sᵢ = 1 when the segment direction error ≤ tolerance, falling linearly to 0 at tolerance + 35°.
 *       wᵢ = 1.0 for required limbs, 0.3 for the torso, 0.4 for optional limbs (only visible segments count).
 *       The segment direction is the circular mean over the freeze interval.
 *   Required positions (25) = 25 × (checks satisfied / total checks)
 *       A check is satisfied when it holds in at least 60% of the freeze frames.
 *   Freeze stability (15) = 15 × (1 − ramp(m, deadzone, limit)) × min(1, similarityRatio / 0.5)
 *       m = mean positional standard deviation of the tracked joints during the freeze, in torso lengths,
 *       after a 3-frame median filter. Movement below the deadzone (breathing / model noise) costs nothing.
 *
 * Everything is measured on directions and torso-normalised distances, so height, limb length and
 * build do not affect the score. If required joints are not reliably visible the result is uncertain
 * and no score is produced.
 */

export const WEIGHTS = { required: 1, torso: 0.3, optional: 0.4 } as const;
export const FALLOFF_DEG = 35;
/** Stillness only earns full stability points when the pose is at least half-matched (no points for freezing in the wrong pose). */
export const STABILITY_SIMILARITY_GATE = 0.5;
export const CHECK_HOLD_RATIO = 0.6;
export const SEGMENT_VISIBLE_RATIO = 0.6;
export const MIN_FREEZE_FRAMES = 5;
export const DIFFICULTY_TOLERANCE_SCALE: Record<Difficulty, number> = { easy: 1.3, medium: 1, hard: 0.8 };

export interface SegmentResult { id: SegmentId; target: number; measured: number | null; error: number | null; credit: number; weight: number }
export interface CheckResult { label: string; holdRatio: number; passed: boolean }

export interface FreezeEvaluation {
  uncertain: boolean;
  uncertaintyReasons: string[];
  similarity: number | null;      // /60
  positions: number | null;       // /25
  stability: number | null;       // /15
  total: number | null;           // /100
  confidence: number;
  orientation: 'as-shown' | 'mirrored';
  segments: SegmentResult[];
  checks: CheckResult[];
  movement: number | null;        // torso lengths
  framesUsed: number;
  explanation: string;
  measurements: Record<string, number | string | boolean>;
}

/** Target for a mirrored performer (Mirror Match): swap left/right and reflect directions. */
export function mirrorPose(p: PoseSpec): PoseSpec {
  const angles = {} as Record<SegmentId, number>;
  for (const [k, v] of Object.entries(p.angles)) angles[swapSide(k as SegmentId)] = reflectAngle(v);
  return {
    ...p, id: `${p.id}~mirrored`, angles, mirrorAllowed: false,
    required: p.required.map(swapSide), optional: p.optional.map(swapSide),
    checks: p.checks.map((c) => swapCheck(c, true)),
  };
}

function swapCheck(c: PositionCheck, flip: boolean): PositionCheck {
  if (!flip) return c;
  const s = (n: LmName) => swapSide(n);
  switch (c.kind) {
    case 'joint': return { ...c, a: s(c.a), b: s(c.b), c: s(c.c) };
    case 'sideOf': return { ...c, a: s(c.a), b: s(c.b), side: c.side === 'left' ? 'right' : 'left' };
    default: return { ...c, a: s(c.a), b: s(c.b) };
  }
}

function checkHolds(c: PositionCheck, b: Body, T: number): boolean | null {
  const pts = c.kind === 'joint' ? [b[c.a], b[c.b], b[c.c]] : [b[c.a], b[c.b]];
  if (pts.some((p) => p.v < VISIBILITY_MIN)) return null;
  switch (c.kind) {
    case 'above': return b[c.a].y < b[c.b].y - c.margin * T;
    case 'below': return b[c.a].y > b[c.b].y + c.margin * T;
    case 'near': return dist(b[c.a], b[c.b]) < c.max * T;
    case 'apart': return dist(b[c.a], b[c.b]) > c.min * T;
    case 'level': return Math.abs(b[c.a].y - b[c.b].y) < c.max * T;
    case 'sideOf': return c.side === 'left' ? b[c.a].x < b[c.b].x - c.margin * T : b[c.a].x > b[c.b].x + c.margin * T;
    case 'joint': { const a = jointAngle(b[c.a], b[c.b], b[c.c]); return a >= c.min && a <= c.max; }
  }
}

function scoreSimilarity(pose: PoseSpec, frames: Body[], tolScale: number, swap: boolean) {
  const segs: SegmentResult[] = [];
  const reasons: string[] = [];
  const all: { id: SegmentId; w: number }[] = [
    ...pose.required.map((id) => ({ id, w: id === 'torso' ? WEIGHTS.torso : WEIGHTS.required })),
    ...pose.optional.map((id) => ({ id, w: WEIGHTS.optional })),
  ];
  let num = 0, den = 0;
  for (const { id, w } of all) {
    const measuredId = swap ? swapSide(id) : id;
    const target = swap ? reflectAngle(pose.angles[id]) : pose.angles[id];
    const vis = frames.map((f) => segmentAngle(f, measuredId)).filter((s) => s.visible).map((s) => s.angle);
    const required = pose.required.includes(id);
    if (vis.length < Math.max(1, SEGMENT_VISIBLE_RATIO * frames.length)) {
      if (required) reasons.push(`The ${SEGMENT_LABEL[measuredId]} was not clearly visible`);
      segs.push({ id: measuredId, target, measured: null, error: null, credit: 0, weight: required ? w : 0 });
      continue;
    }
    const measured = circularMean(vis);
    const error = angleDiff(measured, target);
    const tol = pose.tolerance * tolScale;
    const credit = 1 - ramp(error, tol, tol + FALLOFF_DEG);
    segs.push({ id: measuredId, target, measured, error, credit, weight: w });
    num += w * credit; den += w;
  }
  return { segs, reasons, ratio: den > 0 ? num / den : 0 };
}

/** 3-frame median filter, then mean per-joint positional std in torso lengths. */
export function movementScore(frames: Body[], joints: LmName[], T: number): number {
  const stds: number[] = [];
  for (const j of joints) {
    const pts = frames.map((f) => f[j]).filter((p) => p.v >= VISIBILITY_MIN);
    if (pts.length < 3) continue;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const smooth = (a: number[]) => a.map((_, i) => median(a.slice(Math.max(0, i - 1), i + 2)));
    const sx = smooth(xs), sy = smooth(ys);
    const mx = mean(sx), my = mean(sy);
    const v = mean(sx.map((x, i) => (x - mx) ** 2 + (sy[i] - my) ** 2));
    stds.push(Math.sqrt(v) / T);
  }
  return stds.length ? mean(stds) : NaN;
}

export function evaluateFreeze(
  pose: PoseSpec,
  frames: Body[],
  opts: { difficulty: Difficulty; expectedFrames: number; identitySwitch?: boolean },
): FreezeEvaluation {
  const reasons: string[] = [];
  const empty = (why: string[]): FreezeEvaluation => ({
    uncertain: true, uncertaintyReasons: why, similarity: null, positions: null, stability: null, total: null,
    confidence: 0, orientation: 'as-shown', segments: [], checks: [], movement: null, framesUsed: frames.length,
    explanation: `No score: ${why.join('; ')}. Please retake the round or ask the host to review.`,
    measurements: { framesUsed: frames.length },
  });
  const minFrames = Math.max(MIN_FREEZE_FRAMES, Math.round(0.4 * opts.expectedFrames));
  if (frames.length < minFrames) {
    return empty([`player tracked in only ${frames.length} of ~${opts.expectedFrames} freeze frames`]);
  }
  if (opts.identitySwitch) reasons.push('players may have swapped places during the freeze');

  const Ts = frames.map(torsoLength).filter((t) => t > 0);
  const T = median(Ts);
  if (!(T > 0.02)) return empty(['player too far from the camera to measure reliably']);

  const tolScale = DIFFICULTY_TOLERANCE_SCALE[opts.difficulty];
  let best = scoreSimilarity(pose, frames, tolScale, false);
  let swap = false;
  if (pose.mirrorAllowed) {
    const alt = scoreSimilarity(pose, frames, tolScale, true);
    if (alt.reasons.length <= best.reasons.length && alt.ratio > best.ratio) { best = alt; swap = true; }
  }
  reasons.push(...best.reasons);

  if (pose.needsFullBody) {
    const ankleVis = frames.filter((f) => f.lAnkle.v >= VISIBILITY_MIN && f.rAnkle.v >= VISIBILITY_MIN).length;
    if (ankleVis < SEGMENT_VISIBLE_RATIO * frames.length) reasons.push('feet were out of frame (this pose needs the whole body)');
  }

  const checks: CheckResult[] = pose.checks.map((raw) => {
    const c = swapCheck(raw, swap);
    const r = frames.map((f) => checkHolds(c, f, T)).filter((x): x is boolean => x !== null);
    const holdRatio = r.length ? r.filter(Boolean).length / frames.length : 0;
    if (r.length < SEGMENT_VISIBLE_RATIO * frames.length) reasons.push(`could not see enough to check "${raw.label}"`);
    return { label: raw.label, holdRatio, passed: holdRatio >= CHECK_HOLD_RATIO };
  });

  const joints = new Set<LmName>();
  for (const s of best.segs) if (s.weight > 0) {
    const name = s.id;
    const map: Record<SegmentId, LmName[]> = {
      torso: ['shoulderMid', 'hipMid'], lUpperArm: ['lShoulder', 'lElbow'], lForearm: ['lElbow', 'lWrist'],
      rUpperArm: ['rShoulder', 'rElbow'], rForearm: ['rElbow', 'rWrist'], lThigh: ['lHip', 'lKnee'],
      lShin: ['lKnee', 'lAnkle'], rThigh: ['rHip', 'rKnee'], rShin: ['rKnee', 'rAnkle'],
    };
    map[name].forEach((j) => joints.add(j));
  }
  const movement = movementScore(frames, [...joints], T);

  const unique = [...new Set(reasons)];
  if (unique.length) {
    const ev = empty(unique);
    return { ...ev, segments: best.segs, checks, movement: Number.isFinite(movement) ? Math.round(movement * 1000) / 1000 : null, orientation: swap ? 'mirrored' : 'as-shown' };
  }

  const similarity = round1(60 * best.ratio);
  const positions = round1(checks.length ? (25 * checks.filter((c) => c.passed).length) / checks.length : 25);
  const stillness = 1 - ramp(movement, pose.stability.deadzone, pose.stability.limit);
  const stability = round1(15 * stillness * Math.min(1, best.ratio / STABILITY_SIMILARITY_GATE));
  const total = round1(clamp(similarity + positions + stability, 0, 100));
  const visRatio = mean(frames.map((f) => mean((['lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lHip', 'rHip'] as LmName[]).map((k) => f[k].v))));
  const confidence = round1(clamp(Math.min(1, frames.length / opts.expectedFrames) * visRatio) * 100) / 100;

  return {
    uncertain: false, uncertaintyReasons: [], similarity, positions, stability, total, confidence,
    orientation: swap ? 'mirrored' : 'as-shown', segments: best.segs, checks,
    movement: Math.round(movement * 1000) / 1000, framesUsed: frames.length,
    explanation: explainFreeze(pose, best.segs, checks, movement, stillness, best.ratio, swap),
    measurements: {
      framesUsed: frames.length, torsoLengthNorm: Math.round(T * 1000) / 1000, movementTorsoLengths: Math.round(movement * 1000) / 1000,
      orientation: swap ? 'mirrored' : 'as-shown',
      ...Object.fromEntries(best.segs.filter((s) => s.error !== null).map((s) => [`err_${s.id}_deg`, Math.round(s.error!)])),
    },
  };
}

/** Builds the explanation strictly from the measured numbers above. */
export function explainFreeze(pose: PoseSpec, segs: SegmentResult[], checks: CheckResult[], movement: number, stillness: number, simRatio: number, swapped: boolean): string {
  const measured = segs.filter((s) => s.error !== null && s.weight > 0);
  const tol = pose.tolerance;
  const good = measured.filter((s) => s.error! <= tol).sort((a, b) => a.error! - b.error!);
  const off = measured.filter((s) => s.error! > tol).sort((a, b) => b.error! - a.error!);
  const parts: string[] = [];
  if (swapped) parts.push('You did the pose on the opposite side, which this pose allows.');
  if (good.length) parts.push(`Closely matched: ${good.slice(0, 3).map((s) => `${SEGMENT_LABEL[s.id]} (${Math.round(s.error!)}° off)`).join(', ')}.`);
  if (off.length) parts.push(`Different from the target: ${off.slice(0, 2).map((s) => `${SEGMENT_LABEL[s.id]} was ${Math.round(s.error!)}° away`).join(', ')}.`);
  if (!off.length && good.length) parts.push('Every measured body segment was within tolerance.');
  const failed = checks.filter((c) => !c.passed);
  if (checks.length) parts.push(failed.length
    ? `Missed position${failed.length > 1 ? 's' : ''}: ${failed.map((c) => `${c.label} (held ${Math.round(c.holdRatio * 100)}% of the freeze)`).join('; ')}.`
    : 'All required positions were held.');
  const m = Math.round(movement * 1000) / 1000;
  parts.push(stillness >= 0.999
    ? `The freeze was maintained throughout the interval (movement ${m} torso-lengths, inside the ${pose.stability.deadzone} allowance for breathing).`
    : `There was movement during the freeze (${m} torso-lengths; allowance ${pose.stability.deadzone}).`);
  if (simRatio < STABILITY_SIMILARITY_GATE) parts.push('Stability points were reduced because the frozen pose matched less than half of the target.');
  return parts.join(' ');
}

/** Team score (§11): average of valid individual scores + optional unity bonus, capped at 100. */
export const TEAM_UNITY_BONUS = 5;
export const TEAM_UNITY_MIN = 60;
export function teamFreezeScore(individual: (number | null)[]): { score: number | null; validCount: number; bonus: number; uncertain: boolean } {
  const valid = individual.filter((s): s is number => s !== null);
  if (!individual.length || valid.length < Math.ceil(individual.length / 2)) {
    return { score: null, validCount: valid.length, bonus: 0, uncertain: true };
  }
  const avg = mean(valid);
  const bonus = valid.length === individual.length && valid.every((s) => s >= TEAM_UNITY_MIN) ? TEAM_UNITY_BONUS : 0;
  return { score: round1(Math.min(100, avg + bonus)), validCount: valid.length, bonus, uncertain: false };
}
