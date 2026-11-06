/**
 * Occupancy grid + exact Euclidean distance transform, used for walkability, path width,
 * reachability, dead ends and walking distances. Pure and allocation-light (typed arrays).
 */
import { bbox, type Polygon } from './polygon';
import type { Point } from './vec';

export const CELL_FREE = 0;
export const CELL_BLOCKED = 1;
export const CELL_OUTSIDE = 2;

export interface OccupancyGrid {
  originX: number;
  originY: number;
  cellSize: number;
  cols: number;
  rows: number;
  /** CELL_FREE / CELL_BLOCKED / CELL_OUTSIDE per cell (row-major). */
  cells: Uint8Array;
  /** Index of the obstacle occupying a blocked cell, or -1 (walls/outside/free). */
  owner: Int32Array;
}

export const cellIndex = (g: OccupancyGrid, col: number, row: number): number => row * g.cols + col;

export function cellCenter(g: OccupancyGrid, idx: number): Point {
  const row = Math.floor(idx / g.cols);
  const col = idx - row * g.cols;
  return { x: g.originX + (col + 0.5) * g.cellSize, y: g.originY + (row + 0.5) * g.cellSize };
}

/** Cell index containing p, or -1 if outside the grid. */
export function cellAt(g: OccupancyGrid, p: Point): number {
  const col = Math.floor((p.x - g.originX) / g.cellSize);
  const row = Math.floor((p.y - g.originY) / g.cellSize);
  if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) return -1;
  return row * g.cols + col;
}

/** Scanline-fill the cells whose CENTERS lie inside the polygon. */
function forEachCellInPolygon(g: OccupancyGrid, poly: Polygon, fn: (idx: number) => void): void {
  if (poly.length < 3) return;
  const b = bbox(poly);
  const r0 = Math.max(0, Math.floor((b.minY - g.originY) / g.cellSize));
  const r1 = Math.min(g.rows - 1, Math.ceil((b.maxY - g.originY) / g.cellSize));
  const xs: number[] = [];
  for (let row = r0; row <= r1; row++) {
    const y = g.originY + (row + 0.5) * g.cellSize;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const c = poly[j]!;
      if (a.y > y !== c.y > y) xs.push(a.x + ((y - a.y) * (c.x - a.x)) / (c.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k]! - g.originX) / g.cellSize - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor((xs[k + 1]! - g.originX) / g.cellSize - 0.5));
      for (let col = c0; col <= c1; col++) fn(row * g.cols + col);
    }
  }
}

/**
 * Rasterize a room and its obstacles. The grid gets a one-cell OUTSIDE margin so walls act as
 * obstacles for the distance transform. Obstacles are indexed so blocked cells know their owner.
 */
export function buildOccupancyGrid(room: Polygon, obstacles: readonly Polygon[], cellSize = 50): OccupancyGrid {
  const b = bbox(room);
  const originX = b.minX - cellSize;
  const originY = b.minY - cellSize;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cellSize) + 2);
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cellSize) + 2);
  const g: OccupancyGrid = {
    originX,
    originY,
    cellSize,
    cols,
    rows,
    cells: new Uint8Array(cols * rows).fill(CELL_OUTSIDE),
    owner: new Int32Array(cols * rows).fill(-1),
  };
  forEachCellInPolygon(g, room, (i) => (g.cells[i] = CELL_FREE));
  obstacles.forEach((poly, oi) => {
    forEachCellInPolygon(g, poly, (i) => {
      if (g.cells[i] === CELL_FREE) {
        g.cells[i] = CELL_BLOCKED;
        g.owner[i] = oi;
      }
    });
  });
  return g;
}

const INF = 1e20;

/** 1D squared distance transform (Felzenszwalb & Huttenlocher) with argmin tracking. */
function dt1d(f: Float64Array, n: number, d: Float64Array, arg: Int32Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    if (f[q]! >= INF) continue;
    if (f[v[0]!]! >= INF) {
      v[0] = q;
      continue;
    }
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  if (f[v[0]!]! >= INF) {
    for (let q = 0; q < n; q++) {
      d[q] = INF;
      arg[q] = -1;
    }
    return;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!]!;
    arg[q] = v[k]!;
  }
}

export interface DistanceField {
  /** Squared distance in CELLS from each cell center to the nearest site cell center. */
  dist2: Float64Array;
  /** Index of the nearest site cell. */
  nearest: Int32Array;
}

