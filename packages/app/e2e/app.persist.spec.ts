import type { Page } from '@playwright/test';
import {
  expect,
  fixture,
  openApp,
  openFiles,
  previewImage,
  renderImage,
  storedModels,
  test,
  waitForModel,
  waitForStored,
  type Rgba,
} from './appTest';

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

const TEXTURE = 'tex16.png';

function sad(a: Rgba, b: Rgba): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
  return sum;
}

async function renderOnce(page: Page, renders: number): Promise<Rgba> {
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-renders', String(renders), { timeout: 180_000 });
  return renderImage(page);
}

async function switchFilterByKeyboard(page: Page): Promise<void> {
  const select = page.locator('#scene-panel').getByRole('combobox', { name: TEXTURE });
  await select.focus();
  await page.keyboard.press('ArrowDown');
}

test('the texture filter follows in the preview and the render, is saved and restored on reload', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('8');
  await samples.dispatchEvent('change');
  const select = page.locator('#scene-panel').getByRole('combobox', { name: TEXTURE });
  await expect(select).toHaveCount(1);
  await expect(select).toHaveValue('nearest');
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 120_000 });
  const nearestPreview = await waitForModel(page);
  const nearestRender = await renderOnce(page, 1);

  await switchFilterByKeyboard(page);
  await expect(select).toHaveValue('linear');
  await expect
    .poll(async () => (await previewImage(page)).data.equals(nearestPreview.data), { timeout: 20_000 })
    .toBe(false);
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 120_000 });
  const linearPreview = await waitForModel(page);
  const linearRender = await renderOnce(page, 2);
  expect(linearRender.data.equals(nearestRender.data), 'the render follows the filter').toBe(false);
  await waitForStored(page, (record) => JSON.stringify(record['textureFilters']) === '["linear"]');

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await expect(page.locator('#scene-panel').getByRole('combobox', { name: TEXTURE })).toHaveValue('linear');
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 120_000 });
  const restored = await waitForModel(page);
  expect(restored.data.equals(nearestPreview.data), 'the restored preview is not the nearest look').toBe(false);
  // The restored preview sits within lighting noise of the linear one and far from the nearest one.
  expect(sad(restored, linearPreview) * 4, 'the restored preview is the linear look').toBeLessThan(
    sad(restored, nearestPreview),
  );
});

test('a filter switch whose scene fails to build reverts the select and saves nothing', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await waitForStored(page, (record) => JSON.stringify(record['textureFilters']) === '["nearest"]');
  await page.evaluate(() => window.__msApp!.failNextScene());
  await switchFilterByKeyboard(page);
  await expect(page.getByRole('alert')).toContainText('Could not update the view');
  await expect(page.locator('#scene-panel').getByRole('combobox')).toHaveValue('nearest');
  await page.waitForTimeout(1500);
  const records = await storedModels(page);
  expect(records.map((record) => JSON.stringify(record['textureFilters']))).toEqual(['["nearest"]']);
});
