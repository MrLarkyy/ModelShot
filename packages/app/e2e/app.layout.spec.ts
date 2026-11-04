import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFileMenu, openFiles, test, waitForEditor } from './appTest';

const NESTED = fixture('bbmodel', 'nested-groups.bbmodel');

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} is not shown`);
  return found;
}

for (const [width, height] of [
  [1280, 720],
  [1440, 900],
  [1920, 1080],
] as const) {
  test(`the editor lays out outliner, view, inspector and timeline at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await openFiles(page, [NESTED], 'nested-groups.bbmodel');
    await waitForEditor(page);
    const outliner = await box(page, '#outliner');
    const viewport = await box(page, '#viewport');
    const inspector = await box(page, '#inspector');
    const timeline = await box(page, '#timeline');
    expect(outliner.x + outliner.width).toBeLessThanOrEqual(viewport.x + 1);
    expect(viewport.x + viewport.width).toBeLessThanOrEqual(inspector.x + 1);
    expect(timeline.y).toBeGreaterThanOrEqual(viewport.y + viewport.height - 1);
    expect(viewport.width).toBeGreaterThan(width * 0.5);
    expect(viewport.height).toBeGreaterThan(height * 0.4);
    // The page itself never scrolls: the panels do.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`editor-${width}.png`) });
  });
}

test('below 1024 px the panels are drawers over a usable view', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  await waitForEditor(page);
  await expect(page.locator('#outliner')).toBeHidden();
  await expect(page.locator('#inspector')).toBeHidden();
  const viewport = await box(page, '#viewport');
  expect(viewport.width).toBeGreaterThanOrEqual(900 * 0.5);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('editor-900.png') });

  const toggle = page.getByRole('button', { name: 'Outliner', exact: true });
  await toggle.click();
  await expect(page.locator('#outliner')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('editor-900-drawer.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#outliner')).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(page.locator('#outliner')).toBeHidden();
});

test('a separator resizes a panel with the keyboard, and size and collapse survive a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openFiles(page, [NESTED], 'nested-groups.bbmodel');
  const separator = page.getByRole('separator', { name: 'Resize the outliner' });
  const start = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(start + 48);
  expect((await box(page, '#outliner')).width).toBeCloseTo(start + 48, 0);
  await page.keyboard.press('End');
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBe(
    Number(await separator.getAttribute('aria-valuemax')),
  );

  const timeline = page.getByRole('button', { name: 'Timeline', exact: true });
  await timeline.click();
  await expect(page.locator('#timeline')).toBeHidden();
  await expect(timeline).toHaveAttribute('aria-expanded', 'false');

  await page.reload();
  await expect(page.getByRole('status')).toContainText('Opened nested-groups.bbmodel', { timeout: 30_000 });
  await expect(page.locator('#timeline')).toBeHidden();
  expect(Number(await page.getByRole('separator', { name: 'Resize the outliner' }).getAttribute('aria-valuenow'))).toBe(
    Number(await separator.getAttribute('aria-valuemax')),
  );
});

test('a separator can be dragged with the pointer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const separator = page.getByRole('separator', { name: 'Resize the inspector' });
  const before = (await box(page, '#inspector')).width;
  const at = await box(page, '#inspector-separator');
  await page.mouse.move(at.x + 3, at.y + 100);
  await page.mouse.down();
  await page.mouse.move(at.x - 57, at.y + 100, { steps: 4 });
  await page.mouse.up();
  expect((await box(page, '#inspector')).width).toBeCloseTo(before + 60, 0);
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBeCloseTo(before + 60, 0);
});

test('Forget local data also resets the layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  const separator = page.getByRole('separator', { name: 'Resize the outliner' });
  const start = await separator.getAttribute('aria-valuenow');
  await separator.focus();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(page.locator('#inspector')).toBeHidden();
  await openFileMenu(page);
  await page.getByRole('button', { name: 'Forget local data' }).click();
  await expect(page.getByRole('status')).toContainText('Local data deleted');
  await expect(page.locator('#inspector')).toBeVisible();
  await expect(separator).toHaveAttribute('aria-valuenow', start ?? '');
  expect(await page.evaluate(() => localStorage.getItem('modelshot.layout.v1'))).toBeNull();
});
