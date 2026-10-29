import type { Body, LmName, Pt, SegmentId } from '../../perception/body';

/** Standard proportions in torso lengths, used only to DRAW reference poses (judging ignores proportions). */
export const PROPORTIONS = { shoulderHalf: 0.4, hipHalf: 0.25, upperArm: 0.6, forearm: 0.55, thigh: 0.9, shin: 0.85, neck: 0.45, head: 0.22 };

/**
 * Forward kinematics: turns a reference skeleton (segment directions) into joint positions in
 * mirror-view coordinates. `scale` is the torso length, (ox, oy) the hip centre.
 */
export function bodyFromAngles(angles: Record<SegmentId, number>, scale = 1, ox = 0, oy = 0, prop = PROPORTIONS): Body {
  const rad = (d: number) => (d * Math.PI) / 180;
  const p = (x: number, y: number): Pt => ({ x, y, v: 1 });
  const step = (from: Pt, deg: number, len: number) => p(from.x + Math.cos(rad(deg)) * len * scale, from.y + Math.sin(rad(deg)) * len * scale);
  const hipMid = p(ox, oy);
  const tdir = { x: Math.cos(rad(angles.torso)), y: Math.sin(rad(angles.torso)) };
  const shoulderMid = p(ox + tdir.x * scale, oy + tdir.y * scale);
  const left = { x: tdir.y, y: -tdir.x }; // toward screen-left for an upright torso
  const off = (c: Pt, k: number, sign: number) => p(c.x + left.x * k * scale * sign, c.y + left.y * k * scale * sign);
  const lShoulder = off(shoulderMid, prop.shoulderHalf, 1), rShoulder = off(shoulderMid, prop.shoulderHalf, -1);
  const lHip = off(hipMid, prop.hipHalf, 1), rHip = off(hipMid, prop.hipHalf, -1);
  const lElbow = step(lShoulder, angles.lUpperArm, prop.upperArm), lWrist = step(lElbow, angles.lForearm, prop.forearm);
  const rElbow = step(rShoulder, angles.rUpperArm, prop.upperArm), rWrist = step(rElbow, angles.rForearm, prop.forearm);
  const lKnee = step(lHip, angles.lThigh, prop.thigh), lAnkle = step(lKnee, angles.lShin, prop.shin);
  const rKnee = step(rHip, angles.rThigh, prop.thigh), rAnkle = step(rKnee, angles.rShin, prop.shin);
  const nose = p(shoulderMid.x + tdir.x * prop.neck * scale, shoulderMid.y + tdir.y * prop.neck * scale);
  const b: Record<LmName, Pt> = {
    nose, lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle, shoulderMid, hipMid,
  };
  return b;
}

/** Interpolates between two skeletons along the shortest angular path (for target animations). */
export function lerpAngles(a: Record<SegmentId, number>, b: Record<SegmentId, number>, t: number): Record<SegmentId, number> {
  const out = {} as Record<SegmentId, number>;
  for (const k of Object.keys(a) as SegmentId[]) {
    const d = ((((b[k] - a[k]) % 360) + 540) % 360) - 180;
    out[k] = a[k] + d * t;
  }
  return out;
}
