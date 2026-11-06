import { beforeEach, describe, expect, it } from 'vitest';
import {
  beginGesture,
  canRedo,
  canUndo,
  dispatch,
  endGesture,
  HISTORY_LIMIT,
  loadProject,
  redo,
  redoLabel,
  transact,
  undo,
  undoLabel,
  useProjectStore,
} from './projectStore';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { ObjectDefinitionSchema, ProjectSchema, type ObjectDefinition, type Project } from '@/domain/schema';
import { inches } from '@/domain/units';
import { commandJsonSchemas, listCommands, validateCommand } from '@/domain/commands';
import { activeScenario } from '@/domain/resolve';

const cabinetDef: ObjectDefinition = ObjectDefinitionSchema.parse({
  id: 'test-cabinet',
  name: 'Cabinet',
  category: 'storage',
  width: inches(48),
  depth: inches(24),
  height: inches(72),
  source: 'builtin',
  layer: 'storage',
});

function fixture(): Project {
  const p = createProject({ name: 'Test garage', roomPoints: rectangleRoomPoints(6000, 6000) });
  return p;
}

const state = () => useProjectStore.getState();
const scenario = () => activeScenario(state().project!);

function addCabinet(id = 'cab-1', x = 1000, y = 1000) {
  return dispatch({
    type: 'object.add',
    payload: { objects: [placeObject(cabinetDef, { x, y, rotation: 0 }, { id })], definitions: [cabinetDef] },
  });
}

beforeEach(() => {
  loadProject(fixture());
});

