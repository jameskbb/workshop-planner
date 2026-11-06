import { z } from 'zod';
import { normalizeAngle } from '@/geometry';
import type { Project, Scenario } from '../schema';
import { CommandError } from './registry';

/**
 * Stored rotations live in [0, 360) at 0.001° (R-003). Commands normalize instead of rejecting, so
 * "rotate by 350° five times" and a pasted 1e9 both end up as an ordinary heading.
 */
export function normalizeRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) throw new CommandError('A rotation must be a number of degrees.');
  const rounded = Math.round(normalizeAngle(degrees) * 1000) / 1000;
  return rounded >= 360 ? 0 : rounded;
}

/** Normalize `rotation` on an entity in place, when it has one. */
export function normalizeRotationOf(item: { rotation?: unknown }): void {
  if (typeof item.rotation === 'number') item.rotation = normalizeRotation(item.rotation);
}

/**
 * Patch schema for an object schema: every field optional, `.default()`s removed (so a patch never
 * silently resets unspecified fields), and `id` excluded.
 */
export function patchOf<S extends z.ZodObject>(schema: S): z.ZodType<Partial<Omit<z.output<S>, 'id'>>, Partial<Omit<z.input<S>, 'id'>>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    if (key === 'id') continue;
    let t: z.ZodType = value;
    while (t instanceof z.ZodDefault || t instanceof z.ZodOptional) t = (t as z.ZodDefault<z.ZodType> | z.ZodOptional<z.ZodType>).unwrap() as z.ZodType;
    shape[key] = t.optional();
  }
  return z.strictObject(shape) as unknown as z.ZodType<Partial<Omit<z.output<S>, 'id'>>, Partial<Omit<z.input<S>, 'id'>>>;
}

/** Optional scenario selector shared by scenario-scoped commands (defaults to the active scenario). */
export const ScenarioRef = { scenarioId: z.string().optional() };

export function scenarioOf(project: Project, scenarioId?: string): Scenario {
  const id = scenarioId ?? project.activeScenarioId;
  const s = project.scenarios.find((x) => x.id === id);
  if (!s) throw new CommandError('That layout scenario no longer exists.');
  return s;
}

export function findOrThrow<T extends { id: string }>(items: T[], id: string, noun: string): T {
  const item = items.find((i) => i.id === id);
  if (!item) throw new CommandError(`The ${noun} you are editing no longer exists.`);
  return item;
}

export function removeByIds<T extends { id: string }>(items: T[], ids: ReadonlySet<string>): number {
  let removed = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (ids.has(items[i]!.id)) {
      items.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

export function assertUniqueId(items: Array<{ id: string }>, id: string, noun: string): void {
  if (items.some((i) => i.id === id)) throw new CommandError(`A ${noun} with id "${id}" already exists.`);
}

/** Assign defined keys of a patch onto a draft object (undefined keys are skipped). */
export function applyPatch<T extends object>(target: T, patch: Partial<T>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (target as Record<string, unknown>)[k] = v;
  }
}
