import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { paletteCommands, type PaletteCommand, type PaletteContext } from '@/app/registry';
import { Kbd } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { shortcutLabel } from './keyboard';

/** Score a command against the query: every word must match; earlier/title matches rank higher. */
export function scoreCommand(c: Pick<PaletteCommand, 'title' | 'section' | 'keywords'>, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const title = c.title.toLowerCase();
  const hay = `${title} ${c.section.toLowerCase()} ${(c.keywords ?? []).join(' ').toLowerCase()}`;
  let score = 0;
  for (const w of q.split(/\s+/)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    score += title.startsWith(w) ? 5 : title.includes(w) ? 3 : 1;
  }
  return score;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const commands = paletteCommands.useItems();
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const ctx: PaletteContext = useMemo(() => ({ project, selection }), [project, selection]);

  const results = useMemo(() => {
    return commands
      .filter((c) => !c.when || c.when(ctx))
      .map((c) => ({ c, s: scoreCommand(c, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.section.localeCompare(b.c.section) || (a.c.order ?? 100) - (b.c.order ?? 100))
      .map((x) => x.c)
      .slice(0, 50);
  }, [commands, ctx, query]);

  const close = () => {
    uiActions.setCommandPaletteOpen(false);
    setQuery('');
    setIndex(0);
  };
  const run = (c: PaletteCommand) => {
    close();
    // Let the dialog close before running (commands may open their own dialogs).
    setTimeout(() => c.run(ctx), 0);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (o ? uiActions.setCommandPaletteOpen(true) : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 animate-fade-in" />
        <DialogPrimitive.Content
          aria-label="Command palette"
          className="fixed left-1/2 top-[14vh] z-50 w-[min(92vw,560px)] -translate-x-1/2 overflow-hidden rounded-lg border border-line-strong bg-panel shadow-2xl shadow-black/60 animate-pop-in"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-ink-faint" />
            <input
              autoFocus
              value={query}
              placeholder="Type a command…"
              aria-label="Search commands"
              className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIndex((i) => Math.min(results.length - 1, i + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && results[index]) {
                  e.preventDefault();
                  run(results[index]);
                }
              }}
            />
            <Kbd>Esc</Kbd>
          </div>
          <ul role="listbox" className="scroll-thin max-h-[50vh] overflow-y-auto p-1">
            {results.length === 0 && <li className="px-3 py-6 text-center text-xs text-ink-muted">No matching commands.</li>}
            {results.map((c, i) => {
              const Icon = c.icon;
              return (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => run(c)}
                  className={cn('flex h-8 cursor-default items-center gap-2 rounded px-2 text-[13px]', i === index && 'bg-select/25')}
                >
                  {Icon ? <Icon className="size-3.5 text-ink-muted" /> : <span className="size-3.5" />}
                  <span className="text-ink">{c.title}</span>
                  <span className="text-xs text-ink-faint">{c.section}</span>
                  {c.shortcut && <Kbd className="ml-auto">{shortcutLabel(c.shortcut)}</Kbd>}
                </li>
              );
            })}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
