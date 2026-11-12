import type { LightRig } from './lightRig';

/**
 * What baked light depends on: the key's direction and disc (its visibility) and the environment (the fill is baked as
 * a share of `hemisphereFill`): a dome's sky and ground, an image's id, intensity and rotation. Light baked under one
 * look is valid under another exactly when their keys are equal; colours of the key and the accents, the backdrop, the
 * catcher strength, edges and grading apply at draw time. One exception, left out on purpose: the baked fill share
 * carries one bounce whose key part is lit by the key colour baked under (MS-57), so such a look shows that bounce
 * until the light is baked again, as the app and the embed do on every look change. A dome's key reads as it did
 * before images existed.
 */
export function lightingKey(rig: LightRig): string {
  const { key } = rig.lights;
  const env = rig.environment;
  const parts =
    env.kind === 'dome'
      ? [key.direction, key.angularRadius, env.sky, env.ground]
      : [key.direction, key.angularRadius, 'hdri', env.image, env.intensity, env.rotationDeg];
  return `look-light:${JSON.stringify(parts)}`;
}
