/**
 * Vehicle analyzers (pure, auto-registered): door swings, per-side walking clearance against the
 * desired clearances, trunk/hatch/tailgate and hood access, open doors intruding into working
 * clearances (doors-open state), and the garage-entry simulation.
 */
import { registerAnalyzer } from '@/analysis/registry';
import type { WarningInput } from '@/analysis/types';
import type { EntityRef } from '@/domain/schema';
import { areaOfMulti, bbox, bboxIntersects, intersect } from '@/geometry';
import { entryFor, pathGhosts } from './entry';
import { EGRESS_GAP, SIDE_LABEL, vehicleReportFor } from './report';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const refOf = (r: { kind: string; id: string } | undefined): EntityRef[] => (r ? [r as EntityRef] : []);

registerAnalyzer({
  id: 'vehicle-doors',
  label: 'Vehicle doors',
  description: 'Car doors that cannot open fully or leave too little room to get out.',
  category: 'vehicle',
  order: 50,
  run(ctx) {
    const out: WarningInput[] = [];
    for (const av of ctx.vehicles) {
      const v = av.vehicle;
      const rep = vehicleReportFor(ctx, v);
      const vref: EntityRef = { kind: 'vehicle', id: v.id };
      for (const d of rep.doors) {
        if (d.fullyOpens) continue;
        const who = d.blocker ? d.blocker.name : 'something';
        const tight = d.egressGap < EGRESS_GAP;
        out.push({
          id: `vehicle-doors:${v.id}:${d.door.id}`,
          category: 'vehicle',
          severity: 'warning',
          title: `${v.name}: ${d.label} is blocked`,
          message: tight
            ? `The ${v.name}'s ${d.label} opens only ${d.maxAngle}° (${ctx.fmtLength(d.egressGap)} to get out) before hitting ${who}; about ${ctx.fmtLength(EGRESS_GAP)} is needed to get out comfortably.`
            : `The ${v.name}'s ${d.label} opens ${d.maxAngle}° of ${d.door.openAngle}° (${ctx.fmtLength(d.egressGap)} to get out) before it touches ${who}.`,
          involved: [vref, ...refOf(d.blocker?.ref)],
          highlight: { polygons: [d.sector, d.reachable] },
          quantities: [
            { name: 'angle', value: d.maxAngle, kind: 'angle' },
            { name: 'gap', value: d.egressGap, kind: 'length' },
          ],
          data: { door: d.door.id, blocker: d.blocker?.ref, maxAngle: d.maxAngle, egressGap: d.egressGap },
        });
      }
      // Doors-open state: the open doors take space other items' working zones need.
      if (v.state === 'doors-open') {
        for (const d of rep.doors) {
          const sb = bbox(d.reachable);
          for (const o of ctx.objects) {
            for (const z of o.zones) {
              if (!bboxIntersects(sb, bbox(z.polygon))) continue;
              const region = intersect(d.reachable, z.polygon);
              if (areaOfMulti(region) < 2500) continue;
              out.push({
                id: `vehicle-doors:${v.id}:${d.door.id}:open:${o.id}:${z.zone.id}`,
                category: 'vehicle',
                severity: 'warning',
                title: `Open ${d.label} is in the ${o.name}'s ${z.label} clearance`,
                message: `With its doors open, the ${v.name}'s ${d.label} swings into the ${o.name}'s ${z.label} clearance.`,
                involved: [vref, { kind: 'object', id: o.id }],
                highlight: { polygons: [d.reachable, z.polygon], regions: region },
                quantities: [{ name: 'area', value: areaOfMulti(region), kind: 'area' }],
                data: { door: d.door.id, object: o.id, zone: z.zone.id },
              });
            }
          }
        }
      }
    }
    return out;
  },
});

