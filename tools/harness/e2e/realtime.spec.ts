import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, renderFixture, type FixtureInfo } from '../src/expectGolden';
import type { RasterGoldenSpec } from '../src/goldenSpec';
import { goldenPath } from '../src/goldenStore';
import { expect, test } from '../src/harnessTest';

const spec = (name: string, variant: string): RasterGoldenSpec => ({
  kind: 'raster',
  fixture: 'rt',
  name: `rt-${name}`,
  variant,
});

const TURNTABLE = ['y000', 'y030', 'y060', 'y090'].map((yaw) => spec(`turntable-${yaw}`, `turntable-${yaw}`));
const GOLDENS = [
  ...TURNTABLE,
  spec('iso', 'iso'),
  spec('closeup', 'closeup'),
  spec('far', 'far'),
  spec('fallback', 'fallback'),
  spec('fit-flat-cube', 'fit-flat-cube'),
];

interface Image {
  width: number;
  height: number;
  data: Buffer;
}

function decode(png: Buffer): Image {
  return PNG.sync.read(png);
}

async function render(page: Page, query: string): Promise<{ png: Buffer; image: Image; info: FixtureInfo }> {
  const info = await openFixture(page, `/rt.html?${query}`);
  const png = encodeFlipped(info);
  return { png, image: decode(png), info };
}

/** Reads the current drawing buffer again, after the page changed it without a reload. */
async function readPng(page: Page, info: FixtureInfo): Promise<Buffer> {
  const now = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    return { rgba: fixture.readRGBA(), width: fixture.width, height: fixture.height };
  });
  return encodeFlipped({ ...info, ...now });
}

function matchesGolden(png: Buffer, golden: RasterGoldenSpec): { pass: boolean; message: string } {
  const result = compareImages(png, readFileSync(goldenPath(golden)));
  return { pass: result.pass, message: `${result.diffPixels} pixels differ, mean delta ${result.meanDelta}` };
}

function pixel(image: Image, x: number, y: number): [number, number, number] {
  const i = (Math.floor(y) * image.width + Math.floor(x)) * 4;
  return [image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0];
}

const near = (a: readonly number[], b: readonly number[], levels: number): boolean =>
  a.every((v, i) => Math.abs(v - (b[i] ?? 0)) <= levels);

/** Pixels whose hue leans to the magenta sentinel: red and blue both clearly above green. */
function sentinelPixels(image: Image): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r = 0, g = 0, b = 0] = image.data.subarray(i, i + 3);
    if (r - g > 24 && b - g > 24) count++;
  }
  return count;
}

/** Share of pixels where some channel changed by more than 64 levels. */
function changedShare(a: Image, b: Image): number {
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0)) > 64) {
        changed++;
        break;
      }
    }
  }
  return changed / (a.width * a.height);
}

