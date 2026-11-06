/**
 * Room shape templates (pure). Each template turns a few typed dimensions into an interior outline
 * (NW interior corner at 0,0; +x east, +y south) plus suggested garage-door openings. The result is
 * an ordinary polygon: every wall stays fully editable afterwards.
 */
import type { PointData } from './schema/common';
import { feetInches } from './units';

export type RoomTemplateId = 'rectangle' | 'l-shape' | 't-shape' | 'two-car' | 'three-car';

export interface TemplateParam {
  key: string;
  label: string;
  /** Default in mm for imperial projects. */
  imperial: number;
  /** Default in mm for metric projects. */
  metric: number;
  hint?: string;
}

/** A suggested opening: wall index in the generated outline, center offset from the wall's start, width. */
export interface TemplateOpening {
  wallIndex: number;
  offset: number;
  width: number;
  kind: 'garage-door' | 'door';
}

export interface RoomTemplate {
  id: RoomTemplateId;
  name: string;
  description: string;
  params: readonly TemplateParam[];
  build(p: Record<string, number>): { points: PointData[]; openings: TemplateOpening[] };
  /** Returns a problem with the parameters, or null. */
  validate?(p: Record<string, number>): string | null;
}

const ft = (f: number, i = 0) => feetInches(f, i);

const rect = (w: number, d: number): PointData[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];

export const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  {
    id: 'rectangle',
    name: 'Rectangle',
    description: 'Four square walls. The most common garage outline.',
    params: [
      { key: 'width', label: 'Width (east–west)', imperial: ft(20), metric: 6000 },
      { key: 'depth', label: 'Depth (north–south)', imperial: ft(22), metric: 6600 },
    ],
    build: (p) => ({ points: rect(p.width!, p.depth!), openings: [] }),
  },
  {
    id: 'l-shape',
    name: 'L-shaped',
    description: 'A rectangle with one corner (northeast) cut out, e.g. a jog around a laundry room.',
    params: [
      { key: 'width', label: 'Overall width', imperial: ft(22), metric: 6600 },
      { key: 'depth', label: 'Overall depth', imperial: ft(24), metric: 7200 },
      { key: 'notchWidth', label: 'Jog width', imperial: ft(8), metric: 2400, hint: 'How far the cut-out runs along the north wall' },
      { key: 'notchDepth', label: 'Jog depth', imperial: ft(6), metric: 1800, hint: 'How far the cut-out reaches into the room' },
    ],
    validate: (p) =>
      p.notchWidth! >= p.width! || p.notchDepth! >= p.depth! ? 'The jog must be smaller than the overall width and depth.' : null,
    build: (p) => {
      const { width: w, depth: d, notchWidth: nw, notchDepth: nd } = p as Record<'width' | 'depth' | 'notchWidth' | 'notchDepth', number>;
      return {
        points: [
          { x: 0, y: 0 },
          { x: w - nw, y: 0 },
          { x: w - nw, y: nd },
          { x: w, y: nd },
          { x: w, y: d },
          { x: 0, y: d },
        ],
        openings: [],
      };
    },
  },
  {
    id: 't-shape',
    name: 'T-shaped',
    description: 'A wide bay across the back with a narrower bay toward the door.',
    params: [
      { key: 'width', label: 'Back bay width', imperial: ft(28), metric: 8400 },
      { key: 'barDepth', label: 'Back bay depth', imperial: ft(10), metric: 3000 },
      { key: 'stemWidth', label: 'Front bay width', imperial: ft(16), metric: 4800 },
      { key: 'stemDepth', label: 'Front bay depth', imperial: ft(12), metric: 3600 },
    ],
    validate: (p) => (p.stemWidth! >= p.width! ? 'The front bay must be narrower than the back bay.' : null),
    build: (p) => {
      const { width: w, barDepth: bd, stemWidth: sw, stemDepth: sd } = p as Record<'width' | 'barDepth' | 'stemWidth' | 'stemDepth', number>;
      const l = (w - sw) / 2;
      const r = (w + sw) / 2;
      return {
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: bd },
          { x: r, y: bd },
          { x: r, y: bd + sd },
          { x: l, y: bd + sd },
          { x: l, y: bd },
          { x: 0, y: bd },
        ],
        // South wall of the stem (index 4 runs r → l).
        openings: [{ wallIndex: 4, offset: sw / 2, width: Math.min(ft(16), sw - ft(1)), kind: 'garage-door' }],
      };
    },
  },
  {
    id: 'two-car',
    name: 'Two-car garage',
    description: 'Typical 22′ × 22′ two-car garage with a 16′ door on the south wall.',
    params: [
      { key: 'width', label: 'Width', imperial: ft(22), metric: 6700 },
      { key: 'depth', label: 'Depth', imperial: ft(22), metric: 6700 },
      { key: 'doorWidth', label: 'Garage door width', imperial: ft(16), metric: 4900 },
    ],
    validate: (p) => (p.doorWidth! > p.width! - ft(1) ? 'The garage door must fit in the south wall with at least 6″ on each side.' : null),
    build: (p) => ({
      points: rect(p.width!, p.depth!),
      // Wall 2 = south wall, running east → west from (w, d).
      openings: [{ wallIndex: 2, offset: p.width! / 2, width: p.doorWidth!, kind: 'garage-door' }],
    }),
  },
  {
    id: 'three-car',
    name: 'Three-car garage',
    description: 'Typical 32′ × 22′ three-car garage with a 16′ double and a 9′ single door.',
    params: [
      { key: 'width', label: 'Width', imperial: ft(32), metric: 9800 },
      { key: 'depth', label: 'Depth', imperial: ft(22), metric: 6700 },
    ],
    validate: (p) => (p.width! < ft(28) ? 'A three-car layout needs at least 28′ of width for both doors.' : null),
    build: (p) => {
      const w = p.width!;
      // South wall runs east → west. Double door on the west part, single door on the east part.
      const single = ft(9);
      const dbl = ft(16);
      const pier = (w - single - dbl) / 3;
      return {
        points: rect(w, p.depth!),
        openings: [
          { wallIndex: 2, offset: pier + single / 2, width: single, kind: 'garage-door' },
          { wallIndex: 2, offset: pier * 2 + single + dbl / 2, width: dbl, kind: 'garage-door' },
        ],
      };
    },
  },
];

