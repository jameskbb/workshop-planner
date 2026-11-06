/**
 * Measurements: Measure and Dimension tools, the Measurements sidebar (list, show/hide, delete) and
 * the measurement inspector (label, offset, anchors).
 */
import { Eye, EyeOff, Ruler, Spline, Trash2, Unlink } from 'lucide-react';
import { canvasTools, inspectorSections, paletteCommands, sidebarSections, type SelectionContext } from '@/app/registry';
import { PropRow, Section } from '@/components/shell';
import { LengthInput } from '@/components/LengthInput';
import { Badge, Button, EmptyState, Tip } from '@/components/ui';
import { entityName, resolveMeasurement } from '@/domain/measure';
import { getScenario } from '@/domain/resolve';
import type { Measurement } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { NameField } from '@/features/editor/inspectorParts';
import { dimensionTool, measureTool, useMeasureStore, type MeasureMode } from './tools';

canvasTools.register(measureTool);
canvasTools.register(dimensionTool);

const KIND_LABEL: Record<Measurement['kind'], string> = {
  point: 'Point to point',
  'wall-object': 'Wall to object',
  'object-object': 'Object to object',
  clearance: 'Clearance',
  angular: 'Angle',
};

function startMeasure(mode: MeasureMode) {
  useMeasureStore.setState({ mode, picks: [], temp: null });
  uiActions.setTool('measure');
}

