import { describe, expect, it } from 'vitest';
import { EDGE_LOOK_V0, MAX_EDGE_WIDTH, checkEdgeLook } from '../src/EdgeLook';
import { edgeRamp, roundedNormal } from '../src/edgeRounding';
import edgeRoundingSource from '../src/glsl/edgeRounding.glsl?raw';
import { linkShader } from '../src/linkShader';
import { lookShaderChunks } from '../src/lookShaderChunks';

type V3 = readonly [number, number, number];
const ZERO: V3 = [0, 0, 0];
const NONE = [ZERO, ZERO, ZERO, ZERO] as const;
const FAR = 1e6;

/** The normal of a cube face with one edge in slot 0, at distance d. */
function face(n: V3, toward: V3, d: number, width = 0.5, footprint = 0): V3 {
  return roundedNormal(n, [d, FAR, FAR, FAR], [Math.PI / 2, 0, 0, 0], [toward, ZERO, ZERO, ZERO], width, [
    footprint,
    0,
    0,
    0,
  ]);
}

describe('roundedNormal', () => {
  it('meets the other face at the bisector on the edge', () => {
    // The up face (+y) and the east face (+x) of a cube share the edge along z.
    const up = face([0, 1, 0], [1, 0, 0], 0);
    const east = face([1, 0, 0], [0, 1, 0], 0);
    for (let i = 0; i < 3; i++) expect(up[i]).toBeCloseTo(east[i] ?? 0, 12);
    expect(up[0]).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('turns continuously and leaves the face unchanged at the width and beyond', () => {
    let previous = face([0, 1, 0], [1, 0, 0], 0);
    for (let d = 0.01; d <= 0.5; d += 0.01) {
      const n = face([0, 1, 0], [1, 0, 0], d);
      expect(Math.acos(Math.min(1, n[0] * previous[0] + n[1] * previous[1]))).toBeLessThan(0.07);
      previous = n;
    }
    expect(face([0, 1, 0], [1, 0, 0], 0.5)).toEqual([0, 1, 0]);
    expect(face([0, 1, 0], [1, 0, 0], 3)).toEqual([0, 1, 0]);
  });

  it('returns the very same normal for empty slots and a width of 0', () => {
    const n: V3 = [0.6, 0.8, 0];
    expect(roundedNormal(n, [FAR, FAR, FAR, FAR], [0, 0, 0, 0], NONE, 0.5, [0, 0, 0, 0])).toBe(n);
    expect(roundedNormal(n, [0, 0, 0, 0], [1, 1, 1, 1], NONE, 0, [0, 0, 0, 0])).toBe(n);
  });

  it('bends a crease the other way', () => {
    const convex = face([0, 1, 0], [1, 0, 0], 0.1);
    const crease = roundedNormal(
      [0, 1, 0],
      [0.1, FAR, FAR, FAR],
      [-Math.PI / 2, 0, 0, 0],
      [[1, 0, 0], ZERO, ZERO, ZERO],
      0.5,
      [0, 0, 0, 0],
    );
    expect(convex[0]).toBeGreaterThan(0);
    expect(crease[0]).toBeCloseTo(-convex[0], 12);
  });
});

describe('edgeRamp', () => {
  it('is unfiltered at footprint 0', () => {
    expect(edgeRamp(0, 0.5, 0)).toBe(1);
    expect(edgeRamp(0.25, 0.5, 0)).toBe(0.5);
    expect(edgeRamp(0.75, 0.5, 0)).toBe(0);
  });

  it('box-filters to the mean of jittered unfiltered samples, as the path tracer averages a pixel', () => {
    for (const [d, footprint] of [
      [0, 0.3],
      [0.2, 0.3],
      [0.45, 0.2],
      [0.1, 2],
    ] as const) {
      const n = 4096;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += edgeRamp(d + ((i + 0.5) / n - 0.5) * footprint, 0.5, 0);
      expect(edgeRamp(d, 0.5, footprint)).toBeCloseTo(sum / n, 5);
    }
  });
});

describe('checkEdgeLook', () => {
  it('fills the v0 look and keeps a base', () => {
    expect(checkEdgeLook(undefined)).toEqual(EDGE_LOOK_V0);
    expect(checkEdgeLook({ width: 1 })).toEqual({ width: 1, sharpAngleDeg: 30 });
    expect(checkEdgeLook({ sharpAngleDeg: 45 }, { width: 2, sharpAngleDeg: 30 })).toEqual({
      width: 2,
      sharpAngleDeg: 45,
    });
    expect(checkEdgeLook({ width: 0 }).width).toBe(0);
    expect(checkEdgeLook({ width: MAX_EDGE_WIDTH }).width).toBe(MAX_EDGE_WIDTH);
  });

  it('rejects values naming the field', () => {
    expect(() => checkEdgeLook({ width: Number.NaN })).toThrow(/edges\.width/);
    expect(() => checkEdgeLook({ width: -0.1 })).toThrow(/edges\.width/);
    expect(() => checkEdgeLook({ width: MAX_EDGE_WIDTH + 0.01 })).toThrow(/edges\.width/);
    expect(() => checkEdgeLook({ width: Infinity })).toThrow(RangeError);
    expect(() => checkEdgeLook({ sharpAngleDeg: 0 })).toThrow(/edges\.sharpAngleDeg/);
    expect(() => checkEdgeLook({ sharpAngleDeg: 180 })).toThrow(/edges\.sharpAngleDeg/);
    expect(() => checkEdgeLook({ width: '1' as unknown as number })).toThrow(/edges\.width/);
  });
});

describe('edgeRounding chunk', () => {
  it('defines the function the renderers call and links with the look chunks', () => {
    expect(edgeRoundingSource).toContain(
      'vec3 roundedNormal(vec3 n, vec4 d, vec4 angle, vec3 t[4], float width, vec4 footprint)',
    );
    expect(edgeRoundingSource).toContain('tan(asin(r * sin(0.5 * angle[k])))');
    const linked = linkShader('#include "edgeRounding"', lookShaderChunks);
    expect(linked).toContain('float edgeRamp(float d, float width, float footprint)');
  });
});
