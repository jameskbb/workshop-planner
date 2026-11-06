/**
 * Layout facts (pure): the measured quantities behind the scorecard metrics and "Ask the Layout"
 * answers: vehicle side gaps and door opening, clear space in front of work surfaces, outlet
 * distances for powered machines and wall-storage coverage. Every function takes the shared
 * AnalysisContext and memoizes on it.
 */
import type { AnalysisContext, AnalyzedObject, AnalyzedVehicle } from '@/analysis';
import { featureFootprint, vehicleGeomSpec } from '@/domain/resolve';
import { inches } from '@/domain/units';
import type { ElectricalPoint, ElectricalRequirement, EntityRef } from '@/domain/schema';
import {
  checkDoorOpening,
  containsPoint,
  distanceToBoundary,
  faceClearance,
  pointSegmentDistance,
  localToWorld,
  polygonSegments,
  rotate,
  sideSign,
  wallUtilization,
  type DoorId,
  type Point,
  type Polygon,
} from '@/geometry';
import { theName, walkObstacles } from '@/features/walkability/model';
import { electricalPrefs, outletReach } from '@/features/electrical/reach';

type Seg = [Point, Point];

/** Distance from a point to a polygon (0 inside). */
export function pointPolygonDistance(poly: Polygon, p: Point): number {
  if (poly.length < 3) return Infinity;
  return containsPoint(poly, p) ? 0 : distanceToBoundary(poly, p).distance;
}

/** Wall segments + floor obstacles except the excluded entity. */
function obstacleSegments(ctx: AnalysisContext, exclude?: EntityRef): Seg[] {
  const segs: Seg[] = ctx.hasRoom ? polygonSegments(ctx.room.polygon) : [];
  for (const o of walkObstacles(ctx)) {
    if (exclude && o.ref.kind === exclude.kind && o.ref.id === exclude.id) continue;
    segs.push(...polygonSegments(o.polygon));
  }
  return segs;
}

/** Which obstacle (or wall) a point lies on, for "… to the tool cabinet" phrasing. */
function obstacleAt(ctx: AnalysisContext, p: Point, exclude?: EntityRef): string {
  let best = { d: 30, name: '' };
  for (const o of walkObstacles(ctx)) {
    if (exclude && o.ref.kind === exclude.kind && o.ref.id === exclude.id) continue;
    const d = pointPolygonDistance(o.polygon, p);
    if (d < best.d) best = { d, name: theName(o.name) };
  }
  if (best.name) return best.name;
  let wall = { d: Infinity, name: 'the wall' };
  for (const w of ctx.room.walls) {
    const d = pointSegmentDistance(p, w.a, w.b);
    if (d < wall.d) wall = { d, name: `the ${w.name}` };
  }
  return wall.name;
}

// ───────────────────────────── vehicles ─────────────────────────────

export type VehicleSideName = 'driver' | 'passenger' | 'front' | 'rear';
export const VEHICLE_SIDES: VehicleSideName[] = ['driver', 'passenger', 'front', 'rear'];

export interface SideGap {
  side: VehicleSideName;
  /** Clear distance from the body to the nearest obstacle or wall (mm; Infinity = open). */
  clear: number;
  desired: number;
  from: Point;
  to: Point;
  /** "the tool cabinet", "the North wall". */
  against: string;
}

export interface VehicleFacts {
  vehicle: AnalyzedVehicle;
  sides: Record<VehicleSideName, SideGap>;
  doors: Array<{ id: DoorId; label: string; maxAngle: number; openAngle: number; fullyOpens: boolean; egressGap: number; blockedBy: string | null }>;
}

const DOOR_LABEL: Record<DoorId, string> = {
  'driver-front': 'driver door',
  'passenger-front': 'passenger door',
  'driver-rear': 'driver-side rear door',
  'passenger-rear': 'passenger-side rear door',
};

