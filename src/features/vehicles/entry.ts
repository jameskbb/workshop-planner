/**
 * Garage-entry simulation (pure): builds the planner input from the project (the chosen garage
 * opening, the driveway approach (angle, distance, forward / reverse), the vehicle's parked spot as
 * the goal, and every wall (with garage openings cut out), floor object, fixed feature and other
 * vehicle as obstacles) and runs the bicycle-model planner and explains the outcome in plain words.
 */
import type { AnalysisContext } from '@/analysis/context';
import { vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import type { ArchitecturalFeature, EntityRef, Vehicle } from '@/domain/schema';
import { inches } from '@/domain/units';
import {
  add,
  axleConfigToPose,
  dot,
  sub,
  rotationForHeading,
  bbox,
  bboxIntersects,
  dubinsPaths,
  dubinsSamples,
  entryStagingPoses,
  entryStartPose,
  headingOf,
  isConvex,
  localPolygonToWorld,
  localRect,
  pointOnWall,
  polygonCollision,
  poseToAxleConfig,
  rearAxleTurningRadius,
  satConvex,
  scale,
  union,
  vehicleParts,
  wallObstaclesWithOpenings,
  wallQuads,
  type BBox,
  type DubinsPath,
  type EntryObstacle,
  type MultiPolygon,
  type Point,
  type Polygon,
  type Pose,
  type VehicleGeomSpec,
} from '@/geometry';

/** A near miss closer than this is reported as a tight pass (mm). */
export const ENTRY_MARGIN = inches(6);
/** Mirror bottom as a fraction of the vehicle height (approximate). */
export const MIRROR_HEIGHT_RATIO = 0.62;

export interface EntryOpening {
  feature: ArchitecturalFeature;
  a: Point;
  b: Point;
  inward: Point;
  width: number;
}

export interface EntryCollisionInfo {
  ref: EntityRef | null;
  name: string;
  atDistance: number;
  depth: number;
  pose: Pose;
  envelopeOnly: boolean;
}

/** The maneuver the planner picked (rear-axle bicycle model, Dubins curves). */
export interface EntryPath {
  feasible: boolean;
  word: string | null;
  /** Path length (mm). */
  length: number;
  /** Body poses sampled along the path. */
  poses: Pose[];
  /** Distance along the path for each pose (mm). */
  distances: number[];
  /** How many candidate maneuvers were tried. */
  tried: number;
}

export interface EntryResult {
  vehicleId: string;
  opening: EntryOpening;
  start: Pose;
  goal: Pose;
  spec: VehicleGeomSpec;
  direction: 'forward' | 'reverse';
  plan: EntryPath;
  feasible: boolean;
  collisions: EntryCollisionInfo[];
  /** Plain-language outcome ("The Sedan can pull in forward…"). */
  summary: string;
  /** Per-side slack in the opening with mirrors as set (mm). */
  openingSlack: number;
}

export function garageOpenings(ctx: AnalysisContext): EntryOpening[] {
  const out: EntryOpening[] = [];
  for (const f of ctx.project.architecture) {
    if (f.kind !== 'garage-door' || f.placement.type !== 'wall') continue;
    const i = ctx.room.wallIndex.get(f.placement.wallId);
    const wall = i === undefined ? undefined : ctx.room.walls[i];
    if (!wall) continue;
    const a = pointOnWall(wall, f.placement.offset - f.width / 2, 0);
    const b = pointOnWall(wall, f.placement.offset + f.width / 2, 0);
    out.push({ feature: f, a, b, inward: wall.inward, width: f.width });
  }
  return out;
}

function lengthWords(ctx: AnalysisContext, mm: number): string {
  return ctx.fmtLength(Math.round(mm / 25.4) * 25.4);
}

export function simulateEntry(ctx: AnalysisContext, vehicle: Vehicle): EntryResult | { error: string } {
  if (!ctx.hasRoom) return { error: 'Draw the room first.' };
  const openings = garageOpenings(ctx);
  if (openings.length === 0) return { error: 'Add a garage door to simulate driving in.' };
  const entry = vehicle.entry;
  const opening = openings.find((o) => o.feature.id === entry?.openingFeatureId) ?? openings[0]!;
  const spec = vehicleGeomSpec(vehicle);
  const direction = entry?.direction ?? 'forward';
  const goal = vehiclePose(vehicle);
  const start = entryStartPose(opening, spec, entry?.approachDistance ?? 6000, entry?.approachAngle ?? 0, direction);

  // Obstacles: walls with every garage opening cut out, plus floor items low enough to hit.
  const names = new Map<string, { ref: EntityRef | null; name: string }>();
  const cuts = openings.map((o) => {
    const i = ctx.room.wallIndex.get((o.feature.placement as { wallId: string }).wallId)!;
    const off = (o.feature.placement as { offset: number }).offset;
    return { wallIndex: i, start: off - o.width / 2, end: off + o.width / 2 };
  });
  const walls = wallObstaclesWithOpenings(wallQuads(ctx.room.polygon, ctx.room.thickness), ctx.room.walls, cuts, ctx.room.thickness);
  const obstacles: EntryObstacle[] = [];
  /** Obstacles below mirror height (≈ 60 % of the vehicle height) cannot hit the mirrors. */
  const low = new Set<string>();
  const mirrorBottom = vehicle.height * MIRROR_HEIGHT_RATIO;
  for (const w of walls) {
    const i = Number(w.id.split(':')[1]);
    const wallId = ctx.project.room.walls[i]?.id;
    names.set(w.id, { ref: wallId ? { kind: 'wall', id: wallId } : null, name: `the ${ctx.room.walls[i]?.name ?? 'wall'}` });
    obstacles.push(w);
  }
  for (const o of ctx.objects) {
    if (o.resolved.elevation >= vehicle.height) continue;
    const id = `object:${o.id}`;
    names.set(id, { ref: { kind: 'object', id: o.id }, name: o.name });
    if (o.resolved.elevation + o.resolved.height < mirrorBottom) low.add(id);
    obstacles.push({ id, polygon: o.footprint });
  }
  for (const f of ctx.features) {
    if (!f.blocksFloor) continue;
    const id = `feature:${f.id}`;
    names.set(id, { ref: { kind: 'feature', id: f.id }, name: `the ${f.name}` });
    if (f.feature.elevation + f.feature.height < mirrorBottom) low.add(id);
    obstacles.push({ id, polygon: f.footprint });
  }
  for (const v of ctx.vehicles) {
    if (v.id === vehicle.id) continue;
    v.parts.forEach((p, k) => {
      const id = `vehicle:${v.id}:${k}`;
      names.set(id, { ref: { kind: 'vehicle', id: v.id }, name: v.name });
      obstacles.push({ id, polygon: p });
    });
  }

  const plan = planEntry(spec, start, goal, rearAxleTurningRadius(spec, vehicle.turningRadius), obstacles, low, direction, [
    ...alignedStaging(opening, spec, goal, direction),
    ...entryStagingPoses(opening, spec, direction),
    ...approachStaging(goal, spec, direction),
  ]);
  const raw = pathContacts(spec, plan.poses, plan.distances, prepare(obstacles, low), ENTRY_MARGIN);

  // One entry per obstacle (vehicles report body + mirrors separately).
  const byRef = new Map<string, EntryCollisionInfo>();
  for (const c of raw) {
    const n = names.get(c.obstacleId) ?? { ref: null, name: 'an obstacle' };
    const key = n.ref ? `${n.ref.kind}:${n.ref.id}` : c.obstacleId;
    const cur = byRef.get(key);
    const info: EntryCollisionInfo = { ref: n.ref, name: n.name, atDistance: c.atDistance, depth: c.depth, pose: c.pose, envelopeOnly: c.envelopeOnly };
    if (!cur || (cur.envelopeOnly && !c.envelopeOnly) || (cur.envelopeOnly === c.envelopeOnly && c.depth > cur.depth)) byRef.set(key, info);
  }
  const collisions = [...byRef.values()].sort((a, b) => Number(a.envelopeOnly) - Number(b.envelopeOnly) || a.atDistance - b.atDistance);
  const hits = collisions.filter((c) => !c.envelopeOnly);
  const tight = collisions.filter((c) => c.envelopeOnly);
  const mirrorWidth = spec.mirrorsFolded ? (spec.foldedMirrorWidth ?? spec.width + 80) : spec.mirrorWidth;
  const openingSlack = (opening.width - mirrorWidth) / 2;

  const how = direction === 'reverse' ? 'back in' : 'pull in forward';
  const doorMid = { x: (opening.a.x + opening.b.x) / 2, y: (opening.a.y + opening.b.y) / 2 };
  const where = (p: Pose) => {
    const d = dot(sub(p, doorMid), opening.inward);
    if (Math.abs(d) < spec.length / 2) return `while passing through the ${opening.feature.name}`;
    return d > 0 ? `${lengthWords(ctx, d - spec.length / 2)} inside the garage` : 'on the driveway';
  };
  let summary: string;
  if (plan.feasible) {
    summary = `The ${vehicle.name} can ${how} through the ${opening.feature.name} and reach its spot (about ${lengthWords(ctx, plan.length)} of travel).`;
    if (tight.length) summary += ` It passes within ${ctx.fmtLength(ENTRY_MARGIN)} of ${tight.map((t) => t.name).join(', ')}.`;
  } else {
    const first = hits[0];
    summary = first
      ? `The ${vehicle.name} can't ${how} to its spot: the body hits ${first.name} ${where(first.pose)} (${ctx.fmtLength(first.depth)} overlap).`
      : `The ${vehicle.name} can't find a path from the driveway to its spot.`;
    if (hits.length > 1) summary += ` It also hits ${hits.slice(1).map((h) => h.name).join(', ')}.`;
    summary += direction === 'forward' ? ' Try backing in, a different approach angle, or moving what is in the way.' : ' Try pulling in forward, a different approach angle, or moving what is in the way.';
  }
  if (openingSlack < inches(3)) {
    summary += openingSlack < 0
      ? ` The ${opening.feature.name} (${ctx.fmtLength(opening.width)}) is narrower than the ${vehicle.name} with mirrors (${ctx.fmtLength(mirrorWidth)}).`
      : ` Only ${ctx.fmtLength(openingSlack)} per side in the ${opening.feature.name} with mirrors ${spec.mirrorsFolded ? 'folded' : 'out'}.`;
  }
  return { vehicleId: vehicle.id, opening, start, goal, spec, direction, plan, feasible: plan.feasible, collisions, summary, openingSlack };
}

/** Memoized per analysis context (the UI and the analyzer share one computation per project version). */
export function entryFor(ctx: AnalysisContext, vehicle: Vehicle): EntryResult | { error: string } {
  return ctx.memo(`vehicles:entry:${vehicle.id}`, () => simulateEntry(ctx, vehicle));
}

// ───────────────────────────── planner ─────────────────────────────

interface PreparedObstacle {
  id: string;
  /** Lower than the mirrors: only the body can hit it. */
  low: boolean;
  polygon: Polygon;
  box: BBox;
  convex: boolean;
}

function prepare(obstacles: readonly EntryObstacle[], low: ReadonlySet<string> = new Set()): PreparedObstacle[] {
  return obstacles.map((o) => ({ id: o.id, low: low.has(o.id), polygon: o.polygon, box: bbox(o.polygon), convex: isConvex(o.polygon) }));
}

function penetration(part: Polygon, o: PreparedObstacle): number {
  if (o.convex) {
    const r = satConvex(part, o.polygon, 0.5);
    return r.colliding ? r.depth : 0;
  }
  const r = polygonCollision(part, o.polygon, 1);
  return r.colliding ? Math.max(r.depth, 0.5) : 0;
}

interface Contact {
  obstacleId: string;
  atDistance: number;
  depth: number;
  pose: Pose;
  envelopeOnly: boolean;
}

/** Body (and optional clearance-envelope) contacts along a sampled path. */
function pathContacts(spec: VehicleGeomSpec, poses: Pose[], distances: number[], obstacles: PreparedObstacle[], margin: number): Contact[] {
  const found = new Map<string, Contact>();
  poses.forEach((pose, i) => {
    const parts = vehicleParts(spec, pose);
    const env = margin > 0 ? localPolygonToWorld(pose, localRect(spec.width + 2 * margin, spec.length + 2 * margin)) : null;
    const envBox = bbox(env ?? parts.flat());
    for (const o of obstacles) {
      if (!bboxIntersects(envBox, o.box)) continue;
      let depth = 0;
      parts.forEach((p, k) => {
        if (!(k > 0 && o.low)) depth = Math.max(depth, penetration(p, o));
      });
      const envDepth = env && depth === 0 ? penetration(env, o) : 0;
      if (depth === 0 && envDepth === 0) continue;
      const bodyHit = depth > 0;
      const cur = found.get(o.id);
      if (!cur) found.set(o.id, { obstacleId: o.id, atDistance: distances[i] ?? 0, depth: bodyHit ? depth : envDepth, pose, envelopeOnly: !bodyHit });
      else if (bodyHit && cur.envelopeOnly) Object.assign(cur, { envelopeOnly: false, depth, atDistance: distances[i] ?? cur.atDistance, pose });
      else if (bodyHit || cur.envelopeOnly) cur.depth = Math.max(cur.depth, bodyHit ? depth : envDepth);
    }
  });
  return [...found.values()];
}

/** Total body penetration along a path, stopping early once it exceeds `limit`. */
function bodyDepth(spec: VehicleGeomSpec, poses: Pose[], obstacles: PreparedObstacle[], limit: number): number {
  let total = 0;
  for (const pose of poses) {
    const parts = vehicleParts(spec, pose);
    const box = bbox(parts.flat());
    for (const o of obstacles) {
      if (!bboxIntersects(box, o.box)) continue;
      parts.forEach((p, k) => {
        if (k > 0 && o.low) return;
        total += penetration(p, o);
      });
    }
    if (total > limit) return total;
  }
  return total;
}

/** Staging poses on the straight final approach into the parking spot (1/2 and 1 car length back). */
function approachStaging(goal: Pose, spec: VehicleGeomSpec, direction: 'forward' | 'reverse'): Pose[] {
  const theta = headingOf(goal);
  const back = { x: -Math.cos(theta), y: -Math.sin(theta) };
  const sign = direction === 'reverse' ? -1 : 1;
  return [0.5, 1].map((k) => {
    const c = add(goal, scale(back, sign * spec.length * k));
    return { x: c.x, y: c.y, rotation: goal.rotation };
  });
}

/**
 * Poses squared up to the opening at the lateral position closest to the parking spot (clamped so
 * the mirrors clear both jambs), from a car length outside to half a car length inside. Drivers line
 * up with their bay before the door and straighten inside; these let the planner do the same.
 */
function alignedStaging(opening: EntryOpening, spec: VehicleGeomSpec, goal: Pose, direction: 'forward' | 'reverse'): Pose[] {
  const mid = { x: (opening.a.x + opening.b.x) / 2, y: (opening.a.y + opening.b.y) / 2 };
  const along = scale(sub(opening.b, opening.a), 1 / Math.max(1, opening.width));
  const mirror = spec.mirrorsFolded ? (spec.foldedMirrorWidth ?? spec.width + 80) : spec.mirrorWidth;
  const maxLat = Math.max(0, (opening.width - mirror) / 2 - 50);
  const lat = Math.max(-maxLat, Math.min(maxLat, dot(sub(goal, mid), along)));
  const rotation = rotationForHeading(Math.atan2(opening.inward.y, opening.inward.x) + (direction === 'reverse' ? Math.PI : 0));
  return [-1, -0.5, 0, 0.5].map((k) => {
    const c = add(add(mid, scale(along, lat)), scale(opening.inward, k * spec.length));
    return { x: c.x, y: c.y, rotation };
  });
}

interface Candidate {
  word: string;
  length: number;
  chain: DubinsPath[];
}

function sampleChain(spec: VehicleGeomSpec, chain: DubinsPath[], step: number, reverse: boolean): { poses: Pose[]; distances: number[] } {
  const poses: Pose[] = [];
  const distances: number[] = [];
  let offset = 0;
  chain.forEach((path, k) => {
    const n = Math.max(1, Math.ceil(path.length / step));
    dubinsSamples(path, path.length / n).forEach((c, i) => {
      if (k > 0 && i === 0) return;
      poses.push(axleConfigToPose(spec, c, reverse));
      distances.push(offset + (i / n) * path.length);
    });
    offset += path.length;
  });
  return { poses, distances };
}

/**
 * Shortest collision-free maneuver among Dubins paths start → goal, directly or via one staging
 * pose. Candidates are tried shortest first and the first whose BODY never touches anything wins
 * (broad-phase boxes keep this fast); otherwise the least-bad path is returned.
 */
export function planEntry(
  spec: VehicleGeomSpec,
  start: Pose,
  goal: Pose,
  radius: number,
  obstacles: readonly EntryObstacle[],
  low: ReadonlySet<string>,
  direction: 'forward' | 'reverse',
  staging: readonly Pose[],
  step = 150,
): EntryPath {
  const reverse = direction === 'reverse';
  const prepared = prepare(obstacles, low);
  const qs = poseToAxleConfig(spec, start, reverse);
  const qg = poseToAxleConfig(spec, goal, reverse);
  const candidates: Candidate[] = dubinsPaths(qs, qg, radius).map((p) => ({ word: p.word, length: p.length, chain: [p] }));
  for (const via of staging) {
    const qv = poseToAxleConfig(spec, via, reverse);
    const first = dubinsPaths(qs, qv, radius).slice(0, 2);
    const second = dubinsPaths(qv, qg, radius).slice(0, 2);
    for (const a of first) for (const b of second) candidates.push({ word: `${a.word}+${b.word}`, length: a.length + b.length, chain: [a, b] });
  }
  candidates.sort((a, b) => a.length - b.length);
  let best: { c: Candidate; depth: number; poses: Pose[]; distances: number[] } | null = null;
  let tried = 0;
  for (const c of candidates) {
    tried++;
    const s = sampleChain(spec, c.chain, step, reverse);
    const depth = bodyDepth(spec, s.poses, prepared, 0);
    if (depth === 0) {
      best = { c, depth, ...s };
      break;
    }
  }
  if (!best) {
    // Nothing is collision-free: show the most natural (shortest) maneuver and where it hits.
    const c = candidates[0];
    if (!c) return { feasible: false, word: null, length: 0, poses: [], distances: [], tried };
    best = { c, depth: 1, ...sampleChain(spec, c.chain, step, reverse) };
  }
  return { feasible: best.depth === 0, word: best.c.word, length: best.c.length, poses: best.poses, distances: best.distances, tried };
}

const sweptCache = new WeakMap<EntryPath, MultiPolygon>();
/** Union of the body over the maneuver (sampled about every 300 mm), for drawing. Cached per path. */
export function sweptRegion(spec: VehicleGeomSpec, path: EntryPath): MultiPolygon {
  const hit = sweptCache.get(path);
  if (hit) return hit;
  const every = Math.max(1, Math.round(300 / 150));
  const bodies = path.poses.filter((_, i) => i % every === 0 || i === path.poses.length - 1).flatMap((p) => vehicleParts(spec, p));
  const r = bodies.length ? union(...bodies) : [];
  sweptCache.set(path, r);
  return r;
}

/** A few body outlines along the path (for warning highlights without the cost of a union). */
export function pathGhosts(spec: VehicleGeomSpec, path: EntryPath, every = 1200): Polygon[] {
  const out: Polygon[] = [];
  let next = 0;
  path.poses.forEach((p, i) => {
    const d = path.distances[i] ?? 0;
    if (d >= next || i === path.poses.length - 1) {
      out.push(vehicleParts(spec, p)[0]!);
      next = d + every;
    }
  });
  return out;
}

