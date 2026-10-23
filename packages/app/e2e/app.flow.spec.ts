import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { Page } from '@playwright/test';
import {
  apngFrameCount,
  expect,
  fixture,
  gifFrameCount,
  meanColour,
  openApp,
  openFiles,
  pixelAt,
  previewImage,
  test,
  waitForModel,
} from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

async function setSamples(page: Page, samples: number): Promise<void> {
  const field = page.locator('#render-panel').getByLabel('Samples');
  await field.fill(String(samples));
  await field.dispatchEvent('change');
}

async function exportClip(page: Page, format: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Kind').selectOption('turntable');
  await dialog.getByLabel('Format').selectOption(format);
  await dialog.getByLabel('Width (px)').fill('64');
  await dialog.getByLabel('Height (px)').fill('64');
  await dialog.getByLabel('Samples').fill('4');
  await dialog.getByLabel('Frames', { exact: true }).fill('4');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  // An APNG is a PNG file: it keeps the .png extension.
  expect(file.suggestedFilename()).toBe(`single-cube-modelshot.${format === 'apng' ? 'png' : format}`);
  const buffer = await readFile(await file.path());
  await expect(dialog.getByText(/^Saved single-cube-modelshot/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  return buffer;
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
  const png = PNG.sync.read(await readFile(await file.path()));
  expect([png.width, png.height]).toEqual([64, 64]);
  expect(png.data[3], 'a corner pixel is transparent').toBe(0);
  expect(png.data[(32 * 64 + 32) * 4 + 3], 'the middle is the model').toBe(255);
});

test('exports a 4-frame GIF and a 4-frame APNG turntable', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const gif = await exportClip(page, 'gif');
  expect(gif.toString('latin1', 0, 6)).toBe('GIF89a');
  expect(gifFrameCount(gif)).toBe(4);
  expect(gif.readUInt16LE(6)).toBe(64);

  const apng = await exportClip(page, 'apng');
  expect(apng.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(apngFrameCount(apng)).toBe(4);
});

test('shows an export problem in the dialog and keeps Export off until it is fixed', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  const exportButton = dialog.getByRole('button', { name: 'Export', exact: true });
  await dialog.getByLabel('Width (px)').fill('5000');
  await expect(exportButton).toBeDisabled();
  await expect(dialog.locator('.field-error')).toContainText('width');
  await dialog.getByLabel('Width (px)').fill('64');
  await expect(exportButton).toBeEnabled();
  await dialog.getByLabel('Kind').selectOption('turntable');
  await dialog.getByLabel('Format').selectOption('webm');
  await dialog.getByLabel('Width (px)').fill('63');
  await expect(exportButton).toBeDisabled();
  await expect(dialog.locator('.field-error')).toContainText('even');
});

test('Escape closes the export dialog and the page keeps working', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Render' })).toBeEnabled();
});
