/**
 * Minimal ASCII DXF writer (AutoCAD R12 / AC1009 entity set: LINE, POLYLINE, CIRCLE, TEXT), the
 * most widely readable DXF flavor. Isolated on purpose: nothing outside `features/exports/dxf`
 * depends on it, and it knows nothing about projects (see `planDxf.ts` for the mapping).
 */

export type DxfUnits = 'in' | 'mm';

export interface DxfLayer {
  name: string;
  /** AutoCAD Color Index (1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white/black, 8 gray…). */
  color: number;
  linetype?: 'CONTINUOUS' | 'DASHED';
}

interface Pt {
  x: number;
  y: number;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : r.toString();
};

/** DXF text must be single-line ASCII-ish; control chars are stripped, specials encoded. */
export function dxfText(s: string): string {
  return s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/°/g, '%%d')
    .replace(/⌀|Ø/g, '%%c')
    .replace(/×/g, 'x')
    .replace(/[–\u2014]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7e]/g, '?');
}

export class DxfWriter {
  private entities: string[] = [];
  private min = { x: Infinity, y: Infinity };
  private max = { x: -Infinity, y: -Infinity };

  constructor(
    readonly units: DxfUnits,
    readonly layers: DxfLayer[],
  ) {}

  private pair(code: number, value: string | number) {
    this.entities.push(String(code), typeof value === 'number' ? fmt(value) : value);
  }

  private extend(p: Pt) {
    this.min = { x: Math.min(this.min.x, p.x), y: Math.min(this.min.y, p.y) };
    this.max = { x: Math.max(this.max.x, p.x), y: Math.max(this.max.y, p.y) };
  }

  line(layer: string, a: Pt, b: Pt) {
    this.pair(0, 'LINE');
    this.pair(8, layer);
    this.pair(10, a.x);
    this.pair(20, a.y);
    this.pair(30, 0);
    this.pair(11, b.x);
    this.pair(21, b.y);
    this.pair(31, 0);
    this.extend(a);
    this.extend(b);
  }

  polyline(layer: string, pts: Pt[], closed: boolean) {
    if (pts.length < 2) return;
    this.pair(0, 'POLYLINE');
    this.pair(8, layer);
    this.pair(66, 1);
    this.pair(10, 0);
    this.pair(20, 0);
    this.pair(30, 0);
    this.pair(70, closed ? 1 : 0);
    for (const p of pts) {
      this.pair(0, 'VERTEX');
      this.pair(8, layer);
      this.pair(10, p.x);
      this.pair(20, p.y);
      this.pair(30, 0);
      this.extend(p);
    }
    this.pair(0, 'SEQEND');
    this.pair(8, layer);
  }

  circle(layer: string, c: Pt, r: number) {
    this.pair(0, 'CIRCLE');
    this.pair(8, layer);
    this.pair(10, c.x);
    this.pair(20, c.y);
    this.pair(30, 0);
    this.pair(40, r);
    this.extend({ x: c.x - r, y: c.y - r });
    this.extend({ x: c.x + r, y: c.y + r });
  }

  /** Text centered on `at` (horizontal center, vertical middle), rotated `rotation`° counterclockwise. */
  text(layer: string, at: Pt, height: number, value: string, rotation = 0, align: 'left' | 'center' | 'right' = 'center') {
    const text = dxfText(value);
    if (!text.trim()) return;
    this.pair(0, 'TEXT');
    this.pair(8, layer);
    this.pair(10, at.x);
    this.pair(20, at.y);
    this.pair(30, 0);
    this.pair(40, height);
    this.pair(1, text);
    if (rotation) this.pair(50, rotation);
    const h = align === 'left' ? 0 : align === 'center' ? 1 : 2;
    if (h !== 0) {
      this.pair(72, h);
      this.pair(11, at.x);
      this.pair(21, at.y);
      this.pair(31, 0);
      this.pair(73, 2); // middle
    }
    this.extend(at);
  }

  toString(): string {
    const out: string[] = [];
    const p = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? fmt(value) : value);
    const min = Number.isFinite(this.min.x) ? this.min : { x: 0, y: 0 };
    const max = Number.isFinite(this.max.x) ? this.max : { x: 0, y: 0 };
    // HEADER
    p(0, 'SECTION');
    p(2, 'HEADER');
    p(9, '$ACADVER');
    p(1, 'AC1009');
    p(9, '$INSUNITS');
    p(70, this.units === 'in' ? 1 : 4);
    p(9, '$MEASUREMENT');
    p(70, this.units === 'in' ? 0 : 1);
    p(9, '$EXTMIN');
    p(10, min.x);
    p(20, min.y);
    p(30, 0);
    p(9, '$EXTMAX');
    p(10, max.x);
    p(20, max.y);
    p(30, 0);
    p(0, 'ENDSEC');
    // TABLES: linetypes + layers
    p(0, 'SECTION');
    p(2, 'TABLES');
    p(0, 'TABLE');
    p(2, 'LTYPE');
    p(70, 2);
    p(0, 'LTYPE');
    p(2, 'CONTINUOUS');
    p(70, 0);
    p(3, 'Solid line');
    p(72, 65);
    p(73, 0);
    p(40, 0);
    const dash = this.units === 'in' ? 0.5 : 12.7;
    p(0, 'LTYPE');
    p(2, 'DASHED');
    p(70, 0);
    p(3, '__ __ __ __');
    p(72, 65);
    p(73, 2);
    p(40, dash * 1.5);
    p(49, dash);
    p(49, -dash * 0.5);
    p(0, 'ENDTAB');
    p(0, 'TABLE');
    p(2, 'LAYER');
    p(70, this.layers.length + 1);
    for (const l of [{ name: '0', color: 7, linetype: 'CONTINUOUS' as const }, ...this.layers]) {
      p(0, 'LAYER');
      p(2, l.name);
      p(70, 0);
      p(62, l.color);
      p(6, l.linetype ?? 'CONTINUOUS');
    }
    p(0, 'ENDTAB');
    p(0, 'ENDSEC');
    // ENTITIES
    p(0, 'SECTION');
    p(2, 'ENTITIES');
    out.push(...this.entities);
    p(0, 'ENDSEC');
    p(0, 'EOF');
    return `${out.join('\r\n')}\r\n`;
  }
}
