import softboxStudio from './environments/softbox-studio.sh.json?raw';
import type { LookHdriEnvironment } from './LookPreset';

/**
 * The preview's harmonics of each bundled image at intensity 1, as the generator wrote them next to the image: the
 * preview fills with these 27 numbers and never loads the image itself (`environmentLighting` does, for the path tracer
 * and the bake); a test keeps them equal to `imageIrradianceSh` of the decoded image.
 */
const AT_UNIT_INTENSITY: Readonly<Record<string, Float32Array>> = Object.freeze({
  'softbox-studio': Float32Array.from(JSON.parse(softboxStudio) as number[]),
});

/** The ids `environmentSh` holds, for the test that keeps them equal to `ENVIRONMENT_IMAGE_IDS`. */
export const ENVIRONMENT_SH_IMAGES: readonly string[] = Object.freeze(Object.keys(AT_UNIT_INTENSITY));

/**
 * L2 spherical harmonics of the irradiance over π of the bundled image of `environment` at its intensity, in the
 * image's frame (27 floats: nine RGB coefficients, `u_lookEnvironmentSh`); a `RangeError` for an id that is not one.
 */
export function environmentSh(environment: Pick<LookHdriEnvironment, 'image' | 'intensity'>): Float32Array {
  const unit = Object.hasOwn(AT_UNIT_INTENSITY, environment.image) ? AT_UNIT_INTENSITY[environment.image] : undefined;
  if (!unit) throw new RangeError(`"${environment.image}" is not a bundled environment image`);
  return unit.map((value) => value * environment.intensity);
}
