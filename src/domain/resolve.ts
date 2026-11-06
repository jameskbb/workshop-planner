/**
 * Pure helpers that resolve domain entities into geometry: active scenario, definition lookup,
 * state-resolved footprints/clearances, wall geometry with names, wall-hosted feature poses and
 * vehicle geometry specs. Everything here is memoized by object identity (immutable state), so
 * repeated calls from selectors/analyzers are cheap.
 */
import {
  footprintWorldPolygon,
  localPolygonToWorld,
  localRect,
  pointOnWall,
  roomWalls,
  rotationFacingAwayFromWall,
  type LocalFootprint,
  type Point,
  type Polygon,
  type Pose,
  type VehicleGeomSpec,
  type WallGeom,
} from '@/geometry';
import { isDraft } from 'immer';
import type {
  ArchitecturalFeature,
  ClearanceZone,
  ElectricalPoint,
  LayerId,
  ObjectCategory,
  ObjectDefinition,
  ObjectStateDef,
  PlacedObject,
  Placement,
  Project,
  Room,
  Scenario,
  Vehicle,
} from './schema';
import { OPENING_KINDS } from './schema';

// ───────────────────────────── memo helper ─────────────────────────────

/** Memoize by object identity. Immer drafts are never cached (they are mutable proxies). */
function memoByRef<K extends object, V>(fn: (k: K) => V): (k: K) => V {
  const cache = new WeakMap<K, V>();
  return (k: K) => {
    if (isDraft(k)) return fn(k);
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const v = fn(k);
    cache.set(k, v);
    return v;
  };
}

// ───────────────────────────── scenario / definitions ─────────────────────────────

export function getScenario(project: Project, scenarioId?: string): Scenario {
  const id = scenarioId ?? project.activeScenarioId;
  return project.scenarios.find((s) => s.id === id) ?? project.scenarios[0]!;
}

export const activeScenario = (project: Project): Scenario => getScenario(project);

const definitionIndex = memoByRef((defs: ObjectDefinition[]) => new Map(defs.map((d) => [d.id, d])));

export function findDefinition(project: Project, id: string): ObjectDefinition | undefined {
  return definitionIndex(project.definitions).get(id);
}

const objectIndex = memoByRef((objects: PlacedObject[]) => new Map(objects.map((o) => [o.id, o])));

export function findObject(scenario: Scenario, id: string): PlacedObject | undefined {
  return objectIndex(scenario.objects).get(id);
}

// ───────────────────────────── room & walls ─────────────────────────────

export const roomPolygon = memoByRef((room: Room): Polygon => room.vertices.map((v) => ({ x: v.x, y: v.y })));

export interface RoomGeometry {
  polygon: Polygon;
  walls: WallGeom[];
  /** Wall id → wall index. */
  wallIndex: Map<string, number>;
  thickness: number[];
  /** Wall heights (defaults to ceiling height). */
  heights: number[];
}

/** Wall geometry with human names (user names win, else compass names). */
export const roomGeometry = memoByRef((room: Room): RoomGeometry => {
  const polygon = roomPolygon(room);
  const walls = roomWalls(polygon, { names: room.walls.map((w) => w.name) });
  return {
    polygon,
    walls,
    wallIndex: new Map(room.walls.map((w, i) => [w.id, i])),
    thickness: room.walls.map((w) => w.thickness),
    heights: room.walls.map((w) => w.height ?? room.ceilingHeight),
  };
});

export function wallGeomById(room: Room, wallId: string): WallGeom | undefined {
  const g = roomGeometry(room);
  const i = g.wallIndex.get(wallId);
  return i === undefined ? undefined : g.walls[i];
}

// ───────────────────────────── wall-hosted placement ─────────────────────────────

export interface ResolvedPlacement {
  pose: Pose;
  /** Wall geometry if wall-hosted and the wall still exists. */
  wall?: WallGeom;
  /** Along-wall interval [start, end] (wall placements). */
  interval?: [number, number];
}

/**
 * World pose of a placement. For wall placements the pose is the feature CENTER, sitting `depth/2`
 * inside the wall's interior face, rotated so the feature's front faces into the room.
 */
export function resolvePlacement(room: Room, placement: Placement, width: number, depth: number): ResolvedPlacement {
  if (placement.type === 'free') return { pose: { x: placement.x, y: placement.y, rotation: placement.rotation } };
  const wall = wallGeomById(room, placement.wallId);
  if (!wall) return { pose: { x: 0, y: 0, rotation: 0 } };
  const c = pointOnWall(wall, placement.offset, depth / 2);
  return {
    pose: { x: c.x, y: c.y, rotation: rotationFacingAwayFromWall(wall) },
    wall,
    interval: [placement.offset - width / 2, placement.offset + width / 2],
  };
}

/** World footprint of an architectural feature (openings return the opening footprint within the wall). */
export function featureFootprint(room: Room, f: ArchitecturalFeature): Polygon {
  if (OPENING_KINDS.has(f.kind) && f.placement.type === 'wall') {
    const wall = wallGeomById(room, f.placement.wallId);
    if (!wall) return [];
    const g = roomGeometry(room);
    const t = g.thickness[wall.index] ?? 150;
    const s0 = f.placement.offset - f.width / 2;
    const s1 = f.placement.offset + f.width / 2;
    return [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, -t), pointOnWall(wall, s0, -t)];
  }
  const { pose } = resolvePlacement(room, f.placement, f.width, f.depth);
  if (f.shape === 'round') return circlePolygon(pose, f.width / 2);
  return localPolygonToWorld(pose, localRect(f.width, f.depth));
}

