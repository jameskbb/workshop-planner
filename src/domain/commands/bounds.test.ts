/**
 * R-003: numeric bounds and rotation normalization at the command boundary. Garbage (1e12 mm,
 * 0.001 mm wide, a rotation of 1e9°) must never reach the store, persistence or the analyzers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import '@/domain/commands';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { activeScenario } from '@/domain/resolve';
import { ObjectDefinitionSchema, ProjectSchema, VehicleSchema, type ObjectDefinition } from '@/domain/schema';
import { createVehicle } from '@/features/objects/library';
import { dispatch, loadProject, useProjectStore } from '@/stores/projectStore';
import { inches } from '@/domain/units';

const def: ObjectDefinition = ObjectDefinitionSchema.parse({
  id: 'cab',
  name: 'Cabinet',
  category: 'storage',
  width: inches(48),
  depth: inches(24),
  height: inches(72),
  source: 'builtin',
});

const scenario = () => activeScenario(useProjectStore.getState().project!);
const obj = () => scenario().objects[0]!;

beforeEach(() => {
  loadProject(createProject({ name: 'Bounds', roomPoints: rectangleRoomPoints(6000, 6000) }));
  dispatch({ type: 'object.add', payload: { objects: [placeObject(def, { x: 1000, y: 1000, rotation: 0 }, { id: 'o1' })], definitions: [def] } });
});

describe('numeric bounds', () => {
  it('refuses absurd positions', () => {
    const before = useProjectStore.getState().project;
    const r = dispatch({ type: 'object.update', payload: { id: 'o1', patch: { x: 1e12 } } });
    expect(r.ok).toBe(false);
    expect(useProjectStore.getState().project).toBe(before);
    expect(dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 1e12, y: 0 }] } }).ok).toBe(false);
    expect(obj().x).toBe(1000);
  });

  it('refuses sizes that are not a real object', () => {
    expect(dispatch({ type: 'object.update', payload: { id: 'o1', patch: { width: 0.001 } } }).ok).toBe(false);
    expect(dispatch({ type: 'object.update', payload: { id: 'o1', patch: { depth: 500_000 } } }).ok).toBe(false);
    expect(obj().width).toBe(inches(48));
    expect(useProjectStore.getState().lastError).toMatch(/invalid|Must be/i);
  });

  it('still accepts ordinary values', () => {
    expect(dispatch({ type: 'object.update', payload: { id: 'o1', patch: { width: inches(30), x: -2000 } } }).ok).toBe(true);
    expect(obj()).toMatchObject({ width: inches(30), x: -2000 });
  });

  it('rejects out-of-range values in project files', () => {
    const p = JSON.parse(JSON.stringify(useProjectStore.getState().project!));
    p.scenarios[0].objects[0].x = 1e12;
    expect(ProjectSchema.safeParse(p).success).toBe(false);
    p.scenarios[0].objects[0].x = 0;
    p.scenarios[0].objects[0].height = 0.0001;
    expect(ProjectSchema.safeParse(p).success).toBe(false);
  });
});

describe('rotation normalization', () => {
  it('refuses an absurd rotation and normalizes a merely large one', () => {
    expect(dispatch({ type: 'object.update', payload: { id: 'o1', patch: { rotation: 1e9 } } }).ok).toBe(false);
    expect(obj().rotation).toBe(0);
    expect(dispatch({ type: 'object.update', payload: { id: 'o1', patch: { rotation: 100_000 } } }).ok).toBe(true);
    const r = obj().rotation;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(360);
    expect(r).toBe(100_000 % 360);
  });

  it('normalizes negative and 360° rotations on move', () => {
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 1000, y: 1000, rotation: -450 }] } });
    expect(obj().rotation).toBe(270);
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 1000, y: 1000, rotation: 360 }] } });
    expect(obj().rotation).toBe(0);
  });

  it('normalizes and quantizes the working pose too', () => {
    dispatch({ type: 'object.update', payload: { id: 'o1', patch: { mobility: 'mobile' } } });
    dispatch({ type: 'object.move', payload: { position: 'working', moves: [{ id: 'o1', x: 1500.00000004, y: 1500, rotation: 365.12345 }] } });
    expect(obj().working).toEqual({ x: 1500, y: 1500, rotation: 5.123 });
  });

  it('normalizes rotations of other entities (vehicles)', () => {
    const v = VehicleSchema.parse({ ...createVehicle('sedan', { x: 2000, y: 2000, rotation: 0 }), id: 'v1' });
    expect(dispatch({ type: 'vehicle.add', payload: { items: [v] } }).ok).toBe(true);
    expect(dispatch({ type: 'vehicle.update', payload: { id: 'v1', patch: { rotation: 720 } } }).ok).toBe(true);
    expect(scenario().vehicles[0]!.rotation).toBe(0);
    expect(dispatch({ type: 'vehicle.update', payload: { id: 'v1', patch: { rotation: -90 } } }).ok).toBe(true);
    expect(scenario().vehicles[0]!.rotation).toBe(270);
  });
});
