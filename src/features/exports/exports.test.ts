import { describe, expect, it } from 'vitest';
import { createDemoProject } from '@/features/projects/demo';
import { makeFormatters } from '@/hooks/useFormatters';
import { buildInventory, inventoryText } from '@/features/inventory/inventory';
import { buildPlanDrawing, niceScaleBar, textWidth } from './plan/drawing';
import { escapeXml, pdfSafeText, renderSvg } from './plan/svg';
import { PT_MM } from './sheet';
import { csvCell, csvRow, inventoryCsv } from './csv';
import { projectToDxf } from './dxf/planDxf';
import { DxfWriter, dxfText } from './dxf/writer';

const project = createDemoProject();
const fmt = makeFormatters(project.settings).length;

/** Parse DXF text into [code, value] pairs (validates the pair structure). */
function pairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split('\r\n');
  expect(lines.at(-1)).toBe('');
  lines.pop();
  expect(lines.length % 2).toBe(0);
  const out: Array<[number, string]> = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    expect(Number.isInteger(code)).toBe(true);
    out.push([code, lines[i + 1]!]);
  }
  return out;
}

describe('inventory', () => {
  it('groups the demo by category with counts and sizes', () => {
    const inv = buildInventory(project);
    const titles = inv.groups.map((g) => g.title);
    expect(titles).toEqual(['Storage', 'Tools', 'Work surfaces', 'Dust collection', 'Vehicles']);
    const storage = inv.groups.find((g) => g.id === 'storage')!;
    const cabinets = storage.lines.find((l) => /wall cabinet/i.test(l.name))!;
    expect(cabinets.count).toBe(2);
    expect(cabinets.instanceNames).toEqual(['Wall cabinet (north)', 'Wall cabinet (south)']);
    expect(inv.total).toBe(11); // 10 objects + sedan
    const text = inventoryText(project, inv, fmt, { [cabinets.key]: 'Empty before moving' });
    expect(text).toMatch(/^Demo: Two-car garage workshop: Inventory/);
    expect(text).toMatch(/STORAGE\n {2}2 × Wall cabinet \(/);
    expect(text).toContain('Empty before moving');
  });

  it('counts per layout (workshop mode has no car)', () => {
    const inv = buildInventory(project, project.scenarios[1]!.id);
    expect(inv.groups.some((g) => g.id === 'vehicle')).toBe(false);
    expect(inv.total).toBe(10);
  });
});

describe('CSV', () => {
  it('escapes per RFC 4180 and guards formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-5 trick')).toBe("'-5 trick");
    expect(csvCell(' padded')).toBe('" padded"');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(true)).toBe('Yes');
    expect(csvCell(undefined)).toBe('');
    expect(csvRow(['a', 1, false])).toBe('a,1,No');
  });

  it('exports the brief columns, one row per item, in project units', () => {
    const csv = inventoryCsv(project);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe('Object,Category,Width (in),Depth (in),Height (in),X (in),Y (in),Rotation (deg),Mobile,Notes');
    expect(lines).toHaveLength(12); // header + 10 objects + sedan
    const cab = lines.find((l) => l.startsWith('Rolling tool cabinet'))!;
    const cells = cab.split(',');
    expect(cells[1]).toBe('Storage');
    expect(Number(cells[5])).toBeCloseTo(12, 1); // x = 12"
    expect(Number(cells[6])).toBeCloseTo(170, 1);
    expect(cells[7]).toBe('270');
    const saw = lines.find((l) => /^Table saw/.test(l))!;
    expect(saw.endsWith(',No,Contractor-style saw on a mobile base.')).toBe(true);
  });

  it('switches to metric', () => {
    const metric = { ...project, settings: { ...project.settings, unitSystem: 'metric' as const, metricUnit: 'cm' as const } };
    expect(inventoryCsv(metric).split('\r\n')[0]).toContain('Width (cm)');
  });
});

