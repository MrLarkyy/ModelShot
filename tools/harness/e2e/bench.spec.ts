import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../src/harnessTest';
import { budgetReport, checkBudgets, loadBudgets, type Measured } from '../src/budgets';
import { measureBundle } from '../src/bundleSize';
import { openFixture } from '../src/expectGolden';
import { median } from '../src/measure';

test('frame time, time to samples and bundle size stay inside budgets.json', async ({ page }, testInfo) => {
  // The path-tracer runs and the bakes take seconds each on SwiftShader, and a CI runner is 3-5x slower than the dev
  // machine. Room for three bakes at their budget max plus everything else, so a slow bake fails its budget, not the
  // test timeout.
  const budgets = loadBudgets();
  const bakeMax = budgets.bakeTimeMs['bake-bench-n16']?.max ?? 0;
  test.setTimeout(3 * bakeMax + 300_000);

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
  // Each run is checked against the budget as it completes.
  await openFixture(page, '/rt.html?scene=bench&lag=1');
  await page.evaluate(() => window.__msFixture?.rt?.resetLag());
  const bakeRuns: number[] = [];
  for (let run = 0; run < 3; run++) {
    const ms = await page.evaluate(async () => {
      const fixture = window.__msFixture;
      if (!fixture?.timeBake) throw new Error('bake bench missing');
      return fixture.timeBake();
    });
    expect(ms, `bake run ${run + 1}: ${ms.toFixed(0)} ms / max ${bakeMax}`).toBeLessThanOrEqual(bakeMax);
    bakeRuns.push(ms);
  }
  // The block is the page's own work (long tasks, the bake calls and updates); the heartbeat lag is printed beside it
  // but also counts the time SwiftShader's GPU process takes every core from the page (eventLoopLag.ts).
  const bakeBlock = await page.evaluate(() => ({
    block: window.__msFixture?.rt?.mainThreadBlock() ?? -1,
    lag: window.__msFixture?.rt?.maxLag() ?? -1,
  }));
  console.log(
    `[bench] bake runs ${bakeRuns.map((ms) => ms.toFixed(0)).join(', ')} ms, main-thread block ` +
      `${bakeBlock.block.toFixed(1)} ms (heartbeat lag ${bakeBlock.lag.toFixed(1)} ms)`,
  );

  // What bake() itself costs the main thread for a document at the loaders' limits (200 000 triangles): validation
  // and the structured clone of the posted document, as the longer of the call's own duration and the page's main-thread
  // block over the whole 1-sample bake.
  await openFixture(page, '/rt.html?scene=large-order&lag=1');
  const post = await page.evaluate(async () => {
    const rt = window.__msFixture?.rt;
    if (!rt) throw new Error('rt controls missing');
    rt.resetLag();
    const start = performance.now();
    const pending = rt.bake({ samples: 1 });
    const call = performance.now() - start;
    const result = await pending;
    if (result.error) throw new Error(result.error);
    return { call, block: rt.mainThreadBlock(), lag: rt.maxLag() };
  });
  console.log(
    `[bench] bake() of 200 000 triangles: call ${post.call.toFixed(1)} ms, block ${post.block.toFixed(1)} ms ` +
      `(heartbeat lag ${post.lag.toFixed(1)} ms)`,
  );

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
    bakeTimeMs: { 'bake-bench-n16': median(bakeRuns) },
    mainThreadBlockMs: { 'bake-bench': bakeBlock.block, 'bake-post-200k': Math.max(post.call, post.block) },
  };
  const json = JSON.stringify(measured, null, 2);
  writeFileSync(join(testInfo.project.outputDir, 'budgets-measured.json'), json);
  await testInfo.attach('budgets-measured', { body: json, contentType: 'application/json' });

  for (const line of budgetReport(budgets, measured)) {
    console.log(`[budget] ${line}`);
    testInfo.annotations.push({ type: 'budget', description: line });
  }
  const violations = checkBudgets(budgets, measured);
  expect(violations.map((v) => v.message)).toEqual([]);
});
