import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { fixture } from './appTest';

// No request filter here: the service worker's own requests must work, and the network is cut with setOffline.
test('after the first load the whole flow works offline, export included', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/app/');
  await page.waitForFunction(() => window.__msApp !== undefined);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // The worker claims the page when it activates; wait for that and for the precache to be complete.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('modelshot-app-'));
    const cache = await caches.open(names[0] ?? '');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached).toContain('/app/');
  expect(cached.some((path) => path.includes('/assets/loadWorker'))).toBe(true);
  expect(cached.some((path) => path.includes('/assets/bakeWorker'))).toBe(true);
  expect(cached.some((path) => path.includes('/assets/geometryWorker'))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await page.locator('#file-input').setInputFiles([fixture('bbmodel', 'single-cube.bbmodel')]);
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 60_000 });

  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 60_000 });

  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Width (px)').fill('32');
  await dialog.getByLabel('Height (px)').fill('32');
  await dialog.getByLabel('Samples').fill('2');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
