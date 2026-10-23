import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, test, waitForModel, waitForStored } from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');
const OTHER = fixture('bbmodel', 'flat-cube.bbmodel');

function waitForStoredView(page: Page, projection: string): Promise<void> {
  return waitForStored(page, (record) => (record['camera'] as { projection: string }).projection === projection);
}

const state = (page: Page) => page.evaluate(() => window.__msApp!.state());

async function changeView(page: Page): Promise<void> {
  await page.locator('#preview').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  await page.getByLabel('Field of view').fill('50');
  await page.getByRole('radio', { name: 'Orthographic' }).check();
}

test('the camera is saved with the model and restored on reload', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await changeView(page);
  const before = await state(page);
  expect(before.projection).toBe('orthographic');
  expect(before.fovYDeg).toBeCloseTo(50, 5);
  await waitForStoredView(page, 'orthographic');

  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  const after = await state(page);
  expect(after.projection).toBe('orthographic');
  expect(after.fovYDeg).toBeCloseTo(50, 5);
  expect(after.yawDeg).toBeCloseTo(before.yawDeg, 5);
  expect(after.pitchDeg).toBeCloseTo(before.pitchDeg, 5);
  expect(after.orthoHeight).toBeCloseTo(before.orthoHeight, 5);
  await expect(page.getByRole('radio', { name: 'Orthographic' })).toBeChecked();
  await expect(page.getByLabel('Field of view')).toHaveValue('50');
});

test('opening the same file again restores its view, whatever was open in between', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await changeView(page);
  const before = await state(page);
  await waitForStoredView(page, 'orthographic');
  await openFiles(page, [OTHER], 'flat-cube.bbmodel');
  expect((await state(page)).projection).toBe('perspective');
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const after = await state(page);
  expect(after.projection).toBe('orthographic');
  expect(after.yawDeg).toBeCloseTo(before.yawDeg, 5);
  expect(after.fovYDeg).toBeCloseTo(50, 5);
});

test('the look, the hidden nodes and the render settings are restored', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await page.getByRole('radio', { name: 'Rim' }).check();
  const boxes = page.locator('#scene-panel input[type="checkbox"]');
  await boxes.first().uncheck();
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('32');
  await samples.dispatchEvent('change');
  await waitForStored(page, (record) => (record['render'] as { samples: number }).samples === 32);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await expect(page.getByRole('radio', { name: 'Rim' })).toBeChecked();
  await expect(page.locator('#scene-panel input[type="checkbox"]').first()).not.toBeChecked();
  await expect(page.locator('#render-panel').getByLabel('Samples')).toHaveValue('32');
});

test('Forget local data deletes the database, and the next start has no model and the default view', async ({
  page,
}) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await changeView(page);
  await waitForStored(page, () => true);
  await page.getByRole('button', { name: 'Forget local data' }).click();
  await expect(page.getByRole('status')).toContainText('Local data deleted');
  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(names).not.toContain('modelshot-app');
  await page.reload();
  await page.waitForFunction(() => window.__msApp !== undefined);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Render' })).toBeDisabled();
  const s = await state(page);
  expect(s.projection).toBe('perspective');
  expect(s.yawDeg).toBeCloseTo(210, 5);
});

test('says where the settings are kept, and keeps working when the browser refuses to store them', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#data-heading')).toBeVisible();
  await expect(page.getByText('Everything stays in this browser.')).toBeVisible();
  await page.evaluate(() => {
    const refuse = (): never => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    IDBDatabase.prototype.transaction = refuse;
  });
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await expect(page.getByRole('status')).toContainText('not being kept on this device', { timeout: 10_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Render' })).toBeEnabled();
});
