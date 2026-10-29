import { clamp, mean, median, percentile } from '../../lib/math';
import { type Body, VISIBILITY_MIN, dist, jointAngle, torsoLength } from '../../perception/body';

/**
 * Temporal movement features for Action Detective. A static pose cannot tell actions apart,
 * so every feature here is measured over time: rhythm (autocorrelation periodicity and
 * frequency), amplitude, left/right coordination (correlation), and where the hands spend
 * their time relative to the body. Units are torso lengths, so body size does not matter.
 *
 * Body-relative coordinates: origin at the hip centre, y up is negative.
 * Typical positions: shoulders y ≈ −1, nose ≈ −1.45, top of head ≈ −1.65, knees ≈ +0.9.
 */
export const SAMPLE_HZ = 15;

export interface Osc { amp: number; periodicity: number; freq: number }
export interface Hand {
  meanX: number; meanY: number; distNose: number; extension: number; aboveHead: number;
  oscX: Osc; oscY: Osc; circ: number; travel: number;
}
export interface ActionFeatures {
  duration: number; frames: number; trackedRatio: number;
  L: Hand; R: Hand; dom: Hand; other: Hand; domSide: 'left' | 'right';
  corrY: number; corrX: number;
  wristDist: { mean: number; min: number; osc: Osc };
  elbow: { L: Osc; R: Osc; corr: number };
  hipX: Osc; hipY: Osc;
  shoulderTilt: Osc;           // degrees
  torsoTilt: { mean: number; osc: Osc }; // degrees from vertical
  torsoApparent: { min: number; osc: Osc }; // apparent torso length / median (bending forward shortens it)
  shoulderWidth: Osc;
  headTurn: Osc;
  ankles: { corrY: number; L: Osc; R: Osc; dist: Osc };
}

export interface TimedBody { t: number; body: Body | null }

function resample(times: number[], values: (number | null)[], t0: number, t1: number, maxGap = 0.5): number[] {
  const out: number[] = [];
  const pts = times.map((t, i) => ({ t, v: values[i] })).filter((p): p is { t: number; v: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return [];
  let j = 0;
  for (let t = t0; t <= t1 + 1e-9; t += 1 / SAMPLE_HZ) {
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1];
    if (t <= a.t) out.push(a.v);
    else if (t >= b.t) out.push(b.v);
    else if (b.t - a.t > maxGap) out.push(t - a.t < b.t - t ? a.v : b.v);
    else out.push(a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t));
  }
  return out;
}

const smooth3 = (a: number[]) => a.map((_, i) => mean(a.slice(Math.max(0, i - 1), i + 2)));

/** Remove slow drift with a 2.5 s moving average so only repeated motion remains. */
function detrend(a: number[]): number[] {
  const w = Math.round(SAMPLE_HZ * 1.25);
  return a.map((v, i) => v - mean(a.slice(Math.max(0, i - w), i + w + 1)));
}

export function oscillation(signal: number[]): Osc {
  if (signal.length < SAMPLE_HZ) return { amp: 0, periodicity: 0, freq: 0 };
  const s = smooth3(signal);
  const d = detrend(s);
  const amp = percentile(d, 0.9) - percentile(d, 0.1);
  const m = mean(d);
  const c = d.map((v) => v - m);
  const energy = c.reduce((a, v) => a + v * v, 0);
  if (energy < 1e-9) return { amp, periodicity: 0, freq: 0 };
  const minLag = Math.max(2, Math.round(SAMPLE_HZ / 4)); // ≤ 4 Hz
  const maxLag = Math.min(Math.round(SAMPLE_HZ / 0.4), Math.floor(c.length / 2)); // ≥ 0.4 Hz
  let best = 0, bestLag = 0;
  const r: number[] = [];
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let acc = 0;
    for (let i = 0; i + lag < c.length; i++) acc += c[i] * c[i + lag];
    r[lag] = (acc / energy) * (c.length / (c.length - lag));
  }
  const peaks: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (r[lag] > 0 && r[lag] >= r[lag - 1] && r[lag] >= (r[lag + 1] ?? -Infinity)) peaks.push(lag);
  }
  for (const lag of peaks) if (r[lag] > best) best = r[lag];
  // The fundamental period is the first peak that is nearly as strong as the strongest one
  // (later peaks at 2×, 3× the period are equally strong for a clean rhythm).
  bestLag = peaks.find((lag) => r[lag] >= 0.85 * best) ?? 0;
  return { amp, periodicity: clamp(best), freq: bestLag ? SAMPLE_HZ / bestLag : 0 };
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 4) return 0;
  const da = detrend(smooth3(a.slice(0, n))), db = detrend(smooth3(b.slice(0, n)));
  const ma = mean(da), mb = mean(db);
  let num = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { num += (da[i] - ma) * (db[i] - mb); va += (da[i] - ma) ** 2; vb += (db[i] - mb) ** 2; }
  return va && vb ? num / Math.sqrt(va * vb) : 0;
}

/** Circular motion: both axes oscillate with comparable size and rhythm. */
function circularity(x: Osc, y: Osc): number {
  const big = Math.max(x.amp, y.amp);
  if (big < 0.08) return 0;
  return (Math.min(x.amp, y.amp) / big) * Math.min(1, 2 * Math.min(x.periodicity, y.periodicity));
}

