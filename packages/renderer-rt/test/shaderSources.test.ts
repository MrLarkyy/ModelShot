import { describe, expect, it } from 'vitest';
import { createGlProgram } from '../src/glProgram';
import { RendererError } from '../src/index';
import { shaderProgramSource, type ShaderProgramName } from '../src/shaderSources';

const NAMES: ShaderProgramName[] = ['opaque', 'oitAccum', 'oitComposite', 'present', 'fallback', 'backdrop', 'catcher'];

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
    expect(shaderProgramSource('opaque').fragment).toContain(
      'int texelCoverage(float alpha, int mode, int cutoffByte)',
    );
    expect(shaderProgramSource('present').fragment).toContain('vec3 agxToneMap(vec3 linearColor)');
    expect(shaderProgramSource('fallback').fragment).toContain('vec3 agxToneMap(vec3 linearColor)');
  });

  it('takes the depth key derivatives before the first discard in every mesh pass', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { fragment } = shaderProgramSource(name, depthKey);
        const body = fragment.slice(fragment.indexOf('void main()'));
        const prepare = body.indexOf('prepareDepthKey();');
        const discard = body.indexOf('discard');
        expect(prepare, `${name} ${depthKey}`).toBeGreaterThan(-1);
        expect(prepare, `${name} ${depthKey}`).toBeLessThan(discard);
      }
    }
  });

  it('samples the baked light before the first discard and shades unbaked frames as before', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { vertex, fragment } = shaderProgramSource(name, depthKey);
        const body = fragment.slice(fragment.indexOf('void main()'));
        const light = body.indexOf('sampleBakedLight(v_uv, v_uvRect)');
        expect(light, `${name} ${depthKey}`).toBeGreaterThan(-1);
        expect(light, `${name} ${depthKey}`).toBeLessThan(body.indexOf('discard'));
        expect(fragment).toContain('return u_bakeOn ? shadeBaked(albedo, n, light) : shadeSurface(albedo, n);');
        // The lightmap attribute stays clear of the exact key's corner attributes (4-7).
        expect(vertex).toContain('layout(location = 8) in vec4 a_lightmap;');
        expect(vertex).toContain(depthKey === 'exact' ? 'layout(location = 7)' : 'void passDepthKey(vec4 world) {}');
      }
    }
    // Light and albedo share the seam taps.
    expect(shaderProgramSource('opaque').fragment.match(/seamTaps\(/g)?.length).toBe(3);
  });

  it('shades the catcher with the look chunk, tone-mapped only on request', () => {
    const { fragment } = shaderProgramSource('catcher');
    expect(fragment).toContain('float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)');
    expect(fragment).toContain('u_toneMap ? agxToneMap(color) : color');
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

  it('prepares the edge derivatives before the first discard and shades with the rounded normal', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { fragment } = shaderProgramSource(name, depthKey);
        const body = fragment.slice(fragment.indexOf('void main()'));
        const prepare = body.indexOf('prepareEdges();');
        expect(prepare, `${name} ${depthKey}`).toBeGreaterThan(-1);
        expect(prepare, `${name} ${depthKey}`).toBeLessThan(body.indexOf('discard'));
        expect(body).toContain('shadingNormal(v_normal)');
        expect(body).not.toContain('surfaceNormal(');
        expect(fragment).toContain(
          'vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)',
        );
      }
    }
  });

  it('stays within the WebGL2 minimums of 16 attributes and 15 varyings in every mesh pass and variant', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { vertex, fragment } = shaderProgramSource(name, depthKey);
        const locations = [...vertex.matchAll(/layout\(location = (\d+)\) in /g)].map((m) => Number(m[1]));
        expect(Math.max(...locations), `${name} ${depthKey}`).toBeLessThan(16);
        expect(locations).toContain(9);
        expect(locations).toContain(10);
        // Every varying counted as a whole vector, the most it can take after packing.
        const varyings = vertex.match(/^\s*(flat )?out \w+ v_\w+;/gm) ?? [];
        expect(varyings.length, `${name} ${depthKey}`).toBeLessThanOrEqual(15);
        for (const varying of ['v_worldPosition', 'v_edgeDistances', 'v_edgeAngles']) {
          expect(vertex).toContain(varying);
          expect(fragment).toContain(varying);
        }
      }
    }
  });
});
