/**
 * Vehicle geometry: body/mirror footprint, door swing sectors, trunk/hood access zones,
 * desired-clearance envelope, door-opening checks and a bicycle-model (Dubins) entry planner
 * with swept-path polygon and collision report.
 *
 * Vehicle local frame: origin = body center, +y = FRONT of the vehicle (direction of travel).
 * Facing +y, the vehicle's LEFT side is local +x (plan coordinates are y-down). In a
 * left-hand-drive vehicle (US) the driver side is therefore local +x.
 */
import { difference, union, type MultiPolygon } from './clip';
import { dubinsPaths, dubinsSamples, type DubinsConfig, type DubinsPath } from './dubins';

import { localPolygonToWorld, localRect, localToWorld, type Pose } from './obb';
import { isConvex, polygonsOverlapOrTouch, type Polygon } from './polygon';
import { satConvex, polygonCollision } from './sat';
import { add, degToRad, radToDeg, rotate, scale, type Point } from './vec';

export type DoorId = 'driver-front' | 'passenger-front' | 'driver-rear' | 'passenger-rear';
export type VehicleSide = 'driver' | 'passenger' | 'front' | 'rear';

export interface VehicleDoorSpec {
  id: DoorId;
  /** Distance from the front bumper to the door hinge (mm). */
  hingeFromFront: number;
  /** Door length from hinge to trailing edge (mm): the swing radius. */
  length: number;
  /** Full-open angle in degrees (typically 60–70°). */
  openAngle: number;
}

export interface VehicleGeomSpec {
  length: number;
  width: number;
  /** Overall width with mirrors unfolded (mm). */
  mirrorWidth: number;
  /** Overall width with mirrors folded (mm). Defaults to width + 80 mm. */
  foldedMirrorWidth?: number;
  mirrorsFolded?: boolean;
  /** Distance from the front bumper to the mirrors (mm). Defaults to 32% of length. */
  mirrorFromFront?: number;
  wheelbase: number;
  frontOverhang: number;
  doors: VehicleDoorSpec[];
  /** 'left' = left-hand drive (driver on the vehicle's left). Default 'left'. */
  driverSide?: 'left' | 'right';
  /** Standing/opening depth needed behind the vehicle for the trunk/hatch/tailgate (mm). */
  rearAccessDepth: number;
  /** Standing depth needed in front for hood access (mm). */
  hoodAccessDepth: number;
}

export interface DesiredClearance {
  driver: number;
  passenger: number;
  front: number;
  rear: number;
}

/** Sign of local x for a side (+1 = vehicle-left = local +x). */
export function sideSign(spec: Pick<VehicleGeomSpec, 'driverSide'>, side: 'driver' | 'passenger'): 1 | -1 {
  const driverOnLeft = (spec.driverSide ?? 'left') === 'left';
  const left = side === 'driver' ? driverOnLeft : !driverOnLeft;
  return left ? 1 : -1;
}

