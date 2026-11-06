/**
 * Zone tool (Z): draw a translucent workflow zone as a rectangle (drag, or click two corners) or a
 * polygon (click corners; click the first corner, press Enter or double-click to close).
 */
import { SquareDashedMousePointer } from 'lucide-react';
import { Circle, Group, Line } from 'react-konva';
import { create } from 'zustand';
import type { CanvasPointerEvent, CanvasTool } from '@/app/registry';
import { WORKFLOW_ZONE_KINDS, type WorkflowZone } from '@/domain/schema';
import { quantize } from '@/domain/units';
import { distance, findSelfIntersections, snapPoint, type Point } from '@/geometry';
import { Select } from '@/components/ui';
import { dispatch } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { zoneKindColors } from '@/styles/tokens';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { buildSnapTargets, editorCtx, snapConfig, snapThreshold } from '@/features/editor/selection';
import { useScale } from '@/features/plan/hooks';

export const ZONE_KIND_LABELS: Record<WorkflowZone['kind'], string> = {
  parking: 'Parking',
  woodworking: 'Woodworking',
  assembly: 'Assembly',
  'lumber-storage': 'Lumber storage',
  finishing: 'Finishing',
  automotive: 'Automotive',
  'lawn-equipment': 'Lawn equipment',
  'tool-storage': 'Tool storage',
  'walking-aisle': 'Walking aisle',
  staging: 'Staging',
  'project-storage': 'Project storage',
  other: 'Other',
};

interface ZoneDraw {
  shape: 'rect' | 'polygon';
  kind: WorkflowZone['kind'];
  points: Point[];
  start: Point | null;
  cursor: Point | null;
  dragging: boolean;
}
export const useZoneDraw = create<ZoneDraw>()(() => ({ shape: 'rect', kind: 'woodworking', points: [], start: null, cursor: null, dragging: false }));
const set = (p: Partial<ZoneDraw>) => useZoneDraw.setState(p);
/** True when the latest click landed on the previous corner (second half of a real double-click). */
let repeatPress = false;

function snap(e: CanvasPointerEvent): Point {
  const c = editorCtx();
  const sc = snapConfig();
  if (!c || !sc.on) return e.world;
  return snapPoint(e.world, buildSnapTargets(c, new Set()), snapThreshold(), sc.toggles).point;
}

function create_(points: Point[]) {
  const { kind } = useZoneDraw.getState();
  if (points.length < 3) return;
  if (findSelfIntersections(points).length) return uiActions.flash('A zone outline cannot cross itself.', 'error');
  const c = editorCtx();
  const n = (c?.scenario.zones.filter((z) => z.kind === kind).length ?? 0) + 1;
  const zone: WorkflowZone = {
    id: newId(),
    name: `${ZONE_KIND_LABELS[kind]}${n > 1 ? ` ${n}` : ''}`,
    kind,
    points: points.map((p) => ({ x: quantize(p.x), y: quantize(p.y) })),
    locked: false,
    hidden: false,
    notes: '',
  };
  const r = dispatch({ type: 'zone.add', payload: { items: [zone] } });
  if (!r.ok) return uiActions.flash(r.error, 'error');
  set({ points: [], start: null, dragging: false });
  uiActions.setTool('select');
  uiActions.select([{ kind: 'zone', id: zone.id }]);
  uiActions.flash(`Added the “${zone.name}” zone. Assign the objects inside it from the inspector.`);
}

const rectPoints = (a: Point, b: Point): Point[] => [
  { x: a.x, y: a.y },
  { x: b.x, y: a.y },
  { x: b.x, y: b.y },
  { x: a.x, y: b.y },
];

