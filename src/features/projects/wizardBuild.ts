/**
 * Builds a new project from the New Project wizard's answers: outline, ceiling height, garage
 * doors, permanent obstructions and an optional vehicle. No React; unit tested.
 */
import { createProject } from '@/domain/factories';
import { roomProblem } from '@/domain/roomEdit';
import { vehicleGeomSpec } from '@/domain/resolve';
import { ElectricalPointSchema, type ArchitecturalFeature, type ElectricalPoint, type Project, type Vehicle } from '@/domain/schema';
import { feetInches, quantize } from '@/domain/units';
import { bbox, bboxCenter, centroid, containsPoint, distance, offsetPolygon, polygonCollision, polygonContainsPolygon, polygonSegments, rayCast, rectPolygon, roomWalls, vehicleBody, type Point, type Polygon } from '@/geometry';
import { newId } from '@/utils/id';
import { openingFeatures } from '@/features/room/build';
import { ARCHITECTURE_TEMPLATES, ELECTRICAL_TEMPLATES, createVehicle } from '@/features/objects/library';

export interface WizardDoor {
  wallIndex: number;
  /** Center offset along the wall from its start corner (mm). */
  offset: number;
  width: number;
  height: number;
}

export const OBSTRUCTIONS = [
  { id: 'support-pole', label: 'Support pole' },
  { id: 'water-heater', label: 'Water heater' },
  { id: 'panel', label: 'Electrical panel' },
  { id: 'hvac', label: 'Furnace / HVAC unit' },
  { id: 'utility-closet', label: 'Utility closet' },
  { id: 'sink', label: 'Utility sink' },
  { id: 'stairs', label: 'Stairs' },
  { id: 'steps', label: 'Entry steps' },
  { id: 'attic-ladder', label: 'Attic ladder' },
  { id: 'ceiling-beam', label: 'Ceiling beam' },
] as const;
export type ObstructionId = (typeof OBSTRUCTIONS)[number]['id'];

export interface WizardAnswers {
  name: string;
  unitSystem: 'imperial' | 'metric';
  /** Interior outline (empty = draw it later). */
  points: Point[];
  ceilingHeight: number;
  wallThickness: number;
  doors: WizardDoor[];
  obstructions: ObstructionId[];
  vehicle: { templateId: string; name: string } | null;
}

/** Walls ordered for placing wall-hosted items: longest first, skipping walls with garage doors. */
function freeWalls(points: Point[], doors: WizardDoor[]): number[] {
  const walls = roomWalls(points);
  const withDoor = new Set(doors.map((d) => d.wallIndex));
  return walls
    .map((w) => w.index)
    .sort((a, b) => walls[b]!.length - walls[a]!.length)
    .sort((a, b) => Number(withDoor.has(a)) - Number(withDoor.has(b)));
}

function feature(kind: ArchitecturalFeature['kind'], placement: ArchitecturalFeature['placement'], overrides: Partial<ArchitecturalFeature> = {}): ArchitecturalFeature {
  const t = ARCHITECTURE_TEMPLATES.find((x) => x.kind === kind)!;
  return {
    id: newId(),
    kind,
    name: t.name,
    placement,
    width: t.width,
    depth: t.depth,
    height: t.height,
    elevation: t.elevation ?? 0,
    shape: t.shape ?? 'rect',
    locked: false,
    hidden: false,
    notes: 'Added by the setup wizard. Drag it to its real position.',
    ...overrides,
  };
}