/** Exact Euclidean distance transform where `isSite(idx)` marks the zero set. */
export function distanceTransform(g: OccupancyGrid, isSite: (idx: number) => boolean): DistanceField {
  const { cols, rows } = g;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const arg = new Int32Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const colD = new Float64Array(cols * rows);
  const colArgRow = new Int32Array(cols * rows);
  // Pass 1: columns.
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) f[r] = isSite(r * cols + c) ? 0 : INF;
    dt1d(f, rows, d, arg, v, z);
    for (let r = 0; r < rows; r++) {
      colD[r * cols + c] = d[r]!;
      colArgRow[r * cols + c] = arg[r]!;
    }
  }
  // Pass 2: rows.
  const dist2 = new Float64Array(cols * rows);
  const nearest = new Int32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) f[c] = colD[r * cols + c]!;
    dt1d(f, cols, d, arg, v, z);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      dist2[i] = d[c]!;
      const sc = arg[c]!;
      nearest[i] = sc < 0 ? -1 : colArgRow[r * cols + sc]! * cols + sc;
    }
  }
  return { dist2, nearest };
}

/**
 * Clearance (mm) from each FREE cell center to the nearest obstacle/wall boundary
 * (distance to the nearest non-free cell center minus half a cell). −1 for non-free cells.
 */
export function clearanceField(g: OccupancyGrid): { clearance: Float32Array; nearest: Int32Array } {
  const { dist2, nearest } = distanceTransform(g, (i) => g.cells[i] !== CELL_FREE);
  const clearance = new Float32Array(g.cells.length);
  for (let i = 0; i < clearance.length; i++) {
    clearance[i] = g.cells[i] === CELL_FREE ? Math.max(0, Math.sqrt(dist2[i]!) * g.cellSize - g.cellSize / 2) : -1;
  }
  return { clearance, nearest };
}

// ───────────────────────────── graph search helpers ─────────────────────────────

const NEIGHBORS8: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Minimal binary heap keyed by number. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  constructor(private readonly max: boolean) {}
  get size(): number {
    return this.keys.length;
  }
  private better(a: number, b: number): boolean {
    return this.max ? a > b : a < b;
  }
  push(val: number, key: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.better(this.keys[i]!, this.keys[p]!)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { val: number; key: number } | undefined {
    if (this.keys.length === 0) return undefined;
    const top = { val: this.vals[0]!, key: this.keys[0]! };
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.better(this.keys[l]!, this.keys[m]!)) m = l;
        if (r < this.keys.length && this.better(this.keys[r]!, this.keys[m]!)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.vals[a], this.vals[b]] = [this.vals[b]!, this.vals[a]!];
  }
}

function canStep(g: OccupancyGrid, pass: (i: number) => boolean, c: number, r: number, dc: number, dr: number): boolean {
  const nc = c + dc;
  const nr = r + dr;
  if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) return false;
  if (!pass(nr * g.cols + nc)) return false;
  if (dc !== 0 && dr !== 0) {
    // No corner cutting.
    if (!pass(r * g.cols + nc) || !pass(nr * g.cols + c)) return false;
  }
  return true;
}

/** Nearest cell satisfying `pass` to the given point (spiral search), or -1. */
export function nearestPassableCell(g: OccupancyGrid, p: Point, pass: (i: number) => boolean, maxRadiusCells = 40): number {
  const start = cellAt(g, p);
  const c0 = Math.floor((p.x - g.originX) / g.cellSize);
  const r0 = Math.floor((p.y - g.originY) / g.cellSize);
  if (start >= 0 && pass(start)) return start;
  let best = -1;
  let bestD = Infinity;
  for (let rad = 1; rad <= maxRadiusCells; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
        const i = r * g.cols + c;
        if (!pass(i)) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

export interface GridPath {
  cells: number[];
  points: Point[];
  /** Path length in mm. */
  length: number;
}

/** A* shortest path (8-connected, no corner cutting) over cells where `pass` is true. */
export function shortestPath(g: OccupancyGrid, from: number, to: number, pass: (i: number) => boolean): GridPath | null {
  if (from < 0 || to < 0 || !pass(from) || !pass(to)) return null;
  const n = g.cells.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const tc = to % g.cols;
  const tr = Math.floor(to / g.cols);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - tc);
    const dr = Math.abs(Math.floor(i / g.cols) - tr);
    return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
  };
  const open = new Heap(false);
  gScore[from] = 0;
  open.push(from, h(from));
  while (open.size) {
    const cur = open.pop()!.val;
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % g.cols;
    const r = Math.floor(cur / g.cols);
    for (const [dc, dr, cost] of NEIGHBORS8) {
      if (!canStep(g, pass, c, r, dc, dr)) continue;
      const ni = (r + dr) * g.cols + (c + dc);
      const tentative = gScore[cur]! + cost;
      if (tentative < gScore[ni]!) {
        gScore[ni] = tentative;
        came[ni] = cur;
        open.push(ni, tentative + h(ni));
      }
    }
  }
  if (!Number.isFinite(gScore[to]!)) return null;
  const cells: number[] = [];
  for (let i = to; i !== -1; i = came[i]!) {
    cells.push(i);
    if (i === from) break;
  }
  cells.reverse();
  return { cells, points: cells.map((i) => cellCenter(g, i)), length: gScore[to]! * g.cellSize };
}

