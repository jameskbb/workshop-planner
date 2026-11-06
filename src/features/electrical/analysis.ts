/**
 * Outlet-distance check (pure, auto-registered): items with an electrical requirement that are
 * unusually far from an outlet of the right voltage/amperage, or have none at all. Quiet until at
 * least one outlet is modeled. Planning assistance only.
 */
import { registerAnalyzer } from '@/analysis/registry';
import type { WarningInput } from '@/analysis/types';
import { electricalPrefs, hasOutlets, outletReach, requirementLabel } from './reach';

registerAnalyzer({
  id: 'outlet-distance',
  label: 'Outlet distance',
  description: 'Tools far from an outlet that matches their voltage and amperage (planning aid, not a code check).',
  category: 'electrical',
  order: 65,
  run(ctx) {
    if (!hasOutlets(ctx)) return [];
    const max = electricalPrefs.read(ctx.project).maxDistance;
    const out: WarningInput[] = [];
    for (const r of outletReach(ctx)) {
      const ref = { kind: 'object' as const, id: r.objectId };
      const req = requirementLabel(r.requirement);
      const where = ctx.objectById.get(r.objectId)?.zonesAtWorkingPosition ? ' at its working position' : '';
      if (!r.anyVoltage) {
        out.push({
          id: `outlet-distance:${r.objectId}:none`,
          category: 'electrical',
          severity: 'warning',
          title: `No ${r.requirement.voltage} V outlet for the ${r.name}`,
          message: `There is no ${r.requirement.voltage} V outlet in the garage for the ${r.name} (${req}).`,
          involved: [ref],
          highlight: { polygons: [r.footprint] },
          data: { reason: 'no-voltage', voltage: r.requirement.voltage },
        });
        continue;
      }
      if (!r.best && r.underRated) {
        const u = r.underRated;
        out.push({
          id: `outlet-distance:${r.objectId}:amps`,
          category: 'electrical',
          severity: 'warning',
          title: `${r.name} needs a ${r.requirement.amperage} A outlet`,
          message: `The ${r.requirement.voltage} V outlets are rated below the ${r.name}'s ${r.requirement.amperage} A (nearest: ${u.point.label || 'outlet'}, ${u.point.amperage} A, ${ctx.fmtLength(u.distance)} away).`,
          involved: [ref, { kind: 'electrical', id: u.point.id }],
          highlight: { polygons: [r.footprint], lines: [[u.from, u.position]] },
          quantities: [{ name: 'distance', value: u.distance, kind: 'length' }],
          data: { reason: 'amperage', outlet: u.point.id },
        });
        continue;
      }
      const b = r.best!;
      if (b.distance <= max) continue;
      out.push({
        id: `outlet-distance:${r.objectId}:far`,
        category: 'electrical',
        severity: 'warning',
        title: `${r.name} is far from an outlet`,
        message: `The ${r.name} (${req}) is ${ctx.fmtLength(b.distance)} from the nearest ${r.requirement.voltage} V outlet (${b.point.label || 'outlet'})${where}, more than the ${ctx.fmtLength(max)} you set.`,
        involved: [ref, { kind: 'electrical', id: b.point.id }],
        highlight: { polygons: [r.footprint], lines: [[b.from, b.position]], points: [b.position] },
        quantities: [
          { name: 'distance', value: b.distance, kind: 'length' },
          { name: 'limit', value: max, kind: 'length' },
        ],
        data: { reason: 'distance', outlet: b.point.id, distance: b.distance },
      });
    }
    return out;
  },
});
