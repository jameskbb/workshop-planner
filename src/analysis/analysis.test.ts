import { describe, expect, it } from 'vitest';
import { analyzeLayout, computeMetrics, getAnalyzer, listAnalyzers, listMetrics, openWarnings, registerAnalyzer } from './index';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import type { Project } from '@/domain/schema';
import { builtinObject, createVehicle } from '@/features/objects/library';
import { createDemoProject } from '@/features/projects/demo';

const IN = inches;

/** 20' x 16' garage with the given objects in the single scenario. */
function garage(objects: ReturnType<typeof placeObject>[], extra: (p: Project) => void = () => {}): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(240), IN(192)) });
  const defs = new Map(objects.map((o) => [o.definitionId, builtinObject(o.definitionId)]));
  p.definitions = [...defs.values()];
  p.scenarios[0]!.objects = objects;
  extra(p);
  return p;
}

const saw = builtinObject('table-saw');
const bench = builtinObject('workbench');
const cab = builtinObject('wall-cabinet');

describe('clearance analyzer', () => {
  it('reports "Table saw outfeed clearance intersects the East wall by 18""', () => {
    // Saw faces west (rotation 90): outfeed runs east. Back edge 78" from the east wall.
    const backX = IN(240 - 78);
    const p = garage([placeObject(saw, { x: backX - saw.depth / 2, y: IN(96), rotation: 90 }, { id: 'saw' })]);
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'clearance');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toBe('Table saw outfeed clearance intersects the East wall by 18".');
    expect(w[0]!.data).toMatchObject({ zone: 'outfeed', against: { kind: 'wall', name: 'East wall' } });
    expect(w[0]!.quantities.find((q) => q.name === 'depth')!.value).toBeCloseTo(457.2, 6);
    expect(w[0]!.involved.map((r) => r.kind)).toEqual(['object', 'wall']);
    expect(w[0]!.id).toBe(`clearance:saw:${saw.clearances.find((z) => z.kind === 'outfeed')!.id}:wall:${p.room.walls[1]!.id}`);
  });

  it('metric formatting follows project units', () => {
    const backX = IN(240 - 78);
    const p = garage([placeObject(saw, { x: backX - saw.depth / 2, y: IN(96), rotation: 90 }, { id: 'saw' })]);
    p.settings = { ...p.settings, unitSystem: 'metric' };
    expect(analyzeLayout(p)[0]!.message).toBe('Table saw outfeed clearance intersects the East wall by 457 mm.');
  });

  it('a workbench blocking part of the outfeed is quantified along the zone', () => {
    // Saw faces south (rotation 0): outfeed runs north. Bench placed 60" behind the saw's back edge.
    const sawObj = placeObject(saw, { x: IN(120), y: IN(170), rotation: 0 }, { id: 'saw' });
    const backY = IN(170) - saw.depth / 2;
    const benchObj = placeObject(bench, { x: IN(120), y: backY - IN(60) - bench.depth / 2, rotation: 0 }, { id: 'bench' });
    const p = garage([sawObj, benchObj]);
    const w = analyzeLayout(p).find((x) => x.id.includes('object:bench'))!;
    expect(w.message).toBe(`Workbench blocks 3' 0" of the Table saw's outfeed clearance (5' 0" of 8' 0" clear).`);
    expect(w.quantities.find((q) => q.name === 'clear')!.value).toBeCloseTo(IN(60), 6);
  });

  it('rotated objects: zones rotate with the object', () => {
    // Same bench/saw arrangement rotated by 30° about the saw: still exactly 36" blocked.
    const center = { x: IN(120), y: IN(100) };
    const rot = 30;
    const rad = (rot * Math.PI) / 180;
    const off = -(saw.depth / 2 + IN(60) + bench.depth / 2);
    const benchCenter = { x: center.x - Math.sin(rad) * off, y: center.y + Math.cos(rad) * off };
    const p = garage([
      placeObject(saw, { ...center, rotation: rot }, { id: 'saw' }),
      placeObject(bench, { ...benchCenter, rotation: rot }, { id: 'bench' }),
    ]);
    const w = analyzeLayout(p, undefined, { analyzers: ['clearance'] }).find((x) => x.id.includes('object:bench'))!;
    expect(w.quantities.find((q) => q.name === 'depth')!.value).toBeCloseTo(IN(36), 3);
  });

  it('wall cabinets above a bench do not block anything', () => {
    const p = garage([
      placeObject(bench, { x: IN(120), y: IN(15), rotation: 0 }, { id: 'bench' }),
      placeObject(cab, { x: IN(120), y: IN(6), rotation: 0 }, { id: 'cab' }),
    ]);
    expect(analyzeLayout(p)).toEqual([]);
  });

  it('mobile tools are checked for clearance at their working position', () => {
    const planer = builtinObject('planer');
    const parked = placeObject(planer, { x: IN(12), y: IN(12), rotation: 0 }, { id: 'planer', working: { x: IN(120), y: IN(96), rotation: 0 } });
    const p = garage([parked]);
    // Parked in the corner its zones would hit walls, but it is used in the middle, where it is clear.
    expect(analyzeLayout(p).filter((w) => w.analyzerId === 'clearance')).toEqual([]);
    // Evaluating at the parked position explicitly does show the conflicts.
    expect(analyzeLayout(p, undefined, { positions: 'parked' }).length).toBeGreaterThan(0);
  });
});

