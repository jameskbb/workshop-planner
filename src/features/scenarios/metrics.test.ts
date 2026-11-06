import { describe, expect, it } from 'vitest';
import { analyzeLayout, computeMetrics } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import type { Project } from '@/domain/schema';
import { builtinObject, createVehicle } from '@/features/objects/library';
import { createDemoProject } from '@/features/projects/demo';
import { relativeScores, layoutMetrics } from './scorecard';

const metric = (p: Project, id: string, sid?: string) => computeMetrics(p, sid).find((m) => m.metric.id === id)!.result;

function garage(): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(240), inches(240)) });
  p.architecture = [
    { id: 'door', kind: 'garage-door', name: 'Garage door', placement: { type: 'wall', wallId: p.room.walls[2]!.id, offset: inches(120) }, width: inches(192), depth: inches(7), height: inches(84), elevation: 0, shape: 'rect', locked: false, hidden: false, notes: '', garageDoor: { openingHeight: inches(84), trackLength: inches(100), trackHeight: inches(88), kind: 'sectional', state: 'closed' } },
  ];
  return p;
}

describe('scorecard metrics', () => {
  it('registers every brief metric with units and explanations', () => {
    const ids = computeMetrics(createDemoProject()).map((m) => m.metric.id);
    for (const id of ['open-floor-area', 'walkway-min-width', 'vehicle-clearance', 'collisions', 'clearance-conflicts', 'workbench-access', 'workflow-travel', 'wall-storage', 'parking-usability', 'electrical-distance']) {
      expect(ids, id).toContain(id);
    }
    for (const m of computeMetrics(createDemoProject())) expect(m.result.explanation.length, m.metric.id).toBeGreaterThan(10);
  });

  it('vehicle clearance is the smallest side gap', () => {
    const p = garage();
    const car = createVehicle('sedan', { x: inches(60), y: inches(120), rotation: 180 });
    p.scenarios[0]!.vehicles = [car];
    // Car side faces: x = 60 ± width/2. Left wall gap:
    const gap = Math.min(inches(60) - car.width / 2, inches(120) - car.length / 2);
    expect(metric(p, 'vehicle-clearance').value).toBeCloseTo(gap, 0);
    // Driver side (vehicle-left = west at rotation 180) is only ~2' from the wall: that door can't open 40°.
    expect(metric(p, 'parking-usability').value).toBe(75);
    const q = { ...p, scenarios: [{ ...p.scenarios[0]!, vehicles: [{ ...car, x: inches(120) }] }] };
    expect(metric(q, 'parking-usability').value).toBe(100);
  });

  it('workbench accessibility measures the clear floor in front', () => {
    const p = garage();
    const bench = builtinObject('workbench');
    const cab = builtinObject('base-cabinet');
    p.definitions = [bench, cab];
    // Bench against the north wall facing south; a cabinet 30" in front of it.
    const b = placeObject(bench, { x: inches(120), y: bench.depth / 2, rotation: 0 });
    const c = placeObject(cab, { x: inches(120), y: bench.depth + inches(30) + cab.depth / 2, rotation: 180 });
    p.scenarios[0]!.objects = [b, c];
    expect(metric(p, 'workbench-access').value).toBeCloseTo(inches(30), 0);
  });

  it('walkway width reports the pinch between two items', () => {
    const p = garage();
    const bench = builtinObject('workbench');
    const shelf = builtinObject('shelving');
    p.definitions = [bench, shelf];
    // A shelf unit in the middle leaves a 20" slot to the west wall; the bench sits behind it (north).
    p.scenarios[0]!.objects = [
      placeObject(bench, { x: inches(40), y: bench.depth / 2, rotation: 0 }, { id: 'bench' }),
      placeObject(shelf, { x: inches(130), y: inches(120), rotation: 0 }, { id: 'shelf', width: inches(220) }),
    ];
    const r = metric(p, 'walkway-min-width');
    expect(r.value!).toBeLessThan(inches(24));
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'walkway');
    expect(w.some((x) => /Main path from garage entry to workbench narrows to .* beside the shelving unit/i.test(x.message))).toBe(true);
  });

  it('wall storage share counts storage against walls', () => {
    const p = garage();
    const cab = builtinObject('base-cabinet');
    p.definitions = [cab];
    p.scenarios[0]!.objects = [placeObject(cab, { x: inches(120), y: cab.depth / 2, rotation: 0 })];
    const usable = inches(240 * 4 - 192);
    expect(metric(p, 'wall-storage').value).toBeCloseTo((inches(36) / usable) * 100, 1);
  });
});

describe('relative weighted summary', () => {
  it('is 0–100, explained per metric, and respects weights', () => {
    const p = createDemoProject();
    const rows = layoutMetrics(p, p.scenarios.map((s) => s.id));
    const scores = relativeScores(rows, {});
    for (const s of scores) {
      expect(s.score).not.toBeNull();
      expect(s.score!).toBeGreaterThanOrEqual(0);
      expect(s.score!).toBeLessThanOrEqual(100);
      expect(s.contributions.length).toBe(rows[0]!.metrics.length);
    }
    // Only weighting open floor: the layout with more open floor scores 100.
    const only = Object.fromEntries(rows[0]!.metrics.map((m) => [m.metric.id, m.metric.id === 'open-floor-area' ? 3 : 0]));
    const s2 = relativeScores(rows, only);
    const open = rows.map((r) => r.metrics.find((m) => m.metric.id === 'open-floor-area')!.result.value!);
    const bestIdx = open[0]! > open[1]! ? 0 : 1;
    expect(s2[bestIdx]!.score).toBeCloseTo(100, 6);
    expect(s2[1 - bestIdx]!.score).toBeCloseTo(0, 6);
  });
});
