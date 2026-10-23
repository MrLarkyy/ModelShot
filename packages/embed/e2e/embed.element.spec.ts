import {
  CUBE,
  addViewer,
  events,
  expect,
  meanDifference,
  openHost,
  pixel,
  setAttributes,
  shot,
  test,
  viewerFrame,
  waitForEvent,
  waitLit,
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

test('look and yaw change the picture, through attribute changes of one element', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE });
  const frame = viewerFrame(page);
  await waitLit(frame);
  const studio = await shot(page);

  await setAttributes(page, { look: 'marketplace' });
  await expect(frame.getByRole('status')).not.toHaveText('Preview lit.', { timeout: 10_000 });
  await waitLit(frame);
  const marketplace = await shot(page);
  expect(meanDifference(studio, marketplace), 'studio vs marketplace').toBeGreaterThan(2);

  await setAttributes(page, { yaw: '180' });
  await expect(frame.getByRole('status')).not.toHaveText('Preview lit.', { timeout: 10_000 });
  await waitLit(frame);
  const turned = await shot(page);
  expect(meanDifference(marketplace, turned), 'yaw 210 vs 180').toBeGreaterThan(1);
  expect(await page.locator('modelshot-viewer iframe').count()).toBe(1);
});

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
