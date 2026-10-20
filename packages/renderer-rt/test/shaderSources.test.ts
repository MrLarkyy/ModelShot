import { describe, expect, it } from 'vitest';
import { createGlProgram } from '../src/glProgram';
import { RendererError } from '../src/index';
import { shaderProgramSource, type ShaderProgramName } from '../src/shaderSources';

const NAMES: ShaderProgramName[] = ['opaque', 'oitAccum', 'oitComposite', 'present', 'fallback', 'backdrop'];

/** Just enough of WebGL2 to drive createGlProgram; compile fails for sources containing "BROKEN". */
function fakeGl(): { gl: WebGL2RenderingContext; deleted: string[] } {
  const deleted: string[] = [];
  const sources = new Map<object, string>();
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: () => ({}),
    shaderSource: (shader: object, source: string) => sources.set(shader, source),
    compileShader: () => undefined,
    getShaderParameter: (shader: object) => !(sources.get(shader) ?? '').includes('BROKEN'),
    getShaderInfoLog: () => "ERROR: 0:7: 'BROKEN' : syntax error\n",
    deleteShader: () => deleted.push('shader'),
    createProgram: () => ({}),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    deleteProgram: () => deleted.push('program'),
    isContextLost: () => false,
  };
  return { gl: gl as unknown as WebGL2RenderingContext, deleted };
}

describe('shader sources', () => {
  for (const name of NAMES) {
    it(`${name} links from static chunks with #version first and no include left`, () => {
      const { vertex, fragment } = shaderProgramSource(name);
      for (const source of [vertex, fragment]) {
        expect(source.startsWith('#version 300 es\n')).toBe(true);
        expect(source).not.toMatch(/#\s*include/);
      }
    });
  }

  it('reads the texel alpha classes and AgX from the shared look chunks', () => {
    expect(shaderProgramSource('opaque').fragment).toContain('TEXEL_ALPHA_OPAQUE_MIN = 254.5 / 255.0');
    expect(shaderProgramSource('present').fragment).toContain('vec3 agxToneMap(vec3 linearColor)');
    expect(shaderProgramSource('fallback').fragment).toContain('vec3 agxToneMap(vec3 linearColor)');
  });

  it('surfaces a compile error with the info log as RendererError', () => {
    const { gl, deleted } = fakeGl();
    const { vertex } = shaderProgramSource('opaque');
    expect(() => createGlProgram(gl, vertex, '#version 300 es\nBROKEN', 'opaque')).toThrow(RendererError);
    expect(() => createGlProgram(gl, vertex, '#version 300 es\nBROKEN', 'opaque')).toThrow(
      /opaque fragment: shader compile failed: ERROR: 0:7: 'BROKEN'/,
    );
    expect(deleted.filter((d) => d === 'shader').length).toBe(4);
  });
});
