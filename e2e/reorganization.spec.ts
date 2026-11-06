import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test('before/after overlay and move plan with step statuses that persist', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('sidebar-reorganization').click();
  const steps = page.getByTestId('move-step');
  // Demo: "Car + Workshop" → "Workshop mode": the car leaves first.
  await expect(steps.first()).toContainText('Drive the sedan out of the garage');
  await expect(page.getByTestId('reorg-summary')).toContainText('to move');
  const count = await steps.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Designate explicitly (swap twice → both layouts stored).
  await page.getByRole('button', { name: 'Swap Current and Target' }).click();
  await expect(steps.last()).toContainText(/Park the sedan/);
  await page.getByRole('button', { name: 'Swap Current and Target' }).click();
  await expect(steps.first()).toContainText('Drive the sedan out');
  expect(await project<string>(page, 'p.reorganization.currentScenarioId')).toBe(await project<string>(page, 'p.scenarios[0].id'));

  // Overlay + legend.
  await page.getByTestId('before-after-toggle').click();
  await expect(page.getByTestId('before-after-legend')).toContainText('Car + Workshop → Workshop mode');

  // Highlight a step on the plan, mark it moved, regenerate the remaining plan.
  await steps.first().locator('button').first().click();
  await expect(steps.first().locator('button[aria-pressed="true"]').first()).toBeVisible();
  if (process.env.WP_SHOT) await page.screenshot({ path: process.env.WP_SHOT });
  await steps.first().getByTestId('step-moved').click();
  await expect(steps.first()).toHaveAttribute('data-status', 'moved');
  await page.getByTestId('regenerate-plan').click();
  await expect(page.getByTestId('regenerate-plan')).toBeHidden();
  await expect(steps.first()).toContainText('Already moved.');
  await steps.nth(1).getByTestId('step-blocked').click();
  await expect(steps.nth(1)).toHaveAttribute('data-status', 'blocked');

  // Persisted with the project.
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await page.getByTestId('sidebar-reorganization').click();
  await expect(page.getByTestId('move-step').first()).toHaveAttribute('data-status', 'moved');
  await expect(page.getByTestId('move-step').nth(1)).toHaveAttribute('data-status', 'blocked');
});

test('inventory groups items and keeps notes', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('sidebar-inventory').click();
  await expect(page.getByTestId('inventory-total')).toHaveText('11 items in 5 categories');
  const cabinets = page.getByTestId('inventory-line').filter({ hasText: 'Wall cabinet (north), Wall cabinet (south)' });
  await expect(cabinets).toContainText('2×');
  const note = cabinets.getByTestId('inventory-note');
  await note.fill('Empty the cabinets before moving');
  await note.blur();
  await expect.poll(() => project<number>(page, 'Object.keys(p.inventoryNotes).length')).toBe(1);
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 10_000 });
  await page.reload();
  await page.getByTestId('sidebar-inventory').click();
  await expect(page.getByTestId('inventory-line').filter({ hasText: 'Wall cabinet (north)' }).getByTestId('inventory-note')).toHaveValue('Empty the cabinets before moving');
});
