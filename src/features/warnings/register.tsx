/**
 * Warnings panel: every analyzer's findings for the active layout, with severity, plain-language
 * explanation, click-to-select/highlight and acknowledge / ignore / restore.
 */
import { AlertOctagon, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { locateWarning, SafetyPanel } from '@/features/safety/SafetyPanel';
import { useWarnings } from './analysisClient';
import { Group, Line } from 'react-konva';
import { create } from 'zustand';
import { canvasLayers, inspectorSections, sidebarSections, type SelectionContext } from '@/app/registry';
import { canvasColors } from '@/styles/tokens';
import { cn } from '@/utils/cn';

/** Warning currently highlighted on the canvas. */
export const useWarningHighlight = create<{ id: string | null }>()(() => ({ id: null }));

export { useWarnings, useAnalysisReady } from './analysisClient';

const SEVERITY = {
  critical: { icon: AlertOctagon, cls: 'text-danger', label: 'Critical' },
  warning: { icon: AlertTriangle, cls: 'text-warn', label: 'Warning' },
  info: { icon: Info, cls: 'text-info', label: 'Note' },
} as const;

function WarningsBadge() {
  const n = useWarnings().filter((w) => !w.acknowledged).length;
  if (!n) return null;
  return <span className="num grid h-3.5 min-w-3.5 place-items-center rounded-full bg-warn px-1 text-[9px] font-bold text-black">{n}</span>;
}

// The panel body is the Safety & interference panel (features/safety): checks grouped with status, locate on plan.
sidebarSections.register({ id: 'warnings', title: 'Safety & warnings', icon: ShieldAlert, order: 90, component: SafetyPanel, badge: WarningsBadge });

/** Tint the highlighted warning's regions on the plan. */
function WarningHighlightLayer() {
  const id = useWarningHighlight((s) => s.id);
  const warnings = useWarnings();
  const w = id ? warnings.find((x) => x.id === id) : undefined;
  if (!w) return null;
  const fill = w.severity === 'critical' ? canvasColors.dangerFill : canvasColors.warnFill;
  const stroke = w.severity === 'critical' ? canvasColors.danger : canvasColors.warn;
  return (
    <Group listening={false}>
      {(w.highlight.polygons ?? []).map((p, i) => (
        <Line key={`p${i}`} points={p.flatMap((q) => [q.x, q.y])} closed stroke={stroke} strokeWidth={1} dash={[6, 4]} strokeScaleEnabled={false} />
      ))}
      {(w.highlight.regions ?? []).map((r, i) => (
        <Line key={`r${i}`} points={r.outer.flatMap((q) => [q.x, q.y])} closed fill={fill} stroke={stroke} strokeWidth={2} strokeScaleEnabled={false} />
      ))}
    </Group>
  );
}
canvasLayers.register({ id: 'warning-highlight', slot: 'overlay', order: 20, component: WarningHighlightLayer });

/** Warnings about the selected object, in the inspector. */
function SelectionWarnings({ ctx }: { ctx: SelectionContext }) {
  const warnings = useWarnings().filter((w) => !w.acknowledged && w.involved.some((r) => r.id === ctx.single?.id));
  if (warnings.length === 0) return <p className="text-xs text-ok">No problems found for this item.</p>;
  return (
    <ul className="space-y-1.5">
      {warnings.map((w) => {
        const Icon = SEVERITY[w.severity].icon;
        return (
          <li key={w.id} className="flex gap-1.5 text-xs text-ink-muted">
            <Icon className={cn('mt-0.5 size-3 shrink-0', SEVERITY[w.severity].cls)} />
            <button type="button" className="text-left hover:text-ink" onClick={() => locateWarning(w)}>
              {w.message}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
inspectorSections.register({
  id: 'warnings.selection',
  title: 'Warnings',
  order: 80,
  appliesTo: (c) => c.single !== null && (c.single.kind === 'object' || c.single.kind === 'vehicle'),
  component: SelectionWarnings,
});
