/**
 * Object states: switch an object between its states (miter station wings folded / open, table
 * folded / deployed, ladder…) from the inspector, the context menu or the palette; the garage door
 * opens / closes from its context menu. Analysis follows the selected state automatically (state
 * footprints, heights and clearance zones are resolved in `resolveObject`). Vehicle doors-open is in
 * the vehicle inspector.
 */
import { Repeat } from 'lucide-react';
import { contextMenuActions, inspectorSections, paletteCommands, type SelectionContext } from '@/app/registry';
import { Button } from '@/components/ui';
import { findDefinition, getScenario, resolveObject } from '@/domain/resolve';
import type { ObjectDefinition, PlacedObject, Project } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';

function objectOf(c: { project: Project; scenario: { objects: PlacedObject[] } }, id: string): { o: PlacedObject; def: ObjectDefinition } | null {
  const o = c.scenario.objects.find((x) => x.id === id);
  const def = o ? findDefinition(c.project, o.definitionId) : undefined;
  return o && def && def.states.length > 0 ? { o, def } : null;
}

const currentState = (o: PlacedObject, def: ObjectDefinition) => o.stateId ?? def.defaultStateId ?? def.states[0]!.id;

export function setObjectState(id: string, stateId: string): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const hit = objectOf({ project, scenario: getScenario(project) }, id);
  if (!hit) return;
  const name = hit.def.states.find((s) => s.id === stateId)?.name ?? stateId;
  const r = dispatch({ type: 'object.update', payload: { id, patch: { stateId } } });
  if (!r.ok) uiActions.flash(r.error, 'error');
  else uiActions.flash(`${hit.o.label ?? hit.o.name}: ${name}. Clearances and warnings now use this state.`);
}

function nextState(o: PlacedObject, def: ObjectDefinition) {
  const i = def.states.findIndex((s) => s.id === currentState(o, def));
  return def.states[(i + 1) % def.states.length]!;
}

function StatesSection({ ctx }: { ctx: SelectionContext }) {
  const fmt = useFormatters();
  const { o, def } = objectOf(ctx, ctx.single!.id)!;
  const cur = currentState(o, def);
  const r = resolveObject(ctx.project, o);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Object state">
        {def.states.map((s) => (
          <Button key={s.id} size="sm" variant={s.id === cur ? 'primary' : 'outline'} className="flex-1" aria-pressed={s.id === cur} onClick={() => setObjectState(o.id, s.id)} data-testid={`state-${s.id}`}>
            {s.name}
          </Button>
        ))}
      </div>
      <p className="text-2xs text-ink-muted">
        In this state: {fmt.length(r.footprint.width)} × {fmt.length(r.footprint.depth)}, {fmt.length(r.height)} tall, {r.clearances.length} clearance zone{r.clearances.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
inspectorSections.register({ id: 'object.states', title: 'State', order: 60, appliesTo: (c) => c.single?.kind === 'object' && !!objectOf(c, c.single.id), component: StatesSection });

contextMenuActions.register({
  id: 'states.cycle',
  group: 'state',
  order: 1,
  icon: Repeat,
  label: (c) => {
    const hit = objectOf(c, c.single!.id)!;
    return `Switch to “${nextState(hit.o, hit.def).name}”`;
  },
  appliesTo: (c) => c.single?.kind === 'object' && !!objectOf(c, c.single.id),
  run: (c) => {
    const hit = objectOf(c, c.single!.id)!;
    setObjectState(hit.o.id, nextState(hit.o, hit.def).id);
  },
});

const garageOf = (c: SelectionContext) => (c.single?.kind === 'feature' ? c.project.architecture.find((f) => f.id === c.single!.id && f.kind === 'garage-door' && f.garageDoor) : undefined);
contextMenuActions.register({
  id: 'states.garage-door',
  group: 'state',
  order: 2,
  icon: Repeat,
  label: (c) => (garageOf(c)?.garageDoor?.state === 'open' ? 'Close garage door' : 'Open garage door'),
  appliesTo: (c) => !!garageOf(c),
  run: (c) => {
    const f = garageOf(c)!;
    const state = f.garageDoor!.state === 'open' ? 'closed' : 'open';
    const r = dispatch({ type: 'feature.update', payload: { id: f.id, patch: { garageDoor: { ...f.garageDoor!, state } } } });
    if (!r.ok) uiActions.flash(r.error, 'error');
  },
});

paletteCommands.register({
  id: 'states.cycle',
  title: 'Switch state of the selected object',
  section: 'Edit',
  icon: Repeat,
  keywords: ['state', 'fold', 'open', 'wings', 'deploy'],
  when: (c) => {
    if (!c.project || c.selection.length !== 1 || c.selection[0]!.kind !== 'object') return false;
    return !!objectOf({ project: c.project, scenario: getScenario(c.project) }, c.selection[0]!.id);
  },
  run: (c) => {
    const hit = objectOf({ project: c.project!, scenario: getScenario(c.project!) }, c.selection[0]!.id)!;
    setObjectState(hit.o.id, nextState(hit.o, hit.def).id);
  },
});
