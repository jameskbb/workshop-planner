/**
 * Smart Layout Assistant: heuristic optimizer (pure; runs in a Web Worker in the app).
 *
 * Simulated annealing over the movable items of one layout. Moves: random translations, snapping an
 * item's back against a wall (rotated to face into the room), sliding along a wall, 90° rotations,
 * swapping two items, and moving a mobile tool's working position. Hard constraints (never violated
 * by a returned candidate): room bounds, physical collisions (3D-aware), people-door swings, locked
 * items (never moved) and fixed architecture. Soft terms are the user's priorities; each is a
 * normalized 0…1 penalty with a plain-language label so the result can be explained.
 *
 * Determinism: a seeded PRNG drives everything, so the same project + options give the same result.
 */
import { featureFootprint, getScenario, resolveObject, roomGeometry, vehicleGeomSpec } from '@/domain/resolve';
import type { AppCommand } from '@/domain/commands/registry';
import type { PlacedObject, Project, Scenario } from '@/domain/schema';
import {
  bbox,
  clearanceBands,
  containsPoint,
  doorSwingPolygon,
  localRect,
  localToWorld,
  pointOnWall,
  pointSegmentDistance,
  polygonContainsPolygon,
  rotationFacingAwayFromWall,
  satConvex,
  signedArea,
  zoneLocalPolygon,
  type BBox,
  type LocalFootprint,
  type Point,
  type Polygon,
  type Pose,
  type WallGeom,
} from '@/geometry';

// ───────────────────────────── priorities & presets ─────────────────────────────

export const PRIORITY_KEYS = ['parking', 'woodworking', 'storage', 'openFloor', 'toolAccess', 'assembly', 'mobileMoves', 'walkways'] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];
export type Priorities = Record<PriorityKey, number>;

export const PRIORITY_INFO: Record<PriorityKey, { label: string; hint: string }> = {
  parking: { label: 'Vehicle parking', hint: 'Desired clearance around vehicles, doors that open, a clear drive-in lane.' },
  woodworking: { label: 'Woodworking', hint: 'Tool infeed/outfeed/operator zones clear; short workflow steps.' },
  storage: { label: 'Storage', hint: 'Cabinets, shelving and racks against walls.' },
  openFloor: { label: 'Open floor space', hint: 'Items pushed to the perimeter, leaving one open middle.' },
  toolAccess: { label: 'Easy tool access', hint: 'Room to open drawers and doors and reach storage fronts.' },
  assembly: { label: 'Assembly space', hint: 'Clear floor in front of benches and assembly tables.' },
  mobileMoves: { label: 'Minimal moving of mobile tools', hint: 'Working positions close to where mobile tools are parked.' },
  walkways: { label: 'Clear walkways', hint: 'No narrow slots between items; doorways kept clear.' },
};

export const DEFAULT_PRIORITIES: Priorities = { parking: 5, woodworking: 5, storage: 5, openFloor: 5, toolAccess: 5, assembly: 5, mobileMoves: 5, walkways: 5 };

export const CANDIDATE_KINDS = ['parking', 'workshop', 'balanced', 'open-space'] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const CANDIDATE_PRESETS: Record<CandidateKind, { label: string; description: string; focus: PriorityKey[] }> = {
  parking: { label: 'Parking Priority', description: 'Vehicle clearance and walkways first; tools fit around the car.', focus: ['parking', 'walkways'] },
  workshop: { label: 'Workshop Priority', description: 'Tool clearances, tool access and assembly space first.', focus: ['woodworking', 'toolAccess', 'assembly'] },
  balanced: { label: 'Balanced', description: 'Your priority sliders exactly as set.', focus: [] },
  'open-space': { label: 'Maximum Open Space', description: 'Everything to the perimeter for the biggest open floor.', focus: ['openFloor', 'walkways'] },
};

/** Priorities for a candidate: focus sliders at maximum, the rest at half the user's setting. */
export function presetPriorities(kind: CandidateKind, user: Priorities): Priorities {
  const focus = CANDIDATE_PRESETS[kind].focus;
  if (focus.length === 0) return { ...user };
  const out = {} as Priorities;
  for (const k of PRIORITY_KEYS) out[k] = focus.includes(k) ? 10 : user[k] * 0.5;
  return out;
}

// ───────────────────────────── terms ─────────────────────────────

export const TERM_KEYS = ['vehicle', 'doorway', 'toolClearance', 'workflow', 'storage', 'openFloor', 'access', 'assembly', 'mobile', 'pinch', 'displacement'] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export const TERM_INFO: Record<TermKey, { label: string; unit: string }> = {
  vehicle: { label: 'Vehicle clearance, door swings and drive-in lane blocked', unit: 'share of that area blocked' },
  doorway: { label: 'Garage-door opening blocked', unit: 'share of a 2′ band blocked' },
  toolClearance: { label: 'Tool working zones blocked', unit: 'share of zone area blocked' },
  workflow: { label: 'Workflow step distance', unit: 'relative to the room diagonal' },
  storage: { label: 'Storage away from walls', unit: 'average gap, relative to 2′' },
  openFloor: { label: 'Items away from the perimeter', unit: 'area-weighted gap, relative to 5′' },
  access: { label: 'Storage fronts / access zones blocked', unit: 'share of zone area blocked' },
  assembly: { label: 'Bench front / assembly space blocked', unit: 'share of that area blocked' },
  mobile: { label: 'Mobile tool travel (parked → working)', unit: 'average, relative to 10′' },
  pinch: { label: 'Narrow slots between items', unit: 'per item, relative to the aisle width' },
  displacement: { label: 'Distance moved from the current layout', unit: 'average, relative to the room diagonal' },
};

