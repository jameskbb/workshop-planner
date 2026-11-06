import { describe, expect, it } from 'vitest';
import {
  compassOf,
  cornerName,
  distancesToWalls,
  exteriorCorners,
  interiorAngles,
  nearestWall,
  pointOnWall,
  projectOntoWall,
  roomWalls,
  rotationFacingAwayFromWall,
  wallQuads,
} from './walls';
import { area, rectPolygon, type Polygon } from './polygon';
import { obbCorners, localToWorld } from './obb';
import { snapAngle, snapBox, snapObjectToWall, snapPoint, snapToGrid, obbAabb, ALL_SNAPS } from './snapping';
import { alignItems, distributeItems, gapBetween } from './align';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

const L_ROOM: Polygon = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 2000 },
  { x: 6000, y: 2000 },
  { x: 6000, y: 6000 },
  { x: 0, y: 6000 },
];
const RECT = rectPolygon(0, 0, 6000, 5000);

describe('compass', () => {
  it('maps plan vectors to compass (north = −y)', () => {
    expect(compassOf({ x: 0, y: -1 })).toBe('north');
    expect(compassOf({ x: 1, y: 0 })).toBe('east');
    expect(compassOf({ x: 0, y: 1 })).toBe('south');
    expect(compassOf({ x: -1, y: 0 })).toBe('west');
    expect(compassOf({ x: 1, y: -1 })).toBe('northeast');
    expect(compassOf({ x: -1, y: 1 })).toBe('southwest');
    expect(compassOf({ x: 1, y: -0.3 })).toBe('east');
  });
});

