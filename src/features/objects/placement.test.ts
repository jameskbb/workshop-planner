import { describe, expect, it } from 'vitest';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import { satConvex } from '@/geometry';
import { objectFootprint, resolveObject } from '@/domain/resolve';
import type { Project } from '@/domain/schema';
import { builtinObject } from './library';
import { findFreeSpotNear } from './placement';

function emptyRoom(): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(240), inches(200)) });
  p.definitions = [builtinObject('base-cabinet')];
  return p;
}

/** Add a cabinet at a point the way the library click does, then return the updated project. */
function add(p: Project, at: { x: number; y: number }): Project {
  const def = builtinObject('base-cabinet');
  p.scenarios[0]!.objects.push(placeObject(def, { x: at.x, y: at.y, rotation: 0 }));
  return p;
}

describe('findFreeSpotNear', () => {
  it('keeps the requested point when it is free', () => {
    const p = emptyRoom();
    const at = { x: inches(120), y: inches(100) };
    expect(findFreeSpotNear(p, undefined, { width: inches(36), depth: inches(24) }, at)).toEqual(at);
  });

  it('five clicks at the same point give five non-overlapping placements', () => {
    let p = emptyRoom();
    const center = { x: inches(120), y: inches(100) };
    const def = builtinObject('base-cabinet');
    for (let i = 0; i < 5; i++) {
      const spot = findFreeSpotNear(p, undefined, { width: def.width, depth: def.depth }, center);
      expect(spot).not.toBeNull();
      p = add(p, spot!);
    }
    const polys = p.scenarios[0]!.objects.map((o) => objectFootprint(resolveObject(p, o)));
    expect(polys).toHaveLength(5);
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const c = satConvex(polys[i]!, polys[j]!, 1);
        expect(c.colliding && c.depth > 1).toBe(false);
      }
    }
  });

  it('stays inside the room', () => {
    const p = emptyRoom();
    const spot = findFreeSpotNear(p, undefined, { width: inches(36), depth: inches(24) }, { x: inches(-500), y: inches(-500) });
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeGreaterThan(0);
    expect(spot!.y).toBeGreaterThan(0);
  });

  it('returns null when the item cannot fit in the room at all', () => {
    const p = emptyRoom();
    expect(findFreeSpotNear(p, undefined, { width: inches(600), depth: inches(600) }, { x: inches(120), y: inches(100) })).toBeNull();
  });
});
