import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, renderFixture, type FixtureInfo } from '../src/expectGolden';
import type { RasterGoldenSpec } from '../src/goldenSpec';
import { goldenPath } from '../src/goldenStore';
import { expect, test } from '../src/harnessTest';
import type { ModelViewProbe } from '../fixtures/src/fixtureApi';

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
    ['scene=hostile-corrupt-data', 'TEXTURE_DECODE_FAILED', 0],
    ['scene=hostile-missing', 'TEXTURE_MISSING', 0],
    ['scene=hostile-mismatch', 'TEXTURE_SIZE_MISMATCH', 0],
    ['scene=hostile-huge-header', 'TEXTURE_TOO_LARGE', 0],
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

  test('a PNG header over the limit is rejected before decoding, whatever size the scene declares', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&scene=hostile-huge-header&track=1');
    // Only the brick texture was decoded.
    expect(await page.evaluate(() => window.__msFixture?.rt?.openBitmaps())).toBe(1);
  });

  test('an empty scene draws only the backdrop', async ({ page }) => {
    const { image } = await render(page, 'scene=empty');
    expect(modelBox(image).x0).toBe(Infinity);
  });
});

/** Pixels where green clearly dominates (the grass of the plate's up face; its down face is grey stone). */
function greenPixels(image: Image): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r = 0, g = 0, b = 0] = image.data.subarray(i, i + 3);
    if (g - r > 20 && g - b > 20) count++;
  }
  return count;
}

test('of the two coincident single-sided faces of a flat cube the one turned to the camera shows, from either side and on both paths', async ({
  page,
}) => {
  for (const extra of ['', '&fallback=1']) {
    const above = await render(page, `variant=fit-flat-cube${extra}`);
    const below = await render(page, `variant=fit-flat-cube&pitch=-20${extra}`);
    expect(greenPixels(above.image), `above${extra}`).toBeGreaterThan(1000);
    expect(modelBox(below.image).x1 - modelBox(below.image).x0, `below${extra}`).toBeGreaterThan(100);
    expect(greenPixels(below.image), `below${extra}`).toBe(0);
  }
});

test('float targets rejected at a new size switch the renderer to the no-float path', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const info = await openFixture(page, '/rt.html?variant=turntable-y030');
  expect(await page.evaluate(() => window.__msFixture?.rt?.path)).toBe('float');
  await page.evaluate(async () => {
    const rt = window.__msFixture!.rt!;
    rt.breakFramebuffers();
    await rt.setCssSize(200, 200);
  });
  const after = await page.evaluate(() => ({
    path: window.__msFixture?.rt?.path,
    msaa: window.__msFixture?.rt?.msaaSamples,
  }));
  expect(after).toEqual({ path: 'fallback', msaa: 0 });
  const image = decode(await readPng(page, info));
  expect([image.width, image.height]).toEqual([200, 200]);
  expect(modelBox(image).x1 - modelBox(image).x0).toBeGreaterThan(50);
  expect(errors).toEqual([]);
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

/** Probes of the model-view fixture (same camera image positions as `look=model-view`). */
async function modelViewProbes(page: Page, variant: string): Promise<ModelViewProbe[]> {
  await openFixture(page, `/model-view.html?variant=${variant}`);
  return page.evaluate(() => window.__msFixture?.probes ?? []);
}

/** Cosine between two RGB colours (lighting and tone mapping scale a texel's colour but keep its direction). */
function hueMatch(a: readonly number[], b: readonly number[]): number {
  const dot = [0, 1, 2].reduce((sum, k) => sum + (a[k] ?? 0) * (b[k] ?? 0), 0);
  return dot / (Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0) * Math.hypot(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0));
}

/** Pixels of the opposite quad colour (red: r > 1.5 b; blue: b > 1.5 r) where `expected` must show alone. */
function wrongColourPixels(image: Image, expected: 'red' | 'blue'): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i] ?? 0;
    const b = image.data[i + 2] ?? 0;
    if (expected === 'red' ? b > 1.5 * r + 8 : r > 1.5 * b + 8) count++;
  }
  return count;
}

/** Path and clip planes; the mode is the depth key an order-0 scene gets (a scene with render order is always exact). */
const RT_MODES = [
  ['float, framed', '&depth=framed', 'raster'],
  ['float, inside the sphere', '&depth=inside', 'exact'],
  ['fallback, framed', '&depth=framed&fallback=1', 'raster'],
  ['fallback, inside the sphere', '&depth=inside&fallback=1', 'exact'],
] as const;

