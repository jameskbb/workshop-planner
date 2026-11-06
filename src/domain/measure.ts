/**
 * Measurement resolution (pure). Persistent measurements can be anchored to entities
 * (`anchorA` / `anchorB`); their endpoints are recomputed from the live geometry every time, so a
 * "Cabinet → Sedan = 31″" dimension stays true when either item moves. Unanchored endpoints use the
 * stored points. Also exposes `entityShape` / `entityName` for any EntityRef.
 */
import {
  angleOf,
  closestPointsBetweenPolygons,
  closestPointsBetweenSegments,
  distance,
  faceClearance,
  localPolygonToWorld,
  localRect,
  localToWorld,
  polygonSegments,
  rotate,
  sub,
  vehicleBody,
  type Point,
  type Polygon,
} from '@/geometry';
import { OPENING_KINDS, OVERHEAD_KINDS, type EntityRef, type Measurement, type Project, type Scenario } from './schema';
import { electricalPosition, featureFootprint, findObject, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from './resolve';

export type EntityShape = { type: 'point'; point: Point } | { type: 'segment'; a: Point; b: Point } | { type: 'polygon'; polygon: Polygon };

/** World geometry of any entity (for measuring, marquee selection, fitting). */
export function entityShape(project: Project, scenario: Scenario, ref: EntityRef): EntityShape | null {
  switch (ref.kind) {
    case 'object': {
      const o = findObject(scenario, ref.id);
      return o ? { type: 'polygon', polygon: objectFootprint(resolveObject(project, o)) } : null;
    }
    case 'vehicle': {
      const v = scenario.vehicles.find((x) => x.id === ref.id);
      return v ? { type: 'polygon', polygon: vehicleBody(vehicleGeomSpec(v), vehiclePose(v)) } : null;
    }
    case 'feature': {
      const f = project.architecture.find((x) => x.id === ref.id);
      if (!f) return null;
      const fp = featureFootprint(project.room, f);
      return fp.length >= 3 ? { type: 'polygon', polygon: fp } : null;
    }
    case 'wall': {
      const g = roomGeometry(project.room);
      const i = g.wallIndex.get(ref.id);
      const w = i === undefined ? undefined : g.walls[i];
      return w ? { type: 'segment', a: w.a, b: w.b } : null;
    }
    case 'vertex': {
      const v = project.room.vertices.find((x) => x.id === ref.id);
      return v ? { type: 'point', point: { x: v.x, y: v.y } } : null;
    }
    case 'electrical': {
      const e = project.electrical.find((x) => x.id === ref.id);
      return e ? { type: 'point', point: electricalPosition(project.room, e) } : null;
    }
    case 'light': {
      const l = scenario.lights.find((x) => x.id === ref.id);
      return l ? { type: 'polygon', polygon: localPolygonToWorld(l, localRect(l.length, l.width)) } : null;
    }
    case 'zone': {
      const z = scenario.zones.find((x) => x.id === ref.id);
      return z ? { type: 'polygon', polygon: z.points } : null;
    }
    default:
      return null;
  }
}

/** Human name of an entity ("Tool cabinet", "East wall", "Garage door"). */
export function entityName(project: Project, scenario: Scenario, ref: EntityRef): string {
  switch (ref.kind) {
    case 'object': {
      const o = findObject(scenario, ref.id);
      return o ? (o.label ?? o.name) : 'object';
    }
    case 'vehicle':
      return scenario.vehicles.find((v) => v.id === ref.id)?.name ?? 'vehicle';
    case 'feature':
      return project.architecture.find((f) => f.id === ref.id)?.name ?? 'feature';
    case 'wall': {
      const g = roomGeometry(project.room);
      const i = g.wallIndex.get(ref.id);
      return (i !== undefined && g.walls[i]?.name) || 'wall';
    }
    case 'vertex':
      return 'corner';
    case 'electrical':
      return project.electrical.find((e) => e.id === ref.id)?.label || 'outlet';
    case 'light':
      return scenario.lights.find((l) => l.id === ref.id)?.name ?? 'light';
    case 'zone':
      return scenario.zones.find((z) => z.id === ref.id)?.name ?? 'zone';
    default:
      return ref.kind;
  }
}

/** Closest points between two entity shapes (0 when polygons overlap). */
export function closestBetweenShapes(a: EntityShape, b: EntityShape): { from: Point; to: Point; distance: number } {
  if (a.type === 'polygon' && b.type === 'polygon') {
    const c = closestPointsBetweenPolygons(a.polygon, b.polygon);
    return { from: c.onA, to: c.onB, distance: c.distance };
  }
  const segs = (s: EntityShape): Array<[Point, Point]> =>
    s.type === 'polygon' ? polygonSegments(s.polygon) : s.type === 'segment' ? [[s.a, s.b]] : [[s.point, s.point]];
  let best = { from: a.type === 'point' ? a.point : { x: 0, y: 0 }, to: b.type === 'point' ? b.point : { x: 0, y: 0 }, distance: Infinity };
  for (const [p1, p2] of segs(a)) {
    for (const [q1, q2] of segs(b)) {
      const c = closestPointsBetweenSegments(p1, p2, q1, q2);
      if (c.distance < best.distance) best = { from: c.onP, to: c.onQ, distance: c.distance };
    }
  }
  return best;
}

export type Side = 'front' | 'back' | 'left' | 'right';

/** Local face (a, b) and outward normal of a w × d footprint centered at (ox, oy). Local +y = front. */
export function localFace(w: number, d: number, side: Side, ox = 0, oy = 0): { a: Point; b: Point; normal: Point } {
  const hw = w / 2;
  const hd = d / 2;
  switch (side) {
    case 'front':
      return { a: { x: ox - hw, y: oy + hd }, b: { x: ox + hw, y: oy + hd }, normal: { x: 0, y: 1 } };
    case 'back':
      return { a: { x: ox + hw, y: oy - hd }, b: { x: ox - hw, y: oy - hd }, normal: { x: 0, y: -1 } };
    case 'left':
      return { a: { x: ox - hw, y: oy - hd }, b: { x: ox - hw, y: oy + hd }, normal: { x: -1, y: 0 } };
    case 'right':
      return { a: { x: ox + hw, y: oy + hd }, b: { x: ox + hw, y: oy - hd }, normal: { x: 1, y: 0 } };
  }
}

/** Segments that block floor clearance: walls, floor objects, vehicles, floor architecture. */
export function floorObstacles(project: Project, scenario: Scenario, exclude?: EntityRef): Array<[Point, Point]> {
  const segs: Array<[Point, Point]> = [];
  const g = roomGeometry(project.room);
  if (g.polygon.length >= 3) segs.push(...polygonSegments(g.polygon));
  for (const o of scenario.objects) {
    if (o.hidden || o.mount !== 'floor' || (exclude?.kind === 'object' && exclude.id === o.id)) continue;
    segs.push(...polygonSegments(objectFootprint(resolveObject(project, o))));
  }
  for (const v of scenario.vehicles) {
    if (v.hidden || (exclude?.kind === 'vehicle' && exclude.id === v.id)) continue;
    segs.push(...polygonSegments(vehicleBody(vehicleGeomSpec(v), vehiclePose(v))));
  }
  for (const f of project.architecture) {
    if (f.hidden || OPENING_KINDS.has(f.kind) || OVERHEAD_KINDS.has(f.kind) || (exclude?.kind === 'feature' && exclude.id === f.id)) continue;
    const fp = featureFootprint(project.room, f);
    if (fp.length >= 3) segs.push(...polygonSegments(fp));
  }
  return segs;
}

/** Clear floor distance in front of one face of an object. */
export function objectFaceClearance(project: Project, scenario: Scenario, objectId: string, side: Side): { from: Point; to: Point; distance: number } | null {
  const o = findObject(scenario, objectId);
  if (!o) return null;
  const r = resolveObject(project, o);
  const f = localFace(r.footprint.width, r.footprint.depth, side, r.footprint.offsetX ?? 0, r.footprint.offsetY ?? 0);
  const a = localToWorld(r.pose, f.a);
  const b = localToWorld(r.pose, f.b);
  const n = rotate(f.normal, r.pose.rotation);
  const c = faceClearance(a, b, n, floorObstacles(project, scenario, { kind: 'object', id: objectId }));
  return Number.isFinite(c.distance) ? { from: c.from, to: c.to, distance: c.distance } : null;
}

export interface ResolvedMeasurement {
  measurement: Measurement;
  a: Point;
  b: Point;
  c?: Point;
  /** mm for linear kinds, degrees for angular. */
  value: number;
  /** Label to show (user label, or "A → B" for anchored measurements). */
  title: string;
  /** False when an anchor no longer exists (stored points are shown). */
  live: boolean;
}

/** Interior angle at `a` between a→b and a→c, degrees in [0, 180]. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const d = Math.abs(angleOf(sub(b, a)) - angleOf(sub(c, a))) % 360;
  return d > 180 ? 360 - d : d;
}

export function resolveMeasurement(project: Project, scenario: Scenario, m: Measurement): ResolvedMeasurement {
  const sa = m.anchorA ? entityShape(project, scenario, m.anchorA) : null;
  const sb = m.anchorB ? entityShape(project, scenario, m.anchorB) : null;
  let a = m.a;
  let b = m.b;
  let live = (!m.anchorA || !!sa) && (!m.anchorB || !!sb);
  const names = () => {
    const na = m.anchorA ? entityName(project, scenario, m.anchorA) : null;
    const nb = m.anchorB ? entityName(project, scenario, m.anchorB) : null;
    return na && nb ? `${na} → ${nb}` : (na ?? nb ?? '');
  };
  if (m.kind === 'angular') {
    if (sa?.type === 'point') a = sa.point;
    const c = m.c ?? m.b;
    return { measurement: m, a, b, c, value: angleAt(a, b, c), title: m.label ?? '', live };
  }
  if (m.kind === 'clearance' && m.anchorA?.kind === 'object' && m.side) {
    const c = objectFaceClearance(project, scenario, m.anchorA.id, m.side);
    if (c) return { measurement: m, a: c.from, b: c.to, value: c.distance, title: m.label ?? `${names()} ${m.side} clearance`, live };
    live = false;
  } else if (sa && sb) {
    const c = closestBetweenShapes(sa, sb);
    a = c.from;
    b = c.to;
  } else {
    if (sa?.type === 'point') a = sa.point;
    if (sb?.type === 'point') b = sb.point;
  }
  return { measurement: m, a, b, value: distance(a, b), title: m.label ?? names(), live };
}
