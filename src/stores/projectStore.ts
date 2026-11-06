/**
 * The project store + command bus.
 *
 * - Holds the ACTIVE project (immutable; immer structural sharing).
 * - ALL mutations go through `dispatch` / `transact` with typed `AppCommand`s.
 * - Each committed transaction records immer patches + inverse patches → undo/redo.
 * - Consecutive commands with the same `coalesceKey` (within 1 s, or while a gesture is open) merge
 *   into one history entry (drags, nudges, typing in an inspector field).
 *
 * UI/view state lives in `uiStore`; persistence subscribes to `changeCounter` (see persistence/autosave).
 */
import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from 'immer';
import { create } from 'zustand';
import {
  CommandError,
  commandLabel,
  recordsHistory,
  validateCommand,
  type AppCommand,
  type CommandContext,
} from '@/domain/commands';
import type { Project } from '@/domain/schema';
import { newId } from '@/utils/id';
import { nowIso } from '@/utils/time';

enablePatches();
setAutoFreeze(true);

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export interface HistoryEntry {
  id: number;
  label: string;
  patches: Patch[];
  inverse: Patch[];
  commands: AppCommand[];
  coalesceKey?: string;
  at: number;
  /** Active scenario when the entry was recorded (undo switches back to it). */
  scenarioId: string;
}

export type CommandResult = { ok: true; changed: boolean } | { ok: false; error: string };

export interface DispatchOptions {
  /** Merge into the previous history entry when it has the same key (see module docs). */
  coalesceKey?: string;
  /** Override the history label. */
  label?: string;
}

export interface ProjectStoreState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Increments on every applied change (including non-history ones); autosave watches it. */
  changeCounter: number;
  /** Last command refusal/error, shown unobtrusively in the status bar. */
  lastError: string | null;
  /** Open gesture key (drag in progress). */
  gesture: string | null;
}

export const useProjectStore = create<ProjectStoreState>()(() => ({
  project: null,
  past: [],
  future: [],
  changeCounter: 0,
  lastError: null,
  gesture: null,
}));

let entrySeq = 0;
/** Test seam: override the transaction clock/id source. */
let contextFactory: () => CommandContext = () => ({ now: nowIso(), newId });
export function setCommandContextFactory(fn: () => CommandContext): () => void {
  const prev = contextFactory;
  contextFactory = fn;
  return () => {
    contextFactory = prev;
  };
}

function bumpMeta(project: Project): Project {
  // Metadata is updated outside of the recorded patches, so undo never "un-modifies" the file.
  return { ...project, revision: project.revision + 1, updatedAt: nowIso() };
}

type Tx = { dispatch(cmd: AppCommand): void; readonly project: Project };

/**
 * Run several commands as ONE atomic, undoable step. If any command fails, nothing is applied.
 * The callback receives the in-progress draft (read it to plan follow-up commands).
 */
export function transact(label: string, body: AppCommand[] | ((tx: Tx) => void), options: DispatchOptions = {}): CommandResult {
  const state = useProjectStore.getState();
  const project = state.project;
  if (!project) return { ok: false, error: 'No project is open.' };
  const ctx = contextFactory();
  const executed: AppCommand[] = [];
  let history = false;

  let result: readonly [Project, Patch[], Patch[]];
  try {
    result = produceWithPatches(project, (draft) => {
      const run = (cmd: AppCommand) => {
        const v = validateCommand(cmd);
        if (!v.ok) throw new CommandError(v.error);
        v.def.execute(draft as Project, v.payload, ctx);
        executed.push(cmd);
        if (recordsHistory(v.def, v.payload)) history = true;
      };
      if (Array.isArray(body)) body.forEach(run);
      else body({ dispatch: run, project: draft as Project });
    });
  } catch (e) {
    let error: string;
    if (e instanceof CommandError) error = e.message;
    else {
      console.error('Command failed', e);
      error = `Something went wrong while applying "${label}". Nothing was changed.`;
    }
    useProjectStore.setState({ lastError: error });
    return { ok: false, error };
  }
  const [next, patches, inverse] = result;
  if (patches.length === 0) {
    useProjectStore.setState({ lastError: null });
    return { ok: true, changed: false };
  }
  const now = Date.now();
  const nextState: Partial<ProjectStoreState> = {
    project: bumpMeta(next),
    changeCounter: state.changeCounter + 1,
    lastError: null,
  };
  if (history) {
    const past = state.past;
    const last = past[past.length - 1];
    const key = options.coalesceKey;
    const canMerge =
      key !== undefined &&
      last !== undefined &&
      last.coalesceKey === key &&
      state.future.length === 0 &&
      (state.gesture === key || now - last.at <= COALESCE_MS);
    if (canMerge) {
      const merged: HistoryEntry = {
        ...last,
        patches: [...last.patches, ...patches],
        inverse: [...inverse, ...last.inverse],
        commands: [...last.commands, ...executed],
        at: now,
      };
      nextState.past = [...past.slice(0, -1), merged];
    } else {
      const entry: HistoryEntry = {
        id: ++entrySeq,
        label: options.label ?? label,
        patches,
        inverse,
        commands: executed,
        coalesceKey: key,
        at: now,
        scenarioId: project.activeScenarioId,
      };
      nextState.past = [...past, entry].slice(-HISTORY_LIMIT);
    }
    nextState.future = [];
  }
  useProjectStore.setState(nextState);
  return { ok: true, changed: true };
}

