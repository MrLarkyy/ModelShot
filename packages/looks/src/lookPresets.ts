import type { LookPreset } from './LookPreset';
import { parseLookPreset } from './parseLookPreset';
import marketplace from './presets/marketplace.json?raw';
import rim from './presets/rim.json?raw';
import softbox from './presets/softbox.json?raw';
import studio from './presets/studio.json?raw';

/** Studio: what every renderer shows without a `look` option (the v0 look: `LIGHT_RIG_V0`, a flat grey backdrop). */
export const DEFAULT_LOOK: LookPreset = parseLookPreset(studio);

/**
 * The presets that ship, by id, each parsed and checked like a user's file: Studio, Marketplace (navy gradient, cool
 * rim, saturated grade), Rim (dark, a strong white rim) and Softbox (lit by the bundled studio image `softbox-studio`,
 * Marketplace's backdrop and grade).
 */
export const LOOK_PRESETS: Readonly<Record<string, LookPreset>> = Object.freeze(
  Object.fromEntries(
    [DEFAULT_LOOK, parseLookPreset(marketplace), parseLookPreset(rim), parseLookPreset(softbox)].map(
      (look) => [look.id, look] as const,
    ),
  ),
);
