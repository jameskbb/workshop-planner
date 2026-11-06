import { describe, expect, it } from 'vitest';
import {
  footprintWorldPolygon,
  sideVector,
  zoneLocalPolygon,
  zoneObstruction,
  zoneWallIntrusions,
  zoneWorldAxis,
  zoneWorldPolygon,
  type ZoneShape,
} from './clearance';
import { area, bbox, rectPolygon, type Polygon } from './polygon';
import { roomWalls } from './walls';
import { obbCorners } from './obb';

const IN = 25.4;
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

// Table saw from the brief: 44" x 27" footprint; operator 36" front; infeed 96"; outfeed 96"; side 24".
const SAW = { width: 44 * IN, depth: 27 * IN };
const outfeed: ZoneShape = { type: 'side', side: 'back', depth: 96 * IN };
const infeed: ZoneShape = { type: 'side', side: 'front', depth: 96 * IN };
const leftSide: ZoneShape = { type: 'side', side: 'left', depth: 24 * IN };
const around: ZoneShape = { type: 'around', margin: 24 * IN };

describe('zone local polygons', () => {
  it('side bands sit flush against the footprint', () => {
    const back = bbox(zoneLocalPolygon(outfeed, SAW));
    close(back.maxY, -SAW.depth / 2);
    close(back.minY, -SAW.depth / 2 - 96 * IN);
    close(back.maxX - back.minX, SAW.width);
    const front = bbox(zoneLocalPolygon(infeed, SAW));
    close(front.minY, SAW.depth / 2);
    const left = bbox(zoneLocalPolygon(leftSide, SAW));
    close(left.maxX, -SAW.width / 2);
    close(left.minX, -SAW.width / 2 - 24 * IN);
    const right = bbox(zoneLocalPolygon({ type: 'side', side: 'right', depth: 100 }, SAW));
    close(right.minX, SAW.width / 2);
  });
  it('extend and offset', () => {
    const z = bbox(zoneLocalPolygon({ type: 'side', side: 'front', depth: 100, extend: 50, offset: 10 }, { width: 200, depth: 100 }));
    expect(z).toEqual({ minX: -150, maxX: 150, minY: 60, maxY: 160 });
    const l = bbox(zoneLocalPolygon({ type: 'side', side: 'left', depth: 100, extend: 20 }, { width: 200, depth: 100 }));
    expect(l).toEqual({ minX: -200, maxX: -100, minY: -70, maxY: 70 });
  });
  it('around, rect and polygon', () => {
    expect(area(zoneLocalPolygon(around, { width: 100, depth: 100 }))).toBeCloseTo((100 + 2 * 24 * IN) ** 2);
    expect(bbox(zoneLocalPolygon({ type: 'rect', x: 10, y: 20, width: 40, depth: 60 }, { width: 1, depth: 1 }))).toEqual({
      minX: -10,
      maxX: 30,
      minY: -10,
      maxY: 50,
    });
    expect(zoneLocalPolygon({ type: 'polygon', points: [{ x: 1, y: 1 }] }, { width: 1, depth: 1, offsetX: 5, offsetY: 5 })).toEqual([
      { x: 6, y: 6 },
    ]);
  });
  it('state offsets shift the footprint and its zones', () => {
    const z = bbox(zoneLocalPolygon({ type: 'side', side: 'front', depth: 100 }, { width: 200, depth: 100, offsetX: 30, offsetY: 5 }));
    expect(z).toEqual({ minX: -70, maxX: 130, minY: 55, maxY: 155 });
    const fp = bbox(footprintWorldPolygon({ width: 200, depth: 100, offsetX: 30 }, { x: 0, y: 0, rotation: 0 }));
    expect(fp.minX).toBe(-70);
  });
  it('side vectors', () => {
    expect(sideVector('front')).toEqual({ x: 0, y: 1 });
    expect(sideVector('left')).toEqual({ x: -1, y: 0 });
  });
});

describe('zones rotate with the object', () => {
  it('outfeed of a saw facing west points east', () => {
    // rotation 90: front (+y) → west, back → east.
    const pose = { x: 3000, y: 2000, rotation: 90 };
    const axis = zoneWorldAxis(outfeed, pose)!;
    close(axis.x, 1);
    close(axis.y, 0);
    const b = bbox(zoneWorldPolygon(outfeed, SAW, pose));
    close(b.minX, 3000 + SAW.depth / 2);
    close(b.maxX, 3000 + SAW.depth / 2 + 96 * IN);
    expect(zoneWorldAxis(around, pose)).toBeNull();
  });
  it('rotation at arbitrary angles preserves zone area', () => {
    for (const rotation of [0, 15, 33, 45, 90, 137, 270]) {
      const poly = zoneWorldPolygon(outfeed, SAW, { x: 0, y: 0, rotation });
      close(area(poly), SAW.width * 96 * IN, 1e-3);
    }
  });
});

