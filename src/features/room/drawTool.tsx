/**
 * Wall tool (W): click corners to draw the room outline. Live segment length, compass bearing and
 * corner angle; snapping to the grid, existing corners and 45° directions (Shift = 15° steps, Alt =
 * free). Type a length (e.g. 21' 6") and optionally a bearing, then Enter, to place an exact wall.
 * Close by clicking the first corner, pressing Enter/C with 3+ corners, or double-clicking.
 * Backspace removes the last corner; Esc cancels.
 */
import { PenLine } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Circle, Group, Line, Text } from 'react-konva';
import { create } from 'zustand';
import type { CanvasTool } from '@/app/registry';
import { toScreen } from '@/app/canvas/viewport';
import { bearingOfDirection, directionOfBearing, roomProblem } from '@/domain/roomEdit';
import { parseAngle } from '@/domain/units';
import { add, angleDiff, angleOf, distance, rotate, snapAngle, snapPoint, sub, type Guide, type Point } from '@/geometry';
import { useFormatters, makeFormatters } from '@/hooks/useFormatters';
import { Kbd } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { editorActions } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { canvasColors } from '@/styles/tokens';
import { snapConfig, snapThreshold } from '@/features/editor/selection';
import { useScale, useViewRotation } from '@/features/plan/hooks';
import { uprightAngle } from '@/features/plan/layers/RoomLayer';
import { arcPoints } from '@/features/plan/layers/ArchitectureLayer';
import { applyOutline } from './build';

interface DrawState {
  points: Point[];
  cursor: Point | null;
  closing: boolean;
  guides: Guide[];
  /** Typed-entry panel open (focused) and its initial text. */
  typing: { seed: string; nonce: number } | null;
  error: string | null;
}

export const useDrawStore = create<DrawState>()(() => ({ points: [], cursor: null, closing: false, guides: [], typing: null, error: null }));
const set = (p: Partial<DrawState>) => useDrawStore.setState(p);

function reset() {
  set({ points: [], cursor: null, closing: false, guides: [], typing: null, error: null });
  editorActions.setGuides([]);
}

/** Snap the proposed next corner. */
function snapNext(world: Point, shift: boolean): { p: Point; closing: boolean; guides: Guide[] } {
  const { points } = useDrawStore.getState();
  const last = points[points.length - 1];
  const thr = snapThreshold(10);
  if (points.length >= 3 && distance(world, points[0]!) <= thr) return { p: points[0]!, closing: true, guides: [{ kind: 'point', from: points[0]!, to: points[0]!, source: 'corner' }] };
  if (last && shift) {
    const len = distance(last, world);
    const ang = snapAngle(angleOf(sub(world, last)), 15);
    return { p: add(last, rotate({ x: len, y: 0 }, ang)), closing: false, guides: [] };
  }
  const sc = snapConfig();
  if (!sc.on) return { p: world, closing: false, guides: [] };
  const project = useProjectStore.getState().project;
  const existing = project && project.room.vertices.length >= 3 ? project.room.vertices : [];
  const s = snapPoint(
    world,
    {
      gridSize: sc.toggles.grid ? sc.grid : undefined,
      corners: [...points, ...existing],
      objects: points.map((q, i) => ({ id: String(i), bbox: { minX: q.x, minY: q.y, maxX: q.x, maxY: q.y } })),
    },
    thr,
    { ...sc.toggles, walls: false, wallCenters: false },
  );
  if (last && s.source !== 'corner') {
    // Direction magnet: snap to 45° multiples when close, keeping the (snapped) length.
    const ang = angleOf(sub(world, last));
    const target = Math.round(ang / 45) * 45;
    if (Math.abs(angleDiff(ang, target)) <= 4) {
      const f = makeFormatters(project?.settings ?? null);
      const step = f.system === 'imperial' ? (sc.toggles.grid ? Math.min(sc.grid, 25.4) : 25.4) : 10;
      const len = Math.max(step, Math.round(distance(last, world) / step) * step);
      return { p: add(last, rotate({ x: len, y: 0 }, target)), closing: false, guides: [{ kind: 'segment', from: last, to: add(last, rotate({ x: len * 1.5, y: 0 }, target)), source: 'angle' }] };
    }
  }
  return { p: s.point, closing: false, guides: s.guides };
}

