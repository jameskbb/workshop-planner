/**
 * Snapping engine (pure). Produces a snapped position plus Figma-style guide lines explaining
 * WHY it snapped. The editor passes a world-space threshold (e.g. 8 px / zoom).
 */
import { bboxCenter, type BBox } from './polygon';
import { projectOntoWall, rotationFacingAwayFromWall, type WallGeom } from './walls';
import { add, angleDiff, distance, dot, scale, sub, type Point } from './vec';
import { closestPointOnSegment } from './segment';
import { rotatedExtents, type OBB } from './obb';

export type SnapSource = 'grid' | 'wall' | 'corner' | 'wall-center' | 'object-edge' | 'object-center' | 'angle';

export interface Guide {
  /** Vertical guides are x = const lines, horizontal are y = const; segment is arbitrary. */
  kind: 'vertical' | 'horizontal' | 'segment' | 'point';
  from: Point;
  to: Point;
  source: SnapSource;
  /** Id of the object/wall the guide refers to, when applicable. */
  targetId?: string;
  label?: string;
}

export interface SnapTargetObject {
  id: string;
  bbox: BBox;
}

export interface SnapTargets {
  /** Grid spacing in mm (0/undefined disables grid snapping). */
  gridSize?: number;
  walls?: WallGeom[];
  /** Room corners (typically the room polygon's vertices). */
  corners?: Point[];
  /** Other objects (axis-aligned bounds in world space). The moving object must be excluded by the caller. */
  objects?: SnapTargetObject[];
}

export interface SnapToggles {
  grid: boolean;
  walls: boolean;
  corners: boolean;
  wallCenters: boolean;
  objectEdges: boolean;
  objectCenters: boolean;
}

export const ALL_SNAPS: SnapToggles = {
  grid: true,
  walls: true,
  corners: true,
  wallCenters: true,
  objectEdges: true,
  objectCenters: true,
};

export interface SnapPointResult {
  point: Point;
  snapped: boolean;
  guides: Guide[];
  source?: SnapSource;
}

export const snapToGrid = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);

/**
 * Snap a single point (e.g. a wall-drawing vertex or measurement endpoint).
 * Priority: corners > wall centers > wall lines > object centers/edges (axis) > grid.
 */
