/**
 * The 2D plan canvas: a Konva Stage in world coordinates (mm) hosting four shared layers
 * (background, content, overlay, ui) into which registered canvas layers render. Pointer events
 * are routed to the active tool; wheel/trackpad zoom & pan, space-drag and middle-drag pan are
 * handled here for every tool. HTML overlays (rulers, minimap, tool option bars, typed entry) are
 * layered on top from the `canvasOverlays` registry and the active tool.
 */
import type Konva from 'konva';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Layer, Stage } from 'react-konva';
import {
  canvasDropHandlers,
  canvasLayers,
  canvasOverlays,
  canvasTools,
  type CanvasLayer,
  type CanvasPointerEvent,
  type CanvasTool,
  type KonvaLayerSlot,
  type ToolApi,
} from '@/app/registry';
import { useElementSize } from '@/hooks/useElementSize';
import { uiActions, useUiStore } from '@/stores/uiStore';
import { useProjectStore } from '@/stores/projectStore';
import { roomGeometry } from '@/domain/resolve';
import { bbox, type BBox, type Point } from '@/geometry';
import type { EntityKind, EntityRef } from '@/domain/schema';
import { canvasColors } from '@/styles/tokens';
import { fitBounds, toWorld, zoomAt } from './viewport';
import { CanvasContextMenu } from './CanvasContextMenu';

const SLOTS: KonvaLayerSlot[] = ['background', 'content', 'overlay', 'ui'];

/** Attributes marking a Konva node as a pickable entity. */
export function entityAttrs(kind: EntityKind, id: string): { entityKind: EntityKind; entityId: string } {
  return { entityKind: kind, entityId: id };
}

/** Attributes marking a Konva node as an editor handle (reported as `CanvasPointerEvent.handle`). */
export function handleAttrs(handle: string): { handle: string } {
  return { handle };
}

function findEntity(node: Konva.Node | null): EntityRef | null {
  let n: Konva.Node | null = node;
  while (n) {
    const kind = n.getAttr('entityKind') as EntityKind | undefined;
    const id = n.getAttr('entityId') as string | undefined;
    if (kind && id) return { kind, id };
    n = n.getParent();
  }
  return null;
}

function findHandle(node: Konva.Node | null): string | null {
  let n: Konva.Node | null = node;
  while (n) {
    const h = n.getAttr('handle') as string | undefined;
    if (h) return h;
    n = n.getParent();
  }
  return null;
}

// ───────────── tool API (module singleton so keyboard routing can reach the active tool) ─────────────

let containerEl: HTMLDivElement | null = null;

export const toolApi: ToolApi = {
  getScale: () => useUiStore.getState().viewport.scale,
  toWorld: (p) => toWorld(useUiStore.getState().viewport, p),
  setCursor: (c) => {
    if (containerEl && containerEl.style.cursor !== c) containerEl.style.cursor = c;
  },
  resetTool: () => uiActions.setTool('select'),
};

export function activeTool(): CanvasTool | undefined {
  const id = useUiStore.getState().tool;
  const tools = canvasTools.list();
  return tools.find((t) => t.id === id) ?? tools[0];
}

/** Give the active tool first refusal on a key press (Esc, Backspace, typed lengths…). */
export function routeKeyToTool(e: KeyboardEvent): boolean {
  const tool = activeTool();
  if (!tool?.onKeyDown) return false;
  return tool.onKeyDown(e, toolApi) === true;
}

/** Focus the canvas (so keyboard shortcuts go to the plan). */
export function focusCanvas(): void {
  containerEl?.focus({ preventScroll: true });
}

// ───────────── fitting ─────────────

/** Imperatively fit a world box into view (keeps the current orientation). */
export function fitBoxToView(box: BBox, padding = 56): void {
  const { canvasSize, viewport } = useUiStore.getState();
  if (canvasSize.width < 10) return;
  uiActions.setViewport(fitBounds(box, canvasSize, padding, viewport.rotation ?? 0));
}

