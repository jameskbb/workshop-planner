import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test.setTimeout(180_000);

test('create a layout from current and blank, switch with keys, compare side by side', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  await expect(page.getByTestId('layout-item')).toHaveCount(2);

  // Create from current: arrangement copied, room shared, new layout active.
  const firstCount = await project<number>(page, 's.objects.length');
  await page.getByTestId('duplicate-layout').click();
  await expect(page.getByTestId('layout-item')).toHaveCount(3);
  expect(await project<string>(page, 's.name')).toBe('Car + Workshop (copy)');
  expect(await project<number>(page, 's.objects.length')).toBe(firstCount);

  // Blank layout.
  await page.getByTestId('new-blank-layout').click();
  await expect(page.getByTestId('layout-item')).toHaveCount(4);
  expect(await project<number>(page, 's.objects.length')).toBe(0);

  // Fast switching with [ and ].
  await page.getByTestId('plan-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('[');
  await expect.poll(() => project<string>(page, 's.name')).toBe('Workshop mode');
  await page.keyboard.press(']');
  await expect.poll(() => project<number>(page, 's.objects.length')).toBe(0);

  // Toolbar switcher.
  await page.getByTestId('layout-switcher').click();
  await page.getByTestId('switcher-layout').filter({ hasText: 'Car + Workshop' }).first().click();
  await expect.poll(() => project<string>(page, 's.name')).toBe('Car + Workshop');

  // Compare view: two plans + metric table.
  await page.getByTestId('compare-layouts').click();
  await expect(page.getByTestId('compare-view')).toBeVisible();
  await expect(page.getByTestId('compare-panel')).toHaveCount(3);
  await expect(page.getByTestId('compare-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('compare-table')).toContainText('Open floor area');
  await expect(page.getByTestId('compare-table')).toContainText('Narrowest main walkway');
  await expect(page.getByTestId('compare-table')).toContainText('Relative summary');
  await page.getByTestId('compare-back').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('scorecard shows explained metrics with priorities', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('sidebar-scorecard').click();
  await expect(page.getByTestId('scorecard-metric').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('scorecard-panel')).toContainText('Vehicle clearance');
  await expect(page.getByTestId('scorecard-panel')).toContainText('Wall-storage utilization');
  await expect(page.getByTestId('scorecard-panel')).toContainText('Electrical-distance warnings');
});
