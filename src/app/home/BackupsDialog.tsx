/**
 * Restore an automatic/manual backup (snapshot) of any project, including deleted ones.
 */
import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { services } from '@/app/services';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, EmptyState } from '@/components/ui';
import type { SnapshotMeta } from '@/persistence';
import { relativeTime } from '@/utils/time';

export function BackupsDialog({
  open,
  onOpenChange,
  onRestored,
  projectId,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  onRestored(name: string, projectId: string): void | Promise<void>;
  /** Limit to one project's backups. */
  projectId?: string;
}) {
  const [snaps, setSnaps] = useState<SnapshotMeta[] | null>(null);
  const [live, setLive] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSnaps(null);
    void (async () => {
      try {
        const [s, projects] = await Promise.all([services.repo.listSnapshots(projectId), services.repo.listProjects()]);
        setSnaps(s);
        setLive(new Set(projects.map((p) => p.id)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setSnaps([]);
      }
    })();
  }, [open, projectId]);

  const restore = async (s: SnapshotMeta) => {
    try {
      const p = await services.projects.restoreSnapshot(s.id);
      onOpenChange(false);
      await onRestored(p.name, p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,620px)]">
        <DialogHeader>
          <DialogTitle>Restore a backup</DialogTitle>
          <DialogDescription>
            Backups are taken automatically while you work and before deleting or restoring. Restoring first backs up the current version, so nothing is lost.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="mb-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="scroll-thin max-h-[50vh] overflow-y-auto rounded-md border border-line">
          {snaps === null ? (
            <div className="h-24 animate-pulse bg-panel-2" />
          ) : snaps.length === 0 ? (
            <EmptyState icon={<History />} title="No backups yet">
              Backups appear here after you have been editing for a while, and whenever a project is deleted.
            </EmptyState>
          ) : (
            <ul>
              {snaps.map((s) => (
                <li key={s.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0" data-testid="backup-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-ink">{s.projectName}</span>
                      {!live.has(s.projectId) && <Badge tone="danger">deleted</Badge>}
                    </div>
                    <div className="text-2xs text-ink-muted">
                      {s.label} · {relativeTime(s.createdAt)} · {new Date(s.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void restore(s)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
