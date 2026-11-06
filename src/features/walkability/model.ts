/**
 * Walkability model (pure): which shapes block walking, where people enter, the occupancy-grid
 * analysis for a chosen aisle width and "main path" reports from each entry to the places people
 * work ("Main path from garage entry to workbench narrows to 19" beside the cabinet").
 *
 * Shared by the walkway analyzer, the scorecard metrics, Ask the Layout and the optimizer. Every
 * expensive result is memoized on the AnalysisContext (one grid per context and aisle width).
 */
import { z } from 'zod';
import type { AnalysisContext } from '@/analysis';
import { defineExtension } from '@/domain/extensions';
import { inches } from '@/domain/units';
import type { EntityRef } from '@/domain/schema';
import {
  analyzeWalkability,
  CELL_BLOCKED,
  cellCenter,
  distance,
  localToWorld,
  nearestPassableCell,
  nearestWall,
  pointOnWall,
  type Point,
  type Polygon,
  type WalkabilityResult,
} from '@/geometry';

/** Aisle widths offered in the UI (mm): 24", 30", 36", 42". */
export const AISLE_WIDTHS = [inches(24), inches(30), inches(36), inches(42)] as const;
export const DEFAULT_AISLE = inches(30);
/** Grid resolution used everywhere (mm). ≈ 2"; accuracy of reported widths is about ± one cell. */
export const WALK_CELL = 50;

/** Per-project walkability preferences (not undoable; see the extension.set `history` flag). */
export const walkPrefs = defineExtension(
  'walkability.prefs',
  z.object({ aisleWidth: z.number().positive() }),
  { aisleWidth: DEFAULT_AISLE },
);

/** Items hanging at or above this height (mm) do not block walking (wall cabinets, racks). */
export const WALK_BLOCK_BELOW = 900;

export interface WalkObstacle {
  ref: EntityRef;
  name: string;
  polygon: Polygon;
}

/** Floor-level shapes that block walking: floor objects, fixed floor features and vehicles. */
export function walkObstacles(ctx: AnalysisContext): WalkObstacle[] {
  return ctx.memo('walk:obstacles', () => [
    ...ctx.objects
      .filter((o) => o.resolved.elevation < WALK_BLOCK_BELOW)
      .map((o) => ({ ref: { kind: 'object', id: o.id } as EntityRef, name: o.name, polygon: o.footprint })),
    ...ctx.features.filter((f) => f.blocksFloor).map((f) => ({ ref: { kind: 'feature', id: f.id } as EntityRef, name: f.name, polygon: f.footprint })),
    ...ctx.vehicles.map((v) => ({ ref: { kind: 'vehicle', id: v.id } as EntityRef, name: v.name, polygon: v.body })),
  ]);
}

export interface WalkEntry {
  id: string;
  /** "garage entry", "Entry door" … */
  label: string;
  point: Point;
}

/** Places people walk in: a point just inside every door and garage door. */
export function walkEntries(ctx: AnalysisContext): WalkEntry[] {
  return ctx.memo('walk:entries', () => {
    const out: WalkEntry[] = [];
    for (const f of ctx.features) {
      const k = f.feature.kind;
      if (k !== 'door' && k !== 'double-door' && k !== 'garage-door') continue;
      if (f.feature.placement.type !== 'wall') continue;
      const wi = ctx.room.wallIndex.get(f.feature.placement.wallId);
      const wall = wi === undefined ? undefined : ctx.room.walls[wi];
      if (!wall) continue;
      out.push({
        id: f.id,
        label: k === 'garage-door' ? 'garage entry' : f.name,
        point: pointOnWall(wall, f.feature.placement.offset, 300),
      });
    }
    return out;
  });
}

/** The walkability grid for an aisle width (memoized per context). */
export function walkability(ctx: AnalysisContext, aisleWidth: number): WalkabilityResult | null {
  if (!ctx.hasRoom) return null;
  return ctx.memo(`walk:grid:${Math.round(aisleWidth)}`, () =>
    analyzeWalkability(
      ctx.room.polygon,
      walkObstacles(ctx).map((o) => o.polygon),
      { aisleWidth, cellSize: WALK_CELL, entries: walkEntries(ctx).map((e) => e.point), minDeadEndLength: 900 },
    ),
  );
}

export interface Destination {
  ref: EntityRef;
  name: string;
  /** Where a person stands to use it (in front of its front face). */
  point: Point;
}

const DESTINATION_CATEGORIES = new Set(['work-surface', 'stationary-tool', 'storage']);

