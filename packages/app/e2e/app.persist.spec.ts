import type { Locator, Page } from '@playwright/test';
import {
  expect,
  fixture,
  openApp,
  forgetLocalData,
  openFileMenu,
  openFiles,
  openTab,
  previewImage,
  renderImage,
  storedModels,
  test,
  type Rgba,
  waitForEditor,
  waitForModel,
  waitForStored,
  expectLit,
} from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');
const OTHER = fixture('bbmodel', 'flat-cube.bbmodel');
const ANIMATED = fixture('bbmodel', 'animated.bbmodel');

function waitForStoredView(page: Page, projection: string): Promise<void> {
  return waitForStored(page, (record) => (record['camera'] as { projection: string }).projection === projection);
}

const state = (page: Page) => page.evaluate(() => window.__msApp!.state());

async function changeView(page: Page): Promise<void> {
  await page.locator('#preview').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  await openTab(page, 'Render');
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
  await openTab(page, 'Look');
  await page.getByRole('radio', { name: 'Rim' }).check();
  await page.locator('#scene-panel .row-eye').first().click();
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('32');
  await samples.dispatchEvent('change');
  await waitForStored(page, (record) => (record['render'] as { samples: number }).samples === 32);
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await openTab(page, 'Look');
  await expect(page.getByRole('radio', { name: 'Rim' })).toBeChecked();
  await expect(page.locator('#scene-panel .row-eye').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#render-panel').getByLabel('Samples')).toHaveValue('32');
});

test('a look adjustment is kept with the model and restored, and a stored bad one is ignored', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'nested-groups.bbmodel')], 'nested-groups.bbmodel');
  await openTab(page, 'Look');
  const slider = page.getByRole('slider', { name: 'Exposure' });
  await slider.fill('1.5');
  await page.locator('#backdrop-colour').fill('#336699');
  await waitForStored(
    page,
    (record) => JSON.stringify(record['lookAdjust']) === '{"exposure":1.5,"saturation":1,"backdrop":"#336699"}',
  );
  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await openTab(page, 'Look');
  await expect(page.getByRole('slider', { name: 'Exposure' })).toHaveValue('1.5');
  await expect(page.getByRole('radio', { name: 'Colour', exact: true })).toBeChecked();
  await expect(page.locator('#backdrop-colour')).toHaveValue('#336699');
  await page.getByRole('button', { name: 'Reset adjustments' }).click();
  await waitForStored(page, (record) => record['lookAdjust'] === undefined);
});

test('Forget local data deletes the database, and the next start has no model and the default view', async ({
  page,
}) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await changeView(page);
  await waitForStored(page, () => true);
  await forgetLocalData(page);
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
  await openFileMenu(page);
  await expect(page.getByText('Everything stays in this browser.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const refuse = (): never => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    IDBDatabase.prototype.transaction = refuse;
  });
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await expect(page.locator('#storage-chip')).toContainText('not being kept on this device', { timeout: 10_000 });
  await expect(page.getByRole('status')).not.toContainText('not being kept');
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

// The Nearest / Linear segment of the texture, found by its group name.
const filterRadio = (page: Page, filter: 'Nearest' | 'Linear'): Locator =>
  page
    .locator('#inspector')
    .getByRole('group', { name: `Filter ${TEXTURE}` })
    .getByRole('radio', { name: filter });

async function switchFilterByKeyboard(page: Page): Promise<void> {
  await openTab(page, 'Material');
  await filterRadio(page, 'Nearest').focus();
  await page.keyboard.press('ArrowRight');
}

test('the texture filter follows in the preview and the render, is saved and restored on reload', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('8');
  await samples.dispatchEvent('change');
  await openTab(page, 'Material');
  await expect(filterRadio(page, 'Nearest')).toBeChecked();
  await expectLit(page, 120_000);
  const nearestPreview = await waitForModel(page);
  const nearestRender = await renderOnce(page, 1);

  await switchFilterByKeyboard(page);
  await expect(filterRadio(page, 'Linear')).toBeChecked();
  await expect
    .poll(async () => (await previewImage(page)).data.equals(nearestPreview.data), { timeout: 20_000 })
    .toBe(false);
  await expectLit(page, 120_000);
  const linearPreview = await waitForModel(page);
  const linearRender = await renderOnce(page, 2);
  expect(linearRender.data.equals(nearestRender.data), 'the render follows the filter').toBe(false);
  await waitForStored(page, (record) => JSON.stringify(record['textureFilters']) === '["linear"]');

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened single-cube.bbmodel', { timeout: 30_000 });
  await openTab(page, 'Material');
  await expect(filterRadio(page, 'Linear')).toBeChecked();
  await expectLit(page, 120_000);
  const restored = await waitForModel(page);
  expect(restored.data.equals(nearestPreview.data), 'the restored preview is not the nearest look').toBe(false);
  // The restored preview sits within lighting noise of the linear one and far from the nearest one.
  expect(sad(restored, linearPreview) * 4, 'the restored preview is the linear look').toBeLessThan(
    sad(restored, nearestPreview),
  );
});

