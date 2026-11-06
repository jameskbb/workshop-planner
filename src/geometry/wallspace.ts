/**
 * Free wall space, placement candidates and "Will it fit?" search.
 */
import { intersect } from './clip';
import { localRect, localPolygonToWorld, type Pose } from './obb';
import { bbox, containsPoint, polygonContainsPolygon, type Polygon } from './polygon';
import { satConvex, polygonCollision } from './sat';
import { mergeIntervals, subtractIntervals } from './segment';
import { cornerName, pointOnWall, projectOntoWall, rotationFacingAwayFromWall, type WallGeom } from './walls';
import { distance, type Point } from './vec';

export interface FreeWallSegment {
  wallIndex: number;
  wallName: string;
  /** Offsets along the wall from its start vertex (mm). */
  start: number;
  end: number;
  length: number;
  startPoint: Point;
  endPoint: Point;
  /** True when the segment begins/ends at a room corner. */
  atStartCorner: boolean;
  atEndCorner: boolean;
}

export interface FreeWallOptions {
  /** Depth of the band along the wall that counts as "using" the wall. Default 610 mm (24"). */
  bandDepth?: number;
  /** Ignore free segments shorter than this. Default 1 mm. */
  minLength?: number;
}

/** Band polygon of `depth` along the inside of a wall, clipped to the room. */
export function wallBand(wall: WallGeom, depth: number): Polygon {
  return [pointOnWall(wall, 0, 0), pointOnWall(wall, wall.length, 0), pointOnWall(wall, wall.length, depth), pointOnWall(wall, 0, depth)];
}

/**
 * Occupied intervals (offsets along the wall) caused by obstacles that intrude into the wall band.
 * Obstacles are world polygons (object footprints, door swings, architectural features…).
 */
export function occupiedWallIntervals(
  wall: WallGeom,
  obstacles: readonly Polygon[],
  room: Polygon,
  bandDepth: number,
): Array<[number, number]> {
  const band = wallBand(wall, bandDepth);
  const roomBand = room.length >= 3 ? intersect(band, room) : [{ outer: band, holes: [] }];
  const intervals: Array<[number, number]> = [];
  for (const obs of obstacles) {
    const hit = intersect(roomBand, obs);
    for (const piece of hit) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of piece.outer) {
        const pr = projectOntoWall(p, wall);
        lo = Math.min(lo, pr.offset);
        hi = Math.max(hi, pr.offset);
      }
      if (hi > lo) intervals.push([lo, hi]);
    }
  }
  // Parts of the band that leave the room (reflex corners) are unusable too.
  if (room.length >= 3) {
    const samples = Math.max(2, Math.ceil(wall.length / 50));
    let runStart: number | null = null;
    for (let k = 0; k <= samples; k++) {
      const s = (k / samples) * wall.length;
      const probe = pointOnWall(wall, s, Math.min(bandDepth, 25));
      const inside = containsPoint(room, probe);
      if (!inside && runStart === null) runStart = s;
      if (inside && runStart !== null) {
        intervals.push([runStart, s]);
        runStart = null;
      }
    }
    if (runStart !== null) intervals.push([runStart, wall.length]);
  }
  return mergeIntervals(intervals);
}

/** Free (unoccupied) segments along every wall. */
export function freeWallSegments(
  walls: WallGeom[],
  obstacles: readonly Polygon[],
  room: Polygon,
  options: FreeWallOptions = {},
): FreeWallSegment[] {
  const bandDepth = options.bandDepth ?? 610;
  const minLength = options.minLength ?? 1;
  const out: FreeWallSegment[] = [];
  for (const w of walls) {
    const occ = occupiedWallIntervals(w, obstacles, room, bandDepth);
    for (const [s, e] of subtractIntervals(0, w.length, occ, 0.5)) {
      if (e - s < minLength) continue;
      out.push({
        wallIndex: w.index,
        wallName: w.name,
        start: s,
        end: e,
        length: e - s,
        startPoint: pointOnWall(w, s),
        endPoint: pointOnWall(w, e),
        atStartCorner: s < 1,
        atEndCorner: e > w.length - 1,
      });
    }
  }
  return out;
}

