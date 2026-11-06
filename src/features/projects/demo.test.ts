import { describe, expect, it } from 'vitest';
import { analyzeLayout } from '@/analysis';
import { createDemoProject } from './demo';

describe('demo project', () => {
  const project = createDemoProject();
  const warnings = analyzeLayout(project).filter((w) => w.severity === 'warning');

  it('is crowded on purpose but never impossible: the car drives in and the entry door opens', () => {
    // First impression matters: the demo keeps its teaching warnings (outfeed, drawer pull-out,
    // planer infeed) but must not open with problems that make the layout unusable.
    expect(warnings.filter((w) => w.id.startsWith('vehicle-entry'))).toEqual([]);
    expect(warnings.filter((w) => w.id.startsWith('doorway'))).toEqual([]);
    expect(warnings.some((w) => /outfeed clearance/.test(w.message))).toBe(true);
    expect(warnings.some((w) => /drawer pull-out/.test(w.message))).toBe(true);
    expect(warnings.some((w) => /Mobile planer/.test(w.message))).toBe(true);
  });

  it('has no overlaps or out-of-room items', () => {
    expect(warnings.filter((w) => w.id.startsWith('overlap'))).toEqual([]);
    expect(warnings.filter((w) => w.id.startsWith('bounds'))).toEqual([]);
  });
});
