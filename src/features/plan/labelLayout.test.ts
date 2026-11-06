import { describe, expect, it } from 'vitest';
import { layoutLabels, rectsOverlap, textWidth, type LabelCandidate } from './labelLayout';

const at = (id: string, x: number, y: number, offsets = [{ dx: 0, dy: 0 }], priority = 0): LabelCandidate => ({ id, x, y, w: 60, h: 13, offsets, priority });

describe('label layout', () => {
  it('keeps a lone label at its first choice', () => {
    const out = layoutLabels([at('a', 0, 0)]);
    expect(out.get('a')).toEqual({ dx: 0, dy: 0, hidden: false });
  });

  it('moves the second label to its next free position instead of printing on top', () => {
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: 0, dy: -20 },
      { dx: 0, dy: 20 },
    ];
    const out = layoutLabels([at('a', 0, 0, offsets, 10), at('b', 0, 0, offsets, 1)]);
    expect(out.get('a')).toEqual({ dx: 0, dy: 0, hidden: false });
    expect(out.get('b')!.hidden).toBe(false);
    expect(out.get('b')!.dy).not.toBe(0);
  });

  it('drops a label that has nowhere free rather than overlapping', () => {
    const one = [{ dx: 0, dy: 0 }];
    const out = layoutLabels([at('a', 0, 0, one, 10), at('b', 5, 0, one, 1)]);
    expect(out.get('a')!.hidden).toBe(false);
    expect(out.get('b')!.hidden).toBe(true);
  });

  it('avoids fixed obstacles (outlet glyphs)', () => {
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: 0, dy: 40 },
    ];
    const out = layoutLabels([at('a', 0, 0, offsets)], [{ x: 0, y: 0, w: 26, h: 26 }]);
    expect(out.get('a')).toEqual({ dx: 0, dy: 40, hidden: false });
  });

  it('places the highest priority candidate first regardless of input order', () => {
    const offsets = [
      { dx: 0, dy: 0 },
      { dx: 0, dy: 30 },
    ];
    const out = layoutLabels([at('small', 0, 0, offsets, 1), at('big', 0, 0, offsets, 100)]);
    expect(out.get('big')!.dy).toBe(0);
    expect(out.get('small')!.dy).toBe(30);
  });

  it('rectsOverlap and textWidth behave sanely', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 40, y: 0, w: 10, h: 10 })).toBe(false);
    expect(textWidth('Table saw', 11)).toBeGreaterThan(textWidth('Saw', 11));
  });
});
