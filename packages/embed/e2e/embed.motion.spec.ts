import type { Page } from '@playwright/test';
import {
  CUBE,
  HOST_ORIGIN,
  addViewer,
  events,
  expect,
  frameAlert,
  meanDifference,
  openHost,
  setAttributes,
  shot,
  test,
  viewerFrame,
  waitForEvent,
  waitLight,
  waitLit,
} from './embedTest';

/** Refuses the path tracer chunk (src-*.js: the light baker), so the bake never runs; returns the refusal count. */
async function blockBaker(page: Page): Promise<() => number> {
  let blocked = 0;
  await page.route('**/assets/src-*.js', (route) => {
    blocked++;
    return route.abort();
  });
  return () => blocked;
}

async function expectTurning(page: Page): Promise<void> {
  const first = await shot(page);
  await expect
    .poll(async () => meanDifference(first, await shot(page)), { message: 'the picture turns', timeout: 10_000 })
    .toBeGreaterThan(0.5);
}

test('autorotate turns the model, and the first pointer input stops it for good', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitLit(frame);
  const first = await shot(page);
  await expect
    .poll(async () => meanDifference(first, await shot(page)), { message: 'the picture turns', timeout: 10_000 })
    .toBeGreaterThan(0.5);

  await frame.locator('canvas').dispatchEvent('pointerdown', { pointerId: 1, button: 0, isPrimary: true });
  await frame.locator('canvas').dispatchEvent('pointerup', { pointerId: 1, button: 0, isPrimary: true });
  // Let the orbit easing settle.
  await page.waitForTimeout(1000);
  const stopped = await shot(page);
  await page.waitForTimeout(500);
  expect(meanDifference(stopped, await shot(page)), 'stopped').toBeLessThan(0.05);
});

test('autorotate does not start when the visitor prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  await waitLit(viewerFrame(page));
  const first = await shot(page);
  await page.waitForTimeout(500);
  expect(meanDifference(first, await shot(page))).toBeLessThan(0.05);
});

test('autorotate does not start when the visitor moved the model before the light was baked', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitForEvent(page, 'load');
  await waitLight(frame, 'baking');
  await frame.locator('canvas').press('ArrowLeft');
  await waitLit(frame);
  await page.waitForTimeout(1000);
  const first = await shot(page);
  await page.waitForTimeout(500);
  expect(meanDifference(first, await shot(page))).toBeLessThan(0.05);
});

test('autorotate starts when the light bake fails, the preview staying unbaked', async ({ page }) => {
  const blocked = await blockBaker(page);
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitLight(frame, 'unbaked');
  expect(blocked(), 'the light baker chunk was asked for and refused').toBeGreaterThan(0);
  await expectTurning(page);
});

test('with the light baker unavailable, a new model ends unbaked and turns', async ({ page }) => {
  await blockBaker(page);
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitLight(frame, 'unbaked');

  // The second bake settles at once (the baker is known to be missing): it must not be taken for the first one.
  await setAttributes(page, { model: CUBE.replace('single-cube', 'flat-cube') });
  await expect.poll(async () => (await events(page)).filter((e) => e.type === 'load').length).toBe(2);
  await expect(frame.locator('#stage')).toHaveAttribute('data-light', 'unbaked', { timeout: 10_000 });
  await expectTurning(page);
});

test('an error stops autorotate: nothing turns behind the alert', async ({ page }) => {
  await blockBaker(page);
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitLight(frame, 'unbaked');
  await expectTurning(page);

  await setAttributes(page, { model: `${HOST_ORIGIN}/cors/not-json.bbmodel` });
  expect(await frameAlert(frame, 60_000)).toMatch(/^NOT_JSON: /);
  // The canvas under the alert: the previous model, standing still.
  await frame.locator('#alert').evaluate((alert) => {
    alert.style.visibility = 'hidden';
  });
  await page.waitForTimeout(300);
  const first = await shot(page);
  await page.waitForTimeout(700);
  expect(meanDifference(first, await shot(page)), 'standing still').toBeLessThan(0.05);
});
