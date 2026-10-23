import {
  CUBE,
  addViewer,
  expect,
  meanDifference,
  openHost,
  shot,
  test,
  viewerFrame,
  waitForEvent,
  waitLit,
} from './embedTest';

test('autorotate turns the model, and the first pointer input stops it for good', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: CUBE, autorotate: '' });
  const frame = viewerFrame(page);
  await waitLit(frame);
  const first = await shot(page);
  await page.waitForTimeout(500);
  const second = await shot(page);
  expect(meanDifference(first, second), 'frames 500 ms apart').toBeGreaterThan(0.5);

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
  await expect(frame.getByRole('status')).not.toHaveText('Preview lit.');
  await frame.locator('canvas').press('ArrowLeft');
  await waitLit(frame);
  await page.waitForTimeout(1000);
  const first = await shot(page);
  await page.waitForTimeout(500);
  expect(meanDifference(first, await shot(page))).toBeLessThan(0.05);
});