/** Floor items people walk to: work surfaces, stationary tools and floor storage, at their use position. */
export function destinations(ctx: AnalysisContext): Destination[] {
  return ctx.memo('walk:destinations', () =>
    ctx.objects
      .filter((o) => DESTINATION_CATEGORIES.has(o.resolved.category) && !o.resolved.elevated && o.resolved.elevation < WALK_BLOCK_BELOW)
      .map((o) => {
        const fp = o.resolved.footprint;
        const pose = o.zonePose;
        return {
          ref: { kind: 'object', id: o.id } as EntityRef,
          name: o.name,
          point: localToWorld(pose, { x: fp.offsetX ?? 0, y: (fp.offsetY ?? 0) + fp.depth / 2 + 300 }),
        };
      }),
  );
}

/** "the tool cart", keeping proper-noun style names ("the WRX"). */
export function theName(name: string): string {
  const n = name.trim();
  if (!n) return 'an obstacle';
  const lower = n.length > 1 && n[1] === n[1]!.toLowerCase() ? n[0]!.toLowerCase() + n.slice(1) : n;
  return `the ${lower}`;
}

export interface PathReport {
  entry: WalkEntry;
  destination: Destination;
  /** Narrowest width along the widest route (mm); Infinity when nothing constrains it. */
  width: number;
  point: Point;
  /** What bounds the narrow point (object/feature/vehicle), or a wall. */
  beside: { ref?: EntityRef; name: string };
  route: Point[];
  routeLength: number;
  /** True when no route of at least ~6" exists. */
  blocked: boolean;
}

/** Narrowest point on the main route from every entry to every destination. */
export function pathReports(ctx: AnalysisContext, aisleWidth: number): PathReport[] {
  return ctx.memo(`walk:paths:${Math.round(aisleWidth)}`, () => {
    const walk = walkability(ctx, aisleWidth);
    if (!walk) return [];
    const obstacles = walkObstacles(ctx);
    const out: PathReport[] = [];
    const entries = walkEntries(ctx);
    for (const dest of destinations(ctx)) {
      const destIndex = obstacles.findIndex((o) => o.ref.id === dest.ref.id);
      const use = entries.filter((e) => distance(e.point, dest.point) >= 900);
      const pinches = pinchesToEntries(walk, dest.point, use.map((e) => e.point), destIndex, 600, 150, aisleWidth);
      use.forEach((entry, k) => {
        const r = pinches[k];
        if (!r) {
          out.push({ entry, destination: dest, width: 0, point: dest.point, beside: { name: 'the layout' }, route: [], routeLength: 0, blocked: true });
          return;
        }
        const owner = r.nearestObstacle >= 0 ? obstacles[r.nearestObstacle] : undefined;
        let beside: PathReport['beside'];
        if (owner) beside = { ref: owner.ref, name: theName(owner.name) };
        else {
          const w = nearestWall([r.point], ctx.room.walls);
          beside = { name: w ? `the ${w.wallName}` : 'a wall' };
        }
        out.push({ entry, destination: dest, width: r.width, point: r.point, beside, route: r.route, routeLength: r.routeLength, blocked: false });
      });
    }
    // Stable order: by entry, then destination (as before).
    out.sort((x, y) => entries.indexOf(x.entry) - entries.indexOf(y.entry));
    return out;
  });
}

/** Minimal binary min-heap of (cell, key). */
class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(val: number, key: number): void {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p]! <= this.k[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { val: number; key: number } {
    const top = { val: this.v[0]!, key: this.k[0]! };
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l]! < this.k[m]!) m = l;
        if (r < this.k.length && this.k[r]! < this.k[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.v[a], this.v[b]] = [this.v[b]!, this.v[a]!];
  }
}

export interface Pinch {
  width: number;
  point: Point;
  /** Obstacle index bounding the pinch (not the destination itself), −1 for a wall. */
  nearestObstacle: number;
  route: Point[];
  routeLength: number;
}

/**
 * Narrowest point on the best route between two points (see `pinchesToEntries`).
 */
export function pinchAlongRoute(walk: WalkabilityResult, from: Point, to: Point, exclude = -1, ignoreEnds = 600, minPassage = 150): Pinch | null {
  return pinchesToEntries(walk, to, [from], exclude, ignoreEnds, minPassage)[0] ?? null;
}