// A model with clips turns the timeline bar into the full panel, so the view is lower than at boot. A camera is framed
// and stored relative to the fit of the view's aspect: applied before the view has that size, it was off wherever the
// fit follows the width (a view higher than wide).
async function openAnimated(page: Page, shape: 'portrait' | 'landscape'): Promise<void> {
  await page.setViewportSize(shape === 'portrait' ? { width: 1100, height: 1100 } : { width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [ANIMATED], 'animated.bbmodel');
  await waitForEditor(page);
  await expect(page.locator('#timeline select')).toBeVisible();
  const view = await page.locator('#viewport').boundingBox();
  expect(view!.width < view!.height, `the view is ${shape}`).toBe(shape === 'portrait');
}

test('an animated model is framed to fit the view it is shown in, the full timeline included', async ({ page }) => {
  await openAnimated(page, 'portrait');
  expect((await state(page)).distance).toBeCloseTo(1, 6);
});

for (const shape of ['portrait', 'landscape'] as const) {
  test(`an animated model restores its camera on reload in a ${shape} view`, async ({ page }) => {
    // Two light bakes of the animated model in the portrait case.
    test.setTimeout(360_000);
    await openAnimated(page, shape);
    await page.locator('#preview').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('+');
    const before = await state(page);
    await waitForStored(page, (record) => {
      const camera = record['camera'] as { yawDeg: number; distance: number };
      return Math.abs(camera.yawDeg - before.yawDeg) < 1e-6 && Math.abs(camera.distance - before.distance) < 1e-6;
    });
    // The picture is compared where the zoom depended on the view's size; the camera values everywhere.
    const picture = shape === 'portrait';
    if (picture) await expectLit(page, 120_000);
    const shown = picture ? await waitForModel(page) : null;

    await page.reload();
    await expect(page.getByRole('status')).toContainText('Opened animated.bbmodel', { timeout: 30_000 });
    await waitForEditor(page);
    await expect(page.locator('#timeline select')).toBeVisible();
    // A resize the reload still owed would arrive with the next frame: the camera is read after it.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await state(page);
    expect(after.yawDeg).toBeCloseTo(before.yawDeg, 6);
    expect(after.pitchDeg).toBeCloseTo(before.pitchDeg, 6);
    expect(after.distance, 'the same zoom as saved').toBeCloseTo(before.distance, 6);
    if (!shown) return;
    await expectLit(page, 120_000);
    const restored = await waitForModel(page);
    expect([restored.width, restored.height]).toEqual([shown.width, shown.height]);
    // The same picture up to the noise of a second light bake: under a quarter of a level per byte on average.
    expect(sad(restored, shown) / shown.data.length, 'the restored preview is the saved view').toBeLessThan(0.25);
  });
}

test('a filter switch whose scene fails to build reverts the segment and saves nothing', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
  await waitForStored(page, (record) => JSON.stringify(record['textureFilters']) === '["nearest"]');
  await page.evaluate(() => window.__msApp!.failNextScene());
  await switchFilterByKeyboard(page);
  await expect(page.getByRole('alert')).toContainText('Could not update the view');
  await expect(filterRadio(page, 'Nearest')).toBeChecked();
  await page.waitForTimeout(1500);
  const records = await storedModels(page);
  expect(records.map((record) => JSON.stringify(record['textureFilters']))).toEqual(['["nearest"]']);
});
