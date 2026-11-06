import { describe, expect, it } from 'vitest';
import { findFitLocations, freeWallSegments, largestFreeRectAt, occupiedWallIntervals, wallBand } from './wallspace';
import { roomWalls } from './walls';
import { area, polygonContainsPolygon, rectPolygon, type Polygon } from './polygon';
import { obbCorners } from './obb';
import { spaceUtilization, verticalWallUtilization, wallUtilization } from './utilization';
import {
  buildOccupancyGrid,
  cellAt,
  cellCenter,
  CELL_BLOCKED,
  CELL_FREE,
  CELL_OUTSIDE,
  clearanceField,
  components,
  distanceTransform,
  floodFill,
  nearestPassableCell,
  shortestPath,
  thin,
  widestPathBottleneck,
} from './grid';
import {
  analyzeWalkability,
  clearanceAt,
  narrowestAlongRoute,
  walkingDistance,
  WALK_BLOCKED,
  WALK_NARROW,
  WALK_OPEN,
  WALK_OUTSIDE,
  WALK_UNREACHABLE,
} from './walkability';
import { workflowTravel } from './workflow';

const IN = 25.4;
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

// 20' x 20' room
const ROOM = rectPolygon(0, 0, 240 * IN, 240 * IN);
const WALLS = roomWalls(ROOM);
const L_ROOM: Polygon = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 2000 },
  { x: 6000, y: 2000 },
  { x: 6000, y: 6000 },
  { x: 0, y: 6000 },
];

describe('free wall segments', () => {
  it('an empty room has four fully free walls', () => {
    const segs = freeWallSegments(WALLS, [], ROOM);
    expect(segs).toHaveLength(4);
    for (const s of segs) close(s.length, 240 * IN, 1e-6);
    expect(segs[0]!.atStartCorner).toBe(true);
    expect(segs[0]!.atEndCorner).toBe(true);
  });
  it('a cabinet against the north wall splits it', () => {
    const cab = rectPolygon(60 * IN, 0, 48 * IN, 24 * IN);
    const segs = freeWallSegments(WALLS, [cab], ROOM).filter((s) => s.wallName === 'North wall');
    expect(segs).toHaveLength(2);
    close(segs[0]!.length, 60 * IN, 1e-6);
    close(segs[1]!.length, 132 * IN, 1e-6);
    expect(segs[1]!.atEndCorner).toBe(true);
  });
  it('objects far from a wall do not occupy it', () => {
    const island = rectPolygon(100 * IN, 100 * IN, 48 * IN, 24 * IN);
    expect(freeWallSegments(WALLS, [island], ROOM).every((s) => Math.abs(s.length - 240 * IN) < 1e-6)).toBe(true);
  });
  it('a rotated object near a wall occupies its projection within the band', () => {
    const cab = obbCorners({ x: 2000, y: 400, rotation: 30, width: 1000, depth: 400 });
    const occ = occupiedWallIntervals(WALLS[0]!, [cab], ROOM, 610);
    expect(occ).toHaveLength(1);
    expect(occ[0]![0]).toBeGreaterThan(1400);
    expect(occ[0]![1]).toBeLessThan(2600);
  });
  it('objects on an adjacent wall occupy the corner', () => {
    const onWest = rectPolygon(0, 0, 24 * IN, 48 * IN); // sits in the NW corner
    const north = freeWallSegments(WALLS, [onWest], ROOM).filter((s) => s.wallName === 'North wall');
    close(north[0]!.start, 24 * IN, 1e-6);
  });
  it('L room: the band near the reflex corner is limited to the room', () => {
    const walls = roomWalls(L_ROOM);
    const segs = freeWallSegments(walls, [], L_ROOM, { bandDepth: 600 });
    const northEast = segs.filter((s) => s.wallName === 'North wall (east)');
    expect(northEast).toHaveLength(1);
    close(northEast[0]!.length, 2000, 1e-6);
    // The 'East wall (north)' band points into the room interior (west), fully available.
    const eastNorth = segs.filter((s) => s.wallName === 'East wall (north)');
    close(eastNorth[0]!.length, 2000, 1e-6);
    expect(wallBand(walls[0]!, 100)).toHaveLength(4);
  });
});

