/**
 * Entity adapters for every built-in selectable kind (see `EntityAdapter` in @/app/registry).
 * They make drag, rotate, nudge, marquee, duplicate, copy/paste, delete, lock/hide, alignment and
 * fit-to-selection work uniformly across objects, vehicles, fixtures, zones and measurements.
 */
import { entityAdapters, type EntityAdapter, type EntityContext, type EntityPatch } from '@/app/registry';
import type { AppCommand } from '@/domain/commands';
import { entityShape } from '@/domain/measure';
import { circlePolygon, featureFootprint, findDefinition, findObject, objectFootprint, resolveObject, resolvePlacement, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import {
  OPENING_KINDS,
  type ArchitecturalFeature,
  type ElectricalPoint,
  type LayerId,
  type LightingFixture,
  type Measurement,
  type PlacedObject,
  type Placement,
  type Vehicle,
  type WorkflowZone,
} from '@/domain/schema';
import { quantize } from '@/domain/units';
import {
  add,
  clamp,
  localPolygonToWorld,
  localRect,
  normalize,
  normalizeAngle,
  perp,
  projectOntoWall,
  rotateAround,
  sub,
  vehicleBody,
  type Point,
  type Polygon,
} from '@/geometry';

const q = quantize;
const rot = (r: number) => Math.round(normalizeAngle(r) * 1e6) / 1e6;

// ───────────── objects ─────────────

function activePose(o: PlacedObject) {
  return o.mobility === 'mobile' && o.activePosition === 'working' && o.working ? { ...o.working, working: true as const } : { x: o.x, y: o.y, rotation: o.rotation, working: false as const };
}

const objectAdapter: EntityAdapter = {
  id: 'object',
  kind: 'object',
  ids: (c) => c.scenario.objects.map((o) => o.id),
  order: 10,
  exists: (c, id) => !!findObject(c.scenario, id),
  name: (c, id) => {
    const o = findObject(c.scenario, id);
    return o ? (o.label ?? o.name) : 'object';
  },
  outline: (c, id) => {
    const o = findObject(c.scenario, id);
    return o ? objectFootprint(resolveObject(c.project, o)) : undefined;
  },
  layer: (c, id) => {
    const o = findObject(c.scenario, id);
    return o ? resolveObject(c.project, o).layer : undefined;
  },
  locked: (c, id) => !!findObject(c.scenario, id)?.locked,
  hidden: (c, id) => !!findObject(c.scenario, id)?.hidden,
  marquee: true,
  translate(c, id, d) {
    const o = findObject(c.scenario, id);
    if (!o) return null;
    const p = activePose(o);
    return p.working ? { working: { x: p.x + d.x, y: p.y + d.y, rotation: p.rotation } } : { x: o.x + d.x, y: o.y + d.y };
  },
  rotate(c, id, pivot, deg) {
    const o = findObject(c.scenario, id);
    if (!o) return null;
    const p = activePose(o);
    const center = rotateAround({ x: p.x, y: p.y }, pivot, deg);
    const pose = { x: center.x, y: center.y, rotation: rot(p.rotation + deg) };
    return p.working ? { working: pose } : pose;
  },
  commit(c, id, patch) {
    const o = findObject(c.scenario, id);
    if (!o) return [];
    const cmds: AppCommand[] = [];
    if (patch.width !== undefined || patch.depth !== undefined) {
      cmds.push({ type: 'object.update', payload: { id, patch: { width: q((patch.width as number) ?? o.width), depth: q((patch.depth as number) ?? o.depth) } } });
    }
    const w = patch.working as { x: number; y: number; rotation: number } | undefined;
    if (w) cmds.push({ type: 'object.move', payload: { moves: [{ id, x: w.x, y: w.y, rotation: w.rotation }], position: 'working' } });
    else if (patch.x !== undefined || patch.y !== undefined || patch.rotation !== undefined) {
      cmds.push({
        type: 'object.move',
        payload: { moves: [{ id, x: (patch.x as number) ?? o.x, y: (patch.y as number) ?? o.y, rotation: (patch.rotation as number) ?? o.rotation }] },
      });
    }
    return cmds;
  },
  remove: (_c, ids) => [{ type: 'object.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'object.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy(c, id) {
    const o = findObject(c.scenario, id);
    if (!o) return undefined;
    return { object: JSON.parse(JSON.stringify(o)) as PlacedObject, definition: JSON.parse(JSON.stringify(findDefinition(c.project, o.definitionId) ?? null)) };
  },
  paste(_c, data, newId, off) {
    const { object, definition } = data as { object: PlacedObject; definition: unknown };
    const copy: PlacedObject = { ...object, id: newId, x: q(object.x + off.x), y: q(object.y + off.y), locked: false };
    delete copy.groupId;
    delete copy.wallId;
    if (copy.working) copy.working = { ...copy.working, x: q(copy.working.x + off.x), y: q(copy.working.y + off.y) };
    return [{ type: 'object.add', payload: { objects: [copy], definitions: definition ? [definition as never] : [] } }];
  },
};

// ───────────── vehicles ─────────────

const vehicleOf = (c: EntityContext, id: string): Vehicle | undefined => c.scenario.vehicles.find((v) => v.id === id);
const vehicleAdapter: EntityAdapter = {
  id: 'vehicle',
  kind: 'vehicle',
  ids: (c) => c.scenario.vehicles.map((v) => v.id),
  order: 20,
  exists: (c, id) => !!vehicleOf(c, id),
  name: (c, id) => vehicleOf(c, id)?.name ?? 'vehicle',
  outline: (c, id) => {
    const v = vehicleOf(c, id);
    return v ? vehicleBody(vehicleGeomSpec(v), vehiclePose(v)) : undefined;
  },
  layer: () => 'vehicle',
  locked: (c, id) => !!vehicleOf(c, id)?.locked,
  hidden: (c, id) => !!vehicleOf(c, id)?.hidden,
  marquee: true,
  translate: (c, id, d) => {
    const v = vehicleOf(c, id);
    return v ? { x: v.x + d.x, y: v.y + d.y } : null;
  },
  rotate(c, id, pivot, deg) {
    const v = vehicleOf(c, id);
    if (!v) return null;
    const p = rotateAround(v, pivot, deg);
    return { x: p.x, y: p.y, rotation: rot(v.rotation + deg) };
  },
  commit: (_c, id, patch) => [{ type: 'vehicle.update', payload: { id, patch: roundPose(patch) as Partial<Vehicle> } }],
  remove: (_c, ids) => [{ type: 'vehicle.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'vehicle.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy: (c, id) => JSON.parse(JSON.stringify(vehicleOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const v = data as Vehicle;
    return [{ type: 'vehicle.add', payload: { items: [{ ...v, id: newId, x: q(v.x + off.x), y: q(v.y + off.y), locked: false }] } }];
  },
};

function roundPose(patch: EntityPatch): EntityPatch {
  const out: EntityPatch = { ...patch };
  if (typeof out.x === 'number') out.x = q(out.x);
  if (typeof out.y === 'number') out.y = q(out.y);
  if (typeof out.rotation === 'number') out.rotation = rot(out.rotation);
  return out;
}

// ───────────── lights ─────────────

const lightOf = (c: EntityContext, id: string): LightingFixture | undefined => c.scenario.lights.find((l) => l.id === id);
const lightAdapter: EntityAdapter = {
  id: 'light',
  kind: 'light',
  ids: (c) => c.scenario.lights.map((l) => l.id),
  order: 30,
  exists: (c, id) => !!lightOf(c, id),
  name: (c, id) => lightOf(c, id)?.name ?? 'light',
  outline: (c, id) => {
    const l = lightOf(c, id);
    if (!l) return undefined;
    return l.kind === 'shop-light' ? localPolygonToWorld(l, localRect(l.length, l.width + 40)) : circlePolygon(l, Math.max(l.length, l.width) / 2);
  },
  layer: () => 'lighting',
  locked: (c, id) => !!lightOf(c, id)?.locked,
  hidden: (c, id) => !!lightOf(c, id)?.hidden,
  marquee: true,
  translate: (c, id, d) => {
    const l = lightOf(c, id);
    return l ? { x: l.x + d.x, y: l.y + d.y } : null;
  },
  rotate(c, id, pivot, deg) {
    const l = lightOf(c, id);
    if (!l) return null;
    const p = rotateAround(l, pivot, deg);
    return { x: p.x, y: p.y, rotation: rot(l.rotation + deg) };
  },
  commit: (_c, id, patch) => [{ type: 'light.update', payload: { id, patch: roundPose(patch) as Partial<LightingFixture> } }],
  remove: (_c, ids) => [{ type: 'light.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'light.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy: (c, id) => JSON.parse(JSON.stringify(lightOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const l = data as LightingFixture;
    return [{ type: 'light.add', payload: { items: [{ ...l, id: newId, x: q(l.x + off.x), y: q(l.y + off.y), locked: false }] } }];
  },
};

// ───────────── zones ─────────────

const zoneOf = (c: EntityContext, id: string): WorkflowZone | undefined => c.scenario.zones.find((z) => z.id === id);
const zoneAdapter: EntityAdapter = {
  id: 'zone',
  kind: 'zone',
  ids: (c) => c.scenario.zones.map((z) => z.id),
  order: 60,
  exists: (c, id) => !!zoneOf(c, id),
  name: (c, id) => zoneOf(c, id)?.name ?? 'zone',
  outline: (c, id) => zoneOf(c, id)?.points,
  layer: () => 'zones',
  locked: (c, id) => !!zoneOf(c, id)?.locked,
  hidden: (c, id) => !!zoneOf(c, id)?.hidden,
  marquee: 'contain',
  translate: (c, id, d) => {
    const z = zoneOf(c, id);
    return z ? { points: z.points.map((p) => add(p, d)) } : null;
  },
  rotate: (c, id, pivot, deg) => {
    const z = zoneOf(c, id);
    return z ? { points: z.points.map((p) => rotateAround(p, pivot, deg)) } : null;
  },
  commit: (_c, id, patch) => [
    { type: 'zone.update', payload: { id, patch: { points: (patch.points as Point[]).map((p) => ({ x: q(p.x), y: q(p.y) })) } } },
  ],
  remove: (_c, ids) => [{ type: 'zone.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'zone.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy: (c, id) => JSON.parse(JSON.stringify(zoneOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const z = data as WorkflowZone;
    return [{ type: 'zone.add', payload: { items: [{ ...z, id: newId, name: `${z.name} copy`, points: z.points.map((p) => ({ x: q(p.x + off.x), y: q(p.y + off.y) })), locked: false }] } }];
  },
};

// ───────────── measurements ─────────────

const measOf = (c: EntityContext, id: string): Measurement | undefined => c.scenario.measurements.find((m) => m.id === id);
const measurementAdapter: EntityAdapter = {
  id: 'measurement',
  kind: 'measurement',
  ids: (c) => c.scenario.measurements.map((m) => m.id),
  order: 70,
  exists: (c, id) => !!measOf(c, id),
  name: (c, id) => measOf(c, id)?.label || 'measurement',
  outline: (c, id) => {
    const m = measOf(c, id);
    if (!m) return undefined;
    const pts = [m.a, m.b, ...(m.c ? [m.c] : [])];
    return pts;
  },
  layer: () => 'measurements',
  hidden: (c, id) => !!measOf(c, id)?.hidden,
  marquee: 'contain',
  translate(c, id, d) {
    const m = measOf(c, id);
    if (!m) return null;
    if (m.anchorA || m.anchorB || m.kind === 'clearance') {
      // Anchored dimensions follow their entities; dragging slides the dimension line sideways.
      const n = perp(normalize(sub(m.b, m.a)));
      return { offset: m.offset + (d.x * n.x + d.y * n.y) };
    }
    return { a: add(m.a, d), b: add(m.b, d), ...(m.c ? { c: add(m.c, d) } : {}) };
  },
  commit: (_c, id, patch) => {
    const p: Record<string, unknown> = { ...patch };
    for (const k of ['a', 'b', 'c'] as const) if (p[k]) p[k] = { x: q((p[k] as Point).x), y: q((p[k] as Point).y) };
    if (typeof p.offset === 'number') p.offset = q(p.offset);
    return [{ type: 'measurement.update', payload: { id, patch: p as Partial<Measurement> } }];
  },
  remove: (_c, ids) => [{ type: 'measurement.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => (flag === 'hidden' ? ids.map((id) => ({ type: 'measurement.update', payload: { id, patch: { hidden: value } } }) as AppCommand) : []),
  copy: (c, id) => JSON.parse(JSON.stringify(measOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const m = data as Measurement;
    return [
      {
        type: 'measurement.add',
        payload: { items: [{ ...m, id: newId, a: add(m.a, off), b: add(m.b, off), ...(m.c ? { c: add(m.c, off) } : {}), anchorA: undefined, anchorB: undefined }] },
      },
    ];
  },
};

// ───────────── wall-hosted fixtures (architecture, electrical) ─────────────

/**
 * Move a placement by `delta`. Free placements translate; wall placements slide along their wall and
 * hop to another wall when the moved center is closer to it (openings always stay on a wall).
 */
export function movePlacement(c: EntityContext, placement: Placement, width: number, depth: number, delta: Point): Placement {
  if (placement.type === 'free') return { ...placement, x: placement.x + delta.x, y: placement.y + delta.y };
  const room = c.project.room;
  const { pose } = resolvePlacement(room, placement, width, depth);
  const target = add(pose, delta);
  const g = roomGeometry(room);
  let best: { wallId: string; offset: number; d: number } | null = null;
  g.walls.forEach((w, i) => {
    const pr = projectOntoWall(target, w);
    const along = clamp(pr.offset, Math.min(width / 2, w.length / 2), Math.max(w.length - width / 2, w.length / 2));
    const foot = add(w.a, { x: w.dir.x * along, y: w.dir.y * along });
    const d = Math.hypot(target.x - foot.x - w.inward.x * (depth / 2), target.y - foot.y - w.inward.y * (depth / 2));
    if (!best || d < best.d) best = { wallId: room.walls[i]!.id, offset: along, d };
  });
  if (!best) return placement;
  const b = best as { wallId: string; offset: number };
  return { type: 'wall', wallId: b.wallId, offset: b.offset };
}

function rotatePlacement(placement: Placement, pivot: Point, deg: number): Placement | null {
  if (placement.type !== 'free') return null;
  const p = rotateAround(placement, pivot, deg);
  return { ...placement, x: p.x, y: p.y, rotation: rot(placement.rotation + deg) };
}

const qPlacement = (p: Placement): Placement => (p.type === 'free' ? { ...p, x: q(p.x), y: q(p.y), rotation: rot(p.rotation) } : { ...p, offset: q(p.offset) });

const featureOf = (c: EntityContext, id: string): ArchitecturalFeature | undefined => c.project.architecture.find((f) => f.id === id);
const featureAdapter: EntityAdapter = {
  id: 'feature',
  kind: 'feature',
  ids: (c) => c.project.architecture.map((f) => f.id),
  order: 40,
  exists: (c, id) => !!featureOf(c, id),
  name: (c, id) => featureOf(c, id)?.name ?? 'feature',
  outline: (c, id) => {
    const f = featureOf(c, id);
    if (!f) return undefined;
    const fp = featureFootprint(c.project.room, f);
    return fp.length ? fp : undefined;
  },
  layer: () => 'architecture',
  locked: (c, id) => !!featureOf(c, id)?.locked,
  hidden: (c, id) => !!featureOf(c, id)?.hidden,
  marquee: true,
  translate(c, id, d) {
    const f = featureOf(c, id);
    if (!f) return null;
    const placement = movePlacement(c, f.placement, f.width, f.depth, d);
    if (OPENING_KINDS.has(f.kind) && placement.type !== 'wall') return null;
    return { placement };
  },
  rotate(c, id, pivot, deg) {
    const f = featureOf(c, id);
    const p = f ? rotatePlacement(f.placement, pivot, deg) : null;
    return p ? { placement: p } : null;
  },
  commit: (_c, id, patch) => [{ type: 'feature.update', payload: { id, patch: { placement: qPlacement(patch.placement as Placement) } } }],
  remove: (_c, ids) => [{ type: 'feature.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'feature.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy: (c, id) => JSON.parse(JSON.stringify(featureOf(c, id) ?? null)),
  paste: (c, data, newId, off) => {
    const f = data as ArchitecturalFeature;
    const placement = f.placement.type === 'wall' && !c.project.room.walls.some((w) => w.id === (f.placement as { wallId: string }).wallId) ? null : movePlacement(c, f.placement, f.width, f.depth, off);
    if (!placement) return [];
    return [{ type: 'feature.add', payload: { items: [{ ...f, id: newId, placement: qPlacement(placement), locked: false }] } }];
  },
};

const elecOf = (c: EntityContext, id: string): ElectricalPoint | undefined => c.project.electrical.find((e) => e.id === id);
const ELEC_DEPTH = 20;
const electricalAdapter: EntityAdapter = {
  id: 'electrical',
  kind: 'electrical',
  ids: (c) => c.project.electrical.map((e) => e.id),
  order: 50,
  exists: (c, id) => !!elecOf(c, id),
  name: (c, id) => elecOf(c, id)?.label || 'electrical point',
  outline: (c, id) => {
    const s = entityShape(c.project, c.scenario, { kind: 'electrical', id });
    return s?.type === 'point' ? circlePolygon(s.point, 90, 8) : undefined;
  },
  layer: () => 'electrical',
  locked: (c, id) => !!elecOf(c, id)?.locked,
  hidden: (c, id) => !!elecOf(c, id)?.hidden,
  marquee: true,
  translate(c, id, d) {
    const e = elecOf(c, id);
    return e ? { placement: movePlacement(c, e.placement, e.width, ELEC_DEPTH, d) } : null;
  },
  rotate(c, id, pivot, deg) {
    const e = elecOf(c, id);
    const p = e ? rotatePlacement(e.placement, pivot, deg) : null;
    return p ? { placement: p } : null;
  },
  commit: (_c, id, patch) => [{ type: 'electrical.update', payload: { id, patch: { placement: qPlacement(patch.placement as Placement) } } }],
  remove: (_c, ids) => [{ type: 'electrical.delete', payload: { ids } }],
  setFlag: (_c, ids, flag, value) => ids.map((id) => ({ type: 'electrical.update', payload: { id, patch: { [flag]: value } } }) as AppCommand),
  copy: (c, id) => JSON.parse(JSON.stringify(elecOf(c, id) ?? null)),
  paste: (c, data, newId, off) => {
    const e = data as ElectricalPoint;
    if (e.placement.type === 'wall' && !c.project.room.walls.some((w) => w.id === (e.placement as { wallId: string }).wallId)) return [];
    return [{ type: 'electrical.add', payload: { items: [{ ...e, id: newId, placement: qPlacement(movePlacement(c, e.placement, e.width, ELEC_DEPTH, off)), locked: false }] } }];
  },
};

// ───────────── room: walls & corners (geometry edits go through room commands) ─────────────

const wallAdapter: EntityAdapter = {
  id: 'wall',
  kind: 'wall',
  ids: (c) => c.project.room.walls.map((w) => w.id),
  order: 80,
  exists: (c, id) => c.project.room.walls.some((w) => w.id === id),
  name: (c, id) => {
    const g = roomGeometry(c.project.room);
    const i = g.wallIndex.get(id);
    return (i !== undefined && g.walls[i]?.name) || 'wall';
  },
  outline: (c, id) => {
    const g = roomGeometry(c.project.room);
    const i = g.wallIndex.get(id);
    const w = i === undefined ? undefined : g.walls[i];
    if (!w) return undefined;
    const t = g.thickness[i!] ?? 0;
    return [w.a, w.b, add(w.b, { x: w.outward.x * t, y: w.outward.y * t }), add(w.a, { x: w.outward.x * t, y: w.outward.y * t })];
  },
  layer: () => 'architecture',
  marquee: false,
};

const vertexAdapter: EntityAdapter = {
  id: 'vertex',
  kind: 'vertex',
  ids: (c) => c.project.room.vertices.map((v) => v.id),
  order: 90,
  exists: (c, id) => c.project.room.vertices.some((v) => v.id === id),
  name: () => 'corner',
  outline: (c, id) => {
    const v = c.project.room.vertices.find((x) => x.id === id);
    return v ? circlePolygon(v, 60, 8) : undefined;
  },
  layer: () => 'architecture',
  marquee: false,
  remove: (_c, ids) => ids.map((vertexId) => ({ type: 'room.deleteVertex', payload: { vertexId } }) as AppCommand),
};

for (const a of [objectAdapter, vehicleAdapter, lightAdapter, zoneAdapter, measurementAdapter, featureAdapter, electricalAdapter, wallAdapter, vertexAdapter]) {
  entityAdapters.register(a);
}

// ───────────── helpers used across the editor ─────────────

export function adapterFor(kind: string): EntityAdapter | undefined {
  return entityAdapters.get(kind);
}

/** Layer an entity belongs to (for layer visibility / locking). */
export function entityLayer(c: EntityContext, kind: string, id: string): LayerId | undefined {
  return adapterFor(kind)?.layer?.(c, id);
}

export type { Polygon };
