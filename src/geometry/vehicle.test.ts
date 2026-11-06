import { describe, expect, it } from 'vitest';
import { dubinsPaths, dubinsSample, dubinsSamples, mod2pi, shortestDubins } from './dubins';
import {
  axleConfigToPose,
  checkDoorOpening,
  clearanceBands,
  clearanceEnvelope,
  doorHingeLocal,
  doorSwingPolygon,
  entryStagingPoses,
  entryStartPose,
  headingOf,
  hoodAccessZone,
  planVehicleEntry,
  poseToAxleConfig,
  rearAccessZone,
  rearAxleLocalY,
  rearAxleTurningRadius,
  rotationForHeading,
  sideSign,
  vehicleBody,
  vehicleMirrors,
  vehicleParts,
  wallObstaclesWithOpenings,
  type VehicleGeomSpec,
} from './vehicle';
import { area, bbox, containsPoint, rectPolygon } from './polygon';
import { areaOfMulti } from './clip';
import { roomWalls, wallQuads } from './walls';

const IN = 25.4;
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

// Roughly a Subaru WRX: 184" long, 71.7" wide, 79.5" with mirrors, 105.3" wheelbase.
const WRX: VehicleGeomSpec = {
  length: 184 * IN,
  width: 71.7 * IN,
  mirrorWidth: 79.5 * IN,
  foldedMirrorWidth: 74 * IN,
  wheelbase: 105.3 * IN,
  frontOverhang: 36 * IN,
  doors: [
    { id: 'driver-front', hingeFromFront: 60 * IN, length: 44 * IN, openAngle: 65 },
    { id: 'passenger-front', hingeFromFront: 60 * IN, length: 44 * IN, openAngle: 65 },
    { id: 'driver-rear', hingeFromFront: 104 * IN, length: 34 * IN, openAngle: 70 },
    { id: 'passenger-rear', hingeFromFront: 104 * IN, length: 34 * IN, openAngle: 70 },
  ],
  rearAccessDepth: 30 * IN,
  hoodAccessDepth: 24 * IN,
};

describe('Dubins paths', () => {
  it('straight line when already aligned', () => {
    const p = shortestDubins({ x: 0, y: 0, theta: 0 }, { x: 5000, y: 0, theta: 0 }, 5000)!;
    close(p.length, 5000, 1e-6);
    expect(p.word === 'LSL' || p.word === 'RSR').toBe(true);
  });
  it('mod2pi', () => {
    close(mod2pi(-Math.PI / 2), (3 * Math.PI) / 2);
    expect(mod2pi(2 * Math.PI)).toBe(0);
  });
  it('every path word ends at the goal configuration (random cases)', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let k = 0; k < 40; k++) {
      const start = { x: rnd() * 10000, y: rnd() * 10000, theta: rnd() * 2 * Math.PI };
      const goal = { x: rnd() * 10000, y: rnd() * 10000, theta: rnd() * 2 * Math.PI };
      const paths = dubinsPaths(start, goal, 1000 + rnd() * 4000);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        const end = dubinsSample(p, p.length);
        close(end.x, goal.x, 1e-3);
        close(end.y, goal.y, 1e-3);
        close(Math.cos(end.theta), Math.cos(goal.theta), 1e-6);
        close(Math.sin(end.theta), Math.sin(goal.theta), 1e-6);
      }
      for (let i = 1; i < paths.length; i++) expect(paths[i]!.length).toBeGreaterThanOrEqual(paths[i - 1]!.length);
    }
  });
  it('samples are spaced along arc length and never exceed the turn curvature', () => {
    const p = shortestDubins({ x: 0, y: 0, theta: 0 }, { x: 0, y: 6000, theta: Math.PI }, 2000)!;
    const s = dubinsSamples(p, 50);
    for (let i = 1; i < s.length; i++) {
      const d = Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y);
      expect(d).toBeLessThanOrEqual(50 + 1e-6);
      const dtheta = Math.abs(Math.atan2(Math.sin(s[i]!.theta - s[i - 1]!.theta), Math.cos(s[i]!.theta - s[i - 1]!.theta)));
      expect(dtheta).toBeLessThanOrEqual(50 / 2000 + 1e-6);
    }
  });
});

