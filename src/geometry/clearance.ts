/**
 * Clearance-zone geometry. Zones are defined in an object's LOCAL frame (origin = footprint
 * center before state offsets; +y = FRONT, −y = BACK, −x = LEFT, +x = RIGHT as seen from the
 * front/operator position) so they rotate with the object automatically.
 *
 * Overlap functions return structured, explainable quantities, e.g.
 *   { against: { kind: 'wall', name: 'East wall' }, depth: 457.2 }  // "extends 18" past the East wall"
 */
import { difference, intersect, areaOfMulti, type MultiPolygon } from './clip';
import { localPolygonToWorld, localRect, type Pose } from './obb';
import { bbox, locatePoint, polygonDistance, type Polygon } from './polygon';
import { closestPointOnSegment, segmentIntersection } from './segment';
import type { WallGeom } from './walls';
import { dot, rotate, type Point } from './vec';

export type ZoneSide = 'front' | 'back' | 'left' | 'right';

/** Shape of a clearance zone in the object's local frame. */
export type ZoneShape =
  /** Band along one side of the footprint. `extend` widens it past both ends; `offset` leaves a gap. */
  | { type: 'side'; side: ZoneSide; depth: number; extend?: number; offset?: number }
  /** Uniform margin all around the footprint. */
  | { type: 'around'; margin: number }
  /** Arbitrary rectangle; (x, y) is its center relative to the footprint center. */
  | { type: 'rect'; x: number; y: number; width: number; depth: number }
  /** Arbitrary local polygon. */
  | { type: 'polygon'; points: Point[] };

/** The (state-resolved) footprint a zone is attached to, in the local frame. */
export interface LocalFootprint {
  width: number;
  depth: number;
  /** Footprint center offset within the local frame (e.g. unfolded wings shift the center). */
  offsetX?: number;
  offsetY?: number;
}

/** Unit vector (local frame) pointing away from the object for a side. */
export function sideVector(side: ZoneSide): Point {
  switch (side) {
    case 'front':
      return { x: 0, y: 1 };
    case 'back':
      return { x: 0, y: -1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

/** Zone polygon in the object's local frame. */
export function zoneLocalPolygon(shape: ZoneShape, fp: LocalFootprint): Polygon {
  const ox = fp.offsetX ?? 0;
  const oy = fp.offsetY ?? 0;
  const hw = fp.width / 2;
  const hd = fp.depth / 2;
  switch (shape.type) {
    case 'around':
      return localRect(fp.width + 2 * shape.margin, fp.depth + 2 * shape.margin, ox, oy);
    case 'rect':
      return localRect(shape.width, shape.depth, ox + shape.x, oy + shape.y);
    case 'polygon':
      return shape.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    case 'side': {
      const ext = shape.extend ?? 0;
      const off = shape.offset ?? 0;
      const d = shape.depth;
      switch (shape.side) {
        case 'front':
          return localRect(fp.width + 2 * ext, d, ox, oy + hd + off + d / 2);
        case 'back':
          return localRect(fp.width + 2 * ext, d, ox, oy - hd - off - d / 2);
        case 'left':
          return localRect(d, fp.depth + 2 * ext, ox - hw - off - d / 2, oy);
        case 'right':
          return localRect(d, fp.depth + 2 * ext, ox + hw + off + d / 2, oy);
      }
    }
  }
}

/** Zone polygon in world space for an object at `pose`. */
export function zoneWorldPolygon(shape: ZoneShape, fp: LocalFootprint, pose: Pose): Polygon {
  return localPolygonToWorld(pose, zoneLocalPolygon(shape, fp));
}

/** World-space unit axis along which a side zone extends away from the object (null for non-side shapes). */
export function zoneWorldAxis(shape: ZoneShape, pose: Pose): Point | null {
  return shape.type === 'side' ? rotate(sideVector(shape.side), pose.rotation) : null;
}

/** Local footprint polygon (state-resolved) in world space. */
export function footprintWorldPolygon(fp: LocalFootprint, pose: Pose): Polygon {
  return localPolygonToWorld(pose, localRect(fp.width, fp.depth, fp.offsetX ?? 0, fp.offsetY ?? 0));
}

export interface WallIntrusion {
  wallIndex: number;
  wallName: string;
  /** How far (mm) the zone extends beyond the wall's interior face. */
  depth: number;
  /** Area (mm²) of the zone lying beyond this wall. */
  area: number;
  /** The outside region attributed to this wall, for highlighting. */
  region: MultiPolygon;
}

/**
 * Offsets (along a→b, in mm) of the parts of segment a–b strictly inside polygon `poly`.
 */
export function segmentInsideIntervals(a: Point, b: Point, poly: Polygon): Array<[number, number]> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9 || poly.length < 3) return [];
  const ts = [0, 1];
  for (let i = 0; i < poly.length; i++) {
    const hit = segmentIntersection(a, b, poly[i]!, poly[(i + 1) % poly.length]!);
    if (hit) ts.push(Math.min(1, Math.max(0, hit.t)));
  }
  ts.sort((x, y) => x - y);
  const out: Array<[number, number]> = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k]!;
    const t1 = ts[k + 1]!;
    if (t1 - t0 < 1e-9) continue;
    const mid = { x: a.x + ((b.x - a.x) * (t0 + t1)) / 2, y: a.y + ((b.y - a.y) * (t0 + t1)) / 2 };
    if (locatePoint(poly, mid, 1e-6) === 'inside') {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - t0 * len) < 1e-6) last[1] = t1 * len;
      else out.push([t0 * len, t1 * len]);
    }
  }
  return out;
}

