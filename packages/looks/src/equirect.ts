import type { Direction } from './LookPreset';

/**
 * The equirectangular mapping of environment images, as `glsl/lightRig.glsl` and the path tracer's `environmentMap`
 * chunk use it: v 0 the zenith (+y), v 1 the nadir; u 0.5 the front (−z, where a model faces), u 0.75 +x.
 */
export function equirectDirection(u: number, v: number): Direction {
  const theta = Math.PI * v;
  const phi = 2 * Math.PI * u - Math.PI;
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

/** (u, v) of the unit direction d, the inverse of `equirectDirection`. */
export function equirectUv(d: Direction): [number, number] {
  const u = Math.abs(d[0]) + Math.abs(d[2]) > 0 ? (Math.atan2(d[0], -d[2]) + Math.PI) / (2 * Math.PI) : 0.5;
  return [u, Math.acos(Math.max(-1, Math.min(1, d[1]))) / Math.PI];
}

/** cos and sin of a look's `rotationDeg`, as `u_lookEnvironmentYaw` holds them. */
export function environmentYaw(rotationDeg: number): readonly [number, number] {
  const radians = (rotationDeg * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

/**
 * The world direction d in the image's frame: turned by −yaw about +y (`environmentImageDirection` of the lightRig
 * chunk). The rotation applies to lookups only; the image data never turns.
 */
export function imageDirection(d: Direction, yaw: readonly [number, number]): Direction {
  const [c, s] = yaw;
  return [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
}

/** The image-frame direction d in the world: turned by +yaw about +y, the inverse of `imageDirection`. */
export function worldDirection(d: Direction, yaw: readonly [number, number]): Direction {
  const [c, s] = yaw;
  return [c * d[0] + s * d[2], d[1], -s * d[0] + c * d[2]];
}
