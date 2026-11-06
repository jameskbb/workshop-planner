/**
 * SVG serializer for the plan drawing model. Output is plain SVG 1.1 (no CSS, no
 * `vector-effect`, no `dominant-baseline`) so it also converts cleanly to PDF (svg2pdf) and
 * rasterizes identically in every browser for PNG export.
 */
import { bboxHeight, bboxWidth, type Point } from '@/geometry';
import { dimensionGeometry, textWidth, type LegendEntry, type PlanDrawing, type Prim, type Style } from './drawing';

export const SANS = 'Inter, Helvetica, Arial, sans-serif';
export const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Replace glyphs that the standard PDF fonts cannot show (used for PDF output). */
export function pdfSafeText(s: string): string {
  return s
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/⌀/g, 'Ø')
    .replace(/→/g, '->')
    .replace(/[–\u2014]/g, '-')
    .replace(/…/g, '...');
}

const n = (v: number): string => (Math.round(v * 100) / 100).toString();
const pts = (p: Point[]): string => p.map((q) => `${n(q.x)},${n(q.y)}`).join(' ');

function styleAttrs(s: Style, unit: number, closed: boolean): string {
  const a: string[] = [];
  a.push(`fill="${closed && s.fill ? s.fill : 'none'}"`);
  if (closed && s.fill && s.fillOpacity !== undefined && s.fillOpacity < 1) a.push(`fill-opacity="${n(s.fillOpacity)}"`);
  if (s.stroke) {
    a.push(`stroke="${s.stroke}"`, `stroke-width="${n((s.width ?? 1) * unit)}"`, 'stroke-linejoin="round"', 'stroke-linecap="round"');
    if (s.dash?.length) a.push(`stroke-dasharray="${s.dash.map((d) => n(d * unit)).join(' ')}"`);
  }
  if (s.opacity !== undefined && s.opacity < 1) a.push(`opacity="${n(s.opacity)}"`);
  return a.join(' ');
}

function textEl(p: Extract<Prim, { t: 'text' }>, transform: (s: string) => string): string {
  const shift = p.baseline === 'middle' ? p.size * 0.35 : p.baseline === 'hanging' ? p.size * 0.8 : 0;
  const x = p.at.x;
  const y = p.at.y + shift;
  const rot = p.rotation ? ` transform="rotate(${n(p.rotation)} ${n(p.at.x)} ${n(p.at.y)})"` : '';
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `font-size="${n(p.size)}"`,
    `font-family="${p.mono ? MONO : SANS}"`,
    `text-anchor="${p.anchor}"`,
    `fill="${p.color}"`,
    p.weight === 'bold' ? 'font-weight="bold"' : '',
    p.italic ? 'font-style="italic"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<text ${attrs}${rot}>${escapeXml(transform(p.text))}</text>`;
}

function primEl(p: Prim, unit: number, transform: (s: string) => string): string {
  switch (p.t) {
    case 'poly':
      return p.closed ? `<polygon points="${pts(p.pts)}" ${styleAttrs(p.style, unit, true)}/>` : `<polyline points="${pts(p.pts)}" ${styleAttrs(p.style, unit, false)}/>`;
    case 'circle':
      return `<circle cx="${n(p.c.x)}" cy="${n(p.c.y)}" r="${n(p.r)}" ${styleAttrs(p.style, unit, true)}/>`;
    case 'text':
      return textEl(p, transform);
    case 'dim': {
      const g = dimensionGeometry(p, unit);
      const st = `stroke="${p.color}" stroke-width="${n(0.6 * unit)}" fill="none" stroke-linecap="round"`;
      const parts = [`<line x1="${n(g.a2.x)}" y1="${n(g.a2.y)}" x2="${n(g.b2.x)}" y2="${n(g.b2.y)}" ${st}/>`];
      if (g.drawExt) for (const [a, b] of [g.extA, g.extB]) parts.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" ${st} opacity="0.7"/>`);
      for (const [a, b] of g.ticks) parts.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${p.color}" stroke-width="${n(0.9 * unit)}"/>`);
      const size = unit * 7.5;
      parts.push(textEl({ t: 'text', layer: p.layer, at: g.textAt, text: p.text, size, rotation: g.angle, anchor: 'middle', baseline: 'middle', color: p.color, mono: true }, transform));
      return parts.join('');
    }
  }
}

