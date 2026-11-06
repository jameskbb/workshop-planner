/**
 * Phase 1 plan view: the 2D canvas view, base drawing layers, Select/Pan tools, zoom controls,
 * status bar readouts and core plan shortcuts.
 */
import { Grid3x3, Magnet, Maximize, Minus, Plus, Square } from 'lucide-react';
import { appViews, canvasLayers, entityAdapters, canvasTools, paletteCommands, shortcuts, statusBarItems, toolbarItems } from '@/app/registry';
import { fitRoomToView, PlanCanvas } from '@/app/canvas/PlanCanvas';
import { zoomAt } from '@/app/canvas/viewport';
import { ToolbarButton } from '@/components/shell';
import { Tip } from '@/components/ui';
import { dispatch, useProjectStore } from '@/stores/projectStore';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { useFormatters } from '@/hooks/useFormatters';
import { useSelectionContext } from '@/hooks/useProject';
import { roomGeometry } from '@/domain/resolve';
import { useEditorStore } from '@/stores/editorStore';
import { refsBounds } from '@/features/editor/selection';
import { IMPERIAL_GRIDS, METRIC_GRIDS } from '@/features/editor/viewMenu';
import { GridLayer } from './layers/GridLayer';
import { RoomLayer } from './layers/RoomLayer';
import { ArchitectureLayer } from './layers/ArchitectureLayer';
import { ObjectsLayer } from './layers/ObjectsLayer';
import { VehiclesLayer } from './layers/VehiclesLayer';
import { ElectricalLayer, LightsLayer, MeasurementsLayer, ZonesLayer } from './layers/FixturesLayers';
import { SelectionLayer } from './layers/SelectionLayer';
import { CornerHandlesLayer } from './layers/RoomLayer';
import { ZoneHandlesLayer } from './layers/FixturesLayers';
import { allPickable, editorCtx } from '@/features/editor/selection';
import { panTool, selectTool } from './tools';

// ───────────── view ─────────────
appViews.register({ id: '2d', label: '2D plan', icon: Square, order: 10, component: PlanCanvas });

// ───────────── layers ─────────────
canvasLayers.register({ id: 'grid', slot: 'background', order: 10, component: GridLayer });
canvasLayers.register({ id: 'zones', slot: 'content', order: 10, component: ZonesLayer });
canvasLayers.register({ id: 'room', slot: 'content', order: 20, component: RoomLayer });
canvasLayers.register({ id: 'architecture', slot: 'content', order: 30, component: ArchitectureLayer });
canvasLayers.register({ id: 'objects', slot: 'content', order: 40, component: ObjectsLayer });
canvasLayers.register({ id: 'vehicles', slot: 'content', order: 50, component: VehiclesLayer });
canvasLayers.register({ id: 'electrical', slot: 'content', order: 60, component: ElectricalLayer });
canvasLayers.register({ id: 'lights', slot: 'content', order: 70, component: LightsLayer });
canvasLayers.register({ id: 'measurements', slot: 'content', order: 80, component: MeasurementsLayer });
canvasLayers.register({ id: 'selection', slot: 'overlay', order: 10, component: SelectionLayer });
canvasLayers.register({ id: 'room.corners', slot: 'overlay', order: 20, component: CornerHandlesLayer });
canvasLayers.register({ id: 'zones.handles', slot: 'overlay', order: 30, component: ZoneHandlesLayer });

// ───────────── tools ─────────────
canvasTools.register(selectTool);
canvasTools.register(panTool);

// ───────────── zoom controls ─────────────
function zoomBy(factor: number) {
  const { viewport, canvasSize } = useUiStore.getState();
  uiActions.setViewport(zoomAt(viewport, { x: canvasSize.width / 2, y: canvasSize.height / 2 }, factor));
}

