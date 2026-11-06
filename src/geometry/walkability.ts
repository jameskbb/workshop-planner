/**
 * Walkability analysis on the occupancy grid:
 *  - clearance heatmap (distance to nearest obstacle/wall)
 *  - walkable centers for a chosen aisle width, reachability from entries
 *  - open / narrow / blocked / unreachable classification
 *  - dead ends (skeleton branches that are corridors leading nowhere)
 *  - narrowest point along the widest route between two points, attributed to the nearest obstacle
 */
import {
  buildOccupancyGrid,
  cellAt,
  cellCenter,
  CELL_BLOCKED,
  CELL_FREE,
  clearanceField,
  distanceTransform,
  floodFill,
  components,
  nearestPassableCell,
  shortestPath,
  thin,
  widestPathBottleneck,
  type OccupancyGrid,
} from './grid';
import type { Polygon } from './polygon';
import { distance, type Point } from './vec';

export const WALK_OUTSIDE = 0;
export const WALK_BLOCKED = 1;
export const WALK_OPEN = 2;
export const WALK_NARROW = 3;
export const WALK_UNREACHABLE = 4;

export interface DeadEnd {
  /** The closed end of the corridor. */
  point: Point;
  /** Skeleton path from the dead end back to where it joins the network. */
  path: Point[];
  /** Branch length (mm). */
  length: number;
  /** Typical corridor width along the branch (mm). */
  width: number;
}

export interface WalkabilityOptions {
  /** Desired minimum aisle width (mm), e.g. 762 for 30". */
  aisleWidth: number;
  /** Grid resolution (mm). Default 50. */
  cellSize?: number;
  /** Entry points (doors). If empty, the largest walkable region is treated as reachable. */
  entries?: Point[];
  /** Minimum length for a branch to count as a dead end (mm). Default 900. */
  minDeadEndLength?: number;
}

export interface WalkabilityResult {
  grid: OccupancyGrid;
  /** mm; −1 for non-free cells. Use as the heatmap. */
  clearance: Float32Array;
  /** Nearest non-free cell index for each cell (for attributing narrow spots to an obstacle). */
  nearestSite: Int32Array;
  /** Per-cell class: WALK_OUTSIDE / BLOCKED / OPEN / NARROW / UNREACHABLE. */
  classes: Uint8Array;
  deadEnds: DeadEnd[];
  aisleWidth: number;
  stats: {
    freeArea: number;
    openArea: number;
    narrowArea: number;
    unreachableArea: number;
    blockedArea: number;
  };
}

/** Run the full walkability analysis. Obstacles are world polygons (index = owner id in the grid). */
export function analyzeWalkability(room: Polygon, obstacles: readonly Polygon[], options: WalkabilityOptions): WalkabilityResult {
  const cellSize = options.cellSize ?? 50;
  const half = options.aisleWidth / 2;
  const grid = buildOccupancyGrid(room, obstacles, cellSize);
  const { clearance, nearest } = clearanceField(grid);
  const n = grid.cells.length;
  // Cell-center clearances are quantized to the grid; allow a quarter cell of tolerance so an aisle
  // of exactly the requested width is not rejected by discretization (accuracy ≈ ±cellSize/2).
  const walkable = (i: number) => clearance[i]! >= half - cellSize / 4 - 1e-6;

  // Reachability from entries (snapped to the nearest walkable cell), else the largest component.
  let reachable: Uint8Array;
  const seeds = (options.entries ?? [])
    .map((p) => nearestPassableCell(grid, p, walkable, Math.ceil(1500 / cellSize)))
    .filter((i) => i >= 0);
  if (seeds.length > 0) {
    reachable = floodFill(grid, seeds, walkable);
  } else {
    const { labels, sizes } = components(grid, walkable);
    let bestLabel = 0;
    for (let l = 1; l < sizes.length; l++) if (sizes[l]! > (sizes[bestLabel] ?? 0)) bestLabel = l;
    reachable = new Uint8Array(n);
    if (bestLabel > 0) for (let i = 0; i < n; i++) if (labels[i] === bestLabel) reachable[i] = 1;
  }

  // Cells swept by a body of width `aisleWidth` standing at reachable / any walkable centers.
  const covered = distanceTransform(grid, (i) => reachable[i] === 1);
  const coveredAny = distanceTransform(grid, (i) => walkable(i));
  // A body standing at a walkable cell sweeps a disk of radius ≈ half the aisle width (+½ cell for quantization).
  const r2 = ((half + cellSize / 2) / cellSize) ** 2 + 1e-9;
  const classes = new Uint8Array(n);
  let free = 0;
  let open = 0;
  let narrow = 0;
  let unreachable = 0;
  let blocked = 0;
  for (let i = 0; i < n; i++) {
    const c = grid.cells[i];
    if (c === CELL_FREE) {
      free++;
      if (covered.dist2[i]! <= r2) {
        classes[i] = WALK_OPEN;
        open++;
      } else if (coveredAny.dist2[i]! <= r2) {
        classes[i] = WALK_UNREACHABLE;
        unreachable++;
      } else {
        classes[i] = WALK_NARROW;
        narrow++;
      }
    } else if (c === CELL_BLOCKED) {
      classes[i] = WALK_BLOCKED;
      blocked++;
    } else classes[i] = WALK_OUTSIDE;
  }

  const deadEnds = findDeadEnds(grid, reachable, clearance, options);
  const a = cellSize * cellSize;
  return {
    grid,
    clearance,
    nearestSite: nearest,
    classes,
    deadEnds,
    aisleWidth: options.aisleWidth,
    stats: {
      freeArea: free * a,
      openArea: open * a,
      narrowArea: narrow * a,
      unreachableArea: unreachable * a,
      blockedArea: blocked * a,
    },
  };
}