export interface FitItem {
  width: number;
  depth: number;
  /** Extra clear space required in front of the item (e.g. to open drawers). */
  frontClearance?: number;
  /** Extra clear space required on every side. */
  sideClearance?: number;
}

export interface FitCandidate {
  kind: 'wall' | 'corner' | 'floor';
  /** Pose for the item's footprint center; front faces into the room for wall/corner fits. */
  pose: Pose;
  footprint: Polygon;
  wallIndex?: number;
  wallName?: string;
  /** Human location, e.g. "East wall", "southwest corner". */
  location: string;
  /** Length of the free wall run this candidate uses (wall kinds). */
  available: number;
  /** Slack left in that run after placing the item (mm). */
  remaining: number;
}

export interface FitSearchOptions {
  bandDepth?: number;
  includeFloor?: boolean;
  /** Floor scan step (mm). Default 150. */
  floorStep?: number;
  maxResults?: number;
}

function footprintFor(item: FitItem, pose: Pose): Polygon {
  return localPolygonToWorld(pose, localRect(item.width, item.depth));
}

/** Footprint grown by required clearances (front clearance extends toward local +y). */
function envelopeFor(item: FitItem, pose: Pose): Polygon {
  const side = item.sideClearance ?? 0;
  const front = item.frontClearance ?? 0;
  const w = item.width + 2 * side;
  const d = item.depth + front + side;
  return localPolygonToWorld(pose, localRect(w, d, 0, (front - side) / 2));
}

function placementValid(room: Polygon, obstacles: readonly Polygon[], item: FitItem, pose: Pose): boolean {
  const env = envelopeFor(item, pose);
  // The back may touch the wall; shrink tolerance so flush placements count as inside.
  if (!polygonContainsPolygon(room, env, 0.5)) return false;
  const fb = bbox(env);
  for (const o of obstacles) {
    const ob = bbox(o);
    if (ob.minX >= fb.maxX || ob.maxX <= fb.minX || ob.minY >= fb.maxY || ob.maxY <= fb.minY) continue;
    const col = o.length === 4 ? satConvex(env, o, 0.5) : polygonCollision(env, o, 1);
    if (col.colliding) return false;
  }
  return true;
}

/**
 * Find locations where an item fits: flush against free wall runs (start, center and end of each run),
 * in corners, and optionally on open floor. Results are validated against the room outline and obstacles,
 * and sorted by tightest fit first (least wasted wall) for wall/corner candidates.
 */
