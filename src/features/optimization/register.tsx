/**
 * Smart Layout Assistant panel: priority sliders → "Suggest Layouts" (runs in a Web Worker with
 * progress and Cancel) → labeled candidates with a transparent metric breakdown, a ghost preview
 * on the plan, and "Create layout" which adds a NEW layout. The active layout is never modified.
 */
import { Ban, Eye, EyeOff, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { paletteCommands, sidebarSections } from '@/app/registry';
import { Section } from '@/components/shell';
import { Badge, Button, Select, Slider, Tip } from '@/components/ui';
import { defineExtension } from '@/domain/extensions';
import { getScenario, objectFootprint, resolveObject, vehicleGeomSpec } from '@/domain/resolve';
import type { Project } from '@/domain/schema';
import { vehicleBody } from '@/geometry';
import { dispatch, transact, useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { clearGhosts, showGhosts, type Ghost } from '@/features/ask/overlays';
import { aisleWidthOf } from '@/features/walkability/model';
import { buildAnalysisContext } from '@/analysis';
import { uniqueName } from '@/features/scenarios/manager';
import { runAssistant, type AssistantResult, type EvaluatedCandidate } from './evaluate';
import { applyCandidate, candidateCommands, DEFAULT_PRIORITIES, PRIORITY_INFO, PRIORITY_KEYS, TERM_INFO, type Priorities } from './optimizer';
import type { WorkerMessage, WorkerRequest } from './optimizer.worker';

export const assistantPrefs = defineExtension(
  'optimization.priorities',
  z.object({ priorities: z.record(z.string(), z.number().min(0).max(10)), effort: z.enum(['quick', 'normal', 'thorough']).default('normal') }),
  { priorities: { ...DEFAULT_PRIORITIES }, effort: 'normal' as const },
);

const EFFORT = { quick: 600, normal: 1500, thorough: 4000 } as const;

interface AssistantState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: number;
  message: string;
  sourceId: string | null;
  result: AssistantResult | null;
  preview: string | null;
  error: string | null;
}

export const useAssistant = create<AssistantState>()(() => ({ status: 'idle', progress: 0, message: '', sourceId: null, result: null, preview: null, error: null }));

let worker: Worker | null = null;

function prioritiesOf(project: Project): Priorities {
  const stored = assistantPrefs.read(project).priorities;
  return Object.fromEntries(PRIORITY_KEYS.map((k) => [k, stored[k] ?? DEFAULT_PRIORITIES[k]])) as Priorities;
}

export function suggestLayouts(): void {
  const project = useProjectStore.getState().project;
  if (!project) return;
  cancelSuggest(false);
  const scenarioId = project.activeScenarioId;
  const prefs = assistantPrefs.read(project);
  const req: WorkerRequest = {
    project,
    scenarioId,
    options: { priorities: prioritiesOf(project), iterations: EFFORT[prefs.effort], seed: 1, aisleWidth: aisleWidthOf(buildAnalysisContext(project, scenarioId)) },
  };
  useAssistant.setState({ status: 'running', progress: 0, message: 'Starting…', sourceId: scenarioId, result: null, preview: null, error: null });
  const done = (result: AssistantResult) => useAssistant.setState({ status: 'done', progress: 1, message: '', result });
  const fail = (message: string) => useAssistant.setState({ status: 'error', error: message });
  if (typeof Worker === 'undefined') {
    setTimeout(() => {
      try {
        done(runAssistant(req.project, req.scenarioId, req.options, { onProgress: (f, m) => useAssistant.setState({ progress: f, message: m }) }));
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    }, 0);
    return;
  }
  worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === 'progress') useAssistant.setState({ progress: m.fraction, message: m.message });
    else if (m.type === 'done') {
      done(m.result);
      worker?.terminate();
      worker = null;
    } else {
      fail(m.message);
      worker?.terminate();
      worker = null;
    }
  };
  worker.onerror = (e) => {
    fail(e.message || 'The optimizer stopped unexpectedly.');
    worker?.terminate();
    worker = null;
  };
  worker.postMessage(req);
}

export function cancelSuggest(announce = true): void {
  if (worker) {
    worker.terminate();
    worker = null;
    useAssistant.setState({ status: 'idle', progress: 0, message: '' });
    if (announce) uiActions.flash('Layout suggestions cancelled.');
  }
}

