/**
 * Selector hooks over the project store. Prefer narrow selectors (per-entity) so edits to one
 * object only re-render that object's canvas node / inspector field.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { getScenario } from '@/domain/resolve';
import type { EntityKind, PlacedObject, Project, Scenario } from '@/domain/schema';
import type { SelectionContext } from '@/app/registry';

export function useProject(): Project | null {
  return useProjectStore((s) => s.project);
}

/** The open project; throws if none (use inside the editor only). */
export function useOpenProject(): Project {
  const p = useProjectStore((s) => s.project);
  if (!p) throw new Error('useOpenProject used without an open project');
  return p;
}

export function useActiveScenario(): Scenario | null {
  return useProjectStore((s) => (s.project ? getScenario(s.project) : null));
}

export function useObject(id: string): PlacedObject | undefined {
  return useProjectStore((s) => (s.project ? getScenario(s.project).objects.find((o) => o.id === id) : undefined));
}

/** Ids of objects in the active scenario (stable array while membership/order is unchanged). */
export function useObjectIds(): string[] {
  return useProjectStore(useShallow((s) => (s.project ? getScenario(s.project).objects.map((o) => o.id) : [])));
}

export function useSelectedIds(kind: EntityKind): string[] {
  return useUiStore(useShallow((s) => s.selection.filter((r) => r.kind === kind).map((r) => r.id)));
}

export function useIsSelected(kind: EntityKind, id: string): boolean {
  return useUiStore((s) => s.selection.some((r) => r.kind === kind && r.id === id));
}

/** Selection context for inspector sections / context menus (memoized). */
export function useSelectionContext(): SelectionContext | null {
  const project = useProjectStore((s) => s.project);
  const refs = useUiStore((s) => s.selection);
  return useMemo(() => {
    if (!project) return null;
    const scenario = getScenario(project);
    // Drop refs to entities that no longer exist (after undo/delete).
    const exists = (kind: EntityKind, id: string) => {
      switch (kind) {
        case 'object':
          return scenario.objects.some((o) => o.id === id);
        case 'vehicle':
          return scenario.vehicles.some((v) => v.id === id);
        case 'feature':
          return project.architecture.some((f) => f.id === id);
        case 'electrical':
          return project.electrical.some((e) => e.id === id);
        case 'wall':
          return project.room.walls.some((w) => w.id === id);
        case 'vertex':
          return project.room.vertices.some((v) => v.id === id);
        case 'light':
          return scenario.lights.some((l) => l.id === id);
        case 'zone':
          return scenario.zones.some((z) => z.id === id);
        case 'measurement':
          return scenario.measurements.some((m) => m.id === id);
        case 'duct':
          return scenario.dust.runs.some((d) => d.id === id);
        case 'fitting':
          return scenario.dust.fittings.some((f) => f.id === id);
        default:
          return false;
      }
    };
    const live = refs.filter((r) => exists(r.kind, r.id));
    return {
      project,
      scenario,
      refs: live,
      kinds: new Set(live.map((r) => r.kind)),
      single: live.length === 1 ? live[0]! : null,
    };
  }, [project, refs]);
}
