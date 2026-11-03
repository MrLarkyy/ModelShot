import { defineConfig } from 'vite';

// Playwright starts this server with --port and --strictPort (playwright.config.ts). The JPEG crate fixture is a
// `.glb` imported with `?inline`; Vite only inlines file types it knows as assets.
export default defineConfig({
  root: 'fixtures',
  assetsInclude: ['**/*.glb'],
  server: { host: '127.0.0.1' },
  logLevel: 'warn',
});
