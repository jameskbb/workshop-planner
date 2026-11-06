/**
 * HTML chrome over the plan canvas: rulers (top / left, following zoom, pan and orientation),
 * a north arrow, the minimap and the "no room yet" empty state.
 */
import { PenLine, Ruler as RulerIcon, Shapes } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { centerOn, toScreen, toWorld } from '@/app/canvas/viewport';
import { Button } from '@/components/ui';
import { getScenario, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { bbox, bboxUnion, expandBBox, vehicleBody, type BBox, type Point } from '@/geometry';
import { useFormatters, type Formatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { editorActions } from '@/stores/editorStore';
import { uiActions, useUiStore, type Viewport } from '@/stores/uiStore';
import { orientationOf } from '@/app/canvas/viewport';
import { useViewPrefs } from './prefs';

export const RULER = 18;

// ───────────── rulers ─────────────

const IMPERIAL_STEPS = [25.4, 50.8, 152.4, 304.8, 609.6, 1524, 3048, 6096, 15240];
const METRIC_STEPS = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function drawRuler(canvas: HTMLCanvasElement, horizontal: boolean, v: Viewport, size: { width: number; height: number }, fmt: Formatters, cursor: Point | null) {
  const dpr = window.devicePixelRatio || 1;
  const len = horizontal ? size.width : size.height;
  const w = horizontal ? len : RULER;
  const h = horizontal ? RULER : len;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#1f2327';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a4047';
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
  } else {
    ctx.moveTo(w - 0.5, 0);
    ctx.lineTo(w - 0.5, h);
  }
  ctx.stroke();
  // World coordinate that varies along this ruler (x or y, possibly reversed by the view orientation).
  const at = (s: number) => toWorld(v, horizontal ? { x: s, y: RULER } : { x: RULER, y: s });
  const p0 = at(0);
  const p1 = at(len);
  const useX = Math.abs(p1.x - p0.x) > Math.abs(p1.y - p0.y);
  const c0 = useX ? p0.x : p0.y;
  const c1 = useX ? p1.x : p1.y;
  const pxPerMm = len / Math.max(1e-9, Math.abs(c1 - c0));
  const steps = fmt.system === 'imperial' ? IMPERIAL_STEPS : METRIC_STEPS;
  const step = steps.find((s) => s * pxPerMm >= 64) ?? steps[steps.length - 1]!;
  const minor = step / (fmt.system === 'imperial' && step >= 304.8 ? (step >= 1524 ? 5 : 4) : 5);
  const lo = Math.min(c0, c1);
  const hi = Math.max(c0, c1);
  const toS = (c: number) => ((c - c0) / (c1 - c0)) * len;
  ctx.strokeStyle = '#5b636b';
  ctx.fillStyle = '#9aa3ab';
  ctx.font = '10px "JetBrains Mono Variable", monospace';
  ctx.beginPath();
  for (let c = Math.floor(lo / minor) * minor; c <= hi; c += minor) {
    const s = Math.round(toS(c)) + 0.5;
    const major = Math.abs(c / step - Math.round(c / step)) < 1e-6;
    const t = major ? 8 : 4;
    if (horizontal) {
      ctx.moveTo(s, h);
      ctx.lineTo(s, h - t);
    } else {
      ctx.moveTo(w, s);
      ctx.lineTo(w - t, s);
    }
    if (major) {
      const label = fmt.length(Math.round(c * 100) / 100, { style: fmt.system === 'imperial' ? 'feet-inches' : 'auto' });
      if (horizontal) ctx.fillText(label, s + 3, 10);
      else {
        ctx.save();
        ctx.translate(10, s - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  if (cursor) {
    const cs = toScreen(v, cursor);
    const s = horizontal ? cs.x : cs.y;
    ctx.strokeStyle = '#ff7a1a';
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(s + 0.5, 0);
      ctx.lineTo(s + 0.5, h);
    } else {
      ctx.moveTo(0, s + 0.5);
      ctx.lineTo(w, s + 0.5);
    }
    ctx.stroke();
  }
}

export function Rulers() {
  const on = useViewPrefs((s) => s.rulers);
  const v = useUiStore((s) => s.viewport);
  const size = useUiStore((s) => s.canvasSize);
  const cursor = useUiStore((s) => s.cursor);
  const fmt = useFormatters();
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!on) return;
    if (top.current) drawRuler(top.current, true, v, size, fmt, cursor);
    if (left.current) drawRuler(left.current, false, v, size, fmt, cursor);
  }, [on, v, size, fmt, cursor]);
  if (!on) return null;
  return (
    <div className="pointer-events-none" aria-hidden>
      <canvas ref={top} className="absolute left-0 top-0 z-10" />
      <canvas ref={left} className="absolute left-0 top-0 z-10" />
      <div className="absolute left-0 top-0 z-10 size-[18px] border-b border-r border-[#3a4047] bg-[#1f2327]" />
    </div>
  );
}

// ───────────── compass ─────────────

export function Compass() {
  const rot = useUiStore((s) => s.viewport.rotation ?? 0);
  const orientation = orientationOf(rot);
  return (
    <button
      type="button"
      className="absolute right-3 top-7 z-10 grid size-9 place-items-center rounded-full border border-line-strong bg-panel/90 text-ink shadow hover:bg-panel-3"
      title={orientation === 'north' ? 'North is up' : `${orientation[0]!.toUpperCase()}${orientation.slice(1)} is up. Click to put north up`}
      aria-label={`Plan orientation: ${orientation} up. Click to put north up.`}
      onClick={() => setOrientationRotation(0)}
      data-testid="compass"
    >
      <svg viewBox="-12 -12 24 24" className="size-7" style={{ transform: `rotate(${rot}deg)` }} aria-hidden>
        <path d="M0 -9 L4 3 L0 1 L-4 3 Z" fill="#ff7a1a" />
        <path d="M0 9 L4 3 L0 1 L-4 3 Z" fill="currentColor" opacity="0.35" />
        <text x="0" y="-9.5" textAnchor="middle" fontSize="6" fill="currentColor" style={{ transform: `rotate(${-rot}deg)`, transformOrigin: '0 -11px' }}>
          N
        </text>
      </svg>
    </button>
  );
}

/** Rotate the view (keeping the same world point centered). */
export function setOrientationRotation(rotation: number): void {
  const { viewport, canvasSize } = useUiStore.getState();
  const mid = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
  const center = toWorld(viewport, mid);
  uiActions.setViewport(centerOn({ ...viewport, rotation }, center, mid));
}

// ───────────── minimap ─────────────

const MINI_W = 184;
const MINI_H = 128;

function worldBounds(): BBox | null {
  const p = useProjectStore.getState().project;
  if (!p) return null;
  const boxes: BBox[] = [];
  if (p.room.vertices.length >= 3) boxes.push(bbox(roomGeometry(p.room).polygon));
  const s = getScenario(p);
  for (const o of s.objects) boxes.push(bbox(objectFootprint(resolveObject(p, o))));
  for (const v of s.vehicles) boxes.push(bbox(vehicleBody(vehicleGeomSpec(v), vehiclePose(v))));
  return boxes.length ? expandBBox(bboxUnion(...boxes), 600) : null;
}

export function Minimap() {
  const on = useViewPrefs((s) => s.minimap);
  const project = useProjectStore((s) => s.project);
  const v = useUiStore((s) => s.viewport);
  const size = useUiStore((s) => s.canvasSize);
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const mapRef = useRef<{ b: BBox; k: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!on || !canvas || !project) return;
    const b = worldBounds();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MINI_W * dpr;
    canvas.height = MINI_H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e9e7e1';
    ctx.fillRect(0, 0, MINI_W, MINI_H);
    if (!b) return;
    const k = Math.min(MINI_W / (b.maxX - b.minX), MINI_H / (b.maxY - b.minY));
    const ox = (MINI_W - (b.maxX - b.minX) * k) / 2 - b.minX * k;
    const oy = (MINI_H - (b.maxY - b.minY) * k) / 2 - b.minY * k;
    mapRef.current = { b, k, ox, oy };
    const P = (p: Point) => [p.x * k + ox, p.y * k + oy] as const;
    const poly = (pts: Point[], fill: string, stroke?: string) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    if (project.room.vertices.length >= 3) poly(roomGeometry(project.room).polygon, '#ffffff', '#2a2e32');
    const s = getScenario(project);
    for (const o of s.objects) if (!o.hidden) poly(objectFootprint(resolveObject(project, o)), '#b9c3cc');
    for (const vh of s.vehicles) if (!vh.hidden) poly(vehicleBody(vehicleGeomSpec(vh), vehiclePose(vh)), '#9fb0c4');
    // Visible area.
    const corners = [toWorld(v, { x: 0, y: 0 }), toWorld(v, { x: size.width, y: 0 }), toWorld(v, { x: size.width, y: size.height }), toWorld(v, { x: 0, y: size.height })];
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    ctx.closePath();
    ctx.fillStyle = 'rgba(47,125,246,0.12)';
    ctx.fill();
    ctx.strokeStyle = '#2f7df6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [on, project, v, size]);
  if (!on || !project || project.room.vertices.length < 3) return null;
  const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = mapRef.current;
    if (!m) return;
    const r = e.currentTarget.getBoundingClientRect();
    const world = { x: (e.clientX - r.left - m.ox) / m.k, y: (e.clientY - r.top - m.oy) / m.k };
    const st = useUiStore.getState();
    uiActions.setViewport(centerOn(st.viewport, world, { x: st.canvasSize.width / 2, y: st.canvasSize.height / 2 }));
  };
  return (
    <div className="absolute bottom-3 right-3 z-10 overflow-hidden rounded-md border border-line-strong shadow-lg" data-testid="minimap">
      <canvas
        ref={ref}
        style={{ width: MINI_W, height: MINI_H }}
        className="block cursor-pointer"
        role="img"
        aria-label="Minimap: click or drag to move the view"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => dragging.current && jump(e)}
        onPointerUp={() => (dragging.current = false)}
      />
    </div>
  );
}

// ───────────── empty state ─────────────

export function CanvasEmptyState() {
  const empty = useProjectStore((s) => (s.project ? s.project.room.vertices.length < 3 : false));
  const tool = useUiStore((s) => s.tool);
  if (!empty || tool !== 'select') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      <div className="pointer-events-auto w-[340px] rounded-lg border border-line-strong bg-panel/95 p-4 text-center shadow-xl" data-testid="canvas-empty">
        <h2 className="text-sm font-semibold text-ink">Start with your garage outline</h2>
        <p className="mt-1 text-xs text-ink-muted">Draw it wall by wall, start from a common shape, or type the lengths you measured with a tape.</p>
        <div className="mt-3 grid gap-1.5">
          <Button variant="primary" onClick={() => uiActions.setTool('wall')} data-testid="empty-draw">
            <PenLine /> Draw walls <span className="ml-auto text-2xs opacity-70">W</span>
          </Button>
          <Button variant="outline" onClick={() => editorActions.openDialog('room-template')}>
            <Shapes /> Use a template
          </Button>
          <Button variant="outline" onClick={() => editorActions.openDialog('room-lengths')}>
            <RulerIcon /> Type wall lengths
          </Button>
        </div>
      </div>
    </div>
  );
}
