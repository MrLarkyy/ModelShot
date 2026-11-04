import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shippedGlsl } from '../src/shippedGlsl';
import { stripGlslComments } from '../src/stripGlslComments';

describe('shippedGlsl', () => {
  const plugin = shippedGlsl();
  const file = fileURLToPath(new URL('../../looks/src/glsl/agx.glsl', import.meta.url));

  it('applies to builds only and before the core loaders', () => {
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });

  it('loads a .glsl?raw import as a module whose default is the stripped file', async () => {
    const code = await plugin.load(`${file}?raw`);
    expect(code).toBeDefined();
    const text = JSON.parse(/^export default (.*);$/s.exec(code!)![1]!) as string;
    expect(text).toBe(stripGlslComments(readFileSync(file, 'utf8')));
  });

  it('leaves a .glsl without ?raw and other files alone', async () => {
    expect(await plugin.load(file)).toBeUndefined();
    expect(await plugin.load('/x/y.ts?raw')).toBeUndefined();
  });
});
