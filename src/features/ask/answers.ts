/**
 * "Ask the Layout" (pure): answers computational questions from the project's actual geometry.
 * Every answer carries the measured numbers and what to highlight on the plan.
 *
 *   What is the narrowest walkway?            How much space is behind the car?
 *   Can I open the driver door?               Which tools have clearance conflicts?
 *   How much open floor area do I have?       Which tool is farthest from an outlet?
 *   How many feet of wall are unused?         Could a 48 x 24 cabinet fit anywhere along the west wall?
 */
import { buildAnalysisContext, runAnalyzers, type AnalysisContext } from '@/analysis';
import { roomGeometry, wallGeomById } from '@/domain/resolve';
import { formatLength, parseLength, toFeet, type LengthUnit } from '@/domain/units';
import type { EntityRef, Project } from '@/domain/schema';
import { centroid, pointSegmentDistance, polygonSegments, segmentSegmentDistance, walkingDistance, type Point, type Polygon } from '@/geometry';
import { aisleWidthOf, narrowestPath, pathReports, walkability } from '@/features/walkability/model';
import { outletDistances, outletReachLimit, vehicleFacts, workSurfaceAccess, type VehicleSideName } from '@/features/scenarios/facts';
import { spaceReport, wallReports } from '@/features/utilization/model';
import { workflowTotal } from '@/features/workflow/model';
import { fitSearch } from '@/features/fitcheck/search';
import { buildCatalog, resolveMention, resolveWalls } from '@/features/commands/nl/entities';
import { normalize } from '@/features/commands/nl/text';

export interface AnswerHighlight {
  refs: EntityRef[];
  polygons: Polygon[];
  points: Point[];
  lines: Array<[Point, Point]>;
}

export interface Answer {
  question: string;
  /** One-sentence answer with numbers. */
  text: string;
  /** Supporting facts ("Driver side: 3 3/4" to the tool cabinet"). */
  details: string[];
  /** Key numbers (label → formatted value). */
  numbers: Array<{ label: string; value: string }>;
  highlight: AnswerHighlight;
  /** Which question type answered it (for tests / analytics-free debugging). */
  topic: string;
}

export type AskResult = { ok: true; answer: Answer } | { ok: false; reason: string; suggestions: string[] };

export const ASK_EXAMPLES = [
  'What is the narrowest walkway?',
  'How much space is behind the car?',
  'Can I open the driver door?',
  'Which tools have clearance conflicts?',
  'How much open floor area do I have?',
  'Which tool is farthest from an outlet?',
  'How many feet of wall are unused?',
  'Could a 48 x 24 cabinet fit anywhere along the west wall?',
  'How many collisions are there?',
  'How far do I walk between workflow steps?',
  'How much room is in front of the workbench?',
  'How big is the garage?',
  'How far is the table saw from the workbench?',
  'Where is the water heater?',
  'Could I put a 48 x 24 cabinet anywhere else?',
];

const empty = (): AnswerHighlight => ({ refs: [], polygons: [], points: [], lines: [] });

interface Q {
  ctx: AnalysisContext;
  fmt(mm: number): string;
  unit: LengthUnit;
  question: string;
  text: string;
}

function answer(q: Q, topic: string, text: string, extra: Partial<Omit<Answer, 'question' | 'text' | 'topic'>> = {}): AskResult {
  return { ok: true, answer: { question: q.question, text, topic, details: extra.details ?? [], numbers: extra.numbers ?? [], highlight: extra.highlight ?? empty() } };
}