export function circlePolygon(center: Point, radius: number, segments = 24): Polygon {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

/** World position of an electrical point (center of its plate). */
export function electricalPosition(room: Room, e: ElectricalPoint): Point {
  const { pose } = resolvePlacement(room, e.placement, e.width, 20);
  return { x: pose.x, y: pose.y };
}

// ───────────────────────────── objects ─────────────────────────────

export interface ResolvedObject {
  object: PlacedObject;
  definition?: ObjectDefinition;
  state?: ObjectStateDef;
  name: string;
  label: string;
  category: ObjectCategory | 'unknown';
  layer: LayerId;
  /** State-resolved footprint in the local frame. */
  footprint: LocalFootprint;
  height: number;
  clearances: ClearanceZone[];
  /** Pose currently in effect (parked or working). */
  pose: Pose;
  parkedPose: Pose;
  workingPose?: Pose;
  mobile: boolean;
  wallMounted: boolean;
  /** Bottom elevation (mm); the object occupies [elevation, elevation + height] vertically. */
  elevation: number;
  /** True for wall- or ceiling-mounted items (not standing on the floor). */
  elevated: boolean;
}

/** True when two resolved objects overlap vertically (so a plan-view overlap is a real collision). */
export function verticalOverlap(a: ResolvedObject, b: ResolvedObject, tolerance = 1): boolean {
  return a.elevation < b.elevation + b.height - tolerance && b.elevation < a.elevation + a.height - tolerance;
}

const categoryLayer: Record<ObjectCategory, LayerId> = {
  'work-surface': 'woodworking',
  'stationary-tool': 'woodworking',
  storage: 'storage',
  misc: 'general',
  'dust-collection': 'dust',
};

/** Resolve a placed object against its definition and active state. Pure; memoized per (project defs, object). */
export function resolveObject(project: Project, object: PlacedObject): ResolvedObject {
  const cacheable = !isDraft(project.definitions) && !isDraft(object);
  const perDefs = cacheable ? resolvedCache(project.definitions) : new WeakMap<PlacedObject, ResolvedObject>();
  const hit = perDefs.get(object);
  if (hit) return hit;
  const definition = findDefinition(project, object.definitionId);
  const state = object.stateId ? definition?.states.find((s) => s.id === object.stateId) : undefined;
  // Instance dimensions scale state footprints proportionally when the user resized the object.
  const sx = definition ? object.width / definition.width : 1;
  const sy = definition ? object.depth / definition.depth : 1;
  const footprint: LocalFootprint = state?.footprint
    ? {
        width: state.footprint.width * sx,
        depth: state.footprint.depth * sy,
        offsetX: state.footprint.offsetX * sx,
        offsetY: state.footprint.offsetY * sy,
      }
    : { width: object.width, depth: object.depth };
  const clearances = object.clearances ?? state?.clearances ?? definition?.clearances ?? [];
  const parkedPose = { x: object.x, y: object.y, rotation: object.rotation };
  const mobile = object.mobility === 'mobile';
  const workingPose = mobile ? object.working : undefined;
  const pose = object.activePosition === 'working' && workingPose ? workingPose : parkedPose;
  const category = definition?.category ?? 'unknown';
  const resolved: ResolvedObject = {
    object,
    definition,
    state,
    name: object.name,
    label: object.label ?? object.name,
    category,
    layer: object.layer ?? definition?.layer ?? (category === 'unknown' ? 'general' : categoryLayer[category]),
    footprint,
    height: state?.height ?? object.height,
    clearances,
    pose,
    parkedPose,
    workingPose,
    mobile,
    wallMounted: object.mount === 'wall',
    // Floor items may sit on something (e.g. a benchtop tool on a bench), so elevation always applies.
    elevation: object.elevation,
    elevated: object.mount !== 'floor',
  };
  perDefs.set(object, resolved);
  return resolved;
}

const resolvedCaches = new WeakMap<ObjectDefinition[], WeakMap<PlacedObject, ResolvedObject>>();
function resolvedCache(defs: ObjectDefinition[]): WeakMap<PlacedObject, ResolvedObject> {
  let m = resolvedCaches.get(defs);
  if (!m) {
    m = new WeakMap();
    resolvedCaches.set(defs, m);
  }
  return m;
}

/** World footprint polygon of a resolved object at a pose (defaults to its active pose). */
export function objectFootprint(r: ResolvedObject, pose: Pose = r.pose): Polygon {
  return footprintWorldPolygon(r.footprint, pose);
}

// ───────────────────────────── vehicles ─────────────────────────────

export function vehicleGeomSpec(v: Vehicle): VehicleGeomSpec {
  return {
    length: v.length,
    width: v.width,
    mirrorWidth: v.mirrorWidth,
    foldedMirrorWidth: v.foldedMirrorWidth,
    mirrorsFolded: v.mirrorsFolded,
    wheelbase: v.wheelbase,
    frontOverhang: v.frontOverhang,
    doors: v.doors,
    driverSide: v.driverSide,
    rearAccessDepth: v.rearAccess.depth,
    hoodAccessDepth: v.hoodAccessDepth,
  };
}

export const vehiclePose = (v: Vehicle): Pose => ({ x: v.x, y: v.y, rotation: v.rotation });