describe('fit search ("Will it fit?")', () => {
  it('finds wall runs with available length and remaining slack', () => {
    const obstacles = [
      rectPolygon(0, 0, 240 * IN, 24 * IN), // north wall fully used
      rectPolygon(240 * IN - 24 * IN, 24 * IN, 24 * IN, 36 * IN), // east wall: 24"…60" used
      rectPolygon(240 * IN - 24 * IN, 122 * IN, 24 * IN, 118 * IN), // …122"…240" used → 62" free run
    ];
    const res = findFitLocations(ROOM, WALLS, obstacles, { width: 48 * IN, depth: 24 * IN });
    expect(res.length).toBeGreaterThan(0);
    // Tightest first
    for (let i = 1; i < res.filter((r) => r.kind !== 'floor').length; i++) expect(res[i]!.remaining).toBeGreaterThanOrEqual(res[i - 1]!.remaining);
    const east = res.find((r) => r.wallName === 'East wall');
    expect(east).toBeDefined();
    close(east!.available, 62 * IN, 1e-6); // "East wall: 62" available"
    close(east!.remaining, 14 * IN, 1e-6);
    expect(res.some((r) => r.wallName === 'North wall')).toBe(false);
  });
  it('every candidate footprint is inside the room and clear of obstacles', () => {
    const obstacles = [rectPolygon(1000, 1000, 1500, 1500), obbCorners({ x: 4500, y: 4000, rotation: 30, width: 1200, depth: 600 })];
    const res = findFitLocations(L_ROOM, roomWalls(L_ROOM), obstacles, { width: 1219.2, depth: 609.6 }, { includeFloor: true });
    expect(res.length).toBeGreaterThan(3);
    for (const r of res) expect(polygonContainsPolygon(L_ROOM, r.footprint, 0.5)).toBe(true);
    expect(res.some((r) => r.kind === 'corner')).toBe(true);
    expect(res.some((r) => r.kind === 'floor')).toBe(true);
  });
  it('corner candidates get compass corner names', () => {
    const res = findFitLocations(ROOM, WALLS, [], { width: 48 * IN, depth: 24 * IN });
    const corners = res.filter((r) => r.kind === 'corner').map((r) => r.location);
    expect(corners.some((c) => c.startsWith('Northwest corner'))).toBe(true);
    expect(corners.some((c) => c.startsWith('Southeast corner'))).toBe(true);
  });
  it('front clearance is respected', () => {
    const tiny = rectPolygon(0, 0, 2000, 800);
    const walls = roomWalls(tiny);
    expect(findFitLocations(tiny, walls, [], { width: 1000, depth: 600 }).length).toBeGreaterThan(0);
    const withFront = findFitLocations(tiny, walls, [], { width: 1000, depth: 600, frontClearance: 400 });
    // Only fits against the short walls (east/west) where depth 600+400 fits within 2000 length.
    expect(withFront.every((r) => r.wallName === 'East wall' || r.wallName === 'West wall')).toBe(true);
  });
  it('nothing fits when the item is bigger than the room', () => {
    expect(findFitLocations(rectPolygon(0, 0, 500, 500), roomWalls(rectPolygon(0, 0, 500, 500)), [], { width: 600, depth: 600 }, { includeFloor: true })).toEqual([]);
  });
  it('maxResults limits output', () => {
    expect(findFitLocations(ROOM, WALLS, [], { width: 500, depth: 500 }, { maxResults: 2 })).toHaveLength(2);
  });
});

describe('largest free rectangle ("What could fit here?")', () => {
  it('grows until blocked', () => {
    const r = largestFreeRectAt(rectPolygon(0, 0, 3000, 2000), [rectPolygon(2000, 0, 1000, 2000)], { x: 500, y: 500 })!;
    close(r.width, 2000, 20);
    close(r.depth, 2000, 20);
  });
  it('null when seed is blocked or outside', () => {
    expect(largestFreeRectAt(ROOM, [rectPolygon(0, 0, 1000, 1000)], { x: 500, y: 500 })).toBeNull();
    expect(largestFreeRectAt(ROOM, [], { x: -5, y: 5 })).toBeNull();
  });
});

