/**
 * Objects UI: the library sidebar (built-in + "My objects" shared across projects; click to add or
 * drag onto the plan), the object inspector (identity, exact position/size/rotation, mobile parked /
 * working positions, zone, group, color, flags, notes), the "nothing selected" summary and palette
 * "Add …" commands. Saved groups ("stations") expand into their grouped components when added.
 */
import { Box, GripVertical, Group as GroupIcon, MapPin, Package, PenLine, Plus, RotateCcw, RotateCw, Search, Truck, Ungroup, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canvasDropHandlers, inspectorSections, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { deleteCustomDefinition, useCustomLibrary } from '@/app/services';
import { toWorld } from '@/app/canvas/viewport';
import { PropRow, Section } from '@/components/shell';
import { AngleInput, LengthInput } from '@/components/LengthInput';
import { Badge, Button, Input, Select, Tip } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { placeObject } from '@/domain/factories';
import { findDefinition, resolveObject, roomGeometry } from '@/domain/resolve';
import { ObjectDefinitionSchema, type ObjectDefinition, type PlacedObject, type Project } from '@/domain/schema';
import { containsPoint, centroid, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { transact, dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { editorActions } from '@/stores/editorStore';
import { categoryColors } from '@/styles/tokens';
import { newId } from '@/utils/id';
import { ColorField, NameField, NotesField, SwitchRow } from '@/features/editor/inspectorParts';
import { rotateSelection, setParkedPosition, setWorkingPosition, ungroupSelection } from '@/features/editor/ops';
import { BUILTIN_OBJECTS, BUILTIN_OBJECTS_BY_ID, LIBRARY_GROUPS, searchLibrary } from './library';
import { findFreeSpotNear } from './placement';

export const DEFINITION_MIME = 'application/x-wp-definition';

// ───────────── adding objects ─────────────

function lookupDefinition(project: Project, id: string): ObjectDefinition | undefined {
  return findDefinition(project, id) ?? BUILTIN_OBJECTS_BY_ID.get(id) ?? useCustomLibrary.getState().definitions.find((d) => d.id === id);
}

/**
 * Commands that add a definition at a world point. Definitions with `components` (saved groups)
 * expand into their parts, grouped. Returns the new object ids.
 */
export function addDefinitionCommands(project: Project, def: ObjectDefinition, at: Point): { commands: AppCommand[]; ids: string[] } {
  if (!def.components?.length) {
    const obj = placeObject(def, { x: Math.round(at.x), y: Math.round(at.y), rotation: 0 });
    return { commands: [{ type: 'object.add', payload: { objects: [obj], definitions: [def] } }], ids: [obj.id] };
  }
  const objects: PlacedObject[] = [];
  const defs: ObjectDefinition[] = [];
  def.components.forEach((c, i) => {
    let cd = lookupDefinition(project, c.definitionId);
    if (!cd) {
      // The part's own definition is not available here: keep its size and name as a generic item.
      cd = ObjectDefinitionSchema.parse({ id: `${def.id}:part-${i}`, name: c.name ?? `Part ${i + 1}`, category: def.category, width: c.width ?? 500, depth: c.depth ?? 500, height: c.height ?? 900, source: 'custom', approximate: false });
    }
    if (!defs.some((d) => d.id === cd!.id)) defs.push(cd);
    objects.push(
      placeObject(cd, { x: Math.round(at.x + c.x), y: Math.round(at.y + c.y), rotation: c.rotation }, { name: c.name ?? cd.name, ...(c.width ? { width: c.width } : {}), ...(c.depth ? { depth: c.depth } : {}), ...(c.height ? { height: c.height } : {}) }),
    );
  });
  const commands: AppCommand[] = [{ type: 'object.add', payload: { objects, definitions: defs } }];
  if (objects.length >= 2) commands.push({ type: 'object.group', payload: { ids: objects.map((o) => o.id), group: { id: newId(), name: def.name, locked: false } } });
  return { commands, ids: objects.map((o) => o.id) };
}

export function addObjectAt(def: ObjectDefinition, at: Point): boolean {
  const project = useProjectStore.getState().project;
  if (!project) return false;
  const { commands, ids } = addDefinitionCommands(project, def, at);
  const r = transact(`Add ${def.name}`, commands);
  if (!r.ok) {
    uiActions.flash(r.error, 'error');
    return false;
  }
  uiActions.select(ids.map((id) => ({ kind: 'object' as const, id })));
  uiActions.flash(`Added ${def.name}. Drag it into place or type exact values in the inspector.`);
  return true;
}

/** Footprint a definition occupies when dropped at rotation 0 (saved groups: the parts' extent). */
export function definitionFootprint(def: ObjectDefinition): { width: number; depth: number } {
  if (!def.components?.length) return { width: def.width, depth: def.depth };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of def.components) {
    // A rotated part is covered by its circumscribed square, close enough to keep parts apart.
    const reach = Math.max(c.width ?? def.width, c.depth ?? def.depth) / 2;
    minX = Math.min(minX, c.x - reach);
    maxX = Math.max(maxX, c.x + reach);
    minY = Math.min(minY, c.y - reach);
    maxY = Math.max(maxY, c.y + reach);
  }
  return { width: Math.max(maxX - minX, 1), depth: Math.max(maxY - minY, 1) };
}

/**
 * Add a definition to the active layout near the center of the view: at the nearest spot where it
 * actually fits (inside the room, clear of what is already there), so repeated clicks never stack
 * items on top of each other or drop them on the car.
 */
export function addObjectFromDefinition(def: ObjectDefinition): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const { viewport, canvasSize } = useUiStore.getState();
  let pos = toWorld(viewport, { x: canvasSize.width / 2, y: canvasSize.height / 2 });
  const room = roomGeometry(project.room);
  if (room.polygon.length >= 3 && !containsPoint(room.polygon, pos)) pos = centroid(room.polygon);
  const free = findFreeSpotNear(project, project.activeScenarioId, definitionFootprint(def), pos);
  if (!free) {
    // Nowhere free: still add it (the user asked for it) but say why it lands on top of something.
    if (addObjectAt(def, pos)) uiActions.flash(`No clear floor space for ${def.name}, so it was added where you were looking. Move it or make room.`, 'warning');
    return;
  }
  addObjectAt(def, free);
}

canvasDropHandlers.register({
  id: 'objects.library-drop',
  type: DEFINITION_MIME,
  drop(data, world) {
    const project = useProjectStore.getState().project;
    const def = project ? lookupDefinition(project, data) : undefined;
    if (def) addObjectAt(def, world);
  },
});

// ───────────── library panel ─────────────

function LibraryItem({ def, custom }: { def: ObjectDefinition; custom?: boolean }) {
  const fmt = useFormatters();
  const color = categoryColors[def.category];
  return (
    <li className="group flex items-center gap-1 rounded-md hover:bg-panel-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-grab items-center gap-2 px-2 py-1.5 text-left active:cursor-grabbing"
        onClick={() => addObjectFromDefinition(def)}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DEFINITION_MIME, def.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title={`Add ${def.name}: click to add, or drag onto the plan`}
        data-testid="library-item"
      >
        <GripVertical className="size-3 shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
        <span className="size-3 shrink-0 rounded-sm border" style={{ background: def.color ?? color.fill, borderColor: color.stroke }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink">{def.name}</span>
          <span className="num block text-2xs text-ink-faint">
            {fmt.length(def.width)} × {fmt.length(def.depth)} · {fmt.length(def.height)} h
          </span>
        </span>
        {def.components?.length ? <Badge>{def.components.length} parts</Badge> : null}
        {def.mobility === 'mobile' && <Badge tone="info">mobile</Badge>}
        {def.mount !== 'floor' && <Badge>{def.mount}</Badge>}
      </button>
      {custom && (
        <Tip content="Edit details">
          <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100" aria-label={`Edit ${def.name}`} onClick={() => editorActions.openDialog('custom-object', { definitionId: def.id })}>
            <PenLine />
          </Button>
        </Tip>
      )}
      {custom && (
        <Tip content="Remove from My objects">
          <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100" aria-label={`Remove ${def.name} from My objects`} onClick={() => void deleteCustomDefinition(def.id)}>
            <X />
          </Button>
        </Tip>
      )}
    </li>
  );
}

function LibraryPanel() {
  const [query, setQuery] = useState('');
  const custom = useCustomLibrary((s) => s.definitions);
  const results = useMemo(() => searchLibrary(BUILTIN_OBJECTS, query), [query]);
  const customResults = useMemo(() => searchLibrary(custom, query), [custom, query]);
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-panel p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-ink-faint" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools, storage…" aria-label="Search the object library" className="pl-7" data-testid="library-search" />
        </div>
        <p className="mt-1.5 text-2xs text-ink-faint">Click to add at the center of the view, or drag onto the plan.</p>
      </div>
      <Section
        title="My objects"
        actions={
          <Tip content="New custom object (your own measured item)">
            <Button variant="ghost" size="icon-sm" aria-label="New custom object" onClick={() => editorActions.openDialog('custom-object')} data-testid="library-new-custom">
              <Plus />
            </Button>
          </Tip>
        }
      >
        {customResults.length === 0 ? (
          <p className="text-2xs text-ink-faint">
            {custom.length === 0 ? 'Right-click any object (or a group) on the plan and choose “Save to My objects” to reuse it in every project.' : 'No matches.'}
          </p>
        ) : (
          <ul>
            {customResults.map((d) => (
              <LibraryItem key={d.id} def={d} custom />
            ))}
          </ul>
        )}
      </Section>
      {LIBRARY_GROUPS.map((g) => {
        const items = results.filter(g.filter);
        if (items.length === 0) return null;
        return (
          <Section key={g.id} title={g.title} defaultOpen={query.length > 0 || g.id !== 'misc'}>
            <ul>
              {items.map((d) => (
                <LibraryItem key={d.id} def={d} />
              ))}
            </ul>
          </Section>
        );
      })}
      {query && results.length === 0 && customResults.length === 0 && <p className="px-3 py-6 text-center text-xs text-ink-muted">Nothing matches “{query}”.</p>}
      <p className="px-3 py-3 text-2xs text-ink-faint">Sizes are approximate typical values. Measure your own and type exact dimensions in the inspector.</p>
    </div>
  );
}

sidebarSections.register({ id: 'library', title: 'Object library', icon: Package, order: 40, component: LibraryPanel });

// ───────────── inspector ─────────────

const singleObject = (ctx: SelectionContext): PlacedObject | undefined => (ctx.single?.kind === 'object' ? ctx.scenario.objects.find((o) => o.id === ctx.single!.id) : undefined);

function update(id: string, patch: Partial<PlacedObject>, unset?: string[]) {
  const r = dispatch({ type: 'object.update', payload: { id, patch, unset } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

const CATEGORY_LABEL: Record<string, string> = {
  'work-surface': 'Work surface',
  'stationary-tool': 'Stationary tool',
  storage: 'Storage',
  misc: 'Miscellaneous',
  'dust-collection': 'Dust collection',
  unknown: 'Unknown',
};

function ObjectIdentity({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  const def = findDefinition(ctx.project, o.definitionId);
  return (
    <div className="space-y-1">
      <NameField value={o.name} onCommit={(name) => name && update(o.id, { name })} testId="object-name" />
      <NameField label="Label" value={o.label ?? ''} placeholder={o.name} onCommit={(v) => (v ? update(o.id, { label: v }) : update(o.id, {}, ['label']))} testId="object-label" />
      <PropRow label="Type">
        <span className="flex items-center gap-1.5 truncate text-xs text-ink-muted">
          {def?.name ?? 'Unknown'} {def?.approximate && <Badge>approx. size</Badge>}
        </span>
      </PropRow>
      <PropRow label="Category">
        <span className="text-xs text-ink-muted">{CATEGORY_LABEL[def?.category ?? 'unknown']}</span>
      </PropRow>
    </div>
  );
}

function ObjectGeometry({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  const r = resolveObject(ctx.project, o);
  const working = o.mobility === 'mobile' && o.activePosition === 'working' && o.working;
  const pose = working ? o.working! : o;
  const move = (x: number, y: number, rotation?: number) => {
    const res = dispatch({ type: 'object.move', payload: { moves: [{ id: o.id, x, y, rotation }], position: working ? 'working' : 'parked' } });
    if (!res.ok) uiActions.flash(res.error, 'error');
  };
  return (
    <div className="space-y-1">
      {working && <p className="pb-1 text-2xs text-info">Editing the WORKING position (the parked spot is shown dashed).</p>}
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="X">
          <LengthInput aria-label="X position" value={pose.x} allowNegative onCommit={(x) => move(x, pose.y)} data-testid="inspector-x" />
        </PropRow>
        <PropRow label="Y">
          <LengthInput aria-label="Y position" value={pose.y} allowNegative onCommit={(y) => move(pose.x, y)} data-testid="inspector-y" />
        </PropRow>
      </div>
      <PropRow label="Rotation">
        <div className="flex items-center gap-1">
          <AngleInput aria-label="Rotation" value={pose.rotation} onCommit={(deg) => move(pose.x, pose.y, deg)} data-testid="inspector-rotation" />
          <Tip content="Rotate 90° counter-clockwise" shortcut="⇧R">
            <Button size="icon-sm" variant="ghost" aria-label="Rotate 90° counter-clockwise" onClick={() => rotateSelection(-90)}>
              <RotateCcw />
            </Button>
          </Tip>
          <Tip content="Rotate 90° clockwise" shortcut="R">
            <Button size="icon-sm" variant="ghost" aria-label="Rotate 90° clockwise" onClick={() => rotateSelection(90)}>
              <RotateCw />
            </Button>
          </Tip>
        </div>
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Width">
          <LengthInput aria-label="Width" value={o.width} allowZero={false} onCommit={(width) => update(o.id, { width })} data-testid="inspector-width" />
        </PropRow>
        <PropRow label="Depth">
          <LengthInput aria-label="Depth" value={o.depth} allowZero={false} onCommit={(depth) => update(o.id, { depth })} data-testid="inspector-depth" />
        </PropRow>
        <PropRow label="Height">
          <LengthInput aria-label="Height" value={o.height} allowZero={false} onCommit={(height) => update(o.id, { height })} data-testid="inspector-height" />
        </PropRow>
        <PropRow label="Z (bottom)">
          <LengthInput aria-label="Elevation" value={o.elevation} onCommit={(elevation) => update(o.id, { elevation })} data-testid="inspector-z" />
        </PropRow>
      </div>
      {r.state && <p className="pt-1 text-2xs text-ink-muted">State: {r.state.name}</p>}
      <p className="text-2xs text-ink-faint">X / Y is the center of the footprint. Width runs left–right, depth front–back (the notch marks the front).</p>
    </div>
  );
}

function ObjectMobility({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  const mobile = o.mobility === 'mobile';
  return (
    <div className="space-y-1">
      <SwitchRow label="Mobile (on wheels)" checked={mobile} onChange={(v) => update(o.id, { mobility: v ? 'mobile' : 'static', ...(v ? {} : { activePosition: 'parked' }) })} testId="object-mobile" />
      {mobile && (
        <>
          <div className="flex gap-1" role="group" aria-label="Which position to show and edit">
            <Button size="sm" variant={o.activePosition === 'parked' ? 'primary' : 'outline'} className="flex-1" onClick={setParkedPosition} aria-pressed={o.activePosition === 'parked'}>
              <MapPin /> Parked
            </Button>
            <Button size="sm" variant={o.activePosition === 'working' ? 'primary' : 'outline'} className="flex-1" onClick={setWorkingPosition} aria-pressed={o.activePosition === 'working'}>
              <Truck /> Working
            </Button>
          </div>
          <p className="text-2xs text-ink-faint">
            {o.working ? 'Both positions are shown; the other one is dashed. Clearances are checked where the tool is used.' : 'Choose Working to set where it rolls to when in use.'}
          </p>
          {o.working && (
            <div className="flex flex-wrap gap-1">
              {o.activePosition === 'working' ? (
                <Tip content="Make the current (working) spot the parked spot too">
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'object.move', payload: { moves: [{ id: o.id, x: o.working!.x, y: o.working!.y, rotation: o.working!.rotation }], position: 'parked' } })}>
                    Set parked from current
                  </Button>
                </Tip>
              ) : (
                <Tip content="Make the current (parked) spot the working spot too">
                  <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'object.setWorkingPosition', payload: { id: o.id, pose: { x: o.x, y: o.y, rotation: o.rotation } } })}>
                    Set working from current
                  </Button>
                </Tip>
              )}
              <Tip content="Swap the parked and working spots">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    transact('Swap parked and working positions', [
                      { type: 'object.move', payload: { moves: [{ id: o.id, x: o.working!.x, y: o.working!.y, rotation: o.working!.rotation }], position: 'parked' } },
                      { type: 'object.setWorkingPosition', payload: { id: o.id, pose: { x: o.x, y: o.y, rotation: o.rotation } } },
                    ])
                  }
                >
                  Swap
                </Button>
              </Tip>
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'object.setWorkingPosition', payload: { id: o.id, pose: null } })}>
                Remove working position
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ObjectOrganize({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  const group = o.groupId ? ctx.scenario.groups.find((g) => g.id === o.groupId) : undefined;
  const fill = categoryColors[findDefinition(ctx.project, o.definitionId)?.category ?? 'unknown'].fill;
  return (
    <div className="space-y-1">
      <PropRow label="Zone">
        <Select
          className="h-7"
          ariaLabel="Workflow zone"
          value={o.zoneId ?? 'none'}
          onValueChange={(v) => (v === 'none' ? update(o.id, {}, ['zoneId']) : update(o.id, { zoneId: v }))}
          options={[{ value: 'none', label: ctx.scenario.zones.length ? 'None' : 'No zones yet' }, ...ctx.scenario.zones.map((z) => ({ value: z.id, label: z.name }))]}
        />
      </PropRow>
      {group && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs">
          <GroupIcon className="size-3.5 text-ink-muted" />
          <span className="min-w-0 flex-1 truncate">
            Part of <b>{group.name}</b>
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={() => uiActions.select(ctx.scenario.objects.filter((x) => x.groupId === group.id).map((x) => ({ kind: 'object' as const, id: x.id })))}>
            Select group
          </Button>
          <Tip content="Ungroup" shortcut="⇧G">
            <Button size="icon-sm" variant="ghost" aria-label="Ungroup" onClick={ungroupSelection}>
              <Ungroup />
            </Button>
          </Tip>
        </div>
      )}
      <ColorField value={o.color} fallback={fill} onChange={(color) => update(o.id, { color })} onReset={() => update(o.id, {}, ['color'])} />
    </div>
  );
}

function ObjectFlags({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  return (
    <div>
      <SwitchRow label="Locked" checked={o.locked} onChange={(v) => update(o.id, { locked: v })} testId="object-locked" hint="Locked items can't be moved, resized or deleted until unlocked (L)" />
      <SwitchRow label="Hidden" checked={o.hidden} onChange={(v) => update(o.id, { hidden: v })} testId="object-hidden" />
      <NotesField value={o.notes} onCommit={(notes) => update(o.id, { notes })} />
    </div>
  );
}

const isSingleObject = (ctx: SelectionContext) => singleObject(ctx) !== undefined;
inspectorSections.register({ id: 'object.identity', title: 'Object', order: 10, appliesTo: isSingleObject, component: ObjectIdentity });
inspectorSections.register({ id: 'object.geometry', title: 'Position & size', order: 20, appliesTo: isSingleObject, component: ObjectGeometry });
inspectorSections.register({ id: 'object.mobility', title: 'Mobile tool', order: 30, appliesTo: isSingleObject, component: ObjectMobility });
inspectorSections.register({ id: 'object.organize', title: 'Zone, group & color', order: 35, appliesTo: isSingleObject, component: ObjectOrganize });
inspectorSections.register({ id: 'object.flags', title: 'Options & notes', order: 90, appliesTo: isSingleObject, component: ObjectFlags });

// ───────────── nothing selected ─────────────

function NothingSelected({ ctx }: { ctx: SelectionContext }) {
  const fmt = useFormatters();
  const hasRoom = ctx.project.room.vertices.length >= 3;
  const count = ctx.scenario.objects.length;
  const g = hasRoom ? roomGeometry(ctx.project.room) : null;
  return (
    <div className="space-y-3 text-xs text-ink-muted">
      {!hasRoom ? (
        <>
          <p>Start by drawing your garage. Everything else is placed inside it.</p>
          <Button size="sm" variant="primary" onClick={() => uiActions.setTool('wall')}>
            <PenLine /> Draw walls (W)
          </Button>
          <Button size="sm" variant="outline" onClick={() => uiActions.setLeftSection('room')}>
            More ways to create the room…
          </Button>
        </>
      ) : (
        <>
          <p>Select something on the plan to see and edit its exact dimensions.</p>
          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5">
            <dt>Layout</dt>
            <dd className="text-ink">{ctx.scenario.name}</dd>
            <dt>Objects</dt>
            <dd className="num text-ink">{count}</dd>
            <dt>Walls</dt>
            <dd className="num text-ink">{g!.walls.length}</dd>
            <dt>Ceiling</dt>
            <dd className="num text-ink">{fmt.length(ctx.project.room.ceilingHeight)}</dd>
          </dl>
          <Button size="sm" variant="outline" onClick={() => uiActions.setLeftSection('library')}>
            <Box /> Add from the library
          </Button>
          <p className="text-2xs text-ink-faint">Tip: drag on empty floor to select several items. Hold Alt while dragging to turn snapping off.</p>
        </>
      )}
    </div>
  );
}
inspectorSections.register({ id: 'none.summary', title: 'Getting started', order: 10, appliesTo: (c) => c.refs.length === 0, component: NothingSelected });

// ───────────── palette ─────────────
for (const def of BUILTIN_OBJECTS) {
  paletteCommands.register({
    id: `objects.add.${def.id}`,
    title: `Add ${def.name}`,
    section: 'Add object',
    keywords: [def.category, ...def.tags],
    icon: Package,
    order: 50,
    when: (c) => !!c.project,
    run: () => addObjectFromDefinition(def),
  });
}
