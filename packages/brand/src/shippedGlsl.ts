import { readFile } from 'node:fs/promises';
import { stripGlslComments } from './stripGlslComments.ts';

const GLSL_RAW = /\.glsl\?raw$/;

/**
 * Loads `*.glsl?raw` imports with comments and redundant whitespace removed. A build only: the dev server, Vitest and
 * the harness dev server keep the full sources.
 */
export function shippedGlsl(): {
  readonly name: string;
  readonly apply: 'build';
  readonly enforce: 'pre';
  readonly load: (id: string) => Promise<string | undefined>;
} {
  return {
    name: 'modelshot:shipped-glsl',
    apply: 'build',
    enforce: 'pre',
    async load(id) {
      if (!GLSL_RAW.test(id)) return undefined;
      const text = await readFile(id.slice(0, id.indexOf('?')), 'utf8');
      return `export default ${JSON.stringify(stripGlslComments(text))};`;
    },
  };
}
