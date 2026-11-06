/**
 * 3D scene model: the project turned into simple solids (meters, three.js axes) that the R3F view
 * renders. Pure and testable: no three.js imports.
 *
 * Axes: plan x (east) → three x; plan y (south) → three z; height → three y. A plan rotation θ
 * (clockwise on screen) is a rotation of −θ about +y.
 */
import { featureFootprint, getScenario, objectFootprint, resolveObject, resolvePlacement, roomGeometry, type ResolvedObject } from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, type Project } from '@/domain/schema';
import { bbox, centroid, pointOnWall, type BBox, type Point } from '@/geometry';
import { categoryColors } from '@/styles/tokens';

export const M = 1 / 1000;

/** An axis-aligned (in its own frame) box: center (m), size (m), yaw (radians about +y). */
export interface Box3 {
  center: [number, number, number];
  size: [number, number, number];
  yaw: number;
}

export type ObjectArchetype = 'bench' | 'cabinet' | 'tool' | 'shelving' | 'cylinder' | 'panel' | 'box';

export interface SceneObject {
  id: string;
  name: string;
  archetype: ObjectArchetype;
  /** Footprint center at the floor (or mount elevation), meters. */
  position: [number, number, number];
  yaw: number;
  width: number;
  depth: number;
  height: number;
  color: string;
  accent: string;
  wallMounted: boolean;
}

export interface WallPiece extends Box3 {
  wallIndex: number;
}

export interface Opening {
  kind: 'door' | 'double-door' | 'garage-door' | 'window';
  /** Glass/panel filling the opening (closed garage doors, windows). */
  fill?: Box3 & { material: 'glass' | 'panel' };
}

export interface SceneVehicle {
  id: string;
  name: string;
  position: [number, number, number];
  yaw: number;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  color: string;
}

export interface SceneFeature {
  id: string;
  name: string;
  shape: 'box' | 'cylinder';
  position: [number, number, number];
  yaw: number;
  width: number;
  depth: number;
  height: number;
  color: string;
}

export interface SceneLight {
  id: string;
  position: [number, number, number];
  yaw: number;
  length: number;
  width: number;
  lumens: number;
}

