import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../src/harnessTest';
import { checkBudgets, loadBudgets, type Measured } from '../src/budgets';
import { measureBundle } from '../src/bundleSize';
import { openFixture } from '../src/expectGolden';
import { median } from '../src/measure';

test('frame time, time to samples and bundle size stay inside budgets.json', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await openFixture(page, '/gradient.html');
  const frames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  const rtBench = await openFixture(page, '/rt.html?scene=bench&size=512');
  expect([rtBench.width, rtBench.height]).toEqual([512, 512]);
  const rtFrames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  await openFixture(page, '/progressive.html?seed=7&samples=64');
  const runs = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.timeToSamples) throw new Error('sample bench missing');
    return [fixture.timeToSamples(64), fixture.timeToSamples(64), fixture.timeToSamples(64)];
  });

  const [app, embed] = await Promise.all([measureBundle('app'), measureBundle('embed')]);

  const measured: Measured = {
    frameTimeMs: { 'gradient-256': median(frames), 'rt-bench-512': median(rtFrames) },
    timeToSamplesMs: { 'progressive-256-n64': median(runs) },
    bundleGzipBytes: { app: app.gzipBytes, embed: embed.gzipBytes },
  };
  const json = JSON.stringify(measured, null, 2);
  writeFileSync(join(testInfo.project.outputDir, 'budgets-measured.json'), json);
  await testInfo.attach('budgets-measured', { body: json, contentType: 'application/json' });

  const violations = checkBudgets(loadBudgets(), measured);
  expect(violations.map((v) => v.message)).toEqual([]);
});
