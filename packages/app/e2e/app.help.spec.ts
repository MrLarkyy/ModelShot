import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFileMenu, openFiles, test, waitForEditor } from './appTest';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' });

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).boundingBox();
  if (!found) throw new Error(`${selector} has no box`);
  return found;
}

for (const [width, height] of [
  [900, 600],
  [375, 667],
] as const) {
  test(`the dialog is fully visible and scrolls at ${width}x${height}, with the search focused`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await openApp(page);
    await page.keyboard.press('?');
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search shortcuts' })).toBeFocused();
    const frame = await box(page, '#help-dialog');
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.y).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(width);
    expect(frame.y + frame.height).toBeLessThanOrEqual(height);
    await expect(page.locator('#help-dialog .help-head')).toBeInViewport();
    const last = page.locator('#help-dialog .help-row').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 1 });
    const body = await page.locator('.help-body').evaluate((element) => ({
      scrolls: element.scrollHeight > element.clientHeight,
      top: element.scrollTop,
    }));
    if (height < 700) expect(body.scrolls).toBe(true);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`help-${width}.png`) });
  });
}

test('the search filters the list, hides empty groups and says when nothing matches', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('?');
  const search = page.getByRole('searchbox', { name: 'Search shortcuts' });
  await search.fill('keyframe');
  await expect(page.locator('#help-dialog [data-action="nextKeyframe"]')).toBeVisible();
  await expect(page.locator('#help-dialog [data-action="render"]')).toBeHidden();
  await expect(page.locator('#help-dialog h3:visible')).not.toHaveCount(0);
  await search.fill('qqqqq');
  await expect(page.getByText('No shortcut matches.')).toBeVisible();
  await expect(page.locator('#help-dialog h3:visible')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('#help-dialog [data-action="render"]')).toBeVisible();
});

test('the key and the button both open it; Escape closes it and returns the focus', async ({ page }) => {
  await openApp(page);
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await expect(help).toBeFocused();
  await page.keyboard.press('?');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await openFileMenu(page);
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  // The File menu closed with its item: the focus lands on the Help button, which is on the page.
  await expect(help).toBeFocused();
  await help.click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(help).toBeFocused();
});

test('every icon button with a shortcut shows its keys in the tooltip and in aria-keyshortcuts', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForEditor(page);
  const found = await page.locator('button[aria-keyshortcuts]').evaluateAll((buttons) =>
    buttons.map((button) => ({
      name: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
      title: button.getAttribute('title') ?? '',
      keys: button.getAttribute('aria-keyshortcuts') ?? '',
    })),
  );
  const names = found.map((b) => b.name);
  for (const wanted of [
    'Undo',
    'Redo',
    'Outliner',
    'Inspector',
    'Timeline',
    'Move',
    'Rotate',
    'Help',
    'Play',
    'Front view',
    'Isometric view',
  ]) {
    expect(
      names.some((name) => name.startsWith(wanted)),
      wanted,
    ).toBe(true);
  }
  for (const button of found) {
    expect(button.keys, button.name).not.toBe('');
    expect(button.title, button.name).toMatch(/\(.+\)$/);
  }
});

test('a help dialog chunk that fails to load is reported, and the next open retries', async ({ page }) => {
  await openApp(page);
  await page.route('**/HelpDialog*.js', (route) => route.abort());
  await page.keyboard.press('?');
  await expect(page.getByRole('status')).toContainText('The shortcut list could not load');
  await expect(dialog(page)).toBeHidden();
  await page.unroute('**/HelpDialog*.js');
  await page.keyboard.press('?');
  await expect(dialog(page)).toBeVisible();
});
