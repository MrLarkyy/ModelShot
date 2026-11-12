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

/** The hue of a scene-linear light colour as `#RRGGBB`, sRGB-encoded at full strength (the intensity is separate); null when off. */
export function lightHex(color: Rgb): string | null {
  const peak = lightIntensity(color);
  if (!(peak > 0)) return null;
  return `#${color
    .map((channel) =>
      srgbByte(channel / peak)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

export interface LightAim {
  /** Degrees about the vertical, 0 toward +z (the camera side), positive toward +x; −180..180. */
  readonly azimuth: number;
  /** Degrees above the horizon, −90..90. */
  readonly elevation: number;
}

const DEGREES = 180 / Math.PI;

/** Where a unit direction toward a light points, as azimuth and elevation. */
export function lightAim(direction: Direction): LightAim {
  const [x, y, z] = direction;
  return {
    azimuth: Math.atan2(x, z) * DEGREES,
    elevation: Math.asin(Math.min(1, Math.max(-1, y))) * DEGREES,
  };
}

/** The key's disc radius in degrees (the look stores radians). */
export function softnessDegrees(angularRadius: number): number {
  return angularRadius * DEGREES;
}
