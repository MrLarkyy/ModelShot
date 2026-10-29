import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the two plain modules directly.
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { backdropColor } from '../../../packages/looks/src/backdropColor';
import { LIGHT_RIG_V0, unoccludedRadiance } from '../../../packages/looks/src/lightRig';
import type { ModelViewProbe, PtProbe } from '../fixtures/src/fixtureApi';
import { compareImages } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, renderFixture, type FixtureInfo } from '../src/expectGolden';
import { lookPresetFile } from '../src/lookPresetFile';
import type { GoldenSpec, PathTracedGoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import {
  decodePng,
  hueMatch,
  luminance,
  modelBox,
  pixel,
  sentinelPixels,
  silhouetteMismatches,
  silhouettePixels,
  whiteCount,
  type BackdropRow,
  type Image,
} from '../src/imageMetrics';
import { PT_PAIR_TOLERANCE } from '../src/ptPairTolerance';
import { shadowStep } from '../src/shadowStep';
import { OUTLINE_HULL_BOARD_LEVELS, outlineHullProbe } from '../src/outlineHullProbe';
import { differenceMask, maskedPng } from '../src/edgeProbes';
import { readFileSync } from 'node:fs';
import { goldenPath } from '../src/goldenStore';
import { blockMeans, edgeMask, edgeSharpness, farFrom, imageError } from '../src/imageMetrics';

/**
 * Path-traced images converge: at the default threshold 0.1 another seed or one sample more or less passes (seed 2 at
 * 64 samples: 7 of 65 536 pixels, mean delta 0.30). At threshold 0 every changed level counts: one sample less changes
 * 7.5 % of the pixels, another seed 18 %, far over the default maxDiffRatio 0.001, which stays as it is.
 */
const PT_TOLERANCE = {
  threshold: 0,
  reason:
    'threshold 0 only (default ratio and mean): a converged image tells seed and sample count apart by single levels',
};

const pt = (name: string, variant: string, samples: number): PathTracedGoldenSpec => ({
  kind: 'pathtraced',
  fixture: 'pt',
  name: `pt-${name}`,
  variant,
  seed: 1,
  samples,
  tolerance: PT_TOLERANCE,
});

const TURNTABLE = pt('turntable-y030', 'turntable-y030', 64);
const ALPHA_PLANE = pt('alpha-plane', 'alpha-plane', 128);
const RAMP = pt('alpha-ramp-blend', 'alpha-ramp-blend', 128);
const RENDER_ORDER = pt('render-order', 'render-order', 16);
const EMISSIVE = pt('emissive', 'emissive', 64);
// The MS-20 player in the hold preset with a cube in its right hand, paired with rt-player-hold-34.
const PLAYER_HOLD = pt('player-hold-34', 'player-hold-34', 64);
// MS-16: shadows of cut-out texels on the shadow catcher and a box, paired with rt-bake-cutout-checker.
const CUTOUT_CHECKER = pt('cutout-checker', 'cutout-checker', 128);
// MS-15: rounded edges on a cube and a wedge, none on a plane, a card and a sphere; paired with rt-edges.
const EDGES = pt('edges', 'edges', 128);
// MS-19: the Marketplace and Rim looks on the held-cube player; paired with rt-preset-marketplace and rt-preset-rim.
const MARKETPLACE = pt('preset-marketplace', 'preset-marketplace', 64);
const GOLDENS: readonly PathTracedGoldenSpec[] = [
  TURNTABLE,
  pt('iso', 'iso', 64),
  pt('closeup', 'closeup', 64),
  ALPHA_PLANE,
  RAMP,
  RENDER_ORDER,
  EMISSIVE,
  PLAYER_HOLD,
  CUTOUT_CHECKER,
  EDGES,
  MARKETPLACE,
  pt('preset-rim', 'preset-rim', 64),
  // MS-41: the box's contact shadow on an image-less glTF ground; paired with rt-bake-gltf-contact.
  pt('gltf-contact', 'gltf-contact', 128),
  // MS-39: MS-13 loader fixtures, paired with rt-<v>.
  pt('gltf-nodes-y030', 'gltf-nodes-y030', 128),
  pt('obj-shapes-y030', 'obj-shapes-y030', 128),
];

/** The look preset of a fixture variant (rtScenes.ts RT_VARIANTS), Studio unless the variant names one. */
const VARIANT_PRESET: Readonly<Record<string, string>> = {
  'preset-marketplace': 'marketplace',
  'preset-marketplace-yaw30': 'marketplace',
  'preset-rim': 'rim',
};

/** The display colour (0..255) of the look's backdrop in image row y (top 0): its TS mirror. */
function backdropRowOf(presetId: string): BackdropRow {
  const look = lookPresetFile(presetId);
  return (y, height) =>
    agxToneMap(backdropColor(look, (height - y - 0.5) / height), look.toneMapping).map((v) => v * 255);
}

async function render(page: Page, query: string): Promise<{ png: Buffer; image: Image; info: FixtureInfo }> {
  const info = await openFixture(page, `/pt.html?${query}`);
  const png = encodeFlipped(info);
  return { png, image: decodePng(png), info };
}

/** Reads the current drawing buffer again, after the page drew without a reload. */
async function readPng(page: Page, info: FixtureInfo): Promise<Buffer> {
  const now = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    return { rgba: fixture.readRGBA(), width: fixture.width, height: fixture.height };
  });
  return encodeFlipped({ ...info, ...now });
}

/** The pixels of one pass of `spec` rendered now: the byte reference of the determinism checks (never the PNG). */
const referencePixels = async (page: Page, spec: GoldenSpec): Promise<Buffer> =>
  decodePng((await renderFixture(page, spec)).png).data;

const probesOf = async (page: Page): Promise<readonly PtProbe[]> =>
  page.evaluate(() => window.__msFixture?.pt?.probes ?? []);

const at = <T extends { name: string }>(probes: readonly T[], name: string): T => {
  const probe = probes.find((p) => p.name === name);
  if (!probe) throw new Error(`probe ${name} missing`);
  return probe;
};

