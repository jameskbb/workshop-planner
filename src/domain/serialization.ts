/**
 * Portable JSON project format: parsing, validation with friendly errors, and the schema
 * migration pipeline.
 *
 * File envelope (what Export writes):
 *   { "format": "workshop-planner/project", "exportedAt": "...", "project": { schemaVersion, ... } }
 * A bare project object is also accepted on import.
 */
import type { z } from 'zod';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';
import { CURRENT_SCHEMA_VERSION, ObjectImageSchema, ProjectSchema, type Project } from './schema';
import { quantize } from './units';

export const FILE_FORMAT = 'workshop-planner/project';

type Raw = Record<string, unknown>;

export interface Migration {
  from: number;
  to: number;
  description: string;
  migrate(raw: Raw): Raw;
}

/**
 * v1 → v2. Format v1 was the pre-scenario single-layout draft format: arrangement arrays lived at
 * the top level and units were a bare `units` string. v2 moved the arrangement into `scenarios`.
 * (v1 never shipped publicly; it is kept so the migration path is exercised end to end.)
 */
const v1ToV2: Migration = {
  from: 1,
  to: 2,
  description: 'Move the single layout into a scenario; units → settings.unitSystem',
  migrate(raw) {
    const {
      objects = [],
      vehicles = [],
      zones = [],
      measurements = [],
      relationships = [],
      lights = [],
      groups = [],
      units,
      settings,
      ...rest
    } = raw as Raw & { units?: string; settings?: Raw };
    const t = typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso();
    const scenarioId = newId();
    return {
      ...rest,
      schemaVersion: 2,
      settings: { ...(settings ?? {}), ...(units === 'metric' || units === 'imperial' ? { unitSystem: units } : {}) },
      scenarios: [
        {
          id: scenarioId,
          name: 'Layout A',
          createdAt: t,
          updatedAt: t,
          objects,
          vehicles,
          zones,
          measurements,
          relationships,
          lights,
          groups,
        },
      ],
      activeScenarioId: scenarioId,
    };
  },
};

/**
 * v2 → v3. The canonical lattice was refined from 0.01 mm to 0.000001 mm so that 1/16", 1/32" and
 * 1/64" are exact (R-013: on the old lattice 1/16" stored as 1.59 mm instead of 1.5875 mm, and a
 * thousand fractional nudges drifted 0.1"). Every v2 value is already ON the new lattice (0.01 is a
 * whole number of steps), so this migration only re-snaps numbers (it never moves anything by more
 * than half a step) and records the format change so older apps refuse the file.
 */
const v2ToV3: Migration = {
  from: 2,
  to: 3,
  description: 'Lengths on the finer canonical lattice (1/16", 1/32" and 1/64" are exact)',
  migrate(raw) {
    return requantizeDeep(raw) as Raw;
  },
};

function requantizeDeep(value: unknown): unknown {
  if (typeof value === 'number') return quantize(value);
  if (Array.isArray(value)) return value.map(requantizeDeep);
  if (isObject(value)) {
    const out: Raw = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'schemaVersion' ? 3 : requantizeDeep(v);
    return out;
  }
  return value;
}

/** Ordered migration registry. Add new migrations here when bumping CURRENT_SCHEMA_VERSION. */
export const MIGRATIONS: readonly Migration[] = [v1ToV2, v2ToV3];

export type ProjectParseResult =
  | { ok: true; project: Project; migratedFrom?: number; applied: string[]; notes?: string[] }
  | { ok: false; error: string; details: string[] };

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Drop object images that are not embedded image data (R-018): a project file could otherwise carry
 * a remote URL that the browser would fetch (a tracking beacon) or a multi-megabyte string. The
 * import continues without them rather than failing.
 */
