/**
 * Deterministic natural-language command interpreter.
 *
 *   "Move the workbench against the north wall"          → object.move (back to the wall)
 *   "Give the WRX 30 inches of driver-side clearance"     → vehicle.update desiredClearance
 *   "Rotate the cabinet 90 degrees"                        → object.move (rotation)
 *   "Put the planer next to the miter saw"                 → object.move (beside, backs aligned)
 *   "Show me everything interfering with the garage door"  → select + highlight (no change)
 *   "Hide the vehicle" / "Duplicate this cabinet" …
 *
 * Output is a typed plan: either `AppCommand`s (validated with `validateCommand`, executed as ONE
 * undoable transaction by the caller) or a view action (select / highlight / overlay). The same
 * `NlResult` shape is what an LLM provider would return (see provider.ts).
 */
import { analyzeLayout } from '@/analysis';
import { validateCommand, type AppCommand } from '@/domain/commands';
import { placeObject } from '@/domain/factories';
import { featureFootprint, getScenario, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { formatLength, type LengthUnit } from '@/domain/units';
import { LAYER_IDS, type EntityRef, type LayerId, type ObjectDefinition, type PlacedObject, type Project } from '@/domain/schema';
import { angleDiff, COMPASS_VECTORS, doorSwingPolygon, localRect, localToWorld, normalizeAngle, pointOnWall, polygonsOverlapOrTouch, rotate, type Polygon, type Pose, type WallGeom } from '@/geometry';
import { buildCatalog, resolveMention, resolveWalls, type CatalogEntry, type Resolution } from './entities';
import { blockedAt, footprintAt, freeRunAlong, offsetAlong, placeAgainstWall, placeBeside, placementObstacles, type Item } from './placement';
import { findAngle, findLength, findLengths, normalize, stem, without, words } from './text';

export interface NlContext {
  project: Project;
  scenarioId?: string;
  selection: readonly EntityRef[];
  /** Object definitions that "add a …" can use (built-in + the user's custom objects). */
  library: readonly ObjectDefinition[];
  /** Deterministic id source for new entities (duplicates, added objects). */
  newId: () => string;
}

export type UiAction =
  | { type: 'select'; refs: EntityRef[]; zoom?: boolean }
  | { type: 'highlight'; refs: EntityRef[]; polygons: Polygon[] }
  | { type: 'overlay'; key: string; on: boolean };

export interface Choice {
  label: string;
  /** Command text that resolves the ambiguity. */
  text: string;
}

export type NlResult =
  | {
      ok: true;
      kind: 'commands';
      /** What will happen, in plain words (the preview). */
      summary: string;
      label: string;
      commands: AppCommand[];
      /** Select these after running. */
      select?: EntityRef[];
      /** Footprints after the change, drawn as ghosts in the preview. */
      ghosts?: Polygon[];
      notes?: string[];
    }
  | { ok: true; kind: 'action'; summary: string; actions: UiAction[]; ghosts?: Polygon[] }
  | { ok: false; reason: string; suggestions: string[]; choices?: Choice[] };

export const EXAMPLES = [
  'Move the workbench against the north wall',
  'Give the sedan 30 inches of driver-side clearance',
  'Rotate the table saw 90 degrees',
  'Put the planer next to the miter saw',
  'Show me everything interfering with the garage door',
  'Hide the vehicle',
  'Duplicate this cabinet',
  'Move the tool cart 12 inches east',
  'Make the workbench 72 inches wide',
  'Add a drill press against the east wall',
  'Roll the planer to its working position',
  'Lock the table saw',
  'Hide the electrical layer',
  'Open the garage door',
  'Switch to layout Workshop mode',
];

const fail = (reason: string, suggestions: string[] = [], choices?: Choice[]): NlResult => ({ ok: false, reason, suggestions: suggestions.length ? suggestions : EXAMPLES.slice(0, 4), choices });

const DIRS: Record<string, { x: number; y: number } | 'local'> = {
  north: COMPASS_VECTORS.north,
  up: COMPASS_VECTORS.north,
  south: COMPASS_VECTORS.south,
  down: COMPASS_VECTORS.south,
  east: COMPASS_VECTORS.east,
  west: COMPASS_VECTORS.west,
  left: 'local',
  right: 'local',
  forward: 'local',
  back: 'local',
  backward: 'local',
  backwards: 'local',
};

interface Env {
  ctx: NlContext;
  project: Project;
  scenarioId: string;
  catalog: CatalogEntry[];
  unit: LengthUnit;
  fmt(mm: number): string;
}

function envOf(ctx: NlContext): Env {
  const s = ctx.project.settings;
  const scenarioId = getScenario(ctx.project, ctx.scenarioId).id;
  return {
    ctx,
    project: ctx.project,
    scenarioId,
    catalog: buildCatalog(ctx.project, scenarioId),
    unit: s.unitSystem === 'imperial' ? 'in' : s.metricUnit,
    fmt: (mm) => formatLength(mm, { system: s.unitSystem, precision: s.imperialPrecision, metricUnit: s.metricUnit }),
  };
}

/** Turn a failed resolution into a helpful answer. */
function unresolved(env: Env, r: Resolution, template: (name: string) => string, what = 'item'): NlResult {
  if (r.status === 'ambiguous') {
    return fail(
      `More than one ${what} matches "${r.mention.trim()}". Which one?`,
      [],
      r.options.slice(0, 6).map((o) => ({ label: o.name, text: template(o.name) })),
    );
  }
  if (r.status === 'empty') return fail(`Select the ${what} on the plan first, or name it (for example "${template('workbench')}").`);
  const names = env.catalog.filter((c) => c.kind === 'object' || c.kind === 'vehicle').slice(0, 6).map((c) => c.name);
  const mention = r.status === 'none' ? r.mention.trim() : '';
  return fail(`I couldn't find anything called "${mention}" in this layout.`, names.map((n) => template(n)));
}

const objRef = (refs: EntityRef[]) => refs.filter((r) => r.kind === 'object');

function object(env: Env, id: string): PlacedObject | undefined {
  return getScenario(env.project, env.scenarioId).objects.find((o) => o.id === id);
}

function itemOf(env: Env, o: PlacedObject): { item: Item; pose: Pose } {
  const r = resolveObject(env.project, o);
  return { item: { fp: r.footprint, bottom: r.elevation, top: r.elevation + r.height }, pose: r.parkedPose };
}

function finish(_env: Env, result: Extract<NlResult, { kind: 'commands' }>): NlResult {
  for (const c of result.commands) {
    const v = validateCommand(c);
    if (!v.ok) return fail(`That would produce an invalid change: ${v.error}`);
  }
  return result;
}

function mentionName(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.length} items`;
}

// ───────────────────────────── intents ─────────────────────────────

function moveAgainstWall(env: Env, mention: string, wallText: string): NlResult {
  const r = resolveMention(mention, env.catalog, { kinds: ['object', 'vehicle'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Move the ${n} against the ${wallText} wall`);
  const walls = resolveWalls(env.project, `${wallText} wall`);
  if (walls.length === 0) return fail(`This room has no "${wallText}" wall. Walls: ${roomGeometry(env.project.room).walls.map((w) => w.name).join(', ')}.`);
  const ref = r.refs[0]!;
  const target = movableAt(env, ref);
  if (!target) return fail('That item can no longer be moved.');
  if (target.locked) return fail(`"${target.name}" is locked. Unlock it first ("unlock the ${target.name}").`);
  const { pose, name } = target;
  const room = roomGeometry(env.project.room).polygon;
  const obstacles = placementObstacles(env.project, env.scenarioId, new Set([ref.id]));
  let best: { pose: Pose; wall: WallGeom; offset: number; d: number; run: number; option: PlaceOption } | null = null;
  for (const [rank, option] of target.options.entries()) {
    for (const w of walls) {
      const p = placeAgainstWall(room, obstacles, option.item, w, offsetAlong(w, pose));
      if (!p) continue;
      const d = Math.hypot(p.pose.x - pose.x, p.pose.y - pose.y);
      const run = freeRunAlong(room, obstacles, option.item, w);
      // Several walls can share a compass name (a jog beside the main run). Prefer the longest free
      // stretch that fits, and only use distance to break a near-tie (R-006).
      const better = !best || run > best.run * 1.05 || (run > best.run * 0.95 && d < best.d);
      if (better) best = { ...p, wall: w, d, run, option };
    }
    // A car parks alongside a wall; only try nose-in when nothing else works.
    if (best && rank === 0) break;
  }
  if (!best) return fail(`There is no free stretch of the ${walls[0]!.name} wide enough for the ${name} (it needs ${env.fmt(target.options[0]!.item.fp.width)}).`, ['Will It Fit? can list other places it fits.']);
  const item = best.option.item;
  const fromStart = best.offset - item.fp.width / 2;
  const finalPose = { ...best.pose, rotation: best.option.rotationAt ? best.option.rotationAt(best.pose.rotation) : best.pose.rotation };
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Move ${name} to the ${best.wall.name}`,
    summary: `Move the ${name} against the ${best.wall.name}, ${best.option.how} (${env.fmt(Math.max(0, fromStart))} from the wall's start, ${env.fmt(best.d)} from where it is now).`,
    commands: [poseCommand(ref, finalPose)],
    select: [ref],
    ghosts: [footprintAt(item, best.pose)],
  });
}