/** Term weights from priorities (0–10 sliders). */
export function termWeights(p: Priorities): Record<TermKey, number> {
  const w = (k: PriorityKey) => Math.max(0, Math.min(10, p[k])) / 10;
  return {
    vehicle: w('parking') * 1.2,
    doorway: 0.3 * w('parking') + 0.5 * w('walkways'),
    toolClearance: w('woodworking'),
    workflow: 0.6 * w('woodworking'),
    storage: 0.8 * w('storage'),
    openFloor: 0.8 * w('openFloor'),
    access: w('toolAccess'),
    assembly: w('assembly'),
    mobile: 0.8 * w('mobileMoves'),
    pinch: w('walkways'),
    displacement: 0.15,
  };
}

// ───────────────────────────── model ─────────────────────────────

type ZoneGroup = 'toolClearance' | 'access' | 'assembly';

interface ZoneModel {
  local: Polygon;
  area: number;
  group: ZoneGroup;
  /** Vertical band that must be clear. */
  bottom: number;
  top: number;
  samples: Point[];
}

interface Member {
  id: string;
  /** Pose relative to the unit pose. */
  local: Pose;
  fp: LocalFootprint;
  fpLocal: Polygon;
  bottom: number;
  top: number;
  category: string;
  floor: boolean;
  zones: ZoneModel[];
  area: number;
}

interface Unit {
  key: string;
  kind: 'object' | 'group' | 'vehicle';
  members: Member[];
  pose: Pose;
  start: Pose;
  movable: boolean;
  /** Working pose for a single mobile object with clearance zones. */
  working: Pose | null;
  startWorking: Pose | null;
  /** Largest half-extent (for move sizes). */
  radius: number;
  /** Distance from the unit center to its back edge / half width (for wall snapping). */
  back: number;
  halfWidth: number;
}

interface VehicleModel {
  unit: Unit;
  spec: ReturnType<typeof vehicleGeomSpec>;
  desired: { driver: number; passenger: number; front: number; rear: number };
}

interface Fixed {
  poly: Polygon;
  box: BBox;
  bottom: number;
  top: number;
}

interface Model {
  room: Polygon;
  roomBox: BBox;
  walls: WallGeom[];
  diag: number;
  aisle: number;
  units: Unit[];
  vehicles: VehicleModel[];
  fixed: Fixed[];
  /** People-door swing areas (hard keep-clear). */
  doorKeepClear: Fixed[];
  /** Garage-door opening bands (soft). */
  garageBands: Fixed[];
  relationships: Array<{ from: string; to: string; frequency: number }>;
}

const PERSON_HEIGHT = 1830;
const OVERLAP_TOL = 1;

function composePose(p: Pose, l: Pose): Pose {
  const c = localToWorld(p, { x: l.x, y: l.y });
  return { x: c.x, y: c.y, rotation: normDeg(p.rotation + l.rotation) };
}

