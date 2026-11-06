/**
 * Alignment and distribution of selections (Figma semantics): operations act on each item's
 * world axis-aligned bounds and return per-item translations. Locked items can be passed as
 * `fixed` so they act as anchors but never move.
 */
import { bboxCenter, bboxUnion, type BBox } from './polygon';

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-horizontal' | 'center-vertical';
export type DistributeAxis = 'horizontal' | 'vertical';

export interface AlignItem {
  id: string;
  bbox: BBox;
  fixed?: boolean;
}

export interface Translation {
  id: string;
  dx: number;
  dy: number;
}

/**
 * Align items to the selection bounds (or to the bounds of the fixed items, if any are fixed).
 * 'center-horizontal' aligns centers on a vertical line (x); 'center-vertical' on a horizontal line (y).
 */
export function alignItems(items: AlignItem[], mode: AlignMode): Translation[] {
  if (items.length < 2) return items.map((i) => ({ id: i.id, dx: 0, dy: 0 }));
  const anchors = items.filter((i) => i.fixed);
  const ref = bboxUnion(...(anchors.length ? anchors : items).map((i) => i.bbox));
  const rc = bboxCenter(ref);
  return items.map((i) => {
    if (i.fixed) return { id: i.id, dx: 0, dy: 0 };
    const c = bboxCenter(i.bbox);
    switch (mode) {
      case 'left':
        return { id: i.id, dx: ref.minX - i.bbox.minX, dy: 0 };
      case 'right':
        return { id: i.id, dx: ref.maxX - i.bbox.maxX, dy: 0 };
      case 'top':
        return { id: i.id, dx: 0, dy: ref.minY - i.bbox.minY };
      case 'bottom':
        return { id: i.id, dx: 0, dy: ref.maxY - i.bbox.maxY };
      case 'center-horizontal':
        return { id: i.id, dx: rc.x - c.x, dy: 0 };
      case 'center-vertical':
        return { id: i.id, dx: 0, dy: rc.y - c.y };
    }
  });
}

/**
 * Distribute items so the gaps between consecutive items are equal. The first and last items
 * (by position along the axis) stay put. Needs at least 3 items.
 */
export function distributeItems(items: AlignItem[], axis: DistributeAxis): Translation[] {
  const zero = items.map((i) => ({ id: i.id, dx: 0, dy: 0 }));
  if (items.length < 3) return zero;
  const lo = (b: BBox) => (axis === 'horizontal' ? b.minX : b.minY);
  const hi = (b: BBox) => (axis === 'horizontal' ? b.maxX : b.maxY);
  const sorted = [...items].sort((a, b) => lo(a.bbox) + hi(a.bbox) - (lo(b.bbox) + hi(b.bbox)));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const span = hi(last.bbox) - lo(first.bbox);
  const sizes = sorted.reduce((s, i) => s + (hi(i.bbox) - lo(i.bbox)), 0);
  const gap = (span - sizes) / (sorted.length - 1);
  const result = new Map<string, Translation>();
  let cursor = lo(first.bbox);
  for (const item of sorted) {
    const delta = item === first || item === last || item.fixed ? 0 : cursor - lo(item.bbox);
    result.set(item.id, axis === 'horizontal' ? { id: item.id, dx: delta, dy: 0 } : { id: item.id, dx: 0, dy: delta });
    cursor += hi(item.bbox) - lo(item.bbox) + gap;
  }
  return items.map((i) => result.get(i.id)!);
}

/** Gap between two boxes along an axis (negative if overlapping). */
export function gapBetween(a: BBox, b: BBox, axis: DistributeAxis): number {
  return axis === 'horizontal'
    ? Math.max(b.minX - a.maxX, a.minX - b.maxX)
    : Math.max(b.minY - a.maxY, a.minY - b.maxY);
}
