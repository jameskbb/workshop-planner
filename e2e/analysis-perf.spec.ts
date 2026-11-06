import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

/**
 * R-002: with 300+ objects (real library definitions, so clearance zones are analyzed) a committed
 * edit must not block the main thread on layout analysis. Analyzers and metrics run in a Web Worker
 * (src/analysis/analysis.worker.ts); the badge, the Safety panel and the scorecard update when the
 * result arrives. We time dispatch → next painted frame for a series of nudges.
 *
 * Measured on the build machine (dev server, 300 objects):
 *   before  Safety panel open ~1,460 ms · panel closed ~1,100 ms  (analysis inside the render)
 *   after   Safety panel open ~1,080 ms · panel closed   ~330 ms  (worker; the rest is Konva/React)
 */
test('300 objects: committed nudges stay responsive while analysis runs off the main thread', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Freeze the dev server's HMR client: a hot reload mid-measurement destroys the page context.
  await page.addInitScript(() => {
    class DeadSocket extends EventTarget {
      readyState = 3;
      close() {}
      send() {}
    }
    Object.defineProperty(window, 'WebSocket', { value: DeadSocket, configurable: true });
  });
  await openDemo(page);
  await page.evaluate(() => {
    type P = { definitions: Array<{ id: string; name: string; mount?: string }>; room: { vertices: Array<{ x: number; y: number }> } };
    const wp = window.__wp as unknown as { useProjectStore: { getState(): { project: P } }; dispatch(c: unknown): { ok: boolean; error?: string } };
    const p = wp.useProjectStore.getState().project;
    const defs = p.definitions.filter((d) => (d.mount ?? 'floor') === 'floor');
    const xs = p.room.vertices.map((v) => v.x);
    const ys = p.room.vertices.map((v) => v.y);
    const minX = Math.min(...xs) + 300;
    const minY = Math.min(...ys) + 300;
    const cols = Math.max(1, Math.floor((Math.max(...xs) - 300 - minX) / 420));
    const objects = Array.from({ length: 300 }, (_, i) => {
      const d = defs[i % defs.length]!;
      return {
        id: `perf-${i}`, definitionId: d.id, name: `${d.name} ${i}`, x: minX + (i % cols) * 420, y: minY + Math.floor(i / cols) * 420, rotation: (i * 90) % 360,
        width: 300, depth: 300, height: 800, elevation: 0, mount: 'floor', mobility: 'static', activePosition: 'parked', notes: '', locked: false, hidden: false,
      };
    });
    const r = wp.dispatch({ type: 'object.add', payload: { objects } });
    if (!r.ok) throw new Error(`add failed: ${r.error}`);
  });
  await expect.poll(() => project<number>(page, 's.objects.length')).toBeGreaterThanOrEqual(300);
  // The analyzers must still produce warnings, asynchronously.
  await page.getByTestId('sidebar-warnings').click();
  await expect(page.getByTestId('warning-item').first()).toBeVisible({ timeout: 60_000 });

  const measure = async () => {
    const timings = await page.evaluate(async () => {
      const wp = window.__wp as unknown as { dispatch(c: unknown, o?: unknown): { ok: boolean } };
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const t0 = performance.now();
        wp.dispatch({ type: 'object.move', payload: { moves: [{ id: 'perf-0', x: 400 + i * 25.4, y: 600 }] } });
        await frame();
        out.push(performance.now() - t0);
      }
      return out;
    });
    const sorted = [...timings].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)]!, max: sorted[sorted.length - 1]! };
  };

  const panelOpen = await measure();
  // Ordinary editing: the Safety panel (which renders every single finding) is not the open section.
  await page.getByTestId('sidebar-library').click();
  await page.waitForTimeout(1000);
  const panelClosed = await measure();
  const line = `[analysis-perf] commit→painted frame, Safety panel open: median ${panelOpen.median.toFixed(0)} ms (max ${panelOpen.max.toFixed(0)}); panel closed: median ${panelClosed.median.toFixed(0)} ms (max ${panelClosed.max.toFixed(0)})`;
  console.log(line);
  test.info().annotations.push({ type: 'perf', description: line });

  // Warnings still arrive (asynchronously) after the edits.
  await page.getByTestId('sidebar-warnings').click();
  await expect(page.getByTestId('warning-item').first()).toBeVisible({ timeout: 60_000 });
  // Generous for a loaded machine and an unoptimized dev build: before R-002 every commit paid
  // ~1.1 s of synchronous analysis even with no panel open. What is left is Konva/React rendering.
  expect(panelClosed.median).toBeLessThan(800);
  expect(errors).toEqual([]);
});
