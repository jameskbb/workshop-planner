/**
 * Pure room-outline editing with CAD constraints. Used by the room commands (authoritative) and by
 * the editor's live previews (so what you see while dragging is exactly what gets committed).
 *
 * Every edit returns either the new vertex list (same vertex ids, quantized) or a plain-language
 * refusal. Locked length / angle targets are taken from the room BEFORE the edit.
 */
import {
  angleOf,
  distance,
  findSelfIntersections,
  interiorAngles,
  roomWalls,
  solveWithTiers,
  type ConstraintViolation,
  type Point,
  type Polygon,
  type WallConstraintSpec,
} from '@/geometry';
import type { Room, Vertex, Wall, WallConstraints } from './schema';
import { quantize } from './units';

export type RoomEditResult = { ok: true; vertices: Vertex[]; walls?: Wall[] } | { ok: false; error: string };

/** Explain why a room outline is invalid, or null if it is fine. */
export function roomProblem(points: Polygon): string | null {
  if (points.length === 0) return null;
  if (points.length < 3) return 'A room needs at least 3 corners.';
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) return 'Two corners are on top of each other; every wall needs some length.';
  }
  if (findSelfIntersections(points).length > 0) return 'This would cause the room boundary to intersect itself.';
  if (roomWalls(points).length === 0) return 'The room outline has no area.';
  return null;
}

