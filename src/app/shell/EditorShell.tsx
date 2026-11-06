/**
 * Professional desktop layout: top toolbar, left sidebar (icon rail + panel), center view,
 * right inspector, bottom status bar. Every region renders registry contributions.
 */
import { useEffect } from 'react';
import { appViews, shellExtras } from '@/app/registry';
import { useUiStore } from '@/stores/uiStore';
import { TopToolbar } from './TopToolbar';
import { LeftSidebar } from './LeftSidebar';
import { RightInspector } from './RightInspector';
import { StatusBar } from './StatusBar';
import { CommandPalette } from './CommandPalette';
import { handleShortcut, isTypingTarget } from './keyboard';
import { routeKeyToTool } from '@/app/canvas/PlanCanvas';

function ActiveView() {
  const views = appViews.useItems();
  const viewId = useUiStore((s) => s.view);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  if (!view) return <div className="grid size-full place-items-center text-ink-muted">No views registered.</div>;
  return <view.component />;
}

function ShellExtras() {
  const extras = shellExtras.useItems();
  return (
    <>
      {extras.map((x) => (
        <x.component key={x.id} />
      ))}
    </>
  );
}

export function EditorShell() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // The active canvas tool gets first refusal (Esc/Backspace/typed lengths while drawing…).
      if (!isTypingTarget(e.target) && useUiStore.getState().view === '2d' && routeKeyToTool(e)) {
        e.preventDefault();
        return;
      }
      handleShortcut(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    /* grid-cols-[minmax(0,1fr)] + overflow-hidden: no row (a wide toolbar, a wide inspector row)
       may stretch the shell past the window: the page itself must never scroll sideways. */
    <div className="grid h-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[44px_minmax(0,1fr)_26px] overflow-hidden bg-app" data-testid="editor-shell">
      <TopToolbar />
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <LeftSidebar />
        <main className="relative min-w-0 flex-1 border-x border-line" aria-label="Plan view">
          <ActiveView />
        </main>
        <RightInspector />
      </div>
      <StatusBar />
      <CommandPalette />
      <ShellExtras />
    </div>
  );
}
