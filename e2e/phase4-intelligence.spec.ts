import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test.setTimeout(240_000);

test('natural-language command previews, executes and undoes', async ({ page }) => {
  await openDemo(page);
  const before = await project<{ x: number; y: number }>(page, "(() => { const o = s.objects.find((x) => x.name === 'Tool cart'); return { x: o.x, y: o.y }; })()");
  await page.getByTestId('open-command-bar').click();
  await page.getByTestId('command-input').fill('Move the tool cart 12 inches west');
  await expect(page.getByTestId('command-preview')).toContainText('Move Tool cart 12" west');
  await page.getByTestId('command-input').press('Enter');
  await expect(page.getByTestId('command-status')).toContainText('undo');
  const after = await project<number>(page, "s.objects.find((x) => x.name === 'Tool cart').x");
  expect(after).toBeCloseTo(before.x - 304.8, 1);
  await page.getByTestId('command-undo').click();
  await expect.poll(() => project<number>(page, "s.objects.find((x) => x.name === 'Tool cart').x")).toBeCloseTo(before.x, 1);

  // Brief example: hide the vehicle, then an unknown instruction gets suggestions.
  await page.getByTestId('command-input').fill('Hide the vehicle');
  await page.getByTestId('command-input').press('Enter');
  await expect.poll(() => project<boolean>(page, 's.vehicles[0].hidden')).toBe(true);
  await page.getByTestId('command-input').fill('paint the ceiling purple');
  await expect(page.getByTestId('command-problem')).toContainText('Try');
  await page.getByTestId('command-input').press('Escape');
  await expect(page.getByTestId('command-bar')).toHaveCount(0);
});

test('Will It Fit? suggestion previews and places an object (undoable)', async ({ page }) => {
  await openDemo(page);
  const count = await project<number>(page, 's.objects.length');
  await page.getByTestId('sidebar-fitcheck').click();
  await page.getByTestId('fit-width').fill('24"');
  await page.getByTestId('fit-width').press('Enter');
  await page.getByTestId('fit-depth').fill('18"');
  await page.getByTestId('fit-depth').press('Enter');
  await page.getByTestId('fit-search').click();
  const first = page.getByTestId('fit-result').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(first).toContainText(/available|remaining|Open floor/);
  await first.locator('button').first().click();
  await page.getByTestId('fit-place').click();
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(count + 1);
  await page.getByTestId('undo').click();
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(count);
});

test('Suggest Layouts creates a new layout and leaves the active one untouched', async ({ page }) => {
  await openDemo(page);
  const activeId = await project<string>(page, 'p.activeScenarioId');
  const snapshot = await project<string>(page, 'JSON.stringify(s.objects.map((o) => [o.id, o.x, o.y, o.rotation]))');
  await page.getByTestId('sidebar-assistant').click();
  await page.getByRole('combobox', { name: 'Search effort' }).click();
  await page.getByRole('option', { name: 'Quick' }).click();
  await page.getByTestId('suggest-layouts').click();
  const cands = page.getByTestId('assistant-candidate');
  await expect(cands).toHaveCount(4, { timeout: 150_000 });
  await expect(cands.first()).toContainText('Parking Priority');
  // Active layout unchanged by suggesting.
  expect(await project<string>(page, 'JSON.stringify(s.objects.map((o) => [o.id, o.x, o.y, o.rotation]))')).toBe(snapshot);
  const valid = cands.filter({ hasText: 'valid' }).filter({ hasNotText: 'invalid' }).first();
  await valid.getByTestId('assistant-preview').click();
  await valid.getByTestId('assistant-create').click();
  await expect.poll(() => project<number>(page, 'p.scenarios.length')).toBe(3);
  const newActive = await project<string>(page, 'p.activeScenarioId');
  expect(newActive).not.toBe(activeId);
  const original = await project<string>(page, `JSON.stringify(p.scenarios.find((x) => x.id === '${activeId}').objects.map((o) => [o.id, o.x, o.y, o.rotation]))`);
  expect(original).toBe(snapshot);
});

test('Ask the Layout answers from geometry; walkability panel lists path warnings', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('sidebar-ask').click();
  await page.getByTestId('ask-input').fill('What is the narrowest walkway?');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer-text').first()).toContainText('narrowest main walkway is');
  await page.getByTestId('ask-input').fill('Can I open the driver door?');
  await page.getByTestId('ask-submit').click();
  await expect(page.getByTestId('ask-answer-text').first()).toContainText('driver door');

  await page.getByTestId('sidebar-walkability').click();
  await expect(page.getByTestId('walk-warning').first()).toContainText('Main path from');
  await page.getByTestId('aisle-36').click();
  await expect.poll(() => project<number>(page, "p.extensions['walkability.prefs'].aisleWidth")).toBeCloseTo(914.4, 1);
  await page.getByTestId('walk-overlay').click();
});
