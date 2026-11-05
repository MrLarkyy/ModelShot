import type { Rgb } from './agxToneMap';
import { environmentFill } from './environmentFill';
import type { LightRig } from './lightRig';

const luminance = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const keyWeight = (rig: LightRig): number => luminance(rig.lights.key.color) * rig.lights.key.direction[1];

/** At most this light weight a look is lightless: nothing to take away, so both shades are exactly 1. */
const NO_LIGHT = 1e-6;

/** The unoccluded fill at the catcher, `hemisphereFill(up)`: a dome's sky exactly, an image's L2 irradiance. */
const upFill = (rig: LightRig): Rgb =>
  rig.environment.kind === 'dome' ? rig.environment.sky : environmentFill(rig.environment, [0, 1, 0]);

const lightWeight = (rig: LightRig): number => luminance(upFill(rig)) + keyWeight(rig);

function fade(xz: readonly [number, number], rect: readonly [number, number, number, number]): number {
  const u = (xz[0] - rect[0]) / Math.max(rect[2] - rect[0], 1e-6);
  const v = (xz[1] - rect[1]) / Math.max(rect[3] - rect[1], 1e-6);
  const edge = Math.min(u, 1 - u, v, 1 - v);
  return Math.min(1, Math.max(0, edge / 0.1));
}

/**
 * Factor a shadow-catcher point applies to the backdrop, as `glsl/shadowCatcher.glsl` computes it: `fill` the fill
 * light reaching the point (unoccluded mean `hemisphereFill(up)`), `keyT` the key's visibility, `xz`
 * the point and `rect` the catcher's `[minX, minZ, maxX, maxZ]`. 1 where nothing blocks or the look has no light,
 * `1 − catcher.strength` fully shadowed, affine in `fill` and `keyT`, fading to 1 over the rectangle's outer 10 %.
 * The unshadowed accents (fill and rim lights) cast nothing, so they do not enter. The reference form: both renderers
 * shade with `catcherShadeOfLoss`, which equals it.
 */
export function catcherShade(
  rig: LightRig,
  fill: Rgb,
  keyT: number,
  xz: readonly [number, number],
  rect: readonly [number, number, number, number],
): number {
  const weight = lightWeight(rig);
  if (weight <= NO_LIGHT) return 1;
  const lit = (luminance(fill) + keyWeight(rig) * keyT) / weight;
  return 1 - rig.catcher.strength * (1 - lit) * fade(xz, rect);
}

/**
 * `catcherShade` from what blockers take: `fillLost` = `hemisphereFill(up)` − `fill`, `keyLost` = 1 − `keyT`. The path
 * tracer evaluates it per sample, the preview on the baked catcher's means (`fillLost` = `hemisphereFill(up)` × (1 −
 * rgb), `keyLost` = 1 − a). Exactly 1 where both are 0 (a zero numerator, whatever the division rounds).
 */
export function catcherShadeOfLoss(
  rig: LightRig,
  fillLost: Rgb,
  keyLost: number,
  xz: readonly [number, number],
  rect: readonly [number, number, number, number],
): number {
  const weight = lightWeight(rig);
  if (weight <= NO_LIGHT) return 1;
  const lost = (luminance(fillLost) + keyWeight(rig) * keyLost) / weight;
  return 1 - rig.catcher.strength * lost * fade(xz, rect);
}
