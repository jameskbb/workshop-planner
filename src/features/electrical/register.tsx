/**
 * Electrical points: inspector (kind, label, circuit, voltage, amperage, GFCI, dedicated, mounting
 * height, placement). Placement lives in the Fixed features panel. Planning aid only.
 */
import { Plug } from 'lucide-react';
import { useMemo } from 'react';
import { Group, Line, Text } from 'react-konva';
import { buildAnalysisContext } from '@/analysis';
import { canvasLayers, inspectorSections, paletteCommands, type SelectionContext } from '@/app/registry';
import { resolveObject } from '@/domain/resolve';
import type { ElectricalRequirement } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { canvasColors } from '@/styles/tokens';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { electricalPrefs, hasOutlets, NOT_CODE_NOTE, outletReach, requirementLabel } from './reach';
import { PropRow } from '@/components/shell';
import { LengthInput } from '@/components/LengthInput';
import { Input, Select } from '@/components/ui';
import { ELECTRICAL_KINDS, type ElectricalPoint } from '@/domain/schema';
import { dispatch } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { ELECTRICAL_TEMPLATES } from '@/features/objects/library';
import { NameField, NotesField, PlacementFields, SwitchRow } from '@/features/editor/inspectorParts';

const single = (c: SelectionContext): ElectricalPoint | undefined => (c.single?.kind === 'electrical' ? c.project.electrical.find((e) => e.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<ElectricalPoint>, unset: string[] = []) {
  const r = dispatch({ type: 'electrical.update', payload: { id, patch, unset } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

function ElectricalMain({ ctx }: { ctx: SelectionContext }) {
  const e = single(ctx)!;
  return (
    <div className="space-y-1">
      <PropRow label="Type">
        <Select
          className="h-7"
          ariaLabel="Electrical point type"
          value={e.kind}
          onValueChange={(v) => update(e.id, { kind: v as ElectricalPoint['kind'] })}
          options={ELECTRICAL_KINDS.map((k) => ({ value: k, label: ELECTRICAL_TEMPLATES.find((t) => t.kind === k)?.name ?? k }))}
        />
      </PropRow>
      <NameField label="Label" value={e.label} placeholder="e.g. Bench outlet" onCommit={(label) => update(e.id, { label })} testId="electrical-label" />
      <PlacementFields room={ctx.project.room} placement={e.placement} width={e.width} depth={20} freeRotation={false} onChange={(placement) => update(e.id, { placement })} />
      <PropRow label="Height">
        <LengthInput aria-label="Mounting height above the floor" value={e.elevation} onCommit={(elevation) => update(e.id, { elevation })} />
      </PropRow>
    </div>
  );
}

function ElectricalCircuit({ ctx }: { ctx: SelectionContext }) {
  const e = single(ctx)!;
  return (
    <div className="space-y-1">
      <PropRow label="Circuit" htmlFor="el-circuit">
        <Input
          id="el-circuit"
          key={`c-${e.id}-${e.circuit ?? ''}`}
          defaultValue={e.circuit ?? ''}
          placeholder="e.g. 12"
          onBlur={(ev) => (ev.target.value.trim() ? ev.target.value.trim() !== e.circuit && update(e.id, { circuit: ev.target.value.trim() }) : e.circuit && update(e.id, {}, ['circuit']))}
        />
      </PropRow>
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Voltage">
          <Select className="h-7" ariaLabel="Voltage" value={String(e.voltage)} onValueChange={(v) => update(e.id, { voltage: Number(v) as 120 | 240 })} options={[{ value: '120', label: '120 V' }, { value: '240', label: '240 V' }]} />
        </PropRow>
        <PropRow label="Amps">
          <Select className="h-7" ariaLabel="Amperage" value={String(e.amperage)} onValueChange={(v) => update(e.id, { amperage: Number(v) })} options={[15, 20, 30, 40, 50, 60, 100, 125, 150, 200].map((a) => ({ value: String(a), label: `${a} A` }))} />
        </PropRow>
      </div>
      <SwitchRow label="GFCI protected" checked={e.gfci} onChange={(gfci) => update(e.id, { gfci })} />
      <SwitchRow label="Dedicated circuit" checked={e.dedicated} onChange={(dedicated) => update(e.id, { dedicated })} />
      <SwitchRow label="Locked" checked={e.locked} onChange={(locked) => update(e.id, { locked })} />
      <SwitchRow label="Hidden" checked={e.hidden} onChange={(hidden) => update(e.id, { hidden })} />
      <NotesField value={e.notes} onCommit={(notes) => update(e.id, { notes })} />
      <p className="text-2xs text-ink-faint">Planning aid only; this is not an electrical code check. Have an electrician verify circuits.</p>
    </div>
  );
}

const is = (c: SelectionContext) => !!single(c);
inspectorSections.register({ id: 'electrical.main', title: 'Electrical point', order: 10, appliesTo: is, component: ElectricalMain });
inspectorSections.register({ id: 'electrical.circuit', title: 'Circuit & options', order: 40, appliesTo: is, component: ElectricalCircuit });

// ───────────── tool electrical requirements (object inspector) ─────────────

function ObjectElectrical({ ctx }: { ctx: SelectionContext }) {
  const fmt = useFormatters();
  const o = ctx.scenario.objects.find((x) => x.id === ctx.single!.id)!;
  const r = resolveObject(ctx.project, o);
  const req: ElectricalRequirement | undefined = o.electrical ?? r.definition?.electrical;
  const reach = useMemo(() => outletReach(buildAnalysisContext(ctx.project)).find((x) => x.objectId === o.id), [ctx.project, o.id]);
  const max = electricalPrefs.read(ctx.project).maxDistance;
  const setReq = (next: ElectricalRequirement | null) => {
    const res = next ? dispatch({ type: 'object.update', payload: { id: o.id, patch: { electrical: next } } }) : dispatch({ type: 'object.update', payload: { id: o.id, patch: {}, unset: ['electrical'] } });
    if (!res.ok) uiActions.flash(res.error, 'error');
  };
  const cur = req ?? { voltage: 120 as const, amperage: 15, dedicated: false };
  return (
    <div className="space-y-1" data-testid="object-electrical">
      <div className="grid grid-cols-2 gap-x-2">
        <PropRow label="Needs">
          <Select
            className="h-7"
            ariaLabel="Voltage needed"
            value={req ? String(req.voltage) : 'none'}
            onValueChange={(v) => (v === 'none' ? setReq(null) : setReq({ ...cur, voltage: Number(v) as 120 | 240 }))}
            options={[...(r.definition?.electrical ? [] : [{ value: 'none', label: 'No power' }]), { value: '120', label: '120 V' }, { value: '240', label: '240 V' }]}
          />
        </PropRow>
        {req && (
          <PropRow label="Amps">
            <Select className="h-7" ariaLabel="Amperage needed" value={String(req.amperage)} onValueChange={(v) => setReq({ ...req, amperage: Number(v) })} options={[...new Set([5, 10, 12, 15, 20, 30, 40, 50, req.amperage])].sort((a, b) => a - b).map((a) => ({ value: String(a), label: `${a} A` }))} />
          </PropRow>
        )}
      </div>
      {req && <SwitchRow label="Needs a dedicated circuit" checked={req.dedicated} onChange={(dedicated) => setReq({ ...req, dedicated })} />}
      {req && reach && hasOutlets(buildAnalysisContext(ctx.project)) && (
        <p className="text-2xs leading-snug text-ink-muted">
          {reach.best ? (
            <>
              Nearest {req.voltage} V outlet: <b className={reach.best.distance > max ? 'text-danger' : 'text-ink'}>{reach.best.point.label || 'outlet'}</b>, {fmt.length(reach.best.distance)} away
              {reach.best.distance > max ? ` (more than ${fmt.length(max)})` : ''}.{req.dedicated && !reach.best.point.dedicated ? ' That outlet is not marked as a dedicated circuit.' : ''}
            </>
          ) : reach.anyVoltage ? (
            `No ${req.voltage} V outlet is rated for ${req.amperage} A.`
          ) : (
            `No ${req.voltage} V outlet in the garage yet.`
          )}
        </p>
      )}
      {req && !o.electrical && <p className="text-2xs text-ink-faint">From the {r.definition?.name ?? 'object'} type ({requirementLabel(req)}). Changing it sets it for this item only.</p>}
      <p className="text-2xs text-ink-faint">{NOT_CODE_NOTE}</p>
    </div>
  );
}
inspectorSections.register({ id: 'object.electrical', title: 'Electrical', order: 50, appliesTo: (c) => c.single?.kind === 'object', component: ObjectElectrical, collapsed: true });

// ───────────── outlet reach overlay ─────────────

function OutletReachLayer() {
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  const data = useMemo(() => {
    if (!project) return null;
    const ctx = buildAnalysisContext(project);
    return hasOutlets(ctx) ? { reach: outletReach(ctx), max: electricalPrefs.read(project).maxDistance } : null;
  }, [project]);
  if (!data) return null;
  const font = 10 / scale;
  return (
    <Group listening={false}>
      {data.reach.map((r) => {
        const b = r.best ?? r.underRated;
        if (!b) return null;
        const bad = !r.best || b.distance > data.max;
        const color = bad ? canvasColors.danger : canvasColors.electrical;
        const mid = { x: (b.from.x + b.position.x) / 2, y: (b.from.y + b.position.y) / 2 };
        return (
          <Group key={r.objectId}>
            <Line points={[b.from.x, b.from.y, b.position.x, b.position.y]} stroke={color} strokeWidth={bad ? 2 : 1.25} dash={[6, 4]} strokeScaleEnabled={false} />
            <Text x={mid.x} y={mid.y} rotation={-viewRot} text={`${fmt.length(b.distance)}${bad ? ' ⚠' : ''}`} fontSize={font} fontStyle={bad ? '600' : 'normal'} width={120 / scale} offsetX={60 / scale} offsetY={font * 1.2} align="center" fill={color} />
          </Group>
        );
      })}
    </Group>
  );
}
canvasLayers.register({ id: 'electrical-reach', slot: 'overlay', order: 40, component: OutletReachLayer, overlay: { key: 'electrical-reach', label: 'Outlet distances', defaultOn: false, group: 'Electrical' } });
paletteCommands.register({ id: 'electrical.toggle-reach', title: 'Toggle: Show outlet distances', section: 'View', icon: Plug, keywords: ['electrical', 'cord', 'outlet'], when: (c) => !!c.project, run: () => uiActions.toggleOverlay('electrical-reach') });
