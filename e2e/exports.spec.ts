import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openDemo } from './helpers';

async function exportVia(page: Page, id: string): Promise<{ name: string; data: Buffer }> {
  await page.getByTestId('export-menu').click();
  await page.getByTestId(`export-${id}`).click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-submit').click()]);
  const path = await download.path();
  const data = await readFile(path!);
  await expect(page.getByTestId('export-dialog')).toBeHidden();
  return { name: download.suggestedFilename(), data };
}

test('export PNG, SVG, PDF, CSV and DXF from the export dialog', async ({ page }) => {
  test.setTimeout(180_000);
  await openDemo(page);

  // SVG: toggles change the preview and the file.
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-svg').click();
  await expect(page.getByTestId('export-preview')).toBeVisible();
  await page.getByTestId('export-toggle-clearances').click();
  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-submit').click()]);
  const svg = await readFile((await svgDl.path())!, 'utf8');
  expect(svgDl.suggestedFilename()).toMatch(/\.svg$/);
  expect(svg).toContain('<svg');
  expect(svg).toContain('Rolling tool cabinet');

  const png = await exportVia(page, 'png');
  expect(png.name).toMatch(/\.png$/);
  expect(png.data.subarray(1, 4).toString()).toBe('PNG');
  expect(png.data.length).toBeGreaterThan(20_000);

  const pdf = await exportVia(page, 'pdf');
  expect(pdf.name).toMatch(/\.pdf$/);
  expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.data.length).toBeGreaterThan(5_000);

  const csv = await exportVia(page, 'csv');
  const text = csv.data.toString('utf8').replace(/^\uFEFF/, '');
  expect(text.split('\r\n')[0]).toBe('Object,Category,Width (in),Depth (in),Height (in),X (in),Y (in),Rotation (deg),Mobile,Notes');
  expect(text).toContain('Rolling tool cabinet (350 lb),Storage');

  const dxf = await exportVia(page, 'dxf');
  const d = dxf.data.toString('utf8');
  expect(d.startsWith('0\r\nSECTION')).toBe(true);
  expect(d).toContain('WALLS');
  expect(d.trimEnd().endsWith('EOF')).toBe(true);
});

test('print mode: toggles, paper sizes and scale', async ({ page }) => {
  await openDemo(page);
  await page.getByTestId('print-button').click();
  await expect(page.getByTestId('print-mode')).toBeVisible();
  const sheet = page.getByTestId('print-sheet').locator('svg');
  await expect(sheet).toHaveAttribute('width', '215.9mm');
  await expect(page.getByTestId('print-scale')).toContainText('Prints at');
  await expect(sheet).toContainText('Sedan');
  await page.getByTestId('print-toggle-vehicle').click();
  await expect(sheet).not.toContainText('Sedan');
  await page.getByRole('combobox', { name: 'Paper size' }).click();
  await page.getByRole('option', { name: /A3/ }).click();
  await expect(sheet).toHaveAttribute('width', '297mm');
  await page.getByRole('combobox', { name: 'Orientation' }).click();
  await page.getByRole('option', { name: 'Landscape' }).click();
  await expect(sheet).toHaveAttribute('width', '420mm');
  await page.getByTestId('print-close').click();
  await expect(page.getByTestId('print-mode')).toBeHidden();
  // Choices are remembered for the project.
  await page.keyboard.press('Control+p');
  await expect(page.getByTestId('print-sheet').locator('svg')).toHaveAttribute('width', '420mm');
});
