import { defineConfig } from '@playwright/test';
import { appPort } from './e2e/appPort';

const port = appPort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);
// Set by the concurrent runner (tools/harness/src/runBrowserSuites.ts) after it built every suite: only serve then.
const prebuilt = process.env['MS_E2E_PREBUILT'] === '1';

// The server is the production build of the app in e2e mode (the test hook included), served under /app/ like the
// hosted site; the browser runs WebGL on SwiftShader like the harness.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  reporter: [['list']],
  webServer: {
    command: `pnpm run ${prebuilt ? 'preview:e2e' : 'serve:e2e'} --port ${port}`,
    url: `${origin}/app/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: origin,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
    },
  },
  projects: [{ name: 'app' }],
});
