/**
 * The demo project: an irregular two-car garage (22' 8" × 24' with a 28" jog at the northeast
 * corner) holding every item the brief lists, arranged realistically in two layouts so the
 * analysis has something meaningful to say (a blocked outfeed, a car in the infeed path, a tool
 * cabinet too close to the driver's door, miter-station wings that hit the water heater…).
 */
import { createProject, createRoom, createScenario, placeObject } from '@/domain/factories';
import { inches, feetInches } from '@/domain/units';
import type { ArchitecturalFeature, ElectricalPoint, LightingFixture, ObjectDefinition, PlacedObject, Project, Scenario } from '@/domain/schema';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { ARCHITECTURE_TEMPLATES, builtinObject, createVehicle } from '@/features/objects/library';

const i = inches;

/** Interior corners in inches: north wall jogs 28" south for the last 48" before the east wall. */
const OUTLINE_IN: Array<[number, number]> = [
  [0, 0],
  [224, 0],
  [224, 28],
  [272, 28],
  [272, 288],
  [0, 288],
];

export const DEMO_PROJECT_NAME = 'Demo: Two-car garage workshop';

function arch(kind: ArchitecturalFeature['kind'], name: string, rest: Partial<ArchitecturalFeature> & Pick<ArchitecturalFeature, 'placement'>): ArchitecturalFeature {
  const tpl = ARCHITECTURE_TEMPLATES.find((t) => t.kind === kind)!;
  return {
    id: newId(),
    kind,
    name,
    width: tpl.width,
    depth: tpl.depth,
    height: tpl.height,
    elevation: tpl.elevation ?? 0,
    shape: tpl.shape ?? 'rect',
    locked: true,
    hidden: false,
    notes: '',
    ...(tpl.door ? { door: { swing: 'in', hinge: 'left', openAngle: 90, ...tpl.door } } : {}),
    ...(tpl.garageDoor ? { garageDoor: { kind: 'sectional', state: 'closed', ...tpl.garageDoor } } : {}),
    ...rest,
  } as ArchitecturalFeature;
}

function outlet(kind: ElectricalPoint['kind'], label: string, wallId: string, offsetIn: number, extra: Partial<ElectricalPoint> = {}): ElectricalPoint {
  return {
    id: newId(),
    kind,
    label,
    placement: { type: 'wall', wallId, offset: i(offsetIn) },
    elevation: i(kind === 'outlet-240' ? 24 : 16),
    width: 70,
    height: 115,
    voltage: kind === 'outlet-240' ? 240 : 120,
    amperage: kind === 'outlet-240' ? 20 : 15,
    gfci: kind === 'outlet-120',
    dedicated: kind === 'outlet-240',
    locked: false,
    hidden: false,
    notes: '',
    ...extra,
  };
}

function light(kind: LightingFixture['kind'], name: string, xIn: number, yIn: number, rotation = 0): LightingFixture {
  const shop = kind === 'shop-light';
  return {
    id: newId(),
    kind,
    name,
    x: i(xIn),
    y: i(yIn),
    rotation,
    length: i(shop ? 48 : 14),
    width: i(shop ? 3 : 14),
    elevation: i(105),
    lumens: shop ? 5000 : 3000,
    beamAngle: shop ? 120 : 140,
    locked: false,
    hidden: false,
    notes: '',
  };
}

function place(def: ObjectDefinition, xIn: number, yIn: number, rotation: number, extra: Partial<PlacedObject> = {}): PlacedObject {
  return placeObject(def, { x: i(xIn), y: i(yIn), rotation }, extra);
}

