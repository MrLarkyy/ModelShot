import { defineConfig } from 'vite';

export default defineConfig({
  // Favicons and app icons come from the brand package.
  publicDir: '../brand/assets/public',
  // No polyfill: Safari before 17 and Firefox before 115 lack modulepreload and then fetch a split chunk only when it is
  // imported (later, not broken). The app has no split chunk yet, and the polyfill would cost about 300 B of its budget.
  build: { modulePreload: { polyfill: false } },
});
