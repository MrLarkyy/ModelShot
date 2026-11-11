import type { Page } from '@playwright/test';
import { coveredBy, expect, fixture, forgetLocalData, openApp, openFileMenu, openFiles, test } from './appTest';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');
const LAYOUT_KEY = 'modelshot.layout.v1';
// What a message over the view must leave free: the camera presets and Overlays at the top, the render bar below.
const VIEW_CONTROLS = '#viewport-chips button, .render-bar button';

interface Row {
  readonly centres: number[];
  readonly barHeight: number;
  readonly scrollWidth: number;
  readonly innerWidth: number;
  readonly outside: string[];
}

// The visible controls that sit in the bar itself (not in the open More list) share one row and stay inside the window.
async function measure(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const bar = document.querySelector('.top-bar') as HTMLElement;
    const selector = 'h1, .menu > button, .bar-overflow button, .bar-overflow .segmented, .bar-end button';
    const controls = [...bar.querySelectorAll<HTMLElement>(selector)].filter(
      (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden',
    );
    const outside = controls
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.left < -0.5 || box.right > window.innerWidth + 0.5;
      })
      .map((node) => node.id || node.tagName);
    const inline = controls.filter((node) => {
      const group = node.closest('.bar-overflow');
      return !group || getComputedStyle(group).position !== 'absolute';
    });
    return {
      centres: inline.map((node) => {
        const box = node.getBoundingClientRect();
        return Math.round(box.top + box.height / 2);
      }),
      barHeight: bar.getBoundingClientRect().height,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      outside,
    };
  });
}

for (const width of [1440, 1280, 1024, 900]) {
  test(`the top bar stays on one row at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await openFiles(page, [CUBE], 'single-cube.bbmodel');
    const row = await measure(page);
    expect(new Set(row.centres).size, 'every control shares one row').toBe(1);
    expect(row.barHeight).toBeLessThan(64);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.innerWidth);
    expect(row.outside).toEqual([]);
    await expect(page.locator('#bar-more-button')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Front view' })).toBeVisible();
    expect(await coveredBy(page, '#status', VIEW_CONTROLS), 'the Opened message covers no view control').toEqual([]);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`topbar-${width}.png`) });
  });
}

for (const width of [768, 375]) {
  test(`below 900 px the groups move into More at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await openFiles(page, [CUBE], 'single-cube.bbmodel');
    await expect(page.getByRole('button', { name: 'Front view' })).toBeVisible();
    expect(await coveredBy(page, '#status', VIEW_CONTROLS), 'the Opened message covers no view control').toEqual([]);
    const long = `${'a-very-long-model-name-'.repeat(8)}.bbmodel`;
    await page.evaluate((name) => {
      document.getElementById('model-name')!.textContent = name;
    }, long);
    const more = page.getByRole('button', { name: 'More' });
    await expect(more).toBeVisible();
    await expect(page.locator('#bar-overflow')).toBeHidden();
    const row = await measure(page);
    expect(new Set(row.centres).size, 'every control shares one row').toBe(1);
    expect(row.scrollWidth).toBeLessThanOrEqual(row.innerWidth);
    expect(row.outside).toEqual([]);
    const truncated = await page.locator('#model-name').evaluate((n) => n.scrollWidth > n.clientWidth);
    expect(truncated, 'a long model name is cut with an ellipsis').toBe(true);
    await screenshot(page, testInfo.outputPath(`topbar-${width}.png`));
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Undo', 'Redo', 'Outliner', 'Inspector', 'Timeline']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('radio', { name: 'Path traced' })).toBeVisible();
    expect((await measure(page)).outside).toEqual([]);
    await screenshot(page, testInfo.outputPath(`topbar-${width}-more.png`));
    await page.keyboard.press('Escape');
    await expect(page.locator('#bar-overflow')).toBeHidden();
  });
}

async function screenshot(page: Page, path: string): Promise<void> {
  await page.screenshot({ animations: 'disabled', path });
}