test.describe('scene-format rule in the realtime renderer (model-view scenes)', () => {
  for (const [label, query, mode] of RT_MODES) {
    test(`alpha-plane, ${label}: cutout, back side and texels match the fixture`, async ({ page }) => {
      const probes = await modelViewProbes(page, 'alpha-plane-raster');
      const at = (name: string) => probes.find((p) => p.name === name)!;
      const { image } = await render(page, `scene=alpha-plane&look=model-view${query}`);
      expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe(mode);
      const [r, g, b] = pixel(image, at('opaque-texel').x, at('opaque-texel').y);
      expect(r, 'the opaque texel shows the plane').toBeGreaterThan(1.5 * Math.max(g, b));
      const seen = pixel(image, at('transparent-texel').x, at('transparent-texel').y);
      expect(Math.max(...seen) - Math.min(...seen), 'the transparent texel shows the grey ground').toBeLessThan(24);
      const [br, bg, bb] = pixel(image, at('back-side-texel').x, at('back-side-texel').y);
      expect(br, 'the double-sided back shows the same texel, mirrored').toBeGreaterThan(1.5 * Math.max(bg, bb));
    });

    test(`render-order, ${label}: coincident pairs, gaps (2 × TIE) and ties (0.5 × TIE) resolve as in the fixture`, async ({
      page,
    }) => {
      const probes = await modelViewProbes(page, 'render-order-raster');
      const at = (name: string) => probes.find((p) => p.name === name)!;
      const { image } = await render(page, `scene=render-order&look=model-view${query}`);
      // The scene has render orders, so every frame uses the exact key.
      expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('exact');
      for (const [winner, loser] of [
        ['in-front', 'under-in-front'],
        ['over-behind', 'behind'],
        ['gap-near', 'gap-far-in-front'],
        ['tie-far-in-front', 'tie-near'],
      ] as const) {
        const shown = pixel(image, at(winner).x, at(winner).y);
        const toWinner = hueMatch(shown, at(winner).texel);
        const toLoser = hueMatch(shown, at(loser).texel);
        expect(toWinner, `${winner} over ${loser}: ${toWinner} vs ${toLoser}`).toBeGreaterThan(toLoser + 0.05);
      }
    });
  }
});

test.describe('coincident double-sided faces and single-sided backs', () => {
  for (const [label, query, mode] of RT_MODES) {
    test(`${label}: the side facing the camera wins from above and below; a single-sided back shows nothing`, async ({
      page,
    }) => {
      for (const look of ['above', 'below', 'grazing-above', 'grazing-below'] as const) {
        const { image } = await render(page, `scene=coincident-double&look=${look}${query}`);
        expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe(mode);
        const backdrop = pixel(image, 0, 0);
        const [px, py] = await page.evaluate(() => window.__msFixture!.rt!.project(-6, 0, 0));
        const [r, , b] = pixel(image, px, py);
        if (look.endsWith('above')) expect(r, `${look}: the up-facing red quad`).toBeGreaterThan(1.5 * b);
        else expect(b, `${look}: the down-facing blue quad`).toBeGreaterThan(1.5 * r);
        if (look.startsWith('grazing')) {
          // Every pixel of the pair: no patch of the other colour (order-0 scene, back side −1/16 on the raster pull).
          expect(wrongColourPixels(image, look.endsWith('above') ? 'red' : 'blue'), look).toBe(0);
          continue;
        }
        const [sx, sy] = await page.evaluate(() => window.__msFixture!.rt!.project(6, 0, 0));
        const single = pixel(image, sx, sy);
        if (look === 'above') expect(near(single, backdrop, 8), 'single-sided front is drawn').toBe(false);
        else expect(single, 'single-sided back is not drawn').toEqual(backdrop);
      }
    });
  }
});

/** Pixels where blue clearly dominates red: the blue (hidden) faces of the closed cube. */
function bluePixels(image: Image): number {
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if ((image.data[i + 2] ?? 0) > (image.data[i] ?? 0) + 24) count++;
  }
  return count;
}

test.describe('closed double-sided cube: no back side on silhouettes', () => {
  for (const [label, query, mode] of [
    ['float, raster key', 'scene=closed-cube&depth=framed', 'raster'],
    ['float, exact key (inside the sphere)', 'scene=closed-cube&depth=inside', 'exact'],
    ['float, exact key (render order)', 'scene=closed-cube-order&depth=framed', 'exact'],
    ['fallback, raster key', 'scene=closed-cube&depth=framed&fallback=1', 'raster'],
    ['fallback, exact key (inside the sphere)', 'scene=closed-cube&depth=inside&fallback=1', 'exact'],
    ['fallback, exact key (render order)', 'scene=closed-cube-order&depth=framed&fallback=1', 'exact'],
  ] as const) {
    test(label, async ({ page }) => {
      const { image } = await render(page, `${query}&look=cube`);
      expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe(mode);
      expect(modelBox(image).x1 - modelBox(image).x0, 'the cube is drawn').toBeGreaterThan(50);
      expect(bluePixels(image), 'pixels of a hidden (back-side) face').toBe(0);
    });
  }
});

test.describe('texel alpha bytes in the shaders (alpha ramp, no texel anti-aliasing)', () => {
  for (const [scene, invisibleBelow] of [
    ['alpha-ramp-blend', 3],
    ['alpha-ramp-mask', 128],
    ['alpha-ramp-opaque', 0],
  ] as const) {
    for (const extra of ['', '&fallback=1']) {
      test(`${scene}${extra}: bytes below ${invisibleBelow} show only the backdrop, the others do not`, async ({
        page,
      }) => {
        const { image } = await render(page, `scene=${scene}&look=ramp&aa=0${extra}`);
        const backdrop = pixel(image, 0, 0);
        const invisible: number[] = [];
        for (let k = 0; k < 256; k++) {
          const [x, y] = await page.evaluate(
            ([col, row]) => window.__msFixture!.rt!.project(-8 + col + 0.5, 8 - row - 0.5, 0),
            [k % 16, Math.floor(k / 16)] as const,
          );
          let allBackdrop = true;
          for (let dy = -5; dy <= 5 && allBackdrop; dy++) {
            for (let dx = -5; dx <= 5; dx++) {
              if (!near(pixel(image, x + dx, y + dy), backdrop, 0)) {
                allBackdrop = false;
                break;
              }
            }
          }
          if (allBackdrop) invisible.push(k);
        }
        expect(invisible).toEqual(Array.from({ length: invisibleBelow }, (_, k) => k));
      });
    }
  }
});
