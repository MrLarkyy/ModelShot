import { defineConfig } from 'vite';
import { harnessPort } from './src/harnessPort.ts';

export default defineConfig({
  root: 'fixtures',
  server: { host: '127.0.0.1', port: harnessPort(), strictPort: true },
  logLevel: 'warn',
});
