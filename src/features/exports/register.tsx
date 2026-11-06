/**
 * Export formats (toolbar Export menu + palette): PNG, SVG, PDF, CSV and DXF. JSON is registered
 * by the projects feature. Every format opens the export dialog with its options.
 */
import { FileCode2, FileImage, FileSpreadsheet, FileText, PenTool, type LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import { exportFormats, paletteCommands, shellExtras, type ExportContext } from '@/app/registry';
import { makeFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { inventoryCsv } from './csv';
import { projectToDxf } from './dxf/planDxf';
import { ExportDialog, type ExportKind } from './ExportDialog';
import { planOptionsFrom, readExportPrefs } from './prefs';
import { exportPdf, exportPng, fileBase, planSvgFor } from './render';

const scenarioName = (ctx: ExportContext) => ctx.project.scenarios.find((s) => s.id === ctx.scenarioId)?.name;

/** Direct export with the project's saved options (used when no dialog is shown). */
async function direct(kind: ExportKind, ctx: ExportContext): Promise<{ blob: Blob; fileName: string }> {
  const prefs = readExportPrefs(ctx.project);
  const base = fileBase(ctx.project, scenarioName(ctx));
  switch (kind) {
    case 'png':
      return { blob: await exportPng(ctx.project, prefs, ctx.scenarioId), fileName: `${base}.png` };
    case 'svg':
      return { blob: new Blob([planSvgFor(ctx.project, prefs, ctx.scenarioId).svg], { type: 'image/svg+xml' }), fileName: `${base}.svg` };
    case 'pdf':
      return { blob: await exportPdf(ctx.project, prefs, ctx.scenarioId), fileName: `${base}.pdf` };
    case 'csv':
      return { blob: new Blob([inventoryCsv(ctx.project, ctx.scenarioId)], { type: 'text/csv;charset=utf-8' }), fileName: `${base}-inventory.csv` };
    case 'dxf':
      return {
        blob: new Blob([projectToDxf(ctx.project, makeFormatters(ctx.project.settings).length, planOptionsFrom(prefs.toggles, ctx.scenarioId))], { type: 'application/dxf' }),
        fileName: `${base}.dxf`,
      };
  }
}

const FORMATS: Array<{ kind: ExportKind; label: string; description: string; icon: LucideIcon; order: number }> = [
  { kind: 'png', label: 'PNG image', description: 'High-resolution picture of the plan (96–600 DPI).', icon: FileImage, order: 20 },
  { kind: 'svg', label: 'SVG vector plan', description: 'Scalable vector floor plan with legend.', icon: PenTool, order: 30 },
  { kind: 'pdf', label: 'PDF (printable)', description: 'To scale, with title, legend, measurements, date and notes.', icon: FileText, order: 40 },
  { kind: 'csv', label: 'CSV inventory', description: 'Every item with size, position, rotation and notes.', icon: FileSpreadsheet, order: 50 },
  { kind: 'dxf', label: 'DXF (CAD)', description: 'Walls, footprints and dimensions on separate layers.', icon: FileCode2, order: 60 },
];

/** Palette-opened dialog state (the toolbar menu hosts its own). */
const useExportDialog = create<{ kind: ExportKind | null }>(() => ({ kind: null }));

for (const f of FORMATS) {
  exportFormats.register({
    id: f.kind,
    label: f.label,
    description: f.description,
    extension: f.kind,
    icon: f.icon,
    order: f.order,
    export: (ctx) => direct(f.kind, ctx),
    customUi: ({ ctx, onDone }) => <ExportDialog kind={f.kind} ctx={ctx} onDone={onDone} />,
  });
  paletteCommands.register({
    id: `exports.${f.kind}`,
    title: `Export ${f.label}…`,
    section: 'Export',
    icon: f.icon,
    keywords: ['export', 'download', f.kind],
    when: (c) => !!c.project,
    run: () => useExportDialog.setState({ kind: f.kind }),
  });
}

function PaletteExportHost() {
  const kind = useExportDialog((s) => s.kind);
  const project = useProjectStore((s) => s.project);
  if (!kind || !project) return null;
  return <ExportDialog kind={kind} ctx={{ project, scenarioId: project.activeScenarioId }} onDone={() => useExportDialog.setState({ kind: null })} />;
}
shellExtras.register({ id: 'exports.dialog-host', order: 60, component: PaletteExportHost });
