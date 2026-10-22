import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
// The package index pulls in GLSL through Vite's ?raw, which Playwright cannot load: the plain modules directly.
import { agxToneMap } from '../../../packages/looks/src/agxToneMap';
import { backdropColor } from '../../../packages/looks/src/backdropColor';
import { compareImages } from '../src/compareImages';
import { encodeFlipped, expectGolden, openFixture, renderFixture, type FixtureInfo } from '../src/expectGolden';
import type { RasterGoldenSpec } from '../src/goldenSpec';
import { goldenPath } from '../src/goldenStore';
import { lookPresetFile } from '../src/lookPresetFile';
import { expect, test } from '../src/harnessTest';
import { differenceMask, pixelsFarFrom } from '../src/edgeProbes';
import {
  decodePng,
  hueMatch,
  luminance,
  modelBox,
  near,
  pixel,
  sentinelPixels,
  silhouettePixels,
  whiteCount,
  type Image,
} from '../src/imageMetrics';
import { traceMainThread } from '../src/mainThreadTrace';
import { shadowStep } from '../src/shadowStep';
import { edgesSceneSharpEdges } from '../fixtures/src/edgesScene';
import type { ModelViewProbe, PtProbe, RtBakeOutcome, RtBakeRequest } from '../fixtures/src/fixtureApi';

const spec = (name: string, variant: string): RasterGoldenSpec => ({
  kind: 'raster',
  fixture: 'rt',
  name: `rt-${name}`,
  variant,
});

const TURNTABLE = ['y000', 'y030', 'y060', 'y090'].map((yaw) => spec(`turntable-${yaw}`, `turntable-${yaw}`));
const PLAYER = [
  'player-classic-front',
  'player-classic-back',
  'player-slim-34',
  'player-legacy-34',
  'player-legacy-opaque-hat-34',
  'player-hold-34',
  'player-walk-hold-34',
  'player-slim-fallback',
  'player-wave-front',
].map((variant) => spec(variant, variant));
const GOLDENS = [
  ...TURNTABLE,
  spec('iso', 'iso'),
  spec('closeup', 'closeup'),
  spec('far', 'far'),
  spec('fallback', 'fallback'),
  spec('fit-flat-cube', 'fit-flat-cube'),
  spec('gltf-nodes-y030', 'gltf-nodes-y030'),
  spec('obj-shapes-y030', 'obj-shapes-y030'),
  ...PLAYER,
  // MS-15: rounded edges on a cube and a wedge, none on a plane, a card and a sphere; paired with pt-edges.
  spec('edges', 'edges'),
];
// Baked light (MS-16): 64 samples, seed 1, shadow catcher on; the cut-out checker's pair is pt-cutout-checker. The
// look presets (MS-19) bake under their own look; pairs pt-preset-marketplace and pt-preset-rim.
const BAKED = [
  'bake-cutout-checker',
  'bake-cutout-checker-fallback',
  'bake-alpha-plane',
  'bake-turntable-y030',
  'preset-marketplace',
  'preset-rim',
  'preset-marketplace-fallback',
].map((variant) => spec(variant, variant));