/** Execute a single command. */
export function dispatch(cmd: AppCommand, options: DispatchOptions = {}): CommandResult {
  const project = useProjectStore.getState().project;
  if (!project) return { ok: false, error: 'No project is open.' };
  const v = validateCommand(cmd);
  if (!v.ok) {
    useProjectStore.setState({ lastError: v.error });
    return { ok: false, error: v.error };
  }
  return transact(options.label ?? commandLabel(v.def, v.payload, project), [cmd], options);
}

function restoreScenario(project: Project, scenarioId: string): Project {
  if (project.activeScenarioId === scenarioId || !project.scenarios.some((s) => s.id === scenarioId)) return project;
  return { ...project, activeScenarioId: scenarioId };
}

export function undo(): boolean {
  const s = useProjectStore.getState();
  const entry = s.past[s.past.length - 1];
  if (!s.project || !entry) return false;
  let next = applyPatches(s.project, entry.inverse);
  next = restoreScenario(next, entry.scenarioId);
  useProjectStore.setState({
    project: bumpMeta(next),
    past: s.past.slice(0, -1),
    future: [...s.future, entry],
    changeCounter: s.changeCounter + 1,
    lastError: null,
    gesture: null,
  });
  return true;
}

export function redo(): boolean {
  const s = useProjectStore.getState();
  const entry = s.future[s.future.length - 1];
  if (!s.project || !entry) return false;
  let next = applyPatches(s.project, entry.patches);
  next = restoreScenario(next, entry.scenarioId);
  useProjectStore.setState({
    project: bumpMeta(next),
    past: [...s.past, entry],
    future: s.future.slice(0, -1),
    changeCounter: s.changeCounter + 1,
    lastError: null,
    gesture: null,
  });
  return true;
}

/** Start a gesture (e.g. a drag); commands dispatched with this coalesceKey merge until endGesture. */
export function beginGesture(key: string): void {
  useProjectStore.setState({ gesture: key });
}

export function endGesture(): void {
  useProjectStore.setState({ gesture: null });
}

/** Open a project (clears history). */
export function loadProject(project: Project): void {
  useProjectStore.setState({ project, past: [], future: [], lastError: null, gesture: null, changeCounter: 0 });
}

export function closeProject(): void {
  useProjectStore.setState({ project: null, past: [], future: [], lastError: null, gesture: null, changeCounter: 0 });
}

export const canUndo = (s: ProjectStoreState): boolean => s.past.length > 0;
export const canRedo = (s: ProjectStoreState): boolean => s.future.length > 0;
export const undoLabel = (s: ProjectStoreState): string | null => s.past[s.past.length - 1]?.label ?? null;
export const redoLabel = (s: ProjectStoreState): string | null => s.future[s.future.length - 1]?.label ?? null;

/** Current project (throws if none is open), for command handlers in UI code. */
export function requireProject(): Project {
  const p = useProjectStore.getState().project;
  if (!p) throw new Error('No project is open.');
  return p;
}
