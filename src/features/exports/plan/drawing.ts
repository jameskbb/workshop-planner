/**
 * Plan drawing model: the floor plan as a flat list of vector primitives in WORLD millimeters,
 * generated directly from the project geometry (never scraped from the canvas). One model feeds
 * every vector output: SVG (→ PNG, PDF, print) and DXF.
 *
 * Pure: domain + geometry only (no React, Konva or stores).
 */
import { resolveMeasurement } from '@/domain/measure';
import {
  electricalPosition,
  featureFootprint,
  getScenario,
  objectFootprint,
  resolveObject,
  resolvePlacement,
  roomGeometry,
  vehicleGeomSpec,
  vehiclePose,
} from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, clearanceOverlayGroup, type ArchitecturalFeature, type LayerId, type Project, type Room } from '@/domain/schema';
import {
  add,
  angleOf,
  bbox,
  bboxHeight,
  bboxUnion,
  bboxWidth,
  centroid,
  exteriorCorners,
  localPolygonToWorld,
  localRect,
  localToWorld,
  normalize,
  perp,
  pointOnWall,
  rotate,
  scale as vscale,
  signedArea,
  sub,
  vehicleBody,
  vehicleMirrors,
  wallQuads,
  zoneWorldPolygon,
  type BBox,
  type Point,
  type Pose,
} from '@/geometry';
import { canvasColors, categoryColors, monochrome, zoneKindColors } from '@/styles/tokens';

// ───────────────────────────── model ─────────────────────────────

export type DrawLayer =
  | 'grid'
  | 'zones'
  | 'floor'
  | 'walls'
  | 'openings'
  | 'architecture'
  | 'clearances'
  | 'objects'
  | 'labels'
  | 'vehicles'
  | 'electrical'
  | 'lighting'
  | 'dimensions'
  | 'measurements'
  | 'annotations';

export interface Style {
  stroke?: string;
  fill?: string;
  /** Stroke width in output points (scaled by the drawing's `unit`). */
  width?: number;
  /** Dash pattern in output points. */
  dash?: number[];
  opacity?: number;
  fillOpacity?: number;
}

export type Prim =
  | { t: 'poly'; layer: DrawLayer; pts: Point[]; closed: boolean; style: Style }
  | { t: 'circle'; layer: DrawLayer; c: Point; r: number; style: Style }
  | {
      t: 'text';
      layer: DrawLayer;
      at: Point;
      text: string;
      /** Font size in WORLD mm. */
      size: number;
      /** Degrees clockwise. */
      rotation?: number;
      anchor: 'start' | 'middle' | 'end';
      /** Vertical alignment of `at`. */
      baseline?: 'middle' | 'alphabetic' | 'hanging';
      color: string;
      weight?: 'normal' | 'bold';
      mono?: boolean;
      italic?: boolean;
    }
  | {
      /** Linear dimension between a and b, drawn offset perpendicular by `offset` (world mm). */
      t: 'dim';
      layer: DrawLayer;
      a: Point;
      b: Point;
      offset: number;
      text: string;
      color: string;
    };

export interface PlanOptions {
  scenarioId?: string;
  grid: boolean;
  /** Wall dimensions + saved measurements. */
  measurements: boolean;
  labels: boolean;
  clearances: boolean;
  zones: boolean;
  vehicle: boolean;
  electrical: boolean;
  lighting: boolean;
  monochrome: boolean;
  /** North arrow + scale bar in the margin. */
  annotations: boolean;
  /** Obey the project's hidden layers (default true). */
  respectLayers?: boolean;
  /** Margin around the room (world mm). Default: 8% of the larger extent, ≥ 600 mm. */
  margin?: number;
  /**
   * World mm per output point (line widths and default text size scale with it). Default: the
   * drawing fits ~ 1000 pt across. PDF / print pass the true scale so text is readable on paper.
   */
  unit?: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  grid: false,
  measurements: true,
  labels: true,
  clearances: false,
  zones: true,
  vehicle: true,
  electrical: true,
  lighting: true,
  monochrome: false,
  annotations: true,
};

export interface LegendEntry {
  key: string;
  label: string;
  fill?: string;
  stroke: string;
  dash?: boolean;
  shape: 'rect' | 'circle' | 'line';
}

export interface PlanDrawing {
  prims: Prim[];
  /** Page (viewBox) in world mm, room + margin. */
  bounds: BBox;
  /** Room interior bounds. */
  roomBounds: BBox;
  unit: number;
  legend: LegendEntry[];
  /** Length formatter used for labels (units of the project). */
  fmt: (mm: number) => string;
  /** Scale-bar length (world mm) and its label, when annotations are on. */
  scaleBar?: { length: number; label: string };
}

export type Fmt = (mm: number) => string;

// ───────────────────────────── helpers ─────────────────────────────

const INK = canvasColors.ink;

function categoryPalette(project: Project, mono: boolean) {
  const raw = project.extensions['editor.category-colors'];
  const overrides = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return (category: keyof typeof categoryColors) => {
    if (mono) return { fill: monochrome.fill, stroke: monochrome.stroke };
    const base = categoryColors[category] ?? categoryColors.unknown;
    const o = overrides[category];
    return typeof o === 'string' ? { fill: o, stroke: base.stroke } : base;
  };
}

