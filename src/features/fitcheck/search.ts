/**
 * "Will It Fit?" and "What could fit here?" (pure).
 *
 * fitSearch: where an item of W × D × H (plus optional clearance in front) physically fits: free
 * wall runs ("East wall: 62" available"), corners ("Southwest corner: fits with 3" remaining") and
 * open floor. Obstacles are height-aware: a 36"-tall cabinet fits under wall cabinets hung at 54".
 *
 * whatFitsIn: the free rectangle available in a region and the library items that fit in it.
 */
import { roomGeometry } from '@/domain/resolve';
import type { ObjectDefinition, Project } from '@/domain/schema';
import { findFitLocations, polygonContainsPolygon, satConvex, type FitCandidate, type Point, type Polygon, type Pose } from '@/geometry';
import { blockedAt, footprintAt, placementObstacles, type Item, type Obstacle } from '@/features/commands/nl/placement';

export interface FitQuery {
  width: number;
  depth: number;
  height: number;
  /** Clear floor needed in front (doors, drawers, standing room). */
  clearance?: number;
  /** Also try the item turned 90° (depth along the wall). Default true. */
  allowRotation?: boolean;
  includeFloor?: boolean;
}

export interface FitLocation {
  id: string;
  kind: 'wall' | 'corner' | 'floor';
  /** "East wall", "Southwest corner (North wall)", "Open floor". */
  location: string;
  pose: Pose;
  footprint: Polygon;
  /** Clearance envelope in front (for the preview). */
  clearanceZone: Polygon | null;
  /** Free wall run length (wall/corner), e.g. "62" available". */
  available: number;
  /** Slack left in that run after placing it. */
  remaining: number;
  /** Item turned so its depth runs along the wall. */
  rotated: boolean;
  wallIndex?: number;
}

/** Obstacles that overlap the item's height band. */
function relevant(obstacles: Obstacle[], height: number): Obstacle[] {
  return obstacles.filter((o) => o.bottom < height - 1 && o.top > 1);
}

export function fitSearch(project: Project, scenarioId: string | undefined, q: FitQuery): FitLocation[] {
  const g = roomGeometry(project.room);
  if (g.polygon.length < 3 || q.width <= 0 || q.depth <= 0) return [];
  const obstacles = relevant(placementObstacles(project, scenarioId), q.height);
  const polys = obstacles.map((o) => o.poly);
  const out: FitLocation[] = [];
  const variants: Array<{ w: number; d: number; rotated: boolean }> = [{ w: q.width, d: q.depth, rotated: false }];
  if ((q.allowRotation ?? true) && Math.abs(q.width - q.depth) > 1) variants.push({ w: q.depth, d: q.width, rotated: true });
  for (const v of variants) {
    const cands = findFitLocations(g.polygon, g.walls, polys, { width: v.w, depth: v.d, frontClearance: q.clearance ?? 0 }, { includeFloor: q.includeFloor ?? true, floorStep: 150 });
    for (const c of cands) out.push(toLocation(c, v.w, v.d, q.clearance ?? 0, v.rotated));
  }
  // Double-check against the exact 3D-aware test and drop duplicates.
  const item = (w: number, d: number): Item => ({ fp: { width: w, depth: d }, bottom: 0, top: q.height });
  const valid = out.filter((l) => !blockedAt(g.polygon, obstacles, item(l.rotated ? q.depth : q.width, l.rotated ? q.width : q.depth), l.pose));
  const unique: FitLocation[] = [];
  for (const l of valid) {
    if (unique.some((u) => Math.hypot(u.pose.x - l.pose.x, u.pose.y - l.pose.y) < 50)) continue;
    // Prefer the unrotated variant for the same wall run.
    if (l.rotated && l.kind !== 'floor' && unique.some((u) => !u.rotated && u.kind === l.kind && u.location === l.location)) continue;
    unique.push(l);
  }
  const rank = (l: FitLocation) => (l.kind === 'wall' ? 0 : l.kind === 'corner' ? 1 : 2);
  unique.sort((a, b) => rank(a) - rank(b) || (a.kind === 'wall' ? b.available - a.available : a.remaining - b.remaining));
  const floor = unique.filter((l) => l.kind === 'floor').slice(0, 4);
  return [...unique.filter((l) => l.kind !== 'floor'), ...floor].map((l, i) => ({ ...l, id: `fit-${i}` }));
}

function toLocation(c: FitCandidate, w: number, d: number, clearance: number, rotated: boolean): FitLocation {
  const zone = clearance > 0 ? footprintAt({ fp: { width: w, depth: clearance, offsetY: d / 2 + clearance / 2 }, bottom: 0, top: 0 }, c.pose) : null;
  return {
    id: '',
    kind: c.kind,
    location: c.kind === 'floor' ? 'Open floor' : c.location,
    pose: c.pose,
    footprint: c.footprint,
    clearanceZone: zone,
    available: c.available,
    remaining: c.remaining,
    rotated,
    wallIndex: c.wallIndex,
  };
}

