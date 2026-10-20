import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages, type CompareOptions } from '../src/compareImages';
import { expectGolden, openFixture, renderFixture } from '../src/expectGolden';
import type { RasterGoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import type { ModelViewProbe } from '../fixtures/src/fixtureApi';

const variant = (name: string): RasterGoldenSpec => ({ kind: 'raster', fixture: 'model-view', name, variant: name });
const alphaRaster = variant('alpha-plane-raster');
const alphaRaycast = variant('alpha-plane-raycast');
const meshRaster = variant('mesh-shapes-raster');
const meshRaycast = variant('mesh-shapes-raycast');
const orderRaster = variant('render-order-raster');
const orderRaycast = variant('render-order-raycast');
const playerRaster = variant('player-raster');
const playerRaycast = variant('player-raycast');

/**
 * Raster (shadow map, rasterised edges, interpolated UVs) and raycast (exact rays) renders of the same model differ
 * where a pixel centre sits within a rounding error of a silhouette, a texel boundary or a shadow edge. Each limit is the measured
 * difference on SwiftShader (docs/testing.md) with headroom for that count only. Never widened to make a pair pass: a
 * real difference (a cutout texel shown or casting a shadow in one path only, a lost tie) changes hundreds of pixels.
 */
const MODEL_VIEW_PAIR_TOLERANCE: Readonly<Record<string, CompareOptions & { reason: string }>> = {
  // Measured 115 of 65 536 pixels (ratio 0.00175), mean delta 0.119.
  'alpha-plane': {
    threshold: 0.1,
    maxDiffRatio: 0.0025,
    maxMeanDelta: 0.25,
    reason: 'edge pixels only (shadow-map texels, rasterisation rules)',
  },
  // Measured 50 pixels (ratio 0.00076), mean delta 0.046 (receiver normal offset, round 3).
  'mesh-shapes': {
    threshold: 0.1,
    maxDiffRatio: 0.001,
    maxMeanDelta: 0.07,
    reason: 'edge pixels only (shadow-map texels, rasterisation rules)',
  },
  // Measured 40 pixels (ratio 0.00061), mean delta 0.040 (with the facing gap pairs, round 3).
  'render-order': {
    threshold: 0.1,
    maxDiffRatio: 0.0008,
    maxMeanDelta: 0.06,
    reason: 'edge pixels only (shadow-map texels, rasterisation rules)',
  },
  // Measured 111 pixels (ratio 0.00169), mean delta 0.063. About 80 are 1-px strips just inside the outer layer's holes
  // (arms, legs), where the raycast draws the opaque ring's contact shadow on the base layer 0.15 units behind and the
  // shadow map (0.0625-unit texels, 0.094 receiver offset) cannot resolve it; the rest are edge pixels.
  player: {
    threshold: 0.1,
    maxDiffRatio: 0.0025,
    maxMeanDelta: 0.095,
    reason: 'contact-shadow strips inside outer-layer holes (shadow-map resolution) and edge pixels',
  },
};

const PAIRS: readonly [string, RasterGoldenSpec, RasterGoldenSpec][] = [
  ['alpha-plane', alphaRaster, alphaRaycast],
  ['mesh-shapes', meshRaster, meshRaycast],
  ['render-order', orderRaster, orderRaycast],
  ['player', playerRaster, playerRaycast],
];

async function render(
  page: Page,
  spec: RasterGoldenSpec,
): Promise<{ png: PNG; buffer: Buffer; probes: ModelViewProbe[] }> {
  const { png } = await renderFixture(page, spec);
  const probes = await page.evaluate(() => window.__msFixture?.probes ?? []);
  const body = JSON.stringify(probes);
  await test.info().attach(`${spec.name}-probes`, { body, contentType: 'application/json' });
  writeFileSync(join(test.info().project.outputDir, `${spec.name}-probes.json`), body);
  return { png: PNG.sync.read(png), buffer: png, probes };
}

function pixel(png: PNG, probe: ModelViewProbe | undefined): [number, number, number] {
  if (!probe) throw new Error('probe missing');
  expect(probe.x >= 0 && probe.x < png.width && probe.y >= 0 && probe.y < png.height, probe.name).toBe(true);
  const i = (probe.y * png.width + probe.x) * 4;
  return [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
}

const luminance = ([r, g, b]: readonly number[]): number => 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

/** Cosine between two RGB colours: lighting scales a texel's colour, so its direction stays. */
function hueMatch(a: readonly number[], b: readonly number[]): number {
  const dot = [0, 1, 2].reduce((s, k) => s + (a[k] ?? 0) * (b[k] ?? 0), 0);
  return dot / (Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) * Math.hypot(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0));
}

test.describe('model-view fixture', () => {
  for (const spec of [
    alphaRaster,
    alphaRaycast,
    meshRaster,
    meshRaycast,
    orderRaster,
    orderRaycast,
    playerRaster,
    playerRaycast,
  ]) {
    test(`${spec.name} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, spec);
    });
  }

  for (const spec of [alphaRaster, alphaRaycast]) {
    test(`${spec.name}: a cutout plane shows and shadows only its opaque texels`, async ({ page }) => {
      const { png, probes } = await render(page, spec);
      const at = (name: string) => probes.find((p) => p.name === name);
      expect(probes.map((p) => p.name)).toEqual([
        'opaque-texel',
        'transparent-texel',
        'shadow-of-opaque-texel',
        'shadow-of-transparent-texel',
        'back-side-texel',
        'flat-shadow-of-opaque-texel',
        'flat-shadow-of-transparent-texel',
      ]);
      // The texture: opaque red at the opaque probe, alpha 0 (with pure green RGB) at the transparent one.
      expect(at('opaque-texel')?.texel).toEqual([220, 50, 40, 255]);
      expect(at('transparent-texel')?.texel).toEqual([0, 255, 0, 0]);
      expect(at('flat-shadow-of-opaque-texel')?.texel).toEqual([40, 90, 220, 255]);
      expect(at('flat-shadow-of-transparent-texel')?.texel).toEqual([0, 255, 0, 0]);

      const [r, g, b] = pixel(png, at('opaque-texel'));
      expect(r, 'the opaque texel shows the plane').toBeGreaterThan(2 * Math.max(g, b));
      const seen = pixel(png, at('transparent-texel'));
      expect(Math.max(...seen) - Math.min(...seen), 'the transparent texel shows the grey ground').toBeLessThan(12);
      expect(luminance(seen), 'the ground, not the dark background').toBeGreaterThan(50);
      const lit = pixel(png, at('shadow-of-transparent-texel'));
      const dark = pixel(png, at('shadow-of-opaque-texel'));
      expect(Math.max(...lit) - Math.min(...lit), 'light through the hole falls on the grey ground').toBeLessThan(12);
      expect(luminance(lit), 'and lights it').toBeGreaterThan(120);
      expect(luminance(dark), 'the opaque texel shadows the ground').toBeLessThan(0.6 * luminance(lit));
      const [br, bg, bb] = pixel(png, at('back-side-texel'));
      expect(br, 'from behind, the face shows the same texel, mirrored').toBeGreaterThan(2 * Math.max(bg, bb));

      // Flat cube: only the face toward the light casts; the coincident face behind it must not fill its holes.
      const flatLit = pixel(png, at('flat-shadow-of-transparent-texel'));
      const flatDark = pixel(png, at('flat-shadow-of-opaque-texel'));
      expect(luminance(flatLit), 'light through a flat-cube hole lights the ground').toBeGreaterThan(120);
      expect(luminance(flatDark), 'an opaque flat-cube texel shadows it').toBeLessThan(0.6 * luminance(flatLit));
    });
  }

  for (const spec of [orderRaster, orderRaycast]) {
    test(`${spec.name}: the higher render order wins within the tie distance, the nearer face beyond it`, async ({
      page,
    }) => {
      const { png, probes } = await render(page, spec);
      const at = (name: string) => probes.find((p) => p.name === name);
      for (const [winner, loser] of [
        ['in-front', 'under-in-front'],
        ['over-behind', 'behind'],
        ['gap-near', 'gap-far-in-front'],
        ['tie-far-in-front', 'tie-near'],
      ] as const) {
        const shown = pixel(png, at(winner));
        const winnerTexel = at(winner)?.texel ?? [];
        const loserTexel = at(loser)?.texel ?? [];
        expect(hueMatch(winnerTexel, loserTexel), 'the two faces differ there').toBeLessThan(0.8);
        expect(hueMatch(shown, winnerTexel), `${winner} is shown`).toBeGreaterThan(0.995);
      }
    });
  }

  for (const spec of [playerRaster, playerRaycast]) {
    test(`${spec.name}: the skin's base layer is opaque, the hat shows the head through its holes, the cube is held`, async ({
      page,
    }) => {
      const { png, probes } = await render(page, spec);
      const at = (name: string) => probes.find((p) => p.name === name);
      expect(probes.map((p) => p.name)).toEqual(['face-probe', 'hat-hole', 'hat-ring', 'held-cube']);
      // skin-classic.png: an alpha-0 cyan texel on the opaque head, the red head front, a green hat ring texel.
      expect(at('face-probe')?.texel).toEqual([0, 200, 200, 0]);
      expect(at('hat-hole')?.texel).toEqual([255, 64, 64, 255]);
      for (const name of ['face-probe', 'hat-hole', 'hat-ring', 'held-cube']) {
        const texel = at(name)?.texel ?? [];
        expect(hueMatch(pixel(png, at(name)), texel), `${name} shows its texel`).toBeGreaterThan(0.98);
      }
    });
  }

  for (const [model, raster, raycast] of PAIRS) {
    test(`${model}: raster and raycast renders agree within MODEL_VIEW_PAIR_TOLERANCE`, async ({ page }, testInfo) => {
      const tolerance = MODEL_VIEW_PAIR_TOLERANCE[model];
      if (!tolerance) throw new Error(`no pair tolerance for ${model}`);
      const result = compareImages(
        (await render(page, raster)).buffer,
        (await render(page, raycast)).buffer,
        tolerance,
      );
      const measured = JSON.stringify({
        diffPixels: result.diffPixels,
        ratio: result.ratio,
        meanDelta: result.meanDelta,
      });
      const line =
        `${model}: ${result.diffPixels} px differ, ratio ${result.ratio.toFixed(5)} / max ${tolerance.maxDiffRatio}, ` +
        `mean delta ${result.meanDelta.toFixed(3)} / max ${tolerance.maxMeanDelta}`;
      console.log(`[model-view pair] ${line}`);
      testInfo.annotations.push({ type: 'model-view pair', description: line });
      await testInfo.attach(`${model}-pair`, { body: measured, contentType: 'application/json' });
      writeFileSync(join(testInfo.project.outputDir, `model-view-pair-${model}.json`), measured);
      if (!result.pass) {
        const diff = join(testInfo.outputDir, `${model}-pair-diff.png`);
        writeFileSync(diff, result.diffPng);
        await testInfo.attach(`${model}-pair-diff`, { path: diff, contentType: 'image/png' });
      }
      expect(result.pass, `${model} raster vs raycast: ${measured}`).toBe(true);
    });
  }

  test('the raycast variant re-renders byte-identically', async ({ page }) => {
    const first = await renderFixture(page, alphaRaycast);
    const second = await renderFixture(page, alphaRaycast);
    expect(second.png.equals(first.png)).toBe(true);
  });

  test('unknown variants are rejected', async ({ page }) => {
    for (const name of ['nope', 'constructor', '__proto__', '']) {
      await expect(openFixture(page, `/model-view.html?variant=${name}`), name).rejects.toThrow(/unknown variant/);
    }
    await expect(openFixture(page, '/model-view.html')).rejects.toThrow(/unknown variant/);
  });
});
