import type { Page } from '@playwright/test';
import {
  CUBE,
  addViewer,
  events,
  expect,
  meanDifference,
  openHost,
  openMarkupHost,
  pixel,
  setAttributes,
  shot,
  test,
  viewerFrame,
  waitForEvent,
  waitLight,
  waitLit,
  type Rgba,
} from './embedTest';

test('the element on another origin shows the model lit by the bake, sandboxed and titled', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, label: 'A single cube' });
  const frame = viewerFrame(page);
  await waitLit(frame);
  await waitForEvent(page, 'load');
  expect((await events(page)).filter((e) => e.type === 'error')).toEqual([]);

  const iframe = page.locator('modelshot-viewer iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  await expect(iframe).toHaveAttribute('title', 'A single cube');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(frame.getByRole('alert')).toBeHidden();

  const image = await shot(page);
  // 300 x 300 CSS pixels; an inline-block on a fractional offset can span one more device row.
  expect(image.width).toBe(300);
  expect(image.height).toBeGreaterThanOrEqual(300);
  expect(image.height).toBeLessThanOrEqual(301);
  const centre = pixel(image, 150, 150);
  const corner = pixel(image, 4, 4);
  expect(Math.max(...centre.map((c, i) => Math.abs(c - corner[i]!))), 'the model covers the centre').toBeGreaterThan(8);
});

test('look, yaw, pitch and fov change the picture, through attribute changes of one element', async ({
  page,
  seen,
}) => {
  await openHost(page);
  await addViewer(page, { model: CUBE });
  const frame = viewerFrame(page);
  await waitLit(frame);
  await frame.locator('canvas').evaluate((canvas) => canvas.setAttribute('data-first-canvas', ''));
  const studio = await shot(page);

  await setAttributes(page, { look: 'marketplace' });
  await waitLight(frame, 'baking');
  await waitLit(frame);
  const marketplace = await shot(page);
  expect(meanDifference(studio, marketplace), 'studio vs marketplace').toBeGreaterThan(2);

  // The camera needs no new bake: the lit state stays, the picture changes at once.
  await setAttributes(page, { yaw: '180' });
  const turned = await settledShot(page, marketplace);
  expect(meanDifference(marketplace, turned), 'yaw 210 vs 180').toBeGreaterThan(1);

  await setAttributes(page, { pitch: '-30' });
  const tilted = await settledShot(page, turned);
  expect(meanDifference(turned, tilted), 'pitch 20 vs -30').toBeGreaterThan(1);

  await setAttributes(page, { fov: '80' });
  const wide = await settledShot(page, tilted);
  expect(meanDifference(tilted, wide), 'fov 35 vs 80').toBeGreaterThan(1);

  expect(await page.locator('modelshot-viewer iframe').count()).toBe(1);
  // One viewer, one WebGL context, and the model downloaded once, whatever the attributes became.
  await expect(frame.locator('canvas[data-first-canvas]')).toHaveCount(1);
  expect(seen.filter((r) => r.url.includes('single-cube')).length).toBe(1);
});

test('Home resets the camera to the embed yaw and pitch, not the app default', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, yaw: '180', pitch: '-10' });
  const frame = viewerFrame(page);
  await waitLit(frame);
  const canvas = frame.locator('canvas');
  // Focused before the first picture: the focus ring is part of every later one.
  await canvas.press('Shift');
  const first = await shot(page);

  for (let i = 0; i < 4; i++) await canvas.press('ArrowLeft');
  await expect
    .poll(async () => meanDifference(first, await shot(page)), { message: 'the keys turned the view' })
    .toBeGreaterThan(1);
  await canvas.press('Home');
  await expect
    .poll(async () => meanDifference(first, await shot(page)), { message: 'Home is the first view again' })
    .toBeLessThan(0.05);

  // A later attribute change moves what Home returns to.
  await setAttributes(page, { yaw: '90' });
  const ninety = await settledShot(page, first);
  await canvas.press('ArrowLeft');
  await canvas.press('Home');
  await expect
    .poll(async () => meanDifference(ninety, await shot(page)), { message: 'Home is the new first view' })
    .toBeLessThan(0.05);
});

