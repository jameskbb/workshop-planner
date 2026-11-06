import {
  closestPointOnSegment,
  lineIntersection,
  orient,
  segmentIntersection,
  segmentSegmentDistance,
  segmentsIntersect,
  type Segment,
} from './segment';
import { add, cross, distance, EPS, normalize, pointsEqual, rotateAround, scale, sub, type Point } from './vec';

/** A simple polygon ring: vertices in order, NOT closed (first vertex is not repeated). */
export type Polygon = Point[];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Shoelace signed area. Positive = counter-clockwise in math orientation, which appears
 * CLOCKWISE on screen because +y points down. Use {@link area} for the magnitude.
 */
export function signedArea(poly: Polygon): number {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly: Polygon): number => Math.abs(signedArea(poly));

/** +1 if the ring has positive signed area, -1 if negative, 0 if degenerate. */
export function orientation(poly: Polygon): -1 | 0 | 1 {
  const a = signedArea(poly);
  if (a > EPS) return 1;
  if (a < -EPS) return -1;
  return 0;
}

/** Return the ring with positive signed area (reversing if needed). */
export function withPositiveOrientation(poly: Polygon): Polygon {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

/** Area-weighted centroid (falls back to vertex average for degenerate rings). */
export function centroid(poly: Polygon): Point {
  const n = poly.length;
  if (n === 0) return { x: 0, y: 0 };
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    let x = 0;
    let y = 0;
    for (const p of poly) {
      x += p.x;
      y += p.y;
    }
    return { x: x / n, y: y / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function perimeter(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += distance(poly[i]!, poly[(i + 1) % poly.length]!);
  return s;
}

export function edges(poly: Polygon): Segment[] {
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length]! }));
}

// ───────────────────────────── bounding boxes ─────────────────────────────

