/**
 * Physical move planner: turns "where things are now" (Current layout) and "where they should end
 * up" (Target layout) into an ordered, human-readable sequence of moves.
 *
 * Pure: no React, stores or domain lookups (see `input.ts` for the project → input adapter).
 *
 * Algorithm
 *  1. Items leaving the garage (in Current, not in Target) go first: they only free space.
 *     Removals are grouped by area ("Clear the southwest corner").
 *  2. An item can move once its target spot is free: its target footprint must not overlap the
 *     spot any other *pending* item still occupies (vertical ranges must overlap too, so a wall
 *     cabinet above a bench never blocks it). Ready items are moved in order of how many other items
 *     they unblock, then heaviest first, so heavy items go straight to their final spot.
 *  3. When nothing is ready, the remaining dependencies contain a cycle (A needs B's spot and B
 *     needs A's). The planner finds the dependency cycles (Tarjan SCC) and moves the item that is
 *     cheapest to handle (lowest effective weight; casters count for much less) to a temporary
 *     staging spot on open floor that blocks neither current nor target positions, or out of the
 *     garage when no floor spot fits. Heavy items are therefore moved exactly once whenever a
 *     lighter item in the same cycle can be staged instead.
 *  4. Items new to the garage are brought in last, then vehicles are parked.
 *
 * Step statuses: `skipped` items stay where they are (treated as fixed), `blocked` ("Cannot move
 * yet") items are deferred: the plan works around their current spot and lists them at the end;
 * `moved` steps are treated as done (the item is already at its target).
 */
import {
  bbox,
  bboxHeight,
  bboxWidth,
  centroid,
  containsPoint,
  distance,
  distancesToWalls,
  localPolygonToWorld,
  polygonContainsPolygon,
  satConvex,
  type BBox,
  type Point,
  type Polygon,
  type Pose,
  type WallGeom,
} from '@/geometry';

// ───────────────────────────── types ─────────────────────────────

export type StepStatus = 'moved' | 'skipped' | 'blocked';

export interface ItemPlacement {
  pose: Pose;
  /** World footprint. */
  polygon: Polygon;
  /** Occupied vertical range [bottom, top] in mm. */
  z: [number, number];
}

export interface MoveItem {
  id: string;
  kind: 'object' | 'vehicle';
  name: string;
  category: string;
  /** Estimated or known weight (kg). */
  weightKg: number;
  /** True for items on casters / wheels. */
  mobile: boolean;
  /** Present in the Current layout. */
  from: ItemPlacement | null;
  /** Present in the Target layout. */
  to: ItemPlacement | null;
}

export interface FixedObstacle {
  name: string;
  polygon: Polygon;
  z: [number, number];
}

export interface PlannerInput {
  room: { polygon: Polygon; walls: WallGeom[] };
  /** Items whose position differs between the layouts (or that are added / removed). */
  items: MoveItem[];
  /** Things that stay put: unchanged items, floor architecture (poles, water heater…). */
  fixed: FixedObstacle[];
  /** Step statuses applied to this plan (key → status). */
  status?: Readonly<Record<string, StepStatus>>;
  /** Staging search grid (mm). Default 150. */
  stagingStep?: number;
  /** Items at or above this effective weight are flagged heavy (kg). Default 40. */
  heavyKg?: number;
}

export type StepKind = 'clear' | 'move' | 'stage' | 'bring-in' | 'vehicle-out' | 'vehicle-in' | 'deferred' | 'waiting';

export interface MoveStep {
  /** Stable key (used for statuses): e.g. `move:<id>`, `stage:<id>`, `clear:<ids>`. */
  key: string;
  kind: StepKind;
  title: string;
  detail: string;
  itemIds: string[];
  /** True when the step handles an item flagged heavy. */
  heavy: boolean;
  /** Effective handling weight (kg, casters discounted). */
  effortKg: number;
  /** Where the item starts / ends for this step (world, for highlighting). */
  fromPolygon?: Polygon;
  toPolygon?: Polygon;
  fromPose?: Pose;
  toPose?: Pose;
  /** Stage steps: the key of the step that later moves the item to its final spot. */
  finalStepKey?: string;
  /** Waiting steps: names of the items blocking this one. */
  waitingOn?: string[];
}

export interface MovePlan {
  steps: MoveStep[];
  /** Number of physical item moves (a staged item counts twice). */
  totalMoves: number;
  /** Items that had to be staged (moved twice). */
  stagedIds: string[];
  /** Heavy items that are moved more than once (ideally none). */
  repeatedHeavyIds: string[];
  /** Human notes: target-layout conflicts, skipped items, etc. */
  notes: string[];
}

