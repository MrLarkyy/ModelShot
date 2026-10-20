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
  for (const name of ['trace', 'present'] as const) {
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

  it('has no clock or time input', () => {
    const trace = pathTracerProgramSource('trace').fragment;
    expect(trace).not.toMatch(/u_time|u_clock|u_frameTime/);
  });
});
