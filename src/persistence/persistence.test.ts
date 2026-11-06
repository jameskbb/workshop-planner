import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbRepository } from './idbRepository';
import { ProjectService, SETTING_DEMO_SEEDED } from './projectService';
import { AutosaveController, usePersistenceStore } from './autosave';
import { SNAPSHOT_LIMIT, summarizeProject, RepositoryError } from './repository';
import { createProject, rectangleRoomPoints } from '@/domain/factories';
import { serializeProject } from '@/domain/serialization';
import { ObjectDefinitionSchema } from '@/domain/schema';
import { beginGesture, dispatch, endGesture, loadProject, useProjectStore, closeProject } from '@/stores/projectStore';
import { DEMO_PROJECT_NAME } from '@/features/projects/demo';

let dbCounter = 0;
let repo: IdbRepository;
let service: ProjectService;

beforeEach(() => {
  repo = new IdbRepository(`test-db-${++dbCounter}`);
  service = new ProjectService(repo);
});

afterEach(async () => {
  await repo.close();
});

describe('IdbRepository: projects', () => {
  it('saves, lists (newest first) and loads projects', async () => {
    const a = createProject({ name: 'A', roomPoints: rectangleRoomPoints(6000, 5000) });
    const b = { ...createProject({ name: 'B' }), updatedAt: '2099-01-01T00:00:00.000Z' };
    await repo.saveProject(a);
    await repo.saveProject(b);
    const list = await repo.listProjects();
    expect(list.map((p) => p.name)).toEqual(['B', 'A']);
    expect(list[1]!.footprint).toMatchObject({ width: 6000, depth: 5000, irregular: false, corners: 4 });
    expect(await repo.getProject(a.id)).toEqual(a);
    expect(await repo.getProject('missing')).toBeUndefined();
  });

  it('deletes projects', async () => {
    const a = createProject({ name: 'A' });
    await repo.saveProject(a);
    await repo.deleteProject(a.id);
    expect(await repo.listProjects()).toEqual([]);
    expect(await repo.getProject(a.id)).toBeUndefined();
  });

  it('reports corrupt stored projects with a friendly error', async () => {
    const a = createProject({ name: 'Corrupt' });
    await repo.saveProject({ ...a, scenarios: [] } as never);
    await expect(repo.getProject(a.id)).rejects.toBeInstanceOf(RepositoryError);
    await expect(repo.getProject(a.id)).rejects.toThrow(/"Corrupt" could not be opened/);
  });

  it('summaries flag irregular rooms', async () => {
    const l = createProject({
      name: 'L',
      roomPoints: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 2000 },
        { x: 6000, y: 2000 },
        { x: 6000, y: 6000 },
        { x: 0, y: 6000 },
      ],
    });
    expect(summarizeProject(l).footprint).toMatchObject({ width: 6000, depth: 6000, irregular: true, corners: 6, area: 32e6 });
    expect(summarizeProject(createProject({ name: 'blank' })).footprint.width).toBe(0);
  });
});

describe('IdbRepository: snapshots, library, settings', () => {
  it('creates, lists, restores and prunes snapshots', async () => {
    const p = createProject({ name: 'Snap' });
    await repo.saveProject(p);
    const meta = await repo.createSnapshot(p, 'manual');
    expect(meta.label).toBe('Manual backup');
    expect('project' in meta).toBe(false);
    const full = await repo.getSnapshot(meta.id);
    expect(full!.project).toEqual(p);
    for (let i = 0; i < SNAPSHOT_LIMIT + 5; i++) await repo.createSnapshot({ ...p, revision: i + 1 }, 'auto');
    const list = await repo.listSnapshots(p.id);
    expect(list).toHaveLength(SNAPSHOT_LIMIT);
    expect(list[0]!.revision).toBe(SNAPSHOT_LIMIT + 5);
    await repo.deleteSnapshot(list[0]!.id);
    expect(await repo.listSnapshots(p.id)).toHaveLength(SNAPSHOT_LIMIT - 1);
    expect(await repo.getSnapshot('nope')).toBeUndefined();
  });

  it('stores custom objects globally (shared by all projects)', async () => {
    const def = ObjectDefinitionSchema.parse({ id: 'my-cab', name: 'My rolling cabinet', category: 'storage', width: 1219.2, depth: 609.6, height: 1828.8, mobility: 'mobile' });
    await repo.saveDefinition(def);
    const other = new IdbRepository(`test-db-${dbCounter}`); // same database, new connection
    const defs = await other.listDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ id: 'my-cab', source: 'custom', mobility: 'mobile' });
    expect(defs[0]!.updatedAt).toBeDefined();
    await other.deleteDefinition('my-cab');
    expect(await repo.listDefinitions()).toEqual([]);
    await other.close();
  });

  it('settings key/value', async () => {
    expect(await repo.getSetting('x')).toBeUndefined();
    await repo.setSetting('x', { a: 1 });
    expect(await repo.getSetting('x')).toEqual({ a: 1 });
  });
});