describe('occupancy grid & distance transform', () => {
  const g = buildOccupancyGrid(rectPolygon(0, 0, 1000, 500), [rectPolygon(400, 0, 200, 200)], 50);
  it('rasterizes room, obstacles and a margin', () => {
    expect(g.cols).toBe(22);
    expect(g.rows).toBe(12);
    expect(g.cells[cellAt(g, { x: -25, y: 100 })]).toBe(CELL_OUTSIDE);
    expect(g.cells[cellAt(g, { x: 100, y: 100 })]).toBe(CELL_FREE);
    expect(g.cells[cellAt(g, { x: 450, y: 50 })]).toBe(CELL_BLOCKED);
    expect(g.owner[cellAt(g, { x: 450, y: 50 })]).toBe(0);
    expect(cellAt(g, { x: 5000, y: 0 })).toBe(-1);
    expect(cellCenter(g, cellAt(g, { x: 110, y: 120 }))).toEqual({ x: 125, y: 125 });
  });
  it('exact EDT matches brute force', () => {
    const isSite = (i: number) => g.cells[i] !== CELL_FREE;
    const { dist2, nearest } = distanceTransform(g, isSite);
    for (let i = 0; i < g.cells.length; i += 7) {
      let best = Infinity;
      const ci = i % g.cols;
      const ri = Math.floor(i / g.cols);
      for (let j = 0; j < g.cells.length; j++) {
        if (!isSite(j)) continue;
        const d = (ci - (j % g.cols)) ** 2 + (ri - Math.floor(j / g.cols)) ** 2;
        if (d < best) best = d;
      }
      expect(dist2[i]).toBe(best);
      const n = nearest[i]!;
      expect((ci - (n % g.cols)) ** 2 + (ri - Math.floor(n / g.cols)) ** 2).toBe(best);
    }
  });
  it('EDT with no sites is infinite', () => {
    const { dist2 } = distanceTransform(g, () => false);
    expect(dist2[0]).toBeGreaterThan(1e10);
  });
  it('clearance field approximates distance to the nearest boundary', () => {
    const { clearance } = clearanceField(g);
    // Cell center (125, 275): nearest boundary = west wall at x=0 → 125 mm.
    close(clearance[cellAt(g, { x: 125, y: 275 })]!, 125, 1e-6);
    expect(clearance[cellAt(g, { x: 450, y: 50 })]).toBe(-1);
  });
  it('flood fill, components, nearest passable', () => {
    const free = (i: number) => g.cells[i] === CELL_FREE;
    const f = floodFill(g, [cellAt(g, { x: 100, y: 100 })], free);
    expect(f[cellAt(g, { x: 900, y: 100 })]).toBe(1);
    const { sizes } = components(g, free);
    expect(sizes.length).toBe(2);
    expect(nearestPassableCell(g, { x: 450, y: 50 }, free)).toBeGreaterThanOrEqual(0);
    expect(g.cells[nearestPassableCell(g, { x: 450, y: 50 }, free)]).toBe(CELL_FREE);
  });
  it('A* shortest path goes around the obstacle', () => {
    const free = (i: number) => g.cells[i] === CELL_FREE;
    const p = shortestPath(g, cellAt(g, { x: 100, y: 100 }), cellAt(g, { x: 900, y: 100 }), free)!;
    expect(p).not.toBeNull();
    expect(p.length).toBeGreaterThan(800);
    expect(p.points.every((q) => !(q.x > 400 && q.x < 600 && q.y < 200))).toBe(true);
    expect(shortestPath(g, -1, 0, free)).toBeNull();
  });
  it('widest path bottleneck', () => {
    const { clearance } = clearanceField(g);
    const value = (i: number) => Math.max(0, clearance[i]!);
    // Passage below the obstacle is 300 wide (y 200..500): its center row has clearance 125.
    expect(widestPathBottleneck(g, cellAt(g, { x: 100, y: 375 }), cellAt(g, { x: 875, y: 375 }), value)).toBe(125);
    // Endpoints hugging a wall limit the bottleneck.
    expect(widestPathBottleneck(g, cellAt(g, { x: 100, y: 275 }), cellAt(g, { x: 900, y: 275 }), value)).toBe(75);
    expect(widestPathBottleneck(g, -1, 3, value)).toBeNull();
  });
  it('thinning reduces a bar to a 1-cell line', () => {
    const cols = 20;
    const rows = 7;
    const mask = new Uint8Array(cols * rows);
    for (let r = 1; r < 6; r++) for (let c = 1; c < 19; c++) mask[r * cols + c] = 1;
    const sk = thin(mask, cols, rows);
    const count = sk.reduce((s, v) => s + v, 0);
    expect(count).toBeGreaterThan(8);
    expect(count).toBeLessThan(25);
  });
});

