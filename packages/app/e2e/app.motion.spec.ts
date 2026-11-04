import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, test, waitForEditor, waitForModel } from './appTest';

/** The animation name and transition duration the page computes for the first element that matches `selector`. */
const motion = (page: Page, selector: string): Promise<[string, string]> =>
  page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) throw new Error(`no ${query}`);
    const style = getComputedStyle(element);
    return [style.animationName, style.transitionDuration] as [string, string];
  }, selector);

test('panel and tab motion is switched off under prefers-reduced-motion, and follows a live change', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openApp(page);
  const [animation] = await motion(page, '[role="tabpanel"]:not([hidden])');
  expect(animation).not.toBe('none');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const [reduced, transition] = await motion(page, '[role="tabpanel"]:not([hidden])');
  expect(reduced).toBe('none');
  expect(transition.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  const [button] = await motion(page, '#render-button');
  expect(button).toBe('none');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect((await motion(page, '[role="tabpanel"]:not([hidden])'))[0]).not.toBe('none');
});

test('the drawers do not slide under prefers-reduced-motion', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await page.getByRole('button', { name: 'Outliner', exact: true }).click();
  expect((await motion(page, '#outliner'))[0]).toBe('none');
});

test('the overlay draws within 2 ms and nothing plays by itself', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'animated.bbmodel')], 'animated.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
  const box = (await page.locator('#viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 30 });
  await page.mouse.up();
  const median = await page.evaluate(() => window.__msApp!.overlayMedianMs());
  expect(median).not.toBeNull();
  expect(median ?? Infinity).toBeLessThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Playhead' })).toHaveValue('0');
});
