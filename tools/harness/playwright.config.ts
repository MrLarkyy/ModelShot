import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  updateSnapshots: 'none',
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
  webServer: {
    command: 'pnpm exec vite --config vite.config.ts',
    url: 'http://127.0.0.1:4410/gradient.html',
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4410',
    headless: true,
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
    },
  },
  projects: [
    { name: 'golden', testMatch: ['environment.spec.ts', 'golden*.spec.ts'] },
    { name: 'bench', testMatch: 'bench.spec.ts', dependencies: ['golden'] },
  ],
});
