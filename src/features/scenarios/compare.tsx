/**
 * Side-by-side comparison: 2–4 layouts rendered read-only with one synced viewport (wheel zoom,
 * drag pan, fit) and a metric table underneath: measured values with units, the best layout per
 * metric marked with ✓ (not color alone), and an optional relative weighted summary whose per-metric
 * breakdown is always one click away. Items that moved relative to the first layout are outlined.
 */
import { ArrowLeft, Check, Maximize, Scale } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { Button, Tip } from '@/components/ui';
import { featureFootprint, getScenario, objectFootprint, resolveObject, roomGeometry, vehicleGeomSpec, vehiclePose } from '@/domain/resolve';
import { OPENING_KINDS, OVERHEAD_KINDS, type Project } from '@/domain/schema';
import { bbox, vehicleBody, wallQuads, type Polygon } from '@/geometry';
import { useElementSize } from '@/hooks/useElementSize';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { canvasColors, categoryColors, zoneKindColors } from '@/styles/tokens';
import { cn } from '@/utils/cn';
import { useCompareStore } from './compareStore';
import { layoutMetrics, relativeScores, scorecardPrefs, weightOf, WEIGHT_LABELS } from './scorecard';

const pts = (p: Polygon) => p.map((q) => `${q.x},${q.y}`).join(' ');

function fitView(project: Project, size: { width: number; height: number }) {
  const g = roomGeometry(project.room);
  if (g.polygon.length < 3 || size.width <= 0) return { cx: 0, cy: 0, mmPerPx: 10 };
  const b = bbox(g.polygon);
  const pad = 600;
  const mmPerPx = Math.max((b.maxX - b.minX + pad * 2) / size.width, (b.maxY - b.minY + pad * 2) / size.height);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, mmPerPx };
}

const PlanSvg = memo(function PlanSvg({ project, scenarioId, baseId, view, size }: { project: Project; scenarioId: string; baseId: string; view: { cx: number; cy: number; mmPerPx: number }; size: { width: number; height: number } }) {
  const s = getScenario(project, scenarioId);
  const base = getScenario(project, baseId);
  const g = roomGeometry(project.room);
  const w = size.width * view.mmPerPx;
  const h = size.height * view.mmPerPx;
  const font = 11 * view.mmPerPx;
  const stroke = view.mmPerPx;
  const baseById = new Map(base.objects.map((o) => [o.id, o]));
  return (
    <svg className="size-full" viewBox={`${view.cx - w / 2} ${view.cy - h / 2} ${w} ${h}`} role="img" aria-label={`Plan of layout ${s.name}`}>
      <defs>
        <pattern id={`moved-${scenarioId}`} width={8 * stroke} height={8 * stroke} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={8 * stroke} stroke={canvasColors.select} strokeWidth={2 * stroke} opacity="0.35" />
        </pattern>
      </defs>
      <rect x={view.cx - w / 2} y={view.cy - h / 2} width={w} height={h} fill={canvasColors.outside} />
      {g.polygon.length >= 3 && <polygon points={pts(g.polygon)} fill={canvasColors.paper} />}
      {g.polygon.length >= 3 && wallQuads(g.polygon, g.thickness).map((q, i) => <polygon key={`w${i}`} points={pts(q)} fill={canvasColors.wallFill} />)}
      {s.zones
        .filter((z) => !z.hidden)
        .map((z) => (
          <polygon key={z.id} points={pts(z.points)} fill={zoneKindColors[z.kind] ?? '#bbb'} opacity={0.18} />
        ))}
      {project.architecture
        .filter((f) => !f.hidden && !OVERHEAD_KINDS.has(f.kind))
        .map((f) => {
          const fp = featureFootprint(project.room, f);
          if (fp.length < 3) return null;
          return <polygon key={f.id} points={pts(fp)} fill={OPENING_KINDS.has(f.kind) ? (f.kind === 'window' ? canvasColors.window : canvasColors.paper) : '#b9bcc0'} stroke={canvasColors.wallStroke} strokeWidth={stroke} />;
        })}
      {s.vehicles
        .filter((v) => !v.hidden)
        .map((v) => (
          <polygon key={v.id} points={pts(vehicleBody(vehicleGeomSpec(v), vehiclePose(v)))} fill={canvasColors.vehicleFill} stroke={canvasColors.vehicleStroke} strokeWidth={1.5 * stroke} />
        ))}
      {s.objects
        .filter((o) => !o.hidden)
        .map((o) => {
          const r = resolveObject(project, o);
          const fp = objectFootprint(r);
          const c = categoryColors[r.category];
          const was = baseById.get(o.id);
          const moved = scenarioId !== baseId && (!was || Math.hypot(was.x - o.x, was.y - o.y) > 1 || was.rotation !== o.rotation || was.activePosition !== o.activePosition || was.stateId !== o.stateId);
          const b = bbox(fp);
          return (
            <g key={o.id}>
              <polygon points={pts(fp)} fill={c.fill} fillOpacity={r.elevated ? 0.5 : 0.95} stroke={c.stroke} strokeWidth={1.2 * stroke} strokeDasharray={r.elevated ? `${4 * stroke} ${3 * stroke}` : undefined} />
              {moved && <polygon points={pts(fp)} fill={`url(#moved-${scenarioId})`} stroke={canvasColors.select} strokeWidth={2 * stroke} />}
              {b.maxX - b.minX > font * 4 && (
                <text x={(b.minX + b.maxX) / 2} y={(b.minY + b.maxY) / 2} fontSize={font} textAnchor="middle" dominantBaseline="middle" fill={canvasColors.ink} style={{ pointerEvents: 'none' }}>
                  {r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label}
                </text>
              )}
            </g>
          );
        })}
      {scenarioId !== baseId &&
        base.objects
          .filter((o) => !o.hidden && !s.objects.some((x) => x.id === o.id))
          .map((o) => <polygon key={`gone-${o.id}`} points={pts(objectFootprint(resolveObject(project, o)))} fill="none" stroke={canvasColors.danger} strokeWidth={stroke} strokeDasharray={`${3 * stroke} ${3 * stroke}`} />)}
    </svg>
  );
});

