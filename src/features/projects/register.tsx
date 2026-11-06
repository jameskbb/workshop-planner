/**
 * Project-level UI: home button, project name + save status, the Project sidebar section
 * (details, layouts), JSON export, backups.
 */
import { ArchiveRestore, Check, ChevronLeft, CircleAlert, Copy, Download, FileJson, FolderKanban, Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { exportFormats, paletteCommands, sidebarSections, toolbarItems, type ExportContext } from '@/app/registry';
import { goHome, openProjectSession, services } from '@/app/services';
import { BackupsDialog } from '@/app/home/BackupsDialog';
import { RenameDialog } from '@/app/home/RenameDialog';
import { ToolbarButton, ToolbarLabel, Section } from '@/components/shell';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Textarea, Tip } from '@/components/ui';
import { projectFileName, serializeProject } from '@/domain/serialization';
import { area } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { usePersistenceStore } from '@/persistence';
import { closeProject, dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { downloadBlob } from '@/utils/download';
import { relativeTime } from '@/utils/time';
import { ScenarioManager } from '@/features/scenarios/manager';
import { cn } from '@/utils/cn';

// ───────────── toolbar: home, name, save status ─────────────

function SaveStatus() {
  const { status, lastSavedAt, error } = usePersistenceStore();
  const map = {
    saved: { icon: Check, text: 'Saved', cls: 'text-ink-faint' },
    saving: { icon: Loader2, text: 'Saving…', cls: 'text-ink-muted' },
    unsaved: { icon: Save, text: 'Unsaved changes', cls: 'text-ink-muted' },
    error: { icon: CircleAlert, text: 'Not saved', cls: 'text-danger' },
  } as const;
  const m = map[status];
  const Icon = m.icon;
  return (
    <Tip content={error ?? (lastSavedAt ? `Saved to this browser ${relativeTime(lastSavedAt)}` : 'Changes save automatically')}>
      <span className={cn('flex items-center gap-1 text-2xs', m.cls)} role="status" aria-live="polite" data-testid="save-status">
        <Icon className={cn('size-3', status === 'saving' && 'animate-spin')} />
        <ToolbarLabel>{m.text}</ToolbarLabel>
      </span>
    </Tip>
  );
}

function ProjectTitle() {
  const name = useProjectStore((s) => s.project?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ToolbarButton icon={ChevronLeft} label="All projects" onClick={() => void goHome()} testId="go-home" />
      <button
        type="button"
        className="max-w-64 truncate rounded px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:bg-panel-3 @max-[1800px]/toolbar:max-w-40"
        onClick={() => setRenaming(true)}
        title="Rename project"
        data-testid="project-title"
      >
        {name}
      </button>
      <SaveStatus />
      {renaming && (
        <RenameDialog
          open
          title="Rename project"
          initial={name}
          onOpenChange={(o) => !o && setRenaming(false)}
          onSubmit={(n) => void dispatch({ type: 'project.rename', payload: { name: n } })}
        />
      )}
    </div>
  );
}
toolbarItems.register({ id: 'projects.title', group: 'left', order: 10, component: ProjectTitle });

// ───────────── export ─────────────

async function exportJson(ctx: ExportContext) {
  return { blob: new Blob([serializeProject(ctx.project)], { type: 'application/json' }), fileName: projectFileName(ctx.project) };
}

exportFormats.register({
  id: 'json',
  label: 'Project file (JSON)',
  description: 'Full editable backup of the whole project, all layouts included.',
  extension: 'json',
  icon: FileJson,
  order: 10,
  export: exportJson,
});

function ExportMenu() {
  const formats = exportFormats.useItems();
  const project = useProjectStore((s) => s.project);
  const [custom, setCustom] = useState<string | null>(null);
  if (!project) return null;
  const ctx: ExportContext = { project, scenarioId: project.activeScenarioId };
  const run = async (id: string) => {
    const f = formats.find((x) => x.id === id);
    if (!f) return;
    if (f.customUi) return setCustom(id);
    try {
      const { blob, fileName } = await f.export(ctx);
      downloadBlob(blob, fileName);
      uiActions.flash(`Exported ${fileName}`);
    } catch (e) {
      uiActions.flash(`Export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };
  const Custom = custom ? formats.find((f) => f.id === custom)?.customUi : undefined;
  return (
    <>
      <DropdownMenu>
        <Tip content="Export">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Export" data-testid="export-menu">
              <Download /> <ToolbarLabel>Export</ToolbarLabel>
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="end" className="w-72">
          {formats.map((f) => {
            const Icon = f.icon ?? Download;
            return (
              <DropdownMenuItem key={f.id} onSelect={() => void run(f.id)} className="h-auto py-1.5" data-testid={`export-${f.id}`}>
                <Icon className="mt-0.5 self-start" />
                <div>
                  <div>{f.label}</div>
                  <div className="text-2xs text-ink-faint">{f.description}</div>
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {Custom && <Custom ctx={ctx} onDone={() => setCustom(null)} />}
    </>
  );
}
toolbarItems.register({ id: 'projects.export', group: 'right', order: 50, component: ExportMenu });

// ───────────── sidebar: Project section ─────────────

function ProjectPanel() {
  const project = useProjectStore((s) => s.project);
  const fmt = useFormatters();
  const [backups, setBackups] = useState(false);
  if (!project) return null;
  const poly = project.room.vertices;
  const roomArea = poly.length >= 3 ? area(poly) : 0;

  return (
    <div>
      <Section title="Details">
        <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-xs">
          <dt className="text-ink-muted">Floor area</dt>
          <dd className="num">{roomArea ? fmt.area(roomArea) : 'No room yet'}</dd>
          <dt className="text-ink-muted">Walls</dt>
          <dd className="num">{project.room.walls.length}</dd>
          <dt className="text-ink-muted">Ceiling</dt>
          <dd className="num">{fmt.length(project.room.ceilingHeight)}</dd>
          <dt className="text-ink-muted">Modified</dt>
          <dd>{relativeTime(project.updatedAt)}</dd>
        </dl>
        <Textarea
          className="mt-3 text-xs"
          placeholder="Project notes…"
          aria-label="Project notes"
          defaultValue={project.notes}
          key={project.id}
          onBlur={(e) => e.target.value !== project.notes && dispatch({ type: 'project.setNotes', payload: { notes: e.target.value } })}
        />
      </Section>
      <Section title="Layouts">
        <ScenarioManager />
      </Section>
      <Section title="Backups" defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="outline" onClick={() => void saveBackup()}>
            <Save /> Save a backup now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBackups(true)}>
            <ArchiveRestore /> Restore a backup…
          </Button>
        </div>
      </Section>
      <BackupsDialog
        open={backups}
        onOpenChange={setBackups}
        projectId={project.id}
        onRestored={async (name, id) => {
          // Reload the restored version into the editor (history starts fresh).
          closeProject();
          await openProjectSession(id);
          uiActions.flash(`Restored "${name}" from a backup.`);
        }}
      />
    </div>
  );
}

function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) if (!existing.includes(`${base} ${i}`)) return `${base} ${i}`;
}

async function saveBackup() {
  const p = useProjectStore.getState().project;
  if (!p) return;
  try {
    await services.autosave.flush();
    await services.repo.createSnapshot(p, 'manual');
    uiActions.flash('Backup saved.');
  } catch (e) {
    uiActions.flash(`Backup failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

sidebarSections.register({ id: 'project', title: 'Project', icon: FolderKanban, order: 10, component: ProjectPanel });

// ───────────── palette ─────────────
paletteCommands.register({ id: 'projects.home', title: 'Go to all projects', section: 'Project', icon: ChevronLeft, when: (c) => !!c.project, run: () => void goHome() });
paletteCommands.register({
  id: 'projects.duplicate-layout',
  title: 'Duplicate layout',
  section: 'Layouts',
  icon: Copy,
  keywords: ['scenario', 'copy', 'alternative'],
  when: (c) => !!c.project,
  run: (c) => {
    const p = c.project!;
    const active = p.scenarios.find((s) => s.id === p.activeScenarioId)!;
    dispatch({ type: 'scenario.duplicate', payload: { name: uniqueName(`${active.name} (copy)`, p.scenarios.map((s) => s.name)) } });
  },
});
paletteCommands.register({
  id: 'projects.export-json',
  title: 'Export project file (JSON)',
  section: 'Export',
  icon: FileJson,
  when: (c) => !!c.project,
  run: (c) => {
    downloadBlob(new Blob([serializeProject(c.project!)], { type: 'application/json' }), projectFileName(c.project!));
  },
});
paletteCommands.register({ id: 'projects.backup', title: 'Save a backup now', section: 'Project', icon: Save, when: (c) => !!c.project, run: () => void saveBackup() });
