/**
 * App-level services: the repository, project service and autosave controller, plus navigation
 * between the project list and the editor (hash routes: `#/` and `#/project/<id>`).
 */
import { create } from 'zustand';
import { AutosaveController, IdbRepository, ProjectService, SETTING_LAST_PROJECT, type Repository } from '@/persistence';
import { closeProject, loadProject, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import type { ObjectDefinition } from '@/domain/schema';

let repository: Repository = new IdbRepository();
let service = new ProjectService(repository);
let autosave = new AutosaveController(repository);

/** Swap the repository (tests / future sync backend). */
export function configureServices(repo: Repository): void {
  autosave.stop();
  repository = repo;
  service = new ProjectService(repo);
  autosave = new AutosaveController(repo);
}

export const services = {
  get repo(): Repository {
    return repository;
  },
  get projects(): ProjectService {
    return service;
  },
  get autosave(): AutosaveController {
    return autosave;
  },
};

// ───────────────────────────── routing ─────────────────────────────

export type Route = { screen: 'home' } | { screen: 'editor'; projectId: string };

export function parseHash(hash: string): Route {
  const m = /^#\/project\/([^/?#]+)/.exec(hash);
  return m ? { screen: 'editor', projectId: decodeURIComponent(m[1]!) } : { screen: 'home' };
}

export const useRouteStore = create<{ route: Route }>()(() => ({
  route: typeof window === 'undefined' ? { screen: 'home' } : parseHash(window.location.hash),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => useRouteStore.setState({ route: parseHash(window.location.hash) }));
}

export function navigate(route: Route): void {
  const hash = route.screen === 'home' ? '#/' : `#/project/${encodeURIComponent(route.projectId)}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  useRouteStore.setState({ route });
}

// ───────────────────────────── editor session ─────────────────────────────

export const useSessionStore = create<{ loading: boolean; error: string | null; errorDetails: string[] }>()(() => ({
  loading: false,
  error: null,
  errorDetails: [],
}));

let opening: { id: string; promise: Promise<void> } | null = null;

/** Load a project into the editor (called when the route points at it). Concurrent calls for the same id share one load. */
export function openProjectSession(projectId: string): Promise<void> {
  if (opening?.id === projectId) return opening.promise;
  const promise = doOpen(projectId).finally(() => {
    if (opening?.promise === promise) opening = null;
  });
  opening = { id: projectId, promise };
  return promise;
}

async function doOpen(projectId: string): Promise<void> {
  const current = useProjectStore.getState().project;
  if (current?.id === projectId) return;
  useSessionStore.setState({ loading: true, error: null, errorDetails: [] });
  try {
    if (current) await closeProjectSession();
    const project = await service.repo.getProject(projectId);
    if (!project) {
      useSessionStore.setState({ loading: false, error: 'This project no longer exists. It may have been deleted in another tab.' });
      return;
    }
    uiActions.reset();
    loadProject(project);
    autosave.start();
    uiActions.requestFit();
    void repository.setSetting(SETTING_LAST_PROJECT, projectId);
    useSessionStore.setState({ loading: false });
  } catch (e) {
    const details = (e as { details?: string[] }).details ?? [];
    useSessionStore.setState({ loading: false, error: e instanceof Error ? e.message : String(e), errorDetails: details });
  }
}

/** Save pending changes and close the editor session. */
export async function closeProjectSession(): Promise<void> {
  await autosave.flush();
  autosave.stop();
  closeProject();
}

export async function goHome(): Promise<void> {
  await closeProjectSession();
  navigate({ screen: 'home' });
}

export function openProject(projectId: string): void {
  navigate({ screen: 'editor', projectId });
}

// ───────────────────────────── custom object library (global) ─────────────────────────────

export const useCustomLibrary = create<{ definitions: ObjectDefinition[]; loaded: boolean }>()(() => ({ definitions: [], loaded: false }));

export async function refreshCustomLibrary(): Promise<void> {
  try {
    const definitions = await repository.listDefinitions();
    useCustomLibrary.setState({ definitions, loaded: true });
  } catch {
    useCustomLibrary.setState({ definitions: [], loaded: true });
  }
}

export async function saveCustomDefinition(def: ObjectDefinition): Promise<void> {
  await repository.saveDefinition(def);
  await refreshCustomLibrary();
}

export async function deleteCustomDefinition(id: string): Promise<void> {
  await repository.deleteDefinition(id);
  await refreshCustomLibrary();
}

// Save when the tab is hidden or closed (best effort; IndexedDB writes are quick, and the
// autosave debounce is short for discrete changes so little can be in flight here).
if (typeof window !== 'undefined') {
  const flush = () => void autosave.flush();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // pagehide does not fire in every tab-teardown path; beforeunload covers the rest.
  window.addEventListener('beforeunload', flush);
}
