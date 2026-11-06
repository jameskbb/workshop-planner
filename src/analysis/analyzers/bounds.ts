/**
 * Out-of-room: object and vehicle footprints that extend past the room's walls, with the wall
 * named and the overrun quantified ("Workbench extends 3" past the North wall").
 */
import { areaOfMulti, difference, zoneWallIntrusions, area as polyArea, type Polygon } from '@/geometry';
import type { EntityRef } from '@/domain/schema';
import { registerAnalyzer } from '../registry';
import type { AnalysisContext } from '../context';
import type { WarningInput } from '../types';

function check(ctx: AnalysisContext, ref: EntityRef, name: string, footprint: Polygon, isVehicle: boolean): WarningInput | null {
  const outside = difference(footprint, ctx.room.polygon);
  const outsideArea = areaOfMulti(outside);
  if (outsideArea < 1) return null;
  const total = polyArea(footprint);
  if (outsideArea >= total - 1) {
    return {
      id: `bounds:${ref.id}:outside`,
      category: 'bounds',
      severity: isVehicle ? 'warning' : 'critical',
      title: `${name} is outside the room`,
      message: `${name} is completely outside the room outline.`,
      involved: [ref],
      highlight: { polygons: [footprint] },
      quantities: [{ name: 'area', value: outsideArea, kind: 'area' }],
    };
  }
  const intrusions = zoneWallIntrusions(footprint, ctx.room.polygon, ctx.room.walls, 1);
  const worst = intrusions[0];
  const depth = worst?.depth ?? 0;
  const wallName = worst?.wallName ?? 'room outline';
  const wallId = worst ? ctx.project.room.walls[worst.wallIndex]?.id : undefined;
  const tail = isVehicle ? ' The garage door or wall would hit it.' : ' Something this size will not fit here.';
  return {
    id: `bounds:${ref.id}:${wallId ?? 'room'}`,
    category: 'bounds',
    severity: isVehicle ? 'warning' : 'critical',
    title: `${name} extends past the ${wallName}`,
    message: `${name} extends ${ctx.fmtLength(depth)} past the ${wallName}.${tail}`,
    involved: wallId ? [ref, { kind: 'wall', id: wallId }] : [ref],
    highlight: { regions: outside },
    quantities: [
      { name: 'depth', value: depth, kind: 'length' },
      { name: 'area', value: outsideArea, kind: 'area' },
    ],
    data: { wallIndex: worst?.wallIndex, wallName },
  };
}

registerAnalyzer({
  id: 'bounds',
  label: 'Inside the room',
  description: 'Objects and vehicles that extend past a wall.',
  category: 'bounds',
  order: 20,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const out: WarningInput[] = [];
    for (const o of ctx.objects) {
      const w = check(ctx, { kind: 'object', id: o.id }, o.name, o.footprint, false);
      if (w) out.push(w);
    }
    for (const v of ctx.vehicles) {
      const w = check(ctx, { kind: 'vehicle', id: v.id }, v.name, v.body, true);
      if (w) out.push(w);
    }
    return out;
  },
});