describe('overlap quantification against walls', () => {
  // 20' x 16' garage.
  const room = rectPolygon(0, 0, 240 * IN, 192 * IN);
  const walls = roomWalls(room);
  it('"Table saw outfeed clearance intersects the East wall by 18 inches"', () => {
    // Saw faces west (rotation 90), back toward east. Back edge at x = E − 78".
    const backEdgeX = 240 * IN - 78 * IN;
    const pose = { x: backEdgeX - SAW.depth / 2, y: 96 * IN, rotation: 90 };
    const zone = zoneWorldPolygon(outfeed, SAW, pose);
    const hits = zoneWallIntrusions(zone, room, walls);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.wallName).toBe('East wall');
    close(hits[0]!.depth, 18 * IN, 1e-6);
    close(hits[0]!.area, 18 * IN * SAW.width, 1e-3);
    expect(hits[0]!.region.length).toBe(1);
  });
  it('zone fully inside the room has no intrusions', () => {
    const zone = zoneWorldPolygon(outfeed, SAW, { x: 120 * IN, y: 96 * IN, rotation: 90 });
    expect(zoneWallIntrusions(zone, room, walls)).toEqual([]);
  });
  it('zone poking through a corner reports both walls, deepest first', () => {
    const zone = rectPolygon(-100, -300, 1000, 1000);
    const hits = zoneWallIntrusions(zone, room, walls);
    expect(hits.map((h) => h.wallName)).toEqual(['North wall', 'West wall']);
    close(hits[0]!.depth, 300);
    close(hits[1]!.depth, 100);
  });
  it('L-shaped room: zone reaching into the notch is attributed to the notch walls', () => {
    const L: Polygon = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 6000, y: 2000 },
      { x: 6000, y: 6000 },
      { x: 0, y: 6000 },
    ];
    const lw = roomWalls(L);
    // zone at x 4500..5500, y 1500..2500 pokes 500 up into the notch past "North wall (east)".
    const hits = zoneWallIntrusions(rectPolygon(4500, 1500, 1000, 1000), L, lw);
    expect(hits[0]!.wallName).toBe('North wall (east)');
    close(hits[0]!.depth, 500);
    expect(zoneWallIntrusions(rectPolygon(4500, 1500, 1000, 1000), [], lw)).toEqual([]);
  });
});

describe('overlap quantification against objects', () => {
  const pose = { x: 2000, y: 3000, rotation: 0 };
  it('workbench blocking part of the outfeed zone (side zone depth along the axis)', () => {
    // Outfeed extends north (−y) from y = 3000 − 342.9 by 96". Bench starts 60" behind the saw.
    const sawBack = 3000 - SAW.depth / 2;
    const bench = rectPolygon(1500, sawBack - 60 * IN - 30 * IN, 72 * IN, 30 * IN);
    const r = zoneObstruction(outfeed, SAW, pose, bench)!;
    expect(r).not.toBeNull();
    close(r.clear, 60 * IN, 1e-6);
    close(r.depth, 36 * IN, 1e-6);
    expect(r.area).toBeGreaterThan(0);
  });
  it('rotated object and rotated obstacle', () => {
    const p = { x: 0, y: 0, rotation: 45 };
    const obstacle = obbCorners({ x: 0, y: 0, rotation: 45, width: 400, depth: 200 });
    // Place the obstacle 500 mm behind the object along its back axis.
    const axis = zoneWorldAxis(outfeed, p)!;
    const shifted = obstacle.map((q) => ({ x: q.x + axis.x * (SAW.depth / 2 + 500 + 100), y: q.y + axis.y * (SAW.depth / 2 + 500 + 100) }));
    const r = zoneObstruction(outfeed, SAW, p, shifted)!;
    close(r.clear, 500, 1e-6);
    close(r.depth, 96 * IN - 500, 1e-6);
  });
  it('around zones report the margin shortfall', () => {
    const lathe = { width: 1000, depth: 400 };
    const cab = rectPolygon(500 + 250, -300, 500, 600); // 250 mm gap to the right of the lathe
    const r = zoneObstruction({ type: 'around', margin: 600 }, lathe, { x: 0, y: 0, rotation: 0 }, cab)!;
    close(r.clear, 250);
    close(r.depth, 350);
  });
  it('rect zones report overlap width', () => {
    const r = zoneObstruction({ type: 'rect', x: 0, y: 500, width: 400, depth: 200 }, { width: 400, depth: 400 }, { x: 0, y: 0, rotation: 0 }, rectPolygon(-50, 550, 100, 500))!;
    close(r.depth, 50);
  });
  it('no overlap → null; touching → null', () => {
    expect(zoneObstruction(outfeed, SAW, pose, rectPolygon(5000, 0, 100, 100))).toBeNull();
    const back = 3000 - SAW.depth / 2 - 96 * IN;
    expect(zoneObstruction(outfeed, SAW, pose, rectPolygon(1500, back - 100, 1000, 100))).toBeNull();
  });
});
