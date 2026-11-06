/**
 * Measure tool (M) and Dimension tool (D).
 *
 * Measure modes: point ↔ point, wall ↔ object, object ↔ object, clearance (clear floor in front of
 * the clicked face of an object) and angle (3 clicks: vertex, arm, arm). Results show immediately;
 * "Keep on plan" (or Enter) turns the last result into a persistent measurement. Anchored
 * measurements follow their items when they move.
 * Dimension tool: persistent point-to-point dimension lines; the third click sets the offset.
 */
import { Ruler, Spline } from 'lucide-react';
import { Circle, Group, Line } from 'react-konva';
import { create } from 'zustand';
import type { CanvasPointerEvent, CanvasTool } from '@/app/registry';
import { entityName, entityShape, localFace, resolveMeasurement, type Side } from '@/domain/measure';
import { findObject, getScenario, resolveObject } from '@/domain/resolve';
import type { EntityRef, Measurement } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { add, distance, dot, localToWorld, normalize, perp, rotate, snapPoint, sub, worldToLocal, type Point } from '@/geometry';
import { useFormatters } from '@/hooks/useFormatters';
import { Button, Switch } from '@/components/ui';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { buildSnapTargets, editorCtx, pickBlocker, snapConfig, snapThreshold } from '@/features/editor/selection';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { DimensionLine } from '@/features/plan/layers/FixturesLayers';
import { cn } from '@/utils/cn';

export type MeasureMode = 'point' | 'wall-object' | 'object-object' | 'clearance' | 'angular';

interface Pick {
  point: Point;
  ref?: EntityRef;
}

interface MeasureState {
  mode: MeasureMode;
  keep: boolean;
  picks: Pick[];
  cursor: Point | null;
  /** Last result (not yet kept, in measure mode). */
  temp: Measurement | null;
  /** Dimension tool: waiting for the offset click. */
  offsetStage: boolean;
  hint: string | null;
}

export const useMeasureStore = create<MeasureState>()(() => ({ mode: 'point', keep: false, picks: [], cursor: null, temp: null, offsetStage: false, hint: null }));
const set = (p: Partial<MeasureState>) => useMeasureStore.setState(p);

const MODE_LABEL: Record<MeasureMode, string> = {
  point: 'Point ↔ point',
  'wall-object': 'Wall ↔ object',
  'object-object': 'Object ↔ object',
  clearance: 'Clearance',
  angular: 'Angle',
};
const MODE_HINT: Record<MeasureMode, string[]> = {
  point: ['Click the first point (snaps to corners, edges, grid)', 'Click the second point'],
  'wall-object': ['Click a wall or an item', 'Click the other one (one must be a wall)'],
  'object-object': ['Click the first item', 'Click the second item'],
  clearance: ['Click the side of an object to measure the clear floor in front of it'],
  angular: ['Click the corner (vertex) of the angle', 'Click a point on the first arm', 'Click a point on the second arm'],
};

const ITEM_KINDS = new Set(['object', 'vehicle', 'feature', 'electrical', 'light']);

function snapped(e: CanvasPointerEvent): Point {
  const c = editorCtx();
  const sc = snapConfig();
  if (!c || !sc.on) return e.world;
  return snapPoint(e.world, buildSnapTargets(c, new Set()), snapThreshold(), sc.toggles).point;
}

function validTarget(e: CanvasPointerEvent): EntityRef | null {
  const c = editorCtx();
  if (!c || !e.target || pickBlocker(c, e.target)) return null;
  return e.target;
}

function finishMeasurement(m: Measurement, persistent: boolean) {
  if (persistent) {
    const r = dispatch({ type: 'measurement.add', payload: { items: [m] } });
    if (!r.ok) return uiActions.flash(r.error, 'error');
    set({ picks: [], temp: null, offsetStage: false });
    uiActions.flash('Measurement kept on the plan. Select it to edit the label or offset; Delete removes it.');
  } else set({ picks: [], temp: m, offsetStage: false });
}

