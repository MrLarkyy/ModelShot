import { defineConfig } from 'vitest/config';

const packages = ['formats', 'scene', 'renderer-rt', 'pathtracer', 'looks', 'export', 'app', 'embed', 'brand', 'site'];

export default defineConfig({
  test: {
    projects: [
      ...packages.map((name) => ({
        extends: `./packages/${name}/vite.config.ts`,
        test: {
          name,
          root: `packages/${name}`,
          include: ['{src,test}/**/*.test.ts'],
          // A hang backstop, not a budget: tests bound work or CPU time, never wall time (docs/testing.md).
          testTimeout: 60_000,
          environment: 'node',
        },
      })),
      {
        test: {
          name: 'harness',
          root: 'tools/harness',
          include: ['test/**/*.test.ts'],
          testTimeout: 60_000,
          environment: 'node',
        },
      },
      {
        test: {
          name: 'wiki',
          root: 'tools/wiki',
          include: ['test/**/*.test.mjs'],
          testTimeout: 60_000,
          environment: 'node',
        },
      },
    ],
    passWithNoTests: false,
    // Measured values (bundle size vs budget) are printed by passing tests too, so a build log shows the numbers.
    silent: false,
  },
});
