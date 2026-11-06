/**
 * Inventory panel: an automatic, category-grouped list of everything in a layout with counts,
 * sizes and inventory-specific notes; printable, copyable and exportable as CSV.
 */
import { ClipboardList, Copy, FileSpreadsheet, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { Badge, Button, EmptyState, Select, Textarea, Tip } from '@/components/ui';
import type { Project } from '@/domain/schema';
import { inventoryCsv } from '@/features/exports/csv';
import { fileBase } from '@/features/exports/render';
import { esc, printDocument } from '@/features/print/printDocument';
import { makeFormatters, useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { downloadText } from '@/utils/download';
import { buildInventory, inventoryText, type InventoryLine } from './inventory';

export function printInventory(project: Project, scenarioId: string): void {
  const fmt = makeFormatters(project.settings).length;
  const inv = buildInventory(project, scenarioId);
  const scenario = project.scenarios.find((s) => s.id === scenarioId)!;
  const rows = inv.groups
    .map(
      (g) => `<h2>${esc(g.title)} · ${g.count}</h2><table><tr><th style="width:8%">Qty</th><th>Item</th><th style="width:26%">Size (W × D × H)</th><th style="width:30%">Notes</th></tr>${g.lines
        .map(
          (l) =>
            `<tr><td class="num">${l.count} ×</td><td>${esc(l.name)}${l.mobile ? '<span class="tag">mobile</span>' : ''}${l.wallMounted ? '<span class="tag">wall</span>' : ''}${
              l.instanceNames.length ? `<div class="muted">${esc(l.instanceNames.join(', '))}</div>` : ''
            }</td><td class="num">${esc(`${fmt(l.width)} × ${fmt(l.depth)} × ${fmt(l.height)}`)}</td><td>${esc(project.inventoryNotes[l.key] ?? '')}</td></tr>`,
        )
        .join('')}</table>`,
    )
    .join('');
  printDocument(
    `${project.name}: Inventory`,
    `<h1>${esc(project.name)}: Inventory</h1><div class="meta">Layout: ${esc(scenario.name)} · ${inv.total} items · ${new Date().toLocaleDateString()}</div>${rows}`,
  );
}

function NoteField({ line, note }: { line: InventoryLine; note: string }) {
  return (
    <Textarea
      key={`${line.key}:${note}`}
      defaultValue={note}
      placeholder="Inventory note (e.g. empty drawers first, sell, donate)…"
      aria-label={`Note for ${line.name}`}
      className="mt-1 min-h-0 text-xs"
      rows={1}
      data-testid="inventory-note"
      onBlur={(e) => e.target.value !== note && dispatch({ type: 'inventory.setNote', payload: { key: line.key, note: e.target.value } })}
    />
  );
}

function InventoryPanel() {
  const project = useProjectStore((s) => s.project);
  const fmt = useFormatters();
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const sid = project && scenarioId && project.scenarios.some((s) => s.id === scenarioId) ? scenarioId : (project?.activeScenarioId ?? '');
  const inv = useMemo(() => (project ? buildInventory(project, sid) : null), [project, sid]);
  if (!project || !inv) return null;
  const isActive = sid === project.activeScenarioId;
  const select = (l: InventoryLine) => {
    if (!isActive) return;
    uiActions.select(l.ids.map((id) => ({ kind: l.group === 'vehicle' ? ('vehicle' as const) : ('object' as const), id })));
  };
  return (
    <div>
      <Section title="Layout">
        <Select ariaLabel="Inventory layout" value={sid} onValueChange={setScenarioId} options={project.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
        <p className="mt-2 text-2xs text-ink-faint" data-testid="inventory-total">
          {inv.total} item{inv.total === 1 ? '' : 's'} in {inv.groups.length} categor{inv.groups.length === 1 ? 'y' : 'ies'}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => printInventory(project, sid)} data-testid="inventory-print">
            <Printer /> Print
          </Button>
          <Tip content="Copy as plain text">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(inventoryText(project, inv, fmt.length)).then(
                  () => uiActions.flash('Inventory copied.'),
                  () => uiActions.flash('Could not copy to the clipboard.', 'error'),
                );
              }}
            >
              <Copy /> Copy
            </Button>
          </Tip>
          <Button size="sm" variant="ghost" onClick={() => downloadText(inventoryCsv(project, sid), `${fileBase(project, project.scenarios.find((s) => s.id === sid)?.name)}-inventory.csv`, 'text/csv')}>
            <FileSpreadsheet /> CSV
          </Button>
        </div>
      </Section>
      {inv.groups.length === 0 ? (
        <EmptyState title="Nothing placed yet">Add objects from the library; they are listed here automatically.</EmptyState>
      ) : (
        inv.groups.map((g) => (
          <Section key={g.id} title={`${g.title} · ${g.count}`}>
            <ul className="flex flex-col gap-2">
              {g.lines.map((l) => (
                <li key={l.key} data-testid="inventory-line">
                  <button type="button" className="flex w-full items-baseline gap-2 text-left disabled:cursor-default" onClick={() => select(l)} disabled={!isActive} title={isActive ? 'Select on the plan' : undefined}>
                    <span className="num w-7 shrink-0 text-right text-xs font-semibold text-ink">{l.count}×</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{l.name}</span>
                      <span className="num block text-2xs text-ink-faint">
                        {fmt.length(l.width)} × {fmt.length(l.depth)} × {fmt.length(l.height)}
                      </span>
                      {l.instanceNames.length > 0 && <span className="block truncate text-2xs text-ink-muted">{l.instanceNames.join(', ')}</span>}
                    </span>
                    {l.mobile && g.id !== 'vehicle' && <Badge>mobile</Badge>}
                    {l.wallMounted && <Badge>wall</Badge>}
                  </button>
                  <div className="pl-9">
                    <NoteField line={l} note={project.inventoryNotes[l.key] ?? ''} />
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ))
      )}
    </div>
  );
}

sidebarSections.register({ id: 'inventory', title: 'Inventory', icon: ClipboardList, order: 86, component: InventoryPanel });
paletteCommands.register({ id: 'inventory.open', title: 'Show inventory', section: 'Inventory', icon: ClipboardList, keywords: ['list', 'items', 'count'], when: (c) => !!c.project, run: () => uiActions.setLeftSection('inventory') });
paletteCommands.register({
  id: 'inventory.print',
  title: 'Print inventory',
  section: 'Inventory',
  icon: Printer,
  when: (c) => !!c.project,
  run: (c) => printInventory(c.project!, c.project!.activeScenarioId),
});