describe('command bus', () => {
  it('applies a command and records history', () => {
    expect(addCabinet().ok).toBe(true);
    expect(scenario().objects).toHaveLength(1);
    expect(state().project!.definitions).toHaveLength(1);
    expect(canUndo(state())).toBe(true);
    expect(undoLabel(state())).toBe('Add Cabinet');
    expect(state().project!.revision).toBe(1);
  });

  it('rejects invalid payloads without changing anything', () => {
    const before = state().project;
    const r = dispatch({ type: 'object.move', payload: { moves: [] } });
    expect(r.ok).toBe(false);
    expect(state().project).toBe(before);
    expect(state().lastError).toMatch(/object\.move/);
  });

  it('refuses domain-invalid changes with an explanation', () => {
    addCabinet();
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { locked: true } } });
    const r = dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 0, y: 0 }] } });
    expect(r).toEqual({ ok: false, error: '"Cabinet" is locked. Unlock it to move it.' });
    expect(scenario().objects[0]!.x).toBe(1000);
  });

  it('undo and redo restore exact states', () => {
    const p0 = state().project!;
    addCabinet();
    const p1 = state().project!;
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 2000, y: 1500, rotation: 90 }] } });
    expect(scenario().objects[0]).toMatchObject({ x: 2000, y: 1500, rotation: 90 });
    expect(undo()).toBe(true);
    expect(activeScenario(state().project!).objects).toEqual(activeScenario(p1).objects);
    expect(undo()).toBe(true);
    expect(activeScenario(state().project!).objects).toEqual(activeScenario(p0).objects);
    expect(undo()).toBe(false);
    expect(canRedo(state())).toBe(true);
    expect(redoLabel(state())).toBe('Add Cabinet');
    expect(redo()).toBe(true);
    expect(redo()).toBe(true);
    expect(scenario().objects[0]).toMatchObject({ x: 2000, y: 1500, rotation: 90 });
    expect(redo()).toBe(false);
  });

  it('a new command after undo clears the redo stack', () => {
    addCabinet();
    undo();
    addCabinet('cab-2');
    expect(canRedo(state())).toBe(false);
  });

  it('quantizes positions onto the canonical lattice', () => {
    addCabinet();
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1000.1234564, y: 2000.9876543 }] } });
    expect(scenario().objects[0]).toMatchObject({ x: 1000.123456, y: 2000.987654 });
  });

  it('multi-command transactions undo as one step', () => {
    const r = transact('Add two cabinets', [
      { type: 'object.add', payload: { objects: [placeObject(cabinetDef, { x: 0, y: 0, rotation: 0 }, { id: 'a' })], definitions: [cabinetDef] } },
      { type: 'object.add', payload: { objects: [placeObject(cabinetDef, { x: 0, y: 0, rotation: 0 }, { id: 'b' })] } },
    ]);
    expect(r.ok).toBe(true);
    expect(scenario().objects).toHaveLength(2);
    expect(state().past).toHaveLength(1);
    expect(undoLabel(state())).toBe('Add two cabinets');
    undo();
    expect(scenario().objects).toHaveLength(0);
  });

  it('a failing command aborts the whole transaction', () => {
    const before = state().project;
    const r = transact('Bad', [
      { type: 'object.add', payload: { objects: [placeObject(cabinetDef, { x: 0, y: 0, rotation: 0 }, { id: 'a' })], definitions: [cabinetDef] } },
      { type: 'object.move', payload: { moves: [{ id: 'missing', x: 0, y: 0 }] } },
    ]);
    expect(r.ok).toBe(false);
    expect(state().project).toBe(before);
    expect(state().past).toHaveLength(0);
  });

  it('callback transactions can read the draft between commands', () => {
    addCabinet();
    transact('Nudge twice', (tx) => {
      tx.dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1100, y: 1000 }] } });
      const x = activeScenario(tx.project).objects[0]!.x;
      tx.dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: x + 100, y: 1000 }] } });
    });
    expect(scenario().objects[0]!.x).toBe(1200);
    expect(state().past).toHaveLength(2);
  });

  it('coalesces a drag gesture into one undo step', () => {
    addCabinet();
    beginGesture('drag:1');
    for (let i = 1; i <= 20; i++) {
      dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1000 + i * 10, y: 1000 }] } }, { coalesceKey: 'drag:1' });
    }
    endGesture();
    expect(state().past).toHaveLength(2);
    expect(scenario().objects[0]!.x).toBe(1200);
    undo();
    expect(scenario().objects[0]!.x).toBe(1000);
    redo();
    expect(scenario().objects[0]!.x).toBe(1200);
  });

  it('does not coalesce different keys or stale entries', () => {
    addCabinet();
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1010, y: 1000 }] } }, { coalesceKey: 'nudge' });
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1020, y: 1000 }] } }, { coalesceKey: 'nudge' });
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1030, y: 1000 }] } }, { coalesceKey: 'other' });
    expect(state().past).toHaveLength(3);
    // Simulate time passing: stale entries do not merge.
    const past = state().past;
    useProjectStore.setState({ past: past.map((e) => ({ ...e, at: e.at - 5000 })) });
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 1040, y: 1000 }] } }, { coalesceKey: 'other' });
    expect(state().past).toHaveLength(4);
  });

  it('non-history commands persist but are not undoable', () => {
    addCabinet();
    dispatch({ type: 'layer.setVisibility', payload: { layer: 'storage', visible: false } });
    expect(state().project!.layers.storage.visible).toBe(false);
    expect(state().past).toHaveLength(1);
    undo();
    expect(state().project!.layers.storage.visible).toBe(false);
    expect(scenario().objects).toHaveLength(0);
  });

  it('commands that change nothing do not create history', () => {
    addCabinet();
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { name: 'Cabinet' } } });
    expect(state().past).toHaveLength(1);
  });

  it('history is capped', () => {
    addCabinet();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: i, y: 0 }] } });
    expect(state().past).toHaveLength(HISTORY_LIMIT);
  });

  it('update validates the resulting entity and supports unset', () => {
    addCabinet();
    expect(dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { width: -5 } } }).ok).toBe(false);
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { label: "4' Tool Cabinet", mobility: 'mobile', working: { x: 3000, y: 3000, rotation: 0 } } } });
    expect(scenario().objects[0]!.label).toBe("4' Tool Cabinet");
    dispatch({ type: 'object.update', payload: { id: 'cab-1', unset: ['label'] } });
    expect(scenario().objects[0]!.label).toBeUndefined();
    // Patches never reset unspecified fields to defaults.
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { locked: true } } });
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { notes: 'heavy' } } });
    expect(scenario().objects[0]!.locked).toBe(true);
  });

  it('moves the working position of a mobile tool separately', () => {
    addCabinet();
    dispatch({ type: 'object.update', payload: { id: 'cab-1', patch: { mobility: 'mobile' } } });
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 3000, y: 2000 }], position: 'working' } });
    expect(scenario().objects[0]).toMatchObject({ x: 1000, y: 1000, working: { x: 3000, y: 2000, rotation: 0 } });
  });

  it('duplicate, delete, reorder, group and ungroup', () => {
    addCabinet('a');
    addCabinet('b', 3000, 1000);
    dispatch({ type: 'object.duplicate', payload: { ids: ['a'], idMap: { a: 'a2' } } });
    expect(scenario().objects.map((o) => o.id)).toEqual(['a', 'b', 'a2']);
    expect(scenario().objects[2]).toMatchObject({ x: 1304.8, y: 1304.8 });
    dispatch({ type: 'object.reorder', payload: { id: 'a2', to: 'back' } });
    expect(scenario().objects.map((o) => o.id)).toEqual(['a2', 'a', 'b']);
    dispatch({ type: 'object.group', payload: { ids: ['a', 'b'], group: { id: 'g1', name: 'Pair', locked: false } } });
    expect(scenario().objects.filter((o) => o.groupId === 'g1')).toHaveLength(2);
    dispatch({ type: 'object.duplicate', payload: { ids: ['a', 'b'] } });
    const newGroup = scenario().groups.find((g) => g.id !== 'g1');
    expect(newGroup?.name).toBe('Pair copy');
    dispatch({ type: 'object.ungroup', payload: { groupId: 'g1' } });
    expect(scenario().groups.find((g) => g.id === 'g1')).toBeUndefined();
    dispatch({ type: 'object.delete', payload: { ids: ['a', 'b'] } });
    expect(scenario().objects.map((o) => o.id)).not.toContain('a');
  });
});