export function roomTemplate(id: RoomTemplateId): RoomTemplate {
  const t = ROOM_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown room template "${id}"`);
  return t;
}

export function templateDefaults(t: RoomTemplate, system: 'imperial' | 'metric'): Record<string, number> {
  return Object.fromEntries(t.params.map((p) => [p.key, system === 'metric' ? p.metric : p.imperial]));
}

/**
 * Outline from a list of walls given as length + turn (Method 2: "Wall A: 21' 6", Wall B: 24' …").
 * Starts at (0,0) heading `startDirection` (degrees, 0 = east). `turn` is degrees clockwise on
 * screen (a right turn when walking clockwise around the room). When `close` is true, the last
 * wall is computed to return to the start and must not be given.
 */
export function outlineFromWalls(
  walls: ReadonlyArray<{ length: number; turn: number }>,
  opts: { startDirection?: number; close?: boolean } = {},
): { points: PointData[]; closingLength?: number; closingGap: number } {
  let dir = opts.startDirection ?? 0;
  let cur = { x: 0, y: 0 };
  const points: PointData[] = [{ ...cur }];
  walls.forEach((w, i) => {
    if (i > 0) dir += w.turn;
    const r = (dir * Math.PI) / 180;
    const c = Math.abs(Math.cos(r)) < 1e-12 ? 0 : Math.cos(r);
    const s = Math.abs(Math.sin(r)) < 1e-12 ? 0 : Math.sin(r);
    cur = { x: cur.x + c * w.length, y: cur.y + s * w.length };
    points.push({ ...cur });
  });
  const last = points[points.length - 1]!;
  const gap = Math.hypot(last.x, last.y);
  if (gap < 0.5) {
    points.pop();
    return { points, closingGap: gap };
  }
  if (opts.close) return { points, closingLength: gap, closingGap: gap };
  return { points, closingGap: gap };
}