/** Imperatively fit the room (or everything) into view. */
export function fitRoomToView(): void {
  const project = useProjectStore.getState().project;
  const { canvasSize } = useUiStore.getState();
  if (!project || canvasSize.width < 10) return;
  const poly = project.room.vertices;
  if (poly.length >= 3) {
    const g = roomGeometry(project.room);
    const t = Math.max(0, ...g.thickness);
    const b = bbox(g.polygon);
    fitBoxToView({ minX: b.minX - t, minY: b.minY - t, maxX: b.maxX + t, maxY: b.maxY + t });
  } else {
    // Blank project: show a 30' × 20' area around the origin.
    fitBoxToView({ minX: -500, minY: -500, maxX: 9144, maxY: 6096 });
  }
}

const SlotLayer = memo(function SlotLayer({ slot, layers }: { slot: KonvaLayerSlot; layers: readonly CanvasLayer[] }) {
  const overlays = useUiStore((s) => s.overlays);
  const visible = layers.filter((l) => l.slot === slot && (!l.overlay || (overlays[l.overlay.key] ?? l.overlay.defaultOn ?? false)));
  return (
    <Layer listening={slot === 'content' || slot === 'overlay'}>
      {visible.map((l) => (
        <l.component key={l.id} />
      ))}
    </Layer>
  );
});

