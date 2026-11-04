import { devWithoutCsp } from '@modelshot/brand/devWithoutCsp';
import { shippedGlsl } from '@modelshot/brand/shippedGlsl';
import { defineConfig } from 'vite';

// The frame page (index.html), where the model is fetched, parsed and drawn. The element script is a second build
// (vite.element.config.ts) into the same dist. base "./" keeps every URL relative, so the build works under whatever
// path it is hosted (MS-26).
export default defineConfig({
  base: './',
  // The dev server injects styles the frame's policy refuses; a build keeps the policy. shippedGlsl strips shader
  // comments in builds only; Vitest projects extend this config in serve mode and see full shader sources.
  plugins: [devWithoutCsp(), shippedGlsl()],
  build: {
    // No polyfill: it would add an inline script, which the frame's Content-Security-Policy refuses.
    modulePreload: { polyfill: false },
  },
  // The light-bake worker bundles the path tracer's shaders, and a worker build takes its own plugin list.
  worker: { plugins: () => [shippedGlsl()] },
  // Host pages of the browser tests load the element script from this origin.
  preview: { cors: true },
});
