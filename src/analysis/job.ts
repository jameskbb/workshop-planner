/**
 * One unit of layout analysis (pure): every analyzer (warnings) or every metric (scorecard) for a
 * scenario. Used by the analysis Web Worker (src/analysis/analysis.worker.ts) and, when Workers are
 * unavailable, by the page's asynchronous fallback.
 */
import type { Project } from '@/domain/schema';
import { analyzeLayout, computeMetrics } from './index';
import type { MetricValue, Warning } from './types';

export type AnalysisJobKind = 'warnings' | 'metrics';

export interface AnalysisJobRequest {
  seq: number;
  kind: AnalysisJobKind;
  project: Project;
  scenarioId: string;
}

export type AnalysisJobResponse =
  | { seq: number; kind: 'warnings'; warnings: Warning[]; ms: number }
  | { seq: number; kind: 'metrics'; metrics: Array<{ id: string; result: MetricValue }>; ms: number }
  | { seq: number; kind: AnalysisJobKind; error: string };

export function runAnalysisJob(req: AnalysisJobRequest): AnalysisJobResponse {
  const t0 = performance.now();
  try {
    if (req.kind === 'warnings') {
      return { seq: req.seq, kind: 'warnings', warnings: analyzeLayout(req.project, req.scenarioId), ms: performance.now() - t0 };
    }
    const metrics = computeMetrics(req.project, req.scenarioId).map(({ metric, result }) => ({ id: metric.id, result }));
    return { seq: req.seq, kind: 'metrics', metrics, ms: performance.now() - t0 };
  } catch (e) {
    return { seq: req.seq, kind: req.kind, error: e instanceof Error ? e.message : String(e) };
  }
}
