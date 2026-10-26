import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The element script modelshot-embed.js as one self-contained file next to the frame page: a host page makes one
// cross-origin request for it, and nothing of the frame's code can end up in it through a shared chunk.
export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    // Lib mode keeps the whitespace of ES output for further bundling; this file is served as is, so minify it fully.
    minify: true,
    rolldownOptions: { output: { minify: true } },
    lib: {
      entry: fileURLToPath(new URL('./src/element.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'modelshot-embed.js',
    },
  },
});
