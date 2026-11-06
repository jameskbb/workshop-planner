/**
 * High-level project operations used by the UI (project list, open/close, import/export,
 * snapshots). All storage goes through the Repository interface.
 */
import { createProject, type CreateProjectOptions } from '@/domain/factories';
import { parseProjectJson, projectFileName, serializeProject } from '@/domain/serialization';
import type { Project } from '@/domain/schema';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { createDemoProject } from '@/features/projects/demo';
import type { Repository, SnapshotMeta } from './repository';

export const SETTING_DEMO_SEEDED = 'demoSeeded';
export const SETTING_LAST_PROJECT = 'lastProjectId';

export type ImportResult =
  | { ok: true; project: Project; migratedFrom?: number; renamed: boolean; notes?: string[] }
  | { ok: false; error: string; details: string[] };

export class ProjectService {
  constructor(readonly repo: Repository) {}

  async create(options: CreateProjectOptions): Promise<Project> {
    const p = createProject(options);
    await this.repo.saveProject(p);
    return p;
  }

  /** Create and save a fresh copy of the demo garage. */
  async createDemo(): Promise<Project> {
    const p = createDemoProject();
    await this.repo.saveProject(p);
    return p;
  }

  /** First run: seed the project list with the demo once. */
  private seeding: Promise<boolean> | null = null;

  seedDemoIfFirstRun(): Promise<boolean> {
    // Concurrent callers (e.g. React StrictMode effects) share one seeding run.
    this.seeding ??= this.seedOnce().finally(() => {
      this.seeding = null;
    });
    return this.seeding;
  }

  private async seedOnce(): Promise<boolean> {
    if (await this.repo.getSetting<boolean>(SETTING_DEMO_SEEDED)) return false;
    const existing = await this.repo.listProjects();
    await this.repo.setSetting(SETTING_DEMO_SEEDED, true);
    if (existing.length > 0) return false;
    await this.createDemo();
    return true;
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.repo.getProject(id);
    if (!source) throw new Error('That project no longer exists.');
    const t = nowIso();
    const copy: Project = { ...structuredClone(source), id: newId(), name: `${source.name} (copy)`, createdAt: t, updatedAt: t, revision: 0 };
    await this.repo.saveProject(copy);
    return copy;
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty.');
    const p = await this.repo.getProject(id);
    if (!p) throw new Error('That project no longer exists.');
    await this.repo.saveProject({ ...p, name: trimmed, updatedAt: nowIso(), revision: p.revision + 1 });
  }

  /** Delete with a safety snapshot first (restorable from the backups list). */
  async delete(id: string): Promise<void> {
    const p = await this.repo.getProject(id).catch(() => undefined);
    if (p) await this.repo.createSnapshot(p, 'before-delete');
    await this.repo.deleteProject(id);
  }

  async exportJson(id: string): Promise<{ fileName: string; json: string }> {
    const p = await this.repo.getProject(id);
    if (!p) throw new Error('That project no longer exists.');
    return { fileName: projectFileName(p), json: serializeProject(p) };
  }

  /**
   * Import a project file as a NEW project (never overwrites). If a project with the same id
   * exists, the import gets a new id and "(imported)" suffix.
   */
  async importJson(text: string): Promise<ImportResult> {
    const r = parseProjectJson(text);
    if (!r.ok) return r;
    let project = r.project;
    const exists = await this.repo.getProject(project.id).catch(() => undefined);
    let renamed = false;
    if (exists) {
      project = { ...project, id: newId(), name: `${project.name} (imported)` };
      renamed = true;
    }
    await this.repo.saveProject(project);
    return { ok: true, project, migratedFrom: r.migratedFrom, renamed, notes: r.notes };
  }

  /**
   * Restore a snapshot. The project currently stored under that id (if any) is itself snapshotted
   * first, so a restore can always be undone.
   */
  async restoreSnapshot(snapshotId: string): Promise<Project> {
    const snap = await this.repo.getSnapshot(snapshotId);
    if (!snap) throw new Error('That backup no longer exists.');
    const current = await this.repo.getProject(snap.projectId).catch(() => undefined);
    if (current) await this.repo.createSnapshot(current, 'before-restore');
    const restored: Project = { ...snap.project, updatedAt: nowIso(), revision: (current?.revision ?? snap.project.revision) + 1 };
    await this.repo.saveProject(restored);
    return restored;
  }

  /** Backups of projects that no longer exist (restorable "recently deleted"). */
  async orphanedSnapshots(): Promise<SnapshotMeta[]> {
    const [snaps, projects] = await Promise.all([this.repo.listSnapshots(), this.repo.listProjects()]);
    const live = new Set(projects.map((p) => p.id));
    const latest = new Map<string, SnapshotMeta>();
    for (const s of snaps) if (!live.has(s.projectId) && !latest.has(s.projectId)) latest.set(s.projectId, s);
    return [...latest.values()];
  }
}
