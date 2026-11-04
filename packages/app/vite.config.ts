import { devWithoutCsp } from '@modelshot/brand/devWithoutCsp';
import { shippedGlsl } from '@modelshot/brand/shippedGlsl';
import { defineConfig } from 'vite';
import { swPlugin } from './src/offline/swPlugin.ts';

export default defineConfig({
  // Relative URLs: one build works under /ModelShot/ on GitHub Pages and at a domain root (docs/hosting.md).
  base: './',
  // Favicons and app icons come from the brand package.
  publicDir: '../brand/assets/public',
  // shippedGlsl applies to builds only: Vitest projects extend this config in serve mode and see full shader sources.
  plugins: [devWithoutCsp(), shippedGlsl(), swPlugin()],
  // No polyfill: Safari before 17 and Firefox before 115 lack modulepreload and then fetch a split chunk only when it is
  // imported (later, not broken). The path tracer and the export code are split chunks, and the polyfill would cost
  // about 300 B of the bundle budget.
  // The light-bake worker bundles the path tracer's shaders, and a worker build takes its own plugin list.
  worker: { plugins: () => [shippedGlsl()] },
  build: { modulePreload: { polyfill: false } },
});
