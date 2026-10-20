import { describe, expect, it } from 'vitest';
import {
  cameraBasis,
  cameraProjection,
  cameraRay,
  cameraView,
  mat4Multiply,
  type Mat4,
  type SceneCamera,
  type SceneProjection,
} from '../src/index';

function project(m: Mat4, p: readonly number[]): [number, number, number] {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    out[row] =
      (m[row] ?? 0) * (p[0] ?? 0) +
      (m[4 + row] ?? 0) * (p[1] ?? 0) +
      (m[8 + row] ?? 0) * (p[2] ?? 0) +
      (m[12 + row] ?? 0);
  }
  const w = out[3] ?? 1;
  return [(out[0] ?? 0) / w, (out[1] ?? 0) / w, (out[2] ?? 0) / w];
}

const projections: SceneProjection[] = [
  { kind: 'perspective', fovYDeg: 35 },
  { kind: 'perspective', fovYDeg: 90 },
  { kind: 'orthographic', height: 24 },
];

function camera(projection: SceneProjection): SceneCamera {
  return { position: [30, 18, 40], target: [1, 4, -2], up: [0, 1, 0], projection, near: 5, far: 200 };
}

describe('cameraRay', () => {
  for (const projection of projections) {
    for (const [width, height] of [
      [256, 256],
      [320, 180],
      [100, 400],
    ] as const) {
      it(`agrees with cameraProjection x cameraView (${projection.kind}, ${width}x${height})`, () => {
        const cam = camera(projection);
        const aspect = width / height;
        const viewProjection = mat4Multiply(cameraProjection(cam, aspect), cameraView(cam));
        for (let py = 0; py < height; py += Math.floor(height / 7)) {
          for (let px = 0; px < width; px += Math.floor(width / 7)) {
            const ndcX = ((px + 0.5) / width) * 2 - 1;
            const ndcY = ((py + 0.5) / height) * 2 - 1;
            const ray = cameraRay(cam, aspect, ndcX, ndcY);
            expect(Math.hypot(...ray.direction)).toBeCloseTo(1, 12);
            for (const t of [cam.near, 40, cam.far * 0.9]) {
              const point = ray.origin.map((o, i) => o + (ray.direction[i] ?? 0) * t);
              const [x, y] = project(viewProjection, point);
              expect(Math.abs(x - ndcX)).toBeLessThan(1e-9);
              expect(Math.abs(y - ndcY)).toBeLessThan(1e-9);
            }
          }
        }
      });
    }
  }

  it('shoots the centre ray at the target and maps near and far to -1 and 1', () => {
    for (const projection of projections) {
      const cam = camera(projection);
      const ray = cameraRay(cam, 1, 0, 0);
      const { forward } = cameraBasis(cam);
      ray.direction.forEach((d, i) => expect(d).toBeCloseTo(forward[i] ?? NaN, 12));
      const viewProjection = mat4Multiply(cameraProjection(cam, 1), cameraView(cam));
      const at = (t: number): number[] => ray.origin.map((o, i) => o + (ray.direction[i] ?? 0) * t);
      expect(project(viewProjection, at(cam.near))[2]).toBeCloseTo(-1, 9);
      expect(project(viewProjection, at(cam.far))[2]).toBeCloseTo(1, 9);
    }
  });

  it('keeps a frame when up is parallel to the view direction', () => {
    const cam: SceneCamera = { ...camera(projections[0]!), position: [0, 50, 0], target: [0, 0, 0] };
    const { forward, right, up } = cameraBasis(cam);
    expect(forward).toEqual([0, -1, 0]);
    expect(Math.hypot(...right)).toBeCloseTo(1, 12);
    expect(Math.hypot(...up)).toBeCloseTo(1, 12);
    expect(cameraView(cam).every(Number.isFinite)).toBe(true);
  });

  it('rejects an unusable field of view, ortho height or aspect in projection and ray alike', () => {
    const cam = camera(projections[0]!);
    const invalid: [SceneProjection, number][] = [
      [{ kind: 'perspective', fovYDeg: 0 }, 1],
      [{ kind: 'perspective', fovYDeg: -10 }, 1],
      [{ kind: 'perspective', fovYDeg: 180 }, 1],
      [{ kind: 'perspective', fovYDeg: 270 }, 1],
      [{ kind: 'perspective', fovYDeg: NaN }, 1],
      [{ kind: 'orthographic', height: 0 }, 1],
      [{ kind: 'orthographic', height: -4 }, 1],
      [{ kind: 'orthographic', height: NaN }, 1],
      [{ kind: 'orthographic', height: Infinity }, 1],
      [{ kind: 'perspective', fovYDeg: 35 }, 0],
      [{ kind: 'perspective', fovYDeg: 35 }, NaN],
      [{ kind: 'orthographic', height: 10 }, Infinity],
    ];
    for (const [projection, aspect] of invalid) {
      const label = `${JSON.stringify(projection)} aspect ${aspect}`;
      expect(() => cameraProjection({ ...cam, projection }, aspect), label).toThrow(RangeError);
      expect(() => cameraRay({ ...cam, projection }, aspect, 0, 0), label).toThrow(RangeError);
    }
    expect(() => cameraProjection({ ...cam, far: Infinity }, 1)).toThrow(RangeError);
    expect(() => cameraRay({ ...cam, projection: { kind: 'perspective', fovYDeg: 179.9 } }, 1, 0.5, 0.5)).not.toThrow();
  });

  it('rejects a degenerate camera and aspect', () => {
    const cam = camera(projections[0]!);
    expect(() => cameraBasis({ ...cam, target: cam.position })).toThrow(RangeError);
    expect(() => cameraProjection(cam, 0)).toThrow(RangeError);
    expect(() => cameraProjection({ ...cam, near: 0 }, 1)).toThrow(RangeError);
  });
});
