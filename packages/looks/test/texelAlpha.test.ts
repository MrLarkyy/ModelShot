import { describe, expect, it } from 'vitest';
import texelAlphaGlsl from '../src/glsl/texelAlpha.glsl?raw';
import {
  ALPHA_MODE_ID,
  COVERAGE_INVISIBLE,
  COVERAGE_OPAQUE,
  COVERAGE_PARTIAL,
  alphaCutoffByte,
  texelCoverageByte,
} from '../src/texelAlpha';

function glslInt(name: string): number {
  const match = new RegExp(`const int ${name} = (\\d+);`).exec(texelAlphaGlsl);
  if (!match) throw new Error(`${name} missing from texelAlpha.glsl`);
  return Number(match[1]);
}

describe('texelAlpha', () => {
  it('GLSL ids equal the TypeScript ids', () => {
    expect(glslInt('ALPHA_MODE_OPAQUE')).toBe(ALPHA_MODE_ID.opaque);
    expect(glslInt('ALPHA_MODE_MASK')).toBe(ALPHA_MODE_ID.mask);
    expect(glslInt('ALPHA_MODE_BLEND')).toBe(ALPHA_MODE_ID.blend);
    expect(glslInt('COVERAGE_INVISIBLE')).toBe(COVERAGE_INVISIBLE);
    expect(glslInt('COVERAGE_PARTIAL')).toBe(COVERAGE_PARTIAL);
    expect(glslInt('COVERAGE_OPAQUE')).toBe(COVERAGE_OPAQUE);
  });

  it('alphaCutoffByte is the smallest byte at or above the cutoff', () => {
    expect([0, 0.5 / 255, 0.01, 0.5, 128 / 255, 1].map(alphaCutoffByte)).toEqual([0, 1, 3, 128, 128, 255]);
    expect(alphaCutoffByte(1.0001)).toBe(256);
  });

  it('texelCoverageByte follows the mode', () => {
    const blend = (k: number) => texelCoverageByte(k, ALPHA_MODE_ID.blend, 3);
    expect([0, 2, 3, 254, 255].map(blend)).toEqual([0, 0, 1, 1, 2]);
    expect([0, 2, 3, 255].map((k) => texelCoverageByte(k, ALPHA_MODE_ID.mask, 3))).toEqual([0, 0, 2, 2]);
    expect([0, 255].map((k) => texelCoverageByte(k, ALPHA_MODE_ID.opaque, 3))).toEqual([2, 2]);
  });
});