// ───────────────────────────── what could fit here ─────────────────────────────

export interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface FreeArea extends Region {
  width: number;
  depth: number;
}

/**
 * Largest free axis-aligned rectangle inside `region` (grown from its center in 10 mm steps),
 * considering floor obstacles only (items hung above 36" do not take floor).
 */
export function freeAreaIn(project: Project, scenarioId: string | undefined, region: Region, exclude: ReadonlySet<string> = new Set(), step = 10): FreeArea | null {
  const g = roomGeometry(project.room);
  if (g.polygon.length < 3) return null;
  const obstacles = placementObstacles(project, scenarioId, exclude).filter((o) => o.bottom < 914);
  const free = (r: Region) => {
    const poly: Polygon = [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ];
    if (!polygonContainsPolygon(g.polygon, poly, 0.5)) return false;
    for (const o of obstacles) {
      if (o.box.minX >= r.maxX || o.box.maxX <= r.minX || o.box.minY >= r.maxY || o.box.maxY <= r.minY) continue;
      const c = satConvex(poly, o.poly, 0.5);
      if (c.colliding && c.depth > 0.5) return false;
    }
    return true;
  };
  // Seed: the region center, or the nearest free point on a coarse scan of the region.
  const cx = (region.minX + region.maxX) / 2;
  const cy = (region.minY + region.maxY) / 2;
  let seed: Point | null = null;
  const tiny = (p: Point) => ({ minX: p.x - 5, minY: p.y - 5, maxX: p.x + 5, maxY: p.y + 5 });
  if (free(tiny({ x: cx, y: cy }))) seed = { x: cx, y: cy };
  else {
    let best = Infinity;
    const n = 12;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = { x: region.minX + ((region.maxX - region.minX) * i) / n, y: region.minY + ((region.maxY - region.minY) * j) / n };
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < best && free(tiny(p))) {
          best = d;
          seed = p;
        }
      }
    }
  }
  if (!seed) return null;
  const r = tiny(seed);
  const grow = { minX: true, maxX: true, minY: true, maxY: true };
  while (grow.minX || grow.maxX || grow.minY || grow.maxY) {
    for (const k of ['minX', 'maxX', 'minY', 'maxY'] as const) {
      if (!grow[k]) continue;
      const trial = { ...r, [k]: r[k] + (k.startsWith('min') ? -step : step) };
      const outOfRegion = trial.minX < region.minX - 1e-6 || trial.maxX > region.maxX + 1e-6 || trial.minY < region.minY - 1e-6 || trial.maxY > region.maxY + 1e-6;
      if (outOfRegion || !free(trial)) grow[k] = false;
      else Object.assign(r, trial);
    }
  }
  return { ...r, width: r.maxX - r.minX, depth: r.maxY - r.minY };
}

export interface FitsHere {
  definition: ObjectDefinition;
  /** True when it only fits turned 90°. */
  rotated: boolean;
  pose: Pose;
  /** Share of the free area it would use (0–1). */
  use: number;
}

/** Library items that fit in a free area (floor items; checked at the area's center). */
export function itemsThatFit(project: Project, scenarioId: string | undefined, area: FreeArea, library: readonly ObjectDefinition[], exclude: ReadonlySet<string> = new Set()): FitsHere[] {
  const g = roomGeometry(project.room);
  const obstacles = placementObstacles(project, scenarioId, exclude);
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;
  const out: FitsHere[] = [];
  const seen = new Set<string>();
  for (const d of library) {
    if (d.mount !== 'floor' || d.components?.length || seen.has(d.id)) continue;
    seen.add(d.id);
    const item: Item = { fp: { width: d.width, depth: d.depth }, bottom: 0, top: d.height };
    let fit: { rotation: number; rotated: boolean } | null = null;
    if (d.width <= area.width + 0.5 && d.depth <= area.depth + 0.5) fit = { rotation: 0, rotated: false };
    else if (d.depth <= area.width + 0.5 && d.width <= area.depth + 0.5) fit = { rotation: 90, rotated: true };
    if (!fit) continue;
    const pose = { x: cx, y: cy, rotation: fit.rotation };
    if (blockedAt(g.polygon, obstacles, item, pose)) continue;
    out.push({ definition: d, rotated: fit.rotated, pose, use: (d.width * d.depth) / (area.width * area.depth) });
  }
  return out.sort((a, b) => b.use - a.use);
}