/** True when the latest click landed on the previous corner (the second half of a real double-click). */
let lastPressWasRepeat = false;

function addPoint(p: Point): boolean {
  const { points } = useDrawStore.getState();
  const last = points[points.length - 1];
  if (last && distance(last, p) < 1) return false;
  set({ points: [...points, p], error: null });
  return true;
}

function finish(): void {
  const { points } = useDrawStore.getState();
  if (points.length < 3) {
    set({ error: 'A room needs at least 3 corners.' });
    return;
  }
  const problem = roomProblem(points);
  if (problem) {
    set({ error: problem });
    uiActions.flash(problem, 'error');
    return;
  }
  const pts = [...points];
  applyOutline(pts, { label: 'Draw room outline', onDone: reset });
}

/** Direction (degrees, angleOf convention) the next typed wall will go: toward the cursor. */
function currentDirection(): number | null {
  const { points, cursor } = useDrawStore.getState();
  const last = points[points.length - 1];
  if (!last || !cursor || distance(last, cursor) < 1) return points.length >= 2 ? angleOf(sub(last!, points[points.length - 2]!)) : null;
  return angleOf(sub(cursor, last));
}

export function commitTyped(lengthMm: number, bearing: number | null): string | null {
  const { points } = useDrawStore.getState();
  const last = points[points.length - 1];
  if (!last) return 'Click the first corner on the plan, then type the wall length.';
  const dir = bearing !== null ? directionOfBearing(bearing) : currentDirection();
  if (dir === null) return 'Point the cursor in the direction of the wall, or type a bearing (N 0°, E 90°, S 180°, W 270°).';
  const p = add(last, rotate({ x: lengthMm, y: 0 }, dir));
  addPoint({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
  set({ cursor: p });
  return null;
}

// ───────────── Konva preview ─────────────

function DrawOverlay() {
  const { points, cursor, closing, guides } = useDrawStore();
  const scale = useScale();
  const viewRot = useViewRotation();
  const fmt = useFormatters();
  if (points.length === 0 && !cursor) return null;
  const last = points[points.length - 1];
  const font = 11 / scale;
  const pts = points.flatMap((p) => [p.x, p.y]);
  const seg = last && cursor ? [last, cursor] : null;
  const segLen = seg ? distance(seg[0]!, seg[1]!) : 0;
  const segDir = seg ? angleOf(sub(seg[1]!, seg[0]!)) : 0;
  const prevDir = points.length >= 2 ? angleOf(sub(last!, points[points.length - 2]!)) : null;
  const turn = prevDir !== null && seg ? Math.abs(angleDiff(prevDir, segDir)) : null;
  return (
    <Group>
      {points.length >= 3 && <Line points={pts} closed fill="rgba(47,125,246,0.06)" listening={false} />}
      <Line points={pts} stroke={canvasColors.select} strokeWidth={2.5} strokeScaleEnabled={false} lineCap="round" lineJoin="round" />
      {points.map((p, i) => {
        const b = points[i + 1];
        if (!b) return null;
        const mid = { x: (p.x + b.x) / 2, y: (p.y + b.y) / 2 };
        return (
          <Text
            key={`len-${i}`}
            x={mid.x}
            y={mid.y}
            rotation={uprightAngle(angleOf(sub(b, p)), viewRot)}
            text={fmt.length(distance(p, b))}
            fontSize={font}
            fontFamily="JetBrains Mono Variable, monospace"
            fill={canvasColors.select}
            width={160 / scale}
            offsetX={80 / scale}
            offsetY={font * 1.4}
            align="center"
          />
        );
      })}
      {seg && <Line points={seg.flatMap((p) => [p.x, p.y])} stroke={canvasColors.select} strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} />}
      {prevDir !== null && seg && segLen > 1 && (
        <Line points={arcPoints(last!, 26 / scale, prevDir + 180, prevDir + 180 + angleDiff(prevDir + 180, segDir)).flatMap((p) => [p.x, p.y])} stroke={canvasColors.select} strokeWidth={1} strokeScaleEnabled={false} />
      )}
      {points.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={(i === 0 && closing ? 7 : 4) / scale} fill={i === 0 ? (closing ? canvasColors.select : '#fff') : canvasColors.select} stroke={canvasColors.select} strokeWidth={1.5} strokeScaleEnabled={false} />
      ))}
      {cursor && <Circle x={cursor.x} y={cursor.y} radius={3.5 / scale} fill={canvasColors.select} />}
      {guides.map((g, i) =>
        g.kind === 'point' ? null : <Line key={`g${i}`} points={[g.from.x, g.from.y, g.to.x, g.to.y]} stroke="#e0457b" strokeWidth={1} dash={[5, 3]} strokeScaleEnabled={false} />,
      )}
      {seg && segLen > 1 && (
        <Text
          x={cursor!.x}
          y={cursor!.y}
          rotation={-viewRot}
          offsetX={-12 / scale}
          offsetY={-12 / scale}
          text={`${fmt.length(segLen)}  ·  ${compass(bearingOfDirection(segDir))}${turn !== null ? `  ·  corner ${fmt.angle(180 - turn)}` : ''}`}
          fontSize={font}
          fontFamily="JetBrains Mono Variable, monospace"
          fill={canvasColors.ink}
          padding={3 / scale}
          listening={false}
        />
      )}
    </Group>
  );
}

