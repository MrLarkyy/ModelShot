import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the plain modules directly.
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { backdropColor } from '../../../packages/looks/src/backdropColor';
import { WRAP_CUBES, wrapFacePoint, type WrapCube } from '../fixtures/src/textureWrapLayout';
import { compareImages, type CompareOptions } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, type FixtureInfo } from '../src/expectGolden';
import type { GoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import { decodePng, hueMatch, luminance, sentinelPixels, silhouetteMismatches, type Image } from '../src/imageMetrics';
import { lookPresetFile } from '../src/lookPresetFile';

/**
 * MS-52: a face whose UVs pass its texture (u -4 .. 20 of 16 texels) reads the edge texel (clamp: the Hytale and the
 * free default) or the texture repeated (a stored wrap_mode repeat), the same in the preview and the render, and never
 * a texel of another image: a sentinel image lies right of each wrap texture in the path tracer's texture layers.
 */
const RT_WRAP: GoldenSpec = { kind: 'raster', fixture: 'rt', name: 'rt-texture-wrap', variant: 'texture-wrap' };
// The exact depth key's mesh pass carries the most varyings (the flags are one of them); single-sampled frames.
const RT_WRAP_INSIDE: GoldenSpec = {
  kind: 'raster',
  fixture: 'rt',
  name: 'rt-texture-wrap-inside',
  variant: 'texture-wrap-inside',
};
const PT_WRAP: GoldenSpec = {
  kind: 'pathtraced',
  fixture: 'pt',
  name: 'pt-texture-wrap',
  variant: 'texture-wrap',
  seed: 1,
  samples: 64,
  tolerance: {
    threshold: 0,
    reason:
      'threshold 0 only (default ratio and mean): a converged image tells seed and sample count apart by single levels',
  },
};

/**
 * Preview (baked, 64 samples) vs render (seed 1, 64 samples), as the pair table of src/ptPairTolerance.ts: measured
 * 0.00192 / 0.689, x 1.25 (MS-52). Kept here, not in that table, whose every entry pathtracer.spec.ts pairs.
 */
const PAIR_TOLERANCE: CompareOptions = { threshold: 0.1, maxDiffRatio: 0.0024, maxMeanDelta: 0.861 };

/** u of a probe and u of the texel inside the image it must show, on one box's south face. */
interface WrapProbe {
  readonly cube: WrapCube['name'];
  readonly u: number;
  readonly like: number;
  /** A texel inside the image the probe must not look like (what the other wrap mode would show). */
  readonly unlike: number;
}

const PROBES: readonly WrapProbe[] = [
  ...(['hytale-clamp', 'free-clamp'] as const).flatMap((cube) => [
    // Past the right edge: column 15 (orange), not column 0 (teal, repeat).
    { cube, u: 18.5, like: 15.5, unlike: 0.5 },
    { cube, u: 16.5, like: 15.5, unlike: 0.5 },
    // Past the left edge: column 0, not column 12 (white, repeat).
    { cube, u: -3.5, like: 0.5, unlike: 12.5 },
    { cube, u: -0.5, like: 0.5, unlike: 15.5 },
  ]),
  // Repeated: u 16.5 is column 0, u -3.5 column 12, u -0.5 column 15, never the edge the clamp would show.
  { cube: 'free-repeat', u: 16.5, like: 0.5, unlike: 15.5 },
  { cube: 'free-repeat', u: -3.5, like: 12.5, unlike: 0.5 },
  { cube: 'free-repeat', u: -0.5, like: 15.5, unlike: 0.5 },
];

/** Mean colour of the 3 x 3 pixels around (x, y): a texel is about 8 pixels wide, the seams 1 pixel. */
function meanAround(image: Image, x: number, y: number): [number, number, number] {
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const i = ((Math.round(y) + dy) * image.width + Math.round(x) + dx) * 4;
      for (let k = 0; k < 3; k++) sum[k] = (sum[k] ?? 0) + (image.data[i + k] ?? 0);
    }
  }
  return [(sum[0] ?? 0) / 9, (sum[1] ?? 0) / 9, (sum[2] ?? 0) / 9];
}

/** The same texel colour under the face's lighting: hue within 0.995 and luminance within 8 levels. */
const same = (a: readonly number[], b: readonly number[]): boolean =>
  hueMatch(a, b) >= 0.995 && Math.abs(luminance(a) - luminance(b)) <= 8;

async function currentImage(page: Page): Promise<Image> {
  const now = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    return { rgba: fixture.readRGBA(), width: fixture.width, height: fixture.height };
  });
  return decodePng(encodeFlipped({ ...now, renderer: '', floatRenderTargets: false, samplesDone: 0 }));
}

