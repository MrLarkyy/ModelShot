import type { LightRig } from './lightRig';

/**
 * What baked light depends on: the key's direction and disc (its visibility) and the dome (the fill is baked as a
 * share of `hemisphereFill`). Light baked under one look is valid under another exactly when their keys are equal;
 * colours of the key and the accents, the backdrop, the catcher strength, edges and grading apply at draw time.
 */
export function lightingKey(rig: LightRig): string {
  const { key } = rig.lights;
  const { sky, ground } = rig.environment;
  return `look-light:${JSON.stringify([key.direction, key.angularRadius, sky, ground])}`;
}
