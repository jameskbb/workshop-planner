/**
 * Layout scorecard metrics (pure, auto-loaded by src/analysis). Each metric reports a measured
 * value with units and a one-sentence explanation of how it was computed. Core metrics (open floor
 * area, collisions, clearance conflicts) live in src/analysis/metrics/core.ts.
 */
import { listAnalyzers, registerMetric } from '@/analysis/registry';
import { runAnalyzers } from '@/analysis/run';
import { aisleWidthOf, narrowestPath, pathReports } from '@/features/walkability/model';
import { workflowTotal } from '@/features/workflow/model';
import { BENCH_STANDING_ROOM, outletReachLimit, USABLE_DOOR_ANGLE, outletDistances, vehicleFacts, VEHICLE_SIDES, wallStorage, workSurfaceAccess } from './facts';

const none = (explanation: string) => ({ value: null, display: 'n/a', explanation });

registerMetric({
  id: 'walkway-min-width',
  label: 'Narrowest main walkway',
  description: 'Narrowest point on the widest route from each door to each bench, tool and storage unit.',
  unit: 'length',
  better: 'higher',
  order: 30,
  compute(ctx) {
    if (!ctx.hasRoom) return none('Draw the room first.');
    const aisle = aisleWidthOf(ctx);
    const reports = pathReports(ctx, aisle);
    if (reports.length === 0) return none('Needs at least one door and one bench, tool or storage unit to measure a path.');
    const blocked = reports.filter((r) => r.blocked);
    const n = narrowestPath(ctx, aisle);
    if (!n) return { value: 0, display: 'Blocked', explanation: `No route at all from ${blocked[0]!.entry.label} to the ${blocked[0]!.destination.name}.` };
    const extra = blocked.length ? ` ${blocked.length} destination${blocked.length === 1 ? ' is' : 's are'} unreachable.` : '';
    return {
      value: n.width,
      display: ctx.fmtLength(n.width),
      explanation: `Path from ${n.entry.label} to the ${n.destination.name} narrows to ${ctx.fmtLength(n.width)} beside ${n.beside.name} (${reports.length} routes checked on a 2" grid, ±2").${extra}`,
    };
  },
});

registerMetric({
  id: 'vehicle-clearance',
  label: 'Vehicle clearance',
  description: 'Smallest clear gap around any parked vehicle (driver, passenger, front, rear) to walls and objects.',
  unit: 'length',
  better: 'higher',
  order: 40,
  compute(ctx) {
    if (ctx.vehicles.length === 0) return none('No vehicle in this layout.');
    let worst: { v: string; side: string; clear: number; desired: number; against: string } | null = null;
    let short = 0;
    for (const v of ctx.vehicles) {
      const f = vehicleFacts(ctx, v);
      for (const side of VEHICLE_SIDES) {
        const g = f.sides[side];
        if (g.clear < g.desired) short++;
        if (!worst || g.clear < worst.clear) worst = { v: v.name, side, clear: g.clear, desired: g.desired, against: g.against };
      }
    }
    if (!worst || !Number.isFinite(worst.clear)) return { value: null, display: 'Open', explanation: 'Nothing surrounds the vehicle.' };
    return {
      value: worst.clear,
      display: ctx.fmtLength(worst.clear),
      explanation: `${worst.v} ${worst.side} side has ${ctx.fmtLength(worst.clear)} to ${worst.against} (wanted ${ctx.fmtLength(worst.desired)}); ${short} side${short === 1 ? '' : 's'} short of the desired clearance.`,
    };
  },
});

registerMetric({
  id: 'parking-usability',
  label: 'Parking usability',
  description: 'Share of vehicle doors that open far enough to get out, and whether each vehicle sits clear of everything.',
  unit: 'percent',
  better: 'higher',
  order: 45,
  compute(ctx) {
    if (ctx.vehicles.length === 0) return none('No vehicle in this layout.');
    let doors = 0;
    let usable = 0;
    let full = 0;
    let colliding = 0;
    const overlap = runAnalyzers(ctx, ['overlap']);
    for (const v of ctx.vehicles) {
      const f = vehicleFacts(ctx, v);
      doors += f.doors.length;
      usable += f.doors.filter((d) => d.maxAngle >= USABLE_DOOR_ANGLE).length;
      full += f.doors.filter((d) => d.fullyOpens).length;
      if (overlap.some((w) => w.involved.some((r) => r.kind === 'vehicle' && r.id === v.id))) colliding++;
    }
    const pct = doors === 0 ? 100 : (usable / doors) * 100;
    const value = colliding ? pct / 2 : pct;
    return {
      value,
      display: `${Math.round(value)}%`,
      explanation: `${usable} of ${doors} doors open at least ${USABLE_DOOR_ANGLE}° (${full} fully)${colliding ? `; ${colliding} vehicle${colliding === 1 ? ' overlaps' : 's overlap'} something, which halves the score` : ''}.`,
    };
  },
});

