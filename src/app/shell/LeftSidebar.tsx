import { PanelLeftClose } from 'lucide-react';
import { sidebarSections } from '@/app/registry';
import { Button, Tip } from '@/components/ui';
import { PanelHeader } from '@/components/shell';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';

export function LeftSidebar() {
  const sections = sidebarSections.useItems();
  const activeId = useUiStore((s) => s.leftSection);
  // `null` = first section; '' = collapsed.
  const active = activeId === '' ? null : (sections.find((s) => s.id === activeId) ?? sections[0] ?? null);

  return (
    <aside className="flex shrink-0 overflow-hidden bg-panel" aria-label="Sidebar">
      <nav className="flex w-11 flex-col items-center gap-1 border-r border-line py-2" aria-label="Sidebar sections">
        {sections.map((s) => {
          const Icon = s.icon;
          const isActive = active?.id === s.id;
          return (
            <Tip key={s.id} content={s.title} side="right">
              <button
                type="button"
                aria-label={s.title}
                aria-pressed={isActive}
                data-testid={`sidebar-${s.id}`}
                onClick={() => uiActions.setLeftSection(isActive ? '' : s.id)}
                className={cn(
                  'relative grid size-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-panel-3 hover:text-ink',
                  isActive && 'bg-panel-3 text-ink before:absolute before:-left-1.5 before:h-4 before:w-0.5 before:rounded-full before:bg-accent',
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.75} />
                {s.badge && (
                  <span className="absolute -right-0.5 -top-0.5">
                    <s.badge />
                  </span>
                )}
              </button>
            </Tip>
          );
        })}
      </nav>
      {active && (
        <div className="flex w-[272px] min-w-0 flex-col" data-testid={`panel-${active.id}`}>
          <PanelHeader
            title={active.title}
            actions={
              <Tip content="Collapse sidebar">
                <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" onClick={() => uiActions.setLeftSection('')}>
                  <PanelLeftClose />
                </Button>
              </Tip>
            }
          />
          <div className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <active.component />
          </div>
        </div>
      )}
    </aside>
  );
}
