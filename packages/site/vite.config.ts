import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { inlineBrandSvg } from './src/build/inlineBrandSvg.ts';

function brandAsset(path: string): string {
  return fileURLToPath(new URL(`../brand/assets/${path}`, import.meta.url));
}

export default defineConfig({
  publicDir: '../brand/assets/public',
  plugins: [
    inlineBrandSvg({
      mark: brandAsset('logo/mark.svg'),
      'hero-island': brandAsset('illustrations/hero-island.svg'),
    }),
  ],
  // Every browser with ES2022 modules supports modulepreload; the polyfill only adds bytes.
  build: { modulePreload: { polyfill: false } },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
