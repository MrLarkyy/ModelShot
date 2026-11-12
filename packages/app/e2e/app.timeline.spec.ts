import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from '../../../tools/harness/src/compareImages';
import { PT_PAIR_TOLERANCE } from '../../../tools/harness/src/ptPairTolerance';
import {
  expect,
  fixture,
  openApp,
  openFiles,
  openTab,
  previewImage,
  renderImage,
  storedModels,
  test,
  waitForEditor,
  waitForModel,
  type Rgba,
  expectLit,
} from './appTest';

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
  await expect(playhead(page)).toHaveValue('0');
  await page.waitForTimeout(400);
  await expect(playhead(page)).toHaveValue('0');
  await play.click();
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).not.toHaveAttribute('aria-pressed');
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
  await page.evaluate(() => window.__msApp!.holdRenders());
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

test('a node hidden while a clip plays stays hidden', async ({ page }) => {
  await openAnimated(page);
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number(await playhead(page).inputValue())).toBeGreaterThan(0);
  await page.locator('#scene-panel input[type="checkbox"]').first().uncheck();
  await page.waitForTimeout(800);
  await expect(page.locator('#scene-panel input[type="checkbox"]').first()).not.toBeChecked();
  await expect
    .poll(async () => ((await storedModels(page))[0]?.['hiddenNodes'] as unknown[] | undefined)?.length)
    .toBe(1);
});

test('opening Export pauses the playback', async ({ page }) => {
  await openAnimated(page);
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await expect(timeline(page).locator('button', { hasText: 'Play' })).toHaveCount(1);
  await expect(timeline(page).locator('button', { hasText: 'Pause' })).toHaveCount(0);
});

test('scrubbing during a render cancels it', async ({ page }) => {
  await openAnimated(page);
  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('4096');
  await samples.dispatchEvent('change');
  // Held before its first sample: the cancel is what is checked, and a cancelled long render leaves queued GPU work.
  await page.evaluate(() => window.__msApp!.holdRenders());
  await page.locator('#preview').focus();
  await page.keyboard.press('r');
  await expect(page.getByRole('status')).toContainText('Rendering', { timeout: 30_000 });
  await playhead(page).fill('0.3');
  await expect(page.getByRole('status')).toContainText('Render cancelled', { timeout: 30_000 });
});

// Records every lighting status from here on, so a relight is counted without waiting on it.
async function watchLighting(page: Page): Promise<void> {
  await page.evaluate(() => {
    const status = document.getElementById('model-state');
    const seen: string[] = [];
    (window as unknown as { statusSeen: string[] }).statusSeen = seen;
    if (status) {
      new MutationObserver(() => seen.push(status.textContent ?? '')).observe(status, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  });
}

const lightingSeen = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { statusSeen: string[] }).statusSeen);

test('a scene change at a scrubbed pose relights it at once, not after the relight delay', async ({ page }) => {
  // Three bakes in a row, each allowed 120 s: 37 s quiet, up to 1.5 minutes beside the other suites, and past the
  // config's 120 s once on a loaded machine (MS-111). Bake time itself is held by the bench's bake budget.
  test.setTimeout(360_000);
  await openAnimated(page);
  await expectLit(page, 120_000);
  await playhead(page).fill('0.5');
  await page.waitForTimeout(1000);
  await expectLit(page, 120_000);
  // A relight that waits for the delay would not come within this test: only one at once is seen.
  expect(await page.evaluate(() => window.__msApp!.setRelightDelayMs(600_000))).toBe(true);
  await watchLighting(page);
  await page.locator('#scene-panel input[type="checkbox"]').first().uncheck();
  await expect
    .poll(async () => (await lightingSeen(page)).some((text) => text.includes('Lighting the preview')), {
      timeout: 30_000,
    })
    .toBe(true);
  await expectLit(page, 120_000);
});

function toPng(image: Rgba): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

test('a pose that stays is lit for that pose: preview and render at 0.5 s agree within the pair tolerance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await openAnimated(page);
  await openTab(page, 'Look');
  await page.getByRole('radio', { name: 'Marketplace' }).check();
  await expectLit(page, 120_000);
  await page.waitForTimeout(500);
  await expectLit(page, 120_000);
  await watchLighting(page);
  // "bob" at 0.5 s lifts the body 2 to 4 units off the catcher: the light baked at rest differs from the render at
  // 0.0876 of the pixels, 7.7 x the pair limit (measured with the relight switched off), the relit pose at 0.0016.
  await playhead(page).fill('0.5');
  // The scrub ended: a relight starts 0.2 s later (RELIGHT_DELAY_MS). The pixels below decide whether it lit this pose;
  // the status is only waited on to take the preview after the bake, never as the check.
  await page.waitForTimeout(2000);
  await expectLit(page, 120_000);
  await waitForModel(page);
  const preview = await previewImage(page);
  const seen = await lightingSeen(page);

  await openTab(page, 'Render');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('64');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render', exact: true }).click();
  await expect(page.locator('#result')).toHaveAttribute('data-renders', '1', { timeout: 180_000 });
  const render = await renderImage(page);
  const limits = PT_PAIR_TOLERANCE['preset-marketplace'];
  const result = compareImages(toPng(render), toPng(preview), limits);
  console.log(`[parity posed] ratio ${result.ratio.toFixed(5)} meanDelta ${result.meanDelta.toFixed(3)}`);
  expect(result.ratio, 'differing pixels').toBeLessThanOrEqual(limits?.maxDiffRatio ?? 0);
  expect(result.meanDelta, 'mean difference').toBeLessThanOrEqual(limits?.maxMeanDelta ?? 0);
  // Lit once for the pose that stays, not once per frame of the scrub.
  const lighting = (text: string | undefined): boolean => text?.includes('Lighting the preview') ?? false;
  const relights = seen.filter((text, i) => lighting(text) && !lighting(seen[i - 1])).length;
  expect(relights, `relights in ${JSON.stringify(seen)}`).toBe(1);
});
