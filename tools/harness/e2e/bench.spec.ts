import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../src/harnessTest';
import { budgetReport, checkBudgets, loadBudgets, type Measured } from '../src/budgets';
import { measureBundle } from '../src/bundleSize';
import { openFixture } from '../src/expectGolden';
import { median } from '../src/measure';

test('frame time, time to samples and bundle size stay inside budgets.json', async ({ page }, testInfo) => {
  // The path-tracer runs and the bakes take seconds each on SwiftShader, and a CI runner is 3-5x slower than the dev
  // machine.
  test.setTimeout(600_000);

  await openFixture(page, '/gradient.html');
  const frames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  const rtBench = await openFixture(page, '/rt.html?scene=bench&size=512');
  expect([rtBench.width, rtBench.height]).toEqual([512, 512]);
  // 128 group nodes, one batch each, drawn front and back in the opaque and the transparency pass.
  expect(await page.evaluate(() => window.__msFixture?.rt?.drawCallsPerFrame())).toBe(128 * 2 * 2);
  const rtFrames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  // The same scene with one mesh at render order 1: every frame uses the exact depth key (gl_FragDepth).
  await openFixture(page, '/rt.html?scene=bench-order&size=512');
  expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('exact');
  const rtOrderFrames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  // Load and first frame of a scene at the loader's limits with render order: decode, upload, the exact key's
  // de-indexed geometry, one frame.
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const loadMs = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture?.timeScene) throw new Error('scene bench missing');
    return fixture.timeScene();
  });

  await openFixture(page, '/progressive.html?seed=7&samples=64');
  const runs = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.timeToSamples) throw new Error('sample bench missing');
    return [fixture.timeToSamples(64), fixture.timeToSamples(64), fixture.timeToSamples(64)];
  });

  // The path tracer on the same benchmark scene: 256 seeded samples at 128 x 128 (tiles of 256, so one draw call per
  // sample), until the GPU finished; median of 3.
  await openFixture(page, '/pt.html?scene=bench&size=128&samples=1');
  const ptRuns = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.timeToSamples) throw new Error('sample bench missing');
    return [fixture.timeToSamples(256), fixture.timeToSamples(256), fixture.timeToSamples(256)];
  });

  // Path-tracer load at the loader's limits: validate, flatten, build the BVH of 200 000 triangles, upload, one sample.
  await openFixture(page, '/pt.html?scene=empty&size=128&samples=1');
  const ptLoadMs = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture?.timeScene) throw new Error('scene bench missing');
    return fixture.timeScene();
  });
  expect(await page.evaluate(() => window.__msFixture?.pt?.triangles)).toBe(200_000);

  // The light bake of the benchmark scene in its worker: 16 samples with the shadow catcher, from bake() to the final
  // lighting, median of 3; and the main thread's longest event-loop lag over those bakes (posting, three progress
  // uploads per bake, drawing them).
  await openFixture(page, '/rt.html?scene=bench&lag=1');
  const bake = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture?.timeBake || !fixture.rt) throw new Error('bake bench missing');
    fixture.rt.resetLag();
    const runs = [await fixture.timeBake(), await fixture.timeBake(), await fixture.timeBake()];
    return { runs, lag: fixture.rt.maxLag() };
  });
  console.log(`[bench] bake runs ${bake.runs.map((ms) => ms.toFixed(0)).join(', ')} ms, main-thread lag ${bake.lag.toFixed(1)} ms`);

  const [app, embed] = await Promise.all([measureBundle('app'), measureBundle('embed')]);

  const measured: Measured = {
    frameTimeMs: {
      'gradient-256': median(frames),
      'rt-bench-512': median(rtFrames),
      'rt-bench-order-512': median(rtOrderFrames),
      'rt-load-first-frame-200k-order': loadMs,
      'pt-load-200k': ptLoadMs,
    },
    timeToSamplesMs: { 'progressive-256-n64': median(runs), 'pt-bench-128-n256': median(ptRuns) },
    bundleGzipBytes: { app: app.gzipBytes, embed: embed.gzipBytes },
    bakeTimeMs: { 'bake-bench-n16': median(bake.runs) },
    mainThreadBlockMs: { 'bake-bench': bake.lag },
  };
  const json = JSON.stringify(measured, null, 2);
  writeFileSync(join(testInfo.project.outputDir, 'budgets-measured.json'), json);
  await testInfo.attach('budgets-measured', { body: json, contentType: 'application/json' });

  const budgets = loadBudgets();
  for (const line of budgetReport(budgets, measured)) {
    console.log(`[budget] ${line}`);
    testInfo.annotations.push({ type: 'budget', description: line });
  }
  const violations = checkBudgets(budgets, measured);
  expect(violations.map((v) => v.message)).toEqual([]);
});
