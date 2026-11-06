/**
 * Editor operations on the current selection. Every mutation is ONE undoable transaction and every
 * refusal is explained in the status bar. Used by shortcuts, context menus, the command palette and
 * inspector buttons.
 */
import type { EntityContext } from '@/app/registry';
import { fitBoxToView, focusCanvas } from '@/app/canvas/PlanCanvas';
import { saveCustomDefinition, useCustomLibrary } from '@/app/services';
import type { AppCommand } from '@/domain/commands';
import { findDefinition, findObject, getScenario, objectFootprint, resolveObject } from '@/domain/resolve';
import { ObjectDefinitionSchema, type EntityRef, type ObjectCategory, type ObjectDefinition, type PlacedObject } from '@/domain/schema';
import { alignItems, bbox, bboxCenter, distributeItems, expandBBox, type AlignMode, type DistributeAxis, type Point } from '@/geometry';
import { makeFormatters } from '@/hooks/useFormatters';
import { transact, useProjectStore } from '@/stores/projectStore';
import { editorActions, useEditorStore, type Clipboard } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { BUILTIN_OBJECTS_BY_ID } from '@/features/objects/library';
import { adapter, editorCtx, expandGroups, firstLocked, refKey, refsBounds } from './selection';

const sel = (): EntityRef[] => [...useUiStore.getState().selection];
const fmt = () => makeFormatters(useProjectStore.getState().project?.settings ?? null);

function run(label: string, cmds: AppCommand[], coalesceKey?: string): boolean {
  if (cmds.length === 0) return false;
  const r = transact(label, cmds, coalesceKey ? { coalesceKey } : {});
  if (!r.ok) uiActions.flash(r.error, 'error');
  return r.ok;
}

function noSelection(what: string): void {
  uiActions.flash(`Select something to ${what}.`, 'info');
}

/** Refs that are real, generic entities (not room walls / corners). */
const entityRefs = (refs: EntityRef[]) => refs.filter((r) => r.kind !== 'wall' && r.kind !== 'vertex');

// ───────────── nudge ─────────────

/** Arrow-key nudge: 1" (Shift: 1') in imperial, 10 mm (Shift: 100 mm) in metric. */
export function nudge(dirX: number, dirY: number, large: boolean): void {
  const c = editorCtx();
  if (!c) return;
  const refs = expandGroups(c.scenario, sel());
  if (refs.length === 0) return;
  const imperial = c.project.settings.unitSystem === 'imperial';
  const step = imperial ? (large ? 304.8 : 25.4) : large ? 100 : 10;
  // Screen arrows move along the screen axes, whatever the plan orientation.
  const viewRot = ((useUiStore.getState().viewport.rotation ?? 0) * Math.PI) / 180;
  const d = {
    x: Math.round((dirX * Math.cos(-viewRot) - dirY * Math.sin(-viewRot)) * step * 1e6) / 1e6,
    y: Math.round((dirX * Math.sin(-viewRot) + dirY * Math.cos(-viewRot)) * step * 1e6) / 1e6,
  };
  const locked = firstLocked(c, refs);
  if (locked) return uiActions.flash(`"${locked}" is locked. Unlock it (L) to move it.`, 'warning');
  const cmds: AppCommand[] = [];
  // Room corners / walls.
  const vIds = new Set<string>();
  for (const r of refs) {
    if (r.kind === 'vertex') vIds.add(r.id);
    if (r.kind === 'wall') {
      const i = c.project.room.walls.findIndex((w) => w.id === r.id);
      const n = c.project.room.vertices.length;
      if (i >= 0) vIds.add(c.project.room.vertices[i]!.id).add(c.project.room.vertices[(i + 1) % n]!.id);
    }
  }
  if (vIds.size) {
    const moves = c.project.room.vertices.filter((v) => vIds.has(v.id)).map((v) => ({ vertexId: v.id, x: v.x + d.x, y: v.y + d.y }));
    cmds.push({ type: 'room.moveVertices', payload: { moves } });
  }
  for (const r of entityRefs(refs)) {
    const a = adapter(r.kind);
    const patch = a?.translate?.(c, r.id, d);
    if (patch && a?.commit) cmds.push(...a.commit(c, r.id, patch));
  }
  run(refs.length === 1 ? 'Nudge' : `Nudge ${refs.length} items`, cmds, 'nudge');
}

// ───────────── delete / lock / hide ─────────────

