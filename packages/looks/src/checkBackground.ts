import type { Rgb } from './agxToneMap';
import { MAX_LOOK_COLOR } from './checkLookPreset';

/**
 * `background` as a frozen scene-linear colour: three finite channels in 0..`MAX_LOOK_COLOR`, a look colour's range,
 * so a renderer's `look` holding it as its backdrop passes `checkLookPreset`. Else a `RangeError` naming `background`
 * (the renderers' constructor option, checked like `edges`).
 */
export function checkBackground(background: readonly number[]): Rgb {
  const ok =
    Array.isArray(background) &&
    background.length === 3 &&
    background.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= MAX_LOOK_COLOR);
  if (!ok) {
    throw new RangeError(
      `background must be three finite numbers in 0..${MAX_LOOK_COLOR}, got ${JSON.stringify(background)}`,
    );
  }
  return Object.freeze([background[0], background[1], background[2]] as const) as Rgb;
}
