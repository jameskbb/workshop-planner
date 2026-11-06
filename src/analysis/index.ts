/**
 * Layout analysis public API (pure; safe in workers).
 *
 *   const warnings = analyzeLayout(project, scenarioId);
 *   const metrics = computeMetrics(project, scenarioId);
 *
 * Analyzers/metrics self-register; this module eagerly loads the core ones and every feature's
 * `src/features/<feature>/analysis.ts` and `metrics.ts` (no central list to edit).
 */
import type { Project } from '@/domain/schema';
import { buildAnalysisContext } from './context';
import { listMetrics } from './registry';
import { runAnalyzers } from './run';
import type { AnalyzeOptions, Metric, MetricValue, Warning } from './types';

import.meta.glob('./analyzers/*.ts', { eager: true });
import.meta.glob('./metrics/*.ts', { eager: true });
import.meta.glob('/src/features/*/analysis.ts', { eager: true });
import.meta.glob('/src/features/*/metrics.ts', { eager: true });

/** Every warning for a scenario (defaults to the active one), sorted by severity. */
export function analyzeLayout(project: Project, scenarioId?: string, options: AnalyzeOptions = {}): Warning[] {
  const ctx = buildAnalysisContext(project, scenarioId, options);
  return runAnalyzers(ctx, options.analyzers);
}

/** Warnings that are neither acknowledged nor ignored. */
export const openWarnings = (warnings: readonly Warning[]): Warning[] => warnings.filter((w) => !w.acknowledged);

export interface ComputedMetric {
  metric: Metric;
  result: MetricValue;
}

export function computeMetrics(project: Project, scenarioId?: string, options: AnalyzeOptions = {}): ComputedMetric[] {
  const ctx = buildAnalysisContext(project, scenarioId, options);
  return listMetrics().map((metric) => {
    try {
      return { metric, result: metric.compute(ctx) };
    } catch (e) {
      console.error(`Metric "${metric.id}" failed`, e);
      return { metric, result: { value: null, display: 'n/a', explanation: 'Could not be computed.' } };
    }
  });
}

export * from './types';
export * from './registry';
export { buildAnalysisContext, zoneLabel } from './context';
export type { AnalysisContext, AnalyzedObject, AnalyzedFeature, AnalyzedVehicle, AnalyzedZone } from './context';
export { runAnalyzers } from './run';
