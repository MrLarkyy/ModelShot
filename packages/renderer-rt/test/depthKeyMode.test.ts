import {
  RENDER_ORDER_TIE_DISTANCE,
  cameraProjection,
  cameraView,
  fitClipPlanes,
  mat4Multiply,
  mat4TransformPoint,
  type SceneCamera,
} from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { depthKeyMode, depthPull, depthStepAtFar } from '../src/depthKeyMode';

const perspective = (near: number, far: number): SceneCamera => ({
  position: [0, 0, 60],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 40 },
  near,
  far,
});

describe('depthKeyMode', () => {
  it('a framed camera rasterises, a camera inside the bounding sphere writes linear depth', () => {
    const framed = fitClipPlanes([0, 0, 60], [0, 0, -1], {
      min: [-20, -20, -20],
      max: [20, 20, 20],
      center: [0, 0, 0],
      radius: 20,
    });
    expect(depthKeyMode(perspective(framed.near, framed.far), 24)).toBe('raster');
    const inside = fitClipPlanes([0, 0, 5], [0, 0, -1], {
      min: [-20, -20, -20],
      max: [20, 20, 20],
      center: [0, 0, 0],
      radius: 20,
    });
    expect(inside.near).toBeCloseTo(inside.far * 1e-4, 9);
    expect(depthKeyMode(perspective(inside.near, inside.far), 24)).toBe('linear');
  });

  it('an orthographic camera rasterises; a 16-bit depth buffer needs linear', () => {
    const ortho = { ...perspective(1, 120), projection: { kind: 'orthographic', height: 40 } } as const;
    expect(depthKeyMode(ortho, 24)).toBe('raster');
    expect(depthKeyMode(perspective(40, 80), 16)).toBe('linear');
  });

  it('the step at the far plane follows the projection', () => {
    expect(depthStepAtFar(perspective(1, 2), 1)).toBeCloseTo(1, 12);
    expect(depthStepAtFar({ ...perspective(1, 3), projection: { kind: 'orthographic', height: 1 } }, 1)).toBe(1);
  });

  it('the pull moves a point order × TIE nearer along the view axis', () => {
    const camera = perspective(40, 80);
    const projection = cameraProjection(camera, 1.5);
    const view = cameraView(camera);
    for (const [x, y, z, order] of [
      [3, -2, 5, 1],
      [-7, 4, -9, -1],
      [0.5, 0.25, 12, 3],
    ] as const) {
      const viewPoint = mat4TransformPoint(view, [x, y, z]);
      const pull = depthPull(projection, order);
      const clip = (p: readonly number[]) =>
        [0, 1, 2, 3].map(
          (r) =>
            (projection[r] ?? 0) * (p[0] ?? 0) +
            (projection[4 + r] ?? 0) * (p[1] ?? 0) +
            (projection[8 + r] ?? 0) * (p[2] ?? 0) +
            (projection[12 + r] ?? 0),
        );
      const pulled = clip(viewPoint).map((v, r) => v + (pull[r] ?? 0));
      const moved = clip([viewPoint[0], viewPoint[1], viewPoint[2] + order * RENDER_ORDER_TIE_DISTANCE]);
      pulled.forEach((v, r) => expect(v).toBeCloseTo(moved[r] ?? NaN, 4));
    }
    expect(mat4Multiply(projection, view)).toHaveLength(16);
  });
});