function normDeg(d: number): number {
  const r = ((d % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : Math.round(r * 1e6) / 1e6;
}

function samplesOf(poly: Polygon): Point[] {
  const b = bbox(poly);
  const pts: Point[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const p = { x: b.minX + ((i + 0.5) / 5) * (b.maxX - b.minX), y: b.minY + ((j + 0.5) / 5) * (b.maxY - b.minY) };
      if (containsPoint(poly, p)) pts.push(p);
    }
  }
  return pts;
}

function polyArea(p: Polygon): number {
  return Math.abs(signedArea(p));
}

export interface OptimizeOptions {
  priorities: Priorities;
  /** Aisle width used for the "narrow slot" term (mm). Default 30". */
  aisleWidth?: number;
  seed?: number;
  /** Annealing iterations per candidate. Default 2500. */
  iterations?: number;
  candidates?: readonly CandidateKind[];
}

/** Build the optimization model of a scenario. Exported for tests. */
export function buildModel(project: Project, scenarioId: string, aisle: number): Model {
  const scenario = getScenario(project, scenarioId);
  const g = roomGeometry(project.room);
  const room = g.polygon;
  const roomBox = bbox(room);
  const diag = Math.hypot(roomBox.maxX - roomBox.minX, roomBox.maxY - roomBox.minY) || 1;
  const units: Unit[] = [];
  const fixed: Fixed[] = [];
  const lockedGroups = new Set(scenario.groups.filter((x) => x.locked).map((x) => x.id));

  const memberOf = (o: PlacedObject, unitPose: Pose): Member => {
    const r = resolveObject(project, o);
    const fp = r.footprint;
    const floor = o.mount === 'floor';
    const zones: ZoneModel[] = r.clearances.map((z) => {
      const local = zoneLocalPolygon(z.shape, fp);
      const group: ZoneGroup = r.category === 'work-surface' ? 'assembly' : r.category === 'stationary-tool' || r.category === 'dust-collection' ? 'toolClearance' : 'access';
      const feed = z.kind === 'infeed' || z.kind === 'outfeed';
      const bottom = r.elevated ? r.elevation - 50 : 0;
      const top = r.elevated ? r.elevation + r.height : feed ? r.elevation + r.height + 150 : PERSON_HEIGHT;
      return { local, area: polyArea(local), group, bottom, top, samples: samplesOf(local) };
    });
    // Benches without a front zone still need standing room: 30" in front.
    if (r.category === 'work-surface' && !r.clearances.some((z) => z.shape.type === 'side' && z.shape.side === 'front')) {
      const local = localRect(fp.width, 762, fp.offsetX ?? 0, (fp.offsetY ?? 0) + fp.depth / 2 + 381);
      zones.push({ local, area: polyArea(local), group: 'assembly', bottom: 0, top: PERSON_HEIGHT, samples: samplesOf(local) });
    }
    const parked = { x: o.x, y: o.y, rotation: o.rotation };
    const rel = worldToLocalPose(unitPose, parked);
    const fpLocal = localRect(fp.width, fp.depth, fp.offsetX ?? 0, fp.offsetY ?? 0);
    return { id: o.id, local: rel, fp, fpLocal, bottom: r.elevation, top: r.elevation + r.height, category: r.category, floor, zones, area: fp.width * fp.depth };
  };

  const visible = scenario.objects.filter((o) => !o.hidden);
  const grouped = new Map<string, PlacedObject[]>();
  for (const o of visible) {
    if (o.groupId) grouped.set(o.groupId, [...(grouped.get(o.groupId) ?? []), o]);
  }
  const done = new Set<string>();
  for (const o of visible) {
    if (done.has(o.id)) continue;
    if (o.groupId && (grouped.get(o.groupId)?.length ?? 0) > 1) {
      const list = grouped.get(o.groupId)!;
      list.forEach((m) => done.add(m.id));
      const cx = list.reduce((s, m) => s + m.x, 0) / list.length;
      const cy = list.reduce((s, m) => s + m.y, 0) / list.length;
      const pose = { x: cx, y: cy, rotation: 0 };
      const members = list.map((m) => memberOf(m, pose));
      const movable = !lockedGroups.has(o.groupId) && list.every((m) => !m.locked && m.mount === 'floor');
      units.push(makeUnit(`group:${o.groupId}`, 'group', members, pose, movable, null));
      continue;
    }
    done.add(o.id);
    const pose = { x: o.x, y: o.y, rotation: o.rotation };
    const m = memberOf(o, pose);
    const movable = !o.locked && o.mount === 'floor';
    const r = resolveObject(project, o);
    const working = o.mobility === 'mobile' && movable && r.clearances.length > 0 ? (o.working ? { ...o.working } : { ...pose }) : null;
    units.push(makeUnit(`object:${o.id}`, 'object', [m], pose, movable, working));
  }

  const vehicles: VehicleModel[] = [];
  for (const v of scenario.vehicles) {
    if (v.hidden) continue;
    const spec = vehicleGeomSpec(v);
    const pose = { x: v.x, y: v.y, rotation: v.rotation };
    // Mirrors are part of the car for collisions: the overlap analyzer checks body AND mirrors, so
    // a body-only box let the optimizer converge into a candidate its own final check rejected (R-010).
    const width = Math.max(v.width, v.mirrorsFolded ? (v.foldedMirrorWidth ?? v.width) : v.mirrorWidth);
    const fp = { width, depth: v.length };
    const member: Member = { id: v.id, local: { x: 0, y: 0, rotation: 0 }, fp, fpLocal: localRect(fp.width, fp.depth), bottom: 0, top: v.height, category: 'vehicle', floor: true, zones: [], area: fp.width * fp.depth };
    const unit = makeUnit(`vehicle:${v.id}`, 'vehicle', [member], pose, !v.locked, null);
    units.push(unit);
    vehicles.push({ unit, spec, desired: v.desiredClearance });
  }

  const doorKeepClear: Fixed[] = [];
  const garageBands: Fixed[] = [];
  for (const f of project.architecture) {
    if (f.hidden) continue;
    const isOpening = f.kind === 'door' || f.kind === 'double-door' || f.kind === 'garage-door' || f.kind === 'window';
    if (!isOpening) {
      const overhead = f.kind === 'ceiling-obstruction' || f.kind === 'ceiling-beam' || f.kind === 'attic-ladder' || f.kind === 'hose-bib';
      if (overhead) continue;
      const poly = featureFootprint(project.room, f);
      if (poly.length >= 3) fixed.push({ poly, box: bbox(poly), bottom: f.elevation, top: f.elevation + f.height });
      continue;
    }
    if (f.placement.type !== 'wall' || f.kind === 'window') continue;
    const wi = g.wallIndex.get(f.placement.wallId);
    const wall = wi === undefined ? undefined : g.walls[wi];
    if (!wall) continue;
    const s0 = f.placement.offset - f.width / 2;
    const s1 = f.placement.offset + f.width / 2;
    if (f.kind === 'garage-door') {
      const poly = [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, 610), pointOnWall(wall, s0, 610)];
      garageBands.push({ poly, box: bbox(poly), bottom: 0, top: PERSON_HEIGHT });
    } else {
      const depth = Math.max(f.width, 800);
      const poly = [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, depth), pointOnWall(wall, s0, depth)];
      doorKeepClear.push({ poly, box: bbox(poly), bottom: 0, top: PERSON_HEIGHT });
    }
  }

  const relationships = scenario.relationships.filter((r) => r.kind === 'workflow').map((r) => ({ from: r.fromId, to: r.toId, frequency: r.frequency }));
  return { room, roomBox, walls: g.walls, diag, aisle, units, vehicles, fixed, doorKeepClear, garageBands, relationships };
}