describe('scenarios', () => {
  it('duplicating a scenario copies the arrangement, keeps ids, preserves room geometry', () => {
    addCabinet();
    dispatch({ type: 'measurement.add', payload: { items: [{ id: 'm1', kind: 'point', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }] } });
    const roomBefore = state().project!.room;
    const sourceId = state().project!.activeScenarioId;
    dispatch({ type: 'scenario.duplicate', payload: { name: 'Workshop mode', id: 'scn-2' } });
    const p = state().project!;
    expect(p.scenarios).toHaveLength(2);
    expect(p.activeScenarioId).toBe('scn-2');
    const copy = p.scenarios.find((s) => s.id === 'scn-2')!;
    const source = p.scenarios.find((s) => s.id === sourceId)!;
    expect(copy.objects).toEqual(source.objects);
    expect(copy.measurements).toEqual(source.measurements);
    expect(copy.objects).not.toBe(source.objects);
    expect(p.room).toBe(roomBefore);
    // Editing the copy leaves the source untouched.
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 4000, y: 4000 }] } });
    expect(state().project!.scenarios.find((s) => s.id === sourceId)!.objects[0]!.x).toBe(1000);
    expect(state().project!.scenarios.find((s) => s.id === 'scn-2')!.objects[0]!.x).toBe(4000);
  });

  it('undo returns to the scenario where the change happened', () => {
    addCabinet();
    const first = state().project!.activeScenarioId;
    dispatch({ type: 'scenario.create', payload: { name: 'B', id: 'b' } });
    dispatch({ type: 'scenario.setActive', payload: { scenarioId: first } });
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'cab-1', x: 50, y: 50 }] } });
    dispatch({ type: 'scenario.setActive', payload: { scenarioId: 'b' } });
    undo();
    expect(state().project!.activeScenarioId).toBe(first);
    expect(scenario().objects[0]!.x).toBe(1000);
  });

  it('cannot delete the last scenario; deleting the active one picks a neighbor', () => {
    const only = state().project!.activeScenarioId;
    expect(dispatch({ type: 'scenario.delete', payload: { scenarioId: only } }).ok).toBe(false);
    dispatch({ type: 'scenario.create', payload: { name: 'B', id: 'b' } });
    dispatch({ type: 'reorganization.setScenarios', payload: { targetScenarioId: 'b' } });
    dispatch({ type: 'scenario.delete', payload: { scenarioId: 'b' } });
    expect(state().project!.activeScenarioId).toBe(only);
    expect(state().project!.reorganization.targetScenarioId).toBeUndefined();
    undo();
    expect(state().project!.scenarios).toHaveLength(2);
  });

  it('copies objects to another scenario (paste across layouts)', () => {
    addCabinet();
    const first = state().project!.activeScenarioId;
    dispatch({ type: 'scenario.create', payload: { name: 'B', id: 'b', activate: false } });
    dispatch({ type: 'object.copyToScenario', payload: { fromScenarioId: first, toScenarioId: 'b', ids: ['cab-1'] } });
    expect(state().project!.scenarios.find((s) => s.id === 'b')!.objects[0]!.id).toBe('cab-1');
    dispatch({ type: 'object.copyToScenario', payload: { fromScenarioId: first, toScenarioId: 'b', ids: ['cab-1'] } });
    const ids = state().project!.scenarios.find((s) => s.id === 'b')!.objects.map((o) => o.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('rename / reorder scenarios', () => {
    const first = state().project!.activeScenarioId;
    dispatch({ type: 'scenario.create', payload: { name: 'B', id: 'b' } });
    dispatch({ type: 'scenario.rename', payload: { scenarioId: 'b', name: 'Car priority' } });
    dispatch({ type: 'scenario.reorder', payload: { order: ['b', first] } });
    expect(state().project!.scenarios.map((s) => s.name)).toEqual(['Car priority', 'Layout A']);
    expect(dispatch({ type: 'scenario.reorder', payload: { order: ['b'] } }).ok).toBe(false);
  });
});

describe('room commands', () => {
  it('refuses a vertex move that would self-intersect', () => {
    const v = state().project!.room.vertices;
    const r = dispatch({ type: 'room.moveVertex', payload: { vertexId: v[1]!.id, x: 3000, y: 7000 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('This would cause the room boundary to intersect itself.');
    expect(state().project!.room.vertices[1]).toEqual(v[1]);
  });
  it('moves a vertex (connected walls stay connected by construction)', () => {
    const v = state().project!.room.vertices;
    expect(dispatch({ type: 'room.moveVertex', payload: { vertexId: v[1]!.id, x: 6500, y: 0 } }).ok).toBe(true);
    undo();
    expect(state().project!.room.vertices[1]!.x).toBe(6000);
  });
  it('inserts and deletes corners, re-anchoring wall-hosted features', () => {
    const room = state().project!.room;
    const north = room.walls[0]!;
    dispatch({
      type: 'feature.add',
      payload: { items: [{ id: 'door', kind: 'door', name: 'Entry door', placement: { type: 'wall', wallId: north.id, offset: 4500 }, width: 914.4, depth: 139.7, height: 2032 }] },
    });
    dispatch({ type: 'room.insertVertex', payload: { wallId: north.id, offset: 3000, vertexId: 'v-new', newWallId: 'w-new' } });
    const p = state().project!;
    expect(p.room.vertices).toHaveLength(5);
    const door = p.architecture[0]!;
    expect(door.placement).toEqual({ type: 'wall', wallId: 'w-new', offset: 1500 });
    dispatch({ type: 'room.deleteVertex', payload: { vertexId: 'v-new' } });
    const door2 = state().project!.architecture[0]!;
    expect(door2.placement).toMatchObject({ type: 'wall', wallId: north.id });
    if (door2.placement.type === 'wall') expect(door2.placement.offset).toBeCloseTo(4500, 1);
  });
  it('rejects rooms with fewer than 3 corners or duplicate points', () => {
    const room = state().project!.room;
    expect(dispatch({ type: 'room.set', payload: { room: { ...room, vertices: room.vertices.slice(0, 2), walls: room.walls.slice(0, 2) } } }).ok).toBe(false);
    const dup = { ...room, vertices: room.vertices.map((v, i) => (i === 1 ? { ...v, x: 0, y: 0 } : v)) };
    const r = dispatch({ type: 'room.set', payload: { room: dup } });
    expect(r.ok).toBe(false);
  });
  it('wall updates validate', () => {
    const w = state().project!.room.walls[0]!;
    dispatch({ type: 'room.updateWall', payload: { wallId: w.id, patch: { name: 'Garage door wall', thickness: 200 } } });
    expect(state().project!.room.walls[0]).toMatchObject({ name: 'Garage door wall', thickness: 200 });
    expect(dispatch({ type: 'room.updateWall', payload: { wallId: w.id, patch: { thickness: 0 } } }).ok).toBe(false);
  });
});

describe('misc commands', () => {
  it('acknowledges and restores warnings', () => {
    dispatch({ type: 'warning.acknowledge', payload: { warningId: 'w1', status: 'ignored', note: 'fine' } });
    expect(scenario().acknowledgedWarnings.w1).toMatchObject({ status: 'ignored', note: 'fine' });
    dispatch({ type: 'warning.unacknowledge', payload: { warningId: 'w1' } });
    expect(scenario().acknowledgedWarnings.w1).toBeUndefined();
  });
  it('sets extension data', () => {
    dispatch({ type: 'extension.set', payload: { target: 'project', key: 'print.prefs', value: { paper: 'letter' } } });
    expect(state().project!.extensions['print.prefs']).toEqual({ paper: 'letter' });
    dispatch({ type: 'extension.set', payload: { target: 'scenario', key: 'x', value: 1, history: false } });
    expect(scenario().extensions.x).toBe(1);
    expect(state().past).toHaveLength(1);
  });
  it('settings updates are validated and merged', () => {
    dispatch({ type: 'project.updateSettings', payload: { patch: { unitSystem: 'metric', gridSize: 100 } } });
    expect(state().project!.settings).toMatchObject({ unitSystem: 'metric', gridSize: 100, imperialPrecision: 16 });
    expect(dispatch({ type: 'project.updateSettings', payload: { patch: { gridSize: -1 } } }).ok).toBe(false);
  });
  it('the whole project stays schema-valid after many commands', () => {
    addCabinet();
    dispatch({ type: 'scenario.duplicate', payload: { name: 'Copy' } });
    dispatch({ type: 'project.rename', payload: { name: 'Renamed' } });
    expect(ProjectSchema.safeParse(state().project).success).toBe(true);
  });
  it('exposes JSON schemas for every command (LLM-ready)', () => {
    const schemas = commandJsonSchemas();
    expect(Object.keys(schemas).length).toBe(listCommands().length);
    expect(schemas['object.move']).toBeDefined();
    expect(validateCommand({ type: 'nope' }).ok).toBe(false);
    expect(validateCommand(null).ok).toBe(false);
  });
});