export function findFitLocations(
  room: Polygon,
  walls: WallGeom[],
  obstacles: readonly Polygon[],
  item: FitItem,
  options: FitSearchOptions = {},
): FitCandidate[] {
  const bandDepth = options.bandDepth ?? Math.max(item.depth + (item.frontClearance ?? 0), 100);
  const side = item.sideClearance ?? 0;
  const need = item.width + 2 * side;
  const segments = freeWallSegments(walls, obstacles, room, { bandDepth: Math.min(bandDepth, item.depth), minLength: need });
  const results: FitCandidate[] = [];
  for (const seg of segments) {
    const wall = walls[seg.wallIndex]!;
    const rotation = rotationFacingAwayFromWall(wall);
    const offsets = new Set<number>();
    offsets.add(seg.start + need / 2);
    offsets.add(seg.end - need / 2);
    offsets.add((seg.start + seg.end) / 2);
    let wallCandidate: FitCandidate | null = null;
    for (const off of offsets) {
      const c = pointOnWall(wall, off, item.depth / 2);
      const pose = { x: c.x, y: c.y, rotation };
      if (!placementValid(room, obstacles, item, pose)) continue;
      const atStart = seg.atStartCorner && off - need / 2 - seg.start < 1;
      const atEnd = seg.atEndCorner && seg.end - (off + need / 2) < 1;
      const base = {
        pose,
        footprint: footprintFor(item, pose),
        wallIndex: wall.index,
        wallName: wall.name,
        available: seg.length,
        remaining: seg.length - need,
      };
      if (atStart || atEnd) {
        // Corner placements are reported on their own ("southwest corner: fits with 3" remaining").
        const vertex = atStart ? wall.index : (wall.index + 1) % walls.length;
        results.push({ ...base, kind: 'corner', location: `${capitalize(cornerName(walls, vertex))} (${wall.name})` });
      } else if (!wallCandidate) {
        wallCandidate = { ...base, kind: 'wall', location: wall.name };
      }
    }
    if (wallCandidate) results.push(wallCandidate);
  }
  if (options.includeFloor) {
    const step = options.floorStep ?? 150;
    const b = bbox(room);
    const floorHits: FitCandidate[] = [];
    for (const rotation of [0, 90]) {
      for (let y = b.minY + item.depth / 2; y <= b.maxY; y += step) {
        for (let x = b.minX + item.width / 2; x <= b.maxX; x += step) {
          const pose = { x, y, rotation };
          if (!placementValid(room, obstacles, item, pose)) continue;
          floorHits.push({
            kind: 'floor',
            pose,
            footprint: footprintFor(item, pose),
            location: 'Open floor',
            available: 0,
            remaining: 0,
          });
        }
      }
    }
    // Thin out floor hits so they are spatially distinct.
    const picked: FitCandidate[] = [];
    for (const h of floorHits) {
      if (picked.every((p) => distance(p.pose, h.pose) > Math.max(item.width, item.depth))) picked.push(h);
    }
    results.push(...picked);
  }
  // De-duplicate near-identical poses.
  const unique: FitCandidate[] = [];
  for (const r of results) {
    if (!unique.some((u) => distance(u.pose, r.pose) < 1 && u.pose.rotation === r.pose.rotation)) unique.push(r);
  }
  const rank = (c: FitCandidate) => (c.kind === 'floor' ? 2 : 0);
  unique.sort((a, b) => rank(a) - rank(b) || a.remaining - b.remaining);
  return options.maxResults ? unique.slice(0, options.maxResults) : unique;
}

/**
 * Largest axis-aligned rectangle of free floor around a point (for "What could fit here?").
 * Grows a rectangle from `seed` in 10 mm steps in each direction until blocked.
 */
export function largestFreeRectAt(
  room: Polygon,
  obstacles: readonly Polygon[],
  seed: Point,
  maxSize = 20000,
  step = 10,
): { minX: number; minY: number; maxX: number; maxY: number; width: number; depth: number } | null {
  if (!containsPoint(room, seed)) return null;
  const free = (r: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const poly: Polygon = [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ];
    if (!polygonContainsPolygon(room, poly, 0.5)) return false;
    return obstacles.every((o) => !polygonCollision(poly, o, 0.5).colliding);
  };
  const r = { minX: seed.x - 1, minY: seed.y - 1, maxX: seed.x + 1, maxY: seed.y + 1 };
  if (!free(r)) return null;
  const grow = [true, true, true, true];
  while (grow.some(Boolean)) {
    const dirs: Array<keyof typeof r> = ['minX', 'maxX', 'minY', 'maxY'];
    for (let k = 0; k < 4; k++) {
      if (!grow[k]) continue;
      const key = dirs[k]!;
      const trial = { ...r, [key]: r[key] + (key.startsWith('min') ? -step : step) };
      if (trial.maxX - trial.minX > maxSize || trial.maxY - trial.minY > maxSize || !free(trial)) grow[k] = false;
      else Object.assign(r, trial);
    }
  }
  return { ...r, width: r.maxX - r.minX, depth: r.maxY - r.minY };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
