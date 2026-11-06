/**
 * Performance sanity checks for the editor's hot paths with hundreds of objects. Budgets are
 * generous (CI machines vary) but catch accidental O(n²)-per-frame regressions.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import '@/domain/commands';
import './adapters';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { getScenario, objectFootprint, resolveObject } from '@/domain/resolve';
import { ObjectDefinitionSchema, type Project } from '@/domain/schema';
import { bbox, snapBox, ALL_SNAPS } from '@/geometry';
import { loadProject, transact, useProjectStore } from '@/stores/projectStore';
import { adapter, buildSnapTargets, commitPatches, editorCtx } from './selection';

const def = ObjectDefinitionSchema.parse({ id: 'cab', name: 'Cabinet', category: 'storage', width: 600, depth: 500, height: 900, source: 'builtin' });
const N = 400;

function bigProject(): Project {
  const p = createProject({ name: 'Perf', roomPoints: rectangleRoomPoints(40000, 30000) });
  p.definitions.push(def);
  const s = getScenario(p);
  for (let i = 0; i < N; i++) s.objects.push(placeObject(def, { x: 1000 + (i % 25) * 1500, y: 1000 + Math.floor(i / 25) * 1700, rotation: (i * 15) % 360 }, { id: `o${i}` }));
  return p;
}

const time = (fn: () => void, runs = 1) => {
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t0) / runs;
};

describe(`editor performance with ${N} objects`, () => {
  beforeAll(() => loadProject(bigProject()));

  it('builds snap targets once per gesture quickly', () => {
    const c = editorCtx()!;
    const ms = time(() => buildSnapTargets(c, new Set(['object:o0'])), 5);
    expect(ms).toBeLessThan(150);
  });

  it('snaps a dragged box against all targets well within a frame', () => {
    const c = editorCtx()!;
    const targets = buildSnapTargets(c, new Set(['object:o0']));
    const box = bbox(objectFootprint(resolveObject(c.project, getScenario(c.project).objects[0]!)));
    const ms = time(() => snapBox({ ...box, minX: box.minX + 7, maxX: box.maxX + 7 }, targets, 40, ALL_SNAPS), 200);
    expect(ms).toBeLessThan(4);
  });

  it('computes drag previews for 50 selected objects per frame cheaply', () => {
    const c = editorCtx()!;
    const ids = Array.from({ length: 50 }, (_, i) => `o${i}`);
    const ms = time(() => {
      for (const id of ids) adapter('object')!.translate!(c, id, { x: 12, y: 34 });
    }, 100);
    expect(ms).toBeLessThan(4);
  });

  it('commits a 50-object move as one transaction quickly and undoably', () => {
    const c = editorCtx()!;
    const previews: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) previews[`object:o${i}`] = adapter('object')!.translate!(c, `o${i}`, { x: 100, y: 0 });
    const before = useProjectStore.getState().past.length;
    const ms = time(() => commitPatches('Move 50', previews));
    expect(ms).toBeLessThan(250);
    expect(useProjectStore.getState().past.length).toBe(before + 1);
    expect(getScenario(useProjectStore.getState().project!).objects[0]!.x).toBe(1100);
  });

  it('resolving every object after an unrelated edit hits the memo cache', () => {
    const p0 = useProjectStore.getState().project!;
    for (const o of getScenario(p0).objects) resolveObject(p0, o);
    transact('Rename', [{ type: 'project.rename', payload: { name: 'Perf 2' } }]);
    const p1 = useProjectStore.getState().project!;
    const ms = time(() => {
      for (const o of getScenario(p1).objects) resolveObject(p1, o);
    }, 20);
    expect(ms).toBeLessThan(2);
  });
});
