import { AlertCircle } from 'lucide-react';
import { useEffect } from 'react';
import { statusBarItems } from '@/app/registry';
import { useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';

/** Transient status line: last command refusal (e.g. "…is locked") or a flashed message. */
function StatusMessage() {
  const lastError = useProjectStore((s) => s.lastError);
  const status = useUiStore((s) => s.status);
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => uiActions.clearStatus(), 4000);
    return () => clearTimeout(t);
  }, [status]);
  const text = lastError ?? status?.text;
  if (!text) return null;
  const tone = lastError ? 'error' : status?.tone;
  return (
    <span role="status" className={cn('flex min-w-0 items-center gap-1 truncate', tone === 'error' ? 'text-danger' : tone === 'warning' ? 'text-warn' : 'text-ink-muted')}>
      {tone === 'error' && <AlertCircle className="size-3 shrink-0" />}
      <span className="truncate">{text}</span>
    </span>
  );
}

export function StatusBar() {
  const items = statusBarItems.useItems();
  return (
    <footer className="flex items-center gap-4 border-t border-line bg-panel px-3 text-2xs text-ink-muted" aria-label="Status bar">
      {items
        .filter((i) => i.align === 'left')
        .map((i) => (
          <i.component key={i.id} />
        ))}
      <StatusMessage />
      <div className="ml-auto flex items-center gap-4">
        {items
          .filter((i) => i.align === 'right')
          .map((i) => (
            <i.component key={i.id} />
          ))}
      </div>
    </footer>
  );
}