describe('roomWalls', () => {
  it('names the four walls of a rectangle', () => {
    const walls = roomWalls(RECT);
    expect(walls.map((w) => w.name)).toEqual(['North wall', 'East wall', 'South wall', 'West wall']);
    expect(walls[0]!.length).toBe(6000);
    expect(walls[0]!.inward).toEqual({ x: -0, y: 1 });
  });
  it('is independent of winding order', () => {
    const walls = roomWalls([...RECT].reverse());
    expect(walls.map((w) => w.compass).sort()).toEqual(['east', 'north', 'south', 'west']);
    const north = walls.find((w) => w.compass === 'north')!;
    expect(north.a.y).toBe(0);
    expect(north.inward.y).toBeCloseTo(1);
  });
  it('disambiguates the L-shaped room', () => {
    const names = roomWalls(L_ROOM).map((w) => w.name);
    expect(names).toEqual([
      'North wall (west)',
      'East wall (north)',
      'North wall (east)',
      'East wall (south)',
      'South wall',
      'West wall',
    ]);
  });
  it('numbers three or more same-facing walls', () => {
    const stepped: Polygon = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 2000, y: 500 },
      { x: 2000, y: 1000 },
      { x: 3000, y: 1000 },
      { x: 3000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const walls = roomWalls(stepped);
    expect(walls.filter((w) => w.compass === 'north').map((w) => w.name)).toEqual(['North wall 1', 'North wall 2', 'North wall 3']);
  });
  it('applies custom names', () => {
    const walls = roomWalls(RECT, { names: ['Garage door wall', undefined, '  ', null] });
    expect(walls[0]!.name).toBe('Garage door wall');
    expect(walls[2]!.name).toBe('South wall');
  });
  it('returns nothing for degenerate rooms', () => {
    expect(roomWalls([])).toEqual([]);
    expect(roomWalls([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual([]);
  });
  it('angled walls get diagonal compass names', () => {
    const tri: Polygon = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 0, y: 4000 },
    ];
    const names = roomWalls(tri).map((w) => w.name);
    expect(names).toContain('Southeast wall');
  });
});

describe('wall projection & distances', () => {
  const walls = roomWalls(RECT);
  const east = walls[1]!;
  it('projects onto a wall', () => {
    const p = projectOntoWall({ x: 5000, y: 1000 }, east);
    expect(p.offset).toBe(1000);
    expect(p.inset).toBe(1000);
    expect(p.within).toBe(true);
    expect(p.foot).toEqual({ x: 6000, y: 1000 });
    expect(projectOntoWall({ x: 6500, y: 1000 }, east).inset).toBe(-500);
    expect(projectOntoWall({ x: 5000, y: -10 }, east).within).toBe(false);
  });
  it('pointOnWall', () => {
    expect(pointOnWall(east, 1000, 300)).toEqual({ x: 5700, y: 1000 });
  });
  it('object-to-wall distance for a rotated cabinet', () => {
    const cab = obbCorners({ x: 5000, y: 2500, rotation: 30, width: 1219.2, depth: 609.6 });
    const d = distancesToWalls(cab, walls);
    expect(d[0]!.wallName).toBe('East wall');
    // Extent in x of the rotated rect: w cos30 + d sin30 = 1055.9 + 304.8 → half = 680.35
    close(d[0]!.distance, 1000 - (1219.2 * Math.cos(Math.PI / 6) + 609.6 * 0.5) / 2, 1e-6);
    expect(nearestWall(cab, walls)!.wallIndex).toBe(1);
    expect(nearestWall(cab, [])).toBeNull();
  });
  it('touching wall gives zero distance', () => {
    const d = distancesToWalls(rectPolygon(5000, 1000, 1000, 500), walls);
    expect(d[0]!.distance).toBe(0);
  });
  it('object facing away from each wall', () => {
    expect(rotationFacingAwayFromWall(walls[0]!)).toBe(0); // against north wall → front faces south
    expect(rotationFacingAwayFromWall(walls[1]!)).toBe(90); // east wall → front faces west
    expect(rotationFacingAwayFromWall(walls[2]!)).toBe(180);
    expect(rotationFacingAwayFromWall(walls[3]!)).toBe(270);
    // Front (+y local) of an object against the east wall points west.
    const f = localToWorld({ x: 0, y: 0, rotation: 90 }, { x: 0, y: 1 });
    close(f.x, -1);
  });
});

describe('wall thickness', () => {
  it('exterior corners and quads for a rectangle', () => {
    const ext = exteriorCorners(RECT, 150);
    expect(ext[0]!.x).toBeCloseTo(-150);
    expect(ext[0]!.y).toBeCloseTo(-150);
    const quads = wallQuads(RECT, [100, 200, 300, 400]);
    expect(quads).toHaveLength(4);
    close(area(quads[0]!), 100 * 6000 + (100 * 400) / 2 + (100 * 200) / 2, 1e-6); // trapezoid
  });
  it('L room: reflex corner exterior is inside the notch', () => {
    const ext = exteriorCorners(L_ROOM, 150);
    expect(ext[2]!.x).toBeCloseTo(4150);
    expect(ext[2]!.y).toBeCloseTo(1850);
  });
  it('interior angles and corner names', () => {
    const angles = interiorAngles(L_ROOM);
    expect(angles).toEqual([90, 90, 270, 90, 90, 90]);
    expect(interiorAngles([...L_ROOM].reverse()).sort()).toEqual([270, 90, 90, 90, 90, 90].sort());
    const walls = roomWalls(RECT);
    expect(cornerName(walls, 0)).toBe('northwest corner');
    expect(cornerName(walls, 1)).toBe('northeast corner');
    expect(cornerName(walls, 2)).toBe('southeast corner');
    expect(cornerName(walls, 3)).toBe('southwest corner');
  });
});

describe('snapping', () => {
  const walls = roomWalls(RECT);
  const targets = {
    gridSize: 25.4,
    walls,
    corners: RECT,
    objects: [{ id: 'bench', bbox: { minX: 1000, minY: 0, maxX: 2828.8, maxY: 762 } }],
  };
  it('grid snap helper', () => {
    expect(snapToGrid(30, 25.4)).toBeCloseTo(25.4);
    expect(snapToGrid(30, 0)).toBe(30);
  });
  it('corner beats everything', () => {
    const r = snapPoint({ x: 6005, y: 4990 }, targets, 20);
    expect(r.source).toBe('corner');
    expect(r.point).toEqual({ x: 6000, y: 5000 });
  });
  it('wall center', () => {
    const r = snapPoint({ x: 3010, y: 5 }, targets, 20);
    expect(r.source).toBe('wall-center');
    expect(r.point).toEqual({ x: 3000, y: 0 });
  });
  it('wall line', () => {
    const r = snapPoint({ x: 2000, y: 4990 }, targets, 20);
    expect(r.source).toBe('wall');
    expect(r.point).toEqual({ x: 2000, y: 5000 });
  });
  it('object edge alignment with a vertical guide', () => {
    const r = snapPoint({ x: 1008, y: 3000 }, targets, 20);
    expect(r.point.x).toBe(1000);
    expect(r.guides[0]!.kind).toBe('vertical');
    expect(r.guides[0]!.targetId).toBe('bench');
  });
  it('falls back to grid', () => {
    const r = snapPoint({ x: 3310, y: 3310 }, { gridSize: 100 }, 20);
    expect(r.point).toEqual({ x: 3300, y: 3300 });
    expect(r.source).toBe('grid');
  });
  it('respects toggles (modifier disables snapping)', () => {
    const off = { grid: false, walls: false, corners: false, wallCenters: false, objectEdges: false, objectCenters: false };
    const r = snapPoint({ x: 6005, y: 4990 }, targets, 20, off);
    expect(r.snapped).toBe(false);
    expect(r.point).toEqual({ x: 6005, y: 4990 });
  });
  it('box snapping aligns edges with neighbors (flush)', () => {
    // Moving box just right of the bench: its left edge 2835 should snap to bench right edge 2828.8.
    const r = snapBox({ minX: 2835, minY: 1000, maxX: 3445, maxY: 1610 }, targets, 10);
    close(r.dx, -6.2);
    expect(r.snappedX).toBe(true);
    expect(r.guides.some((g) => g.kind === 'vertical' && g.targetId === 'bench')).toBe(true);
  });
  it('box snapping aligns centers only with centers', () => {
    const r = snapBox({ minX: 1600, minY: 2000, maxX: 2200, maxY: 2400 }, { objects: targets.objects }, 20);
    // box center x = 1900; bench center x = 1914.4 → dx = 14.4
    close(r.dx, 14.4);
  });
  it('box snapping to axis-aligned walls', () => {
    const r = snapBox({ minX: 5000, minY: 100, maxX: 5990, maxY: 700 }, { walls }, 20);
    close(r.dx, 10);
    expect(r.guides[0]!.source).toBe('wall');
  });
  it('box falls back to grid', () => {
    const r = snapBox({ minX: 105, minY: 207, maxX: 205, maxY: 307 }, { gridSize: 100 }, 10);
    close(r.dx, -5);
    close(r.dy, -7);
  });
  it('snaps an object back-to-wall, including angled walls', () => {
    const r = snapObjectToWall({ x: 5600, y: 2500, rotation: 88, width: 1219.2, depth: 609.6 }, walls, 150);
    expect(r).not.toBeNull();
    expect(r!.wallIndex).toBe(1);
    expect(r!.pose.rotation).toBe(90);
    close(r!.pose.x, 6000 - 304.8);
    const tri: Polygon = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 0, y: 4000 },
    ];
    const triWalls = roomWalls(tri);
    const hyp = triWalls[1]!;
    const facing = rotationFacingAwayFromWall(hyp);
    const r2 = snapObjectToWall({ x: 1500, y: 1500, rotation: facing + 3, width: 600, depth: 400 }, triWalls, 900);
    expect(r2!.wallIndex).toBe(1);
    const corners = obbCorners({ ...r2!.pose, width: 600, depth: 400 });
    // Back corners lie on the hypotenuse x + y = 4000.
    const onWall = corners.filter((c) => Math.abs(c.x + c.y - 4000) < 1e-6);
    expect(onWall).toHaveLength(2);
  });
  it('does not snap when too far', () => {
    expect(snapObjectToWall({ x: 3000, y: 2500, rotation: 90, width: 1000, depth: 600 }, walls, 100)).toBeNull();
  });
  it('angle snapping', () => {
    expect(snapAngle(44, 15)).toBe(45);
    expect(snapAngle(97, 90)).toBe(90);
    expect(snapAngle(-10, 45)).toBe(0);
    expect(snapAngle(-50, 45)).toBe(315);
    expect(snapAngle(10, 45, 5)).toBe(10);
    expect(snapAngle(10, 0)).toBe(10);
  });
  it('obb aabb', () => {
    const b = obbAabb({ x: 0, y: 0, rotation: 90, width: 100, depth: 50 });
    close(b.maxX - b.minX, 50);
  });
  it('ALL_SNAPS enables everything', () => {
    expect(Object.values(ALL_SNAPS).every(Boolean)).toBe(true);
  });
});

