/**
 * UI / view state: never persisted in the project and never part of undo history.
 * (Per-browser conveniences like the last left-panel section are kept in localStorage via `persistUi`.)
 */
import { create } from 'zustand';
import type { EntityKind, EntityRef } from '@/domain/schema';
import type { Point } from '@/geometry';

export interface Viewport {
  /** Stage translation in CSS px. */
  x: number;
  y: number;
  /** Pixels per millimeter. */
  scale: number;
  /** View rotation in degrees (multiples of 90): which compass direction is up. 0 = north up. */
  rotation?: number;
}

export interface UiState {
  /** Top-level view id (see viewRegistry): '2d' by default. */
  view: string;
  /** Active canvas tool id (see toolRegistry). */
  tool: string;
  selection: EntityRef[];
  hovered: EntityRef | null;
  viewport: Viewport;
  /** Canvas size in CSS px (kept by the canvas container). */
  canvasSize: { width: number; height: number };
  /** Overlay toggles by overlay id (see canvasLayerRegistry `overlayKey`). */
  overlays: Record<string, boolean>;
  /** World cursor position (mm) or null when outside the canvas. */
  cursor: Point | null;
  /** True while the snap-disable modifier (Alt) is held. */
  snapSuppressed: boolean;
  leftSection: string | null;
  inspectorTab: string | null;
  commandPaletteOpen: boolean;
  /** Transient message in the status bar. */
  status: { text: string; tone: 'info' | 'warning' | 'error' } | null;
  /** Pending fit-to-room request (bumped to trigger a fit). */
  fitRequest: number;
}

const initial: UiState = {
  view: '2d',
  tool: 'select',
  selection: [],
  hovered: null,
  viewport: { x: 0, y: 0, scale: 0.12 },
  canvasSize: { width: 800, height: 600 },
  overlays: {},
  cursor: null,
  snapSuppressed: false,
  leftSection: null,
  inspectorTab: null,
  commandPaletteOpen: false,
  status: null,
  fitRequest: 0,
};

export const useUiStore = create<UiState>()(() => ({ ...initial }));

export const uiActions = {
  reset(): void {
    const s = useUiStore.getState();
    // Keep per-browser layout state (panel choice, measured canvas size) across project switches.
    useUiStore.setState({ ...initial, leftSection: s.leftSection, canvasSize: s.canvasSize, fitRequest: s.fitRequest });
  },
  setView(view: string): void {
    useUiStore.setState({ view });
  },
  setTool(tool: string): void {
    useUiStore.setState({ tool });
  },
  select(refs: EntityRef[]): void {
    useUiStore.setState({ selection: refs });
  },
  selectOne(kind: EntityKind, id: string, additive = false): void {
    const cur = useUiStore.getState().selection;
    if (!additive) {
      useUiStore.setState({ selection: [{ kind, id }] });
      return;
    }
    const exists = cur.some((r) => r.kind === kind && r.id === id);
    useUiStore.setState({ selection: exists ? cur.filter((r) => !(r.kind === kind && r.id === id)) : [...cur, { kind, id }] });
  },
  clearSelection(): void {
    if (useUiStore.getState().selection.length) useUiStore.setState({ selection: [] });
  },
  setHovered(ref: EntityRef | null): void {
    const cur = useUiStore.getState().hovered;
    if (cur?.id === ref?.id && cur?.kind === ref?.kind) return;
    useUiStore.setState({ hovered: ref });
  },
  setViewport(viewport: Viewport): void {
    useUiStore.setState({ viewport });
  },
  setCanvasSize(width: number, height: number): void {
    const s = useUiStore.getState().canvasSize;
    if (s.width !== width || s.height !== height) useUiStore.setState({ canvasSize: { width, height } });
  },
  setOverlay(key: string, on: boolean): void {
    useUiStore.setState((s) => ({ overlays: { ...s.overlays, [key]: on } }));
  },
  toggleOverlay(key: string, defaultOn = false): void {
    useUiStore.setState((s) => ({ overlays: { ...s.overlays, [key]: !(s.overlays[key] ?? defaultOn) } }));
  },
  setCursor(p: Point | null): void {
    useUiStore.setState({ cursor: p });
  },
  setSnapSuppressed(v: boolean): void {
    if (useUiStore.getState().snapSuppressed !== v) useUiStore.setState({ snapSuppressed: v });
  },
  setLeftSection(id: string | null): void {
    useUiStore.setState({ leftSection: id });
  },
  setInspectorTab(id: string | null): void {
    useUiStore.setState({ inspectorTab: id });
  },
  setCommandPaletteOpen(open: boolean): void {
    useUiStore.setState({ commandPaletteOpen: open });
  },
  flash(text: string, tone: 'info' | 'warning' | 'error' = 'info'): void {
    useUiStore.setState({ status: { text, tone } });
  },
  clearStatus(): void {
    useUiStore.setState({ status: null });
  },
  requestFit(): void {
    useUiStore.setState((s) => ({ fitRequest: s.fitRequest + 1 }));
  },
};

/** Overlay on/off with a default for keys never toggled. */
export const isOverlayOn = (s: UiState, key: string, defaultOn = false): boolean => s.overlays[key] ?? defaultOn;

/** Selected ids of one kind. */
export const selectedIdsOf = (s: UiState, kind: EntityKind): string[] => s.selection.filter((r) => r.kind === kind).map((r) => r.id);
