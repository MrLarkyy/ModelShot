import { LOOK_PRESETS, type LookPreset } from '@modelshot/looks';

/**
 * A shipped look preset by id, for the fixtures' `setLook` controls; `bad` is Marketplace with a catcher strength out of
 * range, which `setLook` must refuse without changing anything.
 */
export function lookByName(id: string): LookPreset {
  if (id === 'bad') {
    const marketplace = LOOK_PRESETS['marketplace'];
    if (!marketplace) throw new Error('no marketplace preset');
    return { ...marketplace, catcher: { strength: 1.5 } };
  }
  const look = Object.hasOwn(LOOK_PRESETS, id) ? LOOK_PRESETS[id] : undefined;
  if (!look) throw new Error(`unknown preset "${id}"`);
  return look;
}
