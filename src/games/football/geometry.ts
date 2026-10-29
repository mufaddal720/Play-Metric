export interface P { x: number; y: number }

/** Signed side of point p relative to the directed line a→b (positive / negative / ~0). */
export const side = (a: P, b: P, p: P) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** Intersection of segment p→q with the infinite line a→b, as the parameter u along a→b (0 = a, 1 = b). */
export function crossingParam(a: P, b: P, p: P, q: P): number | null {
  // Solve p + t·r = a + u·s for u, with r = q − p and s = b − a.
  const r = { x: q.x - p.x, y: q.y - p.y }, s = { x: b.x - a.x, y: b.y - a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  return ((a.x - p.x) * r.y - (a.y - p.y) * r.x) / den;
}

export function pointInPolygon(pt: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const distance = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to segment a–b. */
export function distToSegment(p: P, a: P, b: P): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
