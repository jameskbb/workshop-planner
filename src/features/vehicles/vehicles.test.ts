import { describe, expect, it } from 'vitest';
import { analyzeLayout, buildAnalysisContext } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { feetInches, inches } from '@/domain/units';
import type { PlacedObject, Project, Vehicle } from '@/domain/schema';
import { ARCHITECTURE_TEMPLATES, builtinObject, createVehicle } from '@/features/objects/library';
import { noseCompass } from './inspector';
import { simulateEntry } from './entry';
import { vehicleReport } from './report';

const IN = inches;

/** 24' wide × 24' deep garage, 16' garage door centered on the south wall. */
function garage(vehicle: Vehicle, objects: PlacedObject[] = []): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(288), IN(288)) });
  p.definitions = [...new Map(objects.map((o) => [o.definitionId, builtinObject(o.definitionId)])).values()];
  const t = ARCHITECTURE_TEMPLATES.find((x) => x.name === 'Garage door (16 ft)')!;
  p.architecture = [
    {
      id: 'gd',
      kind: 'garage-door',
      name: 'Garage door',
      placement: { type: 'wall', wallId: p.room.walls[2]!.id, offset: IN(144) },
      width: t.width,
      depth: t.depth,
      height: t.height,
      elevation: 0,
      shape: 'rect',
      garageDoor: { ...t.garageDoor!, kind: 'sectional', state: 'open' } as never,
      locked: true,
      hidden: false,
      notes: '',
    },
  ];
  p.scenarios[0]!.vehicles = [{ ...vehicle, entry: { openingFeatureId: 'gd', approachAngle: 0, approachDistance: 6000, direction: 'forward' } }];
  p.scenarios[0]!.objects = objects;
  return p;
}

// Sedan nose-north, centered in the garage, 30" from the north wall.
const sedan = () => createVehicle('sedan', { x: IN(144), y: IN(30 + 96.5), rotation: 180 }, { id: 'car', name: 'Sedan' });

describe('vehicle report', () => {
  it('a clear garage: every door opens, every side has its desired clearance, entry is feasible', () => {
    const p = garage(sedan());
    const ctx = buildAnalysisContext(p);
    const r = vehicleReport(ctx, ctx.vehicles[0]!.vehicle);
    expect(r.doors.every((d) => d.fullyOpens)).toBe(true);
    expect(r.sides.every((s) => s.ok)).toBe(true);
    expect(r.access.every((a) => a.ok)).toBe(true);
    const e = simulateEntry(ctx, ctx.vehicles[0]!.vehicle);
    if ('error' in e) throw new Error(e.error);
    expect(e.feasible).toBe(true);
    expect(e.summary).toMatch(/^The Sedan can pull in forward through the Garage door and reach its spot/);
    expect(analyzeLayout(p).filter((w) => w.category === 'vehicle')).toEqual([]);
  });

  it('a cabinet beside the driver door limits the door and the driver-side clearance', () => {
    const cab = builtinObject('tall-cabinet');
    const v = sedan();
    // Driver side (LHD, nose north) is the WEST side. Cabinet face 14" from the body.
    const bodyLeft = v.x - v.width / 2;
    const obj = placeObject(cab, { x: bodyLeft - IN(14) - cab.depth / 2, y: v.y, rotation: 90 }, { id: 'cab' });
    const p = garage(v, [obj]);
    const w = analyzeLayout(p).filter((x) => x.category === 'vehicle');
    const side = w.find((x) => x.id === 'vehicle-sides:car:driver')!;
    expect(side.quantities.find((q) => q.name === 'clear')!.value).toBeCloseTo(IN(14), 0);
    expect(side.message).toBe(`The Sedan has 14" on the driver side (you want 2' 6"); Tall cabinet is in the way.`);
    const door = w.find((x) => x.id === 'vehicle-doors:car:driver-front')!;
    expect(door.message).toMatch(/^The Sedan's driver door opens only \d+° \(.+ to get out\) before hitting Tall cabinet/);
    expect(door.involved).toEqual([{ kind: 'vehicle', id: 'car' }, { kind: 'object', id: 'cab' }]);
  });

  it('wall cabinets above door height do not block car doors', () => {
    const wc = builtinObject('wall-cabinet');
    const v = sedan();
    const obj = placeObject(wc, { x: v.x - v.width / 2 - IN(8), y: v.y, rotation: 90 }, { id: 'wc', elevation: IN(54) });
    const ctx = buildAnalysisContext(garage(v, [obj]));
    expect(vehicleReport(ctx, ctx.vehicles[0]!.vehicle).doors.every((d) => d.fullyOpens)).toBe(true);
  });

  it('trunk access is measured to the wall behind the car', () => {
    // Nose south, rear 20" from the north wall.
    const v = createVehicle('sedan', { x: IN(144), y: IN(20 + 96.5), rotation: 0 }, { id: 'car', name: 'Sedan' });
    const w = analyzeLayout(garage(v)).find((x) => x.id === 'vehicle-access:car:rear')!;
    expect(w.quantities[0]!.value).toBeCloseTo(IN(20), 0);
    expect(w.message).toBe(`The North wall leaves 20" behind the Sedan (2' 0" wanted to use the trunk).`);
  });

  it('entry is blocked by a pole in the door path, and the message names it', () => {
    const p = garage(sedan());
    p.architecture.push({
      id: 'pole',
      kind: 'support-pole',
      name: 'Support pole',
      placement: { type: 'free', x: IN(144), y: IN(230), rotation: 0 },
      width: IN(4),
      depth: IN(4),
      height: feetInches(9, 0),
      elevation: 0,
      shape: 'round',
      locked: true,
      hidden: false,
      notes: '',
    });
    const ctx = buildAnalysisContext(p);
    const e = simulateEntry(ctx, ctx.vehicles[0]!.vehicle);
    if ('error' in e) throw new Error(e.error);
    // The pole sits on the straight line to the spot; the planner must swerve or fail; either
    // way the maneuver never passes through the pole.
    if (e.feasible) expect(e.collisions.filter((c) => !c.envelopeOnly)).toEqual([]);
    else expect(e.summary).toContain('the Support pole');
  });
});

describe('heading compass', () => {
  it('names where the nose points (0° = nose south, clockwise)', () => {
    expect(noseCompass(0)).toBe('south');
    expect(noseCompass(180)).toBe('north');
    expect(noseCompass(90)).toBe('west');
    expect(noseCompass(270)).toBe('east');
    expect(noseCompass(-90)).toBe('east');
    expect(noseCompass(45)).toBe('southwest');
    expect(noseCompass(719)).toBe('south');
  });
});
