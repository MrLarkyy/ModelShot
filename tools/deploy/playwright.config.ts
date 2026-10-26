import { defineConfig } from '@playwright/test';
import { deployPorts } from './e2e/deployPort.ts';

const ports = deployPorts();
const ci = Boolean(process.env['CI']);
const live = process.env['MS_DEPLOY_URL'] ?? '';
const baseURL = live === '' ? `http://127.0.0.1:${ports.site}/ModelShot/` : live.replace(/\/*$/, '/');

// Without MS_DEPLOY_URL the site is the assembled dist (built by the web server command below) served under /ModelShot/ the way GitHub Pages
// serves it; with it, the deployed site, once its app/sw.js equals the one in dist (e2e/awaitDeploy.ts). Either way the
// host page that embeds the viewer is a local server on another origin. The browser runs WebGL on SwiftShader like
// the harness and the app.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/awaitDeploy.ts',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  reporter: [['list']],
  webServer: {
    // Local mode builds first: the assembled dist must be the current code, never a leftover of an earlier build.
    command:
      live === ''
        ? 'pnpm --filter "@modelshot/deploy..." run build && node e2e/serve.ts'
        : 'node e2e/serve.ts --host-only',
    url: `http://127.0.0.1:${ports.host}/host.html`,
    reuseExistingServer: false,
    timeout: live === '' ? 300_000 : 30_000,
  },
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1100, height: 700 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
    },
  },
  projects: [{ name: 'deploy' }],
});
