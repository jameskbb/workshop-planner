/**
 * Scorecard (pure): descriptive metrics per layout plus user-chosen priority weights. There is no
 * absolute "magic score": the optional weighted summary is RELATIVE to the layouts being compared
 * (best of them on a metric = 1, worst = 0) and always comes with its full per-metric breakdown.
 */
import { z } from 'zod';
import { computeMetrics, type ComputedMetric } from '@/analysis';
import { defineExtension } from '@/domain/extensions';
import type { Project } from '@/domain/schema';

/** Priority weights per metric id: 0 (ignore) … 3 (very important). Missing ids default to 1. */
export const scorecardPrefs = defineExtension(
  'scenarios.scorecard',
  z.object({ weights: z.record(z.string(), z.number().min(0).max(3)) }),
  { weights: {} },
);

export const WEIGHT_LABELS = ['Ignore', 'Low', 'Normal', 'High'] as const;
export const DEFAULT_WEIGHT = 2;

export function weightOf(weights: Record<string, number>, metricId: string): number {
  return weights[metricId] ?? DEFAULT_WEIGHT;
}

export interface LayoutMetrics {
  scenarioId: string;
  name: string;
  metrics: ComputedMetric[];
}

export function layoutMetrics(project: Project, scenarioIds: readonly string[]): LayoutMetrics[] {
  return scenarioIds
    .map((id) => project.scenarios.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({ scenarioId: s.id, name: s.name, metrics: computeMetrics(project, s.id) }));
}

export interface Contribution {
  metricId: string;
  label: string;
  weight: number;
  /** 0 (worst of the compared layouts) … 1 (best); null when not measurable here. */
  normalized: number | null;
  /** weight × normalized. */
  points: number;
}

export interface RelativeScore {
  scenarioId: string;
  /** 0–100, or null when nothing weighted is measurable. */
  score: number | null;
  contributions: Contribution[];
  /** Metric id → is this layout the best (ties included) among those compared. */
  best: Record<string, boolean>;
}

/**
 * Relative weighted summary across layouts. For each metric with a value in at least one layout:
 * normalized = (v − worst) / (best − worst) using the metric's direction (1 when all are equal).
 * Score = Σ weight·normalized / Σ weight over metrics measurable in that layout, × 100.
 */
export function relativeScores(rows: readonly LayoutMetrics[], weights: Record<string, number>): RelativeScore[] {
  const ids = rows[0]?.metrics.map((m) => m.metric.id) ?? [];
  const ranges = new Map<string, { lo: number; hi: number; better: 'higher' | 'lower'; label: string; n: number }>();
  for (const id of ids) {
    const vals = rows.map((r) => r.metrics.find((m) => m.metric.id === id)?.result.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const metric = rows[0]!.metrics.find((m) => m.metric.id === id)!.metric;
    if (vals.length) ranges.set(id, { lo: Math.min(...vals), hi: Math.max(...vals), better: metric.better, label: metric.label, n: vals.length });
  }
  return rows.map((r) => {
    const contributions: Contribution[] = [];
    const best: Record<string, boolean> = {};
    let sum = 0;
    let wsum = 0;
    for (const m of r.metrics) {
      const range = ranges.get(m.metric.id);
      const w = weightOf(weights, m.metric.id);
      const v = m.result.value;
      let norm: number | null = null;
      if (range && typeof v === 'number' && Number.isFinite(v)) {
        const span = range.hi - range.lo;
        norm = span < 1e-9 ? 1 : range.better === 'higher' ? (v - range.lo) / span : (range.hi - v) / span;
        best[m.metric.id] = norm >= 1 - 1e-9 && range.n > 1;
        if (w > 0) {
          sum += w * norm;
          wsum += w;
        }
      }
      contributions.push({ metricId: m.metric.id, label: m.metric.label, weight: w, normalized: norm, points: norm === null ? 0 : w * norm });
    }
    return { scenarioId: r.scenarioId, score: wsum > 0 ? (sum / wsum) * 100 : null, contributions, best };
  });
}
