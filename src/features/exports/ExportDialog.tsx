/**
 * Export dialog: one dialog body for every file format with options (layout, what to show,
 * paper/scale for PDF, resolution for PNG, units for DXF) and a live preview.
 */
import { Download, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ExportContext } from '@/app/registry';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Select, Switch, Textarea } from '@/components/ui';
import { makeFormatters } from '@/hooks/useFormatters';
import { uiActions } from '@/stores/uiStore';
import { downloadBlob } from '@/utils/download';
import { cn } from '@/utils/cn';
import { inventoryCsv } from './csv';
import { projectToDxf } from './dxf/planDxf';
import { planOptionsFrom, readExportPrefs, saveExportPrefs, TOGGLE_LABELS, type ExportPrefs } from './prefs';
import { exportPdf, exportPng, fileBase, planSvgFor, pngSize, sheetFor } from './render';
import { PAPER_SIZES, describeScale, scaleList, type PaperId } from './sheet';

export type ExportKind = 'png' | 'svg' | 'pdf' | 'csv' | 'dxf';

const TITLES: Record<ExportKind, { title: string; description: string }> = {
  png: { title: 'Export PNG image', description: 'A high-resolution picture of the plan, rendered from the geometry.' },
  svg: { title: 'Export SVG vector plan', description: 'A scalable vector drawing for editing in Illustrator, Inkscape or a browser.' },
  pdf: { title: 'Export printable PDF', description: 'A to-scale floor plan with title block, legend, measurements, date and notes.' },
  csv: { title: 'Export CSV inventory', description: 'One row per item: object, category, size, position, rotation, mobile, notes.' },
  dxf: { title: 'Export DXF drawing', description: 'Walls, object footprints and dimensions on separate layers for CAD tools.' },
};

function useDataUrl(svg: string | null) {
  return useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg]);
}

