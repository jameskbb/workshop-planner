import { describe, expect, it } from 'vitest';
import { analyzeLayout } from '@/analysis';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { inches } from '@/domain/units';
import type { ArchitecturalFeature, ElectricalPoint, PlacedObject, Project } from '@/domain/schema';
import { ARCHITECTURE_TEMPLATES, builtinObject } from '@/features/objects/library';
import { safetyPrefs } from './prefs';
import { doorLeaves, garageDoorZones } from './zones';

const IN = inches;

/** 20' × 16' room; walls: 0 north, 1 east, 2 south, 3 west. */
function room(objects: PlacedObject[], extra: (p: Project) => void = () => {}): Project {
  const p = createProject({ name: 'T', roomPoints: rectangleRoomPoints(IN(240), IN(192)) });
  const defs = new Map(objects.map((o) => [o.definitionId, builtinObject(o.definitionId)]));
  p.definitions = [...defs.values()];
  p.scenarios[0]!.objects = objects;
  extra(p);
  return p;
}

function feature(kind: ArchitecturalFeature['kind'], placement: ArchitecturalFeature['placement'], over: Partial<ArchitecturalFeature> = {}): ArchitecturalFeature {
  const t = ARCHITECTURE_TEMPLATES.find((x) => x.kind === kind)!;
  return {
    id: over.id ?? kind,
    kind,
    name: t.name,
    placement,
    width: t.width,
    depth: t.depth,
    height: t.height,
    elevation: t.elevation ?? 0,
    shape: t.shape ?? 'rect',
    locked: true,
    hidden: false,
    notes: '',
    ...(t.door ? { door: { swing: 'in', hinge: 'left', openAngle: 90, ...t.door } } : {}),
    ...(t.garageDoor ? { garageDoor: { kind: 'sectional', state: 'closed', ...t.garageDoor } } : {}),
    ...over,
  } as ArchitecturalFeature;
}

const run = (p: Project, id: string) => analyzeLayout(p, undefined, { analyzers: [id] });
const cart = builtinObject('mobile-tool-cart');

describe('doorway analyzer', () => {
  it('reports how far a door opens before hitting an object', () => {
    const p = room([], (p) => {
      // Door on the north wall centered 60" from the NW corner; swings into the room.
      p.architecture = [feature('door', { type: 'wall', wallId: p.room.walls[0]!.id, offset: IN(60) })];
    });
    const leaves = doorLeaves(p.room, p.architecture[0]!);
    expect(leaves).toHaveLength(1);
    expect(Math.abs(leaves[0]!.sweep)).toBeCloseTo(90, 6);
    // A cart placed inside the swing.
    const hinge = leaves[0]!.hinge;
    const into = hinge.x < IN(60) ? 1 : -1;
    p.scenarios[0]!.objects = [placeObject(cart, { x: hinge.x + into * IN(28), y: IN(26), rotation: 0 }, { id: 'cart' })];
    p.definitions = [cart];
    const w = run(p, 'doorway');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/^Entry door opens only \d+° before hitting Tool cart|^Entry door opens only \d+° before hitting Mobile tool cart/);
    const angle = w[0]!.quantities.find((q) => q.name === 'angle')!.value;
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(90);
  });

  it('flags an object crowding the landing inside a door that swings out', () => {
    const p = room([placeObject(cart, { x: IN(60), y: IN(24), rotation: 0 }, { id: 'cart' })], (p) => {
      p.architecture = [feature('door', { type: 'wall', wallId: p.room.walls[0]!.id, offset: IN(60) }, { door: { swing: 'out', hinge: 'left', openAngle: 90 } })];
    });
    const w = run(p, 'doorway');
    expect(w).toHaveLength(1);
    expect(w[0]!.id).toBe('doorway:door:landing:cart');
    // Cart depth is along y; its back edge is 24" − depth/2 from the north wall.
    const clear = IN(24) - cart.depth / 2;
    expect(w[0]!.quantities[0]!.value).toBeCloseTo(clear, 3);
    expect(w[0]!.message).toContain('inside the Entry door');
  });
});