export function deleteSelection(): void {
  const c = editorCtx();
  if (!c) return;
  const refs = sel();
  if (refs.length === 0) return;
  const walls = refs.filter((r) => r.kind === 'wall');
  if (walls.length === refs.length) {
    uiActions.flash('Walls can’t be deleted on their own. Select a corner and press Delete to remove it (the neighboring walls join), or redraw the room.', 'info');
    return;
  }
  const doIt = () => {
    const byKind = new Map<string, string[]>();
    for (const r of expandGroups(c.scenario, refs)) {
      if (r.kind === 'wall') continue;
      byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.id]);
    }
    const cmds: AppCommand[] = [];
    for (const [kind, ids] of byKind) cmds.push(...(adapter(kind)?.remove?.(c, ids) ?? []));
    if (run(refs.length === 1 ? `Delete ${adapter(refs[0]!.kind)?.name(c, refs[0]!.id) ?? 'item'}` : `Delete ${refs.length} items`, cmds)) uiActions.clearSelection();
  };
  if (refs.length >= 10) {
    editorActions.openDialog('confirm', {
      title: `Delete ${refs.length} items?`,
      description: 'They are removed from this layout. You can undo this with Ctrl/⌘ Z.',
      confirmLabel: `Delete ${refs.length} items`,
      onConfirm: doIt,
    });
  } else doIt();
}

export function toggleFlag(flag: 'locked' | 'hidden'): void {
  const c = editorCtx();
  if (!c) return;
  const refs = entityRefs(expandGroups(c.scenario, sel()));
  if (refs.length === 0) return noSelection(flag === 'locked' ? 'lock' : 'hide');
  const all = refs.every((r) => (flag === 'locked' ? adapter(r.kind)?.locked?.(c, r.id) : adapter(r.kind)?.hidden?.(c, r.id)));
  const value = !all;
  const byKind = new Map<string, string[]>();
  for (const r of refs) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.id]);
  const cmds: AppCommand[] = [];
  for (const [kind, ids] of byKind) cmds.push(...(adapter(kind)?.setFlag?.(c, ids, flag, value) ?? []));
  const noun = refs.length === 1 ? `"${adapter(refs[0]!.kind)?.name(c, refs[0]!.id)}"` : `${refs.length} items`;
  if (run(`${value ? (flag === 'locked' ? 'Lock' : 'Hide') : flag === 'locked' ? 'Unlock' : 'Show'} ${noun}`, cmds)) {
    uiActions.flash(
      flag === 'locked'
        ? value
          ? `Locked ${noun}. It can't be moved or deleted until unlocked (L).`
          : `Unlocked ${noun}.`
        : value
          ? `Hid ${noun}. Hidden items are ignored by the analysis; show them again from the Layers panel.`
          : `Showing ${noun}.`,
    );
  }
}

// ───────────── rotate ─────────────

export function rotateSelection(deg: number): void {
  const c = editorCtx();
  if (!c) return;
  const refs = entityRefs(expandGroups(c.scenario, sel())).filter((r) => adapter(r.kind)?.rotate?.(c, r.id, { x: 0, y: 0 }, 0));
  if (refs.length === 0) return noSelection('rotate');
  const locked = firstLocked(c, refs);
  if (locked) return uiActions.flash(`"${locked}" is locked. Unlock it (L) to rotate it.`, 'warning');
  let pivot: Point;
  if (refs.length === 1 && refs[0]!.kind === 'object') {
    const r = resolveObject(c.project, findObject(c.scenario, refs[0]!.id)!);
    pivot = { x: r.pose.x, y: r.pose.y };
  } else {
    const b = refsBounds(c, refs)!;
    pivot = bboxCenter(b);
  }
  const cmds: AppCommand[] = [];
  for (const r of refs) {
    const a = adapter(r.kind)!;
    const p = a.rotate!(c, r.id, pivot, deg);
    if (p && a.commit) cmds.push(...a.commit(c, r.id, p));
  }
  run(`Rotate ${deg > 0 ? '' : '−'}${Math.abs(deg)}°`, cmds);
}

// ───────────── duplicate & clipboard ─────────────

function remapGroups(c: EntityContext, pairs: Array<{ from: EntityRef; newId: string }>): AppCommand[] {
  const byGroup = new Map<string, string[]>();
  for (const p of pairs) {
    if (p.from.kind !== 'object') continue;
    const g = findObject(c.scenario, p.from.id)?.groupId;
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), p.newId]);
  }
  const cmds: AppCommand[] = [];
  for (const [gid, ids] of byGroup) {
    if (ids.length < 2) continue;
    const name = c.scenario.groups.find((x) => x.id === gid)?.name ?? 'Group';
    cmds.push({ type: 'object.group', payload: { ids, group: { id: newId(), name: `${name} copy`, locked: false } } });
  }
  return cmds;
}

