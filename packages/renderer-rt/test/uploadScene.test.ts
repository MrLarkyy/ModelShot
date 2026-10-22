import { describe, expect, it } from 'vitest';
import { uploadExactGeometry, uploadScene } from '../src/uploadScene';
import { fakeWebGl } from './fakeWebGl';
import { quadScene } from './testScene';

const CHART_LOCATION = 11;

describe('uploadScene', () => {
  it('uploads the world chart attribute only for a batch with world charts, in both geometries', () => {
    const enabled = (corners: (Float32Array | null)[]): { indexed: number[]; exact: number[] } => {
      const fake = fakeWebGl();
      const gl = fake.gl;
      const scene = uploadScene(gl, quadScene(), [], [], [], [], corners);
      const indexed = fake.calls('enableVertexAttribArray').map(([location]) => location as number);
      uploadExactGeometry(gl, scene);
      const exact = fake
        .calls('enableVertexAttribArray')
        .slice(indexed.length)
        .map(([location]) => location as number);
      return { indexed, exact };
    };
    const plain = enabled([]);
    expect(plain.indexed).not.toContain(CHART_LOCATION);
    expect(plain.exact).not.toContain(CHART_LOCATION);
    expect(plain.indexed).toContain(8);
    const world = enabled([Float32Array.from({ length: 6 * 8 }, (_, i) => (i % 8 === 2 ? -2 : i))]);
    expect(world.indexed).toContain(CHART_LOCATION);
    expect(world.exact).toContain(CHART_LOCATION);
  });
});
