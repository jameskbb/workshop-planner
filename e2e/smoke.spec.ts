import { expect, test } from '@playwright/test';

test('project list → demo garage on canvas → edit → undo/redo → survives reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // First run seeds the demo project.
  const demoRow = page.getByTestId('project-row').filter({ hasText: 'Demo: Two-car garage workshop' });
  await expect(demoRow).toBeVisible();
  await expect(demoRow).toContainText('irregular footprint');
  await demoRow.getByRole('button', { name: /Open Demo/ }).click();

  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('plan-canvas').locator('canvas').first()).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  // Warnings are computed from the demo geometry.
  await page.getByTestId('sidebar-warnings').click();
  await expect(page.getByTestId('warning-item').first()).toBeVisible();
  await expect(page.getByText('Table saw outfeed clearance intersects the East wall (south) by 7 1/2".')).toBeVisible();

  // Add an object from the library, then undo and redo it.
  await page.getByTestId('sidebar-library').click();
  await page.getByTestId('library-search').fill('drill press');
  await page.getByTestId('library-item').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Drill press');
  await page.getByTestId('inspector-width').fill('24"');
  await page.getByTestId('inspector-width').press('Enter');
  await expect(page.getByTestId('inspector-width')).toHaveValue('2\' 0"');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('inspector-width')).toHaveValue('20"');
  await page.getByTestId('redo').click();
  await expect(page.getByTestId('inspector-width')).toHaveValue('2\' 0"');

  // Autosave, then reload: the edit persists.
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 5000 });
  await page.reload();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  // The Project panel is the default sidebar section; the added drill press was saved (10 → 11 objects).
  await expect(page.getByTestId('layout-item')).toHaveCount(2);
  await expect(page.getByTestId('layout-item').first()).toContainText('11 objects');
  expect(errors).toEqual([]);
});
