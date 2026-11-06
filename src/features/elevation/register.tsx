/**
 * Wall elevation: registers the "Elevation" center view, ways to open it for a wall (wall context
 * menu, wall inspector, palette), and the object inspector's "Vertical space" section (clear
 * height above the item and what could be stacked there).
 */
import { PanelTop } from 'lucide-react';
import { useMemo } from 'react';
import { appViews, contextMenuActions, inspectorSections, paletteCommands, type SelectionContext } from '@/app/registry';
import { Button } from '@/components/ui';
import { resolveObject, roomGeometry } from '@/domain/resolve';
import { useFormatters } from '@/hooks/useFormatters';
import { uiActions } from '@/stores/uiStore';
import { BUILTIN_OBJECTS } from '@/features/objects/library';
import { ElevationView } from './ElevationView';
import { stackingOpportunities, verticalSpaceAbove, wallElevation } from './model';
import { openElevation } from './store';

appViews.register({ id: 'elevation', label: 'Elevation', icon: PanelTop, order: 30, component: ElevationView });

const open = (wallId: string) => openElevation(wallId, uiActions.setView);

contextMenuActions.register({
  id: 'elevation.open-wall',
  group: 'inspect',
  order: 30,
  icon: PanelTop,
  label: 'Open wall elevation',
  appliesTo: (c) => c.single?.kind === 'wall',
  run: (c) => open(c.single!.id),
});

function WallElevationSection({ ctx }: { ctx: SelectionContext }) {
  const wallId = ctx.single!.id;
  const fmt = useFormatters();
  const el = useMemo(() => wallElevation(ctx.project, wallId), [ctx.project, wallId]);
  const ops = useMemo(() => (el ? stackingOpportunities(el, BUILTIN_OBJECTS, fmt.length) : []), [el, fmt]);
  return (
    <div className="space-y-1.5">
      <Button size="sm" variant="outline" onClick={() => open(wallId)} data-testid="open-elevation">
        <PanelTop /> Open wall elevation
      </Button>
      <p className="text-2xs text-ink-faint">
        Front-facing view of this wall with {el?.items.length ?? 0} item{el?.items.length === 1 ? '' : 's'}, exact heights and stacking room.
        {ops.length ? ` ${ops.length} spot${ops.length === 1 ? '' : 's'} could take wall storage.` : ''}
      </p>
    </div>
  );
}
inspectorSections.register({ id: 'wall.elevation', title: 'Elevation', order: 22, appliesTo: (c) => c.single?.kind === 'wall', component: WallElevationSection });

/** The wall an object stands against (for "open elevation" from an object). */
function wallFor(ctx: SelectionContext, objectId: string): string | undefined {
  const o = ctx.scenario.objects.find((x) => x.id === objectId);
  if (!o) return undefined;
  if (o.wallId && ctx.project.room.walls.some((w) => w.id === o.wallId)) return o.wallId;
  for (const w of ctx.project.room.walls) if (wallElevation(ctx.project, w.id)?.items.some((i) => i.ref.id === objectId)) return w.id;
  return undefined;
}

function VerticalSpaceSection({ ctx }: { ctx: SelectionContext }) {
  const id = ctx.single!.id;
  const fmt = useFormatters();
  const v = useMemo(() => verticalSpaceAbove(ctx.project, id), [ctx.project, id]);
  const wallId = useMemo(() => wallFor(ctx, id), [ctx, id]);
  const op = useMemo(() => {
    if (!wallId) return undefined;
    const el = wallElevation(ctx.project, wallId);
    return el ? stackingOpportunities(el, BUILTIN_OBJECTS, fmt.length).find((s) => s.objectId === id) : undefined;
  }, [ctx.project, wallId, id, fmt]);
  if (!v) return null;
  const o = ctx.scenario.objects.find((x) => x.id === id)!;
  const r = resolveObject(ctx.project, o);
  return (
    <div className="space-y-1 text-xs text-ink-muted" data-testid="vertical-space">
      <dl className="grid grid-cols-[1fr_auto] gap-y-0.5">
        <dt>Occupies</dt>
        <dd className="num text-ink">
          {fmt.length(r.elevation)} – {fmt.length(v.top)}
        </dd>
        <dt>Clear above</dt>
        <dd className="num text-ink">
          {fmt.length(v.available)} (to {v.limitName})
        </dd>
      </dl>
      {op && <p className="text-2xs leading-snug text-ok">{op.message}</p>}
      {wallId && (
        <Button size="sm" variant="ghost" onClick={() => open(wallId)}>
          <PanelTop /> View on the {roomGeometry(ctx.project.room).walls[roomGeometry(ctx.project.room).wallIndex.get(wallId) ?? 0]?.name ?? 'wall'} elevation
        </Button>
      )}
    </div>
  );
}
inspectorSections.register({ id: 'object.vertical', title: 'Vertical space', order: 48, appliesTo: (c) => c.single?.kind === 'object', component: VerticalSpaceSection, collapsed: true });

paletteCommands.register({
  id: 'elevation.open',
  title: 'Open wall elevation',
  section: 'View',
  icon: PanelTop,
  keywords: ['elevation', 'wall', 'vertical', 'front view'],
  when: (c) => !!c.project && c.project.room.walls.length >= 3,
  run: (c) => {
    const sel = c.selection.find((r) => r.kind === 'wall');
    open(sel?.id ?? c.project!.room.walls[0]!.id);
  },
});