test('a new model reuses the viewer: no second canvas, no second frame', async ({ page, seen }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE });
  const frame = viewerFrame(page);
  await waitLit(frame);
  await frame.locator('canvas').evaluate((canvas) => canvas.setAttribute('data-first-canvas', ''));
  const cube = await shot(page);

  await setAttributes(page, { model: CUBE.replace('single-cube', 'flat-cube') });
  await expect.poll(async () => (await events(page)).filter((e) => e.type === 'load').length).toBe(2);
  await waitLit(frame);
  expect(meanDifference(cube, await shot(page)), 'another model').toBeGreaterThan(1);
  await expect(frame.locator('canvas[data-first-canvas]')).toHaveCount(1);
  await expect(frame.locator('canvas')).toHaveCount(1);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(1);
  expect(seen.filter((r) => r.url.includes('flat-cube')).length).toBe(1);
});

test('switching the model back during another download aborts it: the first model stays, the other never shows', async ({
  page,
}) => {
  await openHost(page);
  await addViewer(page, { model: CUBE });
  const frame = viewerFrame(page);
  const stage = frame.locator('#stage');
  await waitLit(frame);
  const cube = await shot(page);

  // The other model's download is held until the switch back is done, then let through (too late, or aborted).
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route('**/cors/flat-cube.bbmodel', async (route) => {
    asked++;
    await held;
    await route.continue().catch(() => undefined);
  });
  await setAttributes(page, { model: CUBE.replace('single-cube', 'flat-cube') });
  await expect.poll(() => asked).toBe(1);
  await expect(stage).toHaveAttribute('data-state', 'loading');
  await setAttributes(page, { model: CUBE });
  await expect(stage).toHaveAttribute('data-state', 'shown');
  release();

  // A late flat-cube would be set and reported within this time.
  await page.waitForTimeout(3000);
  await expect(stage).toHaveAttribute('data-state', 'shown');
  expect((await events(page)).map((e) => e.type)).toEqual(['load']);
  expect(meanDifference(cube, await shot(page)), 'still the first model').toBeLessThan(0.05);
});

/** The next picture that differs from `previous` and holds still (the camera eases for a moment). */
async function settledShot(page: Page, previous: Rgba): Promise<Rgba> {
  let latest = previous;
  await expect
    .poll(
      async () => {
        const next = await shot(page);
        const moved = meanDifference(latest, next);
        latest = next;
        return moved < 0.05 && meanDifference(previous, next) > 0.05;
      },
      { message: 'the picture changed and settled', timeout: 20_000, intervals: [300] },
    )
    .toBe(true);
  return latest;
}

test('an invalid attribute shows the error in the element, fires error and makes no frame', async ({ page, seen }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, yaw: 'abc', loading: 'eager' });
  const event = await waitForEvent(page, 'error', 5_000);
  expect(event.detail.code).toBe('INVALID_PARAM');
  expect(event.detail.message).toMatch(/^yaw /);
  await expect(page.locator('modelshot-viewer').getByRole('alert')).toHaveText(/^INVALID_PARAM: yaw /);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(0);

  await setAttributes(page, { yaw: null });
  await expect(page.locator('modelshot-viewer iframe')).toHaveCount(1);
  await waitLit(viewerFrame(page));
  expect(seen.filter((r) => r.url.includes('single-cube')).length).toBe(1);
});

test('an invalid attribute in the markup, before the script loads, fires one error and makes no frame', async ({
  page,
}) => {
  await openMarkupHost(page);
  await expect(page.locator('modelshot-viewer').getByRole('alert')).toHaveText(/^INVALID_PARAM: yaw /);
  // The upgrade reported three bad attributes and then connected; a later change of the same error stays quiet.
  await setAttributes(page, { pitch: 'y' });
  await setAttributes(page, { yaw: 'z' });
  const errors = (await events(page)).filter((e) => e.type === 'error');
  expect(errors.map((e) => e.detail.code)).toEqual(['INVALID_PARAM']);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(0);
});