export function duplicateSelection(): void {
  const c = editorCtx();
  if (!c) return;
  const refs = entityRefs(expandGroups(c.scenario, sel())).filter((r) => adapter(r.kind)?.copy && adapter(r.kind)?.paste);
  if (refs.length === 0) return noSelection('duplicate');
  const off = c.project.settings.unitSystem === 'imperial' ? { x: 304.8, y: 304.8 } : { x: 300, y: 300 };
  const cmds: AppCommand[] = [];
  const pairs: Array<{ from: EntityRef; newId: string }> = [];
  for (const r of refs) {
    const a = adapter(r.kind)!;
    const id = newId();
    cmds.push(...a.paste!(c, a.copy!(c, r.id), id, off));
    pairs.push({ from: r, newId: id });
  }
  cmds.push(...remapGroups(c, pairs));
  if (run(refs.length === 1 ? `Duplicate ${adapter(refs[0]!.kind)!.name(c, refs[0]!.id)}` : `Duplicate ${refs.length} items`, cmds)) {
    uiActions.select(pairs.map((p) => ({ kind: p.from.kind, id: p.newId })));
  }
}

export function copySelection(cut = false): void {
  const c = editorCtx();
  if (!c) return;
  const refs = entityRefs(expandGroups(c.scenario, sel())).filter((r) => adapter(r.kind)?.copy);
  if (refs.length === 0) return noSelection(cut ? 'cut' : 'copy');
  const entries = refs.map((r) => ({ kind: r.kind, data: adapter(r.kind)!.copy!(c, r.id) }));
  const groupIds = new Set(refs.filter((r) => r.kind === 'object').map((r) => findObject(c.scenario, r.id)?.groupId).filter(Boolean) as string[]);
  const clip: Clipboard = {
    entries,
    definitions: [],
    groups: c.scenario.groups.filter((g) => groupIds.has(g.id)).map((g) => ({ ...g })),
    projectId: c.project.id,
    scenarioId: c.scenario.id,
    pastes: 0,
  };
  editorActions.setClipboard(clip);
  if (cut) {
    deleteSelection();
    uiActions.flash(`Cut ${refs.length} item${refs.length === 1 ? '' : 's'}. Paste with Ctrl/⌘ V into this or any other layout.`);
  } else uiActions.flash(`Copied ${refs.length} item${refs.length === 1 ? '' : 's'}. Paste with Ctrl/⌘ V into this or any other layout.`);
}

/**
 * Paste. Into the same layout: offset copies with new ids. Into another layout of the same project:
 * pasted in place, and objects/vehicles keep their ids when the target layout doesn't have them
 * (same physical item across layouts). Into another project: new ids, in place.
 */
export function pasteClipboard(): void {
  const c = editorCtx();
  const clip = useEditorStore.getState().clipboard;
  if (!c) return;
  if (!clip || clip.entries.length === 0) return uiActions.flash('The clipboard is empty. Select items and press Ctrl/⌘ C first.', 'info');
  const sameLayout = clip.projectId === c.project.id && clip.scenarioId === c.scenario.id;
  const sameProject = clip.projectId === c.project.id;
  const k = sameLayout ? clip.pastes + 1 : 0;
  const unit = c.project.settings.unitSystem === 'imperial' ? 304.8 : 300;
  const off = { x: unit * k, y: unit * k };
  const cmds: AppCommand[] = [];
  const newRefs: EntityRef[] = [];
  const groupMembers = new Map<string, string[]>();
  for (const e of clip.entries) {
    const a = adapter(e.kind);
    if (!a?.paste) continue;
    const origId = (e.data as { id?: string; object?: { id: string } }).object?.id ?? (e.data as { id?: string }).id ?? '';
    const exists = a.exists(c, origId);
    const keep = sameProject && !sameLayout && (e.kind === 'object' || e.kind === 'vehicle' || e.kind === 'light') && !exists;
    const id = keep ? origId : newId();
    cmds.push(...a.paste(c, e.data, id, off));
    newRefs.push({ kind: e.kind, id });
    const gid = e.kind === 'object' ? (e.data as { object: PlacedObject }).object.groupId : undefined;
    if (gid) groupMembers.set(gid, [...(groupMembers.get(gid) ?? []), id]);
  }
  for (const [gid, ids] of groupMembers) {
    if (ids.length < 2) continue;
    const src = clip.groups.find((g) => g.id === gid);
    cmds.push({ type: 'object.group', payload: { ids, group: { id: newId(), name: src?.name ?? 'Group', locked: false } } });
  }
  if (run(`Paste ${newRefs.length} item${newRefs.length === 1 ? '' : 's'}`, cmds)) {
    editorActions.setClipboard({ ...clip, pastes: clip.pastes + (sameLayout ? 1 : 0) });
    uiActions.select(newRefs);
    if (!sameLayout) uiActions.flash(`Pasted ${newRefs.length} item${newRefs.length === 1 ? '' : 's'} into “${c.scenario.name}” at the same position.`);
  }
}

