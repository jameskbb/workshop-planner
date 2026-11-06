import { describe, expect, it } from 'vitest';
import { adaptiveGrid, clampScale, fitBounds, MAX_SCALE, MIN_SCALE, toScreen, toWorld, visibleWorld, zoomAt } from './viewport';

describe('viewport math', () => {
  const v = { x: 100, y: 50, scale: 0.2 };
  it('world ↔ screen round-trip', () => {
    const w = { x: 1234, y: -567 };
    const back = toWorld(v, toScreen(v, w));
    expect(back.x).toBeCloseTo(w.x);
    expect(back.y).toBeCloseTo(w.y);
  });
  it('zoom keeps the point under the cursor fixed', () => {
    const cursor = { x: 400, y: 300 };
    const before = toWorld(v, cursor);
    const z = zoomAt(v, cursor, 1.5);
    expect(z.scale).toBeCloseTo(0.3);
    const after = toWorld(z, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
  it('scale is clamped', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(zoomAt(v, { x: 0, y: 0 }, 1e9).scale).toBe(MAX_SCALE);
  });
  it('fits a box centered with padding', () => {
    const f = fitBounds({ minX: 0, minY: 0, maxX: 6000, maxY: 3000 }, { width: 1000, height: 800 }, 50);
    expect(f.scale).toBeCloseTo(900 / 6000);
    const c = toScreen(f, { x: 3000, y: 1500 });
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(400);
    const vis = visibleWorld(f, { width: 1000, height: 800 });
    expect(vis.minX).toBeLessThan(0);
    expect(vis.maxX).toBeGreaterThan(6000);
  });
  it('adaptive grid thins lines when zoomed out', () => {
    const [minorIn] = adaptiveGrid(152.4, 1);
    expect(minorIn).toBeCloseTo(152.4);
    const [minorOut, majorOut] = adaptiveGrid(152.4, 0.01);
    expect(minorOut * 0.01).toBeGreaterThanOrEqual(8);
    expect(majorOut).toBeGreaterThan(minorOut);
    const [m1, M1] = adaptiveGrid(25.4, 0.5);
    expect(m1).toBeCloseTo(25.4);
    expect(M1).toBeCloseTo(304.8); // foot lines
  });
});

describe('rotated viewport', () => {
  it('round-trips and fits with view rotation (south up)', () => {
    const v = { x: 300, y: 200, scale: 0.1, rotation: 180 };
    const w = { x: 1000, y: 2000 };
    const back = toWorld(v, toScreen(v, w));
    expect(back.x).toBeCloseTo(w.x);
    expect(back.y).toBeCloseTo(w.y);
    // With south up, world +y (south) points up the screen.
    expect(toScreen(v, { x: 0, y: 100 }).y).toBeLessThan(toScreen(v, { x: 0, y: 0 }).y);
  });
  it('fitBounds swaps extents for quarter turns and centers the box', () => {
    const f = fitBounds({ minX: 0, minY: 0, maxX: 6000, maxY: 3000 }, { width: 1000, height: 800 }, 50, 90);
    expect(f.scale).toBeCloseTo(Math.min(900 / 3000, 700 / 6000));
    const c = toScreen(f, { x: 3000, y: 1500 });
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(400);
    const vis = visibleWorld(f, { width: 1000, height: 800 });
    expect(vis.minY).toBeLessThan(0);
    expect(vis.maxY).toBeGreaterThan(3000);
    expect(zoomAt(f, { x: 10, y: 10 }, 2).rotation).toBe(90);
  });
});
