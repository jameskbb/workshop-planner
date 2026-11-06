/**
 * Per-project export & print preferences (persisted via a project extension, not in undo history).
 */
import { z } from 'zod';
import { defineExtension } from '@/domain/extensions';
import type { Project } from '@/domain/schema';
import { dispatch } from '@/stores/projectStore';
import type { PlanOptions } from './plan/drawing';

export const PlanTogglesSchema = z.object({
  grid: z.boolean(),
  measurements: z.boolean(),
  labels: z.boolean(),
  clearances: z.boolean(),
  zones: z.boolean(),
  vehicle: z.boolean(),
  electrical: z.boolean(),
  lighting: z.boolean(),
  monochrome: z.boolean(),
});
export type PlanToggles = z.infer<typeof PlanTogglesSchema>;

export const TOGGLE_LABELS: Array<{ key: keyof PlanToggles; label: string }> = [
  { key: 'grid', label: 'Grid' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'labels', label: 'Object labels' },
  { key: 'clearances', label: 'Clearances' },
  { key: 'zones', label: 'Zones' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'monochrome', label: 'Monochrome' },
];

export const ExportPrefsSchema = z.object({
  toggles: PlanTogglesSchema,
  paper: z.enum(['letter', 'legal', 'tabloid', 'a4', 'a3']),
  orientation: z.enum(['portrait', 'landscape']),
  /** 0 = fit to page, otherwise the scale denominator. */
  scale: z.number().int().nonnegative(),
  legend: z.boolean(),
  notes: z.string(),
  dpi: z.number().int().positive(),
  pngContent: z.enum(['plan', 'sheet']),
});
export type ExportPrefs = z.infer<typeof ExportPrefsSchema>;

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  toggles: { grid: false, measurements: true, labels: true, clearances: false, zones: true, vehicle: true, electrical: true, lighting: true, monochrome: false },
  paper: 'letter',
  orientation: 'portrait',
  scale: 0,
  legend: true,
  notes: '',
  dpi: 300,
  pngContent: 'plan',
};

export const exportPrefsExt = defineExtension('exports.prefs', ExportPrefsSchema, DEFAULT_EXPORT_PREFS);

export function readExportPrefs(project: Project): ExportPrefs {
  return exportPrefsExt.read(project);
}

export function saveExportPrefs(project: Project, patch: Partial<ExportPrefs>): void {
  const value = { ...readExportPrefs(project), ...patch };
  dispatch({ type: 'extension.set', payload: { target: 'project', key: exportPrefsExt.key, value, history: false, label: 'Export settings' } });
}

export function planOptionsFrom(t: PlanToggles, scenarioId?: string): Partial<PlanOptions> {
  return { ...t, scenarioId };
}