function previewCandidate(project: Project, sourceId: string, c: EvaluatedCandidate | null): void {
  if (!c) {
    clearGhosts('assistant');
    useAssistant.setState({ preview: null });
    return;
  }
  const src = getScenario(project, sourceId);
  const next = applyCandidate(src, c);
  const ghosts: Ghost[] = [];
  const arrows: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
  const moved = new Set([...c.objects.map((o) => o.id), ...c.working.map((o) => o.id)]);
  for (const o of next.objects) {
    if (!moved.has(o.id) || o.hidden) continue;
    const before = src.objects.find((x) => x.id === o.id)!;
    const r = resolveObject(project, { ...o, activePosition: 'parked' });
    ghosts.push({ polygon: objectFootprint(r), label: o.label ?? o.name });
    if (Math.hypot(before.x - o.x, before.y - o.y) > 50) arrows.push([{ x: before.x, y: before.y }, { x: o.x, y: o.y }]);
    if (o.working && c.working.some((w) => w.id === o.id)) ghosts.push({ polygon: objectFootprint(r, o.working), label: `${o.name} (working)`, secondary: true });
  }
  for (const v of next.vehicles) {
    if (!c.vehicles.some((x) => x.id === v.id)) continue;
    const before = src.vehicles.find((x) => x.id === v.id)!;
    ghosts.push({ polygon: vehicleBody(vehicleGeomSpec(v), { x: v.x, y: v.y, rotation: v.rotation }), label: v.name });
    arrows.push([{ x: before.x, y: before.y }, { x: v.x, y: v.y }]);
  }
  showGhosts({ source: 'assistant', ghosts, arrows });
  useAssistant.setState({ preview: c.kind });
}

function createLayout(project: Project, sourceId: string, c: EvaluatedCandidate): void {
  const src = getScenario(project, sourceId);
  const id = newId();
  const name = uniqueName(`${src.name} (${c.label})`, project.scenarios.map((s) => s.name));
  const r = transact(`Create layout "${name}"`, candidateCommands(sourceId, c, id, name));
  if (!r.ok) {
    uiActions.flash(r.error, 'error');
    return;
  }
  clearGhosts('assistant');
  useAssistant.setState({ preview: null });
  uiActions.flash(`Created layout "${name}". "${src.name}" is unchanged; switch back any time.`);
}

function PriorityRow({ k, value, onChange }: { k: (typeof PRIORITY_KEYS)[number]; value: number; onChange(v: number): void }) {
  const info = PRIORITY_INFO[k];
  return (
    <div className="py-1">
      <div className="flex items-center justify-between text-xs">
        <Tip content={info.hint}>
          <span className="text-ink">{info.label}</span>
        </Tip>
        <span className="num text-ink-muted">{value}</span>
      </div>
      <Slider className="mt-1" min={0} max={10} step={1} value={[value]} onValueChange={(v) => onChange(v[0] ?? 0)} aria-label={`${info.label} priority`} />
    </div>
  );
}