/** Heading (radians, from +x toward +y) of a vehicle pose's front direction. */
export const headingOf = (pose: Pose): number => degToRad(pose.rotation + 90);
/** Pose rotation (degrees) for a heading in radians. */
export const rotationForHeading = (theta: number): number => {
  const d = radToDeg(theta) - 90;
  const r = ((d % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
};

/** Local y of the rear axle (bicycle-model reference point). */
export function rearAxleLocalY(spec: VehicleGeomSpec): number {
  const rearOverhang = spec.length - spec.wheelbase - spec.frontOverhang;
  return -spec.length / 2 + rearOverhang;
}

export function vehicleBodyLocal(spec: VehicleGeomSpec): Polygon {
  return localRect(spec.width, spec.length);
}

export function vehicleBody(spec: VehicleGeomSpec, pose: Pose): Polygon {
  return localPolygonToWorld(pose, vehicleBodyLocal(spec));
}

/** Mirror rectangles (local), respecting the folded state. */
export function vehicleMirrorsLocal(spec: VehicleGeomSpec): Polygon[] {
  const overall = spec.mirrorsFolded ? (spec.foldedMirrorWidth ?? spec.width + 80) : spec.mirrorWidth;
  const ext = Math.max(0, (overall - spec.width) / 2);
  if (ext <= 0) return [];
  const y = spec.length / 2 - (spec.mirrorFromFront ?? spec.length * 0.32);
  const depth = 180;
  return [
    localRect(ext, depth, spec.width / 2 + ext / 2, y),
    localRect(ext, depth, -spec.width / 2 - ext / 2, y),
  ];
}

export function vehicleMirrors(spec: VehicleGeomSpec, pose: Pose): Polygon[] {
  return vehicleMirrorsLocal(spec).map((m) => localPolygonToWorld(pose, m));
}

/** Body plus mirrors as a list of convex parts (world). */
export function vehicleParts(spec: VehicleGeomSpec, pose: Pose): Polygon[] {
  return [vehicleBody(spec, pose), ...vehicleMirrors(spec, pose)];
}

/** Door hinge in local coordinates. */
export function doorHingeLocal(spec: VehicleGeomSpec, door: VehicleDoorSpec): Point {
  const side = door.id.startsWith('driver') ? 'driver' : 'passenger';
  const s = sideSign(spec, side);
  return { x: (s * spec.width) / 2, y: spec.length / 2 - door.hingeFromFront };
}

/** Local direction of a door leaf opened by `angle` degrees (0 = closed, lying toward the rear). */
function doorDirLocal(spec: VehicleGeomSpec, door: VehicleDoorSpec, angle: number): Point {
  const side = door.id.startsWith('driver') ? 'driver' : 'passenger';
  const s = sideSign(spec, side);
  return rotate({ x: 0, y: -1 }, s * angle);
}

/** Swept sector of a door from closed to `angle` (defaults to its full-open angle), in world coordinates. */
export function doorSwingPolygon(spec: VehicleGeomSpec, pose: Pose, door: VehicleDoorSpec, angle = door.openAngle, segments = 16): Polygon {
  const hinge = doorHingeLocal(spec, door);
  const pts: Point[] = [hinge];
  for (let k = 0; k <= segments; k++) {
    const a = (angle * k) / segments;
    pts.push(add(hinge, scale(doorDirLocal(spec, door, a), door.length)));
  }
  return localPolygonToWorld(pose, pts);
}

/** Thin polygon for the door leaf at a given opening angle (world). */
export function doorLeafPolygon(spec: VehicleGeomSpec, pose: Pose, door: VehicleDoorSpec, angle: number, thickness = 60): Polygon {
  const hinge = doorHingeLocal(spec, door);
  const dir = doorDirLocal(spec, door, angle);
  const side = door.id.startsWith('driver') ? 'driver' : 'passenger';
  const outward = { x: sideSign(spec, side), y: 0 };
  const n = rotate(outward, 0);
  const tip = add(hinge, scale(dir, door.length));
  const off = scale(n, thickness);
  return localPolygonToWorld(pose, [hinge, tip, add(tip, off), add(hinge, off)]);
}

export interface DoorOpeningResult {
  door: DoorId;
  /** Largest opening angle (degrees) reachable without hitting an obstacle. */
  maxAngle: number;
  fullyOpens: boolean;
  /** Lateral gap at the door's trailing edge at maxAngle (mm): roughly the space to squeeze out. */
  egressGap: number;
  /** Index of the obstacle that stops the door, if any. */
  blockedBy: number;
}

/** How far a door can open before hitting any obstacle (1° resolution). */
export function checkDoorOpening(
  spec: VehicleGeomSpec,
  pose: Pose,
  door: VehicleDoorSpec,
  obstacles: readonly Polygon[],
): DoorOpeningResult {
  let maxAngle = 0;
  let blockedBy = -1;
  for (let a = 1; a <= door.openAngle; a++) {
    const leaf = doorLeafPolygon(spec, pose, door, a, 30);
    const hit = obstacles.findIndex((o) => polygonsOverlapOrTouch(leaf, o));
    if (hit >= 0) {
      blockedBy = hit;
      break;
    }
    maxAngle = a;
  }
  return {
    door: door.id,
    maxAngle,
    fullyOpens: maxAngle >= door.openAngle,
    egressGap: door.length * Math.sin(degToRad(maxAngle)),
    blockedBy,
  };
}

/** Rear (trunk/hatch/tailgate) access zone behind the vehicle (world). */
export function rearAccessZone(spec: VehicleGeomSpec, pose: Pose): Polygon {
  return localPolygonToWorld(pose, localRect(spec.width * 0.9, spec.rearAccessDepth, 0, -spec.length / 2 - spec.rearAccessDepth / 2));
}

/** Hood access zone in front of the vehicle (world). */
export function hoodAccessZone(spec: VehicleGeomSpec, pose: Pose): Polygon {
  return localPolygonToWorld(pose, localRect(spec.width * 0.9, spec.hoodAccessDepth, 0, spec.length / 2 + spec.hoodAccessDepth / 2));
}

/** Body grown by desired per-side clearances (world). */
export function clearanceEnvelope(spec: VehicleGeomSpec, pose: Pose, c: DesiredClearance): Polygon {
  const dl = sideSign(spec, 'driver') === 1 ? c.driver : c.passenger; // local +x side
  const dr = sideSign(spec, 'driver') === 1 ? c.passenger : c.driver; // local −x side
  const minX = -spec.width / 2 - dr;
  const maxX = spec.width / 2 + dl;
  const minY = -spec.length / 2 - c.rear;
  const maxY = spec.length / 2 + c.front;
  return localPolygonToWorld(pose, [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

/** Per-side band polygons of the clearance envelope, for color-coding problem sides (world). */
export function clearanceBands(spec: VehicleGeomSpec, pose: Pose, c: DesiredClearance): Record<VehicleSide, Polygon> {
  const hw = spec.width / 2;
  const hl = spec.length / 2;
  const sd = sideSign(spec, 'driver');
  const band = (side: VehicleSide): Polygon => {
    switch (side) {
      case 'front':
        return localRect(spec.width, c.front, 0, hl + c.front / 2);
      case 'rear':
        return localRect(spec.width, c.rear, 0, -hl - c.rear / 2);
      case 'driver':
        return localRect(c.driver, spec.length, sd * (hw + c.driver / 2), 0);
      case 'passenger':
        return localRect(c.passenger, spec.length, -sd * (hw + c.passenger / 2), 0);
    }
  };
  return {
    driver: localPolygonToWorld(pose, band('driver')),
    passenger: localPolygonToWorld(pose, band('passenger')),
    front: localPolygonToWorld(pose, band('front')),
    rear: localPolygonToWorld(pose, band('rear')),
  };
}

// ───────────────────────────── entry planning ─────────────────────────────

/** Minimum turning radius of the REAR AXLE from a curb-to-curb turning radius (approximation). */
export function rearAxleTurningRadius(spec: VehicleGeomSpec, curbToCurbRadius: number): number {
  // Outer front corner traces ≈ curb radius. R_rear ≈ sqrt(Rc² − (wheelbase + frontOverhang)²) − width/2.
  const reach = spec.wheelbase + spec.frontOverhang;
  const inner = curbToCurbRadius * curbToCurbRadius - reach * reach;
  const r = inner > 0 ? Math.sqrt(inner) - spec.width / 2 : spec.wheelbase;
  return Math.max(r, spec.wheelbase * 0.9);
}

/** Convert a body pose to the rear-axle Dubins configuration. */
export function poseToAxleConfig(spec: VehicleGeomSpec, pose: Pose, reverse = false): DubinsConfig {
  const axle = localToWorld(pose, { x: 0, y: rearAxleLocalY(spec) });
  const theta = headingOf(pose) + (reverse ? Math.PI : 0);
  return { x: axle.x, y: axle.y, theta };
}

/** Convert a rear-axle configuration back to a body pose. */
export function axleConfigToPose(spec: VehicleGeomSpec, q: DubinsConfig, reverse = false): Pose {
  const theta = q.theta + (reverse ? Math.PI : 0);
  const rotation = rotationForHeading(theta);
  const back = rotate({ x: 0, y: rearAxleLocalY(spec) }, rotation);
  return { x: q.x - back.x, y: q.y - back.y, rotation };
}

export interface EntryObstacle {
  id: string;
  polygon: Polygon;
}

export interface EntryCollision {
  obstacleId: string;
  /** Distance along the path (mm) where contact first occurs. */
  atDistance: number;
  /** Deepest penetration found (mm). */
  depth: number;
  /** Where on the path (body pose) the first contact happens. */
  pose: Pose;
  /** True if only the clearance envelope (not the body) touches it. */
  envelopeOnly: boolean;
}

export interface EntryPlanOptions {
  spec: VehicleGeomSpec;
  /** Body pose outside the garage where the maneuver starts. */
  start: Pose;
  /** Final parked body pose. */
  goal: Pose;
  /** Rear-axle minimum turning radius (mm). */
  turningRadius: number;
  obstacles: readonly EntryObstacle[];
  /** 'forward' = nose-in, 'reverse' = back in. Default 'forward'. */
  direction?: 'forward' | 'reverse';
  /** Sampling step along the path (mm). Default 100. */
  step?: number;
  /** Extra margin around the body for the clearance-envelope check (mm). Default 0 (off). */
  envelopeMargin?: number;
  /**
   * Optional intermediate body poses (e.g. squared up just outside the door, see {@link entryStagingPoses}).
   * Each is tried as a via-point: start → staging → goal. Real drivers swing wide and straighten
   * before entering; staging poses let the planner find those maneuvers.
   */
  staging?: readonly Pose[];
}

export interface EntryPlan {
  feasible: boolean;
  /** Dubins words of the chosen path (joined with '+' when a staging pose was used). */
  word: string | null;
  length: number;
  poses: Pose[];
  /** Union of the body (and mirrors) over the whole maneuver. */
  swept: MultiPolygon;
  collisions: EntryCollision[];
  /** Every candidate path that was evaluated (for UI "alternatives"). */
  alternatives: Array<{ word: string; length: number; collisionDepth: number }>;
}

function collide(a: Polygon, b: Polygon): number {
  if (isConvex(a) && isConvex(b)) {
    const r = satConvex(a, b, 0.5);
    return r.colliding ? r.depth : 0;
  }
  const r = polygonCollision(a, b, 1);
  return r.colliding ? Math.max(r.depth, 0.5) : 0;
}

function evaluate(spec: VehicleGeomSpec, poses: Pose[], distances: number[], obstacles: readonly EntryObstacle[], margin: number): EntryCollision[] {
  const found = new Map<string, EntryCollision>();
  poses.forEach((pose, i) => {
    const parts = vehicleParts(spec, pose);
    const env = margin > 0 ? localPolygonToWorld(pose, localRect(spec.width + 2 * margin, spec.length + 2 * margin)) : null;
    for (const o of obstacles) {
      let depth = 0;
      for (const p of parts) depth = Math.max(depth, collide(p, o.polygon));
      const envDepth = env && depth === 0 ? collide(env, o.polygon) : 0;
      if (depth === 0 && envDepth === 0) continue;
      const existing = found.get(o.id);
      const bodyHit = depth > 0;
      if (!existing) {
        found.set(o.id, { obstacleId: o.id, atDistance: distances[i] ?? 0, depth: bodyHit ? depth : envDepth, pose, envelopeOnly: !bodyHit });
      } else if (bodyHit && existing.envelopeOnly) {
        existing.envelopeOnly = false;
        existing.depth = depth;
        existing.atDistance = distances[i] ?? existing.atDistance;
        existing.pose = pose;
      } else if (bodyHit || existing.envelopeOnly) {
        existing.depth = Math.max(existing.depth, bodyHit ? depth : envDepth);
      }
    }
  });
  return [...found.values()];
}

interface Candidate {
  word: string;
  length: number;
  poses: Pose[];
  distances: number[];
}

function sampleChain(spec: VehicleGeomSpec, chain: DubinsPath[], step: number, reverse: boolean): Candidate {
  const poses: Pose[] = [];
  const distances: number[] = [];
  let offset = 0;
  chain.forEach((path, k) => {
    const n = Math.max(1, Math.ceil(path.length / step));
    const configs = dubinsSamples(path, path.length / n);
    configs.forEach((c, i) => {
      if (k > 0 && i === 0) return; // shared via-point
      poses.push(axleConfigToPose(spec, c, reverse));
      distances.push(offset + (i / n) * path.length);
    });
    offset += path.length;
  });
  return { word: chain.map((p) => p.word).join('+'), length: offset, poses, distances };
}

/**
 * Plan a garage entry with a bicycle-model vehicle: evaluates Dubins paths (direct, and via any
 * staging poses) between the start and goal rear-axle configurations, samples the body along each,
 * and picks the shortest path whose BODY is collision-free. Clearance-envelope contacts are reported
 * but do not make a path infeasible. If nothing is collision-free, returns the least-bad path.
 */
export function planVehicleEntry(o: EntryPlanOptions): EntryPlan {
  const reverse = o.direction === 'reverse';
  const step = o.step ?? 100;
  const qs = poseToAxleConfig(o.spec, o.start, reverse);
  const qg = poseToAxleConfig(o.spec, o.goal, reverse);
  const candidates: Candidate[] = dubinsPaths(qs, qg, o.turningRadius).map((p) => sampleChain(o.spec, [p], step, reverse));
  for (const via of o.staging ?? []) {
    const qv = poseToAxleConfig(o.spec, via, reverse);
    const first = dubinsPaths(qs, qv, o.turningRadius).slice(0, 2);
    const second = dubinsPaths(qv, qg, o.turningRadius).slice(0, 2);
    for (const a of first) for (const b of second) candidates.push(sampleChain(o.spec, [a, b], step, reverse));
  }
  const evaluated = candidates
    .sort((a, b) => a.length - b.length)
    .map((c) => {
      const collisions = evaluate(o.spec, c.poses, c.distances, o.obstacles, o.envelopeMargin ?? 0);
      const bodyDepth = collisions.filter((x) => !x.envelopeOnly).reduce((s, x) => s + x.depth, 0);
      return { c, collisions, bodyDepth };
    });
  const alternatives = evaluated.map((e) => ({ word: e.c.word, length: e.c.length, collisionDepth: e.bodyDepth }));
  if (evaluated.length === 0) {
    return { feasible: false, word: null, length: 0, poses: [], swept: [], collisions: [], alternatives };
  }
  const chosen = evaluated.find((e) => e.bodyDepth === 0) ?? [...evaluated].sort((a, b) => a.bodyDepth - b.bodyDepth || a.c.length - b.c.length)[0]!;
  // Swept polygon: union of body footprints at a coarser step to bound cost.
  const every = Math.max(1, Math.round(250 / step));
  const bodies = chosen.c.poses.filter((_, i) => i % every === 0 || i === chosen.c.poses.length - 1).flatMap((p) => vehicleParts(o.spec, p));
  return {
    feasible: chosen.bodyDepth === 0,
    word: chosen.c.word,
    length: chosen.c.length,
    poses: chosen.c.poses,
    swept: union(...bodies),
    collisions: chosen.collisions,
    alternatives,
  };
}

/**
 * Typical staging poses for an entry: squared up to the opening, just outside it, at the opening
 * center and shifted toward either jamb (clamped so the body stays within the opening width).
 */
export function entryStagingPoses(
  opening: { a: Point; b: Point; inward: Point },
  spec: VehicleGeomSpec,
  direction: 'forward' | 'reverse' = 'forward',
): Pose[] {
  const mid = { x: (opening.a.x + opening.b.x) / 2, y: (opening.a.y + opening.b.y) / 2 };
  const width = Math.hypot(opening.b.x - opening.a.x, opening.b.y - opening.a.y);
  const along = width > 0 ? { x: (opening.b.x - opening.a.x) / width, y: (opening.b.y - opening.a.y) / width } : { x: 1, y: 0 };
  const slack = Math.max(0, (width - spec.mirrorWidth) / 2 - 50);
  const heading = Math.atan2(opening.inward.y, opening.inward.x) + (direction === 'reverse' ? Math.PI : 0);
  const rotation = rotationForHeading(heading);
  const out: Pose[] = [];
  for (const lateral of [0, -slack, slack]) {
    for (const back of [0.6, 1.2]) {
      const c = add(add(mid, scale(along, lateral)), scale(opening.inward, -(spec.length * back + spec.length / 2)));
      out.push({ x: c.x, y: c.y, rotation });
    }
  }
  return out;
}

/**
 * Start pose for an entry maneuver: `distance` mm outside the opening's midpoint, approaching at
 * `approachAngle` degrees off the opening's normal (0 = straight in), facing the opening
 * (or facing away when reversing in).
 */
export function entryStartPose(
  opening: { a: Point; b: Point; inward: Point },
  spec: VehicleGeomSpec,
  distanceOutside: number,
  approachAngle = 0,
  direction: 'forward' | 'reverse' = 'forward',
): Pose {
  const mid = { x: (opening.a.x + opening.b.x) / 2, y: (opening.a.y + opening.b.y) / 2 };
  const dirIn = rotate(opening.inward, approachAngle);
  const center = add(mid, scale(dirIn, -(distanceOutside + spec.length / 2)));
  const heading = Math.atan2(dirIn.y, dirIn.x) + (direction === 'reverse' ? Math.PI : 0);
  return { x: center.x, y: center.y, rotation: rotationForHeading(heading) };
}

/**
 * Wall obstacles for entry planning: each wall's thickness quad, with door/garage openings cut out.
 * `openings` gives [start, end] offsets along wall `wallIndex`.
 */
export function wallObstaclesWithOpenings(
  wallQuadsList: Polygon[],
  walls: ReadonlyArray<{ index: number; a: Point; dir: Point; outward: Point }>,
  openings: ReadonlyArray<{ wallIndex: number; start: number; end: number }>,
  thickness: number | readonly number[],
): EntryObstacle[] {
  const out: EntryObstacle[] = [];
  wallQuadsList.forEach((quad, i) => {
    const wall = walls[i]!;
    const t = (typeof thickness === 'number' ? thickness : (thickness[i] ?? 0)) + 1000;
    const cuts: Polygon[] = openings
      .filter((op) => op.wallIndex === i)
      .map((op) => {
        const p0 = add(wall.a, scale(wall.dir, op.start));
        const p1 = add(wall.a, scale(wall.dir, op.end));
        const inset = scale(wall.outward, -10);
        const outset = scale(wall.outward, t);
        return [add(p0, inset), add(p1, inset), add(p1, outset), add(p0, outset)];
      });
    if (cuts.length === 0) {
      out.push({ id: `wall:${i}`, polygon: quad });
      return;
    }
    const pieces = difference(quad, ...cuts);
    pieces.forEach((pc, k) => out.push({ id: `wall:${i}:${k}`, polygon: pc.outer }));
  });
  return out;
}
