import type { Direction, Rgb } from '@modelshot/looks';

const srgbByte = (linear: number): number => {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

/** The strongest channel of a scene-linear colour: how bright the light is (0 is off). */
export function lightIntensity(color: Rgb): number {
  return Math.max(color[0], color[1], color[2]);
}

const hex = (channels: readonly number[]): string =>
  `#${channels
    .map((channel) => srgbByte(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

/** A scene-linear colour (0..1 per channel) as `#RRGGBB`, sRGB-encoded. */
export function srgbHex(color: Rgb): string {
  return hex(color);
}

/** The hue of a scene-linear light colour as `#RRGGBB`, sRGB-encoded at full strength (the intensity is separate); null when off. */
export function lightHex(color: Rgb): string | null {
  const peak = lightIntensity(color);
  if (!(peak > 0)) return null;
  return hex(color.map((channel) => channel / peak));
}

export interface LightAim {
  /**
   * Degrees about the vertical as the viewer sees them: 0 toward the camera (of the Front view for a world light),
   * positive toward the viewer's right, ±180 behind the model; −180..180.
   */
  readonly azimuth: number;
  /** Degrees above the horizon, −90..90. */
  readonly elevation: number;
}

const DEGREES = 180 / Math.PI;

/**
 * Where a unit direction toward a light points, as azimuth and elevation. A world direction is seen from the Front
 * preset's camera (it stands at −z, so the viewer's right is world −x); the rim's direction is already in view space
 * (x right, z toward the camera).
 */
export function lightAim(direction: Direction, space: 'world' | 'view' = 'world'): LightAim {
  const [x, y, z] = direction;
  const sign = space === 'world' ? -1 : 1;
  // A light straight above or below has no azimuth; `|| 0` keeps the mirrored zeros from reading as −180 (atan2(−0, −0)).
  return {
    azimuth: Math.atan2(sign * x || 0, sign * z || 0) * DEGREES,
    elevation: Math.asin(Math.min(1, Math.max(-1, y))) * DEGREES,
  };
}

/** The key's disc radius in degrees (the look stores radians). */
export function softnessDegrees(angularRadius: number): number {
  return angularRadius * DEGREES;
}