function HtmlOverlays({ tool }: { tool: CanvasTool | undefined }) {
  const overlays = canvasOverlays.useItems();
  const OptionsBar = tool?.optionsBar;
  const ToolHtml = tool?.htmlOverlay;
  return (
    <>
      {overlays.map((o) => (
        <o.component key={o.id} />
      ))}
      {ToolHtml && <ToolHtml />}
      {OptionsBar && (
        <div className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-line-strong bg-panel/95 px-1.5 py-1 shadow-lg shadow-black/30 backdrop-blur" role="toolbar" aria-label={`${tool.label} options`}>
            <OptionsBar />
          </div>
        </div>
      )}
    </>
  );
}

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(containerRef);
  const viewport = useUiStore((s) => s.viewport);
  const toolId = useUiStore((s) => s.tool);
  const fitRequest = useUiStore((s) => s.fitRequest);
  const layers = canvasLayers.useItems();
  const tools = canvasTools.useItems();
  const tool = tools.find((t) => t.id === toolId) ?? tools[0];
  const panState = useRef<{ start: Point; origin: Point } | null>(null);
  const spaceDown = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    containerEl = el;
    return () => {
      if (containerEl === el) containerEl = null;
    };
  }, []);

  useEffect(() => {
    uiActions.setCanvasSize(size.width, size.height);
  }, [size.width, size.height]);

  // Fit on open / on request. The layout may still be settling (sidebars mounting), so keep
  // re-fitting on size changes until the user takes control of the view.
  const pendingFit = useRef(false);
  useEffect(() => {
    pendingFit.current = true;
  }, [fitRequest]);
  useEffect(() => {
    if (pendingFit.current && size.width > 10 && size.height > 10) fitRoomToView();
  }, [fitRequest, size.width, size.height]);
  const userTookControl = () => {
    pendingFit.current = false;
  };

  // Tool lifecycle.
  useEffect(() => {
    if (!tool) return;
    toolApi.setCursor(tool.cursor ?? 'default');
    tool.onActivate?.(toolApi);
    return () => tool.onDeactivate?.(toolApi);
  }, [tool]);

  // Space-to-pan and Alt (snap suppression) tracking.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') uiActions.setSnapSuppressed(true);
      if (e.code === 'Space' && !isTyping(e.target)) {
        spaceDown.current = true;
        toolApi.setCursor('grab');
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') uiActions.setSnapSuppressed(false);
      if (e.code === 'Space') {
        spaceDown.current = false;
        toolApi.setCursor(tool?.cursor ?? 'default');
      }
    };
    const blur = () => {
      spaceDown.current = false;
      uiActions.setSnapSuppressed(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [tool]);

  const makeEvent = useCallback((evt: Konva.KonvaEventObject<PointerEvent>): CanvasPointerEvent | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const native = evt.evt;
    const hit = evt.target === stage ? null : evt.target;
    return {
      world: toWorld(useUiStore.getState().viewport, pos),
      screen: pos,
      button: native.button,
      shiftKey: native.shiftKey,
      altKey: native.altKey,
      ctrlKey: native.ctrlKey,
      metaKey: native.metaKey,
      target: findEntity(hit),
      handle: findHandle(hit),
      native,
    };
  }, []);

  const onPointerDown = (evt: Konva.KonvaEventObject<PointerEvent>) => {
    userTookControl();
    const e = makeEvent(evt);
    if (!e) return;
    containerRef.current?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      const v = useUiStore.getState().viewport;
      panState.current = { start: e.screen, origin: { x: v.x, y: v.y } };
      toolApi.setCursor('grabbing');
      evt.evt.preventDefault();
      return;
    }
    if (e.button === 2) {
      // Right-click selects the target for the context menu.
      if (e.target && !useUiStore.getState().selection.some((r) => r.id === e.target!.id)) uiActions.select([e.target]);
      return;
    }
    tool?.onPointerDown?.(e, toolApi);
  };

  const onPointerMove = (evt: Konva.KonvaEventObject<PointerEvent>) => {
    const e = makeEvent(evt);
    if (!e) return;
    uiActions.setCursor(e.world);
    if (panState.current) {
      const p = panState.current;
      const v = useUiStore.getState().viewport;
      uiActions.setViewport({ ...v, x: p.origin.x + (e.screen.x - p.start.x), y: p.origin.y + (e.screen.y - p.start.y) });
      return;
    }
    uiActions.setHovered(e.target);
    tool?.onPointerMove?.(e, toolApi);
  };

  const onPointerUp = (evt: Konva.KonvaEventObject<PointerEvent>) => {
    const e = makeEvent(evt);
    if (panState.current) {
      panState.current = null;
      toolApi.setCursor(spaceDown.current ? 'grab' : (tool?.cursor ?? 'default'));
      return;
    }
    if (e) tool?.onPointerUp?.(e, toolApi);
  };

  const onDblClick = (evt: Konva.KonvaEventObject<MouseEvent>) => {
    const e = makeEvent(evt as unknown as Konva.KonvaEventObject<PointerEvent>);
    if (e) tool?.onDoubleClick?.(e, toolApi);
  };

  const onWheel = (evt: Konva.KonvaEventObject<WheelEvent>) => {
    evt.evt.preventDefault();
    userTookControl();
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    const w = evt.evt;
    const v = useUiStore.getState().viewport;
    // Pinch (ctrl+wheel) or a classic mouse wheel zooms; two-finger trackpad scroll pans.
    const mouseWheel = w.deltaMode === 1 || (w.deltaX === 0 && Math.abs(w.deltaY) >= 50 && Number.isInteger(w.deltaY));
    if (w.ctrlKey || w.metaKey || mouseWheel) {
      const factor = Math.exp(-w.deltaY * (w.ctrlKey && !mouseWheel ? 0.01 : 0.0015));
      uiActions.setViewport(zoomAt(v, pos, factor));
    } else {
      uiActions.setViewport({ ...v, x: v.x - w.deltaX, y: v.y - w.deltaY });
    }
  };

  const onLeave = () => {
    uiActions.setCursor(null);
    uiActions.setHovered(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (canvasDropHandlers.list().some((h) => e.dataTransfer.types.includes(h.type))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    for (const h of canvasDropHandlers.list()) {
      const data = e.dataTransfer.getData(h.type);
      if (!data) continue;
      e.preventDefault();
      userTookControl();
      h.drop(data, toWorld(useUiStore.getState().viewport, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
      containerRef.current?.focus({ preventScroll: true });
      return;
    }
  };

  return (
    <CanvasContextMenu>
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Floor plan canvas"
        aria-roledescription="Floor plan editor. Use the toolbar tools; arrow keys nudge the selection."
        data-testid="plan-canvas"
        className="relative size-full overflow-hidden outline-none"
        style={{ background: canvasColors.outside }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {size.width > 0 && size.height > 0 && (
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            rotation={viewport.rotation ?? 0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDblClick={onDblClick}
            onWheel={onWheel}
            onPointerLeave={onLeave}
          >
            {SLOTS.map((slot) => (
              <SlotLayer key={slot} slot={slot} layers={layers} />
            ))}
            {tool?.overlay && (
              <Layer listening={false}>
                <tool.overlay />
              </Layer>
            )}
          </Stage>
        )}
        <HtmlOverlays tool={tool} />
      </div>
    </CanvasContextMenu>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}