function stripUnsafeImages(raw: Raw): { raw: Raw; removed: number } {
  const defs = raw.definitions;
  if (!Array.isArray(defs)) return { raw, removed: 0 };
  let removed = 0;
  const cleaned = defs.map((d) => {
    if (!isObject(d) || d.image === undefined) return d;
    if (ObjectImageSchema.safeParse(d.image).success) return d;
    removed++;
    const { image: _image, ...rest } = d;
    return rest;
  });
  return removed ? { raw: { ...raw, definitions: cleaned }, removed } : { raw, removed: 0 };
}

/** Apply migrations until the raw object reaches the current schema version. */
export function migrateRaw(raw: Raw): { ok: true; raw: Raw; from: number; applied: string[] } | { ok: false; error: string } {
  const version = raw.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'This file has no valid format version, so it is not a Workshop Planner project.' };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This project was saved by a newer version of Workshop Planner (format v${version}; this app reads up to v${CURRENT_SCHEMA_VERSION}). Update the app to open it.`,
    };
  }
  let current = raw;
  let v = version;
  const applied: string[] = [];
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS.find((x) => x.from === v);
    if (!m) return { ok: false, error: `No upgrade path from format v${v}.` };
    current = m.migrate(structuredClone(current));
    applied.push(`v${m.from}→v${m.to}: ${m.description}`);
    v = m.to;
  }
  return { ok: true, raw: current, from: version, applied };
}

/** Human-readable Zod issues ("room.vertices[2].x: Expected number, received string"). */
export function formatIssues(error: z.ZodError, limit = 6): string[] {
  const lines = error.issues.slice(0, limit).map((i) => {
    const path = i.path
      .map((p, k) => (typeof p === 'number' ? `[${p}]` : k === 0 ? String(p) : `.${String(p)}`))
      .join('');
    return path ? `${path}: ${i.message}` : i.message;
  });
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more problem(s).`);
  return lines;
}

/** Validate + migrate an already-parsed value (envelope or bare project). */
export function parseProject(value: unknown): ProjectParseResult {
  if (!isObject(value)) {
    return { ok: false, error: 'This file does not contain a Workshop Planner project (expected a JSON object).', details: [] };
  }
  let raw: Raw = value;
  if ('format' in value || 'project' in value) {
    if (value.format !== FILE_FORMAT) {
      return { ok: false, error: `Unrecognized file format "${String(value.format)}".`, details: [] };
    }
    if (!isObject(value.project)) return { ok: false, error: 'The file is missing its "project" section.', details: [] };
    raw = value.project;
  }
  if (!('schemaVersion' in raw)) {
    return {
      ok: false,
      error: "This doesn't look like a Workshop Planner project file (no format version found).",
      details: [],
    };
  }
  const migrated = migrateRaw(raw);
  if (!migrated.ok) return { ok: false, error: migrated.error, details: [] };
  const safe = stripUnsafeImages(migrated.raw);
  const parsed = ProjectSchema.safeParse(safe.raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'The project file is damaged or incomplete, so it was not imported. Nothing was changed.',
      details: formatIssues(parsed.error),
    };
  }
  return {
    ok: true,
    project: parsed.data,
    migratedFrom: migrated.from < CURRENT_SCHEMA_VERSION ? migrated.from : undefined,
    applied: migrated.applied,
    notes: safe.removed
      ? [`${safe.removed} object picture${safe.removed === 1 ? ' was' : 's were'} left out because ${safe.removed === 1 ? 'it was' : 'they were'} not embedded image data.`]
      : undefined,
  };
}

/** Parse JSON text into a validated project with friendly errors. */
export function parseProjectJson(text: string): ProjectParseResult {
  if (text.trim() === '') return { ok: false, error: 'The file is empty.', details: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: 'The file is not valid JSON, so it cannot be a project file.', details: [msg] };
  }
  return parseProject(value);
}

/** Serialize a project into the portable file envelope (pretty-printed). */
export function serializeProject(project: Project, exportedAt = nowIso()): string {
  return JSON.stringify({ format: FILE_FORMAT, exportedAt, app: 'Workshop Planner', project }, null, 2);
}

/** Suggested file name for an export. */
export function projectFileName(project: Pick<Project, 'name'>): string {
  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'project'}.workshop.json`;
}
