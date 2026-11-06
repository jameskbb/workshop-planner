/**
 * The editor shell must fit the window on ordinary laptops, not only on a 1,920 px monitor:
 * nothing may push the page sideways, and the inspector, Export and Help must stay reachable,
 * including when a clearance-bearing object is selected and a sidebar panel is open.
 */
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers';

const WIDTHS = [1280, 1366, 1440, 1600, 1920];

async function docOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Select the demo's table saw (it carries operator / infeed / outfeed clearance zones). */
async function selectTableSaw(page: Page) {
  await page.evaluate(() => {
    const p = window.__wp.useProjectStore.getState().project;
    const s = p.scenarios.find((x: { id: string }) => x.id === p.activeScenarioId)!;
    const o = s.objects.find((x: { name: string }) => /table saw/i.test(x.name)) ?? s.objects[0];
    (window.__wp.useUiStore as unknown as { setState(patch: { selection: Array<{ kind: string; id: string }> }): void }).setState({ selection: [{ kind: 'object', id: o.id }] });
  });
  await expect(page.getByTestId('inspector')).toContainText('Table saw');
}

for (const width of WIDTHS) {
  test(`editor fits a ${width}px window with a clearance-bearing object selected`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width, height: 900 });
    await openDemo(page);
    await selectTableSaw(page);
    // Open the Safety & warnings panel: the widest sidebar content.
    await page.getByTestId('sidebar-warnings').click();
    await page.waitForTimeout(300);

    expect(await docOverflow(page)).toBe(0);

    // The three regions are all on screen.
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toBeVisible();
    const box = await inspector.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.x).toBeGreaterThanOrEqual(0);

    const rail = await page.locator('nav[aria-label="Sidebar sections"]').boundingBox();
    expect(rail!.x).toBeGreaterThanOrEqual(0);

    // Toolbar essentials stay usable at every width.
    for (const id of ['export-menu', 'help-menu', 'print-button', 'open-palette', 'undo']) {
      const el = page.getByTestId(id);
      await expect(el).toBeVisible();
      const b = await el.boundingBox();
      expect(b!.x + b!.width).toBeLessThanOrEqual(width + 1);
    }

    // The clearance rows fit inside the inspector (no horizontal scrolling there either).
    const zoneOverflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="inspector"] .scroll-thin') as HTMLElement | null;
      return el ? el.scrollWidth - el.clientWidth : 0;
    });
    expect(zoneOverflow).toBeLessThanOrEqual(0);
  });
}

test('2D-only controls are not shown in the 3D, Elevation and Compare views', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await expect(page.getByTestId('tool-select')).toBeVisible();
  await expect(page.getByTestId('zoom-in')).toBeVisible();
  await expect(page.getByTestId('view-menu')).toBeVisible();

  for (const view of ['3d', 'elevation', 'compare']) {
    await page.getByTestId(`view-${view}`).click();
    await expect(page.getByTestId('tool-select')).toHaveCount(0);
    await expect(page.getByTestId('zoom-in')).toHaveCount(0);
    await expect(page.getByTestId('toggle-grid')).toHaveCount(0);
    await expect(page.getByTestId('view-menu')).toHaveCount(0);
    await expect(page.getByTestId('overlays-menu')).toHaveCount(0);
    // Export and Help never go away.
    await expect(page.getByTestId('export-menu')).toBeVisible();
    await expect(page.getByTestId('help-menu')).toBeVisible();
  }

  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('tool-select')).toBeVisible();
});

test('five clicks on a library item give five separate placements, not a pile', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  const before = await page.evaluate(() => {
    const p = window.__wp.useProjectStore.getState().project;
    return p.scenarios.find((x: { id: string }) => x.id === p.activeScenarioId)!.objects.length;
  });
  await page.getByTestId('sidebar-library').click();
  await page.getByTestId('library-search').fill('base cabinet');
  for (let i = 0; i < 5; i++) {
    await page.getByTestId('library-item').first().click();
    await page.waitForTimeout(120);
  }
  const added = await page.evaluate(
    (n) => {
      const p = window.__wp.useProjectStore.getState().project;
      const s = p.scenarios.find((x: { id: string }) => x.id === p.activeScenarioId)!;
      return s.objects.slice(n).map((o: { x: number; y: number }) => ({ x: o.x, y: o.y }));
    },
    before as number,
  );
  expect(added).toHaveLength(5);
  const keys = new Set(added.map((p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`));
  expect(keys.size).toBe(5);
  // 36" x 24" cabinets: centers at least a cabinet's depth apart.
  for (let i = 0; i < added.length; i++) {
    for (let j = i + 1; j < added.length; j++) {
      expect(Math.hypot(added[i]!.x - added[j]!.x, added[i]!.y - added[j]!.y)).toBeGreaterThan(500);
    }
  }
});

test('panel test ids are unique (no strict-mode violations)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  const sections = await page.locator('nav[aria-label="Sidebar sections"] button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('sidebar-', '')));
  for (const id of sections) {
    await page.getByTestId(`sidebar-${id}`).click();
    // Clicking the already-open section collapses the sidebar: open it again.
    if ((await page.getByTestId(`panel-${id}`).count()) === 0) await page.getByTestId(`sidebar-${id}`).click();
    await expect(page.getByTestId(`panel-${id}`)).toHaveCount(1);
  }
});
