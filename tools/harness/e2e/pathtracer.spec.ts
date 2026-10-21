import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the two plain modules directly.
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { LIGHT_RIG_V0, unoccludedRadiance } from '../../../packages/looks/src/lightRig';
import type { ModelViewProbe, PtProbe } from '../fixtures/src/fixtureApi';
import { compareImages, type CompareOptions } from '../src/compareImages';
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
  type Image,
} from '../src/imageMetrics';
import { shadowStep } from '../src/shadowStep';
import { differenceMask, maskedPng } from '../src/edgeProbes';

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
];

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
  // 10.5-22.4 s on a SwiftShader runner (default timeout 30 s).
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
  // 11.5-35.0 s on a SwiftShader runner (default timeout 30 s).
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
        await expect(
          expectGolden(page, testInfo, spec, { compareAgainst: TURNTABLE, allowUpdate: false }),
        ).rejects.toThrow(/pixels differ/);
      });
    }
  });
});

test.describe('transparency, shadows and sides (scene format rules)', () => {
  // 11.2-22.5 s on a SwiftShader runner (default timeout 30 s).
  test.describe.configure({ timeout: 120_000 });
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

/**
 * Preview vs render of the same view, the preview baked (64 samples, seed 1): `maxDiffRatio` and `maxMeanDelta` are
 * measured values x 1.25 (docs/testing.md, path-tracer pair table), never widened later. The render adds
 * interreflection and noise; the bake adds the occlusion and soft shadows the unbaked preview lacked, so the limits
 * fell when it came (MS-16). Framing is compared without the shadow catcher on both sides (the catcher's edge fades
 * into the backdrop and would count as model), radiance with it on both.
 */
const PT_PAIR_TOLERANCE: Readonly<Record<string, CompareOptions>> = {
  'turntable-y030': { threshold: 0.1, maxDiffRatio: 0.00353, maxMeanDelta: 0.953 },
  iso: { threshold: 0.1, maxDiffRatio: 0.00639, maxMeanDelta: 1.18 },
  // Mean delta: measured 2.189 x 1.25 = 2.74 is above the unbaked limit, which therefore stays.
  'alpha-plane': { threshold: 0.1, maxDiffRatio: 0.0398, maxMeanDelta: 2.48 },
  'player-hold-34': { threshold: 0.1, maxDiffRatio: 0.0232, maxMeanDelta: 1.62 },
  'cutout-checker': { threshold: 0.1, maxDiffRatio: 0.00525, maxMeanDelta: 0.908 },
  edges: { threshold: 0.1, maxDiffRatio: 0.00082, maxMeanDelta: 0.496 },
};

const PAIR_SAMPLES: Readonly<Record<string, number>> = { 'alpha-plane': 128, 'cutout-checker': 128, edges: 128 };

test.describe('the render frames and lights like the baked preview', () => {
  for (const [variant, tolerance] of Object.entries(PT_PAIR_TOLERANCE)) {
    test(`${variant}: same silhouettes, radiance within the measured tolerance`, async ({ page }, testInfo) => {
      // Up to 1.3 m on a normal runner, about 2.6 m on a slow VM (run 39624802150).
      test.setTimeout(300_000);
      const samples = PAIR_SAMPLES[variant] ?? 64;
      const preview = (catcher: 0 | 1) => openFixture(page, `/rt.html?variant=${variant}&bake=64&catcher=${catcher}`);
      const previewPng = encodeFlipped(await preview(1));
      const traced = await render(page, `variant=${variant}&seed=1&samples=${samples}`);
      const framingPreview = decodePng(encodeFlipped(await preview(0)));
      const framingTraced = await render(page, `variant=${variant}&seed=1&samples=${samples}&catcher=0`);
      const framing = silhouetteMismatches(framingPreview, framingTraced.image);
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
    // 10.0 s on a SwiftShader runner (default timeout 30 s).
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
  // 14.9-18.6 s on a SwiftShader runner (default timeout 30 s).
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
