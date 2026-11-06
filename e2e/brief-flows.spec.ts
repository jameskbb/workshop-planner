/**
 * The brief's critical flows not covered by the feature specs:
 *   6. creating a scenario (layout): independent of the original, survives reload
 *   7. saving / reloading a project
 *   8. exporting / importing the JSON project file (round trip, plus a rejected bad file)
 * (1–5: new project, drawing a room, adding, dragging and exact dimensions; these are in workflow.spec.ts;
 *  the Phase 4 layout manager has its own spec in phase4-scenarios.spec.ts.)
 */
import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { openDemo, project } from './helpers';

test('create a layout from the current one: independent arrangement, persists across reload', async ({ page }) => {
  await openDemo(page);
  const original = await project<string>(page, 'p.activeScenarioId');
  const count = await project<number>(page, 'p.scenarios.length');
  // The Project panel (with the layout manager) is the default sidebar section.
  if (!(await page.getByTestId('duplicate-layout').isVisible())) await page.getByTestId('sidebar-project').click();
  await page.getByTestId('duplicate-layout').click();
  await expect.poll(() => project<number>(page, 'p.scenarios.length')).toBe(count + 1);
  const copyId = await project<string>(page, 'p.activeScenarioId');
  expect(copyId).not.toBe(original);
  // Same room, same items (ids kept), independent positions.
  expect(await project<number>(page, 's.objects.length')).toBe(await project<number>(page, `p.scenarios.find(x => x.id === '${original}').objects.length`));
  const cart = await project<{ id: string; x: number }>(page, `s.objects.find(o => /tool cart/i.test(o.name))`);
  await page.evaluate((id) => {
    const wp = (window as unknown as { __wp: { dispatch(c: unknown): void } }).__wp;
    wp.dispatch({ type: 'object.move', payload: { moves: [{ id, x: 1000, y: 1000 }] } });
  }, cart.id);
  await expect.poll(() => project<number>(page, `s.objects.find(o => o.id === '${cart.id}').x`)).toBe(1000);
  expect(await project<number>(page, `p.scenarios.find(x => x.id === '${original}').objects.find(o => o.id === '${cart.id}').x`)).toBeCloseTo(cart.x, 2);

  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  expect(await project<number>(page, 'p.scenarios.length')).toBe(count + 1);
  expect(await project<number>(page, `p.scenarios.find(x => x.id === '${copyId}').objects.find(o => o.id === '${cart.id}').x`)).toBe(1000);
});

test('save, export JSON, delete, import the file back: the project round-trips; a bad file is rejected clearly', async ({ page }, info) => {
  await openDemo(page);
  // Make an edit so the round trip carries user data.
  await page.getByTestId('project-title').click();
  await page.locator('#rename-input').fill('Round trip garage');
  await page.locator('#rename-input').press('Enter');
  await expect(page.getByTestId('project-title')).toHaveText('Round trip garage');
  const before = await project<{ objects: number; walls: number; scenarios: number }>(page, '({ objects: s.objects.length, walls: p.room.walls.length, scenarios: p.scenarios.length })');
  await expect(page.getByTestId('save-status')).toContainText('Saved', { timeout: 10_000 });

  // Export
  await page.getByTestId('export-menu').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  expect(download.suggestedFilename()).toBe('round-trip-garage.workshop.json');
  const json = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(json).project.name).toBe('Round trip garage');

  // Delete it from the project list
  await page.getByTestId('go-home').click();
  const row = page.getByTestId('project-row').filter({ hasText: 'Round trip garage' });
  await expect(row).toBeVisible();
  await row.getByTestId('project-actions').click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(row).toHaveCount(0);

  // Import the exported file
  const file = info.outputPath('round-trip-garage.workshop.json');
  await writeFile(file, json);
  await page.getByTestId('import-input').setInputFiles(file);
  await expect(page.getByRole('status').filter({ hasText: 'Imported "Round trip garage"' })).toBeVisible();
  await page.getByTestId('project-row').filter({ hasText: 'Round trip garage' }).getByRole('button', { name: 'Open Round trip garage' }).click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  const after = await project<{ objects: number; walls: number; scenarios: number }>(page, '({ objects: s.objects.length, walls: p.room.walls.length, scenarios: p.scenarios.length })');
  expect(after).toEqual(before);

  // A malformed file is refused with a specific message.
  await page.getByTestId('go-home').click();
  const bad = info.outputPath('broken.workshop.json');
  await writeFile(bad, '{"format":"workshop-planner","project":{"name":42}}');
  await page.getByTestId('import-input').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText("Couldn't import \"broken.workshop.json\"");
});