function arc(center: Point, radius: number, fromDeg: number, toDeg: number, steps = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    pts.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
  }
  return pts;
}

function ellipse(pose: Pose, w: number, d: number, ox = 0, oy = 0, n = 36): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(localToWorld(pose, { x: ox + (Math.cos(a) * w) / 2, y: oy + (Math.sin(a) * d) / 2 }));
  }
  return pts;
}

/** Approximate rendered text width (world mm) for layout decisions. */
export const textWidth = (text: string, size: number): number => text.length * size * 0.56;

/** Fit a label in `maxWidth`: shrink down to `min` then truncate with an ellipsis. */
function fitLabel(text: string, size: number, min: number, maxWidth: number): { text: string; size: number } {
  let s = size;
  while (s > min && textWidth(text, s) > maxWidth) s *= 0.9;
  s = Math.max(s, min);
  let t = text;
  while (t.length > 3 && textWidth(t, s) > maxWidth) t = t.slice(0, -2);
  if (t !== text) t = `${t.replace(/\s+$/, '')}…`;
  return { text: t, size: s };
}

/** Pick a "nice" scale-bar length ≈ 1/5 of the room width. */
export function niceScaleBar(extent: number, imperial: boolean): { length: number; label: string } {
  const target = extent / 5;
  if (imperial) {
    const ft = 304.8;
    const steps = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 100];
    const best = steps.reduce((b, s) => (Math.abs(s * ft - target) < Math.abs(b * ft - target) ? s : b), steps[0]!);
    return { length: best * ft, label: `${best} ft` };
  }
  const steps = [0.5, 1, 2, 2.5, 5, 10, 20, 50];
  const best = steps.reduce((b, s) => (Math.abs(s * 1000 - target) < Math.abs(b * 1000 - target) ? s : b), steps[0]!);
  return { length: best * 1000, label: `${best} m` };
}

// ───────────────────────────── builder ─────────────────────────────

