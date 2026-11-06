import { describe, expect, it } from 'vitest';
import {
  add,
  angleDiff,
  angleOf,
  cross,
  distance,
  dot,
  fromAngle,
  normalize,
  normalizeAngle,
  perp,
  rotate,
  rotateAround,
} from './vec';
import {
  closestPointOnSegment,
  closestPointsBetweenSegments,
  lineIntersection,
  mergeIntervals,
  orient,
  pointSegmentDistance,
  projectParam,
  segmentIntersection,
  segmentSegmentDistance,
  segmentsIntersect,
  signedLineDistance,
  subtractIntervals,
} from './segment';
import {
  area,
  bbox,
  bboxIntersects,
  centroid,
  cleanPolygon,
  containsPoint,
  convexHull,
  distanceToBoundary,
  edgeOutwardNormal,
  findSelfIntersections,
  isConvex,
  isSimplePolygon,
  locatePoint,
  offsetPolygon,
  perimeter,
  polygonContainsPolygon,
  polygonDistance,
  polygonsOverlapOrTouch,
  rectPolygon,
  rotatePolygon,
  signedArea,
  withPositiveOrientation,
  type Polygon,
} from './polygon';
import { localRect, localToWorld, obbBBox, obbContainsPoint, obbCorners, rotatedExtents, worldToLocal } from './obb';
import { minimumWidth, polygonCollision, satConvex } from './sat';
import { areaOfMulti, difference, intersect, intersectionArea, union } from './clip';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);
const expectBox = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: typeof a) => {
  close(a.minX, b.minX);
  close(a.minY, b.minY);
  close(a.maxX, b.maxX);
  close(a.maxY, b.maxY);
};

/** L-shaped room: 6000×6000 with the NE 2000×2000 corner removed (screen coords, y down). */
export const L_ROOM: Polygon = [
  { x: 0, y: 0 },
  { x: 4000, y: 0 },
  { x: 4000, y: 2000 },
  { x: 6000, y: 2000 },
  { x: 6000, y: 6000 },
  { x: 0, y: 6000 },
];

