import { defineConfig } from '@playwright/test';
import { sitePort } from './e2e/sitePort';

const port = sitePort();
const origin = `http://127.0.0.1:${port}`;
const ci = Boolean(process.env['CI']);

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
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01, threshold: 0.2 },
  },
  webServer: {
    command: `pnpm run build:with-app && pnpm exec vite preview --port ${port} --strictPort`,
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