for (const [width, height] of [
  [375, 667],
  [768, 800],
  [1440, 800],
] as const) {
  test(`the longest message and error cover no view control at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await openFiles(page, [CUBE], 'single-cube.bbmodel');
    // The longest texts the notices show: they clip a message at 600 characters.
    await page.evaluate(() => {
      const long = 'A long message that names a file and why it failed. '.repeat(12).slice(0, 600);
      document.getElementById('status')!.textContent = long;
      document.getElementById('alert')!.textContent = long;
      document.getElementById('alert-box')!.hidden = false;
    });
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await coveredBy(page, '.toasts', VIEW_CONTROLS)).toEqual([]);
    const toasts = await page.locator('.toasts').boundingBox();
    const view = await page.locator('#viewport').boundingBox();
    expect(toasts!.x).toBeGreaterThanOrEqual(view!.x);
    expect(toasts!.x + toasts!.width).toBeLessThanOrEqual(view!.x + view!.width);
    expect(toasts!.y).toBeGreaterThanOrEqual(view!.y);
  });
}

test('a message longer than its room scrolls under the wheel, and the camera stays where it is', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const status = page.getByRole('status');
  // The Opened message fades first: its timer must not take the class off the long one below.
  await expect(status).not.toHaveClass(/toast-shown/, { timeout: 10_000 });
  await status.evaluate((line) => {
    line.textContent = 'A long message that names a file and why it failed. '.repeat(12).slice(0, 600);
  });
  const toasts = page.locator('.toasts');
  expect(await toasts.evaluate((node) => node.scrollHeight > node.clientHeight), 'the message is cut off').toBe(true);
  const box = (await status.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + 12 };
  const hit = (): Promise<boolean> =>
    page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id === 'status', point);
  expect(await hit(), 'a faded message lets the pointer through to the view').toBe(false);
  await status.evaluate((line) => line.classList.add('toast-shown'));
  expect(await hit(), 'a shown message takes the pointer').toBe(true);

  const camera = await page.evaluate(() => window.__msApp!.state());
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => toasts.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__msApp!.state())).toEqual(camera);
});

test.describe('with the first-run hint', () => {
  test.use({ firstRunHint: true });

  for (const width of [375, 1440]) {
    test(`the Opened message leaves the shortcut hint and the view controls free at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openApp(page);
      await openFiles(page, [CUBE], 'single-cube.bbmodel');
      await expect(page.getByRole('region', { name: 'Shortcut hints' })).toBeVisible();
      expect(await coveredBy(page, '#status', `${VIEW_CONTROLS}, #first-run-hint`)).toEqual([]);
    });
  }
});

test('the bar has one primary, Export, and no Render label; Share does not move Export', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', { value: () => Promise.resolve(), configurable: true });
  });
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const primaries = await page.locator('.top-bar .primary').allTextContents();
  expect(primaries.map((text) => text.trim())).toEqual(['Export…']);
  const text = await page.evaluate(() => (document.querySelector('.top-bar') as HTMLElement).innerText);
  expect(text).not.toMatch(/Render/);
  const before = await page.locator('#export-button').boundingBox();
  await page.locator('#render-button').click();
  await expect(page.locator('#result')).toHaveAttribute('data-renders', '1', { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
  const after = await page.locator('#export-button').boundingBox();
  expect(after?.x).toBe(before?.x);
});

test('the File menu works from the keyboard and Forget local data asks first', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const file = page.getByRole('button', { name: 'File', exact: true });
  await file.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#file-menu')).toBeVisible();
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement?.id ?? ''));
  }
  expect(order).toEqual(['open-button', 'menu-export-button', 'help-button', 'forget-button']);
  await expect(page.locator('#forget-button')).toHaveClass(/destructive/);
  // The note is a footer, not a stop on the way: the next Tab leaves the menu.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('#file-menu') === null)).toBe(true);
  expect(await page.locator('#file-menu kbd').allTextContents()).toEqual(['Ctrl+O', 'Ctrl+E', '?']);
  await expect(page.locator('#file-menu .menu-foot')).toContainText('Everything stays in this browser');

  await page.evaluate((key) => localStorage.setItem(key, localStorage.getItem(key) ?? '{"v":1}'), LAYOUT_KEY);
  for (const how of ['Escape', 'Cancel'] as const) {
    await openFileMenu(page);
    await expect(page.getByRole('button', { name: 'Open…', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Forget local data' }).click();
    const dialog = page.getByRole('dialog', { name: 'Forget local data?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('the files of the last model');
    await expect(dialog).toContainText('panel layout');
    if (how === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(file).toBeFocused();
    expect(await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)).not.toBeNull();
    await expect(page.getByRole('status')).not.toContainText('Local data deleted');
  }

  await forgetLocalData(page);
  await expect(page.getByRole('status')).toContainText('Local data deleted');
  await expect(file).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY)).toBeNull();
});

test('at 375 px More is reached with Tab, opens onto its first control and Escape gives the focus back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  const more = page.getByRole('button', { name: 'More' });
  await page.getByRole('button', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(more).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const outliner = page.getByRole('button', { name: 'Outliner', exact: true });
  await expect(outliner).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Inspector', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const timeline = page.getByRole('button', { name: 'Timeline', exact: true });
  await expect(timeline).toBeFocused();
  const before = await timeline.getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  await expect(timeline).not.toHaveAttribute('aria-expanded', before ?? '');
  await expect(timeline).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#bar-overflow')).toBeHidden();
  await expect(more).toBeFocused();
});
