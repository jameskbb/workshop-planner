/**
 * The Select tool: click / shift-click / marquee selection, dragging with Figma-style snapping and
 * live distance labels, rotate and resize handles, room corner and wall dragging (with constraints),
 * measurement end points and zone points. All gestures render live previews through the editor
 * store and commit exactly one undoable command on release. Esc cancels a gesture in progress.
 *
 * Marquee: drag left→right selects items fully inside (blue); right→left selects anything touched
 * (green, dashed), the CAD convention.
 */
import { MousePointer2 } from 'lucide-react';
import { entityAdapters, type CanvasPointerEvent, type CanvasTool, type EntityContext, type ToolApi } from '@/app/registry';
import { toScreen } from '@/app/canvas/viewport';
import { projectLengthFormatter } from '@/domain/commands/core/room';
import { floorObstacles, localFace, type Side } from '@/domain/measure';
import { findObject, resolveObject, roomGeometry } from '@/domain/resolve';
import { moveVerticesEdit } from '@/domain/roomEdit';
import type { EntityRef, Measurement, PlacedObject, Vertex, WorkflowZone } from '@/domain/schema';
import {
  add,
  angleOf,
  bbox,
  bboxIntersects,
  distance,
  dot,
  faceClearance,
  localToWorld,
  polygonContainsPolygon,
  polygonsOverlapOrTouch,
  projectOntoWall,
  rotate,
  snapAngle,
  snapBox,
  snapObjectToWall,
  snapPoint,
  snapToGrid,
  sub,
  worldToLocal,
  type BBox,
  type Guide,
  type Point,
  type Pose,
  type SnapTargets,
} from '@/geometry';
import { makeFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { editorActions, previewKey, useEditorStore, type GapLabel } from '@/stores/editorStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import {
  adapter,
  buildSnapTargets,
  commitPatches,
  editorCtx,
  expandGroups,
  firstLocked,
  pickBlocker,
  refKey,
  refsBounds,
  sameRef,
  snapConfig,
  snapThreshold,
} from './selection';

const DRAG_THRESHOLD_PX = 3;

type Gesture =
  | {
      type: 'move';
      startScreen: Point;
      startWorld: Point;
      refs: EntityRef[];
      /** Clicked ref (for the "click again to narrow selection" rule). */
      clicked: EntityRef;
      wasSelected: boolean;
      additive: boolean;
      started: boolean;
      blocked: string | null;
      box: BBox | null;
      targets: SnapTargets | null;
      obstacles: Array<[Point, Point]> | null;
      /** True when only wall-hosted fixtures move (they slide along walls; no box snapping). */
      hostedOnly: boolean;
    }
  | { type: 'marquee'; startScreen: Point; startWorld: Point; additive: boolean; base: EntityRef[] }
  | { type: 'rotate'; pivot: Point; startAngle: number; refs: EntityRef[]; single: { rotation: number } | null; startScreen: Point }
  | {
      type: 'resize';
      id: string;
      hx: number;
      hy: number;
      pose: Pose;
      working: boolean;
      w: number;
      d: number;
      obstacles: Array<[Point, Point]>;
    }
  | { type: 'vertex'; vertexId: string; startScreen: Point; started: boolean; last: Vertex[] | null; targets: SnapTargets; prev: Point; next: Point }
  | { type: 'wall'; wallId: string; startScreen: Point; startWorld: Point; started: boolean; a: Vertex; b: Vertex; normal: Point; last: Vertex[] | null }
  | { type: 'measure-end'; id: string; end: 'a' | 'b' | 'c'; targets: SnapTargets; started: boolean; startScreen: Point }
  | { type: 'zone-point'; id: string; index: number; targets: SnapTargets; started: boolean; startScreen: Point };

let g: Gesture | null = null;

const fmt = () => makeFormatters(useProjectStore.getState().project?.settings ?? null);
const moved = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) >= DRAG_THRESHOLD_PX;

function hudAt(e: CanvasPointerEvent, lines: string[], tone: 'info' | 'error' = 'info') {
  editorActions.setHud({ lines, at: { x: e.screen.x + 16, y: e.screen.y + 18 }, tone });
}

