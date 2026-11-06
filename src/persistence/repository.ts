/**
 * Persistence contracts. The app talks ONLY to these interfaces; `IdbRepository` implements them
 * locally. A future cloud-sync implementation can wrap/replace it: every project carries a monotonic
 * `revision` and `updatedAt`, and summaries are separated from full documents.
 */
import { bbox, isConvex, type Polygon } from '@/geometry';
import type { ObjectDefinition, Project } from '@/domain/schema';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Interior bounding size in mm (0 when no room is drawn). */
  footprint: { width: number; depth: number; area: number; irregular: boolean; corners: number };
  scenarioCount: number;
  objectCount: number;
  unitSystem: 'imperial' | 'metric';
}

export type SnapshotReason = 'auto' | 'manual' | 'before-delete' | 'before-restore' | 'before-import' | 'before-destructive';

export interface SnapshotMeta {
  id: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  /** Monotonic ordering key (ms-based, strictly increasing within a session). */
  seq: number;
  reason: SnapshotReason;
  label: string;
  revision: number;
  summary: ProjectSummary;
}

export interface Snapshot extends SnapshotMeta {
  project: Project;
}

export interface ProjectRepository {
  listProjects(): Promise<ProjectSummary[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  createSnapshot(project: Project, reason: SnapshotReason, label?: string): Promise<SnapshotMeta>;
  /** Snapshots for one project (newest first), or for every project when id is omitted. */
  listSnapshots(projectId?: string): Promise<SnapshotMeta[]>;
  getSnapshot(id: string): Promise<Snapshot | undefined>;
  deleteSnapshot(id: string): Promise<void>;
}

/** Custom object definitions, shared across ALL projects. */
export interface LibraryRepository {
  listDefinitions(): Promise<ObjectDefinition[]>;
  saveDefinition(def: ObjectDefinition): Promise<void>;
  deleteDefinition(id: string): Promise<void>;
}

/** Small app-wide preferences (onboarding done, last opened project, …). */
export interface SettingsRepository {
  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

export type Repository = ProjectRepository & LibraryRepository & SettingsRepository;

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** Maximum snapshots retained per project (oldest pruned first). */
export const SNAPSHOT_LIMIT = 25;

export function summarizeProject(p: Project): ProjectSummary {
  const poly: Polygon = p.room.vertices.map((v) => ({ x: v.x, y: v.y }));
  let footprint: ProjectSummary['footprint'] = { width: 0, depth: 0, area: 0, irregular: false, corners: poly.length };
  if (poly.length >= 3) {
    const b = bbox(poly);
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const q = poly[i]!;
      const r = poly[(i + 1) % poly.length]!;
      a += q.x * r.y - r.x * q.y;
    }
    const width = b.maxX - b.minX;
    const depth = b.maxY - b.minY;
    const areaAbs = Math.abs(a / 2);
    const rectangular = poly.length === 4 && isConvex(poly) && Math.abs(areaAbs - width * depth) < 1;
    footprint = { width, depth, area: areaAbs, irregular: !rectangular, corners: poly.length };
  }
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    revision: p.revision,
    footprint,
    scenarioCount: p.scenarios.length,
    objectCount: p.scenarios.find((s) => s.id === p.activeScenarioId)?.objects.length ?? 0,
    unitSystem: p.settings.unitSystem,
  };
}