function worldToLocalPose(frame: Pose, p: Pose): Pose {
  const dx = p.x - frame.x;
  const dy = p.y - frame.y;
  const a = (-frame.rotation * Math.PI) / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a), rotation: normDeg(p.rotation - frame.rotation) };
}

function makeUnit(key: string, kind: Unit['kind'], members: Member[], pose: Pose, movable: boolean, working: Pose | null): Unit {
  let radius = 0;
  let back = 0;
  let halfWidth = 0;
  for (const m of members) {
    for (const c of m.fpLocal) {
      const p = localToWorld({ ...m.local }, c);
      radius = Math.max(radius, Math.hypot(p.x, p.y));
      back = Math.max(back, -p.y);
      halfWidth = Math.max(halfWidth, Math.abs(p.x));
    }
  }
  return { key, kind, members, pose: { ...pose }, start: { ...pose }, movable, working, startWorking: working ? { ...working } : null, radius, back, halfWidth };
}

// ───────────────────────────── evaluation ─────────────────────────────

interface Placed {
  unit: Unit;
  member: Member;
  pose: Pose;
  poly: Polygon;
  box: BBox;
}

function placeMembers(unit: Unit, pose: Pose = unit.pose): Placed[] {
  return unit.members.map((m) => {
    const wp = composePose(pose, m.local);
    const poly = m.fpLocal.map((c) => localToWorld(wp, c));
    return { unit, member: m, pose: wp, poly, box: bbox(poly) };
  });
}

const boxesOverlap = (a: BBox, b: BBox, pad = 0) => a.minX < b.maxX + pad && b.minX < a.maxX + pad && a.minY < b.maxY + pad && b.minY < a.maxY + pad;
const vOverlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - 1 && b0 < a1 - 1;

/** Area of `subject` ∩ `clip` where clip is CONVEX (Sutherland–Hodgman). */
export function convexClipArea(subject: Polygon, clip: Polygon): number {
  if (subject.length < 3 || clip.length < 3) return 0;
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inside = (p: Point) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-9;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j + input.length - 1) % input.length]!;
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(intersectLines(prev, cur, a, b));
        out.push(cur);
      } else if (pi) out.push(intersectLines(prev, cur, a, b));
    }
  }
  return out.length >= 3 ? polyArea(out) : 0;
}

function intersectLines(p1: Point, p2: Point, a: Point, b: Point): Point {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return p2;
  const t = ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / den;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

function wallGap(poly: Polygon, walls: WallGeom[]): number {
  let best = Infinity;
  for (const w of walls) for (const c of poly) best = Math.min(best, pointSegmentDistance(c, w.a, w.b));
  return best;
}

function polyGap(a: Polygon, b: Polygon): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!;
      best = Math.min(best, pointSegmentDistance(a0, b0, b[(j + 1) % b.length]!), pointSegmentDistance(b0, a0, a[(i + 1) % a.length]!));
    }
  }
  return best;
}

export interface Evaluation {
  violations: number;
  /** Human descriptions of hard violations (first few). */
  problems: string[];
  terms: Record<TermKey, number>;
}

/** Blocked share of a world polygon (outside room + covered by obstacles). */
function blockedArea(poly: Polygon, samples: Point[], area: number, room: Polygon, obstacles: Array<{ poly: Polygon; box: BBox }>): number {
  if (area <= 0) return 0;
  let outside = 0;
  if (samples.length) {
    for (const s of samples) if (!containsPoint(room, s)) outside++;
  }
  let blocked = samples.length ? (outside / samples.length) * area : 0;
  const box = bbox(poly);
  for (const o of obstacles) {
    if (!boxesOverlap(box, o.box)) continue;
    blocked += convexClipArea(poly, o.poly);
  }
  return Math.min(area, blocked);
}

