/**
 * Dust collection UI: the Dust tool (ducts, flex hoses, blast gates, hose connections), the dust
 * layer (runs drawn at their real diameter, fittings, tool dust ports), selectable/draggable runs
 * and fittings (entity adapters), the "Dust routes" overlay (each tool's run to the collector with
 * its approximate length, impractical routes in red), inspectors and the Dust panel.
 * Planning estimate only, not an engineering airflow calculation.
 */
import { Fan, Trash2, Wind } from 'lucide-react';
import { memo, useMemo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import { buildAnalysisContext } from '@/analysis';
import { canvasLayers, canvasTools, entityAdapters, inspectorSections, paletteCommands, sidebarSections, type EntityAdapter, type EntityContext, type SelectionContext } from '@/app/registry';
import { entityAttrs } from '@/app/canvas/PlanCanvas';
import { LengthInput } from '@/components/LengthInput';
import { PropRow, Section } from '@/components/shell';
import { Button, EmptyState, Select } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { circlePolygon, getScenario, resolveObject } from '@/domain/resolve';
import type { DuctRun, DustFitting } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { bbox, bboxToPolygon, closestPointOnSegment, expandBBox, rotateAround, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { usePreview, withPreview } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { useLayerVisible, useScale, useViewRotation } from '@/features/plan/hooks';
import { dustEndpoints, dustPrefs, dustRoutesFor, PLANNING_NOTE } from './network';
import { DIAMETERS, dustTool } from './tool';

const DUST = '#6c5a86';
const q = quantize;
const flat = (pts: readonly Point[]) => pts.flatMap((p) => [p.x, p.y]);

// ───────────── adapters ─────────────

const runOf = (c: EntityContext, id: string) => c.scenario.dust.runs.find((r) => r.id === id);
const fitOf = (c: EntityContext, id: string) => c.scenario.dust.fittings.find((f) => f.id === id);

const ductAdapter: EntityAdapter = {
  id: 'duct',
  kind: 'duct',
  order: 60,
  ids: (c) => c.scenario.dust.runs.map((r) => r.id),
  exists: (c, id) => !!runOf(c, id),
  name: (c, id) => (runOf(c, id)?.kind === 'flex' ? 'flex hose' : 'duct run'),
  outline: (c, id) => {
    const r = runOf(c, id);
    return r ? bboxToPolygon(expandBBox(bbox(r.points), r.diameter / 2)) : undefined;
  },
  layer: () => 'dust',
  marquee: 'contain',
  translate: (c, id, d) => {
    const r = runOf(c, id);
    return r ? { points: r.points.map((p) => ({ x: p.x + d.x, y: p.y + d.y })) } : null;
  },
  rotate: (c, id, pivot, deg) => {
    const r = runOf(c, id);
    return r ? { points: r.points.map((p) => rotateAround(p, pivot, deg)) } : null;
  },
  commit: (_c, id, patch) => [{ type: 'duct.update', payload: { id, patch: { points: (patch.points as Point[]).map((p) => ({ x: q(p.x), y: q(p.y) })) } } }],
  remove: (c, ids) => {
    const cmds: AppCommand[] = [{ type: 'duct.delete', payload: { ids } }];
    const fits = c.scenario.dust.fittings.filter((f) => f.runId && ids.includes(f.runId)).map((f) => f.id);
    if (fits.length) cmds.push({ type: 'fitting.delete', payload: { ids: fits } });
    return cmds;
  },
  copy: (c, id) => JSON.parse(JSON.stringify(runOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const r = data as DuctRun;
    return [{ type: 'duct.add', payload: { items: [{ ...r, id: newId, fromId: undefined, toId: undefined, points: r.points.map((p) => ({ x: q(p.x + off.x), y: q(p.y + off.y) })) }] } }];
  },
};

const fittingAdapter: EntityAdapter = {
  id: 'fitting',
  kind: 'fitting',
  order: 61,
  ids: (c) => c.scenario.dust.fittings.map((f) => f.id),
  exists: (c, id) => !!fitOf(c, id),
  name: (c, id) => (fitOf(c, id)?.kind ?? 'fitting').replace('-', ' '),
  outline: (c, id) => {
    const f = fitOf(c, id);
    return f ? circlePolygon(f, 80, 12) : undefined;
  },
  layer: () => 'dust',
  marquee: true,
  translate: (c, id, d) => {
    const f = fitOf(c, id);
    return f ? { x: f.x + d.x, y: f.y + d.y } : null;
  },
  commit: (c, id, patch) => {
    // Re-seat the fitting on the nearest run.
    const p = { x: patch.x as number, y: patch.y as number };
    let best: { run: DuctRun; p: Point; d: number } | null = null;
    for (const run of c.scenario.dust.runs) {
      for (let k = 0; k + 1 < run.points.length; k++) {
        const cp = closestPointOnSegment(p, run.points[k]!, run.points[k + 1]!);
        if (!best || cp.distance < best.d) best = { run, p: cp.point, d: cp.distance };
      }
    }
    const on = best && best.d < 300 ? best : null;
    return [{ type: 'fitting.update', payload: { id, patch: { x: q(on ? on.p.x : p.x), y: q(on ? on.p.y : p.y), ...(on ? { runId: on.run.id } : {}) }, unset: on ? [] : ['runId'] } }];
  },
  remove: (_c, ids) => [{ type: 'fitting.delete', payload: { ids } }],
  copy: (c, id) => JSON.parse(JSON.stringify(fitOf(c, id) ?? null)),
  paste: (_c, data, newId, off) => {
    const f = data as DustFitting;
    return [{ type: 'fitting.add', payload: { items: [{ ...f, id: newId, runId: undefined, x: q(f.x + off.x), y: q(f.y + off.y) }] } }];
  },
};
entityAdapters.register(ductAdapter);
entityAdapters.register(fittingAdapter);
canvasTools.register(dustTool);

// ───────────── plan layer ─────────────

const RunNode = memo(function RunNode({ run, selected }: { run: DuctRun; selected: boolean }) {
  const r = withPreview(run, usePreview<DuctRun>('duct', run.id));
  const pts = flat(r.points);
  return (
    <Group {...entityAttrs('duct', r.id)}>
      <Line points={pts} stroke={DUST} opacity={r.kind === 'flex' ? 0.35 : 0.5} strokeWidth={r.diameter} lineCap="round" lineJoin="round" hitStrokeWidth={Math.max(r.diameter, 120)} />
      <Line points={pts} stroke={selected ? canvasColors.select : DUST} strokeWidth={selected ? 2.5 : 1.25} dash={r.kind === 'flex' ? [3, 3] : undefined} strokeScaleEnabled={false} listening={false} />
    </Group>
  );
});

const FittingNode = memo(function FittingNode({ fitting, selected }: { fitting: DustFitting; selected: boolean }) {
  const f = withPreview(fitting, usePreview<DustFitting>('fitting', fitting.id));
  const scale = useScale();
  const s = 7 / scale;
  const color = selected ? canvasColors.select : DUST;
  return (
    <Group {...entityAttrs('fitting', f.id)} x={f.x} y={f.y}>
      {f.kind === 'blast-gate' ? (
        <>
          <Rect x={-s} y={-s} width={2 * s} height={2 * s} fill="#fff" stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={10} />
          <Line points={[-s, s, s, -s]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
        </>
      ) : (
        <Circle radius={s} fill="#fff" stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} hitStrokeWidth={10} />
      )}
    </Group>
  );
});

function DustLayer() {
  const visible = useLayerVisible('dust');
  const dust = useProjectStore((s) => (s.project ? getScenario(s.project).dust : undefined));
  const selection = useUiStore((s) => s.selection);
  if (!visible || !dust) return null;
  const sel = (kind: string, id: string) => selection.some((r) => r.kind === kind && r.id === id);
  return (
    <Group>
      {dust.runs.map((r) => (
        <RunNode key={r.id} run={r} selected={sel('duct', r.id)} />
      ))}
      {dust.fittings.map((f) => (
        <FittingNode key={f.id} fitting={f} selected={sel('fitting', f.id)} />
      ))}
    </Group>
  );
}
canvasLayers.register({ id: 'dust', slot: 'content', order: 45, component: DustLayer });

/** Tool dust ports and collector inlets (shown while the dust tool or the routes overlay is active). */
function PortsLayer() {
  const project = useProjectStore((s) => s.project);
  const tool = useUiStore((s) => s.tool);
  const on = useUiStore((s) => s.overlays['dust-routes'] ?? false);
  const scale = useScale();
  const ends = useMemo(() => (project ? dustEndpoints(buildAnalysisContext(project)) : []), [project]);
  if (tool !== 'dust' && !on) return null;
  return (
    <Group listening={false}>
      {ends.map((e) => (
        <Circle key={e.objectId} x={e.port.x} y={e.port.y} radius={Math.max(e.diameter / 2, 4 / scale)} fill={e.collector ? DUST : '#fff'} stroke={DUST} strokeWidth={1.5} strokeScaleEnabled={false} />
      ))}
    </Group>
  );
}
canvasLayers.register({ id: 'dust-ports', slot: 'overlay', order: 46, component: PortsLayer });

function RoutesLayer() {
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  const routes = useMemo(() => (project ? dustRoutesFor(buildAnalysisContext(project)) : []), [project]);
  const font = 10 / scale;
  return (
    <Group listening={false}>
      {routes.map((r) => {
        const bad = r.problems.length > 0;
        const color = !r.connected ? canvasColors.inkMuted : bad ? canvasColors.danger : '#3f9d6a';
        const text = r.connected ? `${fmt.length(r.rigid + r.flex)} run · eq. ${fmt.length(r.equivalent)}${bad ? ' ⚠' : ''}` : r.direct !== undefined ? `not connected (${fmt.length(r.direct)} direct)` : 'not connected';
        return (
          <Group key={r.tool.objectId}>
            {r.connected && <Line points={flat(r.path)} stroke={color} strokeWidth={3} opacity={0.8} strokeScaleEnabled={false} lineJoin="round" />}
            {!r.connected && r.collector && <Line points={flat([r.tool.port, r.collector.port])} stroke={color} strokeWidth={1} dash={[2, 5]} strokeScaleEnabled={false} />}
            <Text x={r.tool.port.x} y={r.tool.port.y} rotation={-viewRot} text={`${r.tool.name}: ${text}`} fontSize={font} fontStyle={bad ? '600' : 'normal'} width={300 / scale} offsetX={150 / scale} offsetY={-font} align="center" fill={color} />
          </Group>
        );
      })}
    </Group>
  );
}
canvasLayers.register({ id: 'dust-routes', slot: 'overlay', order: 47, component: RoutesLayer, overlay: { key: 'dust-routes', label: 'Dust routes & run lengths', defaultOn: false, group: 'Dust collection' } });

// ───────────── inspectors ─────────────

const singleRun = (c: SelectionContext) => (c.single?.kind === 'duct' ? c.scenario.dust.runs.find((r) => r.id === c.single!.id) : undefined);
const singleFitting = (c: SelectionContext) => (c.single?.kind === 'fitting' ? c.scenario.dust.fittings.find((f) => f.id === c.single!.id) : undefined);

function RunSection({ ctx }: { ctx: SelectionContext }) {
  const r = singleRun(ctx)!;
  const fmt = useFormatters();
  let len = 0;
  for (let k = 1; k < r.points.length; k++) len += Math.hypot(r.points[k]!.x - r.points[k - 1]!.x, r.points[k]!.y - r.points[k - 1]!.y);
  const upd = (patch: Partial<DuctRun>) => {
    const res = dispatch({ type: 'duct.update', payload: { id: r.id, patch } });
    if (!res.ok) uiActions.flash(res.error, 'error');
  };
  const gates = ctx.scenario.dust.fittings.filter((f) => f.runId === r.id);
  return (
    <div className="space-y-1">
      <PropRow label="Type">
        <Select className="h-7" ariaLabel="Run type" value={r.kind} onValueChange={(v) => upd({ kind: v as DuctRun['kind'] })} options={[{ value: 'rigid', label: 'Fixed duct' }, { value: 'flex', label: 'Flexible hose' }]} />
      </PropRow>
      <PropRow label="Diameter">
        <Select className="h-7" ariaLabel="Diameter" value={String(DIAMETERS.find((d) => Math.abs(Number(d.value) - r.diameter) < 1)?.value ?? r.diameter)} onValueChange={(v) => upd({ diameter: Number(v) })} options={DIAMETERS.some((d) => Math.abs(Number(d.value) - r.diameter) < 1) ? DIAMETERS : [...DIAMETERS, { value: String(r.diameter), label: fmt.length(r.diameter) }]} />
      </PropRow>
      <PropRow label="Height">
        <LengthInput aria-label="Height above the floor" value={r.elevation ?? 0} onCommit={(elevation) => upd({ elevation })} />
      </PropRow>
      <p className="num text-2xs text-ink-muted">
        {fmt.length(len)} long · {r.points.length - 2} bend{r.points.length === 3 ? '' : 's'} · {gates.length} fitting{gates.length === 1 ? '' : 's'}
      </p>
      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'duct.delete', payload: { ids: [r.id] } })}>
        <Trash2 /> Delete run
      </Button>
    </div>
  );
}
inspectorSections.register({ id: 'dust.run', title: 'Dust run', order: 10, appliesTo: (c) => !!singleRun(c), component: RunSection });

