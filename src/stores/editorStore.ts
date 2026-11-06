/**
 * Transient editor state: live drag previews, snapping guides, marquee, HUD labels, the clipboard,
 * pending placements and editor dialogs. Never persisted, never in undo history.
 *
 * Live previews: while dragging/rotating/resizing, tools write PATCHES here instead of dispatching
 * a command every frame (no project-store churn → no autosave/analysis/history work per frame).
 * Canvas nodes merge their patch over the stored entity (`usePreview(kind, id)`); the gesture
 * commits ONE command on release. Any layer drawing entity geometry should merge the preview too.
 */
import { create } from 'zustand';
import type { EntityKind, EntityRef, Vertex } from '@/domain/schema';
import type { BBox, Guide, Point } from '@/geometry';

export const previewKey = (kind: EntityKind | string, id: string): string => `${kind}:${id}`;

export interface Hud {
  /** Lines of text shown next to the cursor (e.g. "12' 4\"  ∠ 90°"). */
  lines: string[];
  /** Screen position (px, canvas-relative). */
  at: Point;
  tone?: 'info' | 'error';
}

/** A live distance label drawn while dragging (object edge → nearest obstacle). */
export interface GapLabel {
  from: Point;
  to: Point;
  value: number;
}

export interface ClipboardEntry {
  kind: EntityKind;
  /** Deep copy of the entity. */
  data: unknown;
}
export interface Clipboard {
  entries: ClipboardEntry[];
  /** Object definitions needed to paste the objects into any project. */
  definitions: unknown[];
  /** Groups referenced by copied objects. */
  groups: Array<{ id: string; name: string; locked: boolean }>;
  projectId: string;
  scenarioId: string;
  /** How many times this clipboard has been pasted (for cascading offsets). */
  pastes: number;
}

/** Something waiting to be placed with a click (architecture, electrical, light, vehicle, object). */
export interface PlacementRequest {
  kind: 'feature' | 'electrical' | 'light' | 'vehicle' | 'object';
  /** Template/definition id. */
  templateId: string;
  label: string;
}

export interface EditorDialog {
  id: string;
  props?: Record<string, unknown>;
}

export interface EditorState {
  previews: Readonly<Record<string, unknown>>;
  /** Live room corners while a corner or wall is being dragged. */
  roomPreview: Vertex[] | null;
  guides: Guide[];
  marquee: { box: BBox; mode: 'contain' | 'cross' } | null;
  hud: Hud | null;
  gaps: GapLabel[];
  clipboard: Clipboard | null;
  placing: PlacementRequest | null;
  dialog: EditorDialog | null;
  /** Entity the pointer is over a handle of (for hover styling). */
  hoverHandle: string | null;
  /** Ids to briefly highlight (e.g. after "select in plan"). */
  flashRefs: EntityRef[];
}

export const useEditorStore = create<EditorState>()(() => ({
  previews: {},
  roomPreview: null,
  guides: [],
  marquee: null,
  hud: null,
  gaps: [],
  clipboard: null,
  placing: null,
  dialog: null,
  hoverHandle: null,
  flashRefs: [],
}));

export const editorActions = {
  setPreviews(previews: Record<string, unknown>): void {
    useEditorStore.setState({ previews });
  },
  clearGesture(): void {
    useEditorStore.setState({ previews: {}, roomPreview: null, guides: [], marquee: null, hud: null, gaps: [] });
  },
  setRoomPreview(v: Vertex[] | null): void {
    useEditorStore.setState({ roomPreview: v });
  },
  setGuides(guides: Guide[]): void {
    const cur = useEditorStore.getState().guides;
    if (cur.length === 0 && guides.length === 0) return;
    useEditorStore.setState({ guides });
  },
  setMarquee(m: EditorState['marquee']): void {
    useEditorStore.setState({ marquee: m });
  },
  setHud(hud: Hud | null): void {
    if (!hud && !useEditorStore.getState().hud) return;
    useEditorStore.setState({ hud });
  },
  setGaps(gaps: GapLabel[]): void {
    if (gaps.length === 0 && useEditorStore.getState().gaps.length === 0) return;
    useEditorStore.setState({ gaps });
  },
  setClipboard(c: Clipboard | null): void {
    useEditorStore.setState({ clipboard: c });
  },
  setPlacing(p: PlacementRequest | null): void {
    useEditorStore.setState({ placing: p });
  },
  openDialog(id: string, props?: Record<string, unknown>): void {
    useEditorStore.setState({ dialog: { id, props } });
  },
  closeDialog(): void {
    useEditorStore.setState({ dialog: null });
  },
  setHoverHandle(h: string | null): void {
    if (useEditorStore.getState().hoverHandle !== h) useEditorStore.setState({ hoverHandle: h });
  },
};

/** The live preview patch for one entity (undefined when it is not being manipulated). */
export function usePreview<T>(kind: EntityKind | string, id: string): Partial<T> | undefined {
  return useEditorStore((s) => s.previews[previewKey(kind, id)] as Partial<T> | undefined);
}

/** Merge a preview patch over an entity (returns the same object when there is no patch). */
export function withPreview<T extends object>(entity: T, patch: Partial<T> | undefined): T {
  return patch ? { ...entity, ...patch } : entity;
}
