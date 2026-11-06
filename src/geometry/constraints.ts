/**
 * CAD-style wall constraint solver for a closed room outline (pure).
 *
 * The room is a closed polygon; wall i runs from point i to point (i + 1) % n. Each wall may carry
 * constraints: horizontal, vertical, a target length, a target direction (angle), or parallel /
 * perpendicular to another wall. The solver is an iterative Gauss–Seidel projection
 * ("position-based dynamics"): every pass nudges the free endpoints of each violated constraint
 * toward satisfying it. Pinned points never move (e.g. the vertex being dragged).
 *
 * Starting from the proposed outline, the projection converges to a nearby solution, so editing one
 * corner of a constrained rectangle moves only what the constraints demand. Callers that want a
 * minimal-change result try several pin sets (see `solveWithTiers`).
 */
import { angleDiff, angleOf, distance, rotateAround, type Point } from './vec';

export interface WallConstraintSpec {
  horizontal?: boolean;
  vertical?: boolean;
  /** Target length (mm). */
  length?: number;
  /** Target direction of a → b in degrees (angleOf convention: 0 = east, 90 = south). */
  angle?: number;
  /** Index of the wall this one must be parallel to. */
  parallelTo?: number;
  /** Index of the wall this one must be perpendicular to. */
  perpendicularTo?: number;
}

export type ConstraintKind = 'horizontal' | 'vertical' | 'length' | 'angle' | 'parallel' | 'perpendicular';

export interface ConstraintViolation {
  wall: number;
  kind: ConstraintKind;
  /** Residual: mm for position/length constraints, degrees for angular ones. */
  error: number;
  /** The other wall for parallel / perpendicular. */
  other?: number;
}

export interface SolveOptions {
  /** Point indices that must not move. */
  pinned?: ReadonlySet<number>;
  /** Length tolerance (mm). Default 0.05. */
  tolerance?: number;
  /** Angular tolerance (degrees). Default 0.005. */
  angleTolerance?: number;
  maxIterations?: number;
}

export interface SolveResult {
  ok: boolean;
  points: Point[];
  violations: ConstraintViolation[];
  iterations: number;
}

const wrap180 = (d: number): number => angleDiff(0, d);
/** Map an angle difference to (-90, 90] (parallel in either direction). */
function wrap90(d: number): number {
  let x = wrap180(d);
  if (x > 90) x -= 180;
  if (x <= -90) x += 180;
  return x;
}

/** True if a wall's direction is fixed by its own constraints (so relational constraints rotate the other wall). */
function directionFixed(c: WallConstraintSpec | undefined): boolean {
  return !!c && (c.horizontal === true || c.vertical === true || c.angle !== undefined);
}

/** Residuals of every constraint on the outline. */
export function checkConstraints(
  points: readonly Point[],
  constraints: ReadonlyArray<WallConstraintSpec | undefined>,
  opts: { tolerance?: number; angleTolerance?: number } = {},
): ConstraintViolation[] {
  const tol = opts.tolerance ?? 0.05;
  const atol = opts.angleTolerance ?? 0.005;
  const n = points.length;
  const out: ConstraintViolation[] = [];
  const dirOf = (i: number) => {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    return angleOf({ x: b.x - a.x, y: b.y - a.y });
  };
  for (let i = 0; i < n && i < constraints.length; i++) {
    const c = constraints[i];
    if (!c) continue;
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (c.horizontal && Math.abs(b.y - a.y) > tol) out.push({ wall: i, kind: 'horizontal', error: Math.abs(b.y - a.y) });
    if (c.vertical && Math.abs(b.x - a.x) > tol) out.push({ wall: i, kind: 'vertical', error: Math.abs(b.x - a.x) });
    if (c.length !== undefined && Math.abs(distance(a, b) - c.length) > tol) out.push({ wall: i, kind: 'length', error: Math.abs(distance(a, b) - c.length) });
    if (c.angle !== undefined) {
      const e = Math.abs(wrap180(dirOf(i) - c.angle));
      if (e > atol) out.push({ wall: i, kind: 'angle', error: e });
    }
    if (c.parallelTo !== undefined && c.parallelTo !== i && c.parallelTo < n) {
      const e = Math.abs(wrap90(dirOf(i) - dirOf(c.parallelTo)));
      if (e > atol) out.push({ wall: i, kind: 'parallel', error: e, other: c.parallelTo });
    }
    if (c.perpendicularTo !== undefined && c.perpendicularTo !== i && c.perpendicularTo < n) {
      const e = Math.abs(wrap90(dirOf(i) - dirOf(c.perpendicularTo) - 90));
      if (e > atol) out.push({ wall: i, kind: 'perpendicular', error: e, other: c.perpendicularTo });
    }
  }
  return out;
}

/** True if any constraint is set at all (lets callers skip solving). */
export function hasConstraints(constraints: ReadonlyArray<WallConstraintSpec | undefined>): boolean {
  return constraints.some(
    (c) =>
      !!c &&
      (c.horizontal || c.vertical || c.length !== undefined || c.angle !== undefined || c.parallelTo !== undefined || c.perpendicularTo !== undefined),
  );
}

/**
 * Solve the constraints starting from `points`. Returns the adjusted outline; `ok` is false when the
 * constraints cannot all be met with the given pins (violations list what is left).
 */