function cancel() {
  g = null;
  editorActions.clearGesture();
}

// ───────────── click selection ─────────────

function selectOnPointerDown(c: EntityContext, e: CanvasPointerEvent, target: EntityRef): { refs: EntityRef[]; wasSelected: boolean } {
  const sel = useUiStore.getState().selection;
  const group = expandGroups(c.scenario, [target]);
  const wasSelected = sel.some((r) => sameRef(r, target));
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    const keys = new Set(group.map(refKey));
    const next = wasSelected ? sel.filter((r) => !keys.has(refKey(r))) : [...sel, ...group.filter((r) => !sel.some((s) => sameRef(s, r)))];
    uiActions.select(next);
    return { refs: next, wasSelected };
  }
  if (!wasSelected) uiActions.select(group);
  return { refs: wasSelected ? sel : group, wasSelected };
}

// ───────────── live distance labels ─────────────

function objectGaps(c: EntityContext, o: PlacedObject, obstacles: Array<[Point, Point]>): GapLabel[] {
  const r = resolveObject(c.project, o);
  const out: GapLabel[] = [];
  for (const side of ['front', 'back', 'left', 'right'] as Side[]) {
    const f = localFace(r.footprint.width, r.footprint.depth, side, r.footprint.offsetX ?? 0, r.footprint.offsetY ?? 0);
    const cl = faceClearance(localToWorld(r.pose, f.a), localToWorld(r.pose, f.b), rotate(f.normal, r.pose.rotation), obstacles, 5);
    if (Number.isFinite(cl.distance) && cl.distance < 3700 && cl.distance > 0.5) out.push({ from: cl.from, to: cl.to, value: cl.distance });
  }
  return out;
}

// ───────────── move ─────────────

function updateMove(e: CanvasPointerEvent, c: EntityContext, m: Extract<Gesture, { type: 'move' }>) {
  let delta = sub(e.world, m.startWorld);
  if (e.shiftKey) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
  const sc = snapConfig();
  const thr = snapThreshold();
  let guides: Guide[] = [];
  let singlePose: Pose | null = null;
  if (sc.on && m.box && m.targets && !m.hostedOnly) {
    const moving = { minX: m.box.minX + delta.x, minY: m.box.minY + delta.y, maxX: m.box.maxX + delta.x, maxY: m.box.maxY + delta.y };
    const s = snapBox(moving, { ...m.targets, gridSize: sc.toggles.grid ? m.targets.gridSize : undefined }, thr, sc.toggles);
    delta = { x: delta.x + s.dx, y: delta.y + s.dy };
    guides = s.guides;
    // A single object also squares up against angled walls.
    if (m.refs.length === 1 && m.refs[0]!.kind === 'object' && sc.toggles.walls) {
      const o = findObject(c.scenario, m.refs[0]!.id);
      const angled = (m.targets.walls ?? []).filter((w) => Math.abs(w.a.x - w.b.x) > 1e-6 && Math.abs(w.a.y - w.b.y) > 1e-6);
      if (o && angled.length) {
        const r = resolveObject(c.project, o);
        const ws = snapObjectToWall({ x: r.pose.x + delta.x, y: r.pose.y + delta.y, rotation: r.pose.rotation, width: r.footprint.width, depth: r.footprint.depth }, angled, thr);
        if (ws) {
          singlePose = ws.pose;
          guides = [ws.guide];
        }
      }
    }
  }
  const previews: Record<string, unknown> = {};
  for (const ref of m.refs) {
    const a = adapter(ref.kind);
    if (!a?.translate) continue;
    let patch = a.translate(c, ref.id, delta);
    if (singlePose && ref.kind === 'object') {
      const o = findObject(c.scenario, ref.id)!;
      patch = o.mobility === 'mobile' && o.activePosition === 'working' && o.working ? { working: singlePose } : { ...singlePose };
    }
    if (patch) previews[previewKey(ref.kind, ref.id)] = patch;
  }
  editorActions.setPreviews(previews);
  editorActions.setGuides(guides);
  // HUD + gaps for a single object.
  const f = fmt();
  if (m.refs.length === 1 && m.refs[0]!.kind === 'object' && m.obstacles) {
    const o = findObject(c.scenario, m.refs[0]!.id)!;
    const patched = { ...o, ...(previews[previewKey('object', o.id)] as object) } as PlacedObject;
    const r = resolveObject(c.project, patched);
    editorActions.setGaps(objectGaps(c, patched, m.obstacles));
    hudAt(e, [`X ${f.length(r.pose.x)}  Y ${f.length(r.pose.y)}`]);
  } else {
    editorActions.setGaps([]);
    hudAt(e, [`Δ ${f.length(delta.x)}, ${f.length(delta.y)}`]);
  }
}