export const EMPTY_BBOX: BBox = Object.freeze({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function bbox(points: readonly Point[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxUnion(...boxes: BBox[]): BBox {
  return boxes.reduce(
    (acc, b) => ({
      minX: Math.min(acc.minX, b.minX),
      minY: Math.min(acc.minY, b.minY),
      maxX: Math.max(acc.maxX, b.maxX),
      maxY: Math.max(acc.maxY, b.maxY),
    }),
    EMPTY_BBOX,
  );
}

export const bboxIsEmpty = (b: BBox): boolean => !(b.maxX >= b.minX && b.maxY >= b.minY);
export const bboxWidth = (b: BBox): number => b.maxX - b.minX;
export const bboxHeight = (b: BBox): number => b.maxY - b.minY;
export const bboxCenter = (b: BBox): Point => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

export function bboxIntersects(a: BBox, b: BBox, eps = 0): boolean {
  return a.minX <= b.maxX + eps && b.minX <= a.maxX + eps && a.minY <= b.maxY + eps && b.minY <= a.maxY + eps;
}

export function bboxContainsPoint(b: BBox, p: Point, eps = 0): boolean {
  return p.x >= b.minX - eps && p.x <= b.maxX + eps && p.y >= b.minY - eps && p.y <= b.maxY + eps;
}

export function expandBBox(b: BBox, margin: number): BBox {
  return { minX: b.minX - margin, minY: b.minY - margin, maxX: b.maxX + margin, maxY: b.maxY + margin };
}

export function bboxToPolygon(b: BBox): Polygon {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
}

/** Axis-aligned rectangle polygon from origin + size. */
export function rectPolygon(x: number, y: number, w: number, h: number): Polygon {
  return bboxToPolygon({ minX: x, minY: y, maxX: x + w, maxY: y + h });
}

// ───────────────────────────── containment ─────────────────────────────

export type PointLocation = 'inside' | 'outside' | 'boundary';

/** Classify a point against a simple polygon (winding-independent). */
export function locatePoint(poly: Polygon, p: Point, eps = 1e-6): PointLocation {
  const n = poly.length;
  if (n < 3) return 'outside';
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (closestPointOnSegment(p, a, b).distance <= eps) return 'boundary';
    if (a.y > p.y !== b.y > p.y) {
      const xCross = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < xCross) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

/** True if p is inside or on the boundary. */
export function containsPoint(poly: Polygon, p: Point, eps = 1e-6): boolean {
  return locatePoint(poly, p, eps) !== 'outside';
}

/** True if p is strictly inside (not on the boundary). */
export function strictlyContainsPoint(poly: Polygon, p: Point, eps = 1e-6): boolean {
  return locatePoint(poly, p, eps) === 'inside';
}

/**
 * True when `inner` lies entirely within `outer` (touching the boundary is allowed).
 * Works for concave outer polygons: checks vertices, proper edge crossings, and edge midpoints.
 */
export function polygonContainsPolygon(outer: Polygon, inner: Polygon, eps = 1e-6): boolean {
  if (outer.length < 3 || inner.length < 1) return false;
  for (const p of inner) if (!containsPoint(outer, p, eps)) return false;
  // Any proper crossing means part of inner is outside.
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]!;
    const b = inner[(i + 1) % inner.length]!;
    for (let j = 0; j < outer.length; j++) {
      const c = outer[j]!;
      const d = outer[(j + 1) % outer.length]!;
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      const interiorToBoth = hit.t > 1e-9 && hit.t < 1 - 1e-9 && hit.u > 1e-9 && hit.u < 1 - 1e-9;
      if (interiorToBoth && orient(c, d, a) !== 0 && orient(c, d, b) !== 0) return false;
    }
    // A chord between two boundary points of a concave polygon may leave it; test the midpoint.
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!containsPoint(outer, mid, eps)) return false;
  }
  return true;
}

// ───────────────────────────── simplicity ─────────────────────────────

export interface SelfIntersection {
  edgeA: number;
  edgeB: number;
  point: Point;
}

/**
 * All intersections between non-adjacent edges (plus overlapping adjacent edges that fold back).
 * An empty result means the ring is simple.
 */
export function findSelfIntersections(poly: Polygon): SelfIntersection[] {
  const n = poly.length;
  const out: SelfIntersection[] = [];
  if (n < 4) {
    // A triangle can only be non-simple if degenerate (collinear).
    if (n === 3 && Math.abs(signedArea(poly)) < EPS) out.push({ edgeA: 0, edgeB: 1, point: poly[1]! });
    return out;
  }
  for (let i = 0; i < n; i++) {
    const a1 = poly[i]!;
    const a2 = poly[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const b1 = poly[j]!;
      const b2 = poly[(j + 1) % n]!;
      if (adjacent) {
        // Adjacent edges share a vertex; they are only a problem when they fold back over each other.
        const shared = j === i + 1 ? a2 : a1;
        const other1 = j === i + 1 ? a1 : a2;
        const other2 = j === i + 1 ? b2 : b1;
        if (orient(other1, shared, other2) === 0) {
          const d1 = sub(other1, shared);
          const d2 = sub(other2, shared);
          if (d1.x * d2.x + d1.y * d2.y > EPS) out.push({ edgeA: i, edgeB: j, point: shared });
        }
        continue;
      }
      if (segmentsIntersect(a1, a2, b1, b2)) {
        const hit = segmentIntersection(a1, a2, b1, b2);
        out.push({ edgeA: i, edgeB: j, point: hit ? hit.point : a1 });
      }
    }
  }
  return out;
}

export const isSimplePolygon = (poly: Polygon): boolean =>
  poly.length >= 3 && Math.abs(signedArea(poly)) > EPS && findSelfIntersections(poly).length === 0;

export function isConvex(poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const o = orient(poly[i]!, poly[(i + 1) % n]!, poly[(i + 2) % n]!);
    if (o === 0) continue;
    if (sign === 0) sign = o;
    else if (o !== sign) return false;
  }
  return sign !== 0;
}

/** Andrew's monotone chain. Returns hull with positive orientation, no collinear points. */
export function convexHull(points: readonly Point[]): Polygon {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1]!, lower[lower.length - 2]!), sub(p, lower[lower.length - 2]!)) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1]!, upper[upper.length - 2]!), sub(p, upper[upper.length - 2]!)) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Drop consecutive duplicate vertices and collinear middle vertices. */
export function cleanPolygon(poly: Polygon, eps = 1e-6): Polygon {
  let pts = poly.filter((p, i) => !pointsEqual(p, poly[(i + 1) % poly.length]!, eps) || poly.length === 1);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      if (orient(prev, cur, next, eps) === 0) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

// ───────────────────────────── transforms ─────────────────────────────

export const translatePolygon = (poly: Polygon, d: Point): Polygon => poly.map((p) => add(p, d));

export const rotatePolygon = (poly: Polygon, degrees: number, center: Point): Polygon =>
  poly.map((p) => rotateAround(p, center, degrees));

// ───────────────────────────── distances ─────────────────────────────

/** Distance from p to the polygon's boundary (0 on the boundary). */
export function distanceToBoundary(poly: Polygon, p: Point): { distance: number; point: Point; edge: number } {
  let best = { distance: Infinity, point: p, edge: -1 };
  for (let i = 0; i < poly.length; i++) {
    const c = closestPointOnSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    if (c.distance < best.distance) best = { distance: c.distance, point: c.point, edge: i };
  }
  return best;
}

/** Minimum distance between two polygons' boundaries; 0 if they overlap or touch. */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (polygonsOverlapOrTouch(a, b)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const d = segmentSegmentDistance(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!);
      if (d < best) best = d;
    }
  }
  return best;
}

