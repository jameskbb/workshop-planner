/**
 * Core descriptive metrics (Phase 4 adds the full scorecard in its own files).
 */
import { spaceUtilization } from '@/geometry';
import { registerMetric } from '../registry';
import { runAnalyzers } from '../run';

registerMetric({
  id: 'collisions',
  label: 'Collisions',
  description: 'Pairs of objects, fixtures or vehicles that physically overlap.',
  unit: 'count',
  better: 'lower',
  order: 10,
  compute(ctx) {
    const n = runAnalyzers(ctx, ['overlap']).length;
    return { value: n, display: String(n), explanation: `${n} overlapping pair${n === 1 ? '' : 's'} found by the physical-overlap check.` };
  },
});

registerMetric({
  id: 'clearance-conflicts',
  label: 'Clearance conflicts',
  description: 'Working/maintenance zones blocked by walls, objects, fixtures or vehicles.',
  unit: 'count',
  better: 'lower',
  order: 20,
  compute(ctx) {
    const n = runAnalyzers(ctx, ['clearance']).length;
    return { value: n, display: String(n), explanation: `${n} blocked clearance zone${n === 1 ? '' : 's'} (intrusions under 1/2" ignored).` };
  },
});

registerMetric({
  id: 'open-floor-area',
  label: 'Open floor area',
  description: 'Room area not covered by fixed obstructions, floor objects or vehicles. Clearance zones do not count as occupied.',
  unit: 'area',
  better: 'higher',
  order: 5,
  compute(ctx) {
    if (!ctx.hasRoom) return { value: null, display: 'n/a', explanation: 'Draw the room first.' };
    const u = ctx.memo('space-utilization', () =>
      spaceUtilization({
        room: ctx.room.polygon,
        obstructions: ctx.features.filter((f) => f.blocksFloor).map((f) => f.footprint),
        footprints: [...ctx.objects.filter((o) => o.resolved.elevation < 300).map((o) => o.footprint), ...ctx.vehicles.map((v) => v.body)],
      }),
    );
    return {
      value: u.openArea,
      display: `${ctx.fmtArea(u.openArea)} (${u.pct.open.toFixed(0)}%)`,
      explanation: `Room ${ctx.fmtArea(u.roomArea)} minus fixed obstructions ${ctx.fmtArea(u.obstructionArea)} and footprints ${ctx.fmtArea(u.footprintArea)}.`,
    };
  },
});
