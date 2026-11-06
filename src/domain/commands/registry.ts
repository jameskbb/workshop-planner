/**
 * Typed, serializable command registry.
 *
 * Every mutation of a project is an `AppCommand` ({ type, payload }) executed by the command bus
 * (src/stores/projectStore.ts) inside an immer transaction, producing patches for undo/redo.
 * Commands are plain data validated by Zod, so an LLM or the NL parser can emit them later.
 *
 * Adding a command (in any feature folder, file `commands.ts`, auto-loaded):
 *
 *   export const setBenchHeight = defineCommand({
 *     type: 'object.setHeight',
 *     label: 'Change height',
 *     payload: z.object({ id: z.string(), height: z.number().positive() }),
 *     execute(project, p, ctx) { ... mutate the draft ... },
 *   });
 *   declare module '@/domain/commands/registry' {
 *     interface CommandPayloads { 'object.setHeight': z.input<typeof setBenchHeight.payload> }
 *   }
 */
import { z } from 'zod';
import type { Project } from '../schema';

/** Declaration-merged map of command type → payload INPUT type. Augment it next to each definition. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandPayloads {}

export type CommandType = keyof CommandPayloads & string;

/** The discriminated union of every known command. */
export type AppCommand = { [K in CommandType]: { type: K; payload: CommandPayloads[K] } }[CommandType];

export interface CommandContext {
  /** ISO timestamp for this transaction. */
  now: string;
  newId: () => string;
}

/** Thrown by `execute` to refuse a command with a user-facing explanation (no changes are applied). */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface CommandDefinition<T extends string = string, S extends z.ZodType = z.ZodType> {
  type: T;
  /** Short human label for history ("Move object"). Can depend on the payload. */
  label: string | ((payload: z.output<S>, project: Project) => string);
  payload: S;
  /**
   * Whether this command is recorded in undo history. Use `false` for persistent-but-not-meaningful
   * edits such as layer visibility or switching the active scenario. Default true.
   */
  history?: boolean | ((payload: z.output<S>) => boolean);
  execute(project: Project, payload: z.output<S>, ctx: CommandContext): void;
}

export function recordsHistory(def: CommandDefinition, payload: unknown): boolean {
  if (def.history === undefined) return true;
  return typeof def.history === 'function' ? def.history(payload) : def.history;
}

const registry = new Map<string, CommandDefinition>();

export function defineCommand<T extends string, S extends z.ZodType>(def: CommandDefinition<T, S>): CommandDefinition<T, S> {
  if (registry.has(def.type) && registry.get(def.type) !== (def as unknown as CommandDefinition)) {
    throw new Error(`Command "${def.type}" is already registered.`);
  }
  registry.set(def.type, def as unknown as CommandDefinition);
  return def;
}

export function getCommand(type: string): CommandDefinition | undefined {
  return registry.get(type);
}

export function listCommands(): CommandDefinition[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function commandLabel(def: CommandDefinition, payload: unknown, project: Project): string {
  return typeof def.label === 'function' ? def.label(payload, project) : def.label;
}

/** Validate an untrusted command (e.g. from the NL parser or an LLM). */
export function validateCommand(
  cmd: unknown,
): { ok: true; def: CommandDefinition; payload: unknown } | { ok: false; error: string } {
  if (typeof cmd !== 'object' || cmd === null || typeof (cmd as { type?: unknown }).type !== 'string') {
    return { ok: false, error: 'A command needs a "type".' };
  }
  const { type, payload } = cmd as { type: string; payload?: unknown };
  const def = registry.get(type);
  if (!def) return { ok: false, error: `Unknown command "${type}".` };
  const r = def.payload.safeParse(payload ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `Invalid "${type}" command${where}: ${issue?.message ?? 'bad payload'}` };
  }
  return { ok: true, def, payload: r.data };
}

/** JSON Schemas of every registered command payload, for a future LLM provider. */
export function commandJsonSchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of registry.values()) {
    try {
      out[def.type] = z.toJSONSchema(def.payload, { unrepresentable: 'any' });
    } catch {
      out[def.type] = {};
    }
  }
  return out;
}
