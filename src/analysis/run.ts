import type { AnalysisContext } from './context';
import { getAnalyzer, listAnalyzers } from './registry';
import type { Severity, Warning } from './types';

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Run one analyzer (memoized per context), attaching analyzer id + acknowledgment status. */
function runOne(ctx: AnalysisContext, id: string): Warning[] {
  return ctx.memo(`analyzer:${id}`, () => {
    const a = getAnalyzer(id);
    if (!a) return [];
    let raw;
    try {
      raw = a.run(ctx);
    } catch (e) {
      // One broken analyzer must never take down the others (or the editor).
      console.error(`Analyzer "${id}" failed`, e);
      return [];
    }
    const acks = ctx.scenario.acknowledgedWarnings;
    const seen = new Set<string>();
    const out: Warning[] = [];
    for (const w of raw) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      out.push({
        ...w,
        analyzerId: id,
        quantities: w.quantities ?? [],
        highlight: w.highlight ?? {},
        ...(acks[w.id] ? { acknowledged: acks[w.id]!.status } : {}),
      });
    }
    return out;
  });
}

/** Run analyzers (all registered, or a subset) and return warnings sorted by severity then title. */
export function runAnalyzers(ctx: AnalysisContext, ids?: readonly string[]): Warning[] {
  const list = ids ?? listAnalyzers().map((a) => a.id);
  const all = list.flatMap((id) => runOne(ctx, id));
  return all.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.title.localeCompare(b.title));
}