export function keepTemp(): void {
  const t = useMeasureStore.getState().temp;
  if (!t) return;
  finishMeasurement({ ...t, id: newId() }, true);
}

const q = (p: Point) => ({ x: quantize(p.x), y: quantize(p.y) });

function nearestSide(objectId: string, world: Point): Side | null {
  const c = editorCtx();
  const o = c && findObject(c.scenario, objectId);
  if (!c || !o) return null;
  const r = resolveObject(c.project, o);
  const l = worldToLocal(r.pose, world);
  const x = (l.x - (r.footprint.offsetX ?? 0)) / (r.footprint.width / 2);
  const y = (l.y - (r.footprint.offsetY ?? 0)) / (r.footprint.depth / 2);
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'front' : 'back';
}

function handleClick(e: CanvasPointerEvent, persistentTool: boolean) {
  const c = editorCtx();
  if (!c) return;
  const st = useMeasureStore.getState();
  const mode: MeasureMode = persistentTool ? 'point' : st.mode;
  const persistent = persistentTool || st.keep;
  const base = { id: newId(), offset: 0, hidden: false };

  if (persistentTool && st.offsetStage && st.picks.length === 2) {
    const [a, b] = st.picks as [Pick, Pick];
    const n = perp(normalize(sub(b.point, a.point)));
    const off = dot(sub(snapped(e), a.point), n);
    finishMeasurement({ ...base, kind: 'point', a: q(a.point), b: q(b.point), offset: quantize(off), ...(a.ref ? { anchorA: a.ref } : {}), ...(b.ref ? { anchorB: b.ref } : {}) }, true);
    return;
  }

  if (mode === 'point' || mode === 'angular') {
    const t = validTarget(e);
    const pick: Pick = t?.kind === 'vertex' ? { point: entityShape(c.project, c.scenario, t)!.type === 'point' ? (entityShape(c.project, c.scenario, t) as { point: Point }).point : snapped(e), ref: t } : { point: snapped(e) };
    const picks = [...st.picks, pick];
    if (mode === 'point' && picks.length === 2) {
      if (distance(picks[0]!.point, picks[1]!.point) < 1) return set({ hint: 'Pick two different points.' });
      if (persistentTool) return set({ picks, offsetStage: true, hint: 'Move to set where the dimension line sits, then click.' });
      const [a, b] = picks as [Pick, Pick];
      return finishMeasurement({ ...base, kind: 'point', a: q(a.point), b: q(b.point), ...(a.ref ? { anchorA: a.ref } : {}), ...(b.ref ? { anchorB: b.ref } : {}) }, persistent);
    }
    if (mode === 'angular' && picks.length === 3) {
      const [a, b, cc] = picks as [Pick, Pick, Pick];
      return finishMeasurement({ ...base, kind: 'angular', a: q(a.point), b: q(b.point), c: q(cc.point), ...(a.ref ? { anchorA: a.ref } : {}) }, persistent);
    }
    return set({ picks, temp: null, hint: null });
  }

  const t = validTarget(e);
  if (mode === 'clearance') {
    if (t?.kind !== 'object') return set({ hint: 'Click on an object (a tool, cabinet, bench…).' });
    const side = nearestSide(t.id, e.world)!;
    const m: Measurement = { ...base, kind: 'clearance', a: q(e.world), b: q(e.world), anchorA: t, side };
    const r = resolveMeasurement(c.project, c.scenario, m);
    if (!r.live) return set({ hint: `Nothing in front of the ${side} of ${entityName(c.project, c.scenario, t)}.` });
    return finishMeasurement({ ...m, a: q(r.a), b: q(r.b) }, persistent);
  }
  // wall-object / object-object
  const okKind = mode === 'wall-object' ? (k: string) => k === 'wall' || ITEM_KINDS.has(k) : (k: string) => ITEM_KINDS.has(k);
  if (!t || !okKind(t.kind)) return set({ hint: mode === 'wall-object' ? 'Click a wall or an item on the plan.' : 'Click an item on the plan.' });
  const picks = [...st.picks, { point: e.world, ref: t }];
  if (picks.length < 2) return set({ picks, temp: null, hint: null });
  const [a, b] = picks as [Pick, Pick];
  if (a.ref!.id === b.ref!.id) return set({ picks: [a], hint: 'Pick a different second item.' });
  if (mode === 'wall-object' && !(a.ref!.kind === 'wall') !== (b.ref!.kind === 'wall')) {
    return set({ picks: [a], hint: 'One of the two must be a wall. Use Object ↔ object for two items.' });
  }
  const m: Measurement = { ...base, kind: mode, a: q(a.point), b: q(b.point), anchorA: a.ref, anchorB: b.ref };
  const r = resolveMeasurement(c.project, c.scenario, m);
  finishMeasurement({ ...m, a: q(r.a), b: q(r.b) }, persistent);
}