/** Wall letter for tables: A, B, … Z, AA, AB … */
export function wallLetter(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Compass bearing of a direction (degrees clockwise from north: N 0°, E 90°, S 180°, W 270°). */
export function bearingOfDirection(dirDeg: number): number {
  const b = (((dirDeg + 90) % 360) + 360) % 360;
  const r = Math.round(b * 1e6) / 1e6;
  return r === 360 ? 0 : r;
}
/** Inverse of `bearingOfDirection` (angleOf convention: 0 = east, 90 = south). */
export const directionOfBearing = (bearing: number): number => bearing - 90;

const pts = (room: Room): Point[] => room.vertices.map((v) => ({ x: v.x, y: v.y }));

/** Solver specs for the room's wall constraints, with lock targets measured on `reference`. */
export function constraintSpecs(room: Room, reference: Room = room): Array<WallConstraintSpec | undefined> {
  const idx = new Map(room.walls.map((w, i) => [w.id, i]));
  const refIdx = new Map(reference.walls.map((w, i) => [w.id, i]));
  const rn = reference.vertices.length;
  /** Wall `id` as it was in the reference room (a → b), if it existed there. */
  const refSeg = (id: string, fallback: number): [Point, Point] | null => {
    const ri = refIdx.get(id);
    if (ri !== undefined && rn >= 2) return [reference.vertices[ri]!, reference.vertices[(ri + 1) % rn]!];
    const n = room.vertices.length;
    return n >= 2 ? [room.vertices[fallback]!, room.vertices[(fallback + 1) % n]!] : null;
  };
  return room.walls.map((w, i) => {
    const c = w.constraints ?? {};
    const spec: WallConstraintSpec = {};
    let any = false;
    if (c.horizontal) {
      spec.horizontal = true;
      any = true;
    }
    if (c.vertical) {
      spec.vertical = true;
      any = true;
    }
    const seg = c.lockLength || c.lockAngle ? refSeg(w.id, i) : null;
    if (c.lockLength && seg) {
      spec.length = distance(seg[0], seg[1]);
      any = true;
    }
    if (c.lockAngle && !c.horizontal && !c.vertical && seg) {
      spec.angle = angleOf({ x: seg[1].x - seg[0].x, y: seg[1].y - seg[0].y });
      any = true;
    }
    if (c.parallelTo && idx.has(c.parallelTo) && idx.get(c.parallelTo) !== i) {
      spec.parallelTo = idx.get(c.parallelTo);
      any = true;
    }
    if (c.perpendicularTo && idx.has(c.perpendicularTo) && idx.get(c.perpendicularTo) !== i) {
      spec.perpendicularTo = idx.get(c.perpendicularTo);
      any = true;
    }
    return any ? spec : undefined;
  });
}

export type LengthFormatter = (mm: number) => string;

function wallNames(room: Room): string[] {
  const n = room.vertices.length;
  if (n < 3) return room.walls.map((_, i) => `Wall ${wallLetter(i)}`);
  const geo = roomWalls(pts(room), { names: room.walls.map((w) => w.name) });
  return room.walls.map((_, i) => geo[i]?.name ?? `Wall ${wallLetter(i)}`);
}

/** Plain-language reason for a constraint that could not be kept. */
export function describeViolation(room: Room, v: ConstraintViolation, specs: ReadonlyArray<WallConstraintSpec | undefined>, fmt: LengthFormatter): string {
  const names = wallNames(room);
  const name = `the ${names[v.wall] ?? `wall ${wallLetter(v.wall)}`}`.replace('the the ', 'the ');
  const other = v.other !== undefined ? (names[v.other] ?? `wall ${wallLetter(v.other)}`) : '';
  const tail = ' Unlock that constraint in the wall inspector, or make a different change.';
  switch (v.kind) {
    case 'horizontal':
      return `This change can't keep ${name} horizontal (it is locked horizontal).${tail}`;
    case 'vertical':
      return `This change can't keep ${name} vertical (it is locked vertical).${tail}`;
    case 'length':
      return `This change can't keep ${name} at ${fmt(specs[v.wall]?.length ?? 0)} (its length is locked).${tail}`;
    case 'angle':
      return `This change can't keep ${name}'s angle (its angle is locked).${tail}`;
    case 'parallel':
      return `This change can't keep ${name} parallel to the ${other}.${tail}`;
    case 'perpendicular':
      return `This change can't keep ${name} perpendicular to the ${other}.${tail}`;
  }
}

function finish(room: Room, points: Point[], walls?: Wall[]): RoomEditResult {
  const q = points.map((p) => ({ x: quantize(p.x), y: quantize(p.y) }));
  const problem = roomProblem(q);
  if (problem) return { ok: false, error: problem };
  return { ok: true, vertices: room.vertices.map((v, i) => ({ ...v, ...q[i]! })), ...(walls ? { walls } : {}) };
}

/** Solve and validate; returns a refusal naming the first constraint that could not be kept. */
function solveAndFinish(
  reference: Room,
  proposed: Point[],
  pinned: Set<number>,
  tiers: Set<number>[],
  fmt: LengthFormatter,
  opts: { specs?: Array<WallConstraintSpec | undefined>; walls?: Wall[]; roomForNames?: Room } = {},
): RoomEditResult {
  const specs = opts.specs ?? constraintSpecs(reference);
  if (!specs.some(Boolean)) return finish(reference, proposed, opts.walls);
  const r = solveWithTiers(proposed, specs, pinned, tiers);
  if (!r.ok) return { ok: false, error: describeViolation(opts.roomForNames ?? reference, r.violations[0]!, specs, fmt) };
  return finish(reference, r.points, opts.walls);
}

const allExcept = (n: number, free: Iterable<number>): Set<number> => {
  const f = new Set([...free].map((i) => ((i % n) + n) % n));
  const s = new Set<number>();
  for (let i = 0; i < n; i++) if (!f.has(i)) s.add(i);
  return s;
};

/** The corner farthest (around the outline) from a set of corners. */
function anchorFarFrom(n: number, from: ReadonlySet<number>): Set<number> {
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < n; i++) {
    if (from.has(i)) continue;
    let d = Infinity;
    for (const j of from) d = Math.min(d, Math.abs(i - j), n - Math.abs(i - j));
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD < 0 ? new Set() : new Set([best]);
}

/** Move one or more corners to new positions (drag, exact X/Y entry, wall drag). */
export function moveVerticesEdit(room: Room, moves: ReadonlyArray<{ vertexId: string; x: number; y: number }>, fmt: LengthFormatter): RoomEditResult {
  const n = room.vertices.length;
  const index = new Map(room.vertices.map((v, i) => [v.id, i]));
  const proposed = pts(room);
  const pinned = new Set<number>();
  for (const m of moves) {
    const i = index.get(m.vertexId);
    if (i === undefined) return { ok: false, error: 'That corner no longer exists.' };
    proposed[i] = { x: m.x, y: m.y };
    pinned.add(i);
  }
  const neighbors = new Set<number>();
  for (const i of pinned) neighbors.add(i - 1).add(i + 1);
  const neighbors2 = new Set<number>(neighbors);
  for (const i of neighbors) neighbors2.add(i - 1).add(i + 1);
  // Loosest tier: everything may move except one anchor corner far from the edit, so the whole
  // room never slides away under the cursor.
  const anchor = anchorFarFrom(n, pinned);
  return solveAndFinish(room, proposed, pinned, [new Set([...allExcept(n, neighbors), ...anchor]), new Set([...allExcept(n, neighbors2), ...anchor])], fmt);
}

function wallIndexOf(room: Room, wallId: string): number {
  return room.walls.findIndex((w) => w.id === wallId);
}

/**
 * Move a wall's end corner to `target` (keeping its start). The following wall is carried along
 * (keeps its length and direction) so rectangles stay rectangular; if that is impossible the
 * following wall stretches instead.
 */
function moveWallEnd(room: Room, i: number, target: Point, fmt: LengthFormatter, overrides: WallConstraintSpec): RoomEditResult {
  const n = room.vertices.length;
  const a = i;
  const b = (i + 1) % n;
  const c = (i + 2) % n;
  const base = pts(room);
  const disp = { x: target.x - base[b]!.x, y: target.y - base[b]!.y };
  const specs = constraintSpecs(room);
  specs[i] = { ...(specs[i] ?? {}), ...overrides };
  const pinned = new Set([a, b]);
  // 1) carry the following wall along
  if (c !== a) {
    const shift = base.map((p) => ({ ...p }));
    shift[b] = target;
    shift[c] = { x: base[c]!.x + disp.x, y: base[c]!.y + disp.y };
    const r = solveAndFinish(room, shift, pinned, [allExcept(n, [c, c + 1]), allExcept(n, [c, c + 1, c + 2])], fmt, { specs });
    if (r.ok) return r;
  }
  // 2) stretch the following wall
  const stretch = base.map((p) => ({ ...p }));
  stretch[b] = target;
  return solveAndFinish(room, stretch, pinned, [allExcept(n, [c]), allExcept(n, [c, c + 1])], fmt, { specs });
}

/** Set a wall's exact length (its start corner stays put). */
export function setWallLengthEdit(room: Room, wallId: string, length: number, fmt: LengthFormatter): RoomEditResult {
  const i = wallIndexOf(room, wallId);
  if (i < 0) return { ok: false, error: 'That wall no longer exists.' };
  if (!(length > 1)) return { ok: false, error: 'A wall needs some length.' };
  const wall = room.walls[i]!;
  const names = wallNames(room);
  if (wall.constraints?.lockLength) return { ok: false, error: `The ${names[i]}'s length is locked. Unlock it in the wall inspector to change the length.` };
  const n = room.vertices.length;
  const a = room.vertices[i]!;
  const b = room.vertices[(i + 1) % n]!;
  const L = distance(a, b);
  if (L < 1e-9) return { ok: false, error: 'That wall has no length to extend.' };
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const target = { x: a.x + u.x * length, y: a.y + u.y * length };
  return moveWallEnd(room, i, target, fmt, { length, angle: angleOf(u) });
}

/** Set a wall's direction (degrees, angleOf convention) rotating it about its start corner. */
export function setWallDirectionEdit(room: Room, wallId: string, directionDeg: number, fmt: LengthFormatter): RoomEditResult {
  const i = wallIndexOf(room, wallId);
  if (i < 0) return { ok: false, error: 'That wall no longer exists.' };
  const wall = room.walls[i]!;
  const names = wallNames(room);
  const c = wall.constraints ?? {};
  if (c.horizontal || c.vertical || c.lockAngle) {
    const why = c.horizontal ? 'locked horizontal' : c.vertical ? 'locked vertical' : 'angle is locked';
    return { ok: false, error: `The ${names[i]}'s direction is fixed (${why}). Unlock it in the wall inspector to change its angle.` };
  }
  const n = room.vertices.length;
  const a = room.vertices[i]!;
  const b = room.vertices[(i + 1) % n]!;
  const L = distance(a, b);
  const r = (directionDeg * Math.PI) / 180;
  const target = { x: a.x + Math.cos(r) * L, y: a.y + Math.sin(r) * L };
  return moveWallEnd(room, i, target, fmt, { angle: directionDeg, length: L });
}

/** Set the interior angle at a corner by rotating the wall that starts there. */
export function setCornerAngleEdit(room: Room, vertexId: string, interiorDeg: number, fmt: LengthFormatter): RoomEditResult {
  const i = room.vertices.findIndex((v) => v.id === vertexId);
  if (i < 0) return { ok: false, error: 'That corner no longer exists.' };
  if (!(interiorDeg > 0 && interiorDeg < 360)) return { ok: false, error: 'A corner angle must be between 0° and 360°.' };
  const poly = pts(room);
  const n = poly.length;
  const current = interiorAngles(poly)[i]!;
  // interiorAngles: ang = (angle(prev − v) − angle(next − v)) · sign, sign = +1 for positive winding.
  let signed = 0;
  for (let k = 0; k < n; k++) {
    const p = poly[k]!;
    const q = poly[(k + 1) % n]!;
    signed += p.x * q.y - q.x * p.y;
  }
  const sign = signed >= 0 ? 1 : -1;
  const v = poly[i]!;
  const next = poly[(i + 1) % n]!;
  const a2 = angleOf({ x: next.x - v.x, y: next.y - v.y });
  const delta = interiorDeg - current;
  return setWallDirectionEdit(room, room.walls[i]!.id, a2 - delta * sign, fmt);
}

/** Validate a wall's new constraints and reshape the room to satisfy them. */
export function setWallConstraintsEdit(room: Room, wallId: string, constraints: WallConstraints, fmt: LengthFormatter): RoomEditResult {
  const i = wallIndexOf(room, wallId);
  if (i < 0) return { ok: false, error: 'That wall no longer exists.' };
  const c = constraints;
  if (c.horizontal && c.vertical) return { ok: false, error: "A wall can't be both horizontal and vertical." };
  if (c.parallelTo && c.parallelTo === wallId) return { ok: false, error: "A wall can't be parallel to itself." };
  if (c.perpendicularTo && c.perpendicularTo === wallId) return { ok: false, error: "A wall can't be perpendicular to itself." };
  if (c.parallelTo && c.parallelTo === c.perpendicularTo) return { ok: false, error: "A wall can't be both parallel and perpendicular to the same wall." };
  for (const ref of [c.parallelTo, c.perpendicularTo]) {
    if (ref && !room.walls.some((w) => w.id === ref)) return { ok: false, error: 'The wall it refers to no longer exists.' };
  }
  const walls = room.walls.map((w, k) => (k === i ? { ...w, constraints: { ...c } } : w));
  const next: Room = { ...room, walls };
  const n = room.vertices.length;
  const specs = constraintSpecs(next, room);
  const a = i;
  const b = (i + 1) % n;
  const anchor = anchorFarFrom(n, new Set([a, b]));
  const tiers = [allExcept(n, [b]), allExcept(n, [a]), allExcept(n, [a, b]), new Set([...allExcept(n, [a - 1, a, b, b + 1]), ...anchor]), anchor];
  return solveAndFinish(room, pts(room), new Set(), tiers, fmt, {
    specs,
    walls,
    roomForNames: next,
  });
}

/** Check that the room's constraints hold (used after structural edits such as removing a corner). */
export function constraintProblem(room: Room, reference: Room, fmt: LengthFormatter): string | null {
  const specs = constraintSpecs(room, reference);
  if (!specs.some(Boolean)) return null;
  const r = solveWithTiers(pts(room), specs, new Set(room.vertices.map((_, i) => i)), [new Set()]);
  return r.ok ? null : describeViolation(room, r.violations[0]!, specs, fmt);
}