export function validateAnswers(a: WizardAnswers): string | null {
  if (!a.name.trim()) return 'Give the project a name.';
  if (a.points.length > 0) {
    const p = roomProblem(a.points);
    if (p) return p;
  }
  if (!(a.ceilingHeight > 1000)) return 'The ceiling should be at least about 3′ (1 m) high.';
  const walls = a.points.length >= 3 ? roomWalls(a.points) : [];
  for (const [i, d] of a.doors.entries()) {
    const w = walls[d.wallIndex];
    if (!w) return `Garage door ${i + 1}: pick a wall.`;
    if (d.offset - d.width / 2 < -0.5 || d.offset + d.width / 2 > w.length + 0.5) return `Garage door ${i + 1} (${Math.round(d.width / 25.4)}″ wide) doesn't fit on that wall where it is.`;
    if (!(d.height > 1000)) return `Garage door ${i + 1} should be at least about 3′ (1 m) high.`;
    if (d.height > a.ceilingHeight + 0.5) return `Garage door ${i + 1} is taller than the ceiling.`;
    // Two openings cannot share the same piece of wall (R-008).
    for (let j = 0; j < i; j++) {
      const o = a.doors[j]!;
      if (o.wallIndex !== d.wallIndex) continue;
      const [s0, s1] = doorSpan(d);
      const [t0, t1] = doorSpan(o);
      if (s0 < t1 - 0.5 && t0 < s1 - 0.5) return `Garage doors ${j + 1} and ${i + 1} overlap on the same wall. Move one along the wall or put it on another wall.`;
    }
  }
  return null;
}

