import type { Rgb } from './agxToneMap';
import type { LightRig } from './lightRig';

const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Factor a shadow-catcher point applies to the backdrop, as `glsl/shadowCatcher.glsl` computes it: `fill` the fill
 * light reaching the point (unoccluded mean `hemisphereFill(up)`, the dome's sky), `keyT` the key's visibility, `xz`
 * the point and `rect` the catcher's `[minX, minZ, maxX, maxZ]`. 1 where nothing blocks, `1 − catcher.strength` fully
 * shadowed, affine in `fill` and `keyT`, fading to 1 over the rectangle's outer 10 %. The unshadowed accents (fill and
 * rim lights) cast nothing, so they do not enter.
 */
export function catcherShade(
  rig: LightRig,
  fill: Rgb,
  keyT: number,
  xz: readonly [number, number],
  rect: readonly [number, number, number, number],
): number {
  const { key } = rig.lights;
  const keyWeight = luminance(key.color) * key.direction[1];
  const fillWeight = luminance(rig.environment.sky);
  const lit = (luminance(fill) + keyWeight * keyT) / Math.max(fillWeight + keyWeight, 1e-6);
  const u = (xz[0] - rect[0]) / Math.max(rect[2] - rect[0], 1e-6);
  const v = (xz[1] - rect[1]) / Math.max(rect[3] - rect[1], 1e-6);
  const edge = Math.min(u, 1 - u, v, 1 - v);
  const fade = Math.min(1, Math.max(0, edge / 0.1));
  return 1 - rig.catcher.strength * (1 - lit) * fade;
}
