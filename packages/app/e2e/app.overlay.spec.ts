import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  expect,
  fixture,
  openApp,
  openFiles,
  openTab,
  previewImage,
  renderImage,
  test,
  waitForEditor,
  waitForModel,
  expectLit,
} from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');
const overlayPixels = (page: Page): Promise<number> => page.evaluate(() => window.__msApp!.overlayPixels());

async function openNested(page: Page): Promise<void> {
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
}

async function setOverlays(page: Page, on: boolean): Promise<void> {
  await page.getByRole('button', { name: 'Overlays' }).click();
  for (const label of ['Grid floor', 'Axis gizmo', 'Statistics', 'Camera presets', 'Light and transform gizmos']) {
    await page.getByRole('checkbox', { name: label }).setChecked(on);
  }
  await page.keyboard.press('Escape');
}

test('each overlay toggle hides its layer', async ({ page }) => {
  await openNested(page);
  await page.getByRole('button', { name: 'Overlays' }).click();
  await expect(page.getByRole('checkbox', { name: 'Statistics' })).not.toBeChecked();
  await page.keyboard.press('Escape');
  await setOverlays(page, false);
  await expect.poll(() => overlayPixels(page)).toBe(0);
  await expect(page.locator('#camera-presets')).toBeHidden();
  await expect(page.locator('#stats')).toBeHidden();

  const only = async (label: string): Promise<number> => {
    await setOverlays(page, false);
    await page.getByRole('button', { name: 'Overlays' }).click();
    await page.getByRole('checkbox', { name: label }).check();
    await page.keyboard.press('Escape');
    return overlayPixels(page);
  };
  await expect.poll(() => only('Grid floor')).toBeGreaterThan(0);
  await expect.poll(() => only('Axis gizmo')).toBeGreaterThan(0);
  await expect.poll(() => only('Light and transform gizmos')).toBeGreaterThan(0);
  await only('Statistics');
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#stats')).toContainText('triangles');
  await only('Camera presets');
  await expect(page.locator('#camera-presets')).toBeVisible();
});

test('the overlay, a selection and the gizmo never reach the preview, the render or an export', async ({ page }) => {
  await openNested(page);
  await expectLit(page, 120_000);
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4');
  await samples.dispatchEvent('change');

  const shoot = async (): Promise<{ preview: Buffer; render: Buffer; exported: Buffer }> => {
    const preview = (await previewImage(page)).data;
    await page.getByRole('button', { name: 'Render', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Render done', { timeout: 90_000 });
    const render = (await renderImage(page)).data;
    await page.getByRole('button', { name: 'Export…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await dialog.getByLabel('Width (px)').fill('48');
    await dialog.getByLabel('Height (px)').fill('48');
    await dialog.getByLabel('Samples').fill('4');
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    const exported = await readFile(await (await download).path());
    await dialog.getByRole('button', { name: 'Close' }).click();
    return { preview, render, exported };
  };

  await setOverlays(page, false);
  const bare = await shoot();

  await setOverlays(page, true);
  await page.locator('#scene-panel [data-row^="node:"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__msApp!.gizmoHandles().length)).toBe(3);
  expect(await overlayPixels(page)).toBeGreaterThan(0);
  const decorated = await shoot();

  expect(decorated.preview.equals(bare.preview), 'preview pixels').toBe(true);
  expect(decorated.render.equals(bare.render), 'render pixels').toBe(true);
  expect(decorated.exported.equals(bare.exported), 'exported PNG').toBe(true);
});
