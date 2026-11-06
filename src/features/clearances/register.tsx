/**
 * Clearance engine UI.
 *
 *  - Three independent overlays: Physical footprint (grey cross-hatch + height tag), Operational
 *    clearance (orange, diagonal hatch, dashed edge) and Maintenance clearance (purple, dotted
 *    edge). Zones rotate with their object and follow live drags; mobile tools show their zones at
 *    the working position (where the analysis checks them).
 *  - Conflicts: a zone that a wall, object, fixture or vehicle intrudes into gets a red edge, the
 *    intrusion is tinted red and the zone label shows how much is blocked.
 *  - The selected object's zones are always shown (faintly) even with the overlays off.
 *  - Inspector "Clearances" section: edit named zones per object, see which are blocked and why.
 *  - Legend with the overlay toggles.
 */
import { Eye, EyeOff, RotateCcw, Scan } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Group, Line, Text } from 'react-konva';
import type { Warning } from '@/analysis';
import { canvasLayers, canvasOverlays, inspectorSections, paletteCommands, type SelectionContext } from '@/app/registry';
import { Button, Tip } from '@/components/ui';
import { findObject, getScenario, resolveObject } from '@/domain/resolve';
import type { ClearanceZone, PlacedObject } from '@/domain/schema';
import { bbox, centroid, zoneWorldPolygon, type MultiPolygon, type Pose } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { useObjectIds } from '@/hooks/useProject';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { isOverlayOn, uiActions, useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { useWarnings } from '@/features/warnings/register';
import { cssHatch, hatch, type HatchStyle } from './patterns';
import { zoneGroup, zoneTitle } from './presets';
import { ZoneListEditor, type ZoneStatus } from './ZoneListEditor';

export const OVERLAY_OPERATIONAL = 'clearances';
export const OVERLAY_MAINTENANCE = 'clearances-maintenance';
export const OVERLAY_PHYSICAL = 'clearances-physical';

const STYLE = {
  operational: { color: '#e08a2e', hatch: 'diag' as HatchStyle, dash: [7, 4] },
  maintenance: { color: '#8a7cc4', hatch: 'cross' as HatchStyle, dash: [2, 3] },
  physical: { color: '#4b5259', hatch: 'back-diag' as HatchStyle },
  conflict: '#e5484d',
};

interface ZoneConflict {
  depth: number;
  regions: MultiPolygon;
  message: string;
}

/** objectId → zoneId → conflict, from the clearance analyzer's warnings. */
function useZoneConflicts(): Map<string, Map<string, ZoneConflict>> {
  const warnings = useWarnings();
  return useMemo(() => conflictMap(warnings), [warnings]);
}

export function conflictMap(warnings: readonly Warning[]): Map<string, Map<string, ZoneConflict>> {
  const m = new Map<string, Map<string, ZoneConflict>>();
  for (const w of warnings) {
    if (w.analyzerId !== 'clearance' || w.acknowledged === 'ignored') continue;
    const zoneId = w.data?.zoneId as string | undefined;
    const objectId = w.involved[0]?.id;
    if (!zoneId || !objectId) continue;
    const depth = w.quantities.find((q) => q.name === 'depth')?.value ?? 0;
    let per = m.get(objectId);
    if (!per) m.set(objectId, (per = new Map()));
    const cur = per.get(zoneId);
    if (!cur) per.set(zoneId, { depth, regions: [...(w.highlight.regions ?? [])], message: w.message });
    else {
      cur.depth = Math.max(cur.depth, depth);
      cur.regions.push(...(w.highlight.regions ?? []));
      cur.message += ` ${w.message}`;
    }
  }
  return m;
}

const flat = (pts: ReadonlyArray<{ x: number; y: number }>) => pts.flatMap((p) => [p.x, p.y]);

function useLiveResolved(id: string) {
  const base = useProjectStore((s) => (s.project ? findObject(getScenario(s.project), id) : undefined));
  const patch = usePreview<PlacedObject>('object', id);
  const defs = useProjectStore((s) => s.project?.definitions);
  return useMemo(() => {
    const project = useProjectStore.getState().project;
    if (!base || !project || !defs) return null;
    return resolveObject(project, withPreview(base, patch));
  }, [base, patch, defs]);
}

const ObjectZones = memo(function ObjectZones({ id, operational, maintenance, faint, conflicts }: { id: string; operational: boolean; maintenance: boolean; faint: boolean; conflicts?: Map<string, ZoneConflict> }) {
  const r = useLiveResolved(id);
  const layerOn = useProjectStore((s) => s.project?.layers.clearances?.visible ?? true);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (!r || r.object.hidden || !layerOn || r.clearances.length === 0) return null;
  const pose: Pose = r.workingPose ?? r.pose;
  const font = 10 / scale;
  return (
    <Group listening={false} opacity={faint ? 0.55 : 1}>
      {r.clearances.map((z: ClearanceZone) => {
        const group = zoneGroup(z);
        if ((group === 'operational' && !operational) || (group === 'maintenance' && !maintenance)) return null;
        const st = STYLE[group];
        const poly = zoneWorldPolygon(z.shape, r.footprint, pose);
        const conflict = conflicts?.get(z.id);
        const c = centroid(poly);
        const b = bbox(poly);
        const bigEnough = Math.min(b.maxX - b.minX, b.maxY - b.minY) * scale > 26;
        // Push the zone's label away from the object, towards the zone's outer end: the object's own
        // label sits at its center, and two texts on the same spot are unreadable.
        const away = { x: c.x - pose.x, y: c.y - pose.y };
        const len = Math.hypot(away.x, away.y) || 1;
        const reach = (Math.abs(away.x / len) * (b.maxX - b.minX) + Math.abs(away.y / len) * (b.maxY - b.minY)) / 2;
        const label = { x: c.x + (away.x / len) * reach * 0.45, y: c.y + (away.y / len) * reach * 0.45 };
        const pattern = hatch(st.color, st.hatch);
        return (
          <Group key={z.id}>
            <Line
              points={flat(poly)}
              closed
              fillPatternImage={pattern as unknown as HTMLImageElement}
              fillPatternScale={{ x: 1 / scale, y: 1 / scale }}
              fillPatternRepeat="repeat"
              fill={pattern ? undefined : st.color}
              opacity={0.9}
              stroke={conflict ? STYLE.conflict : st.color}
              strokeWidth={conflict ? 2 : 1.25}
              dash={st.dash}
              strokeScaleEnabled={false}
              perfectDrawEnabled={false}
            />
            {conflict?.regions.map((reg, k) => (
              <Line key={k} points={flat(reg.outer)} closed fill={canvasColors.dangerFill} stroke={STYLE.conflict} strokeWidth={1} strokeScaleEnabled={false} perfectDrawEnabled={false} />
            ))}
            {(bigEnough || conflict) && (
              <Text
                x={label.x}
                y={label.y}
                rotation={-viewRot}
                text={conflict ? `${zoneTitle(z)} ⚠ ${fmt.length(conflict.depth)} blocked` : zoneTitle(z)}
                fontSize={font}
                fontStyle={conflict ? '600' : 'normal'}
                width={220 / scale}
                offsetX={110 / scale}
                offsetY={font / 2}
                align="center"
                fill={conflict ? STYLE.conflict : st.color}
              />
            )}
          </Group>
        );
      })}
    </Group>
  );
});

function ClearancesLayer() {
  const ids = useObjectIds();
  const operational = useUiStore((s) => isOverlayOn(s, OVERLAY_OPERATIONAL));
  const maintenance = useUiStore((s) => isOverlayOn(s, OVERLAY_MAINTENANCE));
  const selected = useUiStore((s) => s.selection);
  const conflicts = useZoneConflicts();
  const selIds = new Set(selected.filter((r) => r.kind === 'object').map((r) => r.id));
  return (
    <Group listening={false}>
      {ids.map((id) => {
        const sel = selIds.has(id);
        const op = operational || sel;
        const mt = maintenance || sel;
        if (!op && !mt) return null;
        return <ObjectZones key={id} id={id} operational={op} maintenance={mt} faint={sel && !operational && !maintenance} conflicts={conflicts.get(id)} />;
      })}
    </Group>
  );
}

const PhysicalFootprint = memo(function PhysicalFootprint({ id }: { id: string }) {
  const r = useLiveResolved(id);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (!r || r.object.hidden) return null;
  const { width: w, depth: d, offsetX = 0, offsetY = 0 } = r.footprint;
  const pattern = hatch(STYLE.physical.color, STYLE.physical.hatch, 7, 0.6);
  const font = 9 / scale;
  const pts = [
    { x: offsetX - w / 2, y: offsetY - d / 2 },
    { x: offsetX + w / 2, y: offsetY - d / 2 },
    { x: offsetX + w / 2, y: offsetY + d / 2 },
    { x: offsetX - w / 2, y: offsetY + d / 2 },
  ];
  const tag = `${fmt.length(r.height)} h${r.elevation > 0 ? ` @ ${fmt.length(r.elevation)}` : ''}`;
  return (
    <Group x={r.pose.x} y={r.pose.y} rotation={r.pose.rotation} listening={false}>
      <Line points={flat(pts)} closed fillPatternImage={pattern as unknown as HTMLImageElement} fillPatternScale={{ x: 1 / scale, y: 1 / scale }} stroke={STYLE.physical.color} strokeWidth={1.5} strokeScaleEnabled={false} perfectDrawEnabled={false} />
      {Math.min(w, d) * scale > 30 && (
        <Group x={offsetX} y={offsetY + d / 2} rotation={-r.pose.rotation - viewRot}>
          <Text text={tag} fontSize={font} y={-font * 1.4} width={160 / scale} offsetX={80 / scale} align="center" fill={STYLE.physical.color} fontStyle="600" />
        </Group>
      )}
    </Group>
  );
});

function PhysicalLayer() {
  const ids = useObjectIds();
  return (
    <Group listening={false}>
      {ids.map((id) => (
        <PhysicalFootprint key={id} id={id} />
      ))}
    </Group>
  );
}

canvasLayers.register({ id: 'clearances-physical', slot: 'content', order: 34, component: PhysicalLayer, overlay: { key: OVERLAY_PHYSICAL, label: 'Physical footprint', defaultOn: false, group: 'Clearances' } });
canvasLayers.register({ id: 'clearances', slot: 'content', order: 35, component: ClearancesLayer });
// Menu entries for the two zone groups (the drawing itself is the single layer above, which also
// shows the selected object's zones when both are off).
function Nothing() {
  return null;
}
canvasLayers.register({ id: 'clearances-operational-toggle', slot: 'content', order: 36, component: Nothing, overlay: { key: OVERLAY_OPERATIONAL, label: 'Operational clearance', defaultOn: false, group: 'Clearances' } });
canvasLayers.register({ id: 'clearances-maintenance-toggle', slot: 'content', order: 37, component: Nothing, overlay: { key: OVERLAY_MAINTENANCE, label: 'Maintenance clearance', defaultOn: false, group: 'Clearances' } });

// ───────────── legend ─────────────

function Legend() {
  const overlays = useUiStore((s) => s.overlays);
  const view = useUiStore((s) => s.view);
  const on = (k: string) => overlays[k] ?? false;
  if (view !== '2d' || (!on(OVERLAY_OPERATIONAL) && !on(OVERLAY_MAINTENANCE) && !on(OVERLAY_PHYSICAL))) return null;
  const rows: Array<{ key: string; label: string; swatch: string; border: string; dash: string }> = [
    { key: OVERLAY_PHYSICAL, label: 'Physical footprint', swatch: cssHatch(STYLE.physical.color, 'back-diag'), border: STYLE.physical.color, dash: 'solid' },
    { key: OVERLAY_OPERATIONAL, label: 'Operational clearance', swatch: cssHatch(STYLE.operational.color, 'diag'), border: STYLE.operational.color, dash: 'dashed' },
    { key: OVERLAY_MAINTENANCE, label: 'Maintenance clearance', swatch: cssHatch(STYLE.maintenance.color, 'cross'), border: STYLE.maintenance.color, dash: 'dotted' },
  ];
  return (
    <div className="pointer-events-auto absolute bottom-3 left-8 z-10 rounded-md border border-line bg-panel/95 px-2 py-1.5 text-2xs text-ink-muted shadow-lg" data-testid="clearance-legend">
      <div className="mb-1 font-semibold uppercase tracking-wide text-ink-faint">Clearances</div>
      {rows.map((r) => (
        <button key={r.key} type="button" className="flex w-full items-center gap-1.5 py-0.5 text-left hover:text-ink" onClick={() => uiActions.setOverlay(r.key, !on(r.key))} aria-pressed={on(r.key)}>
          <span className="size-3 rounded-sm" style={{ background: r.swatch, border: `1.5px ${r.dash} ${r.border}` }} />
          <span className={on(r.key) ? 'text-ink' : 'line-through opacity-70'}>{r.label}</span>
          {on(r.key) ? <Eye className="ml-auto size-3" /> : <EyeOff className="ml-auto size-3" />}
        </button>
      ))}
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="size-3 rounded-sm" style={{ background: canvasColors.dangerFill, border: `2px solid ${STYLE.conflict}` }} />
        <span>Blocked (⚠ with amount)</span>
      </div>
    </div>
  );
}
canvasOverlays.register({ id: 'clearances.legend', order: 60, component: Legend });

// ───────────── inspector ─────────────

const singleObject = (c: SelectionContext) => (c.single?.kind === 'object' ? c.scenario.objects.find((o) => o.id === c.single!.id) : undefined);

function ClearancesSection({ ctx }: { ctx: SelectionContext }) {
  const o = singleObject(ctx)!;
  const r = resolveObject(ctx.project, o);
  const warnings = useWarnings();
  const operational = useUiStore((s) => isOverlayOn(s, OVERLAY_OPERATIONAL));
  const statuses = useMemo(() => {
    const m = new Map<string, ZoneStatus>();
    for (const z of r.clearances) m.set(z.id, { blocked: false, text: '' });
    for (const w of warnings) {
      if (w.analyzerId !== 'clearance' || w.involved[0]?.id !== o.id || w.acknowledged === 'ignored') continue;
      const zid = w.data?.zoneId as string | undefined;
      if (!zid) continue;
      const cur = m.get(zid);
      m.set(zid, { blocked: true, text: cur?.blocked ? `${cur.text} ${w.message}` : w.message });
    }
    return m;
  }, [warnings, r.clearances, o.id]);
  const commit = (zones: ClearanceZone[]) => {
    const res = dispatch({ type: 'object.update', payload: { id: o.id, patch: { clearances: zones } } });
    if (!res.ok) uiActions.flash(res.error, 'error');
  };
  const custom = o.clearances !== undefined;
  return (
    <div className="space-y-2">
      {r.mobile && r.workingPose && <p className="text-2xs text-info">Checked at the working position, where the tool is used.</p>}
      {r.state?.clearances && !custom && <p className="text-2xs text-ink-faint">Zones for the “{r.state.name}” state.</p>}
      <ZoneListEditor zones={r.clearances} onChange={commit} statuses={statuses} testId="clearance-zones" />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => uiActions.setOverlay(OVERLAY_OPERATIONAL, !operational)} aria-pressed={operational}>
          <Scan /> {operational ? 'Hide' : 'Show'} clearances on plan
        </Button>
        {custom && (
          <Tip content="Use the zones of this object type again">
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'object.update', payload: { id: o.id, unset: ['clearances'] } })}>
              <RotateCcw /> Reset to type defaults
            </Button>
          </Tip>
        )}
      </div>
      <p className="text-2xs text-ink-faint">Zones are in the object's frame and turn with it. Physical fit and usable space are separate: the item may fit and still be unusable here.</p>
    </div>
  );
}
inspectorSections.register({ id: 'object.clearances', title: 'Clearances', order: 40, appliesTo: (c) => !!singleObject(c), component: ClearancesSection });

// ───────────── palette ─────────────

for (const [key, title] of [
  [OVERLAY_OPERATIONAL, 'Show operational clearances'],
  [OVERLAY_MAINTENANCE, 'Show maintenance clearances'],
  [OVERLAY_PHYSICAL, 'Show physical footprints'],
] as const) {
  paletteCommands.register({ id: `clearances.toggle.${key}`, title: `Toggle: ${title}`, section: 'View', keywords: ['clearance', 'overlay', 'zones'], icon: Scan, when: (c) => !!c.project, run: () => uiActions.toggleOverlay(key) });
}
