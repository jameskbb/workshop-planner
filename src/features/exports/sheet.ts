/**
 * Printable sheet composition shared by PDF export and print mode: paper sizes, scale selection
 * (fit-to-page snapped to a standard architectural/metric scale, or a fixed scale), and one SVG in
 * paper millimeters with the plan, a title block (project, layout, date, stated scale, key
 * measurements, notes) and a legend. Pure.
 */
import { getScenario, roomGeometry } from '@/domain/resolve';
import { resolveMeasurement } from '@/domain/measure';
import type { Project } from '@/domain/schema';
import { area, bbox, bboxHeight, bboxWidth } from '@/geometry';
import { buildPlanDrawing, type Fmt, type PlanOptions } from './plan/drawing';
import { escapeXml, legendLayout, legendSvg, pdfSafeText, renderSvg, SANS } from './plan/svg';

export const PAPER_SIZES = {
  letter: { label: 'Letter (8.5 × 11 in)', w: 215.9, h: 279.4 },
  legal: { label: 'Legal (8.5 × 14 in)', w: 215.9, h: 355.6 },
  tabloid: { label: 'Tabloid (11 × 17 in)', w: 279.4, h: 431.8 },
  a4: { label: 'A4 (210 × 297 mm)', w: 210, h: 297 },
  a3: { label: 'A3 (297 × 420 mm)', w: 297, h: 420 },
} as const;
export type PaperId = keyof typeof PAPER_SIZES;
export type Orientation = 'portrait' | 'landscape';

export interface ScaleChoice {
  /** Scale denominator (1:n). */
  denom: number;
  label: string;
}

/** Standard architectural (imperial) scales, largest drawing first. */
export const IMPERIAL_SCALES: ScaleChoice[] = [
  { denom: 12, label: '1" = 1\'-0"' },
  { denom: 16, label: '3/4" = 1\'-0"' },
  { denom: 24, label: '1/2" = 1\'-0"' },
  { denom: 32, label: '3/8" = 1\'-0"' },
  { denom: 48, label: '1/4" = 1\'-0"' },
  { denom: 64, label: '3/16" = 1\'-0"' },
  { denom: 96, label: '1/8" = 1\'-0"' },
  { denom: 128, label: '3/32" = 1\'-0"' },
  { denom: 192, label: '1/16" = 1\'-0"' },
  { denom: 384, label: '1/32" = 1\'-0"' },
];
export const METRIC_SCALES: ScaleChoice[] = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000].map((d) => ({ denom: d, label: `1:${d}` }));

export const PT_MM = 25.4 / 72;

export interface SheetOptions {
  paper: PaperId;
  orientation: Orientation;
  /** 'fit' picks the largest standard scale that fits; otherwise a fixed denominator. */
  scale: 'fit' | number;
  plan: Partial<PlanOptions>;
  legend: boolean;
  notes: string;
  /** ISO date shown in the title block (defaults to today). */
  date?: string;
  pdfSafe?: boolean;
}

export interface Sheet {
  svg: string;
  widthMm: number;
  heightMm: number;
  scale: ScaleChoice;
  /** True when a fixed scale is too large for the page (the plan is clipped). */
  clipped: boolean;
}

