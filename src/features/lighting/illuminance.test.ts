import { describe, expect, it } from 'vitest';
import type { LightingFixture } from '@/domain/schema';
import { inches } from '@/domain/units';
import { rectangleRoomPoints } from '@/domain/factories';
import { coverageFootprint, illuminanceAt, illuminanceGrid, thirds, toFootCandles } from './illuminance';

const light = (x: number, y: number, extra: Partial<LightingFixture> = {}): LightingFixture => ({
  id: `l${x}${y}`, kind: 'ceiling-fixture', name: 'L', x, y, rotation: 0, length: 300, width: 300, elevation: 762 + 2000, lumens: 5000, beamAngle: 120, locked: false, hidden: false, notes: '', ...extra,
});

describe('illuminance', () => {
  it('directly under a 5000 lm, 120° fixture 2 m above the work plane: E = I0/h²', () => {
    // m = 1 for a 120° beam, I0 = Φ(m+1)/2π = 1591.5 cd → 1591.5 / 4 = 397.9 lux.
    expect(illuminanceAt([light(0, 0)], { x: 0, y: 0 })).toBeCloseTo((5000 * 2) / (2 * Math.PI) / 4, 3);
    // Off-axis falls off as cos^(m+1)θ / d².
    const off = illuminanceAt([light(0, 0)], { x: 2000, y: 0 });
    expect(off).toBeCloseTo((1591.549 * Math.pow(Math.SQRT1_2, 2)) / 8, 1);
    expect(toFootCandles(107.64)).toBeCloseTo(10, 6);
  });

  it('linear shop lights conserve flux across their point sources', () => {
    const a = illuminanceAt([light(0, 0, { kind: 'shop-light', length: 1219, width: 76 })], { x: 0, y: 0 });
    expect(a).toBeGreaterThan(300);
    expect(a).toBeLessThan(400);
  });

  it('grid thirds tell front-middle-back from left-middle-right', () => {
    const room = rectangleRoomPoints(inches(240), inches(288));
    // Three lights along the east–west center line (left-middle-right).
    const lr = [60, 120, 180].map((x) => light(inches(x), inches(144)));
    const g = illuminanceGrid(room, lr, { cell: 200 })!;
    const [n, m, s] = thirds(g, 'y');
    expect(m).toBeGreaterThan(n);
    expect(m).toBeGreaterThan(s);
    expect(Math.abs(n - s) / m).toBeLessThan(0.1);
    expect(g.stats.min).toBeGreaterThan(0);
    expect(g.stats.uniformity).toBeGreaterThan(0);
    expect(g.stats.uniformity).toBeLessThanOrEqual(1);
  });

  it('coverage footprint radius = (elevation − plane)·tan(beam/2)', () => {
    const fp = coverageFootprint(light(0, 0, { beamAngle: 90 }));
    const r = Math.max(...fp.map((p) => Math.hypot(p.x, p.y)));
    expect(r).toBeCloseTo(2000, 0);
  });
});
