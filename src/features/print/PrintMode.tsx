/**
 * Print mode: a clean, to-scale printable sheet with toggles (grid, measurements, labels,
 * clearances, zones, vehicle, electrical, lighting, monochrome), paper sizes, orientation and
 * fit-to-page or a fixed scale. Printing uses the browser's print dialog with `@media print` rules
 * (print.css) so only the sheet is printed.
 */
import { Printer, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { Button, Select, Switch, Textarea } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { readExportPrefs, saveExportPrefs, TOGGLE_LABELS, type ExportPrefs } from '@/features/exports/prefs';
import { sheetFor } from '@/features/exports/render';
import { PAPER_SIZES, describeScale, paperSize, scaleList, type PaperId } from '@/features/exports/sheet';
import './print.css';

export const usePrintMode = create<{ open: boolean }>(() => ({ open: false }));
export const openPrintMode = () => usePrintMode.setState({ open: true });
export const closePrintMode = () => usePrintMode.setState({ open: false });

/** Print just the sheet: set the page size, mark the body, print, restore. */
function printSheet(widthMm: number, heightMm: number) {
  const style = document.createElement('style');
  style.textContent = `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`;
  document.head.appendChild(style);
  document.body.classList.add('wp-printing');
  const cleanup = () => {
    document.body.classList.remove('wp-printing');
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Some browsers print synchronously and never fire afterprint.
  setTimeout(cleanup, 1000);
}

export function PrintMode() {
  const open = usePrintMode((s) => s.open);
  const projectId = useProjectStore((s) => s.project?.id);
  if (!open || !projectId) return null;
  return createPortal(<PrintModeBody key={projectId} />, document.body);
}

function PrintModeBody() {
  const project = useProjectStore((s) => s.project)!;
  const [prefs, setPrefs] = useState<ExportPrefs>(() => readExportPrefs(project));
  const [scenarioId, setScenarioId] = useState(project.activeScenarioId);
  const patch = (p: Partial<ExportPrefs>) => setPrefs((c) => ({ ...c, ...p }));
  const imperial = project.settings.unitSystem === 'imperial';
  const sheet = useMemo(() => sheetFor(project, prefs, scenarioId), [project, prefs, scenarioId]);
  const size = paperSize(prefs.paper, prefs.orientation);

  // Remember the choices (per project) when print mode closes.
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);
  useEffect(
    () => () => {
      const p = useProjectStore.getState().project;
      if (p) saveExportPrefs(p, latest.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePrintMode();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="wp-print-root fixed inset-0 z-[70] flex bg-app" role="dialog" aria-label="Print mode" data-testid="print-mode">
      <aside className="wp-print-chrome flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-panel p-4 text-xs">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Print</h2>
          <Button variant="ghost" size="icon-sm" onClick={closePrintMode} aria-label="Close print mode" data-testid="print-close">
            <X />
          </Button>
        </div>
        <Labeled label="Layout">
          <Select ariaLabel="Layout to print" value={scenarioId} onValueChange={setScenarioId} options={project.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
        </Labeled>
        <Labeled label="Paper">
          <Select ariaLabel="Paper size" value={prefs.paper} onValueChange={(v) => patch({ paper: v as PaperId })} options={Object.entries(PAPER_SIZES).map(([id, p]) => ({ value: id, label: p.label }))} />
        </Labeled>
        <Labeled label="Orientation">
          <Select
            ariaLabel="Orientation"
            value={prefs.orientation}
            onValueChange={(v) => patch({ orientation: v as ExportPrefs['orientation'] })}
            options={[
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </Labeled>
        <Labeled label="Scale">
          <Select
            ariaLabel="Scale"
            value={String(prefs.scale)}
            onValueChange={(v) => patch({ scale: Number(v) })}
            options={[{ value: '0', label: 'Fit to page' }, ...scaleList(project).map((s) => ({ value: String(s.denom), label: describeScale(s, imperial) }))]}
          />
        </Labeled>
        <p className={sheet.clipped ? 'text-warn' : 'text-ink-faint'} data-testid="print-scale">
          {sheet.clipped ? '⚠ Too large for this page at ' : 'Prints at '}
          {describeScale(sheet.scale, imperial)}
        </p>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="panel-heading mb-1">Show</legend>
          {TOGGLE_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-2">
              <span className="text-ink-muted">{label}</span>
              <Switch checked={prefs.toggles[key]} onCheckedChange={(v) => patch({ toggles: { ...prefs.toggles, [key]: v } })} aria-label={label} data-testid={`print-toggle-${key}`} />
            </label>
          ))}
          <label className="flex items-center justify-between gap-2">
            <span className="text-ink-muted">Legend</span>
            <Switch checked={prefs.legend} onCheckedChange={(v) => patch({ legend: v })} aria-label="Legend" />
          </label>
        </fieldset>
        <Labeled label="Notes">
          <Textarea rows={3} value={prefs.notes} onChange={(e) => patch({ notes: e.target.value })} placeholder="Printed in the title block" aria-label="Print notes" />
        </Labeled>
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <Button variant="primary" onClick={() => printSheet(sheet.widthMm, sheet.heightMm)} data-testid="print-now">
            <Printer /> Print…
          </Button>
          <p className="text-2xs text-ink-faint">Choose “Actual size” / 100 % in the print dialog so the stated scale is accurate.</p>
        </div>
      </aside>
      <div className="wp-print-stage flex min-w-0 flex-1 items-center justify-center overflow-auto bg-[#6b7076] p-8">
        <div
          className="wp-print-sheet bg-white shadow-2xl [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          style={{ ['--wp-sheet-w' as string]: `${size.w}mm`, ['--wp-sheet-h' as string]: `${size.h}mm`, aspectRatio: `${size.w} / ${size.h}`, height: 'min(100%, calc(100vh - 4rem))', maxWidth: '100%' }}
          data-testid="print-sheet"
          // The sheet SVG comes from our own serializer (all text is XML-escaped).
          dangerouslySetInnerHTML={{ __html: sheet.svg }}
        />
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
