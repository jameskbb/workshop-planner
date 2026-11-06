import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '@/domain/schema';
import { roomTemplate, templateDefaults } from '@/domain/roomTemplates';
import { featureFootprint } from '@/domain/resolve';
import { polygonContainsPolygon } from '@/geometry';
import { feetInches } from '@/domain/units';
import { addDefaultDoor, buildWizardProject, defaultDoorFor, validateAnswers, VEHICLE_WALL_GAP, type WizardAnswers } from './wizardBuild';
import { analyzeLayout } from '@/analysis';
import { vehicleGeomSpec } from '@/domain/resolve';
import { vehicleBody } from '@/geometry';

const t = roomTemplate('two-car');
const built = t.build(templateDefaults(t, 'imperial'));
const base: WizardAnswers = {
  name: 'Test',
  unitSystem: 'imperial',
  points: built.points,
  ceilingHeight: feetInches(9, 0),
  wallThickness: 139.7,
  doors: built.openings.map((o) => ({ wallIndex: o.wallIndex, offset: o.offset, width: o.width, height: feetInches(7, 0) })),
  obstructions: ['support-pole', 'water-heater', 'panel', 'hvac', 'stairs', 'ceiling-beam'],
  vehicle: { templateId: 'sedan', name: '2024 Subaru WRX' },
};

describe('wizard project builder', () => {
  it('produces a schema-valid project with doors, obstructions and a named vehicle', () => {
    const p = buildWizardProject(base);
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.room.vertices).toHaveLength(4);
    expect(p.architecture.filter((f) => f.kind === 'garage-door')).toHaveLength(1);
    expect(p.electrical.map((e) => e.kind)).toEqual(['panel']);
    expect(p.scenarios[0]!.vehicles[0]!.name).toBe('2024 Subaru WRX');
    // Every floor obstruction sits inside the room.
    for (const f of p.architecture.filter((x) => x.kind !== 'garage-door' && x.kind !== 'ceiling-beam')) {
      expect(polygonContainsPolygon(p.room.vertices, featureFootprint(p.room, f), 1)).toBe(true);
    }
  });

  it('parks the vehicle facing into the garage from the door', () => {
    const p = buildWizardProject(base);
    const v = p.scenarios[0]!.vehicles[0]!;
    // Door on the south wall ⇒ nose north (rotation 180).
    expect(v.rotation).toBe(180);
    expect(v.y).toBeLessThan(built.points[2]!.y);
  });

  // R-007: the parked vehicle must be inside the room, whatever the garage's depth.
  it('parks the vehicle inside the room even in a shallow garage', () => {
    for (const depthFt of [14, 16, 18, 20, 24, 30]) {
      const points = [
        { x: 0, y: 0 },
        { x: feetInches(22, 0), y: 0 },
        { x: feetInches(22, 0), y: feetInches(depthFt, 0) },
        { x: 0, y: feetInches(depthFt, 0) },
      ];
      const p = buildWizardProject({
        ...base,
        points,
        doors: [{ wallIndex: 2, offset: feetInches(11, 0), width: feetInches(16, 0), height: feetInches(7, 0) }],
        obstructions: [],
      });
      const v = p.scenarios[0]!.vehicles[0]!;
      const depth = feetInches(depthFt, 0);
      const body = vehicleBody(vehicleGeomSpec(v), { x: v.x, y: v.y, rotation: v.rotation });
      const ys = body.map((q) => q.y);
      const boundsWarnings = analyzeLayout(p).filter((w) => w.category === 'bounds' && w.involved.some((r) => r.kind === 'vehicle'));
      if (depth >= v.length) {
        // It fits: it is parked entirely inside the room and nothing warns.
        expect(Math.min(...ys), `${depthFt} ft deep: nose is through the far wall`).toBeGreaterThan(-1);
        expect(Math.max(...ys), `${depthFt} ft deep: tail is through the door wall`).toBeLessThan(depth + 1);
        expect(boundsWarnings, `${depthFt} ft deep`).toEqual([]);
      } else {
        // It cannot fit at all: it is centered (not driven through one wall) and the check says so.
        expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - depth / 2)).toBeLessThan(2);
        expect(boundsWarnings.length).toBeGreaterThan(0);
      }
      // Deep enough garages keep a real gap at both ends.
      if (depth > v.length + 2 * VEHICLE_WALL_GAP) {
        expect(Math.min(...ys)).toBeGreaterThan(VEHICLE_WALL_GAP - 1);
        expect(Math.max(...ys)).toBeLessThan(depth - VEHICLE_WALL_GAP + 1);
      }
    }
  });

  // R-008: a second garage door must not land exactly on the first one.
  it('puts each extra garage door on free wall, and refuses overlapping ones', () => {
    const width = feetInches(9, 0);
    const height = feetInches(7, 0);
    const first = defaultDoorFor(built.points, width, height)!;
    const second = defaultDoorFor(built.points, width, height, [first])!;
    expect(second.wallIndex === first.wallIndex && Math.abs(second.offset - first.offset) < 1).toBe(false);
    expect(validateAnswers({ ...base, doors: [first, second] })).toBeNull();
    const p = buildWizardProject({ ...base, doors: [first, second] });
    expect(p.architecture.filter((f) => f.kind === 'garage-door')).toHaveLength(2);
    // Two identical doors are refused with a sentence that says what to do.
    expect(validateAnswers({ ...base, doors: [first, { ...first }] })).toMatch(/overlap/i);
  });

  it('validates doors and outlines', () => {
    expect(validateAnswers({ ...base, name: ' ' })).toMatch(/name/);
    expect(validateAnswers({ ...base, doors: [{ wallIndex: 2, offset: 100, width: 5000, height: 2000 }] })).toMatch(/doesn't fit/);
    expect(validateAnswers(base)).toBeNull();
    expect(defaultDoorFor(built.points, feetInches(9, 0), feetInches(7, 0))!.wallIndex).toBe(2);
  });

  it('start blank gives an empty outline in the chosen units', () => {
    const p = buildWizardProject({ ...base, unitSystem: 'metric', points: [], doors: [], obstructions: [], vehicle: null });
    expect(p.room.vertices).toHaveLength(0);
    expect(p.settings.unitSystem).toBe('metric');
    expect(p.settings.gridSize).toBe(100);
  });
});