function ZoomControls() {
  const scale = useUiStore((s) => s.viewport.scale);
  // 100% = 1 px per inch-ish drafting scale is meaningless on screens; show px/mm as a percentage of 1:20.
  const pct = Math.round((scale / 0.05) * 100);
  return (
    <>
      <ToolbarButton icon={Minus} label="Zoom out" shortcut="-" onClick={() => zoomBy(1 / 1.25)} testId="zoom-out" />
      <Tip content="Zoom level (100% ≈ 1:20)">
        <span className="num w-12 text-center text-2xs text-ink-muted" data-testid="zoom-level">
          {pct}%
        </span>
      </Tip>
      <ToolbarButton icon={Plus} label="Zoom in" shortcut="=" onClick={() => zoomBy(1.25)} testId="zoom-in" />
      <ToolbarButton icon={Maximize} label="Fit room" shortcut="shift+1" onClick={fitRoomToView} testId="fit-room" />
    </>
  );
}
// Zoom / fit / grid drive the 2D viewport only; not shown in the 3D, Elevation or Compare views.
toolbarItems.register({ id: 'plan.zoom', group: 'view', order: 10, views: ['2d'], component: ZoomControls });

function GridToggle() {
  const on = useProjectStore((s) => s.project?.settings.showGrid ?? true);
  return <ToolbarButton icon={Grid3x3} label={on ? 'Hide grid' : 'Show grid'} active={on} onClick={() => dispatch({ type: 'project.updateSettings', payload: { patch: { showGrid: !on } } })} testId="toggle-grid" />;
}
toolbarItems.register({ id: 'plan.grid', group: 'view', order: 20, views: ['2d'], component: GridToggle });

// ───────────── status bar ─────────────
function CursorReadout() {
  const cursor = useUiStore((s) => s.cursor);
  const fmt = useFormatters();
  return (
    <span className="num w-44 truncate" aria-label="Cursor position">
      {cursor ? `X ${fmt.length(cursor.x)}  Y ${fmt.length(cursor.y)}` : 'X n/a  Y n/a'}
    </span>
  );
}

function SelectionReadout() {
  const ctx = useSelectionContext();
  const fmt = useFormatters();
  const hud = useEditorStore((st) => st.hud);
  if (hud && hud.tone !== 'error') return <span className="num text-ink">{hud.lines.join(' · ')}</span>;
  if (!ctx || ctx.refs.length === 0) return null;
  const objs = ctx.refs.filter((r) => r.kind === 'object').map((r) => ctx.scenario.objects.find((o) => o.id === r.id)).filter(Boolean);
  if (ctx.single?.kind === 'object' && objs[0]) {
    const o = objs[0];
    return (
      <span className="num text-ink" data-testid="status-selection">
        {o.label ?? o.name}: {fmt.length(o.width)} × {fmt.length(o.depth)} × {fmt.length(o.height)} h
      </span>
    );
  }
  const c = { project: ctx.project, scenario: ctx.scenario };
  if (ctx.single?.kind === 'wall') {
    const g = roomGeometry(ctx.project.room);
    const w = g.walls[g.wallIndex.get(ctx.single.id) ?? -1];
    return w ? <span className="num text-ink">{w.name}: {fmt.length(w.length)}</span> : null;
  }
  const b = refsBounds(c, ctx.refs);
  const name = ctx.single ? entityAdapters.get(ctx.single.kind)?.name(c, ctx.single.id) : `${ctx.refs.length} items`;
  return (
    <span className="num text-ink" data-testid="status-selection">
      {name}
      {b ? ` · ${fmt.length(b.maxX - b.minX)} × ${fmt.length(b.maxY - b.minY)}` : ''}
    </span>
  );
}

function GridReadout() {
  const settings = useProjectStore((s) => s.project?.settings);
  const fmt = useFormatters();
  if (!settings) return null;
  const grids = settings.unitSystem === 'imperial' ? IMPERIAL_GRIDS : METRIC_GRIDS;
  const i = grids.findIndex((g) => Math.abs(g - settings.gridSize) < 0.01);
  const next = grids[(i + 1) % grids.length]!;
  return (
    <Tip content={`Grid spacing: click for ${fmt.length(next)}`} side="top">
      <button type="button" className="num hover:text-ink" onClick={() => dispatch({ type: 'project.updateSettings', payload: { patch: { gridSize: next } } })} data-testid="status-grid">
        Grid {fmt.length(settings.gridSize)}
      </button>
    </Tip>
  );
}