export function buildPlanDrawing(project: Project, fmt: Fmt, options: Partial<PlanOptions> = {}): PlanDrawing {
  const o: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...options };
  const mono = o.monochrome;
  const scenario = getScenario(project, o.scenarioId);
  const room = project.room;
  const g = roomGeometry(room);
  const hasRoom = g.polygon.length >= 3;
  const layerOn = (l: LayerId) => o.respectLayers === false || (project.layers[l]?.visible ?? true);
  const palette = categoryPalette(project, mono);
  const imperial = project.settings.unitSystem === 'imperial';

  // Bounds: room with walls, plus everything placed (objects can sit outside a half-drawn room).
  const exterior = hasRoom ? exteriorCorners(g.polygon, g.thickness) : [];
  let content = hasRoom ? bbox(exterior) : bbox([{ x: 0, y: 0 }, { x: 6000, y: 6000 }]);
  const objs = scenario.objects.map((ob) => resolveObject(project, ob));
  for (const r of objs) content = bboxUnion(content, bbox(objectFootprint(r)));
  if (o.vehicle) for (const v of scenario.vehicles) content = bboxUnion(content, bbox(vehicleBody(vehicleGeomSpec(v), vehiclePose(v))));
  const extent = Math.max(bboxWidth(content), bboxHeight(content), 1000);
  const unit = o.unit ?? extent / 1000;
  const margin = o.margin ?? Math.max(extent * 0.08, 600, unit * 60);
  const bounds: BBox = { minX: content.minX - margin, minY: content.minY - margin, maxX: content.maxX + margin, maxY: content.maxY + margin };
  const roomBounds = hasRoom ? bbox(g.polygon) : content;
  const font = unit * 9; // 9 pt body text
  const small = unit * 7;
  const prims: Prim[] = [];
  const legend: LegendEntry[] = [];
  const addLegend = (e: LegendEntry) => {
    if (!legend.some((l) => l.key === e.key)) legend.push(e);
  };

  // Grid
  if (o.grid) {
    let step = project.settings.gridSize;
    while (extent / step > 120) step *= 2;
    const major = imperial ? 1219.2 : 1000;
    const gx0 = Math.floor(bounds.minX / step) * step;
    const gy0 = Math.floor(bounds.minY / step) * step;
    for (let x = gx0; x <= bounds.maxX; x += step) {
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      prims.push({ t: 'poly', layer: 'grid', pts: [{ x, y: bounds.minY }, { x, y: bounds.maxY }], closed: false, style: { stroke: mono ? '#c8c8c8' : isMajor ? canvasColors.gridMajor : canvasColors.gridMinor, width: isMajor ? 0.5 : 0.3 } });
    }
    for (let y = gy0; y <= bounds.maxY; y += step) {
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      prims.push({ t: 'poly', layer: 'grid', pts: [{ x: bounds.minX, y }, { x: bounds.maxX, y }], closed: false, style: { stroke: mono ? '#c8c8c8' : isMajor ? canvasColors.gridMajor : canvasColors.gridMinor, width: isMajor ? 0.5 : 0.3 } });
    }
  }

  // Floor
  if (hasRoom) prims.push({ t: 'poly', layer: 'floor', pts: g.polygon, closed: true, style: { fill: '#ffffff', fillOpacity: o.grid ? 0.55 : 1 } });

  // Zones
  if (o.zones && layerOn('zones')) {
    for (const z of scenario.zones) {
      if (z.hidden) continue;
      const color = z.color ?? zoneKindColors[z.kind] ?? '#bdbdbd';
      prims.push({ t: 'poly', layer: 'zones', pts: z.points, closed: true, style: mono ? { stroke: '#777', width: 0.6, dash: [4, 3] } : { fill: color, fillOpacity: 0.2, stroke: color, width: 0.8, dash: [5, 3] } });
      if (o.labels) {
        const c = centroid(z.points);
        const zb = bbox(z.points);
        prims.push({ t: 'text', layer: 'zones', at: { x: c.x, y: zb.minY + small * 1.6 }, text: z.name.toUpperCase(), size: small, anchor: 'middle', baseline: 'middle', color: mono ? '#555' : '#5f666d', weight: 'bold' });
      }
      addLegend({ key: `zone:${z.kind}`, label: `Zone: ${z.kind.replace(/-/g, ' ')}`, fill: mono ? undefined : color, stroke: mono ? '#777' : color, dash: true, shape: 'rect' });
    }
  }

  // Walls
  if (hasRoom) {
    const quads = wallQuads(g.polygon, g.thickness);
    quads.forEach((q, i) => {
      const wall = room.walls[i];
      prims.push({ t: 'poly', layer: 'walls', pts: q, closed: true, style: { fill: mono ? monochrome.stroke : (wall?.color ?? canvasColors.wallFill), stroke: canvasColors.wallStroke, width: 0.6 } });
    });
    prims.push({ t: 'poly', layer: 'walls', pts: g.polygon, closed: true, style: { stroke: canvasColors.roomEdge, width: 0.9 } });
    addLegend({ key: 'walls', label: 'Walls', fill: mono ? monochrome.stroke : canvasColors.wallFill, stroke: canvasColors.wallStroke, shape: 'rect' });
  }

  // Architecture (openings are always drawn: they are part of the walls)
  if (hasRoom) {
    const showArch = layerOn('architecture');
    for (const f of project.architecture) {
      if (f.hidden) continue;
      if (!OPENING_KINDS.has(f.kind) && !showArch) continue;
      drawFeature(prims, room, f, { mono, font: small, labels: o.labels, fmt, unit });
    }
    if (project.architecture.some((f) => f.kind === 'door' || f.kind === 'double-door')) addLegend({ key: 'door', label: 'Door & swing', stroke: canvasColors.doorSwing, dash: true, shape: 'line' });
    if (project.architecture.some((f) => f.kind === 'garage-door')) addLegend({ key: 'garage', label: 'Garage door track area', fill: mono ? undefined : '#e3e5e7', stroke: canvasColors.doorSwing, dash: true, shape: 'rect' });
  }

  // Clearances (under objects)
  if (o.clearances && layerOn('clearances')) {
    for (const r of objs) {
      if (r.object.hidden || !layerOn(r.layer)) continue;
      for (const z of r.clearances) {
        const poly = zoneWorldPolygon(z.shape, r.footprint, r.pose);
        if (poly.length < 3) continue;
        const maint = clearanceOverlayGroup(z.kind) === 'maintenance';
        const color = maint ? '#8a7cc4' : '#e08a2e';
        prims.push({ t: 'poly', layer: 'clearances', pts: poly, closed: true, style: mono ? { stroke: '#888', width: 0.5, dash: [2, 2] } : { fill: color, fillOpacity: 0.14, stroke: color, width: 0.5, dash: [3, 2] } });
        addLegend({ key: maint ? 'clr-maint' : 'clr-op', label: maint ? 'Maintenance clearance' : 'Working clearance', fill: mono ? undefined : color, stroke: mono ? '#888' : color, dash: true, shape: 'rect' });
      }
    }
  }

  // Objects: floor items first, then wall/ceiling-hung items on top.
  const ordered = [...objs].sort((a, b) => Number(a.elevated) - Number(b.elevated));
  for (const r of ordered) {
    if (r.object.hidden || !layerOn(r.layer)) continue;
    const pal = palette(r.category);
    const fill = mono ? monochrome.fill : (r.object.color ?? r.definition?.color ?? pal.fill);
    const round = r.definition?.shape === 'round';
    const { width: w, depth: d, offsetX = 0, offsetY = 0 } = r.footprint;
    const pts = round ? ellipse(r.pose, w, d, offsetX, offsetY) : objectFootprint(r);
    prims.push({ t: 'poly', layer: 'objects', pts, closed: true, style: { fill, stroke: pal.stroke, width: 0.7, dash: r.elevated ? [5, 3] : undefined, fillOpacity: r.elevated ? 0.75 : 1 } });
    if (!round) {
      const m = Math.min(d * 0.12, 120);
      const front = [
        { x: offsetX - w * 0.18, y: offsetY + d / 2 },
        { x: offsetX, y: offsetY + d / 2 - m },
        { x: offsetX + w * 0.18, y: offsetY + d / 2 },
      ].map((p) => localToWorld(r.pose, p));
      prims.push({ t: 'poly', layer: 'objects', pts: front, closed: false, style: { stroke: pal.stroke, width: 0.5, opacity: 0.7 } });
    }
    if (o.labels) {
      // Labels read horizontally; tall narrow items whose label does not fit get a vertical label.
      const fb = bbox(pts);
      // Labels may run a little past the footprint (the layout pass below keeps them off each
      // other), so names like "Mobile planer" print in full instead of as "Mobile plan…".
      const horiz = Math.max(bboxWidth(fb) * 1.4, font * 7);
      const vert = bboxHeight(fb) * 1.3;
      const vertical = textWidth(r.label, font) > horiz && vert > horiz * 1.4;
      const fit = fitLabel(r.label, font, small * 0.85, vertical ? vert : horiz);
      const c = localToWorld(r.pose, { x: offsetX, y: offsetY });
      prims.push({ t: 'text', layer: 'labels', at: c, text: fit.text, size: fit.size, rotation: vertical ? -90 : undefined, anchor: 'middle', baseline: 'middle', color: mono ? monochrome.stroke : INK, weight: 'bold' });
    }
    const catLabel: Record<string, string> = {
      'work-surface': 'Work surfaces',
      'stationary-tool': 'Tools',
      storage: 'Storage',
      misc: 'Miscellaneous',
      'dust-collection': 'Dust collection',
      unknown: 'Other objects',
    };
    addLegend({ key: `cat:${r.category}`, label: catLabel[r.category] ?? r.category, fill, stroke: pal.stroke, shape: 'rect' });
    if (r.elevated) addLegend({ key: 'elevated', label: 'Wall / ceiling mounted (dashed)', fill: mono ? undefined : '#eeeeee', stroke: INK, dash: true, shape: 'rect' });
  }

  // Vehicles
  if (o.vehicle && layerOn('vehicle')) {
    for (const v of scenario.vehicles) {
      if (v.hidden) continue;
      const spec = vehicleGeomSpec(v);
      const pose = vehiclePose(v);
      const fill = mono ? monochrome.fill : (v.color ?? canvasColors.vehicleFill);
      const stroke = mono ? monochrome.stroke : canvasColors.vehicleStroke;
      prims.push({ t: 'poly', layer: 'vehicles', pts: vehicleBody(spec, pose), closed: true, style: { fill, stroke, width: 0.8, fillOpacity: 0.92 } });
      for (const m of vehicleMirrors(spec, pose)) prims.push({ t: 'poly', layer: 'vehicles', pts: m, closed: true, style: { fill, stroke, width: 0.5 } });
      const l = v.length;
      const w = v.width;
      const ws = l / 2 - l * 0.3;
      const rear = -l / 2 + l * 0.14;
      prims.push({ t: 'poly', layer: 'vehicles', pts: [localToWorld(pose, { x: -w * 0.4, y: ws }), localToWorld(pose, { x: w * 0.4, y: ws })], closed: false, style: { stroke, width: 0.5 } });
      prims.push({ t: 'poly', layer: 'vehicles', pts: [localToWorld(pose, { x: -w * 0.38, y: rear }), localToWorld(pose, { x: w * 0.38, y: rear })], closed: false, style: { stroke, width: 0.5 } });
      // Front arrow
      const tip = localToWorld(pose, { x: 0, y: l / 2 - l * 0.03 });
      const base = localToWorld(pose, { x: 0, y: l / 2 - l * 0.12 });
      prims.push({ t: 'poly', layer: 'vehicles', pts: [base, tip], closed: false, style: { stroke, width: 0.8 } });
      prims.push({ t: 'poly', layer: 'vehicles', pts: [localToWorld(pose, { x: -w * 0.05, y: l / 2 - l * 0.07 }), tip, localToWorld(pose, { x: w * 0.05, y: l / 2 - l * 0.07 })], closed: false, style: { stroke, width: 0.8 } });
      if (o.labels) prims.push({ t: 'text', layer: 'labels', at: localToWorld(pose, { x: 0, y: -l * 0.2 }), text: v.name, size: font * 1.1, anchor: 'middle', baseline: 'middle', color: mono ? monochrome.stroke : INK, weight: 'bold' });
      addLegend({ key: 'vehicle', label: 'Vehicle', fill, stroke, shape: 'rect' });
    }
  }

  // Electrical
  if (o.electrical && layerOn('electrical') && hasRoom) {
    const color = mono ? monochrome.stroke : canvasColors.electrical;
    for (const e of project.electrical) {
      if (e.hidden) continue;
      if (e.kind === 'panel') {
        const { pose } = resolvePlacement(room, e.placement, e.width, 100);
        const rect = localPolygonToWorld(pose, localRect(e.width, 100));
        prims.push({ t: 'poly', layer: 'electrical', pts: rect, closed: true, style: { fill: mono ? '#fff' : '#f5e7c2', stroke: color, width: 0.7 } });
        prims.push({ t: 'poly', layer: 'electrical', pts: [rect[0]!, rect[2]!], closed: false, style: { stroke: color, width: 0.5 } });
        if (o.labels) prims.push({ t: 'text', layer: 'electrical', at: localToWorld(pose, { x: 0, y: 50 + small * 1.2 }), text: e.label || 'Panel', size: small, anchor: 'middle', baseline: 'middle', color });
        addLegend({ key: 'panel', label: 'Electrical panel', fill: mono ? '#fff' : '#f5e7c2', stroke: color, shape: 'rect' });
        continue;
      }
      const p = electricalPosition(room, e);
      const r = unit * 4.5;
      prims.push({ t: 'circle', layer: 'electrical', c: p, r, style: { fill: mono ? '#fff' : '#fff8e6', stroke: color, width: 0.7 } });
      if (e.kind === 'ceiling-outlet') {
        prims.push({ t: 'poly', layer: 'electrical', pts: [add(p, { x: -r * 0.6, y: -r * 0.6 }), add(p, { x: r * 0.6, y: r * 0.6 })], closed: false, style: { stroke: color, width: 0.5 } });
        prims.push({ t: 'poly', layer: 'electrical', pts: [add(p, { x: r * 0.6, y: -r * 0.6 }), add(p, { x: -r * 0.6, y: r * 0.6 })], closed: false, style: { stroke: color, width: 0.5 } });
      } else {
        prims.push({ t: 'poly', layer: 'electrical', pts: [add(p, { x: -r * 0.35, y: -r * 0.45 }), add(p, { x: -r * 0.35, y: r * 0.45 })], closed: false, style: { stroke: color, width: 0.6 } });
        prims.push({ t: 'poly', layer: 'electrical', pts: [add(p, { x: r * 0.35, y: -r * 0.45 }), add(p, { x: r * 0.35, y: r * 0.45 })], closed: false, style: { stroke: color, width: 0.6 } });
      }
      const tags = [e.kind === 'outlet-240' ? '240V' : '', e.gfci ? 'GFCI' : '', e.dedicated ? 'DED' : '', e.kind === 'extension-point' ? 'EXT' : ''].filter(Boolean).join(' ');
      if (tags && o.labels) prims.push({ t: 'text', layer: 'electrical', at: add(p, { x: r * 1.4, y: 0 }), text: tags, size: small * 0.85, anchor: 'start', baseline: 'middle', color, mono: true });
      addLegend({ key: e.kind === 'ceiling-outlet' ? 'ceiling-outlet' : 'outlet', label: e.kind === 'ceiling-outlet' ? 'Ceiling outlet' : 'Outlet (240V / GFCI tagged)', fill: mono ? '#fff' : '#fff8e6', stroke: color, shape: 'circle' });
    }
  }

  // Lighting
  if (o.lighting && layerOn('lighting')) {
    const color = mono ? monochrome.stroke : canvasColors.light;
    for (const l of scenario.lights) {
      if (l.hidden) continue;
      const pose = { x: l.x, y: l.y, rotation: l.rotation };
      prims.push({ t: 'poly', layer: 'lighting', pts: localPolygonToWorld(pose, localRect(l.length, l.width)), closed: true, style: { fill: mono ? '#fff' : '#fff4c4', stroke: color, width: 0.7 } });
      prims.push({ t: 'poly', layer: 'lighting', pts: [localToWorld(pose, { x: -l.length / 2, y: 0 }), localToWorld(pose, { x: l.length / 2, y: 0 })], closed: false, style: { stroke: color, width: 0.4 } });
      addLegend({ key: 'light', label: 'Light fixture', fill: mono ? '#fff' : '#fff4c4', stroke: color, shape: 'rect' });
    }
  }

  // Dimensions: exterior wall dimensions + saved measurements
  if (o.measurements && hasRoom) {
    const dimColor = mono ? monochrome.stroke : canvasColors.dimension;
    for (const w of g.walls) {
      if (w.length < 150) continue;
      const t = g.thickness[w.index] ?? 0;
      // Offset outward, past the wall thickness (sign relative to the dimension's left normal).
      const side = perp(w.dir).x * w.outward.x + perp(w.dir).y * w.outward.y >= 0 ? 1 : -1;
      prims.push({ t: 'dim', layer: 'dimensions', a: w.a, b: w.b, offset: side * (t + unit * 14), text: fmt(w.length), color: dimColor });
    }
    if (layerOn('measurements')) {
      for (const m of scenario.measurements) {
        if (m.hidden) continue;
        const rm = resolveMeasurement(project, scenario, m);
        if (m.kind === 'angular' && rm.c) {
          prims.push({ t: 'poly', layer: 'measurements', pts: [rm.b, rm.a, rm.c], closed: false, style: { stroke: dimColor, width: 0.6 } });
          prims.push({ t: 'text', layer: 'measurements', at: add(rm.a, { x: small, y: -small }), text: `${rm.value.toFixed(1)}°`, size: small, anchor: 'start', baseline: 'middle', color: dimColor, mono: true });
          continue;
        }
        const text = rm.title ? `${fmt(rm.value)} · ${rm.title}` : fmt(rm.value);
        prims.push({ t: 'dim', layer: 'measurements', a: rm.a, b: rm.b, offset: m.offset, text, color: dimColor });
      }
    }
    addLegend({ key: 'dim', label: 'Dimension (interior faces)', stroke: dimColor, shape: 'line' });
  }

  // Annotations: north arrow + scale bar
  let scaleBar: PlanDrawing['scaleBar'];
  if (o.annotations) {
    const sb = niceScaleBar(bboxWidth(content), imperial);
    scaleBar = sb;
    const y = bounds.maxY - margin * 0.35;
    const x0 = bounds.minX + margin * 0.5;
    const h = unit * 4;
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const xa = x0 + (sb.length * i) / segs;
      prims.push({
        t: 'poly',
        layer: 'annotations',
        pts: [
          { x: xa, y: y - h },
          { x: xa + sb.length / segs, y: y - h },
          { x: xa + sb.length / segs, y },
          { x: xa, y },
        ],
        closed: true,
        style: { fill: i % 2 === 0 ? INK : '#ffffff', stroke: INK, width: 0.5 },
      });
    }
    prims.push({ t: 'text', layer: 'annotations', at: { x: x0, y: y - h - small * 0.9 }, text: '0', size: small, anchor: 'middle', color: INK, mono: true });
    prims.push({ t: 'text', layer: 'annotations', at: { x: x0 + sb.length, y: y - h - small * 0.9 }, text: sb.label, size: small, anchor: 'middle', color: INK, mono: true });
    // North arrow (plan north is up: −y)
    const nx = bounds.maxX - margin * 0.5;
    const ny = bounds.minY + margin * 0.55;
    const s = Math.min(margin * 0.3, unit * 14);
    prims.push({ t: 'poly', layer: 'annotations', pts: [{ x: nx, y: ny - s }, { x: nx + s * 0.45, y: ny + s * 0.6 }, { x: nx, y: ny + s * 0.25 }, { x: nx - s * 0.45, y: ny + s * 0.6 }], closed: true, style: { fill: INK, stroke: INK, width: 0.5 } });
    prims.push({ t: 'text', layer: 'annotations', at: { x: nx, y: ny - s - small * 0.6 }, text: 'N', size: font, anchor: 'middle', color: INK, weight: 'bold' });
  }

  layoutLabels(prims, unit, mono);

  return { prims, bounds, roomBounds, unit, legend, fmt, scaleBar };
}

