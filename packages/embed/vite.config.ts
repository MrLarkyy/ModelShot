import { devWithoutCsp } from '@modelshot/brand/devWithoutCsp';
import { defineConfig } from 'vite';

// The frame page (index.html), where the model is fetched, parsed and drawn. The element script is a second build
// (vite.element.config.ts) into the same dist. base "./" keeps every URL relative, so the build works under whatever
// path it is hosted (MS-26).
export default defineConfig({
  base: './',
  // The dev server injects styles the frame's policy refuses; a build keeps the policy.
  plugins: [devWithoutCsp()],
  build: {
    // No polyfill: it would add an inline script, which the frame's Content-Security-Policy refuses.
    modulePreload: { polyfill: false },
  },
  // Host pages of the browser tests load the element script from this origin.
  preview: { cors: true },
});
