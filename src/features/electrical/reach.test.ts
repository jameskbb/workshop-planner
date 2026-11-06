import { describe, expect, it } from 'vitest';
import { analyzeLayout } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { feet, inches } from '@/domain/units';
import type { ElectricalPoint, Project } from '@/domain/schema';
import { builtinObject } from '@/features/objects/library';
import { electricalPrefs } from './reach';

const IN = inches;
const planer = builtinObject('planer');

function outlet(p: Project, kind: ElectricalPoint['kind'], offset: number, extra: Partial<ElectricalPoint> = {}): ElectricalPoint {
  return {
    id: `${kind}-${offset}`, kind, label: `${kind} outlet`, placement: { type: 'wall', wallId: p.room.walls[0]!.id, offset },
    elevation: IN(16), width: 70, height: 115, voltage: kind === 'outlet-240' ? 240 : 120, amperage: 20, gfci: false, dedicated: false, locked: false, hidden: false, notes: '', ...extra,
  };
}

function shop(x: number, outlets: (p: Project) => ElectricalPoint[]): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(480), IN(240)) });
  p.definitions = [planer];
  p.scenarios[0]!.objects = [placeObject(planer, { x, y: IN(40), rotation: 0 }, { id: 'planer' })];
  p.electrical = outlets(p);
  return p;
}

const run = (p: Project) => analyzeLayout(p, undefined, { analyzers: ['outlet-distance'] });

describe('outlet distance', () => {
  it('quiet without outlets, quiet when close, warns past the threshold', () => {
    expect(run(shop(IN(100), () => []))).toEqual([]);
    const near = shop(IN(100), (p) => [outlet(p, 'outlet-120', IN(100))]);
    // Planer front/back along y; the outlet is on the north wall straight above it.
    expect(run(near)).toEqual([]);
    const far = shop(IN(400), (p) => [outlet(p, 'outlet-120', IN(100))]);
    const w = run(far);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/^The Planer \(120 V 15 A\) is .+ from the nearest 120 V outlet \(outlet-120 outlet\), more than the 8' 0" you set\.$/);
    far.extensions[electricalPrefs.key] = { maxDistance: feet(40) };
    expect(run({ ...far })).toEqual([]);
  });

  it('voltage must match; amperage is checked', () => {
    const only240 = shop(IN(100), (p) => [outlet(p, 'outlet-240', IN(100))]);
    expect(run(only240)[0]!.message).toBe('There is no 120 V outlet in the garage for the Planer (120 V 15 A).');
    const weak = shop(IN(100), (p) => [outlet(p, 'outlet-120', IN(100), { amperage: 10 })]);
    expect(run(weak)[0]!.message).toMatch(/^The 120 V outlets are rated below the Planer's 15 A/);
  });
});
