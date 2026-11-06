/**
 * Asynchronous layout analysis (R-002).
 *
 * Analyzers and metrics used to run synchronously on the main thread after every committed change,
 * which cost ~1 s at 300 objects. They now run in a Web Worker (`src/analysis/analysis.worker.ts`):
 *
 *  - the page keeps showing the previous result until the new one arrives (no flicker, no blocking);
 *  - at most one job per kind is in flight; newer requests replace the queued one (coalescing), so a
 *    burst of nudges costs one analysis run, not one per key press;
 *  - a request is only sent when something analysis-relevant changed; toggling a layer, renaming the
 *    project or changing a preference keeps the previous result (the inputs below are compared by
 *    identity, which immer's structural sharing makes exact);
 *  - acknowledgments are applied on the page (cheap), so acknowledging a warning updates instantly;
 *  - without `Worker` (unit tests, old browsers) the same job runs asynchronously on the page.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { getMetric, type ComputedMetric, type MetricValue, type Warning } from '@/analysis';
import { runAnalysisJob, type AnalysisJobKind, type AnalysisJobRequest, type AnalysisJobResponse } from '@/analysis/job';
import { getScenario } from '@/domain/resolve';
import type { Project, Scenario } from '@/domain/schema';
import { useProjectStore } from '@/stores/projectStore';

/** Scenario fields an analyzer or metric can read (everything except acknowledgments/metadata). */
const SCENARIO_KEYS = ['objects', 'groups', 'vehicles', 'lights', 'zones', 'measurements', 'relationships', 'dust', 'extensions'] as const;

/** Identity fingerprint of everything analysis depends on. */
function analysisInputs(project: Project, scenario: Scenario): unknown[] {
  return [
    project.id,
    project.settings,
    project.room,
    project.architecture,
    project.electrical,
    project.definitions,
    project.extensions,
    scenario.id,
    ...SCENARIO_KEYS.map((k) => scenario[k]),
  ];
}

const sameInputs = (a: unknown[] | null, b: unknown[] | null): boolean =>
  a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

/** What the worker needs: this scenario only, without acknowledgments (applied on the page). */
function leanProject(project: Project, scenario: Scenario): Project {
  return { ...project, scenarios: [{ ...scenario, acknowledgedWarnings: {} }], activeScenarioId: scenario.id };
}

interface AnalysisState {
  /** Latest finished result, or null before the first one for this project. */
  warnings: Warning[] | null;
  metrics: Array<{ id: string; result: MetricValue }> | null;
  /** Inputs the results were computed from (null = none yet). */
  warningsInputs: unknown[] | null;
  metricsInputs: unknown[] | null;
  /** A job is in flight or queued. */
  warningsPending: boolean;
  metricsPending: boolean;
  /** Last run's duration (ms), used by tests and the perf spec. */
  lastMs: number;
}

export const useAnalysisStore = create<AnalysisState>()(() => ({
  warnings: null,
  metrics: null,
  warningsInputs: null,
  metricsInputs: null,
  warningsPending: false,
  metricsPending: false,
  lastMs: 0,
}));

interface Slot {
  /** Inputs of the job currently running. */
  running: unknown[] | null;
  /** Newest request received while a job was running. */
  queued: { req: AnalysisJobRequest; inputs: unknown[] } | null;
}
const slots: Record<AnalysisJobKind, Slot> = {
  warnings: { running: null, queued: null },
  metrics: { running: null, queued: null },
};

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

function ensureWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../../analysis/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AnalysisJobResponse>) => receive(e.data);
    worker.onerror = (e) => {
      console.error('[analysis] worker failed', (e as ErrorEvent).message ?? e);
      // Fall back to the page: a broken worker must never mean "no warnings".
      workerBroken = true;
      worker?.terminate();
      worker = null;
      slots.warnings.running = null;
      slots.warnings.queued = null;
      slots.metrics.running = null;
      slots.metrics.queued = null;
      const project = useProjectStore.getState().project;
      if (project) {
        request('warnings', project);
        if (metricListeners > 0) request('metrics', project);
      }
    };
  } catch (e) {
    console.error('[analysis] worker could not start', e);
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function receive(res: AnalysisJobResponse): void {
  const slot = slots[res.kind];
  const inputs = slot.running;
  slot.running = null;
  if ('error' in res) {
    console.error(`Layout analysis (${res.kind}) failed`, res.error);
  } else if (res.kind === 'warnings') {
    useAnalysisStore.setState({ warnings: res.warnings, warningsInputs: inputs, lastMs: res.ms });
  } else {
    useAnalysisStore.setState({ metrics: res.metrics, metricsInputs: inputs, lastMs: res.ms });
  }
  const queued = slot.queued;
  slot.queued = null;
  if (queued) start(res.kind, queued.req, queued.inputs);
  else useAnalysisStore.setState(res.kind === 'warnings' ? { warningsPending: false } : { metricsPending: false });
}

function start(kind: AnalysisJobKind, req: AnalysisJobRequest, inputs: unknown[]): void {
  const slot = slots[kind];
  slot.running = inputs;
  useAnalysisStore.setState(kind === 'warnings' ? { warningsPending: true } : { metricsPending: true });
  const w = ensureWorker();
  if (w) {
    w.postMessage(req);
    return;
  }
  // No worker: still asynchronous, so a commit is never blocked by analysis.
  setTimeout(() => receive(runAnalysisJob(req)), 0);
}

/** Ask for an analysis of `project` (no-op when the result or the running job already covers it). */
export function request(kind: AnalysisJobKind, project: Project): void {
  const scenario = getScenario(project);
  const inputs = analysisInputs(project, scenario);
  const state = useAnalysisStore.getState();
  const have = kind === 'warnings' ? state.warningsInputs : state.metricsInputs;
  const slot = slots[kind];
  // Already computed, already running or already queued for exactly these inputs.
  if (sameInputs(have, inputs) || sameInputs(slot.running, inputs) || sameInputs(slot.queued?.inputs ?? null, inputs)) return;
  const req: AnalysisJobRequest = { seq: ++seq, kind, project: leanProject(project, scenario), scenarioId: scenario.id };
  if (slot.running) slot.queued = { req, inputs };
  else start(kind, req, inputs);
}

/** Drop results that belong to another project (switching projects must not show stale warnings). */
function resetFor(project: Project | null): void {
  const s = useAnalysisStore.getState();
  const id = project?.id ?? null;
  const currentId = (s.warningsInputs?.[0] ?? null) as string | null;
  if (currentId !== null && currentId !== id) {
    slots.warnings.queued = null;
    slots.metrics.queued = null;
    useAnalysisStore.setState({ warnings: null, metrics: null, warningsInputs: null, metricsInputs: null });
  }
}

let metricListeners = 0;
let started = false;
/** Subscribe to the project store once: warnings are always kept up to date (the badge is global). */
function ensureSubscribed(): void {
  if (started) return;
  started = true;
  const onProject = (project: Project | null) => {
    resetFor(project);
    if (!project) return;
    request('warnings', project);
    if (metricListeners > 0) request('metrics', project);
  };
  useProjectStore.subscribe((s, prev) => {
    if (s.project !== prev.project) onProject(s.project);
  });
  onProject(useProjectStore.getState().project);
}

/** Apply the scenario's acknowledgments to a worker result (cheap, so acks feel instant). */
function withAcks(warnings: Warning[] | null, acks: Scenario['acknowledgedWarnings']): Warning[] {
  if (!warnings) return [];
  return warnings.map((w) => {
    const ack = acks[w.id];
    if (!ack) return w.acknowledged ? { ...w, acknowledged: undefined } : w;
    return { ...w, acknowledged: ack.status };
  });
}

/** Warnings for the active layout. Recomputed in a worker; the previous result is kept meanwhile. */
export function useWarnings(): Warning[] {
  const project = useProjectStore((s) => s.project);
  useEffect(ensureSubscribed, []);
  useEffect(() => {
    if (project) request('warnings', project);
  }, [project]);
  const raw = useAnalysisStore((s) => s.warnings);
  const acks = project ? getScenario(project).acknowledgedWarnings : undefined;
  return useMemo(() => (acks ? withAcks(raw, acks) : []), [raw, acks]);
}

/** Scorecard metrics for the active layout (computed in the worker while this hook is mounted). */
export function useMetrics(): ComputedMetric[] | null {
  const project = useProjectStore((s) => s.project);
  useEffect(ensureSubscribed, []);
  useEffect(() => {
    metricListeners++;
    return () => {
      metricListeners--;
    };
  }, []);
  useEffect(() => {
    if (project) request('metrics', project);
  }, [project]);
  const raw = useAnalysisStore((s) => s.metrics);
  return useMemo(() => {
    if (!raw) return null;
    return raw.flatMap(({ id, result }) => {
      const metric = getMetric(id);
      return metric ? [{ metric, result }] : [];
    });
  }, [raw]);
}

/** True until the first result for the open project has arrived. */
export function useAnalysisReady(): boolean {
  return useAnalysisStore((s) => s.warnings !== null);
}