// ───────────────────────────── helpers ─────────────────────────────

const CONTACT_TOLERANCE = 5; // mm of overlap tolerated (touching items don't block each other)

function zOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] - 1 && b[0] < a[1] - 1;
}

export function blocks(a: { polygon: Polygon; z: [number, number] }, b: { polygon: Polygon; z: [number, number] }): boolean {
  if (a.polygon.length < 3 || b.polygon.length < 3 || !zOverlap(a.z, b.z)) return false;
  return satConvex(a.polygon, b.polygon, CONTACT_TOLERANCE).colliding;
}

/** Effective handling effort: casters make a heavy cabinet much easier to reposition. */
export function effortOf(item: Pick<MoveItem, 'weightKg' | 'mobile' | 'kind'>): number {
  if (item.kind === 'vehicle') return 0; // driven, not carried
  return item.weightKg * (item.mobile ? 0.35 : 1);
}

const article = (name: string): string => (/^(the|a|an|my|your)\s/i.test(name) || /^[A-Z0-9]{2,}/.test(name) ? name : `the ${lowerFirst(name)}`);
function lowerFirst(s: string): string {
  // Keep proper names / measurements ("6' Workbench" → "6' workbench"; "Sedan" → "sedan").
  return s.length > 1 && s[0] === s[0]!.toUpperCase() && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s;
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────────────────────── location phrases ─────────────────────────────

type Region = { row: 'north' | 'middle' | 'south'; col: 'west' | 'center' | 'east' };

function regionOf(p: Point, box: BBox): Region {
  const fx = bboxWidth(box) > 0 ? (p.x - box.minX) / bboxWidth(box) : 0.5;
  const fy = bboxHeight(box) > 0 ? (p.y - box.minY) / bboxHeight(box) : 0.5;
  return {
    col: fx < 1 / 3 ? 'west' : fx > 2 / 3 ? 'east' : 'center',
    row: fy < 1 / 3 ? 'north' : fy > 2 / 3 ? 'south' : 'middle',
  };
}

/** "southwest corner", "north side", "middle of the room". */
export function regionName(p: Point, box: BBox): string {
  const r = regionOf(p, box);
  if (r.row === 'middle' && r.col === 'center') return 'middle of the room';
  if (r.row === 'middle') return `${r.col} side`;
  if (r.col === 'center') return `${r.row} side`;
  return `${r.row}${r.col} corner`;
}

/** Phrase for where a footprint sits: "the North wall", "the northeast corner", "the middle of the room". */
export function describeSpot(polygon: Polygon, room: PlannerInput['room']): string {
  const box = bbox(room.polygon);
  const c = centroid(polygon);
  const near = room.walls.length ? distancesToWalls(polygon, room.walls).filter((d) => d.distance <= 300) : [];
  if (near.length >= 2) {
    // Against two walls: a corner. Name it by the room region when it is a real corner.
    const region = regionName(c, box);
    if (region.endsWith('corner')) return `the ${region}`;
    return `the corner of the ${near[0]!.wallName} and the ${near[1]!.wallName}`;
  }
  if (near.length === 1) return `the ${near[0]!.wallName}`;
  return `the ${regionName(c, box)}`;
}

// ───────────────────────────── staging ─────────────────────────────

/** Find an open-floor spot for `item` that overlaps nothing in `occupied`, nearest to `near`. */
export function findStagingSpot(item: MoveItem, room: PlannerInput['room'], occupied: FixedObstacle[], near: Point, step = 150): ItemPlacement | null {
  const src = item.from ?? item.to;
  if (!src || room.polygon.length < 3) return null;
  const local = src.polygon.map((p) => ({ x: p.x - src.pose.x, y: p.y - src.pose.y }));
  // Try the item's own rotation first, then turned 90°.
  const variants: Array<{ rot: number; poly: Polygon }> = [
    { rot: 0, poly: local },
    { rot: 90, poly: local.map((p) => ({ x: -p.y, y: p.x })) },
  ];
  const box = bbox(room.polygon);
  const floor = occupied.filter((o) => zOverlap(o.z, src.z));
  let best: { d: number; placement: ItemPlacement } | null = null;
  for (let y = box.minY + step / 2; y <= box.maxY; y += step) {
    for (let x = box.minX + step / 2; x <= box.maxX; x += step) {
      const center = { x, y };
      if (!containsPoint(room.polygon, center)) continue;
      const d = distance(center, near);
      if (best && d >= best.d) continue;
      for (const v of variants) {
        const poly = localPolygonToWorld({ x, y, rotation: 0 }, v.poly);
        if (!polygonContainsPolygon(room.polygon, poly)) continue;
        const cand = { polygon: poly, z: src.z };
        // Keep a little walking room around a staged item (50 mm).
        if (floor.some((o) => blocks(cand, { polygon: grow(o.polygon, 50), z: o.z }))) continue;
        best = { d, placement: { pose: { x, y, rotation: normRot(src.pose.rotation + v.rot) }, polygon: poly, z: src.z } };
        break;
      }
    }
  }
  return best?.placement ?? null;
}

const normRot = (r: number): number => ((r % 360) + 360) % 360;

/** Grow a convex polygon outward from its centroid (cheap margin for staging clearance). */
function grow(poly: Polygon, margin: number): Polygon {
  const c = centroid(poly);
  return poly.map((p) => {
    const d = distance(p, c);
    if (d < 1e-6) return p;
    const k = (d + margin) / d;
    return { x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k };
  });
}

// ───────────────────────────── cycles ─────────────────────────────

/** Strongly connected components (Tarjan). `edges.get(a)` = nodes a depends on. */
export function stronglyConnected(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

// ───────────────────────────── the planner ─────────────────────────────

interface Live {
  item: MoveItem;
  /** Where the item currently is (null = outside the garage). */
  at: ItemPlacement | null;
  staged: boolean;
}

export function planMoves(input: PlannerInput): MovePlan {
  const status = input.status ?? {};
  const heavyKg = input.heavyKg ?? 40;
  const room = input.room;
  const roomBox = bbox(room.polygon.length ? room.polygon : [{ x: 0, y: 0 }]);
  const steps: MoveStep[] = [];
  const notes: string[] = [];
  const stagedIds: string[] = [];
  const moveCount = new Map<string, number>();
  const bump = (id: string) => moveCount.set(id, (moveCount.get(id) ?? 0) + 1);
  const isHeavy = (it: MoveItem) => effortOf(it) >= heavyKg;

  // Fixed obstacles: unchanged items + architecture, plus skipped items at their current spot.
  const fixed: FixedObstacle[] = [...input.fixed];
  const items = [...input.items].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const live = new Map<string, Live>();
  const pending: string[] = []; // items that still need to reach their target
  const deferred: MoveItem[] = [];
  const removals: MoveItem[] = [];
  const vehiclesOut: MoveItem[] = [];
  const additions: MoveItem[] = [];

  for (const it of items) {
    const moveKey = keyFor(it);
    const st = status[moveKey] ?? (status[`final:${it.id}`] === 'moved' ? 'moved' : undefined);
    if (st === 'skipped') {
      if (it.from) fixed.push({ name: it.name, polygon: it.from.polygon, z: it.from.z });
      notes.push(`${cap(article(it.name))} stays where it is (skipped).`);
      continue;
    }
    if (st === 'moved') {
      // Already at its target: it occupies the target spot from the start.
      if (it.to) fixed.push({ name: it.name, polygon: it.to.polygon, z: it.to.z });
      steps.push(doneStep(it, moveKey, room));
      continue;
    }
    if (st === 'blocked') {
      // Cannot move yet: it keeps its current spot until the end.
      deferred.push(it);
      if (it.from) fixed.push({ name: it.name, polygon: it.from.polygon, z: it.from.z });
      continue;
    }
    if (it.from && !it.to) {
      (it.kind === 'vehicle' ? vehiclesOut : removals).push(it);
      continue;
    }
    if (!it.from && it.to) {
      additions.push(it);
      continue;
    }
    if (status[`stage:${it.id}`] === 'moved') {
      // Already carried to its temporary spot: it no longer blocks its original position.
      steps.push({ ...doneStep(it, `stage:${it.id}`, room), kind: 'stage', title: `Move ${article(it.name)} out of the way temporarily`, toPolygon: undefined, toPose: undefined });
      live.set(it.id, { item: it, at: null, staged: true });
      pending.push(it.id);
      continue;
    }
    live.set(it.id, { item: it, at: it.from, staged: false });
    pending.push(it.id);
  }

  // Target-layout conflicts with things that do not move (the plan can't fix those).
  for (const it of [...items]) {
    if (!it.to) continue;
    const hit = input.fixed.find((f) => blocks(it.to!, f));
    if (hit) notes.push(`In the target layout ${article(it.name)} overlaps ${article(hit.name)}, which is not moving. Check the target layout.`);
  }

  // 1. Vehicles out first, then removals grouped by area.
  for (const v of vehiclesOut) {
    bump(v.id);
    steps.push({
      key: keyFor(v),
      kind: 'vehicle-out',
      title: `Drive ${article(v.name)} out of the garage`,
      detail: 'It is not part of the target layout. Park it outside before moving anything else.',
      itemIds: [v.id],
      heavy: false,
      effortKg: 0,
      fromPolygon: v.from!.polygon,
      fromPose: v.from!.pose,
    });
  }
  const byRegion = new Map<string, MoveItem[]>();
  for (const r of removals) {
    const region = regionName(centroid(r.from!.polygon), roomBox);
    byRegion.set(region, [...(byRegion.get(region) ?? []), r]);
  }
  for (const [region, list] of byRegion) {
    for (const r of list) bump(r.id);
    const names = list.map((r) => article(r.name));
    steps.push({
      key: keyFor(list[0]!, list.map((r) => r.id)),
      kind: 'clear',
      title: `Clear the ${region}`,
      detail: `Take ${joinNames(names)} out of the garage; ${list.length > 1 ? 'they are' : 'it is'} not in the target layout.`,
      itemIds: list.map((r) => r.id),
      heavy: list.some(isHeavy),
      effortKg: list.reduce((s, r) => s + effortOf(r), 0),
      fromPolygon: list.length === 1 ? list[0]!.from!.polygon : undefined,
      fromPose: list.length === 1 ? list[0]!.from!.pose : undefined,
    });
  }

  // Positions vacated so far: item id → the spot it left (for "into X's previous position").
  const vacated = new Map<string, { name: string; polygon: Polygon; z: [number, number] }>();
  for (const r of [...removals, ...vehiclesOut]) vacated.set(r.id, { name: r.name, polygon: r.from!.polygon, z: r.from!.z });

  const depsOf = (id: string): Set<string> => {
    const me = live.get(id)!;
    const out = new Set<string>();
    if (!me.item.to) return out;
    for (const other of pending) {
      if (other === id) continue;
      const o = live.get(other)!;
      if (o.at && blocks(me.item.to, o.at)) out.add(other);
    }
    return out;
  };
  /** Deferred ("cannot move yet") items still in their current spot that block this target. */
  const deferredBlockers = (it: MoveItem): MoveItem[] => (it.to ? deferred.filter((d) => d.from && blocks(it.to!, d.from)) : []);

  const finalMove = (id: string) => {
    const l = live.get(id)!;
    const it = l.item;
    const to = it.to!;
    const prev = [...vacated.entries()].find(([vid, v]) => vid !== id && blocks(to, v));
    const spot = describeSpot(to.polygon, room);
    const into = prev ? `into ${possessive(prev[1].name)} previous position` : `to ${spot}`;
    const rot = rotationDelta(l.at?.pose.rotation ?? to.pose.rotation, to.pose.rotation);
    const parts: string[] = [];
    if (prev) parts.push(`That puts it ${atSpot(spot)}.`);
    if (l.staged) parts.push('Bring it back from its temporary spot.');
    if (rot !== 0) parts.push(`Turn it ${Math.abs(rot)}° ${rot > 0 ? 'clockwise' : 'counterclockwise'}.`);
    if (isHeavy(it)) parts.push(it.mobile ? 'Heavy: roll it on its casters.' : 'Heavy: get a helper or use a dolly.');
    else if (it.mobile) parts.push('Rolls on casters.');
    bump(id);
    steps.push({
      key: l.staged ? `final:${id}` : keyFor(it),
      kind: it.kind === 'vehicle' ? 'vehicle-in' : 'move',
      title: it.kind === 'vehicle' ? `Park ${article(it.name)} ${prev ? into : atSpot(spot)}` : `Move ${article(it.name)} ${into}`,
      detail: parts.join(' '),
      itemIds: [id],
      heavy: isHeavy(it),
      effortKg: effortOf(it),
      fromPolygon: l.at?.polygon,
      toPolygon: to.polygon,
      fromPose: l.at?.pose,
      toPose: to.pose,
    });
    if (l.at) vacated.set(id, { name: it.name, polygon: l.at.polygon, z: l.at.z });
    l.at = to;
    // Once in place, the item is a fixed obstacle for staging searches.
    pending.splice(pending.indexOf(id), 1);
    placed.push({ name: it.name, polygon: to.polygon, z: to.z });
  };
  const placed: FixedObstacle[] = [];

  const stage = (id: string) => {
    const l = live.get(id)!;
    const it = l.item;
    // Staging must avoid: fixed things, placed items, every pending item's current spot and every
    // pending item's TARGET (so it never blocks a later move).
    const occupied: FixedObstacle[] = [
      ...fixed,
      ...placed,
      ...pending.filter((p) => p !== id).flatMap((p) => {
        const o = live.get(p)!;
        const out: FixedObstacle[] = [];
        if (o.at) out.push({ name: o.item.name, polygon: o.at.polygon, z: o.at.z });
        if (o.item.to) out.push({ name: o.item.name, polygon: o.item.to.polygon, z: o.item.to.z });
        return out;
      }),
      ...(it.to ? [{ name: it.name, polygon: it.to.polygon, z: it.to.z }] : []),
      ...additions.filter((a) => a.to).map((a) => ({ name: a.name, polygon: a.to!.polygon, z: a.to!.z })),
    ];
    const near = l.at ? { x: l.at.pose.x, y: l.at.pose.y } : centroid(room.polygon);
    const spot = it.kind === 'vehicle' ? null : findStagingSpot(it, room, occupied, near, input.stagingStep ?? 150);
    const region = l.at ? regionName(centroid(l.at.polygon), roomBox) : 'room';
    bump(id);
    stagedIds.push(id);
    const where = spot ? `open floor in the ${regionName({ x: spot.pose.x, y: spot.pose.y }, roomBox)}` : 'outside the garage (driveway)';
    steps.push({
      key: `stage:${id}`,
      kind: 'stage',
      title: it.kind === 'vehicle' ? `Drive ${article(it.name)} out temporarily` : `Clear the ${region}`,
      detail:
        it.kind === 'vehicle'
          ? 'Its spot is needed before it can park in its new position. You will park it again later.'
          : `Move ${article(it.name)} temporarily to ${where}. Its spot is needed first; it goes to its final place in a later step.`,
      itemIds: [id],
      heavy: isHeavy(it),
      effortKg: effortOf(it),
      fromPolygon: l.at?.polygon,
      toPolygon: spot?.polygon,
      fromPose: l.at?.pose,
      toPose: spot?.pose,
      finalStepKey: `final:${id}`,
    });
    if (l.at) vacated.set(id, { name: it.name, polygon: l.at.polygon, z: l.at.z });
    l.at = spot;
    l.staged = true;
  };

  // 2. Main loop.
  let guard = pending.length * 4 + 10;
  while (pending.length && guard-- > 0) {
    const deps = new Map(pending.map((id) => [id, depsOf(id)]));
    const ready = pending.filter((id) => deps.get(id)!.size === 0 && deferredBlockers(live.get(id)!.item).length === 0);
    if (ready.length) {
      // Prefer moves that unblock others, then heavy items (moved once, straight to their spot).
      const unblocks = (id: string) => pending.filter((p) => deps.get(p)!.has(id)).length;
      ready.sort((a, b) => unblocks(b) - unblocks(a) || effortOf(live.get(b)!.item) - effortOf(live.get(a)!.item) || live.get(a)!.item.name.localeCompare(live.get(b)!.item.name));
      finalMove(ready[0]!);
      continue;
    }
    // Nothing is ready: find dependency cycles among pending items.
    const comps = stronglyConnected(pending, deps).filter((c) => c.length > 1);
    if (!comps.length) break; // everything left waits on deferred items
    const candidates = comps.flat().filter((id) => live.get(id)!.at !== null);
    if (!candidates.length) break;
    candidates.sort((a, b) => effortOf(live.get(a)!.item) - effortOf(live.get(b)!.item) || live.get(a)!.item.name.localeCompare(live.get(b)!.item.name));
    stage(candidates[0]!);
  }

  // Items still pending wait on deferred items.
  for (const id of [...pending]) {
    const it = live.get(id)!.item;
    const blockers = deferredBlockers(it);
    steps.push({
      key: `wait:${id}`,
      kind: 'waiting',
      title: `Move ${article(it.name)} to ${it.to ? describeSpot(it.to.polygon, room) : 'its new spot'} (waiting)`,
      detail: blockers.length
        ? `Its new spot is still occupied by ${joinNames(blockers.map((b) => article(b.name)))}, which you marked "Cannot move yet".`
        : 'Its new spot is still occupied.',
      itemIds: [id],
      heavy: isHeavy(it),
      effortKg: effortOf(it),
      fromPolygon: live.get(id)!.at?.polygon,
      toPolygon: it.to?.polygon,
      fromPose: live.get(id)!.at?.pose,
      toPose: it.to?.pose,
      waitingOn: blockers.map((b) => b.name),
    });
  }

  // 3. New items.
  for (const it of additions) {
    bump(it.id);
    steps.push({
      key: keyFor(it),
      kind: it.kind === 'vehicle' ? 'vehicle-in' : 'bring-in',
      title: it.kind === 'vehicle' ? `Park ${article(it.name)} ${atSpot(describeSpot(it.to!.polygon, room))}` : `Bring in ${article(it.name)} and place it ${atSpot(describeSpot(it.to!.polygon, room))}`,
      detail: it.kind === 'vehicle' ? 'Everything else is in place; pull in last.' : 'It is new in the target layout.',
      itemIds: [it.id],
      heavy: isHeavy(it),
      effortKg: effortOf(it),
      toPolygon: it.to!.polygon,
      toPose: it.to!.pose,
    });
  }
  // Vehicles parked at the very end read better than mid-sequence: move vehicle-in steps last.
  const vehicleIn = steps.filter((s) => s.kind === 'vehicle-in');
  const ordered = [...steps.filter((s) => s.kind !== 'vehicle-in'), ...vehicleIn];

  // 4. Deferred items.
  for (const it of deferred) {
    ordered.push({
      key: keyFor(it),
      kind: 'deferred',
      title: it.to ? `Move ${article(it.name)} to ${describeSpot(it.to.polygon, room)}` : `Take ${article(it.name)} out of the garage`,
      detail: 'Marked "Cannot move yet". Do this when it becomes possible.',
      itemIds: [it.id],
      heavy: isHeavy(it),
      effortKg: effortOf(it),
      fromPolygon: it.from?.polygon,
      toPolygon: it.to?.polygon,
      fromPose: it.from?.pose,
      toPose: it.to?.pose,
    });
  }

  const repeatedHeavyIds = [...moveCount.entries()].filter(([id, n]) => n > 1 && isHeavy(items.find((i) => i.id === id)!)).map(([id]) => id);
  return {
    steps: ordered,
    totalMoves: [...moveCount.values()].reduce((a, b) => a + b, 0),
    stagedIds,
    repeatedHeavyIds,
    notes,
  };
}

function doneStep(it: MoveItem, key: string, room: PlannerInput['room']): MoveStep {
  return {
    key,
    kind: it.kind === 'vehicle' ? (it.to ? 'vehicle-in' : 'vehicle-out') : it.to ? (it.from ? 'move' : 'bring-in') : 'clear',
    title: it.to ? `Move ${article(it.name)} to ${describeSpot(it.to.polygon, room)}` : `Take ${article(it.name)} out of the garage`,
    detail: 'Already moved.',
    itemIds: [it.id],
    heavy: false,
    effortKg: effortOf(it),
    fromPolygon: it.from?.polygon,
    toPolygon: it.to?.polygon,
    fromPose: it.from?.pose,
    toPose: it.to?.pose,
  };
}

/** Stable step key for an item's (main) step. */
export function keyFor(it: MoveItem, groupIds?: string[]): string {
  if (groupIds && groupIds.length > 1) return `clear:${[...groupIds].sort().join(',')}`;
  if (it.from && !it.to) return it.kind === 'vehicle' ? `out:${it.id}` : `remove:${it.id}`;
  if (!it.from && it.to) return `add:${it.id}`;
  return `move:${it.id}`;
}

/**
 * "against the North wall", "against the East wall (south)", "in the northeast corner",
 * "in the middle of the room". Named wall segments carry a "(south)"-style suffix, so the wall
 * test cannot anchor on the end of the string.
 */
export function atSpot(spot: string): string {
  if (/^the corner of/i.test(spot)) return `in ${spot}`;
  return /\bwalls?\b/i.test(spot) ? `against ${spot}` : `in ${spot}`;
}

function possessive(name: string): string {
  const n = article(name);
  return n.endsWith('s') ? `${n}'` : `${n}'s`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Signed smallest rotation from a to b in degrees, rounded to 1° (positive = clockwise). */
export function rotationDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return Math.round(d);
}
