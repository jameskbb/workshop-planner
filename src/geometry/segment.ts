import { add, clamp, cross, distance, dot, EPS, lengthSq, lerp, scale, sub, type Point } from './vec';

export interface Segment {
  a: Point;
  b: Point;
}

export const segmentLength = (s: Segment): number => distance(s.a, s.b);

/** Parameter t ∈ ℝ of the orthogonal projection of p onto the infinite line through a→b. */
export function projectParam(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l2 = lengthSq(ab);
  if (l2 < EPS) return 0;
  return dot(sub(p, a), ab) / l2;
}

export interface ClosestPoint {
  point: Point;
  /** Clamped parameter along the segment in [0, 1]. */
  t: number;
  distance: number;
}

/** Nearest point on segment a–b to p. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): ClosestPoint {
  const t = clamp(projectParam(p, a, b), 0, 1);
  const point = lerp(a, b, t);
  return { point, t, distance: distance(p, point) };
}

export const pointSegmentDistance = (p: Point, a: Point, b: Point): number => closestPointOnSegment(p, a, b).distance;

/**
 * Signed perpendicular distance from p to the infinite line a→b.
 * Positive when p is on the LEFT of a→b in math orientation (cross(ab, ap) > 0).
 */
export function signedLineDistance(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const l = Math.sqrt(lengthSq(ab));
  if (l < EPS) return distance(p, a);
  return cross(ab, sub(p, a)) / l;
}

/** Orientation of triplet (a, b, c): 1 = left turn (ccw math), -1 = right turn, 0 = collinear. */
export function orient(a: Point, b: Point, c: Point, eps = EPS): -1 | 0 | 1 {
  const v = cross(sub(b, a), sub(c, a));
  if (v > eps) return 1;
  if (v < -eps) return -1;
  return 0;
}

function onSegment(p: Point, a: Point, b: Point, eps = EPS): boolean {
  return (
    Math.min(a.x, b.x) - eps <= p.x &&
    p.x <= Math.max(a.x, b.x) + eps &&
    Math.min(a.y, b.y) - eps <= p.y &&
    p.y <= Math.max(a.y, b.y) + eps
  );
}

/** True when closed segments p1–p2 and q1–q2 share at least one point. */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point, eps = EPS): boolean {
  const o1 = orient(p1, p2, q1, eps);
  const o2 = orient(p1, p2, q2, eps);
  const o3 = orient(q1, q2, p1, eps);
  const o4 = orient(q1, q2, p2, eps);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(q1, p1, p2, eps)) return true;
  if (o2 === 0 && onSegment(q2, p1, p2, eps)) return true;
  if (o3 === 0 && onSegment(p1, q1, q2, eps)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2, eps)) return true;
  return false;
}

/**
 * Proper intersection point of two segments (null if parallel or non-intersecting).
 * Returns the params along each segment too.
 */
export function segmentIntersection(
  p1: Point,
  p2: Point,
  q1: Point,
  q2: Point,
): { point: Point; t: number; u: number } | null {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const qp = sub(q1, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { point: add(p1, scale(r, t)), t, u };
}

/** Intersection of two infinite lines (null if parallel). */
export function lineIntersection(p1: Point, p2: Point, q1: Point, q2: Point): Point | null {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(q1, p1), s) / denom;
  return add(p1, scale(r, t));
}

/** Minimum distance between two segments. */
export function segmentSegmentDistance(p1: Point, p2: Point, q1: Point, q2: Point): number {
  if (segmentsIntersect(p1, p2, q1, q2)) return 0;
  return Math.min(
    pointSegmentDistance(p1, q1, q2),
    pointSegmentDistance(p2, q1, q2),
    pointSegmentDistance(q1, p1, p2),
    pointSegmentDistance(q2, p1, p2),
  );
}

/** Closest pair of points between two segments. */
export function closestPointsBetweenSegments(
  p1: Point,
  p2: Point,
  q1: Point,
  q2: Point,
): { onP: Point; onQ: Point; distance: number } {
  const hit = segmentIntersection(p1, p2, q1, q2);
  if (hit) return { onP: hit.point, onQ: hit.point, distance: 0 };
  const candidates = [
    { onP: p1, onQ: closestPointOnSegment(p1, q1, q2).point },
    { onP: p2, onQ: closestPointOnSegment(p2, q1, q2).point },
    { onP: closestPointOnSegment(q1, p1, p2).point, onQ: q1 },
    { onP: closestPointOnSegment(q2, p1, p2).point, onQ: q2 },
  ];
  let best = { ...candidates[0]!, distance: distance(candidates[0]!.onP, candidates[0]!.onQ) };
  for (const c of candidates.slice(1)) {
    const d = distance(c.onP, c.onQ);
    if (d < best.distance) best = { ...c, distance: d };
  }
  return best;
}

/** Merge overlapping [start, end] intervals (sorted output). */
export function mergeIntervals(intervals: Array<[number, number]>, eps = EPS): Array<[number, number]> {
  const sorted = intervals
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] + eps) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Complement of merged intervals within [lo, hi]. */
export function subtractIntervals(
  lo: number,
  hi: number,
  occupied: Array<[number, number]>,
  eps = EPS,
): Array<[number, number]> {
  const merged = mergeIntervals(
    occupied.map(([a, b]) => [clamp(a, lo, hi), clamp(b, lo, hi)] as [number, number]),
    eps,
  );
  const free: Array<[number, number]> = [];
  let cursor = lo;
  for (const [a, b] of merged) {
    if (a > cursor + eps) free.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (hi > cursor + eps) free.push([cursor, hi]);
  return free;
}
