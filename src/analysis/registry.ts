/**
 * Analyzer and metric registries (pure: usable from UI, tests and Web Workers).
 *
 * Add an analyzer by creating `src/analysis/analyzers/<name>.ts` (core) or
 * `src/features/<feature>/analysis.ts` (feature-owned); both are auto-loaded by src/analysis/index.ts:
 *
 *   registerAnalyzer({ id: 'vehicle-doors', label: 'Vehicle doors', description: '…', category: 'vehicle',
 *     run(ctx) { return [...] } });
 *
 * Metrics likewise: `src/analysis/metrics/<name>.ts` or `src/features/<feature>/metrics.ts`.
 */
import type { Analyzer, Metric } from './types';

const analyzers = new Map<string, Analyzer>();
const metrics = new Map<string, Metric>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function registerAnalyzer(a: Analyzer): () => void {
  analyzers.set(a.id, a);
  notify();
  return () => {
    if (analyzers.get(a.id) === a) {
      analyzers.delete(a.id);
      notify();
    }
  };
}

export function registerMetric(m: Metric): () => void {
  metrics.set(m.id, m);
  notify();
  return () => {
    if (metrics.get(m.id) === m) {
      metrics.delete(m.id);
      notify();
    }
  };
}

export const listAnalyzers = (): Analyzer[] => [...analyzers.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
export const listMetrics = (): Metric[] => [...metrics.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
export const getAnalyzer = (id: string): Analyzer | undefined => analyzers.get(id);
export const getMetric = (id: string): Metric | undefined => metrics.get(id);

/** Subscribe to registry changes (HMR / late registration). */
export function onAnalysisRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
