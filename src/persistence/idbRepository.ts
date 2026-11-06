/**
 * IndexedDB implementation of the repositories (via `idb`).
 *
 * Stores:
 *   projects      keyPath id  → Project (full document)
 *   projectIndex  keyPath id  → ProjectSummary (fast project list)
 *   snapshots     keyPath id  → Snapshot, index byProject
 *   library       keyPath id  → ObjectDefinition (custom objects, shared by all projects)
 *   settings      out-of-line → any
 *
 * Loaded projects are validated and migrated with the same pipeline as file import, so older
 * stored data upgrades transparently and corrupt data is reported instead of crashing the app.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { parseProject } from '@/domain/serialization';
import { ObjectDefinitionSchema, type ObjectDefinition, type Project } from '@/domain/schema';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import {
  RepositoryError,
  SNAPSHOT_LIMIT,
  summarizeProject,
  type ProjectSummary,
  type Repository,
  type Snapshot,
  type SnapshotMeta,
  type SnapshotReason,
} from './repository';

export const DB_NAME = 'workshop-planner';
export const DB_VERSION = 1;

interface WorkshopDB extends DBSchema {
  projects: { key: string; value: Project };
  projectIndex: { key: string; value: ProjectSummary };
  snapshots: { key: string; value: Snapshot; indexes: { byProject: string } };
  library: { key: string; value: ObjectDefinition };
  settings: { key: string; value: unknown };
}

const REASON_LABEL: Record<SnapshotReason, string> = {
  auto: 'Automatic backup',
  manual: 'Manual backup',
  'before-delete': 'Before deleting the project',
  'before-restore': 'Before restoring a backup',
  'before-import': 'Before importing',
  'before-destructive': 'Before a destructive change',
};

export class IdbRepository implements Repository {
  private dbPromise: Promise<IDBPDatabase<WorkshopDB>> | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBPDatabase<WorkshopDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<WorkshopDB>(this.dbName, DB_VERSION, {
        upgrade(db, oldVersion) {
          if (oldVersion < 1) {
            db.createObjectStore('projects', { keyPath: 'id' });
            db.createObjectStore('projectIndex', { keyPath: 'id' });
            const snaps = db.createObjectStore('snapshots', { keyPath: 'id' });
            snaps.createIndex('byProject', 'projectId');
            db.createObjectStore('library', { keyPath: 'id' });
            db.createObjectStore('settings');
          }
          // Future versions: add `if (oldVersion < 2) { … }` blocks here.
        },
        blocked() {
          console.warn('Workshop Planner database upgrade is blocked by another open tab.');
        },
      }).catch((e: unknown) => {
        this.dbPromise = null;
        throw new RepositoryError(
          'Local storage is unavailable, so projects cannot be saved in this browser (private browsing or storage disabled?).',
          [e instanceof Error ? e.message : String(e)],
        );
      });
    }
    return this.dbPromise;
  }

  /** Close the connection (tests / sign-out). */
  async close(): Promise<void> {
    if (this.dbPromise) (await this.dbPromise).close();
    this.dbPromise = null;
  }

  // ───────────────────────────── projects ─────────────────────────────

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const all = await db.getAll('projectIndex');
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const db = await this.db();
    const raw = await db.get('projects', id);
    if (!raw) return undefined;
    const r = parseProject(raw);
    if (!r.ok) throw new RepositoryError(`"${(raw as { name?: string }).name ?? 'This project'}" could not be opened: ${r.error}`, r.details);
    return r.project;
  }

  async saveProject(project: Project): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['projects', 'projectIndex'], 'readwrite');
    await Promise.all([tx.objectStore('projects').put(project), tx.objectStore('projectIndex').put(summarizeProject(project)), tx.done]);
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['projects', 'projectIndex'], 'readwrite');
    await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('projectIndex').delete(id), tx.done]);
  }

  // ───────────────────────────── snapshots ─────────────────────────────

  async createSnapshot(project: Project, reason: SnapshotReason, label?: string): Promise<SnapshotMeta> {
    const db = await this.db();
    const snap: Snapshot = {
      id: newId(),
      projectId: project.id,
      projectName: project.name,
      createdAt: nowIso(),
      seq: nextSeq(),
      reason,
      label: label ?? REASON_LABEL[reason],
      revision: project.revision,
      summary: summarizeProject(project),
      project,
    };
    await db.put('snapshots', snap);
    await this.pruneSnapshots(project.id);
    return stripProject(snap);
  }

  private async pruneSnapshots(projectId: string): Promise<void> {
    const db = await this.db();
    const metas = (await db.getAllFromIndex('snapshots', 'byProject', projectId)).sort(bySeqDesc);
    const excess = metas.slice(SNAPSHOT_LIMIT);
    if (excess.length === 0) return;
    const tx = db.transaction('snapshots', 'readwrite');
    await Promise.all([...excess.map((s) => tx.store.delete(s.id)), tx.done]);
  }

  async listSnapshots(projectId?: string): Promise<SnapshotMeta[]> {
    const db = await this.db();
    const all = projectId ? await db.getAllFromIndex('snapshots', 'byProject', projectId) : await db.getAll('snapshots');
    return all.map(stripProject).sort(bySeqDesc);
  }

  async getSnapshot(id: string): Promise<Snapshot | undefined> {
    const db = await this.db();
    const snap = await db.get('snapshots', id);
    if (!snap) return undefined;
    const r = parseProject(snap.project);
    if (!r.ok) throw new RepositoryError(`This backup could not be read: ${r.error}`, r.details);
    return { ...snap, project: r.project };
  }

  async deleteSnapshot(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('snapshots', id);
  }

  // ───────────────────────────── library ─────────────────────────────

  async listDefinitions(): Promise<ObjectDefinition[]> {
    const db = await this.db();
    const all = await db.getAll('library');
    const out: ObjectDefinition[] = [];
    for (const raw of all) {
      const r = ObjectDefinitionSchema.safeParse(raw);
      if (r.success) out.push(r.data);
      else console.warn('Skipping invalid custom object', raw);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveDefinition(def: ObjectDefinition): Promise<void> {
    const db = await this.db();
    const parsed = ObjectDefinitionSchema.parse({ ...def, source: 'custom', updatedAt: nowIso() });
    await db.put('library', parsed);
  }

  async deleteDefinition(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('library', id);
  }

  // ───────────────────────────── settings ─────────────────────────────

  async getSetting<T>(key: string): Promise<T | undefined> {
    const db = await this.db();
    return (await db.get('settings', key)) as T | undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const db = await this.db();
    await db.put('settings', value, key);
  }
}

let lastSeq = 0;
function nextSeq(): number {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
}

const bySeqDesc = (a: SnapshotMeta, b: SnapshotMeta): number => (b.seq ?? 0) - (a.seq ?? 0) || b.createdAt.localeCompare(a.createdAt);

function stripProject(s: Snapshot): SnapshotMeta {
   
  const { project: _p, ...meta } = s;
  return meta;
}
