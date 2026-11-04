import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, fixture, openApp, openFiles, test, waitForEditor, waitForModel } from './appTest';

const ANIMATED = fixture('bbmodel', 'animated.bbmodel');
const timeline = (page: Page) => page.locator('#timeline');
const playhead = (page: Page) => timeline(page).getByRole('slider', { name: 'Playhead' });

async function openAnimated(page: Page): Promise<void> {
  await openApp(page);
  await openFiles(page, [ANIMATED], 'animated.bbmodel');
  await waitForModel(page);
  await waitForEditor(page);
}

test('the timeline lists the clips and draws one marker per keyframe time of the first clip', async ({ page }) => {
  await openAnimated(page);
  const clips = timeline(page).getByRole('combobox', { name: 'Clip' });
  await expect(clips.locator('option')).toHaveCount(4);
  // The first clip, "bob", has keyframes at 0, 0.5 and 1 s: the markers come from the file.
  await expect(timeline(page).locator('.marker')).toHaveCount(3);
  await expect(timeline(page)).toContainText('3 keyframes');
  const model = JSON.parse(await readFile(ANIMATED, 'utf8')) as {
    animations: { animators: Record<string, { keyframes?: { time: number }[] }> }[];
  };
  const times = new Set(
    Object.values(model.animations[0]?.animators ?? {}).flatMap((a) => (a.keyframes ?? []).map((k) => k.time)),
  );
  await expect(timeline(page)).toContainText(`${times.size} keyframes`);
  await clips.selectOption({ index: 3 });
  await expect(timeline(page)).toContainText('6 keyframes');
});

test('nothing plays by itself; Play advances the playhead and Pause stops it', async ({ page }) => {
  await openAnimated(page);
  const play = timeline(page).getByRole('button', { name: 'Play' });
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(playhead(page)).toHaveValue('0');
  await page.waitForTimeout(400);
  await expect(playhead(page)).toHaveValue('0');
  await play.click();
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await playhead(page).inputValue())).toBeGreaterThan(0);
  await timeline(page).getByRole('button', { name: 'Pause' }).click();
  const stopped = await playhead(page).inputValue();
  await page.waitForTimeout(300);
  expect(await playhead(page).inputValue()).toBe(stopped);
});

test('scrubbing sets the pose, and a looping clip wraps', async ({ page }) => {
  await openAnimated(page);
  const rest = await page.evaluate(() => window.__msApp!.previewPixels().data);
  await playhead(page).fill('0.5');
  await expect(playhead(page)).toHaveAttribute('aria-valuetext', '0.50 s of 1.00 s');
  await expect.poll(async () => (await page.evaluate(() => window.__msApp!.previewPixels().data)) === rest).toBe(false);
  // "bob" loops over one second: after more than a second of playback the playhead is back below its length.
  await playhead(page).fill('0');
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1300);
  await timeline(page).getByRole('button', { name: 'Pause' }).click();
  expect(Number(await playhead(page).inputValue())).toBeLessThan(1);
});

test('a model without clips says so and disables the controls', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await waitForEditor(page);
  await expect(timeline(page)).toContainText('This model has no animations');
  await expect(timeline(page).getByRole('button', { name: 'Play' })).toBeDisabled();
});

test('starting a render pauses the playback', async ({ page }) => {
  await openAnimated(page);
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press('r');
  await expect(timeline(page).getByRole('button', { name: 'Play' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('Space plays and pauses from the view', async ({ page }) => {
  await openAnimated(page);
  await page.locator('#preview').focus();
  await page.keyboard.press(' ');
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(timeline(page).getByRole('button', { name: 'Play' })).toBeVisible();
});

async function exportClipAt(page: Page, time: string): Promise<Buffer> {
  await playhead(page).fill(time);
  await page.getByRole('button', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export' });
  await dialog.getByLabel('Kind').selectOption('animation');
  await dialog.getByLabel('Format').selectOption('apng');
  await dialog.getByLabel('Width (px)').fill('48');
  await dialog.getByLabel('Height (px)').fill('48');
  await dialog.getByLabel('Samples').fill('2');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  const buffer = await readFile(await file.path());
  await dialog.getByRole('button', { name: 'Close' }).click();
  return buffer;
}

test('an animation clip export from a paused playhead equals the export from the rest pose', async ({ page }) => {
  await openAnimated(page);
  const atRest = await exportClipAt(page, '0');
  const posed = await exportClipAt(page, '0.5');
  expect(posed.equals(atRest)).toBe(true);
});
