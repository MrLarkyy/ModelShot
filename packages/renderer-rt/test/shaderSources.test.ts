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
        expect(fragment).toContain('return u_bakeOn ? shadeBaked(albedo, n, v, light) : shadeSurface(albedo, n, v);');
        // The rim reads the view at the fragment's own world position.
        expect(fragment).toContain('vec3 v = towardEye(v_worldPosition);');
        // The lightmap attribute stays clear of the exact key's corner attributes (4-7).
        expect(vertex).toContain('layout(location = 8) in vec4 a_lightmap;');
        expect(vertex).toContain(depthKey === 'exact' ? 'layout(location = 7)' : 'void passDepthKey(vec4 world) {}');
      }
    }
    // World charts: read bilinearly at their own grid from the corner point and rectangle in the vertex-light varyings;
    // only z = -1 means no light.
    const { vertex, fragment } = shaderProgramSource('opaque', 'exact');
    expect(vertex).toContain('layout(location = 11) in vec4 a_lightmapChart;');
    expect(vertex).toContain('v_vertexLightBack = a_lightmapChart;');
    expect(fragment).toContain('if (chart.z == LIGHTMAP_NONE) return vec4(1.0);');
    expect(fragment).toContain('if (chart.z == LIGHTMAP_WORLD) {');
    expect(fragment).toContain('vec2 at = vertexLight.xy - rect.xy - 0.5;');
    // The vertex light is read at the shading point, as the normal and the edge distances.
    expect(fragment).toContain('vec4 vertexLight = atShadingPoint(v_vertexLight);');
    expect(fragment).toContain('vec4 vertexLightBack = atShadingPoint(v_vertexLightBack);');
    expect(fragment).toContain('interpolatedNormal = atShadingPoint(vec4(v_normal, 0.0)).xyz;');
    expect(fragment).not.toContain('chart.z < 0.0');
    // Light and albedo share the seam taps.
    expect(shaderProgramSource('opaque').fragment.match(/seamTaps\(/g)?.length).toBe(3);
  });

  it('gives only the opaque pass the alpha-to-coverage switch, with alpha 1 and the binary cutout when it is off', () => {
    for (const depthKey of ['raster', 'exact'] as const) {
      const opaque = shaderProgramSource('opaque', depthKey).fragment;
      expect(opaque).toContain('uniform bool u_alphaToCoverage;');
      const body = opaque.slice(opaque.indexOf('void main()'));
      expect(body).toContain('if (s.coverage == COVERAGE_PARTIAL || s.opaqueCoverage <= 0.0) discard;');
      expect(body).toContain('} else if (s.coverage != COVERAGE_OPAQUE) {');
      expect(body).toContain('float alpha = u_alphaToCoverage ? s.opaqueCoverage : 1.0;');
      for (const name of ['oitAccum', 'fallback'] as const) {
        const { fragment } = shaderProgramSource(name, depthKey);
        expect(fragment, `${name} ${depthKey}`).not.toContain('u_alphaToCoverage');
        expect(fragment, `${name} ${depthKey}`).not.toContain('opaqueCoverage <=');
      }
    }
    // The coverage ramp blends the tap indicators with the colour's weights, so it is 0.5 on a texel boundary.
    const texel = shaderProgramSource('opaque').fragment;
    expect(texel).toContain('opaque = mix(mix(o00, o10, f.x), mix(o01, o11, f.x), f.y);');
    expect(texel).toContain('return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);');
    expect(texel).toContain(
      'opaque = coverage == COVERAGE_OPAQUE || (coverage == COVERAGE_PARTIAL && nearestOpaque) ? 1.0 : 0.0;',
    );
  });

  it('addresses every texture texel through faceTexel with the batch texture flags', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { vertex, fragment } = shaderProgramSource(name, depthKey);
        expect(vertex).toContain('layout(location = 12) in float a_textureFlags;');
        expect(vertex).toContain('v_textureFlags = int(a_textureFlags);');
        expect(fragment).toContain('flat in int v_textureFlags;');
        expect(fragment).toContain('sampleTexels(u_texture, v_uv, v_uvRect, v_textureFlags,');
        // The material texture is read in one place, at the texel faceTexel picks.
        const reads = fragment.match(/texelFetch\(tex, [^;]*;/g) ?? [];
        expect(reads, `${name} ${depthKey}`).toEqual([
          'texelFetch(tex, faceTexel(texel, a.range, a.size, a.flags), 0);',
        ]);
        // A strip's lookups stay in its frame (frame count from bit 8 of the flags).
        expect(fragment).toContain('ivec2 s = wrapSize(size, flags);');
      }
    }
    expect(shaderProgramSource('fallback').fragment).toContain(
      'nearestTexel(u_texture, v_uv, v_uvRect, v_textureFlags)',
    );
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

  it('maps normals with the normal matrix, never the upper 3x3 of the model matrix', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      const { vertex } = shaderProgramSource(name);
      expect(vertex).toContain('uniform mat3 u_normalMatrix;');
      expect(vertex).toContain('v_normal = u_normalMatrix * a_normal;');
      expect(vertex).not.toContain('mat3(u_model)');
    }
  });

  it('prepares the shading point and edge derivatives before the first discard and shades with the rounded normal', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { fragment } = shaderProgramSource(name, depthKey);
        const body = fragment.slice(fragment.indexOf('void main()'));
        const prepare = body.indexOf('prepareShading();');
        expect(prepare, `${name} ${depthKey}`).toBeGreaterThan(-1);
        expect(prepare, `${name} ${depthKey}`).toBeLessThan(body.indexOf('discard'));
        expect(body).toContain('shadingNormal()');
        expect(prepare, `${name} ${depthKey}`).toBeLessThan(body.indexOf('sampleBakedLight('));
        expect(body).not.toContain('surfaceNormal(');
        expect(fragment).toContain(
          'vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)',
        );
      }
    }
  });

  it('samples the normal, position, edge distances and baked light at the centroid in every mesh pass, the UV at the centre', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { vertex, fragment } = shaderProgramSource(name, depthKey);
        const label = `${name} ${depthKey}`;
        for (const [type, varying] of [
          ['vec3', 'v_normal'],
          ['vec3', 'v_worldPosition'],
          ['vec4', 'v_edgeDistances'],
          ['vec4', 'v_vertexLight'],
          ['vec4', 'v_vertexLightBack'],
        ] as const) {
          expect(vertex, label).toMatch(new RegExp(`^centroid out ${type} ${varying};$`, 'm'));
          expect(fragment, label).toMatch(new RegExp(`^centroid in ${type} ${varying};$`, 'm'));
        }
        for (const varying of ['v_uv', 'v_uvRect', 'v_lightmap']) {
          expect(vertex, label).toMatch(new RegExp(`^(flat )?out vec\\d ${varying};$`, 'm'));
          expect(fragment, label).toMatch(new RegExp(`^(flat )?in vec\\d ${varying};$`, 'm'));
        }
        expect(vertex.match(/^centroid /gm)?.length, label).toBe(5);
        expect(fragment.match(/^centroid /gm)?.length, label).toBe(5);
        expect(vertex, label).not.toMatch(/^centroid out vec\d (v_uv|v_uvRect|v_lightmap);$/m);
        expect(fragment.match(/^uniform vec2 u_viewportSize;$/gm)?.length, label).toBe(1);
        expect(vertex.match(/u_viewportSize/g)?.length ?? 0, label).toBe(0);
      }
    }
  });

  it('keeps the centroid only where the pixel reaches over a sharp edge, and steps back on any sample pattern', () => {
    for (const name of ['opaque', 'oitAccum', 'fallback'] as const) {
      for (const depthKey of ['raster', 'exact'] as const) {
        const { fragment } = shaderProgramSource(name, depthKey);
        const label = `${name} ${depthKey}`;
        expect(fragment, label).toContain('if (any(lessThan(edgeDistances, 0.5 * edgeFootprint))) {');
        // Every non-singular 4x sample pattern (determinant 1/16 or more) steps back: an RTX 3080 kept 24 pixels at the
        // centroid with a 0.25 bound.
        expect(fragment, label).toContain('bool mapped = maxSkew < 1.0 && abs(det) > 0.03125;');
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
        expect(locations).toContain(11);
        expect(locations).toContain(12);
        // Every varying counted as a whole vector, the most it can take after packing.
        const varyings = vertex.match(/^\s*((flat|centroid) )?out \w+ v_\w+;/gm) ?? [];
        expect(varyings.length, `${name} ${depthKey}`).toBeLessThanOrEqual(15);
        // Raster: the 9 shading varyings; exact: the view position, the three corners and the shared-edge bits too.
        expect(varyings.length, `${name} ${depthKey}`).toBe(depthKey === 'raster' ? 9 : 14);
        for (const varying of ['v_normal', 'v_worldPosition', 'v_edgeDistances']) {
          expect(
            varyings.some((line) => line.includes(` ${varying};`)),
            `${varying} counted`,
          ).toBe(true);
        }
        for (const varying of ['v_worldPosition', 'v_edgeDistances', 'v_edgeAngles']) {
          expect(vertex).toContain(varying);
          expect(fragment).toContain(varying);
        }
      }
    }
  });
});