export function extractActionFeatures(seq: TimedBody[]): ActionFeatures | null {
  if (seq.length < 2) return null;
  const t0 = seq[0].t, t1 = seq[seq.length - 1].t;
  const duration = t1 - t0;
  const valid = seq.filter((s): s is { t: number; body: Body } => !!s.body && s.body.lShoulder.v >= VISIBILITY_MIN && s.body.rShoulder.v >= VISIBILITY_MIN && s.body.lHip.v >= VISIBILITY_MIN * 0.6 && s.body.rHip.v >= VISIBILITY_MIN * 0.6);
  const trackedRatio = valid.length / seq.length;
  if (valid.length < SAMPLE_HZ) return null;
  const T = median(valid.map((v) => torsoLength(v.body)));
  if (!(T > 0)) return null;
  const times = valid.map((v) => v.t);
  const series = (fn: (b: Body) => number | null) => resample(times, valid.map((v) => fn(v.body)), t0, t1);
  const rel = (b: Body, k: keyof Body, axis: 'x' | 'y') => (b[k].v >= VISIBILITY_MIN * 0.6 ? (b[k][axis] - b.hipMid[axis]) / T : null);
  const hipX0 = valid[0].body.hipMid.x, hipY0 = valid[0].body.hipMid.y;

  const hand = (side: 'l' | 'r'): Hand => {
    const w = (side + 'Wrist') as keyof Body, s = (side + 'Shoulder') as keyof Body;
    const xs = series((b) => rel(b, w, 'x')), ys = series((b) => rel(b, w, 'y'));
    const nose = series((b) => (b[w].v >= 0.3 && b.nose.v >= 0.3 ? dist(b[w], b.nose) / T : null));
    const ext = series((b) => (b[w].v >= 0.3 ? dist(b[w], b[s]) / T : null));
    const oscX = oscillation(xs), oscY = oscillation(ys);
    let travel = 0;
    for (let i = 1; i < xs.length; i++) travel += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    return {
      meanX: mean(xs), meanY: mean(ys), distNose: median(nose), extension: median(ext),
      aboveHead: ys.length ? ys.filter((y) => y < -1.55).length / ys.length : 0,
      oscX, oscY, circ: circularity(oscX, oscY), travel: duration > 0 ? travel / duration : 0,
    };
  };
  const L = hand('l'), R = hand('r');
  const domSide = R.travel >= L.travel ? 'right' : 'left';
  const lwY = series((b) => rel(b, 'lWrist', 'y')), rwY = series((b) => rel(b, 'rWrist', 'y'));
  const lwX = series((b) => rel(b, 'lWrist', 'x')), rwX = series((b) => rel(b, 'rWrist', 'x'));
  const wd = series((b) => (b.lWrist.v >= 0.3 && b.rWrist.v >= 0.3 ? dist(b.lWrist, b.rWrist) / T : null));
  const eL = series((b) => jointAngle(b.lShoulder, b.lElbow, b.lWrist)), eR = series((b) => jointAngle(b.rShoulder, b.rElbow, b.rWrist));
  const tilt = series((b) => (Math.atan2(b.rShoulder.y - b.lShoulder.y, b.rShoulder.x - b.lShoulder.x) * 180) / Math.PI);
  const torsoTilt = series((b) => (Math.atan2(b.shoulderMid.x - b.hipMid.x, b.hipMid.y - b.shoulderMid.y) * 180) / Math.PI);
  const torsoApp = series((b) => torsoLength(b) / T);
  const sw = series((b) => dist(b.lShoulder, b.rShoulder) / T);
  const head = series((b) => (b.nose.v >= 0.3 ? (b.nose.x - b.shoulderMid.x) / Math.max(1e-6, dist(b.lShoulder, b.rShoulder)) : null));
  const laY = series((b) => rel(b, 'lAnkle', 'y')), raY = series((b) => rel(b, 'rAnkle', 'y'));
  const ad = series((b) => (b.lAnkle.v >= 0.3 && b.rAnkle.v >= 0.3 ? dist(b.lAnkle, b.rAnkle) / T : null));
  const anklesSeen = laY.length > SAMPLE_HZ && raY.length > SAMPLE_HZ;

  return {
    duration, frames: seq.length, trackedRatio,
    L, R, dom: domSide === 'right' ? R : L, other: domSide === 'right' ? L : R, domSide,
    // corrY: +1 both hands rise together, −1 alternate. corrX: +1 hands open/close symmetrically, −1 both move the same way.
    corrY: correlation(lwY, rwY), corrX: correlation(lwX.map((x) => -x), rwX),
    wristDist: { mean: mean(wd), min: percentile(wd, 0.1), osc: oscillation(wd) },
    elbow: { L: oscillation(eL), R: oscillation(eR), corr: correlation(eL, eR) },
    hipX: oscillation(series((b) => (b.hipMid.x - hipX0) / T)),
    hipY: oscillation(series((b) => (b.hipMid.y - hipY0) / T)),
    shoulderTilt: oscillation(tilt),
    torsoTilt: { mean: mean(torsoTilt.map(Math.abs)), osc: oscillation(torsoTilt) },
    torsoApparent: { min: percentile(torsoApp, 0.1), osc: oscillation(torsoApp) },
    shoulderWidth: oscillation(sw),
    headTurn: oscillation(head),
    ankles: anklesSeen
      ? { corrY: correlation(laY, raY), L: oscillation(laY), R: oscillation(raY), dist: oscillation(ad) }
      : { corrY: 0, L: { amp: 0, periodicity: 0, freq: 0 }, R: { amp: 0, periodicity: 0, freq: 0 }, dist: { amp: 0, periodicity: 0, freq: 0 } },
  };
}
