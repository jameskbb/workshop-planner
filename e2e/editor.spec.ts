import { expect, test } from '@playwright/test';
import { drag, openDemo, project, selection, worldToPage } from './helpers';

test('select, drag with one undo step, rotate with R, marquee select', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  const cart = await project<{ id: string; x: number; y: number }>(page, `s.objects.find(o => /tool cart/i.test(o.name))`);
  expect(cart).toBeTruthy();
  const from = await worldToPage(page, cart);
  await drag(page, from, { x: from.x + 60, y: from.y + 5 });
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').x`)).not.toBe(cart.x);
  expect(await selection(page)).toEqual([{ kind: 'object', id: cart.id }]);
  const moved = await project<{ x: number; y: number }>(page, `s.objects.find(o => o.id === '${cart.id}')`);
  // Undo returns it in one step.
  await page.getByTestId('undo').click();
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').x`)).toBe(cart.x);
  await page.getByTestId('redo').click();
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').x`)).toBe(moved.x);

  // R rotates 90°.
  const rot0 = await project<number>(page, `s.objects.find(o => o.id === '${cart.id}').rotation`);
  await page.getByTestId('plan-canvas').focus();
  await page.keyboard.press('r');
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').rotation`)).toBe((rot0 + 90) % 360);

  // Marquee right→left over everything selects many items.
  const room = await project<Array<{ x: number; y: number }>>(page, 'p.room.vertices');
  const xs = room.map((v) => v.x);
  const ys = room.map((v) => v.y);
  const a = await worldToPage(page, { x: Math.max(...xs) + 700, y: Math.max(...ys) + 700 });
  const b = await worldToPage(page, { x: Math.min(...xs) + 200, y: Math.min(...ys) + 200 });
  await page.keyboard.press('Escape');
  await drag(page, a, b);
  await expect.poll(async () => (await selection(page)).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('resize and rotate handles, context menu, palette, measure and zone tools', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  const cart = await project<{ id: string; x: number; y: number; width: number; depth: number; rotation: number }>(page, `s.objects.find(o => /tool cart/i.test(o.name))`);
  const scale = await page.evaluate(() => window.__wp.useUiStore.getState().viewport.scale);
  const local = (lx: number, ly: number) => {
    const r = (cart.rotation * Math.PI) / 180;
    return { x: cart.x + lx * Math.cos(r) - ly * Math.sin(r), y: cart.y + lx * Math.sin(r) + ly * Math.cos(r) };
  };
  const center = await worldToPage(page, cart);
  await page.mouse.click(center.x, center.y);

  // Resize from the right edge handle: width grows, the left edge stays put.
  const edge = await worldToPage(page, local(cart.width / 2, 0));
  const out = await worldToPage(page, local(cart.width / 2 + 300, 0));
  await drag(page, edge, out, { steps: 6 });
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').width`)).toBeGreaterThan(cart.width + 200);

  // Rotate with the knob above the back edge, Shift snaps to 15° steps.
  const now = await project<{ x: number; y: number; depth: number; rotation: number }>(page, `s.objects.find(o => o.id === '${cart.id}')`);
  const r0 = (now.rotation * Math.PI) / 180;
  const knobWorld = { x: now.x - (-(now.depth / 2) - 26 / scale) * Math.sin(r0), y: now.y + (-(now.depth / 2) - 26 / scale) * Math.cos(r0) };
  const knob = await worldToPage(page, knobWorld);
  const c = await worldToPage(page, now);
  const R = Math.hypot(knob.x - c.x, knob.y - c.y);
  const a0 = Math.atan2(knob.y - c.y, knob.x - c.x);
  const a1 = a0 + Math.PI / 2 + 0.05;
  await drag(page, knob, { x: c.x + R * Math.cos(a1), y: c.y + R * Math.sin(a1) }, { steps: 10, shift: true });
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').rotation`)).toBe((now.rotation + 90) % 360);

  // Context menu: Duplicate.
  const before = await project<number>(page, 's.objects.length');
  const mid = await worldToPage(page, await project<{ x: number; y: number }>(page, `s.objects.find(o => o.id === '${cart.id}')`));
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /Duplicate/ }).click();
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(before + 1);

  // Command palette: set a 12" grid.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search commands').fill('grid 12');
  await page.keyboard.press('Enter');
  await expect.poll(() => project<number>(page, 'p.settings.gridSize')).toBeCloseTo(304.8, 2);

  // Measure object ↔ object and keep it on the plan.
  const m0 = await project<number>(page, 's.measurements.length');
  await page.keyboard.press('m');
  await page.getByTestId('measure-mode-object-object').click();
  const saw = await project<{ x: number; y: number }>(page, `s.objects.find(o => /table saw/i.test(o.name))`);
  const planer = await project<{ x: number; y: number }>(page, `s.objects.find(o => /shop vac/i.test(o.name))`);
  const ps = await worldToPage(page, saw);
  const pp = await worldToPage(page, planer);
  await page.mouse.click(ps.x, ps.y);
  await page.mouse.click(pp.x, pp.y);
  await expect(page.getByTestId('measure-result')).toBeVisible();
  await page.getByTestId('keep-measurement').click();
  await expect.poll(() => project<number>(page, 's.measurements.length')).toBe(m0 + 1);
  expect(await project<string>(page, 's.measurements[s.measurements.length - 1].kind')).toBe('object-object');

  // Draw a rectangular zone.
  const z0 = await project<number>(page, 's.zones.length');
  await page.keyboard.press('Escape');
  await page.keyboard.press('z');
  const zA = await worldToPage(page, { x: 600, y: 600 });
  const zB = await worldToPage(page, { x: 2400, y: 1800 });
  await drag(page, zA, zB, { steps: 6 });
  await expect.poll(() => project<number>(page, 's.zones.length')).toBe(z0 + 1);
  expect(errors).toEqual([]);
});

