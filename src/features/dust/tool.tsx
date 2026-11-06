/**
 * Dust tool: draw fixed duct or flexible hose runs (click points; double-click / Enter to finish,
 * Backspace removes the last point, Esc cancels; Shift keeps 45° angles), or place blast gates /
 * hose connections on a run. Points snap to run ends, run corners and tool dust ports.
 */
import { Wind } from 'lucide-react';
import { Circle, Group, Line } from 'react-konva';
import { create } from 'zustand';
import { buildAnalysisContext } from '@/analysis';
import type { CanvasPointerEvent, CanvasTool } from '@/app/registry';
import { Select } from '@/components/ui';
import { getScenario } from '@/domain/resolve';
import type { DuctRun, DustFitting } from '@/domain/schema';
import { inches, quantize } from '@/domain/units';
import { closestPointOnSegment, distance, snapAngle, type Point } from '@/geometry';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { snapThreshold } from '@/features/editor/selection';
import { useScale } from '@/features/plan/hooks';
import { dustEndpoints } from './network';

export type DustMode = 'rigid' | 'flex' | 'blast-gate' | 'hose-connection';

interface DustDraw {
  mode: DustMode;
  diameter: number;
  points: Point[];
  cursor: Point | null;
}
export const useDustDraw = create<DustDraw>()(() => ({ mode: 'rigid', diameter: inches(4), points: [], cursor: null }));
const set = (p: Partial<DustDraw>) => useDustDraw.setState(p);
let repeatPress = false;

export const DIAMETERS = [2, 2.5, 4, 5, 6].map((d) => ({ value: String(inches(d)), label: `${d}″` }));

/** Snap targets: run ends and corners, tool dust ports and collector inlets. */
function snapTargets(): Point[] {
  const project = useProjectStore.getState().project;
  if (!project) return [];
  const s = getScenario(project);
  return [...s.dust.runs.flatMap((r) => r.points), ...dustEndpoints(buildAnalysisContext(project)).map((e) => e.port)];
}

function snap(e: CanvasPointerEvent, prev?: Point): Point {
  const tol = snapThreshold(12);
  let best: Point | null = null;
  let bd = tol;
  for (const t of snapTargets()) {
    const d = distance(t, e.world);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  if (best) return best;
  if (prev && e.shiftKey) {
    const dx = e.world.x - prev.x;
    const dy = e.world.y - prev.y;
    const len = Math.hypot(dx, dy);
    const a = snapAngle((Math.atan2(dy, dx) * 180) / Math.PI, 45);
    return { x: prev.x + Math.cos((a * Math.PI) / 180) * len, y: prev.y + Math.sin((a * Math.PI) / 180) * len };
  }
  return e.world;
}

function finish() {
  const { points, mode, diameter } = useDustDraw.getState();
  if (points.length < 2 || (mode !== 'rigid' && mode !== 'flex')) return;
  const project = useProjectStore.getState().project;
  if (!project) return;
  const ends = dustEndpoints(buildAnalysisContext(project));
  const near = (p: Point) => ends.find((e) => distance(e.port, p) < inches(2))?.objectId;
  const run: DuctRun = {
    id: newId(),
    kind: mode,
    diameter,
    points: points.map((p) => ({ x: quantize(p.x), y: quantize(p.y) })),
    ...(near(points[0]!) ? { fromId: near(points[0]!) } : {}),
    ...(near(points[points.length - 1]!) ? { toId: near(points[points.length - 1]!) } : {}),
  };
  const r = dispatch({ type: 'duct.add', payload: { items: [run] } });
  if (!r.ok) return uiActions.flash(r.error, 'error');
  set({ points: [] });
  uiActions.select([{ kind: 'duct', id: run.id }]);
  uiActions.flash(`Added a ${mode === 'flex' ? 'flexible hose' : 'duct'} run. Keep drawing, or press V to select.`);
}

function placeFitting(e: CanvasPointerEvent) {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const { mode } = useDustDraw.getState();
  let best: { run: DuctRun; p: Point; d: number } | null = null;
  for (const run of getScenario(project).dust.runs) {
    for (let k = 0; k + 1 < run.points.length; k++) {
      const c = closestPointOnSegment(e.world, run.points[k]!, run.points[k + 1]!);
      if (!best || c.distance < best.d) best = { run, p: c.point, d: c.distance };
    }
  }
  if (!best || best.d > snapThreshold(16)) return uiActions.flash('Click on a duct or hose run to place the fitting there.', 'info');
  const f: DustFitting = { id: newId(), kind: mode as DustFitting['kind'], x: quantize(best.p.x), y: quantize(best.p.y), runId: best.run.id };
  const r = dispatch({ type: 'fitting.add', payload: { items: [f] } });
  if (!r.ok) return uiActions.flash(r.error, 'error');
  uiActions.flash(mode === 'blast-gate' ? 'Blast gate added.' : 'Hose connection added.');
}

function DustDrawOverlay() {
  const { points, cursor, mode, diameter } = useDustDraw();
  const scale = useScale();
  if (mode !== 'rigid' && mode !== 'flex') return cursor ? <Circle x={cursor.x} y={cursor.y} radius={6 / scale} stroke="#6c5a86" strokeWidth={1.5} strokeScaleEnabled={false} /> : null;
  const pts = cursor ? [...points, cursor] : points;
  if (pts.length === 0) return null;
  return (
    <Group listening={false}>
      <Line points={pts.flatMap((p) => [p.x, p.y])} stroke="#6c5a86" opacity={0.35} strokeWidth={diameter} lineCap="round" lineJoin="round" />
      <Line points={pts.flatMap((p) => [p.x, p.y])} stroke="#6c5a86" strokeWidth={1.5} dash={mode === 'flex' ? [4, 3] : undefined} strokeScaleEnabled={false} />
      {points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={4 / scale} fill="#fff" stroke="#6c5a86" strokeWidth={1.5} strokeScaleEnabled={false} />
      ))}
    </Group>
  );
}

