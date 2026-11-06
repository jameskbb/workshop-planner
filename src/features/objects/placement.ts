/**
 * Where a newly added item should land.
 *
 * Clicking a library item used to drop it at the exact center of the view, so a second click put
 * the second item on top of the first (and usually on top of the car). `findFreeSpotNear` keeps the
 * click meaning "about here" but walks outwards on a ring search until the footprint (plus a small
 * breathing gap) is inside the room and clear of everything already placed.
 *
 * Pure: it takes the project and returns a point; it dispatches nothing.
 */
import { roomGeometry } from '@/domain/resolve';
import { inches } from '@/domain/units';
import type { Project } from '@/domain/schema';
import { bbox, type Point } from '@/geometry';
import { blockedAt, placementObstacles, type Item } from '@/features/commands/nl/placement';

export interface FreeSpotQuery {
  /** Footprint of the item at rotation 0 (mm). */
  width: number;
  depth: number;
  /** Extra space to keep on every side so items do not end up touching. Default 2". */
  gap?: number;
  /** Ids that must not count as obstacles (e.g. the item being moved). */
  exclude?: ReadonlySet<string>;
}

/** Search resolution: fine enough to slot into a gap, coarse enough to stay instant. */
function stepFor(q: FreeSpotQuery): number {
  return Math.min(Math.max(inches(4), Math.min(q.width, q.depth) / 2), inches(24));
}

/**
 * The nearest point to `start` where a `width` × `depth` footprint fits free, or `null` when the
 * room has no such spot. Candidates are tested nearest-first on square rings around `start`.
 */
export function findFreeSpotNear(project: Project, scenarioId: string | undefined, q: FreeSpotQuery, start: Point): Point | null {
  const g = roomGeometry(project.room);
  if (q.width <= 0 || q.depth <= 0) return null;
  const obstacles = placementObstacles(project, scenarioId, q.exclude ?? new Set());
  // Full-height item: anything already on the plan counts, even a wall cabinet the item would
  // physically fit under: a click must not produce a pile the user cannot see through.
  const item: Item = { fp: { width: q.width, depth: q.depth }, bottom: 0, top: Number.MAX_SAFE_INTEGER, clearance: q.gap ?? inches(2) };
  const free = (p: Point) => blockedAt(g.polygon, obstacles, item, { x: p.x, y: p.y, rotation: 0 }) === null;
  if (free(start)) return start;

  const step = stepFor(q);
  const box = g.polygon.length >= 3 ? bbox(g.polygon) : null;
  // Far enough to cross the whole room even when the click was outside it.
  const reach = box
    ? Math.hypot(box.maxX - box.minX, box.maxY - box.minY) + Math.hypot((box.minX + box.maxX) / 2 - start.x, (box.minY + box.maxY) / 2 - start.y)
    : inches(600);
  const rings = Math.min(Math.ceil(reach / step), 200);
  for (let r = 1; r <= rings; r++) {
    const ring: Point[] = [];
    for (let i = -r; i <= r; i++) {
      ring.push({ x: start.x + i * step, y: start.y - r * step }, { x: start.x + i * step, y: start.y + r * step });
      if (i > -r && i < r) ring.push({ x: start.x - r * step, y: start.y + i * step }, { x: start.x + r * step, y: start.y + i * step });
    }
    ring.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
    for (const p of ring) if (free(p)) return p;
  }
  return null;
}
