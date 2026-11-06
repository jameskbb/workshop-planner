/**
 * Ray casting and closest-point queries between shapes (pure). Used by clearance measurements
 * ("how much room is in front of the planer?"), live gap labels while dragging, and
 * object↔object / wall↔object measurements.
 */
import type { Polygon } from './polygon';
import { containsPoint } from './polygon';
import { closestPointsBetweenSegments, segmentsIntersect } from './segment';
import { add, cross, distance, scale, sub, type Point } from './vec';

export interface RayHit {
  /** Distance along the (unit) ray. */
  t: number;
  point: Point;
  /** Index of the segment that was hit. */
  segment: number;
}

/** First intersection of a ray (origin + t·dir, t > minT) with any segment. `dir` should be a unit vector. */
export function rayCast(origin: Point, dir: Point, segments: ReadonlyArray<readonly [Point, Point]>, minT = 1e-6): RayHit | null {
  let best: RayHit | null = null;
  segments.forEach(([a, b], i) => {
    const s = sub(b, a);
    const denom = cross(dir, s);
    if (Math.abs(denom) < 1e-12) return;
    const ao = sub(a, origin);
    const t = cross(ao, s) / denom;
    const u = cross(ao, dir) / denom;
    if (t > minT && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t)) best = { t, point: add(origin, scale(dir, t)), segment: i };
  });
  return best;
}

/** Edges of a polygon as segments. */
export function polygonSegments(poly: Polygon): Array<[Point, Point]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Point, Point]);
}

export interface ClosestPair {
  onA: Point;
  onB: Point;
  distance: number;
  /** True when the shapes overlap (distance 0). */
  overlapping: boolean;
}

/** Closest points between two polygons (0 if they overlap or touch). */
export function closestPointsBetweenPolygons(a: Polygon, b: Polygon): ClosestPair {
  const ea = polygonSegments(a);
  const eb = polygonSegments(b);
  for (const [p1, p2] of ea) for (const [q1, q2] of eb) if (segmentsIntersect(p1, p2, q1, q2)) return { onA: p1, onB: p1, distance: 0, overlapping: true };
  if (a.length && containsPoint(b, a[0]!)) return { onA: a[0]!, onB: a[0]!, distance: 0, overlapping: true };
  if (b.length && containsPoint(a, b[0]!)) return { onA: b[0]!, onB: b[0]!, distance: 0, overlapping: true };
  let best: ClosestPair | null = null;
  for (const [p1, p2] of ea) {
    for (const [q1, q2] of eb) {
      const c = closestPointsBetweenSegments(p1, p2, q1, q2);
      if (!best || c.distance < best.distance) best = { onA: c.onP, onB: c.onQ, distance: c.distance, overlapping: false };
    }
  }
  return best ?? { onA: { x: 0, y: 0 }, onB: { x: 0, y: 0 }, distance: 0, overlapping: false };
}

/** Closest points between a segment and a polygon. */
export function closestPointsSegmentPolygon(s0: Point, s1: Point, poly: Polygon): ClosestPair {
  let best: ClosestPair | null = null;
  for (const [q1, q2] of polygonSegments(poly)) {
    const c = closestPointsBetweenSegments(s0, s1, q1, q2);
    if (!best || c.distance < best.distance) best = { onA: c.onP, onB: c.onQ, distance: c.distance, overlapping: c.distance === 0 };
  }
  return best ?? { onA: s0, onB: s0, distance: distance(s0, s1), overlapping: false };
}

export interface FaceClearance {
  /** Minimum clear distance measured perpendicular to the face (Infinity if nothing is hit). */
  distance: number;
  from: Point;
  to: Point;
}

/**
 * Clear distance in front of a face: casts `samples` parallel rays from points spread along the
 * face (a → b) in direction `normal` and returns the shortest hit. Obstacles are segments
 * (walls, other footprints' edges).
 */
export function faceClearance(a: Point, b: Point, normal: Point, obstacles: ReadonlyArray<readonly [Point, Point]>, samples = 9): FaceClearance {
  let best: FaceClearance = { distance: Infinity, from: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, to: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  for (let k = 0; k < samples; k++) {
    // Keep samples slightly inside the face ends so rays grazing a touching neighbor don't count as 0.
    const t = samples === 1 ? 0.5 : 0.02 + (0.96 * k) / (samples - 1);
    const o = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const hit = rayCast(o, normal, obstacles);
    if (hit && hit.t < best.distance) best = { distance: hit.t, from: o, to: hit.point };
  }
  return best;
}