export function paperSize(paper: PaperId, orientation: Orientation): { w: number; h: number } {
  const p = PAPER_SIZES[paper];
  return orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

export function scaleList(project: Project): ScaleChoice[] {
  return project.settings.unitSystem === 'imperial' ? IMPERIAL_SCALES : METRIC_SCALES;
}

/** Largest standard scale at which `worldW × worldH` fits `areaW × areaH` (paper mm). */
export function fitScale(worldW: number, worldH: number, areaW: number, areaH: number, list: ScaleChoice[]): ScaleChoice {
  const exact = Math.max(worldW / areaW, worldH / areaH);
  return list.find((s) => s.denom >= exact) ?? { denom: Math.ceil(exact), label: `1:${Math.ceil(exact)}` };
}

export function describeScale(s: ScaleChoice, imperial: boolean): string {
  return imperial && !s.label.startsWith('1:') ? `${s.label} (1:${s.denom})` : `1:${s.denom}`;
}

function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((line + ' ' + word).trim().length > maxChars) {
        if (line) out.push(line);
        line = word;
      } else line = `${line} ${word}`.trim();
    }
    out.push(line);
  }
  return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function buildSheet(project: Project, fmt: Fmt, o: SheetOptions): Sheet {
  const { w: W, h: H } = paperSize(o.paper, o.orientation);
  const imperial = project.settings.unitSystem === 'imperial';
  const tx = o.pdfSafe ? pdfSafeText : (s: string) => s;
  const M = 10; // frame margin (mm)
  const pad = 4;
  const scenario = getScenario(project, o.plan.scenarioId);
  const date = o.date ?? new Date().toISOString().slice(0, 10);

  // Key measurements
  const g = roomGeometry(project.room);
  const facts: string[] = [];
  if (g.polygon.length >= 3) {
    const b = bbox(g.polygon);
    facts.push(`Overall interior: ${fmt(bboxWidth(b))} × ${fmt(bboxHeight(b))}`);
    facts.push(`Floor area: ${formatAreaQuick(area(g.polygon), imperial)} · Ceiling: ${fmt(project.room.ceilingHeight)}`);
  }
  for (const m of scenario.measurements.filter((m) => !m.hidden && m.kind !== 'angular').slice(0, 4)) {
    const r = resolveMeasurement(project, scenario, m);
    facts.push(`${r.title || 'Measurement'}: ${fmt(r.value)}`);
  }

  // Info band layout (bottom). Legend on the right, title/measurements/notes on the left.
  const bandW = W - 2 * M;
  const leftW = Math.min(bandW * 0.46, 110);
  const legendW = bandW - leftW - pad * 3;
  const noteLines = o.notes.trim() ? wrap(o.notes.trim(), Math.floor(leftW / 1.6)).slice(0, 6) : [];
  const leftH = 7 + 5 + 4.2 * (2 + facts.length) + (noteLines.length ? 4 + 3.6 * noteLines.length : 0) + pad;

  // First pass to learn the legend; unit does not change which entries appear.
  const probe = buildPlanDrawing(project, fmt, { ...o.plan, annotations: false });
  const legendEntries = o.legend ? probe.legend : [];
  const L = legendLayout(legendEntries, legendW, PT_MM);
  const bandH = Math.max(leftH, L.height + pad, 30);

  // Plan area
  const areaX = M + pad;
  const areaY = M + pad;
  const areaW = W - 2 * M - 2 * pad;
  const areaH = H - 2 * M - bandH - 3 * pad;
  const list = scaleList(project);
  // Size without margins/annotations to choose the scale, then rebuild with the true unit.
  const content = probe.bounds;
  const contentW = bboxWidth(content);
  const contentH = bboxHeight(content);
  const fitted = fitScale(contentW, contentH, areaW, areaH, list);
  const scale = o.scale === 'fit' ? fitted : (list.find((s) => s.denom === o.scale) ?? { denom: o.scale, label: `1:${o.scale}` });
  const unit = scale.denom * PT_MM;
  const drawing = buildPlanDrawing(project, fmt, { ...o.plan, annotations: true, unit, margin: Math.max(unit * 26, 300) });
  const dW = bboxWidth(drawing.bounds);
  const dH = bboxHeight(drawing.bounds);
  const k = 1 / scale.denom;
  const clipped = dW * k > areaW + 0.5 || dH * k > areaH + 0.5;
  // Center the plan in its area.
  const ox = areaX + (areaW - dW * k) / 2;
  const oy = areaY + (areaH - dH * k) / 2;
  const planSvg = renderSvg(drawing, { pdfSafe: o.pdfSafe, background: '#ffffff' });
  const inner = planSvg.svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(W)}mm" height="${n(H)}mm">`);
  parts.push(`<defs><clipPath id="wp-plan-clip"><rect x="${n(areaX)}" y="${n(areaY)}" width="${n(areaW)}" height="${n(areaH)}"/></clipPath></defs>`);
  parts.push(`<rect x="0" y="0" width="${n(W)}" height="${n(H)}" fill="#ffffff"/>`);
  parts.push(`<g clip-path="url(#wp-plan-clip)"><g transform="translate(${n(ox)} ${n(oy)}) scale(${k}) translate(${n(-drawing.bounds.minX)} ${n(-drawing.bounds.minY)})">${inner}</g></g>`);
  // Frame + band separator
  parts.push(`<rect x="${M}" y="${M}" width="${n(W - 2 * M)}" height="${n(H - 2 * M)}" fill="none" stroke="#22262a" stroke-width="0.35"/>`);
  const bandY = H - M - bandH;
  parts.push(`<line x1="${M}" y1="${n(bandY)}" x2="${n(W - M)}" y2="${n(bandY)}" stroke="#22262a" stroke-width="0.35"/>`);
  parts.push(`<line x1="${n(M + leftW + pad)}" y1="${n(bandY)}" x2="${n(M + leftW + pad)}" y2="${n(H - M)}" stroke="#22262a" stroke-width="0.2"/>`);
  const text = (x: number, y: number, s: string, size: number, extra = '') =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" font-family="${SANS}" fill="#22262a" ${extra}>${escapeXml(tx(s))}</text>`;
  let y = bandY + 7;
  const x = M + pad;
  parts.push(text(x, y, project.name, 5, 'font-weight="bold"'));
  y += 5;
  parts.push(text(x, y, `Layout: ${scenario.name} · ${date}`, 3, 'fill-opacity="0.8"'));
  y += 4.6;
  parts.push(text(x, y, `Scale ${describeScale(scale, imperial)}${clipped ? ' (does not fit this page, clipped)' : ''}`, 3, 'font-weight="bold"'));
  for (const f of facts) {
    y += 4.2;
    parts.push(text(x, y, f, 2.8));
  }
  if (noteLines.length) {
    y += 5;
    parts.push(text(x, y, 'NOTES', 2.4, 'font-weight="bold" fill-opacity="0.7"'));
    for (const l of noteLines) {
      y += 3.6;
      parts.push(text(x, y, l, 2.8));
    }
  }
  parts.push(text(W - M - pad, H - M - 2, 'Dimensions are to interior wall faces. Library sizes are approximate; verify before moving heavy items.', 2.1, 'text-anchor="end" fill-opacity="0.6"'));
  if (legendEntries.length) parts.push(legendSvg(legendEntries, M + leftW + pad * 2, bandY + 1, legendW, PT_MM, tx));
  parts.push('</svg>');
  return { svg: parts.join('\n'), widthMm: W, heightMm: H, scale, clipped };
}

function formatAreaQuick(mm2: number, imperial: boolean): string {
  return imperial ? `${Math.round(mm2 / 92903.04)} sq ft` : `${(mm2 / 1e6).toFixed(1)} m²`;
}
