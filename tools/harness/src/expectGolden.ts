import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from './compareImages';
import { resolveGolden } from './goldenStore';
import { assertSampleCount } from './sampleCount';
import { fixtureUrl, validateSpec, type GoldenSpec } from './goldenSpec';

export interface ExpectGoldenOptions {
  allowUpdate?: boolean;
  compareAgainst?: GoldenSpec;
}

export interface FixtureInfo {
  renderer: string;
  floatRenderTargets: boolean;
  width: number;
  height: number;
  samplesDone: number;
  rgba: string;
}

export async function openFixture(page: Page, url: string): Promise<FixtureInfo> {
  await page.goto(url);
  await page.waitForFunction(() => window.__msFixture !== undefined);
  const info = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture) throw new Error('fixture API missing');
    await fixture.ready;
    return {
      renderer: fixture.renderer,
      floatRenderTargets: fixture.floatRenderTargets,
      width: fixture.width,
      height: fixture.height,
      samplesDone: fixture.samplesDone,
      rgba: fixture.readRGBA(),
    };
  });
  assertSwiftShader(info.renderer);
  return info;
}

export function assertSwiftShader(renderer: string): void {
  if (!/SwiftShader/i.test(renderer)) {
    throw new Error(`goldens must be rendered on SwiftShader, the WebGL renderer is "${renderer}"`);
  }
}

export function encodeFlipped(info: FixtureInfo): Buffer {
  const src = Buffer.from(info.rgba, 'base64');
  const rowBytes = info.width * 4;
  if (src.length !== rowBytes * info.height) throw new Error('fixture pixel buffer has an unexpected size');
  const png = new PNG({ width: info.width, height: info.height });
  for (let y = 0; y < info.height; y++) {
    src.copy(png.data, (info.height - 1 - y) * rowBytes, y * rowBytes, (y + 1) * rowBytes);
  }
  return PNG.sync.write(png);
}

export async function renderFixture(page: Page, spec: GoldenSpec): Promise<{ png: Buffer; info: FixtureInfo }> {
  const info = await openFixture(page, fixtureUrl(spec));
  if (spec.kind === 'pathtraced') assertSampleCount(spec.samples, info.samplesDone);
  return { png: encodeFlipped(info), info };
}

export async function expectGolden(
  page: Page,
  testInfo: TestInfo,
  spec: GoldenSpec,
  options: ExpectGoldenOptions = {},
): Promise<void> {
  validateSpec(spec);
  const goldenSpec = options.compareAgainst ?? spec;
  const { png } = await renderFixture(page, spec);
  const compareOptions = {
    ...(spec.tolerance?.threshold !== undefined ? { threshold: spec.tolerance.threshold } : {}),
    ...(spec.tolerance?.maxDiffRatio !== undefined ? { maxDiffRatio: spec.tolerance.maxDiffRatio } : {}),
    ...(spec.tolerance?.maxMeanDelta !== undefined ? { maxMeanDelta: spec.tolerance.maxMeanDelta } : {}),
  };
  let result: ReturnType<typeof compareImages> | undefined;
  const resolution = resolveGolden(
    goldenSpec,
    png,
    {
      updateMode: testInfo.config.updateSnapshots,
      ci: Boolean(process.env['CI']),
      allowUpdate: options.allowUpdate ?? true,
      specFile: basename(testInfo.file).replace(/\.ts$/, ''),
    },
    (expected) => {
      result = compareImages(png, expected, compareOptions);
      return !result.pass;
    },
  );
  if (resolution.written) return;

  result ??= compareImages(png, resolution.expected, compareOptions);
  if (result.pass) return;

  const base = testInfo.outputDir;
  mkdirSync(base, { recursive: true });
  const artefacts = {
    actual: join(base, `${spec.name}-actual.png`),
    expected: join(base, `${spec.name}-expected.png`),
    diff: join(base, `${spec.name}-diff.png`),
  };
  writeFileSync(artefacts.actual, png);
  writeFileSync(artefacts.expected, resolution.expected);
  writeFileSync(artefacts.diff, result.diffPng);
  for (const [name, path] of Object.entries(artefacts)) {
    await testInfo.attach(`${spec.name}-${name}`, { path, contentType: 'image/png' });
  }
  expect(
    result.pass,
    `${spec.name}: ${result.diffPixels} pixels differ (ratio ${result.ratio.toFixed(5)}), mean delta ${result.meanDelta.toFixed(3)} levels; diff image ${artefacts.diff}`,
  ).toBe(true);
}
