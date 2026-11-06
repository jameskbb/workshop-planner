/**
 * Wall elevation model (pure): what you see standing inside the room facing one wall (wall- and
 * ceiling-mounted items, floor items against the wall, doors / windows / garage door openings,
 * outlets and the panel), projected onto the wall with accurate along-wall offsets and heights.
 * Also: vertical space above an item and stacking opportunities ("a wall cabinet fits above the
 * workbench: 36" available").
 *
 * Along-wall coordinate `u` runs from the viewer's LEFT end of the wall (0) to the right end.
 */
import { getScenario, resolveObject, objectFootprint, featureFootprint, electricalPosition, roomGeometry } from '@/domain/resolve';
import { OPENING_KINDS, type EntityRef, type ObjectDefinition, type Project } from '@/domain/schema';
import { inches } from '@/domain/units';
import { bbox, bboxIntersects, dot, intersect, areaOfMulti, localPolygonToWorld, localRect, sub, add, scale, type Point, type Polygon, type WallGeom } from '@/geometry';

/** Floor items whose nearest point is within this distance of the wall face count as "against" it. */
export const AGAINST_WALL = inches(24);
/** Work gap kept above a work surface when suggesting wall storage above it (mm). */
export const WORK_GAP = inches(18);

export type ElevationKind = 'object' | 'opening' | 'feature' | 'electrical';

export interface ElevationItem {
  ref: EntityRef;
  name: string;
  kind: ElevationKind;
  /** Along-wall extent (mm from the left end). */
  start: number;
  end: number;
  bottom: number;
  top: number;
  /** Distance of the item's nearest point from the wall face (mm). */
  distance: number;
  mount: 'floor' | 'wall' | 'ceiling' | 'fixed';
  category?: string;
  color?: string;
  locked: boolean;
  /** Can be dragged along the wall / up and down in the elevation. */
  along: boolean;
  vertical: boolean;
}

export interface WallElevation {
  wallId: string;
  name: string;
  wall: WallGeom;
  length: number;
  /** Wall height (mm). */
  height: number;
  ceiling: number;
  /** World point at u = 0 on the wall face. */
  origin: Point;
  /** World unit vector of +u (viewer's right). */
  right: Point;
  items: ElevationItem[];
}

function frame(wall: WallGeom): { origin: Point; right: Point } {
  const f = wall.outward;
  const right = { x: -f.y, y: f.x };
  const origin = dot(wall.a, right) <= dot(wall.b, right) ? wall.a : wall.b;
  return { origin, right };
}

function project1(poly: Polygon, origin: Point, right: Point, inward: Point, wallA: Point) {
  let s = Infinity;
  let e = -Infinity;
  let d = Infinity;
  for (const p of poly) {
    const u = dot(sub(p, origin), right);
    s = Math.min(s, u);
    e = Math.max(e, u);
    d = Math.min(d, dot(sub(p, wallA), inward));
  }
  return { start: s, end: e, distance: d };
}

