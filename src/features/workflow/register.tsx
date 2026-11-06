/**
 * Workflow relationships: ordered chains of stations (Lumber rack → Miter saw → Table saw →
 * Assembly table) or simple pairs (Car → Tool cabinet), defined in the Workflow panel or the object
 * inspector's Relationships section. Optional connection lines on the plan with the approximate
 * walking distance of each step (routed around obstacles; straight line when no route exists).
 */
import { ArrowRight, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Arrow, Group, Text } from 'react-konva';
import { buildAnalysisContext } from '@/analysis';
import { canvasLayers, inspectorSections, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { Section } from '@/components/shell';
import { Button, Input, Select, Switch } from '@/components/ui';
import type { AppCommand } from '@/domain/commands';
import { getScenario } from '@/domain/resolve';
import type { Project, Relationship } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { isOverlayOn, uiActions, useUiStore } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { UNNAMED_CHAIN, workflowChains, workflowTotal, type WorkflowChain } from './model';

const OVERLAY = 'workflow';
const FREQ = [
  { value: '1', label: 'Rarely' },
  { value: '2', label: 'Sometimes' },
  { value: '3', label: 'Often' },
  { value: '4', label: 'Very often' },
  { value: '5', label: 'Constantly' },
];

function useChains(): WorkflowChain[] {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => (project ? workflowChains(buildAnalysisContext(project)) : []), [project]);
}

function stationOptions(project: Project) {
  const s = getScenario(project);
  return [
    ...s.objects.filter((o) => !o.hidden && o.mount === 'floor').map((o) => ({ value: o.id, label: o.label ?? o.name })),
    ...s.vehicles.filter((v) => !v.hidden).map((v) => ({ value: v.id, label: v.name })),
  ];
}

// ───────────── canvas ─────────────

function WorkflowLayer() {
  const chains = useChains();
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY));
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (!on) return null;
  const font = 11 / scale;
  return (
    <Group listening={false}>
      {chains.flatMap((c) =>
        c.steps.map((s) => {
          const a = s.from.center;
          const b = s.to.center;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const color = s.blocked ? '#c2410c' : '#6d4fc4';
          return (
            <Group key={s.relationship.id}>
              <Arrow points={[a.x, a.y, b.x, b.y]} stroke={color} fill={color} strokeWidth={1 + s.relationship.frequency * 0.5} pointerLength={10 / scale} pointerWidth={8 / scale} strokeScaleEnabled={false} dash={s.blocked ? [6, 4] : undefined} opacity={0.85} />
              <Group x={mid.x} y={mid.y} rotation={-viewRot}>
                <Text text={`${fmt.length(s.distance)}${s.blocked ? ' (no path)' : ''}`} fontSize={font} fill={color} fontStyle="bold" offsetY={font * 1.3} />
              </Group>
            </Group>
          );
        }),
      )}
    </Group>
  );
}
canvasLayers.register({ id: 'workflow', slot: 'overlay', order: 30, component: WorkflowLayer, overlay: { key: OVERLAY, label: 'Workflow connections', defaultOn: false } });

// ───────────── chain builder ─────────────

