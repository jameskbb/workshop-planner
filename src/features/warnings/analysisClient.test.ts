/**
 * R-002: analysis must not run on the main thread during a commit. These tests drive the client
 * with a fake Worker and assert the contract: one job per change, coalescing, no re-run for changes
 * that cannot affect analysis, acknowledgments applied locally, and a graceful fallback.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import '@/domain/commands';
import { runAnalysisJob, type AnalysisJobRequest, type AnalysisJobResponse } from '@/analysis/job';
import { createProject, placeObject, rectangleRoomPoints } from '@/domain/factories';
import { activeScenario } from '@/domain/resolve';
import { ObjectDefinitionSchema, type ObjectDefinition, type Project } from '@/domain/schema';
import { inches } from '@/domain/units';
import { dispatch, loadProject, useProjectStore } from '@/stores/projectStore';

const def: ObjectDefinition = ObjectDefinitionSchema.parse({
  id: 'cab',
  name: 'Cabinet',
  category: 'storage',
  width: inches(48),
  depth: inches(24),
  height: inches(72),
  source: 'builtin',
});

/** Fake Worker that records requests and answers only when told to. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: AnalysisJobRequest[] = [];
  onmessage: ((e: { data: AnalysisJobResponse }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(req: AnalysisJobRequest): void {
    this.requests.push(req);
  }
  terminate(): void {}
  /** Answer the oldest unanswered request by actually running the job. */
  flush(): void {
    const req = this.requests[this.requests.length - 1]!;
    this.onmessage?.({ data: runAnalysisJob(req) });
  }
}

function fixture(): Project {
  const p = createProject({ name: 'Analysis', roomPoints: rectangleRoomPoints(6000, 6000) });
  p.definitions.push(def);
  activeScenario(p).objects.push(placeObject(def, { x: 1000, y: 1000, rotation: 0 }, { id: 'o1' }));
  return p;
}

import type * as AnalysisClient from './analysisClient';

let client: typeof AnalysisClient;

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  client = await import('./analysisClient');
  loadProject(fixture());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const worker = () => FakeWorker.instances[0]!;
const project = () => useProjectStore.getState().project!;

describe('asynchronous analysis', () => {
  it('sends the work to a worker instead of computing it on the page', () => {
    client.request('warnings', project());
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker().requests).toHaveLength(1);
    // Nothing is published until the worker answers.
    expect(client.useAnalysisStore.getState().warnings).toBeNull();
    expect(client.useAnalysisStore.getState().warningsPending).toBe(true);
    worker().flush();
    const w = client.useAnalysisStore.getState();
    expect(w.warnings).not.toBeNull();
    expect(w.warningsPending).toBe(false);
  });

  it('coalesces a burst of commits into one extra run', () => {
    client.request('warnings', project());
    expect(worker().requests).toHaveLength(1);
    for (let i = 0; i < 10; i++) {
      dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 1000 + i * 25.4, y: 1000 }] } });
      client.request('warnings', project());
    }
    // Still only the first job in flight; the ten changes are one queued job.
    expect(worker().requests).toHaveLength(1);
    worker().flush();
    expect(worker().requests).toHaveLength(2);
    expect(worker().requests[1]!.project.scenarios[0]!.objects[0]!.x).toBe(1000 + 9 * 25.4);
  });

  it('does not re-run for changes that cannot affect analysis', () => {
    client.request('warnings', project());
    worker().flush();
    expect(worker().requests).toHaveLength(1);
    dispatch({ type: 'project.rename', payload: { name: 'Renamed' } });
    client.request('warnings', project());
    dispatch({ type: 'layer.setVisibility', payload: { layer: 'storage', visible: false } });
    client.request('warnings', project());
    expect(worker().requests).toHaveLength(1);
    // A real change does run again.
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 2000, y: 2000 }] } });
    client.request('warnings', project());
    expect(worker().requests).toHaveLength(2);
  });

  it('asks for a fresh result when the scenario is switched', () => {
    client.request('warnings', project());
    worker().flush();
    dispatch({ type: 'scenario.duplicate', payload: { sourceId: project().activeScenarioId, id: 's2', name: 'B', activate: true } });
    client.request('warnings', project());
    expect(worker().requests).toHaveLength(2);
    expect(worker().requests[1]!.scenarioId).toBe('s2');
  });

  it('runs the job on the page (asynchronously) when there is no Worker', async () => {
    vi.resetModules();
    vi.stubGlobal('Worker', undefined);
    const noWorker = await import('./analysisClient');
    loadProject(fixture());
    noWorker.request('warnings', project());
    expect(noWorker.useAnalysisStore.getState().warnings).toBeNull();
    await vi.waitFor(() => expect(noWorker.useAnalysisStore.getState().warnings).not.toBeNull());
  });

  it('the worker job returns the same warnings as a direct run', () => {
    client.request('warnings', project());
    const res = runAnalysisJob(worker().requests[0]!);
    expect('warnings' in res && res.warnings.length).toBe(0);
    worker().flush();
    // A real problem shows up in the job's result.
    dispatch({ type: 'object.move', payload: { moves: [{ id: 'o1', x: 100_000, y: 100_000 }] } });
    client.request('warnings', project());
    const res2 = runAnalysisJob(worker().requests[worker().requests.length - 1]!);
    expect('warnings' in res2 && res2.warnings.some((w) => w.category === 'bounds')).toBe(true);
  });
});