test.describe('path-tracer goldens', () => {
  // 10.5-22.4 s on a SwiftShader runner (then the 30 s default timeout); MS-39's two loader scenes 5.2 and 3.5 s locally.
  test.describe.configure({ timeout: 120_000 });
  for (const golden of GOLDENS) {
    test(`${golden.name} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, golden);
      // No traversal of a golden view stops at the per-ray node cap, so the cap shapes no pixel.
      expect(await page.evaluate(() => window.__msFixture?.pt?.capped())).toEqual({ traversals: 0, pixels: 0 });
    });
  }
});

test.describe('determinism', () => {
  // 11.5-35.0 s on a SwiftShader runner (then the 30 s default timeout).
  test.describe.configure({ timeout: 120_000 });
  test('the same seed and sample count render byte-identical images', async ({ page }) => {
    const first = await renderFixture(page, TURNTABLE);
    const second = await renderFixture(page, TURNTABLE);
    expect(second.png.equals(first.png)).toBe(true);
  });

  test('batches of 7 samples, 64-pixel tiles and one pass of N give the same bytes', async ({ page }) => {
    const reference = await referencePixels(page, TURNTABLE);
    for (const extra of ['batch=1', 'batch=7', 'tile=64', 'batch=7&tile=64']) {
      const { image, info } = await render(page, `variant=turntable-y030&seed=1&samples=64&${extra}`);
      expect(info.samplesDone, extra).toBe(64);
      expect(image.data.equals(reference), extra).toBe(true);
    }
  });

  test.describe('another seed or sample count fails the comparison', () => {
    for (const [label, spec] of [
      ['seed 2', { ...TURNTABLE, seed: 2 }],
      ['63 samples', { ...TURNTABLE, samples: 63 }],
      ['65 samples', { ...TURNTABLE, samples: 65 }],
    ] as const) {
      test(label, async ({ page }, testInfo) => {
        await expect(expectGolden(page, testInfo, spec, { compareAgainst: TURNTABLE })).rejects.toThrow(
          /pixels differ/,
        );
      });
    }
  });
});

/**
 * MS-18 render quality: supersampling, the denoiser and the convergence stop (docs/testing.md, render quality). The
 * 2048-sample reference of the closeup renders only on a golden update; every other run reads its PNG, and a drift
 * guard checks it still matches the tracer. The limits are measured values with a margin, never widened.
 */
const REFERENCE = pt('closeup-reference', 'closeup', 2048);
const CLOSEUP_DENOISED: PathTracedGoldenSpec = { ...pt('closeup-denoised', 'closeup', 64), denoise: true };
const TURNTABLE_X2_DENOISED: PathTracedGoldenSpec = {
  ...pt('turntable-y030-x2-denoised', 'turntable-y030', 16),
  supersample: 2,
  denoise: true,
};
const QUALITY = {
  // Largest 16 x 16 block mean difference (levels) of a 64-sample closeup from the reference: measured 0.77 x 1.25.
  driftMax: 1,
  // RMSE (levels) of the denoised 64-sample closeup against the reference: measured 1.110 x 1.25 (the plain 64
  // samples measure 1.880).
  denoisedRmseMax: 1.39,
  // Its RMSE over the plain 64 samples': measured 0.590 x 1.1 (docs/testing.md: the plan's 0.5 is not reached).
  denoisedRatioMax: 0.65,
  // The reference took 129 s on the local SwiftShader machine; CI runners are 3-5x slower.
  referenceTimeoutMs: 1_200_000,
} as const;

const referenceImage = (): Image => decodePng(readFileSync(goldenPath(REFERENCE)));

const progressOf = async (page: Page) =>
  page.evaluate(() => ({ ...window.__msFixture!.pt!.progress, running: window.__msFixture!.pt!.running }));

test.describe('render quality: supersampling, denoising, convergence', () => {
  test.describe.configure({ timeout: 300_000 });

  for (const golden of [CLOSEUP_DENOISED, TURNTABLE_X2_DENOISED]) {
    test(`${golden.name} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, golden);
      expect(await page.evaluate(() => window.__msFixture?.pt?.capped())).toEqual({ traversals: 0, pixels: 0 });
    });
  }

  test(`${REFERENCE.name}: rendered only on a golden update, read from its PNG otherwise`, async ({
    page,
  }, testInfo) => {
    const mode = testInfo.config.updateSnapshots;
    if (mode === 'all' || mode === 'changed') {
      test.setTimeout(QUALITY.referenceTimeoutMs);
      const started = Date.now();
      await expectGolden(page, testInfo, REFERENCE);
      console.log(`[pt quality] reference: 2048 samples at 256 x 256 in ${Date.now() - started} ms`);
    }
    const reference = referenceImage();
    expect([reference.width, reference.height]).toEqual([256, 256]);
  });

  test('drift guard: a 64-sample closeup matches the reference in 16 x 16 block means', async ({ page }) => {
    const reference = blockMeans(referenceImage(), 16);
    const noisy = blockMeans((await render(page, 'variant=closeup&seed=1&samples=64')).image, 16);
    const drift = Math.max(...noisy.flatMap((block, i) => block.map((v, c) => Math.abs(v - (reference[i]?.[c] ?? 0)))));
    console.log(`[pt quality] drift: largest block mean difference ${drift.toFixed(2)} / max ${QUALITY.driftMax}`);
    expect(drift, 'the reference was rendered by another tracer: run golden:update for it').toBeLessThanOrEqual(
      QUALITY.driftMax,
    );
  });

  test('AC1: the denoised 64-sample closeup is close to the 2048-sample reference', async ({ page }) => {
    const reference = referenceImage();
    const noisy = imageError((await render(page, 'variant=closeup&seed=1&samples=64')).image, reference);
    const denoised = imageError((await render(page, 'variant=closeup&seed=1&samples=64&denoise=1')).image, reference);
    console.log(
      `[pt quality] AC1: rmse 64 samples ${noisy.rmse.toFixed(3)}, denoised ${denoised.rmse.toFixed(3)} ` +
        `(max ${QUALITY.denoisedRmseMax}), ratio ${(denoised.rmse / noisy.rmse).toFixed(3)} (max ${QUALITY.denoisedRatioMax}); mae ` +
        `${noisy.mae.toFixed(3)} / ${denoised.mae.toFixed(3)}`,
    );
    expect(denoised.rmse).toBeLessThanOrEqual(QUALITY.denoisedRmseMax);
    expect(denoised.rmse / noisy.rmse).toBeLessThanOrEqual(QUALITY.denoisedRatioMax);
  });

  test('AC2: texel edges stay sharp, nothing bleeds across face rectangles', async ({ page }) => {
    const reference = referenceImage();
    const denoised = (await render(page, 'variant=closeup&seed=1&samples=64&denoise=1')).image;
    const edges = edgeMask(reference, 24);
    const sharpness = edgeSharpness(denoised, reference, edges);
    const away = imageError(denoised, reference, farFrom(edges, reference.width, reference.height, 2));
    console.log(
      `[pt quality] AC2: sharpness ${sharpness.toFixed(4)} on ${edges.reduce((s, v) => s + v, 0)} edge px / min ` +
        `0.9; rmse more than 2 px from an edge ${away.rmse.toFixed(3)} on ${away.pixels} px`,
    );
    expect(sharpness).toBeGreaterThanOrEqual(0.9);
    expect(away.rmse).toBeLessThanOrEqual(QUALITY.denoisedRmseMax);
    expect(sentinelPixels(denoised)).toBe(0);
    const x2 = (await render(page, 'variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1')).image;
    expect(sentinelPixels(x2)).toBe(0);
  });

  test('a 2x render frames like the 1x render; its backdrop matches the TS mirror', async ({ page }) => {
    const one = await render(page, 'variant=turntable-y030&seed=1&samples=64&catcher=0');
    const two = await render(page, 'variant=turntable-y030&seed=1&samples=16&catcher=0&supersample=2');
    expect([two.info.width, two.info.height]).toEqual([one.info.width, one.info.height]);
    expect(await page.evaluate(() => window.__msFixture!.pt!.accumulationSize)).toEqual([512, 512]);
    expect((await progressOf(page)).supersample).toBe(2);
    const framing = silhouetteMismatches(one.image, two.image, backdropRowOf('studio'));
    console.log(`[pt quality] 2x framing: ${framing.mismatches} mismatches off ${framing.silhouette} silhouette px`);
    expect(framing.mismatches).toBe(0);
    const row = backdropRowOf('marketplace');
    const { image } = await render(page, 'scene=empty&preset=marketplace&seed=1&samples=1&supersample=2&tile=64');
    let worst = 0;
    for (let y = 0; y < image.height; y++) {
      const expected = row(y, image.height);
      for (const x of [0, 100, image.width - 1]) {
        worst = Math.max(worst, ...pixel(image, x, y).map((v, c) => Math.abs(v - (expected[c] ?? 0))));
      }
    }
    console.log(`[pt quality] 2x marketplace backdrop: worst ${worst} levels from the mirror`);
    expect(worst).toBeLessThanOrEqual(2);
  });

  test('a denoised 2x render gives the same bytes in batches of 7 and 3, 64-pixel tiles and after a restore', async ({
    page,
  }) => {
    const reference = await referencePixels(page, TURNTABLE_X2_DENOISED);
    const query = 'variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1';
    for (const extra of ['batch=7', 'batch=3&tile=64', 'tile=64']) {
      const { image, info } = await render(page, `${query}&${extra}`);
      expect(info.samplesDone, extra).toBe(16);
      expect(image.data.equals(reference), extra).toBe(true);
    }
    const info = await openFixture(page, `/pt.html?${query}`);
    const rendered = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      await ptc.lose();
      await ptc.restore();
      return ptc.render();
    });
    expect(rendered).toBe(16);
    expect(decodePng(await readPng(page, info)).data.equals(reference), 'after a context restore').toBe(true);
  });

  for (const extra of ['batch=1', 'batch=1&tile=64']) {
    test(`a denoised 2x render drawn by ${extra} gives the one-pass reference bytes`, async ({ page }) => {
      const reference = await referencePixels(page, TURNTABLE_X2_DENOISED);
      const { image, info } = await render(
        page,
        `variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1&${extra}`,
      );
      expect(info.samplesDone, extra).toBe(16);
      expect(image.data.equals(reference), extra).toBe(true);
    });
  }

  for (const [tile, k] of [
    [256, 1],
    [64, 1],
    [256, 4],
    [64, 4],
  ] as const) {
    test(`a denoised step(${k}) draws a bounded number of guide tiles (tile ${tile}) and no sample before the guide ends`, async ({
      page,
    }) => {
      const reference = await referencePixels(page, TURNTABLE_X2_DENOISED);
      const query = `variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1&track=1&tile=${tile}`;
      const info = await openFixture(page, `/pt.html?${query}`);
      const run = await page.evaluate((count) => {
        const ptc = window.__msFixture!.pt!;
        const [width, height] = ptc.accumulationSize;
        ptc.restart();
        ptc.drawCounts();
        const steps: {
          drawn: number;
          guide: number;
          other: number;
          guiding: boolean;
          done: number;
          bound: boolean;
        }[] = [];
        do {
          const drawn = ptc.step(count);
          steps.push({
            drawn,
            ...ptc.drawCounts(),
            guiding: ptc.guiding,
            done: ptc.samplesDone,
            bound: ptc.defaultFramebufferBound(),
          });
        } while (steps[steps.length - 1]!.drawn > 0 || steps[steps.length - 1]!.guiding);
        return { width, height, steps };
      }, k);
      // Guide tiles are a eighth of the trace tile (at least 16): a full one costs one trace tile of sample pixels.
      const side = Math.max(16, Math.floor(tile / 8));
      const total = Math.ceil(run.width / side) * Math.ceil(run.height / side);
      const bound = Math.max(1, Math.floor((k * run.width * run.height) / (side * side * 64)));
      let guideDrawn = 0;
      for (const [i, step] of run.steps.entries()) {
        guideDrawn += step.guide;
        expect(step.guide, `guide tiles in step ${i}`).toBeLessThanOrEqual(bound);
        if (step.done === 0) {
          expect(step.drawn, `step ${i} draws no sample`).toBe(0);
          expect(step.other, `step ${i} traces and presents nothing`).toBe(0);
          expect(step.guiding, `step ${i} is a guide step`).toBe(true);
          expect(step.bound, `step ${i} leaves the default framebuffer bound`).toBe(true);
        } else {
          expect(guideDrawn, `the guide is complete when sample ${step.done} is drawn`).toBe(total);
        }
      }
      expect(guideDrawn).toBe(total);
      expect(run.steps.filter((step) => step.drawn === 0 && !step.guiding)).toHaveLength(1);
      expect(run.steps[run.steps.length - 1]!.done).toBe(16);
      expect(decodePng(await readPng(page, info)).data.equals(reference), 'bytes of the one-step reference').toBe(true);
    });
  }

  test('guiding is false when a step would draw nothing: lost context, cancel, dispose, failed restore', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const query = 'variant=turntable-y030&seed=1&samples=4&supersample=2&denoise=1&size=64';
    await openFixture(page, `/pt.html?${query}`);
    const lost = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      ptc.restart();
      for (let i = 0; i < 3; i++) ptc.step(1);
      const before = ptc.guiding;
      return { before, ...(await ptc.loseProbe()) };
    });
    expect(lost).toEqual({
      before: true,
      sync: { drawn: 0, guiding: false },
      event: { drawn: 0, guiding: false },
    });
    await openFixture(page, `/pt.html?${query}`);
    const cancelled = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      ptc.restart();
      for (let i = 0; i < 3; i++) ptc.step(1);
      const before = ptc.guiding;
      ptc.cancel();
      return { before, drawn: ptc.step(1), guiding: ptc.guiding };
    });
    expect(cancelled).toEqual({ before: true, drawn: 0, guiding: false });
    await openFixture(page, `/pt.html?${query}`);
    const failed = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      ptc.restart();
      for (let i = 0; i < 3; i++) ptc.step(1);
      return ptc.failedRestoreProbe();
    });
    expect(failed).toEqual({ drawn: 0, guiding: false });
    await openFixture(page, `/pt.html?${query}`);
    const disposed = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      ptc.restart();
      for (let i = 0; i < 3; i++) ptc.step(1);
      const before = ptc.guiding;
      ptc.dispose();
      return { before, drawn: ptc.step(1), guiding: ptc.guiding };
    });
    expect(disposed).toEqual({ before: true, drawn: 0, guiding: false });
  });

  test('a context lost and restored in the middle of the guide redraws the whole guide', async ({ page }) => {
    const reference = await referencePixels(page, TURNTABLE_X2_DENOISED);
    const query = 'variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1&track=1';
    const info = await openFixture(page, `/pt.html?${query}`);
    const total = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      ptc.restart();
      ptc.drawCounts();
      for (let i = 0; i < 3; i++) ptc.step(1);
      const partial = ptc.drawCounts().guide;
      await ptc.lose();
      await ptc.restore();
      ptc.drawCounts();
      while (ptc.step(1) > 0 || ptc.guiding);
      return { partial, redrawn: ptc.drawCounts().guide, samplesDone: ptc.samplesDone };
    });
    // 512 x 512 traced pixels in guide tiles of 32: 256, whatever was drawn before the loss.
    expect(total.partial).toBeGreaterThan(0);
    expect(total.partial).toBeLessThan(256);
    expect(total).toMatchObject({ redrawn: 256, samplesDone: 16 });
    expect(decodePng(await readPng(page, info)).data.equals(reference), 'after a restore during the guide').toBe(true);
  });

  test('a noise threshold stops at a checkpoint at or under it; a lower one stops later; none draws all', async ({
    page,
  }) => {
    const run = async (noise: string) => {
      await openFixture(page, `/pt.html?variant=closeup&seed=1&samples=1024&size=64${noise}`);
      return progressOf(page);
    };
    const loose = await run('&noise=0.1');
    const tight = await run('&noise=0.07');
    console.log(`[pt quality] convergence: ${JSON.stringify({ loose, tight })}`);
    for (const [threshold, p] of [
      [0.1, loose],
      [0.07, tight],
    ] as const) {
      expect(p).toMatchObject({ converged: true, running: false, remainingMs: 0, targetSamples: 1024 });
      expect(p.samplesDone % 16, 'a checkpoint after 16').toBe(0);
      expect(p.samplesDone).toBeLessThan(1024);
      expect(p.noise).not.toBeNull();
      expect(p.noise!).toBeLessThanOrEqual(threshold);
    }
    expect(tight.samplesDone).toBeGreaterThan(loose.samplesDone);
    const plain = await run('&denoise=1');
    expect(plain).toMatchObject({ samplesDone: 1024, converged: false, running: false, remainingMs: 0 });
  });

  test('progress reports samples, scale, noise and times; the scale stays within 2^22 pixels', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=32&size=64');
    const stages = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      const started = ptc.tryQuality({ supersample: 2, denoise: true });
      const read = () => ({ ...ptc.progress, running: ptc.running });
      const before = read();
      // The guide of a denoised request takes this step's budget (it is spread over steps), so no sample yet.
      const guideOnly = { drawn: ptc.step(8), guiding: ptc.guiding };
      while (ptc.samplesDone < 8) ptc.step(1);
      const partway = read();
      while (ptc.step(8) > 0 || ptc.guiding);
      return { started, before, guideOnly, partway, done: read() };
    });
    console.log(`[pt quality] progress: ${JSON.stringify(stages)}`);
    expect(stages.started).toBe('ok');
    expect(stages.before).toMatchObject({ samplesDone: 0, supersample: 2, noise: null, converged: false });
    expect(stages.before.remainingMs).toBeNull();
    expect(stages.guideOnly).toEqual({ drawn: 0, guiding: true });
    expect(stages.partway).toMatchObject({ samplesDone: 8, targetSamples: 32, supersample: 2, running: true });
    expect(stages.partway.noise).toBeGreaterThan(0);
    expect(stages.partway.elapsedMs).toBeGreaterThan(0);
    expect(stages.partway.remainingMs).toBeGreaterThan(0);
    expect(stages.done).toMatchObject({ samplesDone: 32, running: false, converged: false, remainingMs: 0 });
    expect(stages.done.elapsedMs).toBeGreaterThanOrEqual(stages.partway.elapsedMs);
    // The scale is the one the targets were made with, not queried again: a lost context reports it unchanged.
    const lost = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      await ptc.lose();
      const read = { supersample: ptc.progress.supersample, size: ptc.accumulationSize };
      await ptc.restore();
      return read;
    });
    expect(lost).toEqual({ supersample: 2, size: [128, 128] });
    for (const [size, scale] of [
      [1024, 2],
      [1448, 1],
    ] as const) {
      await openFixture(page, `/pt.html?scene=empty&seed=1&samples=1&size=${size}&supersample=2`);
      expect(await page.evaluate(() => window.__msFixture!.pt!.accumulationSize), `size ${size}`).toEqual([
        size * scale,
        size * scale,
      ]);
      expect((await progressOf(page)).supersample, `size ${size}`).toBe(scale);
    }
  });

  test('a quality field out of range throws a RangeError naming it', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=1&size=64');
    const results = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      const bad = [
        ...[0, 5, 2.5, Number.NaN, '2'].map((supersample) => ['supersample', ptc.tryQuality({ supersample })]),
        ...[1, 'yes', null].map((denoise) => ['denoise', ptc.tryQuality({ denoise })]),
        ...[0, -1, 1.5, Number.NaN, Infinity].map((noiseThreshold) => [
          'noiseThreshold',
          ptc.tryQuality({ noiseThreshold }),
        ]),
      ];
      return { bad, good: ptc.tryQuality({ supersample: 4, denoise: false, noiseThreshold: 1 }) };
    });
    for (const [field, result] of results.bad) expect(result).toMatch(new RegExp(`^RangeError: ${field} `));
    expect(results.good).toBe('ok');
  });

  test('a denoised 2x render pairs with the baked preview within the turntable pair tolerance', async ({
    page,
  }, testInfo) => {
    const tolerance = PT_PAIR_TOLERANCE['turntable-y030']!;
    const query = 'variant=turntable-y030&seed=1&samples=16&supersample=2&denoise=1';
    const previewPng = encodeFlipped(await openFixture(page, '/rt.html?variant=turntable-y030&bake=64&catcher=1'));
    const traced = await render(page, query);
    const framingPreview = decodePng(
      encodeFlipped(await openFixture(page, '/rt.html?variant=turntable-y030&bake=64&catcher=0&msaa=0')),
    );
    const framing = silhouetteMismatches(
      framingPreview,
      (await render(page, `${query}&catcher=0`)).image,
      backdropRowOf('studio'),
    );
    const radiance = compareImages(traced.png, previewPng, tolerance);
    const line =
      `denoised 2x turntable-y030: framing ${framing.mismatches} mismatches; ${radiance.diffPixels} px differ, ratio ` +
      `${radiance.ratio.toFixed(5)} / max ${tolerance.maxDiffRatio}, mean delta ${radiance.meanDelta.toFixed(3)} / ` +
      `max ${tolerance.maxMeanDelta}`;
    console.log(`[pt pair] ${line}`);
    testInfo.annotations.push({ type: 'pt pair', description: line });
    expect(framing.mismatches).toBe(0);
    expect(radiance.pass, line).toBe(true);
  });

  test('dispose releases the quality targets and programs too', async ({ page }) => {
    await openFixture(
      page,
      '/pt.html?variant=turntable-y030&seed=1&samples=2&size=64&track=1&supersample=2&denoise=1&noise=0.5',
    );
    const counts = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      const loaded = ptc.liveGlObjects();
      ptc.dispose();
      return { loaded, gl: ptc.liveGlObjects(), step: ptc.step(1) };
    });
    expect(counts.loaded).toBeGreaterThan(0);
    expect({ gl: counts.gl, step: counts.step }).toEqual({ gl: 0, step: 0 });
  });

  test('explicit default quality fields render the bytes of a request without them', async ({ page }) => {
    const plain = await referencePixels(page, TURNTABLE);
    const explicit = await render(page, 'variant=turntable-y030&seed=1&samples=64&supersample=1&denoise=0');
    expect(explicit.image.data.equals(plain)).toBe(true);
  });

  test('an emissive face over near-black texels denoises at 1 sample with no NaN and no black blob', async ({
    page,
  }) => {
    // The albedo floor makes one sample's variance about 1e6 here, far over half precision: it must not reach the filter.
    const plain = (await render(page, 'variant=emissive-dark&seed=1&samples=1')).image;
    const denoised = (await render(page, 'variant=emissive-dark&seed=1&samples=1&denoise=1')).image;
    let glowing = 0;
    let lostGlow = 0;
    let blackened = 0;
    for (let y = 0; y < plain.height; y++) {
      for (let x = 0; x < plain.width; x++) {
        const before = luminance(pixel(plain, x, y));
        const after = luminance(pixel(denoised, x, y));
        if (before > 150) glowing++;
        if (before > 150 && after < 30) lostGlow++;
        if (after < 2 && before > 30) blackened++;
      }
    }
    console.log(
      `[pt quality] emissive over near-black: ${glowing} glowing px, ${lostGlow} lost, ${blackened} blackened`,
    );
    expect(glowing, 'the bricks glow').toBeGreaterThan(500);
    expect({ lostGlow, blackened }).toEqual({ lostGlow: 0, blackened: 0 });
  });

  test('a context lost during the noise readback never reads as convergence', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=closeup&seed=1&samples=64&size=64');
    const result = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      // 0.01 is far under the noise of a few samples; the zeros a lost context reads would pass it.
      ptc.tryQuality({ noiseThreshold: 0.01 });
      const lost = ptc.loseDuringNoise();
      const drawn = ptc.step(64);
      const { converged, noise } = ptc.progress;
      await lost;
      await ptc.restore();
      return { drawn, converged, noise };
    });
    expect(result).toEqual({ drawn: 2, converged: false, noise: null });
  });

  test('readAccumulation gives null from the moment the context is lost, before its event', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=2&size=64');
    const lengths = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      const before = ptc.accumulationLength();
      // `lose` loses the context at once; its promise resolves only after the event.
      const lost = ptc.lose();
      const during = ptc.accumulationLength();
      await lost;
      const after = ptc.accumulationLength();
      await ptc.restore();
      return { before, during, after };
    });
    expect(lengths).toEqual({ before: 64 * 64 * 4, during: null, after: null });
  });

  test('a plain request links only trace and present; a quality request and a restore link only what it needs', async ({
    page,
  }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=4&size=64&track=1');
    const counts = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      const plain = ptc.livePrograms();
      ptc.tryQuality({ noiseThreshold: 0.5 });
      ptc.step(4);
      const noise = ptc.livePrograms();
      ptc.tryQuality({ supersample: 2, denoise: true });
      ptc.step(1);
      const denoised = ptc.livePrograms();
      // The lost programs are never deleted (they died with the context), so a restore counts on top of them.
      await ptc.lose();
      await ptc.restore();
      const restored = ptc.livePrograms() - denoised;
      ptc.render();
      const plainAfter = ptc.livePrograms() - denoised;
      ptc.tryQuality({ noiseThreshold: 0.5 });
      ptc.step(4);
      return { plain, noise, denoised, restored, plainAfter, noiseAfter: ptc.livePrograms() - denoised };
    });
    expect(counts).toEqual({ plain: 2, noise: 3, denoised: 6, restored: 2, plainAfter: 2, noiseAfter: 3 });
  });
});

