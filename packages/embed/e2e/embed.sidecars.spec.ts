import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import {
  FRAME_ORIGIN,
  HOST_ORIGIN,
  addViewer,
  cspViolations,
  expect,
  frameAlert,
  hostRequests,
  openHost,
  shot,
  test,
  viewerFrame,
  waitForEvent,
  type Rgba,
} from './embedTest';

const TEXTURE = PNG.sync.read(
  readFileSync(join(import.meta.dirname, 'fixtures', 'sidecars', 'textures', 'checker tile.png')),
);
/** The checker's two colours, read from the texture itself. */
const CHECKER = [0, 1].map((x) => [...TEXTURE.data.subarray(x * 4, x * 4 + 3)] as [number, number, number]);

function hue([r, g, b]: readonly number[]): { hue: number; saturation: number; value: number } {
  const max = Math.max(r!, g!, b!);
  const min = Math.min(r!, g!, b!);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g! - b!) / delta) % 6;
    else if (max === g) h = (b! - r!) / delta + 2;
    else h = (r! - g!) / delta + 4;
  }
  return { hue: (h * 60 + 360) % 360, saturation: max === 0 ? 0 : delta / max, value: max / 255 };
}

/** Pixels whose hue is within 20 degrees of `colour`'s and that are clearly coloured: lighting changes only brightness. */
function countHue(image: Rgba, colour: readonly number[]): number {
  const want = hue(colour).hue;
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const seen = hue([image.data[i]!, image.data[i + 1]!, image.data[i + 2]!]);
    const apart = Math.min(Math.abs(seen.hue - want), 360 - Math.abs(seen.hue - want));
    if (apart <= 20 && seen.saturation > 0.45 && seen.value > 0.15) count++;
  }
  return count;
}

async function expectCheckerDrawn(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const image = await shot(page);
        return CHECKER.map((colour) => countHue(image, colour) >= 50);
      },
      { timeout: 120_000, message: 'both checker colours on screen' },
    )
    .toEqual([true, true]);
}

test('a .gltf with an external buffer and image loads by URL, its files asked only of the model server', async ({
  page,
  seen,
  request,
  context,
}) => {
  await context.addCookies([{ name: 'session', value: 'secret', url: HOST_ORIGIN }]);
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/sidecars/gltf/scene.gltf`, loading: 'eager' });
  await waitForEvent(page, 'load');
  await expect(viewerFrame(page).locator('#stage')).toHaveAttribute('data-state', 'shown');
  await expectCheckerDrawn(page);

  const asked = (await hostRequests(request)).filter((r) => r.path.startsWith('/sidecars/'));
  expect(asked).toEqual(
    ['/sidecars/gltf/scene.gltf', '/sidecars/gltf/bin/scene.bin', '/sidecars/textures/checker%20tile.png'].map(
      (path) => ({ method: 'GET', path, cookie: null, referer: null, origin: FRAME_ORIGIN }),
    ),
  );
  for (const r of seen) {
    const url = new URL(r.url);
    if (url.protocol === 'blob:' || url.protocol === 'data:') continue;
    expect([HOST_ORIGIN, FRAME_ORIGIN], `${r.url}: no third origin`).toContain(url.origin);
  }
  expect(await cspViolations(page)).toEqual([]);
});

test('an .obj with its material library and texture loads by URL, the texture relative to the library', async ({
  page,
  request,
}) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/sidecars/obj/scene.obj`, loading: 'eager' });
  await waitForEvent(page, 'load');
  await expectCheckerDrawn(page);
  const asked = (await hostRequests(request)).filter((r) => r.path.startsWith('/sidecars/'));
  expect(asked.map((r) => [r.method, r.path])).toEqual([
    ['GET', '/sidecars/obj/scene.obj'],
    ['GET', '/sidecars/obj/scene.mtl'],
    ['GET', '/sidecars/textures/checker%20tile.png'],
  ]);
});

for (const [model, code] of [
  ['absolute.gltf', 'SIDECAR_REFUSED'],
  ['protocol-relative.gltf', 'SIDECAR_REFUSED'],
  ['backslash.gltf', 'SIDECAR_REFUSED'],
  ['javascript.gltf', 'SIDECAR_REFUSED'],
  ['file.gltf', 'SIDECAR_REFUSED'],
  ['data-mtllib.obj', 'SIDECAR_REFUSED'],
  ['many.gltf', 'TOO_MANY_SIDECARS'],
] as const) {
  test(`hostile/${model} fails with ${code} before any request but the model's`, async ({ page, request, seen }) => {
    await openHost(page);
    await addViewer(page, { model: `${HOST_ORIGIN}/hostile/${model}`, loading: 'eager' });
    expect(await frameAlert(viewerFrame(page), 60_000)).toMatch(new RegExp(`^${code}: `));
    expect((await waitForEvent(page, 'error', 60_000)).detail.code).toBe(code);
    const asked = (await hostRequests(request)).filter((r) => !['/host.html', '/__requests'].includes(r.path));
    expect(asked.map((r) => [r.method, r.path])).toEqual([['GET', `/hostile/${model}`]]);
    expect(seen.filter((r) => /localhost|passwd|t\d+\.png|scene\.(bin|mtl)/.test(r.url)).map((r) => r.url)).toEqual([]);
  });
}

test('a texture served without Access-Control-Allow-Origin is explained as CORS, naming the texture', async ({
  page,
}) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/sidecars-partial/gltf/scene.gltf`, loading: 'eager' });
  const alert = await frameAlert(viewerFrame(page), 60_000);
  expect(alert).toMatch(/^MODEL_CORS_BLOCKED: /);
  expect(alert).toContain(`${HOST_ORIGIN}/sidecars-partial/textures/checker%20tile.png`);
  expect(alert).toContain('Access-Control-Allow-Origin');
});
