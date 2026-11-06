/**
 * Project → move-planner input, and the Current/Target layout diff used by the before/after
 * overlay. Pure (domain + geometry only).
 *
 * Items are matched by id across layouts (duplicating a layout keeps ids; see ARCHITECTURE §4).
 */
import { featureFootprint, getScenario, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose, type ResolvedObject } from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, type Project, type Scenario, type Vehicle } from '@/domain/schema';
import { distance, vehicleBody, type Polygon, type Pose } from '@/geometry';
import type { FixedObstacle, ItemPlacement, MoveItem, PlannerInput, StepStatus } from './planner';

/** A position change smaller than this is "unchanged" (mm / degrees). */
export const MOVE_TOLERANCE_MM = 25;
export const ROTATE_TOLERANCE_DEG = 1;

const LB = 0.45359237;
/** kg per m³ of bounding volume, by category (rough, for ordering heavy vs light items). */
const DENSITY: Record<string, number> = {
  'stationary-tool': 380,
  storage: 170,
  'work-surface': 70,
  'dust-collection': 110,
  misc: 70,
  unknown: 90,
};

/** Known weight, a weight written in the name/label/notes ("350 lb", "80 kg"), or an estimate from size and category. */
export function estimateWeightKg(r: ResolvedObject): { kg: number; estimated: boolean } {
  const known = r.object.weightKg ?? r.definition?.weightKg;
  if (known !== undefined) return { kg: known, estimated: false };
  const text = `${r.object.label ?? ''} ${r.object.name} ${r.object.notes}`;
  const lb = /(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds)\b/i.exec(text);
  if (lb) return { kg: Number(lb[1]) * LB, estimated: false };
  const kg = /(\d+(?:\.\d+)?)\s*kg\b/i.exec(text);
  if (kg) return { kg: Number(kg[1]), estimated: false };
  const volume = (r.footprint.width / 1000) * (r.footprint.depth / 1000) * (r.height / 1000);
  const density = DENSITY[r.category] ?? DENSITY.unknown!;
  // Wall- and ceiling-hung items are light shells; their contents are emptied before moving.
  const factor = r.elevated ? 0.4 : 1;
  return { kg: Math.max(2, Math.round(volume * density * factor)), estimated: true };
}

function objectPlacement(r: ResolvedObject): ItemPlacement {
  return { pose: r.pose, polygon: objectFootprint(r), z: [r.elevation, r.elevation + r.height] };
}

function vehiclePlacement(v: Vehicle): ItemPlacement {
  return { pose: vehiclePose(v), polygon: vehicleBody(vehicleGeomSpec(v), vehiclePose(v)), z: [0, v.height] };
}

function samePose(a: Pose, b: Pose): boolean {
  let d = Math.abs((((a.rotation - b.rotation) % 360) + 360) % 360);
  if (d > 180) d = 360 - d;
  return distance(a, b) <= MOVE_TOLERANCE_MM && d <= ROTATE_TOLERANCE_DEG;
}

function samePolygon(a: Polygon, b: Polygon): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => distance(p, b[i]!) <= MOVE_TOLERANCE_MM);
}

export type DiffKind = 'moved' | 'unchanged' | 'added' | 'removed';

export interface LayoutDiffEntry {
  id: string;
  kind: 'object' | 'vehicle';
  name: string;
  category: string;
  change: DiffKind;
  from: ItemPlacement | null;
  to: ItemPlacement | null;
  weightKg: number;
  weightEstimated: boolean;
  mobile: boolean;
  /** Unchanged position but a different footprint (state change such as wings opened). */
  reconfigured?: boolean;
}

/** Compare two layouts item by item (hidden items are ignored; they are not part of the plan). */
export function diffLayouts(project: Project, current: Scenario, target: Scenario): LayoutDiffEntry[] {
  const out: LayoutDiffEntry[] = [];
  const cur = new Map(current.objects.filter((o) => !o.hidden).map((o) => [o.id, resolveObject(project, o)]));
  const tgt = new Map(target.objects.filter((o) => !o.hidden).map((o) => [o.id, resolveObject(project, o)]));
  for (const id of new Set([...cur.keys(), ...tgt.keys()])) {
    const a = cur.get(id);
    const b = tgt.get(id);
    const r = (b ?? a)!;
    const w = estimateWeightKg(a ?? b!);
    const from = a ? objectPlacement(a) : null;
    const to = b ? objectPlacement(b) : null;
    // A state change in place (e.g. miter-station wings opened) is not a move.
    const change: DiffKind = !a ? 'added' : !b ? 'removed' : samePose(from!.pose, to!.pose) ? 'unchanged' : 'moved';
    const reconfigured = change === 'unchanged' && !samePolygon(from!.polygon, to!.polygon);
    out.push({ id, kind: 'object', name: r.label, category: r.category, change, from, to, weightKg: w.kg, weightEstimated: w.estimated, mobile: r.mobile, reconfigured });
  }
  const curV = new Map(current.vehicles.filter((v) => !v.hidden).map((v) => [v.id, v]));
  const tgtV = new Map(target.vehicles.filter((v) => !v.hidden).map((v) => [v.id, v]));
  for (const id of new Set([...curV.keys(), ...tgtV.keys()])) {
    const a = curV.get(id);
    const b = tgtV.get(id);
    const from = a ? vehiclePlacement(a) : null;
    const to = b ? vehiclePlacement(b) : null;
    const change: DiffKind = !a ? 'added' : !b ? 'removed' : samePose(from!.pose, to!.pose) ? 'unchanged' : 'moved';
    out.push({ id, kind: 'vehicle', name: (b ?? a)!.name, category: 'vehicle', change, from, to, weightKg: 0, weightEstimated: false, mobile: true });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/** Floor architecture that blocks moves (poles, water heater, built-ins…). */
export function fixedArchitecture(project: Project): FixedObstacle[] {
  return project.architecture
    .filter((f) => !OPENING_KINDS.has(f.kind) && !OVERHEAD_KINDS.has(f.kind) && !f.hidden)
    .map((f) => ({ name: f.name, polygon: featureFootprint(project.room, f), z: [f.elevation, f.elevation + f.height] as [number, number] }))
    .filter((f) => f.polygon.length >= 3);
}

export function buildPlannerInput(project: Project, currentId: string, targetId: string, status: Readonly<Record<string, StepStatus>> = {}): { input: PlannerInput; diff: LayoutDiffEntry[] } {
  const current = getScenario(project, currentId);
  const target = getScenario(project, targetId);
  const diff = diffLayouts(project, current, target);
  const g = roomGeometry(project.room);
  const items: MoveItem[] = diff
    .filter((d) => d.change !== 'unchanged')
    .map((d) => ({ id: d.id, kind: d.kind, name: d.name, category: d.category, weightKg: d.weightKg, mobile: d.mobile, from: d.from, to: d.to }));
  const fixed: FixedObstacle[] = [
    ...fixedArchitecture(project),
    ...diff.filter((d) => d.change === 'unchanged').map((d) => ({ name: d.name, polygon: d.to!.polygon, z: d.to!.z })),
  ];
  return { input: { room: { polygon: g.polygon, walls: g.walls }, items, fixed, status }, diff };
}