/**
 * For one destination and several entries: the widest possible route from each entry (maximin
 * path: the route whose narrowest point is as wide as it can be) and where that narrowest point
 * is. One maximin search from the destination serves every entry. Cells within `ignoreEnds` of the
 * destination or any entry are not counted (endpoints naturally sit next to things); passages
 * narrower than `minPassage` are impassable. `exclude` = obstacle index never blamed (the
 * destination itself). Routes are returned entry → destination.
 */
export function pinchesToEntries(
  walk: WalkabilityResult,
  to: Point,
  entries: readonly Point[],
  exclude = -1,
  ignoreEnds = 600,
  minPassage = 150,
  /** Only locate pinches narrower than this (others get width only, no route). */
  locateBelow = Infinity,
): Array<Pinch | null> {
  const { grid, clearance, nearestSite } = walk;
  const passable = (i: number) => clearance[i]! >= minPassage / 2;
  const b = nearestPassableCell(grid, to, passable);
  const starts = entries.map((e) => nearestPassableCell(grid, e, passable));
  if (b < 0) return entries.map(() => null);
  const ends = [cellCenter(grid, b), ...starts.filter((s) => s >= 0).map((s) => cellCenter(grid, s))];
  const n = grid.cells.length;
  const cols = grid.cols;
  const vals = new Float64Array(n);
  const ie2 = ignoreEnds * ignoreEnds;
  for (let i = 0; i < n; i++) {
    const c = clearance[i]!;
    if (c < minPassage / 2) continue;
    const col = i % cols;
    const row = (i - col) / cols;
    const x = grid.originX + (col + 0.5) * grid.cellSize;
    const y = grid.originY + (row + 0.5) * grid.cellSize;
    let near = false;
    for (const e of ends) if ((x - e.x) ** 2 + (y - e.y) ** 2 < ie2) near = true;
    vals[i] = near ? 1e9 : c;
  }
  // Maximin search from the destination (max-heap on the bottleneck so far).
  const best = new Float64Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  best[b] = vals[b]!;
  heap.push(b, -best[b]!);
  let remaining = new Set(starts.filter((s) => s >= 0)).size;
  const targets = new Set(starts.filter((s) => s >= 0));
  while (heap.size && remaining > 0) {
    const { val: cur, key } = heap.pop();
    if (done[cur] || -key < best[cur]!) continue;
    done[cur] = 1;
    if (targets.has(cur)) remaining--;
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= grid.rows) continue;
        const ni = nr * cols + nc;
        if (done[ni] || vals[ni]! <= 0) continue;
        let bn = Math.min(best[cur]!, vals[ni]!);
        if (dc && dr) {
          const o1 = vals[r * cols + nc]!;
          const o2 = vals[nr * cols + c]!;
          if (o1 <= 0 || o2 <= 0) continue;
          bn = Math.min(bn, o1, o2);
        }
        if (bn > best[ni]!) {
          best[ni] = bn;
          heap.push(ni, -bn);
        }
      }
    }
  }
  // The maximin tree gives each entry's bottleneck, but its paths may hug obstacles anywhere once
  // past the pinch. A second, centered search (cost grows as clearance shrinks) restricted to cells
  // at least as wide as the bottleneck finds a route whose narrowest point is the real pinch.
  const groups = new Map<number, number[]>();
  starts.forEach((a, k) => {
    if (a < 0 || best[a]! < 0) return;
    const key = best[a]!;
    groups.set(key, [...(groups.get(key) ?? []), k]);
  });
  const out: Array<Pinch | null> = entries.map(() => null);
  const R = 600;
  for (const [bottleneck, ks] of groups) {
    if (bottleneck >= 1e9 || 2 * bottleneck >= locateBelow) {
      for (const k of ks) out[k] = { width: bottleneck >= 1e9 ? Infinity : 2 * bottleneck, point: cellCenter(grid, b), nearestObstacle: -1, route: [], routeLength: 0 };
      continue;
    }
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const h = new MinHeap();
    dist[b] = 0;
    h.push(b, 0);
    const want = new Set(ks.map((k) => starts[k]!));
    let left = want.size;
    const ok = (i: number) => vals[i]! >= bottleneck - 1e-6;
    // A* toward the nearest remaining entry (every step costs at least its length, so admissible).
    const tgt = [...want].map((i) => ({ c: i % cols, r: Math.floor(i / cols) }));
    const heur = (i: number) => {
      const c = i % cols;
      const r = (i - c) / cols;
      let m = Infinity;
      for (const t of tgt) m = Math.min(m, Math.hypot(t.c - c, t.r - r));
      return m;
    };
    const closed = new Uint8Array(n);
    h.pop();
    h.push(b, heur(b));
    while (h.size && left > 0) {
      const { val: cur } = h.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const key = dist[cur]!;
      if (want.has(cur)) {
        want.delete(cur);
        left--;
      }
      const c = cur % cols;
      const r = (cur - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= grid.rows) continue;
          const ni = nr * cols + nc;
          if (!ok(ni)) continue;
          if (dc && dr && (!ok(r * cols + nc) || !ok(nr * cols + c))) continue;
          if (closed[ni]) continue;
          const cl = Math.max(1, clearance[ni]!);
          const nd = key + (dc && dr ? Math.SQRT2 : 1) * (1 + R / cl);
          if (nd < dist[ni]!) {
            dist[ni] = nd;
            prev[ni] = cur;
            h.push(ni, nd + heur(ni));
          }
        }
      }
    }
    for (const k of ks) {
      const a = starts[k]!;
      if (!Number.isFinite(dist[a]!)) continue;
      const cells: number[] = [];
      for (let i = a; i !== -1; i = prev[i]!) {
        cells.push(i);
        if (i === b) break;
      }
      let worst = cells[0]!;
      for (const c of cells) if (vals[c]! < vals[worst]!) worst = c;
      const points = cells.map((i) => cellCenter(grid, i));
      let routeLength = 0;
      for (let i = 1; i < points.length; i++) routeLength += distance(points[i - 1]!, points[i]!);
      const width = vals[worst]! >= 1e9 ? Infinity : 2 * clearance[worst]!;
      out[k] = { width, point: cellCenter(grid, worst), nearestObstacle: blame(walk, worst, exclude, nearestSite), route: points, routeLength };
    }
  }
  return out;
}

