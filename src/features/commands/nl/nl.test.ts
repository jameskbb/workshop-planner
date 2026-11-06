import { beforeEach, describe, expect, it } from 'vitest';
import '@/domain/commands';
import { getScenario, objectFootprint, resolveObject, roomGeometry } from '@/domain/resolve';
import { inches } from '@/domain/units';
import type { EntityRef, Project } from '@/domain/schema';
import { polygonContainsPolygon } from '@/geometry';
import { BUILTIN_OBJECTS, builtinObject, createVehicle } from '@/features/objects/library';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { createDemoProject } from '@/features/projects/demo';
import { loadProject, transact, undo, useProjectStore } from '@/stores/projectStore';
import { interpret, type NlResult } from './interpret';
import { findAngle, findLength, findLengths, normalize } from './text';
import { fromStructured } from './provider';

let seq = 0;
function demo(): Project {
  const p = createDemoProject();
  const s = p.scenarios[0]!;
  s.vehicles[0]!.name = '2024 Subaru WRX';
  return p;
}
const ctxFor = (project: Project, selection: EntityRef[] = []) => ({ project, selection, library: BUILTIN_OBJECTS, newId: () => `nl-${++seq}` });
const byName = (p: Project, name: string) => getScenario(p).objects.find((o) => o.name === name || o.label === name)!;
const run = (text: string, selection: EntityRef[] = []): NlResult => interpret(text, ctxFor(useProjectStore.getState().project!, selection));
function exec(r: NlResult): void {
  if (!r.ok || r.kind !== 'commands') throw new Error(`not commands: ${JSON.stringify(r)}`);
  const res = transact(r.label, r.commands);
  if (!res.ok) throw new Error(res.error);
}
const current = () => useProjectStore.getState().project!;

beforeEach(() => {
  seq = 0;
  loadProject(demo());
});

describe('text helpers', () => {
  it('normalizes quotes and politeness', () => {
    expect(normalize('Please  move the “bench” 2′ 6″ north!')).toBe('move the "bench" 2\' 6" north');
  });
  it('finds lengths in every spelling', () => {
    for (const t of ['30 inches', '30"', "2' 6\"", '2 ft 6 in', '2.5 ft', '762 mm', '76.2 cm', '30 in']) {
      expect(findLengths(`give it ${t} of room`)[0]?.value, t).toBeCloseTo(inches(30), 6);
    }
    expect(findLength('move it 12 north', 'in')!.value).toBeCloseTo(inches(12), 6);
  });
  it('finds angles', () => {
    expect(findAngle('rotate 90 degrees')!.value).toBe(90);
    expect(findAngle('turn it 45°'.replace('°', ' degrees'))!.value).toBe(45);
    expect(findAngle('turn the saw around')!.value).toBe(180);
  });
});