function MeasurementsPanel() {
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const fmt = useFormatters();
  if (!project) return null;
  const scenario = getScenario(project);
  const list = scenario.measurements;
  return (
    <div>
      <Section title="Measure">
        <div className="grid grid-cols-2 gap-1">
          {(['point', 'wall-object', 'object-object', 'clearance', 'angular'] as MeasureMode[]).map((m) => (
            <Button key={m} size="sm" variant="outline" className="justify-start text-xs" onClick={() => startMeasure(m)}>
              {KIND_LABEL[m]}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="justify-start text-xs" onClick={() => uiActions.setTool('dimension')}>
            <Spline /> Dimension line
          </Button>
        </div>
      </Section>
      <Section title={`On the plan (${list.length})`}>
        {list.length === 0 ? (
          <EmptyState icon={<Ruler />} title="No measurements yet">
            Measure with <b>M</b>; keep results on the plan to track distances like “Cabinet → car = 31″”.
          </EmptyState>
        ) : (
          <ul className="space-y-0.5" aria-label="Measurements">
            {list.map((m) => {
              const r = resolveMeasurement(project, scenario, m);
              const sel = selection.some((s) => s.kind === 'measurement' && s.id === m.id);
              return (
                <li key={m.id} className={cn('group flex items-center gap-1 rounded pr-1', sel ? 'bg-select/15' : 'hover:bg-panel-2')}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs" onClick={() => uiActions.select([{ kind: 'measurement', id: m.id }])}>
                    <span className={cn('min-w-0 flex-1 truncate', m.hidden ? 'text-ink-faint line-through' : 'text-ink')}>{r.title || KIND_LABEL[m.kind]}</span>
                    <span className="num shrink-0 text-ink-muted">{m.kind === 'angular' ? fmt.angle(r.value) : fmt.length(r.value)}</span>
                  </button>
                  <Tip content={m.hidden ? 'Show' : 'Hide'}>
                    <Button size="icon-sm" variant="ghost" aria-label={m.hidden ? 'Show measurement' : 'Hide measurement'} onClick={() => dispatch({ type: 'measurement.update', payload: { id: m.id, patch: { hidden: !m.hidden } } })}>
                      {m.hidden ? <EyeOff /> : <Eye />}
                    </Button>
                  </Tip>
                  <Tip content="Delete">
                    <Button size="icon-sm" variant="ghost" aria-label="Delete measurement" onClick={() => dispatch({ type: 'measurement.delete', payload: { ids: [m.id] } })}>
                      <Trash2 />
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
sidebarSections.register({ id: 'measurements', title: 'Measurements', icon: Ruler, order: 75, component: MeasurementsPanel });

// ───────────── inspector ─────────────

const single = (c: SelectionContext): Measurement | undefined => (c.single?.kind === 'measurement' ? c.scenario.measurements.find((m) => m.id === c.single!.id) : undefined);
function update(id: string, patch: Partial<Measurement>, unset: string[] = []) {
  const r = dispatch({ type: 'measurement.update', payload: { id, patch, unset } });
  if (!r.ok) uiActions.flash(r.error, 'error');
}

function MeasurementSection({ ctx }: { ctx: SelectionContext }) {
  const m = single(ctx)!;
  const fmt = useFormatters();
  const r = resolveMeasurement(ctx.project, ctx.scenario, m);
  const anchors = [m.anchorA, m.anchorB].filter(Boolean).map((a) => entityName(ctx.project, ctx.scenario, a!));
  return (
    <div className="space-y-1">
      <PropRow label="Type">
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          {KIND_LABEL[m.kind]}
          {m.side && <Badge>{m.side}</Badge>}
        </span>
      </PropRow>
      <PropRow label="Value">
        <b className="num text-sm text-ink" data-testid="measurement-value">
          {m.kind === 'angular' ? fmt.angle(r.value) : fmt.length(r.value)}
        </b>
      </PropRow>
      <NameField label="Label" value={m.label ?? ''} placeholder={r.title || 'e.g. Cabinet → car'} onCommit={(label) => (label ? update(m.id, { label }) : update(m.id, {}, ['label']))} />
      {m.kind !== 'angular' && (
        <PropRow label="Offset">
          <LengthInput aria-label="Dimension line offset" value={m.offset} allowNegative onCommit={(offset) => update(m.id, { offset })} />
        </PropRow>
      )}
      {anchors.length > 0 && (
        <div className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-2xs text-ink-muted">
          {r.live ? (
            <>
              Follows <span className="text-ink">{anchors.join(' and ')}</span> when {anchors.length > 1 ? 'they move' : 'it moves'}.
            </>
          ) : (
            <span className="text-warn">An item this measured was removed; showing the last known distance.</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 h-6 px-1.5"
            onClick={() =>
              update(m.id, { a: { x: quantize(r.a.x), y: quantize(r.a.y) }, b: { x: quantize(r.b.x), y: quantize(r.b.y) }, kind: m.kind === 'angular' ? 'angular' : 'point' }, ['anchorA', 'anchorB', 'side'])
            }
          >
            <Unlink /> Detach (keep as fixed points)
          </Button>
        </div>
      )}
      <div className="flex gap-1 pt-1">
        <Button size="sm" variant="outline" onClick={() => update(m.id, { hidden: !m.hidden })}>
          {m.hidden ? <Eye /> : <EyeOff />} {m.hidden ? 'Show' : 'Hide'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-danger"
          onClick={() => {
            dispatch({ type: 'measurement.delete', payload: { ids: [m.id] } });
            uiActions.clearSelection();
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>
      <p className="text-2xs text-ink-faint">Drag the end points to re-measure; drag the line to move it aside.</p>
    </div>
  );
}
inspectorSections.register({ id: 'measurement.main', title: 'Measurement', order: 10, appliesTo: (c) => !!single(c), component: MeasurementSection });

// ───────────── palette ─────────────

paletteCommands.register({ id: 'measure.tool', title: 'Measure distance', section: 'Measure', icon: Ruler, shortcut: 'm', when: (c) => !!c.project, run: () => startMeasure('point') });
paletteCommands.register({ id: 'measure.clearance', title: 'Measure clearance in front of an object', section: 'Measure', icon: Ruler, keywords: ['space', 'room', 'gap'], when: (c) => !!c.project, run: () => startMeasure('clearance') });
paletteCommands.register({ id: 'measure.object-object', title: 'Measure between two objects', section: 'Measure', icon: Ruler, when: (c) => !!c.project, run: () => startMeasure('object-object') });
paletteCommands.register({ id: 'measure.wall-object', title: 'Measure wall to object', section: 'Measure', icon: Ruler, when: (c) => !!c.project, run: () => startMeasure('wall-object') });
paletteCommands.register({ id: 'measure.angle', title: 'Measure an angle', section: 'Measure', icon: Ruler, when: (c) => !!c.project, run: () => startMeasure('angular') });
paletteCommands.register({ id: 'measure.dimension', title: 'Add dimension line', section: 'Measure', icon: Spline, shortcut: 'd', when: (c) => !!c.project, run: () => uiActions.setTool('dimension') });