function narrowestWalkway(q: Q): AskResult {
  const { ctx } = q;
  if (!ctx.hasRoom) return answer(q, 'walkway', 'Draw the room first: walkways are measured inside it.');
  const aisle = aisleWidthOf(ctx);
  const n = narrowestPath(ctx, aisle);
  const reports = pathReports(ctx, aisle);
  if (!n) {
    if (reports.length === 0) return answer(q, 'walkway', 'There are no doors or no benches/tools/storage to walk between yet, so there is no main path to measure.');
    const b = reports.find((r) => r.blocked)!;
    return answer(q, 'walkway', `There is no walkable path at all from ${b.entry.label} to the ${b.destination.name}.`, { highlight: { ...empty(), refs: [b.destination.ref], points: [b.destination.point] } });
  }
  const below = reports.filter((r) => !r.blocked && r.width < aisle).length;
  return answer(q, 'walkway', `The narrowest main walkway is ${q.fmt(n.width)}, on the path from ${n.entry.label} to the ${n.destination.name}, beside ${n.beside.name}.`, {
    numbers: [
      { label: 'Narrowest', value: q.fmt(n.width) },
      { label: 'Aisle target', value: q.fmt(aisle) },
      { label: 'Paths below target', value: `${below} of ${reports.length}` },
    ],
    details: [`Measured on a 2" grid (±2") along the widest possible route; the first and last 2' of each route are ignored because endpoints naturally sit next to things.`],
    highlight: {
      refs: [n.destination.ref, ...(n.beside.ref ? [n.beside.ref] : [])],
      polygons: [],
      points: [n.point],
      lines: n.route.slice(1).map((p, i) => [n.route[i]!, p] as [Point, Point]),
    },
  });
}

