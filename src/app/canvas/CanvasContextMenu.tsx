/**
 * Right-click menu for the canvas, built from the `contextMenuActions` registry for the current
 * selection. Groups are separated; actions that don't apply are hidden.
 */
import { Fragment, type ReactNode } from 'react';
import { contextMenuActions, type ContextMenuAction, type SelectionContext } from '@/app/registry';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui';
import { useSelectionContext } from '@/hooks/useProject';

function describe(ctx: SelectionContext): string {
  if (ctx.refs.length === 0) return 'Plan';
  if (ctx.refs.length > 1) return `${ctx.refs.length} items`;
  const r = ctx.single!;
  if (r.kind === 'object') return ctx.scenario.objects.find((o) => o.id === r.id)?.label ?? ctx.scenario.objects.find((o) => o.id === r.id)?.name ?? 'Object';
  if (r.kind === 'vehicle') return ctx.scenario.vehicles.find((v) => v.id === r.id)?.name ?? 'Vehicle';
  if (r.kind === 'feature') return ctx.project.architecture.find((f) => f.id === r.id)?.name ?? 'Feature';
  return r.kind;
}

export function CanvasContextMenu({ children }: { children: ReactNode }) {
  const ctx = useSelectionContext();
  const actions = contextMenuActions.useItems();
  const applicable = ctx ? actions.filter((a) => a.appliesTo(ctx)) : [];
  const groups: Array<[string, ContextMenuAction[]]> = [];
  for (const a of applicable) {
    const g = groups.find(([name]) => name === a.group);
    if (g) g[1].push(a);
    else groups.push([a.group, [a]]);
  }
  const disabled = !ctx || applicable.length === 0;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={disabled}>
        {/* The browser's own menu is never useful on the canvas. */}
        <div className="size-full" onContextMenu={disabled ? (e) => e.preventDefault() : undefined}>
          {children}
        </div>
      </ContextMenuTrigger>
      {ctx && applicable.length > 0 && (
        <ContextMenuContent className="w-56">
          <ContextMenuLabel>{describe(ctx)}</ContextMenuLabel>
          {groups.map(([name, items], gi) => (
            <Fragment key={name}>
              {gi > 0 && <ContextMenuSeparator />}
              {items.map((a) => {
                const Icon = a.icon;
                return (
                  <ContextMenuItem key={a.id} shortcut={a.shortcut} destructive={a.destructive} disabled={a.disabled?.(ctx)} onSelect={() => a.run(ctx)}>
                    {Icon && <Icon />}
                    {typeof a.label === 'function' ? a.label(ctx) : a.label}
                  </ContextMenuItem>
                );
              })}
            </Fragment>
          ))}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
