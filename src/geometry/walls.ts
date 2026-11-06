/**
 * Room walls: interior-face segments of the room polygon, their orientation, compass naming,
 * thickness bands, and distances from objects to walls.
 *
 * Convention: the room polygon traces the INTERIOR face of the walls (what you measure with a
 * tape inside the garage). Wall i runs from vertex i to vertex i+1; its thickness grows outward.
 */
import { lineIntersection, closestPointOnSegment, projectParam, segmentSegmentDistance } from './segment';
import { edgeOutwardNormal, orientation, polygonsOverlapOrTouch, type Polygon } from './polygon';
import { add, angleOf, distance, dot, lerp, neg, normalize, scale, sub, type Point } from './vec';

export type Compass8 = 'north' | 'northeast' | 'east' | 'southeast' | 'south' | 'southwest' | 'west' | 'northwest';

export interface WallGeom {
  index: number;
  a: Point;
  b: Point;
  length: number;
  /** Unit direction a → b. */
  dir: Point;
  /** Unit normal pointing out of the room. */
  outward: Point;
  /** Unit normal pointing into the room. */
  inward: Point;
  /** Which way the wall faces from inside (its outward normal), e.g. an outward normal toward −y ⇒ 'north'. */
  compass: Compass8;
  /** Human name: user-provided or derived, e.g. "North wall", "East wall (south)". */
  name: string;
}

const COMPASS_ORDER: Compass8[] = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];

/** Compass direction of a vector in plan coordinates (+x east, +y south). */
export function compassOf(v: Point): Compass8 {
  const a = angleOf(v); // 0 = east, 90 = south
  const idx = Math.round((((a % 360) + 360) % 360) / 45) % 8;
  return COMPASS_ORDER[idx]!;
}

export const compassLabel = (c: Compass8): string => c.charAt(0).toUpperCase() + c.slice(1);

/** Opposite and cardinal helpers used by wall naming / NL commands. */
export const COMPASS_VECTORS: Record<'north' | 'east' | 'south' | 'west', Point> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export interface RoomWallOptions {
  /** Optional user names per wall index; empty/undefined entries use compass names. */
  names?: ReadonlyArray<string | undefined | null>;
}

/**
 * Build wall geometry for a room polygon (either orientation).
 * Walls that face the same compass direction are disambiguated by position:
 * two → "North wall (west)" / "North wall (east)"; three or more → "North wall 1…n" (west→east / north→south).
 */
export function roomWalls(room: Polygon, options: RoomWallOptions = {}): WallGeom[] {
  const n = room.length;
  if (n < 3 || orientation(room) === 0) return [];
  const walls: WallGeom[] = room.map((a, i) => {
    const b = room[(i + 1) % n]!;
    const outward = edgeOutwardNormal(room, i);
    return {
      index: i,
      a,
      b,
      length: distance(a, b),
      dir: normalize(sub(b, a)),
      outward,
      inward: neg(outward),
      compass: compassOf(outward),
      name: '',
    };
  });
  const groups = new Map<Compass8, WallGeom[]>();
  for (const w of walls) {
    const g = groups.get(w.compass) ?? [];
    g.push(w);
    groups.set(w.compass, g);
  }
  for (const [compass, group] of groups) {
    const base = `${compassLabel(compass)} wall`;
    if (group.length === 1) {
      group[0]!.name = base;
      continue;
    }
    // Sort along the axis perpendicular to the facing direction.
    const facing = group[0]!.outward;
    const along = { x: -facing.y, y: facing.x };
    const alongIsX = Math.abs(along.x) >= Math.abs(along.y);
    const key = (w: WallGeom) => {
      const m = lerp(w.a, w.b, 0.5);
      return alongIsX ? m.x : m.y;
    };
    const sorted = [...group].sort((p, q) => key(p) - key(q));
    if (sorted.length === 2) {
      const [lo, hi] = alongIsX ? ['west', 'east'] : ['north', 'south'];
      sorted[0]!.name = `${base} (${lo})`;
      sorted[1]!.name = `${base} (${hi})`;
    } else {
      sorted.forEach((w, k) => (w.name = `${base} ${k + 1}`));
    }
  }
  const names = options.names;
  if (names) {
    for (const w of walls) {
      const custom = names[w.index];
      if (custom && custom.trim()) w.name = custom.trim();
    }
  }
  return walls;
}

export interface WallProjection {
  /** Distance along the wall from `a` (may be outside [0, length]). */
  offset: number;
  /** Signed perpendicular distance: positive = inside the room. */
  inset: number;
  /** Foot of the perpendicular on the (infinite) wall line. */
  foot: Point;
  /** True when the foot lies within the wall's extent. */
  within: boolean;
}

/** Project a point onto a wall's line. */
export function projectOntoWall(p: Point, wall: WallGeom): WallProjection {
  const t = projectParam(p, wall.a, wall.b);
  const offset = t * wall.length;
  const foot = add(wall.a, scale(wall.dir, offset));
  return { offset, inset: dot(sub(p, foot), wall.inward), foot, within: t >= -1e-9 && t <= 1 + 1e-9 };
}

/** Point on a wall at `offset` along it, pushed `inset` into the room. */
export function pointOnWall(wall: WallGeom, offset: number, inset = 0): Point {
  return add(add(wall.a, scale(wall.dir, offset)), scale(wall.inward, inset));
}