const SIDE_OF: Array<[RegExp, VehicleSideName]> = [
  [/\b(behind|rear|back|trunk|tailgate|hatch)\b/, 'rear'],
  [/\b(front|ahead|hood|nose)\b/, 'front'],
  [/\b(driver|driver's|drivers|left)\b/, 'driver'],
  [/\b(passenger|passenger's|right)\b/, 'passenger'],
];

function pickVehicle(q: Q) {
  const vs = q.ctx.vehicles;
  if (vs.length <= 1) return vs[0];
  return vs.find((v) => v.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && q.text.includes(w))) ?? vs[0];
}

function vehicleSpace(q: Q): AskResult | null {
  const sideRule = SIDE_OF.find(([re]) => re.test(q.text));
  if (!sideRule) return null;
  const v = pickVehicle(q);
  if (!v) return answer(q, 'vehicle-space', 'There is no vehicle in this layout. Add one from the Vehicles panel.');
  const side = sideRule[1];
  const f = vehicleFacts(q.ctx, v);
  const g = f.sides[side];
  const where = side === 'rear' ? 'behind' : side === 'front' ? 'in front of' : `on the ${side} side of`;
  if (!Number.isFinite(g.clear)) return answer(q, 'vehicle-space', `Nothing is ${where} the ${v.name}; the space is open.`, { highlight: { ...empty(), refs: [{ kind: 'vehicle', id: v.id }] } });
  const ok = g.clear >= g.desired;
  return answer(q, 'vehicle-space', `There is ${q.fmt(g.clear)} ${where} the ${v.name}, up to ${g.against}${ok ? '' : `, less than the ${q.fmt(g.desired)} you want`}.`, {
    numbers: [
      { label: 'Clear', value: q.fmt(g.clear) },
      { label: 'Desired', value: q.fmt(g.desired) },
    ],
    details: ['driver', 'passenger', 'front', 'rear'].map((s) => {
      const x = f.sides[s as VehicleSideName];
      return `${s[0]!.toUpperCase()}${s.slice(1)}: ${Number.isFinite(x.clear) ? `${q.fmt(x.clear)} to ${x.against}` : 'open'} (want ${q.fmt(x.desired)})`;
    }),
    highlight: { refs: [{ kind: 'vehicle', id: v.id }], polygons: [], points: [g.to], lines: [[g.from, g.to]] },
  });
}

function doorOpen(q: Q): AskResult | null {
  if (!/\bdoors?\b/.test(q.text) || !/\b(open|get out|exit|swing)\b/.test(q.text) || /\bgarage\b/.test(q.text)) return null;
  const v = pickVehicle(q);
  if (!v) return answer(q, 'vehicle-door', 'There is no vehicle in this layout.');
  const f = vehicleFacts(q.ctx, v);
  const wantPassenger = /\bpassenger\b/.test(q.text);
  const wantRear = /\b(rear|back)\b/.test(q.text);
  const all = /\b(doors|all|every)\b/.test(q.text) && !/\b(driver|passenger)\b/.test(q.text);
  const doors = f.doors.filter((d) => all || ((wantPassenger ? d.id.startsWith('passenger') : d.id.startsWith('driver')) && (wantRear ? d.id.endsWith('rear') : d.id.endsWith('front'))));
  if (doors.length === 0) return answer(q, 'vehicle-door', `The ${v.name} has no such door.`);
  const lines = doors.map((d) =>
    d.fullyOpens
      ? `Yes, the ${d.label} opens fully (${d.openAngle}°).`
      : d.maxAngle >= 40
        ? `Partly: the ${d.label} opens ${d.maxAngle}° of ${d.openAngle}° before hitting ${d.blockedBy ?? 'something'}, leaving about ${q.fmt(d.egressGap)} to get out.`
        : `Barely: the ${d.label} opens only ${d.maxAngle}° before hitting ${d.blockedBy ?? 'something'} (about ${q.fmt(d.egressGap)} of gap); getting out would be hard.`,
  );
  return answer(q, 'vehicle-door', lines[0]!, {
    details: lines.slice(1),
    numbers: doors.map((d) => ({ label: d.label, value: `${d.maxAngle}° of ${d.openAngle}°` })),
    highlight: { ...empty(), refs: [{ kind: 'vehicle', id: v.id }] },
  });
}

function clearanceConflicts(q: Q): AskResult {
  const ws = runAnalyzers(q.ctx, ['clearance']).filter((w) => w.acknowledged !== 'ignored');
  if (ws.length === 0) return answer(q, 'clearance', 'No tool has a blocked working or maintenance clearance.');
  const owners = new Map<string, { name: string; msgs: string[] }>();
  for (const w of ws) {
    const o = w.involved.find((r) => r.kind === 'object');
    if (!o) continue;
    const name = q.ctx.objectById.get(o.id)?.name ?? 'An item';
    const e = owners.get(o.id) ?? { name, msgs: [] };
    e.msgs.push(w.message);
    owners.set(o.id, e);
  }
  const names = [...owners.values()].map((x) => x.name);
  return answer(q, 'clearance', `${names.length} item${names.length === 1 ? ' has' : 's have'} clearance conflicts: ${names.join(', ')}.`, {
    numbers: [{ label: 'Conflicts', value: String(ws.length) }],
    details: ws.map((w) => w.message),
    highlight: { refs: [...owners.keys()].map((id) => ({ kind: 'object' as const, id })), polygons: ws.flatMap((w) => (w.highlight.regions ?? []).map((r) => r.outer)), points: [], lines: [] },
  });
}

function openFloor(q: Q): AskResult {
  if (!q.ctx.hasRoom) return answer(q, 'space', 'Draw the room first.');
  const s = spaceReport(q.ctx);
  return answer(q, 'space', `You have ${q.ctx.fmtArea(s.openArea)} of open floor, ${s.pct.open.toFixed(0)}% of the ${q.ctx.fmtArea(s.roomArea)} room.`, {
    numbers: [
      { label: 'Open floor', value: `${q.ctx.fmtArea(s.openArea)} (${s.pct.open.toFixed(0)}%)` },
      { label: 'Object & vehicle footprint', value: `${q.ctx.fmtArea(s.footprintArea)} (${s.pct.footprint.toFixed(0)}%)` },
      { label: 'Permanent obstructions', value: `${q.ctx.fmtArea(s.obstructionArea)} (${s.pct.obstruction.toFixed(0)}%)` },
    ],
    details: ['Clearance zones are not counted as occupied; only physical footprints are.'],
  });
}

function farthestOutlet(q: Q): AskResult {
  const list = outletDistances(q.ctx);
  const limit = outletReachLimit(q.ctx);
  if (list.length === 0) return answer(q, 'electrical', 'No item in this layout lists an electrical requirement (set one in the inspector).');
  const far = [...list].sort((a, b) => b.distance - a.distance);
  const f = far[0]!;
  const text = Number.isFinite(f.distance)
    ? `The ${f.object.name} is farthest from a suitable outlet: ${q.fmt(f.distance)} to the ${f.outletName} (${f.requirement.voltage}V).`
    : `The ${f.object.name} needs ${f.requirement.voltage}V and there is no ${f.requirement.voltage}V outlet in the project.`;
  return answer(q, 'electrical', text, {
    details: far.map((d) => `${d.object.name} (${d.requirement.voltage}V ${d.requirement.amperage}A): ${Number.isFinite(d.distance) ? `${q.fmt(d.distance)} to ${d.outletName}` : 'no suitable outlet'}${d.tooFar ? `, beyond ${q.fmt(limit)}` : ''}`),
    numbers: [{ label: 'Farthest', value: Number.isFinite(f.distance) ? q.fmt(f.distance) : 'none' }],
    highlight: { refs: [{ kind: 'object', id: f.object.id }], polygons: [], points: f.outletPoint ? [f.outletPoint] : [], lines: f.outletPoint ? [[{ x: f.object.pose.x, y: f.object.pose.y }, f.outletPoint]] : [] },
  });
}

function unusedWall(q: Q): AskResult {
  if (!q.ctx.hasRoom) return answer(q, 'walls', 'Draw the room first.');
  const w = wallReports(q.ctx);
  const total = w.reduce((s, r) => s + r.linear.available, 0);
  const len = w.reduce((s, r) => s + r.linear.length, 0);
  const ft = toFeet(total);
  const lead = q.ctx.project.settings.unitSystem === 'imperial' ? `About ${ft.toFixed(1)} feet of wall (${q.fmt(total)})` : `About ${q.fmt(total)} of wall`;
  return answer(q, 'walls', `${lead} is unused: nothing stands against it and it is not a door or window.`, {
    numbers: [
      { label: 'Unused', value: q.fmt(total) },
      { label: 'Total wall', value: q.fmt(len) },
    ],
    details: w.map((r) => `${r.linear.wallName}: ${q.fmt(r.linear.available)} free of ${q.fmt(r.linear.length)}`),
  });
}

function couldFit(q: Q): AskResult | null {
  const m = /(\d+(?:\.\d+)?\s*(?:"|''|in(?:ch(?:es)?)?|'|ft|feet|mm|cm)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?\s*(?:"|''|in(?:ch(?:es)?)?|'|ft|feet|mm|cm)?)(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?\s*(?:"|''|in(?:ch(?:es)?)?|'|ft|feet|mm|cm)?))?/.exec(q.text);
  // "fit", but also "could I put a 48 x 24 cabinet anywhere else?" (the brief's sample sentence).
  if (!m || !/\b(fit|fits|room|space|place|put|stand|go|anywhere|somewhere|else|instead)\b/.test(q.text)) return null;
  const parse = (s: string) => {
    const r = parseLength(s.trim(), { defaultUnit: q.unit });
    return r.ok ? r.mm : null;
  };
  const w = parse(m[1]!);
  const d = parse(m[2]!);
  const h = m[3] ? parse(m[3]) : null;
  if (!w || !d) return null;
  const what = /\b(cabinet|bench|workbench|shelf|shelving|rack|table|cart|item|tool)\b/.exec(q.text)?.[1] ?? 'item';
  const walls = /\bwall\b/.test(q.text) ? resolveWalls(q.ctx.project, q.text) : [];
  const height = h ?? 900;
  let locs = fitSearch(q.ctx.project, q.ctx.scenario.id, { width: w, depth: d, height, includeFloor: walls.length === 0 });
  if (walls.length) locs = locs.filter((l) => l.wallIndex !== undefined && walls.some((x) => x.index === l.wallIndex));
  const size = `${q.fmt(w)} × ${q.fmt(d)}${h ? ` × ${q.fmt(h)}` : ''}`;
  const where = walls.length ? ` along the ${walls.map((x) => x.name).join(' / ')}` : '';
  if (locs.length === 0) {
    return answer(q, 'fit', `No, a ${size} ${what} does not fit anywhere${where} right now${walls.length ? '' : ''}.`, {
      details: [walls.length ? 'Try "Will It Fit?" for other walls, corners and open floor.' : 'Every wall run, corner and open-floor spot is too small or blocked.'],
    });
  }
  const lines = locs.slice(0, 6).map((l) => (l.kind === 'floor' ? `Open floor${l.rotated ? ' (turned 90°)' : ''}` : l.kind === 'corner' ? `${l.location}: fits with ${q.fmt(l.remaining)} remaining` : `${l.location}: ${q.fmt(l.available)} available${l.rotated ? ' (turned sideways)' : ''}`));
  return answer(q, 'fit', `Yes, a ${size} ${what} fits in ${locs.length} place${locs.length === 1 ? '' : 's'}${where}. Best: ${lines[0]}.`, {
    details: lines,
    numbers: [{ label: 'Locations', value: String(locs.length) }],
    highlight: { refs: [], polygons: locs.slice(0, 6).map((l) => l.footprint), points: [], lines: [] },
  });
}

/** "How far is the table saw from the workbench?": straight line and, when possible, walking. */
function distanceBetween(q: Q): AskResult | null {
  const m = /\b(?:how far|distance)\b[^a-z0-9]*(?:is|are|between|from)?\s*(.+?)\s+(?:from|to|and)\s+(.+?)[?.]?$/.exec(q.text);
  if (!m) return null;
  const catalog = buildCatalog(q.ctx.project, q.ctx.scenario.id);
  const a = resolveMention(m[1]!, catalog);
  const b = resolveMention(m[2]!, catalog);
  if (a.status !== 'ok' || b.status !== 'ok') return null;
  const pa = entityCenter(q, a.refs[0]!);
  const pb = entityCenter(q, b.refs[0]!);
  if (!pa || !pb) return null;
  const straight = Math.hypot(pa.point.x - pb.point.x, pa.point.y - pb.point.y);
  const gap = pa.polygon && pb.polygon ? polygonGap(pa.polygon, pb.polygon) : null;
  const walk = walkability(q.ctx, aisleWidthOf(q.ctx));
  const walked = walk ? walkingDistance(walk, pa.point, pb.point) : null;
  const details = [
    `Center to center: ${q.fmt(straight)}`,
    ...(gap !== null ? [`Closest gap between them: ${gap <= 0 ? 'they touch or overlap' : q.fmt(gap)}`] : []),
    ...(walked !== null ? [`Walking around obstacles: about ${q.fmt(walked)}`] : ['No walkable route between them was found.']),
  ];
  return answer(q, 'distance', `The ${pa.name} is ${q.fmt(straight)} from the ${pb.name} (center to center${gap !== null && gap > 0 ? `, ${q.fmt(gap)} apart at their closest` : ''}).`, {
    details,
    numbers: [{ label: 'Straight', value: q.fmt(straight) }, ...(walked !== null ? [{ label: 'Walking', value: q.fmt(walked) }] : [])],
    highlight: { refs: [a.refs[0]!, b.refs[0]!], polygons: [], points: [pa.point, pb.point], lines: [[pa.point, pb.point]] },
  });
}

/** "Where is the water heater?": say where it is and select/zoom to it. */
function locate(q: Q): AskResult | null {
  const m = /^(?:where(?:'s| is| are)?|find|show me|locate)\s+(.+?)[?.]?$/.exec(q.text);
  if (!m) return null;
  const catalog = buildCatalog(q.ctx.project, q.ctx.scenario.id);
  const r = resolveMention(m[1]!, catalog);
  if (r.status !== 'ok') return null;
  const e = entityCenter(q, r.refs[0]!);
  if (!e) return null;
  const walls = q.ctx.room.walls;
  const near = walls.length ? [...walls].map((w) => ({ w, d: pointSegmentDistance(e.point, w.a, w.b) })).sort((x, y) => x.d - y.d)[0] : undefined;
  // A wall-hosted fixture (water heater, panel, door) is "on" its wall, so say where along it.
  const hosted = r.refs[0]!.kind === 'feature' ? q.ctx.features.find((f) => f.id === r.refs[0]!.id)?.feature.placement : undefined;
  const host = hosted?.type === 'wall' ? { wall: wallGeomById(q.ctx.project.room, hosted.wallId), offset: hosted.offset } : undefined;
  const where = host?.wall ? `on the ${host.wall.name}, ${q.fmt(host.offset)} along it from its start` : near ? `${q.fmt(near.d)} from the ${near.w.name}` : 'in the layout';
  return answer(q, 'locate', `The ${e.name} is ${where}. It is selected on the plan.`, {
    details: near ? [`Nearest wall: ${near.w.name} (${q.fmt(near.d)} from its center)`] : [],
    numbers: [{ label: 'x', value: q.fmt(e.point.x) }, { label: 'y', value: q.fmt(e.point.y) }],
    highlight: { refs: [r.refs[0]!], polygons: e.polygon ? [e.polygon] : [], points: [e.point], lines: [] },
  });
}

/** Center (and footprint, when it has one) of an object, vehicle or fixture. */
function entityCenter(q: Q, ref: EntityRef): { name: string; point: Point; polygon?: Polygon } | null {
  if (ref.kind === 'object') {
    const o = q.ctx.objectById.get(ref.id);
    return o ? { name: o.name, point: { x: o.pose.x, y: o.pose.y }, polygon: o.footprint } : null;
  }
  if (ref.kind === 'vehicle') {
    const v = q.ctx.vehicles.find((x) => x.id === ref.id);
    return v ? { name: v.name, point: { x: v.pose.x, y: v.pose.y }, polygon: v.body } : null;
  }
  if (ref.kind === 'feature') {
    const f = q.ctx.features.find((x) => x.id === ref.id);
    if (!f) return null;
    const c = centroid(f.footprint);
    return { name: f.name, point: c, polygon: f.footprint };
  }
  if (ref.kind === 'zone') {
    const z = q.ctx.scenario.zones.find((x) => x.id === ref.id);
    return z ? { name: z.name, point: centroid(z.points) } : null;
  }
  return null;
}

/** Smallest distance between two footprints (0 when they touch or overlap). */
function polygonGap(a: Polygon, b: Polygon): number {
  let best = Infinity;
  for (const [p, q2] of polygonSegments(a)) for (const [r, s2] of polygonSegments(b)) best = Math.min(best, segmentSegmentDistance(p, q2, r, s2));
  return best;
}

function collisions(q: Q): AskResult {
  const ws = runAnalyzers(q.ctx, ['overlap']);
  if (ws.length === 0) return answer(q, 'collisions', 'Nothing overlaps; there are no physical collisions.');
  return answer(q, 'collisions', `${ws.length} physical collision${ws.length === 1 ? '' : 's'}: ${ws.map((w) => w.message).slice(0, 2).join(' ')}`, {
    details: ws.map((w) => w.message),
    numbers: [{ label: 'Collisions', value: String(ws.length) }],
    highlight: { refs: ws.flatMap((w) => w.involved), polygons: ws.flatMap((w) => (w.highlight.regions ?? []).map((r) => r.outer)), points: [], lines: [] },
  });
}

function workflow(q: Q): AskResult {
  const t = workflowTotal(q.ctx);
  if (t.steps === 0) return answer(q, 'workflow', 'No workflow relationships are defined yet. Add them in the Workflow panel (e.g. Lumber rack → Miter saw → Table saw).');
  return answer(q, 'workflow', `Walking every workflow step once is about ${q.fmt(t.total)} (${t.steps} step${t.steps === 1 ? '' : 's'}${t.blocked ? `, ${t.blocked} with no walkable route` : ''}).`, {
    numbers: [
      { label: 'Total', value: q.fmt(t.total) },
      { label: 'Steps', value: String(t.steps) },
    ],
  });
}

function frontRoom(q: Q): AskResult | null {
  if (!/\b(in front of|front of)\b/.test(q.text)) return null;
  const list = workSurfaceAccess(q.ctx);
  const target = list.find((s) => q.text.includes(s.object.name.toLowerCase())) ?? (/\b(bench|workbench)\b/.test(q.text) ? list[0] : undefined);
  if (!target) return null;
  return answer(q, 'front', Number.isFinite(target.clear) ? `There is ${q.fmt(target.clear)} of clear floor in front of the ${target.object.name}, up to ${target.against}.` : `The floor in front of the ${target.object.name} is open.`, {
    numbers: [{ label: 'Clear', value: Number.isFinite(target.clear) ? q.fmt(target.clear) : 'open' }],
    highlight: { refs: [{ kind: 'object', id: target.object.id }], polygons: [], points: [target.to], lines: [[target.from, target.to]] },
  });
}

function roomSize(q: Q): AskResult {
  const g = roomGeometry(q.ctx.project.room);
  if (g.polygon.length < 3) return answer(q, 'room', 'There is no room yet. Draw one with the Wall tool or pick a template.');
  const s = spaceReport(q.ctx);
  const xs = g.polygon.map((p) => p.x);
  const ys = g.polygon.map((p) => p.y);
  return answer(q, 'room', `The room is ${q.ctx.fmtArea(s.roomArea)}, about ${q.fmt(Math.max(...xs) - Math.min(...xs))} × ${q.fmt(Math.max(...ys) - Math.min(...ys))} overall, with ${g.walls.length} walls and a ${q.fmt(q.ctx.project.room.ceilingHeight)} ceiling.`, {
    details: g.walls.map((w) => `${w.name}: ${q.fmt(w.length)}`),
  });
}

/** Answer a question about the active (or given) layout. */
export function ask(question: string, project: Project, scenarioId?: string): AskResult {
  const text = normalize(question).replace(/[,]/g, ' ');
  if (!text) return { ok: false, reason: 'Ask a question about the layout.', suggestions: ASK_EXAMPLES.slice(0, 4) };
  const ctx = buildAnalysisContext(project, scenarioId);
  const s = project.settings;
  const q: Q = {
    ctx,
    question: question.trim(),
    text,
    unit: s.unitSystem === 'imperial' ? 'in' : s.metricUnit,
    fmt: (mm) => formatLength(mm, { system: s.unitSystem, precision: s.imperialPrecision, metricUnit: s.metricUnit }),
  };
  const fit = couldFit(q);
  if (fit) return fit;
  const dist = distanceBetween(q);
  if (dist) return dist;
  if (/\b(narrow|narrowest|tightest|pinch|walkway|aisle|path)\b/.test(text) && !/\bdoor\b/.test(text)) return narrowestWalkway(q);
  const door = doorOpen(q);
  if (door) return door;
  if (/\b(car|vehicle|truck|suv|sedan)\b/.test(text) || (q.ctx.vehicles.some((v) => text.includes(v.name.toLowerCase())) && /\b(space|room|clearance|gap)\b/.test(text))) {
    const r = vehicleSpace(q);
    if (r) return r;
  }
  if (/\bclearance\b/.test(text) && /\b(conflict|problem|blocked|issue|which|what)\b/.test(text)) return clearanceConflicts(q);
  if (/\b(open floor|floor area|floor space|open space|free floor|open area)\b/.test(text)) return openFloor(q);
  if (/\b(outlet|power|plug|receptacle|electric)/.test(text)) return farthestOutlet(q);
  if (/\bwall\b/.test(text) && /\b(unused|free|empty|available|open|bare|left)\b/.test(text)) return unusedWall(q);
  if (/\b(collision|collide|overlap|overlapping|hitting)\b/.test(text)) return collisions(q);
  if (/\b(workflow|walk between|steps|travel)\b/.test(text)) return workflow(q);
  const fr = frontRoom(q);
  if (fr) return fr;
  const loc = locate(q);
  if (loc) return loc;
  if (/\b(how big|room size|size of the (?:garage|room|shop)|dimensions|square feet|area of the)\b/.test(text)) return roomSize(q);
  return { ok: false, reason: `I can't answer "${question.trim()}" yet. These questions are computed from your plan:`, suggestions: ASK_EXAMPLES.slice(0, 8) };
}