export function vehicleFacts(ctx: AnalysisContext, v: AnalyzedVehicle): VehicleFacts {
  return ctx.memo(`facts:vehicle:${v.id}`, () => {
    const spec = v.spec;
    const ref: EntityRef = { kind: 'vehicle', id: v.id };
    const segs = obstacleSegments(ctx, ref);
    const hw = spec.width / 2;
    const hl = spec.length / 2;
    const face = (side: VehicleSideName): { a: Point; b: Point; n: Point } => {
      switch (side) {
        case 'front':
          return { a: { x: -hw, y: hl }, b: { x: hw, y: hl }, n: { x: 0, y: 1 } };
        case 'rear':
          return { a: { x: hw, y: -hl }, b: { x: -hw, y: -hl }, n: { x: 0, y: -1 } };
        default: {
          const s = sideSign(spec, side);
          return { a: { x: s * hw, y: -hl }, b: { x: s * hw, y: hl }, n: { x: s, y: 0 } };
        }
      }
    };
    const desired = v.vehicle.desiredClearance;
    const sides = {} as Record<VehicleSideName, SideGap>;
    for (const side of VEHICLE_SIDES) {
      const f = face(side);
      const c = faceClearance(localToWorld(v.pose, f.a), localToWorld(v.pose, f.b), rotate(f.n, v.pose.rotation), segs, 11);
      sides[side] = {
        side,
        clear: c.distance,
        desired: desired[side],
        from: c.from,
        to: c.to,
        against: Number.isFinite(c.distance) ? obstacleAt(ctx, c.to, ref) : 'nothing',
      };
    }
    // Doors: check against walls (as thin polygons) and every floor obstacle.
    const obstacles = walkObstacles(ctx).filter((o) => !(o.ref.kind === 'vehicle' && o.ref.id === v.id));
    const polys: Polygon[] = [...obstacles.map((o) => o.polygon), ...ctx.room.walls.map((w) => wallSliver(w.a, w.b, w.outward))];
    const names = [...obstacles.map((o) => theName(o.name)), ...ctx.room.walls.map((w) => `the ${w.name}`)];
    const doors = vehicleGeomSpec(v.vehicle).doors.map((d) => {
      const r = checkDoorOpening(spec, v.pose, d, polys);
      return {
        id: d.id,
        label: DOOR_LABEL[d.id],
        maxAngle: r.maxAngle,
        openAngle: d.openAngle,
        fullyOpens: r.fullyOpens,
        egressGap: r.egressGap,
        blockedBy: r.blockedBy >= 0 ? (names[r.blockedBy] ?? 'an obstacle') : null,
      };
    });
    return { vehicle: v, sides, doors };
  });
}

/** A 20 mm band just outside a wall segment (so door leaves "hit" walls). */
function wallSliver(a: Point, b: Point, outward: Point): Polygon {
  const o = { x: outward.x * 20, y: outward.y * 20 };
  return [a, b, { x: b.x + o.x, y: b.y + o.y }, { x: a.x + o.x, y: a.y + o.y }];
}

/** Door opening is "usable" when the leaf reaches at least this angle (typical egress ≈ 40°). */
export const USABLE_DOOR_ANGLE = 40;

// ───────────────────────────── work surfaces ─────────────────────────────

export interface SurfaceAccess {
  object: AnalyzedObject;
  /** Clear floor in front of the working face (mm; Infinity = open). */
  clear: number;
  from: Point;
  to: Point;
  against: string;
}

/** Recommended standing room in front of a bench (mm): 36". */
export const BENCH_STANDING_ROOM = inches(36);

export function workSurfaceAccess(ctx: AnalysisContext): SurfaceAccess[] {
  return ctx.memo('facts:work-surfaces', () =>
    ctx.objects
      .filter((o) => o.resolved.category === 'work-surface' && !o.resolved.elevated)
      .map((o) => {
        const ref: EntityRef = { kind: 'object', id: o.id };
        const fp = o.resolved.footprint;
        const ox = fp.offsetX ?? 0;
        const oy = fp.offsetY ?? 0;
        const a = localToWorld(o.pose, { x: ox - fp.width / 2, y: oy + fp.depth / 2 });
        const b = localToWorld(o.pose, { x: ox + fp.width / 2, y: oy + fp.depth / 2 });
        const c = faceClearance(a, b, rotate({ x: 0, y: 1 }, o.pose.rotation), obstacleSegments(ctx, ref), 9);
        return { object: o, clear: c.distance, from: c.from, to: c.to, against: Number.isFinite(c.distance) ? obstacleAt(ctx, c.to, ref) : 'nothing' };
      }),
  );
}

// ───────────────────────────── electrical ─────────────────────────────

/**
 * Outlet reach for the scorecard and Ask the Layout. There is exactly ONE implementation of
 * "which outlet can power this?" and "how far is it?": `outletReach` in features/electrical/reach.ts
 * (R-011: this file used to have a second one whose voltage rule accepted a 240 V outlet for a
 * 120 V tool, so Ask and the electrical analyzer disagreed about the same planer). The distance
 * limit is the one the user set in the Safety panel (`electricalPrefs.maxDistance`).
 */
