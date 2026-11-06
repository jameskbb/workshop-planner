import { expect, test } from '@playwright/test';
import { openDemo, project, selection } from './helpers';

test.setTimeout(180_000);

test('safety panel explains the clearance problem, locates it, and overlays can be toggled', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);

  await page.getByTestId('sidebar-warnings').click();
  await expect(page.getByTestId('safety-panel')).toBeVisible();
  // The clearance check lists the explanatory warning with the quantity and the wall name.
  const check = page.getByTestId('check-clearance');
  await expect(check).toBeVisible();
  const item = check.getByTestId('warning-item').filter({ hasText: 'Table saw outfeed clearance intersects the East wall (south) by 7 1/2".' });
  await expect(item).toBeVisible();
  // Other checks are listed with their status.
  await expect(page.getByTestId('check-doorway')).toBeVisible();
  await expect(page.getByTestId('check-vehicle-doors')).toContainText('Vehicle doors');

  // Clicking the warning selects the tool (and zooms to it).
  const sawId = await project<string>(page, "s.objects.find(o => o.name === 'Table saw').id");
  const before = await page.evaluate(() => window.__wp.useUiStore.getState().viewport.scale);
  await item.locator('button').first().click();
  await expect.poll(async () => (await selection(page)).map((r) => r.id)).toEqual([sawId]);
  await expect.poll(() => page.evaluate(() => window.__wp.useUiStore.getState().viewport.scale)).not.toBe(before);

  // Inspector clearances section shows the blocked outfeed zone with the explanation.
  await expect(page.getByTestId('clearance-zones')).toContainText('Blocked');

  // Acknowledge persists on the scenario.
  await item.getByTestId('warning-ack').click();
  await expect.poll(() => project<number>(page, 'Object.keys(s.acknowledgedWarnings).length')).toBeGreaterThan(0);

  // Toggle overlays from the Overlays menu; the legend appears.
  await page.getByTestId('overlays-menu').click();
  await page.getByTestId('overlay-clearances-maintenance').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('clearance-legend')).toBeVisible();
  await expect(page.getByTestId('clearance-legend')).toContainText('Maintenance clearance');
  expect(errors).toEqual([]);
});
