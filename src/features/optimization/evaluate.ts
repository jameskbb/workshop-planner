/**
 * Full evaluation of assistant candidates with the scorecard metrics (pure; runs in the worker).
 * Results are plain data (no functions) so they can cross the worker boundary.
 */
import { analyzeLayout, computeMetrics } from '@/analysis';
import type { Project } from '@/domain/schema';
import { optimizeLayout, projectWithCandidate, type Candidate, type OptimizeHooks, type OptimizeOptions } from './optimizer';

export interface MetricRow {
  id: string;
  label: string;
  unit: string;
  better: 'higher' | 'lower';
  value: number | null;
  display: string;
  explanation: string;
}

export interface EvaluatedCandidate extends Candidate {
  metrics: MetricRow[];
  /** Critical (physical) problems found by the full analysis; must be empty for a valid candidate. */
  critical: string[];
}

export interface AssistantResult {
  current: MetricRow[];
  candidates: EvaluatedCandidate[];
}

export function metricRows(project: Project, scenarioId: string): MetricRow[] {
  return computeMetrics(project, scenarioId).map(({ metric, result }) => ({
    id: metric.id,
    label: metric.label,
    unit: metric.unit,
    better: metric.better,
    value: result.value,
    display: result.display,
    explanation: result.explanation,
  }));
}

export function runAssistant(project: Project, scenarioId: string, options: OptimizeOptions, hooks: OptimizeHooks = {}): AssistantResult {
  const candidates = optimizeLayout(project, scenarioId, options, hooks);
  // Problems the layout already has (locked items that overlap, say) are not the candidate's doing
  // and cannot be fixed by moving what may be moved; only NEW ones make a candidate invalid.
  const before = new Set(analyzeLayout(project, scenarioId).filter((w) => w.severity === 'critical').map((w) => w.id));
  const evaluated = candidates.map((c) => {
    const q = projectWithCandidate(project, scenarioId, c);
    const critical = analyzeLayout(q, scenarioId)
      .filter((w) => w.severity === 'critical' && !before.has(w.id))
      .map((w) => w.message);
    return { ...c, valid: c.valid && critical.length === 0, metrics: metricRows(q, scenarioId), critical };
  });
  return {
    current: metricRows(project, scenarioId),
    // R-010: never hand back a candidate our own final check calls invalid: the optimizer already
    // re-annealed it from other seeds, so at this point it is simply not offered.
    candidates: evaluated.filter((c) => c.valid),
  };
}
