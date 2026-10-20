import { cameraRay, type SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { cameraUniforms, uniformRay } from '../src/cameraUniforms';

const perspective: SceneCamera = {
  position: [30, 20, 40],
  target: [0, 4, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 35 },
  near: 1,
  far: 200,
};
const orthographic: SceneCamera = { ...perspective, projection: { kind: 'orthographic', height: 24 } };

describe('cameraUniforms', () => {
  for (const camera of [perspective, orthographic]) {
    it(`shoots cameraRay's rays at the corners and the centre (${camera.projection.kind})`, () => {
      for (const aspect of [1, 1.5, 0.5]) {
        const u = cameraUniforms(camera, aspect);
        for (const [x, y] of [
          [0, 0],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
          [0.3, -0.7],
        ] as const) {
          const expected = cameraRay(camera, aspect, x, y);
          const actual = uniformRay(u, x, y);
          for (let k = 0; k < 3; k++) {
            expect(Math.abs((actual.origin[k] ?? 0) - (expected.origin[k] ?? 0))).toBeLessThan(1e-6);
            expect(Math.abs((actual.direction[k] ?? 0) - (expected.direction[k] ?? 0))).toBeLessThan(1e-6);
          }
        }
      }
    });
  }

  it('rejects an invalid projection, aspect or clip range with a RangeError', () => {
    expect(() => cameraUniforms({ ...perspective, projection: { kind: 'perspective', fovYDeg: 180 } }, 1)).toThrow(
      RangeError,
    );
    expect(() => cameraUniforms({ ...orthographic, projection: { kind: 'orthographic', height: 0 } }, 1)).toThrow(
      RangeError,
    );
    expect(() => cameraUniforms(perspective, 0)).toThrow(RangeError);
    expect(() => cameraUniforms({ ...perspective, near: 5, far: 5 }, 1)).toThrow(RangeError);
    expect(() => cameraUniforms({ ...perspective, target: perspective.position }, 1)).toThrow(RangeError);
  });
});