function SnapReadout() {
  const enabled = useProjectStore((s) => s.project?.settings.snapping.enabled ?? true);
  const suppressed = useUiStore((s) => s.snapSuppressed);
  const on = enabled && !suppressed;
  return (
    <Tip content={suppressed ? 'Snapping paused while Alt is held' : 'Toggle snapping (hold Alt to bypass temporarily)'} side="top">
      <button
        type="button"
        className={`flex items-center gap-1 hover:text-ink ${on ? 'text-ink-muted' : 'text-ink-faint line-through'}`}
        aria-pressed={on}
        onClick={() => dispatch({ type: 'project.updateSettings', payload: { patch: { snapping: { ...useProjectStore.getState().project!.settings.snapping, enabled: !enabled } } } })}
      >
        <Magnet className="size-3" /> Snap {on ? 'on' : 'off'}
      </button>
    </Tip>
  );
}

function UnitsReadout() {
  const settings = useProjectStore((s) => s.project?.settings);
  if (!settings) return null;
  const label = settings.unitSystem === 'imperial' ? `ft-in · 1/${settings.imperialPrecision}"` : settings.metricUnit;
  return (
    <Tip content="Switch between imperial and metric display" side="top">
      <button
        type="button"
        className="hover:text-ink"
        onClick={() => dispatch({ type: 'project.updateSettings', payload: { patch: { unitSystem: settings.unitSystem === 'imperial' ? 'metric' : 'imperial' } } })}
      >
        {label}
      </button>
    </Tip>
  );
}

function ZoomReadout() {
  const scale = useUiStore((s) => s.viewport.scale);
  return <span className="num">{Math.round((scale / 0.05) * 100)}%</span>;
}

statusBarItems.register({ id: 'plan.cursor', align: 'left', order: 10, component: CursorReadout });
statusBarItems.register({ id: 'plan.selection', align: 'left', order: 20, component: SelectionReadout });
statusBarItems.register({ id: 'plan.zoom', align: 'right', order: 10, component: ZoomReadout });
statusBarItems.register({ id: 'plan.grid', align: 'right', order: 20, component: GridReadout });
statusBarItems.register({ id: 'plan.snap', align: 'right', order: 30, component: SnapReadout });
statusBarItems.register({ id: 'plan.units', align: 'right', order: 40, component: UnitsReadout });

// ───────────── shortcuts & palette ─────────────
const hasProject = () => useProjectStore.getState().project !== null;

shortcuts.register({ id: 'plan.fit', keys: ['shift+1', 'shift+!'], description: 'Fit the room in view', when: hasProject, run: () => fitRoomToView() });
shortcuts.register({ id: 'plan.zoom-in', keys: ['=', 'shift+='], description: 'Zoom in', when: hasProject, run: () => zoomBy(1.25) });
shortcuts.register({ id: 'plan.zoom-out', keys: ['-', 'shift+_'], description: 'Zoom out', when: hasProject, run: () => zoomBy(1 / 1.25) });
shortcuts.register({
  id: 'plan.select-all',
  keys: 'mod+a',
  description: 'Select all items',
  when: hasProject,
  run: () => {
    const c = editorCtx();
    if (c) uiActions.select(allPickable(c, new Set(['object', 'vehicle', 'feature', 'electrical', 'light'])));
  },
});

paletteCommands.register({ id: 'plan.fit', title: 'Fit room', section: 'View', icon: Maximize, shortcut: 'shift+1', when: (c) => !!c.project, run: fitRoomToView });
paletteCommands.register({
  id: 'plan.toggle-grid',
  title: 'Toggle grid',
  section: 'View',
  icon: Grid3x3,
  when: (c) => !!c.project,
  run: (c) => void dispatch({ type: 'project.updateSettings', payload: { patch: { showGrid: !c.project!.settings.showGrid } } }),
});
paletteCommands.register({
  id: 'plan.toggle-units',
  title: 'Switch units (imperial / metric)',
  section: 'View',
  keywords: ['metric', 'imperial', 'mm', 'inches'],
  when: (c) => !!c.project,
  run: (c) => void dispatch({ type: 'project.updateSettings', payload: { patch: { unitSystem: c.project!.settings.unitSystem === 'imperial' ? 'metric' : 'imperial' } } }),
});
paletteCommands.register({ id: 'plan.zoom-in', title: 'Zoom in', section: 'View', icon: Plus, when: (c) => !!c.project, run: () => zoomBy(1.25) });
paletteCommands.register({ id: 'plan.zoom-out', title: 'Zoom out', section: 'View', icon: Minus, when: (c) => !!c.project, run: () => zoomBy(1 / 1.25) });