describe('brief examples', () => {
  it('Move the workbench against the north wall', () => {
    const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(inches(240), inches(192)) });
    const def = builtinObject('workbench');
    p.definitions = [def];
    p.scenarios[0]!.objects = [placeObject(def, { x: inches(150), y: inches(100), rotation: 90 }, { id: 'bench' })];
    loadProject(p);
    const r = run('Move the workbench against the north wall.');
    expect(r.ok && r.kind === 'commands').toBe(true);
    exec(r);
    const moved = getScenario(current()).objects[0]!;
    expect(moved.rotation).toBe(0);
    const fp = objectFootprint(resolveObject(current(), moved));
    expect(Math.min(...fp.map((q) => q.y))).toBeCloseTo(0.5, 0);
    expect(moved.x).toBeCloseTo(inches(150), 0);
    expect(polygonContainsPolygon(roomGeometry(current().room).polygon, fp, 1)).toBe(true);
    undo();
    expect(getScenario(current()).objects[0]!.x).toBe(inches(150));
    // Variants.
    for (const t of ['put the bench along the east wall', 'push the workbench up against the south wall', 'move it to the west wall']) {
      const v = interpret(t, ctxFor(current(), [{ kind: 'object', id: 'bench' }]));
      expect(v.ok, t).toBe(true);
    }
  });

  // R-006: "car"/"the vehicle" are vehicles, "everything" is everything, and a compass name that
  // matches several wall segments picks the longest free run.
  it('puts the car against a wall (vehicles are movable by name)', () => {
    const p = createProject({ name: 'Empty garage', roomPoints: rectangleRoomPoints(inches(288), inches(288)) });
    p.scenarios[0]!.vehicles = [{ ...createVehicle('sedan', { x: inches(144), y: inches(144), rotation: 0 }), id: 'car' }];
    loadProject(p);
    for (const text of ['put the car against the west wall', 'move the vehicle against the west wall', 'park the sedan against the west wall']) {
      loadProject(p);
      const r = interpret(text, ctxFor(current(), []));
      expect(r.ok, `${text}: ${r.ok ? '' : r.reason}`).toBe(true);
      if (!r.ok || r.kind !== 'commands') continue;
      expect(r.commands[0]!.type).toBe('vehicle.update');
      exec(r);
      const v = getScenario(current()).vehicles[0]!;
      // Parked alongside the west wall: nose north or south, body just inside the wall.
      expect([0, 180]).toContain(v.rotation);
      expect(v.x - v.mirrorWidth / 2).toBeLessThan(inches(6));
    }
  });

  it('moves everything at once and leaves locked items alone', () => {
    const before = getScenario(current()).objects.map((o) => ({ id: o.id, x: o.x, locked: o.locked }));
    const r = run('move everything 6 inches east');
    expect(r.ok).toBe(true);
    exec(r);
    const after = getScenario(current()).objects;
    let moved = 0;
    for (const b of before) {
      const a2 = after.find((o) => o.id === b.id)!;
      if (b.locked) expect(a2.x).toBe(b.x);
      else if (a2.x !== b.x) moved++;
    }
    expect(moved).toBeGreaterThan(3);
  });

  it('prefers the longest free run when several walls share a compass name', () => {
    // L-shaped room: a long north wall and a short north jog.
    const p = createProject({
      name: 'L',
      roomPoints: [
        { x: 0, y: 0 },
        { x: inches(240), y: 0 },
        { x: inches(240), y: inches(48) },
        { x: inches(288), y: inches(48) },
        { x: inches(288), y: inches(240) },
        { x: 0, y: inches(240) },
      ],
    });
    const def = builtinObject('workbench');
    p.definitions = [def];
    p.scenarios[0]!.objects = [placeObject(def, { x: inches(260), y: inches(150), rotation: 0 }, { id: 'bench' })];
    loadProject(p);
    const r = run('move the workbench against the north wall');
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'commands') expect(r.summary).toMatch(/North wall \(west\)/);
  });

  it('explains when a wall has no room', () => {
    exec(run('unlock the workbench'));
    const r = run('Move the workbench against the north wall');
    if (!r.ok) expect(r.reason).toMatch(/no free stretch|wide enough/);
  });

  it('refuses to move a locked item with an explanation', () => {
    const r = run('move the workbench against the north wall');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/locked/);
  });

  it('Give the WRX 30 inches of driver-side clearance', () => {
    for (const text of ['Give the WRX 30 inches of driver-side clearance.', "give the wrx 2' 6\" of driver side clearance", 'set the driver side clearance of the WRX to 30"', 'WRX driver-side clearance 762 mm']) {
      loadProject(demo());
      const r = run(text);
      expect(r.ok, text).toBe(true);
      exec(r);
      expect(getScenario(current()).vehicles[0]!.desiredClearance.driver, text).toBeCloseTo(inches(30), 6);
    }
    const r = run('give the wrx 24 inches of passenger side clearance');
    exec(r);
    expect(getScenario(current()).vehicles[0]!.desiredClearance.passenger).toBeCloseTo(inches(24), 6);
  });

  it('Rotate the cabinet 90 degrees (asks which cabinet, then rotates)', () => {
    const amb = run('Rotate the cabinet 90 degrees');
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.choices!.length).toBeGreaterThanOrEqual(2);
    const cab = byName(current(), 'Wall cabinet (north)');
    exec(run('Rotate the cabinet 90 degrees', [{ kind: 'object', id: cab.id }]));
    expect(byName(current(), 'Wall cabinet (north)').rotation).toBe((cab.rotation + 90) % 360);
    exec(run('rotate the north wall cabinet 90 degrees counterclockwise'));
    expect(byName(current(), 'Wall cabinet (north)').rotation).toBe(cab.rotation);
    exec(run('turn the table saw to 180'));
    expect(byName(current(), 'Table saw').rotation).toBe(180);
  });

  it('Put the planer next to the miter saw', () => {
    const r = run('Put the planer next to the miter saw.');
    expect(r.ok).toBe(true);
    exec(r);
    const planer = resolveObject(current(), byName(current(), 'Planer'));
    const miter = resolveObject(current(), byName(current(), 'Miter saw station'));
    expect(planer.parkedPose.rotation).toBe(miter.pose.rotation);
    const d = Math.hypot(planer.parkedPose.x - miter.pose.x, planer.parkedPose.y - miter.pose.y);
    expect(d).toBeLessThan(miter.footprint.width / 2 + planer.footprint.width / 2 + miter.footprint.depth + 100);
  });

  it('Show me everything interfering with the garage door', () => {
    const r = run('Show me everything interfering with the garage door');
    expect(r.ok && r.kind === 'action').toBe(true);
    if (r.ok && r.kind === 'action') {
      expect(r.summary).toMatch(/garage door/i);
      expect(r.actions.some((a) => a.type === 'select')).toBe(true);
    }
    const r2 = run("what's blocking the garage door");
    expect(r2.ok && r2.kind).toBe('action');
  });

  it('Hide the vehicle', () => {
    exec(run('Hide the vehicle.'));
    expect(getScenario(current()).vehicles[0]!.hidden).toBe(true);
    exec(run('show the car'));
    expect(getScenario(current()).vehicles[0]!.hidden).toBe(false);
  });

  it('Duplicate this cabinet', () => {
    const cab = byName(current(), 'Rolling cabinet') ?? byName(current(), 'Rolling tool cabinet (350 lb)');
    const n = getScenario(current()).objects.length;
    const none = run('Duplicate this cabinet');
    expect(none.ok).toBe(false);
    const r = run('Duplicate this cabinet', [{ kind: 'object', id: cab.id }]);
    exec(r);
    expect(getScenario(current()).objects.length).toBe(n + 1);
    undo();
    expect(getScenario(current()).objects.length).toBe(n);
  });
});