export function buildWizardProject(a: WizardAnswers): Project {
  const project = createProject({
    name: a.name.trim(),
    settings: a.unitSystem === 'metric' ? { unitSystem: 'metric', gridSize: 100 } : { unitSystem: 'imperial', gridSize: feetInches(0, 6) },
    roomPoints: a.points.map((p) => ({ x: quantize(p.x), y: quantize(p.y) })),
    ceilingHeight: quantize(a.ceilingHeight),
    wallThickness: quantize(a.wallThickness),
  });
  project.settings.defaultWallThickness = quantize(a.wallThickness);
  const room = project.room;
  if (room.vertices.length < 3) return project;
  const pts = room.vertices.map((v) => ({ x: v.x, y: v.y }));
  const walls = roomWalls(pts);

  // Garage doors.
  const doors = openingFeatures(
    room,
    a.doors.map((d) => ({ wallIndex: d.wallIndex, offset: d.offset, width: d.width, kind: 'garage-door' as const })),
  ).map((f, i) => ({ ...f, height: quantize(a.doors[i]!.height), garageDoor: f.garageDoor ? { ...f.garageDoor, openingHeight: quantize(a.doors[i]!.height) } : undefined }));
  project.architecture.push(...doors);

  const c = containsPoint(pts, centroid(pts)) ? centroid(pts) : bboxCenter(bbox(pts));

  // Vehicle: parked in from the (first) garage door, nose pointing into the garage, and always
  // inside the room (R-007: a fixed 3 m from the door drove the nose through the far wall of any
  // garage shallower than about 17' 6"). Decided first, so free-standing obstructions below can
  // keep out of the car's way.
  let parked: { vehicle: Vehicle; body: Polygon; across: Point } | null = null;
  if (a.vehicle) {
    const d = a.doors[0];
    const template = createVehicle(a.vehicle.templateId, { x: 0, y: 0, rotation: 0 });
    let rotation = 180;
    let pos = c;
    let across: Point = { x: 1, y: 0 };
    if (d) {
      const w = walls[d.wallIndex]!;
      // Nose faces into the garage (away from the door): the vehicle's +y (front) along the wall's inward normal.
      rotation = Math.round(((Math.atan2(w.inward.y, w.inward.x) * 180) / Math.PI - 90 + 360) % 360);
      const doorCenter = { x: w.a.x + w.dir.x * d.offset, y: w.a.y + w.dir.y * d.offset };
      pos = parkingSpot(pts, doorCenter, w.inward, template.length, distance(doorCenter, c) + 800);
      across = w.dir;
    }
    const v: Vehicle = { ...template, x: quantize(pos.x), y: quantize(pos.y), rotation };
    if (a.vehicle.name.trim()) v.name = a.vehicle.name.trim();
    parked = { vehicle: v, body: vehicleBody(vehicleGeomSpec(v), { x: v.x, y: v.y, rotation: v.rotation }), across };
  }

  // Permanent obstructions, spread along the walls without doors (users drag them into place).
  const order = freeWalls(pts, a.doors);
  let slot = 0;
  const nextWall = () => order[slot++ % Math.max(1, order.length)] ?? 0;
  const used = new Map<number, number>();
  const wallSpot = (width: number): ArchitecturalFeature['placement'] => {
    const wi = nextWall();
    const w = walls[wi]!;
    const n = (used.get(wi) ?? 0) + 1;
    used.set(wi, n);
    const off = Math.min(Math.max(width / 2 + 150, (w.length * n) / 4), w.length - width / 2 - 150);
    return { type: 'wall', wallId: room.walls[wi]!.id, offset: quantize(Math.max(width / 2, off)) };
  };
  /**
   * A free-standing feature of `size` centered at `p`, moved sideways out of the parked car's lane
   * when it would sit under the car (the pole of a one-door garage used to land exactly under the
   * sedan's roof, a critical overlap the wizard created silently).
   */
  const clearOfVehicle = (p: Point, size: number): Point => {
    if (!parked) return p;
    const spec = vehicleGeomSpec(parked.vehicle);
    const footprintAt = (q: Point): Polygon => rectPolygon(q.x - size / 2, q.y - size / 2, size, size);
    const free = (q: Point) => polygonContainsPolygon(pts, footprintAt(q), 1) && !polygonCollision(offsetPolygon(footprintAt(q), VEHICLE_SIDE_GAP), parked.body).colliding;
    if (free(p)) return p;
    const shift = spec.mirrorWidth / 2 + VEHICLE_SIDE_GAP + size / 2;
    for (const k of [1, -1, 1.5, -1.5, 2, -2]) {
      const q = { x: p.x + parked.across.x * shift * k, y: p.y + parked.across.y * shift * k };
      if (free(q)) return q;
    }
    return p;
  };
  const freeSpot = (kind: ArchitecturalFeature['kind'], p: Point): ArchitecturalFeature['placement'] => {
    const t = ARCHITECTURE_TEMPLATES.find((x) => x.kind === kind)!;
    const q = clearOfVehicle(p, Math.max(t.width, t.depth));
    return { type: 'free', x: quantize(q.x), y: quantize(q.y), rotation: 0 };
  };
  for (const id of a.obstructions) {
    if (id === 'panel') {
      const t = ELECTRICAL_TEMPLATES.find((x) => x.kind === 'panel')!;
      const e: ElectricalPoint = ElectricalPointSchema.parse({ id: newId(), kind: 'panel', label: 'Electrical panel', placement: wallSpot(360), ...t.defaults });
      project.electrical.push(e);
      continue;
    }
    if (id === 'support-pole') project.architecture.push(feature('support-pole', freeSpot('support-pole', c)));
    else if (id === 'attic-ladder') project.architecture.push(feature('attic-ladder', freeSpot('attic-ladder', { x: c.x, y: c.y + 900 })));
    else if (id === 'ceiling-beam') {
      const b = bbox(pts);
      project.architecture.push(feature('ceiling-beam', { type: 'free', x: quantize((b.minX + b.maxX) / 2), y: quantize(c.y), rotation: 0 }, { width: quantize(b.maxX - b.minX) }));
    } else {
      const t = ARCHITECTURE_TEMPLATES.find((x) => x.kind === id)!;
      project.architecture.push(feature(id, wallSpot(t.width)));
    }
  }

  if (parked) project.scenarios[0]!.vehicles.push(parked.vehicle);
  return project;
}

/** Clearance a parked vehicle keeps from the garage door opening and from the far wall (mm). */
export const VEHICLE_WALL_GAP = 610; // 24"
/** Walking room the wizard keeps between a parked vehicle and a free-standing obstruction (mm). */
export const VEHICLE_SIDE_GAP = 610; // 24"

/**
 * Where to park a vehicle that entered through a door: `preferred` mm in from the opening when
 * that leaves room, otherwise as far in as the room allows (never through the far wall).
 */