// ───────────── rotate ─────────────

function updateRotate(e: CanvasPointerEvent, c: EntityContext, r: Extract<Gesture, { type: 'rotate' }>) {
  const sc = snapConfig();
  let deg = angleOf(sub(e.world, r.pivot)) - r.startAngle;
  if (r.single) {
    let abs = r.single.rotation + deg;
    if (e.shiftKey) abs = snapAngle(abs, sc.rotationStep);
    else if (!useUiStore.getState().snapSuppressed) abs = snapAngle(abs, 90, 2.5);
    deg = abs - r.single.rotation;
  } else if (e.shiftKey) deg = snapAngle(deg, sc.rotationStep);
  const previews: Record<string, unknown> = {};
  for (const ref of r.refs) {
    const p = adapter(ref.kind)?.rotate?.(c, ref.id, r.pivot, deg);
    if (p) previews[previewKey(ref.kind, ref.id)] = p;
  }
  editorActions.setPreviews(previews);
  const shown = r.single ? (((r.single.rotation + deg) % 360) + 360) % 360 : deg;
  hudAt(e, [`${Math.round(shown * 10) / 10}°${e.shiftKey ? `  (snap ${sc.rotationStep}°)` : ''}`]);
}

// ───────────── resize ─────────────

function updateResize(e: CanvasPointerEvent, c: EntityContext, s: Extract<Gesture, { type: 'resize' }>) {
  const l = worldToLocal(s.pose, e.world);
  const sc = snapConfig();
  const f = fmt();
  const minSize = 25.4;
  const step = f.system === 'imperial' ? Math.min(sc.grid, 25.4) : Math.min(sc.grid, 10);
  const symmetric = e.altKey;
  let w = s.w;
  let d = s.d;
  let cx = 0;
  let cy = 0;
  const size = (edge: number, half: number, h: number) => (symmetric ? Math.abs(edge) * 2 : h * (edge + h * half));
  if (s.hx !== 0) w = size(l.x, s.w / 2, s.hx);
  if (s.hy !== 0) d = size(l.y, s.d / 2, s.hy);
  if (e.shiftKey && s.hx !== 0 && s.hy !== 0) {
    const k = Math.max(w / s.w, d / s.d);
    w = s.w * k;
    d = s.d * k;
  }
  if (sc.on && !e.altKey) {
    w = snapToGrid(w, step);
    d = snapToGrid(d, step);
  }
  w = Math.max(minSize, w);
  d = Math.max(minSize, d);
  if (!symmetric) {
    if (s.hx !== 0) cx = -s.hx * (s.w / 2) + s.hx * (w / 2);
    if (s.hy !== 0) cy = -s.hy * (s.d / 2) + s.hy * (d / 2);
  }
  const center = localToWorld(s.pose, { x: cx, y: cy });
  const pose = { x: center.x, y: center.y, rotation: s.pose.rotation };
  const patch = s.working ? { width: w, depth: d, working: pose } : { width: w, depth: d, x: pose.x, y: pose.y };
  editorActions.setPreviews({ [previewKey('object', s.id)]: patch });
  const o = findObject(c.scenario, s.id);
  if (o) editorActions.setGaps(objectGaps(c, { ...o, ...patch } as PlacedObject, s.obstacles));
  hudAt(e, [`${f.length(w)} × ${f.length(d)}`]);
}

