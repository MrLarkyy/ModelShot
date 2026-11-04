import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { expect, fixture, openApp, openFiles, openTab, renderImage, test, waitForEditor } from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

async function stubShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files?.[0];
        if (!file) return;
        const url = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.readAsDataURL(file);
        });
        Reflect.set(window, '__shared', { count: data.files?.length, type: file.type, name: file.name, url });
      },
    });
  });
}

async function renderOnce(page: Page): Promise<void> {
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('2');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-renders', '1', { timeout: 60_000 });
}

test('Share is hidden where the browser cannot share files', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  await renderOnce(page);
  await expect(page.getByRole('button', { name: 'Share' })).toBeHidden();
});

test('Share hands the finished render as one PNG file to the share sheet, and only after a render', async ({
  page,
}) => {
  await stubShare(page);
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  const share = page.getByRole('button', { name: 'Share' });
  await expect(share).toBeHidden();
  await renderOnce(page);
  await expect(share).toBeVisible();
  await share.click();
  await expect
    .poll(() => page.evaluate((): unknown => Reflect.get(window, '__shared') as unknown))
    .toMatchObject({ count: 1, type: 'image/png', name: 'single-cube-modelshot.png' });
  const shared = (await page.evaluate((): unknown => Reflect.get(window, '__shared') as unknown)) as { url: string };
  // The same pixels as the render on show.
  const png = PNG.sync.read(Buffer.from(shared.url.slice(shared.url.indexOf(',') + 1), 'base64'));
  const render = await renderImage(page);
  expect([png.width, png.height]).toEqual([render.width, render.height]);
  expect(Buffer.from(png.data).equals(render.data)).toBe(true);
  // The view changes: the render no longer matches and Share goes away.
  await page.locator('#preview').dispatchEvent('wheel', { deltaY: 200 });
  await expect(share).toBeHidden();
});