export function ExportDialog({ kind, ctx, onDone }: { kind: ExportKind; ctx: ExportContext; onDone(): void }) {
  const { project } = ctx;
  const [prefs, setPrefs] = useState<ExportPrefs>(() => readExportPrefs(project));
  const [scenarioId, setScenarioId] = useState(ctx.scenarioId);
  const [dxfUnits, setDxfUnits] = useState<'in' | 'mm'>(project.settings.unitSystem === 'imperial' ? 'in' : 'mm');
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<ExportPrefs>) => setPrefs((cur) => ({ ...cur, ...p }));
  const imperial = project.settings.unitSystem === 'imperial';
  const scenario = project.scenarios.find((s) => s.id === scenarioId) ?? project.scenarios[0]!;
  const usesSheet = kind === 'pdf' || (kind === 'png' && prefs.pngContent === 'sheet');
  const usesToggles = kind !== 'csv';

  const preview = useMemo(() => {
    try {
      if (kind === 'csv') return null;
      if (usesSheet) return sheetFor(project, prefs, scenarioId);
      return planSvgFor(project, prefs, scenarioId, kind !== 'dxf');
    } catch {
      return null;
    }
  }, [kind, usesSheet, project, prefs, scenarioId]);
  const src = useDataUrl(preview?.svg ?? null);
  const sheetInfo = preview && 'scale' in preview ? preview : null;
  const pngPixels =
    kind === 'png' && preview
      ? 'widthPx' in preview
        ? pngSize({ width: preview.widthPx, height: preview.heightPx }, prefs.dpi)
        : { width: Math.round((preview.widthMm / 25.4) * prefs.dpi), height: Math.round((preview.heightMm / 25.4) * prefs.dpi) }
      : null;

  const run = async () => {
    setBusy(true);
    const base = fileBase(project, scenario.name);
    try {
      let blob: Blob;
      let name: string;
      switch (kind) {
        case 'png':
          blob = await exportPng(project, prefs, scenarioId);
          name = `${base}.png`;
          break;
        case 'svg':
          blob = new Blob([planSvgFor(project, prefs, scenarioId).svg], { type: 'image/svg+xml' });
          name = `${base}.svg`;
          break;
        case 'pdf':
          blob = await exportPdf(project, prefs, scenarioId);
          name = `${base}.pdf`;
          break;
        case 'csv':
          blob = new Blob([inventoryCsv(project, scenarioId)], { type: 'text/csv;charset=utf-8' });
          name = `${base}-inventory.csv`;
          break;
        case 'dxf':
          blob = new Blob([projectToDxf(project, makeFormatters(project.settings).length, { ...planOptionsFrom(prefs.toggles, scenarioId), units: dxfUnits })], { type: 'application/dxf' });
          name = `${base}.dxf`;
          break;
      }
      downloadBlob(blob, name);
      saveExportPrefs(project, prefs);
      uiActions.flash(`Exported ${name}`);
      onDone();
    } catch (e) {
      uiActions.flash(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const t = TITLES[kind];
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="w-[min(94vw,880px)]" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[260px_1fr] gap-5">
          <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1 text-xs">
            <Field label="Layout">
              <Select ariaLabel="Layout to export" value={scenarioId} onValueChange={setScenarioId} options={project.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
            {kind === 'png' && (
              <>
                <Field label="Content">
                  <Select
                    ariaLabel="PNG content"
                    value={prefs.pngContent}
                    onValueChange={(v) => patch({ pngContent: v as ExportPrefs['pngContent'] })}
                    options={[
                      { value: 'plan', label: 'Plan with legend' },
                      { value: 'sheet', label: 'Printable sheet (paper size)' },
                    ]}
                  />
                </Field>
                <Field label="Resolution">
                  <Select ariaLabel="Resolution" value={String(prefs.dpi)} onValueChange={(v) => patch({ dpi: Number(v) })} options={[96, 150, 300, 600].map((d) => ({ value: String(d), label: `${d} DPI` }))} />
                </Field>
                {pngPixels && (
                  <p className="text-2xs text-ink-faint" data-testid="png-size">
                    {pngPixels.width} × {pngPixels.height} px
                  </p>
                )}
              </>
            )}
            {usesSheet && (
              <>
                <Field label="Paper">
                  <Select ariaLabel="Paper size" value={prefs.paper} onValueChange={(v) => patch({ paper: v as PaperId })} options={Object.entries(PAPER_SIZES).map(([id, p]) => ({ value: id, label: p.label }))} />
                </Field>
                <Field label="Orientation">
                  <Select ariaLabel="Orientation" value={prefs.orientation} onValueChange={(v) => patch({ orientation: v as ExportPrefs['orientation'] })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
                </Field>
                <Field label="Scale">
                  <Select
                    ariaLabel="Scale"
                    value={String(prefs.scale)}
                    onValueChange={(v) => patch({ scale: Number(v) })}
                    options={[{ value: '0', label: 'Fit to page' }, ...scaleList(project).map((s) => ({ value: String(s.denom), label: describeScale(s, imperial) }))]}
                  />
                </Field>
                {sheetInfo && (
                  <p className={cn('text-2xs', sheetInfo.clipped ? 'text-warn' : 'text-ink-faint')} data-testid="sheet-scale">
                    {sheetInfo.clipped ? '⚠ The plan does not fit this page at ' : 'Prints at '}
                    {describeScale(sheetInfo.scale, imperial)}
                  </p>
                )}
              </>
            )}
            {kind === 'dxf' && (
              <Field label="Units">
                <Select ariaLabel="DXF units" value={dxfUnits} onValueChange={(v) => setDxfUnits(v as 'in' | 'mm')} options={[{ value: 'in', label: 'Inches' }, { value: 'mm', label: 'Millimeters' }]} />
              </Field>
            )}
            {usesToggles && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="panel-heading mb-1">Show</legend>
                {TOGGLE_LABELS.filter((x) => !(kind === 'dxf' && (x.key === 'monochrome' || x.key === 'grid'))).map(({ key, label }) => (
                  <label key={key} className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">{label}</span>
                    <Switch checked={prefs.toggles[key]} onCheckedChange={(v) => patch({ toggles: { ...prefs.toggles, [key]: v } })} data-testid={`export-toggle-${key}`} aria-label={label} />
                  </label>
                ))}
                {kind === 'pdf' && (
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-ink-muted">Legend</span>
                    <Switch checked={prefs.legend} onCheckedChange={(v) => patch({ legend: v })} aria-label="Legend" />
                  </label>
                )}
              </fieldset>
            )}
            {kind === 'pdf' && (
              <Field label="Notes (optional)">
                <Textarea rows={3} value={prefs.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="e.g. Move the planer before Saturday." aria-label="Notes" data-testid="export-notes" />
              </Field>
            )}
          </div>
          <div className="flex min-h-[320px] items-center justify-center rounded-md border border-line bg-[#8a8f95] p-3">
            {kind === 'csv' ? (
              <p className="max-w-72 text-center text-xs text-white">
                {scenario.objects.length + scenario.vehicles.length} rows · columns: Object, Category, Width, Depth, Height, X, Y, Rotation, Mobile, Notes ({imperial ? 'inches' : project.settings.metricUnit}).
              </p>
            ) : src ? (
              <img src={src} alt="Export preview" className="max-h-[58vh] max-w-full bg-white shadow-lg" data-testid="export-preview" />
            ) : (
              <p className="text-xs text-white">Preview unavailable.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy} data-testid="export-submit">
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Export {kind.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