// ───────────── groups ─────────────

export function groupSelection(): void {
  const c = editorCtx();
  if (!c) return;
  const ids = [...new Set(expandGroups(c.scenario, sel()).filter((r) => r.kind === 'object').map((r) => r.id))];
  if (ids.length < 2) return uiActions.flash('Select two or more objects to group them.', 'info');
  const group = { id: newId(), name: `Group ${c.scenario.groups.length + 1}`, locked: false };
  if (run('Group objects', [{ type: 'object.group', payload: { ids, group } }])) uiActions.flash(`Grouped ${ids.length} objects. They now move together; double-click to pick one. Shift+G ungroups.`);
}

export function ungroupSelection(): void {
  const c = editorCtx();
  if (!c) return;
  const groups = new Set(sel().filter((r) => r.kind === 'object').map((r) => findObject(c.scenario, r.id)?.groupId).filter(Boolean) as string[]);
  if (groups.size === 0) return uiActions.flash('The selection is not grouped.', 'info');
  run('Ungroup', [...groups].map((groupId) => ({ type: 'object.ungroup', payload: { groupId } }) as AppCommand));
}

/**
 * Save the selected objects (typically a group) as one reusable custom object whose components are
 * placed together (and grouped) whenever it is added.
 */
export async function saveSelectionAsCustomObject(name: string): Promise<void> {
  const c = editorCtx();
  if (!c) return;
  const objs = expandGroups(c.scenario, sel())
    .filter((r) => r.kind === 'object')
    .map((r) => findObject(c.scenario, r.id))
    .filter((o): o is PlacedObject => !!o);
  if (objs.length === 0) return uiActions.flash('Select objects to save.', 'info');
  const polys = objs.map((o) => objectFootprint(resolveObject(c.project, o)));
  const b = bbox(polys.flat());
  const center = bboxCenter(b);
  const cats = new Map<ObjectCategory, number>();
  for (const o of objs) {
    const cat = findDefinition(c.project, o.definitionId)?.category ?? 'misc';
    cats.set(cat, (cats.get(cat) ?? 0) + 1);
  }
  const category = [...cats.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] ?? 'misc';
  // Component definitions that aren't built in must be in the library too, so the object works in any project.
  const library = useCustomLibrary.getState().definitions;
  for (const o of objs) {
    const d = findDefinition(c.project, o.definitionId);
    if (d && !BUILTIN_OBJECTS_BY_ID.has(d.id) && !library.some((x) => x.id === d.id)) await saveCustomDefinition({ ...d, source: 'custom' });
  }
  const single = objs.length === 1 ? objs[0]! : null;
  const base = single ? findDefinition(c.project, single.definitionId) : undefined;
  const def: ObjectDefinition = ObjectDefinitionSchema.parse({
    ...(base ?? {}),
    id: `custom:${newId()}`,
    name,
    category,
    width: Math.round((b.maxX - b.minX) * 100) / 100,
    depth: Math.round((b.maxY - b.minY) * 100) / 100,
    height: Math.max(...objs.map((o) => o.height + o.elevation)),
    mobility: objs.every((o) => o.mobility === 'mobile') ? 'mobile' : 'static',
    mount: single?.mount ?? 'floor',
    source: 'custom',
    approximate: false,
    notes: single?.notes ?? `Made from ${objs.length} objects: ${objs.map((o) => o.label ?? o.name).join(', ')}.`,
    ...(single
      ? {}
      : {
          clearances: [],
          states: [],
          components: objs.map((o) => ({
            definitionId: o.definitionId,
            name: o.label ?? o.name,
            x: Math.round((o.x - center.x) * 100) / 100,
            y: Math.round((o.y - center.y) * 100) / 100,
            rotation: o.rotation,
            width: o.width,
            depth: o.depth,
            height: o.height,
          })),
        }),
  });
  try {
    await saveCustomDefinition(def);
    uiActions.flash(`Saved “${name}” to My objects, available in every project.`);
  } catch (e) {
    uiActions.flash(`Could not save: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

// ───────────── align / distribute / order ─────────────

function alignable(c: EntityContext) {
  const refs = entityRefs(expandGroups(c.scenario, sel())).filter((r) => adapter(r.kind)?.translate && adapter(r.kind)?.outline(c, r.id));
  return refs.map((r) => ({ ref: r, id: refKey(r), bbox: bbox(adapter(r.kind)!.outline(c, r.id)!), fixed: !!adapter(r.kind)?.locked?.(c, r.id) }));
}

function applyTranslations(c: EntityContext, items: ReturnType<typeof alignable>, t: Array<{ id: string; dx: number; dy: number }>, label: string) {
  const cmds: AppCommand[] = [];
  // Group members move by their group's translation (groups align as a unit).
  for (const tr of t) {
    if (Math.abs(tr.dx) < 1e-6 && Math.abs(tr.dy) < 1e-6) continue;
    const it = items.find((i) => i.id === tr.id)!;
    const a = adapter(it.ref.kind)!;
    const p = a.translate!(c, it.ref.id, { x: tr.dx, y: tr.dy });
    if (p && a.commit) cmds.push(...a.commit(c, it.ref.id, p));
  }
  if (cmds.length === 0) return uiActions.flash('Already aligned.', 'info');
  run(label, cmds);
}

/** Merge grouped objects into one align item so groups keep their internal arrangement. */
function unitize(c: EntityContext, items: ReturnType<typeof alignable>) {
  const units = new Map<string, typeof items>();
  for (const it of items) {
    const g = it.ref.kind === 'object' ? findObject(c.scenario, it.ref.id)?.groupId : undefined;
    const key = g ? `group:${g}` : it.id;
    units.set(key, [...(units.get(key) ?? []), it]);
  }
  return [...units.entries()].map(([key, members]) => ({
    id: key,
    members,
    bbox: members.map((m) => m.bbox).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) })),
    fixed: members.some((m) => m.fixed),
  }));
}

export function alignSelection(mode: AlignMode): void {
  const c = editorCtx();
  if (!c) return;
  const items = alignable(c);
  const units = unitize(c, items);
  if (units.length < 2) return uiActions.flash('Select two or more items (or groups) to align them.', 'info');
  const t = alignItems(units, mode);
  const perItem = t.flatMap((tr) => units.find((u) => u.id === tr.id)!.members.map((m) => ({ id: m.id, dx: tr.dx, dy: tr.dy })));
  const names: Record<AlignMode, string> = {
    left: 'Align left',
    right: 'Align right',
    top: 'Align top',
    bottom: 'Align bottom',
    'center-horizontal': 'Align centers horizontally',
    'center-vertical': 'Align centers vertically',
  };
  applyTranslations(c, items, perItem, names[mode]);
}

export function distributeSelection(axis: DistributeAxis): void {
  const c = editorCtx();
  if (!c) return;
  const items = alignable(c);
  const units = unitize(c, items);
  if (units.length < 3) return uiActions.flash('Select three or more items (or groups) to distribute them evenly.', 'info');
  const t = distributeItems(units, axis);
  const perItem = t.flatMap((tr) => units.find((u) => u.id === tr.id)!.members.map((m) => ({ id: m.id, dx: tr.dx, dy: tr.dy })));
  applyTranslations(c, items, perItem, axis === 'horizontal' ? 'Distribute horizontally' : 'Distribute vertically');
}

export function reorderSelection(to: 'forward' | 'backward' | 'front' | 'back'): void {
  const c = editorCtx();
  if (!c) return;
  const ids = expandGroups(c.scenario, sel())
    .filter((r) => r.kind === 'object')
    .map((r) => r.id);
  if (ids.length === 0) return uiActions.flash('Stacking order applies to objects. Select an object first.', 'info');
  // Keep relative order: move the top-most first when bringing forward, bottom-most first when sending back.
  const index = new Map(c.scenario.objects.map((o, i) => [o.id, i]));
  ids.sort((a, b) => (to === 'forward' || to === 'front' ? index.get(b)! - index.get(a)! : index.get(a)! - index.get(b)!));
  const label = { forward: 'Bring forward', backward: 'Send backward', front: 'Bring to front', back: 'Send to back' }[to];
  run(label, ids.map((id) => ({ type: 'object.reorder', payload: { id, to } }) as AppCommand));
}

// ───────────── views ─────────────

export function fitSelection(): void {
  const c = editorCtx();
  if (!c) return;
  const b = refsBounds(c, sel());
  if (!b) return uiActions.flash('Nothing selected to fit.', 'info');
  const pad = Math.max(300, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.15);
  fitBoxToView(expandBBox(b, pad));
}

// ───────────── mobile tools: parked / working positions ─────────────

export function setWorkingPosition(): void {
  const c = editorCtx();
  const ref = sel()[0];
  if (!c || ref?.kind !== 'object') return;
  const o = findObject(c.scenario, ref.id);
  if (!o) return;
  const cmds: AppCommand[] = [];
  if (o.mobility !== 'mobile') cmds.push({ type: 'object.update', payload: { id: o.id, patch: { mobility: 'mobile' } } });
  if (!o.working) {
    // Start the working pose a little into the room so both positions are visible.
    const room = c.project.room.vertices;
    const center = room.length ? bboxCenter(bbox(room)) : { x: o.x, y: o.y };
    const dx = center.x - o.x;
    const dy = center.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const shift = Math.min(900, len * 0.5);
    cmds.push({ type: 'object.setWorkingPosition', payload: { id: o.id, pose: { x: o.x + (dx / len) * shift, y: o.y + (dy / len) * shift, rotation: o.rotation } } });
  }
  cmds.push({ type: 'object.update', payload: { id: o.id, patch: { activePosition: 'working' } } });
  if (run(`Set working position of ${o.label ?? o.name}`, cmds)) {
    uiActions.flash(`Editing the WORKING position of “${o.label ?? o.name}”. Drag it to where you use it; the parked spot stays as a dashed ghost.`);
  }
}

export function setParkedPosition(): void {
  const c = editorCtx();
  const ref = sel()[0];
  if (!c || ref?.kind !== 'object') return;
  const o = findObject(c.scenario, ref.id);
  if (!o) return;
  if (o.activePosition === 'parked') {
    uiActions.flash(`“${o.label ?? o.name}” is showing its parked position. Drag it to where it is stored.`);
    return;
  }
  if (run(`Show parked position of ${o.label ?? o.name}`, [{ type: 'object.update', payload: { id: o.id, patch: { activePosition: 'parked' } } }])) {
    uiActions.flash(`Editing the PARKED position of “${o.label ?? o.name}”. Drag it to where it is stored.`);
  }
}

/** Copy the selected objects into another layout (same physical items keep their identity). */
export function copyToLayout(targetScenarioId: string): void {
  const c = editorCtx();
  if (!c) return;
  const refs = expandGroups(c.scenario, sel());
  const objIds = refs.filter((r) => r.kind === 'object').map((r) => r.id);
  const target = c.project.scenarios.find((s) => s.id === targetScenarioId);
  if (!target) return;
  const cmds: AppCommand[] = [];
  if (objIds.length) cmds.push({ type: 'object.copyToScenario', payload: { fromScenarioId: c.scenario.id, toScenarioId: targetScenarioId, ids: objIds } });
  for (const r of refs) {
    if (r.kind === 'vehicle' || r.kind === 'light' || r.kind === 'zone' || r.kind === 'measurement') {
      const data = adapter(r.kind)!.copy!(c, r.id) as { id: string };
      const exists = getScenario(c.project, targetScenarioId)[`${r.kind === 'vehicle' ? 'vehicles' : r.kind === 'light' ? 'lights' : r.kind === 'zone' ? 'zones' : 'measurements'}`].some((x: { id: string }) => x.id === data.id);
      const item = { ...data, id: exists ? newId() : data.id };
      cmds.push({ type: `${r.kind}.add`, payload: { scenarioId: targetScenarioId, items: [item] } } as AppCommand);
    }
  }
  if (cmds.length === 0) return uiActions.flash('Select objects, vehicles, lights, zones or measurements to copy.', 'info');
  if (run(`Copy to “${target.name}”`, cmds)) uiActions.flash(`Copied ${refs.length} item${refs.length === 1 ? '' : 's'} to “${target.name}”.`);
}

/** Focus an inspector field after selecting (used by "Edit dimensions…"). */
export function focusInspectorField(testId: string): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
    if (el) {
      el.focus();
      el.select();
    } else focusCanvas();
  }, 30);
}

export { fmt as editorFormatters };