test.describe('transparency, shadows and sides (scene format rules)', () => {
  // 11.2-22.5 s on a SwiftShader runner (then the 30 s default timeout); MS-39's sentinel and catcher tests 5.0 and 9.7 s locally;
  // up to 66 s at six parallel workers (MS-74).
  test.describe.configure({ timeout: 180_000 });
  test('light passes cut-out texels and opaque texels cast pixel-shaped shadows', async ({ page }) => {
    const { image } = await render(page, 'variant=alpha-plane&seed=1&samples=128');
    const probes = await probesOf(page);
    const lit = luminance(
      pixel(image, at(probes, 'shadow-of-transparent-texel').x, at(probes, 'shadow-of-transparent-texel').y),
    );
    const dark = luminance(
      pixel(image, at(probes, 'shadow-of-opaque-texel').x, at(probes, 'shadow-of-opaque-texel').y),
    );
    console.log(`[pt probe] cutout shadow: lit ${lit.toFixed(1)}, shadowed ${dark.toFixed(1)} / step min 40`);
    expect(lit - dark, `ground under the hole ${lit}, under the opaque texel ${dark}`).toBeGreaterThanOrEqual(40);
    const [r, g, b] = pixel(image, at(probes, 'opaque-texel').x, at(probes, 'opaque-texel').y);
    expect(r, 'the opaque texel shows the plane').toBeGreaterThan(1.5 * Math.max(g, b));
    const seen = pixel(image, at(probes, 'transparent-texel').x, at(probes, 'transparent-texel').y);
    expect(Math.max(...seen) - Math.min(...seen), 'the cut-out texel shows the grey ground').toBeLessThan(24);

    // Along the image line between the two shadow cells the step from lit to shadowed spans at most 2 pixels.
    const from = at(probes, 'shadow-of-transparent-texel');
    const to = at(probes, 'shadow-of-opaque-texel');
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.ceil(length * 4);
    const values = Array.from({ length: steps + 1 }, (_, i) =>
      luminance(pixel(image, from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)),
    );
    const high = values[0] ?? 0;
    const low = values[steps] ?? 0;
    const between = values.filter((v) => v < high - 0.1 * (high - low) && v > low + 0.1 * (high - low)).length;
    const transition = (between * length) / steps;
    console.log(`[pt probe] shadow edge: ${transition.toFixed(2)} px between lit and shadowed / max 2`);
    expect(transition, `transition over ${length.toFixed(1)} px: ${values.join(', ')}`).toBeLessThanOrEqual(2);
  });

  test('the cut-out checker casts pixel-shaped shadows on the shadow catcher and the box', async ({ page }) => {
    const { image } = await render(page, 'variant=cutout-checker&seed=1&samples=128');
    const probes = await probesOf(page);
    for (const surface of ['catcher', 'cube']) {
      const lit = at(probes, `${surface}-shadow-of-transparent-texel`);
      const dark = at(probes, `${surface}-shadow-of-opaque-texel`);
      const { step, transition, values } = shadowStep(image, lit, dark);
      console.log(
        `[pt probe] cutout checker ${surface}: step ${step.toFixed(1)} levels / min 40, edge ${transition.toFixed(2)} px / max 2`,
      );
      expect(step, `${surface}: ${values.join(', ')}`).toBeGreaterThanOrEqual(40);
      expect(transition, `${surface}: ${values.join(', ')}`).toBeLessThanOrEqual(2);
    }
  });

  test('the shadow catcher is seen only by camera rays: without it the model renders the same', async ({ page }) => {
    // A closed opaque cube: off its silhouette every camera ray stops on it (no hole or glass shows the catcher).
    const on = await render(page, 'scene=closed-cube&look=cube&seed=1&samples=16');
    const off = await render(page, 'scene=closed-cube&look=cube&seed=1&samples=16&catcher=0');
    const backdrop = pixel(off.image, 0, 0);
    const isBackdrop = (x: number, y: number) => pixel(off.image, x, y).every((v, c) => v === backdrop[c]);
    let interior = 0;
    let changed = 0;
    let darkened = 0;
    for (let y = 1; y < off.image.height - 1; y++) {
      for (let x = 1; x < off.image.width - 1; x++) {
        const a = pixel(off.image, x, y);
        const b = pixel(on.image, x, y);
        if (isBackdrop(x, y)) {
          if (luminance(b) < luminance(a) - 10) darkened++;
          continue;
        }
        if ([-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => isBackdrop(x + dx, y + dy)))) continue;
        interior++;
        if (!a.every((v, c) => v === b[c])) changed++;
      }
    }
    expect(interior).toBeGreaterThan(1000);
    expect(changed, 'interior model pixels the catcher changed').toBe(0);
    expect(darkened, 'backdrop pixels in the catcher shadow').toBeGreaterThan(100);
  });

  test('an unblocked catcher shades exactly 1: a camera-only model renders the same bytes with and without it', async ({
    page,
  }) => {
    // Camera-only geometry is skipped by fill and key rays, so no catcher ray is ever blocked: with the control variate
    // every catcher sample is the bare backdrop (opaque) or coverage 0 (transparent), so at 1 sample, with no averaging
    // to hide a per-sample swing, the bytes must match exactly. Tolerance 0: exact by construction.
    const count = (a: Buffer, b: Buffer): number => {
      let differ = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a.subarray(i, i + 4).compare(b.subarray(i, i + 4)) !== 0) differ++;
      }
      return differ;
    };
    for (const seed of [1, 7]) {
      const query = `variant=turntable-y030&cameraonly=1&seed=${seed}&samples=1`;
      const opaqueOn = (await render(page, query)).image.data;
      const opaqueOff = (await render(page, `${query}&catcher=0`)).image.data;
      expect(count(opaqueOn, opaqueOff), `seed ${seed}: opaque pixels the catcher changed`).toBe(0);
      const clearOn = (await render(page, `${query}&transparent=1`)).image.data;
      const clearOff = (await render(page, `${query}&transparent=1&catcher=0`)).image.data;
      expect(count(clearOn, clearOff), `seed ${seed}: transparent pixels the catcher changed`).toBe(0);
      let clear = 0;
      for (let i = 3; i < clearOn.length; i += 4) if (clearOn[i] === 0) clear++;
      // Off the model the escaped rays and the catcher alike are alpha 0.
      expect(clear, `seed ${seed}: alpha-0 pixels`).toBeGreaterThan(clearOn.length / 4 / 4);
      // Not vacuous: the catcher's rectangle comes from the visible geometry, camera-only or not, and with the model
      // casting it darkens the same view.
      const castOn = (await render(page, `variant=turntable-y030&seed=${seed}&samples=1`)).image.data;
      const castOff = (await render(page, `variant=turntable-y030&seed=${seed}&samples=1&catcher=0`)).image.data;
      const cast = count(castOn, castOff);
      console.log(`[pt probe] seed ${seed}: catcher on/off differ in 0 camera-only pixels, ${cast} casting / min 100`);
      expect(cast, `seed ${seed}: pixels the catcher changes under a casting model`).toBeGreaterThan(100);
    }
  });

  test('a single-sided face casts a shadow only from the side facing the light', async ({ page }) => {
    // alpha-plane's flat cube: two coincident single-sided faces; the south one faces the light and has a hole at
    // (14, 2), the north one faces away. Light through the hole must reach the ground.
    const { image } = await render(page, 'scene=alpha-plane&look=flat-shadow&seed=1&samples=64');
    const probes = await probesOf(page);
    const lit = at(probes, 'flat-shadow-of-transparent-texel');
    const dark = at(probes, 'flat-shadow-of-opaque-texel');
    const step = luminance(pixel(image, lit.x, lit.y)) - luminance(pixel(image, dark.x, dark.y));
    console.log(`[pt probe] flat cube shadow: step ${step.toFixed(1)} levels / min 40`);
    expect(step, 'ground under the hole minus under the opaque texel').toBeGreaterThanOrEqual(40);
  });

  test('a single-sided back is invisible to the camera; a double-sided back shows the mirrored texel', async ({
    page,
  }) => {
    const below = await render(page, 'scene=coincident-double&look=below&seed=1&samples=16');
    const backdrop = pixel(below.image, 0, 0);
    const [px, py] = await page.evaluate(() => window.__msFixture!.pt!.project(6, 0, 0));
    expect(pixel(below.image, px, py), 'single-sided back').toEqual(backdrop);
    const [dx, dy] = await page.evaluate(() => window.__msFixture!.pt!.project(-6, 0, 0));
    const [r, , b] = pixel(below.image, dx, dy);
    expect(b, 'from below the down-facing blue quad').toBeGreaterThan(1.5 * r);

    const probes = await modelViewProbes(page, 'alpha-plane-raster');
    const { image } = await render(page, 'variant=alpha-plane&seed=1&samples=16');
    const back = at(probes, 'back-side-texel');
    const [br, bg, bb] = pixel(image, back.x, back.y);
    expect(br, 'the double-sided back shows the same texel, mirrored').toBeGreaterThan(1.5 * Math.max(bg, bb));
  });

  test('render order: coincident pairs, gaps (2 x TIE) and ties (0.5 x TIE) resolve as in the fixture', async ({
    page,
  }) => {
    const probes = await modelViewProbes(page, 'render-order-raster');
    const { image } = await render(page, 'variant=render-order&seed=1&samples=16');
    for (const [winner, loser] of [
      ['in-front', 'under-in-front'],
      ['over-behind', 'behind'],
      ['gap-near', 'gap-far-in-front'],
      ['tie-far-in-front', 'tie-near'],
    ] as const) {
      const shown = pixel(image, at(probes, winner).x, at(probes, winner).y);
      const toWinner = hueMatch(shown, at(probes, winner).texel);
      const toLoser = hueMatch(shown, at(probes, loser).texel);
      expect(toWinner, `${winner} over ${loser}: ${toWinner} vs ${toLoser}`).toBeGreaterThan(toLoser + 0.05);
    }
  });

  test('stochastic transparency converges to the alpha blend of each ramp texel over the backdrop', async ({
    page,
  }) => {
    const { image } = await render(page, 'variant=alpha-ramp-blend&seed=1&samples=128');
    const lit = unoccludedRadiance(LIGHT_RIG_V0, [1, 1, 1], [0, 0, 1]);
    const background = lookPresetFile('studio').backdrop.top;
    let worst = 0;
    for (let k = 0; k < 256; k++) {
      const [col, row] = [k % 16, Math.floor(k / 16)];
      const [x, y] = await page.evaluate(([c, r]) => window.__msFixture!.pt!.project(-8 + c + 0.5, 8 - r - 0.5, 0), [
        col,
        row,
      ] as const);
      // Bytes below the cutoff byte 3 (alphaCutoff 0.01) are invisible.
      const alpha = k < 3 ? 0 : k / 255;
      const expected = agxToneMap(
        [0, 1, 2].map((c) => alpha * lit[c]! + (1 - alpha) * background[c]!) as [number, number, number],
      ).map((v) => v * 255);
      const sum = [0, 0, 0];
      let n = 0;
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          pixel(image, x + dx, y + dy).forEach((v, c) => (sum[c]! += v));
          n++;
        }
      }
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(sum[c]! / n - expected[c]!));
    }
    console.log(`[pt probe] alpha ramp: largest texel mean deviation ${worst.toFixed(2)} levels / max 6`);
    expect(worst, 'largest texel mean deviation in levels').toBeLessThanOrEqual(6);
  });

  test('no turntable pixel shows a texel from outside its face rectangle', async ({ page }) => {
    const { image } = await render(page, 'variant=turntable-y030&seed=1&samples=64');
    expect(sentinelPixels(image)).toBe(0);
  });

  test('no gltf-nodes pixel shows a texel from outside its face rectangle', async ({ page }) => {
    const { image } = await render(page, 'variant=gltf-nodes-y030&seed=1&samples=128');
    const count = sentinelPixels(image);
    console.log(`[pt probe] gltf-nodes sentinel pixels ${count} / max 0`);
    expect(count).toBe(0);
  });

  test('a model surface at the catcher height hides the catcher', async ({ page }) => {
    // gltf-nodes' ground lies in the catcher's plane: a camera ray there must always take the ground. Patches of it clear
    // of the other meshes (the glass plane shows the catcher past the ground's edge through its rejected texels).
    const query = 'variant=gltf-nodes-y030&seed=1&samples=128';
    const without = (await render(page, `${query}&catcher=0`)).image;
    const withCatcher = (await render(page, query)).image;
    const backdrop = backdropRowOf('studio');
    const points: [number, number][] = [-1.2, -0.6, 0.6, 1.2].map((x) => [x, 1.25] as [number, number]);
    for (const z of [-0.8, 0, 0.8]) points.push([-1.25, z], [1.25, z]);
    let checked = 0;
    let changed = 0;
    for (const [x, z] of points) {
      const [cx, cy] = await page.evaluate(([px, pz]) => window.__msFixture!.pt!.project(px!, 0, pz!), [x, z]);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const [px, py] = [Math.round(cx) + dx, Math.round(cy) + dy];
          const model = pixel(without, px, py).some((v, c) => Math.abs(v - backdrop(py, without.height)[c]!) > 2);
          if (!model) continue;
          checked++;
          if (pixel(without, px, py).some((v, c) => v !== pixel(withCatcher, px, py)[c])) changed++;
        }
      }
    }
    console.log(`[pt probe] catcher over the ground: ${changed} of ${checked} ground pixels differ / max 0`);
    expect(checked, 'ground pixels checked').toBeGreaterThan(100);
    expect(changed, 'ground pixels the catcher changed').toBe(0);
  });

  test('an emissive material lights the post beside it', async ({ page }) => {
    const plain = await render(page, 'variant=turntable-y030&seed=1&samples=64');
    const glowing = await render(page, 'variant=emissive&seed=1&samples=64');
    // South face of the post (rotated 22.5 degrees about its pivot (9.5, 0, -2.5)), which sees the brick face.
    const [x, y] = await page.evaluate(() => window.__msFixture!.pt!.project(10.07, 5, -1.11));
    const gain = luminance(pixel(glowing.image, x, y)) - luminance(pixel(plain.image, x, y));
    console.log(`[pt probe] emission: the post gains ${gain.toFixed(1)} levels / min 10`);
    expect(gain, 'post brightened by the bricks').toBeGreaterThanOrEqual(10);
  });
});

