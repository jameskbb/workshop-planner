/**
 * Layout (scenario) management: list with fast switching, create from the current arrangement or
 * blank (the room and fixed features are always shared), rename with a description, reorder,
 * delete with confirmation (a backup snapshot is saved first), and "Compare".
 */
import { ArrowDown, ArrowUp, Columns2, Copy, FilePlus2, Layers3, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { services } from '@/app/services';
import { RenameDialog } from '@/app/home/RenameDialog';
import { Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Kbd, Tip } from '@/components/ui';
import type { Project } from '@/domain/schema';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { useCompareStore } from './compareStore';

export function uniqueName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) if (!existing.includes(`${base} ${i}`)) return `${base} ${i}`;
}

/** Duplicate a layout's arrangement (room geometry is shared, so it is preserved) and switch to it. */
export function duplicateLayout(project: Project, sourceId: string): void {
  const src = project.scenarios.find((s) => s.id === sourceId);
  if (!src) return;
  const r = dispatch({ type: 'scenario.duplicate', payload: { sourceId, id: newId(), name: uniqueName(`${src.name} (copy)`, project.scenarios.map((s) => s.name)) } });
  if (r.ok) uiActions.flash(`Created a copy of "${src.name}". The original is unchanged.`);
}

/** A new empty layout in the same room. */
export function createBlankLayout(project: Project): void {
  const letter = String.fromCharCode(65 + (project.scenarios.length % 26));
  const r = dispatch({ type: 'scenario.create', payload: { id: newId(), name: uniqueName(`Layout ${letter}`, project.scenarios.map((s) => s.name)) } });
  if (r.ok) uiActions.flash('New empty layout: same room and fixed features, nothing placed yet.');
}

/** Switch to the next/previous layout (wraps). */
export function switchLayout(delta: number): void {
  const p = useProjectStore.getState().project;
  if (!p || p.scenarios.length < 2) return;
  const i = p.scenarios.findIndex((s) => s.id === p.activeScenarioId);
  const next = p.scenarios[(i + delta + p.scenarios.length) % p.scenarios.length]!;
  dispatch({ type: 'scenario.setActive', payload: { scenarioId: next.id } });
  uiActions.flash(`Layout: ${next.name}`);
}

export function openCompare(ids?: string[]): void {
  const p = useProjectStore.getState().project;
  if (!p) return;
  const chosen = ids ?? [p.activeScenarioId, ...p.scenarios.filter((s) => s.id !== p.activeScenarioId).map((s) => s.id)].slice(0, Math.min(3, p.scenarios.length));
  useCompareStore.setState({ ids: chosen });
  uiActions.setView('compare');
}

function move(project: Project, id: string, delta: number): void {
  const order = project.scenarios.map((s) => s.id);
  const i = order.indexOf(id);
  const j = i + delta;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j]!, order[i]!];
  dispatch({ type: 'scenario.reorder', payload: { order } });
}