function DustOptions() {
  const { mode, diameter } = useDustDraw();
  const modes: Array<[DustMode, string]> = [
    ['rigid', 'Fixed duct'],
    ['flex', 'Flex hose'],
    ['blast-gate', 'Blast gate'],
    ['hose-connection', 'Hose connection'],
  ];
  return (
    <>
      {modes.map(([m, label]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => set({ mode: m, points: [] })}
          className={cn('h-7 rounded px-2 text-xs', mode === m ? 'bg-select/25 text-ink ring-1 ring-inset ring-select/60' : 'text-ink-muted hover:bg-panel-3 hover:text-ink')}
          data-testid={`dust-mode-${m}`}
        >
          {label}
        </button>
      ))}
      {(mode === 'rigid' || mode === 'flex') && (
        <>
          <span className="mx-1 h-5 w-px bg-line" />
          <Select className="h-7 w-20" ariaLabel="Diameter" value={String(diameter)} onValueChange={(v) => set({ diameter: Number(v) })} options={DIAMETERS} />
        </>
      )}
    </>
  );
}

function DustHint() {
  const { mode, points } = useDustDraw();
  const text =
    mode === 'rigid' || mode === 'flex'
      ? points.length < 2
        ? 'Click from the collector toward a tool; points snap to dust ports and other runs · Shift: 45°'
        : 'Keep clicking, or double-click / Enter to finish · Backspace removes the last point'
      : 'Click on a run to place the fitting';
  return <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-2xs text-ink-muted shadow-lg">{text} · Esc to cancel</div>;
}

export const dustTool: CanvasTool = {
  id: 'dust',
  label: 'Dust collection',
  icon: Wind,
  cursor: 'crosshair',
  order: 60,
  overlay: DustDrawOverlay,
  optionsBar: DustOptions,
  htmlOverlay: DustHint,
  onActivate: () => set({ points: [], cursor: null }),
  onDeactivate: () => set({ points: [], cursor: null }),
  onPointerDown(e) {
    if (e.button !== 0) return;
    const st = useDustDraw.getState();
    if (st.mode === 'blast-gate' || st.mode === 'hose-connection') return placeFitting(e);
    const p = snap(e, st.points[st.points.length - 1]);
    const last = st.points[st.points.length - 1];
    repeatPress = !!last && distance(last, p) <= 1;
    if (!repeatPress) set({ points: [...st.points, p] });
  },
  onPointerMove(e) {
    const st = useDustDraw.getState();
    set({ cursor: st.mode === 'rigid' || st.mode === 'flex' ? snap(e, st.points[st.points.length - 1]) : e.world });
  },
  onDoubleClick() {
    if (repeatPress && useDustDraw.getState().points.length >= 2) finish();
  },
  onKeyDown(e) {
    const st = useDustDraw.getState();
    if (e.key === 'Escape' && st.points.length) {
      set({ points: [] });
      return true;
    }
    if (e.key === 'Enter' && st.points.length >= 2) {
      finish();
      return true;
    }
    if (e.key === 'Backspace' && st.points.length) {
      set({ points: st.points.slice(0, -1) });
      return true;
    }
    return false;
  },
};