describe('ProjectService', () => {
  it('seeds the demo on first run only', async () => {
    expect(await service.seedDemoIfFirstRun()).toBe(true);
    expect((await repo.listProjects()).map((p) => p.name)).toEqual([DEMO_PROJECT_NAME]);
    expect(await repo.getSetting(SETTING_DEMO_SEEDED)).toBe(true);
    expect(await service.seedDemoIfFirstRun()).toBe(false);
    expect(await repo.listProjects()).toHaveLength(1);
  });

  it('does not seed when the user already has projects', async () => {
    await service.create({ name: 'Mine' });
    expect(await service.seedDemoIfFirstRun()).toBe(false);
    expect(await repo.listProjects()).toHaveLength(1);
  });

  it('create, duplicate, rename', async () => {
    const p = await service.create({ name: 'Garage' });
    const copy = await service.duplicate(p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe('Garage (copy)');
    await service.rename(p.id, '  Shop  ');
    expect((await repo.getProject(p.id))!.name).toBe('Shop');
    await expect(service.rename(p.id, '  ')).rejects.toThrow('Name cannot be empty.');
    await expect(service.duplicate('missing')).rejects.toThrow();
  });

  it('delete keeps a restorable backup', async () => {
    const p = await service.create({ name: 'Doomed' });
    await service.delete(p.id);
    expect(await repo.listProjects()).toEqual([]);
    const orphans = await service.orphanedSnapshots();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.reason).toBe('before-delete');
    const restored = await service.restoreSnapshot(orphans[0]!.id);
    expect(restored.name).toBe('Doomed');
    expect((await repo.listProjects()).map((x) => x.id)).toEqual([p.id]);
  });

  it('restoring a snapshot backs up the current version first', async () => {
    const p = await service.create({ name: 'V1' });
    const snap = await repo.createSnapshot(p, 'manual');
    await service.rename(p.id, 'V2');
    const restored = await service.restoreSnapshot(snap.id);
    expect(restored.name).toBe('V1');
    const snaps = await repo.listSnapshots(p.id);
    expect(snaps.some((s) => s.reason === 'before-restore' && s.projectName === 'V2')).toBe(true);
    await expect(service.restoreSnapshot('missing')).rejects.toThrow();
  });

  it('export → import round-trips as a new project', async () => {
    const p = await service.createDemo();
    const { fileName, json } = await service.exportJson(p.id);
    expect(fileName).toMatch(/\.workshop\.json$/);
    const r = await service.importJson(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.renamed).toBe(true);
    expect(r.project.id).not.toBe(p.id);
    expect(r.project.name).toBe(`${p.name} (imported)`);
    expect(r.project.scenarios).toEqual(p.scenarios);
    expect(await repo.listProjects()).toHaveLength(2);
  });

  it('import of an unknown id keeps it', async () => {
    const p = createProject({ name: 'Fresh' });
    const r = await service.importJson(serializeProject(p));
    expect(r.ok && r.project.id).toBe(p.id);
  });

  it('import rejects malformed files without writing anything', async () => {
    const r = await service.importJson('not json');
    expect(r.ok).toBe(false);
    expect(await repo.listProjects()).toEqual([]);
  });
});

