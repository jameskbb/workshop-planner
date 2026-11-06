/**
 * Boolean polygon operations (thin, defensive wrapper around `polygon-clipping`).
 * Inputs are simple rings (`Polygon`) or regions with holes (`MultiPolygon`).
 */
import * as pcNamespace from 'polygon-clipping';
import type { Pair, Polygon as PcPolygon, MultiPolygon as PcMultiPolygon } from 'polygon-clipping';
import { area as ringArea, type Polygon } from './polygon';

// polygon-clipping's ESM build only has a default export while its typings declare named ones.
const pc = ((pcNamespace as unknown as { default?: typeof pcNamespace }).default ?? pcNamespace) as typeof pcNamespace;

export interface PolygonWithHoles {
  outer: Polygon;
  holes: Polygon[];
}

/** A region: zero or more disjoint polygons with holes. */
export type MultiPolygon = PolygonWithHoles[];

export type Region = Polygon | MultiPolygon;

function isMulti(r: Region): r is MultiPolygon {
  return r.length > 0 && 'outer' in (r[0] as object);
}

function ringToPc(ring: Polygon): Pair[] {
  return ring.map((p) => [p.x, p.y] as Pair);
}

function toPc(r: Region): PcMultiPolygon {
  if (r.length === 0) return [];
  if (isMulti(r)) return r.map((p) => [ringToPc(p.outer), ...p.holes.map(ringToPc)] as PcPolygon);
  return [[ringToPc(r as Polygon)]];
}

function fromPc(m: PcMultiPolygon): MultiPolygon {
  return m.map((poly) => {
    const [outer, ...holes] = poly.map((ring) => {
      const pts = ring.map(([x, y]) => ({ x, y }));
      // polygon-clipping returns closed rings; drop the duplicate closing vertex.
      if (pts.length > 1) {
        const f = pts[0]!;
        const l = pts[pts.length - 1]!;
        if (f.x === l.x && f.y === l.y) pts.pop();
      }
      return pts;
    });
    return { outer: outer ?? [], holes };
  });
}

function nonEmpty(r: Region): boolean {
  if (r.length === 0) return false;
  if (isMulti(r)) return r.some((p) => p.outer.length >= 3);
  return r.length >= 3;
}

function safe(op: () => PcMultiPolygon): MultiPolygon {
  try {
    return fromPc(op());
  } catch {
    // Degenerate input (e.g. zero-area slivers): treat as empty rather than crashing analysis.
    return [];
  }
}

export function intersect(a: Region, b: Region): MultiPolygon {
  if (!nonEmpty(a) || !nonEmpty(b)) return [];
  return safe(() => pc.intersection(toPc(a), toPc(b)));
}

export function union(...regions: Region[]): MultiPolygon {
  const valid = regions.filter(nonEmpty);
  if (valid.length === 0) return [];
  const [first, ...rest] = valid;
  return safe(() => pc.union(toPc(first!), ...rest.map(toPc)));
}

export function difference(subject: Region, ...clips: Region[]): MultiPolygon {
  if (!nonEmpty(subject)) return [];
  const valid = clips.filter(nonEmpty);
  if (valid.length === 0) return isMulti(subject) ? subject : [{ outer: subject as Polygon, holes: [] }];
  return safe(() => pc.difference(toPc(subject), ...valid.map(toPc)));
}

export function areaOfMulti(m: MultiPolygon): number {
  let s = 0;
  for (const p of m) {
    s += ringArea(p.outer);
    for (const h of p.holes) s -= ringArea(h);
  }
  return s;
}

export function areaOfRegion(r: Region): number {
  if (r.length === 0) return 0;
  return isMulti(r) ? areaOfMulti(r) : ringArea(r as Polygon);
}

/** Area of the intersection of two regions. */
export const intersectionArea = (a: Region, b: Region): number => areaOfMulti(intersect(a, b));

export const toMulti = (r: Region): MultiPolygon => (r.length === 0 ? [] : isMulti(r) ? r : [{ outer: r as Polygon, holes: [] }]);
