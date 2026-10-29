import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../src/harnessTest';
import { budgetReport, checkBudgets, loadBudgets, type Measured } from '../src/budgets';
import { BUNDLE_TARGETS, measureBundle } from '../src/bundleSize';
import { openFixture } from '../src/expectGolden';
import { traceMainThread } from '../src/mainThreadTrace';
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

  // MS-60: the partial-edge quad filling most of a 512 px frame, raster key, 4x MSAA: the transparency pass per sample
  // into its multisampled targets with the seam ramp, and their resolve.
  await openFixture(page, '/rt.html?variant=partial-edge&size=512');
  expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('raster');
  const partialEdgeFrames = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.renderFrames) throw new Error('frame bench missing');
    fixture.renderFrames(5);
    return fixture.renderFrames(30);
  });

  // The same scene with one mesh at render order 1: every frame uses the exact depth key (gl_FragDepth). A still
  // exact frame draws one shifted pass of its sample history per render (MS-35): the draws of the single-sampled
  // frame (msaa=0, as on main before it), and frame time within 1.25x of that frame measured alongside.
  const orderFrames = async (query: string) => {
    await openFixture(page, `/rt.html?scene=bench-order&size=512${query}`);
    expect(await page.evaluate(() => window.__msFixture?.rt?.depthKeyMode())).toBe('exact');
    const draws = (await page.evaluate(() => window.__msFixture!.rt!.drawStatesPerFrame())).length;
    const times = await page.evaluate(() => {
      const fixture = window.__msFixture;
      if (!fixture?.renderFrames) throw new Error('frame bench missing');
      fixture.renderFrames(5);
      return fixture.renderFrames(30);
    });
    return { draws, times };
  };
  const singleOrder = await orderFrames('&msaa=0');
  const order = await orderFrames('');
  const rtOrderFrames = order.times;
  console.log(
    `[bench] rt-bench-order-512: ${order.draws} draws, median ${median(order.times).toFixed(1)} ms; ` +
      `single-sampled (msaa=0) ${singleOrder.draws} draws, median ${median(singleOrder.times).toFixed(1)} ms`,
  );
  expect(order.draws, 'draws per exact frame: one pass').toBe(singleOrder.draws);
  expect(median(order.times), 'exact frame time against the single-sampled pass').toBeLessThanOrEqual(
    1.25 * median(singleOrder.times),
  );

  // Load and first frame of a scene at the loader's limits with render order: decode, upload, the exact key's
  // de-indexed geometry, one frame.
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const loadMs = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture?.timeScene) throw new Error('scene bench missing');
    return fixture.timeScene();
  });

  // Sharp-edge detection (MS-15) in a load and first frame, on fresh meshes: 200 004 triangles of separate cubes, and
  // the hostile plate whose single patch would ask 2 · 10⁸ slot checks (cut at MAX_EDGE_CHECKS).
  const timeScene = (scene: string) =>
    page.evaluate(async (name) => {
      const fixture = window.__msFixture;
      if (!fixture?.timeScene) throw new Error('scene bench missing');
      return fixture.timeScene(name);
    }, scene);
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const edgesLoadMs = await timeScene('edges-200k');
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const edgesHostileMs = await timeScene('edges-hostile');
  // And the matching of positions and edges where every coordinate is a multiple of 2^20 (a hash's worst case).
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const edgesWeldMs = await timeScene('edges-weld');
  // World-density lightmap charts (MS-41): 49 untextured meshes of 4096 triangles, none coplanar, unwrapped and drawn
  // de-indexed per corner.
  await openFixture(page, '/rt.html?scene=empty&size=512');
  const worldLoadMs = await timeScene('world-200k');

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

  // The final-render path (MS-18) on the same scene: 64 samples at 2x (256 x 256 traced pixels) in one step, the
  // guides, a noise estimate at every checkpoint from 2 to 64 and one denoised resolve at the end, until the GPU
  // finished; median of 3.
  await openFixture(page, '/pt.html?scene=bench&size=128&samples=1&supersample=2&denoise=1');
  const ptQualityRuns = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.timeToSamples) throw new Error('sample bench missing');
    return [fixture.timeToSamples(64), fixture.timeToSamples(64), fixture.timeToSamples(64)];
  });

  // The same request one `step(1)` at a time (MS-56): the longest step, each timed until the GPU finished it. The guide
  // is spread over the first steps, so none is the 2.4 s step the whole guide once made on the local SwiftShader
  // machine; the slowest steps now are a checkpoint's noise estimate and resolve. One untimed run first, median of 3.
  await page.evaluate(() => window.__msFixture?.maxStepMs?.(64));
  const ptStepRuns = await page.evaluate(() => {
    const fixture = window.__msFixture;
    if (!fixture?.maxStepMs) throw new Error('step bench missing');
    return [fixture.maxStepMs(64), fixture.maxStepMs(64), fixture.maxStepMs(64)];
  });

  // Path-tracer load at the loader's limits: validate, flatten, build the BVH of 200 000 triangles, upload, one sample.
  await openFixture(page, '/pt.html?scene=empty&size=128&samples=1');
  const ptLoadMs = await page.evaluate(async () => {
    const fixture = window.__msFixture;
    if (!fixture?.timeScene) throw new Error('scene bench missing');
    return fixture.timeScene();
  });
  expect(await page.evaluate(() => window.__msFixture?.pt?.triangles)).toBe(200_000);

  // What the path tracer's setScene costs the main thread for a document at the loaders' limits (MS-40): validation,
  // the mesh stream to the geometry worker, taking its buffers back, the banded upload and the swap, as the most one
  // task blocked (CPU plus GPU wait). The document is built before the traced window.
  await openFixture(page, '/pt.html?scene=empty&size=128&samples=1');
  await page.evaluate(() => window.__msFixture?.pt?.prepareLarge());
  let ptSet = { applied: false, triangles: 0, ms: 0 };
  const ptSetTrace = await traceMainThread(page, async () => {
    ptSet = await page.evaluate(async () => {
      const pt = window.__msFixture?.pt;
      if (!pt) throw new Error('pt controls missing');
      const start = performance.now();
      const result = await pt.setLarge();
      return { ...result, ms: performance.now() - start };
    });
  });
  expect({ applied: ptSet.applied, triangles: ptSet.triangles }).toEqual({ applied: true, triangles: 200_000 });
  expect(await page.evaluate(() => window.__msFixture?.pt?.geometryInWorker)).toBe(true);
  console.log(
    `[bench] pt setScene of 200 000 triangles: ${ptSetTrace.tasks} tasks, max blocking per task ` +
      `${ptSetTrace.maxBlocking.toFixed(1)} ms (CPU ${ptSetTrace.maxCpu.toFixed(1)} ms, GPU wait ` +
      `${ptSetTrace.maxGpuWait.toFixed(1)} ms); longest ${ptSetTrace.longestWall.toFixed(1)} ms wall / ` +
      `${ptSetTrace.longestCpu.toFixed(1)} ms CPU, largest wall-CPU gap ${ptSetTrace.largestGap.toFixed(1)} ms; ` +
      `call to applied ${ptSet.ms.toFixed(0)} ms`,
  );

  // The light bake of the benchmark scene in its worker: 16 samples with the shadow catcher, from bake() to the final
  // lighting, median of 3; and the main thread's longest event-loop lag over those bakes (posting, three progress
  // uploads per bake, drawing them).
  // Each run is checked against the budget as it completes.
  await openFixture(page, '/rt.html?scene=bench&lag=1');
  await page.evaluate(() => window.__msFixture?.rt?.resetLag());
  const bakeRuns: number[] = [];
  // Traced, so a slow phase can be told apart: page work (CPU time) or the OS not running the thread (wall only).
  const trace = await traceMainThread(page, async () => {
    for (let run = 0; run < 3; run++) {
      const ms = await page.evaluate(async () => {
        const fixture = window.__msFixture;
        if (!fixture?.timeBake) throw new Error('bake bench missing');
        return fixture.timeBake();
      });
      expect(ms, `bake run ${run + 1}: ${ms.toFixed(0)} ms / max ${bakeMax}`).toBeLessThanOrEqual(bakeMax);
      bakeRuns.push(ms);
    }
  });
  // The budget is the most one main-thread task blocked over the three bakes: its CPU time plus its synchronous waits
  // for the GPU process (the trace sees every task, the Playwright evaluate that calls bake() included). Wall time also
  // counts the OS not running the thread on a loaded machine, so the wall-time block and the heartbeat lag are printed
  // beside it, not asserted (docs/testing.md).
  console.log(
    `[bench] bake main thread (trace): ${trace.tasks} tasks, max blocking per task ${trace.maxBlocking.toFixed(1)} ms ` +
      `(CPU ${trace.maxCpu.toFixed(1)} ms, GPU wait ${trace.maxGpuWait.toFixed(1)} ms); longest ` +
      `${trace.longestWall.toFixed(1)} ms wall / ${trace.longestCpu.toFixed(1)} ms CPU, largest wall-CPU gap ` +
      `${trace.largestGap.toFixed(1)} ms`,
  );
  const bakeBlock = await page.evaluate(() => ({
    block: window.__msFixture?.rt?.mainThreadBlock() ?? -1,
    lag: window.__msFixture?.rt?.maxLag() ?? -1,
    report: window.__msFixture?.rt?.blockReport(),
  }));
  console.log(
    `[bench] bake runs ${bakeRuns.map((ms) => ms.toFixed(0)).join(', ')} ms, wall-time block ` +
      `${bakeBlock.block.toFixed(1)} ms (heartbeat lag ${bakeBlock.lag.toFixed(1)} ms)`,
  );
  // Which work the block came from: the longest stretch per phase, every long task and the slow phases around them.
  const phases = Object.entries(bakeBlock.report?.phases ?? {}).map(([phase, ms]) => `${phase} ${ms.toFixed(1)}`);
  console.log(`[bench] bake phases (max ms): ${phases.join(', ')}`);
  console.log(`[bench] bake long tasks: ${JSON.stringify(bakeBlock.report?.longTasks ?? [])}`);
  console.log(`[bench] bake slow phases: ${JSON.stringify(bakeBlock.report?.slowPhases.slice(-40) ?? [])}`);

  // What a bake costs the main thread for a document at the loaders' limits (200 000 triangles): the call, the mesh
  // stream and the update, as the most CPU time one task used over the whole 1-sample bake.
  await openFixture(page, '/rt.html?scene=large-order&lag=1');
  let post = { call: 0, block: 0, lag: 0 };
  const postTrace = await traceMainThread(page, async () => {
    post = await page.evaluate(async () => {
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
  });
  console.log(
    `[bench] bake() of 200 000 triangles: max blocking per task ${postTrace.maxBlocking.toFixed(1)} ms (CPU ` +
      `${postTrace.maxCpu.toFixed(1)} ms, GPU wait ${postTrace.maxGpuWait.toFixed(1)} ms); call ` +
      `${post.call.toFixed(1)} ms, wall-time block ${post.block.toFixed(1)} ms (heartbeat lag ${post.lag.toFixed(1)} ms)`,
  );

  // An export (MS-22): a transparent 4-frame turntable of the showcase at 64 x 64, 16 samples a frame, as APNG, from a
  // fresh tracer: scene upload, the frames, the encoding. Median of 3.
  await page.goto('/export.html');
  await page.waitForFunction(() => window.__msExport !== undefined);
  const exportRuns: number[] = [];
  for (let i = 0; i < 3; i++) {
    exportRuns.push(
      await page.evaluate(async () => {
        const controls = window.__msExport;
        if (!controls) throw new Error('export controls missing');
        const start = performance.now();
        if ((await controls.turntable()) !== 4) throw new Error('the export rendered other than 4 frames');
        return performance.now() - start;
      }),
    );
  }
  console.log(
    `[bench] export turntable 64 x 64 x 4 frames, n16: ${exportRuns.map((ms) => ms.toFixed(0)).join(', ')} ms`,
  );

  // An animation export (MS-58): the same clip of the showcase bobbing, 4 poses, from a fresh tracer. Once as exported
  // (every pose shares the textures array: no decode, no texture upload) and once with a new array per pose (what a
  // setScene did before); with the showcase's small atlas and with a generated 2048 x 2048 one. One untimed run of each
  // first (shaders, the generated atlas), then the median of 3, interleaved so a load spike hits both.
  const animationRun = async (fullSetScene: boolean, atlasSide?: number): Promise<number> =>
    page.evaluate(
      async (options) => {
        const controls = window.__msExport;
        if (!controls) throw new Error('export controls missing');
        const start = performance.now();
        if ((await controls.animation(options)) !== 4) throw new Error('the export rendered other than 4 frames');
        return performance.now() - start;
      },
      { fullSetScene, ...(atlasSide === undefined ? {} : { atlasSide }) },
    );
  const animationMedians: Record<string, { pose: number; full: number }> = {};
  for (const atlasSide of [undefined, 2048]) {
    await animationRun(false, atlasSide);
    await animationRun(true, atlasSide);
    const poseRuns: number[] = [];
    const fullRuns: number[] = [];
    for (let i = 0; i < 3; i++) {
      poseRuns.push(await animationRun(false, atlasSide));
      fullRuns.push(await animationRun(true, atlasSide));
    }
    animationMedians[String(atlasSide)] = { pose: median(poseRuns), full: median(fullRuns) };
    console.log(
      `[bench] export animation 64 x 64 x 4 frames, n16, ${atlasSide === undefined ? 'showcase atlas' : `${atlasSide}² atlas`}: ` +
        `pose-only ${poseRuns.map((ms) => ms.toFixed(0)).join(', ')} ms, full setScene ` +
        `${fullRuns.map((ms) => ms.toFixed(0)).join(', ')} ms, median ratio ` +
        `${(median(poseRuns) / median(fullRuns)).toFixed(2)}`,
    );
  }

  // Every target, so a budget row cannot go unmeasured; one at a time, as `site` and `site-assets` build the same package.
  const bundleGzipBytes: Record<string, number> = {};
  for (const target of BUNDLE_TARGETS) bundleGzipBytes[target] = (await measureBundle(target)).gzipBytes;

  const measured: Measured = {
    frameTimeMs: {
      'gradient-256': median(frames),
      'rt-bench-512': median(rtFrames),
      'rt-bench-order-512': median(rtOrderFrames),
      'rt-frame-partial-edge-512': median(partialEdgeFrames),
      'rt-load-first-frame-200k-order': loadMs,
      'rt-load-first-frame-200k-edges': edgesLoadMs,
      'rt-load-first-frame-edges-hostile': edgesHostileMs,
      'rt-load-first-frame-edges-weld': edgesWeldMs,
      'rt-load-first-frame-200k-world': worldLoadMs,
      'pt-bench-128-x2-denoised-step': median(ptStepRuns),
      'pt-load-200k': ptLoadMs,
      'export-turntable-64-f4-n16': median(exportRuns),
      'export-animation-64-f4-n16': animationMedians['undefined']?.pose ?? Number.NaN,
      'export-animation-atlas2048-64-f4-n16': animationMedians['2048']?.pose ?? Number.NaN,
    },
    timeToSamplesMs: {
      'progressive-256-n64': median(runs),
      'pt-bench-128-n256': median(ptRuns),
      'pt-bench-128-n64-x2-denoised': median(ptQualityRuns),
    },
    bundleGzipBytes,
    bakeTimeMs: { 'bake-bench-n16': median(bakeRuns) },
    mainThreadBlockMs: {
      'bake-bench': trace.maxBlocking,
      'bake-post-200k': postTrace.maxBlocking,
      'pt-setscene-200k': ptSetTrace.maxBlocking,
    },
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