/**
 * Parts of a zone that lie outside the room, attributed to the wall(s) the zone actually crosses,
 * with intrusion depth measured perpendicular to that wall ("extends 18" past the East wall").
 * Works for concave (L-shaped) rooms because it clips against the actual room polygon.
 */
export function zoneWallIntrusions(zone: Polygon, room: Polygon, walls: WallGeom[], minDepth = 1): WallIntrusion[] {
  if (room.length < 3 || walls.length === 0) return [];
  const outside = difference(zone, room);
  if (outside.length === 0) return [];
  const pieces = outside.filter((p) => areaOfMulti([p]) >= 1);
  if (pieces.length === 0) return [];
  const crossed = walls
    .map((w) => ({ w, intervals: segmentInsideIntervals(w.a, w.b, zone) }))
    .filter((c) => c.intervals.length > 0);
  const byWall = new Map<number, WallIntrusion>();
  const add = (w: WallGeom, depth: number, pieceArea: number, piece: MultiPolygon[number] | null) => {
    const existing = byWall.get(w.index);
    if (existing) {
      existing.depth = Math.max(existing.depth, depth);
      existing.area += pieceArea;
      if (piece) existing.region.push(piece);
    } else {
      byWall.set(w.index, { wallIndex: w.index, wallName: w.name, depth, area: pieceArea, region: piece ? [piece] : [] });
    }
  };
  for (const piece of pieces) {
    const pieceArea = areaOfMulti([piece]);
    let best: { w: WallGeom; depth: number } | null = null;
    const depths: Array<{ w: WallGeom; depth: number }> = [];
    for (const { w, intervals } of crossed) {
      let depth = 0;
      for (const v of piece.outer) {
        const along = dot({ x: v.x - w.a.x, y: v.y - w.a.y }, w.dir);
        if (!intervals.some(([s, e]) => along >= s - 1e-6 && along <= e + 1e-6)) continue;
        depth = Math.max(depth, dot({ x: v.x - w.a.x, y: v.y - w.a.y }, w.outward));
      }
      if (depth <= 0) continue;
      depths.push({ w, depth });
      if (!best || depth > best.depth) best = { w, depth };
    }
    if (best) {
      for (const d of depths) {
        if (d.depth < minDepth) continue;
        add(d.w, d.depth, d.w === best.w ? pieceArea : 0, d.w === best.w ? piece : null);
      }
      continue;
    }
    // The zone does not cross any wall (e.g. the object itself is outside): use the nearest wall.
    let nearest: WallGeom | null = null;
    let nd = Infinity;
    let far = 0;
    for (const v of piece.outer) {
      for (const w of walls) {
        const c = closestPointOnSegment(v, w.a, w.b);
        if (c.distance < nd) {
          nd = c.distance;
          nearest = w;
        }
      }
    }
    if (!nearest) continue;
    for (const v of piece.outer) far = Math.max(far, closestPointOnSegment(v, nearest.a, nearest.b).distance);
    if (far >= minDepth) add(nearest, far, pieceArea, piece);
  }
  return [...byWall.values()].sort((a, b) => b.depth - a.depth);
}

export interface ZoneObstruction {
  /** Overlap area in mm². */
  area: number;
  /**
   * How much of the zone's depth is blocked (mm). For side zones: from the obstacle's nearest
   * point to the zone's far edge along the zone axis. For other shapes: the shortfall between the
   * requested margin and the actual gap between footprint and obstacle (or the overlap width).
   */
  depth: number;
  /** Clear distance (mm) available before hitting the obstacle, along the zone axis (side zones), or the footprint gap. */
  clear: number;
  /** Overlap region for highlighting. */
  region: MultiPolygon;
}

/**
 * Quantify how an obstacle polygon intrudes into a clearance zone.
 * Returns null when they do not overlap (touching is not an intrusion).
 */
export function zoneObstruction(
  shape: ZoneShape,
  fp: LocalFootprint,
  pose: Pose,
  obstacle: Polygon,
  minArea = 1,
): ZoneObstruction | null {
  const zone = zoneWorldPolygon(shape, fp, pose);
  const region = intersect(zone, obstacle);
  const a = areaOfMulti(region);
  if (a < minArea) return null;
  const axis = zoneWorldAxis(shape, pose);
  if (axis && shape.type === 'side') {
    const zoneProj = zone.map((p) => dot(p, axis));
    const far = Math.max(...zoneProj);
    const near = Math.min(...zoneProj);
    let minHit = Infinity;
    for (const piece of region) for (const p of piece.outer) minHit = Math.min(minHit, dot(p, axis));
    const clear = Math.max(0, minHit - near);
    return { area: a, depth: Math.max(0, far - minHit), clear, region };
  }
  if (shape.type === 'around') {
    const footprint = footprintWorldPolygon(fp, pose);
    const gap = polygonDistance(footprint, obstacle);
    return { area: a, depth: Math.max(0, shape.margin - gap), clear: gap, region };
  }
  // rect / polygon: report the overlap width along the narrowest direction.
  const b = bbox(region.flatMap((p) => p.outer));
  const depth = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  return { area: a, depth, clear: 0, region };
}
