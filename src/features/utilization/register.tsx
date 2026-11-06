/**
 * Space utilization (room, permanent obstructions, object footprint, open floor, zones, with
 * percentages; clearance overlays never count as footprint) and wall utilization per wall (linear:
 * total / occupied / available; vertical: surface / storage coverage / unused).
 */
import { ChartPie } from 'lucide-react';
import { useMemo } from 'react';
import { buildAnalysisContext } from '@/analysis';
import { paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { useFormatters } from '@/hooks/useFormatters';
import { useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { spaceReport, wallReports } from './model';

function Bar({ pct, pattern }: { pct: number; pattern?: boolean }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-panel-3" aria-hidden>
      <div
        className="h-full bg-select"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundImage: pattern ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 2px, transparent 2px 5px)' : undefined }}
      />
    </div>
  );
}

function UtilizationPanel() {
  const project = useProjectStore((s) => s.project);
  const fmt = useFormatters();
  const data = useMemo(() => {
    if (!project) return null;
    const ctx = buildAnalysisContext(project);
    if (!ctx.hasRoom) return null;
    return { space: spaceReport(ctx), walls: wallReports(ctx) };
  }, [project]);
  if (!project) return null;
  if (!data) return <p className="p-3 text-xs text-ink-muted">Draw the room to see how its floor and walls are used.</p>;
  const { space: s, walls } = data;
  const rows: Array<{ label: string; area: number; pct: number; note?: string }> = [
    { label: 'Open floor', area: s.openArea, pct: s.pct.open, note: 'Clearance zones count as open.' },
    { label: 'Object & vehicle footprint', area: s.footprintArea, pct: s.pct.footprint, note: `${s.counted.objects} floor items, ${s.counted.vehicles} vehicle(s)` },
    { label: 'Permanent obstructions', area: s.obstructionArea, pct: s.pct.obstruction, note: `${s.counted.obstructions} fixed features` },
  ];
  const lin = walls.reduce((a, w) => ({ total: a.total + w.linear.length, occupied: a.occupied + w.linear.occupied, available: a.available + w.linear.available }), { total: 0, occupied: 0, available: 0 });
  return (
    <div data-testid="utilization-panel">
      <Section title="Floor">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Room</span>
          <span className="num font-semibold text-ink">{fmt.area(s.roomArea)}</span>
        </div>
        <ul className="mt-2 space-y-2">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-ink">{r.label}</span>
                <span className="num text-ink">
                  {fmt.area(r.area)} <span className="text-ink-faint">({r.pct.toFixed(1)}%)</span>
                </span>
              </div>
              <Bar pct={r.pct} />
              {r.note && <div className="text-2xs text-ink-faint">{r.note}</div>}
            </li>
          ))}
        </ul>
        <div className="mt-3 panel-heading">Zones</div>
        {s.zones.length === 0 ? (
          <p className="text-2xs text-ink-faint">No zones in this layout.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {s.zones.map((z) => (
              <li key={z.id}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-ink">{z.name}</span>
                  <span className="num text-ink">
                    {fmt.area(z.area)} <span className="text-ink-faint">({z.pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <Bar pct={z.pct} pattern />
              </li>
            ))}
            <li className="text-2xs text-ink-faint">All zones together (overlaps counted once): {fmt.area(s.zoneArea)} ({s.pct.zone.toFixed(1)}%)</li>
          </ul>
        )}
      </Section>
      <Section title="Walls">
        <p className="mb-2 text-2xs text-ink-faint">
          Linear: {fmt.length(lin.occupied)} used, {fmt.length(lin.available)} free of {fmt.length(lin.total)}. Items within 2′ of a wall count against it; doors and low windows are unusable.
        </p>
        <table className="w-full text-2xs" data-testid="wall-utilization">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="py-1 font-normal">Wall</th>
              <th className="py-1 text-right font-normal">Length</th>
              <th className="py-1 text-right font-normal">Used</th>
              <th className="py-1 text-right font-normal">Free</th>
            </tr>
          </thead>
          <tbody>
            {walls.map((w) => (
              <tr key={w.linear.wallIndex} className="border-t border-line/60 align-top">
                <td className="py-1 pr-1 text-ink">
                  {w.linear.wallName}
                  <div className="text-ink-faint">
                    Surface {fmt.area(w.vertical.surface)} · storage {w.vertical.pctCovered.toFixed(0)}% · unused {fmt.area(w.vertical.unused)}
                  </div>
                </td>
                <td className="num py-1 text-right text-ink">{fmt.length(w.linear.length)}</td>
                <td className="num py-1 text-right text-ink">{fmt.length(w.linear.occupied)}</td>
                <td className="num py-1 text-right text-ink">{fmt.length(w.linear.available)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-2xs text-ink-faint">Vertical: floor-to-ceiling surface of each wall, the share covered by cabinets, shelves and tall items against it (openings excluded), and what is left.</p>
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'utilization', title: 'Space use', icon: ChartPie, order: 106, component: UtilizationPanel });
paletteCommands.register({ id: 'utilization.open', title: 'Space & wall utilization', section: 'Analysis', icon: ChartPie, keywords: ['area', 'open floor', 'wall', 'usage'], when: (c) => !!c.project, run: () => uiActions.setLeftSection('utilization') });