/** Rotation (degrees) that makes an object's FRONT (local +y) face into the room from this wall. */
export function rotationFacingAwayFromWall(wall: WallGeom): number {
  return normalizeDeg(angleOf(wall.inward) - 90);
}

function normalizeDeg(d: number): number {
  const r = ((d % 360) + 360) % 360;
  const rounded = Math.round(r * 1e9) / 1e9;
  return rounded === 360 ? 0 : rounded;
}

export interface WallDistance {
  wallIndex: number;
  wallName: string;
  /** Minimum distance from the shape to the wall's interior face segment (0 if touching/crossing). */
  distance: number;
  /** Closest point on the shape and on the wall. */
  onShape: Point;
  onWall: Point;
}

/** Distance from a polygon (e.g. an object footprint) to every wall, nearest first. */
export function distancesToWalls(shape: Polygon, walls: WallGeom[]): WallDistance[] {
  const out: WallDistance[] = [];
  for (const w of walls) {
    let best: WallDistance = {
      wallIndex: w.index,
      wallName: w.name,
      distance: Infinity,
      onShape: shape[0] ?? w.a,
      onWall: w.a,
    };
    for (let i = 0; i < shape.length; i++) {
      const p = shape[i]!;
      const q = shape[(i + 1) % shape.length]!;
      const d = segmentSegmentDistance(p, q, w.a, w.b);
      if (d < best.distance) {
        // Recover the closest pair.
        const candidates: Array<[Point, Point]> = [
          [p, closestPointOnSegment(p, w.a, w.b).point],
          [q, closestPointOnSegment(q, w.a, w.b).point],
          [closestPointOnSegment(w.a, p, q).point, w.a],
          [closestPointOnSegment(w.b, p, q).point, w.b],
        ];
        let pair = candidates[0]!;
        let pd = Infinity;
        for (const c of candidates) {
          const dd = distance(c[0], c[1]);
          if (dd < pd) {
            pd = dd;
            pair = c;
          }
        }
        best = { ...best, distance: d, onShape: pair[0], onWall: pair[1] };
      }
    }
    out.push(best);
  }
  return out.sort((x, y) => x.distance - y.distance);
}

/** Nearest wall to a shape, or null for a room without walls. */
export function nearestWall(shape: Polygon, walls: WallGeom[]): WallDistance | null {
  return distancesToWalls(shape, walls)[0] ?? null;
}

/**
 * Exterior corner points for wall thickness, using a mitered join at every vertex
 * (no bevels, so wall quads stay 4-sided). `thickness[i]` is the thickness of wall i.
 */
export function exteriorCorners(room: Polygon, thickness: number | readonly number[]): Point[] {
  const n = room.length;
  const t = (i: number) => (typeof thickness === 'number' ? thickness : (thickness[((i % n) + n) % n] ?? 0));
  const normals = room.map((_, i) => edgeOutwardNormal(room, i));
  return room.map((v, i) => {
    const ip = (i - 1 + n) % n;
    const prevA = add(room[ip]!, scale(normals[ip]!, t(ip)));
    const prevB = add(v, scale(normals[ip]!, t(ip)));
    const curA = add(v, scale(normals[i]!, t(i)));
    const curB = add(room[(i + 1) % n]!, scale(normals[i]!, t(i)));
    const hit = lineIntersection(prevA, prevB, curA, curB);
    if (hit && distance(hit, v) < 20 * Math.max(t(ip), t(i), 1)) return hit;
    return add(v, scale(normalize(add(normals[ip]!, normals[i]!)), Math.max(t(ip), t(i))));
  });
}

/** Exterior outline of the building shell (interior polygon grown by per-wall thickness). */
export const exteriorOutline = exteriorCorners;

/** Quadrilateral occupied by wall i's thickness: interior a, interior b, exterior b, exterior a. */
export function wallQuads(room: Polygon, thickness: number | readonly number[]): Polygon[] {
  const ext = exteriorCorners(room, thickness);
  const n = room.length;
  return room.map((a, i) => [a, room[(i + 1) % n]!, ext[(i + 1) % n]!, ext[i]!]);
}

/** Interior angle (degrees) at each vertex of the room; > 180 means a reflex (inside) corner. */
export function interiorAngles(room: Polygon): number[] {
  const n = room.length;
  const sign = orientation(room) >= 0 ? 1 : -1;
  return room.map((v, i) => {
    const prev = room[(i - 1 + n) % n]!;
    const next = room[(i + 1) % n]!;
    const a1 = angleOf(sub(prev, v));
    const a2 = angleOf(sub(next, v));
    let ang = (a1 - a2) * sign;
    ang = ((ang % 360) + 360) % 360;
    return Math.round(ang * 1e9) / 1e9;
  });
}

/** Human description of a corner between two walls, e.g. "southwest corner". */
export function cornerName(walls: WallGeom[], vertexIndex: number): string {
  const n = walls.length;
  const prev = walls[(vertexIndex - 1 + n) % n];
  const next = walls[vertexIndex % n];
  if (!prev || !next) return 'corner';
  const v = add(prev.outward, next.outward);
  if (Math.hypot(v.x, v.y) < 1e-9) return 'corner';
  return `${compassOf(v)} corner`;
}

/** Does any wall segment of the room pass through this polygon? */
export function shapeCrossesWalls(shape: Polygon, walls: WallGeom[]): boolean {
  return walls.some((w) => polygonsOverlapOrTouch(shape, [w.a, w.b, lerp(w.a, w.b, 0.5)]));
}
