/**
 * Space and wall utilization math. Clearance overlays are never counted as physical footprint.
 */
import { areaOfMulti, intersect, union } from './clip';
import { area, type Polygon } from './polygon';
import { mergeIntervals } from './segment';
import { occupiedWallIntervals } from './wallspace';
import type { WallGeom } from './walls';

export interface SpaceUtilizationInput {
  room: Polygon;
  /** Permanent obstructions (poles, water heater, stairs, built-ins…). */
  obstructions: readonly Polygon[];
  /** Physical footprints of floor objects and vehicles. */
  footprints: readonly Polygon[];
  /** Workflow zones (may overlap each other and objects). */
  zones?: readonly Polygon[];
}

export interface SpaceUtilization {
  roomArea: number;
  obstructionArea: number;
  footprintArea: number;
  openArea: number;
  zoneArea: number;
  /** Percentages of room area (0–100). */
  pct: { obstruction: number; footprint: number; open: number; zone: number };
}

/** Areas are computed with polygon unions clipped to the room, so overlaps are never double-counted. */
export function spaceUtilization(input: SpaceUtilizationInput): SpaceUtilization {
  const roomArea = input.room.length >= 3 ? area(input.room) : 0;
  if (roomArea === 0) {
    return { roomArea: 0, obstructionArea: 0, footprintArea: 0, openArea: 0, zoneArea: 0, pct: { obstruction: 0, footprint: 0, open: 0, zone: 0 } };
  }
  const obst = intersect(union(...input.obstructions), input.room);
  const obstructionArea = areaOfMulti(obst);
  const allSolid = intersect(union(...input.obstructions, ...input.footprints), input.room);
  const solidArea = areaOfMulti(allSolid);
  const footprintArea = Math.max(0, solidArea - obstructionArea);
  const zoneArea = input.zones && input.zones.length ? areaOfMulti(intersect(union(...input.zones), input.room)) : 0;
  const openArea = Math.max(0, roomArea - solidArea);
  const pct = (v: number) => (v / roomArea) * 100;
  return {
    roomArea,
    obstructionArea,
    footprintArea,
    openArea,
    zoneArea,
    pct: { obstruction: pct(obstructionArea), footprint: pct(footprintArea), open: pct(openArea), zone: pct(zoneArea) },
  };
}

export interface WallUtilization {
  wallIndex: number;
  wallName: string;
  length: number;
  /** Length covered by objects standing against the wall. */
  occupied: number;
  /** Length taken by door/window/garage openings that cannot be used. */
  openings: number;
  available: number;
}

/**
 * Linear wall utilization. `occupiers` are floor-object footprints; an object counts against a wall
 * when it intrudes into a band of `bandDepth` along it. `openings[i]` lists unusable intervals on wall i.
 */
export function wallUtilization(
  walls: WallGeom[],
  room: Polygon,
  occupiers: readonly Polygon[],
  openings: ReadonlyArray<ReadonlyArray<[number, number]>> = [],
  bandDepth = 610,
): WallUtilization[] {
  return walls.map((w) => {
    const occ = occupiedWallIntervals(w, occupiers, room, bandDepth);
    const ops = mergeIntervals((openings[w.index] ?? []).map(([a, b]) => [Math.max(0, a), Math.min(w.length, b)] as [number, number]));
    const opLen = ops.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
    const all = mergeIntervals([...occ, ...ops]);
    const usedTotal = all.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
    const occupied = Math.max(0, usedTotal - opLen);
    return {
      wallIndex: w.index,
      wallName: w.name,
      length: w.length,
      occupied,
      openings: opLen,
      available: Math.max(0, w.length - usedTotal),
    };
  });
}

export interface ElevationRect {
  /** Offsets along the wall (mm). */
  start: number;
  end: number;
  /** Elevation above floor (mm). */
  bottom: number;
  top: number;
}

export interface VerticalWallUtilization {
  surface: number;
  covered: number;
  openings: number;
  unused: number;
  pctCovered: number;
}

/**
 * Vertical (elevation) utilization of one wall: total surface, surface covered by mounted storage
 * (and tall floor objects against the wall), openings, and unused area; overlaps counted once.
 */
export function verticalWallUtilization(
  wallLength: number,
  wallHeight: number,
  storage: readonly ElevationRect[],
  openingRects: readonly ElevationRect[] = [],
): VerticalWallUtilization {
  const toPoly = (r: ElevationRect): Polygon => [
    { x: Math.max(0, r.start), y: Math.max(0, r.bottom) },
    { x: Math.min(wallLength, r.end), y: Math.max(0, r.bottom) },
    { x: Math.min(wallLength, r.end), y: Math.min(wallHeight, r.top) },
    { x: Math.max(0, r.start), y: Math.min(wallHeight, r.top) },
  ];
  const valid = (r: ElevationRect) => r.end > r.start && r.top > r.bottom;
  const surface = wallLength * wallHeight;
  const wallPoly: Polygon = [
    { x: 0, y: 0 },
    { x: wallLength, y: 0 },
    { x: wallLength, y: wallHeight },
    { x: 0, y: wallHeight },
  ];
  const ops = areaOfMulti(intersect(union(...openingRects.filter(valid).map(toPoly)), wallPoly));
  const coveredAll = areaOfMulti(intersect(union(...storage.filter(valid).map(toPoly), ...openingRects.filter(valid).map(toPoly)), wallPoly));
  const covered = Math.max(0, coveredAll - ops);
  return {
    surface,
    covered,
    openings: ops,
    unused: Math.max(0, surface - coveredAll),
    pctCovered: surface > 0 ? (covered / Math.max(1, surface - ops)) * 100 : 0,
  };
}
