import { describe, expect, it } from 'vitest';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { formatLength, inches } from '@/domain/units';
import { BUILTIN_OBJECTS, builtinObject } from '@/features/objects/library';
import { createDemoProject } from '@/features/projects/demo';
import { offsetForAlong, stackingOpportunities, verticalSpaceAbove, wallElevation } from './model';

const IN = inches;
const fmt = (mm: number) => formatLength(mm);

describe('wall elevation', () => {
  it('demo east wall: bench, wall cabinets, outlets and the window with exact heights', () => {
    const p = createDemoProject();
    const east = p.room.walls[3]!;
    const el = wallElevation(p, east.id)!;
    expect(el.name).toMatch(/^East wall/);
    const bench = el.items.find((i) => i.name === "6' Workbench")!;
    expect(bench.bottom).toBe(0);
    expect(bench.top).toBeCloseTo(IN(36), 3);
    expect(bench.end - bench.start).toBeCloseTo(IN(72), 3);
    const cab = el.items.find((i) => i.name === 'Wall cabinet (north)')!;
    expect(cab.bottom).toBeCloseTo(IN(54), 3);
    expect(cab.mount).toBe('wall');
    expect(el.items.some((i) => i.kind === 'electrical' && i.name === '240V saw circuit')).toBe(true);
    expect(el.items.some((i) => i.kind === 'opening' && i.name === 'Side window')).toBe(true);
    // Facing east from inside, north (smaller y) is on the LEFT: the north cabinet is left of the south one.
    const cabS = el.items.find((i) => i.name === 'Wall cabinet (south)')!;
    expect(cab.start).toBeLessThan(cabS.start);
    // u → placement offset round trip for a wall-hosted outlet.
    const outlet = p.electrical.find((e) => e.label === '240V saw circuit')!;
    const it = el.items.find((i) => i.ref.id === outlet.id)!;
    expect(offsetForAlong(el, (it.start + it.end) / 2)).toBeCloseTo((outlet.placement as { offset: number }).offset, 3);
  });

  it('suggests wall storage above a bench with nothing above it', () => {
    const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(240), IN(192)) });
    const bench = builtinObject('workbench');
    p.definitions = [bench];
    p.room.ceilingHeight = IN(108);
    // Bench against the north wall (back to the wall, front facing south).
    p.scenarios[0]!.objects = [placeObject(bench, { x: IN(120), y: bench.depth / 2, rotation: 0 }, { id: 'bench' })];
    const el = wallElevation(p, p.room.walls[0]!.id)!;
    const ops = stackingOpportunities(el, BUILTIN_OBJECTS, fmt);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.available).toBeCloseTo(IN(72), 3);
    expect(ops[0]!.message).toMatch(/can fit above the Workbench: 6' 0" clear above it with an 18" work gap\.$/);
    expect(ops[0]!.suggestion!.mount).toBe('wall');
    const v = verticalSpaceAbove(p, 'bench')!;
    expect(v.available).toBeCloseTo(IN(72), 3);
    expect(v.limitName).toBe('the ceiling');
  });

  it('a wall cabinet above the bench limits the vertical space', () => {
    const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(240), IN(192)) });
    const bench = builtinObject('workbench');
    const cab = builtinObject('wall-cabinet');
    p.definitions = [bench, cab];
    p.scenarios[0]!.objects = [
      placeObject(bench, { x: IN(120), y: bench.depth / 2, rotation: 0 }, { id: 'bench' }),
      placeObject(cab, { x: IN(120), y: cab.depth / 2, rotation: 0 }, { id: 'cab', elevation: IN(54), mount: 'wall' }),
    ];
    const v = verticalSpaceAbove(p, 'bench')!;
    expect(v.available).toBeCloseTo(IN(18), 3);
    expect(v.limitName).toBe('Wall cabinet');
    expect(stackingOpportunities(wallElevation(p, p.room.walls[0]!.id)!, BUILTIN_OBJECTS, fmt)).toEqual([]);
  });
});
