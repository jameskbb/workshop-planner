import { describe, expect, it } from 'vitest';
import { analyzeLayout, buildAnalysisContext } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { feet, inches } from '@/domain/units';
import type { DuctRun, PlacedObject, Project } from '@/domain/schema';
import { builtinObject } from '@/features/objects/library';
import { BEND_EQUIVALENT_PER_90, dustRoutes, FLEX_FACTOR } from './network';

const IN = inches;
const collector = builtinObject('dust-collector');
const saw = builtinObject('table-saw');

function shop(objects: PlacedObject[], runs: DuctRun[]): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(480), IN(240)) });
  p.definitions = [collector, saw];
  p.scenarios[0]!.objects = objects;
  p.scenarios[0]!.dust.runs = runs;
  return p;
}

// Collector at the west, inlet on its front (+y local, rotation 0 → south). Saw east, port on its back.
const dc = placeObject(collector, { x: IN(40), y: IN(40), rotation: 0 }, { id: 'dc' });
const ts = placeObject(saw, { x: IN(300), y: IN(150), rotation: 0 }, { id: 'saw' });
const inlet = { x: IN(40), y: IN(40) + collector.dustPort!.y };
const port = { x: IN(300), y: IN(150) + saw.dustPort!.y };

describe('dust network', () => {
  it('measures duct + flex, bends and equivalent length along a connected route', () => {
    const corner = { x: port.x, y: inlet.y };
    const p = shop([dc, ts], [
      { id: 'main', kind: 'rigid', diameter: IN(4), points: [inlet, corner, { x: port.x, y: port.y - IN(12) }] },
      { id: 'hose', kind: 'flex', diameter: IN(4), points: [{ x: port.x, y: port.y - IN(12) }, port] },
    ]);
    const [r] = dustRoutes(buildAnalysisContext(p));
    expect(r!.connected).toBe(true);
    expect(r!.collector!.objectId).toBe('dc');
    const rigid = port.x - inlet.x + (port.y - IN(12) - inlet.y);
    expect(r!.rigid).toBeCloseTo(rigid, 3);
    expect(r!.flex).toBeCloseTo(IN(12), 3);
    expect(r!.bends).toBe(1);
    expect(r!.bendDegrees).toBeCloseTo(90, 3);
    expect(r!.equivalent).toBeCloseTo(rigid + IN(12) * FLEX_FACTOR + BEND_EQUIVALENT_PER_90, 3);
  });

  it('joins a branch landing mid-duct (wye) and flags an over-long run', () => {
    const far = { x: IN(460), y: inlet.y };
    const p = shop([dc, placeObject(saw, { x: IN(430), y: IN(150), rotation: 0 }, { id: 'saw' })], [
      { id: 'main', kind: 'rigid', diameter: IN(4), points: [inlet, far] },
      { id: 'drop', kind: 'flex', diameter: IN(4), points: [{ x: IN(430), y: inlet.y }, { x: IN(430), y: IN(150) + saw.dustPort!.y }] },
    ]);
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'dust-routing');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/^The Table saw's dust run is about .+ equivalent \(.+ of duct, .+ of flex hose, 1 bend\): past the 35' 0" that suits a typical hobby collector/);
    expect(w[0]!.quantities.find((q) => q.name === 'rigid')!.value).toBeCloseTo(IN(430) - inlet.x, 3);
  });

  it('an unconnected tool gets a note with the direct hose distance', () => {
    const p = shop([dc, ts], [{ id: 'stub', kind: 'rigid', diameter: IN(4), points: [inlet, { x: IN(100), y: inlet.y }] }]);
    const w = analyzeLayout(p).filter((x) => x.analyzerId === 'dust-routing');
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe('info');
    expect(w[0]!.message).toContain("isn't connected to a run; a direct hose to the Dust collector would be about");
    expect(feet(1)).toBeGreaterThan(0);
  });

  it('stays quiet until a run exists', () => {
    expect(analyzeLayout(shop([dc, ts], [])).filter((x) => x.analyzerId === 'dust-routing')).toEqual([]);
  });
});