// ───────────────────────────── label placement ─────────────────────────────

type TextPrim = Extract<Prim, { t: 'text' }>;
interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: LabelBox, b: LabelBox) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Bounding box of a text primitive placed at `at` (world mm), with a little breathing room. */
function textBox(p: TextPrim, at: Point): LabelBox {
  const w = textWidth(p.text, p.size);
  const h = p.size * 1.15;
  const pad = p.size * 0.18;
  const rotated = Math.abs(((p.rotation ?? 0) % 180) - 90) < 45;
  const bw = (rotated ? h : w) / 2 + pad;
  const bh = (rotated ? w : h) / 2 + pad;
  const dx = p.anchor === 'start' ? bw : p.anchor === 'end' ? -bw : 0;
  return { x0: at.x + dx - bw, x1: at.x + dx + bw, y0: at.y - bh, y1: at.y + bh };
}

/**
 * Greedy label placement for printed / exported sheets: dimension and annotation text is fixed;
 * every other label keeps its spot when it is free, otherwise it tries a few anchors around it
 * (with a leader line back to what it names) and is dropped when nothing fits. Without this,
 * labels on a real layout print on top of each other and on top of symbols.
 */
function layoutLabels(prims: Prim[], unit: number, mono: boolean) {
  const placed: LabelBox[] = [];
  // Fixed obstacles: dimension text (drawn by the renderer from the 'dim' primitive) and margin
  // annotations (scale bar, north arrow).
  for (const p of prims) {
    if (p.t === 'dim') {
      const g = dimensionGeometry(p, unit);
      const size = unit * 7.5;
      const w = textWidth(p.text, size);
      const h = size * 1.15;
      const rad = (g.angle * Math.PI) / 180;
      const bw = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
      const bh = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2;
      placed.push({ x0: g.textAt.x - bw, x1: g.textAt.x + bw, y0: g.textAt.y - bh, y1: g.textAt.y + bh });
    } else if (p.t === 'text' && (p.layer === 'annotations' || p.layer === 'measurements')) {
      placed.push(textBox(p, p.at));
    } else if (p.t === 'circle' && p.layer === 'electrical') {
      // Outlet glyphs: small symbols labels must not sit on.
      placed.push({ x0: p.c.x - p.r, x1: p.c.x + p.r, y0: p.c.y - p.r, y1: p.c.y + p.r });
    } else if (p.t === 'poly' && p.layer === 'electrical' && p.closed) {
      const b = bbox(p.pts);
      placed.push({ x0: b.minX, x1: b.maxX, y0: b.minY, y1: b.maxY });
    }
  }

  // Movable labels, most important first (bigger, bolder text wins its spot).
  const movable = prims.filter((p): p is TextPrim => p.t === 'text' && p.layer !== 'annotations' && p.layer !== 'measurements');
  const rank = (p: TextPrim) => (p.layer === 'labels' ? 0 : p.layer === 'zones' ? 2 : 1);
  const order = movable
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || b.p.size - a.p.size || a.i - b.i);
  const leaders: Prim[] = [];
  const dropped = new Set<TextPrim>();

  for (const { p } of order) {
    const step = p.size * 1.35;
    const candidates: Point[] = [{ x: p.at.x, y: p.at.y }];
    for (const k of [1, 2, 3])
      candidates.push(
        { x: p.at.x, y: p.at.y - step * k },
        { x: p.at.x, y: p.at.y + step * k },
        { x: p.at.x + textWidth(p.text, p.size) * 0.6, y: p.at.y - step * (k - 0.5) },
        { x: p.at.x - textWidth(p.text, p.size) * 0.6, y: p.at.y - step * (k - 0.5) },
      );
    const spot = candidates.find((c) => !placed.some((b) => overlaps(b, textBox(p, c))));
    if (!spot) {
      dropped.add(p);
      continue;
    }
    placed.push(textBox(p, spot));
    const moved = Math.hypot(spot.x - p.at.x, spot.y - p.at.y);
    if (moved > p.size * 0.8) {
      // Leader line from what the label names to the label.
      const box = textBox(p, spot);
      const edge = { x: Math.max(box.x0, Math.min(p.at.x, box.x1)), y: spot.y > p.at.y ? box.y0 : box.y1 };
      leaders.push({ t: 'poly', layer: p.layer, pts: [p.at, edge], closed: false, style: { stroke: mono ? monochrome.stroke : canvasColors.inkMuted, width: 0.35, opacity: 0.7 } });
    }
    p.at = spot;
  }

  if (dropped.size) {
    for (let i = prims.length - 1; i >= 0; i--) {
      const p = prims[i]!;
      if (p.t === 'text' && dropped.has(p)) prims.splice(i, 1);
    }
  }
  prims.push(...leaders);
}

