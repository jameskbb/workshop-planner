/**
 * Dropdown and context menus (Radix) sharing one visual style.
 */
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';

const menuContent =
  'z-50 min-w-44 overflow-hidden rounded-md border border-line-strong bg-panel-2 p-1 text-[13px] text-ink shadow-xl shadow-black/40 animate-pop-in';
const menuItem =
  'relative flex h-7 select-none items-center gap-2 rounded-sm px-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-select/25 [&_svg]:size-3.5 [&_svg]:text-ink-muted';

// ───────────── dropdown ─────────────
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn(menuContent, className)} {...props} />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { shortcut?: string; destructive?: boolean }
>(({ className, shortcut, destructive, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref} className={cn(menuItem, destructive && 'text-danger', className)} {...props}>
    {children}
    {shortcut && <span className="num ml-auto pl-4 text-2xs text-ink-faint">{shortcut}</span>}
  </DropdownMenuPrimitive.Item>
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(menuItem, 'pl-7', className)} {...props}>
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="!text-select" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel-heading px-2 pb-1 pt-1.5', className)} {...props} />;
}
export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} />;
}
export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger ref={ref} className={cn(menuItem, 'data-[state=open]:bg-select/20', className)} {...props}>
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger';
export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.SubContent ref={ref} className={cn(menuContent, className)} {...props} />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent';

// ───────────── context menu ─────────────
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content ref={ref} className={cn(menuContent, className)} {...props} />
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = 'ContextMenuContent';

export const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & { shortcut?: string; destructive?: boolean }
>(({ className, shortcut, destructive, children, ...props }, ref) => (
  <ContextMenuPrimitive.Item ref={ref} className={cn(menuItem, destructive && 'text-danger', className)} {...props}>
    {children}
    {shortcut && <span className="num ml-auto pl-4 text-2xs text-ink-faint">{shortcut}</span>}
  </ContextMenuPrimitive.Item>
));
ContextMenuItem.displayName = 'ContextMenuItem';

export function ContextMenuSeparator() {
  return <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-line" />;
}
export function ContextMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('panel-heading truncate px-2 pb-1 pt-1.5', className)} {...props} />;
}
