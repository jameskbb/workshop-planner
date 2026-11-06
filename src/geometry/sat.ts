import { convexHull, isConvex, type Polygon } from './polygon';
import { areaOfMulti, intersect } from './clip';
import { dot, EPS, normalize, scale, sub, type Point } from './vec';
import { centroid } from './polygon';

export interface CollisionResult {
  colliding: boolean;
  /**
   * Minimum translation distance (mm) that separates the shapes; 0 when not colliding.
   * For convex shapes this is the exact SAT penetration depth.
   */
  depth: number;
  /** Unit direction to move B (relative to A) to separate them. Zero vector when not colliding. */
  normal: Point;
  /** Overlap area in mm² (exact via polygon clipping). */
  overlapArea: number;
}

const NONE: CollisionResult = { colliding: false, depth: 0, normal: { x: 0, y: 0 }, overlapArea: 0 };

function project(poly: Polygon, axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = dot(p, axis);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

function axesOf(poly: Polygon): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const e = sub(poly[(i + 1) % poly.length]!, poly[i]!);
    const n = normalize({ x: -e.y, y: e.x });
    if (n.x === 0 && n.y === 0) continue;
    out.push(n);
  }
  return out;
}

/**
 * Separating Axis Theorem for two CONVEX polygons.
 * Touching (zero-depth contact within `tolerance`) is not a collision.
 */
export function satConvex(a: Polygon, b: Polygon, tolerance = 1e-6): { colliding: boolean; depth: number; normal: Point } {
  if (a.length < 3 || b.length < 3) return { colliding: false, depth: 0, normal: { x: 0, y: 0 } };
  let minOverlap = Infinity;
  let bestAxis: Point = { x: 0, y: 0 };
  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const [aMin, aMax] = project(a, axis);
    const [bMin, bMax] = project(b, axis);
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap <= tolerance) return { colliding: false, depth: 0, normal: { x: 0, y: 0 } };
    // For containment, the MTV must push fully out on the shorter side.
    const pushPos = aMax - bMin; // move B in +axis
    const pushNeg = bMax - aMin; // move B in −axis
    const depth = Math.min(pushPos, pushNeg);
    if (depth < minOverlap) {
      minOverlap = depth;
      bestAxis = pushPos < pushNeg ? axis : scale(axis, -1);
    }
  }
  return { colliding: true, depth: minOverlap, normal: bestAxis };
}

/** Width of a convex polygon along its narrowest direction (rotating-calipers over edge normals). */
export function minimumWidth(poly: Polygon): number {
  const hull = convexHull(poly);
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (const axis of axesOf(hull)) {
    const [lo, hi] = project(hull, axis);
    best = Math.min(best, hi - lo);
  }
  return best;
}

/**
 * Collision between two arbitrary simple polygons (concave OK).
 * Convex pairs use exact SAT depth; otherwise depth is the minimum width of the overlap region,
 * a stable, explainable approximation ("how far does it intrude").
 */
export function polygonCollision(a: Polygon, b: Polygon, tolerance = 1e-6): CollisionResult {
  if (a.length < 3 || b.length < 3) return NONE;
  const inter = intersect(a, b);
  const overlapArea = areaOfMulti(inter);
  if (overlapArea <= tolerance) return NONE;
  if (isConvex(a) && isConvex(b)) {
    const s = satConvex(a, b, tolerance);
    if (!s.colliding) return { ...NONE, overlapArea };
    return { colliding: true, depth: s.depth, normal: s.normal, overlapArea };
  }
  let depth = 0;
  for (const piece of inter) depth = Math.max(depth, minimumWidth(piece.outer));
  const ca = centroid(a);
  const cb = centroid(b);
  const dir = sub(cb, ca);
  const normal = Math.hypot(dir.x, dir.y) < EPS ? { x: 1, y: 0 } : normalize(dir);
  return { colliding: true, depth, normal, overlapArea };
}