// ───────────────────────────── architecture ─────────────────────────────

function drawFeature(prims: Prim[], room: Room, f: ArchitecturalFeature, o: { mono: boolean; font: number; labels: boolean; fmt: Fmt; unit: number }) {
  const g = roomGeometry(room);
  const fp = featureFootprint(room, f);
  if (fp.length < 3) return;
  const ink = o.mono ? monochrome.stroke : INK;
  const { pose } = resolvePlacement(room, f.placement, f.width, f.depth);
  if (OPENING_KINDS.has(f.kind)) {
    const wall = f.placement.type === 'wall' ? g.walls[g.wallIndex.get(f.placement.wallId) ?? -1] : undefined;
    if (f.kind === 'garage-door' && f.garageDoor && wall && f.placement.type === 'wall') {
      const s0 = f.placement.offset - f.width / 2;
      const s1 = f.placement.offset + f.width / 2;
      const L = f.garageDoor.trackLength;
      const area = [pointOnWall(wall, s0, 0), pointOnWall(wall, s1, 0), pointOnWall(wall, s1, L), pointOnWall(wall, s0, L)];
      prims.push({ t: 'poly', layer: 'openings', pts: area, closed: true, style: { fill: o.mono ? undefined : '#e3e5e7', fillOpacity: 0.5, stroke: canvasColors.doorSwing, width: 0.5, dash: [6, 4] } });
      prims.push({ t: 'poly', layer: 'openings', pts: [pointOnWall(wall, s0 - 40, 0), pointOnWall(wall, s0 - 40, L)], closed: false, style: { stroke: canvasColors.doorSwing, width: 0.8 } });
      prims.push({ t: 'poly', layer: 'openings', pts: [pointOnWall(wall, s1 + 40, 0), pointOnWall(wall, s1 + 40, L)], closed: false, style: { stroke: canvasColors.doorSwing, width: 0.8 } });
    }
    prims.push({ t: 'poly', layer: 'openings', pts: fp, closed: true, style: { fill: f.kind === 'window' ? (o.mono ? '#ffffff' : '#dbe9f4') : '#ffffff', stroke: f.kind === 'window' && !o.mono ? canvasColors.window : ink, width: 0.6 } });
    if (f.kind === 'window' && fp.length === 4) {
      prims.push({ t: 'poly', layer: 'openings', pts: [mid(fp[0]!, fp[1]!), mid(fp[2]!, fp[3]!)], closed: false, style: { stroke: o.mono ? ink : canvasColors.window, width: 0.5 } });
    }
    if ((f.kind === 'door' || f.kind === 'double-door') && f.door && f.door.swing !== 'none' && wall && f.placement.type === 'wall') {
      const s0 = f.placement.offset - f.width / 2;
      const s1 = f.placement.offset + f.width / 2;
      const into = f.door.swing === 'in' ? wall.inward : wall.outward;
      const t = g.thickness[wall.index] ?? 0;
      const faceOffset = f.door.swing === 'in' ? 0 : -t;
      const a = pointOnWall(wall, s0, faceOffset);
      const b = pointOnWall(wall, s1, faceOffset);
      const leaves: Array<{ hinge: Point; closedDir: Point; length: number }> = [];
      if (f.kind === 'double-door') leaves.push({ hinge: a, closedDir: wall.dir, length: f.width / 2 }, { hinge: b, closedDir: vscale(wall.dir, -1), length: f.width / 2 });
      else {
        const leftIsStart = (f.door.hinge === 'left') === signedArea(g.polygon) > 0;
        leaves.push(leftIsStart ? { hinge: a, closedDir: wall.dir, length: f.width } : { hinge: b, closedDir: vscale(wall.dir, -1), length: f.width });
      }
      for (const leaf of leaves) {
        const closed = angleOf(leaf.closedDir);
        let delta = angleOf(into) - closed;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        const end = closed + Math.sign(delta) * Math.min(Math.abs(delta), f.door.openAngle);
        const tip = add(leaf.hinge, vscale(rotate({ x: 1, y: 0 }, end), leaf.length));
        prims.push({ t: 'poly', layer: 'openings', pts: arc(leaf.hinge, leaf.length, closed, end), closed: false, style: { stroke: canvasColors.doorSwing, width: 0.5, dash: [3, 2] } });
        prims.push({ t: 'poly', layer: 'openings', pts: [leaf.hinge, tip], closed: false, style: { stroke: ink, width: 0.9 } });
      }
    }
    if (o.labels && f.kind === 'garage-door' && fp.length === 4 && wall) {
      const m = add(mid(fp[0]!, fp[1]!), vscale(wall.inward, o.font * 2.2));
      prims.push({ t: 'text', layer: 'labels', at: m, text: `${f.name} · ${o.fmt(f.width)} × ${o.fmt(f.garageDoor?.openingHeight ?? f.height)}`, size: o.font, anchor: 'middle', baseline: 'middle', color: canvasColors.inkMuted });
    }
    return;
  }
  const overhead = OVERHEAD_KINDS.has(f.kind);
  if (f.shape === 'round') {
    prims.push({ t: 'circle', layer: 'architecture', c: pose, r: f.width / 2, style: { fill: o.mono ? '#ffffff' : '#9aa1a8', stroke: ink, width: 0.7 } });
  } else {
    prims.push({ t: 'poly', layer: 'architecture', pts: fp, closed: true, style: { fill: overhead ? (o.mono ? undefined : '#6d747c') : o.mono ? '#ffffff' : (f.color ?? '#c7ccd1'), fillOpacity: overhead ? 0.08 : 1, stroke: ink, width: 0.6, dash: overhead ? [5, 3] : undefined } });
    if (!overhead) prims.push({ t: 'poly', layer: 'architecture', pts: [fp[0]!, fp[2]!], closed: false, style: { stroke: canvasColors.inkMuted, width: 0.4, opacity: 0.5 } });
  }
  if (o.labels) {
    const text = f.shape === 'round' && f.kind === 'support-pole' ? `${f.name} ⌀ ${o.fmt(f.width)}` : overhead ? `${f.name} (overhead)` : f.name;
    const at = f.shape === 'round' ? add(pose, { x: 0, y: f.width / 2 + o.font * 1.1 }) : { x: pose.x, y: pose.y };
    prims.push({ t: 'text', layer: 'labels', at, text, size: o.font, anchor: 'middle', baseline: 'middle', color: ink });
  }
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Geometry of a dimension primitive: offset line, extension lines, ticks and text anchor. */
export function dimensionGeometry(d: { a: Point; b: Point; offset: number }, unit: number) {
  const dir = normalize(sub(d.b, d.a));
  const n = perp(dir); // left normal
  const off = vscale(n, d.offset);
  const a2 = add(d.a, off);
  const b2 = add(d.b, off);
  const ext = unit * 2;
  const extSign = Math.sign(d.offset) || 1;
  const extA: [Point, Point] = [add(d.a, vscale(n, extSign * unit * 1.5)), add(a2, vscale(n, extSign * ext))];
  const extB: [Point, Point] = [add(d.b, vscale(n, extSign * unit * 1.5)), add(b2, vscale(n, extSign * ext))];
  const tick = unit * 3;
  const diag = normalize(add(dir, n));
  const ticks: Array<[Point, Point]> = [a2, b2].map((p) => [add(p, vscale(diag, -tick)), add(p, vscale(diag, tick))]);
  let angle = angleOf(dir);
  // Keep text upright.
  if (angle > 90 || angle <= -90) angle += 180;
  angle = ((angle + 180) % 360) - 180;
  const textAt = add(mid(a2, b2), vscale(n, extSign * unit * 3.2));
  return { a2, b2, extA, extB, ticks, angle, textAt, drawExt: Math.abs(d.offset) > unit };
}