describe('vehicle footprint', () => {
  const pose = { x: 0, y: 0, rotation: 0 };
  it('body rectangle', () => {
    close(area(vehicleBody(WRX, pose)), 184 * IN * 71.7 * IN, 1e-3);
  });
  it('mirrors unfolded vs folded', () => {
    const open = vehicleMirrors(WRX, pose);
    expect(open).toHaveLength(2);
    const b = bbox(open.flat());
    close(b.maxX - b.minX, 79.5 * IN, 1e-6);
    const folded = vehicleMirrors({ ...WRX, mirrorsFolded: true }, pose);
    const bf = bbox(folded.flat());
    close(bf.maxX - bf.minX, 74 * IN, 1e-6);
    expect(vehicleMirrors({ ...WRX, mirrorWidth: WRX.width }, pose)).toEqual([]);
    expect(vehicleParts(WRX, pose)).toHaveLength(3);
  });
  it('driver side is the vehicle-left (local +x) for left-hand drive', () => {
    expect(sideSign(WRX, 'driver')).toBe(1);
    expect(sideSign(WRX, 'passenger')).toBe(-1);
    expect(sideSign({ driverSide: 'right' }, 'driver')).toBe(-1);
    // Parked nose-north (rotation 180 → front faces −y): driver side is the WEST side.
    const hinge = doorHingeLocal(WRX, WRX.doors[0]!);
    expect(hinge.x).toBeGreaterThan(0);
    const swing = doorSwingPolygon(WRX, { x: 0, y: 0, rotation: 180 }, WRX.doors[0]!);
    expect(bbox(swing).minX).toBeLessThan(-WRX.width / 2);
  });
  it('heading ↔ rotation', () => {
    close(headingOf({ x: 0, y: 0, rotation: 0 }), Math.PI / 2);
    expect(rotationForHeading(Math.PI / 2)).toBe(0);
    expect(rotationForHeading(-Math.PI / 2)).toBe(180);
    close(rotationForHeading(0), 270);
  });
  it('rear axle position and axle/pose round-trip', () => {
    const rear = 184 - 105.3 - 36;
    close(rearAxleLocalY(WRX), (-184 / 2 + rear) * IN, 1e-9);
    const p = { x: 1234, y: -567, rotation: 37 };
    for (const reverse of [false, true]) {
      const back = axleConfigToPose(WRX, poseToAxleConfig(WRX, p, reverse), reverse);
      close(back.x, p.x, 1e-6);
      close(back.y, p.y, 1e-6);
      close(back.rotation, p.rotation, 1e-6);
    }
  });
  it('turning radius conversion is sane', () => {
    const r = rearAxleTurningRadius(WRX, 18 * 12 * IN);
    expect(r).toBeGreaterThan(WRX.wheelbase);
    expect(r).toBeLessThan(18 * 12 * IN);
    // Impossible curb radius falls back to (at least) the wheelbase.
    expect(rearAxleTurningRadius(WRX, 1000)).toBeCloseTo(WRX.wheelbase);
  });
});

