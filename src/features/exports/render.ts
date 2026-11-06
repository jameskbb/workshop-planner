/**
 * Browser-side renderers: SVG → PNG (offscreen canvas at a chosen DPI) and sheet SVG → PDF
 * (jsPDF + svg2pdf, loaded lazily so they stay out of the main bundle).
 */
import type { Project } from '@/domain/schema';
import { makeFormatters } from '@/hooks/useFormatters';
import { buildPlanDrawing } from './plan/drawing';
import { renderSvg } from './plan/svg';
import { buildSheet, type SheetOptions } from './sheet';
import { planOptionsFrom, type ExportPrefs } from './prefs';

export const fileBase = (project: Project, scenarioName?: string): string =>
  [project.name, scenarioName]
    .filter(Boolean)
    .join(' - ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plan';

export function planSvgFor(project: Project, prefs: ExportPrefs, scenarioId: string, legend = true) {
  const fmt = makeFormatters(project.settings).length;
  const drawing = buildPlanDrawing(project, fmt, { ...planOptionsFrom(prefs.toggles, scenarioId), annotations: true });
  const scenario = project.scenarios.find((s) => s.id === scenarioId);
  return renderSvg(drawing, { legend, standalone: true, title: `${project.name}: ${scenario?.name ?? ''}` });
}

export function sheetOptionsFor(prefs: ExportPrefs, scenarioId: string, pdfSafe = false): SheetOptions {
  return {
    paper: prefs.paper,
    orientation: prefs.orientation,
    scale: prefs.scale === 0 ? 'fit' : prefs.scale,
    plan: planOptionsFrom(prefs.toggles, scenarioId),
    legend: prefs.legend,
    notes: prefs.notes,
    pdfSafe,
  };
}

export function sheetFor(project: Project, prefs: ExportPrefs, scenarioId: string, pdfSafe = false) {
  return buildSheet(project, makeFormatters(project.settings).length, sheetOptionsFor(prefs, scenarioId, pdfSafe));
}

/** Pixel size of a PNG export. Plan: natural size (≈ 1000 pt wide) at `dpi`; sheet: paper × dpi. */
export function pngSize(naturalPx: { width: number; height: number }, dpi: number): { width: number; height: number } {
  const k = dpi / 96;
  let width = Math.round(naturalPx.width * k);
  let height = Math.round(naturalPx.height * k);
  const max = 12000;
  if (Math.max(width, height) > max) {
    const s = max / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  return { width, height };
}

export async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The plan image could not be rendered.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot create an image canvas.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed (image too large?).'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(project: Project, prefs: ExportPrefs, scenarioId: string): Promise<Blob> {
  if (prefs.pngContent === 'sheet') {
    const sheet = sheetFor(project, prefs, scenarioId);
    const w = Math.round((sheet.widthMm / 25.4) * prefs.dpi);
    const h = Math.round((sheet.heightMm / 25.4) * prefs.dpi);
    const size = pngSize({ width: w, height: h }, 96);
    return svgToPng(sheet.svg, size.width, size.height);
  }
  const r = planSvgFor(project, prefs, scenarioId);
  const size = pngSize({ width: r.widthPx, height: r.heightPx }, prefs.dpi);
  return svgToPng(r.svg, size.width, size.height);
}

export async function exportPdf(project: Project, prefs: ExportPrefs, scenarioId: string): Promise<Blob> {
  const sheet = sheetFor(project, prefs, scenarioId, true);
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pdf = new jsPDF({ orientation: prefs.orientation, unit: 'mm', format: [sheet.widthMm, sheet.heightMm].sort((a, b) => a - b) as [number, number], compress: true });
  const scenario = project.scenarios.find((s) => s.id === scenarioId);
  pdf.setProperties({ title: `${project.name}: ${scenario?.name ?? ''}`, creator: 'Workshop Planner', subject: 'Floor plan' });
  const el = new DOMParser().parseFromString(sheet.svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  // svg2pdf measures text with the DOM, so the element must be attached while converting.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden';
  host.appendChild(el);
  document.body.appendChild(host);
  try {
    await svg2pdf(el, pdf, { x: 0, y: 0, width: sheet.widthMm, height: sheet.heightMm });
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}
