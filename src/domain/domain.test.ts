import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CURRENT_SCHEMA_VERSION,
  createProject,
  createScenario,
  defineExtension,
  duplicateScenario,
  FILE_FORMAT,
  migrateRaw,
  parseProject,
  parseProjectJson,
  placeObject,
  ObjectDefinitionSchema,
  ProjectSchema,
  projectFileName,
  rectangleRoomPoints,
  resolveObject,
  roomGeometry,
  serializeProject,
  featureFootprint,
  resolvePlacement,
  electricalPosition,
  vehicleGeomSpec,
  verticalOverlap,
  inches,
  type Project,
} from './index';
import { BUILTIN_OBJECTS, builtinObject, createVehicle, LIBRARY_GROUPS, searchLibrary, VEHICLE_TEMPLATES, ARCHITECTURE_TEMPLATES } from '@/features/objects/library';
import { createDemoProject, DEMO_PROJECT_NAME } from '@/features/projects/demo';
import { area, bbox } from '@/geometry';

function roundTrip(p: Project): Project {
  const r = parseProjectJson(serializeProject(p));
  if (!r.ok) throw new Error(r.error + r.details.join('\n'));
  return r.project;
}

describe('project serialization', () => {
  it('round-trips a new project exactly', () => {
    const p = createProject({ name: 'Garage', roomPoints: rectangleRoomPoints(6000, 5000) });
    expect(roundTrip(p)).toEqual(p);
  });

  it('round-trips the full demo project exactly', () => {
    const demo = createDemoProject();
    expect(roundTrip(demo)).toEqual(demo);
  });

  it('writes the file envelope and a friendly file name', () => {
    const p = createProject({ name: "Home Garage!" });
    const json = JSON.parse(serializeProject(p, '2026-01-01T00:00:00.000Z'));
    expect(json.format).toBe(FILE_FORMAT);
    expect(json.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(json.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(projectFileName(p)).toBe('home-garage.workshop.json');
    expect(projectFileName({ name: '!!!' })).toBe('project.workshop.json');
  });

  it('accepts a bare project object (no envelope)', () => {
    const p = createProject({ name: 'Bare' });
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.ok).toBe(true);
  });

  it('fills defaults for optional fields', () => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'Sparse' })));
    delete p.layers;
    delete p.savedViews;
    delete p.notes;
    delete p.scenarios[0].measurements;
    const r = parseProject(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.layers.storage).toEqual({ visible: true, locked: false });
      expect(r.project.scenarios[0]!.measurements).toEqual([]);
    }
  });
});

describe('friendly import errors', () => {
  it('invalid JSON', () => {
    const r = parseProjectJson('{ nope');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('The file is not valid JSON, so it cannot be a project file.');
      expect(r.details.length).toBe(1);
    }
  });
  it('empty file', () => {
    expect(parseProjectJson('   ')).toMatchObject({ ok: false, error: 'The file is empty.' });
  });
  it('not an object', () => {
    expect(parseProjectJson('[1,2]')).toMatchObject({ ok: false });
    expect(parseProjectJson('42')).toMatchObject({ ok: false });
  });
  it('some other JSON file', () => {
    const r = parseProjectJson('{"hello": "world"}');
    expect(r).toMatchObject({ ok: false, error: "This doesn't look like a Workshop Planner project file (no format version found)." });
  });
  it('wrong envelope format', () => {
    expect(parseProjectJson('{"format":"other","project":{}}')).toMatchObject({ ok: false, error: 'Unrecognized file format "other".' });
    expect(parseProjectJson(`{"format":"${FILE_FORMAT}"}`)).toMatchObject({ ok: false, error: 'The file is missing its "project" section.' });
  });
  it('newer schema version', () => {
    const p = { ...createProject({ name: 'Future' }), schemaVersion: 99 };
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version of Workshop Planner \(format v99/);
  });
  it('bad version value', () => {
    expect(parseProject({ schemaVersion: 'two' })).toMatchObject({ ok: false });
    expect(parseProject({ schemaVersion: 0 })).toMatchObject({ ok: false });
  });
  it('damaged content lists specific problems with paths', () => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'Broken', roomPoints: rectangleRoomPoints(1000, 1000) })));
    p.room.vertices[2].x = 'lots';
    p.name = '';
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('The project file is damaged or incomplete, so it was not imported. Nothing was changed.');
      expect(r.details.some((d) => d.startsWith('room.vertices[2].x:'))).toBe(true);
      expect(r.details.some((d) => d.startsWith('name:'))).toBe(true);
    }
  });
  it('mismatched walls and vertices are explained', () => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'Broken', roomPoints: rectangleRoomPoints(1000, 1000) })));
    p.room.walls.pop();
    const r = parseProject(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details.join()).toMatch(/4 corners but 3 walls/);
  });
  it('active scenario must exist', () => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'Broken' })));
    p.activeScenarioId = 'missing';
    const r = parseProject(p);
    expect(r.ok).toBe(false);
  });
});

