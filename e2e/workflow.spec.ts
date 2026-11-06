import { expect, test, type Page } from '@playwright/test';
import { drag, prepare, project, worldToPage } from './helpers';

async function home(page: Page) {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible();
}

test('New Project wizard: two-car template with a door, pole and vehicle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await home(page);
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('new-project-wizard')).toBeVisible();
  await page.getByTestId('wizard-name').fill('Wizard garage');
  await page.getByTestId('wizard-next').click(); // → units
  await page.getByTestId('wizard-units-imperial').click();
  await page.getByTestId('wizard-next').click(); // → shape
  await page.getByTestId('template-two-car').click();
  await page.getByTestId('template-param-width').fill(`24'`);
  await page.getByTestId('wizard-next').click(); // → ceiling
  await page.getByTestId('wizard-ceiling').fill(`10'`);
  await page.getByTestId('wizard-next').click(); // → doors (template door pre-filled)
  await page.getByTestId('wizard-next').click(); // → obstructions
  await page.getByTestId('wizard-obstruction-support-pole').click();
  await page.getByTestId('wizard-next').click(); // → vehicle
  await page.getByTestId('wizard-vehicle-sedan').click();
  await page.getByTestId('wizard-next').click(); // → begin
  await page.getByTestId('wizard-create').click();

  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('project-title')).toHaveText('Wizard garage');
  await expect.poll(() => project<number>(page, 'p.room.vertices.length')).toBe(4);
  expect(await project<number>(page, 'Math.max(...p.room.vertices.map(v => v.x))')).toBeCloseTo(24 * 304.8, 2);
  expect(await project<number>(page, 'p.room.ceilingHeight')).toBeCloseTo(120 * 25.4, 2);
  expect(await project<string[]>(page, 'p.architecture.map(f => f.kind).sort()')).toEqual(['garage-door', 'support-pole']);
  expect(await project<number>(page, 's.vehicles.length')).toBe(1);
  expect(errors).toEqual([]);
});

test('Start blank, then draw a room by clicking corners and typing exact lengths', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await home(page);
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-name').fill('Drawn garage');
  await page.getByTestId('wizard-start-blank').click();
  await expect(page.getByTestId('canvas-empty')).toBeVisible();
  await page.getByTestId('empty-draw').click();
  await expect(page.getByTestId('wall-tool-hint')).toBeVisible();

  // First corner by clicking at the world origin.
  const o = await worldToPage(page, { x: 0, y: 0 });
  await page.mouse.click(o.x, o.y);
  // Point east, type the length.
  const east = await worldToPage(page, { x: 3000, y: 0 });
  await page.mouse.move(east.x, east.y);
  await page.keyboard.type(`20'`);
  await expect(page.getByTestId('wall-typed-entry')).toBeVisible();
  await page.keyboard.press('Enter');
  // South: type length and an explicit bearing.
  await page.getByTestId('wall-length-input').fill(`18' 6"`);
  await page.getByTestId('wall-bearing-input').fill('S');
  await page.keyboard.press('Enter');
  // West by bearing.
  await page.getByTestId('wall-length-input').fill(`20'`);
  await page.getByTestId('wall-bearing-input').fill('270');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // close the typed entry
  // Close the polygon by clicking the first corner.
  await page.mouse.click(o.x, o.y);

  await expect.poll(() => project<number>(page, 'p.room.vertices.length')).toBe(4);
  const v = await project<Array<{ x: number; y: number }>>(page, 'p.room.vertices');
  expect(v[1]!.x).toBeCloseTo(240 * 25.4, 2);
  expect(v[1]!.y).toBeCloseTo(0, 2);
  expect(v[2]!.y).toBeCloseTo(222 * 25.4, 2);
  expect(v[3]!.x).toBeCloseTo(0, 2);

  // Exact wall length edit afterwards in the Room panel.
  await page.getByTestId('sidebar-room').click();
  await page.getByTestId('wall-table-length-0').fill(`21' 6"`);
  await page.getByTestId('wall-table-length-0').press('Enter');
  await expect.poll(() => project<number>(page, 'p.room.vertices[1].x')).toBeCloseTo(258 * 25.4, 2);
  // The room stays rectangular (the next wall is carried along).
  expect(await project<number>(page, 'p.room.vertices[2].x')).toBeCloseTo(258 * 25.4, 2);
  expect(errors).toEqual([]);
});

test('Add an object, drag it against a wall with snapping, type exact values, undo/redo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await home(page);
  await page.getByTestId('new-project').click();
  await page.getByTestId('wizard-name').fill('Object test');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('template-rectangle').click();
  for (let i = 0; i < 5; i++) await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-create').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect.poll(() => project<number>(page, 'p.room.vertices.length')).toBe(4);

  await page.getByTestId('sidebar-library').click();
  await page.getByTestId('library-search').fill('base cabinet');
  await page.getByTestId('library-item').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Base cabinet');
  const obj = await project<{ id: string; x: number; y: number; width: number; depth: number }>(page, 's.objects[0]');

  // Drag it so its left edge lands ~3 px from the west wall: snapping pulls it flush.
  const scale = await page.evaluate(() => window.__wp.useUiStore.getState().viewport.scale);
  const targetX = obj.width / 2 + 3 / scale;
  const from = await worldToPage(page, { x: obj.x, y: obj.y });
  const to = await worldToPage(page, { x: targetX, y: obj.y + 200 });
  await drag(page, from, to, { steps: 12 });
  await expect.poll(() => project<number>(page, `s.objects[0].x - s.objects[0].width / 2`)).toBeCloseTo(0, 2);

  // Exact position and size in the inspector.
  await page.getByTestId('inspector-x').fill(`42"`);
  await page.getByTestId('inspector-x').press('Enter');
  await page.getByTestId('inspector-y').fill(`118"`);
  await page.getByTestId('inspector-y').press('Enter');
  await page.getByTestId('inspector-rotation').fill('90');
  await page.getByTestId('inspector-rotation').press('Enter');
  await page.getByTestId('inspector-width').fill(`48"`);
  await page.getByTestId('inspector-width').press('Enter');
  await expect.poll(() => project<number>(page, 's.objects[0].width')).toBeCloseTo(48 * 25.4, 2);
  expect(await project<number>(page, 's.objects[0].x')).toBeCloseTo(42 * 25.4, 2);
  expect(await project<number>(page, 's.objects[0].y')).toBeCloseTo(118 * 25.4, 2);
  expect(await project<number>(page, 's.objects[0].rotation')).toBe(90);

  // Undo the width, redo it.
  await page.getByTestId('undo').click();
  await expect.poll(() => project<number>(page, 's.objects[0].width')).toBeCloseTo(obj.width, 2);
  await page.getByTestId('redo').click();
  await expect.poll(() => project<number>(page, 's.objects[0].width')).toBeCloseTo(48 * 25.4, 2);
  // Keyboard: nudge right by 1" and duplicate.
  await page.getByTestId('plan-canvas').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => project<number>(page, 's.objects[0].x')).toBeCloseTo(43 * 25.4, 2);
  await page.keyboard.press('Control+d');
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(1);
  expect(errors).toEqual([]);
});
