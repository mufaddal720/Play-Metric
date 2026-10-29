/**
 * Explicit Freeze & Fool round state machine:
 * READY → PREPARE → COPY → FREEZE → ANALYSE → VERDICT → (READY for next round | COMPLETE)
 */
export type FreezePhase = 'READY' | 'PREPARE' | 'COPY' | 'FREEZE' | 'ANALYSE' | 'VERDICT' | 'COMPLETE';

export interface Timing { prepare: number; copy: number; freeze: number }
export const DEFAULT_TIMING: Timing = { prepare: 5, copy: 8, freeze: 3 };
export const CHAOS_TIMING: Timing = { prepare: 3, copy: 6, freeze: 3 };

const ORDER: FreezePhase[] = ['READY', 'PREPARE', 'COPY', 'FREEZE', 'ANALYSE', 'VERDICT'];

export function nextPhase(phase: FreezePhase, roundIndex: number, totalRounds: number): FreezePhase {
  if (phase === 'COMPLETE') return 'COMPLETE';
  if (phase === 'VERDICT') return roundIndex + 1 >= totalRounds ? 'COMPLETE' : 'READY';
  return ORDER[ORDER.indexOf(phase) + 1];
}

export function phaseDuration(phase: FreezePhase, t: Timing): number | null {
  if (phase === 'PREPARE') return t.prepare;
  if (phase === 'COPY') return t.copy;
  if (phase === 'FREEZE') return t.freeze;
  return null; // READY / ANALYSE / VERDICT wait for an action or for analysis to finish
}

export function validateTiming(t: Timing): string | null {
  if (t.prepare < 2 || t.prepare > 15) return 'Preparation must be 2–15 seconds.';
  if (t.copy < 3 || t.copy > 20) return 'Copying time must be 3–20 seconds.';
  if (t.freeze < 2 || t.freeze > 8) return 'Freeze interval must be 2–8 seconds.';
  return null;
}

/** Deterministic pseudo-random sequence (seeded by the round id) for Chaos-mode target switches. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Chaos mode: the target may change during COPY; the target active when FREEZE starts is the judged reference. */
export function chaosSchedule(roundId: string, poseIds: string[], copySeconds: number): { at: number; poseId: string }[] {
  const rnd = seededRandom(roundId);
  const pick = () => poseIds[Math.floor(rnd() * poseIds.length)];
  const first = pick();
  const switches = 1 + Math.floor(rnd() * 2);
  const out = [{ at: 0, poseId: first }];
  for (let i = 1; i <= switches; i++) {
    let id = pick();
    if (id === out[out.length - 1].poseId) id = poseIds[(poseIds.indexOf(id) + 1) % poseIds.length];
    out.push({ at: Math.round(((copySeconds * i) / (switches + 1)) * 10) / 10, poseId: id });
  }
  return out;
}

export function targetAt(schedule: { at: number; poseId: string }[], elapsedCopy: number): string {
  let id = schedule[0].poseId;
  for (const s of schedule) if (elapsedCopy >= s.at) id = s.poseId;
  return id;
}
