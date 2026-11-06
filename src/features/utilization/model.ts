/**
 * Space and wall utilization (pure). Clearance overlays are never counted as physical footprint:
 * only object bodies, vehicles and permanent obstructions occupy floor.
 */
import type { AnalysisContext } from '@/analysis';
import { featureFootprint } from '@/domain/resolve';
import {
  areaOfMulti,
  intersect,
  projectOntoWall,
  spaceUtilization,
  union,
  verticalWallUtilization,
  wallUtilization,
  type ElevationRect,
  type SpaceUtilization,
  type VerticalWallUtilization,
  type WallUtilization,
} from '@/geometry';
import { wallOpenings } from '@/features/scenarios/facts';

export interface ZoneShare {
  id: string;
  name: string;
  kind: string;
  area: number;
  pct: number;
}

export interface SpaceReport extends SpaceUtilization {
  zones: ZoneShare[];
  /** Floor items counted in the footprint (for the explanation). */
  counted: { objects: number; vehicles: number; obstructions: number };
}

/** Objects standing on (or hanging low over) the floor count as footprint; wall/ceiling items do not. */
export const FLOOR_FOOTPRINT_BELOW = 300;

export function spaceReport(ctx: AnalysisContext): SpaceReport {
  return ctx.memo('util:space', () => {
    const obstructions = ctx.features.filter((f) => f.blocksFloor).map((f) => f.footprint);
    const floorObjects = ctx.objects.filter((o) => o.resolved.elevation < FLOOR_FOOTPRINT_BELOW && o.resolved.object.mount === 'floor');
    const zonePolys = ctx.scenario.zones.filter((z) => !z.hidden).map((z) => z.points);
    const u = spaceUtilization({
      room: ctx.room.polygon,
      obstructions,
      footprints: [...floorObjects.map((o) => o.footprint), ...ctx.vehicles.map((v) => v.body)],
      zones: zonePolys,
    });
    const zones = ctx.scenario.zones
      .filter((z) => !z.hidden)
      .map((z) => {
        const a = u.roomArea > 0 ? areaOfMulti(intersect(union(z.points), ctx.room.polygon)) : 0;
        return { id: z.id, name: z.name, kind: z.kind, area: a, pct: u.roomArea > 0 ? (a / u.roomArea) * 100 : 0 };
      });
    return { ...u, zones, counted: { objects: floorObjects.length, vehicles: ctx.vehicles.length, obstructions: obstructions.length } };
  });
}

export interface WallReport {
  linear: WallUtilization;
  vertical: VerticalWallUtilization;
  height: number;
  /** Items counted on this wall (names). */
  items: string[];
}

/** Items within this distance of a wall count as "on" the wall (mm). */
export const WALL_BAND = 610;

export function wallReports(ctx: AnalysisContext): WallReport[] {
  return ctx.memo('util:walls', () => {
    const walls = ctx.room.walls;
    const openings = wallOpenings(ctx);
    const floorPolys = [
      ...ctx.objects.filter((o) => !o.resolved.elevated).map((o) => o.footprint),
      ...ctx.features.filter((f) => f.blocksFloor).map((f) => featureFootprint(ctx.project.room, f.feature)),
    ];
    const linear = wallUtilization(walls, ctx.room.polygon, floorPolys, openings, WALL_BAND);
    return walls.map((w, i) => {
      const height = ctx.room.heights[i] ?? ctx.project.room.ceilingHeight;
      const storage: ElevationRect[] = [];
      const items: string[] = [];
      for (const o of ctx.objects) {
        const proj = o.footprint.map((p) => projectOntoWall(p, w));
        const inset = Math.min(...proj.map((p) => p.inset));
        if (inset > WALL_BAND || inset < -50) continue;
        const start = Math.max(0, Math.min(...proj.map((p) => p.offset)));
        const end = Math.min(w.length, Math.max(...proj.map((p) => p.offset)));
        if (end - start < 1) continue;
        storage.push({ start, end, bottom: o.resolved.elevation, top: o.resolved.elevation + o.resolved.height });
        items.push(o.name);
      }
      const openingRects: ElevationRect[] = [];
      for (const f of ctx.project.architecture) {
        if (f.hidden || f.placement.type !== 'wall' || f.placement.wallId !== ctx.project.room.walls[i]?.id) continue;
        if (!['door', 'double-door', 'garage-door', 'window'].includes(f.kind)) continue;
        const h = f.kind === 'garage-door' ? (f.garageDoor?.openingHeight ?? f.height) : f.height;
        openingRects.push({ start: f.placement.offset - f.width / 2, end: f.placement.offset + f.width / 2, bottom: f.elevation, top: f.elevation + h });
      }
      return { linear: linear[i]!, vertical: verticalWallUtilization(w.length, height, storage, openingRects), height, items };
    });
  });
}
