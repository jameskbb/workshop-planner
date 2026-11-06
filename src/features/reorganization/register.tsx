/**
 * Reorganization: Current/Target designation, before/after overlay and the physical move plan
 * (step list with Already moved / Skip / Cannot move yet, highlight on the plan, regenerate the
 * remaining plan, printable checklist).
 */
import { ArrowLeftRight, Ban, Check, Eye, EyeOff, Printer, RefreshCw, RotateCcw, SkipForward, Truck, Weight } from 'lucide-react';
import { canvasLayers, canvasOverlays, paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { Badge, Button, EmptyState, Select, Tip } from '@/components/ui';
import type { Project } from '@/domain/schema';
import { esc, printDocument } from '@/features/print/printDocument';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { isOverlayOn, uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { BeforeAfterLayer, BeforeAfterLegend, StepHighlightLayer } from './overlay';
import type { MoveStep, StepStatus } from './planner';
import { OVERLAY_KEY, regenerate, reorgModel, resetProgress, setLayouts, setStepStatus, useReorgModel, useReorgUi } from './state';

const STATUS: Array<{ id: StepStatus; label: string; short: string; icon: typeof Check }> = [
  { id: 'moved', label: 'Already moved', short: 'Moved', icon: Check },
  { id: 'skipped', label: 'Skip', short: 'Skipped', icon: SkipForward },
  { id: 'blocked', label: 'Cannot move yet', short: 'Cannot move yet', icon: Ban },
];

const LB = 2.20462;

export function printChecklist(project: Project): void {
  const m = reorgModel(project);
  if (!m) return;
  const name = (id: string) => project.scenarios.find((s) => s.id === id)?.name ?? '';
  const imperial = project.settings.unitSystem === 'imperial';
  const rows = m.plan.steps
    .map((s, i) => {
      const st = m.live[s.key];
      const statusText = st ? STATUS.find((x) => x.id === st)!.short : '';
      const heavy = s.heavy ? `<span class="tag">heavy · ~${imperial ? `${Math.round(s.effortKg * LB)} lb` : `${Math.round(s.effortKg)} kg`}</span>` : '';
      return `<tr><td class="num" style="width:6%">${i + 1}</td><td style="width:6%"><span class="box"></span></td><td class="${st === 'moved' ? 'done' : ''}"><strong>${esc(s.title)}</strong>${heavy}${s.detail ? `<div class="muted">${esc(s.detail)}</div>` : ''}</td><td style="width:18%" class="muted">${esc(statusText)}</td></tr>`;
    })
    .join('');
  const notes = m.plan.notes.length ? `<h2>Notes</h2><ul>${m.plan.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  printDocument(
    `${project.name}: Move plan`,
    `<h1>${esc(project.name)}: Move plan</h1><div class="meta">From “${esc(name(m.d.currentId))}” to “${esc(name(m.d.targetId))}” · ${m.plan.steps.length} steps · ${m.plan.totalMoves} moves · ${new Date().toLocaleDateString()}</div><table><tr><th>#</th><th></th><th>Step</th><th>Status</th></tr>${rows}</table>${notes}`,
  );
}

function StepRow({ step, index, status, highlighted }: { step: MoveStep; index: number; status: StepStatus | undefined; highlighted: boolean }) {
  const imperial = useProjectStore((s) => s.project?.settings.unitSystem !== 'metric');
  const done = status === 'moved';
  const passive = step.kind === 'waiting' || step.kind === 'deferred';
  return (
    <li
      className={cn('rounded-md border px-2 py-1.5', highlighted ? 'border-select bg-select/10' : 'border-transparent hover:bg-panel-2', done && 'opacity-60')}
      data-testid="move-step"
      data-step-key={step.key}
      data-status={status ?? ''}
    >
      <button type="button" className="flex w-full gap-2 text-left" onClick={() => useReorgUi.setState({ highlight: highlighted ? null : step.key })} aria-pressed={highlighted}>
        <span className={cn('num mt-px grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold', done ? 'bg-ok/25 text-ok' : 'bg-panel-3 text-ink')}>
          {done ? <Check className="size-3" /> : index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-[13px] leading-snug text-ink', done && 'line-through')}>{step.title}</span>
          {step.detail && <span className="block text-2xs leading-snug text-ink-muted">{step.detail}</span>}
          <span className="mt-0.5 flex flex-wrap gap-1">
            {step.heavy && (
              <Badge tone="warn">
                <Weight className="mr-0.5 inline size-3" />
                Heavy · ~{imperial ? `${Math.round(step.effortKg * LB)} lb` : `${Math.round(step.effortKg)} kg`}
              </Badge>
            )}
            {step.kind === 'stage' && <Badge tone="info">Temporary</Badge>}
            {passive && <Badge tone="danger">{step.kind === 'waiting' ? 'Waiting' : 'Deferred'}</Badge>}
            {status && <Badge tone={status === 'moved' ? 'ok' : 'neutral'}>{STATUS.find((s) => s.id === status)!.short}</Badge>}
          </span>
        </span>
      </button>
      <div className="mt-1 flex flex-wrap gap-1 pl-7" role="group" aria-label={`Status of step ${index + 1}`}>
        {STATUS.map((s) => {
          const Icon = s.icon;
          const on = status === s.id;
          return (
            <Tip key={s.id} content={on ? `Clear “${s.label}”` : s.label}>
              <Button size="sm" variant={on ? 'default' : 'ghost'} className="h-6 px-1.5 text-2xs" aria-pressed={on} onClick={() => setStepStatus(step.key, on ? null : s.id)} data-testid={`step-${s.id}`}>
                <Icon className="!size-3" /> {s.label}
              </Button>
            </Tip>
          );
        })}
      </div>
    </li>
  );
}

function ReorganizePanel() {
  const project = useProjectStore((s) => s.project);
  const model = useReorgModel();
  const overlayOn = useUiStore((s) => isOverlayOn(s, OVERLAY_KEY));
  const highlight = useReorgUi((s) => s.highlight);
  if (!project) return null;
  if (!model) {
    return (
      <EmptyState title="Two layouts needed" icon={<Truck className="size-6" />}>
        Duplicate your layout, rearrange the copy into the layout you want, then come back: the app compares the Current and Target layouts and plans the physical moves.
      </EmptyState>
    );
  }
  const { d, plan, diff, live, stale } = model;
  const options = project.scenarios.map((s) => ({ value: s.id, label: s.name }));
  const name = (id: string) => project.scenarios.find((s) => s.id === id)?.name ?? '';
  // The before/after overlay draws the Current → Target pair, which may not be what is on screen.
  const viewing = project.scenarios.find((s) => s.id === project.activeScenarioId);
  const counts = { moved: diff.filter((x) => x.change === 'moved').length, removed: diff.filter((x) => x.change === 'removed').length, added: diff.filter((x) => x.change === 'added').length };
  const doneCount = plan.steps.filter((s) => live[s.key] === 'moved').length;
  return (
    <div>
      <Section title="Layouts">
        <div className="grid grid-cols-[56px_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
          <span className="text-ink-muted">Current</span>
          <Select ariaLabel="Current layout" value={d.currentId} onValueChange={(v) => setLayouts(v, v === d.targetId ? d.currentId : d.targetId)} options={options} />
          <span className="text-ink-muted">Target</span>
          <Select ariaLabel="Target layout" value={d.targetId} onValueChange={(v) => setLayouts(v === d.currentId ? d.targetId : d.currentId, v)} options={options} />
        </div>
        {!d.designated && <p className="mt-1.5 text-2xs text-ink-faint">Pick the layout that matches your garage today (Current) and the one you want (Target).</p>}
        {viewing && viewing.id !== d.currentId && viewing.id !== d.targetId && (
          <p className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs leading-snug text-ink" data-testid="reorg-viewing-notice">
            You are viewing “{viewing.name}”; this plan compares “{name(d.currentId)}” → “{name(d.targetId)}”.{' '}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-select"
              onClick={() => dispatch({ type: 'scenario.setActive', payload: { scenarioId: d.currentId } })}
              data-testid="reorg-view-current"
            >
              Show “{name(d.currentId)}”
            </button>
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant={overlayOn ? 'default' : 'outline'} onClick={() => uiActions.setOverlay(OVERLAY_KEY, !overlayOn)} aria-pressed={overlayOn} data-testid="before-after-toggle">
            {overlayOn ? <EyeOff /> : <Eye />} {overlayOn ? 'Hide' : 'Show'} before / after
          </Button>
          <Tip content="Swap Current and Target">
            <Button size="sm" variant="ghost" onClick={() => setLayouts(d.targetId, d.currentId)} aria-label="Swap Current and Target">
              <ArrowLeftRight />
            </Button>
          </Tip>
        </div>
        <p className="mt-2 text-2xs text-ink-muted" data-testid="reorg-summary">
          {counts.moved} to move{counts.removed ? ` · ${counts.removed} leave` : ''}
          {counts.added ? ` · ${counts.added} new` : ''} · {plan.totalMoves} physical moves
          {plan.stagedIds.length ? ` (${plan.stagedIds.length} temporary)` : ''}
        </p>
      </Section>
      <Section
        title={`Move plan · ${doneCount}/${plan.steps.length}`}
        actions={
          <Tip content="Print checklist">
            <Button size="icon-sm" variant="ghost" onClick={() => printChecklist(project)} aria-label="Print checklist" data-testid="print-checklist">
              <Printer />
            </Button>
          </Tip>
        }
      >
        {plan.steps.length === 0 ? (
          <p className="text-xs text-ink-muted">The two layouts are identical; nothing to move.</p>
        ) : (
          <>
            {stale && (
              <div className="mb-2 rounded-md border border-select/40 bg-select/10 p-2 text-2xs text-ink">
                You marked progress since this plan was made.
                <Button size="sm" variant="outline" className="mt-1.5 w-full" onClick={() => regenerate(project)} data-testid="regenerate-plan">
                  <RefreshCw /> Regenerate remaining plan
                </Button>
              </div>
            )}
            <ol className="flex flex-col gap-1" aria-label="Move steps">
              {plan.steps.map((s, i) => (
                <StepRow key={s.key} step={s} index={i} status={live[s.key]} highlighted={highlight === s.key} />
              ))}
            </ol>
            {plan.notes.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-2xs text-ink-muted">
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-2xs text-ink-faint">Heavy items are moved once whenever possible; lighter items are staged instead. Weights are estimates unless the object has one.</p>
            {Object.keys(live).length > 0 && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => resetProgress(project)}>
                <RotateCcw /> Reset progress
              </Button>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

sidebarSections.register({ id: 'reorganization', title: 'Reorganize', icon: Truck, order: 84, component: ReorganizePanel });
canvasLayers.register({ id: 'reorganization.before-after', slot: 'overlay', order: 60, component: BeforeAfterLayer, overlay: { key: OVERLAY_KEY, label: 'Before / after', defaultOn: false } });
canvasLayers.register({ id: 'reorganization.step-highlight', slot: 'overlay', order: 61, component: StepHighlightLayer });
canvasOverlays.register({ id: 'reorganization.legend', order: 60, component: BeforeAfterLegend });

paletteCommands.register({ id: 'reorganization.open', title: 'Plan the reorganization (move plan)', section: 'Reorganize', icon: Truck, keywords: ['move', 'checklist', 'before', 'after'], when: (c) => !!c.project, run: () => uiActions.setLeftSection('reorganization') });
paletteCommands.register({
  id: 'reorganization.toggle-overlay',
  title: 'Toggle before / after overlay',
  section: 'Reorganize',
  icon: Eye,
  when: (c) => !!c.project && c.project.scenarios.length > 1,
  run: () => uiActions.toggleOverlay(OVERLAY_KEY),
});
paletteCommands.register({ id: 'reorganization.print', title: 'Print move checklist', section: 'Reorganize', icon: Printer, when: (c) => !!c.project && c.project.scenarios.length > 1, run: (c) => printChecklist(c.project!) });