function NewChain({ project, onDone }: { project: Project; onDone(): void }) {
  const opts = stationOptions(project);
  const [name, setName] = useState('');
  const [stations, setStations] = useState<string[]>([opts[0]?.value ?? '', opts[1]?.value ?? '']);
  const valid = name.trim() && stations.length >= 2 && stations.every(Boolean) && stations.every((s, i) => i === 0 || s !== stations[i - 1]);
  const create = () => {
    const chain = name.trim();
    const items: Relationship[] = stations.slice(1).map((to, i) => ({ id: newId(), fromId: stations[i]!, toId: to, kind: 'workflow', chain, order: i, frequency: 3 }));
    const r = dispatch({ type: 'relationship.add', payload: { items } });
    if (r.ok) {
      uiActions.setOverlay(OVERLAY, true);
      onDone();
    }
  };
  return (
    <div className="rounded-md border border-line bg-panel-2 p-2" data-testid="workflow-new-chain">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chain name, e.g. Sheet goods" aria-label="Chain name" className="h-7" />
      <ol className="mt-2 space-y-1">
        {stations.map((id, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="w-4 text-right text-2xs text-ink-faint">{i + 1}</span>
            <div className="flex-1">
              <Select ariaLabel={`Step ${i + 1}`} value={id} onValueChange={(v) => setStations((s) => s.map((x, j) => (j === i ? v : x)))} options={opts} className="h-6 text-2xs" />
            </div>
            {stations.length > 2 && (
              <Button size="icon-sm" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setStations((s) => s.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-2 flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setStations((s) => [...s, opts.find((o) => o.value !== s[s.length - 1])?.value ?? ''])}>
          <Plus /> Step
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!valid} onClick={create} data-testid="workflow-create">
          Create
        </Button>
      </div>
    </div>
  );
}

function WorkflowPanel() {
  const project = useProjectStore((s) => s.project);
  const chains = useChains();
  const on = useUiStore((s) => isOverlayOn(s, OVERLAY));
  const fmt = useFormatters();
  const [adding, setAdding] = useState(false);
  const total = useMemo(() => (project ? workflowTotal(buildAnalysisContext(project)) : null), [project]);
  if (!project) return null;
  const removeChain = (c: WorkflowChain) => dispatch({ type: 'relationship.delete', payload: { ids: c.steps.map((s) => s.relationship.id) } });
  return (
    <div data-testid="workflow-panel">
      <Section title="Chains">
        <label className="mb-2 flex items-center justify-between text-xs text-ink">
          Show connection lines
          <Switch checked={on} onCheckedChange={(v) => uiActions.setOverlay(OVERLAY, v)} />
        </label>
        {chains.length === 0 && !adding && <p className="text-xs text-ink-muted">No workflow yet. Add the order you usually work in, e.g. Lumber rack → Miter saw → Table saw → Assembly table.</p>}
        <ul className="space-y-2">
          {chains.map((c) => (
            <li key={c.name || 'pairs'} className="rounded-md border border-line p-2" data-testid="workflow-chain">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">{c.name === UNNAMED_CHAIN ? 'Pairs' : c.name}</span>
                <span className="num text-xs text-ink">{fmt.length(c.total)}</span>
              </div>
              <ol className="mt-1 space-y-0.5">
                {c.steps.map((s) => (
                  <li key={s.relationship.id} className="flex items-center gap-1 text-2xs text-ink-muted">
                    <span className="truncate">{s.from.name}</span>
                    <ArrowRight className="size-3 shrink-0" />
                    <span className="truncate">{s.to.name}</span>
                    <span className="num ml-auto shrink-0 text-ink" title={s.walked ? 'Walking route around obstacles' : 'Straight line (no walkable route)'}>
                      {fmt.length(s.distance)}
                      {s.blocked ? ' ⚠ no path' : ''}
                    </span>
                  </li>
                ))}
              </ol>
              {c.missing > 0 && <p className="mt-1 text-2xs text-warn">{c.missing} step(s) refer to items not in this layout.</p>}
              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => removeChain(c)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="mt-2">
            <NewChain project={project} onDone={() => setAdding(false)} />
          </div>
        ) : (
          <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setAdding(true)} data-testid="workflow-add">
            <Plus /> New workflow chain
          </Button>
        )}
        {total && total.steps > 0 && (
          <p className="mt-2 text-2xs text-ink-faint">
            All steps: <span className="num text-ink">{fmt.length(total.total)}</span> of walking (routes keep 18" of body room around obstacles).
          </p>
        )}
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'workflow', title: 'Workflow', icon: WorkflowIcon, order: 105, component: WorkflowPanel });
paletteCommands.register({
  id: 'workflow.toggle',
  title: 'Toggle workflow connection lines',
  section: 'Analysis',
  icon: WorkflowIcon,
  keywords: ['relationship', 'workflow', 'chain', 'lines'],
  when: (c) => !!c.project,
  run: () => uiActions.toggleOverlay(OVERLAY),
});

// ───────────── inspector: Relationships ─────────────

function RelationshipsSection({ ctx }: { ctx: SelectionContext }) {
  const id = ctx.single!.id;
  const fmt = useFormatters();
  const chains = useChains();
  const rels = ctx.scenario.relationships.filter((r) => r.fromId === id || r.toId === id);
  const opts = stationOptions(ctx.project).filter((o) => o.value !== id);
  const chainNames = [...new Set(ctx.scenario.relationships.map((r) => r.chain?.trim()).filter((x): x is string => !!x))];
  const [target, setTarget] = useState(opts[0]?.value ?? '');
  const [chain, setChain] = useState(chainNames[0] ?? '');
  const nameOf = (x: string) => stationOptions(ctx.project).find((o) => o.value === x)?.label ?? 'missing item';
  const stepOf = (rid: string) => chains.flatMap((c) => c.steps).find((s) => s.relationship.id === rid);
  const add = () => {
    if (!target) return;
    const inChain = ctx.scenario.relationships.filter((r) => (r.chain?.trim() ?? '') === chain.trim());
    const order = inChain.length ? Math.max(...inChain.map((r) => r.order)) + 1 : 0;
    const cmds: AppCommand[] = [{ type: 'relationship.add', payload: { items: [{ id: newId(), fromId: id, toId: target, kind: 'workflow', chain: chain.trim() || undefined, order, frequency: 3 }] } }];
    transact('Add workflow step', cmds);
  };
  return (
    <div data-testid="relationships-section">
      {rels.length === 0 ? (
        <p className="text-xs text-ink-muted">Not part of any workflow yet.</p>
      ) : (
        <ul className="space-y-1">
          {rels.map((r) => {
            const step = stepOf(r.id);
            return (
              <li key={r.id} className="rounded border border-line p-1.5 text-2xs">
                <div className="flex items-center gap-1 text-ink">
                  <span className="truncate">{r.fromId === id ? 'This' : nameOf(r.fromId)}</span>
                  <ArrowRight className="size-3 shrink-0 text-ink-faint" />
                  <span className="truncate">{r.toId === id ? 'this' : nameOf(r.toId)}</span>
                  <span className="num ml-auto shrink-0">{step ? fmt.length(step.distance) : ''}</span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-ink-faint">{r.chain || 'Pair'}</span>
                  <div className="ml-auto w-24">
                    <Select ariaLabel="How often" value={String(r.frequency)} onValueChange={(v) => dispatch({ type: 'relationship.update', payload: { id: r.id, patch: { frequency: Number(v) } } })} options={FREQ} className="h-5 text-2xs" />
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove relationship" onClick={() => dispatch({ type: 'relationship.delete', payload: { ids: [r.id] } })}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {opts.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-2xs text-ink-faint">Next step from this item</div>
          <Select ariaLabel="Next step" value={target} onValueChange={setTarget} options={opts} className="h-6 text-2xs" />
          <Input value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Chain name (optional)" aria-label="Chain name" className="h-6 text-2xs" list="wp-chain-names" />
          <datalist id="wp-chain-names">
            {chainNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <Button size="sm" variant="outline" className="w-full" onClick={add} data-testid="relationship-add">
            <Plus /> Add step
          </Button>
        </div>
      )}
    </div>
  );
}

inspectorSections.register({
  id: 'workflow.relationships',
  title: 'Relationships',
  order: 70,
  appliesTo: (c) => c.single?.kind === 'object',
  component: RelationshipsSection,
});
