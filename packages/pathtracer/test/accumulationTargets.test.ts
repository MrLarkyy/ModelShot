import { describe, expect, it } from 'vitest';
import { AccumulationTargets } from '../src/accumulationTargets';
import { stubGl } from './stubGl';

const textureFormats = (calls: ReturnType<typeof stubGl>['calls']): unknown[] =>
  calls.filter((c) => c.name === 'texStorage2D').map((c) => c.args[2]);

const drawBuffers = (calls: ReturnType<typeof stubGl>['calls']): unknown[] =>
  calls.filter((c) => c.name === 'drawBuffers').map((c) => c.args[0]);

describe('AccumulationTargets', () => {
  it('allocates no coverage target for an opaque request, with or without moments', () => {
    for (const moments of [false, true]) {
      const { gl, calls } = stubGl();
      const targets = new AccumulationTargets(gl, 8, 4, moments);
      expect(targets.sum.coverage).toBeNull();
      expect(textureFormats(calls)).toEqual(
        moments ? [gl.RGBA32F, gl.R32F, gl.RGBA32F, gl.R32F] : [gl.RGBA32F, gl.RGBA32F],
      );
      expect(drawBuffers(calls)).toEqual(
        moments
          ? [
              [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1],
              [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1],
            ]
          : [],
      );
    }
  });

  it('gives a transparent request an RG32F coverage sum at attachment 2 of each target', () => {
    const { gl, calls } = stubGl();
    const targets = new AccumulationTargets(gl, 8, 4, false, true);
    expect(textureFormats(calls)).toEqual([gl.RGBA32F, gl.RG32F, gl.RGBA32F, gl.RG32F]);
    expect(targets.sum.coverage).not.toBeNull();
    expect(targets.next.coverage).not.toBe(targets.sum.coverage);
    // Without moments draw buffer 1 is NONE, as WebGL2 wants draw buffer i to be attachment i or nothing.
    expect(drawBuffers(calls)).toEqual([
      [gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2],
      [gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2],
    ]);
    const attached = calls.filter((c) => c.name === 'framebufferTexture2D' && c.args[1] === gl.COLOR_ATTACHMENT2);
    expect(attached.map((c) => c.args[3])).toEqual([targets.sum.coverage, targets.next.coverage]);
  });

  it('keeps moments at attachment 1 beside the coverage', () => {
    const { gl, calls } = stubGl();
    new AccumulationTargets(gl, 8, 4, true, true);
    expect(textureFormats(calls)).toEqual([gl.RGBA32F, gl.R32F, gl.RG32F, gl.RGBA32F, gl.R32F, gl.RG32F]);
    expect(drawBuffers(calls)[0]).toEqual([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
  });

  it('clears the coverage sums with the radiance sums and deletes them with the targets', () => {
    const { gl, calls } = stubGl();
    const targets = new AccumulationTargets(gl, 8, 4, false, true);
    const clears = calls.filter((c) => c.name === 'clearBufferfv').map((c) => c.args[1]);
    expect(clears).toEqual([0, 2, 0, 2]);
    targets.dispose();
    const deleted = calls.filter((c) => c.name === 'deleteTexture').map((c) => c.args[0]);
    expect(deleted).toHaveLength(4);
    expect(deleted).toContain(targets.sum.coverage);
    expect(deleted).toContain(targets.next.coverage);
  });

  it('names the coverage target when the float targets are not renderable', () => {
    const { gl } = stubGl();
    const incomplete = new Proxy(gl, {
      get: (target, property, receiver) =>
        property === 'checkFramebufferStatus' ? () => 0 : (Reflect.get(target, property, receiver) as unknown),
    });
    expect(() => new AccumulationTargets(incomplete, 8, 4, false, true)).toThrow(
      'RGBA32F + RG32F coverage accumulation targets are not renderable here',
    );
    expect(() => new AccumulationTargets(incomplete, 8, 4, true, true)).toThrow(
      'RGBA32F + R32F moment and RG32F coverage accumulation targets are not renderable here',
    );
    expect(() => new AccumulationTargets(incomplete, 8, 4, true)).toThrow(
      'RGBA32F + R32F accumulation targets are not renderable here',
    );
  });
});
