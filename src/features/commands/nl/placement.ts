/**
 * Placement helpers (pure) shared by the command parser, "Will It Fit?" and "What could fit here?":
 * is a footprint free at a pose (inside the room, no 3D-overlapping item, fixture or vehicle), put
 * an item's back against a wall at the nearest free spot, or set it beside another item.
 */
import { featureFootprint, getScenario, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, type Project } from '@/domain/schema';
import {
  bbox,
  localRect,
  localToWorld,
  pointOnWall,
  polygonContainsPolygon,
  projectOntoWall,
  rotationFacingAwayFromWall,
  satConvex,
  vehicleBody,
  type BBox,
  type LocalFootprint,
  type Polygon,
  type Pose,
  type WallGeom,
} from '@/geometry';

export interface Obstacle {
  id: string;
  name: string;
  poly: Polygon;
  box: BBox;
  bottom: number;
  top: number;
}

/** Everything a new/moved item could bump into (excluding `excludeIds`). */
export function placementObstacles(project: Project, scenarioId: string | undefined, excludeIds: ReadonlySet<string> = new Set()): Obstacle[] {
  const s = getScenario(project, scenarioId);
  const out: Obstacle[] = [];
  for (const o of s.objects) {
    if (o.hidden || excludeIds.has(o.id)) continue;
    const r = resolveObject(project, o);
    const poly = objectFootprint(r);
    out.push({ id: o.id, name: o.name, poly, box: bbox(poly), bottom: r.elevation, top: r.elevation + r.height });
  }
  for (const v of s.vehicles) {
    if (v.hidden || excludeIds.has(v.id)) continue;
    const poly = vehicleBody(vehicleGeomSpec(v), vehiclePose(v));
    out.push({ id: v.id, name: v.name, poly, box: bbox(poly), bottom: 0, top: v.height });
  }
  for (const f of project.architecture) {
    if (f.hidden || OPENING_KINDS.has(f.kind) || OVERHEAD_KINDS.has(f.kind) || excludeIds.has(f.id)) continue;
    const poly = featureFootprint(project.room, f);
    if (poly.length >= 3) out.push({ id: f.id, name: f.name, poly, box: bbox(poly), bottom: f.elevation, top: f.elevation + f.height });
  }
  out.push(...doorKeepClear(project));
  return out;
}

/**
 * Floor that must stay clear at doorways: a people door's swing (its width square, at least 32"
 * deep) and a 24" band inside each garage door. Nothing should be placed there.
 */
export function doorKeepClear(project: Project): Obstacle[] {
  const g = roomGeometry(project.room);
  const out: Obstacle[] = [];
  for (const f of project.architecture) {
    if (f.hidden || f.placement.type !== 'wall') continue;
    if (f.kind !== 'door' && f.kind !== 'double-door' && f.kind !== 'garage-door') continue;
    const wi = g.wallIndex.get(f.placement.wallId);
    const wall = wi === undefined ? undefined : g.walls[wi];
    if (!wall) continue;
    const s0 = f.placement.offset - f.width / 2;
    const s1 = f.placement.offset + f.width / 2;
    const depth = f.kind === 'garage-door' ? 610 : f.door?.swing === 'out' ? 610 : Math.max(f.width, 810);
    const poly = [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, depth), pointOnWall(wall, s0, depth)];
    out.push({ id: `${f.id}:keep-clear`, name: f.kind === 'garage-door' ? `the ${f.name} opening` : `the ${f.name} swing`, poly, box: bbox(poly), bottom: 0, top: 2000 });
  }
  return out;
}

export interface Item {
  fp: LocalFootprint;
  /** Vertical extent. */
  bottom: number;
  top: number;
  /** Extra clearance on every side (mm). */
  clearance?: number;
}

export function footprintAt(item: Item, pose: Pose, grow = 0): Polygon {
  return localRect(item.fp.width + 2 * grow, item.fp.depth + 2 * grow, item.fp.offsetX ?? 0, item.fp.offsetY ?? 0).map((p) => localToWorld(pose, p));
}