export function snapPoint(
  p: Point,
  targets: SnapTargets,
  threshold: number,
  toggles: SnapToggles = ALL_SNAPS,
): SnapPointResult {
  if (toggles.corners && targets.corners) {
    let best: Point | null = null;
    let bd = threshold;
    for (const c of targets.corners) {
      const d = distance(p, c);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    if (best) return { point: { ...best }, snapped: true, source: 'corner', guides: [{ kind: 'point', from: best, to: best, source: 'corner' }] };
  }
  if (toggles.wallCenters && targets.walls) {
    for (const w of targets.walls) {
      const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      if (distance(p, m) <= threshold)
        return {
          point: m,
          snapped: true,
          source: 'wall-center',
          guides: [{ kind: 'point', from: m, to: m, source: 'wall-center', targetId: String(w.index), label: w.name }],
        };
    }
  }
  if (toggles.walls && targets.walls) {
    let best: { point: Point; w: WallGeom } | null = null;
    let bd = threshold;
    for (const w of targets.walls) {
      const c = closestPointOnSegment(p, w.a, w.b);
      if (c.distance <= bd) {
        bd = c.distance;
        best = { point: c.point, w };
      }
    }
    if (best)
      return {
        point: best.point,
        snapped: true,
        source: 'wall',
        guides: [{ kind: 'segment', from: best.w.a, to: best.w.b, source: 'wall', targetId: String(best.w.index), label: best.w.name }],
      };
  }
  // Axis alignment with object edges/centers, then grid, per axis.
  let x = p.x;
  let y = p.y;
  const guides: Guide[] = [];
  let snapped = false;
  let source: SnapSource | undefined;
  const xs: Array<{ v: number; src: SnapSource; id: string; b: BBox }> = [];
  const ys: Array<{ v: number; src: SnapSource; id: string; b: BBox }> = [];
  for (const o of targets.objects ?? []) {
    const c = bboxCenter(o.bbox);
    if (toggles.objectEdges) {
      xs.push({ v: o.bbox.minX, src: 'object-edge', id: o.id, b: o.bbox }, { v: o.bbox.maxX, src: 'object-edge', id: o.id, b: o.bbox });
      ys.push({ v: o.bbox.minY, src: 'object-edge', id: o.id, b: o.bbox }, { v: o.bbox.maxY, src: 'object-edge', id: o.id, b: o.bbox });
    }
    if (toggles.objectCenters) {
      xs.push({ v: c.x, src: 'object-center', id: o.id, b: o.bbox });
      ys.push({ v: c.y, src: 'object-center', id: o.id, b: o.bbox });
    }
  }
  const bestOf = (arr: typeof xs, v: number) => {
    let best: (typeof xs)[number] | null = null;
    let bd = threshold;
    for (const c of arr) {
      const d = Math.abs(c.v - v);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  const bx = bestOf(xs, p.x);
  if (bx) {
    x = bx.v;
    snapped = true;
    source = bx.src;
    guides.push({ kind: 'vertical', from: { x, y: Math.min(p.y, bx.b.minY) }, to: { x, y: Math.max(p.y, bx.b.maxY) }, source: bx.src, targetId: bx.id });
  } else if (toggles.grid && targets.gridSize) {
    const gx = snapToGrid(p.x, targets.gridSize);
    if (Math.abs(gx - p.x) <= threshold) {
      x = gx;
      snapped = true;
      source = source ?? 'grid';
    }
  }
  const by = bestOf(ys, p.y);
  if (by) {
    y = by.v;
    snapped = true;
    source = source ?? by.src;
    guides.push({ kind: 'horizontal', from: { x: Math.min(p.x, by.b.minX), y }, to: { x: Math.max(p.x, by.b.maxX), y }, source: by.src, targetId: by.id });
  } else if (toggles.grid && targets.gridSize) {
    const gy = snapToGrid(p.y, targets.gridSize);
    if (Math.abs(gy - p.y) <= threshold) {
      y = gy;
      snapped = true;
      source = source ?? 'grid';
    }
  }
  return { point: { x, y }, snapped, guides, source };
}

export interface SnapBoxResult {
  /** Adjusted translation to apply to the moving box's proposed position. */
  dx: number;
  dy: number;
  snappedX: boolean;
  snappedY: boolean;
  guides: Guide[];
}

/**
 * Figma-style box snapping. `moving` is the axis-aligned bounds of the dragged selection at its
 * PROPOSED position. Tries to align its left/center/right (and top/middle/bottom) with other objects'
 * edges/centers, axis-aligned wall lines and room corners; falls back to the grid (top-left corner).
 * Returns the correction to add to the proposed position.
 */
export function snapBox(moving: BBox, targets: SnapTargets, threshold: number, toggles: SnapToggles = ALL_SNAPS): SnapBoxResult {
  const mc = bboxCenter(moving);
  const movingX = [
    { v: moving.minX, role: 'edge' as const },
    { v: mc.x, role: 'center' as const },
    { v: moving.maxX, role: 'edge' as const },
  ];
  const movingY = [
    { v: moving.minY, role: 'edge' as const },
    { v: mc.y, role: 'center' as const },
    { v: moving.maxY, role: 'edge' as const },
  ];
  interface Cand {
    v: number;
    src: SnapSource;
    id?: string;
    span: [number, number];
    role: 'edge' | 'center';
  }
  const tx: Cand[] = [];
  const ty: Cand[] = [];
  for (const o of targets.objects ?? []) {
    const c = bboxCenter(o.bbox);
    if (toggles.objectEdges) {
      tx.push({ v: o.bbox.minX, src: 'object-edge', id: o.id, span: [o.bbox.minY, o.bbox.maxY], role: 'edge' });
      tx.push({ v: o.bbox.maxX, src: 'object-edge', id: o.id, span: [o.bbox.minY, o.bbox.maxY], role: 'edge' });
      ty.push({ v: o.bbox.minY, src: 'object-edge', id: o.id, span: [o.bbox.minX, o.bbox.maxX], role: 'edge' });
      ty.push({ v: o.bbox.maxY, src: 'object-edge', id: o.id, span: [o.bbox.minX, o.bbox.maxX], role: 'edge' });
    }
    if (toggles.objectCenters) {
      tx.push({ v: c.x, src: 'object-center', id: o.id, span: [o.bbox.minY, o.bbox.maxY], role: 'center' });
      ty.push({ v: c.y, src: 'object-center', id: o.id, span: [o.bbox.minX, o.bbox.maxX], role: 'center' });
    }
  }
  if (toggles.walls) {
    for (const w of targets.walls ?? []) {
      if (Math.abs(w.a.x - w.b.x) < 1e-6)
        tx.push({ v: w.a.x, src: 'wall', id: String(w.index), span: [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)], role: 'edge' });
      if (Math.abs(w.a.y - w.b.y) < 1e-6)
        ty.push({ v: w.a.y, src: 'wall', id: String(w.index), span: [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)], role: 'edge' });
    }
  }
  if (toggles.wallCenters) {
    for (const w of targets.walls ?? []) {
      const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      // A wall center aligns with the box center along the wall's direction.
      if (Math.abs(w.a.y - w.b.y) < 1e-6) tx.push({ v: m.x, src: 'wall-center', id: String(w.index), span: [m.y, m.y], role: 'center' });
      if (Math.abs(w.a.x - w.b.x) < 1e-6) ty.push({ v: m.y, src: 'wall-center', id: String(w.index), span: [m.x, m.x], role: 'center' });
    }
  }
  if (toggles.corners) {
    for (const c of targets.corners ?? []) {
      tx.push({ v: c.x, src: 'corner', span: [c.y, c.y], role: 'edge' });
      ty.push({ v: c.y, src: 'corner', span: [c.x, c.x], role: 'edge' });
    }
  }

  const pick = (movingVals: typeof movingX, cands: Cand[]) => {
    let best: { delta: number; cand: Cand } | null = null;
    for (const m of movingVals) {
      for (const c of cands) {
        // Centers only align with centers; edges align with edges (and wall centers with box center).
        if (m.role !== c.role) continue;
        const d = c.v - m.v;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, cand: c };
      }
    }
    return best;
  };
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  let snappedX = false;
  let snappedY = false;
  const bx = pick(movingX, tx);
  if (bx) {
    dx = bx.delta;
    snappedX = true;
  } else if (toggles.grid && targets.gridSize) {
    const g = snapToGrid(moving.minX, targets.gridSize) - moving.minX;
    if (Math.abs(g) <= threshold) {
      dx = g;
      snappedX = true;
    }
  }
  const by = pick(movingY, ty);
  if (by) {
    dy = by.delta;
    snappedY = true;
  } else if (toggles.grid && targets.gridSize) {
    const g = snapToGrid(moving.minY, targets.gridSize) - moving.minY;
    if (Math.abs(g) <= threshold) {
      dy = g;
      snappedY = true;
    }
  }
  if (bx) {
    const x = bx.cand.v;
    const y0 = Math.min(moving.minY + dy, bx.cand.span[0]);
    const y1 = Math.max(moving.maxY + dy, bx.cand.span[1]);
    guides.push({ kind: 'vertical', from: { x, y: y0 }, to: { x, y: y1 }, source: bx.cand.src, targetId: bx.cand.id });
  }
  if (by) {
    const y = by.cand.v;
    const x0 = Math.min(moving.minX + dx, by.cand.span[0]);
    const x1 = Math.max(moving.maxX + dx, by.cand.span[1]);
    guides.push({ kind: 'horizontal', from: { x: x0, y }, to: { x: x1, y }, source: by.cand.src, targetId: by.cand.id });
  }
  return { dx, dy, snappedX, snappedY, guides };
}

