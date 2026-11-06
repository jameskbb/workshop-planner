/**
 * Project list / home screen: create, open, duplicate, rename, delete (confirmed), export, import,
 * open the demo, and restore automatic backups.
 */
import { Copy, Download, FileUp, History, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, Warehouse } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { homePanels } from '@/app/registry';
import { openProject, services } from '@/app/services';
import { Badge, Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from '@/components/ui';
import type { ProjectSummary } from '@/persistence';
import { makeFormatters } from '@/hooks/useFormatters';
import { relativeTime } from '@/utils/time';
import { downloadText } from '@/utils/download';
import { NewProjectWizard } from './NewProjectWizard';
import { RenameDialog } from './RenameDialog';
import { BackupsDialog } from './BackupsDialog';

export function footprintSummary(p: ProjectSummary): string {
  if (p.footprint.corners < 3) return 'No room drawn yet';
  const f = makeFormatters({ unitSystem: p.unitSystem, imperialPrecision: 16, metricUnit: 'mm' });
  const size = `${f.length(p.footprint.width, { style: 'feet-inches' })} × ${f.length(p.footprint.depth, { style: 'feet-inches' })}`;
  return p.footprint.irregular ? `${size} · irregular footprint (${p.footprint.corners} corners)` : size;
}

type Notice = { tone: 'ok' | 'error'; text: string; details?: string[] } | null;

export function HomeScreen() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [backupsOpen, setBackupsOpen] = useState(false);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const extra = homePanels.useItems();

  const refresh = useCallback(async () => {
    try {
      setProjects(await services.repo.listProjects());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await services.projects.seedDemoIfFirstRun();
      } catch {
        /* storage unavailable: surfaced by refresh() */
      }
      await refresh();
    })();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setNotice({ tone: 'ok', text: ok });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
    await refresh();
  };

  const onImport = async (file: File) => {
    const text = await file.text();
    const r = await services.projects.importJson(text);
    if (!r.ok) {
      setNotice({ tone: 'error', text: `Couldn't import "${file.name}": ${r.error}`, details: r.details });
      return;
    }
    const parts = [`Imported "${r.project.name}".`];
    if (r.migratedFrom) parts.push(`It was upgraded from an older file format (v${r.migratedFrom}).`);
    if (r.renamed) parts.push('A project with the same id already existed, so this was added as a copy.');
    if (r.notes?.length) parts.push(...r.notes);
    setNotice({ tone: 'ok', text: parts.join(' ') });
    await refresh();
  };

  return (
    <div className="scroll-thin h-full overflow-y-auto bg-app" data-testid="home-screen">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-accent text-accent-ink">
              <Warehouse className="size-5" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-ink">Workshop Planner</h1>
              <p className="text-[13px] text-ink-muted">Model your real garage. Know the layout works before you move a 300 lb cabinet.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setBackupsOpen(true)} data-testid="open-backups">
              <History /> Restore backup
            </Button>
            <Button variant="outline" onClick={() => fileInput.current?.click()} data-testid="import-project">
              <FileUp /> Import
            </Button>
            <Button variant="outline" onClick={() => void act(async () => openProject((await services.projects.createDemo()).id))} data-testid="open-demo">
              <Sparkles /> Open demo
            </Button>
            <Button variant="primary" onClick={() => setNewOpen(true)} data-testid="new-project">
              <Plus /> New project
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              data-testid="import-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onImport(f);
              }}
            />
          </div>
        </header>

        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-md border px-3 py-2 text-[13px] ${notice.tone === 'error' ? 'border-danger/40 bg-danger/10 text-ink' : 'border-ok/40 bg-ok/10 text-ink'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{notice.text}</span>
              <button type="button" className="text-xs text-ink-muted hover:text-ink" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
            {notice.details && notice.details.length > 0 && (
              <ul className="num mt-1.5 list-disc pl-5 text-2xs text-ink-muted">
                {notice.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loadError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px]">
            {loadError}
          </div>
        )}

        <section aria-label="Projects" className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,2.4fr)_100px_120px_40px] items-center gap-3 border-b border-line px-4 py-2 panel-heading">
            <span>Project</span>
            <span>Footprint</span>
            <span>Layouts</span>
            <span>Last modified</span>
            <span />
          </div>
          {projects === null ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-panel-2" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState
              icon={<Warehouse />}
              title="No projects yet"
              action={
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => setNewOpen(true)}>
                    <Plus /> New project
                  </Button>
                  <Button variant="outline" onClick={() => void act(async () => openProject((await services.projects.createDemo()).id))}>
                    <Sparkles /> Open the demo garage
                  </Button>
                </div>
              }
            >
              Start from your garage's measurements, or explore the demo two-car garage to see what the planner can do.
            </EmptyState>
          ) : (
            <ul>
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="group grid cursor-default grid-cols-[minmax(0,1.6fr)_minmax(0,2.4fr)_100px_120px_40px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-panel-2"
                  onDoubleClick={() => openProject(p.id)}
                  data-testid="project-row"
                >
                  <button type="button" className="min-w-0 text-left" onClick={() => openProject(p.id)} aria-label={`Open ${p.name}`}>
                    <div className="truncate text-[13px] font-medium text-ink group-hover:text-accent-strong">{p.name}</div>
                    <div className="text-2xs text-ink-faint">
                      {p.objectCount} object{p.objectCount === 1 ? '' : 's'} · {p.unitSystem}
                    </div>
                  </button>
                  <span className="num truncate text-xs text-ink-muted">{footprintSummary(p)}</span>
                  <span>
                    <Badge>
                      {p.scenarioCount} layout{p.scenarioCount === 1 ? '' : 's'}
                    </Badge>
                  </span>
                  <span className="text-xs text-ink-muted" title={new Date(p.updatedAt).toLocaleString()}>
                    {relativeTime(p.updatedAt)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${p.name}`} data-testid="project-actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openProject(p.id)}>Open</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRenaming(p)}>
                        <Pencil /> Rename…
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void act(() => services.projects.duplicate(p.id), `Duplicated "${p.name}".`)}>
                        <Copy /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          void act(async () => {
                            const { fileName, json } = await services.projects.exportJson(p.id);
                            downloadText(json, fileName, 'application/json');
                          })
                        }
                      >
                        <Download /> Export JSON
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(p)}>
                        <Trash2 className="!text-danger" /> Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </section>

        {extra.map((x) => (
          <x.component key={x.id} />
        ))}

        <p className="text-2xs text-ink-faint">
          Projects are stored in this browser (IndexedDB) and saved automatically. Export a JSON backup to move a project to another computer.
        </p>
      </div>

      <NewProjectWizard open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => openProject(id)} />
      <BackupsDialog
        open={backupsOpen}
        onOpenChange={setBackupsOpen}
        onRestored={async (name) => {
          setNotice({ tone: 'ok', text: `Restored "${name}" from a backup.` });
          await refresh();
        }}
      />
      {renaming && (
        <RenameDialog
          open
          initial={renaming.name}
          title="Rename project"
          onOpenChange={(o) => !o && setRenaming(null)}
          onSubmit={(name) => void act(() => services.projects.rename(renaming.id, name))}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="The project is removed from this browser. A backup is kept, so you can restore it later from Restore backup."
        confirmLabel="Delete project"
        destructive
        onConfirm={() => {
          const p = deleting;
          setDeleting(null);
          if (p) void act(() => services.projects.delete(p.id), `Deleted "${p.name}". You can restore it from Restore backup.`);
        }}
      />
    </div>
  );
}