registerMetric({
  id: 'workbench-access',
  label: 'Workbench accessibility',
  description: 'Clear standing room in front of the least accessible work surface (36" recommended).',
  unit: 'length',
  better: 'higher',
  order: 50,
  compute(ctx) {
    const list = workSurfaceAccess(ctx);
    if (list.length === 0) return none('No work surfaces in this layout.');
    const worst = list.reduce((a, b) => (b.clear < a.clear ? b : a));
    const ok = list.filter((s) => s.clear >= BENCH_STANDING_ROOM).length;
    if (!Number.isFinite(worst.clear)) return { value: null, display: 'Open', explanation: 'Nothing is in front of any work surface.' };
    return {
      value: worst.clear,
      display: ctx.fmtLength(worst.clear),
      explanation: `${worst.object.name} has ${ctx.fmtLength(worst.clear)} of clear floor in front before ${worst.against}; ${ok} of ${list.length} work surface${list.length === 1 ? '' : 's'} have ${ctx.fmtLength(BENCH_STANDING_ROOM)} or more.`,
    };
  },
});

registerMetric({
  id: 'workflow-travel',
  label: 'Workflow travel distance',
  description: 'Walking distance along every workflow relationship (routes around obstacles).',
  unit: 'length',
  better: 'lower',
  order: 60,
  compute(ctx) {
    const t = workflowTotal(ctx);
    if (t.steps === 0) return none('No workflow relationships defined (Workflow panel).');
    return {
      value: t.total,
      display: ctx.fmtLength(t.total),
      explanation: `${t.steps} workflow step${t.steps === 1 ? '' : 's'} walked around obstacles${t.blocked ? `; ${t.blocked} have no walkable route (straight line used)` : ''}.`,
    };
  },
});

registerMetric({
  id: 'wall-storage',
  label: 'Wall-storage utilization',
  description: 'Share of usable wall length (openings excluded) lined with storage: cabinets, shelving, racks.',
  unit: 'percent',
  better: 'higher',
  order: 70,
  compute(ctx) {
    if (!ctx.hasRoom) return none('Draw the room first.');
    const w = wallStorage(ctx);
    if (w.usable <= 0) return none('No usable wall length.');
    const pct = (w.storage / w.usable) * 100;
    return {
      value: pct,
      display: `${pct.toFixed(0)}%`,
      explanation: `${ctx.fmtLength(w.storage)} of ${ctx.fmtLength(w.usable)} usable wall has storage against it or mounted on it.`,
    };
  },
});

registerMetric({
  id: 'electrical-distance',
  label: 'Electrical-distance warnings',
  description: 'Powered machines unusually far from a suitable outlet.',
  unit: 'count',
  better: 'lower',
  order: 80,
  compute(ctx) {
    // Prefer the electrical analyzers (clearer shared wording) when a feature registered them.
    const analyzers = listAnalyzers().filter((a) => a.category === 'electrical');
    if (analyzers.length) {
      const n = runAnalyzers(ctx, analyzers.map((a) => a.id)).filter((w) => !w.acknowledged).length;
      return { value: n, display: String(n), explanation: `${n} open electrical warning${n === 1 ? '' : 's'} from the electrical checks.` };
    }
    const list = outletDistances(ctx);
    if (list.length === 0) return { value: 0, display: '0', explanation: 'No machines with electrical requirements.' };
    const limit = outletReachLimit(ctx);
    const far = list.filter((d) => d.tooFar);
    return {
      value: far.length,
      display: String(far.length),
      explanation: far.length
        ? `${far.map((d) => d.object.name).join(', ')} ${far.length === 1 ? 'is' : 'are'} more than ${ctx.fmtLength(limit)} from an outlet that can power them.`
        : `All ${list.length} powered machines are within ${ctx.fmtLength(limit)} of an outlet that can power them.`,
    };
  },
});
