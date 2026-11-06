/**
 * Onboarding: an optional 6-step guided tour (draw the garage → fixed features → tools → vehicle →
 * clearances → layout alternatives), a one-time, dismissible invitation to take it, and the Help
 * menu with a keyboard-shortcut reference built from the registries.
 */
import { CircleHelp, GraduationCap, Keyboard, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { canvasTools, paletteCommands, shellExtras, shortcuts, toolbarItems } from '@/app/registry';
import { shortcutLabel } from '@/app/shell/keyboard';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Kbd, Tip } from '@/components/ui';
import { uiActions } from '@/stores/uiStore';
import { setViewPref, useViewPrefs } from '@/features/editor/prefs';

interface TourStep {
  target: string;
  title: string;
  body: string;
  /** Sidebar section to open so the target's panel is visible. */
  section?: string;
}

export const TOUR: readonly TourStep[] = [
  {
    target: '[data-testid="tool-wall"]',
    title: '1 · Draw the garage',
    body: 'Pick the Wall tool (W) and click the corners of your garage. Type a length like 21\' 6" and press Enter for exact walls. Prefer numbers? The Room panel has templates and a "type wall lengths" builder.',
  },
  { target: '[data-testid="sidebar-architecture"]', section: 'architecture', title: '2 · Add fixed features', body: 'Garage doors, entry doors, windows, support poles, the water heater, outlets and lights. Doors and outlets snap to the nearest wall; the inspector takes exact sizes.' },
  { target: '[data-testid="sidebar-library"]', section: 'library', title: '3 · Add your tools', body: 'Benches, saws, cabinets and more. Click to add or drag onto the plan, then type your real dimensions; library sizes are only typical values.' },
  { target: '[data-testid="sidebar-vehicles"]', section: 'vehicles', title: '4 · Add your vehicle', body: 'Choose a vehicle class and enter your car\'s length, width and mirror width to check parking and door clearance.' },
  { target: '[data-testid="overlays-menu"]', title: '5 · Turn on clearances', body: 'Overlays show the room each tool needs to be used safely, not just where it physically fits. Right-click an object → View clearances works too.' },
  { target: '[data-testid="layout-switcher"]', title: '6 · Save layout alternatives', body: 'Duplicate the layout to try "Car + Workshop" against "Workshop mode". The room and fixed features are shared; each layout keeps its own arrangement.' },
];

export const useTour = create<{ step: number | null; helpOpen: boolean }>()(() => ({ step: null, helpOpen: false }));

export function startTour(): void {
  useTour.setState({ step: 0 });
  setViewPref('tourDismissed', true);
}

function TourCard() {
  const step = useTour((s) => s.step);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = step === null ? null : TOUR[step];
  useLayoutEffect(() => {
    if (!s) return;
    if (s.section) uiActions.setLeftSection(s.section);
    const measure = () => setRect(document.querySelector(s.target)?.getBoundingClientRect() ?? null);
    measure();
    const t = setTimeout(measure, 60);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [s]);
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useTour.setState({ step: null });
      else if (e.key === 'ArrowRight') useTour.setState({ step: step + 1 < TOUR.length ? step + 1 : null });
      else if (e.key === 'ArrowLeft' && step > 0) useTour.setState({ step: step - 1 });
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step]);
  if (step === null || !s) return null;
  const cardW = 320;
  const left = rect ? Math.min(window.innerWidth - cardW - 12, Math.max(12, rect.left + (rect.left < 80 ? rect.width + 12 : 0))) : window.innerWidth / 2 - cardW / 2;
  const top = rect ? (rect.left < 80 ? Math.max(12, rect.top - 8) : rect.bottom + 10) : window.innerHeight / 3;
  return (
    <>
      {rect && <div className="pointer-events-none fixed z-[70] rounded-md ring-2 ring-accent ring-offset-2 ring-offset-app transition-all" style={{ left: rect.left - 2, top: rect.top - 2, width: rect.width + 4, height: rect.height + 4 }} />}
      <div role="dialog" aria-modal="false" aria-labelledby="tour-title" className="fixed z-[71] rounded-lg border border-line-strong bg-panel p-4 shadow-2xl shadow-black/50" style={{ left, top, width: cardW }} data-testid="tour-card">
        <div className="flex items-start justify-between gap-2">
          <h2 id="tour-title" className="text-sm font-semibold text-ink">
            {s.title}
          </h2>
          <button type="button" aria-label="Close the tour" className="text-ink-muted hover:text-ink" onClick={() => useTour.setState({ step: null })}>
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{s.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-2xs text-ink-faint">
            {step + 1} of {TOUR.length}
          </span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => useTour.setState({ step: null })}>
            Skip tour
          </Button>
          {step > 0 && (
            <Button size="sm" variant="outline" onClick={() => useTour.setState({ step: step - 1 })}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => useTour.setState({ step: step + 1 < TOUR.length ? step + 1 : null })} data-testid="tour-next">
            {step + 1 < TOUR.length ? 'Next' : 'Done'}
          </Button>
        </div>
      </div>
    </>
  );
}

