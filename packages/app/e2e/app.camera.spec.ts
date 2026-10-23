import { expect, fixture, openApp, openFiles, pixelAt, test, waitForModel } from './appTest';
import type { Page } from '@playwright/test';

const CUBE = fixture('bbmodel', 'single-cube.bbmodel');

const state = (page: Page) => page.evaluate(() => window.__msApp!.state());

async function openCube(page: Page): Promise<void> {
  await openApp(page);
  await openFiles(page, [CUBE], 'single-cube.bbmodel');
  await waitForModel(page);
}

test('starts at the three-quarter view, yaw 210 and pitch 20', async ({ page }) => {
  await openCube(page);
  const s = await state(page);
  expect(s.yawDeg).toBeCloseTo(210, 5);
  expect(s.pitchDeg).toBeCloseTo(20, 5);
  expect(s.projection).toBe('perspective');
  expect(s.fovYDeg).toBeCloseTo(35, 5);
});

test('the field of view slider changes the camera, and is off in orthographic', async ({ page }) => {
  await openCube(page);
  const slider = page.getByLabel('Field of view');
  await slider.fill('60');
  expect((await state(page)).fovYDeg).toBeCloseTo(60, 5);
  await page.getByRole('radio', { name: 'Orthographic' }).check();
  expect((await state(page)).projection).toBe('orthographic');
  await expect(slider).toBeDisabled();
  await page.getByRole('radio', { name: 'Perspective' }).check();
  await expect(slider).toBeEnabled();
  expect((await state(page)).projection).toBe('perspective');
});

test('the O and I keys in the view move the projection radios with them', async ({ page }) => {
  await openCube(page);
  await page.locator('#preview').focus();
  await page.keyboard.press('o');
  await expect(page.getByRole('radio', { name: 'Orthographic' })).toBeChecked();
  await page.keyboard.press('o');
  await expect(page.getByRole('radio', { name: 'Perspective' })).toBeChecked();
  await page.keyboard.press('i');
  await expect(page.getByRole('radio', { name: 'Orthographic' })).toBeChecked();
  expect((await state(page)).pitchDeg).toBeCloseTo(35.264, 2);
});

test('Frame and Reset', async ({ page }) => {
  await openCube(page);
  await page.locator('#preview').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  const moved = await state(page);
  expect(moved.yawDeg).not.toBeCloseTo(210, 1);
  await page.getByRole('button', { name: 'Frame the model' }).click();
  const framed = await state(page);
  expect(framed.distance).toBeCloseTo(1, 5);
  expect(framed.yawDeg).toBeCloseTo(moved.yawDeg, 5);
  await page.getByRole('button', { name: 'Reset the view' }).click();
  const reset = await state(page);
  expect(reset.yawDeg).toBeCloseTo(210, 5);
  expect(reset.pitchDeg).toBeCloseTo(20, 5);
});

test.describe('preset angles', () => {
  const cases = [
    ['Front view', 180, 0],
    ['Side view', 270, 0],
    ['Three-quarter view', 210, 20],
  ] as const;
  for (const [name, yaw, pitch] of cases) {
    test(`${name} sets yaw ${yaw} and pitch ${pitch}`, async ({ page }) => {
      await openCube(page);
      await page.getByRole('button', { name }).click();
      const s = await state(page);
      expect(s.yawDeg).toBeCloseTo(yaw, 5);
      expect(s.pitchDeg).toBeCloseTo(pitch, 5);
    });
  }

  test('Isometric view is orthographic at the isometric angles', async ({ page }) => {
    await openCube(page);
    await page.getByRole('button', { name: 'Isometric view' }).click();
    const s = await state(page);
    expect(s.projection).toBe('orthographic');
    expect(s.yawDeg).toBeCloseTo(45, 5);
    expect(s.pitchDeg).toBeCloseTo(35.264, 2);
  });

  test('the digit keys apply the presets', async ({ page }) => {
    await openCube(page);
    await page.keyboard.press('2');
    expect((await state(page)).yawDeg).toBeCloseTo(270, 5);
    await page.keyboard.press('1');
    expect((await state(page)).yawDeg).toBeCloseTo(180, 5);
  });
});

test('the front preset shows the texture face that looks at the camera, the side preset another', async ({ page }) => {
  await openCube(page);
  await page.getByRole('button', { name: 'Front view' }).click();
  await page.waitForTimeout(400);
  // The fixture's north face is the dark blue quarter of its texture (48, 48, 64), the west face the yellow one.
  const front = pixelAt(await waitForModel(page), 0.5, 0.5);
  expect(Math.max(front[0], front[1])).toBeLessThan(110);
  expect(front[2]).toBeGreaterThanOrEqual(front[0]);
  await page.getByRole('button', { name: 'Side view' }).click();
  await page.waitForTimeout(400);
  const side = pixelAt(await waitForModel(page), 0.5, 0.5);
  expect(side[0]).toBeGreaterThan(100);
  expect(side[1]).toBeGreaterThan(100);
  expect(side[2]).toBeLessThan(side[0] * 0.6);
});
