/**
 * Small primitives: tooltip, tabs, slider, switch, select, popover, separator, scroll area,
 * kbd, badge, empty state.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';

// ───────────── tooltip ─────────────
export const TooltipProvider = TooltipPrimitive.Provider;

export interface TipProps {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactElement;
}

/** Tooltip wrapper: `<Tip content="Undo" shortcut="⌘Z"><Button …/></Tip>`. */
export function Tip({ content, shortcut, side = 'bottom', children }: TipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] flex max-w-72 items-center gap-2 rounded-md border border-line-strong bg-panel-3 px-2 py-1 text-xs text-ink shadow-lg animate-fade-in"
        >
          <span>{content}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ───────────── tabs ─────────────
export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => <TabsPrimitive.List ref={ref} className={cn('flex gap-0.5 border-b border-line px-2', className)} {...props} />,
);
TabsList.displayName = 'TabsList';
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        '-mb-px h-8 border-b-2 border-transparent px-2 text-xs font-medium text-ink-muted hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = 'TabsTrigger';
export const TabsContent = TabsPrimitive.Content;

// ───────────── slider ─────────────
export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SliderPrimitive.Root ref={ref} className={cn('relative flex h-4 w-full touch-none select-none items-center', className)} {...props}>
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-line-strong">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb key={i} className="block size-3.5 rounded-full border-2 border-accent bg-panel shadow focus-visible:outline-2 focus-visible:outline-select" />
      ))}
    </SliderPrimitive.Root>
  ),
);
Slider.displayName = 'Slider';

// ───────────── switch ─────────────
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-line-strong bg-panel-3 transition-colors data-[state=checked]:border-select data-[state=checked]:bg-select disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-ink shadow transition-transform data-[state=checked]:translate-x-3" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = 'Switch';

// ───────────── select ─────────────
export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export function Select({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
  disabled,
}: {
  value: string;
  onValueChange(v: string): void;
  options: readonly SelectOption[];
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex h-7 w-full items-center justify-between gap-1 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-ink outline-none hover:border-line-strong focus:border-select disabled:opacity-50',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 text-ink-faint" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-[60] min-w-[var(--radix-select-trigger-width)] rounded-md border border-line-strong bg-panel-2 p-1 shadow-xl animate-pop-in">
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex h-7 select-none items-center rounded-sm pl-6 pr-2 text-[13px] outline-none data-[highlighted]:bg-select/25"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5">
                  <Check className="size-3.5 text-select" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

// ───────────── popover ─────────────
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = React.forwardRef<React.ElementRef<typeof PopoverPrimitive.Content>, React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
  ({ className, sideOffset = 6, ...props }, ref) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 w-72 rounded-md border border-line-strong bg-panel-2 p-3 text-[13px] shadow-xl shadow-black/40 animate-pop-in', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';

// ───────────── separator / scroll ─────────────
export function Separator({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn('shrink-0 bg-line', orientation === 'horizontal' ? 'h-px w-full' : 'mx-1 h-5 w-px', className)}
    />
  );
}

export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className="size-full [&>div]:!block">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-0.5">
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-line-strong" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

// ───────────── kbd / badge / empty state ─────────────
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('num rounded border border-line-strong bg-panel px-1 text-2xs text-ink-muted', className)}>{children}</kbd>;
}

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'ok' | 'info' | 'accent'; className?: string }) {
  const tones = {
    neutral: 'bg-panel-3 text-ink-muted',
    warn: 'bg-warn/15 text-warn',
    danger: 'bg-danger/15 text-danger',
    ok: 'bg-ok/15 text-ok',
    info: 'bg-info/15 text-info',
    accent: 'bg-accent/15 text-accent',
  } as const;
  return <span className={cn('inline-flex h-4.5 items-center gap-1 rounded px-1.5 text-2xs font-medium', tones[tone], className)}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      {icon && <div className="text-ink-faint [&_svg]:size-6">{icon}</div>}
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {children && <div className="max-w-64 text-xs text-ink-muted">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