function compass(b: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${names[Math.round(b / 45) % 8]} ${Math.round(b * 10) / 10}°`;
}

// ───────────── HTML: hints + typed entry ─────────────

function TypedEntry() {
  const { points, typing, error } = useDrawStore();
  const viewport = useUiStore((s) => s.viewport);
  const fmt = useFormatters();
  const [len, setLen] = useState('');
  const [bearing, setBearing] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const lenRef = useRef<HTMLInputElement>(null);
  // Layout effect: focus before the next keystroke can arrive (fast typists / automation).
  useLayoutEffect(() => {
    if (typing) {
      setLen(typing.seed);
      setMsg(null);
      const el = lenRef.current;
      if (el) {
        el.value = typing.seed;
        el.focus();
        el.setSelectionRange(typing.seed.length, typing.seed.length);
      }
    }
  }, [typing]);
  const last = points[points.length - 1];
  const anchor = last ? toScreen(viewport, last) : null;
  const submit = () => {
    const r = fmt.parse(len, { allowZero: false });
    if (!r.ok) return setMsg(r.error);
    let b: number | null = null;
    if (bearing.trim()) {
      const map: Record<string, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
      const key = bearing.trim().toLowerCase();
      if (key in map) b = map[key]!;
      else {
        const a = parseAngle(bearing);
        if (!a.ok) return setMsg(a.error);
        b = ((a.degrees % 360) + 360) % 360;
      }
    }
    const err = commitTyped(r.mm, b);
    if (err) return setMsg(err);
    setLen('');
    setBearing('');
    setMsg(null);
    lenRef.current?.focus();
  };
  return (
    <>
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md border border-line-strong bg-panel/95 px-3 py-1.5 text-2xs text-ink-muted shadow-lg" data-testid="wall-tool-hint">
        {points.length === 0 ? (
          <>Click to place the first corner · hold <Kbd>Shift</Kbd> for 15° steps · <Kbd>Alt</Kbd> disables snapping</>
        ) : (
          <>
            Click the next corner or <b className="text-ink">type a length</b> then <Kbd>Enter</Kbd> · {points.length >= 3 ? <>click the first corner or press <Kbd>Enter</Kbd> to close · </> : null}
            <Kbd>Backspace</Kbd> undo corner · <Kbd>Esc</Kbd> cancel
          </>
        )}
        {error && <span className="ml-2 text-danger">{error}</span>}
      </div>
      {typing && anchor && (
        <form
          className="absolute z-30 flex items-start gap-1 rounded-md border border-select/60 bg-panel-3 p-1.5 shadow-xl"
          style={{ left: Math.min(anchor.x + 14, (useUiStore.getState().canvasSize.width || 800) - 300), top: anchor.y + 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              set({ typing: null });
            }
          }}
          data-testid="wall-typed-entry"
        >
          <label className="flex flex-col text-2xs text-ink-muted">
            Length
            <input
              ref={lenRef}
              className="num h-7 w-24 rounded border border-line bg-panel px-1.5 text-xs text-ink outline-none focus:border-select"
              value={len}
              onChange={(e) => setLen(e.target.value)}
              aria-label="Wall length"
              data-testid="wall-length-input"
              placeholder={`e.g. 21' 6"`}
            />
          </label>
          <label className="flex flex-col text-2xs text-ink-muted">
            Bearing (optional)
            <input
              className="num h-7 w-24 rounded border border-line bg-panel px-1.5 text-xs text-ink outline-none focus:border-select"
              value={bearing}
              onChange={(e) => setBearing(e.target.value)}
              aria-label="Wall bearing"
              data-testid="wall-bearing-input"
              placeholder="E, 90, S…"
            />
          </label>
          <button type="submit" className="mt-3.5 h-7 rounded bg-select px-2 text-xs font-medium text-white">
            Add wall
          </button>
          {msg && <p className="absolute left-0 top-full mt-1 w-72 rounded border border-danger/50 bg-panel-3 px-2 py-1 text-2xs text-danger" role="alert">{msg}</p>}
        </form>
      )}
    </>
  );
}