/** Probes of the model-view fixture (same camera image positions as `look=model-view`). */
async function modelViewProbes(page: Page, variant: string): Promise<ModelViewProbe[]> {
  await openFixture(page, `/model-view.html?variant=${variant}`);
  return page.evaluate(() => window.__msFixture?.probes ?? []);
}

const PAIR_SAMPLES: Readonly<Record<string, number>> = {
  'alpha-plane': 128,
  'cutout-checker': 128,
  edges: 128,
  'gltf-contact': 128,
  'gltf-nodes-y030': 128,
  'obj-shapes-y030': 128,
};

/** Views whose render has no shadow catcher (their variant turns it off): the preview's radiance is compared without. */
const PAIR_WITHOUT_CATCHER: ReadonlySet<string> = new Set(['gltf-contact']);

test.describe('the render frames and lights like the baked preview', () => {
  for (const [variant, tolerance] of Object.entries(PT_PAIR_TOLERANCE)) {
    test(`${variant}: same silhouettes, radiance within the measured tolerance`, async ({ page }, testInfo) => {
      // Up to 1.3 m on a normal runner, about 2.6 m on a slow VM (run 39624802150).
      test.setTimeout(300_000);
      const samples = PAIR_SAMPLES[variant] ?? 64;
      const preview = (catcher: 0 | 1, query = '') =>
        openFixture(page, `/rt.html?variant=${variant}&bake=64&catcher=${catcher}${query}`);
      const previewPng = encodeFlipped(await preview(PAIR_WITHOUT_CATCHER.has(variant) ? 0 : 1));
      const traced = await render(page, `variant=${variant}&seed=1&samples=${samples}`);
      // Framing compares geometric coverage, so its preview samples pixel centres (msaa=0): 4-sample
      // alpha-to-coverage turns a cut-out texel strip covering 2 % of a pixel into a quarter-covered pixel, a radiance
      // difference the radiance tolerance already measures (obj-shapes-y030, wedge slope, docs/testing.md).
      const framingPreview = decodePng(encodeFlipped(await preview(0, '&msaa=0')));
      const framingTraced = await render(page, `variant=${variant}&seed=1&samples=${samples}&catcher=0`);
      const framing = silhouetteMismatches(
        framingPreview,
        framingTraced.image,
        backdropRowOf(VARIANT_PRESET[variant] ?? 'studio'),
      );
      const radiance = compareImages(traced.png, previewPng, tolerance);
      const line =
        `${variant}: framing ${framing.mismatches} mismatches off ${framing.silhouette} silhouette px; ` +
        `${radiance.diffPixels} px differ, ratio ${radiance.ratio.toFixed(5)} / max ${tolerance.maxDiffRatio}, ` +
        `mean delta ${radiance.meanDelta.toFixed(3)} / max ${tolerance.maxMeanDelta}`;
      console.log(`[pt pair] ${line}`);
      testInfo.annotations.push({ type: 'pt pair', description: line });
      const dir = testInfo.project.outputDir;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `pt-pair-${variant}.json`),
        JSON.stringify({ framing, ratio: radiance.ratio, meanDelta: radiance.meanDelta }),
      );
      expect(framing.mismatches, 'backdrop/model mismatches off silhouettes').toBe(0);
      expect(radiance.pass, line).toBe(true);
    });
  }
});

