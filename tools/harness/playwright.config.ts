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
  projects: [
    {
      name: 'golden',
      testMatch: [
        'environment.spec.ts',
        'golden*.spec.ts',
        'modelView.spec.ts',
        'realtime.spec.ts',
        'pathtracer.spec.ts',
      ],
    },
    { name: 'bench', testMatch: 'bench.spec.ts', dependencies: ['golden'] },
  ],
});