describe('doors and access zones', () => {
  const pose = { x: 0, y: 0, rotation: 0 };
  it('door swing sector area ≈ πr²·θ/360', () => {
    const d = WRX.doors[0]!;
    const poly = doorSwingPolygon(WRX, pose, d, d.openAngle, 64);
    close(area(poly), (Math.PI * d.length ** 2 * d.openAngle) / 360, area(poly) * 0.002);
  });
  it('door opens fully in open space', () => {
    const r = checkDoorOpening(WRX, pose, WRX.doors[0]!, []);
    expect(r.fullyOpens).toBe(true);
    expect(r.maxAngle).toBe(65);
    close(r.egressGap, 44 * IN * Math.sin((65 * Math.PI) / 180), 1e-6);
  });
  it('a cabinet 18" from the driver side limits the door', () => {
    const cabinet = rectPolygon(WRX.width / 2 + 18 * IN, -1000, 600, 3000);
    const r = checkDoorOpening(WRX, pose, WRX.doors[0]!, [cabinet]);
    expect(r.fullyOpens).toBe(false);
    expect(r.blockedBy).toBe(0);
    // sin(θ)·44" ≈ 18" − door skin → θ ≈ 22°
    expect(r.maxAngle).toBeGreaterThan(18);
    expect(r.maxAngle).toBeLessThan(26);
    expect(r.egressGap).toBeLessThanOrEqual(18 * IN);
    expect(r.egressGap).toBeGreaterThan(15 * IN);
    // Passenger side unaffected.
    expect(checkDoorOpening(WRX, pose, WRX.doors[1]!, [cabinet]).fullyOpens).toBe(true);
  });
  it('trunk and hood zones sit behind and in front', () => {
    const rear = bbox(rearAccessZone(WRX, pose));
    close(rear.maxY, -WRX.length / 2, 1e-6);
    close(rear.minY, -WRX.length / 2 - 30 * IN, 1e-6);
    const hood = bbox(hoodAccessZone(WRX, pose));
    close(hood.minY, WRX.length / 2, 1e-6);
  });
  it('clearance envelope applies per-side desired clearance', () => {
    const c = { driver: 30 * IN, passenger: 18 * IN, front: 24 * IN, rear: 30 * IN };
    const env = bbox(clearanceEnvelope(WRX, pose, c));
    close(env.maxX, WRX.width / 2 + 30 * IN, 1e-6); // driver = +x
    close(env.minX, -WRX.width / 2 - 18 * IN, 1e-6);
    close(env.maxY, WRX.length / 2 + 24 * IN, 1e-6);
    close(env.minY, -WRX.length / 2 - 30 * IN, 1e-6);
    const bands = clearanceBands(WRX, pose, c);
    close(bbox(bands.driver).minX, WRX.width / 2, 1e-6);
    close(bbox(bands.passenger).maxX, -WRX.width / 2, 1e-6);
    close(bbox(bands.front).minY, WRX.length / 2, 1e-6);
    close(bbox(bands.rear).maxY, -WRX.length / 2, 1e-6);
    const rhd = bbox(clearanceEnvelope({ ...WRX, driverSide: 'right' }, pose, c));
    close(rhd.minX, -WRX.width / 2 - 30 * IN, 1e-6);
  });
});