// R-018: a project or library file must not be able to carry an arbitrary image string.
describe('custom object images', () => {
  const withImage = (image: unknown) => {
    const p = JSON.parse(JSON.stringify(createProject({ name: 'Img' })));
    p.definitions.push({ id: 'd', name: 'Thing', category: 'misc', width: 500, depth: 500, height: 500, image });
    return p;
  };
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('accepts an embedded image', () => {
    const r = parseProject(withImage(tiny));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.definitions.find((d) => d.id === 'd')!.image).toBe(tiny);
  });

  it('refuses remote URLs, scripts and huge strings at the schema boundary', () => {
    for (const bad of ['https://tracker.example/beacon.png', 'javascript:alert(1)', 'data:text/html;base64,PHN2Zz4=', `data:image/png;base64,${'A'.repeat(500_000)}`]) {
      expect(ObjectDefinitionSchema.safeParse({ id: 'd', name: 'T', category: 'misc', width: 1, depth: 1, height: 1, image: bad }).success, bad).toBe(false);
    }
  });

  it('imports a file with a bad image by leaving the picture out, and says so', () => {
    const r = parseProject(withImage('https://tracker.example/beacon.png'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.definitions.find((d) => d.id === 'd')!.image).toBeUndefined();
    expect(r.notes?.[0]).toMatch(/not embedded image data/);
  });
});