describe('align & distribute', () => {
  const items = [
    { id: 'a', bbox: { minX: 0, minY: 0, maxX: 100, maxY: 50 } },
    { id: 'b', bbox: { minX: 300, minY: 100, maxX: 350, maxY: 300 } },
    { id: 'c', bbox: { minX: 150, minY: 20, maxX: 200, maxY: 60 } },
  ];
  it('align left/right/top/bottom', () => {
    expect(alignItems(items, 'left').map((t) => t.dx)).toEqual([0, -300, -150]);
    expect(alignItems(items, 'right').map((t) => t.dx)).toEqual([250, 0, 150]);
    expect(alignItems(items, 'top').map((t) => t.dy)).toEqual([0, -100, -20]);
    expect(alignItems(items, 'bottom').map((t) => t.dy)).toEqual([250, 0, 240]);
  });
  it('align centers', () => {
    expect(alignItems(items, 'center-horizontal').map((t) => t.dx)).toEqual([125, -150, 0]);
    expect(alignItems(items, 'center-vertical').map((t) => t.dy)).toEqual([125, -50, 110]);
  });
  it('fixed (locked) items anchor alignment and do not move', () => {
    const r = alignItems([{ ...items[0]!, fixed: true }, items[1]!], 'left');
    expect(r).toEqual([
      { id: 'a', dx: 0, dy: 0 },
      { id: 'b', dx: -300, dy: 0 },
    ]);
  });
  it('single item is a no-op', () => {
    expect(alignItems([items[0]!], 'left')).toEqual([{ id: 'a', dx: 0, dy: 0 }]);
  });
  it('distribute horizontally gives equal gaps', () => {
    const r = distributeItems(items, 'horizontal');
    // span 0..350, sizes 100+50+50=200, gap 75 → c should start at 175
    expect(r.find((t) => t.id === 'c')!.dx).toBe(25);
    expect(r.find((t) => t.id === 'a')!.dx).toBe(0);
    expect(r.find((t) => t.id === 'b')!.dx).toBe(0);
  });
  it('distribute vertically', () => {
    const r = distributeItems(items, 'vertical');
    // sorted by center y: a(25), c(40), b(200). span 0..300 sizes 50+40+200=290 → gap 5 → c at 55
    expect(r.find((t) => t.id === 'c')!.dy).toBe(35);
  });
  it('distribute needs three', () => {
    expect(distributeItems(items.slice(0, 2), 'horizontal').every((t) => t.dx === 0)).toBe(true);
  });
  it('gapBetween', () => {
    expect(gapBetween(items[0]!.bbox, items[2]!.bbox, 'horizontal')).toBe(50);
    expect(gapBetween(items[0]!.bbox, items[2]!.bbox, 'vertical')).toBe(-30);
  });
});