export interface OutletDistance {
  object: AnalyzedObject;
  requirement: ElectricalRequirement;
  /** Nearest outlet that can power it (null when the project has none of that voltage). */
  outlet: ElectricalPoint | null;
  outletName: string;
  outletPoint: Point | null;
  /** Cord distance from where the machine is used to that outlet (mm). */
  distance: number;
  tooFar: boolean;
  /** True when the only outlet of the right voltage is rated below the tool's amperage. */
  underRated: boolean;
}

export function outletLabel(e: ElectricalPoint): string {
  if (e.label) return e.label;
  return e.kind === 'outlet-240' ? '240V outlet' : e.kind === 'ceiling-outlet' ? 'ceiling outlet' : e.kind === 'extension-point' ? 'extension point' : '120V outlet';
}

/** The distance beyond which a machine needs a long cord (the user's setting; 8' by default). */
export const outletReachLimit = (ctx: AnalysisContext): number => electricalPrefs.read(ctx.project).maxDistance;

/** Nearest suitable outlet for every machine with an electrical requirement. */
export function outletDistances(ctx: AnalysisContext): OutletDistance[] {
  return ctx.memo('facts:outlets', () => {
    const limit = outletReachLimit(ctx);
    const out: OutletDistance[] = [];
    for (const r of outletReach(ctx)) {
      const object = ctx.objectById.get(r.objectId);
      if (!object) continue;
      const option = r.best ?? r.underRated;
      out.push({
        object,
        requirement: r.requirement,
        outlet: option?.point ?? null,
        outletName: option ? outletLabel(option.point) : `no ${r.requirement.voltage}V outlet`,
        outletPoint: option?.position ?? null,
        distance: option?.distance ?? Infinity,
        tooFar: !r.best || r.best.distance > limit,
        underRated: !r.best && !!r.underRated,
      });
    }
    return out;
  });
}

// ───────────────────────────── walls & storage ─────────────────────────────

/** Unusable wall intervals (doors, garage doors, windows below 4') per wall index. */
export function wallOpenings(ctx: AnalysisContext): Array<Array<[number, number]>> {
  return ctx.memo('facts:wall-openings', () => {
    const out: Array<Array<[number, number]>> = ctx.room.walls.map(() => []);
    for (const f of ctx.project.architecture) {
      if (f.hidden || f.placement.type !== 'wall') continue;
      const k = f.kind;
      const opening = k === 'door' || k === 'double-door' || k === 'garage-door' || (k === 'window' && f.elevation < inches(48));
      if (!opening) continue;
      const wi = ctx.room.wallIndex.get(f.placement.wallId);
      if (wi === undefined) continue;
      out[wi]!.push([f.placement.offset - f.width / 2, f.placement.offset + f.width / 2]);
    }
    return out;
  });
}

export interface WallStorage {
  /** Usable wall length (total minus openings), mm. */
  usable: number;
  /** Length of wall with storage against or on it, mm. */
  storage: number;
  /** Length with anything against it, mm. */
  occupied: number;
  perWall: Array<{ wallIndex: number; name: string; usable: number; storage: number; occupied: number; available: number }>;
}

/** Linear wall use: storage (cabinets, shelving, racks; floor or wall-mounted) vs everything. */
export function wallStorage(ctx: AnalysisContext): WallStorage {
  return ctx.memo('facts:wall-storage', () => {
    const openings = wallOpenings(ctx);
    const storagePolys = ctx.objects.filter((o) => o.resolved.category === 'storage').map((o) => o.footprint);
    const anyPolys = [
      ...ctx.objects.map((o) => o.footprint),
      ...ctx.features.filter((f) => f.blocksFloor).map((f) => featureFootprint(ctx.project.room, f.feature)),
    ];
    const st = wallUtilization(ctx.room.walls, ctx.room.polygon, storagePolys, openings, 300);
    const all = wallUtilization(ctx.room.walls, ctx.room.polygon, anyPolys, openings, 610);
    const perWall = ctx.room.walls.map((w, i) => {
      const usable = Math.max(0, w.length - (all[i]?.openings ?? 0));
      return { wallIndex: i, name: w.name, usable, storage: st[i]?.occupied ?? 0, occupied: all[i]?.occupied ?? 0, available: all[i]?.available ?? 0 };
    });
    return {
      usable: perWall.reduce((s, w) => s + w.usable, 0),
      storage: perWall.reduce((s, w) => s + w.storage, 0),
      occupied: perWall.reduce((s, w) => s + w.occupied, 0),
      perWall,
    };
  });
}