/** Obstacle nearest to a cell, skipping `exclude`; −1 when only walls are close. */
function blame(walk: WalkabilityResult, cell: number, exclude: number, nearestSite: Int32Array): number {
  const { grid, clearance } = walk;
  const site = nearestSite[cell] ?? -1;
  if (site >= 0 && grid.cells[site] === CELL_BLOCKED && grid.owner[site] !== exclude) return grid.owner[site]!;
  const radius = (clearance[cell] ?? 0) + 3 * grid.cellSize;
  const c0 = cell % grid.cols;
  const r0 = Math.floor(cell / grid.cols);
  const rc = Math.ceil(radius / grid.cellSize);
  let best = -1;
  let bestD = Infinity;
  for (let dr = -rc; dr <= rc; dr++) {
    for (let dc = -rc; dc <= rc; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const i = r * grid.cols + c;
      if (grid.cells[i] !== CELL_BLOCKED || grid.owner[i] === exclude) continue;
      const d = dr * dr + dc * dc;
      if (d < bestD && Math.sqrt(d) * grid.cellSize <= radius) {
        bestD = d;
        best = grid.owner[i]!;
      }
    }
  }
  return best;
}

/** The single narrowest main path (what "walking-path minimum width" reports). */
export function narrowestPath(ctx: AnalysisContext, aisleWidth: number): PathReport | null {
  return ctx.memo(`walk:narrowest:${Math.round(aisleWidth)}`, () => {
    const reports = pathReports(ctx, aisleWidth).filter((r) => !r.blocked && Number.isFinite(r.width));
    if (reports.length === 0) return null;
    const n = reports.reduce((a, b) => (b.width < a.width ? b : a));
    if (n.route.length) return n;
    // Wide enough everywhere: locate this one's pinch now (skipped in the bulk pass for speed).
    const walk = walkability(ctx, aisleWidth)!;
    const obstacles = walkObstacles(ctx);
    const r = pinchAlongRoute(walk, n.entry.point, n.destination.point, obstacles.findIndex((o) => o.ref.id === n.destination.ref.id));
    if (!r) return n;
    const owner = r.nearestObstacle >= 0 ? obstacles[r.nearestObstacle] : undefined;
    const w = owner ? null : nearestWall([r.point], ctx.room.walls);
    return { ...n, width: r.width, point: r.point, route: r.route, routeLength: r.routeLength, beside: owner ? { ref: owner.ref, name: theName(owner.name) } : { name: w ? `the ${w.wallName}` : 'a wall' } };
  });
}

/** Aisle width stored for the project (falls back to 30"). */
export function aisleWidthOf(ctx: AnalysisContext): number {
  return walkPrefs.read(ctx.project).aisleWidth;
}
