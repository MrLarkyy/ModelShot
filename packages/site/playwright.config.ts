import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { previewCommand } from '../../tools/harness/src/previewCommand';
import { sitePort } from './e2e/sitePort';

const port = sitePort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);
// Set by the concurrent runner (tools/harness/src/runBrowserSuites.ts) after it built every suite: only serve then.
const prebuilt = process.env['MS_E2E_PREBUILT'] === '1';
const command = previewCommand(dirname(fileURLToPath(import.meta.url)), port, prebuilt);

// The server is the composed production build: the landing page at / and the app at /app/, one origin, as hosted.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/../goldens/{arg}{ext}',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  updateSnapshots: 'none',
  reporter: [['list']],
  expect: {
    // About 5x the Windows vs Ubuntu difference measured on these pages (at most 0.00042); 0.01 let a wrong tile
    // layout at 768 px pass.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002, threshold: 0.2 },
  },
  webServer: {
    command,
    url: `${origin}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: origin,
    browserName: 'chromium',
    headless: true,
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
    },
  },
  projects: [{ name: 'landing' }],
});
