import { expect, test } from '../src/harnessTest';
import { encodeFlipped, openFixture, type FixtureInfo } from '../src/expectGolden';
import type { Page } from '@playwright/test';

const QUERY = 'variant=edges&seed=1&samples=4';

async function readPng(page: Page, info: FixtureInfo): Promise<Buffer> {
  const now = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    return { rgba: fixture.readRGBA(), width: fixture.width, height: fixture.height };
  });
  return encodeFlipped({ ...info, ...now });
}

test.describe('path tracer setEdges rewrites the attribute rows in place', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a new angle renders byte for byte as a reload of the scene at that angle', async ({ page }) => {
    const info = await openFixture(page, `/pt.html?${QUERY}`);
    const initial = encodeFlipped(info);
    await page.evaluate(() => window.__msFixture!.pt!.setEdges({ sharpAngleDeg: 100 }));
    const rewritten = await readPng(page, info);
    expect(rewritten.equals(initial), 'the angle changes the picture').toBe(false);
    expect(await page.evaluate(() => window.__msFixture!.pt!.reloadScene())).toBe(true);
    expect((await readPng(page, info)).equals(rewritten)).toBe(true);
    await page.evaluate(() => window.__msFixture!.pt!.setEdges({ sharpAngleDeg: 30 }));
    expect((await readPng(page, info)).equals(initial)).toBe(true);
  });

  test('a pose overlapped by a new angle keeps its borrowed textures and renders the new angle', async ({ page }) => {
    const info = await openFixture(page, `/pt.html?${QUERY}`);
    const during = await page.evaluate(() => window.__msFixture!.pt!.poseDuringEdges({ sharpAngleDeg: 100 }));
    expect(during.applied).toBe(true);
    expect(during.layerUploads).toBe(0);
    const posed = await readPng(page, info);
    expect(await page.evaluate(() => window.__msFixture!.pt!.reloadScene())).toBe(true);
    expect((await readPng(page, info)).equals(posed)).toBe(true);
  });
});
