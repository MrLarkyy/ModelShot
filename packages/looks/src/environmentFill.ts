import type { Rgb } from './agxToneMap';
import { environmentSh } from './environmentSh';
import { environmentYaw, imageDirection } from './equirect';
import { domeFill } from './lightRig';
import type { Direction, LookEnvironment } from './LookPreset';
import { shIrradiance } from './shIrradiance';

/**
 * The fill a unit-albedo Lambert surface with unit normal n receives from `environment`, as `hemisphereFill` of the
 * lightRig chunk computes it: a dome's sky/ground mix, an image's L2 irradiance over π at n turned into the image's
 * frame, clamped at 0. Pass it to `unoccludedRadiance` for a look with an image.
 */
export function environmentFill(environment: LookEnvironment, n: Direction): Rgb {
  if (environment.kind === 'dome') return domeFill(environment, n);
  const fill = shIrradiance(environmentSh(environment), imageDirection(n, environmentYaw(environment.rotationDeg)));
  return [Math.max(0, fill[0]), Math.max(0, fill[1]), Math.max(0, fill[2])];
}