// ───────────── room corners & walls ─────────────

function vertexTargets(c: EntityContext, exceptId: string): SnapTargets {
  const others = c.project.room.vertices.filter((v) => v.id !== exceptId);
  return {
    gridSize: c.project.settings.gridSize,
    corners: others,
    // Other corners also act as alignment lines (vertical / horizontal guides).
    objects: others.map((v) => ({ id: v.id, bbox: { minX: v.x, minY: v.y, maxX: v.x, maxY: v.y } })),
  };
}

function updateVertex(e: CanvasPointerEvent, c: EntityContext, v: Extract<Gesture, { type: 'vertex' }>) {
  const sc = snapConfig();
  let p = e.world;
  let guides: Guide[] = [];
  if (e.shiftKey) {
    // Constrain the wall from the previous corner to 15° steps.
    const len = distance(v.prev, p);
    const ang = snapAngle(angleOf(sub(p, v.prev)), 15);
    p = add(v.prev, rotate({ x: len, y: 0 }, ang));
  } else if (sc.on) {
    const s = snapPoint(p, v.targets, snapThreshold(), { ...sc.toggles, objectEdges: sc.toggles.corners, objectCenters: false, walls: false, wallCenters: false });
    p = s.point;
    guides = s.guides;
  }
  const f = projectLengthFormatter(c.project);
  const r = moveVerticesEdit(c.project.room, [{ vertexId: v.vertexId, x: p.x, y: p.y }], f);
  editorActions.setGuides(guides);
  const fm = fmt();
  if (r.ok) {
    v.last = r.vertices;
    editorActions.setRoomPreview(r.vertices);
    const i = r.vertices.findIndex((x) => x.id === v.vertexId);
    const n = r.vertices.length;
    const cur = r.vertices[i]!;
    hudAt(e, [`${fm.length(distance(r.vertices[(i - 1 + n) % n]!, cur))} · ${fm.length(distance(cur, r.vertices[(i + 1) % n]!))}`]);
  } else hudAt(e, [r.error], 'error');
}

function updateWall(e: CanvasPointerEvent, c: EntityContext, w: Extract<Gesture, { type: 'wall' }>) {
  const sc = snapConfig();
  let off = dot(sub(e.world, w.startWorld), w.normal);
  // Axis-aligned walls snap their position to the grid.
  if (sc.on && sc.toggles.grid) {
    if (Math.abs(w.normal.x) > 0.999) off = snapToGrid(w.a.x + off * w.normal.x, sc.grid) * w.normal.x - w.a.x * w.normal.x;
    else if (Math.abs(w.normal.y) > 0.999) off = snapToGrid(w.a.y + off * w.normal.y, sc.grid) * w.normal.y - w.a.y * w.normal.y;
  }
  const d = { x: w.normal.x * off, y: w.normal.y * off };
  const r = moveVerticesEdit(
    c.project.room,
    [
      { vertexId: w.a.id, x: w.a.x + d.x, y: w.a.y + d.y },
      { vertexId: w.b.id, x: w.b.x + d.x, y: w.b.y + d.y },
    ],
    projectLengthFormatter(c.project),
  );
  if (r.ok) {
    w.last = r.vertices;
    editorActions.setRoomPreview(r.vertices);
    hudAt(e, [`${off >= 0 ? 'In' : 'Out'} ${fmt().length(Math.abs(off))}`]);
  } else hudAt(e, [r.error], 'error');
}

// ───────────── measurement ends & zone points ─────────────

function pointTargets(c: EntityContext): SnapTargets {
  return buildSnapTargets(c, new Set());
}

function snapFree(e: CanvasPointerEvent, targets: SnapTargets): Point {
  const sc = snapConfig();
  if (!sc.on) {
    editorActions.setGuides([]);
    return e.world;
  }
  const s = snapPoint(e.world, targets, snapThreshold(), sc.toggles);
  editorActions.setGuides(s.guides);
  return s.point;
}

// ───────────── cursor feedback ─────────────