export function wallElevation(project: Project, wallId: string, scenarioId?: string, maxDistance = AGAINST_WALL): WallElevation | null {
  const g = roomGeometry(project.room);
  const i = g.wallIndex.get(wallId);
  if (i === undefined) return null;
  const wall = g.walls[i]!;
  const { origin, right } = frame(wall);
  const scenario = getScenario(project, scenarioId);
  const items: ElevationItem[] = [];
  const within = (s: number, e: number) => e > 1 && s < wall.length - 1;

  for (const o of scenario.objects) {
    if (o.hidden) continue;
    const r = resolveObject(project, o);
    const fp = objectFootprint(r);
    const pr = project1(fp, origin, right, wall.inward, wall.a);
    const hosted = o.wallId === wallId;
    const limit = r.elevated ? inches(6) : maxDistance;
    if (!hosted && (pr.distance > limit || pr.distance < -inches(2))) continue;
    if (!within(pr.start, pr.end)) continue;
    items.push({
      ref: { kind: 'object', id: o.id },
      name: r.label,
      kind: 'object',
      start: pr.start,
      end: pr.end,
      bottom: r.elevation,
      top: r.elevation + r.height,
      distance: Math.max(0, pr.distance),
      mount: o.mount,
      category: r.category,
      color: o.color ?? r.definition?.color,
      locked: o.locked,
      along: !o.locked,
      vertical: !o.locked && o.mount !== 'floor',
    });
  }
  for (const f of project.architecture) {
    if (f.hidden) continue;
    const onWall = f.placement.type === 'wall' && f.placement.wallId === wallId;
    let pr: { start: number; end: number; distance: number };
    if (onWall) {
      const a = dot(sub(add(wall.a, scale(wall.dir, (f.placement as { offset: number }).offset - f.width / 2)), origin), right);
      const b = dot(sub(add(wall.a, scale(wall.dir, (f.placement as { offset: number }).offset + f.width / 2)), origin), right);
      pr = { start: Math.min(a, b), end: Math.max(a, b), distance: 0 };
    } else {
      const fp = featureFootprint(project.room, f);
      if (fp.length < 3) continue;
      pr = project1(fp, origin, right, wall.inward, wall.a);
      if (pr.distance > maxDistance || pr.distance < -inches(2)) continue;
    }
    if (!within(pr.start, pr.end)) continue;
    const opening = OPENING_KINDS.has(f.kind);
    const top = f.kind === 'garage-door' ? (f.garageDoor?.openingHeight ?? f.height) + f.elevation : f.elevation + f.height;
    items.push({ ref: { kind: 'feature', id: f.id }, name: f.name, kind: opening ? 'opening' : 'feature', ...pr, bottom: f.elevation, top, distance: Math.max(0, pr.distance), mount: 'fixed', locked: f.locked, along: onWall && !f.locked, vertical: false, color: f.color });
  }
  for (const e of project.electrical) {
    if (e.hidden || e.placement.type !== 'wall' || e.placement.wallId !== wallId) continue;
    const p = electricalPosition(project.room, e);
    const u = dot(sub(p, origin), right);
    items.push({
      ref: { kind: 'electrical', id: e.id },
      name: e.label || (e.kind === 'panel' ? 'Panel' : 'Outlet'),
      kind: 'electrical',
      start: u - e.width / 2,
      end: u + e.width / 2,
      bottom: e.elevation - e.height / 2,
      top: e.elevation + e.height / 2,
      distance: 0,
      mount: 'fixed',
      locked: e.locked,
      along: !e.locked,
      vertical: !e.locked,
    });
  }
  // Far items first so nearer ones draw on top.
  items.sort((a, b) => b.distance - a.distance);
  return {
    wallId,
    name: wall.name,
    wall,
    length: wall.length,
    height: g.heights[i] ?? project.room.ceilingHeight,
    ceiling: project.room.ceilingHeight,
    origin,
    right,
    items,
  };
}

/** World point on the wall face at along-wall offset u. */
export const alongToWorld = (el: WallElevation, u: number): Point => add(el.origin, scale(el.right, u));

/** Placement offset (from the wall's start vertex) for an along-wall position u. */
export const offsetForAlong = (el: WallElevation, u: number): number => dot(sub(alongToWorld(el, u), el.wall.a), el.wall.dir);

// ───────────────────────────── vertical space ─────────────────────────────

export interface VerticalSpace {
  top: number;
  /** Height of the lowest thing above the item within its plan footprint (or the ceiling). */
  limit: number;
  limitName: string;
  available: number;
}