describe('schema migrations', () => {
  const v1 = {
    schemaVersion: 1,
    id: 'legacy-1',
    name: 'Old garage',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
    units: 'metric',
    settings: { gridSize: 100 },
    room: {
      vertices: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 5000, y: 0 },
        { id: 'c', x: 5000, y: 6000 },
      ],
      walls: [
        { id: 'w1', thickness: 140 },
        { id: 'w2', thickness: 140 },
        { id: 'w3', thickness: 140 },
      ],
      ceilingHeight: 2700,
    },
    definitions: [{ id: 'd', name: 'Bench', category: 'work-surface', width: 1800, depth: 750, height: 900 }],
    objects: [{ id: 'o', definitionId: 'd', name: 'Bench', x: 2000, y: 1000, rotation: 0, width: 1800, depth: 750, height: 900 }],
    vehicles: [],
    zones: [],
  };
  it('migrates v1 (pre-scenario) files forward', () => {
    const r = parseProject(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(1);
    expect(r.applied).toHaveLength(2); // v1→v2 (scenarios) and v2→v3 (finer length lattice)
    expect(r.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r.project.settings.unitSystem).toBe('metric');
    expect(r.project.settings.gridSize).toBe(100);
    expect(r.project.scenarios).toHaveLength(1);
    expect(r.project.scenarios[0]!.objects[0]!.name).toBe('Bench');
    expect(r.project.activeScenarioId).toBe(r.project.scenarios[0]!.id);
    expect(ProjectSchema.safeParse(r.project).success).toBe(true);
  });
  it('migration does not mutate the input', () => {
    const input = structuredClone(v1);
    migrateRaw(input);
    expect(input).toEqual(v1);
  });
  // R-013: files saved on the old 0.01 mm lattice open unchanged on the finer one.
  it('migrates v2 files onto the finer length lattice without moving anything', () => {
    const v2 = JSON.parse(JSON.stringify({ ...createProject({ name: 'Old', roomPoints: rectangleRoomPoints(6000, 4000) }), schemaVersion: 2 }));
    v2.scenarios[0].objects.push({ id: 'o', definitionId: 'd', name: 'Bench', x: 1000.12, y: 2000.99, rotation: 0, width: 1800, depth: 750, height: 900 });
    v2.definitions.push({ id: 'd', name: 'Bench', category: 'work-surface', width: 1800, depth: 750, height: 900 });
    const r = parseProject(v2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBe(2);
    expect(r.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const o = r.project.scenarios[0]!.objects[0]!;
    expect(o.x).toBe(1000.12);
    expect(o.y).toBe(2000.99);
    expect(r.project.room.vertices.map((v) => v.x)).toEqual(v2.room.vertices.map((v: { x: number }) => v.x));
  });
  it('current files need no migration', () => {
    const r = parseProject(JSON.parse(JSON.stringify(createProject({ name: 'Now' }))));
    expect(r.ok && r.migratedFrom).toBeUndefined();
  });
});

describe('factories & scenario duplication', () => {
  it('createProject is schema-valid', () => {
    expect(ProjectSchema.safeParse(createProject({ name: 'X' })).success).toBe(true);
    expect(ProjectSchema.safeParse(createProject({ name: 'X', roomPoints: rectangleRoomPoints(1, 1) })).success).toBe(true);
  });
  it('duplicateScenario deep-copies and keeps entity ids', () => {
    const s = createScenario('A');
    s.objects.push(placeObject(builtinObject('workbench'), { x: 1, y: 2, rotation: 0 }, { id: 'bench' }));
    const d = duplicateScenario(s, 'B');
    expect(d.id).not.toBe(s.id);
    expect(d.name).toBe('B');
    expect(d.objects[0]!.id).toBe('bench');
    expect(d.objects[0]).not.toBe(s.objects[0]);
    d.objects[0]!.x = 99;
    expect(s.objects[0]!.x).toBe(1);
  });
  it('placeObject copies dimensions and mount data', () => {
    const cab = placeObject(builtinObject('wall-cabinet'), { x: 0, y: 0, rotation: 0 });
    expect(cab.mount).toBe('wall');
    expect(cab.elevation).toBe(inches(54));
    expect(placeObject(builtinObject('planer'), { x: 0, y: 0, rotation: 0 }).mobility).toBe('mobile');
  });
});

describe('extensions', () => {
  const prefs = defineExtension('test.prefs', z.object({ paper: z.enum(['letter', 'a4']) }), { paper: 'letter' as const });
  it('reads defaults, validated values, and ignores garbage', () => {
    const p = createProject({ name: 'X' });
    expect(prefs.read(p)).toEqual({ paper: 'letter' });
    p.extensions['test.prefs'] = { paper: 'a4' };
    expect(prefs.read(p)).toEqual({ paper: 'a4' });
    p.extensions['test.prefs'] = { paper: 'tabloid' };
    expect(prefs.read(p)).toEqual({ paper: 'letter' });
    prefs.write(p, { paper: 'a4' });
    expect(p.extensions['test.prefs']).toEqual({ paper: 'a4' });
  });
  it('rejects badly named keys', () => {
    expect(() => defineExtension('Bad Key', z.string(), '')).toThrow();
  });
});

describe('resolve helpers', () => {
  const demo = createDemoProject();
  it('room geometry names walls, including the jog', () => {
    const g = roomGeometry(demo.room);
    expect(g.walls.map((w) => w.name)).toEqual([
      'North wall (west)',
      'East wall (north)',
      'North wall (east)',
      'East wall (south)',
      'Garage door wall',
      'West wall',
    ]);
    expect(roomGeometry(demo.room)).toBe(g); // memoized
  });
  it('resolves state footprints (miter station wings open)', () => {
    const workshop = demo.scenarios[1]!;
    const station = workshop.objects.find((o) => o.name === 'Miter saw station')!;
    const r = resolveObject(demo, station);
    expect(r.state?.name).toBe('Wings open');
    expect(r.footprint.width).toBeCloseTo(inches(144));
    expect(r.clearances.map((z) => z.kind)).toEqual(['operator', 'infeed', 'outfeed']);
    const folded = resolveObject(demo, demo.scenarios[0]!.objects.find((o) => o.name === 'Miter saw station')!);
    expect(folded.footprint.width).toBeCloseTo(inches(40));
  });
  it('resolves the working pose for mobile tools', () => {
    const planer = demo.scenarios[1]!.objects.find((o) => o.label === 'Mobile planer')!;
    const r = resolveObject(demo, planer);
    expect(r.pose).toEqual(planer.working);
    expect(resolveObject(demo, demo.scenarios[0]!.objects.find((o) => o.label === 'Mobile planer')!).pose.x).toBe(planer.x);
  });
  it('wall-hosted features resolve against their wall', () => {
    const door = demo.architecture.find((f) => f.kind === 'garage-door')!;
    const fp = featureFootprint(demo.room, door);
    const b = bbox(fp);
    expect(b.maxX - b.minX).toBeCloseTo(inches(192));
    expect(b.minY).toBeCloseTo(inches(288));
    const pole = demo.architecture.find((f) => f.kind === 'support-pole')!;
    // Round features are 24-gons: within ~1% of the true circle area.
    expect(area(featureFootprint(demo.room, pole)) / (Math.PI * inches(2) ** 2)).toBeGreaterThan(0.985);
    const panel = demo.electrical.find((e) => e.kind === 'panel')!;
    expect(electricalPosition(demo.room, panel).x).toBeCloseTo(inches(30));
    expect(resolvePlacement(demo.room, { type: 'wall', wallId: 'gone', offset: 0 }, 1, 1).wall).toBeUndefined();
  });
  it('vertical overlap', () => {
    const s = demo.scenarios[0]!;
    const bench = resolveObject(demo, s.objects.find((o) => o.definitionId === 'builtin:workbench')!);
    const cabinet = resolveObject(demo, s.objects.find((o) => o.definitionId === 'builtin:wall-cabinet')!);
    expect(verticalOverlap(bench, cabinet)).toBe(false);
  });
  it('vehicle geometry spec', () => {
    const v = demo.scenarios[0]!.vehicles[0]!;
    expect(vehicleGeomSpec(v).doors).toHaveLength(4);
  });
});

describe('library data', () => {
  it('covers every item the brief lists', () => {
    const names = BUILTIN_OBJECTS.map((d) => d.name.toLowerCase());
    const required = [
      'workbench', 'assembly table', 'mobile workbench', 'outfeed table', 'folding table', 'desk',
      'table saw', 'cabinet saw', 'contractor saw', 'miter saw', 'miter saw station', 'planer', 'jointer', 'bandsaw',
      'drill press', 'lathe', 'router table', 'spindle sander', 'belt/disc sander', 'cnc machine', 'laser cutter',
      'dust collector', 'air compressor',
      'base cabinet', 'wall cabinet', 'tall cabinet', 'rolling tool cabinet', 'shelving unit', 'metal shelving', 'lumber rack',
      'sheet goods rack', 'mobile tool cart', 'drawer cabinet', 'pegboard', 'french cleat wall', 'tote rack',
      'trash can', 'shop vacuum', 'step ladder', 'bicycle', 'lawn mower', 'pressure washer', 'generator', 'rolling toolbox',
      'refrigerator', 'chest freezer', 'clamp rack', 'wall shelf', 'tv', 'battery charger station', 'extension cord reel',
    ];
    for (const r of required) expect(names, r).toContain(r);
  });
  it('every definition is approximate, built-in, uniquely identified and has unique zone ids', () => {
    const ids = new Set<string>();
    for (const d of BUILTIN_OBJECTS) {
      expect(d.approximate).toBe(true);
      expect(d.source).toBe('builtin');
      expect(d.notes).toMatch(/Approximate/);
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      const zoneIds = d.clearances.map((z) => z.id);
      expect(new Set(zoneIds).size).toBe(zoneIds.length);
      if (d.defaultStateId) expect(d.states.some((s) => s.id === d.defaultStateId)).toBe(true);
    }
  });
  it('the table saw matches the brief example', () => {
    const saw = builtinObject('table-saw');
    expect(saw.width).toBeCloseTo(inches(44));
    expect(saw.depth).toBeCloseTo(inches(27));
    const zone = (k: string) => saw.clearances.find((z) => z.kind === k)!.shape;
    expect(zone('operator')).toMatchObject({ type: 'side', side: 'front', depth: inches(36) });
    expect(zone('infeed')).toMatchObject({ depth: inches(96) });
    expect(zone('outfeed')).toMatchObject({ side: 'back', depth: inches(96) });
    expect(zone('side')).toMatchObject({ depth: inches(24) });
  });
  it('electrical requirements follow the brief examples', () => {
    expect(builtinObject('planer').electrical).toMatchObject({ voltage: 120, amperage: 15 });
    expect(builtinObject('dust-collector').electrical).toMatchObject({ voltage: 240, amperage: 20 });
  });
  it('states exist where the brief expects them', () => {
    expect(builtinObject('miter-saw-station').states.map((s) => s.id)).toEqual(['wings-folded', 'wings-open']);
    expect(builtinObject('folding-table').states.map((s) => s.id)).toEqual(['deployed', 'folded']);
  });
  it('library groups cover every item exactly once', () => {
    for (const d of BUILTIN_OBJECTS) expect(LIBRARY_GROUPS.filter((g) => g.filter(d)).length, d.id).toBe(1);
  });
  it('search', () => {
    expect(searchLibrary(BUILTIN_OBJECTS, 'saw').length).toBeGreaterThan(4);
    expect(searchLibrary(BUILTIN_OBJECTS, 'roll cab').map((d) => d.id)).toEqual(['builtin:rolling-cabinet']);
    expect(searchLibrary(BUILTIN_OBJECTS, '').length).toBe(BUILTIN_OBJECTS.length);
    expect(() => builtinObject('nope')).toThrow();
  });
  it('seven vehicle templates produce valid vehicles', () => {
    expect(VEHICLE_TEMPLATES.map((v) => v.id)).toEqual(['compact-car', 'sedan', 'sports-car', 'midsize-suv', 'full-size-suv', 'pickup-truck', 'crew-cab-pickup']);
    for (const t of VEHICLE_TEMPLATES) {
      const v = createVehicle(t.id, { x: 0, y: 0, rotation: 0 });
      expect(v.length).toBeGreaterThan(v.wheelbase + v.frontOverhang);
      expect(v.mirrorWidth).toBeGreaterThan(v.width);
      expect(v.doors.length === 2 || v.doors.length === 4).toBe(true);
    }
    expect(() => createVehicle('tank', { x: 0, y: 0, rotation: 0 })).toThrow();
  });
  it('architecture templates cover every brief feature', () => {
    const kinds = new Set(ARCHITECTURE_TEMPLATES.map((t) => t.kind));
    for (const k of ['door', 'double-door', 'garage-door', 'window', 'support-pole', 'column', 'stairs', 'steps', 'utility-closet', 'water-heater', 'hvac', 'attic-ladder', 'permanent-shelving', 'sink', 'hose-bib', 'wall-protrusion', 'ceiling-obstruction', 'built-in-cabinet', 'worktop'] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
  });
});

describe('demo project', () => {
  const demo = createDemoProject();
  it('is schema-valid with two scenarios and an irregular room', () => {
    expect(ProjectSchema.safeParse(demo).success).toBe(true);
    expect(demo.name).toBe(DEMO_PROJECT_NAME);
    expect(demo.scenarios.map((s) => s.name)).toEqual(['Car + Workshop', 'Workshop mode']);
    expect(demo.room.vertices).toHaveLength(6);
  });
  it('contains every item the brief lists for the demo', () => {
    const s = demo.scenarios[0]!;
    const defs = new Set(s.objects.map((o) => o.definitionId));
    for (const id of ['workbench', 'wall-cabinet', 'miter-saw-station', 'planer', 'table-saw', 'shop-vacuum', 'mobile-tool-cart', 'mobile-shelving']) {
      expect(defs.has(`builtin:${id}`), id).toBe(true);
    }
    expect(s.objects.filter((o) => o.definitionId === 'builtin:wall-cabinet')).toHaveLength(2);
    const kinds = new Set(demo.architecture.map((f) => f.kind));
    for (const k of ['garage-door', 'door', 'support-pole'] as const) expect(kinds.has(k)).toBe(true);
    expect(demo.electrical.some((e) => e.kind === 'panel')).toBe(true);
    expect(demo.electrical.filter((e) => e.kind.startsWith('outlet')).length).toBeGreaterThanOrEqual(4);
    expect(s.lights.length).toBeGreaterThanOrEqual(3);
    expect(s.vehicles).toHaveLength(1);
    expect(demo.scenarios[1]!.vehicles).toHaveLength(0);
  });
  it('scenarios share object identities', () => {
    const [a, b] = demo.scenarios;
    expect(a!.objects.map((o) => o.id)).toEqual(b!.objects.map((o) => o.id));
  });
});
