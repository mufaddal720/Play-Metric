/**
 * Colour-based ball tracker (works on any RGBA pixel buffer, so it is unit-testable).
 * The host taps the ball once during calibration; the tracker learns its hue/saturation/value,
 * then each frame it finds round blobs of that colour, preferring the blob nearest the last
 * known position with a similar size. This is reliable for a brightly coloured ball and is
 * complemented by the EfficientDet "sports ball" detector.
 */
export interface ColourModel { h: number; s: number; v: number; hTol: number; sMin: number; vMin: number; lowSat: boolean; radius: number }
/** A ball never covers more than this share of the frame; a larger match means the sample was not the ball. */
export const MAX_BALL_FRAME_FRACTION = 0.03;

export interface Blob { x: number; y: number; r: number; area: number; fill: number; conf: number }

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

/** Learn a colour model from a small disc of pixels around the tapped point. */
export function learnColour(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius = 4): ColourModel | null {
  const hs: number[] = [], ss: number[] = [], vs: number[] = [];
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const i = (y * w + x) * 4;
      const [hh, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      hs.push(hh); ss.push(s); vs.push(v);
    }
  }
  if (!hs.length) return null;
  const sMed = [...ss].sort((a, b) => a - b)[ss.length >> 1];
  const vMed = [...vs].sort((a, b) => a - b)[vs.length >> 1];
  const lowSat = sMed < 0.25;
  // circular median-ish hue: mean of unit vectors
  let sx = 0, sy = 0;
  hs.forEach((d) => { sx += Math.cos((d * Math.PI) / 180); sy += Math.sin((d * Math.PI) / 180); });
  const hMean = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const model: ColourModel = {
    h: hMean, s: sMed, v: vMed, hTol: 18, sMin: Math.max(0.3, sMed * 0.55), vMin: Math.max(0.18, vMed * 0.45), lowSat, radius: 0,
  };
  // Reject a sample that matches a large part of the frame (e.g. the host tapped the grass, not the ball).
  let hits = 0;
  for (let i = 0; i < data.length; i += 16) if (matches(model, data[i], data[i + 1], data[i + 2])) hits++;
  if (hits / (data.length / 16) > MAX_BALL_FRAME_FRACTION) return null;
  const blobs = findBlobs(data, w, h, model);
  const near = blobs.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
  model.radius = near && Math.hypot(near.x - cx, near.y - cy) < near.r + 4 ? near.r : radius;
  return model;
}

export function matches(model: ColourModel, r: number, g: number, b: number): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  if (model.lowSat) return s < 0.3 && v >= Math.max(0.55, model.v - 0.2);
  const dh = Math.abs(((h - model.h + 540) % 360) - 180);
  return dh <= model.hTol && s >= model.sMin && v >= model.vMin;
}

/** Connected components (4-neighbour, union-find) over the colour mask; returns roughly round blobs. */
export function findBlobs(data: Uint8ClampedArray, w: number, h: number, model: ColourModel, roi?: (x: number, y: number) => boolean): Blob[] {
  const labels = new Int32Array(w * h).fill(-1);
  const parent: number[] = [];
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      if (!matches(model, data[p], data[p + 1], data[p + 2])) continue;
      if (roi && !roi(x, y)) continue;
      const up = y > 0 ? labels[i - w] : -1, left = x > 0 ? labels[i - 1] : -1;
      if (up < 0 && left < 0) { labels[i] = parent.length; parent.push(parent.length); }
      else if (up >= 0 && left >= 0) { const a = find(up), b = find(left); labels[i] = Math.min(a, b); parent[Math.max(a, b)] = Math.min(a, b); }
      else labels[i] = up >= 0 ? find(up) : find(left);
    }
  }
  const stats = new Map<number, { n: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number }>();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] < 0) continue;
    const root = find(labels[i]);
    const x = i % w, y = (i / w) | 0;
    const s = stats.get(root) ?? { n: 0, sx: 0, sy: 0, x0: x, x1: x, y0: y, y1: y };
    s.n++; s.sx += x; s.sy += y; s.x0 = Math.min(s.x0, x); s.x1 = Math.max(s.x1, x); s.y0 = Math.min(s.y0, y); s.y1 = Math.max(s.y1, y);
    stats.set(root, s);
  }
  const out: Blob[] = [];
  for (const s of stats.values()) {
    if (s.n < 4) continue;
    const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    const r = Math.max(bw, bh) / 2;
    const fill = s.n / (Math.PI * r * r);
    if (aspect < 0.45 || fill < 0.35) continue; // not round enough to be a ball
    out.push({ x: s.sx / s.n, y: s.sy / s.n, r, area: s.n, fill: Math.min(1, fill), conf: Math.min(1, aspect * Math.min(1, fill / 0.75)) });
  }
  return out;
}

/** Pick the most plausible ball blob given the expected radius and the predicted position. */
export function pickBall(blobs: Blob[], model: ColourModel, predicted: { x: number; y: number } | null, maxJump: number): Blob | null {
  let best: Blob | null = null, bestScore = -Infinity;
  for (const b of blobs) {
    const sizeRatio = model.radius > 0 ? Math.min(b.r, model.radius) / Math.max(b.r, model.radius) : 0.5;
    if (sizeRatio < 0.35) continue;
    let score = b.conf + sizeRatio;
    if (predicted) {
      const d = Math.hypot(b.x - predicted.x, b.y - predicted.y);
      if (d > maxJump) continue;
      score -= d / maxJump;
    }
    if (score > bestScore) { bestScore = score; best = { ...b, conf: Math.min(1, b.conf * sizeRatio + 0.2) }; }
  }
  return best;
}