/**
 * Marketplace's view-relative rim on the held-cube player at 512 px, pitch 20, from the review yaw 210 and the app's
 * default 30, in the baked preview and the render (16 samples). The silhouette is the outline band (a backdrop pixel
 * within 2 px), the interior the rest of the model. A near-white line (every channel above 200) on the outline: at
 * least the measured count / 1.25, preview and render within 25 % of each other. The interior keeps its texels: its
 * near-white pixels at most the measured count x 1.25 (a broad rim washed upward faces white: 4 097 in round 4), its
 * blown-out ones (every channel 250 or more) at most the measured share x 1.25 and never 2 %. The saturated test skin
 * is where a diffuse rim gave no white at all (docs/testing.md, look presets).
 */
const RIM_PROBES: Readonly<Record<number, { outlineFloor: number; interiorWhite: number; blownShare: number }>> = {
  // Measured outline white 575 preview / 548 render, interior white 309 / 394, interior blown out 0 / 0.
  210: { outlineFloor: 438, interiorWhite: 493, blownShare: 0 },
  // Measured outline white 412 / 448, interior white 101 / 113, interior blown out 0 / 0.
  30: { outlineFloor: 330, interiorWhite: 141, blownShare: 0 },
};

test.describe('the Marketplace rim draws a white silhouette line and leaves the faces their texels', () => {
  for (const [yaw, limits] of Object.entries(RIM_PROBES)) {
    test(`yaw ${yaw}: preview and render`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const query = `variant=preset-marketplace&yaw=${yaw}&size=512`;
      const preview = decodePng(encodeFlipped(await openFixture(page, `/rt.html?${query}`)));
      const traced = (await render(page, `${query}&seed=1&samples=16`)).image;
      const measured = [preview, traced].map((image) => {
        const { silhouette, interior } = silhouettePixels(image, { backdropTolerance: 4, reach: 2 });
        return {
          outline: whiteCount(silhouette, 200),
          inside: whiteCount(interior, 200),
          blown: whiteCount(interior, 249) / interior.length,
        };
      });
      const [p, r] = measured as [(typeof measured)[0], (typeof measured)[0]];
      const line =
        `yaw ${yaw}: outline white preview ${p.outline} / render ${r.outline} (floor ${limits.outlineFloor}), ` +
        `interior white ${p.inside} / ${r.inside} (max ${limits.interiorWhite}), ` +
        `interior blown-out share ${p.blown.toFixed(5)} / ${r.blown.toFixed(5)} (max ${limits.blownShare})`;
      console.log(`[pt probe] rim ${line}`);
      testInfo.annotations.push({ type: 'rim probe', description: line });
      for (const { outline, inside, blown } of measured) {
        expect(outline, line).toBeGreaterThanOrEqual(limits.outlineFloor);
        expect(inside, line).toBeLessThanOrEqual(limits.interiorWhite);
        expect(blown, line).toBeLessThanOrEqual(limits.blownShare);
        expect(blown, line).toBeLessThan(0.02);
      }
      expect(Math.abs(p.outline - r.outline) / Math.max(p.outline, r.outline), line).toBeLessThanOrEqual(0.25);
    });
  }
});

