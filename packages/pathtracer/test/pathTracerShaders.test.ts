import { describe, expect, it } from 'vitest';
import { MAX_BVH_DEPTH } from '../src/buildBvh';
import {
  MATERIAL_TEXELS,
  NODE_TEXELS,
  TRIANGLE_ATTRIBUTE_TEXELS,
  TRIANGLE_POSITION_TEXELS,
} from '../src/packSceneData';
import { pathTracerProgramSource } from '../src/pathTracerShaders';
import { NOISE_BLOCK } from '../src/resolveTargets';

describe('path tracer shaders', () => {
  for (const name of ['trace', 'present', 'bake', 'guide', 'denoise', 'resolve', 'noise'] as const) {
    it(`${name} links from static chunks with #version first and no include left`, () => {
      const { vertex, fragment } = pathTracerProgramSource(name);
      for (const source of [vertex, fragment]) {
        expect(source.startsWith('#version 300 es\n')).toBe(true);
        expect(source).not.toMatch(/#\s*include/);
      }
    });
  }

  it('reads alpha, face texels, light and tone mapping from the shared look chunks', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('int texelCoverage(float alpha, int mode, int cutoffByte)');
    expect(trace).toContain('ivec4 faceTexelRange(vec4 uvRect, vec2 size)');
    expect(trace).toContain('vec3 environmentRadiance(vec3 d)');
    expect(pathTracerProgramSource('present').fragment).toContain('vec3 agxToneMap(vec3 linearColor)');
  });

  it('adds the fill and the rim at the camera hit only, the rim seen back along the camera ray; the bake has neither', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain(
      'if (pathVertex == 0) radiance += s.albedo * fillLight(s.normal) + rimLight(s.normal, -direction, s.albedo);',
    );
    expect(trace.match(/rimLight\(s\./g)).toHaveLength(1);
    const bake = pathTracerProgramSource('bake').fragment;
    expect(bake).not.toMatch(/fillLight\(n|fillLight\(s|rimLight\(s|rimLight\(n/);
  });

  it('lays out data as packSceneData writes it, with a stack deep enough for any BVH', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain(`const int NODE_TEXELS = ${NODE_TEXELS};`);
    expect(trace).toContain(`const int TRIANGLE_POSITION_TEXELS = ${TRIANGLE_POSITION_TEXELS};`);
    expect(trace).toContain(`const int TRIANGLE_ATTRIBUTE_TEXELS = ${TRIANGLE_ATTRIBUTE_TEXELS};`);
    expect(trace).toContain(`const int MATERIAL_TEXELS = ${MATERIAL_TEXELS};`);
    expect(trace).toContain(`const int BVH_STACK_SIZE = ${MAX_BVH_DEPTH + 1};`);
  });

  it('bounds every traversal by a fixed node count', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('const int MAX_NODE_VISITS = 2048;');
    expect(trace.match(/for \(int visits = 0; visits < MAX_NODE_VISITS; visits\+\+\)/g)).toHaveLength(2);
    expect(trace).not.toMatch(/while \(/);
    // Capped traversals are counted into the accumulation's alpha.
    expect(trace).toContain('sum.a + float(cappedTraversals)');
  });

  it('has no clock or time input', () => {
    for (const name of ['trace', 'bake', 'guide', 'denoise', 'resolve', 'noise'] as const) {
      expect(pathTracerProgramSource(name).fragment).not.toMatch(/u_time|u_clock|u_frameTime/);
    }
  });

  it('traces bake rays with the same chunks and ray functions as the render', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    const bake = pathTracerProgramSource('bake').fragment;
    for (const shared of [
      'float shadowTransmittance(vec3 origin, vec3 direction, int skip)',
      'bool closestHit(',
      'Surface surfaceAt(Hit hit)',
      'vec3 keyConeDirection(float u1, float u2)',
      'vec3 cosineDirection(vec3 n, float u1, float u2)',
      'vec3 leave(vec3 p, vec3 side)',
      'vec3 environmentRadiance(vec3 d)',
    ]) {
      expect(trace, shared).toContain(shared);
      expect(bake, shared).toContain(shared);
    }
    expect(trace).toContain('float catcherShade(vec3 fill, float keyT, vec2 xz, vec4 rect)');
    expect(bake).toContain('shadowTransmittance(origin, cone, skip)');
    expect(trace).toContain('shadowTransmittance(leave(s.position, s.side), cone, hit.triangle)');
  });

  it('rounds the shading normal at sharp edges with the shared chunk before the back side flips it', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)');
    const surface = trace.slice(trace.indexOf('Surface surfaceAt(Hit hit)'));
    const round = surface.indexOf('if (u_edgeWidth > 0.0) n = edgeRoundedNormal(');
    expect(round).toBeGreaterThan(-1);
    expect(round).toBeLessThan(surface.indexOf('s.normal = hit.back ? -n : n;'));
    // The path tracer averages its jittered samples: no footprint filter.
    expect(trace).toContain('roundedNormal(n, d, angle, t, u_edgeWidth, vec4(0.0))');
  });

  it('mirrors a bounce below the surface instead of ending the path', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('vec3 aboveSurface(vec3 d, vec3 side)');
    expect(trace).toMatch(/vec3 next = aboveSurface\(\s*cosineDirection\(s\.normal/);
  });

  it('defines the shadow catcher once, in the chunk the trace and the guide share', () => {
    for (const name of ['trace', 'guide'] as const) {
      const source = pathTracerProgramSource(name).fragment;
      expect(source.match(/bool catcherHit\(/g), name).toHaveLength(1);
      expect(source.match(/const uint FIRST_VERTEX_DIMENSION = 2u;/g), name).toHaveLength(1);
    }
  });

  it('sums squared luminance into the second target only when asked', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('layout(location = 0) out vec4 outSum;');
    expect(trace).toContain('layout(location = 1) out float outMoments;');
    expect(trace).toMatch(/if \(u_moments\) \{\s*float luminance = radianceLuminance\(radiance\);/);
    // The radiance sum is written exactly as without moments.
    expect(trace).toContain('outSum = vec4(sum.rgb + radiance, sum.a + float(cappedTraversals));');
  });

  it('replays the camera rays of the first samples in the guide: same keys, jitter and alpha dimension', () => {
    const guide = pathTracerProgramSource('guide').fragment;
    expect(guide).toContain('uint key = sampleHash(u_seed, i, uvec2(pixel));');
    expect(guide).toContain(
      'primaryRay(vec2(pixel) + vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u)), origin, direction);',
    );
    expect(guide).toContain(
      'closestHit(origin, direction, tMin, tMax, depthScale, -1, key, FIRST_VERTEX_DIMENSION + 3u, hit)',
    );
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain(
      'primaryRay(pixel + vec2(unitRandom(key, 0u, 0u), unitRandom(key, 1u, 0u)), origin, direction);',
    );
    expect(trace).toContain('uint dimension = FIRST_VERTEX_DIMENSION + uint(pathVertex) * DIMENSIONS_PER_VERTEX;');
    expect(trace).toContain('closestHit(origin, direction, tMin, tMax, depthScale, skip, key, dimension + 3u, hit)');
  });

  it('filters demodulated radiance and multiplies the same floored albedo back', () => {
    const denoise = pathTracerProgramSource('denoise').fragment;
    expect(denoise).toContain('sum / u_samples / texelFetch(u_albedo, p, 0).rgb');
    expect(pathTracerProgramSource('resolve').fragment).toContain('c * texelFetch(u_albedo, p, 0).rgb');
    expect(pathTracerProgramSource('guide').fragment).toContain('max(albedo / rays, vec3(ALBEDO_FLOOR))');
  });

  it('measures noise in the blocks the CPU sizes the noise target by', () => {
    expect(pathTracerProgramSource('noise').fragment).toContain(`const int NOISE_BLOCK = ${NOISE_BLOCK};`);
  });
});