function Panel({ project, scenarioId, baseId, index }: { project: Project; scenarioId: string; baseId: string; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const stored = useCompareStore((s) => s.view);
  const view = stored ?? fitView(project, size);
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);
  const s = project.scenarios.find((x) => x.id === scenarioId)!;
  return (
    <div className="flex min-w-0 flex-1 flex-col border-r border-line last:border-r-0" data-testid="compare-panel">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-line px-2">
        <span className="truncate text-xs font-semibold text-ink">
          {s.name}
          {index === 0 ? <span className="ml-1.5 font-normal text-ink-faint">(reference)</span> : null}
        </span>
        <Button size="sm" variant="ghost" onClick={() => {
          dispatch({ type: 'scenario.setActive', payload: { scenarioId } });
          uiActions.setView('2d');
        }}>
          Open
        </Button>
      </div>
      <div
        ref={ref}
        className="relative min-h-0 flex-1 cursor-grab touch-none active:cursor-grabbing"
        onWheel={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = e.clientX - r.left - r.width / 2;
          const py = e.clientY - r.top - r.height / 2;
          const f = Math.exp(e.deltaY * 0.0015);
          const wx = view.cx + px * view.mmPerPx;
          const wy = view.cy + py * view.mmPerPx;
          const m = Math.min(200, Math.max(0.5, view.mmPerPx * f));
          useCompareStore.setState({ view: { cx: wx - px * m, cy: wy - py * m, mmPerPx: m } });
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          useCompareStore.setState({ view: { ...d.view, cx: d.view.cx - (e.clientX - d.x) * d.view.mmPerPx, cy: d.view.cy - (e.clientY - d.y) * d.view.mmPerPx } });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {size.width > 0 && <PlanSvg project={project} scenarioId={scenarioId} baseId={baseId} view={view} size={size} />}
      </div>
    </div>
  );
}

export function CompareView() {
  const project = useProjectStore((s) => s.project);
  const storedIds = useCompareStore((s) => s.ids);
  const [showBreakdown, setShowBreakdown] = useState<string | null>(null);
  const ids = useMemo(() => {
    if (!project) return [];
    const valid = storedIds.filter((id) => project.scenarios.some((s) => s.id === id));
    return valid.length >= 1 ? valid : project.scenarios.slice(0, 2).map((s) => s.id);
  }, [project, storedIds]);
  const rows = useMemo(() => (project ? layoutMetrics(project, ids) : []), [project, ids]);
  const weights = useMemo(() => (project ? scorecardPrefs.read(project).weights : {}), [project]);
  const scores = useMemo(() => relativeScores(rows, weights), [rows, weights]);
  if (!project) return null;
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-4);
    if (next.length) useCompareStore.setState({ ids: next });
  };
  return (
    <div className="flex size-full flex-col bg-app" data-testid="compare-view">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button size="sm" variant="ghost" onClick={() => uiActions.setView('2d')} data-testid="compare-back">
          <ArrowLeft /> Back to plan
        </Button>
        <span className="text-xs text-ink-muted">Compare:</span>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Layouts to compare">
          {project.scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={ids.includes(s.id)}
              onClick={() => toggle(s.id)}
              className={cn('rounded border px-2 py-0.5 text-xs', ids.includes(s.id) ? 'border-select bg-select/20 text-ink' : 'border-line text-ink-muted hover:text-ink')}
            >
              {ids.includes(s.id) && <Check className="mr-1 inline size-3" />}
              {s.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-2xs text-ink-faint">Scroll to zoom · drag to pan (all panels move together)</span>
          <Tip content="Fit room">
            <Button size="icon-sm" variant="ghost" aria-label="Fit room" onClick={() => useCompareStore.setState({ view: null })}>
              <Maximize />
            </Button>
          </Tip>
        </div>
      </div>
      <div className="flex min-h-0 flex-[3]">
        {ids.map((id, i) => (
          <Panel key={id} project={project} scenarioId={id} baseId={ids[0]!} index={i} />
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-[2] overflow-auto border-t border-line bg-panel">
        <table className="w-full border-collapse text-xs" data-testid="compare-table">
          <thead className="sticky top-0 bg-panel">
            <tr className="border-b border-line">
              <th className="px-3 py-1.5 text-left font-semibold text-ink-muted">Metric</th>
              <th className="px-2 py-1.5 text-left font-semibold text-ink-muted">Priority</th>
              {rows.map((r) => (
                <th key={r.scenarioId} className="px-3 py-1.5 text-left font-semibold text-ink">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows[0]?.metrics.map((m, mi) => (
              <tr key={m.metric.id} className="border-b border-line/60 align-top" data-testid="compare-row">
                <td className="px-3 py-1.5">
                  <div className="text-ink">{m.metric.label}</div>
                  <div className="text-2xs text-ink-faint">
                    {m.metric.better === 'higher' ? 'Higher is better' : 'Lower is better'} · {m.metric.description}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-ink-muted">{WEIGHT_LABELS[weightOf(weights, m.metric.id)]}</td>
                {rows.map((r, ri) => {
                  const res = r.metrics[mi]!.result;
                  const best = scores[ri]?.best[m.metric.id];
                  return (
                    <td key={r.scenarioId} className={cn('px-3 py-1.5', best && 'bg-ok/10')} title={res.explanation}>
                      <div className="num flex items-center gap-1 text-ink">
                        {res.display}
                        {best && (
                          <span className="inline-flex items-center gap-0.5 text-2xs text-ok">
                            <Check className="size-3" aria-hidden /> best
                          </span>
                        )}
                      </div>
                      <div className="text-2xs leading-snug text-ink-faint">{res.explanation}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="border-t-2 border-line-strong align-top">
                <td className="px-3 py-2" colSpan={2}>
                  <div className="flex items-center gap-1 font-semibold text-ink">
                    <Scale className="size-3.5" /> Relative summary (your priorities)
                  </div>
                  <div className="text-2xs text-ink-faint">100 = best of these layouts on every weighted metric, 0 = worst. Not an absolute rating; open the breakdown to see exactly how it adds up. Change priorities in the Scorecard panel.</div>
                </td>
                {scores.map((s) => (
                  <td key={s.scenarioId} className="px-3 py-2">
                    <div className="num text-sm font-semibold text-ink">{s.score === null ? 'n/a' : Math.round(s.score)}</div>
                    <button type="button" className="text-2xs text-select hover:underline" onClick={() => setShowBreakdown(showBreakdown === s.scenarioId ? null : s.scenarioId)}>
                      {showBreakdown === s.scenarioId ? 'Hide breakdown' : 'Breakdown'}
                    </button>
                    {showBreakdown === s.scenarioId && (
                      <ul className="mt-1 space-y-0.5 text-2xs text-ink-muted">
                        {s.contributions.map((c) => (
                          <li key={c.metricId}>
                            {c.label}: {c.normalized === null ? 'n/a' : `${Math.round(c.normalized * 100)}% × weight ${c.weight}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
