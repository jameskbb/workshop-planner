/**
 * Safety & interference panel: every registered check (overlap, doorways, garage door, vehicle,
 * working clearance, walkways, panel access, hazards, overhead, electrical, dust…) with its status,
 * the warnings it found, acknowledge / ignore / restore, and click-to-locate (select + zoom +
 * highlight on the plan). Thresholds for the safety checks are editable at the bottom.
 */
import { AlertOctagon, AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, EyeOff, Info, LocateFixed, RotateCcw, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { listAnalyzers, type Warning } from '@/analysis';
import { entityAdapters } from '@/app/registry';
import { fitBoxToView } from '@/app/canvas/PlanCanvas';
import { LengthInput } from '@/components/LengthInput';
import { PropRow, Section } from '@/components/shell';
import { Button, EmptyState, Tip } from '@/components/ui';
import { getScenario } from '@/domain/resolve';
import type { EntityRef } from '@/domain/schema';
import { bboxUnion, bbox, expandBBox, type BBox, type Point } from '@/geometry';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { useAnalysisReady, useWarnings, useWarningHighlight } from '@/features/warnings/register';
import { safetyPrefs, type SafetyPrefs } from './prefs';
import { electricalPrefs } from '@/features/electrical/reach';
import { dustPrefs } from '@/features/dust/network';

const SEVERITY = {
  critical: { icon: AlertOctagon, cls: 'text-danger', label: 'Critical' },
  warning: { icon: AlertTriangle, cls: 'text-warn', label: 'Warning' },
  info: { icon: Info, cls: 'text-info', label: 'Note' },
} as const;

const SELECTABLE = new Set(['object', 'vehicle', 'feature', 'electrical', 'light', 'zone', 'duct', 'fitting', 'wall']);

/** Bounding box of everything a warning points at. */
function warningBox(w: Warning): BBox | null {
  const pts: Point[] = [];
  for (const p of w.highlight.polygons ?? []) pts.push(...p);
  for (const r of w.highlight.regions ?? []) pts.push(...r.outer);
  for (const [a, b] of w.highlight.lines ?? []) pts.push(a, b);
  pts.push(...(w.highlight.points ?? []));
  const project = useProjectStore.getState().project;
  const boxes: BBox[] = pts.length ? [bbox(pts)] : [];
  if (project) {
    const ctx = { project, scenario: getScenario(project) };
    for (const r of w.involved) {
      if (r.kind === 'wall') continue;
      const o = entityAdapters.get(r.kind)?.outline(ctx, r.id);
      if (o?.length) boxes.push(bbox(o));
    }
  }
  return boxes.length ? bboxUnion(...boxes) : null;
}

/** Select the items involved, zoom to them and tint the problem area on the plan. */
export function locateWarning(w: Warning): void {
  useWarningHighlight.setState({ id: w.id });
  const refs = w.involved.filter((r) => SELECTABLE.has(r.kind) && r.kind !== 'wall') as EntityRef[];
  if (refs.length) uiActions.select(refs.slice(0, 1));
  if (useUiStore.getState().view !== '2d') uiActions.setView('2d');
  const box = warningBox(w);
  if (box) requestAnimationFrame(() => fitBoxToView(expandBBox(box, 600), 80));
}

function WarningRow({ w }: { w: Warning }) {
  const highlighted = useWarningHighlight((s) => s.id === w.id);
  const sev = SEVERITY[w.severity];
  const Icon = sev.icon;
  return (
    <li className={cn('border-t border-line px-3 py-2', highlighted && 'bg-select/10', w.acknowledged && 'opacity-60')} data-testid="warning-item" data-warning-id={w.id}>
      <button type="button" className="flex w-full gap-2 text-left" onClick={() => (highlighted ? useWarningHighlight.setState({ id: null }) : locateWarning(w))} aria-pressed={highlighted}>
        <Icon className={cn('mt-0.5 size-3.5 shrink-0', sev.cls)} aria-label={sev.label} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug text-ink">{w.message}</span>
          <span className="mt-0.5 block text-2xs text-ink-faint">
            {sev.label}
            {w.acknowledged ? ` · ${w.acknowledged}` : ''}
          </span>
        </span>
        <LocateFixed className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-label="Show on plan" />
      </button>
      <div className="mt-1 flex justify-end gap-1">
        {w.acknowledged ? (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'warning.unacknowledge', payload: { warningId: w.id } })}>
            <RotateCcw /> Restore
          </Button>
        ) : (
          <>
            <Tip content="I know about this; keep it listed but dimmed">
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'warning.acknowledge', payload: { warningId: w.id, status: 'acknowledged' } })} data-testid="warning-ack">
                <Check /> Acknowledge
              </Button>
            </Tip>
            <Tip content="Not a problem for me; hide it">
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'warning.acknowledge', payload: { warningId: w.id, status: 'ignored' } })} data-testid="warning-ignore">
                <EyeOff /> Ignore
              </Button>
            </Tip>
          </>
        )}
      </div>
    </li>
  );
}