describe('walkability', () => {
  it('classifies open, narrow and blocked areas', () => {
    // 4 m x 3 m room with a cabinet leaving a 500 mm gap to the south wall.
    const room = rectPolygon(0, 0, 4000, 3000);
    const cab = rectPolygon(1500, 0, 1000, 2500);
    const res = analyzeWalkability(room, [cab], { aisleWidth: 762, entries: [{ x: 300, y: 1500 }] });
    const at = (x: number, y: number) => res.classes[cellAt(res.grid, { x, y })];
    expect(at(700, 1500)).toBe(WALK_OPEN);
    expect(at(2000, 1000)).toBe(WALK_BLOCKED);
    expect(at(2000, 2750)).toBe(WALK_NARROW); // 500 mm gap < 30"
    expect(at(-20, -20)).toBe(WALK_OUTSIDE);
    // The east part is walkable but not reachable from the west entry at 30".
    expect(at(3300, 1500)).toBe(WALK_UNREACHABLE);
    expect(res.stats.narrowArea).toBeGreaterThan(0);
    expect(res.stats.unreachableArea).toBeGreaterThan(0);
    close(res.stats.blockedArea, 1000 * 2500, 50 * 50 * 60);
  });
  it('the same gap is fine for a narrower aisle', () => {
    const room = rectPolygon(0, 0, 4000, 3000);
    const cab = rectPolygon(1500, 0, 1000, 2500);
    const res = analyzeWalkability(room, [cab], { aisleWidth: 400, entries: [{ x: 300, y: 1500 }] });
    expect(res.classes[cellAt(res.grid, { x: 3300, y: 1500 })]).toBe(WALK_OPEN);
  });
  it('without entries the largest walkable region is reachable', () => {
    const res = analyzeWalkability(rectPolygon(0, 0, 3000, 3000), [], { aisleWidth: 762 });
    // A round body cannot sweep the square room corners, so coverage is just under 100%.
    expect(res.stats.openArea).toBeGreaterThan(0.99 * 3000 * 3000);
    expect(res.deadEnds).toEqual([]);
  });
  it('"main path narrows to N inches beside the cabinet"', () => {
    const room = rectPolygon(0, 0, 6000, 3000);
    const cabinet = rectPolygon(2500, 0, 600, 2517.4); // leaves 19" (482.6 mm) to the south wall
    const res = analyzeWalkability(room, [cabinet], { aisleWidth: 762, cellSize: 25 });
    const r = narrowestAlongRoute(res, { x: 500, y: 1500 }, { x: 5500, y: 1500 })!;
    expect(r).not.toBeNull();
    expect(r.nearestObstacle).toBe(0);
    close(r.width, 19 * IN, 30);
    expect(r.point.x).toBeGreaterThan(2300);
    expect(r.point.x).toBeLessThan(3200);
    expect(r.routeLength).toBeGreaterThan(5000);
  });
  it('narrowest route ignores the endpoints', () => {
    const res = analyzeWalkability(rectPolygon(0, 0, 6000, 3000), [], { aisleWidth: 762 });
    const r = narrowestAlongRoute(res, { x: 30, y: 30 }, { x: 5970, y: 2970 })!;
    // Without ignoring the ends the corner cells (≈150 mm) would dominate; 600 mm out the aisle is ≈950 mm.
    expect(r.width).toBeGreaterThan(900);
  });
  it('unreachable destination → null', () => {
    const room = rectPolygon(0, 0, 6000, 3000);
    const wall = rectPolygon(3000, 0, 100, 3000);
    const res = analyzeWalkability(room, [wall], { aisleWidth: 762 });
    expect(narrowestAlongRoute(res, { x: 500, y: 1500 }, { x: 5500, y: 1500 })).toBeNull();
    expect(walkingDistance(res, { x: 500, y: 1500 }, { x: 5500, y: 1500 })).toBeNull();
  });
  it('detects a dead-end corridor', () => {
    // Main hall 6000x2000 plus a 900 mm-wide corridor 3000 long going south, closed at its end.
    const room: Polygon = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 2000 },
      { x: 3450, y: 2000 },
      { x: 3450, y: 5000 },
      { x: 2550, y: 5000 },
      { x: 2550, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const res = analyzeWalkability(room, [], { aisleWidth: 762, entries: [{ x: 200, y: 1000 }] });
    expect(res.deadEnds.length).toBeGreaterThanOrEqual(1);
    const d = res.deadEnds.find((x) => x.point.y > 3500)!;
    expect(d).toBeDefined();
    expect(d.point.x).toBeGreaterThan(2550);
    expect(d.point.x).toBeLessThan(3450);
    expect(d.length).toBeGreaterThan(1500);
    expect(d.width).toBeLessThan(1000);
  });
  it('walking distance goes around obstacles', () => {
    const room = rectPolygon(0, 0, 6000, 4000);
    const island = rectPolygon(2500, 0, 1000, 3000);
    const res = analyzeWalkability(room, [island], { aisleWidth: 600 });
    const d = walkingDistance(res, { x: 1000, y: 500 }, { x: 5000, y: 500 })!;
    // Euclidean detour around the island's corners is ≈ 7466 mm; grid paths are slightly longer.
    expect(d).toBeGreaterThan(7400);
    expect(d).toBeLessThan(8500);
    expect(clearanceAt(res, { x: 1000, y: 2000 })).toBeGreaterThan(900);
    expect(clearanceAt(res, { x: -500, y: 0 })).toBe(-1);
  });
  it('workflow travel sums legs, walking when a grid is supplied', () => {
    const room = rectPolygon(0, 0, 6000, 4000);
    const res = analyzeWalkability(room, [rectPolygon(2500, 0, 1000, 3000)], { aisleWidth: 600 });
    const stations = [
      { x: 1000, y: 500 },
      { x: 5000, y: 500 },
      { x: 5000, y: 3500 },
    ];
    const straight = workflowTravel(stations);
    close(straight.total, 4000 + 3000);
    const walked = workflowTravel(stations, res);
    expect(walked.total).toBeGreaterThan(straight.total);
    expect(walked.legs.every((l) => l.walked)).toBe(true);
    const split = analyzeWalkability(room, [rectPolygon(2500, 0, 1000, 4000)], { aisleWidth: 600 });
    const blocked = workflowTravel([stations[0]!, stations[1]!], split);
    expect(blocked.legs[0]!.blocked).toBe(true);
    close(blocked.total, 4000);
  });
});

