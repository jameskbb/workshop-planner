/**
 * Toolbar menus: View (grid, orientation, labels, rulers, minimap, snapping, rotation step,
 * monochrome), Overlays (every toggleable canvas layer), Add and the view switcher (shown once more
 * than one view is registered, e.g. 2D / 3D). The layout switcher lives in features/scenarios.
 */
import { Box, Building2, Car, Compass as CompassIcon, Eye, Focus, Layers3, Lightbulb, Maximize, Plug, Plus, Ruler, SquareDashedMousePointer } from 'lucide-react';
import { appViews, canvasLayers, paletteCommands, shortcuts, toolbarItems } from '@/app/registry';
import { fitRoomToView } from '@/app/canvas/PlanCanvas';
import { ORIENTATIONS, orientationOf, type Orientation } from '@/app/canvas/viewport';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Kbd,
  Tip,
} from '@/components/ui';
import { ToolbarLabel } from '@/components/shell';
import { shortcutLabel } from '@/app/shell/keyboard';
import type { SnapSettings } from '@/domain/schema';
import { useFormatters } from '@/hooks/useFormatters';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { ARCHITECTURE_TEMPLATES, ELECTRICAL_TEMPLATES, LIGHT_TEMPLATES, VEHICLE_TEMPLATES } from '@/features/objects/library';
import { startPlacing } from '@/features/architecture/place';
import { fitSelection } from './ops';
import { setViewPref, useViewPrefs } from './prefs';
import { setOrientationRotation } from './viewChrome';

export const IMPERIAL_GRIDS = [25.4, 50.8, 76.2, 152.4, 304.8];
export const METRIC_GRIDS = [10, 25, 50, 100, 250];

const settingsPatch = (patch: Record<string, unknown>) => dispatch({ type: 'project.updateSettings', payload: { patch } });

export function setOrientation(o: Orientation): void {
  setOrientationRotation(ORIENTATIONS[o]);
  setTimeout(fitRoomToView, 0);
}