function ZoneDrawOverlay() {
  const { shape, kind, points, start, cursor } = useZoneDraw();
  const scale = useScale();
  const color = zoneKindColors[kind] ?? '#999';
  const pts = shape === 'rect' ? (start && cursor ? rectPoints(start, cursor) : []) : cursor ? [...points, cursor] : points;
  if (pts.length === 0) return null;
  return (
    <Group>
      <Line points={pts.flatMap((p) => [p.x, p.y])} closed={pts.length > 2} fill={color} opacity={0.25} />
      <Line points={pts.flatMap((p) => [p.x, p.y])} closed={pts.length > 2} stroke={color} strokeWidth={2} dash={[8, 5]} strokeScaleEnabled={false} />
      {shape === 'polygon' && points.map((p, i) => <Circle key={i} x={p.x} y={p.y} radius={(i === 0 ? 6 : 4) / scale} fill={i === 0 ? '#fff' : color} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />)}
    </Group>
  );
}

function ZoneOptions() {
  const { shape, kind } = useZoneDraw();
  return (
    <>
      {(['rect', 'polygon'] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={shape === s}
          onClick={() => set({ shape: s, points: [], start: null })}
          className={cn('h-7 rounded px-2 text-xs', shape === s ? 'bg-select/25 text-ink ring-1 ring-inset ring-select/60' : 'text-ink-muted hover:bg-panel-3 hover:text-ink')}
        >
          {s === 'rect' ? 'Rectangle' : 'Polygon'}
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <Select className="h-7 w-40" ariaLabel="Zone type" value={kind} onValueChange={(v) => set({ kind: v as WorkflowZone['kind'] })} options={WORKFLOW_ZONE_KINDS.map((k) => ({ value: k, label: ZONE_KIND_LABELS[k] }))} />
    </>
  );
}

function ZoneHint() {
  const { shape, points } = useZoneDraw();
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-2xs text-ink-muted shadow-lg">
      {shape === 'rect' ? 'Drag to draw the zone (or click two opposite corners)' : points.length < 3 ? 'Click the corners of the zone' : 'Click the first corner, press Enter or double-click to finish'} · Esc to cancel
    </div>
  );
}

export const zoneTool: CanvasTool = {
  id: 'zone',
  label: 'Zone',
  icon: SquareDashedMousePointer,
  shortcut: 'z',
  cursor: 'crosshair',
  order: 50,
  overlay: ZoneDrawOverlay,
  optionsBar: ZoneOptions,
  htmlOverlay: ZoneHint,
  onActivate() {
    set({ points: [], start: null, cursor: null, dragging: false });
  },
  onDeactivate() {
    set({ points: [], start: null, cursor: null, dragging: false });
  },
  onPointerDown(e) {
    if (e.button !== 0) return;
    const p = snap(e);
    const st = useZoneDraw.getState();
    if (st.shape === 'rect') {
      if (st.start && !st.dragging) {
        create_(rectPoints(st.start, p));
        return;
      }
      set({ start: p, cursor: p, dragging: true });
      return;
    }
    if (st.points.length >= 3 && distance(p, st.points[0]!) <= snapThreshold(10)) return create_(st.points);
    const last = st.points[st.points.length - 1];
    repeatPress = !!last && distance(last, p) <= 1;
    if (!repeatPress) set({ points: [...st.points, p] });
  },
  onPointerMove(e) {
    set({ cursor: snap(e) });
  },
  onPointerUp(e) {
    const st = useZoneDraw.getState();
    if (st.shape !== 'rect' || !st.start || !st.dragging) return;
    const p = snap(e);
    if (Math.abs(p.x - st.start.x) * Math.abs(p.y - st.start.y) > 10000) create_(rectPoints(st.start, p));
    else set({ dragging: false }); // treat as the first click of a click-click rectangle
  },
  onDoubleClick() {
    const st = useZoneDraw.getState();
    // Only a real double-click (second press on the same corner) finishes; quick clicks elsewhere don't.
    if (st.shape === 'polygon' && st.points.length >= 3 && repeatPress) create_(st.points);
  },
  onKeyDown(e) {
    const st = useZoneDraw.getState();
    if (e.key === 'Escape' && (st.points.length || st.start)) {
      set({ points: [], start: null, dragging: false });
      return true;
    }
    if (e.key === 'Enter' && st.shape === 'polygon' && st.points.length >= 3) {
      create_(st.points);
      return true;
    }
    if (e.key === 'Backspace' && st.points.length) {
      set({ points: st.points.slice(0, -1) });
      return true;
    }
    return false;
  },
};
