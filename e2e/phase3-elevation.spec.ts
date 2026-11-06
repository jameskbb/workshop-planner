import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test.setTimeout(180_000);

test('wall elevation opens for a wall, shows items with heights and moves an item exactly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);

  // Select the east wall and open its elevation from the inspector.
  const eastId = await project<string>(page, 'p.room.walls[3].id');
  await page.evaluate((id) => (window.__wp.useUiStore as unknown as { setState(s: object): void }).setState({ selection: [{ kind: 'wall', id }] }), eastId);
  await page.getByTestId('open-elevation').click();
  await expect(page.getByTestId('elevation-view')).toBeVisible();
  await expect(page.getByTestId('elevation-title')).toContainText('East wall');
  const bench = page.locator('[data-testid="elevation-item"][data-name="6\' Workbench"]');
  await expect(bench).toHaveCount(1);
  await expect(page.locator('[data-testid="elevation-item"][data-name="Wall cabinet (north)"]')).toHaveCount(1);

  // Select the north wall cabinet and set its bottom height exactly.
  await page.locator('[data-testid="elevation-item"][data-name="Wall cabinet (north)"] rect').click();
  await expect(page.getByTestId('elevation-selected')).toBeVisible();
  await page.getByTestId('elevation-bottom').fill('60"');
  await page.getByTestId('elevation-bottom').press('Enter');
  await expect.poll(() => project<number>(page, "s.objects.find(o => o.name === 'Wall cabinet (north)').elevation")).toBeCloseTo(60 * 25.4, 2);

  // Back to the plan.
  await page.getByRole('button', { name: /Plan/ }).first().click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