describe('overlap and bounds analyzers', () => {
  it('physical overlap with depth', () => {
    const p = garage([
      placeObject(bench, { x: IN(60), y: IN(60), rotation: 0 }, { id: 'a' }),
      placeObject(bench, { x: IN(60 + 70), y: IN(60), rotation: 0 }, { id: 'b' }),
    ]);
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'overlap');
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe('critical');
    expect(w[0]!.id).toBe('overlap:a+b');
    expect(w[0]!.message).toBe('Workbench overlaps Workbench by 2". They cannot both occupy this space.');
  });

  it('elevated items only collide when heights overlap', () => {
    const low = placeObject(cab, { x: IN(60), y: IN(6), rotation: 0 }, { id: 'low', elevation: IN(20) });
    const p = garage([placeObject(bench, { x: IN(60), y: IN(15), rotation: 0 }, { id: 'bench' }), low]);
    expect(analyzeLayout(p).some((w) => w.analyzerId === 'overlap')).toBe(true);
  });

  it('objects vs vehicles and floor architecture', () => {
    const p = garage([placeObject(bench, { x: IN(60), y: IN(100), rotation: 0 }, { id: 'bench' })], (proj) => {
      proj.scenarios[0]!.vehicles = [createVehicle('sedan', { x: IN(60), y: IN(96), rotation: 180 }, { id: 'car' })];
      proj.architecture = [
        {
          id: 'pole',
          kind: 'support-pole',
          name: 'Support pole',
          placement: { type: 'free', x: IN(30), y: IN(100), rotation: 0 },
          width: IN(4),
          depth: IN(4),
          height: IN(108),
          elevation: 0,
          shape: 'round',
          locked: true,
          hidden: false,
          notes: '',
        },
      ];
    });
    const ids = analyzeLayout(p)
      .filter((w) => w.analyzerId === 'overlap')
      .map((w) => w.id)
      .sort();
    expect(ids).toEqual(['overlap:bench+car', 'overlap:bench+pole', 'overlap:car+pole']);
  });

  it('extends past a wall, and completely outside', () => {
    const p = garage([
      // Rotated 90°, the bench's 30" depth runs east–west: x ∈ [10 − 15, 10 + 15] → 5" past the west wall.
      placeObject(bench, { x: IN(10), y: IN(100), rotation: 90 }, { id: 'bench' }),
      placeObject(bench, { x: IN(400), y: IN(100), rotation: 0 }, { id: 'far' }),
    ]);
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'bounds');
    expect(w.map((x) => x.id).sort()).toEqual([`bounds:bench:${p.room.walls[3]!.id}`, 'bounds:far:outside']);
    const past = w.find((x) => x.id.startsWith('bounds:bench'))!;
    expect(past.message).toBe('Workbench extends 5" past the West wall. Something this size will not fit here.');
    expect(w.find((x) => x.id === 'bounds:far:outside')!.message).toBe('Workbench is completely outside the room outline.');
  });

  it('hidden objects are ignored by default', () => {
    const p = garage([
      placeObject(bench, { x: IN(60), y: IN(60), rotation: 0 }, { id: 'a' }),
      placeObject(bench, { x: IN(100), y: IN(60), rotation: 0 }, { id: 'b', hidden: true }),
    ]);
    expect(analyzeLayout(p).some((w) => w.analyzerId === 'overlap')).toBe(false);
    expect(analyzeLayout(p, undefined, { includeHidden: true }).some((w) => w.analyzerId === 'overlap')).toBe(true);
  });
});

