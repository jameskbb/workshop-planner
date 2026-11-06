/**
 * 2D vector math. Plan coordinates are millimeters with +x = east and +y = south
 * (screen-down); north is "up" on screen. Rotations are in DEGREES and positive values
 * rotate clockwise on screen (which is the mathematical positive direction in a y-down frame).
 */

export interface Point {
  x: number;
  y: number;
}

export type Vec = Point;

/** Geometric tolerance in mm used for "touching" / degenerate checks. */
export const EPS = 1e-6;
/** Coarser tolerance for user-scale comparisons (0.01 mm, the unit quantum). */
export const LENGTH_EPS = 0.01;

export const vec = (x: number, y: number): Point => ({ x, y });
export const ORIGIN: Point = Object.freeze({ x: 0, y: 0 });

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const neg = (a: Point): Point => ({ x: -a.x, y: -a.y });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
/** z-component of the 3D cross product. */
export const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
export const lengthSq = (a: Point): number => a.x * a.x + a.y * a.y;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceSq = (a: Point, b: Point): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint = (a: Point, b: Point): Point => lerp(a, b, 0.5);
/** Left-hand perpendicular in math orientation: (x, y) → (-y, x). */
export const perp = (a: Point): Point => ({ x: -a.y, y: a.x });

export function normalize(a: Point): Point {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** Rotate a vector by `degrees` (clockwise on screen). */
export function rotate(a: Point, degrees: number): Point {
  if (degrees === 0) return { x: a.x, y: a.y };
  const r = degToRad(degrees);
  const c = Math.cos(r);
  const s = Math.sin(r);
  // Snap tiny float noise for right angles so 90° rotations are exact.
  const cc = Math.abs(c) < 1e-12 ? 0 : c;
  const ss = Math.abs(s) < 1e-12 ? 0 : s;
  return { x: a.x * cc - a.y * ss, y: a.x * ss + a.y * cc };
}

export function rotateAround(p: Point, center: Point, degrees: number): Point {
  return add(center, rotate(sub(p, center), degrees));
}

/** Angle of a vector in degrees, in (-180, 180]. 0 = east, 90 = south (screen-down). */
export const angleOf = (a: Point): number => radToDeg(Math.atan2(a.y, a.x));

/** Normalize an angle in degrees into [0, 360). */
export function normalizeAngle(deg: number): number {
  const r = deg % 360;
  const n = r < 0 ? r + 360 : r;
  return n === 360 || Math.abs(n) < 1e-12 ? 0 : n;
}

/** Smallest signed difference b − a in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normalizeAngle(b - a);
  if (d > 180) d -= 360;
  return d;
}

export const pointsEqual = (a: Point, b: Point, eps = EPS): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Unit vector for a heading in degrees (0 = east, 90 = south). */
export const fromAngle = (deg: number): Point => rotate({ x: 1, y: 0 }, deg);

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