export function evaluate(model: Model, names?: Map<string, string>): Evaluation {
  const placed = model.units.flatMap((u) => placeMembers(u));
  const problems: string[] = [];
  let violations = 0;
  const name = (id: string) => names?.get(id) ?? 'An item';
  const floorPlaced = placed.filter((p) => p.member.floor);

  // Hard: room bounds.
  for (const p of floorPlaced) {
    if (!p.unit.movable) continue;
    if (!polygonContainsPolygon(model.room, p.poly, 0.5)) {
      violations++;
      if (problems.length < 5) problems.push(`${name(p.member.id)} extends outside the room.`);
    }
  }
  // Hard: collisions (pairs with at least one movable item).
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!;
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j]!;
      if (a.unit === b.unit) continue;
      if (!a.unit.movable && !b.unit.movable) continue;
      if (!boxesOverlap(a.box, b.box)) continue;
      if (!vOverlap(a.member.bottom, a.member.top, b.member.bottom, b.member.top)) continue;
      const c = satConvex(a.poly, b.poly, OVERLAP_TOL);
      if (c.colliding && c.depth > OVERLAP_TOL) {
        violations++;
        if (problems.length < 5) problems.push(`${name(a.member.id)} overlaps ${name(b.member.id)}.`);
      }
    }
    if (!a.unit.movable) continue;
    for (const f of model.fixed) {
      if (!boxesOverlap(a.box, f.box) || !vOverlap(a.member.bottom, a.member.top, f.bottom, f.top)) continue;
      const c = satConvex(a.poly, f.poly, OVERLAP_TOL);
      if (c.colliding && c.depth > OVERLAP_TOL) {
        violations++;
        if (problems.length < 5) problems.push(`${name(a.member.id)} overlaps a fixed feature.`);
      }
    }
    if (a.member.floor && a.unit.kind !== 'vehicle') {
      for (const d of model.doorKeepClear) {
        if (!boxesOverlap(a.box, d.box)) continue;
        if (satConvex(a.poly, d.poly, OVERLAP_TOL).colliding) {
          violations++;
          if (problems.length < 5) problems.push(`${name(a.member.id)} blocks a door swing.`);
        }
      }
    }
  }
  // Hard: working positions must be reachable floor (inside, clear of parked items, features, vehicles).
  const workingPlaced: Placed[] = [];
  for (const u of model.units) {
    if (!u.working) continue;
    const wp = placeMembers(u, u.working)[0]!;
    workingPlaced.push(wp);
    if (!polygonContainsPolygon(model.room, wp.poly, 0.5)) {
      violations++;
      if (problems.length < 5) problems.push(`${name(wp.member.id)} working position extends outside the room.`);
      continue;
    }
    for (const b of floorPlaced) {
      if (b.unit === u || !boxesOverlap(wp.box, b.box) || !vOverlap(wp.member.bottom, wp.member.top, b.member.bottom, b.member.top)) continue;
      if (satConvex(wp.poly, b.poly, OVERLAP_TOL).colliding) {
        violations++;
        if (problems.length < 5) problems.push(`${name(wp.member.id)} working position overlaps ${name(b.member.id)}.`);
      }
    }
    for (const f of model.fixed) {
      if (!boxesOverlap(wp.box, f.box) || !vOverlap(wp.member.bottom, wp.member.top, f.bottom, f.top)) continue;
      if (satConvex(wp.poly, f.poly, OVERLAP_TOL).colliding) violations++;
    }
  }

  // ───── soft terms ─────
  const terms = Object.fromEntries(TERM_KEYS.map((k) => [k, 0])) as Record<TermKey, number>;
  const zoneTotals: Record<ZoneGroup, { blocked: number; area: number }> = { toolClearance: { blocked: 0, area: 0 }, access: { blocked: 0, area: 0 }, assembly: { blocked: 0, area: 0 } };
  const obstacleList = (self: Unit, bottom: number, top: number) => [
    ...floorPlaced.filter((p) => p.unit !== self && vOverlap(bottom, top, p.member.bottom, p.member.top)).map((p) => ({ poly: p.poly, box: p.box })),
    ...placed.filter((p) => !p.member.floor && p.unit !== self && vOverlap(bottom, top, p.member.bottom, p.member.top)).map((p) => ({ poly: p.poly, box: p.box })),
    ...model.fixed.filter((f) => vOverlap(bottom, top, f.bottom, f.top)),
  ];
  for (const p of placed) {
    if (p.member.zones.length === 0) continue;
    const zonePose = p.unit.working ? composePose(p.unit.working, p.member.local) : p.pose;
    for (const z of p.member.zones) {
      const poly = z.local.map((c) => localToWorld(zonePose, c));
      const samples = z.samples.map((c) => localToWorld(zonePose, c));
      const blocked = blockedArea(poly, samples, z.area, model.room, obstacleList(p.unit, z.bottom, z.top));
      zoneTotals[z.group].blocked += blocked;
      zoneTotals[z.group].area += z.area;
    }
  }
  terms.toolClearance = zoneTotals.toolClearance.area ? zoneTotals.toolClearance.blocked / zoneTotals.toolClearance.area : 0;
  terms.access = zoneTotals.access.area ? zoneTotals.access.blocked / zoneTotals.access.area : 0;
  terms.assembly = zoneTotals.assembly.area ? zoneTotals.assembly.blocked / zoneTotals.assembly.area : 0;

  // Vehicles: desired clearance bands, door swings, drive-in lane toward the garage door.
  if (model.vehicles.length) {
    let blocked = 0;
    let total = 0;
    for (const v of model.vehicles) {
      const pose = v.unit.pose;
      const others = [...floorPlaced.filter((p) => p.unit !== v.unit).map((p) => ({ poly: p.poly, box: p.box })), ...model.fixed];
      const bands = clearanceBands(v.spec, pose, v.desired);
      const areas: Polygon[] = [bands.driver, bands.passenger, bands.front, bands.rear, ...v.spec.doors.map((d) => doorSwingPolygon(v.spec, pose, d, d.openAngle, 6))];
      for (const lane of model.garageBands.map((gb) => laneFor(pose, v.spec.width, gb.poly))) if (lane) areas.push(lane);
      for (const a of areas) {
        const ar = polyArea(a);
        if (ar <= 0) continue;
        total += ar;
        blocked += blockedArea(a, samplesOf(a), ar, model.room, others);
      }
    }
    terms.vehicle = total ? blocked / total : 0;
  }

  // Garage-door bands.
  if (model.garageBands.length) {
    let blocked = 0;
    let total = 0;
    for (const gb of model.garageBands) {
      total += polyArea(gb.poly);
      for (const p of floorPlaced) if (p.unit.kind !== 'vehicle' && boxesOverlap(p.box, gb.box)) blocked += convexClipArea(p.poly, gb.poly);
    }
    terms.doorway = total ? Math.min(1, blocked / total) : 0;
  }

  // Workflow: frequency-weighted straight-line distance between use points.
  if (model.relationships.length) {
    const front = new Map<string, Point>();
    for (const p of placed) {
      const pose = p.unit.working ? composePose(p.unit.working, p.member.local) : p.pose;
      front.set(p.member.id, localToWorld(pose, { x: p.member.fp.offsetX ?? 0, y: (p.member.fp.offsetY ?? 0) + p.member.fp.depth / 2 + 300 }));
    }
    let sum = 0;
    let freq = 0;
    for (const r of model.relationships) {
      const a = front.get(r.from);
      const b = front.get(r.to);
      if (!a || !b) continue;
      sum += r.frequency * Math.hypot(a.x - b.x, a.y - b.y);
      freq += r.frequency;
    }
    terms.workflow = freq ? sum / freq / model.diag : 0;
  }

  // Storage and perimeter preference.
  const movableFloor = floorPlaced.filter((p) => p.unit.movable && p.unit.kind !== 'vehicle');
  const storage = movableFloor.filter((p) => p.member.category === 'storage');
  if (storage.length) terms.storage = storage.reduce((s, p) => s + Math.min(1, wallGap(p.poly, model.walls) / 610), 0) / storage.length;
  if (movableFloor.length) {
    const areaSum = movableFloor.reduce((s, p) => s + p.member.area, 0) || 1;
    terms.openFloor = movableFloor.reduce((s, p) => s + p.member.area * Math.min(1, wallGap(p.poly, model.walls) / 1524), 0) / areaSum;
  }

  // Mobile travel.
  const mobiles = model.units.filter((u) => u.working);
  if (mobiles.length) terms.mobile = mobiles.reduce((s, u) => s + Math.min(1, Math.hypot(u.pose.x - u.working!.x, u.pose.y - u.working!.y) / 3048), 0) / mobiles.length;

  // Narrow slots: gaps between 1" and the aisle width (flush contact is fine).
  if (movableFloor.length) {
    const aisle = model.aisle;
    const all = [...floorPlaced.map((p) => ({ unit: p.unit as Unit | null, poly: p.poly, box: p.box })), ...model.fixed.filter((f) => f.bottom < 900).map((f) => ({ unit: null as Unit | null, poly: f.poly, box: f.box }))];
    let pen = 0;
    for (const a of movableFloor) {
      const wg = wallGap(a.poly, model.walls);
      if (wg > 25 && wg < aisle) pen += (aisle - wg) / aisle;
      for (const b of all) {
        if (b.unit === a.unit || !boxesOverlap(a.box, b.box, aisle)) continue;
        const gap = polyGap(a.poly, b.poly);
        if (gap > 25 && gap < aisle) pen += (aisle - gap) / aisle;
      }
    }
    terms.pinch = pen / movableFloor.length;
  }

  // Stability: distance moved from the current layout.
  const movers = model.units.filter((u) => u.movable);
  if (movers.length) {
    terms.displacement =
      movers.reduce((s, u) => s + Math.hypot(u.pose.x - u.start.x, u.pose.y - u.start.y) / model.diag + (Math.abs(normDeg(u.pose.rotation - u.start.rotation)) > 1e-6 ? 0.05 : 0), 0) / movers.length;
  }
  return { violations, problems, terms };
}

