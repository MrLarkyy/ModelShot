import { cameraBasis, fitDistance, type SceneBounds, type Vec3 } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILL, fitCameraToPoints } from '../fixtures/src/fitCameraToPoints';

const FOV = 35;

function boundsOf(points: readonly Vec3[]): SceneBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a] ?? 0, p[a] ?? 0);
      max[a] = Math.max(max[a] ?? 0, p[a] ?? 0);
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { min, max, center, radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 };
}

const corners = (min: Vec3, max: Vec3): Vec3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? max[0] : min[0], k & 2 ? max[1] : min[1], k & 4 ? max[2] : min[2]]);

/** Points, framed at `yaw`/`pitch` with aspect 1: the largest |NDC x| and |NDC y|, their outline's centre, the distance. */
function framed(points: readonly Vec3[], yaw: number, pitch: number) {
  const bounds = boundsOf(points);
  const camera = fitCameraToPoints(points.flat(), bounds, yaw, pitch, FOV, 1);
  const { forward, right, up } = cameraBasis(camera);
  const tan = Math.tan((FOV * Math.PI) / 360);
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let ahead = true;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    const v: Vec3 = [p[0] - camera.position[0], p[1] - camera.position[1], p[2] - camera.position[2]];
    const depth = dot(v, forward);
    ahead &&= depth >= camera.near && depth <= camera.far;
    xs.push(dot(v, right) / (depth * tan));
    ys.push(dot(v, up) / (depth * tan));
  }
  const extent = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs));
  const centre = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const distance = Math.hypot(...[0, 1, 2].map((a) => (camera.position[a] ?? 0) - (camera.target[a] ?? 0)));
  return { bounds, extent, centre, ahead, distance };
}

describe('fitCameraToPoints', () => {
  const player = corners([-4, 0, -2], [4, 32, 2]);
  const board = corners([-6, 0, -19], [6, 3, 13]);
  // A rider on a board: the bulk is off the box centre, the board's tips far apart.
  const rider = [...board, ...corners([-4, 3, -2], [4, 35, 2])];
  // A diagonal rod: its bounding box and sphere are far larger than its outline.
  const rod = [
    [-10, -10, -10],
    [-9, -10, -10],
    [10, 10, 10],
    [9, 10, 10],
  ] as Vec3[];

  it.each([
    ['a player', player, 210, 20],
    ['a long flat board', board, 210, 20],
    ['a rider on a board', rider, 210, 20],
    ['a diagonal rod', rod, 45, 35],
    ['a player from below', player, 30, -40],
  ])('frames %s to the fill on its tighter axis, centred, every point in front', (_name, points, yaw, pitch) => {
    const { extent, centre, ahead } = framed(points, yaw, pitch);
    expect(ahead).toBe(true);
    expect(extent).toBeLessThanOrEqual(DEFAULT_FILL + 1e-6);
    expect(extent).toBeGreaterThan(DEFAULT_FILL - 1e-3);
    expect(Math.abs(centre[0] ?? 1)).toBeLessThan(0.05);
    expect(Math.abs(centre[1] ?? 1)).toBeLessThan(0.05);
  });

  it('stands closer than the bounding-sphere fit where the outline is smaller than the sphere', () => {
    const { bounds, distance } = framed(rod, 45, 35);
    expect(distance).toBeLessThan(0.5 * fitDistance(bounds.radius, FOV, 1));
  });
});