/**
 * Widest (maximin) path: the path whose narrowest point is as wide as possible.
 * `value(i)` is the clearance of a cell; returns the bottleneck value along the best path.
 */
export function widestPathBottleneck(
  g: OccupancyGrid,
  from: number,
  to: number,
  value: (i: number) => number,
): number | null {
  if (from < 0 || to < 0) return null;
  const n = g.cells.length;
  const best = new Float64Array(n).fill(-Infinity);
  const heap = new Heap(true);
  best[from] = value(from);
  heap.push(from, best[from]!);
  const pass = (i: number) => value(i) > 0;
  while (heap.size) {
    const { val: cur, key } = heap.pop()!;
    if (key < best[cur]!) continue;
    if (cur === to) return key;
    const c = cur % g.cols;
    const r = Math.floor(cur / g.cols);
    for (const [dc, dr] of NEIGHBORS8) {
      if (!canStep(g, pass, c, r, dc, dr)) continue;
      const ni = (r + dr) * g.cols + (c + dc);
      let b = Math.min(key, value(ni));
      // Diagonal moves squeeze between the two orthogonal cells; count them toward the bottleneck
      // so the result matches what shortestPath (no corner cutting) can actually traverse.
      if (dc !== 0 && dr !== 0) b = Math.min(b, value(r * g.cols + c + dc), value((r + dr) * g.cols + c));
      if (b > best[ni]!) {
        best[ni] = b;
        heap.push(ni, b);
      }
    }
  }
  return null;
}

/** Flood fill (4-connected) from seeds over `pass` cells. */
export function floodFill(g: OccupancyGrid, seeds: number[], pass: (i: number) => boolean): Uint8Array {
  const out = new Uint8Array(g.cells.length);
  const stack: number[] = [];
  for (const s of seeds) {
    if (s >= 0 && pass(s) && !out[s]) {
      out[s] = 1;
      stack.push(s);
    }
  }
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % g.cols;
    const r = Math.floor(i / g.cols);
    const nb = [
      c > 0 ? i - 1 : -1,
      c < g.cols - 1 ? i + 1 : -1,
      r > 0 ? i - g.cols : -1,
      r < g.rows - 1 ? i + g.cols : -1,
    ];
    for (const j of nb) {
      if (j >= 0 && !out[j] && pass(j)) {
        out[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/** Connected components (4-connected) of `pass` cells; returns labels (0 = none) and sizes. */
export function components(g: OccupancyGrid, pass: (i: number) => boolean): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(g.cells.length);
  const sizes: number[] = [0];
  let next = 1;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] || !pass(i)) continue;
    const fill = floodFill(g, [i], (j) => !labels[j] && pass(j));
    let size = 0;
    for (let j = 0; j < fill.length; j++) {
      if (fill[j]) {
        labels[j] = next;
        size++;
      }
    }
    sizes.push(size);
    next++;
  }
  return { labels, sizes };
}

/** Zhang–Suen thinning of a binary mask (1 = foreground). Returns a new skeleton mask. */
export function thin(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const img = mask.slice();
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : img[r * cols + c]!);
  let changed = true;
  const toClear: number[] = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!img[r * cols + c]) continue;
          const p2 = at(c, r - 1);
          const p3 = at(c + 1, r - 1);
          const p4 = at(c + 1, r);
          const p5 = at(c + 1, r + 1);
          const p6 = at(c, r + 1);
          const p7 = at(c - 1, r + 1);
          const p8 = at(c - 1, r);
          const p9 = at(c - 1, r - 1);
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let a = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) a++;
          if (a !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          toClear.push(r * cols + c);
        }
      }
      for (const i of toClear) img[i] = 0;
      if (toClear.length) changed = true;
    }
  }
  return img;
}