// ───────────── overlays ─────────────

function MeasureOverlay() {
  const { picks, cursor, temp, offsetStage } = useMeasureStore();
  const project = useProjectStore((s) => s.project);
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (!project) return null;
  const color = '#d9480f';
  const r = temp ? resolveMeasurement(project, getScenario(project), temp) : null;
  return (
    <Group>
      {picks.map((p, i) => (
        <Circle key={i} x={p.point.x} y={p.point.y} radius={4 / scale} fill={color} />
      ))}
      {picks.length >= 1 && cursor && !offsetStage && (picks.length === 1 || useMeasureStore.getState().mode === 'angular') && (
        <Line points={[picks[picks.length - 1]!.point.x, picks[picks.length - 1]!.point.y, cursor.x, cursor.y]} stroke={color} strokeWidth={1} dash={[5, 4]} strokeScaleEnabled={false} />
      )}
      {picks.length === 1 && cursor && distance(picks[0]!.point, cursor) > 1 && useMeasureStore.getState().mode === 'point' && (
        <DimensionLine a={picks[0]!.point} b={cursor} text={fmt.length(distance(picks[0]!.point, cursor))} color={color} scale={scale} viewRot={viewRot} />
      )}
      {offsetStage && picks.length === 2 && cursor && (
        <DimensionLine
          a={picks[0]!.point}
          b={picks[1]!.point}
          offset={dot(sub(cursor, picks[0]!.point), perp(normalize(sub(picks[1]!.point, picks[0]!.point))))}
          text={fmt.length(distance(picks[0]!.point, picks[1]!.point))}
          color={color}
          scale={scale}
          viewRot={viewRot}
        />
      )}
      {r && temp && temp.kind !== 'angular' && <DimensionLine a={r.a} b={r.b} text={`${r.title ? `${r.title} = ` : ''}${fmt.length(r.value)}`} color={color} scale={scale} viewRot={viewRot} strokeWidth={1.75} />}
      {r && temp?.kind === 'angular' && r.c && (
        <Line points={[r.b.x, r.b.y, r.a.x, r.a.y, r.c.x, r.c.y]} stroke={color} strokeWidth={1.75} strokeScaleEnabled={false} />
      )}
      {temp?.kind === 'clearance' && temp.anchorA && <FaceHighlight id={temp.anchorA.id} side={temp.side ?? 'front'} />}
    </Group>
  );
}

function FaceHighlight({ id, side }: { id: string; side: Side }) {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const o = findObject(getScenario(project), id);
  if (!o) return null;
  const r = resolveObject(project, o);
  const f = localFace(r.footprint.width, r.footprint.depth, side, r.footprint.offsetX ?? 0, r.footprint.offsetY ?? 0);
  const a = localToWorld(r.pose, f.a);
  const b = localToWorld(r.pose, f.b);
  const n = rotate(f.normal, r.pose.rotation);
  return <Line points={[a.x, a.y, b.x, b.y, add(b, n).x, add(b, n).y]} stroke="#d9480f" strokeWidth={3} strokeScaleEnabled={false} />;
}

