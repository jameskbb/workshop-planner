/**
 * Command providers turn text into an `NlResult` (typed `AppCommand`s or view actions). The app
 * ships the deterministic grammar; an LLM provider can be added later by implementing the same
 * interface and returning structured commands, which go through `fromStructured` → `validateCommand`
 * exactly like the grammar's output (JSON schemas for every command: `commandJsonSchemas()`).
 */
import { validateCommand, type AppCommand } from '@/domain/commands';
import { interpret, type NlContext, type NlResult } from './interpret';

export interface CommandProvider {
  id: string;
  label: string;
  interpret(text: string, ctx: NlContext): NlResult | Promise<NlResult>;
}

export const grammarProvider: CommandProvider = {
  id: 'grammar',
  label: 'Built-in command grammar (offline)',
  interpret: (text, ctx) => interpret(text, ctx),
};

/**
 * Validate structured output from an external provider (e.g. an LLM asked to emit
 * `{ summary, commands: [{ type, payload }] }`). Nothing unvalidated reaches the command bus.
 */
export function fromStructured(output: unknown): NlResult {
  if (typeof output !== 'object' || output === null) return { ok: false, reason: 'The provider returned nothing usable.', suggestions: [] };
  const { summary, commands } = output as { summary?: unknown; commands?: unknown };
  if (!Array.isArray(commands) || commands.length === 0) return { ok: false, reason: 'The provider returned no commands.', suggestions: [] };
  for (const c of commands) {
    const v = validateCommand(c);
    if (!v.ok) return { ok: false, reason: v.error, suggestions: [] };
  }
  const text = typeof summary === 'string' && summary.trim() ? summary.trim() : `${commands.length} change${commands.length === 1 ? '' : 's'}`;
  return { ok: true, kind: 'commands', summary: text, label: text, commands: commands as AppCommand[] };
}