describe('garage-door analyzer', () => {
  const tall = builtinObject('lumber-rack'); // 96" tall

  function withGarage(objects: PlacedObject[], state: 'open' | 'closed', trackHeight = IN(80)) {
    return room(objects, (p) => {
      p.architecture = [
        feature('garage-door', { type: 'wall', wallId: p.room.walls[2]!.id, offset: IN(120) }, {
          id: 'gd',
          name: 'Garage door',
          garageDoor: { openingHeight: IN(84), trackLength: IN(102), trackHeight, kind: 'sectional', state },
        }),
      ];
    });
  }

  it('warns when a tall item stands under the tracks (closed door wording)', () => {
    const p = withGarage([placeObject(tall, { x: IN(120), y: IN(150), rotation: 0 }, { id: 'rack' })], 'closed');
    const w = run(p, 'garage-door');
    expect(w.map((x) => x.id)).toEqual(['garage-door:gd:band:rack']);
    expect(w[0]!.message).toBe(`Lumber rack (8' 0" tall) stands under the Garage door tracks (6' 8"); the door would hit it when opened.`);
  });

  it('open door wording, and no warning when the track is above the item', () => {
    const p = withGarage([placeObject(tall, { x: IN(120), y: IN(150), rotation: 0 }, { id: 'rack' })], 'open');
    expect(run(p, 'garage-door')[0]!.message).toBe(`The open Garage door hits Lumber rack: the door rests at 6' 8" and Lumber rack is 8' 0" tall here.`);
    const high = withGarage([placeObject(tall, { x: IN(120), y: IN(150), rotation: 0 }, { id: 'rack' })], 'open', IN(100));
    expect(run(high, 'garage-door')).toEqual([]);
  });

  it('an object in the opening strip blocks the door from closing', () => {
    const p = withGarage([placeObject(cart, { x: IN(120), y: IN(192 - 8), rotation: 0 }, { id: 'cart' })], 'closed');
    const w = run(p, 'garage-door').filter((x) => x.data?.zone === 'opening');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain('the door would come down on it');
    const z = garageDoorZones(p.room, p.architecture[0]!)!;
    expect(z.trackHeight).toBe(IN(80));
  });
});

describe('panel access analyzer', () => {
  it('measures the clear depth in front of the panel', () => {
    const panel: ElectricalPoint = {
      id: 'panel',
      kind: 'panel',
      label: 'Main panel',
      placement: { type: 'wall', wallId: '', offset: IN(60) },
      elevation: IN(48),
      width: IN(14.5),
      height: IN(30),
      voltage: 240,
      amperage: 100,
      gfci: false,
      dedicated: false,
      locked: false,
      hidden: false,
      notes: '',
    };
    // Cart's near face 20" from the north wall.
    const p = room([placeObject(cart, { x: IN(60), y: IN(20) + cart.depth / 2, rotation: 0 }, { id: 'cart' })], (p) => {
      p.electrical = [{ ...panel, placement: { type: 'wall', wallId: p.room.walls[0]!.id, offset: IN(60) } }];
    });
    const w = run(p, 'panel-access');
    expect(w).toHaveLength(1);
    expect(w[0]!.quantities.find((q) => q.name === 'clear')!.value).toBeCloseTo(IN(20), 3);
    expect(w[0]!.message).toBe(`Mobile tool cart is 20" in front of the Main panel; keep a 2' 6" × 3' 0" space clear so the panel can be reached and opened.`.replace('Mobile tool cart', cart.name));
  });
});

describe('hazard analyzer', () => {
  it('flags flammables near a water heater using the project threshold', () => {
    const mower = builtinObject('lawn-mower');
    const p = room([placeObject(mower, { x: IN(60), y: IN(100), rotation: 0 }, { id: 'mower' })], (p) => {
      p.architecture = [feature('water-heater', { type: 'free', x: IN(60 + 11 + 11 + 20), y: IN(100), rotation: 0 }, { id: 'wh', name: 'Water heater' })];
    });
    const w = run(p, 'hazard');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/^Lawn mower is 20" from the Water heater\. Keep flammables at least 3' 0" from hot appliances\.$/);
    // Relax the threshold → no warning.
    p.extensions[safetyPrefs.key] = { ...safetyPrefs.defaultValue, hotDistance: IN(12) };
    expect(run({ ...p }, 'hazard')).toEqual([]);
  });
  it('untagged items never raise hazard warnings', () => {
    expect(run(room([placeObject(cart, { x: IN(60), y: IN(100), rotation: 0 })]), 'hazard')).toEqual([]);
  });
});

describe('overhead analyzer', () => {
  it('reports beams, lights and the ceiling with quantities', () => {
    const rack = builtinObject('lumber-rack'); // wall-mounted: top = elevation + 100"
    const p = room([placeObject(rack, { x: IN(120), y: IN(100), rotation: 0 }, { id: 'rack', height: IN(100) })], (p) => {
      p.room.ceilingHeight = IN(96);
      p.architecture = [feature('ceiling-beam', { type: 'free', x: IN(120), y: IN(100), rotation: 0 }, { id: 'beam', name: 'Ceiling beam', elevation: IN(88) })];
      p.scenarios[0]!.lights = [{ id: 'l1', kind: 'shop-light', name: 'Shop light', x: IN(120), y: IN(100), rotation: 0, length: IN(48), width: IN(3), elevation: IN(92), lumens: 5000, beamAngle: 120, locked: false, hidden: false, notes: '' }];
    });
    const w = run(p, 'overhead');
    const msgs = w.map((x) => x.message);
    expect(msgs).toContain(`Lumber rack reaches 9' 4" but the ceiling is 8' 0" (16" too tall).`);
    expect(msgs).toContain(`Lumber rack (9' 4" tall) runs into the Ceiling beam, which hangs down to 7' 4" (2' 0" too tall).`);
    expect(msgs).toContain(`Lumber rack (9' 4" tall) would hit the Shop light, mounted at 7' 8".`);
    expect(w.find((x) => x.id === 'overhead:rack:ceiling')!.severity).toBe('critical');
  });
});
