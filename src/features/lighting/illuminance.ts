/**
 * Approximate illuminance on the work plane (pure). Each fixture is a generalized Lambertian
 * emitter whose half-intensity angle equals half its beam angle (I(θ) = I₀·cosᵐθ, total flux =
 * the fixture's lumens); linear shop lights are split into point sources along their length. A
 * uniform bounce term approximates light reflected off walls and ceiling. Good enough to compare
 * "front-middle-back vs left-middle-right", not a photometric calculation.
 */
import type { LightingFixture } from '@/domain/schema';
import { bbox, containsPoint, localToWorld, type BBox, type Point, type Polygon } from '@/geometry';

/** Typical bench / work-plane height (mm). */
export const WORK_PLANE = 762;
export const LUX_PER_FC = 10.764;
/** Average surface reflectance used for the bounce term. */
const REFLECTANCE = 0.4;

interface PointSource {
  x: number;
  y: number;
  z: number;
  /** Peak intensity I₀ (candela = lm/sr). */
  i0: number;
  m: number;
}

function exponentFor(beamAngle: number): number {
  const half = Math.min(89, Math.max(5, beamAngle / 2));
  return -Math.LN2 / Math.log(Math.cos((half * Math.PI) / 180));
}

export function pointSources(light: LightingFixture): PointSource[] {
  const m = exponentFor(light.beamAngle);
  const n = light.kind === 'shop-light' ? Math.max(1, Math.round(light.length / 300)) : 1;
  const flux = light.lumens / n;
  const i0 = (flux * (m + 1)) / (2 * Math.PI);
  const out: PointSource[] = [];
  for (let k = 0; k < n; k++) {
    const lx = n === 1 ? 0 : -light.length / 2 + (light.length * (k + 0.5)) / n;
    const p = localToWorld({ x: light.x, y: light.y, rotation: light.rotation }, { x: lx, y: 0 });
    out.push({ x: p.x, y: p.y, z: light.elevation, i0, m });
  }
  return out;
}

/** Direct illuminance (lux) at a work-plane point from a set of sources. */
function direct(sources: readonly PointSource[], p: Point, plane: number): number {
  let e = 0;
  for (const s of sources) {
    const h = (s.z - plane) / 1000;
    if (h <= 0) continue;
    const dx = (p.x - s.x) / 1000;
    const dy = (p.y - s.y) / 1000;
    const d2 = dx * dx + dy * dy + h * h;
    const cos = h / Math.sqrt(d2);
    e += (s.i0 * Math.pow(cos, s.m + 1)) / d2;
  }
  return e;
}

/** Uniform bounce light (lux) for a room of `floorArea` mm² and ceiling height `ceiling` mm. */
export function bounce(totalLumens: number, floorArea: number, perimeter: number, ceiling: number): number {
  const surfaces = (2 * floorArea + perimeter * ceiling) / 1e6;
  if (surfaces <= 0) return 0;
  return (REFLECTANCE * totalLumens) / (surfaces * (1 - REFLECTANCE));
}

export function illuminanceAt(lights: readonly LightingFixture[], p: Point, plane = WORK_PLANE, ambient = 0): number {
  return direct(lights.flatMap(pointSources), p, plane) + ambient;
}

export interface IlluminanceGrid {
  box: BBox;
  cell: number;
  cols: number;
  rows: number;
  /** Lux per cell, NaN outside the room. Row-major. */
  lux: Float32Array;
  stats: { average: number; min: number; max: number; uniformity: number };
}

export function illuminanceGrid(room: Polygon, lights: readonly LightingFixture[], opts: { cell?: number; plane?: number; ceiling?: number } = {}): IlluminanceGrid | null {
  if (room.length < 3) return null;
  const cell = opts.cell ?? 150;
  const plane = opts.plane ?? WORK_PLANE;
  const box = bbox(room);
  const cols = Math.max(1, Math.ceil((box.maxX - box.minX) / cell));
  const rows = Math.max(1, Math.ceil((box.maxY - box.minY) / cell));
  const sources = lights.flatMap(pointSources);
  let area = 0;
  let perim = 0;
  for (let i = 0; i < room.length; i++) {
    const a = room[i]!;
    const b = room[(i + 1) % room.length]!;
    area += a.x * b.y - b.x * a.y;
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const ambient = bounce(
    lights.reduce((s, l) => s + l.lumens, 0),
    Math.abs(area) / 2,
    perim,
    opts.ceiling ?? 2700,
  );
  const lux = new Float32Array(cols * rows);
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: box.minX + (c + 0.5) * cell, y: box.minY + (r + 0.5) * cell };
      if (!containsPoint(room, p)) {
        lux[r * cols + c] = NaN;
        continue;
      }
      const v = direct(sources, p, plane) + ambient;
      lux[r * cols + c] = v;
      sum += v;
      n++;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  const average = n ? sum / n : 0;
  return { box, cell, cols, rows, lux, stats: { average, min: n ? min : 0, max, uniformity: average > 0 ? (n ? min : 0) / average : 0 } };
}

/** Average illuminance in thirds of the room along x (west→east) or y (north→south). */
export function thirds(grid: IlluminanceGrid, axis: 'x' | 'y'): [number, number, number] {
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const v = grid.lux[r * grid.cols + c]!;
      if (Number.isNaN(v)) continue;
      const t = axis === 'x' ? (c + 0.5) / grid.cols : (r + 0.5) / grid.rows;
      const k = Math.min(2, Math.floor(t * 3));
      sums[k]! += v;
      counts[k]!++;
    }
  }
  return [0, 1, 2].map((k) => (counts[k] ? sums[k]! / counts[k]! : 0)) as [number, number, number];
}

/**
 * Approximate beam footprint on the work plane: radius (elevation − plane)·tan(beam/2), stretched
 * along a linear fixture's length.
 */
export function coverageFootprint(light: LightingFixture, plane = WORK_PLANE, segments = 28): Polygon {
  const h = Math.max(0, light.elevation - plane);
  const r = h * Math.tan((Math.min(170, light.beamAngle) / 2) * (Math.PI / 180));
  const half = light.kind === 'shop-light' ? light.length / 2 : 0;
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a) >= 0 ? half : -half;
    pts.push(localToWorld({ x: light.x, y: light.y, rotation: light.rotation }, { x: cx + Math.cos(a) * r, y: Math.sin(a) * r }));
  }
  return pts;
}

export const toFootCandles = (lux: number): number => lux / LUX_PER_FC;
