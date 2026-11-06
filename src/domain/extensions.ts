/**
 * Typed per-feature data stored in `project.extensions[key]` or `scenario.extensions[key]`.
 *
 * Parallel feature tracks use this instead of editing the core schema:
 *
 *   export const printPrefs = defineExtension('print.prefs', z.object({ paper: z.enum(['letter','a4']) }), { paper: 'letter' });
 *   const prefs = printPrefs.read(project);            // validated, defaulted
 *   dispatch({ type: 'extension.set', payload: { target: 'project', key: printPrefs.key, value: {...} } });
 *
 * Invalid stored data never throws: `read` falls back to the default (and the file still loads).
 */
import type { z } from 'zod';

interface HasExtensions {
  extensions: Record<string, unknown>;
}

export interface ExtensionDef<T> {
  key: string;
  schema: z.ZodType<T>;
  defaultValue: T;
  read(target: HasExtensions): T;
  /** Mutating write for use inside a command's immer draft. */
  write(draft: HasExtensions, value: T): void;
}

const registered = new Map<string, ExtensionDef<unknown>>();

export function defineExtension<T>(key: string, schema: z.ZodType<T>, defaultValue: T): ExtensionDef<T> {
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(key)) throw new Error(`Extension key "${key}" must be dotted kebab-case, e.g. "print.prefs".`);
  const def: ExtensionDef<T> = {
    key,
    schema,
    defaultValue,
    read(target) {
      const raw = target.extensions?.[key];
      if (raw === undefined) return defaultValue;
      const r = schema.safeParse(raw);
      return r.success ? r.data : defaultValue;
    },
    write(draft, value) {
      draft.extensions[key] = schema.parse(value);
    },
  };
  if (registered.has(key) && import.meta.env?.DEV) console.warn(`Extension "${key}" defined twice.`);
  registered.set(key, def as ExtensionDef<unknown>);
  return def;
}

export function getExtensionDef(key: string): ExtensionDef<unknown> | undefined {
  return registered.get(key);
}