test('drag a room corner (undoable) and paste a copy into another layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  // Corner drag: the NE corner of the jog moves; one undo step restores it.
  const v = await project<{ id: string; x: number; y: number }>(page, 'p.room.vertices[2]');
  const from = await worldToPage(page, v);
  await drag(page, from, { x: from.x + 25, y: from.y + 20 }, { steps: 8 });
  await expect.poll(() => project<number>(page, 'p.room.vertices[2].y')).not.toBe(v.y);
  await page.getByTestId('undo').click();
  await expect.poll(() => project<number>(page, 'p.room.vertices[2].y')).toBe(v.y);

  // Copy the tool cart, switch layouts, paste: same position, same identity if absent there.
  const cart = await project<{ id: string; x: number; y: number }>(page, `s.objects.find(o => /tool cart/i.test(o.name))`);
  const pc = await worldToPage(page, cart);
  await page.mouse.click(pc.x, pc.y);
  await page.keyboard.press('Control+c');
  await page.getByTestId('layout-switcher').click();
  await page.getByTestId('switcher-layout').filter({ hasText: 'Workshop mode' }).click();
  await expect.poll(() => project<string>(page, 's.name')).toBe('Workshop mode');
  const before = await project<number>(page, 's.objects.length');
  const hadCart = await project<boolean>(page, `s.objects.some(o => o.id === '${cart.id}')`);
  await page.getByTestId('plan-canvas').focus();
  await page.keyboard.press('Control+v');
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(before + 1);
  const pasted = await project<{ id: string; x: number; y: number }>(page, 's.objects[s.objects.length - 1]');
  expect(pasted.x).toBeCloseTo(cart.x, 2);
  expect(pasted.y).toBeCloseTo(cart.y, 2);
  if (!hadCart) expect(pasted.id).toBe(cart.id);
  expect(errors).toEqual([]);
});
