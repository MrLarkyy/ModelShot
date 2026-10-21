import { describe, expect, it } from 'vitest';
import { LOOK_PRESETS } from '../src/lookPresets';

// Presets are data: no renderer source, shader or look module other than the preset table names one.
const sources = {
  ...import.meta.glob<string>('../../renderer-rt/src/**/*.{ts,glsl}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>('../../pathtracer/src/**/*.{ts,glsl}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>(['../src/**/*.{ts,glsl}', '!../src/lookPresets.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
};

describe('look presets are data, not code paths', () => {
  it('scans the renderers, the tracer and the look chunks', () => {
    const files = Object.keys(sources);
    expect(files.some((file) => file.includes('/renderer-rt/src/shaders/'))).toBe(true);
    expect(files.some((file) => file.includes('/pathtracer/src/shaders/'))).toBe(true);
    expect(files.some((file) => file.endsWith('/glsl/lightRig.glsl'))).toBe(true);
    expect(files.some((file) => file.endsWith('/lookPresets.ts'))).toBe(false);
  });

  it('no source mentions a preset id', () => {
    const ids = Object.keys(LOOK_PRESETS);
    expect(ids).toEqual(['studio', 'marketplace', 'rim']);
    for (const [file, text] of Object.entries(sources)) {
      for (const id of ids) {
        // A quoted id is a branch or a lookup by name. GLSL has no strings, so there any mention of the word counts.
        // An id that is also the name of a light (the rim light is in every look) may appear where lights are named:
        // in GLSL and in the look's own schema.
        const schema = file.endsWith('.glsl') || file.startsWith('../src/');
        if (schema && ['key', 'fill', 'rim'].includes(id)) continue;
        const pattern = file.endsWith('.glsl') ? new RegExp(`\\b${id}\\b`, 'i') : new RegExp(`['"\`]${id}['"\`]`);
        expect(pattern.test(text), `${file} mentions "${id}"`).toBe(false);
      }
    }
  });
});