/** Null when the item fits at the pose; otherwise the reason. */
export function blockedAt(room: Polygon, obstacles: readonly Obstacle[], item: Item, pose: Pose): string | null {
  const poly = footprintAt(item, pose);
  if (room.length >= 3 && !polygonContainsPolygon(room, poly, 0.5)) return 'outside the room';
  const env = item.clearance ? footprintAt(item, pose, item.clearance) : poly;
  const b = bbox(env);
  for (const o of obstacles) {
    if (o.box.minX >= b.maxX || o.box.maxX <= b.minX || o.box.minY >= b.maxY || o.box.maxY <= b.minY) continue;
    if (!(item.bottom < o.top - 1 && o.bottom < item.top - 1)) continue;
    const c = satConvex(env, o.poly, 1);
    if (c.colliding && c.depth > 1) return `overlaps ${o.name}`;
  }
  return null;
}

/** Back against `wall` facing into the room, at the free offset nearest `preferred`. */
export function placeAgainstWall(room: Polygon, obstacles: readonly Obstacle[], item: Item, wall: WallGeom, preferred?: number, step = 25): { pose: Pose; offset: number } | null {
  const rotation = rotationFacingAwayFromWall(wall);
  const half = item.fp.width / 2;
  if (wall.length < item.fp.width) return null;
  const back = item.fp.depth / 2 - (item.fp.offsetY ?? 0);
  const target = Math.min(wall.length - half, Math.max(half, preferred ?? wall.length / 2));
  const poseAt = (offset: number): Pose => {
    const c = pointOnWall(wall, offset - (item.fp.offsetX ?? 0), back + 0.5);
    return { x: c.x, y: c.y, rotation };
  };
  const maxK = Math.ceil(wall.length / step);
  for (let k = 0; k <= maxK; k++) {
    for (const sign of k === 0 ? [1] : [1, -1]) {
      const offset = target + sign * k * step;
      if (offset < half - 1e-6 || offset > wall.length - half + 1e-6) continue;
      const pose = poseAt(offset);
      if (!blockedAt(room, obstacles, item, pose)) return { pose, offset };
    }
  }
  return null;
}

/**
 * Longest stretch of `wall` where the item fits, in mm (0 when it fits nowhere). Used to choose
 * between walls that share a compass name: "the north wall" should mean the long run, not the 4'
 * jog beside it (R-006).
 */
export function freeRunAlong(room: Polygon, obstacles: readonly Obstacle[], item: Item, wall: WallGeom, step = 50): number {
  const half = item.fp.width / 2;
  if (wall.length < item.fp.width) return 0;
  const rotation = rotationFacingAwayFromWall(wall);
  const back = item.fp.depth / 2 - (item.fp.offsetY ?? 0);
  let best = 0;
  let runStart: number | null = null;
  for (let offset = half; offset <= wall.length - half + 1e-6; offset += step) {
    const c = pointOnWall(wall, offset - (item.fp.offsetX ?? 0), back + 0.5);
    const free = !blockedAt(room, obstacles, item, { x: c.x, y: c.y, rotation });
    if (!free) {
      runStart = null;
      continue;
    }
    if (runStart === null) runStart = offset;
    best = Math.max(best, offset - runStart + item.fp.width);
  }
  return best;
}

/** Offset of a point projected onto a wall. */
export const offsetAlong = (wall: WallGeom, p: { x: number; y: number }) => projectOntoWall(p, wall).offset;

/**
 * Beside `target` (right, left, front, back of it), matching its rotation with backs aligned, the
 * free spot closest to `near`. `gap` separates them slightly.
 */
export function placeBeside(room: Polygon, obstacles: readonly Obstacle[], item: Item, target: { pose: Pose; fp: LocalFootprint }, near: { x: number; y: number }, gap = 12.7): Pose | null {
  const tw = target.fp.width / 2;
  const td = target.fp.depth / 2;
  const iw = item.fp.width / 2;
  const id = item.fp.depth / 2;
  const tox = target.fp.offsetX ?? 0;
  const toy = target.fp.offsetY ?? 0;
  const locals = [
    { x: tox + tw + gap + iw, y: toy - td + id },
    { x: tox - tw - gap - iw, y: toy - td + id },
    { x: tox, y: toy + td + gap + id },
    { x: tox, y: toy - td - gap - id },
  ];
  let best: { pose: Pose; d: number } | null = null;
  for (const l of locals) {
    const c = localToWorld(target.pose, l);
    const pose = { x: c.x, y: c.y, rotation: target.pose.rotation };
    if (blockedAt(room, obstacles, item, pose)) continue;
    const d = Math.hypot(c.x - near.x, c.y - near.y);
    if (!best || d < best.d) best = { pose, d };
  }
  return best?.pose ?? null;
}

export function roomPolygonOf(project: Project): Polygon {
  return roomGeometry(project.room).polygon;
}