export interface SceneModel {
  /** Floor outline (x, z) in meters. */
  floor: Array<[number, number]>;
  walls: WallPiece[];
  openings: Opening[];
  ceilingHeight: number;
  objects: SceneObject[];
  vehicles: SceneVehicle[];
  features: SceneFeature[];
  lights: SceneLight[];
  /** Room bounds in meters (x/z) and max height. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
  center: [number, number, number];
}

const toXZ = (p: Point): [number, number] => [p.x * M, p.y * M];
const yawOf = (planRotationDeg: number): number => (-planRotationDeg * Math.PI) / 180;

/** Pick a recognizable simplified shape for an object. */
export function archetypeOf(r: ResolvedObject): ObjectArchetype {
  const d = r.definition;
  const text = [d?.id ?? '', d?.name ?? '', d?.subcategory ?? '', ...(d?.tags ?? []), r.object.name].join(' ').toLowerCase();
  if (d?.shape === 'round' || /vacuum|collector|trash|drum|can\b/.test(text)) return 'cylinder';
  if (r.wallMounted && r.height < 250) return 'panel';
  if (/pegboard|cleat|tv\b/.test(text)) return 'panel';
  if (/shelv|shelf|rack|tote/.test(text)) return 'shelving';
  if (/bench|table|desk|assembly|outfeed/.test(text) && !/saw|router/.test(text)) return 'bench';
  if (r.category === 'stationary-tool' || /saw|planer|jointer|press|lathe|sander|cnc|laser|compressor|router/.test(text)) return 'tool';
  if (/cabinet|chest|drawer|toolbox|cart|fridge|refrigerator|freezer|locker/.test(text)) return 'cabinet';
  return 'box';
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

export function buildSceneModel(project: Project, scenarioId?: string): SceneModel {
  const scenario = getScenario(project, scenarioId);
  const room = project.room;
  const g = roomGeometry(room);
  const H = room.ceilingHeight * M;
  const hasRoom = g.polygon.length >= 3;
  const b: BBox = hasRoom ? bbox(g.polygon) : { minX: 0, minY: 0, maxX: 6000, maxY: 6000 };

  // Openings per wall: along-wall interval + vertical interval.
  const openingsByWall = new Map<number, Array<{ s0: number; s1: number; z0: number; z1: number }>>();
  const openings: Opening[] = [];
  for (const f of project.architecture) {
    if (f.hidden || !OPENING_KINDS.has(f.kind) || f.placement.type !== 'wall') continue;
    const wi = g.wallIndex.get(f.placement.wallId);
    const wall = wi === undefined ? undefined : g.walls[wi];
    if (!wall) continue;
    const s0 = f.placement.offset - f.width / 2;
    const s1 = f.placement.offset + f.width / 2;
    const openH = f.kind === 'garage-door' ? (f.garageDoor?.openingHeight ?? f.height) : f.height;
    const z0 = f.kind === 'window' ? f.elevation : 0;
    const z1 = z0 + openH;
    openingsByWall.set(wall.index, [...(openingsByWall.get(wall.index) ?? []), { s0, s1, z0, z1 }]);
    const t = g.thickness[wall.index] ?? 150;
    const mid = pointOnWall(wall, f.placement.offset, -t / 2);
    const yaw = -Math.atan2(wall.dir.y, wall.dir.x);
    const kind = f.kind as Opening['kind'];
    const fill =
      f.kind === 'window'
        ? { center: [mid.x * M, ((z0 + z1) / 2) * M, mid.y * M] as [number, number, number], size: [f.width * M, (z1 - z0) * M, 0.02] as [number, number, number], yaw, material: 'glass' as const }
        : f.kind === 'garage-door' && f.garageDoor?.state !== 'open'
          ? { center: [mid.x * M, ((z0 + z1) / 2) * M, mid.y * M] as [number, number, number], size: [f.width * M, (z1 - z0) * M, 0.05] as [number, number, number], yaw, material: 'panel' as const }
          : undefined;
    openings.push({ kind, fill });
  }

  // Walls: split each wall into solid pieces around its openings.
  const walls: WallPiece[] = [];
  g.walls.forEach((wall) => {
    const t = g.thickness[wall.index] ?? 150;
    const h = g.heights[wall.index] ?? room.ceilingHeight;
    const yaw = -Math.atan2(wall.dir.y, wall.dir.x);
    const piece = (s0: number, s1: number, z0: number, z1: number) => {
      if (s1 - s0 < 1 || z1 - z0 < 1) return;
      // Extend by the thickness at the ends so corners close (walls overlap slightly at joints).
      const e0 = s0 <= 0.5 ? -t : s0;
      const e1 = s1 >= wall.length - 0.5 ? wall.length + t : s1;
      const c = pointOnWall(wall, (e0 + e1) / 2, -t / 2);
      walls.push({ wallIndex: wall.index, center: [c.x * M, ((z0 + z1) / 2) * M, c.y * M], size: [(e1 - e0) * M, (z1 - z0) * M, t * M], yaw });
    };
    const ops = (openingsByWall.get(wall.index) ?? []).map((o) => ({ ...o, s0: Math.max(0, o.s0), s1: Math.min(wall.length, o.s1), z1: Math.min(h, o.z1) })).sort((a, c) => a.s0 - c.s0);
    let cursor = 0;
    for (const o of ops) {
      if (o.s0 > cursor) piece(cursor, o.s0, 0, h);
      piece(Math.max(o.s0, cursor), o.s1, o.z1, h); // lintel
      if (o.z0 > 0) piece(Math.max(o.s0, cursor), o.s1, 0, o.z0); // sill
      cursor = Math.max(cursor, o.s1);
    }
    piece(cursor, wall.length, 0, h);
  });

  // Objects
  const objects: SceneObject[] = [];
  for (const o of scenario.objects) {
    if (o.hidden) continue;
    const r = resolveObject(project, o);
    const fp = objectFootprint(r);
    const c = centroid(fp);
    const base = categoryColors[r.category] ?? categoryColors.unknown;
    const color = r.object.color ?? r.definition?.color ?? base.fill;
    objects.push({
      id: o.id,
      name: r.label,
      archetype: archetypeOf(r),
      position: [c.x * M, r.elevation * M, c.y * M],
      yaw: yawOf(r.pose.rotation),
      width: r.footprint.width * M,
      depth: r.footprint.depth * M,
      height: r.height * M,
      color,
      accent: shade(base.stroke, 1),
      wallMounted: r.wallMounted,
    });
  }

  // Vehicles
  const vehicles: SceneVehicle[] = scenario.vehicles
    .filter((v) => !v.hidden)
    .map((v) => ({ id: v.id, name: v.name, position: [v.x * M, 0, v.y * M], yaw: yawOf(v.rotation), length: v.length * M, width: v.width * M, height: v.height * M, wheelbase: v.wheelbase * M, color: v.color ?? '#9fb3c8' }));

  // Fixed features (not openings)
  const features: SceneFeature[] = [];
  for (const f of project.architecture) {
    if (f.hidden || OPENING_KINDS.has(f.kind) || !hasRoom) continue;
    const fp = featureFootprint(room, f);
    if (fp.length < 3) continue;
    const { pose } = resolvePlacement(room, f.placement, f.width, f.depth);
    const c = f.shape === 'round' ? pose : centroid(fp);
    const overhead = OVERHEAD_KINDS.has(f.kind);
    const height = f.kind === 'support-pole' || f.kind === 'column' ? room.ceilingHeight : f.height;
    features.push({
      id: f.id,
      name: f.name,
      shape: f.shape === 'round' || f.kind === 'water-heater' ? 'cylinder' : 'box',
      position: [c.x * M, (overhead ? f.elevation : f.elevation) * M, c.y * M],
      yaw: yawOf(pose.rotation),
      width: f.width * M,
      depth: f.depth * M,
      height: Math.min(height, room.ceilingHeight - f.elevation) * M,
      color: f.color ?? (f.kind === 'support-pole' || f.kind === 'column' ? '#7d858d' : f.kind === 'water-heater' ? '#d9dcdf' : '#c7ccd1'),
    });
  }

  const lights: SceneLight[] = scenario.lights
    .filter((l) => !l.hidden)
    .map((l) => ({ id: l.id, position: [l.x * M, Math.min(l.elevation, room.ceilingHeight - 20) * M, l.y * M], yaw: yawOf(l.rotation), length: l.length * M, width: l.width * M, lumens: l.lumens }));

  return {
    floor: hasRoom ? g.polygon.map(toXZ) : [],
    walls,
    openings,
    ceilingHeight: H,
    objects,
    vehicles,
    features,
    lights,
    bounds: { minX: b.minX * M, maxX: b.maxX * M, minZ: b.minY * M, maxZ: b.maxY * M, height: H },
    center: [((b.minX + b.maxX) / 2) * M, H / 2, ((b.minY + b.maxY) / 2) * M],
  };
}

// ───────────────────────────── camera presets ─────────────────────────────

export type CameraPreset = 'top' | 'front' | 'rear' | 'left' | 'right' | 'perspective';

export const CAMERA_PRESETS: Array<{ id: CameraPreset; label: string; hint: string }> = [
  { id: 'perspective', label: 'Perspective', hint: 'Three-quarter view from the southeast' },
  { id: 'top', label: 'Top', hint: 'Straight down (plan view)' },
  { id: 'front', label: 'Front', hint: 'From the south, looking north' },
  { id: 'rear', label: 'Rear', hint: 'From the north, looking south' },
  { id: 'left', label: 'Left', hint: 'From the west, looking east' },
  { id: 'right', label: 'Right', hint: 'From the east, looking west' },
];

/** Camera position + target for a preset, framing the room (meters). */
export function presetCamera(b: SceneModel['bounds'], preset: CameraPreset, fovDeg = 50): { position: [number, number, number]; target: [number, number, number] } {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const size = Math.max(w, d, 3);
  const fit = (extent: number) => extent / 2 / Math.tan(((fovDeg / 2) * Math.PI) / 180) + 1;
  const ty = b.height * 0.4;
  switch (preset) {
    case 'top':
      return { position: [cx, fit(size * 1.1) + b.height, cz + 0.001], target: [cx, 0, cz] };
    case 'front':
      return { position: [cx, b.height * 0.55, b.maxZ + fit(Math.max(w, b.height) * 1.1)], target: [cx, ty, cz] };
    case 'rear':
      return { position: [cx, b.height * 0.55, b.minZ - fit(Math.max(w, b.height) * 1.1)], target: [cx, ty, cz] };
    case 'left':
      return { position: [b.minX - fit(Math.max(d, b.height) * 1.1), b.height * 0.55, cz], target: [cx, ty, cz] };
    case 'right':
      return { position: [b.maxX + fit(Math.max(d, b.height) * 1.1), b.height * 0.55, cz], target: [cx, ty, cz] };
    case 'perspective':
    default: {
      const r = fit(size) * 0.95;
      return { position: [cx + r * 0.62, b.height + r * 0.55, cz + r * 0.78], target: [cx, ty * 0.5, cz] };
    }
  }
}