/** One way to stand an item against a wall (a car has two: alongside, or nose-in). */
interface PlaceOption {
  item: Item;
  how: string;
  /** Entity rotation for the placement rotation, when they differ (vehicles parked alongside). */
  rotationAt?: (facing: number) => number;
}

/** An object or a vehicle seen as something that can be placed (R-006: "put the car …"). */
function movableAt(env: Env, ref: EntityRef): { options: PlaceOption[]; pose: Pose; name: string; locked: boolean } | null {
  const s = getScenario(env.project, env.scenarioId);
  if (ref.kind === 'object') {
    const o = s.objects.find((x) => x.id === ref.id);
    if (!o) return null;
    const { item, pose } = itemOf(env, o);
    return { options: [{ item, how: 'back to the wall and facing into the room' }], pose, name: o.label ?? o.name, locked: o.locked };
  }
  if (ref.kind === 'vehicle') {
    const v = s.vehicles.find((x) => x.id === ref.id);
    if (!v) return null;
    const spec = vehicleGeomSpec(v);
    // Mirrors are part of what has to fit against a wall.
    const width = Math.max(spec.width, spec.mirrorsFolded ? (spec.foldedMirrorWidth ?? spec.width) : spec.mirrorWidth);
    const alongside: PlaceOption = {
      item: { fp: { width: spec.length, depth: width }, bottom: 0, top: v.height },
      how: 'parked alongside it',
      // Keep the nose pointing the way it already (roughly) points, parallel to the wall.
      rotationAt: (facing) => {
        const options = [normalizeAngle(facing - 90), normalizeAngle(facing + 90)];
        return Math.abs(angleDiff(v.rotation, options[0]!)) <= Math.abs(angleDiff(v.rotation, options[1]!)) ? options[0]! : options[1]!;
      },
    };
    const noseIn: PlaceOption = { item: { fp: { width, depth: spec.length }, bottom: 0, top: v.height }, how: 'nose in, tail to the room' };
    return { options: [alongside, noseIn], pose: vehiclePose(v), name: v.name, locked: v.locked };
  }
  return null;
}

/** The command that puts an object or vehicle at a pose. */
function poseCommand(ref: EntityRef, pose: Pose): AppCommand {
  return ref.kind === 'vehicle'
    ? { type: 'vehicle.update', payload: { id: ref.id, patch: { x: pose.x, y: pose.y, rotation: pose.rotation } } }
    : { type: 'object.move', payload: { moves: [{ id: ref.id, x: pose.x, y: pose.y, rotation: pose.rotation }] } };
}