export interface WallSnapResult {
  pose: { x: number; y: number; rotation: number };
  wallIndex: number;
  guide: Guide;
  /** True if the rotation was changed to sit square to the wall. */
  rotated: boolean;
}

/**
 * Snap an object so its BACK sits flush against the nearest wall (works for angled walls).
 * The object is snapped when its back edge is within `threshold` of a wall's interior face and its
 * rotation is within `angleTolerance` of facing away from that wall.
 */
export function snapObjectToWall(
  obb: OBB,
  walls: WallGeom[],
  threshold: number,
  angleTolerance = 10,
): WallSnapResult | null {
  let best: WallSnapResult | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const facing = rotationFacingAwayFromWall(w);
    const delta = angleDiff(obb.rotation, facing);
    // Accept the object facing away from the wall (back to wall) or sideways to it.
    const candidates = [0, 90, -90, 180].map((k) => ({ k, off: angleDiff(delta, k) }));
    const c = candidates.find((cc) => Math.abs(cc.off) <= angleTolerance);
    if (!c) continue;
    const rotation = normalize360(facing + c.k);
    // Half-extent of the object perpendicular to the wall at the snapped rotation.
    const half = c.k === 0 || c.k === 180 ? obb.depth / 2 : obb.width / 2;
    const proj = projectOntoWall({ x: obb.x, y: obb.y }, w);
    if (proj.offset < -half || proj.offset > w.length + half) continue;
    const gap = proj.inset - half;
    const d = Math.abs(gap);
    if (d <= threshold && d < bestD) {
      bestD = d;
      const center = add(proj.foot, scale(w.inward, half));
      best = {
        pose: { x: center.x, y: center.y, rotation },
        wallIndex: w.index,
        rotated: Math.abs(angleDiff(obb.rotation, rotation)) > 1e-9,
        guide: { kind: 'segment', from: w.a, to: w.b, source: 'wall', targetId: String(w.index), label: w.name },
      };
    }
  }
  return best;
}

function normalize360(d: number): number {
  const r = ((d % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : Math.round(r * 1e9) / 1e9;
}

/** Snap an angle to the nearest multiple of `step` degrees if within `tolerance` (default: always). */
export function snapAngle(deg: number, step: number, tolerance = Infinity): number {
  if (step <= 0) return deg;
  const s = Math.round(deg / step) * step;
  return Math.abs(s - deg) <= tolerance ? normalize360(s) : deg;
}

/** World axis-aligned bounds of an OBB (fast path for snapping). */
export function obbAabb(o: OBB): BBox {
  const e = rotatedExtents(o.width, o.depth, o.rotation);
  return { minX: o.x - e.width / 2, minY: o.y - e.depth / 2, maxX: o.x + e.width / 2, maxY: o.y + e.depth / 2 };
}

/** Signed distance from a point to a wall line along its inward normal (positive = inside). */
export const insetFromWall = (p: Point, w: WallGeom): number => dot(sub(p, w.a), w.inward);
