/**
 * AnalysisContext: everything analyzers and metrics need, computed ONCE per (project, scenario,
 * options) and memoized by project identity. Analyzers share further expensive results through
 * `ctx.memo(key, fn)` (e.g. a walkability grid used by several checks).
 */
import {
  bbox,
  zoneWorldPolygon,
  type BBox,
  type Polygon,
  type Pose,
  type VehicleGeomSpec,
} from '@/geometry';
import {
  featureFootprint,
  getScenario,
  objectFootprint,
  resolveObject,
  roomGeometry,
  vehicleGeomSpec,
  vehiclePose,
  type ResolvedObject,
  type RoomGeometry,
} from '@/domain/resolve';
import { formatArea, formatLength } from '@/domain/units';
import {
  OPENING_KINDS,
  OVERHEAD_KINDS,
  type ArchitecturalFeature,
  type ClearanceZone,
  type Project,
  type Scenario,
  type Vehicle,
} from '@/domain/schema';
import { vehicleParts } from '@/geometry';
import type { AnalyzeOptions } from './types';

export interface AnalyzedZone {
  zone: ClearanceZone;
  polygon: Polygon;
  /** Human label, e.g. "outfeed" or the zone's custom label. */
  label: string;
}

export interface AnalyzedObject {
  id: string;
  name: string;
  resolved: ResolvedObject;
  pose: Pose;
  footprint: Polygon;
  bbox: BBox;
  /**
   * Pose at which clearance zones are evaluated. Mobile items with a working position are USED
   * there, so their zones are checked at the working pose even while parked (the parked spot only
   * has to physically fit). Otherwise equals `pose`.
   */
  zonePose: Pose;
  /** True when zones are evaluated at a different pose than the footprint (mobile, parked). */
  zonesAtWorkingPosition: boolean;
  zones: AnalyzedZone[];
}

export interface AnalyzedFeature {
  id: string;
  name: string;
  feature: ArchitecturalFeature;
  footprint: Polygon;
  /** Occupies floor space (poles, water heaters, steps…), as opposed to openings and overhead items. */
  blocksFloor: boolean;
}

export interface AnalyzedVehicle {
  id: string;
  name: string;
  vehicle: Vehicle;
  spec: VehicleGeomSpec;
  pose: Pose;
  /** Body + mirrors (world). */
  parts: Polygon[];
  body: Polygon;
}

export interface AnalysisContext {
  project: Project;
  scenario: Scenario;
  options: Required<Pick<AnalyzeOptions, 'includeHidden' | 'positions'>>;
  room: RoomGeometry;
  hasRoom: boolean;
  objects: AnalyzedObject[];
  objectById: Map<string, AnalyzedObject>;
  features: AnalyzedFeature[];
  vehicles: AnalyzedVehicle[];
  fmtLength(mm: number): string;
  fmtArea(mm2: number): string;
  /** Memoize an expensive shared computation for the lifetime of this context. */
  memo<T>(key: string, compute: () => T): T;
}

/** Human label for a clearance zone ("outfeed", "operator", custom label…). */
export function zoneLabel(zone: ClearanceZone): string {
  if (zone.label) return zone.label.toLowerCase();
  return zone.kind === 'operational' ? 'working' : zone.kind;
}

const cache = new WeakMap<Project, Map<string, AnalysisContext>>();

export function buildAnalysisContext(project: Project, scenarioId?: string, options: AnalyzeOptions = {}): AnalysisContext {
  const scenario = getScenario(project, scenarioId);
  const opts = { includeHidden: options.includeHidden ?? false, positions: options.positions ?? 'active' } as const;
  const key = `${scenario.id}|${opts.includeHidden}|${opts.positions}`;
  let perProject = cache.get(project);
  if (!perProject) {
    perProject = new Map();
    cache.set(project, perProject);
  }
  const hit = perProject.get(key);
  if (hit) return hit;

  const room = roomGeometry(project.room);
  const settings = project.settings;
  const fmtLength = (mm: number) =>
    formatLength(mm, { system: settings.unitSystem, precision: settings.imperialPrecision, metricUnit: settings.metricUnit });
  const fmtArea = (mm2: number) => formatArea(mm2, { system: settings.unitSystem });

  const objects: AnalyzedObject[] = [];
  for (const o of scenario.objects) {
    if (o.hidden && !opts.includeHidden) continue;
    const resolved = resolveObject(project, o);
    const pose =
      opts.positions === 'parked'
        ? resolved.parkedPose
        : opts.positions === 'working'
          ? (resolved.workingPose ?? resolved.parkedPose)
          : resolved.pose;
    const footprint = objectFootprint(resolved, pose);
    const zonePose = opts.positions === 'parked' ? pose : (resolved.workingPose ?? pose);
    objects.push({
      id: o.id,
      name: resolved.label,
      resolved,
      pose,
      footprint,
      bbox: bbox(footprint),
      zonePose,
      zonesAtWorkingPosition: zonePose !== pose,
      zones: resolved.clearances.map((zone) => ({ zone, polygon: zoneWorldPolygon(zone.shape, resolved.footprint, zonePose), label: zoneLabel(zone) })),
    });
  }

  const features: AnalyzedFeature[] = project.architecture
    .filter((f) => opts.includeHidden || !f.hidden)
    .map((f) => ({
      id: f.id,
      name: f.name,
      feature: f,
      footprint: featureFootprint(project.room, f),
      blocksFloor: !OPENING_KINDS.has(f.kind) && !OVERHEAD_KINDS.has(f.kind) && f.kind !== 'hose-bib' && f.elevation < 300,
    }))
    .filter((f) => f.footprint.length >= 3);

  const vehicles: AnalyzedVehicle[] = scenario.vehicles
    .filter((v) => opts.includeHidden || !v.hidden)
    .map((v) => {
      const spec = vehicleGeomSpec(v);
      const pose = vehiclePose(v);
      const parts = vehicleParts(spec, pose);
      return { id: v.id, name: v.name, vehicle: v, spec, pose, parts, body: parts[0]! };
    });

  const memoStore = new Map<string, unknown>();
  const ctx: AnalysisContext = {
    project,
    scenario,
    options: opts,
    room,
    hasRoom: room.walls.length >= 3,
    objects,
    objectById: new Map(objects.map((o) => [o.id, o])),
    features,
    vehicles,
    fmtLength,
    fmtArea,
    memo<T>(k: string, compute: () => T): T {
      if (!memoStore.has(k)) memoStore.set(k, compute());
      return memoStore.get(k) as T;
    },
  };
  perProject.set(key, ctx);
  return ctx;
}