export function solveConstraints(
  points: readonly Point[],
  constraints: ReadonlyArray<WallConstraintSpec | undefined>,
  opts: SolveOptions = {},
): SolveResult {
  const n = points.length;
  const p = points.map((q) => ({ x: q.x, y: q.y }));
  const pinned = opts.pinned ?? new Set<number>();
  const tol = opts.tolerance ?? 0.05;
  const atol = opts.angleTolerance ?? 0.005;
  const maxIt = opts.maxIterations ?? 800;
  if (n < 3 || !hasConstraints(constraints)) return { ok: true, points: p, violations: [], iterations: 0 };

  const w = (i: number) => (pinned.has(i) ? 0 : 1);
  const next = (i: number) => (i + 1) % n;

  /** Rotate wall i by `deg` about its pinned endpoint (or its midpoint). Returns false if immovable. */
  const rotateWall = (i: number, deg: number): boolean => {
    const ia = i;
    const ib = next(i);
    const pa = pinned.has(ia);
    const pb = pinned.has(ib);
    if (pa && pb) return false;
    const a = p[ia]!;
    const b = p[ib]!;
    const pivot = pa ? a : pb ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pa) p[ia] = rotateAround(a, pivot, deg);
    if (!pb) p[ib] = rotateAround(b, pivot, deg);
    return true;
  };
  const canRotate = (i: number) => !(pinned.has(i) && pinned.has(next(i)));
  const dirOf = (i: number) => {
    const a = p[i]!;
    const b = p[next(i)]!;
    return angleOf({ x: b.x - a.x, y: b.y - a.y });
  };

  /** Relative constraint: bring wall j's direction to (wall i's direction + offset) mod 180. */
  const relate = (i: number, j: number, offset: number) => {
    const delta = wrap90(dirOf(j) - dirOf(i) - offset);
    if (Math.abs(delta) <= atol / 4) return;
    const fixI = directionFixed(constraints[i]) || !canRotate(i);
    const fixJ = directionFixed(constraints[j]) || !canRotate(j);
    if (fixI && fixJ) {
      // Both look fixed; still try to rotate whichever can physically move (lets the solver report).
      if (canRotate(j)) rotateWall(j, -delta);
      else if (canRotate(i)) rotateWall(i, delta);
      return;
    }
    if (fixI) rotateWall(j, -delta);
    else if (fixJ) rotateWall(i, delta);
    else {
      rotateWall(i, delta / 2);
      rotateWall(j, -delta / 2);
    }
  };

  let iterations = 0;
  for (; iterations < maxIt; iterations++) {
    for (let i = 0; i < n && i < constraints.length; i++) {
      const c = constraints[i];
      if (!c) continue;
      const ia = i;
      const ib = next(i);
      const wa = w(ia);
      const wb = w(ib);
      const ws = wa + wb;
      if (c.horizontal && ws > 0) {
        const e = p[ib]!.y - p[ia]!.y;
        p[ia] = { x: p[ia]!.x, y: p[ia]!.y + (e * wa) / ws };
        p[ib] = { x: p[ib]!.x, y: p[ib]!.y - (e * wb) / ws };
      }
      if (c.vertical && ws > 0) {
        const e = p[ib]!.x - p[ia]!.x;
        p[ia] = { x: p[ia]!.x + (e * wa) / ws, y: p[ia]!.y };
        p[ib] = { x: p[ib]!.x - (e * wb) / ws, y: p[ib]!.y };
      }
      if (c.angle !== undefined && ws > 0) {
        const delta = wrap180(c.angle - dirOf(i));
        if (Math.abs(delta) > atol / 4) rotateWall(i, delta);
      }
      if (c.length !== undefined && ws > 0) {
        const a = p[ia]!;
        const b = p[ib]!;
        const L = distance(a, b);
        if (L > 1e-9) {
          const diff = L - c.length;
          const ux = (b.x - a.x) / L;
          const uy = (b.y - a.y) / L;
          p[ia] = { x: a.x + (ux * diff * wa) / ws, y: a.y + (uy * diff * wa) / ws };
          p[ib] = { x: b.x - (ux * diff * wb) / ws, y: b.y - (uy * diff * wb) / ws };
        }
      }
      if (c.parallelTo !== undefined && c.parallelTo !== i && c.parallelTo < n) relate(c.parallelTo, i, 0);
      if (c.perpendicularTo !== undefined && c.perpendicularTo !== i && c.perpendicularTo < n) relate(c.perpendicularTo, i, 90);
    }
    if (checkConstraints(p, constraints, { tolerance: tol, angleTolerance: atol }).length === 0) break;
  }
  const violations = checkConstraints(p, constraints, { tolerance: tol, angleTolerance: atol });
  return { ok: violations.length === 0, points: p, violations, iterations };
}

/**
 * Solve trying progressively looser pin sets: each tier adds extra "prefer fixed" points to the
 * mandatory pins. The first tier that satisfies every constraint wins (smallest disturbance first).
 * Returns the best failing result (fewest violations) if no tier works. Pass an empty set as the
 * last tier to allow everything that is not pinned to move.
 */
export function solveWithTiers(
  points: readonly Point[],
  constraints: ReadonlyArray<WallConstraintSpec | undefined>,
  pinned: ReadonlySet<number>,
  tiers: ReadonlyArray<ReadonlySet<number>>,
  opts: Omit<SolveOptions, 'pinned'> = {},
): SolveResult {
  let best: SolveResult | null = null;
  for (const extra of tiers.length ? tiers : [new Set<number>()]) {
    const r = solveConstraints(points, constraints, { ...opts, pinned: new Set([...pinned, ...extra]) });
    if (r.ok) return r;
    if (!best || r.violations.length < best.violations.length) best = r;
  }
  return best!;
}
