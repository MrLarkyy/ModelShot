import { defineConfig } from '@playwright/test';
import { harnessPort } from './src/harnessPort';

const port = harnessPort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  workers: 1,
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
  // are independent units: the golden tests share no state, so they shard per test; workers stay 1, so nothing runs in
  // parallel. Shards are contiguous ranges, so the baked lighting tests (13-15 minutes together on a slow VM) and the
  // preview-vs-render pairing tests (about 4 minutes per three on a normal VM) are their own projects, with own shards. The bench has no dependency on the goldens, which would
  // pull every golden test into its shard.
  projects: [
    {
      name: 'golden',
      fullyParallel: true,
      grepInvert: /baked lighting|like the baked preview/,
      testMatch: [
        'environment.spec.ts',
        'golden*.spec.ts',
        'modelView.spec.ts',
        'realtime.spec.ts',
        'pathtracer.spec.ts',
      ],
    },
    { name: 'bake', fullyParallel: true, testMatch: 'realtime.spec.ts', grep: /baked lighting/ },
    { name: 'pair', fullyParallel: true, testMatch: 'pathtracer.spec.ts', grep: /like the baked preview/ },
    { name: 'bench', testMatch: 'bench.spec.ts' },
  ],
});
