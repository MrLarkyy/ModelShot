import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import { expect, fixture, meanColour, openApp, openFiles, pixelAt, previewImage, test, waitForModel } from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

async function setSamples(page: Page, samples: number): Promise<void> {
  await page.getByLabel('Samples').first().fill(String(samples));
  await page.getByLabel('Samples').first().dispatchEvent('change');
}

test('opens a model, switches the look, renders and exports a transparent PNG', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Render' })).toBeDisabled();
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const studio = await waitForModel(page);
  const centre = pixelAt(studio, 0.5, 0.5);
  const corner = pixelAt(studio, 0.02, 0.02);
  expect(
    Math.abs(centre[0] - corner[0]) + Math.abs(centre[1] - corner[1]) + Math.abs(centre[2] - corner[2]),
  ).toBeGreaterThan(30);

  await page.getByRole('radio', { name: 'Marketplace' }).check();
  await page.waitForTimeout(300);
  const marketplace = await previewImage(page);
  const [sr, sg, sb] = meanColour(studio);
  const [mr, mg, mb] = meanColour(marketplace);
  expect(Math.abs(sr - mr) + Math.abs(sg - mg) + Math.abs(sb - mb)).toBeGreaterThan(5);

  await setSamples(page, 16);
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 90_000 });
  await expect(page.locator('#result')).toBeVisible();

  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Width (px)').fill('64');
  await dialog.getByLabel('Height (px)').fill('64');
  await dialog.getByLabel('Samples').fill('8');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('single-cube-modelshot.png');
  const path = await file.path();
  const png = PNG.sync.read(await readFile(path));
  expect([png.width, png.height]).toEqual([64, 64]);
  expect(png.data[3]).toBe(0);
  const middle = (32 * 64 + 32) * 4 + 3;
  expect(png.data[middle]).toBe(255);
});
