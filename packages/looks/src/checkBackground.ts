import type { Rgb } from './agxToneMap';

/** The largest scene-linear channel a look colour may hold (`checkLookPreset`). */
const MAX_BACKGROUND_CHANNEL = 16;

/**
 * `background` as a frozen scene-linear colour: three finite channels in 0..16, else a `RangeError` naming
 * `background` (the renderers' constructor option, checked like `edges`).
 */
export function checkBackground(background: readonly number[]): Rgb {
  const ok =
    Array.isArray(background) &&
    background.length === 3 &&
    background.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= MAX_BACKGROUND_CHANNEL);
  if (!ok) {
    throw new RangeError(
      `background must be three finite numbers in 0..${MAX_BACKGROUND_CHANNEL}, got ${JSON.stringify(background)}`,
    );
  }
  return Object.freeze([background[0], background[1], background[2]] as const) as Rgb;
}
