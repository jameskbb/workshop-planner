import { expect, test, type Page } from '@playwright/test';
import { openDemo, project } from './helpers';

/**
 * 3D view. Headless Chromium on the build machine has no usable WebGL, so the view falls back to
 * its software (SVG) renderer; with `WP_E2E_WEBGL=1` the same spec also runs in a GPU-enabled
 * project (see playwright.config.ts) against the WebGL renderer. Assertions use the scene/camera
 * state the view exposes in dev builds, so they do not depend on pixels.
 */
type Cam = { position: [number, number, number]; target: [number, number, number]; orthographic?: boolean };
const cam = (page: Page) => page.evaluate(() => (window as unknown as { __wp3d: { camera(): Cam } }).__wp3d.camera());

test('3D view: generated scene, presets, projection, walls/ceiling, walk mode and saved cameras', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  await page.getByTestId('view-3d').click();
  const view = page.getByTestId('three-view');
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(view).toHaveAttribute('data-objects', '10');
  await expect(page.getByTestId('three-toolbar')).toBeVisible();
  await expect.poll(async () => (await cam(page))?.position.length ?? 0, { timeout: 20_000 }).toBe(3);
  const stats = await page.evaluate(() => (window as unknown as { __wp3d: { stats: Record<string, number> } }).__wp3d.stats);
  expect(stats).toMatchObject({ objects: 10, vehicles: 1, openings: 3, lights: 4 });
  expect(stats.walls).toBeGreaterThan(6); // walls split around the garage door, entry door and window

  // Presets move the camera to the named side.
  await page.getByTestId('three-preset-top').click();
  await expect.poll(async () => (await cam(page)).position[1]).toBeGreaterThan(8);
  await page.getByTestId('three-preset-front').click();
  await expect.poll(async () => (await cam(page)).position[2]).toBeGreaterThan(8);
  await page.getByTestId('three-preset-left').click();
  await expect.poll(async () => (await cam(page)).position[0]).toBeLessThan(0);

  // Projection and visibility toggles.
  await page.getByTestId('three-projection').click();
  await expect(page.getByTestId('three-projection')).toHaveText(/Orthographic/);
  await expect.poll(async () => (await cam(page)).orthographic).toBe(true);
  await page.getByTestId('three-projection').click();
  await page.getByTestId('three-walls').click();
  await expect(page.getByTestId('three-walls')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('three-ceiling').click();
  await expect(page.getByTestId('three-ceiling')).toHaveAttribute('aria-pressed', 'true');

  // Saved camera: create, rename, recall, delete.
  await page.getByTestId('three-preset-perspective').click();
  await page.getByTestId('three-saved-views').click();
  await page.getByTestId('three-save-view').click();
  await page.locator('#rename-input').fill('Bench corner');
  await page.locator('#rename-input').press('Enter');
  await expect.poll(() => project<number>(page, `p.savedViews.filter(v => v.mode === '3d').length`)).toBe(1);
  await page.getByTestId('three-preset-top').click();
  await page.getByTestId('three-saved-views').click();
  await page.getByRole('button', { name: 'Rename Bench corner' }).click();
  await page.locator('#rename-input').fill('Workbench view');
  await page.locator('#rename-input').press('Enter');
  await expect.poll(() => project<string>(page, `p.savedViews[0].name`)).toBe('Workbench view');
  await page.getByTestId('three-saved-views').click();
  await page.getByTestId('three-view-item').filter({ hasText: 'Workbench view' }).click();
  const saved = await project<Cam>(page, 'p.savedViews[0].camera3d');
  await expect.poll(async () => Math.abs((await cam(page)).position[1] - saved.position[1])).toBeLessThan(0.05);
  await page.getByTestId('three-saved-views').click();
  await page.getByTestId('three-view-delete').click();
  await expect.poll(() => project<number>(page, 'p.savedViews.length')).toBe(0);
  await page.keyboard.press('Escape');

  // Walk mode: eye height, WASD moves (and does not switch editor tools).
  await page.getByTestId('three-mode-walk').click();
  await expect(page.getByTestId('three-walk-hint')).toBeVisible();
  await expect.poll(async () => (await cam(page)).position[1]).toBeCloseTo(1.6, 2);
  const before = await cam(page);
  await page.getByTestId('three-view').click({ position: { x: 20, y: 300 } });
  for (let i = 0; i < 4; i++) await page.keyboard.press('w');
  await expect.poll(async () => Math.hypot((await cam(page)).position[0] - before.position[0], (await cam(page)).position[2] - before.position[2])).toBeGreaterThan(0.2);
  expect(await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState(): { tool: string } } } }).__wp.useUiStore.getState().tool)).toBe('select');

  // Back to the plan.
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('plan-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