export function ScenarioManager() {
  const project = useProjectStore((s) => s.project);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  if (!project) return null;
  return (
    <div data-testid="scenario-manager">
      <ul className="space-y-0.5" aria-label="Layouts">
        {project.scenarios.map((s, i) => {
          const active = s.id === project.activeScenarioId;
          return (
            <li key={s.id} className={cn('group flex items-center gap-1 rounded-md pr-1', active ? 'bg-select/15' : 'hover:bg-panel-2')}>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                aria-current={active}
                onClick={() => dispatch({ type: 'scenario.setActive', payload: { scenarioId: s.id } })}
                data-testid="layout-item"
                title={s.description || undefined}
              >
                <Layers3 className={cn('size-3.5 shrink-0', active ? 'text-select' : 'text-ink-faint')} />
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13px]', active ? 'text-ink' : 'text-ink-muted')}>
                    {s.name}
                    {active && <span className="sr-only"> (active)</span>}
                  </span>
                  <span className="block text-2xs text-ink-faint">
                    {s.objects.length} objects{s.vehicles.length ? ` · ${s.vehicles.length} vehicle${s.vehicles.length > 1 ? 's' : ''}` : ''}
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`Layout actions for ${s.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => duplicateLayout(project, s.id)}>
                    <Copy /> Duplicate layout
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenaming({ id: s.id, name: s.name })}>
                    <Pencil /> Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === 0} onSelect={() => move(project, s.id, -1)}>
                    <ArrowUp /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={i === project.scenarios.length - 1} onSelect={() => move(project, s.id, 1)}>
                    <ArrowDown /> Move down
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={project.scenarios.length < 2} onSelect={() => openCompare([project.activeScenarioId === s.id ? s.id : project.activeScenarioId, ...(project.activeScenarioId === s.id ? project.scenarios.filter((x) => x.id !== s.id).slice(0, 1).map((x) => x.id) : [s.id])])}>
                    <Columns2 /> Compare with active
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive disabled={project.scenarios.length <= 1} onSelect={() => setDeleting({ id: s.id, name: s.name })}>
                    <Trash2 className="!text-danger" /> Delete…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" onClick={() => duplicateLayout(project, project.activeScenarioId)} data-testid="duplicate-layout">
          <Copy /> From current
        </Button>
        <Button size="sm" variant="outline" onClick={() => createBlankLayout(project)} data-testid="new-blank-layout">
          <FilePlus2 /> Blank
        </Button>
        <Button size="sm" variant="outline" className="col-span-2" disabled={project.scenarios.length < 2} onClick={() => openCompare()} data-testid="compare-layouts">
          <Columns2 /> Compare side by side
        </Button>
      </div>
      <p className="mt-2 text-2xs text-ink-faint">
        Layouts share the room and fixed features; each keeps its own arrangement. Switch with <Kbd>[</Kbd> <Kbd>]</Kbd>.
      </p>
      {renaming && (
        <RenameDialog
          open
          title="Rename layout"
          initial={renaming.name}
          onOpenChange={(o) => !o && setRenaming(null)}
          onSubmit={(name) => void dispatch({ type: 'scenario.rename', payload: { scenarioId: renaming.id, name } })}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete layout "${deleting?.name}"?`}
        description="Its arrangement is removed from the project. You can undo this, and a backup is saved first."
        confirmLabel="Delete layout"
        destructive
        onConfirm={() => {
          const s = deleting;
          setDeleting(null);
          if (!s) return;
          void (async () => {
            const p = useProjectStore.getState().project;
            if (p) await services.repo.createSnapshot(p, 'before-destructive', `Before deleting layout "${s.name}"`).catch(() => undefined);
            dispatch({ type: 'scenario.delete', payload: { scenarioId: s.id } });
          })();
        }}
      />
    </div>
  );
}

/** Toolbar layout switcher (replaces the editor's basic one): switch, create, compare, manage. */
export function LayoutSwitcher() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const active = project.scenarios.find((s) => s.id === project.activeScenarioId);
  return (
    <DropdownMenu>
      <Tip content="Layout alternatives ([ and ] switch)">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-48 @max-[1800px]/toolbar:max-w-32" aria-label="Layouts" data-testid="layout-switcher">
            <Layers3 /> <span className="truncate">{active?.name}</span>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent className="w-64">
        <div className="px-2 py-1 panel-heading">Layouts</div>
        {project.scenarios.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => dispatch({ type: 'scenario.setActive', payload: { scenarioId: s.id } })} data-testid="switcher-layout">
            <Layers3 className={cn(s.id === project.activeScenarioId ? 'text-select' : 'text-ink-faint')} />
            <span className="truncate">{s.name}</span>
            {s.id === project.activeScenarioId && <span className="ml-auto text-2xs text-select">active</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => duplicateLayout(project, project.activeScenarioId)}>
          <Copy /> New from current layout
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => createBlankLayout(project)}>
          <FilePlus2 /> New blank layout
        </DropdownMenuItem>
        <DropdownMenuItem disabled={project.scenarios.length < 2} onSelect={() => openCompare()}>
          <Columns2 /> Compare side by side
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => uiActions.setLeftSection('project')}>Manage layouts…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
