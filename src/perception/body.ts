/**
 * Body geometry shared by Freeze & Fool and Action Detective.
 *
 * Coordinate convention ("mirror view"): x is flipped so the player's LEFT side appears on the
 * LEFT of the screen, exactly like looking into a mirror. x is scaled by the frame aspect ratio so
 * that angles are not distorted, and y points down. Angles are in degrees: 0 = screen-right,
 * 90 = down, 180 = screen-left, -90 = up.
 */

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
} as const;
export type LmName = keyof typeof LM | 'shoulderMid' | 'hipMid';

export interface RawLandmark { x: number; y: number; z?: number; visibility?: number }
export interface Pt { x: number; y: number; v: number }
export type Body = Record<LmName, Pt>;

export const VISIBILITY_MIN = 0.5;

export function toBody(raw: RawLandmark[], aspect: number, mirror = true): Body {
  const get = (i: number): Pt => {
    const r = raw[i];
    const inFrame = r.x > -0.02 && r.x < 1.02 && r.y > -0.02 && r.y < 1.02;
    return { x: (mirror ? 1 - r.x : r.x) * aspect, y: r.y, v: inFrame ? (r.visibility ?? 1) : 0 };
  };
  const b = {} as Body;
  for (const [k, i] of Object.entries(LM)) b[k as keyof typeof LM] = get(i);
  b.shoulderMid = mid(b.lShoulder, b.rShoulder);
  b.hipMid = mid(b.lHip, b.rHip);
  return b;
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const dirDeg = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/** Interior angle at joint b (degrees, 180 = straight). */
export function jointAngle(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (d === 0) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / d))) * 180) / Math.PI;
}

/** Torso length (shoulder-mid to hip-mid) is the body-size unit: it removes height and proportion differences. */
export const torsoLength = (b: Body) => dist(b.shoulderMid, b.hipMid);

export type SegmentId = 'torso' | 'lUpperArm' | 'lForearm' | 'rUpperArm' | 'rForearm' | 'lThigh' | 'lShin' | 'rThigh' | 'rShin';
export const SEGMENTS: Record<SegmentId, [LmName, LmName]> = {
  torso: ['hipMid', 'shoulderMid'],
  lUpperArm: ['lShoulder', 'lElbow'], lForearm: ['lElbow', 'lWrist'],
  rUpperArm: ['rShoulder', 'rElbow'], rForearm: ['rElbow', 'rWrist'],
  lThigh: ['lHip', 'lKnee'], lShin: ['lKnee', 'lAnkle'],
  rThigh: ['rHip', 'rKnee'], rShin: ['rKnee', 'rAnkle'],
};
export const SEGMENT_LABEL: Record<SegmentId, string> = {
  torso: 'torso', lUpperArm: 'left upper arm', lForearm: 'left forearm', rUpperArm: 'right upper arm',
  rForearm: 'right forearm', lThigh: 'left thigh', lShin: 'left lower leg', rThigh: 'right thigh', rShin: 'right lower leg',
};
export const SEGMENT_IDS = Object.keys(SEGMENTS) as SegmentId[];

export function segmentAngle(b: Body, s: SegmentId): { angle: number; visible: boolean } {
  const [a, c] = SEGMENTS[s];
  return { angle: dirDeg(b[a], b[c]), visible: b[a].v >= VISIBILITY_MIN && b[c].v >= VISIBILITY_MIN };
}

/** Swap anatomical left/right — used for mirrored targets and "either side" poses. */
export function swapSide<T extends string>(name: T): T {
  if (name.startsWith('l') && name[1] === name[1]?.toUpperCase()) return ('r' + name.slice(1)) as T;
  if (name.startsWith('r') && name[1] === name[1]?.toUpperCase()) return ('l' + name.slice(1)) as T;
  return name;
}

/** Reflect a direction across the vertical axis. */
export const reflectAngle = (deg: number) => ((180 - deg + 540) % 360) - 180;