export function createDemoProject(): Project {
  const project = createProject({ name: DEMO_PROJECT_NAME, scenarioName: 'Car + Workshop' });
  const room = createRoom(
    OUTLINE_IN.map(([x, y]) => ({ x: i(x), y: i(y) })),
    { ceilingHeight: feetInches(9, 0), wallThickness: i(5.5) },
  );
  // Wall order follows the outline: 0 north (west part), 1 jog, 2 north (east part), 3 east, 4 south, 5 west.
  const [north, , , east, south, west] = room.walls;
  south!.name = 'Garage door wall';
  south!.thickness = i(7.25);
  project.room = room;
  project.description = 'An irregular two-car garage used as a woodworking shop. Explore both layouts and the warnings they raise.';

  project.architecture = [
    arch('garage-door', 'Garage door', { placement: { type: 'wall', wallId: south!.id, offset: i(136) } }),
    arch('door', 'Entry door', { placement: { type: 'wall', wallId: west!.id, offset: i(228) }, door: { swing: 'in', hinge: 'right', openAngle: 90 } }),
    arch('support-pole', 'Support pole', { placement: { type: 'free', x: i(118), y: i(150), rotation: 0 }, notes: '4" steel column under the beam.' }),
    arch('water-heater', 'Water heater', { placement: { type: 'free', x: i(200), y: i(14), rotation: 0 } }),
    arch('window', 'Side window', { placement: { type: 'wall', wallId: east!.id, offset: i(40) } }),
  ];

  project.electrical = [
    { ...outlet('panel', 'Main panel', north!.id, 30), elevation: i(48), width: i(14.5), height: i(30), voltage: 240, amperage: 100, gfci: false, dedicated: false },
    outlet('outlet-120', 'North outlet', north!.id, 100),
    outlet('outlet-120', 'Bench outlet (north)', east!.id, 110),
    outlet('outlet-240', '240V saw circuit', east!.id, 150, { circuit: '12' }),
    outlet('outlet-120', 'Bench outlet (south)', east!.id, 200),
    outlet('outlet-120', 'Door-side outlet', west!.id, 130),
    {
      ...outlet('ceiling-outlet', 'Opener outlet', north!.id, 0),
      placement: { type: 'free', x: i(136), y: i(200), rotation: 0 },
      elevation: feetInches(9, 0),
      gfci: false,
    },
  ];

  const defs = [
    'workbench',
    'wall-cabinet',
    'table-saw',
    'miter-saw-station',
    'planer',
    'mobile-tool-cart',
    'shop-vacuum',
    'mobile-shelving',
    'rolling-cabinet',
  ].map(builtinObject);
  project.definitions = defs.map((d) => structuredClone(d));
  const def = (id: string) => project.definitions.find((d) => d.id === `builtin:${id}`)!;

  const workbench = place(def('workbench'), 257, 186, 90, { label: "6' Workbench", locked: true });
  const cabinetA = place(def('wall-cabinet'), 266, 168, 90, { name: 'Wall cabinet (north)' });
  const cabinetB = place(def('wall-cabinet'), 266, 204, 90, { name: 'Wall cabinet (south)' });
  const saw = place(def('table-saw'), 170, 190, 90, { notes: 'Contractor-style saw on a mobile base.' });
  const miter = place(def('miter-saw-station'), 120, 12, 0, { name: 'Miter saw station' });
  const planer = place(def('planer'), 257, 50, 90, {
    label: 'Mobile planer',
    working: { x: i(150), y: i(105), rotation: 90 },
  });
  const cart = place(def('mobile-tool-cart'), 230, 130, 180, { name: 'Tool cart' });
  const vacuum = place(def('shop-vacuum'), 250, 262, 0);
  const shelving = place(def('mobile-shelving'), 60, 12, 0);
  const toolCabinet = place(def('rolling-cabinet'), 12, 170, 270, { label: 'Rolling tool cabinet (350 lb)' });

  // Parked 9" east and 8" south of dead centre in the bay: tight (the pole, the cabinet drawers and
  // the planer's infeed are the demo's teaching points) but it can still be driven in and the entry
  // door still opens.
  const sedan = createVehicle('sedan', { x: i(73), y: i(134.5), rotation: 180 }, { name: 'Sedan' });
  sedan.entry = { openingFeatureId: project.architecture[0]!.id, approachAngle: 0, approachDistance: 6000, direction: 'forward' };

  const t = nowIso();
  const lights = [
    light('shop-light', 'Shop light (front)', 200, 60, 90),
    light('shop-light', 'Shop light (middle)', 200, 150, 90),
    light('shop-light', 'Shop light (back)', 200, 240, 90),
    light('ceiling-fixture', 'Car bay light', 64, 130),
  ];

  const primary: Scenario = {
    ...project.scenarios[0]!,
    description: 'Daily layout: the sedan parks in the west bay; tools stay parked.',
    objects: [workbench, cabinetA, cabinetB, saw, miter, planer, cart, vacuum, shelving, toolCabinet],
    vehicles: [sedan],
    lights,
    zones: [
      {
        id: newId(),
        name: 'Parking',
        kind: 'parking',
        points: [
          { x: i(6), y: i(26) },
          { x: i(112), y: i(26) },
          { x: i(112), y: i(282) },
          { x: i(6), y: i(282) },
        ],
        locked: false,
        hidden: false,
        notes: '',
      },
      {
        id: newId(),
        name: 'Woodworking',
        kind: 'woodworking',
        points: [
          { x: i(128), y: i(40) },
          { x: i(242), y: i(40) },
          { x: i(242), y: i(240) },
          { x: i(128), y: i(240) },
        ],
        locked: false,
        hidden: false,
        notes: '',
      },
    ],
    measurements: [
      { id: newId(), kind: 'point', a: { x: 0, y: i(276) }, b: { x: i(272), y: i(276) }, label: 'Inside width at the door', offset: 0, hidden: false },
      { id: newId(), kind: 'object-object', a: { x: i(100.25), y: i(150) }, b: { x: i(116), y: i(150) }, label: 'Car → pole', offset: 0, hidden: false },
    ],
    relationships: [
      { id: newId(), fromId: miter.id, toId: saw.id, kind: 'workflow', chain: 'Crosscut → rip → assemble', order: 0, frequency: 4 },
      { id: newId(), fromId: saw.id, toId: workbench.id, kind: 'workflow', chain: 'Crosscut → rip → assemble', order: 1, frequency: 4 },
    ],
    updatedAt: t,
  };

  // Workshop mode: car out, planer rolled to its working spot, miter-station wings open.
   
  const { id: _id, name: _name, createdAt: _c, updatedAt: _u, ...arrangement } = structuredClone(primary);
  const workshop = createScenario('Workshop mode', {
    ...arrangement,
    description: 'Weekend layout: the car is in the driveway; mobile tools move to their working positions.',
  });
  workshop.vehicles = [];
  workshop.objects = workshop.objects.map((o) => {
    if (o.id === planer.id) return { ...o, activePosition: 'working' as const };
    if (o.id === miter.id) return { ...o, stateId: 'wings-open' };
    // With the car out, the shelving rolls into the empty bay so the station wings can open.
    if (o.id === shelving.id) return { ...o, x: i(12), y: i(250), rotation: 270 };
    return o;
  });

  project.scenarios = [primary, workshop];
  project.activeScenarioId = primary.id;
  project.settings = { ...project.settings, gridSize: i(6) };
  return project;
}
