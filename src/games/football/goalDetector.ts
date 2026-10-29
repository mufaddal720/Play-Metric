import { type P, crossingParam, distToSegment, distance, side } from './geometry';

/**
 * Goal-verification pipeline (§15). Pure and deterministic: it consumes timestamped ball
 * observations (or "not seen") and emits goal decisions. Coordinates are in pixels of the
 * analysed frame so distances are not distorted by the aspect ratio.
 *
 * A goal is CONFIRMED only when all of these hold:
 *   1. Approach: ≥ minBefore ball observations on the field side of the goal line within `approachWindow` s
 *      before the crossing (a tracked trajectory, not a ball that "appears" inside the goal).
 *   2. Crossing: consecutive observations cross the goal line from the field side to the inside, and the
 *      crossing point lies on the goal mouth (between the posts, ± lineMargin of the goal width).
 *   3. Continuity: the gap between the last outside and first inside observation is ≤ maxGap s.
 *   4. Inside: ≥ minAfter observations inside the goal within `confirmWindow` s after the crossing.
 *   5. Armed: the goal is armed — after any goal, scoring is locked until a restart (kick-off).
 * If 2 holds but 1, 3 or 4 cannot be verified (e.g. occlusion), the event is UNCERTAIN and goes to host review.
 * Near-misses, celebrations and balls resting near the line never count.
 */
export interface GoalDef { id: string; label: string; p1: P; p2: P; inside: P; awardTo: string }
export interface BallObs { t: number; x: number; y: number; conf: number; source: 'colour' | 'ml' }

export interface GoalRules {
  minBefore: number;
  minAfter: number;
  maxGap: number;
  approachWindow: number;
  confirmWindow: number;
  lineMargin: number;
  restart: 'auto' | 'host';
  /** auto restart: ball must be seen this long, continuously, at least `rearmDistance` goal-widths from every goal line. */
  rearmSeconds: number;
  rearmDistance: number;
}
export const DEFAULT_GOAL_RULES: GoalRules = {
  minBefore: 2, minAfter: 2, maxGap: 0.35, approachWindow: 0.8, confirmWindow: 1.0, lineMargin: 0.1,
  restart: 'auto', rearmSeconds: 1.5, rearmDistance: 0.75,
};

export type GoalDecision = 'confirmed' | 'uncertain';
export interface GoalEvent {
  id: string;
  goalId: string;
  awardTo: string;
  decision: GoalDecision;
  crossingTime: number;
  reasons: string[];
  trajectory: BallObs[];
  measurements: Record<string, number | string | boolean>;
}

interface Pending { goal: GoalDef; crossT: number; u: number; before: BallObs[]; gap: number; inside: BallObs[]; prev: BallObs }

export class GoalDetector {
  private history: BallObs[] = [];
  private pending: Pending | null = null;
  private armed = true;
  private rearmSince: number | null = null;
  readonly emitted = new Set<string>();

  constructor(readonly goals: GoalDef[], readonly rules: GoalRules = DEFAULT_GOAL_RULES) {}

  get isArmed() { return this.armed; }
  get hasPending() { return this.pending !== null; }

  /** Host pressed kick-off / restart. */
  restart() { this.armed = true; this.rearmSince = null; this.pending = null; }

  private insideSign(g: GoalDef) { return Math.sign(side(g.p1, g.p2, g.inside)) || 1; }
  private isInside(g: GoalDef, o: P) { return side(g.p1, g.p2, o) * this.insideSign(g) > 0; }
  private width(g: GoalDef) { return distance(g.p1, g.p2); }
  /** Inside the goal "box": beyond the line and near the mouth (within one goal-width). */
  private inGoalArea(g: GoalDef, o: P) { return this.isInside(g, o) && distToSegment(o, g.p1, g.p2) < this.width(g); }

  /** Feed one analysed frame. `obs` is null when the ball was not found in that frame. */
  push(t: number, obs: BallObs | null): GoalEvent[] {
    const out: GoalEvent[] = [];
    if (this.pending) {
      const p = this.pending;
      if (obs && this.inGoalArea(p.goal, obs)) p.inside.push(obs);
      const resolved = (obs && !this.isInside(p.goal, obs)) || t - p.crossT > this.rules.confirmWindow || p.inside.length >= this.rules.minAfter;
      if (resolved) out.push(this.resolve(p));
    }

    if (obs) {
      const prev = this.history[this.history.length - 1];
      if (this.armed && !this.pending && prev) {
        for (const g of this.goals) {
          if (!this.isInside(g, prev) && this.isInside(g, obs)) {
            const u = crossingParam(g.p1, g.p2, prev, obs);
            if (u === null || u < -this.rules.lineMargin || u > 1 + this.rules.lineMargin) continue;
            const crossT = prev.t + (obs.t - prev.t) * 0.5;
            const before = this.history.filter((h) => h.t >= prev.t - this.rules.approachWindow && !this.isInside(g, h));
            this.pending = { goal: g, crossT, u, before, gap: obs.t - prev.t, inside: this.inGoalArea(g, obs) ? [obs] : [], prev };
            if (this.pending.inside.length >= this.rules.minAfter) out.push(this.resolve(this.pending));
            break;
          }
        }
      }
      this.history.push(obs);
      if (this.history.length > 300) this.history.splice(0, this.history.length - 300);

      if (!this.armed && this.rules.restart === 'auto' && !this.pending) {
        const far = this.goals.every((g) => !this.isInside(g, obs) && distToSegment(obs, g.p1, g.p2) > this.rules.rearmDistance * this.width(g));
        if (far) {
          this.rearmSince ??= t;
          if (t - this.rearmSince >= this.rules.rearmSeconds) { this.armed = true; this.rearmSince = null; }
        } else this.rearmSince = null;
      }
    } else if (this.rearmSince !== null && this.history.length && t - this.history[this.history.length - 1].t > 0.3) {
      this.rearmSince = null; // continuity required for auto re-arm
    }
    return out;
  }

  private resolve(p: Pending): GoalEvent {
    this.pending = null;
    const reasons: string[] = [];
    if (p.before.length < this.rules.minBefore) reasons.push(`approach not tracked (${p.before.length} of ${this.rules.minBefore} observations before the line)`);
    if (p.gap > this.rules.maxGap) reasons.push(`ball hidden for ${p.gap.toFixed(2)} s at the line (limit ${this.rules.maxGap} s)`);
    if (p.inside.length < this.rules.minAfter) reasons.push(`ball seen inside the goal only ${p.inside.length} time(s) (need ${this.rules.minAfter})`);
    const decision: GoalDecision = reasons.length ? 'uncertain' : 'confirmed';
    const id = `${p.goal.id}@${p.crossT.toFixed(2)}`;
    this.emitted.add(id);
    this.armed = false; // ball is dead after a goal (or a possible goal) until restart
    this.rearmSince = null;
    return {
      id, goalId: p.goal.id, awardTo: p.goal.awardTo, decision, crossingTime: p.crossT, reasons,
      trajectory: [...p.before, ...p.inside],
      measurements: {
        observationsBefore: p.before.length, observationsInside: p.inside.length,
        gapAtLineSec: Math.round(p.gap * 100) / 100, crossingPointOnMouth: Math.round(p.u * 100) / 100,
        meanConfidence: Math.round((p.before.concat(p.inside).reduce((a, o) => a + o.conf, 0) / Math.max(1, p.before.length + p.inside.length)) * 100) / 100,
      },
    };
  }
}
