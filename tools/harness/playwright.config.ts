import { availableParallelism, totalmem } from 'node:os';
import { defineConfig } from '@playwright/test';
import { harnessPort } from './src/harnessPort';
import { playwrightWorkers } from './src/workerCount';

const port = harnessPort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  workers: playwrightWorkers(process.env, availableParallelism(), totalmem()),
  retries: 0,
  forbidOnly: ci,
  updateSnapshots: 'none',
  reporter: [['list']],
  webServer: {
    command: `pnpm exec vite --config vite.config.ts --port ${port} --strictPort`,
    url: `${origin}/gradient.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: origin,
    headless: true,
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
    },
  },
  // CI runs the suite in separate jobs, one VM per shard (docs/testing.md, CI). Shards split whole files unless tests
  // are independent units: the golden tests share no state, so they shard per test (CI sets workers 1). Shards are
  // contiguous ranges by test count, not by time, so each block of slow tests is its own project with its own shards:
  // the path-tracer tests (golden-pt), the baked lighting tests (bake) and the preview-vs-render pairing tests (pair).
  // Locally 'test:browser' runs two phases (src/browserPhases.ts): every test without @timing with the worker count of
  // src/workerCount.ts, then the bench project alone with one worker. The bench project is every @timing test, so a
  // measure never shares the machine with another test. It has no dependency on the goldens: that would skip it after
  // a golden failure and pull every golden test into its CI shard.
  // Playwright queues the test groups of one run in project order, so the projects with the longest tests come first
  // and the short golden tests fill the workers at the end of phase 1 instead of one long test running on alone.
  projects: [
    {
      name: 'pair',
      fullyParallel: true,
      testMatch: 'pathtracer.spec.ts',
      grep: /like the baked preview/,
      grepInvert: /@timing/,
    },
    { name: 'bake', fullyParallel: true, testMatch: 'realtime.spec.ts', grep: /baked lighting/, grepInvert: /@timing/ },
    {
      name: 'golden-pt',
      fullyParallel: true,
      testMatch: 'pathtracer.spec.ts',
      grepInvert: [/like the baked preview/, /@timing/],
    },
    {
      name: 'golden',
      fullyParallel: true,
      grepInvert: [/baked lighting/, /@timing/],
      testMatch: ['environment.spec.ts', 'export.spec.ts', 'golden*.spec.ts', 'modelView.spec.ts', 'realtime.spec.ts'],
    },
    { name: 'bench', grep: /@timing/, workers: 1, outputDir: 'test-results/serial' },
  ],
});
