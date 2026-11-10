import type { Page } from '@playwright/test';
import { encodeFlipped, expectGolden, openFixture, type FixtureInfo } from '../src/expectGolden';
import type { GoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import { decodePng, luminance, type Image } from '../src/imageMetrics';

/**
 * MS-47: Softbox, a look lit by the bundled studio image `softbox-studio` (packages/looks/src/environments), on the
 * held-cube player from the review yaw 210, pitch 20. The preview fills with the image's L2 irradiance and bakes its
 * occlusion; the render samples the image itself (luminance importance sampling with MIS). The radiance pair of the
 * whole view is pathtracer.spec.ts's (`preset-softbox` in src/ptPairTolerance.ts); these are its goldens and probes.
 */
const RT_SOFTBOX: GoldenSpec = { kind: 'raster', fixture: 'rt', name: 'rt-preset-softbox', variant: 'preset-softbox' };
const PT_SOFTBOX: GoldenSpec = {
  kind: 'pathtraced',
  fixture: 'pt',
  name: 'pt-preset-softbox',
  variant: 'preset-softbox',
  seed: 1,
  samples: 64,
  tolerance: {
    threshold: 0,
    reason:
      'threshold 0 only (default ratio and mean): a converged image tells seed and sample count apart by single levels',
  },
};

/**
 * The head front seen through a hole of the hat (realtime.spec.ts HEAD_THROUGH_HAT_HOLE, model units): its light comes
 * through the hat's cut-out texels, so a shadow ray of the image that a cut-out texel stopped would darken it in the
 * render only.
 */
const HEAD_THROUGH_HAT_HOLE: readonly [number, number, number] = [-1.5, 29.5, -4];
/**
 * Preview vs render at that point, 5 x 5 mean luminance in levels: measured 2.64 (preview baked 64: 92.92, render seed 1
 * at 64 samples: 95.56, its interreflection the brighter), x 1.25; MS-57, with one bounce in the bake: 0.07 (preview
 * 95.63, render 95.56: a signed difference near zero, so the two estimators' noise, not a bias, sets it). The limit
 * is the larger of measured x 1.25 (0.09) and one level, the least the 8-bit frame resolves: 1.
 */
const HEAD_LIMIT = 1;

/**
 * Path-tracer cost of the image (one more shadow ray per vertex): the median of 3 runs of 64 samples at 128 x 128 on the
 * bench scene, software GL. Locally Softbox 2079 to 2211 ms against Marketplace 1739 to 1911 ms (ratio 1.16 to 1.20).
 * CI medians, Softbox / Marketplace: 4941 / 4298 ms on an AMD EPYC 9V74 (run 41938074241), 6812 / 5758 ms and
 * 6791 / 5714 ms on an Intel Xeon Platinum 8573C (runs 42603995894, 42609514376): ratio 1.15 to 1.19, as locally
 * (1.21 to 1.27 in three runs on a later day), while Marketplace alone runs 2.2 to 3.3x slower than locally. The runners
 * differ, the Softbox cost did not grow. 15000 ms is 3.0x the fast runner's Softbox median and 2.2x the slowest. The
 * ratio limit is the Softbox-specific guard: on the CI runners measured it fails at a Softbox-only slowdown of about
 * 1.4x (1.39x from 1.15, 1.34x from 1.19); the absolute limit catches a tracer-wide slowdown beyond 3x.
 */
const SOFTBOX_SAMPLES_MS = 15000;
const SOFTBOX_COST_RATIO = 1.6;

async function currentImage(page: Page, info: FixtureInfo): Promise<Image> {
  const now = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    return { rgba: fixture.readRGBA(), width: fixture.width, height: fixture.height };
  });
  return decodePng(encodeFlipped({ ...info, ...now }));
}

async function project(page: Page, point: readonly [number, number, number]): Promise<[number, number]> {
  return page.evaluate(([x, y, z]) => {
    const fixture = window.__msFixture;
    const projector = fixture?.rt ?? fixture?.pt;
    if (!projector) throw new Error('fixture controls missing');
    return projector.project(x, y, z);
  }, point);
}

/** Mean luminance of the 5 x 5 pixels around (x, y). */
function meanLuminance(image: Image, x: number, y: number): number {
  let sum = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const i = ((Math.round(y) + dy) * image.width + Math.round(x) + dx) * 4;
      sum += luminance([image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]);
    }
  }
  return sum / 25;
}

/** Mean absolute channel difference of two images of one size, in levels. */
function meanDifference(a: Image, b: Image): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) sum += Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
  return sum / ((a.data.length / 4) * 3);
}

