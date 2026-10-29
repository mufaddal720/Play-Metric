import type { Body } from './body';
import { torsoLength } from './body';

/**
 * Keeps player identities stable across frames without any face or identity recognition.
 * Slots are assigned left-to-right (mirror view) when tracking starts, then each frame every
 * detected body is matched to the nearest previous position (greedy nearest-neighbour on hip centre).
 */
export interface TrackFrame { t: number; bodies: (Body | null)[] }

export class PersonTracker {
  private last: ({ x: number; y: number } | null)[];
  readonly switches: number[] = [];
  constructor(readonly slots: number) {
    this.last = Array(slots).fill(null);
  }

  reset() { this.last = Array(this.slots).fill(null); }

  assign(bodies: Body[], t: number): TrackFrame {
    const out: (Body | null)[] = Array(this.slots).fill(null);
    const cands = bodies.map((b) => ({ b, x: b.hipMid.x, y: b.hipMid.y, scale: torsoLength(b) }));
    const initialised = this.last.some((p) => p !== null);
    if (!initialised) {
      if (cands.length < this.slots) {
        // Wait until everyone is visible before fixing the left-to-right order.
        cands.sort((a, b) => a.x - b.x).forEach((c, i) => { out[i] = c.b; });
        return { t, bodies: out };
      }
      cands.sort((a, b) => a.x - b.x).slice(0, this.slots).forEach((c, i) => { out[i] = c.b; this.last[i] = { x: c.x, y: c.y }; });
      return { t, bodies: out };
    }
    const pairs: { slot: number; ci: number; d: number }[] = [];
    this.last.forEach((p, slot) => {
      if (!p) return;
      cands.forEach((c, ci) => pairs.push({ slot, ci, d: Math.hypot(c.x - p.x, c.y - p.y) / Math.max(c.scale, 1e-3) }));
    });
    pairs.sort((a, b) => a.d - b.d);
    const usedSlot = new Set<number>(), usedCand = new Set<number>();
    for (const pr of pairs) {
      if (usedSlot.has(pr.slot) || usedCand.has(pr.ci)) continue;
      if (pr.d > 1.5) continue; // more than 1.5 torso lengths in one frame: not the same person
      usedSlot.add(pr.slot); usedCand.add(pr.ci);
      out[pr.slot] = cands[pr.ci].b;
      this.last[pr.slot] = { x: cands[pr.ci].x, y: cands[pr.ci].y };
    }
    // Order check: if two tracked players swap left/right order, flag a possible identity switch.
    const xs = out.map((b, i) => (b ? { i, x: b.hipMid.x } : null)).filter(Boolean) as { i: number; x: number }[];
    for (let k = 1; k < xs.length; k++) if (xs[k].x < xs[k - 1].x) { this.switches.push(t); break; }
    return { t, bodies: out };
  }
}
