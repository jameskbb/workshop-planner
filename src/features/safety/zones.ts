/**
 * Pure geometry for the safety checks (no React / stores): door leaves and swing sectors of
 * wall-hosted doors, the landing zone inside a doorway, the garage door's opening strip and its
 * overhead track / open-panel band, the clear working space in front of an electrical panel and
 * the landing zone of an attic ladder. Shared by the analyzers and the canvas overlays so what is
 * drawn is exactly what is checked.
 */
import { resolvePlacement, roomGeometry } from '@/domain/resolve';
import type { ArchitecturalFeature, ElectricalPoint, Room } from '@/domain/schema';
import { inches } from '@/domain/units';
import { add, angleOf, localPolygonToWorld, localRect, pointOnWall, polygonsOverlapOrTouch, rotate, scale, signedArea, type Point, type Polygon, type WallGeom } from '@/geometry';

/** Recommended clear landing depth inside a person door (mm). */
export const DOOR_LANDING_DEPTH = inches(36);
/** Depth of the strip just inside a garage door the door itself needs to close (mm). */
export const GARAGE_DOOR_STRIP = inches(18);
/** Clear space in front of an electrical panel: 36" deep, at least 30" wide, 6' 6" high. */
export const PANEL_CLEAR_DEPTH = inches(36);
export const PANEL_CLEAR_WIDTH = inches(30);
export const PANEL_CLEAR_HEIGHT = inches(78);
/** Vertical thickness of an open sectional door lying under its tracks, plus a margin (mm). */
export const OPEN_DOOR_BAND = inches(3);

export interface DoorLeaf {
  hinge: Point;
  /** Unit direction of the closed leaf (along the wall, hinge → latch). */
  closedDir: Point;
  length: number;
  /** Degrees from `closedDir` to the fully open leaf (signed, short way into the room). */
  sweep: number;
}

function wallOf(room: Room, f: { placement: ArchitecturalFeature['placement'] }): WallGeom | undefined {
  if (f.placement.type !== 'wall') return undefined;
  const g = roomGeometry(room);
  const i = g.wallIndex.get(f.placement.wallId);
  return i === undefined ? undefined : g.walls[i];
}

/**
 * Leaves of an inward-swinging door (one for a single door, two for a double door). Mirrors the
 * plan drawing (features/plan ArchitectureLayer) exactly.
 */
export function doorLeaves(room: Room, f: ArchitecturalFeature): DoorLeaf[] {
  if ((f.kind !== 'door' && f.kind !== 'double-door') || !f.door || f.door.swing !== 'in' || f.placement.type !== 'wall') return [];
  const wall = wallOf(room, f);
  if (!wall) return [];
  const g = roomGeometry(room);
  const s0 = f.placement.offset - f.width / 2;
  const s1 = f.placement.offset + f.width / 2;
  const a = pointOnWall(wall, s0, 0);
  const b = pointOnWall(wall, s1, 0);
  const raw: Array<{ hinge: Point; closedDir: Point; length: number }> = [];
  if (f.kind === 'double-door') {
    raw.push({ hinge: a, closedDir: wall.dir, length: f.width / 2 }, { hinge: b, closedDir: scale(wall.dir, -1), length: f.width / 2 });
  } else {
    const leftIsStart = (f.door.hinge === 'left') === signedArea(g.polygon) > 0;
    raw.push(leftIsStart ? { hinge: a, closedDir: wall.dir, length: f.width } : { hinge: b, closedDir: scale(wall.dir, -1), length: f.width });
  }
  const open = angleOf(wall.inward);
  return raw.map((l) => {
    let delta = open - angleOf(l.closedDir);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return { ...l, sweep: Math.sign(delta) * Math.min(Math.abs(delta), f.door!.openAngle) };
  });
}

/** Leaf direction after opening by `deg` degrees (0 = closed). */
export function leafDir(leaf: DoorLeaf, deg: number): Point {
  return rotate(leaf.closedDir, Math.sign(leaf.sweep) * Math.min(Math.abs(deg), Math.abs(leaf.sweep)));
}

/** The swept sector of a leaf from closed to `deg` (default fully open). */
export function leafSector(leaf: DoorLeaf, deg = Math.abs(leaf.sweep), segments = 16): Polygon {
  const pts: Point[] = [leaf.hinge];
  for (let i = 0; i <= segments; i++) pts.push(add(leaf.hinge, scale(leafDir(leaf, (deg * i) / segments), leaf.length)));
  return pts;
}

/** A thin polygon for the leaf itself at an opening angle. */
export function leafPolygon(leaf: DoorLeaf, deg: number, thickness = 40): Polygon {
  const d = leafDir(leaf, deg);
  const n = rotate(d, leaf.sweep >= 0 ? 90 : -90);
  const tip = add(leaf.hinge, scale(d, leaf.length));
  // Offset the leaf thickness toward the side it swings to.
  const off = scale(n, -thickness);
  return [leaf.hinge, tip, add(tip, off), add(leaf.hinge, off)];
}

