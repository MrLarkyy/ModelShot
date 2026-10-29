import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the plain modules directly.
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { backdropColor } from '../../../packages/looks/src/backdropColor';
import { filterQuad, filterQuadPoint, type FilterQuadName } from '../fixtures/src/textureFilterLayout';
import { compareImages, type CompareOptions } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, type FixtureInfo } from '../src/expectGolden';
import type { GoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import {
  decodePng,
  hueMatch,
  luminance,
  near,
  pixel,
  sentinelPixels,
  silhouetteMismatches,
  type Image,
} from '../src/imageMetrics';
import { lookPresetFile } from '../src/lookPresetFile';

/**
 * MS-38: a glTF texture whose sampler asks LINEAR is filtered linearly, the same in the preview and the render: its
 * colour is the bilinear blend of the four texels around the point, each addressed as a nearest lookup is (face range,
 * wrap), and its coverage that of the nearest texel. The same image under a NEAREST sampler stays pixel art. A cut-out
 * texel adds no dark fringe to the blend; a repeated texture blends across its wrap seam; a sentinel image lies right
 * of each linear texture in the path tracer's texture layers. `-far` shows the minified quad at about 3 texels per
 * pixel (realtime: the mean of the blend at the rotated grid).
 */
const RT_FILTER: GoldenSpec = { kind: 'raster', fixture: 'rt', name: 'rt-texture-filter', variant: 'texture-filter' };
const RT_FILTER_FAR: GoldenSpec = {
  kind: 'raster',
  fixture: 'rt',
  name: 'rt-texture-filter-far',
  variant: 'texture-filter-far',
};
const PT_FILTER: GoldenSpec = {
  kind: 'pathtraced',
  fixture: 'pt',
  name: 'pt-texture-filter',
  variant: 'texture-filter',
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
 * 0.00011 / 0.396, x 1.25 (MS-38). Kept here, not in that table, whose every entry pathtracer.spec.ts pairs.
 */
const PAIR_TOLERANCE: CompareOptions = { threshold: 0.1, maxDiffRatio: 0.00014, maxMeanDelta: 0.495 };

/** A texel coordinate (u, v) of the image on a quad, v down the image. */
type At = readonly [number, number];

/** The same texel colour under the quads' lighting: hue within 0.995 and luminance within 8 levels. */
const same = (a: readonly number[], b: readonly number[]): boolean =>
  hueMatch(a, b) >= 0.995 && Math.abs(luminance(a) - luminance(b)) <= 8;

/**
 * `at` lies strictly between texel colours `a` and `b`: in every channel where they differ by more than 40 levels, at
 * least a tenth of the way from each (a quarter-texel blend in linear light is 18 % or more of the way in display
 * levels), so neither texel alone (nearest) nor a seam stepped to one side passes.
 */
function between(at: readonly number[], a: readonly number[], b: readonly number[]): boolean {
  return [0, 1, 2].every((k) => {
    const [lo, hi] = [Math.min(a[k] ?? 0, b[k] ?? 0), Math.max(a[k] ?? 0, b[k] ?? 0)];
    const d = hi - lo;
    return d <= 40 || ((at[k] ?? 0) >= lo + 0.1 * d && (at[k] ?? 0) <= hi - 0.1 * d);
  });
}

/** A display level (0..255, sRGB) in linear light. */
const linearLight = (level: number): number => {
  const c = level / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * How far `at` lies from texel colour `from` toward `to` in linear light (0 at `from`, 1 at `to`), along the channel
 * they differ in most: the weight of `to` in a linear blend.
 */
function weightToward(at: readonly number[], from: readonly number[], to: readonly number[]): number {
  const k = [0, 1, 2].reduce((best, c) =>
    Math.abs((to[c] ?? 0) - (from[c] ?? 0)) > Math.abs((to[best] ?? 0) - (from[best] ?? 0)) ? c : best,
  );
  const [a, f, t] = [at[k] ?? 0, from[k] ?? 0, to[k] ?? 0].map(linearLight) as [number, number, number];
  return (a - f) / (t - f);
}

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

const text = (c: readonly number[]) => c.map(Math.round).join(',');

/**
 * Every probe of the near view the page shows (about 7 pixels per texel), each logged under `[filter probe]`. A probe
 * reads the one pixel at its point: a mean over neighbours would flatten the linear blend's peak at a texel centre.
 */
async function checkProbes(page: Page, label: string): Promise<void> {
  const image = await currentImage(page);
  const pixelAt = async (point: readonly [number, number, number]) => {
    const [x, y] = await project(page, point);
    return pixel(image, x, y);
  };
  const colourAt = (quad: FilterQuadName, [u, v]: At) => pixelAt(filterQuadPoint(filterQuad(quad), u, v));
  const failures: string[] = [];
  const check = (ok: boolean, line: string) => {
    console.log(`[filter probe] ${label} ${ok ? 'ok' : 'FAIL'} ${line}`);
    if (!ok) failures.push(line);
  };

  // Checker texel (3, 3) is yellow, (4, 3) teal (the nearest quad's centres: the plain texel colours under the same
  // light). At a texel centre the linear quad shows mostly that texel: its pixel lies up to 0.07 texel off the centre
  // in each axis, so the neighbours weigh up to 0.14 together (measured up to 0.147 in the render, which averages the
  // pixel), where taps shifted by half a texel would weigh 0.5. A
  // quarter texel off the centre the nearest quad still shows the texel alone, the linear one a blend of the two.
  const [yellow, teal, nearYellow, nearTeal] = await Promise.all([
    colourAt('linear', [3.5, 3.5]),
    colourAt('linear', [4.5, 3.5]),
    colourAt('nearest', [3.5, 3.5]),
    colourAt('nearest', [4.5, 3.5]),
  ]);
  for (const [centre, own, other, at] of [
    [yellow, nearYellow, nearTeal, '3.5'],
    [teal, nearTeal, nearYellow, '4.5'],
  ] as const) {
    const weight = weightToward(centre, own, other);
    check(weight <= 0.25, `linear centre (${at}, 3.5) ${text(centre)}: weight ${weight.toFixed(3)} off ${text(own)}`);
  }
  for (const at of [
    [4, 3.5],
    [3.75, 3.5],
    [4.25, 3.5],
  ] as const) {
    const linear = await colourAt('linear', at);
    check(between(linear, nearYellow, nearTeal), `linear (${at.join(', ')}) ${text(linear)} between`);
  }
  for (const [at, like] of [
    [[3.75, 3.5], nearYellow],
    [[4.25, 3.5], nearTeal],
  ] as const) {
    const nearest = await colourAt('nearest', at);
    check(same(nearest, like), `nearest (${at.join(', ')}) ${text(nearest)} = its texel ${text(like)}`);
  }

  // The linear quad is two by two cells of two triangles (texel borders at 4, diagonals u = v and u + v = 4 or 8): a tap
  // is limited by the image, not by a triangle's UV rectangle, so the blend stays the bilinear one on either side of
  // every shared edge. Teal's weight at (u, v) over the checker's four texels, as hardware filtering gives it (0.375 or
  // 0.625 at these points); the tone mapping bends the measured one by up to 0.2, a tap clamped to a face rectangle
  // moves it by 0.375 or more. The rows and columns through the texel centres (u or v 3.5, 4.5) are checked above.
  const tealWeight = (u: number, v: number): number => {
    const [fx, fy] = [(u - 0.5) % 1, (v - 0.5) % 1];
    const [bx, by] = [Math.floor(u - 0.5), Math.floor(v - 0.5)];
    let weight = 0;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      if ((bx + dx + by + dy) % 2 !== 0) weight += (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    }
    return weight;
  };
  const offsets = [1.75, 2.25, 3.75, 4.25, 5.75, 6.25];
  for (const v of offsets) {
    for (const u of offsets) {
      const at = await colourAt('linear', [u, v]);
      const weight = weightToward(at, nearYellow, nearTeal);
      const expected = tealWeight(u, v);
      check(
        Math.abs(weight - expected) <= 0.28,
        `linear (${u}, ${v}) ${text(at)}: teal weight ${weight.toFixed(3)} vs bilinear ${expected.toFixed(3)}`,
      );
    }
  }

  // The cut-out block (texels 3..4): its centre shows the backdrop of that row, right of the quad. Opaque texels beside
  // it, 0.3 texel (2 pixels) off its edge where a cut texel would weigh 20 % in the blend, but clear of the one-pixel
  // anti-aliased alpha seam, are no darker than the same colour further away: the cut texels' black adds no fringe.
  const cutout = filterQuad('cutout');
  const [, holeY, holeZ] = filterQuadPoint(cutout, 4, 4);
  const [hole, row] = await Promise.all([colourAt('cutout', [4, 4]), pixelAt([cutout.x[1] + 2, holeY, holeZ])]);
  check(near(hole, row, 10), `cutout hole ${text(hole)} = backdrop ${text(row)}`);
  for (const [edge, away] of [
    [
      [2.7, 4],
      [1.5, 4],
    ],
    [
      [5.3, 4],
      [6.5, 4],
    ],
    [
      [4, 2.7],
      [4, 1.5],
    ],
    [
      [4, 5.3],
      [4, 6.5],
    ],
  ] as const) {
    const [e, a] = await Promise.all([colourAt('cutout', edge), colourAt('cutout', away)]);
    check(
      luminance(e) >= luminance(a) - 3,
      `cutout (${edge.join(', ')}) ${text(e)} not darker than (${away.join(', ')}) ${text(a)}`,
    );
  }

  // Repeat: column 0 white, column 7 orange; u 8.5 repeats column 0, u -0.5 column 7, and u 8 blends across the seam.
  const [white, orange] = await Promise.all([colourAt('repeat', [0.5, 4]), colourAt('repeat', [7.5, 4])]);
  const [past, before, seam] = await Promise.all([
    colourAt('repeat', [8.5, 4]),
    colourAt('repeat', [-0.5, 4]),
    colourAt('repeat', [8, 4]),
  ]);
  check(same(past, white) && !same(past, orange), `repeat u 8.5 ${text(past)} = column 0 ${text(white)}`);
  check(same(before, orange) && !same(before, white), `repeat u -0.5 ${text(before)} = column 7 ${text(orange)}`);
  check(between(seam, orange, white), `repeat u 8 ${text(seam)} between ${text(orange)} and ${text(white)}`);

  expect(failures, `${label}: probes`).toEqual([]);
  const sentinel = sentinelPixels(image);
  console.log(`[filter probe] ${label}: ${sentinel} sentinel pixels`);
  expect(sentinel, `${label}: pixels of the sentinel image`).toBe(0);
}

/**
 * The far view: no sentinel pixel, and the minified checker (3 texels per pixel) averaged: its interior pixels stay
 * within MINIFIED_SPREAD levels of their mean in every channel (nearest texels would alias into yellow and teal).
 */
// Measured 4.2, x 1.25.
const MINIFIED_SPREAD = 5.3;

async function checkFar(page: Page): Promise<void> {
  const image = await currentImage(page);
  const quad = filterQuad('minified');
  const [u0, v0, u1, v1] = quad.uv;
  const corners = await Promise.all(
    [
      [u0 + (u1 - u0) * 0.2, v0 + (v1 - v0) * 0.2],
      [u0 + (u1 - u0) * 0.8, v0 + (v1 - v0) * 0.8],
    ].map(([u, v]) => project(page, filterQuadPoint(quad, u ?? 0, v ?? 0))),
  );
  const [[xa, ya], [xb, yb]] = corners as [[number, number], [number, number]];
  const pixels: number[][] = [];
  for (let y = Math.ceil(Math.min(ya, yb)); y <= Math.floor(Math.max(ya, yb)); y++) {
    for (let x = Math.ceil(Math.min(xa, xb)); x <= Math.floor(Math.max(xa, xb)); x++) {
      const i = (y * image.width + x) * 4;
      pixels.push([image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0]);
    }
  }
  const mean = [0, 1, 2].map((k) => pixels.reduce((sum, p) => sum + (p[k] ?? 0), 0) / pixels.length);
  const spread = Math.max(...pixels.flatMap((p) => p.map((v, k) => Math.abs(v - (mean[k] ?? 0)))));
  console.log(`[filter probe] far: minified ${pixels.length} px, mean ${text(mean)}, spread ${spread.toFixed(1)}`);
  expect(pixels.length, 'far: minified quad pixels').toBeGreaterThan(100);
  expect(spread, 'far: minified quad spread').toBeLessThanOrEqual(MINIFIED_SPREAD);
  const sentinel = sentinelPixels(image);
  console.log(`[filter probe] far: ${sentinel} sentinel pixels`);
  expect(sentinel, 'far: pixels of the sentinel image').toBe(0);
}

test.describe('texture filter: linear glTF textures blend their texels, nearest ones stay pixel art', () => {
  test('preview golden and probes', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, RT_FILTER);
    await checkProbes(page, 'rt');
  });

  test('preview minified: golden and probes', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, RT_FILTER_FAR);
    await checkFar(page);
  });

  test('render golden and probes', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await expectGolden(page, testInfo, PT_FILTER);
    await checkProbes(page, 'pt');
  });

  test('the render frames and lights like the baked preview', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const look = lookPresetFile('studio');
    const backdropRow = (y: number, height: number) =>
      agxToneMap(backdropColor(look, (height - y - 0.5) / height), look.toneMapping).map((v) => v * 255);
    const preview = (query: string): Promise<FixtureInfo> =>
      openFixture(page, `/rt.html?variant=texture-filter${query}`);
    const traced = (query: string): Promise<FixtureInfo> =>
      openFixture(page, `/pt.html?variant=texture-filter&seed=1&samples=64${query}`);
    const previewPng = encodeFlipped(await preview('&bake=64'));
    const tracedPng = encodeFlipped(await traced(''));
    const framing = silhouetteMismatches(
      decodePng(encodeFlipped(await preview('&bake=64&catcher=0&msaa=0'))),
      decodePng(encodeFlipped(await traced('&catcher=0'))),
      backdropRow,
    );
    const radiance = compareImages(tracedPng, previewPng, PAIR_TOLERANCE);
    const line =
      `texture-filter: framing ${framing.mismatches} mismatches off ${framing.silhouette} silhouette px; ` +
      `${radiance.diffPixels} px differ, ratio ${radiance.ratio.toFixed(5)} / max ${PAIR_TOLERANCE.maxDiffRatio}, ` +
      `mean delta ${radiance.meanDelta.toFixed(3)} / max ${PAIR_TOLERANCE.maxMeanDelta}`;
    console.log(`[pt pair] ${line}`);
    const dir = testInfo.project.outputDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'pt-pair-texture-filter.json'),
      JSON.stringify({ framing, ratio: radiance.ratio, meanDelta: radiance.meanDelta }),
    );
    expect(framing.mismatches, 'backdrop/model mismatches off silhouettes').toBe(0);
    expect(radiance.pass, line).toBe(true);
  });
});
