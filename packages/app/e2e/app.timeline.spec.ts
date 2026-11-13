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
  chooseMadeFiles,
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

test('the timeline lists the clips and draws a diamond per keyframe time of each node of the first clip', async ({
  page,
}) => {
  await openAnimated(page);
  const clips = timeline(page).getByRole('combobox', { name: 'Clip' });
  await expect(clips.locator('option')).toHaveCount(4);
  await expect(clips.locator('option').first()).toContainText(' · 1.00 s');
  // The first clip, "bob", has keyframes at 0, 0.5 and 1 s: the diamonds come from the file.
  const lanes = timeline(page).locator('.tl-lane');
  expect(await lanes.count()).toBeGreaterThan(0);
  await expect(timeline(page).locator('.tl-name')).toHaveCount(await lanes.count());
  const times = await timeline(page)
    .locator('.kf')
    .evaluateAll((nodes) => [...new Set(nodes.map((n) => (n as HTMLElement).dataset['time']))].sort());
  expect(times).toEqual(['0', '0.5', '1']);
  await expect(timeline(page)).toContainText('3 keyframes');
  const model = JSON.parse(await readFile(ANIMATED, 'utf8')) as {
    animations: { animators: Record<string, { keyframes?: { time: number }[] }> }[];
  };
  const fileTimes = new Set(
    Object.values(model.animations[0]?.animators ?? {}).flatMap((a) => (a.keyframes ?? []).map((k) => k.time)),
  );
  await expect(timeline(page)).toContainText(`${fileTimes.size} keyframes`);
  await clips.selectOption({ index: 3 });
  await expect(timeline(page)).toContainText('6 keyframes');
  await expect(timeline(page).locator('.tl-ruler .tl-tick').first()).toHaveText(/^0(.0+)?s$/);
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
  await page.locator('#scene-panel .row-eye').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('#scene-panel .row-eye').first()).toHaveAttribute('aria-pressed', 'true');
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
  await expect(timeline(page).getByRole('button', { name: 'Play' })).toHaveCount(1);
  await expect(timeline(page).getByRole('button', { name: 'Pause' })).toHaveCount(0);
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
  await page.locator('#scene-panel .row-eye').first().click();
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
  // Two baked lightings and a render: 1.4-1.5 minutes locally, over the 120 s default on a CI runner (MS-97, run
  // 43209537341); 360 s is 4x the local time and is confirmed by the next main run.
  test.setTimeout(360_000);
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

const centreX = async (locator: ReturnType<Page['locator']>): Promise<number> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not laid out');
  return box.x + box.width / 2;
};

test('one lane per animated node, named and in node order, with ruler ticks and a playhead line', async ({ page }) => {
  await openAnimated(page);
  await expect(timeline(page).locator('.tl-name')).toHaveText(['body', 'head']);
  await expect(timeline(page).locator('.tl-lane')).toHaveCount(2);
  await expect(timeline(page).locator('.tl-lane').first().locator('.kf')).toHaveCount(3);
  expect(await timeline(page).locator('.tl-tick').count()).toBeGreaterThan(2);
  await expect(timeline(page).locator('.tl-playhead')).toBeVisible();
});

test('transport by mouse and keyboard: keyframe steps, frame steps, clip switch and Loop', async ({ page }) => {
  await openAnimated(page);
  const value = async (): Promise<number> => Number(await playhead(page).inputValue());
  await timeline(page).getByRole('button', { name: 'Next keyframe' }).click();
  expect(await value()).toBe(0.5);
  await page.keyboard.press('.');
  expect(await value()).toBe(1);
  await page.keyboard.press(',');
  expect(await value()).toBe(0.5);
  await timeline(page).getByRole('button', { name: 'Back to start' }).click();
  expect(await value()).toBe(0);
  await playhead(page).focus();
  await page.keyboard.press('ArrowRight');
  expect(await value()).toBeCloseTo(1 / 24, 6);
  await page.keyboard.press('Shift+ArrowRight');
  expect(await value()).toBeCloseTo(11 / 24, 6);
  await page.keyboard.press('PageDown');
  expect(await value()).toBe(0.5);
  await page.keyboard.press('Home');
  expect(await value()).toBe(0);
  await expect(playhead(page)).toBeFocused();
  const loop = timeline(page).getByRole('button', { name: 'Loop' });
  await expect(loop).toHaveAttribute('aria-pressed', 'true');
  await loop.click();
  await expect(loop).toHaveAttribute('aria-pressed', 'false');
  await timeline(page).getByRole('combobox', { name: 'Clip' }).selectOption({ index: 1 });
  expect(await value()).toBe(0);
  await expect(timeline(page).getByRole('combobox', { name: 'Clip' })).toHaveValue('1');
});

