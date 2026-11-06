/**
 * Debounced autosave of the active project + periodic automatic snapshots.
 *
 * Status (for the non-intrusive indicator): 'saved' | 'saving' | 'unsaved' | 'error'.
 */
import { create } from 'zustand';
import { useProjectStore } from '@/stores/projectStore';
import type { Project } from '@/domain/schema';
import type { ProjectRepository } from './repository';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export interface PersistenceState {
  status: SaveStatus;
  lastSavedAt: string | null;
  error: string | null;
}

export const usePersistenceStore = create<PersistenceState>()(() => ({ status: 'saved', lastSavedAt: null, error: null }));

export interface AutosaveOptions {
  /** Debounce for a discrete command (typing a value, a nudge, a menu action). Default 300 ms. */
  debounceMs?: number;
  /** Debounce while a gesture (drag) is open; those commit continuously. Default 800 ms. */
  gestureDebounceMs?: number;
  /** Take an automatic snapshot at most this often while editing (ms). Default 10 minutes. */
  snapshotIntervalMs?: number;
  /** …or after this many saved changes since the last snapshot. Default 150. */
  snapshotEveryChanges?: number;
}

export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private saving: Promise<void> | null = null;
  private pending = false;
  private lastSnapshotAt = 0;
  private changesSinceSnapshot = 0;
  private readonly debounceMs: number;
  private readonly gestureDebounceMs: number;
  private readonly snapshotIntervalMs: number;
  private readonly snapshotEveryChanges: number;

  constructor(
    private readonly repo: ProjectRepository,
    options: AutosaveOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? 300;
    this.gestureDebounceMs = options.gestureDebounceMs ?? Math.max(options.debounceMs ?? 0, 800);
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 10 * 60 * 1000;
    this.snapshotEveryChanges = options.snapshotEveryChanges ?? 150;
  }

  start(): void {
    this.stop();
    this.lastSnapshotAt = Date.now();
    this.changesSinceSnapshot = 0;
    usePersistenceStore.setState({ status: 'saved', error: null });
    this.unsubscribe = useProjectStore.subscribe((s, prev) => {
      if (s.project && s.changeCounter !== prev.changeCounter && s.project !== prev.project) {
        this.changesSinceSnapshot++;
        this.schedule();
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    usePersistenceStore.setState({ status: 'unsaved' });
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    // A drag commits many times a second, so it keeps the longer debounce; everything else is a
    // discrete change and is written quickly, so closing the tab loses nothing.
    const delay = useProjectStore.getState().gesture ? this.gestureDebounceMs : this.debounceMs;
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Save now if there are unsaved changes (awaits an in-flight save first). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) await this.saving;
    if (!this.pending) return;
    const project = useProjectStore.getState().project;
    if (!project) return;
    this.pending = false;
    usePersistenceStore.setState({ status: 'saving' });
    this.saving = this.save(project).finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async save(project: Project): Promise<void> {
    try {
      await this.repo.saveProject(project);
      const now = Date.now();
      if (now - this.lastSnapshotAt >= this.snapshotIntervalMs || this.changesSinceSnapshot >= this.snapshotEveryChanges) {
        await this.repo.createSnapshot(project, 'auto');
        this.lastSnapshotAt = now;
        this.changesSinceSnapshot = 0;
      }
      usePersistenceStore.setState({
        status: this.pending ? 'unsaved' : 'saved',
        lastSavedAt: new Date().toISOString(),
        error: null,
      });
    } catch (e) {
      this.pending = true;
      usePersistenceStore.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  get hasPendingChanges(): boolean {
    return this.pending || this.saving !== null;
  }
}
