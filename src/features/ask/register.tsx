/**
 * "Ask the Layout": type a question, get an answer computed from the plan's geometry with the key
 * numbers and a highlight on the canvas. Also hosts the shared highlight / preview-ghost layers.
 */
import { MessageCircleQuestion, Crosshair, X } from 'lucide-react';
import { useState } from 'react';
import { canvasLayers, paletteCommands, sidebarSections } from '@/app/registry';
import { fitBoxToView } from '@/app/canvas/PlanCanvas';
import { Button, Input } from '@/components/ui';
import { bbox, type Point } from '@/geometry';
import { useProjectStore } from '@/stores/projectStore';
import { uiActions } from '@/stores/uiStore';
import { ask, ASK_EXAMPLES, type Answer, type AskResult } from './answers';
import { clearHighlight, IntelHighlightLayer, PreviewGhostsLayer, showHighlight } from './overlays';

canvasLayers.register({ id: 'intel-highlight', slot: 'overlay', order: 60, component: IntelHighlightLayer });
canvasLayers.register({ id: 'intel-ghosts', slot: 'overlay', order: 61, component: PreviewGhostsLayer });

function highlightAnswer(a: Answer, zoom: boolean): void {
  const h = a.highlight;
  showHighlight({ source: 'ask', polygons: h.polygons, points: h.points, lines: h.lines, label: a.numbers[0]?.value });
  if (h.refs.length) uiActions.select(h.refs.filter((r) => r.kind === 'object' || r.kind === 'vehicle' || r.kind === 'feature'));
  if (!zoom) return;
  const pts: Point[] = [...h.points, ...h.polygons.flat(), ...h.lines.flat()];
  if (pts.length) {
    const b = bbox(pts);
    fitBoxToView({ minX: b.minX - 1200, minY: b.minY - 1200, maxX: b.maxX + 1200, maxY: b.maxY + 1200 });
  }
}

interface Entry {
  id: number;
  result: AskResult;
  question: string;
}

let seq = 0;

function AskPanel() {
  const project = useProjectStore((s) => s.project);
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  if (!project) return null;
  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const p = useProjectStore.getState().project!;
    const result = ask(t, p);
    setEntries((e) => [{ id: ++seq, result, question: t }, ...e].slice(0, 12));
    if (result.ok) highlightAnswer(result.answer, false);
    setQ('');
  };
  return (
    <div className="p-3" data-testid="ask-panel">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What is the narrowest walkway?" aria-label="Ask a question about the layout" data-testid="ask-input" />
        <Button type="submit" size="sm" disabled={!q.trim()} data-testid="ask-submit">
          Ask
        </Button>
      </form>
      <p className="mt-1.5 text-2xs text-ink-faint">Answers are measured from this layout's geometry; nothing is guessed.</p>
      {entries.length === 0 && (
        <div className="mt-3">
          <div className="panel-heading mb-1">Try</div>
          <ul className="space-y-1">
            {ASK_EXAMPLES.map((ex) => (
              <li key={ex}>
                <button type="button" className="text-left text-xs text-select hover:underline" onClick={() => submit(ex)}>
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-line bg-panel-2 p-2.5" data-testid="ask-answer">
            <div className="flex items-start justify-between gap-2">
              <p className="text-2xs text-ink-faint">{e.question}</p>
              <button type="button" aria-label="Remove answer" className="text-ink-faint hover:text-ink" onClick={() => setEntries((x) => x.filter((y) => y.id !== e.id))}>
                <X className="size-3" />
              </button>
            </div>
            {e.result.ok ? (
              <AnswerCard a={e.result.answer} />
            ) : (
              <div className="mt-1">
                <p className="text-xs text-ink">{e.result.reason}</p>
                <ul className="mt-1 space-y-0.5">
                  {e.result.suggestions.map((s) => (
                    <li key={s}>
                      <button type="button" className="text-left text-xs text-select hover:underline" onClick={() => submit(s)}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerCard({ a }: { a: Answer }) {
  const [more, setMore] = useState(false);
  const hasHighlight = a.highlight.points.length + a.highlight.polygons.length + a.highlight.lines.length + a.highlight.refs.length > 0;
  return (
    <div className="mt-1">
      <p className="text-[13px] leading-snug text-ink" data-testid="ask-answer-text">
        {a.text}
      </p>
      {a.numbers.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {a.numbers.map((n) => (
            <div key={n.label} className="contents">
              <dt className="text-ink-muted">{n.label}</dt>
              <dd className="num text-ink">{n.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.details.length > 0 && (
        <>
          <button type="button" className="mt-1.5 text-2xs text-select hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Hide details' : `Details (${a.details.length})`}
          </button>
          {more && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-2xs text-ink-muted">
              {a.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {hasHighlight && (
        <div className="mt-2 flex gap-1">
          <Button size="sm" variant="outline" onClick={() => highlightAnswer(a, true)}>
            <Crosshair /> Show on plan
          </Button>
          <Button size="sm" variant="ghost" onClick={() => clearHighlight('ask')}>
            Clear
          </Button>
        </div>
      )}
    </div>
  );
}

sidebarSections.register({ id: 'ask', title: 'Ask the Layout', icon: MessageCircleQuestion, order: 100, component: AskPanel });
paletteCommands.register({
  id: 'ask.open',
  title: 'Ask the Layout…',
  section: 'Analysis',
  icon: MessageCircleQuestion,
  keywords: ['question', 'narrowest', 'walkway', 'how much', 'can I', 'which'],
  when: (c) => !!c.project,
  run: () => uiActions.setLeftSection('ask'),
});
