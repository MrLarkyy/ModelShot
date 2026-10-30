import { PNG } from 'pngjs';
import { compareImages } from '../../../tools/harness/src/compareImages';
import { PT_PAIR_TOLERANCE } from '../../../tools/harness/src/ptPairTolerance';
import { expect, fixture, openApp, openFiles, previewImage, renderImage, test, type Rgba } from './appTest';

function toPng(image: Rgba): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  image.data.copy(png.data);
  return PNG.sync.write(png);
}

test('the preview and the render of the same view agree within the path tracer pair tolerance, and a render repeats exactly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await page.getByRole('radio', { name: 'Marketplace' }).check();
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 120_000 });
  // The Marketplace bake replaced the Studio one: wait for the bake that ends after the look change.
  await page.waitForTimeout(500);
  await expect(page.getByRole('status')).toContainText('Preview lit', { timeout: 120_000 });
  const preview = await previewImage(page);

  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('64');
  await samples.dispatchEvent('change');
  let renders = 0;
  const render = async (): Promise<Rgba> => {
    await page.getByRole('button', { name: 'Render' }).click();
    renders += 1;
    await expect(page.locator('#result')).toHaveAttribute('data-renders', String(renders), { timeout: 180_000 });
    return renderImage(page);
  };
  const first = await render();
  expect([first.width, first.height]).toEqual([preview.width, preview.height]);

  const limits = PT_PAIR_TOLERANCE['preset-marketplace'];
  const result = compareImages(toPng(first), toPng(preview), limits);
  console.log(`[parity] ratio ${result.ratio.toFixed(5)} meanDelta ${result.meanDelta.toFixed(3)}`);
  expect(result.ratio, 'differing pixels').toBeLessThanOrEqual(limits?.maxDiffRatio ?? 0);
  expect(result.meanDelta, 'mean difference').toBeLessThanOrEqual(limits?.maxMeanDelta ?? 0);

  const second = await render();
  expect(second.data.equals(first.data), 'the same scene, camera and seed give the same bytes').toBe(true);
});

test('the render canvas is drawn pixelated and as large as the view', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  const samples = page.locator('#render-panel').getByLabel('Samples');
  await samples.fill('2');
  await samples.dispatchEvent('change');
  await page.getByRole('button', { name: 'Render' }).click();
  await expect(page.getByRole('status')).toContainText('Render done', { timeout: 60_000 });
  const sizes = await page.evaluate(() => {
    const preview = document.getElementById('preview') as HTMLCanvasElement;
    const result = document.getElementById('result') as HTMLCanvasElement;
    return {
      previewBacking: [preview.width, preview.height],
      resultBacking: [result.width, result.height],
      dpr: window.devicePixelRatio,
      css: [preview.clientWidth, preview.clientHeight],
      rendering: getComputedStyle(result).imageRendering,
    };
  });
  expect(sizes.rendering).toBe('pixelated');
  expect(sizes.resultBacking).toEqual(sizes.previewBacking);
  expect(sizes.previewBacking).toEqual([sizes.css[0]! * sizes.dpr, sizes.css[1]! * sizes.dpr]);
});

test('the backing store follows the device pixel ratio', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1000, height: 600 } });
  const page = await context.newPage();
  await page.goto(`${baseURL}/app/`);
  await page.waitForFunction(() => window.__msApp !== undefined);
  // The backing store follows a ResizeObserver, so a layout change late in loading reaches it a frame later.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const preview = document.getElementById('preview') as HTMLCanvasElement;
        return [preview.width - preview.clientWidth * 2, preview.height - preview.clientHeight * 2];
      }),
    )
    .toEqual([0, 0]);
  await context.close();
});

test('a lost graphics context comes back with the model drawn again', async ({ page }) => {
  await openApp(page);
  await openFiles(page, [fixture('bbmodel', 'single-cube.bbmodel')], 'single-cube.bbmodel');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__msApp!.loseContext())).toBe(true);
  await expect(page.getByRole('status')).toContainText('graphics context was restored', { timeout: 30_000 });
  let centreChanged = false;
  for (let i = 0; i < 40 && !centreChanged; i++) {
    const image = await previewImage(page);
    const centre = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
    const corner = 4 * (image.width * 4 + 4);
    centreChanged = Math.abs((image.data[centre] ?? 0) - (image.data[corner] ?? 0)) > 20;
    if (!centreChanged) await page.waitForTimeout(150);
  }
  expect(centreChanged, 'the model is drawn after the context came back').toBe(true);
});