describe('AutosaveController', () => {
  afterEach(() => {
    vi.useRealTimers();
    closeProject();
  });

  it('debounces saves and reports status', async () => {
    // Real timers: fake-indexeddb schedules its own callbacks on the timer queue.
    const p = createProject({ name: 'Auto', roomPoints: rectangleRoomPoints(5000, 5000) });
    await repo.saveProject(p);
    loadProject(p);
    const saver = new AutosaveController(repo, { debounceMs: 60, snapshotIntervalMs: 1e12, snapshotEveryChanges: 1e9 });
    const save = vi.spyOn(repo, 'saveProject');
    saver.start();
    expect(usePersistenceStore.getState().status).toBe('saved');
    dispatch({ type: 'project.rename', payload: { name: 'Auto 2' } });
    dispatch({ type: 'project.rename', payload: { name: 'Auto 3' } });
    expect(usePersistenceStore.getState().status).toBe('unsaved');
    expect(saver.hasPendingChanges).toBe(true);
    expect(save).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(usePersistenceStore.getState().status).toBe('saved'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(usePersistenceStore.getState().status).toBe('saved');
    expect((await repo.getProject(p.id))!.name).toBe('Auto 3');
    saver.stop();
  });

  it('writes discrete changes quickly but waits out an open drag gesture', async () => {
    const p = createProject({ name: 'Gesture' });
    await repo.saveProject(p);
    loadProject(p);
    const saver = new AutosaveController(repo, { debounceMs: 20, gestureDebounceMs: 10_000, snapshotIntervalMs: 1e12, snapshotEveryChanges: 1e9 });
    const save = vi.spyOn(repo, 'saveProject');
    saver.start();
    beginGesture('drag');
    dispatch({ type: 'project.rename', payload: { name: 'Dragging' } });
    await new Promise((r) => setTimeout(r, 120));
    expect(save).not.toHaveBeenCalled(); // still mid-drag
    endGesture();
    dispatch({ type: 'project.rename', payload: { name: 'Dropped' } });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect((await repo.getProject(p.id))!.name).toBe('Dropped');
    saver.stop();
  });

  it('flush saves immediately; snapshots are taken periodically', async () => {
    const p = createProject({ name: 'Snappy' });
    await repo.saveProject(p);
    loadProject(p);
    const saver = new AutosaveController(repo, { debounceMs: 10_000, snapshotEveryChanges: 2 });
    saver.start();
    dispatch({ type: 'project.rename', payload: { name: 'S1' } });
    dispatch({ type: 'project.rename', payload: { name: 'S2' } });
    await saver.flush();
    expect((await repo.getProject(p.id))!.name).toBe('S2');
    expect((await repo.listSnapshots(p.id)).map((s) => s.reason)).toEqual(['auto']);
    await saver.flush(); // nothing pending → no-op
    saver.stop();
  });

  it('survives a "browser refresh" (new repository instance reads the saved project)', async () => {
    const p = createProject({ name: 'Persisted' });
    await repo.saveProject(p);
    loadProject(p);
    const saver = new AutosaveController(repo, { debounceMs: 5 });
    saver.start();
    dispatch({ type: 'project.rename', payload: { name: 'After refresh' } });
    await saver.flush();
    saver.stop();
    const fresh = new IdbRepository(`test-db-${dbCounter}`);
    expect((await fresh.getProject(p.id))!.name).toBe('After refresh');
    await fresh.close();
  });

  it('reports errors and retries later', async () => {
    const p = createProject({ name: 'Err' });
    loadProject(p);
    const failing = new IdbRepository(`test-db-${dbCounter}`);
    vi.spyOn(failing, 'saveProject').mockRejectedValueOnce(new Error('Quota exceeded'));
    const saver = new AutosaveController(failing, { debounceMs: 5 });
    saver.start();
    dispatch({ type: 'project.rename', payload: { name: 'X' } });
    await saver.flush();
    expect(usePersistenceStore.getState()).toMatchObject({ status: 'error', error: 'Quota exceeded' });
    expect(saver.hasPendingChanges).toBe(true);
    await saver.flush();
    expect(usePersistenceStore.getState().status).toBe('saved');
    saver.stop();
    await failing.close();
    expect(useProjectStore.getState().project!.name).toBe('X');
  });
});
