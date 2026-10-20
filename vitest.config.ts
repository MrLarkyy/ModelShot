import { defineConfig } from 'vitest/config';

const packages = ['formats', 'scene', 'renderer-rt', 'pathtracer', 'looks', 'export', 'app', 'embed'];

export default defineConfig({
  test: {
    projects: packages.map((name) => ({
      test: {
        name,
        root: `packages/${name}`,
        include: ['{src,test}/**/*.test.ts'],
        environment: 'node',
      },
    })),
    passWithNoTests: false,
  },
});