/**
 * Edge rounding (MS-15) in the render: the plane, the card and the sphere (their pixels from the preview, where hiding
 * the mesh changes them, less the cube's and the wedge's) stay within the default golden tolerance of the render
 * without rounding (indirect light off rounded neighbours may move a level); the key-facing edge brightens.
 */
test.describe('rounded edges', () => {
  test.describe.configure({ timeout: 180_000 });

  test('planes, cards and smooth areas render as without rounding; a key-facing edge brightens', async ({ page }) => {
    const pixelsOf = async (mesh: string) =>
      differenceMask(
        decodePng(encodeFlipped(await openFixture(page, '/rt.html?variant=edges&edges=0'))),
        decodePng(encodeFlipped(await openFixture(page, `/rt.html?variant=edges&edges=0&hide=${mesh}`))),
      );
    const sharp = [await pixelsOf('cube'), await pixelsOf('wedge')];
    const own = new Uint8Array(256 * 256);
    for (const mesh of ['plane', 'card', 'sphere']) {
      const mask = await pixelsOf(mesh);
      mask.forEach((v, p) => {
        if (v && !sharp.some((other) => other[p])) own[p] = 1;
      });
    }
    const off = await render(page, 'variant=edges&seed=1&samples=128&edges=0');
    const on = await render(page, 'variant=edges&seed=1&samples=128');
    const result = compareImages(maskedPng(on.image, off.image, own), off.png);
    console.log(
      `[pt probe] edges: plane, card and sphere (${own.reduce((s, v) => s + v, 0)} px) with rounding: ` +
        `${result.diffPixels} px differ, mean delta ${result.meanDelta.toFixed(4)}`,
    );
    expect(result.pass, 'plane, card and sphere within the default tolerance').toBe(true);
    const lum = (image: Image, x: number, y: number) => {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += luminance(pixel(image, x + dx, y + dy));
      return sum / 9;
    };
    const [ex, ey] = await page.evaluate(() => window.__msFixture!.pt!.project(-8, 8, 9.75));
    const [cx, cy] = await page.evaluate(() => window.__msFixture!.pt!.project(-8, 8, 6));
    const edge = lum(on.image, ex, ey);
    const centre = lum(on.image, cx, cy);
    console.log(`[pt probe] edges: up face beside the south edge ${edge.toFixed(1)}, centre ${centre.toFixed(1)}`);
    expect(edge).toBeGreaterThan(centre + 1);
    expect(lum(off.image, ex, ey), 'unrounded: as the centre').toBeLessThan(centre + 1);
  });

  test('setEdges: a width restarts, an angle detects again, a bad value names its field', async ({ page }) => {
    const off = await render(page, 'variant=edges&seed=1&samples=4&edges=0');
    const { info, png: initial } = await render(page, 'variant=edges&seed=1&samples=4');
    const set = (edges: { width?: number; sharpAngleDeg?: number }) =>
      page.evaluate((e) => window.__msFixture!.pt!.setEdges(e), edges);
    expect(await set({ width: 0 })).toBe('ok');
    expect((await readPng(page, info)).equals(off.png), 'width 0 renders as edges=0').toBe(true);
    expect(await set({ width: 0.5 })).toBe('ok');
    expect((await readPng(page, info)).equals(initial)).toBe(true);
    expect(await set({ sharpAngleDeg: 100 })).toBe('ok');
    const steep = await readPng(page, info);
    expect(steep.equals(initial)).toBe(false);
    expect(steep.equals(off.png)).toBe(false);
    expect(await set({ sharpAngleDeg: 30 })).toBe('ok');
    expect((await readPng(page, info)).equals(initial)).toBe(true);
    expect(await set({ width: 4.5 })).toMatch(/^RangeError: edges\.width must be a finite number in 0\.\.4/);
    expect(await set({ sharpAngleDeg: 0 })).toMatch(/^RangeError: edges\.sharpAngleDeg/);
    expect((await readPng(page, info)).equals(initial), 'a rejected value changes nothing').toBe(true);
  });

  test('an angle set while setScene decodes applies to the new scene', async ({ page }) => {
    const { info, png: initial } = await render(page, 'variant=edges&seed=1&samples=4');
    expect(await page.evaluate(() => window.__msFixture!.pt!.setSceneDuringEdges({ sharpAngleDeg: 100 }))).toBe(true);
    const during = await readPng(page, info);
    // The reference packs the new scene at 100 degrees by a change of angle after it loaded.
    await page.evaluate(() => window.__msFixture!.pt!.setEdges({ sharpAngleDeg: 30 }));
    await page.evaluate(() => window.__msFixture!.pt!.setEdges({ sharpAngleDeg: 100 }));
    const after = await readPng(page, info);
    expect(during.equals(initial), 'the new scene is not drawn with the old angle').toBe(false);
    expect(during.equals(after), 'the same bytes as packed at 100 degrees after loading').toBe(true);
  });
});

