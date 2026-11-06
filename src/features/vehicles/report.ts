/**
 * Vehicle usability report (pure): how far each door opens and what stops it, the walking room on
 * each side against the user's desired clearances, and whether the trunk/hatch/tailgate and hood
 * can be reached. Used by the vehicle analyzers AND the vehicle overlay, so the plan shows exactly
 * what the warnings say. Accepts a (possibly live-dragged) vehicle and reads obstacles from the
 * analysis context, excluding the vehicle itself.
 */
import type { AnalysisContext } from '@/analysis/context';
import { vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import type { EntityRef, Vehicle, VehicleDoor } from '@/domain/schema';
import { inches } from '@/domain/units';
import {
  areaOfMulti,
  bbox,
  bboxIntersects,
  checkDoorOpening,
  clearanceBands,
  difference,
  dot,
  doorSwingPolygon,
  hoodAccessZone,
  intersect,
  localToWorld,
  rearAccessZone,
  rotate,
  sideSign,
  sub,
  vehicleParts,
  wallQuads,
  type BBox,
  type MultiPolygon,
  type Point,
  type Polygon,
  type Pose,
  type VehicleGeomSpec,
  type VehicleSide,
} from '@/geometry';

/** Vertical band a car door sweeps through (mm above the floor). */
export const DOOR_BAND: [number, number] = [inches(12), inches(48)];
/** Items hanging above this height do not block walking beside the car (mm). */
export const WALK_BAND_TOP = inches(48);
/** Comfortable gap needed to get out of a car door (mm). */
export const EGRESS_GAP = inches(24);

export interface VehicleObstacle {
  ref: EntityRef | { kind: 'wall'; id: string };
  name: string;
  polygon: Polygon;
  box: BBox;
  bottom: number;
  top: number;
}

export const DOOR_LABEL: Record<VehicleDoor['id'], string> = {
  'driver-front': 'driver door',
  'passenger-front': 'passenger door',
  'driver-rear': 'rear driver-side door',
  'passenger-rear': 'rear passenger-side door',
};

export const SIDE_LABEL: Record<VehicleSide, string> = { driver: 'driver side', passenger: 'passenger side', front: 'front', rear: 'rear' };

/** Everything around vehicles: objects, floor features, other vehicles and the walls (as thick quads). */
export function vehicleObstacles(ctx: AnalysisContext): VehicleObstacle[] {
  return ctx.memo('vehicles:obstacles', () => {
    const out: VehicleObstacle[] = [];
    for (const o of ctx.objects) out.push({ ref: { kind: 'object', id: o.id }, name: o.name, polygon: o.footprint, box: o.bbox, bottom: o.resolved.elevation, top: o.resolved.elevation + o.resolved.height });
    for (const f of ctx.features) {
      if (!f.blocksFloor) continue;
      out.push({ ref: { kind: 'feature', id: f.id }, name: `the ${f.name}`, polygon: f.footprint, box: bbox(f.footprint), bottom: f.feature.elevation, top: f.feature.elevation + f.feature.height });
    }
    for (const v of ctx.vehicles) {
      for (const part of v.parts) out.push({ ref: { kind: 'vehicle', id: v.id }, name: v.name, polygon: part, box: bbox(part), bottom: 0, top: v.vehicle.height });
    }
    if (ctx.hasRoom) {
      const quads = wallQuads(ctx.room.polygon, ctx.room.thickness.map((t) => t + 600));
      quads.forEach((q, i) => {
        const w = ctx.room.walls[i]!;
        out.push({ ref: { kind: 'wall', id: ctx.project.room.walls[i]?.id ?? String(i) }, name: `the ${w.name}`, polygon: q, box: bbox(q), bottom: 0, top: Infinity });
      });
    }
    return out;
  });
}

export interface DoorReport {
  door: VehicleDoor;
  label: string;
  maxAngle: number;
  fullyOpens: boolean;
  /** Lateral room to get out at the reachable angle (mm). */
  egressGap: number;
  blocker?: VehicleObstacle;
  /** Full-open sector and the reachable sector (world). */
  sector: Polygon;
  reachable: Polygon;
}

export interface SideReport {
  side: VehicleSide;
  desired: number;
  /** Clear distance from the body to the first obstacle within the desired band (capped at desired). */
  clear: number;
  ok: boolean;
  blocker?: VehicleObstacle;
  band: Polygon;
  region?: MultiPolygon;
}

export interface AccessReport {
  which: 'rear' | 'hood';
  label: string;
  zone: Polygon;
  depth: number;
  clear: number;
  ok: boolean;
  blocker?: VehicleObstacle;
  region?: MultiPolygon;
}

export interface VehicleReport {
  vehicle: Vehicle;
  spec: VehicleGeomSpec;
  pose: Pose;
  parts: Polygon[];
  doors: DoorReport[];
  sides: SideReport[];
  access: AccessReport[];
}

const inBand = (o: VehicleObstacle, lo: number, hi: number) => o.bottom < hi && o.top > lo;

function sideFrame(spec: VehicleGeomSpec, pose: Pose, side: VehicleSide): { origin: Point; normal: Point } {
  let local: Point;
  let n: Point;
  switch (side) {
    case 'front':
      local = { x: 0, y: spec.length / 2 };
      n = { x: 0, y: 1 };
      break;
    case 'rear':
      local = { x: 0, y: -spec.length / 2 };
      n = { x: 0, y: -1 };
      break;
    default: {
      const s = sideSign(spec, side);
      local = { x: (s * spec.width) / 2, y: 0 };
      n = { x: s, y: 0 };
    }
  }
  return { origin: localToWorld(pose, local), normal: rotate(n, pose.rotation) };
}

/**
 * Clear distance from a face (origin + outward normal) to the nearest obstacle within `zone`.
 * Walls use the zone's part outside the room. Returns the capped clear distance and the blocker.
 */
function clearWithin(ctx: AnalysisContext, zone: Polygon, origin: Point, normal: Point, depth: number, obstacles: VehicleObstacle[]): { clear: number; blocker?: VehicleObstacle; region?: MultiPolygon } {
  const zb = bbox(zone);
  let best: { clear: number; blocker?: VehicleObstacle; region?: MultiPolygon } = { clear: depth };
  for (const o of obstacles) {
    if (o.ref.kind === 'wall' || !bboxIntersects(zb, o.box)) continue;
    const reg = intersect(zone, o.polygon);
    if (areaOfMulti(reg) < 50) continue;
    let d = Infinity;
    for (const piece of reg) for (const p of piece.outer) d = Math.min(d, dot(sub(p, origin), normal));
    d = Math.max(0, d);
    if (d < best.clear) best = { clear: d, blocker: o, region: reg };
  }
  // Anything outside the room (beyond a wall face) also blocks.
  if (ctx.hasRoom) {
    const outside = difference(zone, ctx.room.polygon);
    if (areaOfMulti(outside) >= 50) {
      let d = Infinity;
      for (const piece of outside) for (const p of piece.outer) d = Math.min(d, dot(sub(p, origin), normal));
      d = Math.max(0, d);
      if (d < best.clear) {
        const wall = obstacles.find((o) => o.ref.kind === 'wall' && bboxIntersects(zb, o.box) && areaOfMulti(intersect(zone, o.polygon)) >= 50);
        best = { clear: d, blocker: wall, region: outside };
      }
    }
  }
  return best;
}

export function vehicleReport(ctx: AnalysisContext, vehicle: Vehicle): VehicleReport {
  const spec = vehicleGeomSpec(vehicle);
  const pose = vehiclePose(vehicle);
  const parts = vehicleParts(spec, pose);
  const others = vehicleObstacles(ctx).filter((o) => !(o.ref.kind === 'vehicle' && o.ref.id === vehicle.id));
  const box = bbox(parts.flat());
  const reach = Math.max(...vehicle.doors.map((d) => d.length), vehicle.desiredClearance.driver, vehicle.desiredClearance.passenger, vehicle.desiredClearance.front, vehicle.desiredClearance.rear, vehicle.rearAccess.depth, vehicle.hoodAccessDepth) + 200;
  const near = others.filter((o) => bboxIntersects({ minX: box.minX - reach, minY: box.minY - reach, maxX: box.maxX + reach, maxY: box.maxY + reach }, o.box));

  const doorObstacles = near.filter((o) => inBand(o, DOOR_BAND[0], DOOR_BAND[1]));
  const doors: DoorReport[] = vehicle.doors.map((door) => {
    const r = checkDoorOpening(spec, pose, door, doorObstacles.map((o) => o.polygon));
    return {
      door,
      label: DOOR_LABEL[door.id],
      maxAngle: r.maxAngle,
      fullyOpens: r.fullyOpens,
      egressGap: r.egressGap,
      blocker: r.blockedBy >= 0 ? doorObstacles[r.blockedBy] : undefined,
      sector: doorSwingPolygon(spec, pose, door),
      reachable: doorSwingPolygon(spec, pose, door, Math.max(r.maxAngle, 0.5)),
    };
  });

  const walkObstacles = near.filter((o) => inBand(o, 0, WALK_BAND_TOP));
  const bands = clearanceBands(spec, pose, vehicle.desiredClearance);
  const sides: SideReport[] = (['driver', 'passenger', 'front', 'rear'] as VehicleSide[]).map((side) => {
    const desired = vehicle.desiredClearance[side];
    if (desired <= 0) return { side, desired, clear: 0, ok: true, band: bands[side] };
    const { origin, normal } = sideFrame(spec, pose, side);
    const r = clearWithin(ctx, bands[side], origin, normal, desired, walkObstacles);
    return { side, desired, clear: r.clear, ok: r.clear >= desired - 12.7, blocker: r.blocker, band: bands[side], region: r.region };
  });

  const accessObstacles = near.filter((o) => inBand(o, 0, inches(72)));
  const access: AccessReport[] = [
    { which: 'rear' as const, label: vehicle.rearAccess.kind, zone: rearAccessZone(spec, pose), depth: vehicle.rearAccess.depth, side: 'rear' as const },
    { which: 'hood' as const, label: 'hood', zone: hoodAccessZone(spec, pose), depth: vehicle.hoodAccessDepth, side: 'front' as const },
  ].map((a) => {
    const { origin, normal } = sideFrame(spec, pose, a.side);
    const r = clearWithin(ctx, a.zone, origin, normal, a.depth, accessObstacles);
    return { which: a.which, label: a.label, zone: a.zone, depth: a.depth, clear: r.clear, ok: r.clear >= a.depth - 12.7, blocker: r.blocker, region: r.region };
  });

  return { vehicle, spec, pose, parts, doors, sides, access };
}

/** Memoized report for a stored vehicle (by analysis context). */
export function vehicleReportFor(ctx: AnalysisContext, vehicle: Vehicle): VehicleReport {
  return ctx.memo(`vehicles:report:${vehicle.id}`, () => vehicleReport(ctx, vehicle));
}