function CheckGroup({ id, label, description, warnings, showIgnored }: { id: string; label: string; description: string; warnings: Warning[]; showIgnored: boolean }) {
  const open = warnings.filter((w) => !w.acknowledged);
  const visible = warnings.filter((w) => showIgnored || w.acknowledged !== 'ignored');
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const isOpen = expanded ?? open.length > 0;
  const worst = open.some((w) => w.severity === 'critical') ? 'critical' : open.some((w) => w.severity === 'warning') ? 'warning' : open.length ? 'info' : null;
  const Icon = worst ? SEVERITY[worst].icon : CheckCircle2;
  return (
    <li className="border-b border-line" data-testid={`check-${id}`}>
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel-2" onClick={() => setExpanded(!isOpen)} aria-expanded={isOpen} disabled={visible.length === 0}>
        {visible.length ? isOpen ? <ChevronDown className="size-3 text-ink-faint" /> : <ChevronRight className="size-3 text-ink-faint" /> : <span className="size-3" />}
        <Icon className={cn('size-3.5 shrink-0', worst ? SEVERITY[worst].cls : 'text-ok')} aria-label={worst ? SEVERITY[worst].label : 'OK'} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-ink">{label}</span>
          <span className="block truncate text-2xs text-ink-faint" title={description}>
            {description}
          </span>
        </span>
        <span className={cn('num text-2xs', open.length ? 'text-ink' : 'text-ok')}>{open.length ? open.length : 'OK'}</span>
      </button>
      {isOpen && visible.length > 0 && (
        <ul>
          {visible.map((w) => (
            <WarningRow key={w.id} w={w} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Thresholds() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const sp = safetyPrefs.read(project);
  const ep = electricalPrefs.read(project);
  const dp = dustPrefs.read(project);
  const setSafety = (patch: Partial<SafetyPrefs>) => dispatch({ type: 'extension.set', payload: { target: 'project', key: safetyPrefs.key, value: { ...sp, ...patch }, label: 'Change safety thresholds' } });
  return (
    <Section title="Thresholds" defaultOpen={false}>
      <div className="space-y-1">
        <PropRow label="Flammables ↔ hot">
          <LengthInput aria-label="Keep flammables this far from hot appliances" value={sp.hotDistance} allowZero={false} onCommit={(hotDistance) => setSafety({ hotDistance })} />
        </PropRow>
        <PropRow label="Finishing ↔ sparks">
          <LengthInput aria-label="Keep finishing this far from spark-producing tools" value={sp.sparksDistance} allowZero={false} onCommit={(sparksDistance) => setSafety({ sparksDistance })} />
        </PropRow>
        <PropRow label="Outlet distance">
          <LengthInput
            aria-label="Warn when a tool is farther than this from a suitable outlet"
            value={ep.maxDistance}
            allowZero={false}
            onCommit={(maxDistance) => dispatch({ type: 'extension.set', payload: { target: 'project', key: electricalPrefs.key, value: { maxDistance }, label: 'Change outlet distance' } })}
            data-testid="outlet-threshold"
          />
        </PropRow>
        <PropRow label="Dust run (equiv.)">
          <LengthInput aria-label="Longest practical equivalent dust run" value={dp.maxEquivalent} allowZero={false} onCommit={(maxEquivalent) => dispatch({ type: 'extension.set', payload: { target: 'project', key: dustPrefs.key, value: { ...dp, maxEquivalent }, label: 'Change dust threshold' } })} />
        </PropRow>
        <PropRow label="Flex hose max">
          <LengthInput aria-label="Longest practical flex hose" value={dp.maxFlex} allowZero={false} onCommit={(maxFlex) => dispatch({ type: 'extension.set', payload: { target: 'project', key: dustPrefs.key, value: { ...dp, maxFlex }, label: 'Change dust threshold' } })} />
        </PropRow>
        <p className="text-2xs text-ink-faint">Rules of thumb for planning. The walkway width is set in the Walkways panel.</p>
      </div>
    </Section>
  );
}

export function SafetyPanel() {
  const warnings = useWarnings();
  const ready = useAnalysisReady();
  const [showIgnored, setShowIgnored] = useState(false);
  const analyzers = useMemo(() => listAnalyzers(), []);
  const byAnalyzer = useMemo(() => {
    const m = new Map<string, Warning[]>();
    for (const w of warnings) {
      const list = m.get(w.analyzerId) ?? [];
      list.push(w);
      m.set(w.analyzerId, list);
    }
    return m;
  }, [warnings]);
  const open = warnings.filter((w) => !w.acknowledged);
  const ignored = warnings.filter((w) => w.acknowledged === 'ignored').length;
  const acknowledged = warnings.filter((w) => w.acknowledged === 'acknowledged').length;
  return (
    <div data-testid="safety-panel">
      <div className="border-b border-line px-3 py-2 text-xs text-ink-muted">
        {!ready ? (
          <span>Checking this layout…</span>
        ) : open.length === 0 ? (
          <span className="flex items-center gap-1.5 text-ok">
            <CheckCircle2 className="size-3.5" /> No open problems in this layout.
          </span>
        ) : (
          <span>
            <b className="text-ink">{open.length}</b> open · {acknowledged} acknowledged · {ignored} ignored. Click a problem to see it on the plan.
          </span>
        )}
      </div>
      {ready && warnings.length === 0 && (
        <EmptyState icon={<ShieldAlert />} title="No problems found">
          Nothing overlaps, everything is inside the room and every check below passes.
        </EmptyState>
      )}
      <ul>
        {analyzers.map((a) => (
          <CheckGroup key={a.id} id={a.id} label={a.label} description={a.description} warnings={byAnalyzer.get(a.id) ?? []} showIgnored={showIgnored} />
        ))}
      </ul>
      <div className="flex items-center justify-between px-3 py-2 text-2xs text-ink-faint">
        <span>Planning aid only, not a code-compliance check.</span>
        {ignored > 0 && (
          <button type="button" className="text-select hover:underline" onClick={() => setShowIgnored((v) => !v)}>
            {showIgnored ? 'Hide' : 'Show'} {ignored} ignored
          </button>
        )}
      </div>
      <Thresholds />
    </div>
  );
}
