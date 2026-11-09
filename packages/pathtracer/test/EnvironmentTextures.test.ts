import { environmentLighting, type LookHdriEnvironment } from '@modelshot/looks';
import { describe, expect, it } from 'vitest';
import { EnvironmentTextures } from '../src/EnvironmentTextures';
import { stubGl } from './stubGl';

const SOFTBOX: LookHdriEnvironment = { kind: 'hdri', image: 'softbox-studio', intensity: 1, rotationDeg: 0 };

describe('EnvironmentTextures', () => {
  it('uploads the marginal CDF in r and the catcher marginal in g of one RG32F row, read by texelFetch', () => {
    const { gl, calls } = stubGl();
    new EnvironmentTextures(gl).bind(SOFTBOX, 5, 6);
    const lighting = environmentLighting(SOFTBOX);
    expect(calls.filter((c) => c.name === 'texStorage2D').map((c) => c.args.slice(2))).toEqual([
      [gl.RGBA32F, lighting.width, lighting.height],
      [gl.RG32F, lighting.height, 1],
    ]);
    const uploads = calls.filter((c) => c.name === 'texSubImage2D');
    expect(uploads.map((c) => c.args.slice(4, 8))).toEqual([
      [lighting.width, lighting.height, gl.RGBA, gl.FLOAT],
      [lighting.height, 1, gl.RG, gl.FLOAT],
    ]);
    const marginals = uploads[1]?.args[8] as Float32Array;
    expect(marginals).toHaveLength(lighting.height * 2);
    for (let row = 0; row < lighting.height; row++) {
      expect(marginals[row * 2], `row ${row} r`).toBe(lighting.marginal[row]);
      expect(marginals[row * 2 + 1], `row ${row} g`).toBe(lighting.catcherMarginal[row]);
    }
    const filters = calls.filter((c) => c.name === 'texParameteri').map((c) => c.args[2]);
    expect(filters.every((f) => f === gl.NEAREST)).toBe(true);
  });

  it('uploads nothing for a dome', () => {
    const { gl, calls } = stubGl();
    new EnvironmentTextures(gl).bind({ kind: 'dome', sky: [1, 1, 1], ground: [0, 0, 0] }, 5, 6);
    expect(calls.some((c) => c.name === 'texStorage2D')).toBe(false);
  });
});