test.describe('look presets', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the backdrop gradient matches its TS mirror in 64-pixel tiles, before and after the first sample', async ({
    page,
  }) => {
    const row = backdropRowOf('marketplace');
    for (const samples of [1, 4]) {
      const { image } = await render(page, `scene=empty&preset=marketplace&seed=1&samples=${samples}&tile=64`);
      let worst = 0;
      for (let y = 0; y < image.height; y++) {
        const expected = row(y, image.height);
        for (const x of [0, 100, image.width - 1]) {
          const seen = pixel(image, x, y);
          worst = Math.max(worst, ...seen.map((v, c) => Math.abs(v - (expected[c] ?? 0))));
        }
      }
      console.log(`[pt probe] marketplace backdrop, ${samples} samples: worst ${worst} levels from the mirror`);
      expect(worst).toBeLessThanOrEqual(2);
      // A gradient: the bottom row is brighter than the top.
      expect(luminance(pixel(image, 0, image.height - 1)) - luminance(pixel(image, 0, 0))).toBeGreaterThan(5);
    }
  });

  test('a look set while setScene decodes applies to the new scene: the bytes of a fresh render', async ({ page }) => {
    const { info, png: studio } = await render(page, 'variant=turntable-y030&seed=1&samples=4');
    expect(await page.evaluate(() => window.__msFixture!.pt!.setSceneDuringLook('marketplace'))).toBe(true);
    const during = await readPng(page, info);
    const fresh = await render(page, 'variant=turntable-y030&preset=marketplace&seed=1&samples=4');
    expect(during.equals(studio)).toBe(false);
    expect(during.equals(fresh.png), 'the same bytes as rendered under Marketplace from the start').toBe(true);
  });

  test('setLook restarts with the look; an invalid look names its field and changes nothing', async ({ page }) => {
    const { info, png: studio } = await render(page, 'variant=turntable-y030&seed=1&samples=4');
    const set = (id: string) => page.evaluate((name) => window.__msFixture!.pt!.setLook(name), id);
    expect(await set('rim')).toBe('ok');
    const rim = await readPng(page, info);
    expect(rim.equals(studio)).toBe(false);
    expect(await set('bad')).toMatch(/^LookPresetError: catcher\.strength/);
    expect((await readPng(page, info)).equals(rim), 'a rejected look changes nothing').toBe(true);
    expect(await set('studio')).toBe('ok');
    expect((await readPng(page, info)).equals(studio), 'back to Studio: the first bytes').toBe(true);
  });

  test('Marketplace renders the same bytes in batches of 7 samples and 64-pixel tiles', async ({ page }) => {
    const reference = await referencePixels(page, MARKETPLACE);
    const { image, info } = await render(page, 'variant=preset-marketplace&seed=1&samples=64&batch=7&tile=64');
    expect(info.samplesDone).toBe(64);
    expect(image.data.equals(reference)).toBe(true);
  });

  /**
   * The rim light is unshadowed in both renderers: every pixel it brightens in the preview (Rim against Rim with the
   * rim light black) it brightens in the render too, which a rim shadowed in the render would not. The render brightens
   * a few more: its jittered camera rays catch more of the grazing fillets (the rim is added at the camera hit only).
   */
  test('the rim light brightens in the render every pixel it brightens in the preview', async ({ page }) => {
    const lit = (on: Image, off: Image): Uint8Array => {
      const mask = new Uint8Array(on.width * on.height);
      for (let p = 0; p < mask.length; p++) {
        const x = p % on.width;
        const y = Math.floor(p / on.width);
        if (luminance(pixel(on, x, y)) - luminance(pixel(off, x, y)) > 12) mask[p] = 1;
      }
      return mask;
    };
    const preview = async (rim: 0 | 1) =>
      decodePng(encodeFlipped(await openFixture(page, `/rt.html?variant=preset-rim&bake=0&rim=${rim}`)));
    const traced = async (rim: 0 | 1) => (await render(page, `variant=preset-rim&seed=1&samples=16&rim=${rim}`)).image;
    const previewMask = lit(await preview(1), await preview(0));
    const tracedMask = lit(await traced(1), await traced(0));
    let both = 0;
    for (let p = 0; p < previewMask.length; p++) if (previewMask[p] && tracedMask[p]) both++;
    const count = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0);
    console.log(
      `[pt probe] rim: preview ${count(previewMask)} px, render ${count(tracedMask)} px brightened, ` +
        `share of the preview's in the render ${(both / Math.max(count(previewMask), 1)).toFixed(4)}`,
    );
    expect(count(previewMask)).toBeGreaterThan(300);
    expect(count(tracedMask)).toBeGreaterThan(300);
    expect(both / count(previewMask)).toBeGreaterThan(0.95);
  });
});