describe('vec', () => {
  it('basic arithmetic', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(perp({ x: 1, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    close(Math.hypot(normalize({ x: 3, y: 4 }).x, normalize({ x: 3, y: 4 }).y), 1);
  });
  it('rotation is clockwise on screen (y down) and exact at right angles', () => {
    // East rotated 90° points south (+y).
    expect(rotate({ x: 1, y: 0 }, 90)).toEqual({ x: 0, y: 1 });
    expect(rotate({ x: 1, y: 0 }, 180)).toEqual({ x: -1, y: 0 });
    expect(rotate({ x: 1, y: 0 }, 270)).toEqual({ x: 0, y: -1 });
    expect(rotate({ x: 2, y: 3 }, 0)).toEqual({ x: 2, y: 3 });
    const r = rotate({ x: 1, y: 0 }, 45);
    close(r.x, Math.SQRT1_2);
    close(r.y, Math.SQRT1_2);
    expect(rotateAround({ x: 2, y: 1 }, { x: 1, y: 1 }, 90)).toEqual({ x: 1, y: 2 });
  });
  it('angles', () => {
    expect(angleOf({ x: 0, y: 1 })).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(720)).toBe(0);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
    expect(angleDiff(0, 180)).toBe(180);
    const f = fromAngle(90);
    close(f.x, 0);
    close(f.y, 1);
  });
});

describe('segment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  it('projection and closest point', () => {
    expect(projectParam({ x: 5, y: 3 }, a, b)).toBe(0.5);
    expect(projectParam({ x: -5, y: 3 }, a, b)).toBe(-0.5);
    expect(closestPointOnSegment({ x: 5, y: 3 }, a, b)).toEqual({ point: { x: 5, y: 0 }, t: 0.5, distance: 3 });
    expect(closestPointOnSegment({ x: -3, y: 4 }, a, b).distance).toBe(5);
    expect(closestPointOnSegment({ x: 13, y: 4 }, a, b).point).toEqual({ x: 10, y: 0 });
    expect(pointSegmentDistance({ x: 3, y: 3 }, a, a)).toBe(Math.hypot(3, 3));
  });
  it('signed line distance: positive on the math-left', () => {
    expect(signedLineDistance({ x: 5, y: 2 }, a, b)).toBe(2);
    expect(signedLineDistance({ x: 5, y: -2 }, a, b)).toBe(-2);
  });
  it('orientation', () => {
    expect(orient(a, b, { x: 5, y: 1 })).toBe(1);
    expect(orient(a, b, { x: 5, y: -1 })).toBe(-1);
    expect(orient(a, b, { x: 20, y: 0 })).toBe(0);
  });
  it('intersection tests', () => {
    expect(segmentsIntersect(a, b, { x: 5, y: -5 }, { x: 5, y: 5 })).toBe(true);
    expect(segmentsIntersect(a, b, { x: 5, y: 1 }, { x: 5, y: 5 })).toBe(false);
    expect(segmentsIntersect(a, b, { x: 10, y: 0 }, { x: 10, y: 5 })).toBe(true); // touching end
    expect(segmentsIntersect(a, b, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true); // collinear overlap
    expect(segmentsIntersect(a, b, { x: 11, y: 0 }, { x: 15, y: 0 })).toBe(false); // collinear disjoint
    expect(segmentIntersection(a, b, { x: 5, y: -5 }, { x: 5, y: 5 })).toEqual({ point: { x: 5, y: 0 }, t: 0.5, u: 0.5 });
    expect(segmentIntersection(a, b, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull();
    expect(lineIntersection(a, b, { x: 20, y: -1 }, { x: 20, y: 1 })).toEqual({ x: 20, y: 0 });
    expect(lineIntersection(a, b, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
  it('segment distance', () => {
    expect(segmentSegmentDistance(a, b, { x: 0, y: 3 }, { x: 10, y: 3 })).toBe(3);
    expect(segmentSegmentDistance(a, b, { x: 5, y: -1 }, { x: 5, y: 1 })).toBe(0);
    expect(segmentSegmentDistance(a, b, { x: 13, y: 4 }, { x: 20, y: 4 })).toBe(5);
    const cp = closestPointsBetweenSegments(a, b, { x: 12, y: 0 }, { x: 20, y: 0 });
    expect(cp.distance).toBe(2);
    expect(cp.onP).toEqual({ x: 10, y: 0 });
  });
  it('interval algebra', () => {
    expect(mergeIntervals([[5, 7], [0, 2], [1, 3], [7, 8]])).toEqual([[0, 3], [5, 8]]);
    expect(mergeIntervals([[3, 1]])).toEqual([[1, 3]]);
    expect(subtractIntervals(0, 10, [[2, 3], [5, 7]])).toEqual([[0, 2], [3, 5], [7, 10]]);
    expect(subtractIntervals(0, 10, [[-5, 3], [8, 15]])).toEqual([[3, 8]]);
    expect(subtractIntervals(0, 10, [[0, 10]])).toEqual([]);
    expect(subtractIntervals(0, 10, [])).toEqual([[0, 10]]);
  });
});

describe('polygon measures', () => {
  const sq = rectPolygon(0, 0, 10, 10);
  it('area, orientation and perimeter', () => {
    expect(area(sq)).toBe(100);
    expect(signedArea(sq)).toBe(100); // math-CCW (screen-CW with y down)
    expect(signedArea([...sq].reverse())).toBe(-100);
    expect(withPositiveOrientation([...sq].reverse())).toEqual(sq);
    expect(perimeter(sq)).toBe(40);
    expect(area(L_ROOM)).toBe(6000 * 6000 - 2000 * 2000);
    expect(area([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
  it('centroid', () => {
    expect(centroid(sq)).toEqual({ x: 5, y: 5 });
    const c = centroid(L_ROOM);
    // Composite: big square minus NE notch.
    const bigA = 36e6;
    const notchA = 4e6;
    close(c.x, (3000 * bigA - 5000 * notchA) / (bigA - notchA));
    close(c.y, (3000 * bigA - 1000 * notchA) / (bigA - notchA));
    expect(centroid([{ x: 0, y: 0 }, { x: 2, y: 0 }])).toEqual({ x: 1, y: 0 });
  });
  it('bbox', () => {
    expect(bbox(L_ROOM)).toEqual({ minX: 0, minY: 0, maxX: 6000, maxY: 6000 });
    expect(bboxIntersects(bbox(sq), bbox(rectPolygon(10, 10, 5, 5)))).toBe(true);
    expect(bboxIntersects(bbox(sq), bbox(rectPolygon(11, 0, 5, 5)))).toBe(false);
  });
  it('convexity and hull', () => {
    expect(isConvex(sq)).toBe(true);
    expect(isConvex(L_ROOM)).toBe(false);
    const hull = convexHull(L_ROOM);
    expect(area(hull)).toBe(34e6); // notch corner cut diagonally
    expect(hull).toHaveLength(5);
  });
  it('cleanPolygon removes duplicates and collinear vertices', () => {
    const messy = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(cleanPolygon(messy)).toHaveLength(4);
  });
});

describe('containment (irregular L room)', () => {
  it('locates points', () => {
    expect(locatePoint(L_ROOM, { x: 1000, y: 1000 })).toBe('inside');
    expect(locatePoint(L_ROOM, { x: 5000, y: 1000 })).toBe('outside'); // inside the notch
    expect(locatePoint(L_ROOM, { x: 5000, y: 3000 })).toBe('inside');
    expect(locatePoint(L_ROOM, { x: 4000, y: 1000 })).toBe('boundary');
    expect(locatePoint(L_ROOM, { x: 0, y: 0 })).toBe('boundary');
    expect(locatePoint(L_ROOM, { x: -1, y: 3000 })).toBe('outside');
    expect(containsPoint(L_ROOM, { x: 6000, y: 6000 })).toBe(true);
    expect(locatePoint([], { x: 0, y: 0 })).toBe('outside');
  });
  it('polygon in polygon handles the reflex corner', () => {
    expect(polygonContainsPolygon(L_ROOM, rectPolygon(100, 100, 1000, 1000))).toBe(true);
    // Straddles the notch: all four corners... (3500..4500, 1500..2500); NE corner is in the notch.
    expect(polygonContainsPolygon(L_ROOM, rectPolygon(3500, 1500, 1000, 1000))).toBe(false);
    // Rect whose corners are all inside but whose edge cuts through the notch corner region.
    const sneaky: Polygon = [
      { x: 3000, y: 1000 },
      { x: 3500, y: 1000 },
      { x: 5500, y: 3000 },
      { x: 5000, y: 3000 },
    ];
    expect(sneaky.every((p) => containsPoint(L_ROOM, p))).toBe(true); // every vertex is inside…
    expect(polygonContainsPolygon(L_ROOM, sneaky)).toBe(false); // …but an edge cuts through the notch
    // Flush against walls is allowed.
    expect(polygonContainsPolygon(L_ROOM, rectPolygon(0, 0, 4000, 2000))).toBe(true);
    expect(polygonContainsPolygon(L_ROOM, rectPolygon(4000, 2000, 2000, 4000))).toBe(true);
    // A chord across the notch mouth: vertices on boundary but middle leaves the room.
    const chord: Polygon = [
      { x: 4000, y: 1000 },
      { x: 5000, y: 2000 },
      { x: 4000, y: 2000 },
    ];
    expect(polygonContainsPolygon(L_ROOM, chord)).toBe(false);
  });
});

describe('self-intersection', () => {
  it('detects a bow-tie', () => {
    const bow: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const hits = findSelfIntersections(bow);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point).toEqual({ x: 5, y: 5 });
    expect(isSimplePolygon(bow)).toBe(false);
  });
  it('accepts simple rooms', () => {
    expect(isSimplePolygon(L_ROOM)).toBe(true);
    expect(isSimplePolygon(rectPolygon(0, 0, 1, 1))).toBe(true);
  });
  it('detects fold-back of adjacent edges and degenerate triangles', () => {
    const fold: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(isSimplePolygon(fold)).toBe(false);
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toBe(false);
  });
  it('detects a vertex touching a non-adjacent edge', () => {
    const touch: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(isSimplePolygon(touch)).toBe(false);
  });
});

describe('distances', () => {
  it('distance to boundary', () => {
    const d = distanceToBoundary(L_ROOM, { x: 3200, y: 1000 });
    expect(d.distance).toBe(800);
    expect(d.point).toEqual({ x: 4000, y: 1000 });
  });
  it('polygon distance', () => {
    expect(polygonDistance(rectPolygon(0, 0, 10, 10), rectPolygon(13, 0, 5, 5))).toBe(3);
    expect(polygonDistance(rectPolygon(0, 0, 10, 10), rectPolygon(5, 5, 10, 10))).toBe(0);
    expect(polygonDistance(rectPolygon(0, 0, 10, 10), rectPolygon(13, 14, 5, 5))).toBe(5);
    expect(polygonsOverlapOrTouch(rectPolygon(0, 0, 10, 10), rectPolygon(2, 2, 2, 2))).toBe(true); // contained
    expect(polygonsOverlapOrTouch(rectPolygon(0, 0, 10, 10), rectPolygon(10, 0, 2, 2))).toBe(true); // touching
  });
});

describe('offsetPolygon', () => {
  it('grows a square uniformly', () => {
    const out = offsetPolygon(rectPolygon(0, 0, 100, 100), 10);
    expect(area(out)).toBeCloseTo(120 * 120, 6);
    expectBox(bbox(out), { minX: -10, minY: -10, maxX: 110, maxY: 110 });
  });
  it('works for either orientation', () => {
    const out = offsetPolygon([...rectPolygon(0, 0, 100, 100)].reverse(), 10);
    expect(area(out)).toBeCloseTo(120 * 120, 6);
  });
  it('shrinks with negative distance', () => {
    expect(area(offsetPolygon(rectPolygon(0, 0, 100, 100), -10))).toBeCloseTo(80 * 80, 6);
  });
  it('supports per-edge distances (room walls of different thickness)', () => {
    // edges: 0 north(top), 1 east, 2 south, 3 west
    const out = offsetPolygon(rectPolygon(0, 0, 100, 100), [10, 20, 30, 40]);
    expectBox(bbox(out), { minX: -40, minY: -10, maxX: 120, maxY: 130 });
  });
  it('handles the reflex corner of an L room', () => {
    const out = offsetPolygon(L_ROOM, 150);
    expect(out).toHaveLength(6);
    // Reflex vertex (4000,2000) moves diagonally INTO the notch.
    close(out[2]!.x, 4150);
    close(out[2]!.y, 1850);
    // Outer square grows to 6300², the notch stays 2000×2000 (shifted by the wall thickness).
    expect(area(out)).toBeCloseTo(6300 * 6300 - 2000 * 2000, 3);
  });
  it('outward normals point away from the interior', () => {
    const sq = rectPolygon(0, 0, 10, 10);
    expect(edgeOutwardNormal(sq, 0)).toEqual({ x: 0, y: -1 }); // top edge → north
    expect(edgeOutwardNormal(sq, 1)).toEqual({ x: 1, y: -0 }); // right edge → east
    expect(edgeOutwardNormal([...sq].reverse(), 0).y).toBe(1); // bottom edge in reversed ring → south
  });
  it('bevels very sharp corners', () => {
    const spike: Polygon = [
      { x: 0, y: 0 },
      { x: 1000, y: 10 },
      { x: 0, y: 20 },
    ];
    const out = offsetPolygon(spike, 10, { miterLimit: 2 });
    expect(out.length).toBeGreaterThan(3);
  });
});

describe('OBB / rotated rectangles', () => {
  it('local ↔ world round-trip', () => {
    const pose = { x: 1000, y: 500, rotation: 30 };
    const p = { x: 120, y: -45 };
    const w = localToWorld(pose, p);
    const back = worldToLocal(pose, w);
    close(back.x, p.x);
    close(back.y, p.y);
  });
  it('corners of an unrotated box', () => {
    expect(obbCorners({ x: 0, y: 0, rotation: 0, width: 100, depth: 50 })).toEqual(localRect(100, 50));
  });
  it('rotating 90° swaps extents', () => {
    const o = { x: 0, y: 0, rotation: 90, width: 100, depth: 50 };
    const b = obbBBox(o);
    close(b.maxX - b.minX, 50);
    close(b.maxY - b.minY, 100);
    expect(rotatedExtents(100, 50, 90)).toEqual({ width: 50, depth: 100 });
    const e45 = rotatedExtents(100, 100, 45);
    close(e45.width, 100 * Math.SQRT2);
  });
  it('front of an object (local +y) faces west after 90° rotation', () => {
    const front = localToWorld({ x: 0, y: 0, rotation: 90 }, { x: 0, y: 1 });
    close(front.x, -1);
    close(front.y, 0);
  });
  it('containment in a rotated box', () => {
    const o = { x: 0, y: 0, rotation: 45, width: 100, depth: 10 };
    expect(obbContainsPoint(o, { x: 30, y: 30 })).toBe(true);
    expect(obbContainsPoint(o, { x: 30, y: -30 })).toBe(false);
  });
});

describe('SAT collision', () => {
  it('separated boxes', () => {
    expect(satConvex(rectPolygon(0, 0, 10, 10), rectPolygon(11, 0, 10, 10)).colliding).toBe(false);
  });
  it('touching boxes do not collide', () => {
    expect(satConvex(rectPolygon(0, 0, 10, 10), rectPolygon(10, 0, 10, 10)).colliding).toBe(false);
  });
  it('overlapping boxes: depth + direction', () => {
    const r = satConvex(rectPolygon(0, 0, 10, 10), rectPolygon(8, 2, 10, 10));
    expect(r.colliding).toBe(true);
    close(r.depth, 2);
    close(r.normal.x, 1);
  });
  it('containment gives full push-out depth', () => {
    const r = satConvex(rectPolygon(0, 0, 100, 100), rectPolygon(10, 40, 10, 10));
    expect(r.colliding).toBe(true);
    close(r.depth, 20); // push left: 10+10
  });
  it('rotated boxes (diamond vs square): gap along the diagonal', () => {
    const square = obbCorners({ x: 0, y: 0, rotation: 0, width: 100, depth: 100 });
    // Diamond centered at (110, 0): its west tip reaches 110 − 50√2 ≈ 39.3 → overlaps by ≈10.7.
    const diamond = obbCorners({ x: 110, y: 0, rotation: 45, width: 100, depth: 100 });
    const r = satConvex(square, diamond);
    expect(r.colliding).toBe(true);
    close(r.depth, 50 - (110 - 50 * Math.SQRT2), 1e-6);
    expect(satConvex(square, obbCorners({ x: 130, y: 0, rotation: 45, width: 100, depth: 100 })).colliding).toBe(false);
    const far = obbCorners({ x: 125, y: 125, rotation: 45, width: 100, depth: 100 });
    // Corner-to-corner diagonal: square corner at (50,50); diamond's nearest point is its tip at 125-70.7 along both...
    expect(satConvex(square, far).colliding).toBe(false);
  });
  it('rotated vs rotated at arbitrary angles matches clipping area sign', () => {
    for (let angle = 0; angle < 180; angle += 15) {
      const a = obbCorners({ x: 0, y: 0, rotation: angle, width: 200, depth: 60 });
      for (let dx = -300; dx <= 300; dx += 75) {
        const b = obbCorners({ x: dx, y: 40, rotation: -angle / 2, width: 120, depth: 80 });
        const s = satConvex(a, b);
        const ia = intersectionArea(a, b);
        expect(s.colliding).toBe(ia > 1e-6);
      }
    }
  });
  it('minimumWidth', () => {
    close(minimumWidth(rectPolygon(0, 0, 100, 30)), 30);
    close(minimumWidth(obbCorners({ x: 0, y: 0, rotation: 33, width: 100, depth: 30 })), 30);
  });
  it('polygonCollision on concave shapes uses overlap width', () => {
    const r = polygonCollision(L_ROOM, rectPolygon(3500, 500, 1000, 400));
    expect(r.colliding).toBe(true);
    close(r.overlapArea, 500 * 400);
    close(r.depth, 400);
    const none = polygonCollision(L_ROOM, rectPolygon(4500, 500, 1000, 400));
    expect(none.colliding).toBe(false);
  });
});

describe('clipping', () => {
  const a = rectPolygon(0, 0, 10, 10);
  const b = rectPolygon(5, 5, 10, 10);
  it('intersection / union / difference areas', () => {
    expect(areaOfMulti(intersect(a, b))).toBeCloseTo(25, 9);
    expect(areaOfMulti(union(a, b))).toBeCloseTo(175, 9);
    expect(areaOfMulti(difference(a, b))).toBeCloseTo(75, 9);
    expect(intersect(a, rectPolygon(20, 20, 1, 1))).toEqual([]);
  });
  it('difference with a hole', () => {
    const d = difference(rectPolygon(0, 0, 10, 10), rectPolygon(4, 4, 2, 2));
    expect(d).toHaveLength(1);
    expect(d[0]!.holes).toHaveLength(1);
    expect(areaOfMulti(d)).toBeCloseTo(96, 9);
  });
  it('union of disjoint parts keeps both', () => {
    expect(union(a, rectPolygon(20, 0, 5, 5))).toHaveLength(2);
  });
  it('empty inputs are safe', () => {
    expect(union()).toEqual([]);
    expect(intersect([], a)).toEqual([]);
    expect(difference([], a)).toEqual([]);
    expect(areaOfMulti(difference(a))).toBe(100);
  });
  it('rotated polygon intersection area', () => {
    const r = rotatePolygon(rectPolygon(-5, -5, 10, 10), 45, { x: 0, y: 0 });
    // Square ∩ same square rotated 45° = regular octagon, area = 2(√2−1)·s² ... for s=10 → 82.84
    expect(intersectionArea(rectPolygon(-5, -5, 10, 10), r)).toBeCloseTo(200 * (Math.SQRT2 - 1), 6);
  });
});
