import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, openTab, test, waitForEditor } from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');
const RUNNING = /\d+ \/ 4096 samples · \d+ % · \d+:\d{2}/;

async function setSamples(page: Page, value: number): Promise<void> {
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill(String(value));
  await samples.dispatchEvent('change');
}

const viewportBox = (page: Page): Promise<unknown> => page.locator('#viewport').boundingBox();

test('the render bar names the sample count', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  await setSamples(page, 256);
  await expect(page.locator('#render-meta')).toHaveText('· 256 samples');
  await expect(page.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
});

// One page for both ways out: a second page right after a cancelled 4096-sample render waits on the GPU process draining it.
test('a render shows samples, percent and time, and Esc and Stop each cancel it cleanly', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  await setSamples(page, 4096);
  const before = await viewportBox(page);
  const info = page.locator('#render-info');
  for (const stop of ['Escape', 'Stop'] as const) {
    await page.locator('#preview').focus();
    await page.keyboard.press('r');
    await expect(info).toHaveText(RUNNING, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.locator('#progress')).toHaveAttribute('aria-valuetext', RUNNING);
    const first = (await info.textContent()) ?? '';
    await expect.poll(async () => (await info.textContent()) ?? '', { timeout: 15_000 }).not.toBe(first);
    expect(await viewportBox(page), 'the view keeps its size during the render').toEqual(before);
    if (stop === 'Escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('status')).toContainText('Render cancelled', { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden();
    await expect(info).toBeHidden();
    await expect(page.locator('#result')).toBeHidden();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await viewportBox(page)).toEqual(before);
  }
});

test('a finished render shows its size, samples and time', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForEditor(page);
  await setSamples(page, 8);
  const before = await viewportBox(page);
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 90_000 });
  await expect(page.locator('#render-info')).toHaveText(/\d+ × \d+ px · 8 samples · \d+:\d{2}/);
  await expect(page.getByRole('button', { name: 'Render', exact: true })).toBeEnabled();
  expect(await viewportBox(page), 'the view keeps its size after the render').toEqual(before);
});
