import { expect, test } from '@playwright/test';

/**
 * The one spec that runs against the PRODUCTION build (`vite build` + `vite preview`, see the
 * "preview" project in playwright.config.ts). It uses nothing but the DOM (`window.__wp` is a dev
 * build hook), so chunking, `import.meta.env` and lazy-loading regressions that only exist in the
 * built app cannot ship unnoticed.
 */
test('production build: demo opens, an object is added and persists, 3D and print load', async ({ page }) => {
  const errors: string[] = [];
  const console404: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && console404.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
  // Dev-only hooks must not be in the production bundle.
  expect(await page.evaluate(() => '__wp' in window)).toBe(false);

  const demoRow = page.getByTestId('project-row').filter({ hasText: 'Demo: Two-car garage workshop' });
  await expect(demoRow).toBeVisible();
  await demoRow.getByRole('button', { name: /Open Demo/ }).click();

  // The editor is a lazy chunk in the built app.
  await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('plan-canvas').locator('canvas').first()).toBeVisible();

  // Add an object from the library and let autosave write it.
  await page.getByTestId('sidebar-library').click();
  await page.getByTestId('library-search').fill('drill press');
  await page.getByTestId('library-item').first().click();
  await expect(page.getByTestId('inspector')).toContainText('Drill press');
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 15_000 });

  // Reload: the production build reads it back from IndexedDB.
  await page.reload();
  await expect(page.getByTestId('editor-shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('layout-item').first()).toContainText('11 objects');

  // The other lazy chunks resolve: 3D (three) and the print sheet (exports).
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('three-view')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('three-toolbar')).toBeVisible();
  await page.getByTestId('view-2d').click();
  await page.getByTestId('print-button').click();
  await expect(page.getByTestId('print-sheet')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('print-close').click();

  expect(errors).toEqual([]);
  expect(console404.filter((t) => /Failed to load|chunk|MIME/i.test(t))).toEqual([]);
});
