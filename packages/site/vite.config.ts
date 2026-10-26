import { fileURLToPath } from 'node:url';
import { devWithoutCsp } from '@modelshot/brand/devWithoutCsp';
import { defineConfig } from 'vite';
import { inlineBrandSvg } from './src/build/inlineBrandSvg.ts';

function brandAsset(path: string): string {
  return fileURLToPath(new URL(`../brand/assets/${path}`, import.meta.url));
}

export default defineConfig({
  // Relative URLs: one build works under /ModelShot/ on GitHub Pages and at a domain root (docs/hosting.md).
  base: './',
  publicDir: '../brand/assets/public',
  plugins: [
    devWithoutCsp(),
    inlineBrandSvg({
      mark: brandAsset('logo/mark.svg'),
      'hero-island': brandAsset('illustrations/hero-island.svg'),
    }),
  ],
  // No polyfill: Safari before 17 and Firefox before 115 lack modulepreload and then fetch a split chunk only when it is
  // imported (later, not broken). The page has no split chunk.
  build: { modulePreload: { polyfill: false } },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
