/**
 * Physical overlap: objects, floor-standing architecture and vehicles whose footprints overlap
 * in plan AND in height (a wall cabinet above a bench is not a collision).
 */
import { bboxIntersects, bbox, intersect, polygonCollision, type Polygon } from '@/geometry';
import type { EntityRef } from '@/domain/schema';
import { registerAnalyzer } from '../registry';
import type { WarningInput } from '../types';

const MIN_DEPTH = 1; // mm; ignore touching / float noise

interface Solid {
  ref: EntityRef;
  name: string;
  /** Convex parts (vehicles have body + mirrors). */
  parts: Polygon[];
  bottom: number;
  top: number;
  locked: boolean;
}

function article(name: string): string {
  return name;
}

registerAnalyzer({
  id: 'overlap',
  label: 'Physical overlap',
  description: 'Objects, vehicles and fixed features that occupy the same space.',
  category: 'collision',
  order: 10,
  run(ctx) {
    const solids: Solid[] = [];
    for (const o of ctx.objects) {
      solids.push({
        ref: { kind: 'object', id: o.id },
        name: o.name,
        parts: [o.footprint],
        bottom: o.resolved.elevation,
        top: o.resolved.elevation + o.resolved.height,
        locked: o.resolved.object.locked,
      });
    }
    for (const f of ctx.features) {
      if (!f.blocksFloor) continue;
      solids.push({
        ref: { kind: 'feature', id: f.id },
        name: f.name,
        parts: [f.footprint],
        bottom: f.feature.elevation,
        top: f.feature.elevation + f.feature.height,
        locked: true,
      });
    }
    for (const v of ctx.vehicles) {
      solids.push({ ref: { kind: 'vehicle', id: v.id }, name: v.name, parts: v.parts, bottom: 0, top: v.vehicle.height, locked: false });
    }
    const boxes = solids.map((s) => bbox(s.parts.flat()));
    const out: WarningInput[] = [];
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]!;
        const b = solids[j]!;
        if (a.ref.kind === 'feature' && b.ref.kind === 'feature') continue; // fixed architecture is the user's reality
        if (!bboxIntersects(boxes[i]!, boxes[j]!)) continue;
        if (!(a.bottom < b.top - 1 && b.bottom < a.top - 1)) continue;
        let depth = 0;
        let area = 0;
        for (const pa of a.parts) {
          for (const pb of b.parts) {
            const c = polygonCollision(pa, pb, 0.5);
            if (c.colliding) {
              depth = Math.max(depth, c.depth);
              area += c.overlapArea;
            }
          }
        }
        if (depth < MIN_DEPTH) continue;
        // Report the movable thing first ("Workbench overlaps the Support pole").
        const [first, second] = a.locked && !b.locked ? [b, a] : [a, b];
        const ids = [a.ref.id, b.ref.id].sort();
        const region = a.parts.flatMap((pa) => b.parts.flatMap((pb) => intersect(pa, pb)));
        out.push({
          id: `overlap:${ids.join('+')}`,
          category: 'collision',
          severity: 'critical',
          title: `${first.name} overlaps ${second.name}`,
          message: `${article(first.name)} overlaps ${second.ref.kind === 'feature' ? 'the ' : ''}${second.name} by ${ctx.fmtLength(depth)}. They cannot both occupy this space.`,
          involved: [first.ref, second.ref],
          highlight: { regions: region },
          quantities: [
            { name: 'depth', value: depth, kind: 'length' },
            { name: 'area', value: area, kind: 'area' },
          ],
          data: { a: first.ref, b: second.ref },
        });
      }
    }
    return out;
  },
});
