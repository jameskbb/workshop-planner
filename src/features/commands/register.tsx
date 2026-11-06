/**
 * Natural-language command bar ( / or the toolbar "Command" button, also in the Ctrl/Cmd+K
 * palette). As you type, the instruction is parsed into typed commands and the result is previewed
 * (a sentence + ghost outlines on the plan). Enter runs it through the command bus as ONE undoable
 * step. Unclear or ambiguous input gets "try …" suggestions and clickable choices.
 */
import { CornerDownLeft, TerminalSquare, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { paletteCommands, shellExtras, shortcuts, toolbarItems } from '@/app/registry';
import { useCustomLibrary } from '@/app/services';
import { fitBoxToView } from '@/app/canvas/PlanCanvas';
import { ToolbarButton } from '@/components/shell';
import { Button, Kbd } from '@/components/ui';
import { bbox, type Point } from '@/geometry';
import { transact, undo, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { newId } from '@/utils/id';
import { cn } from '@/utils/cn';
import { BUILTIN_OBJECTS } from '@/features/objects/library';
import { clearGhosts, showGhosts, showHighlight } from '@/features/ask/overlays';
import { EXAMPLES, type NlResult, type UiAction } from './nl/interpret';
import { grammarProvider } from './nl/provider';

export const useCommandBar = create<{ open: boolean; text: string; history: string[] }>()(() => ({ open: false, text: '', history: [] }));

export function openCommandBar(text = ''): void {
  useCommandBar.setState({ open: true, text });
}

function closeBar(): void {
  useCommandBar.setState({ open: false, text: '' });
  clearGhosts('nl');
}

function interpretNow(text: string): NlResult | null {
  const project = useProjectStore.getState().project;
  if (!project || !text.trim()) return null;
  // Ids are drawn fresh per parse; the executed commands carry them, so replay/undo is exact.
  const r = grammarProvider.interpret(text, {
    project,
    selection: useUiStore.getState().selection,
    library: [...useCustomLibrary.getState().definitions, ...BUILTIN_OBJECTS],
    newId,
  });
  return r instanceof Promise ? null : r;
}

function applyActions(actions: UiAction[]): void {
  for (const a of actions) {
    if (a.type === 'select') {
      uiActions.select(a.refs);
      if (a.zoom && a.refs.length) uiActions.flash(`Selected ${a.refs.length} item${a.refs.length === 1 ? '' : 's'}.`);
    } else if (a.type === 'highlight') {
      showHighlight({ source: 'nl', polygons: a.polygons, points: [], lines: [] });
      const pts: Point[] = a.polygons.flat();
      if (pts.length) {
        const b = bbox(pts);
        fitBoxToView({ minX: b.minX - 900, minY: b.minY - 900, maxX: b.maxX + 900, maxY: b.maxY + 900 });
      }
    } else if (a.type === 'overlay') uiActions.setOverlay(a.key, a.on);
  }
}

/** Execute a parse result. Returns a status line. */
export function runResult(r: NlResult): { ok: boolean; message: string } {
  if (!r.ok) return { ok: false, message: r.reason };
  if (r.kind === 'action') {
    applyActions(r.actions);
    return { ok: true, message: r.summary };
  }
  const res = transact(r.label, r.commands);
  if (!res.ok) return { ok: false, message: res.error };
  if (r.select) uiActions.select(r.select);
  return { ok: true, message: `${r.summary} (Ctrl/Cmd+Z to undo)` };
}

function CommandBar() {
  const { open, text, history } = useCommandBar();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [histIdx, setHistIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const result = useMemo(() => (open ? interpretNow(text) : null), [open, text, project, selection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setStatus(null);
  }, [open]);

  // Live preview: ghosts where things would go.
  useEffect(() => {
    if (!open || !result || !result.ok) return clearGhosts('nl');
    const ghosts = (result.ghosts ?? []).map((polygon) => ({ polygon }));
    if (ghosts.length) showGhosts({ source: 'nl', ghosts, arrows: [] });
    else clearGhosts('nl');
  }, [open, result]);

  if (!open) return null;
  const setText = (t: string) => {
    useCommandBar.setState({ text: t });
    setStatus(null);
  };
  const execute = (r: NlResult | null = result) => {
    if (!r) return;
    const out = runResult(r);
    setStatus(out);
    if (out.ok) {
      useCommandBar.setState((s) => ({ text: '', history: [text, ...s.history.filter((h) => h !== text)].slice(0, 20) }));
      clearGhosts('nl');
      setHistIdx(-1);
    }
  };

  return (
    <div className="fixed bottom-10 left-1/2 z-40 w-[min(92vw,620px)] -translate-x-1/2 rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/50" role="dialog" aria-label="Command bar" data-testid="command-bar">
      <form
        className="flex items-center gap-2 border-b border-line px-3"
        onSubmit={(e) => {
          e.preventDefault();
          execute();
        }}
      >
        <TerminalSquare className="size-4 text-ink-faint" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              closeBar();
            } else if (e.key === 'ArrowUp' && history.length) {
              e.preventDefault();
              const i = Math.min(history.length - 1, histIdx + 1);
              setHistIdx(i);
              setText(history[i]!);
            } else if (e.key === 'ArrowDown' && histIdx >= 0) {
              e.preventDefault();
              const i = histIdx - 1;
              setHistIdx(i);
              setText(i >= 0 ? history[i]! : '');
            }
          }}
          placeholder='Tell the plan what to do, e.g. "Move the workbench against the north wall"'
          aria-label="Command"
          className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          data-testid="command-input"
        />
        <Button type="submit" size="sm" disabled={!result || !result.ok} data-testid="command-run">
          <CornerDownLeft /> Run
        </Button>
      </form>
      <div className="px-3 py-2.5 text-[13px]" aria-live="polite">
        {status ? (
          <div className="flex items-start justify-between gap-2" data-testid="command-status">
            <p className={cn(status.ok ? 'text-ink' : 'text-danger')}>
              {status.ok ? '✓ ' : '✕ '}
              {status.message}
            </p>
            {status.ok && (
              <Button size="sm" variant="ghost" onClick={() => undo() && setStatus({ ok: true, message: 'Undone.' })} data-testid="command-undo">
                <Undo2 /> Undo
              </Button>
            )}
          </div>
        ) : !text.trim() ? (
          <div>
            <p className="text-2xs text-ink-faint">Examples (click to fill in):</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {EXAMPLES.slice(0, 9).map((ex) => (
                <button key={ex} type="button" onClick={() => setText(ex)} className="rounded border border-line px-1.5 py-0.5 text-2xs text-ink-muted hover:border-line-strong hover:text-ink">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : result?.ok ? (
          <div data-testid="command-preview">
            <p className="text-ink">
              <span className="mr-1.5 rounded bg-select/20 px-1 text-2xs font-semibold uppercase tracking-wide text-select">{result.kind === 'commands' ? 'Will do' : 'Will show'}</span>
              {result.summary}
            </p>
            <p className="mt-1 text-2xs text-ink-faint">
              Press <Kbd>Enter</Kbd> to run{result.kind === 'commands' ? ' as one undoable step' : ''}. <Kbd>Esc</Kbd> closes.
            </p>
          </div>
        ) : result ? (
          <div data-testid="command-problem">
            <p className="text-ink">{result.reason}</p>
            {result.choices && result.choices.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {result.choices.map((c) => (
                  <Button key={c.text} size="sm" variant="outline" onClick={() => setText(c.text)}>
                    {c.label}
                  </Button>
                ))}
              </div>
            )}
            {result.suggestions.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {result.suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" className="text-left text-xs text-select hover:underline" onClick={() => setText(s)}>
                      Try: {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

shellExtras.register({ id: 'commands.bar', component: CommandBar });
toolbarItems.register({
  id: 'commands.open',
  group: 'right',
  order: 15,
  component: () => <ToolbarButton icon={TerminalSquare} label="Command (type an instruction)" shortcut="/" onClick={() => openCommandBar()} testId="open-command-bar" />,
});
shortcuts.register({ id: 'commands.open', keys: '/', description: 'Type a command in plain English', when: () => !!useProjectStore.getState().project, run: () => openCommandBar() });
paletteCommands.register({
  id: 'commands.open',
  title: 'Type a command in plain English…',
  section: 'Commands',
  icon: TerminalSquare,
  shortcut: '/',
  keywords: ['natural language', 'instruction', 'move', 'rotate', 'hide', 'duplicate', 'give', 'put', 'nl'],
  when: (c) => !!c.project,
  run: () => openCommandBar(),
});
for (const ex of EXAMPLES.slice(0, 8)) {
  paletteCommands.register({
    id: `commands.example.${ex}`,
    title: `“${ex}”`,
    section: 'Commands',
    icon: TerminalSquare,
    keywords: ['command', 'instruction'],
    when: (c) => !!c.project,
    run: () => openCommandBar(ex),
  });
}
