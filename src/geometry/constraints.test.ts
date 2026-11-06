import { describe, expect, it } from 'vitest';
import { checkConstraints, hasConstraints, solveConstraints, solveWithTiers, type WallConstraintSpec } from './constraints';
import { closestPointsBetweenPolygons, closestPointsSegmentPolygon, faceClearance, polygonSegments, rayCast } from './raycast';
import { rectPolygon } from './polygon';
import { angleOf, distance, type Point } from './vec';

const close = (a: number, b: number, eps = 0.06) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const dir = (p: Point[], i: number) => angleOf({ x: p[(i + 1) % p.length]!.x - p[i]!.x, y: p[(i + 1) % p.length]!.y - p[i]!.y });

// 6000 × 5000 rectangle, clockwise on screen: NW, NE, SE, SW. Walls: 0 north, 1 east, 2 south, 3 west.
const RECT = rectPolygon(0, 0, 6000, 5000);
const HV: WallConstraintSpec[] = [{ horizontal: true }, { vertical: true }, { horizontal: true }, { vertical: true }];

describe('constraint solver', () => {
  it('is a no-op without constraints', () => {
    const r = solveConstraints(RECT, [undefined, {}, undefined, undefined]);
    expect(r.ok).toBe(true);
    expect(r.points).toEqual(RECT);
    expect(hasConstraints([{}, undefined])).toBe(false);
    expect(hasConstraints([{ lockLengthIgnored: true } as unknown as WallConstraintSpec, { horizontal: true }])).toBe(true);
  });

  it('keeps a constrained rectangle rectangular when a corner is dragged (minimal tier)', () => {
    const moved = RECT.map((p) => ({ ...p }));
    moved[1] = { x: 6500, y: -300 }; // drag NE corner out and up
    const r = solveWithTiers(moved, HV, new Set([1]), [new Set([3])]);
    expect(r.ok).toBe(true);
    // NW follows in y (north wall horizontal), SE follows in x (east wall vertical), SW unchanged.
    close(r.points[0]!.y, -300);
    close(r.points[0]!.x, 0);
    close(r.points[2]!.x, 6500);
    close(r.points[2]!.y, 5000);
    expect(r.points[3]).toEqual({ x: 0, y: 5000 });
    expect(r.points[1]).toEqual({ x: 6500, y: -300 });
  });

  it('enforces horizontal / vertical on a skewed outline', () => {
    const skew = [
      { x: 0, y: 0 },
      { x: 6000, y: 250 },
      { x: 6100, y: 5000 },
      { x: 0, y: 5000 },
    ];
    const r = solveConstraints(skew, [{ horizontal: true }, { vertical: true }], { pinned: new Set([0, 3]) });
    expect(r.ok).toBe(true);
    close(r.points[1]!.y, 0);
    close(r.points[2]!.x, r.points[1]!.x);
  });

  it('holds a locked length while the neighbor is dragged', () => {
    const moved = RECT.map((p) => ({ ...p }));
    moved[2] = { x: 7000, y: 5000 }; // drag SE east; east wall (1) keeps 5000 length, north wall (0) is locked at 6000
    const specs: Array<WallConstraintSpec | undefined> = [{ length: 6000 }, undefined, undefined, undefined];
    const r = solveConstraints(moved, specs, { pinned: new Set([2, 0, 3]) });
    expect(r.ok).toBe(true);
    close(distance(r.points[0]!, r.points[1]!), 6000);
  });

  it('locks a wall direction (angle)', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 5000, y: 1000 },
      { x: 5000, y: 5000 },
      { x: 0, y: 5000 },
    ];
    const r = solveConstraints(pts, [{ angle: 0 }], { pinned: new Set([0]) });
    expect(r.ok).toBe(true);
    close(dir(r.points, 0), 0, 0.01);
    // Length is preserved by a pure rotation.
    close(distance(r.points[0]!, r.points[1]!), Math.hypot(5000, 1000), 0.1);
  });

  it('makes walls parallel and perpendicular', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6300, y: 5000 },
      { x: 0, y: 5200 },
    ];
    const specs: Array<WallConstraintSpec | undefined> = [{ horizontal: true }, { perpendicularTo: 0 }, { parallelTo: 0 }, undefined];
    const r = solveConstraints(pts, specs, { pinned: new Set([0, 1]) });
    expect(r.ok).toBe(true);
    close(Math.abs(Math.sin(((dir(r.points, 1) - 90) * Math.PI) / 180)), 0, 1e-4);
    close(Math.abs(Math.sin((dir(r.points, 2) * Math.PI) / 180)), 0, 1e-4);
  });

  it('reports unsatisfiable combinations instead of silently breaking them', () => {
    // Both endpoints of the north wall are pinned but the wall must be 5000 long.
    const r = solveConstraints(RECT, [{ length: 5000 }], { pinned: new Set([0, 1]), maxIterations: 50 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatchObject({ wall: 0, kind: 'length' });
  });

  it('checkConstraints lists residuals by kind', () => {
    const v = checkConstraints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 10 },
        { x: 0, y: 100 },
      ],
      [{ horizontal: true, length: 50 }],
    );
    expect(v.map((x) => x.kind).sort()).toEqual(['horizontal', 'length']);
  });
});

describe('ray casting & closest points', () => {
  const box = rectPolygon(1000, 1000, 500, 500);
  it('casts a ray to the nearest segment', () => {
    const hit = rayCast({ x: 0, y: 1250 }, { x: 1, y: 0 }, polygonSegments(box));
    expect(hit).not.toBeNull();
    close(hit!.t, 1000);
    expect(rayCast({ x: 0, y: 0 }, { x: -1, y: 0 }, polygonSegments(box))).toBeNull();
  });

  it('finds closest points between polygons and reports overlap', () => {
    const other = rectPolygon(2000, 1100, 200, 200);
    const c = closestPointsBetweenPolygons(box, other);
    close(c.distance, 500);
    close(c.onA.x, 1500);
    close(c.onB.x, 2000);
    expect(closestPointsBetweenPolygons(box, rectPolygon(1400, 1400, 300, 300)).overlapping).toBe(true);
    expect(closestPointsBetweenPolygons(box, rectPolygon(1100, 1100, 50, 50)).distance).toBe(0);
  });

  it('measures segment ↔ polygon distance (wall to object)', () => {
    const c = closestPointsSegmentPolygon({ x: 0, y: 0 }, { x: 5000, y: 0 }, box);
    close(c.distance, 1000);
    close(c.onA.y, 0);
  });

  it('measures clearance in front of a face as the minimum over the face', () => {
    const walls = polygonSegments(rectPolygon(0, 0, 4000, 3000));
    // A step in the "obstacle": a box sticking out partially in front of the face.
    const obstacle = polygonSegments(rectPolygon(1200, 2000, 100, 100));
    const c = faceClearance({ x: 1000, y: 1500 }, { x: 1500, y: 1500 }, { x: 0, y: 1 }, [...walls, ...obstacle]);
    close(c.distance, 500);
    const free = faceClearance({ x: 1000, y: 1500 }, { x: 1500, y: 1500 }, { x: 0, y: 1 }, walls);
    close(free.distance, 1500);
  });
});
