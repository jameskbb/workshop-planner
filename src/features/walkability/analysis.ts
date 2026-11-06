/**
 * Walkway analyzer (pure, auto-loaded by src/analysis): main paths from each door to benches, tools
 * and storage that narrow below the chosen aisle width, destinations with no route at all, and
 * dead-end aisles. Wording: "Main path from garage entry to workbench narrows to 19" beside the cabinet."
 */
import { registerAnalyzer } from '@/analysis/registry';
import type { WarningInput } from '@/analysis/types';
import { inches } from '@/domain/units';
import { aisleWidthOf, pathReports, walkability, type PathReport } from './model';

/** Below this fraction of the chosen aisle width a narrowing is a warning rather than a note. */
const WARN_FRACTION = 0.75;

function lower(name: string): string {
  return name.length > 1 && name[1] === name[1]!.toLowerCase() ? name[0]!.toLowerCase() + name.slice(1) : name;
}

registerAnalyzer({
  id: 'walkway',
  label: 'Walkways',
  description: 'Main paths from each door that narrow below the chosen aisle width, unreachable items and dead-end aisles.',
  category: 'walkway',
  order: 60,
  run(ctx) {
    if (!ctx.hasRoom) return [];
    const aisle = aisleWidthOf(ctx);
    const out: WarningInput[] = [];
    const reports = pathReports(ctx, aisle);

    // Group narrow paths by their bottleneck (the same pinch point often limits several routes).
    const groups = new Map<string, PathReport[]>();
    for (const r of reports) {
      if (r.blocked || !(r.width < aisle)) continue;
      const key = `${r.beside.ref?.id ?? r.beside.name}:${Math.round(r.point.x / 300)}:${Math.round(r.point.y / 300)}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    for (const list of groups.values()) {
      const worst = list.reduce((a, b) => (b.width < a.width ? b : a));
      const others = [...new Set(list.filter((r) => r !== worst).map((r) => lower(r.destination.name)))];
      const also = others.length ? ` It also limits the way to ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}.` : '';
      out.push({
        id: `walkway:narrow:${worst.entry.id}:${worst.destination.ref.id}`,
        category: 'walkway',
        severity: worst.width < aisle * WARN_FRACTION ? 'warning' : 'info',
        title: 'Walkway narrows',
        message: `Main path from ${worst.entry.label} to ${lower(worst.destination.name)} narrows to ${ctx.fmtLength(worst.width)} beside ${worst.beside.name} (aisle target ${ctx.fmtLength(aisle)}).${also}`,
        involved: [worst.destination.ref, ...(worst.beside.ref ? [worst.beside.ref] : [])],
        highlight: {
          points: [worst.point],
          lines: worst.route.slice(1).map((p, i) => [worst.route[i]!, p] as [typeof p, typeof p]),
          polygons: [circle(worst.point, Math.max(worst.width / 2, 150))],
        },
        quantities: [
          { name: 'width', value: worst.width, kind: 'length' },
          { name: 'aisle', value: aisle, kind: 'length' },
        ],
        data: { entry: worst.entry.label, destination: worst.destination.name, beside: worst.beside.name, point: worst.point },
      });
    }

    for (const r of reports.filter((x) => x.blocked)) {
      out.push({
        id: `walkway:blocked:${r.entry.id}:${r.destination.ref.id}`,
        category: 'walkway',
        severity: 'warning',
        title: 'No walkable path',
        message: `There is no path at least 6" wide from ${r.entry.label} to ${lower(r.destination.name)}; something must be moved to reach it.`,
        involved: [r.destination.ref],
        highlight: { points: [r.destination.point], polygons: [circle(r.destination.point, 300)] },
        quantities: [],
      });
    }

    const walk = walkability(ctx, aisle);
    for (const d of walk?.deadEnds ?? []) {
      if (d.length < inches(36)) continue;
      out.push({
        id: `walkway:dead-end:${Math.round(d.point.x / 100)}:${Math.round(d.point.y / 100)}`,
        category: 'walkway',
        severity: 'info',
        title: 'Dead-end aisle',
        message: `Dead-end aisle ${ctx.fmtLength(d.length)} long and about ${ctx.fmtLength(d.width)} wide: you can walk in but not through.`,
        involved: [],
        highlight: { points: [d.point], lines: d.path.slice(1).map((p, i) => [d.path[i]!, p] as [typeof p, typeof p]) },
        quantities: [
          { name: 'length', value: d.length, kind: 'length' },
          { name: 'width', value: d.width, kind: 'length' },
        ],
      });
    }
    return out;
  },
});

function circle(c: { x: number; y: number }, r: number) {
  const pts = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return pts;
}