function findDeadEnds(grid: OccupancyGrid, reachable: Uint8Array, clearance: Float32Array, options: WalkabilityOptions): DeadEnd[] {
  const { cols, rows } = grid;
  const skel = thin(reachable, cols, rows);
  const minLen = options.minDeadEndLength ?? 900;
  const entries = options.entries ?? [];
  const neighbors = (i: number): number[] => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const j = nr * cols + nc;
        if (skel[j]) out.push(j);
      }
    return out;
  };
  const result: DeadEnd[] = [];
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue;
    if (neighbors(i).length !== 1) continue;
    // Walk the branch until a junction (≥3 neighbors) or another end.
    const path = [i];
    let prev = -1;
    let cur = i;
    let length = 0;
    let reachedJunction = false;
    for (let guard = 0; guard < skel.length; guard++) {
      const nb = neighbors(cur).filter((j) => j !== prev && !path.includes(j));
      if (neighbors(cur).length >= 3 && cur !== i) {
        reachedJunction = true;
        break;
      }
      if (nb.length === 0) break;
      const next = nb[0]!;
      length += distance(cellCenter(grid, cur), cellCenter(grid, next));
      prev = cur;
      cur = next;
      path.push(cur);
    }
    if (!reachedJunction || length < minLen) continue;
    const widths = path.map((j) => 2 * clearance[j]!).sort((p, q) => p - q);
    const width = widths[Math.floor(widths.length / 2)]!;
    // Only corridors (not the medial spurs of open floor) count as dead ends.
    if (width > 2 * options.aisleWidth) continue;
    const endPoint = cellCenter(grid, i);
    if (entries.some((e) => distance(e, endPoint) < Math.max(options.aisleWidth * 1.5, 900))) continue;
    result.push({ point: endPoint, path: path.map((j) => cellCenter(grid, j)), length, width });
  }
  return result;
}

export interface NarrowestResult {
  /** Width of the narrowest point along the best route (mm): 2 × clearance. */
  width: number;
  point: Point;
  /** Index of the obstacle nearest to the narrowest point (−1 for a wall). */
  nearestObstacle: number;
  route: Point[];
  routeLength: number;
}

/**
 * Narrowest point along the widest route from `from` to `to` ("main path from garage entry to
 * workbench narrows to 19 inches beside the cabinet"). The first/last `ignoreEnds` mm of the
 * route are excluded, since endpoints naturally sit next to obstacles.
 */
export function narrowestAlongRoute(
  result: WalkabilityResult,
  from: Point,
  to: Point,
  ignoreEnds = 600,
  minPassage = 150,
): NarrowestResult | null {
  const { grid, clearance, nearestSite } = result;
  const passable = (i: number) => clearance[i]! >= minPassage / 2;
  const a = nearestPassableCell(grid, from, passable);
  const b = nearestPassableCell(grid, to, passable);
  if (a < 0 || b < 0) return null;
  const pa = cellCenter(grid, a);
  const pb = cellCenter(grid, b);
  const value = (i: number) => {
    const c = clearance[i]!;
    if (c < minPassage / 2) return 0;
    const p = cellCenter(grid, i);
    if (distance(p, pa) < ignoreEnds || distance(p, pb) < ignoreEnds) return 1e9;
    return c;
  };
  const bottleneck = widestPathBottleneck(grid, a, b, value);
  if (bottleneck === null) return null;
  const route = shortestPath(grid, a, b, (i) => value(i) >= bottleneck - 1e-6);
  if (!route) return null;
  let worst = route.cells[0]!;
  for (const c of route.cells) if (value(c) < value(worst)) worst = c;
  const width = value(worst) >= 1e9 ? Infinity : 2 * clearance[worst]!;
  return {
    width,
    point: cellCenter(grid, worst),
    nearestObstacle: nearestObstacleTo(grid, worst, nearestSite, clearance[worst]! + 2 * grid.cellSize),
    route: route.points,
    routeLength: route.length,
  };
}

/**
 * The object nearest to a cell, preferring objects over walls when both bound a gap
 * ("narrows to 19" beside the cabinet" rather than "beside the wall"). −1 if only walls are near.
 */
export function nearestObstacleTo(grid: OccupancyGrid, cell: number, nearestSite: Int32Array, radius: number): number {
  const site = nearestSite[cell] ?? -1;
  if (site >= 0 && grid.cells[site] === CELL_BLOCKED) return grid.owner[site]!;
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
      if (grid.cells[i] !== CELL_BLOCKED) continue;
      const d = dr * dr + dc * dc;
      if (d < bestD && Math.sqrt(d) * grid.cellSize <= radius) {
        bestD = d;
        best = grid.owner[i]!;
      }
    }
  }
  return best;
}

/** Walking distance (mm) between two points, keeping `bodyWidth` clear; null if unreachable. */
export function walkingDistance(result: WalkabilityResult, from: Point, to: Point, bodyWidth = 450): number | null {
  const { grid, clearance } = result;
  const pass = (i: number) => clearance[i]! >= bodyWidth / 2;
  const a = nearestPassableCell(grid, from, pass);
  const b = nearestPassableCell(grid, to, pass);
  const p = shortestPath(grid, a, b, pass);
  if (!p) return null;
  return p.length + distance(from, cellCenter(grid, a)) + distance(to, cellCenter(grid, b));
}

/** Clearance at a world point (mm), or −1 if not free. */
export function clearanceAt(result: WalkabilityResult, p: Point): number {
  const i = cellAt(result.grid, p);
  return i < 0 ? -1 : result.clearance[i]!;
}