test.describe('limits and hostile input', () => {
  test('an empty scene renders only the backdrop', async ({ page }) => {
    const { image } = await render(page, 'scene=empty&seed=1&samples=4');
    expect(modelBox(image).x0).toBe(Infinity);
  });

  for (const [scene, code] of [
    ['hostile-corrupt', 'TEXTURE_DECODE_FAILED'],
    ['hostile-missing', 'TEXTURE_MISSING'],
    ['hostile-mismatch', 'TEXTURE_SIZE_MISMATCH'],
  ] as const) {
    test(`${scene} renders the placeholder with a ${code} warning`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      const { image } = await render(page, `variant=turntable-y030&scene=${scene}&seed=1&samples=4`);
      expect(await page.evaluate(() => window.__msFixture?.pt?.warnings)).toEqual([{ code, texture: 0 }]);
      expect(modelBox(image).x1 - modelBox(image).x0).toBeGreaterThan(50);
      expect(errors).toEqual([]);
    });
  }

  test('a scene over maxTriangles fails with SCENE_TOO_LARGE', async ({ page }) => {
    await expect(openFixture(page, '/pt.html?variant=turntable-y030&samples=1&maxTriangles=10')).rejects.toThrow(
      /SCENE_TOO_LARGE|visible triangles; the limit is 10/,
    );
  });

  test('10 000 coincident cubes finish a sample: the per-ray node cap bounds the work', async ({ page }) => {
    // 10.0 s on a SwiftShader runner (then the 30 s default timeout).
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const started = Date.now();
    const { image, info } = await render(page, 'scene=coincident-cubes&seed=1&samples=1');
    const elapsed = Date.now() - started;
    console.log(`[pt probe] coincident cubes: 1 sample in ${elapsed} ms (page load included)`);
    expect(info.samplesDone).toBe(1);
    expect(await page.evaluate(() => window.__msFixture?.pt?.triangles)).toBe(120_000);
    expect(await page.evaluate(() => window.__msFixture?.pt?.contextLost)).toBe(false);
    expect(modelBox(image).x1 - modelBox(image).x0, 'the cubes are drawn').toBeGreaterThan(50);
    const capped = await page.evaluate(() => window.__msFixture!.pt!.capped());
    console.log(`[pt probe] coincident cubes: ${capped.traversals} capped traversals in ${capped.pixels} pixels`);
    expect(capped.pixels, 'the camera rays onto the cubes stop at the cap').toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  // Real views, the costliest ones measured: the benchmark scene, the 200 000-triangle grid of the load budget, and a
  // field of 16 384 cut-out plants seen edge-on from the ground (rays cross dozens of plants and holes). The worst
  // needed between 512 and 1024 node visits (counted with lower caps); the cap is 2048.
  for (const [label, query] of [
    ['benchmark scene (24 576 triangles)', 'scene=bench&size=128&samples=16'],
    ['200 000-triangle grid, load-budget view', 'scene=large-order&size=128&samples=4'],
    ['200 000-triangle grid, edge-on', 'scene=large-order&size=256&samples=4&pitch=0&zoom=0.1'],
    ['cut-out plant field, edge-on from the ground', 'scene=grass-field&size=256&samples=16&pitch=0&zoom=0.12'],
    ['cut-out plant field, 2 degrees', 'scene=grass-field&size=256&samples=16&pitch=2&zoom=0.15'],
  ] as const) {
    test(`no traversal reaches the node cap: ${label}`, async ({ page }) => {
      await openFixture(page, `/pt.html?${query}&seed=1`);
      const capped = await page.evaluate(() => window.__msFixture!.pt!.capped());
      console.log(`[pt probe] node cap, ${label}: ${capped.traversals} capped traversals`);
      expect(capped).toEqual({ traversals: 0, pixels: 0 });
    });
  }

  test('seed, sample count and projection out of range throw a RangeError', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&samples=1');
    const results = await page.evaluate(() => {
      const ptc = window.__msFixture!.pt!;
      return [
        ptc.tryStart(-1, 1),
        ptc.tryStart(1.5, 1),
        ptc.tryStart(2 ** 32, 1),
        ptc.tryStart(1, 0),
        ptc.tryStart(1, 65537),
        ptc.tryStart(1, 2.5),
        ptc.tryFov(0),
        ptc.tryFov(180),
        ptc.tryStart(2 ** 32 - 1, 65536),
      ];
    });
    expect(
      results.slice(0, 8).every((r) => r.startsWith('RangeError:')),
      results.join('\n'),
    ).toBe(true);
    expect(results[8]).toBe('ok');
  });
});

test.describe('lifetime', () => {
  // 14.9-18.6 s on a SwiftShader runner (then the 30 s default timeout).
  test.describe.configure({ timeout: 120_000 });
  test('a lost context draws nothing; after the restore the same request renders byte-identically', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const info = await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=64');
    const before = decodePng(await readPng(page, info)).data;
    const steps = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      await ptc.lose();
      if (!ptc.contextLost) throw new Error('context not reported lost');
      const whileLost = ptc.step(8);
      await ptc.restore();
      if (ptc.contextLost) throw new Error('context still reported lost');
      const afterRestore = ptc.samplesDone;
      return { whileLost, afterRestore, rendered: ptc.render() };
    });
    expect(steps).toEqual({ whileLost: 0, afterRestore: 0, rendered: 64 });
    expect(decodePng(await readPng(page, info)).data.equals(before)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('cancel stops at the samples done and keeps them', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=64');
    const result = await page.evaluate(() => window.__msFixture!.pt!.cancelAfter(5));
    expect(result).toEqual({ cancelled: 5, afterStep: 5 });
  });

  test('of two quick setScene calls only the second is applied', async ({ page }) => {
    const reference = await referencePixels(page, TURNTABLE);
    const info = await openFixture(page, '/pt.html?variant=turntable-y030&scene=flat&seed=1&samples=64');
    const applied = await page.evaluate(() => window.__msFixture!.pt!.setScenes(['flat', 'showcase']));
    expect(applied).toEqual([false, true]);
    expect(decodePng(await readPng(page, info)).data.equals(reference)).toBe(true);
  });

  test('a scene that fails a limit keeps the current one and decodes nothing', async ({ page }) => {
    const info = await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=16&track=1');
    const before = decodePng(await readPng(page, info)).data;
    const result = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      const bitmaps = ptc.openBitmaps();
      const code = await ptc.tryHugeMaterials();
      return { code, bitmaps, after: ptc.openBitmaps(), rendered: ptc.render() };
    });
    expect(result).toEqual({ code: 'SCENE_TOO_LARGE', bitmaps: 2, after: 2, rendered: 16 });
    expect(decodePng(await readPng(page, info)).data.equals(before)).toBe(true);
  });

  test('dispose releases every GL object and image, a superseded scene included', async ({ page }) => {
    await openFixture(page, '/pt.html?variant=turntable-y030&seed=1&samples=2&track=1');
    const counts = await page.evaluate(async () => {
      const ptc = window.__msFixture!.pt!;
      const loaded = { gl: ptc.liveGlObjects(), bitmaps: ptc.openBitmaps() };
      await ptc.setScenes(['showcase', 'flat', 'showcase']);
      ptc.dispose();
      return { loaded, gl: ptc.liveGlObjects(), bitmaps: ptc.openBitmaps(), step: ptc.step(1) };
    });
    expect(counts.loaded.gl).toBeGreaterThan(0);
    expect(counts.loaded.bitmaps).toBe(2);
    expect({ gl: counts.gl, bitmaps: counts.bitmaps, step: counts.step }).toEqual({ gl: 0, bitmaps: 0, step: 0 });
  });
});

/** MS-40: setScene builds the geometry in a worker; the main thread builds the same bytes when it cannot or may not. */
test.describe('geometry worker', () => {
  // Two loads of the 200 000-triangle document and four short renders on SwiftShader.
  test.describe.configure({ timeout: 180_000 });
  test('the worker builds the bytes the main thread builds: the edges view and 200 000 triangles', async ({ page }) => {
    const run = async (query: string, large: boolean) => {
      await openFixture(page, `/pt.html?${query}`);
      return page.evaluate(async (setLarge) => {
        const ptc = window.__msFixture!.pt!;
        if (setLarge) {
          ptc.prepareLarge();
          if (!(await ptc.setLarge()).applied) throw new Error('the large document was not applied');
          ptc.render();
        }
        return { inWorker: ptc.geometryInWorker, sums: ptc.accumulationBase64() };
      }, large);
    };
    for (const [query, large] of [
      ['variant=edges&seed=1&samples=16', false],
      ['scene=empty&size=64&seed=1&samples=4', true],
    ] as const) {
      const worker = await run(query, large);
      const inline = await run(`${query}&geometryWorker=0`, large);
      expect([worker.inWorker, inline.inWorker], query).toEqual([true, false]);
      expect(worker.sums, query).not.toBeNull();
      // Byte for byte: the accumulated float sums, not the 8-bit image.
      expect(worker.sums === inline.sums, query).toBe(true);
    }
  });

  test('with workers blocked the scene builds on the main thread and matches its golden', async ({
    page,
  }, testInfo) => {
    // A host whose policy forbids workers: the constructor throws.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'Worker', {
        value: function Blocked() {
          throw new Error('workers are blocked here');
        },
      });
    });
    await expectGolden(page, testInfo, TURNTABLE);
    expect(await page.evaluate(() => window.__msFixture?.pt?.geometryInWorker)).toBe(false);
  });
});

/**
 * MS-50: a board inside an inverted-hull outline (a Blockbench cube with from > to on every axis, its texture `auto`
 * sided): the board keeps its brightness and the hull shows only as a dark rim; paired with rt-outline-hull.
 */
test.describe('outline hull', () => {
  test.describe.configure({ timeout: 120_000 });
  const golden = pt('outline-hull', 'outline-hull', 64);

  test(`${golden.name} matches its golden`, async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, golden);
    expect(await page.evaluate(() => window.__msFixture?.pt?.capped())).toEqual({ traversals: 0, pixels: 0 });
  });

  test('the board keeps its brightness inside the hull, a dark rim shows around it', async ({ page }) => {
    const withHull = await render(page, 'variant=outline-hull&seed=1&samples=64');
    const alone = await render(page, 'variant=outline-hull&scene=outline-hull-board&seed=1&samples=64');
    const probe = outlineHullProbe(withHull.image, alone.image);
    console.log(`[pt probe] outline hull: ${JSON.stringify(probe)}`);
    expect(Math.abs(probe.boardWithHull - probe.boardAlone)).toBeLessThanOrEqual(OUTLINE_HULL_BOARD_LEVELS);
    expect(probe.rimPixels).toBeGreaterThan(200);
  });
});
