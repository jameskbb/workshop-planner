/**
 * Project → DXF: walls, openings, fixed features, object footprints (+ labels), vehicles,
 * electrical/lighting symbols, zones, clearances and dimensions, each on its own layer.
 *
 * Coordinates: DXF is y-up, the plan is y-down (north up on screen), so y is negated: north stays
 * up in CAD. Units follow the project: inches for imperial, millimeters for metric.
 */
import type { Project } from '@/domain/schema';
import { buildPlanDrawing, dimensionGeometry, type DrawLayer, type Fmt, type PlanOptions } from '../plan/drawing';
import { DxfWriter, type DxfLayer, type DxfUnits } from './writer';

/** Plan layer → DXF layer. Layers not listed (grid, floor, annotations) are not exported. */
export const DXF_LAYERS: Partial<Record<DrawLayer, DxfLayer>> = {
  walls: { name: 'WALLS', color: 7 },
  openings: { name: 'OPENINGS', color: 8 },
  architecture: { name: 'FIXED-FEATURES', color: 8 },
  zones: { name: 'ZONES', color: 6, linetype: 'DASHED' },
  clearances: { name: 'CLEARANCES', color: 30, linetype: 'DASHED' },
  objects: { name: 'OBJECTS', color: 5 },
  labels: { name: 'LABELS', color: 7 },
  vehicles: { name: 'VEHICLES', color: 4 },
  electrical: { name: 'ELECTRICAL', color: 2 },
  lighting: { name: 'LIGHTING', color: 2 },
  dimensions: { name: 'DIMENSIONS', color: 1 },
  measurements: { name: 'MEASUREMENTS', color: 1 },
};

export interface DxfExportOptions extends Partial<PlanOptions> {
  units?: DxfUnits;
}

export function projectToDxf(project: Project, fmt: Fmt, options: DxfExportOptions = {}): string {
  const units: DxfUnits = options.units ?? (project.settings.unitSystem === 'imperial' ? 'in' : 'mm');
  const k = units === 'in' ? 1 / 25.4 : 1;
  const P = (p: { x: number; y: number }) => ({ x: p.x * k, y: -p.y * k });
  // A fixed nominal scale keeps text heights sensible in CAD (≈ 1/4" = 1' → 1 pt ≈ 17 mm).
  const drawing = buildPlanDrawing(project, fmt, { annotations: false, grid: false, clearances: true, ...options, unit: options.unit ?? 17 });
  const used = new Set(drawing.prims.map((p) => p.layer));
  const layers = Object.entries(DXF_LAYERS)
    .filter(([k]) => used.has(k as DrawLayer))
    .map(([, v]) => v!);
  const w = new DxfWriter(units, layers);
  for (const prim of drawing.prims) {
    const layer = DXF_LAYERS[prim.layer]?.name;
    if (!layer) continue;
    switch (prim.t) {
      case 'poly':
        w.polyline(layer, prim.pts.map(P), prim.closed);
        break;
      case 'circle':
        w.circle(layer, P(prim.c), prim.r * k);
        break;
      case 'text':
        w.text(layer, P(prim.at), prim.size * k, prim.text, -(prim.rotation ?? 0), prim.anchor === 'start' ? 'left' : prim.anchor === 'end' ? 'right' : 'center');
        break;
      case 'dim': {
        const g = dimensionGeometry(prim, drawing.unit);
        w.line(layer, P(g.a2), P(g.b2));
        if (g.drawExt) {
          w.line(layer, P(g.extA[0]), P(g.extA[1]));
          w.line(layer, P(g.extB[0]), P(g.extB[1]));
        }
        for (const [a, b] of g.ticks) w.line(layer, P(a), P(b));
        w.text(layer, P(g.textAt), drawing.unit * 7.5 * k, prim.text, -g.angle);
        break;
      }
    }
  }
  return w.toString();
}
