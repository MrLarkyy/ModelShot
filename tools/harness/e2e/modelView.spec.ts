import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from '../src/compareImages';
import { expectGolden, openFixture, renderFixture } from '../src/expectGolden';
import type { RasterGoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';
import type { ModelViewProbe } from '../fixtures/src/fixtureApi';

const variant = (name: string): RasterGoldenSpec => ({ kind: 'raster', fixture: 'model-view', name, variant: name });
const alphaRaster = variant('alpha-plane-raster');
const alphaRaycast = variant('alpha-plane-raycast');
const meshRaster = variant('mesh-shapes-raster');

/**
 * The raster (shadow map, rasterised edges) and the raycast (exact rays) renders of alpha-plane differ only where a
 * pixel centre sits within a rounding error of a silhouette, a texel edge or a shadow edge. Measured on SwiftShader
 * (docs/testing.md): 125 of 65 536 pixels (ratio 0.0019), mean delta 0.13 levels; the limits leave about 30 %
 * headroom for that count. Never widened to make the pair pass: a real difference (a cutout texel shown or casting
 * a shadow in one path only) changes hundreds of pixels per texel block.
 */
const MODEL_VIEW_PAIR_TOLERANCE = {
  threshold: 0.1,
  maxDiffRatio: 0.0025,
  maxMeanDelta: 0.25,
  reason: 'raster vs raycast differ only on edge pixels (shadow-map texels, rasterisation rules)',
} as const;

async function render(
  page: Page,
  spec: RasterGoldenSpec,
): Promise<{ png: PNG; buffer: Buffer; probes: ModelViewProbe[] }> {
  const { png } = await renderFixture(page, spec);
  const probes = await page.evaluate(() => window.__msFixture?.probes ?? []);
  return { png: PNG.sync.read(png), buffer: png, probes };
}

function pixel(png: PNG, probe: ModelViewProbe | undefined): [number, number, number] {
  if (!probe) throw new Error('probe missing');
  expect(probe.x >= 0 && probe.x < png.width && probe.y >= 0 && probe.y < png.height, probe.name).toBe(true);
  const i = (probe.y * png.width + probe.x) * 4;
  return [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
}

const luminance = ([r, g, b]: readonly number[]): number => 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

test.describe('model-view fixture', () => {
  for (const spec of [alphaRaster, alphaRaycast, meshRaster]) {
    test(`${spec.name} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, spec);
    });
  }

  for (const spec of [alphaRaster, alphaRaycast]) {
    test(`${spec.name}: a cutout plane shows and shadows only its opaque texels`, async ({ page }) => {
      const { png, probes } = await render(page, spec);
      await test.info().attach('probes', { body: JSON.stringify(probes), contentType: 'application/json' });
      const at = (name: string) => probes.find((p) => p.name === name);
      expect(probes.map((p) => p.name)).toEqual([
        'opaque-texel',
        'transparent-texel',
        'shadow-of-opaque-texel',
        'shadow-of-transparent-texel',
        'back-side-texel',
      ]);
      // The texture: opaque red at the opaque probe, alpha 0 (with pure green RGB) at the transparent one.
      expect(at('opaque-texel')?.texel).toEqual([220, 50, 40, 255]);
      expect(at('transparent-texel')?.texel).toEqual([0, 255, 0, 0]);

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
    });
  }

  test('raster and raycast renders agree within MODEL_VIEW_PAIR_TOLERANCE', async ({ page }, testInfo) => {
    const raster = await render(page, alphaRaster);
    const raycast = await render(page, alphaRaycast);
    const result = compareImages(raster.buffer, raycast.buffer, MODEL_VIEW_PAIR_TOLERANCE);
    const measured = JSON.stringify({
      diffPixels: result.diffPixels,
      ratio: result.ratio,
      meanDelta: result.meanDelta,
    });
    await testInfo.attach('model-view-pair', { body: measured, contentType: 'application/json' });
    writeFileSync(join(testInfo.project.outputDir, 'model-view-pair.json'), measured);
    if (!result.pass) {
      const diff = join(testInfo.outputDir, 'model-view-pair-diff.png');
      writeFileSync(diff, result.diffPng);
      await testInfo.attach('model-view-pair-diff', { path: diff, contentType: 'image/png' });
    }
    expect(result.pass, `raster vs raycast: ${measured}`).toBe(true);
  });

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