/** One-time, non-blocking invitation (never forced). */
function TourInvite() {
  const dismissed = useViewPrefs((s) => s.tourDismissed);
  const running = useTour((s) => s.step !== null);
  if (dismissed || running) return null;
  return (
    /* Centered over the canvas just above the status bar: it must not cover the sidebar panel's own
       content (Backups, layout list) or the minimap in the corner while it waits to be dismissed. */
    <div
      className="fixed bottom-9 left-1/2 z-40 flex max-w-xs -translate-x-1/2 items-start gap-3 rounded-lg border border-line-strong bg-panel p-3 shadow-xl"
      role="status"
      data-testid="tour-invite"
    >
      <GraduationCap className="mt-0.5 size-5 shrink-0 text-accent" />
      <div>
        <p className="text-xs text-ink">New here? A six-step tour shows the fastest way from an empty plan to a layout you can trust.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="primary" onClick={startTour}>
            Take the tour
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setViewPref('tourDismissed', true)} data-testid="tour-dismiss">
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShortcutsDialog() {
  const open = useTour((s) => s.helpOpen);
  const list = shortcuts.useItems();
  const tools = canvasTools.useItems().filter((t) => t.shortcut && !t.hidden);
  const seen = new Set<string>();
  const rows = list.filter((s) => {
    const key = s.description;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <Dialog open={open} onOpenChange={(o) => useTour.setState({ helpOpen: o })}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Hold Alt while dragging to turn snapping off; Shift constrains angles and axes.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] grid-cols-2 gap-x-6 overflow-y-auto">
          <div>
            <h3 className="panel-heading mb-1">Tools</h3>
            <ul className="space-y-0.5 text-xs">
              {tools.map((t) => (
                <li key={t.id} className="flex justify-between gap-2 py-0.5">
                  <span className="text-ink-muted">{t.label}</span>
                  <Kbd>{shortcutLabel(t.shortcut!)}</Kbd>
                </li>
              ))}
              <li className="flex justify-between gap-2 py-0.5">
                <span className="text-ink-muted">Pan while held</span>
                <Kbd>Space</Kbd>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="panel-heading mb-1">Editing & view</h3>
            <ul className="space-y-0.5 text-xs">
              {rows.map((s) => (
                <li key={s.id} className="flex justify-between gap-2 py-0.5">
                  <span className="text-ink-muted">{s.description}</span>
                  <span className="flex gap-1">
                    {(Array.isArray(s.keys) ? s.keys.slice(0, 1) : [s.keys]).map((k) => (
                      <Kbd key={k}>{shortcutLabel(k)}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HelpMenu() {
  return (
    <DropdownMenu>
      <Tip content="Help">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Help" data-testid="help-menu">
            <CircleHelp />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={startTour} data-testid="start-tour">
          <GraduationCap /> Guided tour
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useTour.setState({ helpOpen: true })}>
          <Keyboard /> Keyboard shortcuts <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

shellExtras.register({ id: 'onboarding.tour', order: 50, component: TourCard });
shellExtras.register({ id: 'onboarding.invite', order: 51, component: TourInvite });
shellExtras.register({ id: 'onboarding.shortcuts', order: 52, component: ShortcutsDialog });
toolbarItems.register({ id: 'onboarding.help', group: 'right', order: 95, component: HelpMenu });
shortcuts.register({ id: 'onboarding.shortcuts', keys: ['shift+?', '?'], description: 'Show keyboard shortcuts', run: () => useTour.setState({ helpOpen: true }) });
paletteCommands.register({ id: 'onboarding.tour', title: 'Start guided tour', section: 'Help', icon: GraduationCap, keywords: ['help', 'tutorial', 'onboarding'], run: startTour });
paletteCommands.register({ id: 'onboarding.shortcuts', title: 'Keyboard shortcuts', section: 'Help', icon: Keyboard, run: () => useTour.setState({ helpOpen: true }) });