test.describe('Softbox: a look lit by the bundled studio image', () => {
  test('preview golden', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, RT_SOFTBOX);
  });

  test('render golden', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await expectGolden(page, testInfo, PT_SOFTBOX);
    expect(await page.evaluate(() => window.__msFixture?.pt?.capped())).toEqual({ traversals: 0, pixels: 0 });
  });

  test('the image lights the model: Softbox is not Marketplace under the same backdrop and grade', async ({ page }) => {
    test.setTimeout(120_000);
    const open = async (variant: string) => {
      const info = await openFixture(page, `/rt.html?variant=${variant}`);
      return currentImage(page, info);
    };
    const softbox = await open('preset-softbox');
    const marketplace = await open('preset-marketplace');
    const delta = meanDifference(softbox, marketplace);
    console.log(`[softbox probe] mean difference to Marketplace ${delta.toFixed(2)} levels`);
    expect(delta).toBeGreaterThan(2);
  });

  test('setLook to Softbox and back renders Marketplace byte for byte, in the preview and the render', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const [fixture, query] of [
      ['rt', 'variant=preset-marketplace&bake=0'],
      ['pt', 'variant=preset-marketplace&seed=1&samples=4'],
    ] as const) {
      const info = await openFixture(page, `/${fixture}.html?${query}`);
      const marketplace = await currentImage(page, info);
      const set = (id: string) =>
        page.evaluate(
          ([which, name]) => {
            const controls = which === 'rt' ? window.__msFixture?.rt : window.__msFixture?.pt;
            if (!controls) throw new Error('fixture controls missing');
            return controls.setLook(name);
          },
          [fixture, id] as const,
        );
      expect(await set('softbox')).toBe('ok');
      const softbox = await currentImage(page, info);
      expect(meanDifference(softbox, marketplace), `${fixture}: Softbox differs`).toBeGreaterThan(2);
      expect(await set('marketplace')).toBe('ok');
      const back = await currentImage(page, info);
      expect(Buffer.from(back.data).equals(Buffer.from(marketplace.data)), `${fixture}: Marketplace again`).toBe(true);
    }
  });

  test('the head through a hat hole: the render lights it like the baked preview', async ({ page }) => {
    test.setTimeout(300_000);
    const previewInfo = await openFixture(page, '/rt.html?variant=preset-softbox&bake=64');
    const preview = await currentImage(page, previewInfo);
    const previewAt = meanLuminance(preview, ...(await project(page, HEAD_THROUGH_HAT_HOLE)));
    const renderInfo = await openFixture(page, '/pt.html?variant=preset-softbox&seed=1&samples=64');
    const render = await currentImage(page, renderInfo);
    const renderAt = meanLuminance(render, ...(await project(page, HEAD_THROUGH_HAT_HOLE)));
    const line = `head through the hat hole: preview ${previewAt.toFixed(2)}, render ${renderAt.toFixed(2)} levels`;
    console.log(`[softbox probe] ${line}`);
    expect(previewAt, 'the head is lit').toBeGreaterThan(40);
    expect(Math.abs(renderAt - previewAt), line).toBeLessThanOrEqual(HEAD_LIMIT);
  });

  test(
    'path-tracer time to 64 samples under Softbox stays within a factor of Marketplace',
    { tag: '@timing' },
    async ({ page }) => {
      test.setTimeout(300_000);
      const timed = async (preset: string) => {
        await openFixture(page, `/pt.html?scene=bench&size=128&samples=1&preset=${preset}`);
        const runs = await page.evaluate(() => {
          const fixture = window.__msFixture;
          if (!fixture?.timeToSamples) throw new Error('sample bench missing');
          return [fixture.timeToSamples(64), fixture.timeToSamples(64), fixture.timeToSamples(64)];
        });
        return runs.sort((a, b) => a - b)[1] ?? 0;
      };
      const marketplace = await timed('marketplace');
      const softbox = await timed('softbox');
      console.log(
        `[softbox probe] 64 samples at 128 x 128 (bench scene): Softbox ${softbox.toFixed(0)} ms, Marketplace ${marketplace.toFixed(0)} ms, ratio ${(softbox / marketplace).toFixed(2)}`,
      );
      expect(softbox, 'time to 64 samples under Softbox (ms)').toBeLessThanOrEqual(SOFTBOX_SAMPLES_MS);
      expect(softbox / marketplace, 'Softbox over Marketplace').toBeLessThanOrEqual(SOFTBOX_COST_RATIO);
    },
  );
});
