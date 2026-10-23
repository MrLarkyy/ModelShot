import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, type ConsoleMessage, type Page, type Request, type Response, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareImages } from './compareImages';
import { mayWriteGolden, resolveGolden } from './goldenStore';
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

/** The fixture module sets `__msFixture` as it evaluates, before any scene work: a page without it after this long never ran it. */
const FIXTURE_BOOT_MS = 20_000;

interface BootTrace {
  pageErrors: string[];
  failedRequests: string[];
  errorResponses: string[];
  consoleErrors: string[];
}

function describeBoot(trace: BootTrace): string {
  const list = (items: string[]): string => items.join(' | ') || 'none';
  return (
    `page errors: ${list(trace.pageErrors)}; failed requests: ${list(trace.failedRequests)}; ` +
    `responses >= 400: ${list(trace.errorResponses)}; console errors: ${list(trace.consoleErrors)}`
  );
}

/**
 * Opens a fixture page. Once (pt-gltf-contact in a full pathtracer.spec run) a page loaded but its fixture module never
 * ran, and the wait sat until the 120 s test timeout. The cause is unknown: no dependency is pre-bundled, so it is not
 * a stale Vite optimised dep; a module request that failed after `goto` returned fits it. So the page's failed
 * requests, error responses and console errors are collected with its page errors from before `goto`, and printed
 * under `[fixture reload]` at the first boot timeout, so the flake leaves a trace with `retries: 0`. A page error means
 * the fixture's own code threw, which a reload would not fix: that fails at once. Otherwise the page reloads once; a
 * second boot timeout fails with everything collected only in a test whose timeout leaves room for it (45 s or more,
 * e.g. the 120 s path-tracer describes). Under the 30 s default the test timeout ends the second wait first, and the
 * `[fixture reload]` line is the trace.
 */
export async function openFixture(page: Page, url: string): Promise<FixtureInfo> {
  const trace: BootTrace = { pageErrors: [], failedRequests: [], errorResponses: [], consoleErrors: [] };
  const onPageError = (error: Error): void => void trace.pageErrors.push(error.message);
  const onRequestFailed = (request: Request): void =>
    void trace.failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'no reason'})`);
  const onResponse = (response: Response): void => {
    if (response.status() >= 400) trace.errorResponses.push(`${response.status()} ${response.url()}`);
  };
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') trace.consoleErrors.push(message.text());
  };
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('console', onConsole);
  try {
    await page.goto(url);
    const booted = () =>
      page.waitForFunction(() => window.__msFixture !== undefined, undefined, { timeout: FIXTURE_BOOT_MS });
    try {
      await booted();
    } catch {
      const seen = describeBoot(trace);
      if (trace.pageErrors.length > 0) {
        throw new Error(`fixture ${url} did not boot in ${FIXTURE_BOOT_MS} ms after a page error; ${seen}`);
      }
      console.warn(`[fixture reload] ${url} did not boot in ${FIXTURE_BOOT_MS} ms, reloading once; ${seen}`);
      await page.reload();
      await booted().catch(() => {
        throw new Error(`fixture ${url} did not boot after a reload; ${describeBoot(trace)}`);
      });
    }
  } finally {
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('console', onConsole);
  }
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
  const resolution = resolveGolden(goldenSpec, png, {
    updateMode: testInfo.config.updateSnapshots,
    ci: Boolean(process.env['CI']),
    allowUpdate: mayWriteGolden(options),
    specFile: basename(testInfo.file).replace(/\.ts$/, ''),
  });
  if (resolution.written) return;

  const result = compareImages(png, resolution.expected, compareOptions);
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