/** True if the polygons share any point (general simple polygons, concave OK). */
export function polygonsOverlapOrTouch(a: Polygon, b: Polygon): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (!bboxIntersects(bbox(a), bbox(b), 1e-9)) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return containsPoint(a, b[0]!) || containsPoint(b, a[0]!);
}

// ───────────────────────────── offsetting ─────────────────────────────

/** Outward unit normal of edge i (from vertex i to i+1), independent of ring orientation. */
export function edgeOutwardNormal(poly: Polygon, i: number): Point {
  const a = poly[i]!;
  const b = poly[(i + 1) % poly.length]!;
  const d = normalize(sub(b, a));
  // Positive orientation ⇒ interior on the left (−dy, dx) ⇒ outward is (dy, −dx).
  return orientation(poly) >= 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
}

export interface OffsetOptions {
  /** Miter length limit as a multiple of the offset distance; beyond it the corner is beveled. Default 4. */
  miterLimit?: number;
}

/**
 * Offset a simple polygon outward (positive distances) or inward (negative), using mitered joins.
 * `distance` may be a single number or one per edge (edge i runs from vertex i to i+1), which
 * is how a room's interior outline is grown by per-wall thickness into its exterior outline.
 *
 * Returns a polygon with the same orientation as the input. Beveled corners add a vertex.
 */
export function offsetPolygon(poly: Polygon, amount: number | number[], options: OffsetOptions = {}): Polygon {
  const n = poly.length;
  if (n < 3) return [...poly];
  const miterLimit = options.miterLimit ?? 4;
  const d = (i: number): number => (typeof amount === 'number' ? amount : (amount[((i % n) + n) % n] ?? 0));
  const normals = poly.map((_, i) => edgeOutwardNormal(poly, i));
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n]!;
    const off = scale(normals[i]!, d(i));
    return { a: add(a, off), b: add(b, off) };
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n]!;
    const cur = lines[i]!;
    const v = poly[i]!;
    const hit = lineIntersection(prev.a, prev.b, cur.a, cur.b);
    const maxD = Math.max(Math.abs(d(i - 1)), Math.abs(d(i)));
    if (!hit) {
      // Parallel consecutive edges (collinear vertex): average the offsets.
      out.push(add(v, scale(normalize(add(normals[(i - 1 + n) % n]!, normals[i]!)), maxD)));
      continue;
    }
    if (maxD > 0 && distance(hit, v) > miterLimit * maxD) {
      out.push(prev.b, cur.a); // bevel
    } else {
      out.push(hit);
    }
  }
  return out;
}
