/**
 * Dust-collection routing check (pure, auto-registered). Quiet until the user starts laying out
 * dust collection (a duct/hose run exists). Planning estimate only.
 */
import { registerAnalyzer } from '@/analysis/registry';
import type { WarningInput } from '@/analysis/types';
import { dustPrefs, dustRoutesFor } from './network';

registerAnalyzer({
  id: 'dust-routing',
  label: 'Dust collection routing',
  description: 'Tools not connected to the collector and runs too long, too flexible or too narrow (planning estimate).',
  category: 'dust',
  order: 75,
  run(ctx) {
    if (ctx.scenario.dust.runs.length === 0) return [];
    const prefs = dustPrefs.read(ctx.project);
    const out: WarningInput[] = [];
    const routes = dustRoutesFor(ctx);
    const hasCollector = ctx.objects.some((o) => o.resolved.category === 'dust-collection');
    if (!hasCollector) {
      return [
        {
          id: 'dust-routing:no-collector',
          category: 'dust',
          severity: 'info',
          title: 'No dust collector',
          message: 'Dust runs are drawn but there is no dust collector or shop vacuum in this layout to connect them to.',
          involved: [],
        },
      ];
    }
    for (const r of routes) {
      const ref = { kind: 'object' as const, id: r.tool.objectId };
      if (!r.connected) {
        out.push({
          id: `dust-routing:${r.tool.objectId}:unconnected`,
          category: 'dust',
          severity: 'info',
          title: `${r.tool.name} isn't connected`,
          message: `The ${r.tool.name}'s ${ctx.fmtLength(r.tool.diameter)} dust port isn't connected to a run${r.direct !== undefined && r.collector ? `; a direct hose to the ${r.collector.name} would be about ${ctx.fmtLength(r.direct)}` : ''}.`,
          involved: [ref],
          highlight: { points: [r.tool.port] },
          quantities: r.direct !== undefined ? [{ name: 'direct', value: r.direct, kind: 'length' }] : [],
          data: { connected: false },
        });
        continue;
      }
      if (r.problems.length === 0) continue;
      const parts = [`${ctx.fmtLength(r.rigid)} of duct`, `${ctx.fmtLength(r.flex)} of flex hose`, `${r.bends} bend${r.bends === 1 ? '' : 's'}`];
      const why: string[] = [];
      if (r.problems.includes('long')) why.push(`past the ${ctx.fmtLength(prefs.maxEquivalent)} that suits a typical hobby collector`);
      if (r.problems.includes('flex')) why.push(`more than ${ctx.fmtLength(prefs.maxFlex)} of flex hose`);
      if (r.problems.includes('narrow') && r.narrowest !== undefined) why.push(`it necks down to ${ctx.fmtLength(r.narrowest)} from the ${ctx.fmtLength(r.tool.diameter)} port`);
      out.push({
        id: `dust-routing:${r.tool.objectId}`,
        category: 'dust',
        severity: 'warning',
        title: `${r.tool.name}: impractical dust run`,
        message: `The ${r.tool.name}'s dust run is about ${ctx.fmtLength(r.equivalent)} equivalent (${parts.join(', ')}): ${why.join('; ')}.`,
        involved: [ref, ...(r.collector ? [{ kind: 'object' as const, id: r.collector.objectId }] : [])],
        highlight: { lines: r.path.slice(1).map((p, i) => [r.path[i]!, p] as [typeof p, typeof p]) },
        quantities: [
          { name: 'equivalent', value: r.equivalent, kind: 'length' },
          { name: 'rigid', value: r.rigid, kind: 'length' },
          { name: 'flex', value: r.flex, kind: 'length' },
          { name: 'bends', value: r.bends, kind: 'count' },
        ],
        data: { connected: true, problems: r.problems },
      });
    }
    return out;
  },
});