function moveBeside(env: Env, mention: string, targetText: string): NlResult {
  const r = resolveMention(mention, env.catalog, { kinds: ['object'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Put the ${n} next to the ${targetText}`);
  const t = resolveMention(targetText, env.catalog, { kinds: ['object', 'vehicle', 'feature'], selection: [] });
  if (t.status !== 'ok') return unresolved(env, t, (n) => `Put the ${mention.replace(/^the /, '')} next to the ${n}`);
  const id = objRef(r.refs)[0]!.id;
  const o = object(env, id)!;
  if (o.locked) return fail(`"${o.name}" is locked. Unlock it first.`);
  const tref = t.refs[0]!;
  if (tref.id === id) return fail('An item cannot go next to itself.');
  let target: { pose: Pose; fp: { width: number; depth: number; offsetX?: number; offsetY?: number } };
  if (tref.kind === 'object') {
    const to = object(env, tref.id)!;
    const tr = resolveObject(env.project, to);
    target = { pose: tr.pose, fp: tr.footprint };
  } else if (tref.kind === 'vehicle') {
    const v = getScenario(env.project, env.scenarioId).vehicles.find((x) => x.id === tref.id)!;
    target = { pose: vehiclePose(v), fp: { width: v.width, depth: v.length } };
  } else {
    const f = env.project.architecture.find((x) => x.id === tref.id)!;
    const poly = featureFootprint(env.project.room, f);
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    target = { pose: { x: cx, y: cy, rotation: 0 }, fp: { width: f.width, depth: f.depth } };
  }
  const { item, pose } = itemOf(env, o);
  const room = roomGeometry(env.project.room).polygon;
  const obstacles = placementObstacles(env.project, env.scenarioId, new Set([id]));
  const p = placeBeside(room, obstacles, item, target, pose);
  if (!p) return fail(`There is no free space right beside the ${t.names[0]} for the ${o.name}. Try "Will It Fit?" or move something first.`);
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Put ${o.name} next to ${t.names[0]}`,
    summary: `Move the ${o.name} next to the ${t.names[0]}, lined up with it (${env.fmt(Math.hypot(p.x - pose.x, p.y - pose.y))} from where it is now).`,
    commands: [{ type: 'object.move', payload: { moves: [{ id, x: p.x, y: p.y, rotation: p.rotation }] } }],
    select: [{ kind: 'object', id }],
    ghosts: [footprintAt(item, p)],
  });
}

function moveBy(env: Env, rest: string): NlResult | null {
  const dirM = /\b(north|south|east|west|up|down|left|right|forward|backwards?|back)\b/.exec(rest);
  const len = findLength(rest, env.unit);
  if (!dirM || !len) return null;
  const mention = without(rest.replace(dirM[0], ' '), [len]).replace(/\b(?:by|to the|towards?|to)\b/g, ' ');
  const r = resolveMention(mention, env.catalog, { kinds: ['object', 'vehicle'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Move the ${n} ${len.text} ${dirM[1]}`);
  const s = getScenario(env.project, env.scenarioId);
  const moves: Array<{ id: string; x: number; y: number }> = [];
  const commands: AppCommand[] = [];
  const ghosts: Polygon[] = [];
  const many = r.refs.length > 1;
  const skipped: string[] = [];
  for (const ref of r.refs) {
    if (ref.kind === 'object') {
      const o = s.objects.find((x) => x.id === ref.id)!;
      if (o.locked) {
        // "Move everything" steps around locked items instead of refusing outright.
        if (!many) return fail(`"${o.name}" is locked. Unlock it first.`);
        skipped.push(o.name);
        continue;
      }
      const d = DIRS[dirM[1]!]!;
      const localDir = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, forward: { x: 0, y: 1 }, back: { x: 0, y: -1 }, backward: { x: 0, y: -1 }, backwards: { x: 0, y: -1 } }[dirM[1] as 'left'];
      const v = d === 'local' ? rotate(localDir, o.rotation) : d;
      const x = o.x + v.x * len.value;
      const y = o.y + v.y * len.value;
      moves.push({ id: o.id, x, y });
      const { item } = itemOf(env, o);
      ghosts.push(footprintAt(item, { x, y, rotation: o.rotation }));
    } else if (ref.kind === 'vehicle') {
      const v = s.vehicles.find((x) => x.id === ref.id)!;
      if (v.locked) {
        if (!many) return fail(`"${v.name}" is locked. Unlock it first.`);
        skipped.push(v.name);
        continue;
      }
      const d = DIRS[dirM[1]!]!;
      const localDir = { left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, forward: { x: 0, y: 1 }, back: { x: 0, y: -1 }, backward: { x: 0, y: -1 }, backwards: { x: 0, y: -1 } }[dirM[1] as 'left'];
      const dv = d === 'local' ? rotate(localDir, v.rotation) : d;
      commands.push({ type: 'vehicle.update', payload: { id: v.id, patch: { x: v.x + dv.x * len.value, y: v.y + dv.y * len.value } } });
    }
  }
  if (moves.length) commands.unshift({ type: 'object.move', payload: { moves } });
  if (commands.length === 0) return fail(`Everything named there is locked. Unlock ${skipped.slice(0, 3).join(', ')} first.`);
  const note = skipped.length ? ` (${skipped.length} locked item${skipped.length === 1 ? '' : 's'} left in place)` : '';
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Move ${mentionName(r.names)}`,
    summary: `Move ${mentionName(r.names)} ${env.fmt(len.value)} ${dirM[1]}${note}.`,
    commands,
    select: r.refs,
    ghosts,
  });
}

function moveTo(env: Env, mention: string, coords: string): NlResult | null {
  const ls = findLengths(coords);
  let xs: number;
  let ys: number;
  if (ls.length >= 2) {
    xs = ls[0]!.value;
    ys = ls[1]!.value;
  } else {
    const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(?:y\s*=?\s*)?(-?\d+(?:\.\d+)?)/.exec(coords.replace(/x\s*=?\s*/, ''));
    if (!m) return null;
    const a = findLength(m[1]!, env.unit);
    const b = findLength(m[2]!, env.unit);
    if (!a || !b) return null;
    xs = a.value;
    ys = b.value;
  }
  const r = resolveMention(mention, env.catalog, { kinds: ['object'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Move the ${n} to ${coords}`);
  const o = object(env, objRef(r.refs)[0]!.id)!;
  if (o.locked) return fail(`"${o.name}" is locked. Unlock it first.`);
  const { item } = itemOf(env, o);
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Move ${o.name}`,
    summary: `Move the ${o.name}'s center to X ${env.fmt(xs)}, Y ${env.fmt(ys)}.`,
    commands: [{ type: 'object.move', payload: { moves: [{ id: o.id, x: xs, y: ys }] } }],
    select: [{ kind: 'object', id: o.id }],
    ghosts: [footprintAt(item, { x: xs, y: ys, rotation: o.rotation })],
  });
}

function rotateCmd(env: Env, rest: string): NlResult {
  const absolute = /\bto\s+-?\d/.test(rest) || /\bface\b/.test(rest);
  const ccw = /\b(?:counter-?clockwise|anti-?clockwise|ccw|left)\b/.test(rest);
  const angle = findAngle(rest.replace(/\b(?:counter-?clockwise|anti-?clockwise|clockwise|ccw|cw)\b/g, ' '));
  const mention = without(rest, [angle]).replace(/\b(?:by|to|counter-?clockwise|anti-?clockwise|clockwise|ccw|cw|left|right|degrees?)\b/g, ' ');
  const r = resolveMention(mention, env.catalog, { kinds: ['object', 'vehicle'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Rotate the ${n} 90 degrees`);
  const deg = angle ? angle.value : 90;
  const s = getScenario(env.project, env.scenarioId);
  const moves: Array<{ id: string; x: number; y: number; rotation: number }> = [];
  const commands: AppCommand[] = [];
  const ghosts: Polygon[] = [];
  const norm = (d: number) => ((Math.round(d * 1000) / 1000) % 360 + 360) % 360;
  const many = r.refs.length > 1;
  const skipped: string[] = [];
  for (const ref of r.refs) {
    if (ref.kind === 'object') {
      const o = s.objects.find((x) => x.id === ref.id)!;
      if (o.locked) {
        // "Move everything" steps around locked items instead of refusing outright.
        if (!many) return fail(`"${o.name}" is locked. Unlock it first.`);
        skipped.push(o.name);
        continue;
      }
      const rotation = norm(absolute ? deg : o.rotation + (ccw ? -deg : deg));
      moves.push({ id: o.id, x: o.x, y: o.y, rotation });
      ghosts.push(footprintAt(itemOf(env, o).item, { x: o.x, y: o.y, rotation }));
    } else if (ref.kind === 'vehicle') {
      const v = s.vehicles.find((x) => x.id === ref.id)!;
      commands.push({ type: 'vehicle.update', payload: { id: v.id, patch: { rotation: norm(absolute ? deg : v.rotation + (ccw ? -deg : deg)) } } });
    }
  }
  if (moves.length) commands.unshift({ type: 'object.move', payload: { moves } });
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Rotate ${mentionName(r.names)}`,
    summary: absolute ? `Set ${mentionName(r.names)} to ${deg}°.` : `Rotate ${mentionName(r.names)} ${deg}° ${ccw ? 'counterclockwise' : 'clockwise'} in place.`,
    commands,
    select: r.refs,
    ghosts,
  });
}

const SIDE_WORDS: Record<string, 'driver' | 'passenger' | 'front' | 'rear'> = { driver: 'driver', drivers: 'driver', passenger: 'passenger', passengers: 'passenger', front: 'front', nose: 'front', hood: 'front', rear: 'rear', back: 'rear', trunk: 'rear', tail: 'rear' };

function vehicleClearance(env: Env, text: string): NlResult | null {
  if (!/\b(?:clearance|space|room|gap)\b/.test(text)) return null;
  const sideM = /\b(drivers?|passengers?|front|nose|hood|rear|back|trunk|tail)(?:'s)?(?:[- ]?side)?\b/.exec(text);
  if (!sideM) return null;
  const len = findLength(text.replace(sideM[0], ' '), env.unit);
  if (!len) return fail('How much clearance? For example "give the car 30 inches of driver-side clearance".');
  const side = SIDE_WORDS[sideM[1]!]!;
  const mention = without(text.replace(sideM[0], ' '), [len]).replace(/^(?:give|set|make|allow|leave|want|need|use)\b/, ' ').replace(/\b(?:of|clearance|space|room|gap|on|at|the|for|to|side|a|an|with|keep|desired|around)\b/g, ' ');
  const catalogV = env.catalog.filter((c) => c.kind === 'vehicle');
  if (catalogV.length === 0) return fail('There is no vehicle in this layout. Add one from the Vehicles panel.');
  let r = resolveMention(mention, catalogV, { selection: env.ctx.selection });
  if (r.status !== 'ok' && catalogV.length === 1 && mention.trim() === '') r = { status: 'ok', refs: [catalogV[0]!.ref], names: [catalogV[0]!.name] };
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Give the ${n} ${env.fmt(len.value)} of ${side}-side clearance`, 'vehicle');
  const v = getScenario(env.project, env.scenarioId).vehicles.find((x) => x.id === r.refs[0]!.id)!;
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `${v.name}: ${side} clearance ${env.fmt(len.value)}`,
    summary: `Set the ${v.name}'s desired ${side}-side clearance to ${env.fmt(len.value)} (was ${env.fmt(v.desiredClearance[side])}). Clearance checks use it immediately.`,
    commands: [{ type: 'vehicle.update', payload: { id: v.id, patch: { desiredClearance: { ...v.desiredClearance, [side]: len.value } } } }],
    select: [{ kind: 'vehicle', id: v.id }],
  });
}

/** Items interfering with an entity: from every analyzer's warnings plus direct geometry. */
export function interferenceWith(project: Project, scenarioId: string, ref: EntityRef): { refs: EntityRef[]; polygons: Polygon[]; reasons: string[] } {
  const found = new Map<string, EntityRef>();
  const polygons: Polygon[] = [];
  const reasons: string[] = [];
  for (const w of analyzeLayout(project, scenarioId)) {
    if (!w.involved.some((r) => r.kind === ref.kind && r.id === ref.id)) continue;
    for (const r of w.involved) if (!(r.kind === ref.kind && r.id === ref.id) && r.kind !== 'wall') found.set(`${r.kind}:${r.id}`, r);
    polygons.push(...(w.highlight.polygons ?? []), ...(w.highlight.regions ?? []).map((x) => x.outer));
    reasons.push(w.message);
  }
  const s = getScenario(project, scenarioId);
  if (ref.kind === 'feature') {
    const f = project.architecture.find((x) => x.id === ref.id);
    const g = roomGeometry(project.room);
    const wall = f?.placement.type === 'wall' ? g.walls[g.wallIndex.get(f.placement.wallId) ?? -1] : undefined;
    if (f && wall && f.placement.type === 'wall') {
      const s0 = f.placement.offset - f.width / 2;
      const s1 = f.placement.offset + f.width / 2;
      const zones: Array<{ poly: Polygon; minTop: number }> = [];
      if (f.kind === 'garage-door') {
        zones.push({ poly: [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, 610), pointOnWall(wall, s0, 610)], minTop: 0 });
        const gd = f.garageDoor;
        if (gd) zones.push({ poly: [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, gd.trackLength), pointOnWall(wall, s0, gd.trackLength)], minTop: gd.trackHeight - 50 });
      } else if (f.kind === 'door' || f.kind === 'double-door') {
        const depth = Math.max(f.width, 800);
        zones.push({ poly: [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, depth), pointOnWall(wall, s0, depth)], minTop: 0 });
      }
      for (const z of zones) {
        for (const o of s.objects) {
          if (o.hidden) continue;
          const r = resolveObject(project, o);
          if (r.elevation + r.height <= z.minTop && z.minTop > 0) continue;
          const fp = objectFootprint(r);
          if (polygonsOverlapOrTouch(fp, z.poly) && !overlapIsTouch(fp, z.poly)) {
            found.set(`object:${o.id}`, { kind: 'object', id: o.id });
            polygons.push(fp);
          }
        }
        for (const v of s.vehicles) {
          if (v.hidden || (z.minTop === 0 && f.kind === 'garage-door')) continue;
          if (z.minTop > 0 && v.height <= z.minTop) continue;
          const body = localRect(v.width, v.length).map((p) => localToWorld(vehiclePose(v), p));
          if (polygonsOverlapOrTouch(body, z.poly)) found.set(`vehicle:${v.id}`, { kind: 'vehicle', id: v.id });
        }
        polygons.push(z.poly);
      }
    }
  } else if (ref.kind === 'vehicle') {
    const v = s.vehicles.find((x) => x.id === ref.id);
    if (v) {
      const spec = vehicleGeomSpec(v);
      for (const d of spec.doors) {
        const swing = doorSwingPolygon(spec, vehiclePose(v), d);
        for (const o of s.objects) {
          if (o.hidden) continue;
          const fp = objectFootprint(resolveObject(project, o));
          if (polygonsOverlapOrTouch(fp, swing) && !overlapIsTouch(fp, swing)) found.set(`object:${o.id}`, { kind: 'object', id: o.id });
        }
      }
    }
  }
  return { refs: [...found.values()], polygons, reasons };
}