function FittingSection({ ctx }: { ctx: SelectionContext }) {
  const f = singleFitting(ctx)!;
  return (
    <div className="space-y-1">
      <PropRow label="Type">
        <Select
          className="h-7"
          ariaLabel="Fitting type"
          value={f.kind}
          onValueChange={(v) => dispatch({ type: 'fitting.update', payload: { id: f.id, patch: { kind: v as DustFitting['kind'] } } })}
          options={[
            { value: 'blast-gate', label: 'Blast gate' },
            { value: 'hose-connection', label: 'Hose connection' },
            { value: 'wye', label: 'Wye' },
            { value: 'reducer', label: 'Reducer' },
          ]}
        />
      </PropRow>
      <p className="text-2xs text-ink-faint">{f.runId ? 'On a run. Drag it along the run.' : 'Not on a run. Drag it onto a duct or hose.'}</p>
    </div>
  );
}
inspectorSections.register({ id: 'dust.fitting', title: 'Dust fitting', order: 10, appliesTo: (c) => !!singleFitting(c), component: FittingSection });

function ObjectDust({ ctx }: { ctx: SelectionContext }) {
  const fmt = useFormatters();
  const id = ctx.single!.id;
  const o = ctx.scenario.objects.find((x) => x.id === id)!;
  const r = resolveObject(ctx.project, o);
  const route = useMemo(() => dustRoutesFor(buildAnalysisContext(ctx.project)).find((x) => x.tool.objectId === id), [ctx.project, id]);
  if (r.category === 'dust-collection') return <p className="text-2xs text-ink-muted">This is a collector. Draw runs from its inlet with the Dust tool.</p>;
  const port = r.definition?.dustPort;
  if (!port) return <p className="text-2xs text-ink-faint">No dust port on this item. Custom objects can have one (My objects → edit).</p>;
  return (
    <div className="space-y-1 text-2xs text-ink-muted" data-testid="object-dust">
      <p>
        {fmt.length(port.diameter)} dust port. {route?.connected ? (
          <>
            Run to the {route.collector?.name ?? 'collector'}: <b className="text-ink">{fmt.length(route.rigid)}</b> duct + <b className="text-ink">{fmt.length(route.flex)}</b> flex, {route.bends} bend{route.bends === 1 ? '' : 's'}, {route.gates} blast gate{route.gates === 1 ? '' : 's'} ≈ <b className={route.problems.length ? 'text-danger' : 'text-ink'}>{fmt.length(route.equivalent)}</b> equivalent.
          </>
        ) : route?.direct !== undefined ? (
          `Not connected; a direct hose to the collector would be about ${fmt.length(route.direct)}.`
        ) : (
          'No collector in this layout yet.'
        )}
      </p>
      <p className="text-ink-faint">{PLANNING_NOTE}</p>
    </div>
  );
}
inspectorSections.register({ id: 'object.dust', title: 'Dust collection', order: 52, appliesTo: (c) => c.single?.kind === 'object', component: ObjectDust, collapsed: true });