/** Largest opening angle (whole degrees) before the leaf touches any obstacle. */
export function leafMaxAngle(leaf: DoorLeaf, obstacles: readonly Polygon[]): { angle: number; blockedBy: number } {
  const full = Math.abs(leaf.sweep);
  for (let a = 1; a <= full; a++) {
    const poly = leafPolygon(leaf, a, 20);
    const hit = obstacles.findIndex((o) => polygonsOverlapOrTouch(poly, o));
    if (hit >= 0) return { angle: a - 1, blockedBy: hit };
  }
  return { angle: full, blockedBy: -1 };
}

/** Clear landing rectangle inside a doorway (door width × depth, from the wall's interior face). */
export function doorLanding(room: Room, f: ArchitecturalFeature, depth = DOOR_LANDING_DEPTH): Polygon {
  const wall = wallOf(room, f);
  if (!wall || f.placement.type !== 'wall') return [];
  const s0 = f.placement.offset - f.width / 2;
  const s1 = f.placement.offset + f.width / 2;
  return [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, depth), pointOnWall(wall, s0, depth)];
}

export interface GarageDoorZones {
  wall: WallGeom;
  /** Opening line from jamb to jamb (interior face). */
  a: Point;
  b: Point;
  /** Floor strip just inside the opening that the door needs to close / cars need to pass. */
  strip: Polygon;
  /** Plan area under the horizontal tracks where the open door panel rests. */
  band: Polygon;
  /** The two rails (thin strips along both sides of the band). */
  rails: Polygon[];
  /** Height (mm) of the tracks / open panel. */
  trackHeight: number;
  open: boolean;
}

export function garageDoorZones(room: Room, f: ArchitecturalFeature): GarageDoorZones | null {
  if (f.kind !== 'garage-door' || !f.garageDoor || f.placement.type !== 'wall') return null;
  const wall = wallOf(room, f);
  if (!wall) return null;
  const s0 = f.placement.offset - f.width / 2;
  const s1 = f.placement.offset + f.width / 2;
  const L = f.garageDoor.trackLength;
  const rail = (s: number): Polygon => [pointOnWall(wall, s - 40, 0), pointOnWall(wall, s + 40, 0), pointOnWall(wall, s + 40, L), pointOnWall(wall, s - 40, L)];
  return {
    wall,
    a: pointOnWall(wall, s0, 0),
    b: pointOnWall(wall, s1, 0),
    strip: [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, GARAGE_DOOR_STRIP), pointOnWall(wall, s0, GARAGE_DOOR_STRIP)],
    band: [pointOnWall(wall, s0 - 80, 0), pointOnWall(wall, s1 + 80, 0), pointOnWall(wall, s1 + 80, L), pointOnWall(wall, s0 - 80, L)],
    rails: [rail(s0 - 40), rail(s1 + 40)],
    trackHeight: f.garageDoor.trackHeight,
    open: f.garageDoor.state === 'open',
  };
}

export interface PanelClearance {
  /** The clear working space in front of the panel (floor plan). */
  zone: Polygon;
  wall?: WallGeom;
  /** Panel center on the wall face. */
  center: Point;
  /** Into-the-room unit normal. */
  inward: Point;
  depth: number;
  width: number;
}

/** 30"-wide (or panel-width) × 36"-deep clear space in front of an electrical panel. */
export function panelClearance(room: Room, e: ElectricalPoint): PanelClearance | null {
  if (e.kind !== 'panel') return null;
  const width = Math.max(PANEL_CLEAR_WIDTH, e.width);
  if (e.placement.type === 'wall') {
    const wall = wallOf(room, e);
    if (!wall) return null;
    const o = e.placement.offset;
    return {
      zone: [pointOnWall(wall, o - width / 2, 0), pointOnWall(wall, o + width / 2, 0), pointOnWall(wall, o + width / 2, PANEL_CLEAR_DEPTH), pointOnWall(wall, o - width / 2, PANEL_CLEAR_DEPTH)],
      wall,
      center: pointOnWall(wall, o, 0),
      inward: wall.inward,
      depth: PANEL_CLEAR_DEPTH,
      width,
    };
  }
  const { pose } = resolvePlacement(room, e.placement, e.width, 100);
  const inward = rotate({ x: 0, y: 1 }, pose.rotation);
  return {
    zone: localPolygonToWorld(pose, localRect(width, PANEL_CLEAR_DEPTH, 0, 50 + PANEL_CLEAR_DEPTH / 2)),
    center: { x: pose.x, y: pose.y },
    inward,
    depth: PANEL_CLEAR_DEPTH,
    width,
  };
}

/**
 * Floor area an attic ladder lands on when unfolded: the hatch footprint extended on its front
 * (local +y) side by the ladder's horizontal run (≈ 0.6 × the ceiling height at a typical 60° pitch).
 */
export function atticLadderLanding(room: Room, f: ArchitecturalFeature): Polygon {
  if (f.kind !== 'attic-ladder') return [];
  const { pose } = resolvePlacement(room, f.placement, f.width, f.depth);
  const run = Math.max(f.depth, f.elevation * 0.6);
  // Hatch spans local y ∈ [−depth/2, depth/2]; the ladder lands beyond its front edge.
  const back = -f.depth / 2;
  const front = back + run;
  return localPolygonToWorld(pose, localRect(f.width + inches(12), front - back + inches(24), 0, (back + front + inches(24)) / 2));
}
