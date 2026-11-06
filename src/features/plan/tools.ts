/**
 * Base canvas tools: Select (implemented in features/editor/selectTool.ts: selection, marquee,
 * snapping drag, rotate/resize handles, room corners/walls) and Pan.
 */
import { Hand } from 'lucide-react';
import type { CanvasTool } from '@/app/registry';
import type { Point } from '@/geometry';
import { uiActions, useUiStore } from '@/stores/uiStore';

export { selectTool } from '@/features/editor/selectTool';

let pan: { start: Point; origin: Point } | null = null;

export const panTool: CanvasTool = {
  id: 'pan',
  label: 'Pan',
  icon: Hand,
  shortcut: 'h',
  cursor: 'grab',
  order: 20,
  onPointerDown(e, api) {
    const v = useUiStore.getState().viewport;
    pan = { start: e.screen, origin: { x: v.x, y: v.y } };
    api.setCursor('grabbing');
  },
  onPointerMove(e) {
    if (!pan) return;
    const v = useUiStore.getState().viewport;
    uiActions.setViewport({ ...v, x: pan.origin.x + e.screen.x - pan.start.x, y: pan.origin.y + e.screen.y - pan.start.y });
  },
  onPointerUp(_e, api) {
    pan = null;
    api.setCursor('grab');
  },
};
