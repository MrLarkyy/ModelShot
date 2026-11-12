import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { previewCommand } from '../../tools/harness/src/previewCommand';
import { appPort } from './e2e/appPort';

const port = appPort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);
// Set by the concurrent runner (tools/harness/src/runBrowserSuites.ts) after it built every suite: only serve then.
const prebuilt = process.env['MS_E2E_PREBUILT'] === '1';
const command = previewCommand(dirname(fileURLToPath(import.meta.url)), port, prebuilt);

// The server is the production build of the app in e2e mode (the test hook included), served under /app/ like the
// hosted site; the browser runs WebGL on SwiftShader like the harness.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/../goldens/{arg}{ext}',
  timeout: 120_000,
  // A hang or a slow runner ends the shard with every finished test reported and the artefact uploaded, before the
  // 20-minute job limit cancels the job and drops both (the harness does the same, 17 minutes).
  globalTimeout: ci ? 17 * 60_000 : 0,
  workers: 1,
  // Every test opens its own page and shares no state, so this only lets CI's `--shard` (ci.yml, job app) split a
  // file; with one worker nothing runs at once and a shard still runs its tests in file order.
  fullyParallel: true,
  retries: 0,
  forbidOnly: ci,
  updateSnapshots: 'none',
  reporter: [['list']],
  expect: {
    // The site's landing tolerance: a wrong layout fails, text anti-aliasing between machines does not.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002, threshold: 0.2 },
  },
  webServer: {
    command,
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
    // A failure that cannot be repeated locally (MS-97) leaves its trace in the uploaded artefact.
    trace: ci ? 'retain-on-failure' : 'off',
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--use-gl=angle',
        '--enable-unsafe-swiftshader',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
      ],
    },
  },
  projects: [{ name: 'app' }],
});
