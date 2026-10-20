import type { BakedLighting } from './BakedLighting';
import type { LightmapLayout } from './lightmapLayout';
import { MAX_CATCHER_SIDE } from './shadowCatcherPlane';

/**
 * Whether `lighting` was baked for `layout`: the same layout key and size, `data` of exactly width × height × 4
 * halves, and a catcher (when present) of 1..MAX_CATCHER_SIDE texels per side with a finite plane and data to match.
 */
export function checkLighting(layout: LightmapLayout, lighting: BakedLighting): boolean {
  if (lighting.layoutKey !== layout.layoutKey) return false;
  if (lighting.width !== layout.width || lighting.height !== layout.height) return false;
  if (!(lighting.data instanceof Uint16Array) || lighting.data.length !== layout.width * layout.height * 4)
    return false;
  const catcher = lighting.catcher;
  if (!catcher) return true;
  const side = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_CATCHER_SIDE;
  if (!side(catcher.width) || !side(catcher.height)) return false;
  if (![catcher.y, ...catcher.rect].every(Number.isFinite)) return false;
  if (!(catcher.rect[2] > catcher.rect[0] && catcher.rect[3] > catcher.rect[1])) return false;
  return catcher.data instanceof Uint16Array && catcher.data.length === catcher.width * catcher.height * 4;
}
