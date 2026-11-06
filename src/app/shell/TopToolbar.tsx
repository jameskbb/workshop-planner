import { Fragment } from 'react';
import { toolbarItems, type ToolbarGroup, type ToolbarItem } from '@/app/registry';
import { Separator } from '@/components/ui';
import { useUiStore } from '@/stores/uiStore';

const GROUPS: ToolbarGroup[] = ['left', 'tools', 'edit', 'view'];

const visibleIn = (view: string) => (i: ToolbarItem) => !i.views || i.views.includes(view);

/**
 * The main toolbar. It never makes the page wider than the window:
 *  - it is a size container (`@container/toolbar`); below ~1,800 px toolbar buttons drop their text
 *    labels (`<ToolbarLabel>`, kept for screen readers and tooltips) and the project title narrows;
 *  - the right-hand group (layouts, print, export, palette, help) never shrinks, and everything to
 *    its left lives in a horizontally scrollable strip as a last resort on very narrow windows;
 *  - items registered with `views` only appear in those views (2D-only controls are hidden in 3D).
 */
export function TopToolbar() {
  const view = useUiStore((s) => s.view);
  const items = toolbarItems.useItems().filter(visibleIn(view));
  const byGroup = (g: ToolbarGroup) => items.filter((i) => i.group === g);
  const groups = GROUPS.map((g) => ({ g, list: byGroup(g) })).filter((x) => x.list.length > 0);
  return (
    <header
      className="@container/toolbar flex min-w-0 items-center gap-1 overflow-hidden border-b border-line bg-panel px-2"
      role="toolbar"
      aria-label="Main toolbar"
      data-testid="main-toolbar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="toolbar-scroll">
        {groups.map(({ g, list }, gi) => (
          <Fragment key={g}>
            {gi > 0 && <Separator orientation="vertical" className="mx-1.5 shrink-0" />}
            <div className={g === 'left' ? 'flex min-w-0 items-center gap-0.5' : 'flex shrink-0 items-center gap-0.5'} data-toolbar-group={g}>
              {list.map((i) => (
                <i.component key={i.id} />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-1" data-toolbar-group="right">
        {byGroup('right').map((i) => (
          <i.component key={i.id} />
        ))}
      </div>
    </header>
  );
}