describe('utilization', () => {
  it('space utilization never double-counts overlaps and excludes clearances', () => {
    const room = rectPolygon(0, 0, 6000, 5000);
    const u = spaceUtilization({
      room,
      obstructions: [rectPolygon(0, 0, 500, 500)],
      footprints: [rectPolygon(250, 0, 1000, 500), rectPolygon(1000, 0, 1000, 500)],
      zones: [rectPolygon(0, 0, 3000, 3000), rectPolygon(2000, 2000, 2000, 2000)],
    });
    expect(u.roomArea).toBe(30e6);
    close(u.obstructionArea, 250000);
    close(u.footprintArea, 2000 * 500 - 250000, 1e-3);
    close(u.openArea, 30e6 - 2000 * 500, 1e-3);
    close(u.zoneArea, 9e6 + 4e6 - 1e6, 1e-3);
    close(u.pct.open + u.pct.footprint + u.pct.obstruction, 100, 1e-6);
  });
  it('handles empty rooms and clips outside footprints', () => {
    expect(spaceUtilization({ room: [], obstructions: [], footprints: [] }).roomArea).toBe(0);
    const u = spaceUtilization({ room: rectPolygon(0, 0, 1000, 1000), obstructions: [], footprints: [rectPolygon(900, 0, 500, 100)] });
    close(u.footprintArea, 100 * 100);
  });
  it('wall utilization: occupied, openings, available', () => {
    const cab = rectPolygon(1000, 0, 1219.2, 609.6);
    const u = wallUtilization(WALLS, ROOM, [cab], [[], [], [[1000, 1000 + 16 * 12 * IN]], []]);
    const north = u[0]!;
    close(north.occupied, 1219.2, 1e-6);
    close(north.available, 240 * IN - 1219.2, 1e-6);
    const south = u[2]!;
    close(south.openings, 16 * 12 * IN, 1e-6);
    close(south.available, 240 * IN - 16 * 12 * IN, 1e-6);
    expect(u[1]!.occupied).toBe(0);
  });
  it('vertical wall utilization with overlap counted once', () => {
    const v = verticalWallUtilization(4000, 2700, [
      { start: 0, end: 1000, bottom: 1400, top: 2100 },
      { start: 500, end: 1500, bottom: 1400, top: 2100 },
      { start: 0, end: 0, bottom: 0, top: 10 },
    ], [{ start: 3000, end: 3900, bottom: 0, top: 2032 }]);
    expect(v.surface).toBe(4000 * 2700);
    close(v.covered, 1500 * 700, 1e-3);
    close(v.openings, 900 * 2032, 1e-3);
    close(v.unused, 4000 * 2700 - 1500 * 700 - 900 * 2032, 1e-3);
    expect(v.pctCovered).toBeGreaterThan(0);
    expect(area(rectPolygon(0, 0, 1, 1))).toBe(1);
  });
});
