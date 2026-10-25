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

  it('addresses material texels with the shared faceTexel and the material flags before the atlas offset', () => {
    for (const name of ['trace', 'bake', 'guide'] as const) {
      const fragment = pathTracerProgramSource(name).fragment;
      expect(fragment).toContain('ivec2 faceTexel(ivec2 texel, ivec4 range, ivec2 size, int flags)');
      expect(fragment).toContain(
        'ivec2 texel = faceTexel(ivec2(floor(hitUv(triangle, b) * size)), range, m.size, m.textureFlags);',
      );
      expect(fragment).toContain('texelFetch(u_textureLayers, ivec3(texel + m.offset, m.layer), 0)');
      expect(fragment.match(/texelFetch\(u_textureLayers/g)).toHaveLength(1);
      expect(fragment).toContain('int(b.y), int(b.z), int(b.w));');
    }
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

  it('shades the catcher with a control variate: only a blocked fill ray brings environment radiance', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    const at = trace.slice(trace.indexOf('float catcherShadeAt('), trace.indexOf('vec3 tracePath('));
    expect(trace).toContain('float catcherShadeOfLoss(vec3 fillLost, float keyLost, vec2 xz, vec4 rect)');
    expect(at).toMatch(
      /vec3 fillLost = closestHit\(origin, d, 0\.0, 3\.0e38, 1\.0, -1, key, dimension \+ 2u, blocker\) \? environmentRadiance\(d\)\s*: vec3\(0\.0\);/,
    );
    expect(at).toContain('return catcherShadeOfLoss(fillLost, 1.0 - keyT, point.xz, u_catcherRect);');
    expect(at).not.toMatch(/catcherShade\(/);
    // The same random dimensions as before: the guide and the goldens' seeds keep their meaning.
    expect(at.match(/unitRandom\(key, dimension( \+ \du)?, 0u\)/g)).toEqual([
      'unitRandom(key, dimension + 4u, 0u)',
      'unitRandom(key, dimension + 5u, 0u)',
      'unitRandom(key, dimension, 0u)',
      'unitRandom(key, dimension + 1u, 0u)',
    ]);
    expect(trace).toContain('coverage = 1.0 - shade;');
  });

  it('sums squared luminance into the second target only when asked', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('layout(location = 0) out vec4 outSum;');
    expect(trace).toContain('layout(location = 1) out float outMoments;');
    expect(trace).toMatch(/if \(u_moments\) \{\s*float luminance = radianceLuminance\(radiance\);/);
    // The radiance sum is written exactly as without moments.
    expect(trace).toContain('outSum = vec4(sum.rgb + radiance, sum.a + float(cappedTraversals));');
  });

  it('sums coverage into a third target only for a transparent request, the opaque paths written as before', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('layout(location = 2) out vec2 outCoverage;');
    expect(trace).toContain('uniform bool u_transparent;');
    expect(trace).toContain(
      'outCoverage = u_transparent ? texelFetch(u_previousCoverage, pixel, 0).rg + vec2(coverage, coverage * coverage) : vec2(0.0);',
    );
    // Opaque: the catcher still shades the backdrop, an escaped camera ray still shows it, the sum is unchanged.
    expect(trace).toContain('if (!u_transparent) return backdropHere() * shade;');
    expect(trace).toContain(
      'radiance += throughput * (pathVertex == 0 ? backdropHere() : environmentRadiance(direction));',
    );
    expect(trace).toContain('outSum = vec4(sum.rgb + radiance, sum.a + float(cappedTraversals));');
    // Coverage reuses the camera ray's outcome: no random dimension of its own.
    const coverage = trace.slice(trace.indexOf('vec3 tracePath('), trace.indexOf('void main()'));
    expect(coverage.match(/unitRandom\(/g)).toHaveLength(7);
  });

  it('presents the opaque image as before and the transparent one over the backdrop or with straight alpha', () => {
    const present = pathTracerProgramSource('present').fragment;
    expect(present).toContain(
      'vec3 linearColor = u_samples > 0.0 ? texelFetch(u_sum, ivec2(gl_FragCoord.xy), 0).rgb / u_samples : backdropHere();',
    );
    expect(present).toContain('outColor = vec4(agxToneMap(linearColor), 1.0);');
    expect(present).toContain('agxToneMap(premultiplied + backdropHere() * (1.0 - coverage))');
    expect(present).toContain('outColor = vec4(alpha > 0.0 ? agxToneMap(premultiplied / alpha) : vec3(0.0), alpha);');
    const resolve = pathTracerProgramSource('resolve').fragment;
    expect(resolve).toContain('outColor = vec4(total / area, u_transparent ? coverage / area : 1.0);');
    expect(resolve).toContain(
      'coverage += u_coverageFiltered ? texelFetch(u_filteredCoverage, p, 0).r : texelFetch(u_coverage, p, 0).r / u_samples;',
    );
  });

  it('denoises coverage with the radiance weights and measures its noise, the opaque arithmetic unchanged', () => {
    const denoise = pathTracerProgramSource('denoise').fragment;
    const weighted = denoise.indexOf('w *= wNormal * wAlbedo * wLuminance * wDepth;');
    const coverage = denoise.indexOf('float wc = w * exp(-abs(c - coverageCentre) / coverageStop);');
    expect(coverage).toBeGreaterThan(weighted);
    expect(denoise).toContain('outFiltered = vec4(filtered / weights, variance / (weights * weights));');
    expect(denoise).toContain('layout(location = 1) out float outCoverage;');
    const noise = pathTracerProgramSource('noise').fragment;
    expect(noise).toContain(
      'worst = max(worst, sqrt(max(variance, 0.0) / (area * area)) / max(mean / area, MEAN_FLOOR));',
    );
    expect(noise).toContain('coverageVariance += varianceOfMean(coverage.r, coverage.g, u_samples);');
  });

  it('takes the guide through stratified points with the alpha rule and keys of the trace, more at partial texels', () => {
    const guide = pathTracerProgramSource('guide').fragment;
    expect(guide).toContain('uint key = sampleHash(u_seed, i, uvec2(pixel));');
    expect(guide).toContain('vec2 point = fract(vec2(vanDerCorput(i), sobol(i)) + rotation);');
    expect(guide).toContain(
      'closestHit(origin, direction, tMin, tMax, depthScale, -1, key, FIRST_VERTEX_DIMENSION + 3u, hit, true)',
    );
    expect(guide).toContain('if (i + 1u == rays && partial) rays = max(rays, u_partialGuideRays);');
    // Both are camera rays (outline hulls' camera-only faces count) accepting partial texels in the same dimension.
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).toContain('uint dimension = FIRST_VERTEX_DIMENSION + uint(pathVertex) * DIMENSIONS_PER_VERTEX;');
    expect(trace).toContain(
      'closestHit(origin, direction, tMin, tMax, depthScale, skip, key, dimension + 3u, hit, pathVertex == 0)',
    );
  });

  it('stops the filter at albedo, normal, depth and luminance edges; the first pass reads the accumulation', () => {
    const denoise = pathTracerProgramSource('denoise').fragment;
    expect(denoise).toContain('w *= wNormal * wAlbedo * wLuminance * wDepth;');
    expect(denoise).toContain('if (!u_first) return texelFetch(u_source, p, 0);');
    expect(denoise).toContain('const float KERNEL[3] = float[3](0.375, 0.25, 0.0625);');
  });

  it('skips a tap of weight 0 after weighting it and before adding it, so no 0 * Inf reaches the sums', () => {
    const denoise = pathTracerProgramSource('denoise').fragment;
    const weighted = denoise.indexOf('w *= wNormal * wAlbedo * wLuminance * wDepth;');
    const skip = denoise.indexOf('if (!(w > 0.0)) continue;');
    const added = denoise.indexOf('filtered += w * c.rgb;');
    expect(weighted).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(weighted);
    expect(added).toBeGreaterThan(skip);
    expect(denoise.match(/if \(!\(w > 0\.0\)\) continue;/g)).toHaveLength(1);
  });

  it('filters demodulated radiance and multiplies the same floored albedo back', () => {
    const denoise = pathTracerProgramSource('denoise').fragment;
    expect(denoise).toContain('sum / u_samples / texelFetch(u_albedo, p, 0).rgb');
    expect(pathTracerProgramSource('resolve').fragment).toContain('c * texelFetch(u_albedo, p, 0).rgb');
    expect(pathTracerProgramSource('guide').fragment).toContain('max(albedo / count, vec3(ALBEDO_FLOOR))');
  });

  it('measures noise in the blocks the CPU sizes the noise target by', () => {
    expect(pathTracerProgramSource('noise').fragment).toContain(`const int NOISE_BLOCK = ${NOISE_BLOCK};`);
  });
});
