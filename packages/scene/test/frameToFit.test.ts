import { describe, expect, it } from 'vitest';
import {
  ISOMETRIC_PITCH_DEG,
  ISOMETRIC_YAW_DEG,
  cameraBasis,
  cameraProjection,
  cameraView,
  fitClipPlanes,
  fitDistance,
  frameToFit,
  mat4Multiply,
  orbitDirection,
  type Mat4,
  type SceneBounds,
  type SceneProjection,
  type Vec3,
} from '../src/index';

function clip(m: Mat4, p: Vec3): [number, number, number, number] {
  const row = (r: number): number =>
    (m[r] ?? 0) * p[0] + (m[4 + r] ?? 0) * p[1] + (m[8 + r] ?? 0) * p[2] + (m[12 + r] ?? 0);
  return [row(0), row(1), row(2), row(3)];
}

function boundsOf(min: Vec3, max: Vec3): SceneBounds {
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
}

function corners(b: SceneBounds): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]])
    for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

const projections: SceneProjection[] = [
  { kind: 'perspective', fovYDeg: 35 },
  { kind: 'orthographic', height: 1 },
];
const models = {
  cube: boundsOf([-8, 0, -8], [8, 16, 8]),
  long: boundsOf([-40, 2, -3], [40, 6, 3]),
  flat: boundsOf([0, 0, 0], [16, 0, 16]),
};

describe('frameToFit', () => {
  for (const projection of projections) {
    for (const aspect of [0.25, 1, 4]) {
      for (const [name, bounds] of Object.entries(models)) {
        it(`keeps every corner of ${name} inside the frustum (${projection.kind}, aspect ${aspect})`, () => {
          for (const [yaw, pitch] of [
            [30, 20],
            [ISOMETRIC_YAW_DEG, ISOMETRIC_PITCH_DEG],
            [200, -60],
            [0, 89.5],
          ] as const) {
            const camera = frameToFit(bounds, { projection, aspect, yawDeg: yaw, pitchDeg: pitch });
            expect(camera.near).toBeGreaterThan(0);
            const m = mat4Multiply(cameraProjection(camera, aspect), cameraView(camera));
            for (const corner of corners(bounds)) {
              const [x, y, z, w] = clip(m, corner);
              expect(w).toBeGreaterThan(0);
              for (const v of [x / w, y / w, z / w]) expect(Math.abs(v)).toBeLessThan(1);
            }
          }
        });
      }
    }
  }

  it('looks at the centre from the orbit direction', () => {
    const bounds = models.cube;
    const camera = frameToFit(bounds, { projection: projections[0]!, aspect: 1, yawDeg: 90, pitchDeg: 0 });
    expect(camera.target).toEqual(bounds.center);
    const { forward } = cameraBasis(camera);
    [-1, 0, 0].forEach((v, i) => expect(forward[i]).toBeCloseTo(v, 12));
    expect(orbitDirection(0, 0)).toEqual([0, 0, 1]);
  });

  it('frames a point-sized model with the minimum radius', () => {
    const point = boundsOf([3, 3, 3], [3, 3, 3]);
    const camera = frameToFit(point, { projection: projections[0]!, aspect: 1, yawDeg: 0, pitchDeg: 0 });
    expect(camera.position.every(Number.isFinite)).toBe(true);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
  });
});

describe('fitClipPlanes', () => {
  it('encloses the sphere at the closest and farthest orbit distance', () => {
    const bounds = models.cube;
    const fit = fitDistance(bounds.radius, 35, 1);
    for (const distance of [bounds.radius * 1.05, fit, fit * 8]) {
      const dir = orbitDirection(30, 20);
      const position: Vec3 = [
        bounds.center[0] + dir[0] * distance,
        bounds.center[1] + dir[1] * distance,
        bounds.center[2] + dir[2] * distance,
      ];
      const { near, far } = fitClipPlanes(position, [-dir[0], -dir[1], -dir[2]], bounds);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThanOrEqual(distance - bounds.radius);
      expect(far).toBeGreaterThanOrEqual(distance + bounds.radius);
    }
  });

  it('keeps a positive near plane when the camera is inside the sphere', () => {
    const bounds = models.cube;
    const { near, far } = fitClipPlanes(bounds.center, [0, 0, -1], bounds);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThanOrEqual(bounds.radius);
  });
});