/** Bounding box of the pixels that differ from the backdrop (the top-left pixel). */
function modelBox(image: Image): { x0: number; y0: number; x1: number; y1: number } {
  const backdrop = pixel(image, 0, 0);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (near(pixel(image, x, y), backdrop, 2)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

test.describe('realtime goldens', () => {
  for (const golden of GOLDENS) {
    test(`${golden.name} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, golden);
      const path = await page.evaluate(() => window.__msFixture?.rt?.path);
      expect(path).toBe(golden.variant === 'fallback' ? 'fallback' : 'float');
    });
  }
});

test('the float path uses MSAA and the fallback reports itself', async ({ page }) => {
  await openFixture(page, '/rt.html?variant=turntable-y030');
  const float = await page.evaluate(() => window.__msFixture?.rt);
  expect(float?.path).toBe('float');
  expect(float?.msaaSamples).toBeGreaterThan(0);
  const fallback = await openFixture(page, '/rt.html?variant=turntable-y030&fallback=1');
  expect(await page.evaluate(() => window.__msFixture?.rt?.path)).toBe('fallback');
  expect(fallback.floatRenderTargets).toBe(true);
});

test('the fixture rejects unknown or malformed parameters', async ({ page }) => {
  for (const [query, message] of [
    ['variant=nope', /unknown variant/],
    ['variant=constructor', /unknown variant/],
    ['scene=toString', /unknown scene/],
    ['yaw=abc', /query parameter yaw/],
    ['zoom=0', /query parameter zoom/],
    ['proj=fisheye', /query parameter proj/],
    ['aa=2', /query parameter aa/],
    ['size=0', /query parameter size/],
  ] as const) {
    await expect(openFixture(page, `/rt.html?${query}`), query).rejects.toThrow(message);
  }
});

test('the same view renders byte-identical images', async ({ page }) => {
  const first = await renderFixture(page, TURNTABLE[1]!);
  const second = await renderFixture(page, TURNTABLE[1]!);
  expect(second.png.equals(first.png)).toBe(true);
});

test('no turntable frame shows a texel from outside its face rectangle', async ({ page }) => {
  for (const golden of TURNTABLE) {
    const { image } = await render(page, `variant=${golden.variant ?? ''}`);
    expect(sentinelPixels(image), golden.name).toBe(0);
  }
});

test('texel anti-aliasing halves shimmer against nearest sampling', async ({ page }) => {
  for (const framing of ['far', 'closeup']) {
    const share = async (aa: 0 | 1): Promise<number> => {
      const a = await render(page, `variant=${framing}&aa=${aa}&yaw=30`);
      const b = await render(page, `variant=${framing}&aa=${aa}&yaw=30.25`);
      return changedShare(a.image, b.image);
    };
    const nearest = await share(0);
    const antialiased = await share(1);
    expect(nearest, `${framing}: nearest sampling must shimmer for the check to mean anything`).toBeGreaterThan(0);
    expect(antialiased, `${framing}: ${antialiased} vs nearest ${nearest}`).toBeLessThanOrEqual(nearest * 0.5);
  }
});

test('partial alpha does not depend on draw order (float path and fallback)', async ({ page }) => {
  for (const extra of ['', '&fallback=1']) {
    for (const yaw of [0, 30]) {
      const forward = await render(page, `variant=turntable-y030&yaw=${yaw}${extra}`);
      const reversed = await render(page, `variant=turntable-y030&yaw=${yaw}&reverse=1${extra}`);
      expect(reversed.png.equals(forward.png), `yaw ${yaw}${extra}`).toBe(true);
    }
  }
});

test('a cutout texel shows the backdrop exactly, an opaque neighbour does not', async ({ page }) => {
  for (const extra of ['', '&fallback=1']) {
    const { image } = await render(page, `variant=turntable-y000${extra}`);
    const backdrop = pixel(image, 0, 0);
    // The sprite spans x -4..4, y 12..20 at z 0 with 6x6 texels; texel (0, 0) is cut out, texel (2, 0) is opaque.
    const [cx, cy] = await page.evaluate(() =>
      window.__msFixture!.rt!.project(-4 + 0.5 * (8 / 6), 20 - 0.5 * (8 / 6), 0),
    );
    const [ox, oy] = await page.evaluate(() =>
      window.__msFixture!.rt!.project(-4 + 2.5 * (8 / 6), 20 - 0.5 * (8 / 6), 0),
    );
    expect(pixel(image, cx, cy), `cutout texel${extra}`).toEqual(backdrop);
    expect(near(pixel(image, ox, oy), backdrop, 8), `opaque texel${extra}`).toBe(false);
  }
});

test('the context comes back after a loss without a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const info = await openFixture(page, '/rt.html?variant=turntable-y030');
  await page.evaluate(() => Object.assign(window, { __beforeLoss: true }));
  await page.evaluate(async () => {
    const rt = window.__msFixture!.rt!;
    await rt.lose();
    if (!rt.contextLost) throw new Error('context not reported lost');
    rt.render();
    await rt.restore();
    if (rt.contextLost) throw new Error('context still reported lost');
  });
  expect(await page.evaluate(() => (window as unknown as { __beforeLoss?: boolean }).__beforeLoss)).toBe(true);
  const result = matchesGolden(await readPng(page, info), TURNTABLE[1]!);
  expect(result.pass, result.message).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('device pixel ratio 2', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the backing store follows CSS size x devicePixelRatio and element resizes', async ({ page }) => {
    const { info, image } = await render(page, 'variant=turntable-y030');
    expect([info.width, info.height]).toEqual([512, 512]);
    const before = modelBox(image);
    await page.evaluate(() => window.__msFixture!.rt!.setCssSize(384, 256));
    const after = decode(await readPng(page, info));
    expect([after.width, after.height]).toEqual([768, 512]);
    const box = modelBox(after);
    // Same height in pixels and centred: the projection follows the new aspect instead of stretching.
    expect(Math.abs(box.y1 - box.y0 - (before.y1 - before.y0))).toBeLessThanOrEqual(3);
    expect(Math.abs(box.x1 - box.x0 - (before.x1 - before.x0))).toBeLessThanOrEqual(3);
    expect(Math.abs((box.x0 + box.x1) / 2 - (before.x0 + before.x1) / 2 - 128)).toBeLessThanOrEqual(3);
  });
});

test('framing keeps the whole model inside the image', async ({ page }) => {
  for (const variant of ['fit-flat-cube', 'iso', 'turntable-y000', 'turntable-y090']) {
    const { image } = await render(page, `variant=${variant}`);
    const box = modelBox(image);
    expect(box.x0, variant).toBeGreaterThanOrEqual(2);
    expect(box.y0, variant).toBeGreaterThanOrEqual(2);
    expect(box.x1, variant).toBeLessThan(image.width - 2);
    expect(box.y1, variant).toBeLessThan(image.height - 2);
  }
});

test.describe('hostile textures', () => {
  for (const [query, code, texture] of [
    ['scene=hostile-corrupt', 'TEXTURE_DECODE_FAILED', 0],
    ['scene=hostile-missing', 'TEXTURE_MISSING', 0],
    ['scene=hostile-mismatch', 'TEXTURE_SIZE_MISMATCH', 0],
    ['maxTextureSide=32', 'TEXTURE_TOO_LARGE', 1],
  ] as const) {
    test(`${query} draws a placeholder with a ${code} warning`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      const { image } = await render(page, `variant=turntable-y030&${query}`);
      const warnings = await page.evaluate(() => window.__msFixture?.rt?.warnings);
      expect(warnings).toEqual([{ code, texture }]);
      const box = modelBox(image);
      expect(box.x1 - box.x0).toBeGreaterThan(50);
      expect(errors).toEqual([]);
    });
  }

  test('an empty scene draws only the backdrop', async ({ page }) => {
    const { image } = await render(page, 'scene=empty');
    expect(modelBox(image).x0).toBe(Infinity);
  });
});

test.describe('lifetime', () => {
  test('of two quick setScene calls only the second is shown', async ({ page }) => {
    const info = await openFixture(page, '/rt.html?variant=turntable-y030&scene=flat&track=1');
    const applied = await page.evaluate(() => window.__msFixture!.rt!.setScenes(['flat', 'showcase']));
    expect(applied).toEqual([false, true]);
    const result = matchesGolden(await readPng(page, info), TURNTABLE[1]!);
    expect(result.pass, result.message).toBe(true);
  });

  test('dispose releases every GL object and image, a superseded scene included', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&track=1');
    const counts = await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      const loaded = { gl: rt.liveGlObjects(), bitmaps: rt.openBitmaps() };
      await rt.setScenes(['showcase', 'flat', 'showcase']);
      rt.dispose();
      return { loaded, gl: rt.liveGlObjects(), bitmaps: rt.openBitmaps() };
    });
    expect(counts.loaded.gl).toBeGreaterThan(0);
    expect(counts.loaded.bitmaps).toBe(2);
    expect({ gl: counts.gl, bitmaps: counts.bitmaps }).toEqual({ gl: 0, bitmaps: 0 });
  });

  test('dispose during texture decode raises nothing and leaks nothing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await openFixture(page, '/rt.html?variant=turntable-y030&track=1');
    const result = await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      const applied = await rt.disposeDuringDecode();
      rt.render();
      return { applied, gl: rt.liveGlObjects(), bitmaps: rt.openBitmaps() };
    });
    expect(result).toEqual({ applied: false, gl: 0, bitmaps: 0 });
    expect(errors).toEqual([]);
  });
});