test('Space on the focused scrubber does not play, and the playhead line meets the scrubber thumb and readout', async ({
  page,
}) => {
  await openAnimated(page);
  await playhead(page).focus();
  await page.keyboard.press(' ');
  await expect(timeline(page).getByRole('button', { name: 'Play' })).toBeVisible();
  for (const time of [0.25, 0.5]) {
    await playhead(page).fill(String(time));
    await expect(timeline(page).locator('.time-readout')).toHaveText(`${time.toFixed(2)} / 1.00 s`);
    const line = await centreX(timeline(page).locator('.tl-playhead'));
    const scrub = (await playhead(page).boundingBox())!;
    const thumb = scrub.x + 6 + time * (scrub.width - 12);
    expect(Math.abs(line - thumb), `playhead line at ${time} s`).toBeLessThanOrEqual(1);
  }
});

test('a lane, the outliner and the inspector follow one selection', async ({ page }) => {
  await openAnimated(page);
  const second = timeline(page).locator('.tl-name').nth(1);
  await second.click();
  await expect(second).toHaveAttribute('aria-current', 'true');
  await expect(timeline(page).locator('.tl-lane').nth(1)).toHaveClass(/sel/);
  await expect(page.locator('#scene-panel [data-row][aria-current="true"]')).toContainText('head');
  await expect(page.locator('#tabpanel-object').getByLabel('Name')).toHaveValue('head');
  const body = page.locator('#scene-panel [role="treeitem"]', { has: page.locator('[data-row]', { hasText: 'body' }) });
  await body.first().locator('[data-row]').click();
  await expect(timeline(page).locator('.tl-name').first()).toHaveAttribute('aria-current', 'true');
  await expect(second).not.toHaveAttribute('aria-current', 'true');
});

test('the panel is never bare between the start of an open and the lanes', async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { snapshots: string[] }).snapshots = seen;
    let started = false;
    let done = false;
    new MutationObserver(() => {
      const panel = document.getElementById('timeline');
      if (!panel || done) return;
      const loading = panel.hasAttribute('data-loading');
      const lanes = panel.querySelector('.tl-lane') !== null;
      if (loading) started = true;
      if (started && lanes) done = true;
      if (started && !done) seen.push(loading || lanes ? 'ok' : 'bare');
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await openAnimated(page);
  const snapshots = await page.evaluate(() => (window as unknown as { snapshots: string[] }).snapshots);
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.filter((state) => state === 'bare')).toEqual([]);
  await expect(timeline(page)).not.toHaveAttribute('aria-busy');
  await expect(timeline(page)).not.toHaveAttribute('data-loading');
});

test('an open that fails ends the busy state', async ({ page }) => {
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'bad.bbmodel', text: 'not json at all' }]);
  await expect(page.getByRole('alert')).toContainText('bad.bbmodel');
  await expect(timeline(page)).not.toHaveAttribute('aria-busy');
  await expect(timeline(page)).not.toHaveAttribute('data-loading');
});

test('a clip with 384 keyframes plays without rebuilding a lane, and a frame costs about a millisecond', async ({
  page,
}) => {
  const source = JSON.parse(await readFile(ANIMATED, 'utf8')) as Record<string, unknown>;
  const ids = Array.from({ length: 8 }, (_, i) => `0b0d1e5a-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
  const outliner = ids.map((uuid, i) => ({
    name: `bone${i}`,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    uuid,
    export: true,
    isOpen: true,
    visibility: true,
    autouv: 0,
    children: i === 0 ? ['c-trunk', 'c-skull'] : [],
  }));
  const keyframes = (channel: string) =>
    Array.from({ length: 16 }, (_, k) => ({
      channel,
      data_points: [{ x: k, y: 0, z: 0 }],
      uuid: `k-${channel}-${k}`,
      time: (k * 2) / 16,
      color: -1,
      interpolation: 'linear',
    }));
  const animators = Object.fromEntries(
    ids.map((uuid, i) => [
      uuid,
      { name: `bone${i}`, type: 'bone', keyframes: ['position', 'rotation', 'scale'].flatMap(keyframes) },
    ]),
  );
  const model = {
    ...source,
    outliner,
    animations: [{ uuid: 'a-big', name: 'big', loop: 'loop', length: 2, animators }],
  };
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'big.bbmodel', text: JSON.stringify(model) }]);
  await waitForEditor(page);
  await expect(timeline(page).locator('.tl-lane')).toHaveCount(8);
  await expect(timeline(page)).toContainText('16 keyframes');
  const before = (await page.evaluate(() => window.__msApp!.timelineStats()))!;
  await timeline(page).getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number(await playhead(page).inputValue()), { timeout: 20_000 }).toBeGreaterThan(1);
  await timeline(page).getByRole('button', { name: 'Pause' }).click();
  const after = (await page.evaluate(() => window.__msApp!.timelineStats()))!;
  expect(after.laneBuilds).toBe(before.laneBuilds);
  expect(after.medianSyncMs).toBeLessThanOrEqual(1);
});

for (const width of [1440, 1024]) {
  test(`the timeline at ${width} px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await openAnimated(page);
    await timeline(page).locator('.tl-name').first().click();
    await playhead(page).fill('0.5');
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`timeline-${width}.png`) });
    const box = (await timeline(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect((await timeline(page).locator('.tl-bar').boundingBox())!.width).toBeLessThanOrEqual(width);
  });
}