function MetricDiff({ current, c }: { current: EvaluatedCandidate['metrics']; c: EvaluatedCandidate }) {
  return (
    <ul className="mt-1.5 space-y-0.5 text-2xs">
      {c.metrics.map((m) => {
        const before = current.find((x) => x.id === m.id);
        const b = before?.value;
        const a = m.value;
        const better = typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 1e-6 ? (m.better === 'higher' ? a > b : a < b) : null;
        return (
          <li key={m.id} title={m.explanation} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-ink-muted">{m.label}</span>
            <span className="num shrink-0 whitespace-nowrap text-ink-faint">{before?.display ?? 'n/a'}</span>
            <span className="shrink-0 text-ink-faint">→</span>
            <span className={cn('num shrink-0 whitespace-nowrap', better === true ? 'text-ok' : better === false ? 'text-warn' : 'text-ink')}>
              {m.display}
              {better === true ? ' ▲' : better === false ? ' ▼' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CandidateCard({ c, current, project, sourceId }: { c: EvaluatedCandidate; current: EvaluatedCandidate['metrics']; project: Project; sourceId: string }) {
  const preview = useAssistant((s) => s.preview === c.kind);
  const [terms, setTerms] = useState(false);
  const moved = c.objects.length + c.vehicles.length;
  return (
    <li className={cn('rounded-md border p-2.5', preview ? 'border-select bg-select/10' : 'border-line bg-panel-2')} data-testid="assistant-candidate">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink">{c.label}</div>
          <div className="text-2xs text-ink-faint">{c.description}</div>
        </div>
        {c.valid ? <Badge tone="ok">valid</Badge> : <Badge tone="danger">invalid</Badge>}
      </div>
      <p className="mt-1 text-2xs text-ink-muted">
        Moves {moved} item{moved === 1 ? '' : 's'}
        {c.working.length ? `, ${c.working.length} new working position${c.working.length === 1 ? '' : 's'}` : ''}. Locked items stay put.
      </p>
      {!c.valid && (
        <p className="mt-1 flex gap-1 text-2xs text-danger">
          <TriangleAlert className="size-3 shrink-0" /> {[...c.problems, ...c.critical][0] ?? 'No valid arrangement was found.'}
        </p>
      )}
      <MetricDiff current={current} c={c} />
      <button type="button" className="mt-1 text-2xs text-select hover:underline" onClick={() => setTerms((t) => !t)} aria-expanded={terms}>
        {terms ? 'Hide' : 'Show'} what the optimizer weighed
      </button>
      {terms && (
        <ul className="mt-1 space-y-0.5 text-2xs text-ink-muted">
          {c.terms
            .filter((t) => t.weight > 0)
            .map((t) => (
              <li key={t.key} title={TERM_INFO[t.key].unit}>
                {t.label}: {(t.before * 100).toFixed(0)}% → {(t.after * 100).toFixed(0)}% <span className="text-ink-faint">(weight {t.weight.toFixed(2)})</span>
              </li>
            ))}
        </ul>
      )}
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" variant="outline" onClick={() => previewCandidate(project, sourceId, preview ? null : c)} data-testid="assistant-preview">
          {preview ? <EyeOff /> : <Eye />} {preview ? 'Hide preview' : 'Preview'}
        </Button>
        <Button size="sm" variant="primary" disabled={!c.valid} onClick={() => createLayout(project, sourceId, c)} data-testid="assistant-create">
          <Plus /> Create layout
        </Button>
      </div>
    </li>
  );
}

function AssistantPanel() {
  const project = useProjectStore((s) => s.project);
  const st = useAssistant();
  useEffect(() => () => clearGhosts('assistant'), []);
  if (!project) return null;
  const prefs = assistantPrefs.read(project);
  const pr = prioritiesOf(project);
  const save = (next: Partial<{ priorities: Priorities; effort: 'quick' | 'normal' | 'thorough' }>) =>
    dispatch({ type: 'extension.set', payload: { target: 'project', key: assistantPrefs.key, value: { ...prefs, ...next }, label: 'Change assistant priorities', history: false } });
  const source = st.sourceId ? project.scenarios.find((s) => s.id === st.sourceId) : undefined;
  return (
    <div data-testid="assistant-panel">
      <Section title="Priorities">
        {PRIORITY_KEYS.map((k) => (
          <PriorityRow key={k} k={k} value={pr[k]} onChange={(v) => save({ priorities: { ...pr, [k]: v } })} />
        ))}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-muted">Search effort</span>
          <div className="w-28">
            <Select ariaLabel="Search effort" value={prefs.effort} onValueChange={(v) => save({ effort: v as 'quick' | 'normal' | 'thorough' })} options={[{ value: 'quick', label: 'Quick' }, { value: 'normal', label: 'Normal' }, { value: 'thorough', label: 'Thorough' }]} className="h-6 text-2xs" />
          </div>
        </div>
        <Button className="mt-3 w-full" variant="primary" disabled={st.status === 'running'} onClick={suggestLayouts} data-testid="suggest-layouts">
          <Sparkles /> Suggest Layouts
        </Button>
        <p className="mt-1.5 text-2xs text-ink-faint">Suggestions become new layouts only when you choose one. Your current layout is never changed. Locked items never move.</p>
      </Section>
      {st.status === 'running' && (
        <div className="border-b border-line px-3 py-3" role="status" aria-live="polite" data-testid="assistant-progress">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{st.message}</span>
            <span className="num">{Math.round(st.progress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-3">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(st.progress * 100)}%` }} />
          </div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => cancelSuggest()} data-testid="assistant-cancel">
            <Ban /> Cancel
          </Button>
        </div>
      )}
      {st.status === 'error' && <p className="px-3 py-3 text-xs text-danger">The assistant failed: {st.error}</p>}
      {st.status === 'done' && st.result && source && (
        <Section title={`Suggestions for “${source.name}”`}>
          {st.sourceId !== project.activeScenarioId && <p className="mb-2 text-2xs text-warn">These were computed for “{source.name}”, not the layout you are viewing.</p>}
          {st.result.candidates.length === 0 && (
            <p className="text-xs text-ink-muted">
              The assistant could not find an arrangement that keeps everything legal in this layout: every attempt left something overlapping or outside the room. Try unlocking an item, moving one thing
              by hand, or raising the effort.
            </p>
          )}
          <ul className="space-y-2">
            {st.result.candidates.map((c) => (
              <CandidateCard key={c.kind} c={c} current={st.result!.current} project={project} sourceId={source.id} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

sidebarSections.register({ id: 'assistant', title: 'Layout assistant', icon: Sparkles, order: 102, component: AssistantPanel });
paletteCommands.register({
  id: 'assistant.suggest',
  title: 'Suggest Layouts',
  section: 'Analysis',
  icon: Sparkles,
  keywords: ['optimize', 'assistant', 'smart', 'arrange', 'auto'],
  when: (c) => !!c.project,
  run: () => {
    uiActions.setLeftSection('assistant');
    suggestLayouts();
  },
});
