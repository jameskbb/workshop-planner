import { expect, test } from '@playwright/test';
import { openDemo, project } from './helpers';

test.setTimeout(180_000);

test('create a custom object with metadata, add it to the plan, find it in My objects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);

  await page.getByTestId('sidebar-my-objects').click();
  await page.getByTestId('new-custom-object').click();
  const dialog = page.getByTestId('custom-object-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('co-name').fill('My rolling cabinet');
  for (const [id, v] of [
    ['co-width', '48"'],
    ['co-depth', '24"'],
    ['co-height', '72"'],
  ] as const) {
    await page.getByTestId(id).fill(v);
    await page.getByTestId(id).press('Enter');
  }
  await page.getByTestId('co-weight').fill('350');
  await page.getByTestId('co-mobile').click();
  await dialog.getByTestId('add-zone').click();
  await page.getByRole('menuitem', { name: /Access/ }).click();
  await expect(dialog.getByTestId('zone-row')).toHaveCount(1);
  await page.getByTestId('co-save-add').click();
  await expect(dialog).toBeHidden();

  // Added to the plan with the entered sizes and metadata.
  await expect(page.getByTestId('inspector')).toContainText('My rolling cabinet');
  const o = await project<{ width: number; depth: number; height: number; mobility: string; definitionId: string }>(page, "s.objects.find(o => o.name === 'My rolling cabinet')");
  expect(o.width).toBeCloseTo(48 * 25.4, 2);
  expect(o.depth).toBeCloseTo(24 * 25.4, 2);
  expect(o.height).toBeCloseTo(72 * 25.4, 2);
  expect(o.mobility).toBe('mobile');
  const def = await project<{ weightKg: number; clearances: unknown[]; source: string }>(page, `p.definitions.find(d => d.id === '${o.definitionId}')`);
  expect(def.source).toBe('custom');
  expect(def.weightKg).toBeCloseTo(158.76, 1);
  expect(def.clearances).toHaveLength(1);

  // It is in the cross-project library.
  await expect(page.getByTestId('custom-object-row').filter({ hasText: 'My rolling cabinet' })).toBeVisible();
  expect(errors).toEqual([]);
});
