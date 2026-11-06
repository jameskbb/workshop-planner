/**
 * UI extension registries. Feature folders contribute UI by calling these from their own
 * `src/features/<feature>/register.ts(x)` (auto-loaded, see loadFeatures.ts). No shell file needs
 * editing to add a panel, inspector section, tool, overlay, command, export format or view.
 *
 * Pure (non-UI) registries live elsewhere so workers/tests can use them:
 *   - commands:            src/domain/commands (defineCommand)
 *   - analyzers & metrics: src/analysis (registerAnalyzer / registerMetric)
 *   - project extensions:  src/domain/extensions (defineExtension)
 */
import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { AppCommand } from '@/domain/commands';
import type { EntityKind, EntityRef, LayerId, Project, Scenario } from '@/domain/schema';
import type { Point, Polygon } from '@/geometry';
import { createRegistry, type RegistryItem } from './createRegistry';

export { createRegistry, type Registry, type RegistryItem } from './createRegistry';

// ───────────────────────────── left sidebar ─────────────────────────────

export interface SidebarSection extends RegistryItem {
  title: string;
  icon: LucideIcon;
  /** Panel body. Rendered inside a scroll container when the section is active. */
  component: ComponentType;
  /** Optional small badge next to the icon (e.g. warning count). */
  badge?: ComponentType;
}
/** Left sidebar sections (icon rail + panel). Order: 10 project, 20 room, 30 architecture, 40 library, 60 vehicles, 70 zones, 80 layers, 90 warnings. */
export const sidebarSections = createRegistry<SidebarSection>('sidebarSections');

// ───────────────────────────── right inspector ─────────────────────────────

export interface SelectionContext {
  project: Project;
  scenario: Scenario;
  refs: readonly EntityRef[];
  /** Distinct kinds in the selection. */
  kinds: ReadonlySet<EntityKind>;
  /** The single selected entity, if exactly one. */
  single: EntityRef | null;
}

export interface InspectorSection extends RegistryItem {
  title: string;
  /** Show this section for the current selection (empty selection = "nothing selected" state). */
  appliesTo(ctx: SelectionContext): boolean;
  component: ComponentType<{ ctx: SelectionContext }>;
  /** Collapsed by default? */
  collapsed?: boolean;
}
/** Right inspector sections. Order: 10 identity, 20 geometry, 30 appearance, 40+ feature sections, 90 notes. */
export const inspectorSections = createRegistry<InspectorSection>('inspectorSections');

// ───────────────────────────── toolbar ─────────────────────────────

export type ToolbarGroup = 'left' | 'tools' | 'edit' | 'view' | 'right';
export interface ToolbarItem extends RegistryItem {
  group: ToolbarGroup;
  /** Rendered as-is; use <ToolbarButton> for consistency. */
  component: ComponentType;
  /**
   * App view ids (see `appViews`) in which the item is shown. Omit for "every view". Controls that
   * only act on the 2D plan (tools, zoom, grid, plan overlays) pass `['2d']` so they never sit in the
   * toolbar of the 3D / Elevation / Compare views doing nothing.
   */
  views?: readonly string[];
}
/** Top toolbar items, grouped left → right: left (home/project), tools, edit, view, right (export/help). */
export const toolbarItems = createRegistry<ToolbarItem>('toolbarItems');

// ───────────────────────────── canvas tools ─────────────────────────────

export interface CanvasPointerEvent {
  /** World position (mm). */
  world: Point;
  /** Screen position relative to the canvas (px). */
  screen: Point;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Topmost hit entity under the pointer, if any. */
  target: EntityRef | null;
  /**
   * Name of the editor handle under the pointer, if any (Konva attr `handle`, e.g. 'rotate',
   * 'resize:1:-1', 'measure:a', 'zone-point:2'). Handles are drawn in the overlay slot.
   */
  handle: string | null;
  native: PointerEvent;
}

export interface ToolApi {
  /** px per mm */
  getScale(): number;
  /** Convert a screen (canvas-relative) point to world. */
  toWorld(screen: Point): Point;
  setCursor(cursor: string): void;
  /** Temporarily switch back to the default tool. */
  resetTool(): void;
}

