/**
 * Shared building blocks for shell contributions: toolbar buttons, panel sections, property rows.
 * Feature panels should use these so the app looks consistent.
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, Tip } from '@/components/ui';
import { shortcutLabel } from '@/app/shell/keyboard';
import { cn } from '@/utils/cn';

export interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  /** Show the label next to the icon. */
  showLabel?: boolean;
  testId?: string;
}

export function ToolbarButton({ icon: Icon, label, shortcut, onClick, active, disabled, showLabel, testId }: ToolbarButtonProps) {
  return (
    <Tip content={label} shortcut={shortcut ? shortcutLabel(shortcut) : undefined}>
      <Button
        variant="ghost"
        size={showLabel ? 'sm' : 'icon-sm'}
        active={active}
        aria-pressed={active}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        data-testid={testId}
        className={cn(active && 'bg-select/20 text-ink ring-1 ring-select/50 ring-inset')}
      >
        <Icon />
        {showLabel && <ToolbarLabel>{label}</ToolbarLabel>}
      </Button>
    </Tip>
  );
}

/**
 * Text label of a toolbar control. Hidden (visually only; tooltips and the accessible name stay)
 * once the toolbar is narrower than ~1,800 px, so the whole chrome fits a 1,280 px laptop without
 * pushing Export/Help off screen. Requires the `@container/toolbar` on the toolbar (TopToolbar).
 */
export function ToolbarLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('@max-[1800px]/toolbar:sr-only', className)}>{children}</span>;
}

/** Panel heading with optional actions on the right. */
export function PanelHeader({ title, actions, className }: { title: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center justify-between border-b border-line px-3', className)}>
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/** Collapsible group inside a panel or inspector. */
export function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center gap-1 px-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left panel-heading hover:text-ink-muted"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

/** A label/value row for property grids. */
export function PropRow({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    // Rows inside a two-column grid size their label to its content so values are not truncated.
    <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-0.5 [.grid-cols-2>&]:grid-cols-[auto_minmax(0,1fr)] [.grid-cols-2>&]:gap-1.5">
      <label htmlFor={htmlFor} className="truncate text-xs text-ink-muted">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
