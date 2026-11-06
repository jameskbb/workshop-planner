import type { BBox, Polygon } from './polygon';
import { bbox } from './polygon';
import { add, rotate, sub, type Point } from './vec';

/**
 * A pose in the plan: position (mm) + rotation (degrees, clockwise on screen).
 * For placed objects the position is the CENTER of the footprint.
 */
export interface Pose {
  x: number;
  y: number;
  rotation: number;
}

/** Oriented bounding box: a rectangle of `width` (local x) × `depth` (local y) centered on a pose. */
export interface OBB extends Pose {
  width: number;
  depth: number;
}

/** Local frame → world. Local +y is an object's FRONT; local −x is its LEFT (see docs/ARCHITECTURE.md). */
export function localToWorld(pose: Pose, p: Point): Point {
  return add({ x: pose.x, y: pose.y }, rotate(p, pose.rotation));
}

export function worldToLocal(pose: Pose, p: Point): Point {
  return rotate(sub(p, { x: pose.x, y: pose.y }), -pose.rotation);
}

export function localPolygonToWorld(pose: Pose, poly: Polygon): Polygon {
  return poly.map((p) => localToWorld(pose, p));
}

/** Axis-aligned rectangle in local coordinates centered at (cx, cy). */
export function localRect(width: number, depth: number, cx = 0, cy = 0): Polygon {
  const hw = width / 2;
  const hd = depth / 2;
  return [
    { x: cx - hw, y: cy - hd },
    { x: cx + hw, y: cy - hd },
    { x: cx + hw, y: cy + hd },
    { x: cx - hw, y: cy + hd },
  ];
}

/** World-space corners of an OBB: back-left, back-right, front-right, front-left. */
export function obbCorners(o: OBB): Polygon {
  return localPolygonToWorld(o, localRect(o.width, o.depth));
}

export function obbBBox(o: OBB): BBox {
  return bbox(obbCorners(o));
}

/** True if world point p lies within the OBB (inclusive, with tolerance). */
export function obbContainsPoint(o: OBB, p: Point, eps = 1e-6): boolean {
  const l = worldToLocal(o, p);
  return Math.abs(l.x) <= o.width / 2 + eps && Math.abs(l.y) <= o.depth / 2 + eps;
}

/** Unit axes of the OBB in world space: [local x, local y]. */
export function obbAxes(o: OBB): [Point, Point] {
  return [rotate({ x: 1, y: 0 }, o.rotation), rotate({ x: 0, y: 1 }, o.rotation)];
}

/** World-space size of the axis-aligned box that encloses a rotated w×d rectangle. */
export function rotatedExtents(width: number, depth: number, rotation: number): { width: number; depth: number } {
  const r = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const cc = c < 1e-12 ? 0 : c;
  const ss = s < 1e-12 ? 0 : s;
  return { width: width * cc + depth * ss, depth: width * ss + depth * cc };
}