describe('acknowledgment, registry and robustness', () => {
  it('acknowledged warnings keep their id and carry the status', () => {
    const p = garage([
      placeObject(bench, { x: IN(60), y: IN(60), rotation: 0 }, { id: 'a' }),
      placeObject(bench, { x: IN(100), y: IN(60), rotation: 0 }, { id: 'b' }),
    ]);
    p.scenarios[0]!.acknowledgedWarnings = { 'overlap:a+b': { status: 'ignored', at: '2026-01-01T00:00:00Z' } };
    const w = analyzeLayout(p).find((x) => x.id === 'overlap:a+b')!;
    expect(w.acknowledged).toBe('ignored');
    expect(openWarnings(analyzeLayout(p)).some((x) => x.id === 'overlap:a+b')).toBe(false);
  });

  it('warning ids are stable across moves', () => {
    const make = (dx: number) =>
      garage([
        placeObject(bench, { x: IN(60), y: IN(60), rotation: 0 }, { id: 'a' }),
        placeObject(bench, { x: IN(100 + dx), y: IN(60), rotation: 0 }, { id: 'b' }),
      ]);
    expect(analyzeLayout(make(0)).map((w) => w.id)).toEqual(analyzeLayout(make(5)).map((w) => w.id));
  });

  it('core analyzers and metrics are registered', () => {
    expect(listAnalyzers().map((a) => a.id)).toEqual(expect.arrayContaining(['overlap', 'bounds', 'clearance']));
    expect(listMetrics().map((m) => m.id)).toEqual(expect.arrayContaining(['collisions', 'clearance-conflicts', 'open-floor-area']));
    expect(getAnalyzer('overlap')!.category).toBe('collision');
  });

  it('a throwing analyzer does not break the others', () => {
    const off = registerAnalyzer({ id: 'boom', label: 'Boom', description: '', category: 'misc', run: () => { throw new Error('x'); } });
    const p = garage([placeObject(bench, { x: IN(-100), y: IN(60), rotation: 0 }, { id: 'a' })]);
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      expect(analyzeLayout(p).length).toBeGreaterThan(0);
    } finally {
      console.error = orig;
      off();
    }
    expect(errors.length).toBe(1);
    expect(listAnalyzers().some((a) => a.id === 'boom')).toBe(false);
  });

  it('an empty project analyzes cleanly', () => {
    const p = createProject({ name: 'Empty' });
    expect(analyzeLayout(p)).toEqual([]);
    expect(computeMetrics(p).find((m) => m.metric.id === 'open-floor-area')!.result.value).toBeNull();
  });
});

describe('demo project', () => {
  const demo = createDemoProject();
  it('warns about meaningful problems in the car + workshop layout', () => {
    const w = analyzeLayout(demo, demo.scenarios[0]!.id);
    const msgs = w.map((x) => x.message);
    expect(msgs).toContain('Table saw outfeed clearance intersects the East wall (south) by 7 1/2".');
    expect(msgs.some((m) => m.startsWith("6' Workbench blocks") && m.includes("Table saw's outfeed"))).toBe(true);
    expect(msgs.some((m) => m.startsWith('Sedan blocks') && m.includes('Rolling tool cabinet'))).toBe(true);
    expect(msgs.some((m) => m.includes('Mobile planer') && m.includes('working position'))).toBe(true);
    expect(w.some((x) => x.severity === 'critical')).toBe(false);
  });
  it('workshop mode reflects states and positions (wings open hit the water heater)', () => {
    const w = analyzeLayout(demo, demo.scenarios[1]!.id);
    expect(w.some((x) => x.id.startsWith('overlap:') && x.message.includes('Water heater'))).toBe(true);
    expect(w.some((x) => x.message.startsWith('Sedan'))).toBe(false);
  });
  it('metrics compute for both scenarios', () => {
    for (const s of demo.scenarios) {
      const m = computeMetrics(demo, s.id);
      const open = m.find((x) => x.metric.id === 'open-floor-area')!.result;
      expect(open.value).toBeGreaterThan(0);
      expect(open.explanation).toMatch(/Room/);
    }
  });
});