export interface CanvasTool extends RegistryItem {
  label: string;
  icon: LucideIcon;
  /** Single key shortcut shown in tooltips and bound globally (e.g. 'v', 'h'). */
  shortcut?: string;
  /** CSS cursor while active. */
  cursor?: string;
  onActivate?(api: ToolApi): void;
  onDeactivate?(api: ToolApi): void;
  onPointerDown?(e: CanvasPointerEvent, api: ToolApi): void;
  onPointerMove?(e: CanvasPointerEvent, api: ToolApi): void;
  onPointerUp?(e: CanvasPointerEvent, api: ToolApi): void;
  onDoubleClick?(e: CanvasPointerEvent, api: ToolApi): void;
  onKeyDown?(e: KeyboardEvent, api: ToolApi): boolean | void;
  /** Konva nodes drawn in the UI layer while this tool is active (previews, rubber bands). */
  overlay?: ComponentType;
  /** HTML shown in a floating bar at the top of the canvas while the tool is active (modes, options). */
  optionsBar?: ComponentType;
  /** HTML layered over the canvas while the tool is active (typed-entry fields, hints). */
  htmlOverlay?: ComponentType;
  /** Hide from the toolbar picker (internal tools). */
  hidden?: boolean;
}
/** Canvas tools. Order: 10 select, 20 pan, 30+ drawing/measuring tools. */
export const canvasTools = createRegistry<CanvasTool>('canvasTools');

// ───────────────────────────── canvas layers ─────────────────────────────

export type KonvaLayerSlot = 'background' | 'content' | 'overlay' | 'ui';

export interface CanvasLayer extends RegistryItem {
  /** Which shared Konva <Layer> hosts it (few HTML canvases = fast). */
  slot: KonvaLayerSlot;
  /** Konva node(s) in WORLD coordinates (mm). Read state via hooks. */
  component: ComponentType;
  /**
   * If set, this layer is an optional overlay the user can toggle: it appears in the Overlays menu
   * and renders only when `uiStore.overlays[key]` (default `defaultOn`).
   */
  overlay?: { key: string; label: string; defaultOn?: boolean; group?: string; shortcut?: string };
}
/** Canvas layers by slot, drawn in `order` within each slot. */
export const canvasLayers = createRegistry<CanvasLayer>('canvasLayers');

// ───────────────────────────── HTML overlays on the canvas ─────────────────────────────

export interface CanvasHtmlOverlay extends RegistryItem {
  /**
   * HTML rendered absolutely inside the canvas container (rulers, minimap, compass, legends, empty
   * states). Use `pointer-events-none` on anything that should not block the canvas. World → screen:
   * `toScreen(useUiStore(s => s.viewport), worldPoint)` from '@/app/canvas/viewport'.
   */
  component: ComponentType;
}
/** HTML overlays on the plan canvas. Order: 10 rulers, 20 compass, 30 minimap, 50 tool UI, 90 empty state. */
export const canvasOverlays = createRegistry<CanvasHtmlOverlay>('canvasOverlays');

// ───────────────────────────── drag & drop onto the canvas ─────────────────────────────

export interface CanvasDropHandler extends RegistryItem {
  /** MIME type in the DataTransfer this handler accepts (e.g. 'application/x-wp-definition'). */
  type: string;
  drop(data: string, world: Point): void;
}
/** HTML5 drag-and-drop targets on the plan (e.g. library items dragged onto the canvas). */
export const canvasDropHandlers = createRegistry<CanvasDropHandler>('canvasDropHandlers');

// ───────────────────────────── entity adapters ─────────────────────────────

export interface EntityContext {
  project: Project;
  scenario: Scenario;
}

/** A preview patch: a partial entity merged over the stored one while a gesture is live. */
export type EntityPatch = Record<string, unknown>;

/**
 * Generic operations for one entity kind, used by the Select tool (drag, rotate, marquee,
 * nudge), clipboard, duplicate, delete, lock/hide, fit-to-selection and alignment. Register one per
 * kind with `id === kind`. Phases adding a new selectable kind (e.g. 'duct') register an adapter and
 * render nodes with `entityAttrs(kind, id)` + `usePreview(kind, id)`; everything else just works.
 */
export interface EntityAdapter extends RegistryItem {
  kind: EntityKind;
  /** Every id of this kind in the active layout (for marquee / select all). */
  ids(ctx: EntityContext): string[];
  exists(ctx: EntityContext, id: string): boolean;
  name(ctx: EntityContext, id: string): string;
  /** World outline (for marquee, selection bounds, fit-to-selection, alignment). */
  outline(ctx: EntityContext, id: string): Polygon | undefined;
  layer?(ctx: EntityContext, id: string): LayerId | undefined;
  locked?(ctx: EntityContext, id: string): boolean;
  hidden?(ctx: EntityContext, id: string): boolean;
  /** Marquee participation: true (contain or cross), 'contain' (only when fully enclosed), false. */
  marquee?: boolean | 'contain';
  /** Patch that translates the entity by `delta` mm (null = cannot move). */
  translate?(ctx: EntityContext, id: string, delta: Point): EntityPatch | null;
  /** Patch that rotates the entity by `deg` about `pivot` (null = cannot rotate). */
  rotate?(ctx: EntityContext, id: string, pivot: Point, deg: number): EntityPatch | null;
  /** Commands that commit a patch produced by translate/rotate (or a resize). */
  commit?(ctx: EntityContext, id: string, patch: EntityPatch): AppCommand[];
  remove?(ctx: EntityContext, ids: string[]): AppCommand[];
  setFlag?(ctx: EntityContext, ids: string[], flag: 'locked' | 'hidden', value: boolean): AppCommand[];
  /** Deep copy for the clipboard (JSON-safe). */
  copy?(ctx: EntityContext, id: string): unknown;
  /** Commands that add a pasted copy with a new id, shifted by `offset`. */
  paste?(ctx: EntityContext, data: unknown, newId: string, offset: Point): AppCommand[];
}
export const entityAdapters = createRegistry<EntityAdapter>('entityAdapters');

