import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test.setTimeout(180_000);

test('vehicle door conflict, desired clearance edit and entry simulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);

  // The driver door conflict is reported with the angle and what stops it.
  await page.getByTestId('sidebar-warnings').click();
  const doors = page.getByTestId('check-vehicle-doors');
  await expect(doors.getByTestId('warning-item').filter({ hasText: /The Sedan's driver door opens \d+° of 65°/ })).toBeVisible();

  // Select the sedan from the Vehicles panel; the inspector shows door and side status.
  await page.getByTestId('sidebar-vehicles').click();
  await page.getByRole('button', { name: /Sedan/ }).first().click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector).toContainText('Desired clearance');
  await expect(inspector).toContainText(/driver door: \d+° of 65°/);

  // Change the desired driver-side clearance: stored exactly.
  await page.getByTestId('vehicle-clearance-driver').fill('12"');
  await page.getByTestId('vehicle-clearance-driver').press('Enter');
  await expect.poll(() => project<number>(page, 's.vehicles[0].desiredClearance.driver')).toBeCloseTo(304.8, 2);

  // Doors-open state.
  await inspector.getByRole('button', { name: 'Doors open' }).click();
  await expect.poll(() => project<string>(page, 's.vehicles[0].state')).toBe('doors-open');

  // Entry simulation produces an explained result and turns the path overlay on.
  await page.getByTestId('entry-run').click();
  await expect(page.getByTestId('entry-result')).toContainText(/The Sedan can/);
  await expect.poll(() => page.evaluate(() => (window.__wp.useUiStore.getState() as unknown as { overlays: Record<string, boolean> }).overlays['vehicle-entry'])).toBe(true);
  expect(errors).toEqual([]);
});