/** Touching along an edge is not interference: shrink and re-test. */
function overlapIsTouch(a: Polygon, b: Polygon): boolean {
  const cx = a.reduce((s, p) => s + p.x, 0) / a.length;
  const cy = a.reduce((s, p) => s + p.y, 0) / a.length;
  const shrunk = a.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dx / d) * 5, y: p.y - (dy / d) * 5 };
  });
  return !polygonsOverlapOrTouch(shrunk, b);
}

function showInterfering(env: Env, targetText: string): NlResult {
  const r = resolveMention(targetText, env.catalog, { selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Show me everything interfering with the ${n}`);
  const ref = r.refs[0]!;
  const found = interferenceWith(env.project, env.scenarioId, ref);
  const nameOf = (x: EntityRef) => env.catalog.find((c) => c.ref.kind === x.kind && c.ref.id === x.id)?.name ?? 'an item';
  if (found.refs.length === 0) {
    return { ok: true, kind: 'action', summary: `Nothing is interfering with the ${r.names[0]}.`, actions: [{ type: 'select', refs: [ref] }, { type: 'highlight', refs: [ref], polygons: found.polygons }] };
  }
  return {
    ok: true,
    kind: 'action',
    summary: `${found.refs.length} item${found.refs.length === 1 ? ' interferes' : 's interfere'} with the ${r.names[0]}: ${found.refs.map(nameOf).join(', ')}. They are selected and highlighted.`,
    actions: [
      { type: 'select', refs: found.refs, zoom: true },
      { type: 'highlight', refs: [ref, ...found.refs], polygons: found.polygons },
    ],
  };
}

const LAYER_WORDS: Record<string, LayerId> = Object.fromEntries(LAYER_IDS.map((l) => [l, l])) as Record<string, LayerId>;
Object.assign(LAYER_WORDS, { vehicles: 'vehicle', cars: 'vehicle', zone: 'zones', measurement: 'measurements', dimensions: 'measurements', lights: 'lighting', light: 'lighting', outlets: 'electrical', clearance: 'clearances', tools: 'woodworking' });
const OVERLAYS: Record<string, string> = { clearances: 'clearances', clearance: 'clearances', walkability: 'walkability', walkways: 'walkability', heatmap: 'walkability', workflow: 'workflow', 'workflow lines': 'workflow' };

function hideShow(env: Env, verb: string, rest: string): NlResult {
  const hide = verb === 'hide';
  const bare = rest.replace(/\b(?:the|all|layer|overlay|of)\b/g, ' ').trim();
  if (/\blayer\b/.test(rest) || (LAYER_WORDS[bare] && !resolvesToEntity(env, rest))) {
    const layer = LAYER_WORDS[bare] ?? LAYER_WORDS[stem(bare)];
    if (layer) {
      return finish(env, { ok: true, kind: 'commands', label: `${hide ? 'Hide' : 'Show'} ${layer} layer`, summary: `${hide ? 'Hide' : 'Show'} the ${layer} layer.`, commands: [{ type: 'layer.setVisibility', payload: { layer, visible: !hide } }] });
    }
  }
  const ov = OVERLAYS[bare];
  if (ov && !resolvesToEntity(env, rest)) return { ok: true, kind: 'action', summary: `${hide ? 'Hide' : 'Show'} the ${bare} overlay.`, actions: [{ type: 'overlay', key: ov, on: !hide }] };
  const r = resolveMention(rest, env.catalog, { kinds: ['object', 'vehicle', 'feature', 'zone'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `${hide ? 'Hide' : 'Show'} the ${n}`);
  const commands: AppCommand[] = r.refs.map((ref) => {
    switch (ref.kind) {
      case 'vehicle':
        return { type: 'vehicle.update', payload: { id: ref.id, patch: { hidden: hide } } };
      case 'feature':
        return { type: 'feature.update', payload: { id: ref.id, patch: { hidden: hide } } };
      case 'zone':
        return { type: 'zone.update', payload: { id: ref.id, patch: { hidden: hide } } };
      default:
        return { type: 'object.update', payload: { id: ref.id, patch: { hidden: hide } } };
    }
  });
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `${hide ? 'Hide' : 'Show'} ${mentionName(r.names)}`,
    summary: `${hide ? 'Hide' : 'Show'} ${mentionName(r.names)}.${hide ? ' Hidden items are left out of the analysis; show them again from Layers → Hidden items or by typing "show …".' : ''}`,
    commands,
    select: hide ? [] : r.refs,
  });
}

function resolvesToEntity(env: Env, text: string): boolean {
  return resolveMention(text, env.catalog, { selection: [] }).status === 'ok';
}

function duplicateCmd(env: Env, rest: string): NlResult {
  const r = resolveMention(rest, env.catalog, { kinds: ['object'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Duplicate the ${n}`);
  const ids = objRef(r.refs).map((x) => x.id);
  const idMap = Object.fromEntries(ids.map((id) => [id, env.ctx.newId()]));
  const s = getScenario(env.project, env.scenarioId);
  // Place each copy in the nearest free spot beside the original (fallback: 12" offset).
  const room = roomGeometry(env.project.room).polygon;
  const obstacles = placementObstacles(env.project, env.scenarioId);
  const moves: Array<{ id: string; x: number; y: number; rotation: number }> = [];
  const ghosts: Polygon[] = [];
  for (const id of ids) {
    const o = s.objects.find((x) => x.id === id)!;
    const { item, pose } = itemOf(env, o);
    const p = placeBeside(room, obstacles, item, { pose, fp: item.fp }, pose);
    if (p) {
      moves.push({ id: idMap[id]!, x: p.x, y: p.y, rotation: p.rotation });
      ghosts.push(footprintAt(item, p));
      obstacles.push({ id: idMap[id]!, name: o.name, poly: footprintAt(item, p), box: bboxOf(footprintAt(item, p)), bottom: item.bottom, top: item.top });
    }
  }
  const commands: AppCommand[] = [{ type: 'object.duplicate', payload: { ids, idMap } }];
  if (moves.length) commands.push({ type: 'object.move', payload: { moves } });
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Duplicate ${mentionName(r.names)}`,
    summary: `Duplicate ${mentionName(r.names)}${moves.length === ids.length ? ', placing each copy right beside the original' : ' (offset 12" where there is no free spot beside it)'}.`,
    commands,
    select: ids.map((id) => ({ kind: 'object' as const, id: idMap[id]! })),
    ghosts,
  });
}

function bboxOf(p: Polygon) {
  const xs = p.map((q) => q.x);
  const ys = p.map((q) => q.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function deleteCmd(env: Env, rest: string): NlResult {
  const r = resolveMention(rest, env.catalog, { kinds: ['object', 'vehicle'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Delete the ${n}`);
  const objects = objRef(r.refs).map((x) => x.id);
  const vehicles = r.refs.filter((x) => x.kind === 'vehicle').map((x) => x.id);
  const commands: AppCommand[] = [];
  if (objects.length) commands.push({ type: 'object.delete', payload: { ids: objects } });
  if (vehicles.length) commands.push({ type: 'vehicle.delete', payload: { ids: vehicles } });
  return finish(env, { ok: true, kind: 'commands', label: `Delete ${mentionName(r.names)}`, summary: `Delete ${mentionName(r.names)} from this layout (undo brings ${r.refs.length === 1 ? 'it' : 'them'} back).`, commands });
}