// ───────────────────────────── command palette ─────────────────────────────

export interface PaletteContext {
  project: Project | null;
  selection: readonly EntityRef[];
}
export interface PaletteCommand extends RegistryItem {
  title: string;
  section: string;
  keywords?: string[];
  shortcut?: string;
  icon?: LucideIcon;
  /** Hide when not applicable. */
  when?(ctx: PaletteContext): boolean;
  run(ctx: PaletteContext): void;
}
/** Ctrl/Cmd+K command palette entries. */
export const paletteCommands = createRegistry<PaletteCommand>('paletteCommands');

// ───────────────────────────── keyboard shortcuts ─────────────────────────────

export interface Shortcut extends RegistryItem {
  /** e.g. 'mod+z', 'mod+shift+z', 'delete', 'escape', 'r'. `mod` = Cmd on macOS, Ctrl elsewhere. */
  keys: string | string[];
  description: string;
  /** Return false to let the event continue to other handlers. */
  run(e: KeyboardEvent): boolean | void;
  when?(): boolean;
  /** Fire even when focus is in a text field (default false). */
  allowInInputs?: boolean;
}
export const shortcuts = createRegistry<Shortcut>('shortcuts');

// ───────────────────────────── export formats ─────────────────────────────

export interface ExportContext {
  project: Project;
  scenarioId: string;
}
export interface ExportFormat extends RegistryItem {
  label: string;
  description: string;
  extension: string;
  icon?: LucideIcon;
  /** Produce the file. The shell downloads it. */
  export(ctx: ExportContext): Promise<{ blob: Blob; fileName: string }>;
  /**
   * Formats with options (PDF paper size, PNG resolution…) provide a dialog body instead; the shell
   * opens it in a dialog when the format is chosen, and `onDone` closes it.
   */
  customUi?: ComponentType<{ ctx: ExportContext; onDone(): void }>;
}
/** Export menu entries. Order: 10 JSON, 20 PNG, 30 SVG, 40 PDF, 50 CSV, 60 DXF. */
export const exportFormats = createRegistry<ExportFormat>('exportFormats');

// ───────────────────────────── top-level views ─────────────────────────────

export interface AppView extends RegistryItem {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Fills the center area. */
  component: ComponentType;
}
/** Center-area views/modes. Order: 10 2D plan, 20 3D, 30 elevation, 40 compare. */
export const appViews = createRegistry<AppView>('appViews');

// ───────────────────────────── status bar ─────────────────────────────

export interface StatusBarItem extends RegistryItem {
  align: 'left' | 'right';
  component: ComponentType;
}
export const statusBarItems = createRegistry<StatusBarItem>('statusBarItems');

// ───────────────────────────── context menu (canvas right-click) ─────────────────────────────

export interface ContextMenuAction extends RegistryItem {
  /** Items are grouped by `group` with separators between groups (group order = first item order). */
  group: string;
  label: string | ((ctx: SelectionContext) => string);
  icon?: LucideIcon;
  shortcut?: string;
  destructive?: boolean;
  appliesTo(ctx: SelectionContext): boolean;
  disabled?(ctx: SelectionContext): boolean;
  run(ctx: SelectionContext): void;
}
export const contextMenuActions = createRegistry<ContextMenuAction>('contextMenuActions');

// ───────────────────────────── home screen ─────────────────────────────

export interface HomePanel extends RegistryItem {
  component: ComponentType;
}
/** Extra panels on the project list screen (e.g. "Start from a template"). */
export const homePanels = createRegistry<HomePanel>('homePanels');

export type { ReactNode };

// ───────────── always-mounted editor components ─────────────

export interface ShellExtra extends RegistryItem {
  /** Rendered once inside the editor shell (dialog hosts, guided tour, toasts). */
  component: ComponentType;
}
/** Components mounted once in the editor shell regardless of view (dialog hosts, the guided tour…). */
export const shellExtras = createRegistry<ShellExtra>('shellExtras');
