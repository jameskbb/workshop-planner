import { expect, test } from '@playwright/test';
import { drag, openDemo, project, worldToPage } from './helpers';

test('400 objects: the plan renders and a drag stays responsive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  // Add 400 small objects in one transaction.
  await page.evaluate(() => {
    const wp = window.__wp as unknown as { useProjectStore: { getState(): { project: { definitions: Array<{ id: string }> } } }; dispatch(c: unknown): { ok: boolean } };
    const p = wp.useProjectStore.getState().project;
    const def = p.definitions[0];
    const objects = Array.from({ length: 400 }, (_, i) => ({
      id: `perf-${i}`, definitionId: def.id, name: `Bin ${i}`, x: 400 + (i % 20) * 300, y: 400 + Math.floor(i / 20) * 330, rotation: 0,
      width: 200, depth: 200, height: 300, elevation: 0, mount: 'floor', mobility: 'static', activePosition: 'parked', notes: '', locked: false, hidden: false,
    }));
    const r = wp.dispatch({ type: 'object.add', payload: { objects } });
    if (!r.ok) throw new Error('add failed');
  });
  await expect.poll(() => project<number>(page, 's.objects.length')).toBeGreaterThanOrEqual(400);
  const target = await project<{ x: number; y: number }>(page, `s.objects.find(o => o.id === 'perf-210')`);
  const from = await worldToPage(page, target);
  const t0 = Date.now();
  await drag(page, from, { x: from.x + 90, y: from.y + 40 }, { steps: 30 });
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === 'perf-210').x`)).not.toBe(target.x);
  const elapsed = Date.now() - t0;
  // 30 pointer moves + commit on a heavily loaded CI box: generous, but catches per-frame store churn.
  expect(elapsed).toBeLessThan(15000);
  // Exactly one undo step for the whole drag.
  const pastBefore = await page.evaluate(() => (window.__wp.useProjectStore.getState() as { past: unknown[] }).past.length);
  await page.getByTestId('undo').click();
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === 'perf-210').x`)).toBe(target.x);
  expect(await page.evaluate(() => (window.__wp.useProjectStore.getState() as { past: unknown[] }).past.length)).toBe(pastBefore - 1);
  expect(errors).toEqual([]);
});
