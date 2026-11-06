import { useSyncExternalStore } from 'react';

export interface RegistryItem {
  id: string;
  /** Sort key (ascending). Conventions per registry are documented in docs/ARCHITECTURE.md. */
  order?: number;
}

export interface Registry<T extends RegistryItem> {
  readonly name: string;
  /** Add (or replace, by id) an item. Returns an unregister function. */
  register(item: T): () => void;
  /** Items sorted by order then id. The array identity is stable until the registry changes. */
  list(): readonly T[];
  get(id: string): T | undefined;
  subscribe(listener: () => void): () => void;
  /** React hook: re-renders when items are added/removed. */
  useItems(): readonly T[];
}

/**
 * A tiny observable registry. Feature folders call `register` from their `register.ts(x)` at
 * module load; shell components render `useItems()`.
 */
export function createRegistry<T extends RegistryItem>(name: string): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  let snapshot: readonly T[] = [];

  const rebuild = () => {
    snapshot = [...items.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
    for (const l of listeners) l();
  };

  const registry: Registry<T> = {
    name,
    register(item) {
      // Always loud (not DEV-only): two features registering the same id silently overrode each
      // other during the build; one of them was dead code nobody could see.
      if (items.has(item.id) && items.get(item.id) !== item) {
        console.warn(`[${name}] "${item.id}" re-registered; the previous entry is now dead code. Ids must be unique.`);
      }
      items.set(item.id, item);
      rebuild();
      return () => {
        if (items.get(item.id) === item) {
          items.delete(item.id);
          rebuild();
        }
      };
    },
    list: () => snapshot,
    get: (id) => items.get(id),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    useItems() {
      return useSyncExternalStore(registry.subscribe, registry.list, registry.list);
    },
  };
  return registry;
}
