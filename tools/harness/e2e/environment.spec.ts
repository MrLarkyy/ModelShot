import { expect, test } from '@playwright/test';
import { assertSwiftShader, openFixture } from '../src/expectGolden';

test('the browser renders WebGL2 on SwiftShader with float render targets', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  const info = await openFixture(page, '/progressive.html?seed=1&samples=1');
  expect(() => assertSwiftShader(info.renderer)).not.toThrow();
  expect(info.floatRenderTargets).toBe(true);
  expect([...origins]).toEqual(['http://127.0.0.1:4410']);
});

test('a hardware renderer name is rejected', () => {
  expect(() => assertSwiftShader('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11)')).toThrow(/SwiftShader/);
});

test('the fixture rejects out of range or malformed parameters', async ({ page }) => {
  for (const query of [
    'seed=1&samples=0',
    'seed=1&samples=4097',
    'seed=-1&samples=4',
    'seed=x&samples=4',
    'samples=4',
  ]) {
    await expect(openFixture(page, `/progressive.html?${query}`), query).rejects.toThrow(/query parameter/);
  }
  await expect(openFixture(page, '/gradient.html?variant=nope')).rejects.toThrow(/unknown variant/);
});
