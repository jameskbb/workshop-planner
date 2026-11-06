import { describe, expect, it } from 'vitest';
import { buildAnalysisContext } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import { builtinObject } from '@/features/objects/library';
import { workflowChains } from '@/features/workflow/model';
import { spaceReport, wallReports } from './model';

function p1() {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(120), inches(120)) });
  const cab = builtinObject('base-cabinet'); // 36 x 24 x 36
  const wall = builtinObject('wall-cabinet'); // 36 x 12 x 30 at 54"
  const saw = builtinObject('table-saw');
  p.definitions = [cab, wall, saw];
  p.scenarios[0]!.objects = [
    placeObject(cab, { x: inches(60), y: inches(12), rotation: 0 }, { id: 'cab' }),
    placeObject(wall, { x: inches(60), y: inches(6), rotation: 0 }, { id: 'wc', mount: 'wall', elevation: inches(54) }),
    placeObject(saw, { x: inches(60), y: inches(80), rotation: 0 }, { id: 'saw' }),
  ];
  p.scenarios[0]!.zones = [{ id: 'z', name: 'Shop', kind: 'woodworking', points: [{ x: 0, y: inches(60) }, { x: inches(120), y: inches(60) }, { x: inches(120), y: inches(120) }, { x: 0, y: inches(120) }], locked: false, hidden: false, notes: '' }];
  return p;
}

describe('space utilization', () => {
  it('counts floor footprints only (not wall-mounted items or clearances) with percentages', () => {
    const p = p1();
    const s = spaceReport(buildAnalysisContext(p));
    const saw = builtinObject('table-saw');
    expect(s.roomArea).toBeCloseTo(inches(120) ** 2, 0);
    expect(s.footprintArea).toBeCloseTo(inches(36) * inches(24) + saw.width * saw.depth, 0);
    expect(s.openArea + s.footprintArea + s.obstructionArea).toBeCloseTo(s.roomArea, 0);
    expect(s.zones[0]!.pct).toBeCloseTo(50, 6);
    expect(s.pct.open + s.pct.footprint).toBeCloseTo(100, 6);
  });
});

describe('wall utilization', () => {
  it('linear and vertical per wall', () => {
    const w = wallReports(buildAnalysisContext(p1()));
    const north = w.find((x) => x.linear.wallName === 'North wall')!;
    expect(north.linear.occupied).toBeCloseTo(inches(36), 0);
    expect(north.linear.available).toBeCloseTo(inches(84), 0);
    // Vertical: 36"×36" base + 36"×30" wall cabinet on a 120" × 108" wall.
    expect(north.vertical.covered).toBeCloseTo(inches(36) * inches(36) + inches(36) * inches(30), -2);
    expect(north.vertical.surface).toBeCloseTo(inches(120) * inches(108), -2);
    expect(north.items).toEqual(expect.arrayContaining(['Base cabinet', 'Wall cabinet']));
  });
});

describe('workflow chains', () => {
  it('orders steps and walks around obstacles', () => {
    const p = p1();
    p.scenarios[0]!.relationships = [
      { id: 'r2', fromId: 'saw', toId: 'cab', kind: 'workflow', chain: 'Cut', order: 1, frequency: 3 },
      { id: 'r1', fromId: 'cab', toId: 'saw', kind: 'workflow', chain: 'Cut', order: 0, frequency: 3 },
    ];
    const [c] = workflowChains(buildAnalysisContext(p));
    expect(c!.steps.map((s) => s.relationship.id)).toEqual(['r1', 'r2']);
    expect(c!.path).toEqual(['Base cabinet', 'Table saw', 'Base cabinet']);
    for (const s of c!.steps) {
      expect(s.walked).toBe(true);
      expect(s.distance).toBeGreaterThanOrEqual(s.straight - 1);
    }
    expect(c!.total).toBeCloseTo(c!.steps[0]!.distance + c!.steps[1]!.distance, 6);
  });
});
