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
    ignores: ['tools/harness/fixtures/src/bench.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Fixture images are deterministic: no random source.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Fixture images are deterministic: no clock.' },
        { name: 'performance', message: 'Timing belongs in fixtures/src/bench.ts only.' },
      ],
    },
  },
  {
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
