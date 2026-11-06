/// <reference lib="dom" />
import { expect, type Page } from '@playwright/test';

type WP = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useProjectStore: { getState(): { project: any; past: unknown[] } };
  useUiStore: { getState(): { viewport: { x: number; y: number; scale: number; rotation?: number }; selection: Array<{ kind: string; id: string }>; tool: string } };
};
declare global {
  interface Window {
    __wp: WP;
  }
}

/** Page coordinates of a world point (mm) on the plan canvas. */
export async function worldToPage(page: Page, p: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    const v = window.__wp.useUiStore.getState().viewport;
    const r = document.querySelector('[data-testid="plan-canvas"]')!.getBoundingClientRect();
    const rot = ((v.rotation ?? 0) * Math.PI) / 180;
    const sx = x * v.scale;
    const sy = y * v.scale;
    return { x: r.left + v.x + sx * Math.cos(rot) - sy * Math.sin(rot), y: r.top + v.y + sx * Math.sin(rot) + sy * Math.cos(rot) };
  }, p);
}

/** Read a value from the open project in the page. */
export async function project<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate((src) => {
    const p = window.__wp.useProjectStore.getState().project;
    const s = p.scenarios.find((x: { id: string }) => x.id === p.activeScenarioId);
    return new Function('p', 's', `return (${src});`)(p, s);
  }, fn) as Promise<T>;
}

export async function selection(page: Page): Promise<Array<{ kind: string; id: string }>> {
  return page.evaluate(() => window.__wp.useUiStore.getState().selection);
}

/** Drag with intermediate pointer moves (so tools see a real gesture). */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { steps?: number; shift?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.down();
  const steps = opts.steps ?? 8;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
}

/** Dismiss the one-time tour invitation so it never overlaps what a test clicks. */
export async function prepare(page: Page) {
  await page.addInitScript(() => {
    try {
      const k = 'wp.viewPrefs';
      const cur = JSON.parse(localStorage.getItem(k) ?? '{}');
      localStorage.setItem(k, JSON.stringify({ ...cur, tourDismissed: true }));
    } catch {
      /* ignore */
    }
  });
}

export async function openDemo(page: Page) {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('open-demo').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
  await expect(page.getByTestId('plan-canvas').locator('canvas').first()).toBeVisible();
  // Let the initial fit settle.
  await page.waitForTimeout(300);
}