// ───────────── the tool ─────────────

export const wallTool: CanvasTool = {
  id: 'wall',
  label: 'Draw walls',
  icon: PenLine,
  shortcut: 'w',
  cursor: 'crosshair',
  order: 30,
  overlay: DrawOverlay,
  htmlOverlay: TypedEntry,
  onActivate() {
    reset();
  },
  onDeactivate() {
    reset();
  },
  onPointerDown(e) {
    if (e.button !== 0) return;
    const s = snapNext(e.world, e.shiftKey);
    if (s.closing) return finish();
    lastPressWasRepeat = !addPoint(s.p);
    set({ cursor: s.p, typing: null });
  },
  onPointerMove(e) {
    const s = snapNext(e.world, e.shiftKey);
    set({ cursor: s.p, closing: s.closing, guides: s.guides });
  },
  onDoubleClick(e) {
    // Only a real double-click on the last corner closes the room (quick clicks on different spots
    // can also register as a "double click").
    void e;
    if (useDrawStore.getState().points.length >= 3 && lastPressWasRepeat) finish();
  },
  onKeyDown(e) {
    const st = useDrawStore.getState();
    if (e.key === 'Escape') {
      if (st.typing) return (set({ typing: null }), true);
      if (st.points.length) return (reset(), true);
      return false;
    }
    if (e.key === 'Backspace' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && st.points.length)) {
      if (st.points.length === 0) return false;
      set({ points: st.points.slice(0, -1), error: null });
      return true;
    }
    if (e.key === 'Enter' || e.key.toLowerCase() === 'c') {
      if (st.points.length >= 3) {
        finish();
        return true;
      }
      return e.key === 'Enter';
    }
    if (st.points.length > 0 && /^[0-9.'" /a-z-]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && (st.typing || /^[0-9.'"]$/.test(e.key))) {
      // Keys that arrive before the entry field has focus are appended to what was typed so far.
      set({ typing: { seed: (st.typing?.seed ?? '') + e.key, nonce: Date.now() } });
      return true;
    }
    return false;
  },
};