// ───────────── panel ─────────────

function DustPanel() {
  const project = useProjectStore((s) => s.project);
  const fmt = useFormatters();
  const routes = useMemo(() => (project ? dustRoutesFor(buildAnalysisContext(project)) : []), [project]);
  const on = useUiStore((s) => s.overlays['dust-routes'] ?? false);
  if (!project) return null;
  const s = getScenario(project);
  const collectors = s.objects.filter((o) => resolveObject(project, o).category === 'dust-collection');
  const prefs = dustPrefs.read(project);
  return (
    <div data-testid="dust-panel">
      <div className="flex flex-wrap gap-1 border-b border-line p-2">
        <Button size="sm" variant="primary" onClick={() => uiActions.setTool('dust')} data-testid="dust-draw">
          <Wind /> Draw ducts & hoses
        </Button>
        <Button size="sm" variant="outline" onClick={() => uiActions.setOverlay('dust-routes', !on)} aria-pressed={on}>
          {on ? 'Hide' : 'Show'} routes
        </Button>
      </div>
      {collectors.length === 0 && (
        <EmptyState icon={<Fan />} title="No dust collector yet" action={<Button onClick={() => uiActions.setLeftSection('library')}>Add one from the library</Button>}>
          Add a dust collector (or shop vacuum), then draw duct runs from its inlet to your tools.
        </EmptyState>
      )}
      <Section title="Tools with dust ports">
        {routes.length === 0 ? (
          <p className="text-2xs text-ink-faint">No tools with dust ports in this layout.</p>
        ) : (
          <ul className="space-y-1">
            {routes.map((r) => (
              <li key={r.tool.objectId}>
                <button type="button" className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-panel-2" onClick={() => uiActions.select([{ kind: 'object', id: r.tool.objectId }])}>
                  <span className="text-ink">{r.tool.name}</span>{' '}
                  <span className={r.problems.length ? 'text-danger' : r.connected ? 'text-ok' : 'text-ink-faint'}>
                    {r.connected ? `≈ ${fmt.length(r.equivalent)} equivalent${r.problems.length ? ' ⚠' : ''}` : 'not connected'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Runs">
        <p className="text-2xs text-ink-muted">
          {s.dust.runs.length} run{s.dust.runs.length === 1 ? '' : 's'}, {s.dust.fittings.filter((f) => f.kind === 'blast-gate').length} blast gate(s). Routes longer than {fmt.length(prefs.maxEquivalent)} equivalent or with more than {fmt.length(prefs.maxFlex)} of flex are flagged (change in Safety & warnings → Thresholds).
        </p>
      </Section>
      <p className="px-3 py-2 text-2xs text-ink-faint">{PLANNING_NOTE} Equivalent length counts flex hose ×2.5 and each 90° bend as 6′ of duct.</p>
    </div>
  );
}
sidebarSections.register({ id: 'dust', title: 'Dust collection', icon: Wind, order: 75, component: DustPanel });

paletteCommands.register({ id: 'dust.tool', title: 'Draw dust ducts & hoses', section: 'Tools', icon: Wind, keywords: ['dust', 'duct', 'hose', 'blast gate'], when: (c) => !!c.project, run: () => uiActions.setTool('dust') });
paletteCommands.register({ id: 'dust.toggle-routes', title: 'Toggle: Dust routes & run lengths', section: 'View', icon: Wind, when: (c) => !!c.project, run: () => uiActions.toggleOverlay('dust-routes') });