/** Drive-in lane: from the vehicle body toward a garage-door band (convex hull of both near edges). */
function laneFor(pose: Pose, width: number, band: Polygon): Polygon | null {
  const c = { x: (band[0]!.x + band[1]!.x) / 2, y: (band[0]!.y + band[1]!.y) / 2 };
  const dx = c.x - pose.x;
  const dy = c.y - pose.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * (width / 2);
  const ny = ux * (width / 2);
  return [
    { x: pose.x + nx, y: pose.y + ny },
    { x: c.x + nx, y: c.y + ny },
    { x: c.x - nx, y: c.y - ny },
    { x: pose.x - nx, y: pose.y - ny },
  ];
}

export function energy(ev: Evaluation, weights: Record<TermKey, number>): number {
  let e = ev.violations * 1000;
  for (const k of TERM_KEYS) e += weights[k] * ev.terms[k];
  return e;
}

// ───────────────────────────── annealing ─────────────────────────────

/** Mulberry32 PRNG. */
export function prng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Snapshot {
  poses: Pose[];
  working: Array<Pose | null>;
}

const snap = (m: Model): Snapshot => ({ poses: m.units.map((u) => ({ ...u.pose })), working: m.units.map((u) => (u.working ? { ...u.working } : null)) });
function restore(m: Model, s: Snapshot): void {
  m.units.forEach((u, i) => {
    u.pose = { ...s.poses[i]! };
    u.working = s.working[i] ? { ...s.working[i]! } : null;
  });
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One random neighbour move. Returns false when no move applies. */
function propose(m: Model, rand: () => number, heat: number): boolean {
  const movable = m.units.filter((u) => u.movable);
  if (movable.length === 0) return false;
  const u = movable[Math.floor(rand() * movable.length)]!;
  const r = rand();
  const sigma = Math.max(40, m.diag * 0.12 * heat);
  if (u.kind === 'vehicle') {
    // Vehicles only shift (they must stay drivable in their bay).
    u.pose = { ...u.pose, x: u.pose.x + gaussian(rand) * sigma * 0.5, y: u.pose.y + gaussian(rand) * sigma * 0.5 };
    return true;
  }
  if (r < 0.3) {
    u.pose = { ...u.pose, x: u.pose.x + gaussian(rand) * sigma, y: u.pose.y + gaussian(rand) * sigma };
  } else if (r < 0.55) {
    // Back against a random wall, facing into the room.
    const wall = m.walls[Math.floor(rand() * m.walls.length)];
    if (!wall || wall.length < u.halfWidth * 2) return false;
    const rotation = rotationFacingAwayFromWall(wall);
    const offset = u.halfWidth + rand() * (wall.length - 2 * u.halfWidth);
    const c = pointOnWall(wall, offset, u.back + 1);
    u.pose = { x: c.x, y: c.y, rotation };
    if (u.working && rand() < 0.5) u.working = { ...u.pose };
  } else if (r < 0.68) {
    // Slide along the nearest wall direction.
    const wall = nearestWallTo(m.walls, u.pose);
    if (!wall) return false;
    const d = gaussian(rand) * sigma;
    u.pose = { ...u.pose, x: u.pose.x + wall.dir.x * d, y: u.pose.y + wall.dir.y * d };
  } else if (r < 0.78) {
    const k = 1 + Math.floor(rand() * 3);
    u.pose = { ...u.pose, rotation: normDeg(u.pose.rotation + 90 * k) };
  } else if (r < 0.88) {
    const others = movable.filter((x) => x !== u && x.kind !== 'vehicle');
    const o = others[Math.floor(rand() * others.length)];
    if (!o) return false;
    const a = u.pose;
    u.pose = { ...o.pose };
    o.pose = { ...a };
  } else {
    const mob = movable.filter((x) => x.working);
    const w = mob[Math.floor(rand() * mob.length)];
    if (!w || !w.working) return false;
    if (rand() < 0.3) w.working = { ...w.pose };
    else w.working = { ...w.working, x: w.working.x + gaussian(rand) * sigma * 1.5, y: w.working.y + gaussian(rand) * sigma * 1.5 };
  }
  return true;
}

function nearestWallTo(walls: WallGeom[], p: Point): WallGeom | undefined {
  let best: WallGeom | undefined;
  let bd = Infinity;
  for (const w of walls) {
    const d = pointSegmentDistance(p, w.a, w.b);
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

export interface CandidatePose {
  id: string;
  x: number;
  y: number;
  rotation: number;
}

export interface Candidate {
  kind: CandidateKind;
  label: string;
  description: string;
  priorities: Priorities;
  /** Parked poses of objects that moved. */
  objects: CandidatePose[];
  /** Working poses of mobile tools that changed. */
  working: CandidatePose[];
  vehicles: CandidatePose[];
  valid: boolean;
  problems: string[];
  /** Soft penalties before (current layout) and after, per term (0 = perfect). */
  terms: Array<{ key: TermKey; label: string; weight: number; before: number; after: number }>;
  seed: number;
}

export interface OptimizeHooks {
  onProgress?(fraction: number, message: string): void;
  shouldCancel?(): boolean;
}

export class OptimizationCancelled extends Error {
  constructor() {
    super('Optimization cancelled.');
  }
}

const MOVE_EPS = 0.5;

/** Run the assistant: several candidates (one per kind), each from its own deterministic seed. */
export function optimizeLayout(project: Project, scenarioId: string, options: OptimizeOptions, hooks: OptimizeHooks = {}): Candidate[] {
  const kinds = options.candidates ?? CANDIDATE_KINDS;
  const iterations = options.iterations ?? 2500;
  const aisle = options.aisleWidth ?? 762;
  const baseSeed = options.seed ?? 1;
  const names = new Map<string, string>();
  const sc = getScenario(project, scenarioId);
  for (const o of sc.objects) names.set(o.id, o.name);
  for (const v of sc.vehicles) names.set(v.id, v.name);

  const results: Candidate[] = [];
  // A candidate that the final check calls invalid is useless to the user (R-010), so each kind is
  // re-annealed from a different seed before we give up on it.
  const ATTEMPTS = 3;
  const runKind = (kind: CandidateKind, ci: number, seed: number): Candidate => {
    const priorities = presetPriorities(kind, options.priorities);
    const weights = termWeights(priorities);
    const model = buildModel(project, scenarioId, aisle);
    const rand = prng(seed);
    const before = evaluate(model, names);
    let cur = snap(model);
    let curE = energy(before, weights);
    let best = cur;
    let bestEval = before;
    let bestE = before.violations === 0 ? curE : Infinity;
    let bestViol = before.violations;
    const t0 = 0.25;
    const t1 = 0.002;
    for (let it = 0; it < iterations; it++) {
      if ((it & 63) === 0) {
        if (hooks.shouldCancel?.()) throw new OptimizationCancelled();
        hooks.onProgress?.((ci + it / iterations) / kinds.length, `${CANDIDATE_PRESETS[kind].label}: searching…`);
      }
      const frac = it / iterations;
      const temp = t0 * Math.pow(t1 / t0, frac);
      if (!propose(model, rand, 1 - frac)) continue;
      const ev = evaluate(model);
      const e = energy(ev, weights);
      if (e <= curE || rand() < Math.exp((curE - e) / temp)) {
        cur = snap(model);
        curE = e;
        if (ev.violations < bestViol || (ev.violations === 0 && e < bestE)) {
          best = cur;
          bestE = ev.violations === 0 ? e : Infinity;
          bestViol = ev.violations;
          bestEval = ev;
        }
      } else restore(model, cur);
    }
    restore(model, best);
    // Greedy polish: tiny nudges that keep the layout valid and lower the energy.
    for (let k = 0; k < Math.min(400, iterations / 4); k++) {
      const s = snap(model);
      if (!propose(model, rand, 0.02)) continue;
      const ev = evaluate(model);
      const e = energy(ev, weights);
      if (ev.violations <= bestViol && e < energy(bestEval, weights)) {
        bestEval = ev;
        bestViol = ev.violations;
      } else restore(model, s);
    }
    const final = evaluate(model, names);
    const out: Candidate = {
      kind,
      label: CANDIDATE_PRESETS[kind].label,
      description: CANDIDATE_PRESETS[kind].description,
      priorities,
      objects: [],
      working: [],
      vehicles: [],
      valid: final.violations === 0,
      problems: final.problems,
      terms: TERM_KEYS.map((k) => ({ key: k, label: TERM_INFO[k].label, weight: weights[k], before: before.terms[k], after: final.terms[k] })),
      seed,
    };
    for (const u of model.units) {
      if (!u.movable) continue;
      const moved = Math.hypot(u.pose.x - u.start.x, u.pose.y - u.start.y) > MOVE_EPS || Math.abs(normDeg(u.pose.rotation - u.start.rotation)) > 1e-6;
      if (u.kind === 'vehicle') {
        if (moved) out.vehicles.push({ id: u.members[0]!.id, x: u.pose.x, y: u.pose.y, rotation: u.pose.rotation });
        continue;
      }
      if (moved) {
        for (const m of u.members) {
          const wp = composePose(u.pose, m.local);
          out.objects.push({ id: m.id, x: wp.x, y: wp.y, rotation: wp.rotation });
        }
      }
      if (u.working && u.startWorking) {
        const w = u.working;
        const changed = Math.hypot(w.x - u.startWorking.x, w.y - u.startWorking.y) > MOVE_EPS || Math.abs(normDeg(w.rotation - u.startWorking.rotation)) > 1e-6;
        if (changed) out.working.push({ id: u.members[0]!.id, x: w.x, y: w.y, rotation: w.rotation });
      }
    }
    return out;
  };

  kinds.forEach((kind, ci) => {
    let best: Candidate | null = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const seed = ((baseSeed * 7919 + CANDIDATE_KINDS.indexOf(kind) * 104729 + attempt * 15_485_863) >>> 0);
      const out = runKind(kind, ci, seed);
      if (!best || (out.valid && !best.valid) || (out.valid === best.valid && out.problems.length < best.problems.length)) best = out;
      if (best.valid) break;
    }
    results.push(best!);
  });

  hooks.onProgress?.(1, 'Done');
  return results;
}

// ───────────────────────────── applying candidates ─────────────────────────────

/** A copy of the scenario with the candidate's poses applied (pure; for previews and evaluation). */
export function applyCandidate(scenario: Scenario, c: Pick<Candidate, 'objects' | 'working' | 'vehicles'>): Scenario {
  const pos = new Map(c.objects.map((p) => [p.id, p]));
  const work = new Map(c.working.map((p) => [p.id, p]));
  const veh = new Map(c.vehicles.map((p) => [p.id, p]));
  return {
    ...scenario,
    objects: scenario.objects.map((o) => {
      const p = pos.get(o.id);
      const w = work.get(o.id);
      if (!p && !w) return o;
      return {
        ...o,
        ...(p ? { x: round2(p.x), y: round2(p.y), rotation: p.rotation } : {}),
        ...(w ? { working: { x: round2(w.x), y: round2(w.y), rotation: w.rotation } } : {}),
      };
    }),
    vehicles: scenario.vehicles.map((v) => {
      const p = veh.get(v.id);
      return p ? { ...v, x: round2(p.x), y: round2(p.y), rotation: p.rotation } : v;
    }),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** A project whose `scenarioId` layout has the candidate applied (for full metric evaluation). */
export function projectWithCandidate(project: Project, scenarioId: string, c: Pick<Candidate, 'objects' | 'working' | 'vehicles'>): Project {
  return { ...project, scenarios: project.scenarios.map((s) => (s.id === scenarioId ? applyCandidate(s, c) : s)) };
}

/**
 * Commands that create a NEW layout from a candidate (the source layout is never modified):
 * duplicate the source, then move items in the copy. Run them in one transaction.
 */
export function candidateCommands(sourceScenarioId: string, c: Candidate, newScenarioId: string, name: string): AppCommand[] {
  const cmds: AppCommand[] = [
    { type: 'scenario.duplicate', payload: { sourceId: sourceScenarioId, id: newScenarioId, name, activate: true } },
    { type: 'scenario.rename', payload: { scenarioId: newScenarioId, name, description: `Suggested by the Layout Assistant (${c.label}). ${c.description}` } },
  ];
  if (c.objects.length) cmds.push({ type: 'object.move', payload: { scenarioId: newScenarioId, moves: c.objects.map((p) => ({ id: p.id, x: p.x, y: p.y, rotation: p.rotation })) } });
  for (const w of c.working) cmds.push({ type: 'object.setWorkingPosition', payload: { scenarioId: newScenarioId, id: w.id, pose: { x: w.x, y: w.y, rotation: w.rotation } } });
  for (const v of c.vehicles) cmds.push({ type: 'vehicle.update', payload: { scenarioId: newScenarioId, id: v.id, patch: { x: round2(v.x), y: round2(v.y), rotation: v.rotation } } });
  return cmds;
}