function ViewMenu() {
  const settings = useProjectStore((s) => s.project?.settings);
  const prefs = useViewPrefs();
  const rotation = useUiStore((s) => s.viewport.rotation ?? 0);
  const fmt = useFormatters();
  if (!settings) return null;
  const grids = settings.unitSystem === 'imperial' ? IMPERIAL_GRIDS : METRIC_GRIDS;
  const snap = settings.snapping;
  const setSnap = (k: keyof SnapSettings, v: boolean) => settingsPatch({ snapping: { ...snap, [k]: v } });
  const orient = orientationOf(rotation);
  return (
    <DropdownMenu>
      <Tip content="View options: grid, orientation, labels, snapping">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="View" data-testid="view-menu">
            <Eye /> <ToolbarLabel>View</ToolbarLabel>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent className="w-64">
        <DropdownMenuItem onSelect={fitRoomToView}>
          <Maximize /> Fit room <Kbd className="ml-auto">{shortcutLabel('shift+1')}</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={fitSelection}>
          <Focus /> Fit selection <Kbd className="ml-auto">{shortcutLabel('shift+2')}</Kbd>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CompassIcon /> Orientation: {orient} up
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(['north', 'east', 'south', 'west'] as Orientation[]).map((o) => (
              <DropdownMenuCheckboxItem key={o} checked={orient === o} onSelect={() => setOrientation(o)} data-testid={`orientation-${o}`}>
                {o[0]!.toUpperCase() + o.slice(1)} up
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Grid: {fmt.length(settings.gridSize)}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {grids.map((g) => (
              <DropdownMenuCheckboxItem key={g} checked={Math.abs(settings.gridSize - g) < 0.01} onSelect={() => settingsPatch({ gridSize: g })} data-testid={`grid-${g}`}>
                {fmt.length(g)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuCheckboxItem checked={settings.showGrid} onSelect={(e) => (e.preventDefault(), settingsPatch({ showGrid: !settings.showGrid }))}>
          Show grid
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={settings.showLabels} onSelect={(e) => (e.preventDefault(), settingsPatch({ showLabels: !settings.showLabels }))}>
          Object labels
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={settings.showDimensions} onSelect={(e) => (e.preventDefault(), settingsPatch({ showDimensions: !settings.showDimensions }))}>
          Wall dimensions
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.rulers} onSelect={(e) => (e.preventDefault(), setViewPref('rulers', !prefs.rulers))}>
          Rulers
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.minimap} onSelect={(e) => (e.preventDefault(), setViewPref('minimap', !prefs.minimap))} data-testid="toggle-minimap">
          Minimap
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={prefs.liveDistances} onSelect={(e) => (e.preventDefault(), setViewPref('liveDistances', !prefs.liveDistances))}>
          Live distances while dragging
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={settings.monochrome} onSelect={(e) => (e.preventDefault(), settingsPatch({ monochrome: !settings.monochrome }))} data-testid="toggle-monochrome">
          Monochrome (technical drawing)
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Snapping: {snap.enabled ? 'on' : 'off'}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuCheckboxItem checked={snap.enabled} onSelect={(e) => (e.preventDefault(), setSnap('enabled', !snap.enabled))}>
              Snapping (hold Alt to bypass)
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {(
              [
                ['grid', 'Grid'],
                ['walls', 'Walls'],
                ['corners', 'Corners'],
                ['wallCenters', 'Wall centers'],
                ['objectEdges', 'Object edges'],
                ['objectCenters', 'Object centers'],
              ] as Array<[keyof SnapSettings, string]>
            ).map(([k, label]) => (
              <DropdownMenuCheckboxItem key={k} disabled={!snap.enabled} checked={snap[k]} onSelect={(e) => (e.preventDefault(), setSnap(k, !snap[k]))}>
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Rotation snap (Shift): {settings.rotationSnap}°</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {[15, 45, 90].map((d) => (
              <DropdownMenuCheckboxItem key={d} checked={settings.rotationSnap === d} onSelect={() => settingsPatch({ rotationSnap: d })}>
                {d}°
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OverlaysMenu() {
  const layers = canvasLayers.useItems().filter((l) => l.overlay);
  const overlays = useUiStore((s) => s.overlays);
  if (layers.length === 0) return null;
  return (
    <DropdownMenu>
      <Tip content="Overlays: clearances and other analysis layers">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Overlays" data-testid="overlays-menu">
            <Layers3 /> <ToolbarLabel>Overlays</ToolbarLabel>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent className="w-60">
        <DropdownMenuLabel>Show on the plan</DropdownMenuLabel>
        {layers.map((l) => {
          const on = overlays[l.overlay!.key] ?? l.overlay!.defaultOn ?? false;
          return (
            <DropdownMenuCheckboxItem key={l.id} checked={on} onSelect={(e) => (e.preventDefault(), uiActions.setOverlay(l.overlay!.key, !on))} data-testid={`overlay-${l.overlay!.key}`}>
              {l.overlay!.label}
              {l.overlay!.shortcut && <Kbd className="ml-auto">{shortcutLabel(l.overlay!.shortcut)}</Kbd>}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Placing happens on the 2D plan: switch to it first so the Add menu never acts on a hidden view. */
function placeOnPlan(run: () => void): void {
  if (useUiStore.getState().view !== '2d') uiActions.setView('2d');
  run();
}

function AddMenu() {
  const fmt = useFormatters();
  return (
    <DropdownMenu>
      <Tip content="Add objects, fixed features, outlets, lights, vehicles, zones">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Add" data-testid="add-menu">
            <Plus /> <ToolbarLabel>Add</ToolbarLabel>
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent className="w-60">
        <DropdownMenuItem onSelect={() => uiActions.setLeftSection('library')}>
          <Box /> Object from the library…
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Building2 /> Door, window, structure
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-96 overflow-y-auto">
            {ARCHITECTURE_TEMPLATES.map((t) => (
              <DropdownMenuItem key={`${t.kind}:${t.name}`} onSelect={() => placeOnPlan(() => startPlacing({ kind: 'feature', templateId: `${t.kind}:${t.name}`, label: t.name }))}>
                {t.name}
                <span className="num ml-auto text-2xs text-ink-faint">{fmt.length(t.width)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Plug /> Electrical
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {ELECTRICAL_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.kind} onSelect={() => placeOnPlan(() => startPlacing({ kind: 'electrical', templateId: t.kind, label: t.name }))}>
                {t.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Lightbulb /> Light
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {LIGHT_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.name} onSelect={() => placeOnPlan(() => startPlacing({ kind: 'light', templateId: t.name, label: t.name }))}>
                {t.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Car /> Vehicle
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {VEHICLE_TEMPLATES.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => placeOnPlan(() => startPlacing({ kind: 'vehicle', templateId: t.id, label: t.name }))}>
                {t.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => placeOnPlan(() => uiActions.setTool('zone'))}>
          <SquareDashedMousePointer /> Zone <Kbd className="ml-auto">Z</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => placeOnPlan(() => uiActions.setTool('dimension'))}>
          <Ruler /> Dimension line <Kbd className="ml-auto">D</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewSwitcher() {
  const views = appViews.useItems();
  const active = useUiStore((s) => s.view);
  if (views.length < 2) return null;
  return (
    <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="View">
      {views.map((v) => {
        const Icon = v.icon;
        return (
          <Tip key={v.id} content={v.label} shortcut={v.shortcut ? shortcutLabel(v.shortcut) : undefined}>
            <button
              type="button"
              aria-pressed={active === v.id}
              onClick={() => uiActions.setView(v.id)}
              className={cn('flex h-6 items-center gap-1 rounded px-2 text-xs', active === v.id ? 'bg-select/25 text-ink' : 'text-ink-muted hover:text-ink')}
              data-testid={`view-${v.id}`}
              aria-label={v.label}
            >
              <Icon className="size-3.5" /> <ToolbarLabel>{v.label}</ToolbarLabel>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

toolbarItems.register({ id: 'editor.add', group: 'tools', order: 90, component: AddMenu });
// View options and plan overlays act on the 2D plan only; they are not shown in 3D / Elevation / Compare.
toolbarItems.register({ id: 'editor.view-menu', group: 'view', order: 30, views: ['2d'], component: ViewMenu });
toolbarItems.register({ id: 'editor.overlays', group: 'view', order: 40, views: ['2d'], component: OverlaysMenu });
toolbarItems.register({ id: 'editor.view-switcher', group: 'view', order: 5, component: ViewSwitcher });

// ───────────── palette & shortcuts for view presets ─────────────

for (const o of ['north', 'east', 'south', 'west'] as Orientation[]) {
  paletteCommands.register({ id: `view.orient.${o}`, title: `View: ${o} up`, section: 'View', icon: CompassIcon, keywords: ['orientation', 'rotate view', o], when: (c) => !!c.project, run: () => setOrientation(o) });
}
paletteCommands.register({ id: 'view.toggle-rulers', title: 'Toggle rulers', section: 'View', icon: Ruler, when: (c) => !!c.project, run: () => setViewPref('rulers', !useViewPrefs.getState().rulers) });
paletteCommands.register({ id: 'view.toggle-minimap', title: 'Toggle minimap', section: 'View', when: (c) => !!c.project, run: () => setViewPref('minimap', !useViewPrefs.getState().minimap) });
paletteCommands.register({ id: 'view.toggle-labels', title: 'Toggle object labels', section: 'View', when: (c) => !!c.project, run: (c) => settingsPatch({ showLabels: !c.project!.settings.showLabels }) });
paletteCommands.register({ id: 'view.toggle-dimensions', title: 'Toggle wall dimensions', section: 'View', when: (c) => !!c.project, run: (c) => settingsPatch({ showDimensions: !c.project!.settings.showDimensions }) });
paletteCommands.register({ id: 'view.monochrome', title: 'Toggle monochrome technical drawing', section: 'View', keywords: ['print', 'black and white'], when: (c) => !!c.project, run: (c) => settingsPatch({ monochrome: !c.project!.settings.monochrome }) });
paletteCommands.register({
  id: 'view.toggle-snapping',
  title: 'Toggle snapping',
  section: 'View',
  keywords: ['snap', 'magnet'],
  when: (c) => !!c.project,
  run: (c) => settingsPatch({ snapping: { ...c.project!.settings.snapping, enabled: !c.project!.settings.snapping.enabled } }),
});
for (const g of [...IMPERIAL_GRIDS]) {
  const inch = Math.round(g / 25.4);
  paletteCommands.register({ id: `view.grid.${inch}`, title: `Grid: ${inch}"`, section: 'View', keywords: ['grid spacing'], when: (c) => c.project?.settings.unitSystem === 'imperial', run: () => settingsPatch({ gridSize: g }) });
}
for (const g of METRIC_GRIDS) {
  paletteCommands.register({ id: `view.grid.mm${g}`, title: `Grid: ${g} mm`, section: 'View', keywords: ['grid spacing'], when: (c) => c.project?.settings.unitSystem === 'metric', run: () => settingsPatch({ gridSize: g }) });
}
shortcuts.register({ id: 'view.grid-toggle', keys: "mod+'", description: 'Toggle the grid', when: () => !!useProjectStore.getState().project, run: () => void settingsPatch({ showGrid: !useProjectStore.getState().project!.settings.showGrid }) });
