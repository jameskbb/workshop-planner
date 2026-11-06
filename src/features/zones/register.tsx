/**
 * Workflow zones: Zone tool, Zones sidebar (list, visibility, draw) and the zone inspector (name,
 * type, color, area, member objects).
 */
import { Eye, EyeOff, Lock, SquareDashedMousePointer, UserPlus, X } from 'lucide-react';
import { canvasTools, inspectorSections, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { PropRow, Section } from '@/components/shell';
import { Button, EmptyState, Select, Tip } from '@/components/ui';
import { getScenario, objectFootprint, resolveObject } from '@/domain/resolve';
import { WORKFLOW_ZONE_KINDS, type PlacedObject, type WorkflowZone } from '@/domain/schema';
import { area, bboxCenter, bbox, containsPoint } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { zoneKindColors } from '@/styles/tokens';
import { cn } from '@/utils/cn';
import { ColorField, NameField, NotesField, SwitchRow } from '@/features/editor/inspectorParts';
import { useZoneDraw, zoneTool, ZONE_KIND_LABELS } from './tool';

canvasTools.register(zoneTool);

function startZone(shape: 'rect' | 'polygon') {
  useZoneDraw.setState({ shape, points: [], start: null });
  uiActions.setTool('zone');
}

function ZonesPanel() {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const fmt = useFormatters();
  if (!project) return null;
  const zones = getScenario(project).zones;
  const layerOn = project.layers.zones?.visible ?? true;
  return (
    <div>
      <Section title="Draw">
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" variant="outline" onClick={() => startZone('rect')} data-testid="zone-rect">
            Rectangle zone
          </Button>
          <Button size="sm" variant="outline" onClick={() => startZone('polygon')}>
            Polygon zone
          </Button>
        </div>
        <label className="mt-2 flex items-center justify-between text-xs text-ink-muted">
          Show zones on the plan
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'layer.setVisibility', payload: { layer: 'zones', visible: !layerOn } })} aria-pressed={layerOn}>
            {layerOn ? <Eye /> : <EyeOff />} {layerOn ? 'Shown' : 'Hidden'}
          </Button>
        </label>
      </Section>
      <Section title={`Zones (${zones.length})`}>
        {zones.length === 0 ? (
          <EmptyState icon={<SquareDashedMousePointer />} title="No zones yet">
            Mark areas like Parking, Woodworking or Assembly so the plan reads at a glance. Press <b>Z</b> to draw one.
          </EmptyState>
        ) : (
          <ul className="space-y-0.5" aria-label="Zones">
            {zones.map((z) => {
              const members = getScenario(project).objects.filter((o) => o.zoneId === z.id).length;
              const sel = selection.some((s) => s.kind === 'zone' && s.id === z.id);
              return (
                <li key={z.id} className={cn('flex items-center gap-1 rounded pr-1', sel ? 'bg-select/15' : 'hover:bg-panel-2')}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs" onClick={() => uiActions.select([{ kind: 'zone', id: z.id }])}>
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: z.color ?? zoneKindColors[z.kind] }} />
                    <span className={cn('min-w-0 flex-1 truncate', z.hidden ? 'text-ink-faint line-through' : 'text-ink')}>{z.name}</span>
                    <span className="num shrink-0 text-2xs text-ink-faint">
                      {fmt.area(area(z.points))}
                      {members ? ` · ${members}` : ''}
                    </span>
                    {z.locked && <Lock className="size-3 text-ink-faint" aria-label="Locked" />}
                  </button>
                  <Tip content={z.hidden ? 'Show zone' : 'Hide zone'}>
                    <Button size="icon-sm" variant="ghost" aria-label={z.hidden ? `Show ${z.name}` : `Hide ${z.name}`} onClick={() => dispatch({ type: 'zone.update', payload: { id: z.id, patch: { hidden: !z.hidden } } })}>
                      {z.hidden ? <EyeOff /> : <Eye />}
                    </Button>
                  </Tip>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
sidebarSections.register({ id: 'zones', title: 'Zones', icon: SquareDashedMousePointer, order: 70, component: ZonesPanel });

// ───────────── inspector ─────────────

const single = (c: SelectionContext): WorkflowZone | undefined => (c.single?.kind === 'zone' ? c.scenario.zones.find((z) => z.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<WorkflowZone>, unset: string[] = []) {
  const r = dispatch({ type: 'zone.update', payload: { id, patch, unset } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

/** Objects whose footprint center lies inside the zone. */
export function objectsInside(c: SelectionContext, z: WorkflowZone): PlacedObject[] {
  return c.scenario.objects.filter((o) => containsPoint(z.points, bboxCenter(bbox(objectFootprint(resolveObject(c.project, o))))));
}

function ZoneMain({ ctx }: { ctx: SelectionContext }) {
  const z = single(ctx)!;
  const fmt = useFormatters();
  return (
    <div className="space-y-1">
      <NameField value={z.name} onCommit={(name) => name && update(z.id, { name })} testId="zone-name" />
      <PropRow label="Type">
        <Select className="h-7" ariaLabel="Zone type" value={z.kind} onValueChange={(v) => update(z.id, { kind: v as WorkflowZone['kind'] })} options={WORKFLOW_ZONE_KINDS.map((k) => ({ value: k, label: ZONE_KIND_LABELS[k] }))} />
      </PropRow>
      <PropRow label="Area">
        <span className="num text-xs text-ink">{fmt.area(area(z.points))}</span>
      </PropRow>
      <ColorField value={z.color} fallback={zoneKindColors[z.kind] ?? '#999999'} onChange={(color) => update(z.id, { color })} onReset={() => update(z.id, {}, ['color'])} />
      <SwitchRow label="Locked" checked={z.locked} onChange={(locked) => update(z.id, { locked })} />
      <SwitchRow label="Hidden" checked={z.hidden} onChange={(hidden) => update(z.id, { hidden })} />
      <NotesField value={z.notes} onCommit={(notes) => update(z.id, { notes })} />
    </div>
  );
}

function ZoneMembers({ ctx }: { ctx: SelectionContext }) {
  const z = single(ctx)!;
  const members = ctx.scenario.objects.filter((o) => o.zoneId === z.id);
  const inside = objectsInside(ctx, z);
  const unassigned = inside.filter((o) => o.zoneId !== z.id);
  return (
    <div className="space-y-2">
      {members.length === 0 ? (
        <p className="text-2xs text-ink-faint">No objects belong to this zone yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {members.map((o) => (
            <li key={o.id} className="flex items-center gap-1 text-xs">
              <button type="button" className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-ink hover:bg-panel-2" onClick={() => uiActions.select([{ kind: 'object', id: o.id }])}>
                {o.label ?? o.name}
              </button>
              <Tip content="Remove from zone">
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${o.name} from ${z.name}`} onClick={() => dispatch({ type: 'object.update', payload: { id: o.id, unset: ['zoneId'] } })}>
                  <X />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      {unassigned.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          data-testid="zone-assign-inside"
          onClick={() =>
            transact(
              `Assign ${unassigned.length} objects to ${z.name}`,
              unassigned.map((o) => ({ type: 'object.update' as const, payload: { id: o.id, patch: { zoneId: z.id } } })),
            )
          }
        >
          <UserPlus /> Assign the {unassigned.length} object{unassigned.length === 1 ? '' : 's'} inside
        </Button>
      )}
    </div>
  );
}

const is = (c: SelectionContext) => !!single(c);
inspectorSections.register({ id: 'zone.main', title: 'Zone', order: 10, appliesTo: is, component: ZoneMain });
inspectorSections.register({ id: 'zone.members', title: 'Objects in this zone', order: 40, appliesTo: is, component: ZoneMembers });

paletteCommands.register({ id: 'zones.draw', title: 'Draw a zone', section: 'Zones', icon: SquareDashedMousePointer, shortcut: 'z', keywords: ['area', 'workflow', 'parking'], when: (c) => !!c.project, run: () => startZone('rect') });
paletteCommands.register({
  id: 'zones.toggle',
  title: 'Show / hide zones',
  section: 'Zones',
  icon: Eye,
  when: (c) => !!c.project,
  run: (c) => dispatch({ type: 'layer.setVisibility', payload: { layer: 'zones', visible: !(c.project!.layers.zones?.visible ?? true) } }),
});
