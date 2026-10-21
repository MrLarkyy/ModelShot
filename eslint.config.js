import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['packages/**/*.ts', 'tools/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  {
    files: ['tools/harness/fixtures/**/*.ts'],
    ignores: ['tools/harness/fixtures/src/bench.ts', 'tools/harness/fixtures/src/eventLoopLag.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Fixture images are deterministic: no random source.' },
        ...['window', 'globalThis', 'self'].flatMap((object) => [
          { object, property: 'Math', message: 'Fixture images are deterministic: no indirect Math.random.' },
          { object, property: 'Date', message: 'Fixture images are deterministic: no clock.' },
          { object, property: 'crypto', message: 'Fixture images are deterministic: no random source.' },
          {
            object,
            property: 'performance',
            message: 'Timing belongs in fixtures/src/bench.ts and eventLoopLag.ts only.',
          },
        ]),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Fixture images are deterministic: no clock.' },
        { name: 'crypto', message: 'Fixture images are deterministic: no random source.' },
        { name: 'performance', message: 'Timing belongs in fixtures/src/bench.ts and eventLoopLag.ts only.' },
      ],
    },
  },
  {
    files: ['packages/*/scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
