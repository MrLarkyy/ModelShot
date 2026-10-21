import { describe, expect, it } from 'vitest';
import { MAX_BVH_DEPTH } from '../src/buildBvh';
import {
  MATERIAL_TEXELS,
  NODE_TEXELS,
  TRIANGLE_ATTRIBUTE_TEXELS,
  TRIANGLE_POSITION_TEXELS,
} from '../src/packSceneData';
import { pathTracerProgramSource } from '../src/pathTracerShaders';

describe('path tracer shaders', () => {
  for (const name of ['trace', 'present', 'bake'] as const) {
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
    for (const name of ['trace', 'bake'] as const) {
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
});
