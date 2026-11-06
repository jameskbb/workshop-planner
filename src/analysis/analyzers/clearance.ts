/**
 * Working-clearance conflicts: an object's clearance zones (operator, infeed, outfeed, side,
 * maintenance, access…) checked against walls, other objects, floor architecture and vehicles.
 * Physical fit and practical usability are different: this is the "usability" check.
 */
import { bbox, bboxIntersects, zoneObstruction, zoneWallIntrusions, type Polygon } from '@/geometry';
import type { EntityRef } from '@/domain/schema';
import { registerAnalyzer } from '../registry';
import type { AnalyzedObject, AnalyzedZone } from '../context';
import type { WarningInput } from '../types';

/** Ignore intrusions smaller than this (mm): 1/2". */
export const MIN_CLEARANCE_INTRUSION = 12.7;
/** Standing head height used as the vertical extent of people-space zones (mm). */
const PERSON_HEIGHT = 1830;

/** Vertical band [bottom, top] (mm) in which a zone must be clear. */
function zoneBand(owner: AnalyzedObject, z: AnalyzedZone): [number, number] {
  const bottom = owner.resolved.elevation;
  const top = bottom + owner.resolved.height;
  // Wall/ceiling-mounted items only need their own height band clear (a cabinet door above a bench).
  if (owner.resolved.elevated) return [bottom - 50, top];
  // Stock passes at table height for feed zones; people need standing room elsewhere.
  return z.zone.kind === 'infeed' || z.zone.kind === 'outfeed' ? [0, top + 150] : [0, PERSON_HEIGHT];
}

function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

interface Obstacle {
  ref: EntityRef;
  name: string;
  polygon: Polygon;
  bottom: number;
  top: number;
}

registerAnalyzer({
  id: 'clearance',
  label: 'Tool working clearance',
  description: 'Working, feed and maintenance zones blocked by walls, objects, fixtures or vehicles.',
  category: 'clearance',
  order: 30,
  run(ctx) {
    const out: WarningInput[] = [];
    const obstacles: Obstacle[] = [
      ...ctx.objects.map((o) => ({
        ref: { kind: 'object', id: o.id } as EntityRef,
        name: o.name,
        polygon: o.footprint,
        bottom: o.resolved.elevation,
        top: o.resolved.elevation + o.resolved.height,
      })),
      ...ctx.features
        .filter((f) => f.blocksFloor)
        .map((f) => ({ ref: { kind: 'feature', id: f.id } as EntityRef, name: f.name, polygon: f.footprint, bottom: f.feature.elevation, top: f.feature.elevation + f.feature.height })),
      ...ctx.vehicles.map((v) => ({ ref: { kind: 'vehicle', id: v.id } as EntityRef, name: v.name, polygon: v.body, bottom: 0, top: v.vehicle.height })),
    ];
    const obstacleBoxes = obstacles.map((o) => bbox(o.polygon));

    for (const owner of ctx.objects) {
      const ownerRef: EntityRef = { kind: 'object', id: owner.id };
      for (const z of owner.zones) {
        const label = z.label;
        // Walls
        if (ctx.hasRoom) {
          for (const hit of zoneWallIntrusions(z.polygon, ctx.room.polygon, ctx.room.walls, MIN_CLEARANCE_INTRUSION)) {
            const wallId = ctx.project.room.walls[hit.wallIndex]?.id ?? String(hit.wallIndex);
            out.push({
              id: `clearance:${owner.id}:${z.zone.id}:wall:${wallId}`,
              category: 'clearance',
              severity: 'warning',
              title: `${owner.name}: ${label} clearance hits the ${hit.wallName}`,
              message: `${owner.name} ${label} clearance${owner.zonesAtWorkingPosition ? ' (at its working position)' : ''} intersects the ${hit.wallName} by ${ctx.fmtLength(hit.depth)}.`,
              involved: [ownerRef, { kind: 'wall', id: wallId }],
              highlight: { regions: hit.region, polygons: [z.polygon] },
              quantities: [
                { name: 'depth', value: hit.depth, kind: 'length' },
                { name: 'area', value: hit.area, kind: 'area' },
              ],
              data: { zone: z.zone.kind, zoneId: z.zone.id, against: { kind: 'wall', name: hit.wallName, id: wallId }, depth: hit.depth },
            });
          }
        }
        // Objects, fixtures, vehicles
        const zb = bbox(z.polygon);
        const [bandBottom, bandTop] = zoneBand(owner, z);
        obstacles.forEach((obs, k) => {
          if (obs.ref.kind === 'object' && obs.ref.id === owner.id) return;
          if (!bboxIntersects(zb, obstacleBoxes[k]!)) return;
          if (!(obs.bottom < bandTop && obs.top > bandBottom)) return;
          const r = zoneObstruction(z.zone.shape, owner.resolved.footprint, owner.zonePose, obs.polygon);
          if (!r || r.depth < MIN_CLEARANCE_INTRUSION) return;
          const isSide = z.zone.shape.type === 'side';
          const required = z.zone.shape.type === 'side' ? z.zone.shape.depth : z.zone.shape.type === 'around' ? z.zone.shape.margin : r.depth;
          const where = owner.zonesAtWorkingPosition ? ' at its working position' : '';
          const message = isSide
            ? `${obs.name} blocks ${ctx.fmtLength(r.depth)} of the ${possessive(owner.name)} ${label} clearance${where} (${ctx.fmtLength(r.clear)} of ${ctx.fmtLength(required)} clear).`
            : z.zone.shape.type === 'around'
              ? `${obs.name} is ${ctx.fmtLength(r.clear)} from the ${owner.name}${where}; its ${label} clearance asks for ${ctx.fmtLength(required)} (${ctx.fmtLength(r.depth)} short).`
              : `${obs.name} intrudes ${ctx.fmtLength(r.depth)} into the ${possessive(owner.name)} ${label} clearance${where}.`;
          out.push({
            id: `clearance:${owner.id}:${z.zone.id}:${obs.ref.kind}:${obs.ref.id}`,
            category: 'clearance',
            severity: 'warning',
            title: `${obs.name} blocks ${possessive(owner.name)} ${label} clearance`,
            message,
            involved: [ownerRef, obs.ref],
            highlight: { regions: r.region, polygons: [z.polygon] },
            quantities: [
              { name: 'depth', value: r.depth, kind: 'length' },
              { name: 'clear', value: r.clear, kind: 'length' },
              { name: 'required', value: required, kind: 'length' },
              { name: 'area', value: r.area, kind: 'area' },
            ],
            data: { zone: z.zone.kind, zoneId: z.zone.id, against: { kind: obs.ref.kind, name: obs.name, id: obs.ref.id }, depth: r.depth },
          });
        });
      }
    }
    return out;
  },
});