async function render(page: Page, query: string): Promise<{ png: Buffer; image: Image; info: FixtureInfo }> {
  const info = await openFixture(page, `/rt.html?${query}`);
  const png = encodeFlipped(info);
  return { png, image: decodePng(png), info };
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

test.describe('realtime goldens', () => {
  for (const golden of [...GOLDENS, ...BAKED]) {
    test(`${golden.name} matches its golden`, async ({ page }, testInfo) => {
      // One 64-sample bake: 17 s to over 30 s on a SwiftShader runner.
      if (BAKED.includes(golden)) test.setTimeout(180_000);
      await expectGolden(page, testInfo, golden);
      const path = await page.evaluate(() => window.__msFixture?.rt?.path);
      expect(path).toBe(golden.variant?.endsWith('fallback') ? 'fallback' : 'float');
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
    ['hide=a%20b', /query parameter hide/],
    ['scene=player-classic&hide=block', /unknown mesh/],
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

test('glTF scene: no frame shows an atlas texel from outside its face region', async ({ page }) => {
  for (const yaw of [0, 30, 60, 90, 180, 270]) {
    const { image } = await render(page, `variant=gltf-nodes-y030&yaw=${yaw}`);
    expect(sentinelPixels(image), `gltf-nodes yaw ${yaw}`).toBe(0);
  }
});

test('glTF scene: partial alpha does not depend on draw order (float path and fallback)', async ({ page }) => {
  for (const extra of ['', '&fallback=1']) {
    const forward = await render(page, `variant=gltf-nodes-y030${extra}`);
    const reversed = await render(page, `variant=gltf-nodes-y030&reverse=1${extra}`);
    expect(reversed.png.equals(forward.png), `gltf-nodes${extra}`).toBe(true);
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
    const after = decodePng(await readPng(page, info));
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

test.describe('look presets', () => {
  for (const extra of ['', '&fallback=1']) {
    test(`the backdrop gradient matches its TS mirror${extra ? ' (fallback)' : ''}`, async ({ page }) => {
      const look = lookPresetFile('marketplace');
      const { image } = await render(page, `scene=empty&preset=marketplace${extra}`);
      let worst = 0;
      for (let y = 0; y < image.height; y++) {
        const expected = agxToneMap(backdropColor(look, (image.height - y - 0.5) / image.height), look.toneMapping);
        for (const x of [0, 100, image.width - 1]) {
          const seen = pixel(image, x, y);
          worst = Math.max(worst, ...seen.map((v, c) => Math.abs(v - (expected[c] ?? 0) * 255)));
        }
      }
      console.log(`[rt probe] marketplace backdrop${extra}: worst ${worst.toFixed(2)} levels from the mirror`);
      expect(worst).toBeLessThanOrEqual(2);
      expect(luminance(pixel(image, 0, image.height - 1)) - luminance(pixel(image, 0, 0))).toBeGreaterThan(5);
    });
  }

  test('setLook draws the look; an invalid look names its field and changes nothing', async ({ page }) => {
    const { info, png: studio } = await render(page, 'variant=turntable-y030');
    const fresh = (await render(page, 'variant=turntable-y030&preset=marketplace')).png;
    const opened = await render(page, 'variant=turntable-y030');
    const set = (id: string) => page.evaluate((name) => window.__msFixture!.rt!.setLook(name), id);
    expect(await set('marketplace')).toBe('ok');
    const marketplace = await readPng(page, opened.info);
    expect(marketplace.equals(fresh), 'the bytes of a renderer created with Marketplace').toBe(true);
    expect(await set('bad')).toMatch(/^LookPresetError: catcher\.strength/);
    expect((await readPng(page, info)).equals(marketplace), 'a rejected look changes nothing').toBe(true);
    expect(await set('studio')).toBe('ok');
    expect((await readPng(page, info)).equals(studio), 'back to Studio: the first bytes').toBe(true);
  });

  /**
   * The view-relative rim never blows out a camera-facing face: the held-cube player under Marketplace, unbaked (the
   * bake only darkens), 512 px, pitch 20, a turntable of 12 yaws. Blown out: every channel at 250 or more; the limit is
   * the measured worst share x 1.25 and never 2 % of the model. Each view keeps a near-white silhouette line,
   * at least the fewest measured / 1.25.
   */
  test('Marketplace: no blown-out face from any orbit yaw, a white silhouette line from every one', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Measured: no blown-out pixel from any yaw; the fewest white silhouette pixels 107, at yaw 0 (the back).
    const worstShare = 0;
    const minWhite = 85;
    const lines: string[] = [];
    for (let yaw = 0; yaw < 360; yaw += 30) {
      const { image } = await render(page, `variant=preset-marketplace&yaw=${yaw}&bake=0&size=512`);
      const { model, silhouette } = silhouettePixels(image, { backdropTolerance: 4, reach: 2 });
      const share = whiteCount(model, 249) / model.length;
      const white = whiteCount(silhouette, 200);
      lines.push(`yaw ${yaw}: blown ${share.toFixed(5)}, white ${white}`);
      expect(share, `yaw ${yaw}`).toBeLessThanOrEqual(worstShare);
      expect(share, `yaw ${yaw}`).toBeLessThan(0.02);
      expect(white, `yaw ${yaw}`).toBeGreaterThanOrEqual(minWhite);
    }
    console.log(`[rt probe] marketplace turntable: ${lines.join('; ')}`);
  });

  test('a lost context comes back with the look', async ({ page }) => {
    const { info, png } = await render(page, 'variant=turntable-y030&preset=rim');
    await page.evaluate(() => window.__msFixture!.rt!.lose());
    await page.evaluate(() => window.__msFixture!.rt!.restore());
    expect((await readPng(page, info)).equals(png)).toBe(true);
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
  const image = decodePng(await readPng(page, info));
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

/** Pixels that differ at all between two images of the same size (a single MSAA sample changes a pixel). */
function differingPixels(a: Image, b: Image): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) count++;
  }
  return count;
}

test.describe('closed double-sided boxes: no hidden face at any sample', () => {
  const modes = [
    ['float, raster key', '', '&depth=framed', 'raster'],
    ['float, exact key (inside the sphere)', '', '&depth=inside', 'exact'],
    ['float, exact key (render order)', '-order', '&depth=framed', 'exact'],
    ['fallback, raster key', '', '&depth=framed&fallback=1', 'raster'],
    ['fallback, exact key (inside the sphere)', '', '&depth=inside&fallback=1', 'exact'],
    ['fallback, exact key (render order)', '-order', '&depth=framed&fallback=1', 'exact'],
  ] as const;
  for (const [shape, looks] of [
    ['closed-cube', ['cube', 'cube-grazing-1', 'cube-grazing-5']],
    ['step', ['cube', 'cube-grazing-5']],
  ] as const) {
    for (const [label, order, query, mode] of modes) {
      test(`${shape}, ${label}: the hidden faces change no pixel (${looks.join(', ')})`, async ({ page }) => {
        const scene = shape === 'closed-cube' && order ? 'closed-cube-order' : `${shape}${order}`;
        // Raster frames skip the back pass of these closed opaque boxes, so even beside a face 1 degree from
        // edge-on no MSAA sample shows a hidden face.
        for (const look of looks) {
          // The open variant has only the faces in view; the hidden (blue) faces must not change a single pixel.
          const closed = await render(page, `scene=${scene}${query}&look=${look}&edges=0`);
          expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe(mode);
          expect(modelBox(closed.image).x1 - modelBox(closed.image).x0, `${look}: drawn`).toBeGreaterThan(20);
          const open = await render(page, `scene=${scene}-open${query}&look=${look}&edges=0`);
          expect(differingPixels(closed.image, open.image), `${look}: pixels touched by a hidden face`).toBe(0);
        }
      });
    }
  }
});

/**
 * Pixels the hidden faces of `closed-cube-cutout` change at the `cube-grazing-1` look on the float path (raster key,
 * MSAA), as measured when the remaining deviation was pinned: an upper bound, so the leak cannot grow unnoticed.
 */
const CUTOUT_GRAZING_1_PIXELS = 10;

test.describe('raster back pass of closed meshes', () => {
  for (const [label, query] of [
    ['float', ''],
    ['fallback', '&fallback=1'],
  ] as const) {
    test(`${label}: a closed cube with cut-outs keeps its back pass; beside a face 1 degree from edge-on its hidden faces touch at most the pinned pixel count`, async ({
      page,
    }) => {
      // Not opaque on every face, so the back sides are drawn, and MSAA samples next to the near edge-on east face
      // still let a few through (docs/realtime-renderer.md, deviation). The bound is the count measured when pinned.
      const bound = label === 'float' ? CUTOUT_GRAZING_1_PIXELS : 0;
      for (const [look, max] of [
        ['cube', 0],
        ['cube-grazing-1', bound],
      ] as const) {
        const closed = await render(page, `scene=closed-cube-cutout${query}&look=${look}&edges=0`);
        expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('raster');
        const open = await render(page, `scene=closed-cube-open${query}&look=${look}&edges=0`);
        expect(
          differingPixels(closed.image, open.image),
          `${look}: pixels touched by a hidden face`,
        ).toBeLessThanOrEqual(max);
      }
    });

    test(`${label}: an inside-out closed cube keeps its back pass: its near wall shows at the centre`, async ({
      page,
    }) => {
      // Inverted faces: the near (red) walls are back sides, the far (blue) walls face the camera. Skipping the back
      // pass would show the blue far wall at the centre.
      const { image } = await render(page, `scene=closed-cube-inverted${query}&look=cube`);
      expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('raster');
      const [r, g, b] = pixel(image, image.width / 2, image.height / 2);
      expect(r, `centre ${r}, ${g}, ${b}: red near wall`).toBeGreaterThan(2 * Math.max(g, b) + 10);
    });

    test(`${label}: with the camera inside a closed opaque cube the back sides are still drawn`, async ({ page }) => {
      const { image } = await render(page, `scene=closed-cube${query}&look=cube-inside`);
      expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('raster');
      // Every wall seen from inside is a back side: no backdrop pixel may remain.
      const { image: empty } = await render(page, `scene=empty${query}&look=cube-inside`);
      const backdrop = pixel(empty, 0, 0);
      let backdropPixels = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) if (near(pixel(image, x, y), backdrop, 0)) backdropPixels++;
      }
      expect(backdropPixels).toBe(0);
    });
  }
});

test.describe('render-order tie at MSAA sample level: coincident quads with different diagonals (exact key)', () => {
  for (const [look, kind] of [
    ['above', ''],
    ['grazing-above', ''],
    ['model-view', ''],
    ['below', '-double'],
    ['grazing-below', '-double'],
  ] as const) {
    for (const extra of ['', '&fallback=1']) {
      const sides = kind ? 'back sides' : 'fronts';
      test(`${look}${extra}: the in_front quad wins every sample (${sides}), along both diagonals`, async ({
        page,
      }) => {
        const pair = await render(page, `scene=tie-pair${kind}&look=${look}${extra}`);
        expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('exact');
        const single = await render(page, `scene=tie-single${kind}&look=${look}${extra}`);
        expect(modelBox(single.image).x1 - modelBox(single.image).x0, 'the quad is drawn').toBeGreaterThan(20);
        expect(differingPixels(pair.image, single.image), 'pixels touched by the default quad').toBe(0);
      });
    }
  }

  test.describe('device pixel ratio 2, non-square viewport', () => {
    test.use({ deviceScaleFactor: 2 });

    test('the exact key uses the viewport the passes draw into (768 x 512)', async ({ page }) => {
      const images: Image[] = [];
      for (const scene of ['tie-pair', 'tie-single']) {
        const { info } = await render(page, `scene=${scene}&look=grazing-above`);
        await page.evaluate(() => window.__msFixture!.rt!.setCssSize(384, 256));
        const image = decodePng(await readPng(page, info));
        expect([image.width, image.height]).toEqual([768, 512]);
        images.push(image);
      }
      expect(differingPixels(images[0]!, images[1]!)).toBe(0);
    });
  });
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

/** World point → image position under the page's current camera. */
async function projectPoint(page: Page, point: readonly [number, number, number]): Promise<[number, number]> {
  return page.evaluate(([x, y, z]) => window.__msFixture!.rt!.project(x, y, z), point);
}

function meanPixel(image: Image, x: number, y: number): [number, number, number] {
  const sum = [0, 0, 0];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) pixel(image, x + dx, y + dy).forEach((v, k) => (sum[k] = (sum[k] ?? 0) + v));
  }
  return [(sum[0] ?? 0) / 25, (sum[1] ?? 0) / 25, (sum[2] ?? 0) / 25];
}

/** Centroid and count of the pixels where two images differ. */
function differenceCentroid(a: Image, b: Image): { x: number; y: number; count: number } {
  let x = 0;
  let y = 0;
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data.readUInt32BE(i) === b.data.readUInt32BE(i)) continue;
    const p = i / 4;
    x += (p % a.width) + 0.5;
    y += Math.floor(p / a.width) + 0.5;
    count++;
  }
  return { x: x / count, y: y / count, count };
}

// The generated skins (packages/formats/test/fixtures/skins/generate.mjs): blue never above green, so only the magenta
// sentinel around the face regions can trip `sentinelPixels`. Head front texels (2..3, 2..3) are alpha 0 with RGB
// (0, 200, 200); the head front is otherwise red (255, 64, 64); the hat front is a ring around holes, and in the slim
// skin hat front texels (4..5, 4..5) are green at alpha 128. Model units: head front at z = -4 from x = 4 (u 8) to
// x = -4, hat front at z = -4.5 with 9/8-unit texels.
const HEAD_PROBE: readonly [number, number, number] = [1, 29, -4];
const HEAD_THROUGH_HAT_HOLE: readonly [number, number, number] = [-1.5, 29.5, -4];
const HAT_PARTIAL: readonly [number, number, number] = [4.5 - 5 * 1.125, 32.5 - 5 * 1.125, -4.5];
// The held cube's centre in the right hand's frame: 1.5 below the hand anchor (6, 12, 0) (fixtures/src/playerScenes.ts).
const HELD_CUBE_CENTRE: readonly [number, number, number] = [6, 10.5, 0];
const HOLDING = ['player-hold-34', 'player-walk-hold-34'];

test.describe('player skins', () => {
  test('no player frame shows a skin texel from outside its part region', async ({ page }) => {
    for (const golden of PLAYER) {
      // The held cube has its own texture (a gradient with magenta-like texels), so its frames are checked without it.
      const hide = HOLDING.includes(golden.variant ?? '') ? '&hide=block' : '';
      const { image } = await render(page, `variant=${golden.variant ?? ''}${hide}`);
      expect(sentinelPixels(image), golden.name).toBe(0);
    }
  });

  for (const extra of ['', '&fallback=1']) {
    test(`an alpha-0 base texel shows opaque, a cut-out outer texel shows the base${extra}`, async ({ page }) => {
      const { image } = await render(page, `scene=player-classic&yaw=180&pitch=10${extra}`);
      const [pr, pg, pb] = pixel(image, ...(await projectPoint(page, HEAD_PROBE)));
      expect(pg, 'the alpha-0 texel is drawn with its cyan RGB').toBeGreaterThan(80);
      expect(Math.abs(pg - pb), 'cyan: green and blue alike').toBeLessThan(0.15 * pg);
      expect(pr, 'cyan: little red').toBeLessThan(0.6 * pg);
      const [hr, hg, hb] = pixel(image, ...(await projectPoint(page, HEAD_THROUGH_HAT_HOLE)));
      expect(hr, 'the head shows through the hat hole').toBeGreaterThan(1.5 * Math.max(hg, hb));
    });

    test(`an alpha-128 outer texel lies between the base and its own colour${extra}`, async ({ page }) => {
      const { image } = await render(page, `scene=player-slim&yaw=180&pitch=10${extra}`);
      // A 5 x 5 mean inside the 2 x 2-texel block (about 15 px): the fallback dithers partial alpha per pixel.
      const base = meanPixel(image, ...(await projectPoint(page, HEAD_THROUGH_HAT_HOLE)));
      const blended = meanPixel(image, ...(await projectPoint(page, HAT_PARTIAL)));
      expect(blended[0], 'less red than the head').toBeLessThan(base[0] - 30);
      expect(blended[0], 'but some of it').toBeGreaterThan(20);
      expect(blended[1], 'more green than the head').toBeGreaterThan(base[1] + 30);
    });
  }

  test('outer-layer transparency does not depend on draw order (float path and fallback)', async ({ page }) => {
    for (const variant of ['player-slim-34', 'player-hold-34', 'player-slim-fallback']) {
      const forward = await render(page, `variant=${variant}`);
      const reversed = await render(page, `variant=${variant}&reverse=1`);
      expect(reversed.png.equals(forward.png), variant).toBe(true);
    }
  });

  test('the held cube follows the right hand through the hold and walk poses', async ({ page }) => {
    const centres: { x: number; y: number }[] = [];
    for (const variant of HOLDING) {
      const shown = await render(page, `variant=${variant}`);
      const hidden = await render(page, `variant=${variant}&hide=block`);
      const cube = differenceCentroid(shown.image, hidden.image);
      const [x, y, z] = await page.evaluate(
        (p) => window.__msFixture!.rt!.nodePoint('right_hand', p[0], p[1], p[2]),
        HELD_CUBE_CENTRE,
      );
      const [ex, ey] = await projectPoint(page, [x, y, z]);
      expect(cube.count, `${variant}: the cube is drawn`).toBeGreaterThan(100);
      expect(Math.hypot(cube.x - ex, cube.y - ey), `${variant}: cube at ${cube.x}, ${cube.y}`).toBeLessThanOrEqual(2);
      centres.push(cube);
    }
    // The arm is 40° forward in hold and 30° in walk: the cube moved with it.
    const [hold, walk] = centres;
    expect(Math.hypot((hold?.x ?? 0) - (walk?.x ?? 0), (hold?.y ?? 0) - (walk?.y ?? 0))).toBeGreaterThan(5);
  });
});

const rtBake = (page: Page, request: RtBakeRequest): Promise<RtBakeOutcome> =>
  page.evaluate((r) => window.__msFixture!.rt!.bake(r), request);

const probeAt = (probes: readonly PtProbe[], name: string): PtProbe => {
  const probe = probes.find((p) => p.name === name);
  if (!probe) throw new Error(`probe ${name} missing`);
  return probe;
};

test.describe('baked lighting', () => {
  // A 64-sample bake takes seconds on SwiftShader; several tests bake more than once. Run 39624802150: bake goldens
  // 33-42 s, and a VM ran about 2x slower than another on the same image.
  test.describe.configure({ timeout: 300_000 });

  test('the cut-out checker casts pixel-shaped shadows on the catcher and the box (float path and fallback)', async ({
    page,
  }) => {
    for (const variant of ['bake-cutout-checker', 'bake-cutout-checker-fallback']) {
      const { image } = await render(page, `variant=${variant}`);
      const probes = await page.evaluate(() => window.__msFixture!.rt!.probes);
      for (const surface of ['catcher', 'cube']) {
        const lit = probeAt(probes, `${surface}-shadow-of-transparent-texel`);
        const dark = probeAt(probes, `${surface}-shadow-of-opaque-texel`);
        const { step, transition, values } = shadowStep(image, lit, dark);
        console.log(
          `[rt probe] ${variant} ${surface}: step ${step.toFixed(1)} levels / min 40, edge ${transition.toFixed(2)} px / max 2`,
        );
        expect(step, `${variant} ${surface}: ${values.join(', ')}`).toBeGreaterThanOrEqual(40);
        expect(transition, `${variant} ${surface}: ${values.join(', ')}`).toBeLessThanOrEqual(2);
      }
    }
  });

  test('texel anti-aliasing still halves shimmer against nearest sampling with baked light', async ({ page }) => {
    for (const framing of ['far', 'closeup']) {
      const share = async (aa: 0 | 1): Promise<number> => {
        const a = await render(page, `variant=${framing}&aa=${aa}&yaw=30&bake=4`);
        const b = await render(page, `variant=${framing}&aa=${aa}&yaw=30.25&bake=4`);
        return changedShare(a.image, b.image);
      };
      const nearest = await share(0);
      const antialiased = await share(1);
      console.log(`[rt probe] baked shimmer ${framing}: ${antialiased.toFixed(5)} vs nearest ${nearest.toFixed(5)}`);
      expect(nearest, `${framing}: nearest sampling must shimmer for the check to mean anything`).toBeGreaterThan(0);
      expect(antialiased, `${framing}: ${antialiased} vs nearest ${nearest}`).toBeLessThanOrEqual(nearest * 0.5);
    }
  });

  test('a bake is deterministic: repeated, in 32 or 64 texel tiles, and its progress equals a shorter bake', async ({
    page,
  }) => {
    // 1.6 m on a normal runner, 3.0 m (the old 180 s limit) on a slow one: several 64-sample bakes in a row.
    test.setTimeout(480_000);
    await openFixture(page, '/rt.html?variant=turntable-y030');
    const first = await rtBake(page, { samples: 64 });
    const again = await rtBake(page, { samples: 64 });
    const tiled = await rtBake(page, { samples: 64, tile: 32 });
    const short = await rtBake(page, { samples: 16 });
    expect(first.error).toBe('');
    expect(first.progress, 'progress after 4 and 16 samples').toEqual([4, 16]);
    expect(again.hash).toBe(first.hash);
    expect(tiled.hash).toBe(first.hash);
    expect(first.progressHashes[1]).toBe(short.hash);
    const otherSeed = await rtBake(page, { samples: 64, seed: 2 });
    expect(otherSeed.hash).not.toBe(first.hash);
  });

  test('a superseded bake resolves not applied; the shown light is the later bake alone', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030');
    const both = await page.evaluate(() =>
      window.__msFixture!.rt!.bakeTwice({ samples: 64 }, { samples: 16, seed: 3 }),
    );
    expect(both.applied).toEqual([false, true]);
    const alone = await rtBake(page, { samples: 16, seed: 3 });
    expect(both.hash).toBe(alone.hash);
  });

  test('after a pose change the old light stays until the new bake, which equals a fresh bake of the posed document', async ({
    page,
  }) => {
    const held = await render(page, 'variant=player-hold-34&bake=16');
    const before = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    await page.evaluate(() => window.__msFixture!.rt!.pose('wave'));
    expect(await page.evaluate(() => window.__msFixture!.rt!.lightingHash), 'kept across the pose').toBe(before);
    const kept = decodePng(await readPng(page, held.info));
    const rebaked = await rtBake(page, { samples: 16 });
    expect(rebaked.progressHashes[0], 'the first update replaces the old light').not.toBe(before);
    const after = decodePng(await readPng(page, held.info));
    const fresh = await render(page, 'variant=player-hold-34&pose=wave&bake=16');
    expect(await page.evaluate(() => window.__msFixture!.rt!.lightingHash)).toBe(rebaked.hash);
    expect(after.data.equals(fresh.image.data), 'the image of the re-bake equals the fresh bake').toBe(true);
    expect(rebaked.hash, 'the moved arm changes the light').not.toBe(before);
    expect(kept.data.equals(after.data), 'the old light differed under the moved arm').toBe(false);
  });

  test('exact depth key: the catcher never draws over the model', async ({ page }) => {
    const withCatcher = await render(page, 'variant=render-order&bake=16');
    expect(await page.evaluate(() => window.__msFixture!.rt!.depthKeyMode())).toBe('exact');
    const without = await render(page, 'variant=render-order&bake=16&catcher=0');
    const unbaked = await render(page, 'variant=render-order');
    const backdrop = pixel(unbaked.image, 0, 0);
    let model = 0;
    let changed = 0;
    for (let i = 0; i < without.image.data.length; i += 4) {
      const shown = [...without.image.data.subarray(i, i + 3)];
      const plain = [...unbaked.image.data.subarray(i, i + 3)];
      if (near(plain, backdrop, 0)) continue;
      model++;
      if (!withCatcher.image.data.subarray(i, i + 3).every((v, c) => v === shown[c])) changed++;
    }
    expect(model, 'model pixels').toBeGreaterThan(1000);
    expect(changed, 'model pixels the catcher changed').toBe(0);
  });

  test('a lost renderer context re-uploads the light; a lost worker context restarts the bake to the same bytes', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const info = await openFixture(page, '/rt.html?variant=bake-turntable-y030');
    const before = await readPng(page, info);
    await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      await rt.lose();
      await rt.restore();
    });
    expect((await readPng(page, info)).equals(before), 'renderer restore').toBe(true);
    const reference = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    const restarted = await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      const pending = rt.bake({ samples: 64 });
      rt.loseBakerContext();
      return pending;
    });
    expect(restarted.error).toBe('');
    expect(restarted.hash).toBe(reference);
    expect((await readPng(page, info)).equals(before), 'worker restart').toBe(true);
    expect(errors).toEqual([]);
  });

  test('dispose leaves no GL object or image and terminates the worker', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&bake=4&track=1');
    const loaded = await page.evaluate(() => window.__msFixture!.rt!.liveGlObjects());
    expect(loaded).toBeGreaterThan(0);
    await page.evaluate(() => window.__msFixture!.rt!.dispose());
    await page.waitForFunction(() => window.__msFixture!.rt!.bakerTerminated);
    const counts = await page.evaluate(() => ({
      gl: window.__msFixture!.rt!.liveGlObjects(),
      bitmaps: window.__msFixture!.rt!.openBitmaps(),
    }));
    expect(counts).toEqual({ gl: 0, bitmaps: 0 });
  });

  test('setLighting refuses light baked for another layout, size or data length', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&bake=4');
    const hash = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    const taken = await page.evaluate(() =>
      (['key', 'size', 'length'] as const).map((change) => window.__msFixture!.rt!.tryLighting(change)),
    );
    expect(taken).toEqual([false, false, false]);
    expect(await page.evaluate(() => window.__msFixture!.rt!.lightingHash)).toBe(hash);
  });

  test('light baked under one look is refused under a look of another lighting key, taken under its own', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=player-hold-34');
    const taken = await page.evaluate(() => window.__msFixture!.rt!.bakeUnderLook('marketplace'));
    expect(taken).toEqual({ current: false, same: true });
    expect(await page.evaluate(() => window.__msFixture!.rt!.lightingHash)).not.toBe('');
  });

  test('a failed bake keeps the textures it posted: the next bake of the same textures shadows like a fresh one', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=bake-cutout-checker');
    const reference = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    await openFixture(page, '/rt.html?variant=cutout-checker');
    const [failed, next] = await page.evaluate(() => window.__msFixture!.rt!.bakeAfterFailure({ samples: 64 }));
    expect(failed?.error).toMatch(/^SCENE_TOO_LARGE/);
    expect(next?.error).toBe('');
    expect(next?.warnings, 'no texture became a placeholder').toEqual([]);
    expect(next?.hash).toBe(reference);
  });

  test('a bake asked while the worker context is lost waits for the restore and reaches the same bytes', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=bake-turntable-y030');
    const reference = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    const result = await page.evaluate(() => {
      const rt = window.__msFixture!.rt!;
      rt.loseBakerContext();
      return rt.bake({ samples: 64 });
    });
    expect(result.error).toBe('');
    expect(result.hash).toBe(reference);
  });

  test('a loss right before a progress readback restarts the bake instead of posting empty light', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=bake-turntable-y030');
    const reference = await page.evaluate(() => window.__msFixture!.rt!.lightingHash);
    const result = await page.evaluate(() => {
      const rt = window.__msFixture!.rt!;
      rt.loseBakerContext({ beforeMark: 16 });
      return rt.bake({ samples: 64 });
    });
    expect(result.error).toBe('');
    // The update after 4 samples came, the one after 16 was lost; the restarted bake reports 4 and 16 again.
    expect(result.progress).toEqual([4, 4, 16]);
    expect(result.hash).toBe(reference);
  });

  test('a bake whose restored context cannot bake rejects instead of hanging, and so do later bakes', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=bake-turntable-y030');
    const results = await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      rt.loseBakerContext({ failRestore: true });
      const pending = await rt.bake({ samples: 4 });
      return [pending, await rt.bake({ samples: 4 })];
    });
    for (const result of results) expect(result.error).toMatch(/^WEBGL2_UNAVAILABLE: test hook/);
  });

  test('the main-thread block measure sees a long task outside the timed bake work', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&lag=1');
    await page.evaluate(() => {
      window.__msFixture!.rt!.resetLag();
      return window.__msFixture!.rt!.spinMainThread(80);
    });
    // Read in a later task: the long-task entry exists once the busy task ended.
    const block = await page.evaluate(() => window.__msFixture!.rt!.mainThreadBlock());
    console.log(`[rt probe] 80 ms busy task: block ${block.toFixed(1)} ms`);
    expect(block).toBeGreaterThanOrEqual(80);
  });

  test('the budgeted measure (max CPU per main-thread task, traced) sees >= 80 ms of busy work in a timer task and in an evaluate', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030&lag=1');
    // CPU work, not wall time (an interrupted wall-clock spin gets less CPU than its wall time): the iterations one
    // millisecond holds at best, over several samples, times 100, so the task does at least 80 ms of CPU work even if
    // it runs up to 20 % slower than the fastest sample.
    const iterations = await page.evaluate(() => {
      let best = 0;
      for (let sample = 0; sample < 20; sample++) {
        let count = 0;
        let x = 0;
        const end = performance.now() + 5;
        while (performance.now() < end) {
          for (let i = 0; i < 1000; i++) x += Math.sqrt(i + x);
          count++;
        }
        best = Math.max(best, count / 5);
        if (x < 0) return 0;
      }
      return Math.ceil(best * 100);
    });
    const timer = await traceMainThread(page, () =>
      page.evaluate(
        (count) =>
          new Promise<number>((resolve) =>
            setTimeout(() => {
              let x = 0;
              for (let n = 0; n < count; n++) for (let i = 0; i < 1000; i++) x += Math.sqrt(i + x);
              resolve(x);
            }, 0),
          ),
        iterations,
      ),
    );
    // The bench calls bake() from a Playwright evaluate, which the Long Tasks API does not report: the trace must.
    const evaluate = await traceMainThread(page, () =>
      page.evaluate((count) => {
        let x = 0;
        for (let n = 0; n < count; n++) for (let i = 0; i < 1000; i++) x += Math.sqrt(i + x);
        return x;
      }, iterations),
    );
    console.log(
      `[rt probe] 100 ms of busy work at best speed, max CPU per task: timer task ${timer.maxCpu.toFixed(1)} ms, evaluate ` +
        `${evaluate.maxCpu.toFixed(1)} ms`,
    );
    expect(timer.maxCpu).toBeGreaterThanOrEqual(80);
    expect(evaluate.maxCpu).toBeGreaterThanOrEqual(80);
    expect(timer.maxBlocking).toBeGreaterThanOrEqual(80);
    expect(evaluate.maxBlocking).toBeGreaterThanOrEqual(80);
  });

  test('the budgeted measure also counts a synchronous wait for the GPU process, which CPU time alone misses', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?scene=bench&size=512');
    let call = 0;
    // Heavy draws queued, then a readback: the main thread waits until the GPU process has drawn them.
    const trace = await traceMainThread(page, async () => {
      call = await page.evaluate(() => {
        const rt = window.__msFixture!.rt!;
        const canvas = document.querySelector('canvas')!;
        const gl = canvas.getContext('webgl2')!;
        for (let i = 0; i < 4; i++) rt.render();
        const start = performance.now();
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array(canvas.width * canvas.height * 4),
        );
        return performance.now() - start;
      });
    });
    console.log(
      `[rt probe] readPixels after heavy draws: call ${call.toFixed(1)} ms, traced GPU wait ` +
        `${trace.maxGpuWait.toFixed(1)} ms, CPU ${trace.maxCpu.toFixed(1)} ms, blocking ${trace.maxBlocking.toFixed(1)} ms`,
    );
    expect(call, 'the readback really waits').toBeGreaterThan(100);
    expect(trace.maxGpuWait, 'the trace sees the wait').toBeGreaterThanOrEqual(0.9 * call);
    expect(trace.maxCpu, 'CPU time alone would not').toBeLessThan(trace.maxGpuWait / 2);
    expect(trace.maxBlocking).toBeGreaterThanOrEqual(0.9 * call);
  });

  test('banded light upload: frames keep the complete light until the next is in, whatever happens mid-upload', async ({
    page,
  }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030');
    const s = await page.evaluate(() => window.__msFixture!.rt!.uploadStates());
    expect(new Set([s.unbaked, s.refA, s.refC]).size, 'three distinct frames').toBe(3);
    expect(s.midB, 'one budget into B the frame still shows A').toBe(s.refA);
    expect(s.midBPending).toBe(true);
    expect(s.afterC, 'C set mid-upload, drained').toBe(s.refC);
    expect(s.afterNull, 'null mid-upload').toBe(s.unbaked);
    expect(s.nullPending).toBe(false);
    expect(s.otherFrame, 'another layout mid-upload draws unbaked').toBe(s.otherUnbaked);
    expect(s.otherPending).toBe(false);
    expect(s.restored, 'context restored mid-upload: the retained C, whole').toBe(s.refC);
    expect(s.restoredPending).toBe(false);
  });

  test('no bake ray reaches the per-ray node cap: benchmark scene and the cut-out plant field', async ({ page }) => {
    await openFixture(page, '/rt.html?variant=turntable-y030');
    const counts = await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      return {
        bench: await rt.bakeCapped('bench', 4),
        grass: await rt.bakeCapped('grass-field', 1),
        cubes: await rt.bakeCapped('coincident-cubes', 1),
      };
    });
    console.log(`[rt probe] capped bake texels: ${JSON.stringify(counts)}`);
    expect(counts.bench).toEqual({ texels: 0, error: '' });
    expect(counts.grass).toEqual({ texels: 0, error: '' });
    // The hook counts: 10 000 coincident cubes reach the cap.
    expect(counts.cubes.texels).toBeGreaterThan(0);
  });

  test.describe('hostile input', () => {
    test('10 000 coincident cubes bake a sample without losing a context', async ({ page }) => {
      await openFixture(page, '/rt.html?variant=turntable-y030');
      const result = await page.evaluate(() => window.__msFixture!.rt!.bakeScene('coincident-cubes', 1));
      expect(result.error).toBe('');
      expect(result.applied).toBe(true);
      expect(await page.evaluate(() => window.__msFixture!.rt!.contextLost)).toBe(false);
    });

    test('a lightmap over MAX_LIGHTMAP_TEXELS is refused with SCENE_TOO_LARGE by the bake and the renderer', async ({
      page,
    }) => {
      await openFixture(page, '/rt.html?variant=turntable-y030');
      const result = await page.evaluate(() => window.__msFixture!.rt!.bakeScene('lightmap-overflow', 1));
      expect(result.error).toMatch(/^SCENE_TOO_LARGE: the lightmap needs more than 2097152 texels/);
      await expect(openFixture(page, '/rt.html?scene=lightmap-overflow')).rejects.toThrow(/lightmap needs more/);
    });

    test('a corrupt texture bakes with the placeholder and a warning', async ({ page }) => {
      await openFixture(page, '/rt.html?variant=turntable-y030');
      const result = await page.evaluate(() => window.__msFixture!.rt!.bakeScene('hostile-corrupt-data', 1));
      expect(result.error).toBe('');
      expect(result.warnings).toEqual([{ code: 'TEXTURE_DECODE_FAILED', texture: 0 }]);
    });

    test('an empty scene bakes without a catcher (nothing casts on it): the backdrop stays', async ({ page }) => {
      const plain = await render(page, 'scene=empty');
      const baked = await render(page, 'scene=empty&bake=64');
      let worst = 0;
      for (let i = 0; i < plain.image.data.length; i++) {
        worst = Math.max(worst, Math.abs((plain.image.data[i] ?? 0) - (baked.image.data[i] ?? 0)));
      }
      console.log(`[rt probe] empty scene: largest backdrop change ${worst} levels / max 2`);
      expect(worst).toBeLessThanOrEqual(2);
    });
  });

  test('the bake fetches nothing but the page and its own modules', async ({ page }) => {
    const requests: string[] = [];
    page.context().on('request', (request) => requests.push(request.url()));
    await openFixture(page, '/rt.html?variant=bake-turntable-y030');
    const origin = new URL(page.url()).origin;
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((url) => !url.startsWith(`${origin}/`))).toEqual([]);
  });
});