const ROTATE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='%23111' stroke-width='2.2'%3E%3Cpath d='M21 12a9 9 0 1 1-3-6.7L21 8'/%3E%3Cpath d='M21 3v5h-5'/%3E%3C/svg%3E\") 11 11, crosshair";

function resizeCursor(hx: number, hy: number, rotation: number): string {
  const viewRot = useUiStore.getState().viewport.rotation ?? 0;
  const ang = (((angleOf(rotate({ x: hx, y: hy }, rotation + viewRot)) % 180) + 180) % 180) as number;
  if (ang < 22.5 || ang >= 157.5) return 'ew-resize';
  if (ang < 67.5) return 'nwse-resize';
  if (ang < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

function hoverCursor(e: CanvasPointerEvent, api: ToolApi) {
  const c = editorCtx();
  if (!c) return;
  if (e.handle) {
    if (e.handle === 'rotate') return api.setCursor(ROTATE_CURSOR);
    if (e.handle.startsWith('resize:')) {
      const [, hx, hy] = e.handle.split(':');
      const id = useUiStore.getState().selection[0]?.id;
      const o = id ? findObject(c.scenario, id) : undefined;
      const rot = o ? resolveObject(c.project, o).pose.rotation : 0;
      return api.setCursor(resizeCursor(Number(hx), Number(hy), rot));
    }
    return api.setCursor('move');
  }
  const t = e.target;
  if (!t || pickBlocker(c, t)) return api.setCursor('default');
  if (t.kind === 'wall' || t.kind === 'vertex') return api.setCursor('move');
  if (adapter(t.kind)?.locked?.(c, t.id)) return api.setCursor('not-allowed');
  api.setCursor(adapter(t.kind)?.translate ? 'move' : 'pointer');
}

// ───────────── the tool ─────────────

function startHandle(e: CanvasPointerEvent, c: EntityContext): boolean {
  const h = e.handle!;
  const sel = useUiStore.getState().selection;
  if (h === 'rotate') {
    const refs = expandGroups(c.scenario, sel).filter((r) => adapter(r.kind)?.rotate);
    const locked = firstLocked(c, refs);
    if (locked) {
      uiActions.flash(`"${locked}" is locked. Unlock it (L) to rotate it.`, 'warning');
      return true;
    }
    if (refs.length === 0) return true;
    let pivot: Point;
    let single: { rotation: number } | null = null;
    if (refs.length === 1 && refs[0]!.kind === 'object') {
      const r = resolveObject(c.project, findObject(c.scenario, refs[0]!.id)!);
      pivot = { x: r.pose.x, y: r.pose.y };
      single = { rotation: r.pose.rotation };
    } else if (refs.length === 1 && (refs[0]!.kind === 'vehicle' || refs[0]!.kind === 'light')) {
      const ent = (refs[0]!.kind === 'vehicle' ? c.scenario.vehicles : c.scenario.lights).find((x) => x.id === refs[0]!.id)!;
      pivot = { x: ent.x, y: ent.y };
      single = { rotation: ent.rotation };
    } else {
      const b = refsBounds(c, refs)!;
      pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    g = { type: 'rotate', pivot, startAngle: angleOf(sub(e.world, pivot)), refs, single, startScreen: e.screen };
    return true;
  }
  if (h.startsWith('resize:')) {
    const [, hx, hy] = h.split(':');
    const ref = sel[0];
    const o = ref?.kind === 'object' ? findObject(c.scenario, ref.id) : undefined;
    if (!o) return true;
    if (o.locked) {
      uiActions.flash(`"${o.label ?? o.name}" is locked. Unlock it (L) to resize it.`, 'warning');
      return true;
    }
    const working = o.mobility === 'mobile' && o.activePosition === 'working' && !!o.working;
    const pose = working ? o.working! : { x: o.x, y: o.y, rotation: o.rotation };
    g = { type: 'resize', id: o.id, hx: Number(hx), hy: Number(hy), pose, working, w: o.width, d: o.depth, obstacles: floorObstacles(c.project, c.scenario, { kind: 'object', id: o.id }) };
    return true;
  }
  if (h.startsWith('measure:')) {
    const [, id, end] = h.split(':');
    g = { type: 'measure-end', id: id!, end: end as 'a' | 'b' | 'c', targets: pointTargets(c), started: false, startScreen: e.screen };
    return true;
  }
  if (h.startsWith('zone:')) {
    const [, id, idx] = h.split(':');
    const z = c.scenario.zones.find((x) => x.id === id);
    if (z?.locked) {
      uiActions.flash(`"${z.name}" is locked.`, 'warning');
      return true;
    }
    g = { type: 'zone-point', id: id!, index: Number(idx), targets: pointTargets(c), started: false, startScreen: e.screen };
    return true;
  }
  return false;
}

export const selectTool: CanvasTool = {
  id: 'select',
  label: 'Select',
  icon: MousePointer2,
  shortcut: 'v',
  cursor: 'default',
  order: 10,
  onPointerDown(e) {
    if (e.button !== 0) return;
    const c = editorCtx();
    if (!c) return;
    editorActions.clearGesture();
    if (e.handle && startHandle(e, c)) return;
    const t = e.target && !pickBlocker(c, e.target) ? e.target : null;
    if (!t) {
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      const base = additive ? [...useUiStore.getState().selection] : [];
      if (!additive) uiActions.clearSelection();
      g = { type: 'marquee', startScreen: e.screen, startWorld: e.world, additive, base };
      return;
    }
    if (t.kind === 'vertex') {
      if (e.shiftKey) return void uiActions.selectOne('vertex', t.id, true);
      uiActions.select([t]);
      const vs = c.project.room.vertices;
      const i = vs.findIndex((v) => v.id === t.id);
      const n = vs.length;
      g = { type: 'vertex', vertexId: t.id, startScreen: e.screen, started: false, last: null, targets: vertexTargets(c, t.id), prev: vs[(i - 1 + n) % n]!, next: vs[(i + 1) % n]! };
      return;
    }
    if (t.kind === 'wall') {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return void uiActions.selectOne('wall', t.id, true);
      uiActions.select([t]);
      const geo = roomGeometry(c.project.room);
      const i = geo.wallIndex.get(t.id);
      const w = i === undefined ? undefined : geo.walls[i];
      if (!w) return;
      const vs = c.project.room.vertices;
      g = { type: 'wall', wallId: t.id, startScreen: e.screen, startWorld: e.world, started: false, a: vs[i!]!, b: vs[(i! + 1) % vs.length]!, normal: w.inward, last: null };
      return;
    }
    const { refs, wasSelected } = selectOnPointerDown(c, e, t);
    const movable = expandGroups(c.scenario, refs).filter((r) => adapter(r.kind)?.translate && !pickBlocker(c, r));
    const hostedOnly = movable.every((r) => {
      if (r.kind === 'feature') return c.project.architecture.find((f) => f.id === r.id)?.placement.type === 'wall';
      if (r.kind === 'electrical') return c.project.electrical.find((f) => f.id === r.id)?.placement.type === 'wall';
      return false;
    });
    g = {
      type: 'move',
      startScreen: e.screen,
      startWorld: e.world,
      refs: movable,
      clicked: t,
      wasSelected,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
      started: false,
      blocked: firstLocked(c, movable),
      box: null,
      targets: null,
      obstacles: null,
      hostedOnly,
    };
  },

  onPointerMove(e, api) {
    const c = editorCtx();
    if (!c) return;
    if (!g) return hoverCursor(e, api);
    switch (g.type) {
      case 'move': {
        if (!g.started) {
          if (!moved(e.screen, g.startScreen) || g.additive || g.refs.length === 0) return;
          if (g.blocked) {
            uiActions.flash(`"${g.blocked}" is locked. Unlock it (L) to move it.`, 'warning');
            g = null;
            return;
          }
          g.started = true;
          const exclude = new Set(g.refs.map(refKey));
          g.box = refsBounds(c, g.refs);
          g.targets = buildSnapTargets(c, exclude);
          if (g.refs.length === 1 && g.refs[0]!.kind === 'object') g.obstacles = floorObstacles(c.project, c.scenario, g.refs[0]!);
        }
        return updateMove(e, c, g);
      }
      case 'marquee': {
        if (!moved(e.screen, g.startScreen)) return;
        const box = bbox([g.startWorld, e.world]);
        editorActions.setMarquee({ box, mode: e.screen.x >= g.startScreen.x ? 'contain' : 'cross' });
        return;
      }
      case 'rotate':
        return updateRotate(e, c, g);
      case 'resize':
        return updateResize(e, c, g);
      case 'vertex':
        if (!g.started && !moved(e.screen, g.startScreen)) return;
        g.started = true;
        return updateVertex(e, c, g);
      case 'wall':
        if (!g.started && !moved(e.screen, g.startScreen)) return;
        if (!g.started && c.project.layers.architecture?.locked) {
          g = null;
          return uiActions.flash('The Architecture layer is locked. Unlock it in the Layers panel to reshape the room.', 'warning');
        }
        g.started = true;
        return updateWall(e, c, g);
      case 'measure-end': {
        if (!g.started && !moved(e.screen, g.startScreen)) return;
        g.started = true;
        const p = snapFree(e, g.targets);
        editorActions.setPreviews({ [previewKey('measurement', g.id)]: { [g.end]: p } });
        return;
      }
      case 'zone-point': {
        if (!g.started && !moved(e.screen, g.startScreen)) return;
        g.started = true;
        const z = c.scenario.zones.find((x) => x.id === (g as { id: string }).id);
        if (!z) return;
        const p = snapFree(e, g.targets);
        const idx = g.index;
        editorActions.setPreviews({ [previewKey('zone', z.id)]: { points: z.points.map((q, i) => (i === idx ? p : q)) } satisfies Partial<WorkflowZone> });
        return;
      }
    }
  },

  onPointerUp(e) {
    const c = editorCtx();
    const cur = g;
    g = null;
    if (!c || !cur) return editorActions.clearGesture();
    const previews = useEditorStore.getState().previews;
    switch (cur.type) {
      case 'move':
        if (cur.started) commitPatches(cur.refs.length === 1 ? `Move ${adapter(cur.refs[0]!.kind)?.name(c, cur.refs[0]!.id)}` : `Move ${cur.refs.length} items`, previews);
        else if (cur.wasSelected && !cur.additive && useUiStore.getState().selection.length > 1) {
          // Clicking one item of a multi-selection (without dragging) narrows the selection to it (and its group).
          uiActions.select(expandGroups(c.scenario, [cur.clicked]));
        }
        break;
      case 'marquee': {
        const m = useEditorStore.getState().marquee;
        if (m) {
          const hits: EntityRef[] = [];
          for (const ref of allMarqueeCandidates(c, m.box)) {
            const a = adapter(ref.kind)!;
            const o = a.outline(c, ref.id);
            if (!o) continue;
            const boxPoly = [
              { x: m.box.minX, y: m.box.minY },
              { x: m.box.maxX, y: m.box.minY },
              { x: m.box.maxX, y: m.box.maxY },
              { x: m.box.minX, y: m.box.maxY },
            ];
            const contained = polygonContainsPolygon(boxPoly, o);
            const hit = m.mode === 'contain' || a.marquee === 'contain' ? contained : contained || polygonsOverlapOrTouch(boxPoly, o);
            if (hit) hits.push(ref);
          }
          const expanded = expandGroups(c.scenario, hits);
          const keys = new Set(cur.base.map(refKey));
          uiActions.select([...cur.base, ...expanded.filter((r) => !keys.has(refKey(r)))]);
        }
        break;
      }
      case 'rotate':
        commitPatches(cur.refs.length === 1 ? 'Rotate' : `Rotate ${cur.refs.length} items`, previews);
        break;
      case 'resize':
        commitPatches('Resize', previews);
        break;
      case 'vertex':
        if (cur.started && cur.last) {
          const v = cur.last.find((x) => x.id === cur.vertexId)!;
          const r = dispatch({ type: 'room.moveVertex', payload: { vertexId: cur.vertexId, x: v.x, y: v.y } });
          if (!r.ok) uiActions.flash(r.error, 'error');
        }
        break;
      case 'wall':
        if (cur.started && cur.last) {
          const a = cur.last.find((x) => x.id === cur.a.id)!;
          const b = cur.last.find((x) => x.id === cur.b.id)!;
          const r = dispatch({
            type: 'room.moveVertices',
            payload: {
              moves: [
                { vertexId: a.id, x: a.x, y: a.y },
                { vertexId: b.id, x: b.x, y: b.y },
              ],
            },
          });
          if (!r.ok) uiActions.flash(r.error, 'error');
        }
        break;
      case 'measure-end': {
        const patch = previews[previewKey('measurement', cur.id)] as Partial<Measurement> | undefined;
        if (cur.started && patch) {
          const unset = cur.end === 'a' ? ['anchorA'] : cur.end === 'b' ? ['anchorB'] : [];
          const m = c.scenario.measurements.find((x) => x.id === cur.id);
          // Clearance measurements are computed; moving an end turns them into plain point-to-point dimensions.
          const extra = m?.kind === 'clearance' || m?.kind === 'wall-object' || m?.kind === 'object-object' ? { kind: 'point' as const } : {};
          const p = patch[cur.end] as Point;
          dispatch({ type: 'measurement.update', payload: { id: cur.id, patch: { [cur.end]: { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }, ...extra }, unset } });
        }
        break;
      }
      case 'zone-point':
        if (cur.started) commitPatches('Move zone point', previews);
        break;
    }
    editorActions.clearGesture();
    void e;
  },

  onDoubleClick(e) {
    const c = editorCtx();
    if (!c || !e.target) return;
    const t = e.target;
    if (t.kind === 'wall') {
      // Double-click a wall to add a corner there (split it).
      const geo = roomGeometry(c.project.room);
      const i = geo.wallIndex.get(t.id);
      const w = i === undefined ? undefined : geo.walls[i];
      if (!w) return;
      const off = projectOntoWall(e.world, w).offset;
      if (off < 10 || off > w.length - 10) return;
      const vertexId = crypto.randomUUID();
      const r = dispatch({ type: 'room.insertVertex', payload: { wallId: t.id, offset: Math.round(off * 100) / 100, vertexId, newWallId: crypto.randomUUID() } });
      if (r.ok) {
        uiActions.select([{ kind: 'vertex', id: vertexId }]);
        uiActions.flash('Corner added. Drag it to reshape the room; press Delete to remove it.');
      } else uiActions.flash(r.error, 'error');
      return;
    }
    if (t.kind === 'object') {
      // Double-click a grouped object to select just that member.
      uiActions.select([t]);
    }
  },

  onKeyDown(e) {
    if (e.key === 'Escape' && g) {
      cancel();
      return true;
    }
    return false;
  },

  onDeactivate() {
    cancel();
  },
};

/** Candidates for a marquee box (visible, pickable, bounds overlapping the box). */
function allMarqueeCandidates(c: EntityContext, box: BBox): EntityRef[] {
  const out: EntityRef[] = [];
  for (const a of entityAdapters.list()) {
    if (!a.marquee) continue;
    for (const id of a.ids(c)) {
      const ref = { kind: a.kind, id };
      if (a.hidden?.(c, id) || pickBlocker(c, ref)) continue;
      const o = a.outline(c, id);
      if (o && bboxIntersects(bbox(o), box)) out.push(ref);
    }
  }
  return out;
}

/** Screen-space bounds of the current selection (for placing HTML UI next to it). */
export function selectionScreenBounds(): BBox | null {
  const c = editorCtx();
  if (!c) return null;
  const b = refsBounds(c, useUiStore.getState().selection);
  if (!b) return null;
  const v = useUiStore.getState().viewport;
  return bbox([toScreen(v, { x: b.minX, y: b.minY }), toScreen(v, { x: b.maxX, y: b.maxY }), toScreen(v, { x: b.minX, y: b.maxY }), toScreen(v, { x: b.maxX, y: b.minY })]);
}

