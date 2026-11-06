/**
 * Command registry entry point. Importing this module registers every core command plus every
 * feature's `src/features/<feature>/commands.ts` (auto-discovered, no central list to edit).
 * Feature command files must stay pure (no React/Konva) so they also load in tests and workers.
 */
import './core/project';
import './core/scenario';
import './core/objects';
import './core/room';
import './core/entities';
import './core/misc';

import.meta.glob('/src/features/*/commands.ts', { eager: true });

export * from './registry';
export { roomProblem } from './core/room';
export { patchOf } from './helpers';