/** Clear height above an object: ceiling, beams/obstructions, lights and items mounted above it. */
export function verticalSpaceAbove(project: Project, objectId: string, scenarioId?: string): VerticalSpace | null {
  const scenario = getScenario(project, scenarioId);
  const o = scenario.objects.find((x) => x.id === objectId);
  if (!o) return null;
  const r = resolveObject(project, o);
  const fp = objectFootprint(r);
  const box = bbox(fp);
  const top = r.elevation + r.height;
  let limit = project.room.ceilingHeight;
  let limitName = 'the ceiling';
  const overlaps = (poly: Polygon) => poly.length >= 3 && bboxIntersects(box, bbox(poly)) && areaOfMulti(intersect(fp, poly)) > 100;
  for (const other of scenario.objects) {
    if (other.id === o.id || other.hidden) continue;
    const ro = resolveObject(project, other);
    if (ro.elevation < top - 1 || ro.elevation >= limit) continue;
    if (overlaps(objectFootprint(ro))) {
      limit = ro.elevation;
      limitName = ro.label;
    }
  }
  for (const f of project.architecture) {
    if (f.hidden || f.elevation < top - 1 || f.elevation >= limit || OPENING_KINDS.has(f.kind)) continue;
    if (overlaps(featureFootprint(project.room, f))) {
      limit = f.elevation;
      limitName = `the ${f.name}`;
    }
  }
  for (const l of scenario.lights) {
    if (l.hidden || l.elevation < top - 1 || l.elevation >= limit) continue;
    if (overlaps(localPolygonToWorld({ x: l.x, y: l.y, rotation: l.rotation }, localRect(l.length, Math.max(l.width, 60))))) {
      limit = l.elevation;
      limitName = `the ${l.name}`;
    }
  }
  return { top, limit, limitName, available: Math.max(0, limit - top) };
}

export interface StackingOpportunity {
  objectId: string;
  name: string;
  /** Clear height above the item along the wall (mm). */
  available: number;
  /** Height usable for storage after the work gap (mm). */
  usable: number;
  start: number;
  end: number;
  bottom: number;
  suggestion?: ObjectDefinition;
  message: string;
}

/**
 * Floor items against a wall with enough clear wall above them for wall storage. `candidates` are
 * wall-mountable definitions to suggest (tallest that fits wins).
 */
export function stackingOpportunities(el: WallElevation, candidates: readonly ObjectDefinition[], fmt: (mm: number) => string, minUsable = inches(12)): StackingOpportunity[] {
  const out: StackingOpportunity[] = [];
  for (const it of el.items) {
    if (it.kind !== 'object' || it.mount !== 'floor' || it.distance > inches(6)) continue;
    const width = it.end - it.start;
    // Lowest thing above it on this wall within its span.
    let limit = el.height;
    for (const other of el.items) {
      if (other === it || other.end <= it.start + 1 || other.start >= it.end - 1) continue;
      if (other.bottom >= it.top - 1 && other.bottom < limit) limit = other.bottom;
    }
    const available = limit - it.top;
    const gap = it.category === 'work-surface' ? WORK_GAP : inches(2);
    const usable = available - gap;
    if (usable < minUsable) continue;
    const fit = candidates.filter((d) => d.mount === 'wall' && d.category === 'storage' && d.height <= usable && d.width <= width + 1).sort((a, b) => b.height * b.width - a.height * a.width)[0];
    const what = fit ? fit.name : 'Wall storage';
    const gapNote = it.category === 'work-surface' ? ` with an ${fmt(gap)} work gap` : '';
    out.push({
      objectId: it.ref.id,
      name: it.name,
      available,
      usable,
      start: it.start,
      end: it.end,
      bottom: it.top + gap,
      suggestion: fit,
      message: `${what}${fit ? ` (${fmt(fit.height)} tall)` : ''} can fit above the ${it.name}: ${fmt(available)} clear above it${gapNote}.`,
    });
  }
  return out;
}

/** Walls that have something worth showing (for the wall picker). */
export function wallSummaries(project: Project, scenarioId?: string): Array<{ wallId: string; name: string; length: number; count: number }> {
  const g = roomGeometry(project.room);
  return project.room.walls.map((w, i) => {
    const el = wallElevation(project, w.id, scenarioId);
    return { wallId: w.id, name: g.walls[i]?.name ?? `Wall ${i + 1}`, length: g.walls[i]?.length ?? 0, count: el?.items.length ?? 0 };
  });
}