describe('variants', () => {
  it('moves by a distance in a compass direction', () => {
    const cart = byName(current(), 'Tool cart');
    exec(run('move the tool cart 12 inches west'));
    expect(byName(current(), 'Tool cart').x).toBeCloseTo(cart.x - inches(12), 2);
    exec(run('nudge the cart 1 ft north'));
    expect(byName(current(), 'Tool cart').y).toBeCloseTo(cart.y - inches(12), 2);
  });
  it('resizes', () => {
    exec(run('make the table saw 50 inches wide'));
    expect(byName(current(), 'Table saw').width).toBeCloseTo(inches(50), 2);
    exec(run('set the height of the table saw to 3 ft'));
    expect(byName(current(), 'Table saw').height).toBeCloseTo(inches(36), 2);
  });
  it('adds a library item against a wall', () => {
    const n = getScenario(current()).objects.length;
    const r = run('Add a drill press against the west wall');
    expect(r.ok).toBe(true);
    exec(r);
    expect(getScenario(current()).objects.length).toBe(n + 1);
  });
  it('locks, hides layers, deletes, switches layouts', () => {
    exec(run('lock the table saw'));
    expect(byName(current(), 'Table saw').locked).toBe(true);
    exec(run('hide the electrical layer'));
    expect(current().layers.electrical.visible).toBe(false);
    exec(run('delete the shop vacuum'));
    expect(getScenario(current()).objects.some((o) => o.name === 'Shop vacuum')).toBe(false);
    exec(run('switch to layout workshop mode'));
    expect(getScenario(current()).name).toBe('Workshop mode');
  });
  it('mobile positions and garage door state', () => {
    exec(run('roll the planer to its working position'));
    expect(byName(current(), 'Planer').activePosition).toBe('working');
    exec(run('open the garage door'));
    expect(current().architecture.find((f) => f.kind === 'garage-door')!.garageDoor!.state).toBe('open');
  });
  it('explains what it did not understand with suggestions', () => {
    const r = run('make me a sandwich');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestions.length).toBeGreaterThan(0);
    const r2 = run('hide the flux capacitor');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/couldn't find/);
  });
  it('structured provider output is validated', () => {
    expect(fromStructured({ commands: [{ type: 'object.move', payload: {} }] }).ok).toBe(false);
    const cab = byName(current(), 'Tool cart');
    expect(fromStructured({ summary: 'x', commands: [{ type: 'object.update', payload: { id: cab.id, patch: { hidden: true } } }] }).ok).toBe(true);
  });
});