export interface SvgRenderOptions {
  /** Draw a legend strip under the plan. */
  legend?: boolean;
  /** Title line above the legend. */
  title?: string;
  /** Background color (default white). */
  background?: string;
  /** Glyph substitution for PDF fonts. */
  pdfSafe?: boolean;
  /** Include an XML declaration (standalone .svg files). */
  standalone?: boolean;
}

export interface RenderedSvg {
  svg: string;
  /** viewBox in world mm. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Natural size in CSS px (1 pt = 4/3 px). */
  widthPx: number;
  heightPx: number;
}

/** Height (world mm) the legend block needs for `entries` across `width`. */
export function legendLayout(entries: LegendEntry[], width: number, unit: number) {
  const colW = unit * 125;
  const cols = Math.max(1, Math.floor(width / colW));
  const rowH = unit * 14;
  const rows = Math.ceil(entries.length / cols);
  return { cols, colW: width / cols, rowH, height: rows ? rows * rowH + unit * 22 : 0 };
}

export function legendSvg(entries: LegendEntry[], x0: number, y0: number, width: number, unit: number, transform: (s: string) => string, heading = 'Legend'): string {
  const L = legendLayout(entries, width, unit);
  const parts: string[] = [];
  const size = unit * 7.5;
  parts.push(textEl({ t: 'text', layer: 'annotations', at: { x: x0, y: y0 + unit * 9 }, text: heading.toUpperCase(), size: unit * 7, anchor: 'start', color: '#5f666d', weight: 'bold' }, transform));
  entries.forEach((e, i) => {
    const cx = x0 + (i % L.cols) * L.colW;
    const cy = y0 + unit * 18 + Math.floor(i / L.cols) * L.rowH;
    const sw = unit * 16;
    const sh = unit * 9;
    const dash = e.dash ? ` stroke-dasharray="${n(unit * 3)} ${n(unit * 2)}"` : '';
    if (e.shape === 'rect') parts.push(`<rect x="${n(cx)}" y="${n(cy)}" width="${n(sw)}" height="${n(sh)}" fill="${e.fill ?? 'none'}" stroke="${e.stroke}" stroke-width="${n(unit * 0.8)}"${dash}/>`);
    else if (e.shape === 'circle') parts.push(`<circle cx="${n(cx + sw / 2)}" cy="${n(cy + sh / 2)}" r="${n(sh / 2)}" fill="${e.fill ?? 'none'}" stroke="${e.stroke}" stroke-width="${n(unit * 0.8)}"/>`);
    else parts.push(`<line x1="${n(cx)}" y1="${n(cy + sh / 2)}" x2="${n(cx + sw)}" y2="${n(cy + sh / 2)}" stroke="${e.stroke}" stroke-width="${n(unit * 1)}"${dash}/>`);
    parts.push(textEl({ t: 'text', layer: 'annotations', at: { x: cx + sw + unit * 5, y: cy + sh / 2 }, text: e.label, size, anchor: 'start', baseline: 'middle', color: '#22262a' }, transform));
  });
  return parts.join('');
}

export function renderSvg(d: PlanDrawing, o: SvgRenderOptions = {}): RenderedSvg {
  const transform = o.pdfSafe ? pdfSafeText : (s: string) => s;
  const x = d.bounds.minX;
  const y = d.bounds.minY;
  const width = bboxWidth(d.bounds);
  let height = bboxHeight(d.bounds);
  const body = d.prims.map((p) => primEl(p, d.unit, transform));
  const extra: string[] = [];
  if (o.title) {
    extra.push(textEl({ t: 'text', layer: 'annotations', at: { x: x + d.unit * 12, y: y + d.unit * 18 }, text: o.title, size: d.unit * 12, anchor: 'start', color: '#22262a', weight: 'bold' }, transform));
  }
  if (o.legend && d.legend.length) {
    const L = legendLayout(d.legend, width - d.unit * 24, d.unit);
    extra.push(legendSvg(d.legend, x + d.unit * 12, y + height, width - d.unit * 24, d.unit, transform));
    height += L.height;
  }
  const widthPx = (width / d.unit) * (4 / 3);
  const heightPx = (height / d.unit) * (4 / 3);
  const svg = [
    o.standalone ? '<?xml version="1.0" encoding="UTF-8"?>' : '',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${n(x)} ${n(y)} ${n(width)} ${n(height)}" width="${n(widthPx)}" height="${n(heightPx)}">`,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${o.background ?? '#ffffff'}"/>`,
    ...body,
    ...extra,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
  return { svg, viewBox: { x, y, width, height }, widthPx, heightPx };
}

/** Width of a text run in world mm (exported for layout code in print/PDF). */
export { textWidth };
