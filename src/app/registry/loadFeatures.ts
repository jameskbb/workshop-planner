/**
 * Loads every feature's UI registration module. Adding `src/features/<name>/register.ts(x)` is all
 * it takes; nothing else needs editing. Import this once at startup (main.tsx), after the shell's
 * own registrations.
 *
 * Pure registrations (commands, analyzers, metrics) are loaded by src/domain/commands and
 * src/analysis respectively, so they also work in tests and Web Workers.
 */
import '@/domain/commands';
import '@/analysis';

const modules = import.meta.glob('/src/features/*/register.{ts,tsx}', { eager: true });

/** Names of feature folders whose register module was loaded (for diagnostics). */
export const loadedFeatures: string[] = Object.keys(modules)
  .map((p) => p.split('/')[3] ?? p)
  .sort();
