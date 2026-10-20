import { defineConfig } from 'vitest/config';

const packages = ['formats', 'scene', 'renderer-rt', 'pathtracer', 'looks', 'export', 'app', 'embed'];

export default defineConfig({
  test: {
    projects: [
      ...packages.map((name) => ({
        extends: `./packages/${name}/vite.config.ts`,
        test: {
          name,
          root: `packages/${name}`,
          include: ['{src,test}/**/*.test.ts'],
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
    ],
    passWithNoTests: false,
  },
});
