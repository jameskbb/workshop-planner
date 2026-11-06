/**
 * Things that physically occupy space, with their vertical extent: the obstacle set most safety
 * checks test against (objects, floor-standing fixed features, vehicles). Pure; memoized per
 * analysis context.
 */
import type { AnalysisContext } from '@/analysis/context';
import type { EntityRef } from '@/domain/schema';
import { bbox, type BBox, type Polygon } from '@/geometry';

export interface Solid {
  ref: EntityRef;
  name: string;
  polygon: Polygon;
  box: BBox;
  bottom: number;
  top: number;
  /** Floor object / feature / vehicle vs wall- or ceiling-mounted item. */
  mount: 'floor' | 'wall' | 'ceiling';
}

export function solids(ctx: AnalysisContext): Solid[] {
  return ctx.memo('safety:solids', () => {
    const out: Solid[] = [];
    for (const o of ctx.objects) {
      out.push({
        ref: { kind: 'object', id: o.id },
        name: o.name,
        polygon: o.footprint,
        box: o.bbox,
        bottom: o.resolved.elevation,
        top: o.resolved.elevation + o.resolved.height,
        mount: o.resolved.object.mount,
      });
    }
    for (const f of ctx.features) {
      if (!f.blocksFloor) continue;
      out.push({ ref: { kind: 'feature', id: f.id }, name: f.name, polygon: f.footprint, box: bbox(f.footprint), bottom: f.feature.elevation, top: f.feature.elevation + f.feature.height, mount: 'floor' });
    }
    for (const v of ctx.vehicles) {
      out.push({ ref: { kind: 'vehicle', id: v.id }, name: v.name, polygon: v.body, box: bbox(v.parts.flat()), bottom: 0, top: v.vehicle.height, mount: 'floor' });
    }
    return out;
  });
}

/** True when [bottom, top] overlaps [lo, hi] by more than 1 mm. */
export const overlapsBand = (s: { bottom: number; top: number }, lo: number, hi: number): boolean => s.bottom < hi - 1 && s.top > lo + 1;

/** "the Water heater" for fixed features, plain names for the user's own items. */
export const the = (s: { ref: EntityRef; name: string }): string => (s.ref.kind === 'feature' ? `the ${s.name}` : s.name);

export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
