import { defineConfig } from 'vite';

// Playwright starts this server with --port and --strictPort (playwright.config.ts).
export default defineConfig({
  root: 'fixtures',
  server: { host: '127.0.0.1' },
  logLevel: 'warn',
});