/**
 * Edge rounding (MS-15) on the `edges` scene: the pixels of the plane, the card and the sphere (those that change when
 * the mesh is hidden) are byte-identical with rounding on and off, and every pixel rounding changes lies within the
 * projected rounding band (+ 2 px) of a sharp edge of the cube or the wedge.
 */
test.describe('rounded edges', () => {
  test.describe.configure({ timeout: 120_000 });
  for (const [label, query] of [
    ['float', ''],
    ['fallback', '&fallback=1'],
  ] as const) {
    test(`${label}: planes, cards and smooth areas do not change; sharp-edged meshes change only beside their edges`, async ({
      page,
    }) => {
      const off = await render(page, `variant=edges&edges=0${query}`);
      const on = await render(page, `variant=edges${query}`);
      const pixelsOf = async (mesh: string) =>
        differenceMask(off.image, (await render(page, `variant=edges&edges=0&hide=${mesh}${query}`)).image);
      // MSAA silhouette pixels of the cube or the wedge over another mesh belong to both; they are the cube's.
      const sharpMeshes = [await pixelsOf('cube'), await pixelsOf('wedge')];
      const rounded = differenceMask(on.image, off.image);
      for (const mesh of ['plane', 'card', 'sphere']) {
        const own = await pixelsOf(mesh);
        for (const other of sharpMeshes) for (let p = 0; p < own.length; p++) if (other[p]) own[p] = 0;
        const shown = own.reduce((sum, v) => sum + v, 0);
        expect(shown, `${mesh}: pixels`).toBeGreaterThan(200);
        let changed = 0;
        for (let p = 0; p < own.length; p++) if (own[p] && rounded[p]) changed++;
        console.log(`[edges probe] ${label} ${mesh}: ${changed} of ${shown} pixels change with rounding / max 0`);
        expect(changed, `${mesh}: pixels changed by rounding`).toBe(0);
      }
      const segments = await page.evaluate(
        (edges) =>
          edges.map(
            ([a, b]) =>
              [window.__msFixture!.rt!.project(...a), window.__msFixture!.rt!.project(...b)] as [
                [number, number],
                [number, number],
              ],
          ),
        edgesSceneSharpEdges(),
      );
      // The band's width on screen: 0.5 units (EDGE_LOOK_V0) along any axis at any edge's midpoint, the largest.
      const band = await page.evaluate((edges) => {
        const rt = window.__msFixture!.rt!;
        let widest = 0;
        for (const [a, b] of edges) {
          const mid = [0, 1, 2].map((k) => ((a[k] ?? 0) + (b[k] ?? 0)) / 2) as [number, number, number];
          const [x, y] = rt.project(...mid);
          for (const axis of [0, 1, 2]) {
            const moved = [...mid] as [number, number, number];
            moved[axis] = (moved[axis] ?? 0) + 0.5;
            const [mx, my] = rt.project(...moved);
            widest = Math.max(widest, Math.hypot(mx - x, my - y));
          }
        }
        return widest;
      }, edgesSceneSharpEdges());
      const changed = differenceMask(on.image, off.image);
      const total = changed.reduce((sum, v) => sum + v, 0);
      const far = pixelsFarFrom(changed, on.image.width, segments, band + 2);
      console.log(
        `[edges probe] ${label}: ${total} pixels change, ${far} farther than ${(band + 2).toFixed(2)} px from a sharp edge`,
      );
      expect(total, 'rounding changes the cube and the wedge').toBeGreaterThan(100);
      expect(far, 'changed pixels away from every sharp edge').toBe(0);
    });
  }

  test('a cube edge facing the key is brighter than its face centre', async ({ page }) => {
    const { image } = await render(page, 'variant=edges');
    const at = async (x: number, y: number, z: number) => {
      const [px, py] = await page.evaluate((p) => window.__msFixture!.rt!.project(...p), [x, y, z] as const);
      return luminance(pixel(image, px, py));
    };
    // The cube's up face (y 8) beside its south edge (z 10), inside the 0.5-unit band, and its centre.
    const edge = await at(-8, 8, 9.85);
    const centre = await at(-8, 8, 6);
    console.log(`[edges probe] up face beside the south edge ${edge.toFixed(1)}, centre ${centre.toFixed(1)}`);
    expect(edge).toBeGreaterThan(centre + 1);
    const flat = await render(page, 'variant=edges&edges=0');
    const [px, py] = await page.evaluate(() => window.__msFixture!.rt!.project(-8, 8, 9.85));
    expect(luminance(pixel(flat.image, px, py)), 'unrounded: as the centre').toBeLessThan(centre + 1);
  });

  test('setEdges: a width is a uniform, an angle detects again, a bad value names its field', async ({ page }) => {
    const off = await render(page, 'variant=edges&edges=0');
    const info = (await render(page, 'variant=edges')).info;
    const initial = await readPng(page, info);
    const set = (edges: { width?: number; sharpAngleDeg?: number }) =>
      page.evaluate((e) => window.__msFixture!.rt!.setEdges(e), edges);
    expect(await set({ width: 0 })).toBe('ok');
    expect((await readPng(page, info)).equals(off.png), 'width 0 draws as edges=0').toBe(true);
    expect(await set({ width: 0.5 })).toBe('ok');
    expect((await readPng(page, info)).equals(initial)).toBe(true);
    // 100 degrees: the cube's 90-degree edges are no longer sharp, the wedge's 135-degree ones still are.
    expect(await set({ sharpAngleDeg: 100 })).toBe('ok');
    const steep = decodePng(await readPng(page, info));
    expect(differingPixels(steep, decodePng(initial))).toBeGreaterThan(50);
    expect(differingPixels(steep, off.image)).toBeGreaterThan(50);
    expect(await set({ sharpAngleDeg: 30 })).toBe('ok');
    expect((await readPng(page, info)).equals(initial)).toBe(true);
    expect(await set({ width: -1 })).toMatch(/^RangeError: edges\.width must be a finite number in 0\.\.4/);
    expect(await set({ width: Number.NaN })).toMatch(/edges\.width/);
    expect(await set({ sharpAngleDeg: 180 })).toMatch(/^RangeError: edges\.sharpAngleDeg/);
    expect((await readPng(page, info)).equals(initial), 'a rejected value changes nothing').toBe(true);
    await expect(openFixture(page, '/rt.html?variant=edges&edges=5')).rejects.toThrow(/query parameter edges/);
  });

  test('a lost and restored context uploads the edge attributes again: the same bytes', async ({ page }) => {
    const info = await openFixture(page, '/rt.html?variant=edges');
    const before = await readPng(page, info);
    await page.evaluate(async () => {
      const rt = window.__msFixture!.rt!;
      await rt.lose();
      await rt.restore();
    });
    expect((await readPng(page, info)).equals(before)).toBe(true);
  });
});
