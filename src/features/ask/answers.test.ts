import { describe, expect, it } from 'vitest';
import '@/domain/commands';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { ArchitecturalFeatureSchema } from '@/domain/schema';
import { inches } from '@/domain/units';
import { builtinObject, createVehicle } from '@/features/objects/library';
import { createDemoProject } from '@/features/projects/demo';
import { ask } from './answers';
import { buildAnalysisContext } from '@/analysis';
import { outletDistances } from '@/features/scenarios/facts';
import { outletReach, suppliedVoltage } from '@/features/electrical/reach';

const demo = createDemoProject();
const a = (q: string, p = demo) => {
  const r = ask(q, p);
  if (!r.ok) throw new Error(`${q}: ${r.reason}`);
  return r.answer;
};

describe('Ask the Layout: brief questions on the demo', () => {
  it('What is the narrowest walkway?', () => {
    const x = a('What is the narrowest walkway?');
    expect(x.topic).toBe('walkway');
    expect(x.text).toMatch(/narrowest main walkway is .+ on the path from .+ beside /);
    expect(x.highlight.points).toHaveLength(1);
  });
  it('How much space is behind the car?', () => {
    const x = a('How much space is behind the car?');
    expect(x.topic).toBe('vehicle-space');
    expect(x.text).toMatch(/behind the Sedan/);
    expect(x.details).toHaveLength(4);
  });
  it('Can I open the driver door?', () => {
    const x = a('Can I open the driver door?');
    expect(x.topic).toBe('vehicle-door');
    expect(x.text).toMatch(/driver door/);
  });
  it('Which tools have clearance conflicts?', () => {
    const x = a('Which tools have clearance conflicts?');
    expect(x.topic).toBe('clearance');
    expect(x.text).toMatch(/have clearance conflicts|has clearance conflicts/);
  });
  it('How much open floor area do I have?', () => {
    const x = a('How much open floor area do I have?');
    expect(x.text).toMatch(/sq ft of open floor/);
  });
  it('Which tool is farthest from an outlet?', () => {
    expect(a('Which tool is farthest from an outlet?').topic).toBe('electrical');
  });
  it('How many feet of wall are unused?', () => {
    expect(a('How many feet of wall are unused?').text).toMatch(/feet of wall/);
  });
  it('Could a 48 x 24 cabinet fit anywhere along the west wall?', () => {
    const x = a('Could a 48 x 24 cabinet fit anywhere along the west wall?');
    expect(x.topic).toBe('fit');
    expect(x.text).toMatch(/^(Yes|No)/);
  });
  it('unknown questions get suggestions', () => {
    const r = ask('what is the meaning of life', demo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestions.length).toBeGreaterThan(3);
  });
});

// R-005: the brief's SAMPLE EXPERIENCE sentence and the two questions the review found unanswered.
describe('Ask the Layout: brief sample sentences', () => {
  it('Could I put a 48 x 24 cabinet anywhere else?', () => {
    const x = a('Could I put a 48 x 24 cabinet anywhere else?');
    expect(x.topic).toBe('fit');
    expect(x.text).toMatch(/^(Yes|No)/);
    expect(x.highlight.polygons.length).toBeGreaterThan(0);
  });
  it('how far is the table saw from the workbench', () => {
    const x = a('how far is the table saw from the workbench');
    expect(x.topic).toBe('distance');
    expect(x.text).toMatch(/Table saw is .+ from the .*Workbench/);
    expect(x.highlight.refs).toHaveLength(2);
    expect(x.highlight.lines).toHaveLength(1);
    expect(x.numbers.some((n) => n.label === 'Straight')).toBe(true);
  });
  it('where is the water heater', () => {
    const x = a('where is the water heater');
    expect(x.topic).toBe('locate');
    // The demo's heater stands free: distance to the nearest wall.
    expect(x.text).toMatch(/Water heater is .+ from the .+ wall/i);
    expect(x.highlight.refs[0]!.kind).toBe('feature');
  });
  it('where is a wall-hosted fixture: on its wall, with the offset along it', () => {
    const p = createProject({ name: 'W', roomPoints: rectangleRoomPoints(inches(240), inches(240)) });
    const wall = p.room.walls[1]!; // east wall
    p.architecture.push(
      ArchitecturalFeatureSchema.parse({ id: 'wh', kind: 'water-heater', name: 'Water heater', placement: { type: 'wall', wallId: wall.id, offset: inches(55) }, width: inches(22), depth: inches(22), height: inches(60), shape: 'round' }),
    );
    const x = a('where is the water heater', p);
    expect(x.topic).toBe('locate');
    expect(x.text).toBe('The Water heater is on the East wall, 4\' 7" along it from its start. It is selected on the plan.');
  });
});

// R-011: Ask and the electrical analyzer must name the SAME nearest outlet (one implementation).
describe('Ask the Layout: outlet answers match the electrical analyzer', () => {
  it('names the outlet the analyzer measures from', () => {
    const ctx = buildAnalysisContext(demo);
    const facts = outletDistances(ctx);
    const reach = outletReach(ctx);
    for (const f of facts) {
      const r = reach.find((x) => x.objectId === f.object.id)!;
      const option = r.best ?? r.underRated;
      expect(f.outlet?.id ?? null).toBe(option?.point.id ?? null);
      if (option) expect(f.distance).toBeCloseTo(option.distance, 6);
      // One voltage rule: a 120 V tool is never matched to a 240 V-only outlet.
      if (f.outlet) expect(suppliedVoltage(f.outlet)).toBe(f.requirement.voltage);
    }
  });
});

describe('Ask the Layout: exact numbers', () => {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(240), inches(240)) });
  const cab = builtinObject('base-cabinet');
  p.definitions = [cab];
  // Sedan parked nose-north (rotation 180) with its rear bumper 30" from the south wall.
  const car = createVehicle('sedan', { x: inches(80), y: 0, rotation: 180 });
  car.y = inches(240 - 30) - car.length / 2;
  p.scenarios[0]!.vehicles = [car];
  p.scenarios[0]!.objects = [placeObject(cab, { x: inches(200), y: cab.depth / 2, rotation: 0 }, { id: 'cab' })];

  it('space behind the car is measured to the wall', () => {
    const x = a('how much room is behind the car', p);
    expect(x.numbers[0]!.value).toBe('2\' 6"');
  });
  it('a 48 x 24 cabinet fits along the west wall of an empty stretch', () => {
    const x = a('Could a 48 x 24 cabinet fit anywhere along the east wall?', p);
    expect(x.text).toMatch(/^Yes/);
    expect(x.details[0]).toMatch(/East wall/);
  });
  it('a 300 x 24 cabinet does not fit', () => {
    expect(a('could a 300 x 24 cabinet fit along the north wall', p).text).toMatch(/^No/);
  });
});
