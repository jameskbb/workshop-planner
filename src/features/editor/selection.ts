/**
 * Selection model helpers shared by the Select tool, shortcuts, context menus and inspector.
 *
 * Selection = `uiStore.selection: EntityRef[]`. Grouped objects are selected together (clicking a
 * member selects the whole group; double-click selects one member). Entities on hidden or locked
 * layers are not pickable; hidden entities are selectable only from panels.
 */
import { entityAdapters, type EntityAdapter, type EntityContext } from '@/app/registry';
import type { AppCommand } from '@/domain/commands';
import { getScenario, objectFootprint, resolveObject, roomGeometry, featureFootprint, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, type EntityRef, type Scenario } from '@/domain/schema';
import { bbox, bboxUnion, vehicleBody, type BBox, type SnapTargets, type SnapToggles } from '@/geometry';
import { transact, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { LAYER_LABELS } from '@/features/layers/register';

export function editorCtx(): EntityContext | null {
  const project = useProjectStore.getState().project;
  return project ? { project, scenario: getScenario(project) } : null;
}

export const refKey = (r: EntityRef): string => `${r.kind}:${r.id}`;
export const sameRef = (a: EntityRef, b: EntityRef): boolean => a.kind === b.kind && a.id === b.id;

export function adapter(kind: string): EntityAdapter | undefined {
  return entityAdapters.get(kind);
}

/** Why an entity can't be picked on the canvas right now (null = pickable). */
export function pickBlocker(c: EntityContext, ref: EntityRef): string | null {
  const a = adapter(ref.kind);
  if (!a || !a.exists(c, ref.id)) return 'gone';
  const layer = a.layer?.(c, ref.id);
  if (layer) {
    const st = c.project.layers[layer];
    if (st && !st.visible) return `The ${LAYER_LABELS[layer]} layer is hidden.`;
    if (st?.locked) return `The ${LAYER_LABELS[layer]} layer is locked. Unlock it in the Layers panel to edit it.`;
  }
  return null;
}

/** Add every member of any selected object's group. */
export function expandGroups(scenario: Scenario, refs: readonly EntityRef[]): EntityRef[] {
  const groups = new Set<string>();
  for (const r of refs) {
    if (r.kind !== 'object') continue;
    const g = scenario.objects.find((o) => o.id === r.id)?.groupId;
    if (g) groups.add(g);
  }
  if (groups.size === 0) return [...refs];
  const out = [...refs];
  const seen = new Set(refs.map(refKey));
  for (const o of scenario.objects) {
    if (o.groupId && groups.has(o.groupId) && !seen.has(`object:${o.id}`)) {
      out.push({ kind: 'object', id: o.id });
      seen.add(`object:${o.id}`);
    }
  }
  return out;
}

/** Union bounds of the given entities (null if none has an outline). */
export function refsBounds(c: EntityContext, refs: readonly EntityRef[]): BBox | null {
  const boxes: BBox[] = [];
  for (const r of refs) {
    const o = adapter(r.kind)?.outline(c, r.id);
    if (o && o.length) boxes.push(bbox(o));
  }
  return boxes.length ? bboxUnion(...boxes) : null;
}

/** First locked entity in a set, if any (for "X is locked" explanations). */
export function firstLocked(c: EntityContext, refs: readonly EntityRef[]): string | null {
  for (const r of refs) {
    const a = adapter(r.kind);
    if (a?.locked?.(c, r.id)) return a.name(c, r.id);
  }
  return null;
}

/** Commit preview patches (from drag/rotate/resize) as one undoable step. */
export function commitPatches(label: string, previews: Readonly<Record<string, unknown>>): boolean {
  const c = editorCtx();
  if (!c) return false;
  const cmds: AppCommand[] = [];
  for (const [key, patch] of Object.entries(previews)) {
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    const a = adapter(kind);
    if (a?.commit && patch) cmds.push(...a.commit(c, id, patch as Record<string, unknown>));
  }
  if (cmds.length === 0) return false;
  const r = transact(label, cmds);
  if (!r.ok) uiActions.flash(r.error, 'error');
  return r.ok;
}

/** Current snapping configuration (respects project settings and Alt). */
export function snapConfig(): { on: boolean; toggles: SnapToggles; grid: number; rotationStep: number } {
  const p = useProjectStore.getState().project;
  const s = p?.settings.snapping;
  const suppressed = useUiStore.getState().snapSuppressed;
  const on = !!s?.enabled && !suppressed;
  return {
    on,
    toggles: {
      grid: !!s?.grid,
      walls: !!s?.walls,
      corners: !!s?.corners,
      wallCenters: !!s?.wallCenters,
      objectEdges: !!s?.objectEdges,
      objectCenters: !!s?.objectCenters,
    },
    grid: p?.settings.gridSize ?? 152.4,
    rotationStep: p?.settings.rotationSnap ?? 15,
  };
}

/** Snap threshold in world mm for `px` screen pixels. */
export const snapThreshold = (px = 8): number => px / useUiStore.getState().viewport.scale;

/** Snap targets: walls, corners, grid and the bounds of every visible floor item not in `exclude`. */
export function buildSnapTargets(c: EntityContext, exclude: ReadonlySet<string>): SnapTargets {
  const g = roomGeometry(c.project.room);
  const objects: SnapTargets['objects'] = [];
  for (const o of c.scenario.objects) {
    if (o.hidden || exclude.has(`object:${o.id}`)) continue;
    objects.push({ id: o.id, bbox: bbox(objectFootprint(resolveObject(c.project, o))) });
  }
  for (const v of c.scenario.vehicles) {
    if (v.hidden || exclude.has(`vehicle:${v.id}`)) continue;
    objects.push({ id: v.id, bbox: bbox(vehicleBody(vehicleGeomSpec(v), vehiclePose(v))) });
  }
  for (const f of c.project.architecture) {
    if (f.hidden || OPENING_KINDS.has(f.kind) || OVERHEAD_KINDS.has(f.kind) || exclude.has(`feature:${f.id}`)) continue;
    const fp = featureFootprint(c.project.room, f);
    if (fp.length >= 3) objects.push({ id: f.id, bbox: bbox(fp) });
  }
  return {
    gridSize: useProjectStore.getState().project?.settings.gridSize,
    walls: g.polygon.length >= 3 ? g.walls : [],
    corners: g.polygon,
    objects,
  };
}

/** Selectable, visible, pickable refs of every adapter (for select-all / marquee). */
export function allPickable(c: EntityContext, kinds?: ReadonlySet<string>): EntityRef[] {
  const out: EntityRef[] = [];
  for (const a of entityAdapters.list()) {
    if (kinds && !kinds.has(a.kind)) continue;
    if (!a.marquee) continue;
    for (const id of a.ids(c)) {
      const ref = { kind: a.kind, id };
      if (a.hidden?.(c, id)) continue;
      if (pickBlocker(c, ref)) continue;
      out.push(ref);
    }
  }
  return out;
}
