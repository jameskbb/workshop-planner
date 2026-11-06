import { describe, expect, it } from 'vitest';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import { BUILTIN_OBJECTS, builtinObject } from '@/features/objects/library';
import { fitSearch, freeAreaIn, itemsThatFit } from './search';

function room() {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(120), inches(96)) });
  const cab = builtinObject('base-cabinet'); // 36 x 24 x 36
  const wall = builtinObject('wall-cabinet');
  p.definitions = [cab, wall];
  // North wall: a 36" base cabinet in the NW corner, leaving 84" free on the north wall.
  p.scenarios[0]!.objects = [placeObject(cab, { x: inches(18), y: inches(12), rotation: 0 }, { id: 'cab' })];
  return p;
}

describe('Will It Fit?', () => {
  it('reports free wall runs with available length and corners with remaining margin', () => {
    const locs = fitSearch(room(), undefined, { width: inches(48), depth: inches(24), height: inches(36) });
    const north = locs.find((l) => l.location === 'North wall');
    expect(north?.available).toBeCloseTo(inches(84), 0);
    const corner = locs.find((l) => l.kind === 'corner' && /northeast/i.test(l.location));
    expect(corner?.remaining).toBeCloseTo(inches(36), 0);
    for (const l of locs) expect(l.footprint).toHaveLength(4);
  });
  it('is height-aware: fits under wall cabinets, not a tall unit', () => {
    const p = room();
    const wall = builtinObject('wall-cabinet');
    p.scenarios[0]!.objects.push(placeObject(wall, { x: inches(80), y: wall.depth / 2, rotation: 0 }, { id: 'wc', elevation: inches(54), mount: 'wall' }));
    const low = fitSearch(p, undefined, { width: inches(80), depth: inches(24), height: inches(36), includeFloor: false, allowRotation: false });
    expect(low.some((l) => l.location === 'North wall')).toBe(true);
    const tall = fitSearch(p, undefined, { width: inches(80), depth: inches(24), height: inches(80), includeFloor: false, allowRotation: false });
    expect(tall.some((l) => l.location === 'North wall')).toBe(false);
  });
  it('front clearance reduces the options', () => {
    const a = fitSearch(room(), undefined, { width: inches(48), depth: inches(24), height: inches(36), includeFloor: false });
    const b = fitSearch(room(), undefined, { width: inches(48), depth: inches(24), height: inches(36), clearance: inches(80), includeFloor: false });
    expect(b.length).toBeLessThan(a.length);
  });
});

describe('What could fit here?', () => {
  it('finds the free area in a region and matching library items', () => {
    const p = room();
    const area = freeAreaIn(p, undefined, { minX: inches(40), minY: 0, maxX: inches(82), maxY: inches(28) })!;
    expect(area.width).toBeGreaterThan(inches(41));
    expect(area.width).toBeLessThanOrEqual(inches(42) + 0.01);
    expect(area.depth).toBeGreaterThan(inches(27));
    const items = itemsThatFit(p, undefined, area, BUILTIN_OBJECTS);
    expect(items.length).toBeGreaterThan(3);
    for (const it of items) {
      const w = it.rotated ? it.definition.depth : it.definition.width;
      const d = it.rotated ? it.definition.width : it.definition.depth;
      expect(w).toBeLessThanOrEqual(area.width + 1);
      expect(d).toBeLessThanOrEqual(area.depth + 1);
    }
    expect(items.some((i) => i.definition.id === 'builtin:planer')).toBe(true);
  });
  it('returns null for a region fully covered', () => {
    expect(freeAreaIn(room(), undefined, { minX: inches(2), minY: inches(2), maxX: inches(30), maxY: inches(20) })).toBeNull();
  });
});