describe('SVG plan', () => {
  it('is generated from geometry with walls, objects, labels, dimensions and annotations', () => {
    const d = buildPlanDrawing(project, fmt);
    const svg = renderSvg(d, { legend: true, standalone: true }).svg;
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // One wall quad per wall.
    expect(d.prims.filter((p) => p.layer === 'walls' && p.t === 'poly' && p.style.fill).length).toBe(project.room.walls.length);
    expect(svg).toContain('>Rolling tool cabinet (350 lb)<');
    expect(svg).toContain('>Sedan<');
    expect(svg).toContain('>N<'); // north arrow
    expect(svg).toContain('LEGEND');
    // Exterior wall dimensions use formatted lengths.
    expect(d.prims.some((p) => p.t === 'dim' && p.layer === 'dimensions' && /'/.test(p.text))).toBe(true);
    // Well-formed-ish: every opened tag is closed.
    expect((svg.match(/<text/g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
  });

  it('honours toggles and monochrome', () => {
    const d = buildPlanDrawing(project, fmt, { labels: false, vehicle: false, electrical: false, lighting: false, measurements: false, zones: false, annotations: false, clearances: true, monochrome: true });
    const layers = new Set(d.prims.map((p) => p.layer));
    expect(layers.has('vehicles')).toBe(false);
    expect(layers.has('electrical')).toBe(false);
    expect(layers.has('lighting')).toBe(false);
    expect(layers.has('labels')).toBe(false);
    expect(layers.has('dimensions')).toBe(false);
    expect(layers.has('clearances')).toBe(true);
    const fills = new Set(d.prims.filter((p) => p.layer === 'objects' && p.t === 'poly' && p.style.fill).map((p) => (p.t === 'poly' ? p.style.fill : '')));
    expect([...fills]).toEqual(['#ffffff']);
  });

  it('respects hidden project layers', () => {
    const hidden = { ...project, layers: { ...project.layers, vehicle: { visible: false, locked: false } } };
    expect(buildPlanDrawing(hidden, fmt).prims.some((p) => p.layer === 'vehicles')).toBe(false);
  });

  it('escapes text and offers PDF-safe glyphs', () => {
    expect(escapeXml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;');
    expect(pdfSafeText('⌀ 4″ – ok…')).toBe('Ø 4" - ok...');
  });

  it('places labels so no two texts overlap on the printed sheet', () => {
    // Print/PDF scale (1/4" = 1'-0"): text is large relative to the plan, so labels collide unless
    // they are laid out.
    const d = buildPlanDrawing(project, fmt, { clearances: true, unit: 48 * PT_MM, margin: 48 * PT_MM * 26 });
    const boxes = d.prims
      .filter((p): p is Extract<typeof p, { t: 'text' }> => p.t === 'text')
      .map((p) => {
        const w = textWidth(p.text, p.size) / 2;
        const h = (p.size * 1.15) / 2;
        const rot = Math.abs(((p.rotation ?? 0) % 180) - 90) < 45;
        const dx = p.anchor === 'start' ? (rot ? h : w) : p.anchor === 'end' ? -(rot ? h : w) : 0;
        return { text: p.text, x0: p.at.x + dx - (rot ? h : w), x1: p.at.x + dx + (rot ? h : w), y0: p.at.y - (rot ? w : h), y1: p.at.y + (rot ? w : h) };
      });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) hits.push(`${a.text} / ${b.text}`);
      }
    expect(hits).toEqual([]);
    // Labels that had to move get a leader line back to what they name.
    expect(d.prims.some((p) => p.t === 'poly' && p.layer === 'labels' && !p.closed && p.pts.length === 2 && p.style.width === 0.35)).toBe(true);
    // The important names survive the pass.
    for (const name of ['Sedan', 'Table saw']) expect(d.prims.some((p) => p.t === 'text' && p.text.includes(name))).toBe(true);
    // Screen-scale drawings are laid out too (no regression at the default unit).
    const screen = buildPlanDrawing(project, fmt, { clearances: true, grid: true });
    expect(screen.prims.filter((p) => p.t === 'text').length).toBeGreaterThan(20);
  });

  it('picks readable scale bars', () => {
    expect(niceScaleBar(7000, true).label).toBe('5 ft');
    expect(niceScaleBar(7000, false).label).toBe('1 m');
  });
});

describe('DXF', () => {
  it('writer emits a valid R12 structure', () => {
    const w = new DxfWriter('mm', [{ name: 'WALLS', color: 7 }]);
    w.polyline('WALLS', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], true);
    w.circle('WALLS', { x: 5, y: 5 }, 2);
    w.text('WALLS', { x: 10, y: 10 }, 5, 'Hi 4″ ⌀');
    const p = pairs(w.toString());
    expect(p[0]).toEqual([0, 'SECTION']);
    expect(p.at(-1)).toEqual([0, 'EOF']);
    const sections = p.filter(([c, v]) => c === 0 && v === 'SECTION').length;
    expect(p.filter(([c, v]) => c === 0 && v === 'ENDSEC').length).toBe(sections);
    expect(p.filter(([c, v]) => c === 0 && v === 'VERTEX').length).toBe(3);
    expect(p.some(([c, v]) => c === 1 && v === 'Hi 4" %%c')).toBe(true);
    const ins = p.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
    expect(p[ins + 1]).toEqual([70, '4']);
  });

  it('sanitizes text', () => {
    expect(dxfText('a\nb 90° é')).toBe('a b 90%%d ?');
  });

  it('exports the demo in inches with walls, objects and dimensions on separate layers, north up', () => {
    const dxf = projectToDxf(project, fmt);
    const p = pairs(dxf);
    const ins = p.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
    expect(p[ins + 1]).toEqual([70, '1']);
    const layerNames = p.filter(([c], i) => c === 2 && p[i - 1]?.[1] === 'LAYER').map(([, v]) => v);
    for (const l of ['WALLS', 'OBJECTS', 'DIMENSIONS', 'LABELS', 'VEHICLES']) expect(layerNames).toContain(l);
    // Entities by layer: POLYLINE followed by 8 <layer>.
    const polyLayers = p.flatMap(([c, v], i) => (c === 0 && v === 'POLYLINE' ? [p[i + 1]![1]] : []));
    expect(polyLayers.filter((l) => l === 'WALLS').length).toBe(project.room.walls.length + 1); // quads + interior outline
    expect(polyLayers.filter((l) => l === 'OBJECTS').length).toBeGreaterThanOrEqual(10);
    const dimLines = p.filter(([c, v], i) => c === 0 && v === 'LINE' && p[i + 1]?.[1] === 'DIMENSIONS').length;
    expect(dimLines).toBeGreaterThan(project.room.walls.length);
    // y is flipped: interior y ∈ [0, 282"] in the plan → ≤ 0 in DXF (plus the north wall thickness).
    const ys = p.filter(([c], i) => c === 20 && p.slice(Math.max(0, i - 12), i).some(([cc, vv]) => cc === 0 && vv === 'VERTEX')).map(([, v]) => Number(v));
    expect(Math.max(...ys)).toBeLessThanOrEqual(20);
    expect(Math.min(...ys)).toBeLessThan(-250);
  });
});

describe('printable sheet', () => {
  it('fits the demo on Letter at a standard scale with title block and legend', async () => {
    const { buildSheet, fitScale, IMPERIAL_SCALES } = await import('./sheet');
    const s = buildSheet(project, fmt, { paper: 'letter', orientation: 'portrait', scale: 'fit', plan: {}, legend: true, notes: 'Move the saw first.\nCall Bob.', date: '2026-09-18' });
    expect(s.widthMm).toBeCloseTo(215.9);
    expect(IMPERIAL_SCALES.some((x) => x.denom === s.scale.denom)).toBe(true);
    expect(s.clipped).toBe(false);
    expect(s.svg).toContain('Demo: Two-car garage workshop');
    expect(s.svg).toContain('2026-09-18');
    expect(s.svg).toMatch(/Scale 3\/16&quot; = 1&apos;-0&quot; \(1:64\)|Scale .*= 1&apos;-0&quot;/);
    expect(s.svg).toContain('Call Bob.');
    expect(s.svg).toContain('LEGEND');
    const fixed = buildSheet(project, fmt, { paper: 'letter', orientation: 'portrait', scale: 12, plan: {}, legend: false, notes: '' });
    expect(fixed.clipped).toBe(true);
    expect(fitScale(10000, 5000, 200, 200, IMPERIAL_SCALES).denom).toBe(64);
  });
});
