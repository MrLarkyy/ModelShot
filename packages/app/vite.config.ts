import { defineConfig } from 'vite';

export default defineConfig({
  // Favicons and app icons come from the brand package.
  publicDir: '../brand/assets/public',
  // Every browser with WebGL2 and ES2022 supports modulepreload; the polyfill only costs budget bytes.
  build: { modulePreload: { polyfill: false } },
});