registerAnalyzer({
  id: 'vehicle-sides',
  label: 'Vehicle clearance',
  description: 'Walking room on each side of a vehicle compared with the desired clearances.',
  category: 'vehicle',
  order: 51,
  run(ctx) {
    const out: WarningInput[] = [];
    for (const av of ctx.vehicles) {
      const v = av.vehicle;
      const rep = vehicleReportFor(ctx, v);
      for (const s of rep.sides) {
        if (s.ok || s.desired <= 0) continue;
        const who = s.blocker ? `; ${s.blocker.name} is in the way` : '';
        out.push({
          id: `vehicle-sides:${v.id}:${s.side}`,
          category: 'vehicle',
          severity: 'warning',
          title: `${v.name}: ${SIDE_LABEL[s.side]} is tight`,
          message: `The ${v.name} has ${ctx.fmtLength(s.clear)} on the ${SIDE_LABEL[s.side]} (you want ${ctx.fmtLength(s.desired)})${who}.`,
          involved: [{ kind: 'vehicle', id: v.id }, ...refOf(s.blocker?.ref)],
          highlight: { polygons: [s.band], regions: s.region },
          quantities: [
            { name: 'clear', value: s.clear, kind: 'length' },
            { name: 'desired', value: s.desired, kind: 'length' },
            { name: 'short', value: s.desired - s.clear, kind: 'length' },
          ],
          data: { side: s.side, clear: s.clear, desired: s.desired, blocker: s.blocker?.ref },
        });
      }
    }
    return out;
  },
});

registerAnalyzer({
  id: 'vehicle-access',
  label: 'Trunk & hood access',
  description: 'Room to open the trunk, hatch or tailgate and to work under the hood.',
  category: 'vehicle',
  order: 52,
  run(ctx) {
    const out: WarningInput[] = [];
    for (const av of ctx.vehicles) {
      const v = av.vehicle;
      for (const a of vehicleReportFor(ctx, v).access) {
        if (a.ok) continue;
        const who = a.blocker ? a.blocker.name : 'something';
        out.push({
          id: `vehicle-access:${v.id}:${a.which}`,
          category: 'vehicle',
          severity: 'warning',
          title: `${v.name}: ${a.label} access is blocked`,
          message: `${cap(who)} leaves ${ctx.fmtLength(a.clear)} ${a.which === 'rear' ? 'behind' : 'in front of'} the ${v.name} (${ctx.fmtLength(a.depth)} wanted to use the ${a.label}).`,
          involved: [{ kind: 'vehicle', id: v.id }, ...refOf(a.blocker?.ref)],
          highlight: { polygons: [a.zone], regions: a.region },
          quantities: [
            { name: 'clear', value: a.clear, kind: 'length' },
            { name: 'desired', value: a.depth, kind: 'length' },
          ],
          data: { which: a.which, clear: a.clear, blocker: a.blocker?.ref },
        });
      }
    }
    return out;
  },
});

registerAnalyzer({
  id: 'vehicle-entry',
  label: 'Vehicle entry path',
  description: 'Whether each vehicle with an entry setup can drive from the driveway to its spot.',
  category: 'vehicle',
  order: 53,
  run(ctx) {
    const out: WarningInput[] = [];
    for (const av of ctx.vehicles) {
      const v = av.vehicle;
      if (!v.entry?.openingFeatureId) continue;
      const r = entryFor(ctx, v);
      if ('error' in r) continue;
      const hits = r.collisions.filter((c) => !c.envelopeOnly);
      const tight = r.collisions.filter((c) => c.envelopeOnly);
      if (!r.feasible) {
        out.push({
          id: `vehicle-entry:${v.id}`,
          category: 'vehicle',
          severity: 'warning',
          title: `${v.name} can't drive in`,
          message: r.summary,
          involved: [{ kind: 'vehicle', id: v.id }, ...hits.flatMap((h) => refOf(h.ref ?? undefined))],
          highlight: { polygons: pathGhosts(r.spec, r.plan) },
          quantities: hits.map((h) => ({ name: `depth:${h.name}`, value: h.depth, kind: 'length' as const })),
          data: { feasible: false, collisions: hits.map((h) => ({ ref: h.ref, depth: h.depth, atDistance: h.atDistance })) },
        });
      } else if (tight.length) {
        out.push({
          id: `vehicle-entry:${v.id}:tight`,
          category: 'vehicle',
          severity: 'info',
          title: `${v.name} squeezes past ${tight[0]!.name}`,
          message: r.summary,
          involved: [{ kind: 'vehicle', id: v.id }, ...tight.flatMap((h) => refOf(h.ref ?? undefined))],
          highlight: { polygons: pathGhosts(r.spec, r.plan) },
          data: { feasible: true, tight: tight.map((t) => t.ref) },
        });
      }
    }
    return out;
  },
});
