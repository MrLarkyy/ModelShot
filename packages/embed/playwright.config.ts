import { defineConfig } from '@playwright/test';
import { embedPorts } from './e2e/embedPort';

const ports = embedPorts();
const frameOrigin = `http://127.0.0.1:${ports.frame}`;
const hostOrigin = `http://127.0.0.1:${ports.host}`;
const ci = Boolean(process.env['CI']);

// Two servers, two origins: the production embed build (frame page and element script) and a host page server that
// also serves the test models, as a marketplace or wiki page and a model host would. The browser runs WebGL on
// SwiftShader like the harness and the app.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // A test waits for the bake up to LIT_TIMEOUT (e2e/embedTest.ts) once or twice.
  timeout: 600_000,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  reporter: [['list']],
  webServer: [
    {
      command: `pnpm run serve:e2e --port ${ports.frame}`,
      url: `${frameOrigin}/modelshot-embed.js`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `node e2e/hostServer.mjs --port ${ports.host}`,
      url: `${hostOrigin}/host.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
  use: {
    baseURL: hostOrigin,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
    },
  },
  projects: [{ name: 'embed' }],
});