function lockCmd(env: Env, lock: boolean, rest: string): NlResult {
  const r = resolveMention(rest, env.catalog, { kinds: ['object', 'vehicle', 'feature'], selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `${lock ? 'Lock' : 'Unlock'} the ${n}`);
  const commands: AppCommand[] = r.refs.map((ref) =>
    ref.kind === 'vehicle'
      ? { type: 'vehicle.update', payload: { id: ref.id, patch: { locked: lock } } }
      : ref.kind === 'feature'
        ? { type: 'feature.update', payload: { id: ref.id, patch: { locked: lock } } }
        : { type: 'object.update', payload: { id: ref.id, patch: { locked: lock } } },
  );
  return finish(env, { ok: true, kind: 'commands', label: `${lock ? 'Lock' : 'Unlock'} ${mentionName(r.names)}`, summary: `${lock ? 'Lock' : 'Unlock'} ${mentionName(r.names)}${lock ? ' so it cannot be moved by accident' : ''}.`, commands, select: r.refs });
}

const DIM_WORDS: Record<string, 'width' | 'depth' | 'height'> = { wide: 'width', width: 'width', long: 'width', length: 'width', deep: 'depth', depth: 'depth', tall: 'height', high: 'height', height: 'height' };

function resizeCmd(env: Env, text: string): NlResult | null {
  const dimM = /\b(wide|width|long|length|deep|depth|tall|high|height)\b/.exec(text);
  const len = findLengths(text)[0] ?? findLength(text.replace(/^\S+/, ''), env.unit);
  if (!dimM || !len) return null;
  const dim = DIM_WORDS[dimM[1]!]!;
  const mention = without(text.replace(dimM[0], ' '), [len]).replace(/^(?:make|set|resize|change)\b/, ' ').replace(/\b(?:the|of|to|be|at|is|should)\b/g, ' ');
  const r = resolveMention(mention, env.catalog, { kinds: ['object'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Make the ${n} ${env.fmt(len.value)} ${dimM[1]}`);
  const o = object(env, objRef(r.refs)[0]!.id)!;
  if (len.value <= 0) return fail('Sizes must be greater than zero.');
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Resize ${o.name}`,
    summary: `Set the ${o.name}'s ${dim} to ${env.fmt(len.value)} (was ${env.fmt(o[dim])}).`,
    commands: [{ type: 'object.update', payload: { id: o.id, patch: { [dim]: len.value } } }],
    select: [{ kind: 'object', id: o.id }],
  });
}

function findLibraryItem(env: Env, text: string): ObjectDefinition[] {
  const ws = words(text).filter((w) => !['a', 'an', 'another', 'new', 'one', 'the', 'some'].includes(w));
  if (ws.length === 0) return [];
  const scored = env.ctx.library
    .map((d) => {
      const dw = new Set([...words(d.name), ...d.tags.flatMap(words)]);
      if (!ws.every((w) => dw.has(w))) return { d, s: -1 };
      return { d, s: ws.length - 0.01 * (words(d.name).length - ws.length) + (d.source === 'custom' ? 0.001 : 0) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  const top = scored[0]!.s;
  return scored.filter((x) => Math.abs(x.s - top) < 1e-9).map((x) => x.d);
}

function addCmd(env: Env, rest: string): NlResult {
  let itemText = rest;
  let where: { kind: 'wall'; text: string } | { kind: 'beside'; text: string } | null = null;
  const wallM = /\s(?:against|along|on|to)\s+(?:the\s+)?(.+?)\s+wall\b/.exec(rest);
  const besideM = /\s(?:next to|beside|by|near|alongside)\s+(.+)$/.exec(rest);
  if (wallM) {
    where = { kind: 'wall', text: wallM[1]! };
    itemText = rest.slice(0, wallM.index);
  } else if (besideM) {
    where = { kind: 'beside', text: besideM[1]! };
    itemText = rest.slice(0, besideM.index);
  }
  const defs = findLibraryItem(env, itemText);
  if (defs.length === 0) return fail(`The library has nothing called "${itemText.trim()}".`, ['Add a workbench against the north wall', 'Add a drill press', 'Add a base cabinet next to the workbench']);
  if (defs.length > 1) return fail(`Which one?`, [], defs.slice(0, 6).map((d) => ({ label: d.name, text: `Add a ${d.name.toLowerCase()}${where ? (where.kind === 'wall' ? ` against the ${where.text} wall` : ` next to ${where.text}`) : ''}` })));
  const def = defs[0]!;
  const item: Item = { fp: { width: def.width, depth: def.depth }, bottom: def.mount === 'floor' ? 0 : def.defaultElevation, top: (def.mount === 'floor' ? 0 : def.defaultElevation) + def.height };
  const room = roomGeometry(env.project.room).polygon;
  const obstacles = placementObstacles(env.project, env.scenarioId);
  let pose: Pose | null = null;
  let where2 = '';
  if (where?.kind === 'wall') {
    const walls = resolveWalls(env.project, `${where.text} wall`);
    if (!walls.length) return fail(`This room has no "${where.text}" wall.`);
    for (const w of walls) {
      const p = placeAgainstWall(room, obstacles, item, w);
      if (p) {
        pose = p.pose;
        where2 = ` against the ${w.name}`;
        break;
      }
    }
    if (!pose) return fail(`There is no free stretch of the ${walls[0]!.name} wide enough for a ${def.name.toLowerCase()} (${env.fmt(def.width)}).`);
  } else if (where?.kind === 'beside') {
    const t = resolveMention(where.text, env.catalog, { kinds: ['object', 'vehicle'], selection: env.ctx.selection });
    if (t.status !== 'ok') return unresolved(env, t, (n) => `Add a ${def.name.toLowerCase()} next to the ${n}`);
    const tr = t.refs[0]!;
    const s = getScenario(env.project, env.scenarioId);
    const target =
      tr.kind === 'object'
        ? (() => {
            const r = resolveObject(env.project, s.objects.find((o) => o.id === tr.id)!);
            return { pose: r.pose, fp: r.footprint };
          })()
        : (() => {
            const v = s.vehicles.find((x) => x.id === tr.id)!;
            return { pose: vehiclePose(v), fp: { width: v.width, depth: v.length } };
          })();
    pose = placeBeside(room, obstacles, item, target, target.pose);
    if (!pose) return fail(`There is no free space beside the ${t.names[0]} for a ${def.name.toLowerCase()}.`);
    where2 = ` next to the ${t.names[0]}`;
  } else {
    // Anywhere: the first free wall spot (walls in order), else the room center.
    for (const w of roomGeometry(env.project.room).walls) {
      const p = placeAgainstWall(room, obstacles, item, w);
      if (p) {
        pose = p.pose;
        where2 = ` against the ${w.name} (first free wall spot)`;
        break;
      }
    }
    if (!pose) return fail(`I couldn't find a free spot for a ${def.name.toLowerCase()} (${env.fmt(def.width)} × ${env.fmt(def.depth)}).`);
  }
  if (blockedAt(room, obstacles, item, pose)) return fail(`A ${def.name.toLowerCase()} does not fit there.`);
  const obj = placeObject(def, pose, { id: env.ctx.newId() });
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `Add ${def.name}`,
    summary: `Add a ${def.name.toLowerCase()} (${env.fmt(def.width)} × ${env.fmt(def.depth)}, approximate size)${where2}.`,
    commands: [{ type: 'object.add', payload: { objects: [obj], definitions: [def] } }],
    select: [{ kind: 'object', id: obj.id }],
    ghosts: [footprintAt(item, pose)],
  });
}

function positionCmd(env: Env, mention: string, position: 'parked' | 'working'): NlResult {
  const r = resolveMention(mention, env.catalog, { kinds: ['object'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Roll the ${n} to its ${position} position`);
  const o = object(env, objRef(r.refs)[0]!.id)!;
  if (o.mobility !== 'mobile') return fail(`The ${o.name} is not marked mobile. Mark it mobile in the inspector to give it a working position.`);
  if (position === 'working' && !o.working) return fail(`The ${o.name} has no working position yet. Right-click it → "Set working position".`);
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `${o.name}: ${position} position`,
    summary: `Show the ${o.name} at its ${position} position.`,
    commands: [{ type: 'object.update', payload: { id: o.id, patch: { activePosition: position } } }],
    select: [{ kind: 'object', id: o.id }],
  });
}

function openClose(env: Env, open: boolean, rest: string): NlResult {
  const r = resolveMention(rest.replace(/\b(?:wings?|doors?)$/, (m) => (/door/.test(m) && /garage/.test(rest) ? m : ' ')), env.catalog, { kinds: ['feature', 'vehicle', 'object'], selection: env.ctx.selection });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `${open ? 'Open' : 'Close'} the ${n}`);
  const ref = r.refs[0]!;
  if (ref.kind === 'feature') {
    const f = env.project.architecture.find((x) => x.id === ref.id)!;
    if (!f.garageDoor) return fail(`Only garage doors have an open/closed state (the ${f.name} is a ${f.kind.replace(/-/g, ' ')}).`);
    return finish(env, { ok: true, kind: 'commands', label: `${open ? 'Open' : 'Close'} ${f.name}`, summary: `${open ? 'Open' : 'Close'} the ${f.name} (overhead checks use the open position).`, commands: [{ type: 'feature.update', payload: { id: f.id, patch: { garageDoor: { ...f.garageDoor, state: open ? 'open' : 'closed' } } } }] });
  }
  if (ref.kind === 'vehicle') {
    return finish(env, { ok: true, kind: 'commands', label: `${r.names[0]}: doors ${open ? 'open' : 'closed'}`, summary: `Show the ${r.names[0]} with its doors ${open ? 'open' : 'closed'}.`, commands: [{ type: 'vehicle.update', payload: { id: ref.id, patch: { state: open ? 'doors-open' : 'parked' } } }], select: [ref] });
  }
  const o = object(env, ref.id)!;
  const def = resolveObject(env.project, o).definition;
  const want = open ? /(open|deployed|working)/ : /(fold|closed|stored|parked)/;
  const st = def?.states.find((x) => want.test(x.name.toLowerCase()) || want.test(x.id));
  if (!st) return fail(`The ${o.name} has no ${open ? 'open' : 'closed'} state.`);
  return finish(env, { ok: true, kind: 'commands', label: `${o.name}: ${st.name}`, summary: `Switch the ${o.name} to "${st.name}" (clearance checks follow the state).`, commands: [{ type: 'object.update', payload: { id: o.id, patch: { stateId: st.id } } }], select: [ref] });
}

function layoutCmd(env: Env, text: string): NlResult | null {
  const sw = /^(?:switch|go|change|jump)\s+(?:back\s+)?to\s+(?:the\s+)?(?:layout|scenario)?\s*"?(.+?)"?(?:\s+(?:layout|scenario))?$/.exec(text) ?? /^(?:open|show)\s+(?:the\s+)?(?:layout|scenario)\s+"?(.+?)"?$/.exec(text);
  if (sw) {
    const q = sw[1]!.trim();
    const s = env.project.scenarios.find((x) => x.name.toLowerCase() === q) ?? env.project.scenarios.find((x) => x.name.toLowerCase().includes(q));
    if (!s) return fail(`No layout is called "${q}". Layouts: ${env.project.scenarios.map((x) => x.name).join(', ')}.`);
    return finish(env, { ok: true, kind: 'commands', label: `Switch to ${s.name}`, summary: `Switch to the layout "${s.name}".`, commands: [{ type: 'scenario.setActive', payload: { scenarioId: s.id } }] });
  }
  const dup = /^(?:duplicate|copy|clone)\s+(?:this|the current|the)?\s*(?:layout|scenario)(?:\s+(?:as|named|called)\s+"?(.+?)"?)?$/.exec(text);
  if (dup) {
    const cur = getScenario(env.project, env.scenarioId);
    const name = dup[1]?.trim() || `${cur.name} (copy)`;
    return finish(env, { ok: true, kind: 'commands', label: `Duplicate layout as "${name}"`, summary: `Duplicate the layout "${cur.name}" as "${name}" (room shared, arrangement copied) and switch to it.`, commands: [{ type: 'scenario.duplicate', payload: { id: env.ctx.newId(), name } }] });
  }
  return null;
}

function mirrors(env: Env, fold: boolean, rest: string): NlResult {
  const catalogV = env.catalog.filter((c) => c.kind === 'vehicle');
  const mention = rest.replace(/\b(?:mirrors?|'s)\b/g, ' ');
  let r = resolveMention(mention, catalogV, { selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok' && catalogV.length === 1) r = { status: 'ok', refs: [catalogV[0]!.ref], names: [catalogV[0]!.name] };
  if (r.status !== 'ok') return unresolved(env, r, (n) => `${fold ? 'Fold' : 'Unfold'} the ${n}'s mirrors`, 'vehicle');
  return finish(env, {
    ok: true,
    kind: 'commands',
    label: `${fold ? 'Fold' : 'Unfold'} mirrors`,
    summary: `${fold ? 'Fold' : 'Unfold'} the mirrors on ${mentionName(r.names)}.`,
    commands: r.refs.map((ref) => ({ type: 'vehicle.update', payload: { id: ref.id, patch: { mirrorsFolded: fold } } }) as AppCommand),
    select: r.refs,
  });
}

function selectCmd(env: Env, rest: string): NlResult {
  const r = resolveMention(rest, env.catalog, { selection: env.ctx.selection, allowMany: true });
  if (r.status !== 'ok') return unresolved(env, r, (n) => `Select the ${n}`);
  return { ok: true, kind: 'action', summary: `Select ${mentionName(r.names)}.`, actions: [{ type: 'select', refs: r.refs, zoom: true }] };
}

// ───────────────────────────── entry point ─────────────────────────────

/** Interpret one instruction. Pure and deterministic (ids come from `ctx.newId`). */
export function interpret(input: string, ctx: NlContext): NlResult {
  const text = normalize(input);
  if (!text) return fail('Type an instruction, for example "Move the workbench against the north wall".');
  const env = envOf(ctx);
  let m: RegExpExecArray | null;

  if ((m = /^(?:show|find|list|highlight|what|which|tell)(?:\s+me)?\s*(?:is\s+|are\s+)?(?:everything|anything|all|things|items|objects|what)?(?:'s|\s+is|\s+are)?\s*(?:that(?:'s|\s+is|\s+are)?\s+)?(?:interfering with|interferes with|interfere with|blocking|blocks|in the way of|obstructing|conflicting with|hitting|touching)\s+(.+)$/.exec(text))) {
    return showInterfering(env, m[1]!);
  }
  const lay = layoutCmd(env, text);
  if (lay) return lay;

  const vc = /\b(?:give|set|make|allow|leave|want|need|keep|use)\b/.test(text) || /\bclearance\b/.test(text) ? vehicleClearance(env, text) : null;
  if (vc) return vc;

  if ((m = /^(fold|unfold)\s+(.*)mirrors?.*$/.exec(text))) return mirrors(env, m[1] === 'fold', m[2]!);

  if ((m = /^(?:move|put|place|push|shift|slide|set|drag|park|stand)\s+(.+?)\s+(?:up\s+)?(?:against|along|flush (?:with|against)|onto|on|to|by|at)\s+(?:the\s+)?(.+?)\s+wall\b/.exec(text))) {
    return moveAgainstWall(env, m[1]!, m[2]!);
  }
  if ((m = /^(?:roll|move|put|set|switch|bring)\s+(.+?)\s+(?:out\s+|back\s+)?(?:to|into|in)\s+(?:its|their|the)\s+(working|work|use|parked|park|storage|stored)\s*(?:position|spot|pose|location)?$/.exec(text))) {
    return positionCmd(env, m[1]!, /work|use/.test(m[2]!) ? 'working' : 'parked');
  }
  if ((m = /^park\s+(.+)$/.exec(text)) && !resolveMention(m[1]!, env.catalog.filter((c) => c.kind === 'vehicle')).status.startsWith('ok')) {
    return positionCmd(env, m[1]!, 'parked');
  }
  if ((m = /^(?:add|insert|create|place|put)\s+(?:a|an|another|one|new|a new)\s+(.+)$/.exec(text)) || (m = /^(?:add|insert|create)\s+(.+)$/.exec(text))) {
    return addCmd(env, ` ${m[1]!}`.replace(/^ /, ''));
  }
  if ((m = /^(?:move|put|place|set|park|push|slide|bring)\s+(.+?)\s+(?:right\s+)?(?:next to|beside|alongside|adjacent to|close to|near|by)\s+(.+)$/.exec(text))) {
    return moveBeside(env, m[1]!, m[2]!);
  }
  if ((m = /^(?:move|put|place|set)\s+(.+?)\s+to\s+(x\s*=?\s*.+)$/.exec(text)) || (m = /^(?:move|put|place|set)\s+(.+?)\s+(?:to|at)\s+(-?[\d.]+.*[, ]\s*-?[\d.]+.*)$/.exec(text))) {
    const r = moveTo(env, m[1]!, m[2]!);
    if (r) return r;
  }
  if ((m = /^(?:move|shift|nudge|slide|push|drag|scoot|bump)\s+(.+)$/.exec(text))) {
    const r = moveBy(env, m[1]!);
    if (r) return r;
    return fail(`Where should it go? Say a wall ("against the north wall"), an item ("next to the table saw") or a distance ("12 inches east").`, ['Move the workbench against the north wall', 'Move the tool cart 12 inches east', 'Put the planer next to the miter saw']);
  }
  if ((m = /^(?:rotate|turn|spin|swivel)\s+(.+)$/.exec(text))) return rotateCmd(env, m[1]!);
  if ((m = /^(hide|show|unhide|reveal)\s+(.+)$/.exec(text))) return hideShow(env, m[1] === 'hide' ? 'hide' : 'show', m[2]!);
  if ((m = /^(?:duplicate|copy|clone)\s*(.*)$/.exec(text))) return duplicateCmd(env, m[1]!);
  if ((m = /^(?:delete|remove|get rid of|trash|discard)\s+(.+)$/.exec(text))) return deleteCmd(env, m[1]!);
  if ((m = /^(lock|unlock|pin|unpin)\s+(.+)$/.exec(text))) return lockCmd(env, m[1] === 'lock' || m[1] === 'pin', m[2]!);
  if (/^(?:make|set|resize|change)\b/.test(text) || /\b(?:width|depth|height)\b/.test(text)) {
    const r = resizeCmd(env, text);
    if (r) return r;
  }
  if ((m = /^(open|raise|lift|deploy|unfold|close|lower|shut|fold)\s+(.+)$/.exec(text))) return openClose(env, ['open', 'raise', 'lift', 'deploy', 'unfold'].includes(m[1]!), m[2]!);
  if ((m = /^(?:select|pick|find|locate|where is|where's|zoom to)\s+(.+)$/.exec(text))) return selectCmd(env, m[1]!);

  // Not understood: suggest the closest examples by shared words.
  const tw = new Set(words(text));
  const ranked = EXAMPLES.map((e) => ({ e, s: words(e).filter((w) => tw.has(w)).length })).sort((a, b) => b.s - a.s);
  return fail(`I didn't understand "${input.trim()}". Try one of these:`, ranked.slice(0, 4).map((x) => x.e));
}