async function project(page: Page, point: readonly [number, number, number]): Promise<[number, number]> {
  return page.evaluate(([x, y, z]) => {
    const fixture = window.__msFixture;
    const projector = fixture?.rt ?? fixture?.pt;
    if (!projector) throw new Error('fixture controls missing');
    return projector.project(x, y, z);
  }, point);
}

/** Every probe of the image the page shows, each logged under `[wrap probe]`. */
async function checkProbes(page: Page, label: string): Promise<void> {
  const image = await currentImage(page);
  const colourAt = async (cube: WrapCube, u: number) => {
    const [x, y] = await project(page, wrapFacePoint(cube, u));
    return meanAround(image, x, y);
  };
  const failures: string[] = [];
  for (const probe of PROBES) {
    const cube = WRAP_CUBES.find((c) => c.name === probe.cube);
    if (!cube) throw new Error(`no cube ${probe.cube}`);
    const [at, like, unlike] = await Promise.all([
      colourAt(cube, probe.u),
      colourAt(cube, probe.like),
      colourAt(cube, probe.unlike),
    ]);
    const line =
      `${label} ${probe.cube} u ${probe.u}: ${at.map(Math.round).join(',')} like u ${probe.like} ` +
      `${like.map(Math.round).join(',')} (hue ${hueMatch(at, like).toFixed(4)}), unlike u ${probe.unlike} ` +
      `${unlike.map(Math.round).join(',')} (hue ${hueMatch(at, unlike).toFixed(4)})`;
    console.log(`[wrap probe] ${line}`);
    if (!same(at, like) || same(at, unlike)) failures.push(line);
  }
  // The texels the probes compare are the columns they are meant to be: no box shows its image mirrored.
  const free = WRAP_CUBES[1];
  if (!free) throw new Error('no free-clamp cube');
  const [first, last] = await Promise.all([colourAt(free, 0.5), colourAt(free, 15.5)]);
  expect(Math.min(first[1], first[2]), `${label}: column 0 is teal`).toBeGreaterThan(first[0] + 40);
  expect(last[0], `${label}: column 15 is orange`).toBeGreaterThan(Math.max(last[1], last[2]));
  expect(failures, `${label}: probes off their texel`).toEqual([]);
  const sentinel = sentinelPixels(image);
  console.log(`[wrap probe] ${label}: ${sentinel} sentinel pixels`);
  expect(sentinel, `${label}: pixels of the sentinel image`).toBe(0);
}

test.describe('texture wrap: faces past their texture clamp or repeat', () => {
  test('preview golden and probes', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, RT_WRAP);
    await checkProbes(page, 'rt');
  });

  test('preview under the exact depth key: golden and probes', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, RT_WRAP_INSIDE);
    expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('exact');
    await checkProbes(page, 'rt-inside');
  });

  test('render golden and probes', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await expectGolden(page, testInfo, PT_WRAP);
    await checkProbes(page, 'pt');
  });

  test('the render frames and lights like the baked preview', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const look = lookPresetFile('studio');
    const backdropRow = (y: number, height: number) =>
      agxToneMap(backdropColor(look, (height - y - 0.5) / height), look.toneMapping).map((v) => v * 255);
    const preview = (query: string): Promise<FixtureInfo> => openFixture(page, `/rt.html?variant=texture-wrap${query}`);
    const traced = (query: string): Promise<FixtureInfo> =>
      openFixture(page, `/pt.html?variant=texture-wrap&seed=1&samples=64${query}`);
    const previewPng = encodeFlipped(await preview('&bake=64'));
    const tracedPng = encodeFlipped(await traced(''));
    const framing = silhouetteMismatches(
      decodePng(encodeFlipped(await preview('&bake=64&catcher=0&msaa=0'))),
      decodePng(encodeFlipped(await traced('&catcher=0'))),
      backdropRow,
    );
    const radiance = compareImages(tracedPng, previewPng, PAIR_TOLERANCE);
    const line =
      `texture-wrap: framing ${framing.mismatches} mismatches off ${framing.silhouette} silhouette px; ` +
      `${radiance.diffPixels} px differ, ratio ${radiance.ratio.toFixed(5)} / max ${PAIR_TOLERANCE.maxDiffRatio}, ` +
      `mean delta ${radiance.meanDelta.toFixed(3)} / max ${PAIR_TOLERANCE.maxMeanDelta}`;
    console.log(`[pt pair] ${line}`);
    const dir = testInfo.project.outputDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'pt-pair-texture-wrap.json'),
      JSON.stringify({ framing, ratio: radiance.ratio, meanDelta: radiance.meanDelta }),
    );
    expect(framing.mismatches, 'backdrop/model mismatches off silhouettes').toBe(0);
    expect(radiance.pass, line).toBe(true);
  });
});