// Final review: the wizard must never create an overlap of its own, and "Add a garage door" on a
// front wall wide enough for two doors keeps both doors on the front wall.
describe('wizard placements never collide', () => {
  it('keeps the support pole (and attic ladder) out of the parked car', () => {
    for (const depthFt of [18, 20, 24]) {
      const width = feetInches(22, 0);
      const depth = feetInches(depthFt, 0);
      const points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: depth },
        { x: 0, y: depth },
      ];
      const door = defaultDoorFor(points, feetInches(9, 0), feetInches(7, 0))!;
      const p = buildWizardProject({
        ...base,
        points,
        doors: [door],
        obstructions: ['support-pole', 'attic-ladder', 'water-heater'],
      });
      const critical = analyzeLayout(p).filter((w) => w.severity === 'critical');
      expect(
        critical.map((w) => w.message),
        `${depthFt} ft deep`,
      ).toEqual([]);
      const pole = p.architecture.find((f) => f.kind === 'support-pole')!;
      expect(polygonContainsPolygon(p.room.vertices, featureFootprint(p.room, pole), 1)).toBe(true);
    }
  });

  it('packs two 9 ft doors side by side on a 22 ft front wall', () => {
    const width = feetInches(22, 0);
    const points = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: feetInches(20, 0) },
      { x: 0, y: feetInches(20, 0) },
    ];
    const w = feetInches(9, 0);
    const h = feetInches(7, 0);
    const one = addDefaultDoor(points, w, h, []);
    expect(one).toHaveLength(1);
    expect(one[0]!.offset).toBeCloseTo(width / 2, 3);
    const two = addDefaultDoor(points, w, h, one);
    expect(two).toHaveLength(2);
    expect(two.every((d) => d.wallIndex === one[0]!.wallIndex)).toBe(true);
    expect(validateAnswers({ ...base, points, doors: two })).toBeNull();
    const [a, b] = [...two].sort((x, y) => x.offset - y.offset);
    // Evenly spaced: equal reveals at both ends and between the doors.
    const reveal = (width - 2 * w) / 3;
    expect(a!.offset - w / 2).toBeCloseTo(reveal, 3);
    expect(b!.offset - w / 2 - (a!.offset + w / 2)).toBeCloseTo(reveal, 3);
    expect(width - (b!.offset + w / 2)).toBeCloseTo(reveal, 3);
    // A third 9 ft door cannot fit on the front wall: it goes to another wall, nothing else moves.
    const three = addDefaultDoor(points, w, h, two);
    expect(three).toHaveLength(3);
    expect(three.slice(0, 2)).toEqual(two);
    expect(three[2]!.wallIndex).not.toBe(one[0]!.wallIndex);
  });
});