test('a model with more than 500 animated nodes shows 500 lanes and a "+N more nodes" row, names as text', async ({
  page,
}) => {
  const source = JSON.parse(await readFile(ANIMATED, 'utf8')) as Record<string, unknown>;
  const count = 510;
  const ids = Array.from({ length: count }, (_, i) => `0b0d1e5a-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const outliner = ids.map((uuid, i) => ({
    name: i === 0 ? '<img src=x onerror=alert(1)>' : `n${i}`,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    uuid,
    export: true,
    isOpen: true,
    visibility: true,
    autouv: 0,
    children: i === 0 ? ['c-trunk', 'c-skull'] : [],
  }));
  const animators = Object.fromEntries(
    ids.map((uuid, i) => [
      uuid,
      {
        name: `n${i}`,
        type: 'bone',
        keyframes: [
          {
            channel: 'rotation',
            data_points: [{ x: 1, y: 0, z: 0 }],
            uuid: `k-${i}`,
            time: 0.5,
            color: -1,
            interpolation: 'linear',
          },
        ],
      },
    ]),
  );
  const model = {
    ...source,
    outliner,
    animations: [{ uuid: 'a-many', name: 'many', loop: 'loop', length: 1, animators }],
  };
  await openApp(page);
  await chooseMadeFiles(page, [{ name: 'many.bbmodel', text: JSON.stringify(model) }]);
  await waitForEditor(page);
  await expect(timeline(page).locator('.tl-lane:not(.more)')).toHaveCount(500);
  await expect(timeline(page).locator('.tl-name.more')).toHaveText('+10 more nodes');
  await expect(timeline(page).locator('.tl-name').first()).toHaveText('<img src=x onerror=alert(1)>');
  expect(await timeline(page).locator('img').count()).toBe(0);
});

test('forced colours keep the diamonds, the playhead and the selected lane visible', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openAnimated(page);
  await timeline(page).locator('.tl-name').first().click();
  await playhead(page).fill('0.5');
  const seen = await page.evaluate(() => {
    const probe = (colour: string): string => {
      const element = document.createElement('i');
      element.style.color = colour;
      document.body.append(element);
      const value = getComputedStyle(element).color;
      element.remove();
      return value;
    };
    const kf = getComputedStyle(document.querySelector('#timeline .kf')!);
    const line = getComputedStyle(document.querySelector('#timeline .tl-playhead')!);
    const lane = getComputedStyle(document.querySelector('#timeline .tl-lane.sel')!);
    return {
      diamond: kf.backgroundColor,
      diamondBorder: kf.borderTopColor,
      line: line.borderLeftColor,
      lineWidth: line.borderLeftWidth,
      outline: lane.outlineStyle,
      outlineWidth: lane.outlineWidth,
      highlight: probe('Highlight'),
      text: probe('CanvasText'),
    };
  });
  expect(seen.diamond).not.toBe('rgba(0, 0, 0, 0)');
  expect(seen.diamond).toBe(seen.highlight);
  expect(seen.diamondBorder).toBe(seen.text);
  expect(seen.line).toBe(seen.text);
  expect(parseFloat(seen.lineWidth)).toBeGreaterThan(0);
  expect(seen.outline).toBe('solid');
  expect(parseFloat(seen.outlineWidth)).toBeGreaterThan(0);
});
