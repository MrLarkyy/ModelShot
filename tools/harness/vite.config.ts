import { defineConfig } from 'vite';

export default defineConfig({
  root: 'fixtures',
  server: { host: '127.0.0.1', port: 4410, strictPort: true },
  logLevel: 'warn',
});
