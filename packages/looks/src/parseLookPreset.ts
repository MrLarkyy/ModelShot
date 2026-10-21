import { checkLookPreset } from './checkLookPreset';
import type { LookPreset } from './LookPreset';
import { LookPresetError } from './LookPresetError';

/** Longest preset text accepted, in UTF-16 code units (64 KiB of ASCII); checked before parsing. */
export const MAX_LOOK_PRESET_LENGTH = 65_536;

/**
 * A look preset from JSON text (a file the user picked, a preset shipped with the package): `TOO_LARGE` over
 * `MAX_LOOK_PRESET_LENGTH` before anything is parsed, `SYNTAX` for text that is not JSON, then `checkLookPreset`.
 * Every failure is a `LookPresetError`.
 */
export function parseLookPreset(text: string): LookPreset {
  if (text.length > MAX_LOOK_PRESET_LENGTH) {
    throw new LookPresetError('TOO_LARGE', `a look preset is at most ${MAX_LOOK_PRESET_LENGTH} characters`, '');
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new LookPresetError('SYNTAX', `not JSON: ${error instanceof Error ? error.message : String(error)}`, '');
  }
  return checkLookPreset(value);
}
