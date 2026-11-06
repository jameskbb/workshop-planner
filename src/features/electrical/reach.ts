/**
 * Outlet reach (pure): for every item with an electrical requirement, the nearest outlet that
 * matches its voltage (and amperage), measured from where the item is USED (mobile tools at their
 * working position) to the outlet. Planning assistance only, never a code-compliance check.
 */
import { z } from 'zod';
import type { AnalysisContext } from '@/analysis/context';
import { defineExtension } from '@/domain/extensions';
import { electricalPosition, objectFootprint } from '@/domain/resolve';
import type { ElectricalPoint, ElectricalRequirement } from '@/domain/schema';
import { feet } from '@/domain/units';
import { closestPointsSegmentPolygon, type Point, type Polygon } from '@/geometry';

export const electricalPrefs = defineExtension(
  'electrical.prefs',
  z.object({
    /** Warn when an item is farther than this from a suitable outlet (mm). */
    maxDistance: z.number().positive(),
  }),
  { maxDistance: feet(8) },
);

export interface OutletOption {
  point: ElectricalPoint;
  position: Point;
  /** Cord distance estimate (mm): horizontal gap to the footprint, plus the drop from a ceiling outlet. */
  distance: number;
  /** Closest footprint point (for drawing the reach line). */
  from: Point;
}

export interface ReachResult {
  objectId: string;
  name: string;
  requirement: ElectricalRequirement;
  footprint: Polygon;
  /** Nearest outlet with the right voltage and enough amperage. */
  best?: OutletOption;
  /** Nearest outlet with the right voltage but too little amperage (when it is closer than `best`). */
  underRated?: OutletOption;
  /** Outlets of the right voltage exist at all. */
  anyVoltage: boolean;
}

export const NOT_CODE_NOTE = 'Planning assistance only, not an electrical code check. Have an electrician confirm circuits and outlets.';

/** Voltage an electrical point supplies (panels supply nothing directly). */
export function suppliedVoltage(e: ElectricalPoint): 120 | 240 | null {
  if (e.kind === 'panel') return null;
  if (e.kind === 'outlet-240') return 240;
  if (e.kind === 'outlet-120' || e.kind === 'ceiling-outlet' || e.kind === 'extension-point') return e.voltage === 240 && e.kind !== 'outlet-120' ? 240 : 120;
  return e.voltage;
}

export function requirementOf(ctx: AnalysisContext, objectId: string): ElectricalRequirement | undefined {
  const o = ctx.objectById.get(objectId);
  return o ? (o.resolved.object.electrical ?? o.resolved.definition?.electrical) : undefined;
}

/** True when the project has any outlet at all (with none modeled, reach checks stay quiet). */
export const hasOutlets = (ctx: AnalysisContext): boolean => ctx.project.electrical.some((e) => e.kind !== 'panel' && (!e.hidden || ctx.options.includeHidden));

export function outletReach(ctx: AnalysisContext): ReachResult[] {
  return ctx.memo('electrical:reach', () => {
    const outlets = ctx.project.electrical
      .filter((e) => e.kind !== 'panel' && (!e.hidden || ctx.options.includeHidden))
      .map((e) => ({ e, p: electricalPosition(ctx.project.room, e), v: suppliedVoltage(e) }));
    const out: ReachResult[] = [];
    for (const o of ctx.objects) {
      const req = o.resolved.object.electrical ?? o.resolved.definition?.electrical;
      if (!req) continue;
      // Where it is used: mobile tools at their working pose.
      const footprint = o.zonesAtWorkingPosition ? objectFootprint(o.resolved, o.zonePose) : o.footprint;
      const top = o.resolved.elevation + o.resolved.height;
      let best: OutletOption | undefined;
      let underRated: OutletOption | undefined;
      let anyVoltage = false;
      for (const { e, p, v } of outlets) {
        if (v !== req.voltage) continue;
        anyVoltage = true;
        const c = closestPointsSegmentPolygon(p, p, footprint);
        const drop = e.kind === 'ceiling-outlet' ? Math.max(0, e.elevation - top) : 0;
        const opt: OutletOption = { point: e, position: p, distance: c.distance + drop, from: c.onB };
        if (e.amperage >= req.amperage) {
          if (!best || opt.distance < best.distance) best = opt;
        } else if (!underRated || opt.distance < underRated.distance) underRated = opt;
      }
      if (underRated && best && underRated.distance >= best.distance) underRated = undefined;
      out.push({ objectId: o.id, name: o.name, requirement: req, footprint, best, underRated, anyVoltage });
    }
    return out;
  });
}

export const requirementLabel = (r: ElectricalRequirement): string => `${r.voltage} V ${r.amperage} A${r.dedicated ? ', dedicated' : ''}`;
