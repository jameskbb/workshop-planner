/**
 * Greedy label placement for the plan (pure, screen-space px).
 *
 * Every label asks for a few anchor positions in order of preference (inside the footprint, above
 * it, below it, to the left, to the right). Labels are placed one at a time, biggest/most important
 * first; a label takes the first position that hits neither an already placed label nor a fixed
 * obstacle (glyphs, other footprints). If nothing is free the label is dropped rather than drawn on
 * top of something, so the plan stays readable and the inspector still shows the name.
 */

export interface Rect {
  /** Center. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelCandidate {
  id: string;
  /** Anchor in screen px (the point the offsets are measured from). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offsets to try, in order of preference (screen px). */
  offsets: ReadonlyArray<{ dx: number; dy: number }>;
  /** Higher wins ties and is placed first (selected items, big items). */
  priority: number;
}

export interface LabelPlacement {
  dx: number;
  dy: number;
  /** No free position: do not draw this label. */
  hidden: boolean;
}

const PAD = 2;

export function rectsOverlap(a: Rect, b: Rect, pad = PAD): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;
}

/**
 * Placements keyed by candidate id. `obstacles` are fixed rectangles labels must avoid (symbols,
 * glyphs, other layers' text that is already committed).
 */
export function layoutLabels(candidates: readonly LabelCandidate[], obstacles: readonly Rect[] = []): Map<string, LabelPlacement> {
  const out = new Map<string, LabelPlacement>();
  const taken: Rect[] = [...obstacles];
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const c of ordered) {
    let placed: LabelPlacement | null = null;
    for (const o of c.offsets) {
      const r: Rect = { x: c.x + o.dx, y: c.y + o.dy, w: c.w, h: c.h };
      if (taken.some((t) => rectsOverlap(r, t))) continue;
      taken.push(r);
      placed = { dx: o.dx, dy: o.dy, hidden: false };
      break;
    }
    out.set(c.id, placed ?? { dx: c.offsets[0]?.dx ?? 0, dy: c.offsets[0]?.dy ?? 0, hidden: true });
  }
  return out;
}

/** Rough width of a single line of text in px (Inter at `fontSize`), good enough for collisions. */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}