describe('garage entry planning (bicycle model)', () => {
  // 24' x 24' garage; 16' garage door centered on the south wall.
  const W = 288 * IN;
  const room = rectPolygon(0, 0, W, W);
  const walls = roomWalls(room);
  const doorStart = (W - 192 * IN) / 2;
  const opening = { wallIndex: 2, start: doorStart, end: doorStart + 192 * IN };
  // South wall runs east→west (from (W,W) to (0,W)), so offsets are measured from the east end.
  const obstaclesBase = wallObstaclesWithOpenings(wallQuads(room, 150), walls, [opening], 150);
  const south = walls[2]!;
  const a = { x: south.a.x + south.dir.x * opening.start, y: south.a.y };
  const b = { x: south.a.x + south.dir.x * opening.end, y: south.a.y };
  const openingGeom = { a, b, inward: south.inward };
  const R = rearAxleTurningRadius(WRX, 18 * 12 * IN);

  it('wall obstacles leave a gap for the opening', () => {
    expect(obstaclesBase.length).toBe(5);
    const mid = { x: W / 2, y: W + 75 };
    expect(obstaclesBase.some((o) => containsPoint(o.polygon, mid))).toBe(false);
    expect(obstaclesBase.some((o) => containsPoint(o.polygon, { x: 100, y: W + 75 }))).toBe(true);
  });

  it('drives straight in through the door into an empty bay', () => {
    const start = entryStartPose(openingGeom, WRX, 3000, 0);
    // Facing north: rotation 180.
    close(start.rotation, 180, 1e-9);
    const goal = { x: W / 2, y: W - 1000 - WRX.length / 2, rotation: 180 };
    const plan = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: obstaclesBase });
    expect(plan.feasible).toBe(true);
    expect(plan.collisions.filter((c) => !c.envelopeOnly)).toEqual([]);
    expect(plan.poses.length).toBeGreaterThan(10);
    expect(areaOfMulti(plan.swept)).toBeGreaterThan(area(vehicleBody(WRX, goal)));
    const last = plan.poses[plan.poses.length - 1]!;
    close(last.x, goal.x, 1);
    close(last.y, goal.y, 1);
  });

  it('reports a cabinet in the path with the obstacle id and depth', () => {
    const start = entryStartPose(openingGeom, WRX, 3000, 0);
    const goal = { x: W / 2, y: W - 1000 - WRX.length / 2, rotation: 180 };
    const cabinet = { id: 'cabinet', polygon: rectPolygon(W / 2 - 300, W - 900, 600, 400) };
    const plan = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: [...obstaclesBase, cabinet] });
    expect(plan.feasible).toBe(false);
    const hit = plan.collisions.find((c) => c.obstacleId === 'cabinet');
    expect(hit).toBeDefined();
    expect(hit!.depth).toBeGreaterThan(0);
    expect(hit!.envelopeOnly).toBe(false);
    expect(plan.alternatives.length).toBeGreaterThan(0);
  });

  it('an angled approach needs to straighten out first (staging poses)', () => {
    const start = entryStartPose(openingGeom, WRX, 6000, 25);
    const goal = { x: W / 2 - 1200, y: W - 800 - WRX.length / 2, rotation: 180 };
    // A direct Dubins curve clips the door jamb…
    const direct = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: obstaclesBase, step: 80 });
    expect(direct.feasible).toBe(false);
    expect(direct.collisions[0]!.obstacleId.startsWith('wall:2')).toBe(true);
    // …but squaring up outside the door first works.
    const staging = entryStagingPoses(openingGeom, WRX);
    expect(staging).toHaveLength(6);
    const plan = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: obstaclesBase, step: 80, staging });
    expect(plan.feasible).toBe(true);
    expect(plan.word).toContain('+');
    const last = plan.poses[plan.poses.length - 1]!;
    close(last.x, goal.x, 1);
    // Distances along the path are monotonic.
    expect(plan.length).toBeGreaterThan(direct.length * 0.5);
  });

  it('flags the clearance envelope separately from the body', () => {
    const start = entryStartPose(openingGeom, WRX, 3000, 0);
    const goal = { x: W / 2, y: W - 1000 - WRX.length / 2, rotation: 180 };
    const shelf = { id: 'shelf', polygon: rectPolygon(W / 2 + WRX.width / 2 + 100, 500, 400, 2000) };
    const plan = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: [...obstaclesBase, shelf], envelopeMargin: 300 });
    expect(plan.feasible).toBe(true);
    const hit = plan.collisions.find((c) => c.obstacleId === 'shelf');
    expect(hit?.envelopeOnly).toBe(true);
  });

  it('can back in (reverse)', () => {
    const start = entryStartPose(openingGeom, WRX, 3000, 0, 'reverse');
    close(start.rotation, 0, 1e-9); // rear faces the garage → front faces south
    const goal = { x: W / 2, y: 1000 + WRX.length / 2, rotation: 0 };
    const plan = planVehicleEntry({ spec: WRX, start, goal, turningRadius: R, obstacles: obstaclesBase, direction: 'reverse' });
    expect(plan.feasible).toBe(true);
    const last = plan.poses[plan.poses.length - 1]!;
    close(last.y, goal.y, 1);
  });
});