export function parkingSpot(room: Point[], doorCenter: Point, inward: Point, length: number, preferred: number): Point {
  const hit = rayCast(doorCenter, inward, polygonSegments(room));
  const available = hit ? hit.t : length + 2 * VEHICLE_WALL_GAP;
  const lo = length / 2 + VEHICLE_WALL_GAP;
  const hi = available - length / 2 - VEHICLE_WALL_GAP;
  // Too shallow for both gaps: center what space there is (the bounds check will say so).
  const depth = hi < lo ? available / 2 : Math.min(Math.max(Math.min(preferred, 3000), lo), hi);
  return { x: doorCenter.x + inward.x * depth, y: doorCenter.y + inward.y * depth };
}

/** Openings on a wall as [start, end] offsets. */
const doorSpan = (d: WizardDoor): [number, number] => [d.offset - d.width / 2, d.offset + d.width / 2];

/**
 * A default, sensible door for a new outline: centered on the longest south-facing wall, or (when
 * other doors already exist) centered on the longest free run left on a wall (R-008: adding a
 * second garage door used to duplicate the first one exactly).
 */
export function defaultDoorFor(points: Point[], width: number, height: number, existing: readonly WizardDoor[] = []): WizardDoor | null {
  if (points.length < 3) return null;
  const walls = roomWalls(points);
  const candidates = [
    ...walls.filter((w) => w.compass === 'south').sort((a, b) => b.length - a.length),
    ...[...walls].sort((a, b) => b.length - a.length),
  ];
  for (const wall of candidates) {
    if (wall.length < width + 100) continue;
    const taken = existing
      .filter((d) => d.wallIndex === wall.index)
      .map(doorSpan)
      .sort((a, b) => a[0] - b[0]);
    // Longest gap between existing openings (with a 6" reveal between doors).
    const gap = 152.4;
    let best: { offset: number; run: number } | null = null;
    let cursor = 0;
    for (const [s0, s1] of [...taken, [wall.length + gap, wall.length + gap] as [number, number]]) {
      const run = s0 - gap - cursor;
      if (run >= width && (!best || run > best.run)) best = { offset: cursor + run / 2, run };
      cursor = Math.max(cursor, s1 + gap);
    }
    if (best) return { wallIndex: wall.index, offset: best.offset, width, height };
  }
  return null;
}

/**
 * The wizard's "Add a garage door": `existing` plus a default door. When the wall we would prefer
 * (the longest south wall, then the longest wall) can hold all of its doors side by side but the
 * doors already on it are in the way (a first door is centered, so a 22' front wall with one 9'
 * door has no 9' run left on either side), the doors on that wall are re-spaced evenly instead of
 * sending the new door to the back wall.
 */
export function addDefaultDoor(points: Point[], width: number, height: number, existing: readonly WizardDoor[]): WizardDoor[] {
  const free = defaultDoorFor(points, width, height, existing);
  if (points.length < 3) return free ? [...existing, free] : [...existing];
  const walls = roomWalls(points);
  const gap = 152.4;
  const preferred = [...walls.filter((w) => w.compass === 'south').sort((a, b) => b.length - a.length), ...[...walls].sort((a, b) => b.length - a.length)];
  for (const wall of preferred) {
    // defaultDoorFor found a free run on this wall (or an earlier one): keep it.
    if (free && free.wallIndex === wall.index) break;
    const mine = existing.filter((d) => d.wallIndex === wall.index);
    if (mine.length === 0) continue;
    const widths = mine.reduce((s, d) => s + d.width, 0) + width;
    if (widths + gap * (mine.length + 2) > wall.length) continue;
    const ordered = [...mine].sort((a, b) => a.offset - b.offset);
    const reveal = (wall.length - widths) / (ordered.length + 2);
    let cursor = reveal;
    const packed = new Map<WizardDoor, WizardDoor>();
    for (const d of ordered) {
      packed.set(d, { ...d, offset: cursor + d.width / 2 });
      cursor += d.width + reveal;
    }
    return [...existing.map((d) => packed.get(d) ?? d), { wallIndex: wall.index, offset: cursor + width / 2, width, height }];
  }
  return free ? [...existing, free] : [...existing];
}