function ResultReadout() {
  const temp = useMeasureStore((s) => s.temp);
  const project = useProjectStore((s) => s.project);
  const fmt = useFormatters();
  if (!temp || !project) return null;
  const r = resolveMeasurement(project, getScenario(project), temp);
  return (
    <div className="pointer-events-auto absolute bottom-12 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-xs shadow-lg" role="status" data-testid="measure-result">
      <span className="text-ink-muted">{r.title || MODE_LABEL[temp.kind as MeasureMode]}</span>
      <b className="num text-ink">{temp.kind === 'angular' ? fmt.angle(r.value) : fmt.length(r.value)}</b>
      <Button size="sm" variant="outline" onClick={keepTemp} data-testid="keep-measurement">
        Keep on plan <span className="text-ink-faint">⏎</span>
      </Button>
    </div>
  );
}

function Hint({ persistentTool }: { persistentTool: boolean }) {
  const { mode, picks, hint, offsetStage } = useMeasureStore();
  const m = persistentTool ? 'point' : mode;
  const text = hint ?? (offsetStage ? 'Move to set where the dimension line sits, then click.' : (MODE_HINT[m][Math.min(picks.length, MODE_HINT[m].length - 1)] ?? ''));
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-2xs text-ink-muted shadow-lg">
      {text} · Esc to {picks.length ? 'start over' : 'exit'}
    </div>
  );
}

function MeasureOptions() {
  const { mode, keep } = useMeasureStore();
  return (
    <>
      {(Object.keys(MODE_LABEL) as MeasureMode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          data-testid={`measure-mode-${m}`}
          onClick={() => set({ mode: m, picks: [], temp: null, hint: null })}
          className={cn('h-7 rounded px-2 text-xs', mode === m ? 'bg-select/25 text-ink ring-1 ring-inset ring-select/60' : 'text-ink-muted hover:bg-panel-3 hover:text-ink')}
        >
          {MODE_LABEL[m]}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <label className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
        <Switch checked={keep} onCheckedChange={(v) => set({ keep: v })} aria-label="Keep every measurement on the plan" />
        Keep on plan
      </label>
    </>
  );
}

function makeTool(persistentTool: boolean): CanvasTool {
  return {
    id: persistentTool ? 'dimension' : 'measure',
    label: persistentTool ? 'Dimension line' : 'Measure',
    icon: persistentTool ? Spline : Ruler,
    shortcut: persistentTool ? 'd' : 'm',
    cursor: 'crosshair',
    order: persistentTool ? 45 : 40,
    overlay: MeasureOverlay,
    optionsBar: persistentTool ? undefined : MeasureOptions,
    htmlOverlay: persistentTool
      ? () => <Hint persistentTool />
      : () => (
          <>
            <Hint persistentTool={false} />
            <ResultReadout />
          </>
        ),
    onActivate() {
      set({ picks: [], temp: null, offsetStage: false, hint: null, cursor: null });
    },
    onDeactivate() {
      set({ picks: [], temp: null, offsetStage: false, hint: null, cursor: null });
    },
    onPointerMove(e) {
      set({ cursor: snapped(e) });
    },
    onPointerDown(e) {
      if (e.button !== 0) return;
      handleClick(e, persistentTool);
    },
    onKeyDown(e) {
      const st = useMeasureStore.getState();
      if (e.key === 'Escape') {
        if (st.picks.length || st.temp || st.offsetStage) {
          set({ picks: [], temp: null, offsetStage: false, hint: null });
          return true;
        }
        return false;
      }
      if (e.key === 'Enter' && st.temp) {
        keepTemp();
        return true;
      }
      return false;
    },
  };
}

export const measureTool = makeTool(false);
export const dimensionTool = makeTool(true);
