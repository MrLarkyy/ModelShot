import { PLACEHOLDER_IMAGE, UNTEXTURED_IMAGE, type RawImage } from '@modelshot/renderer-rt';
import type { MaterialTextures } from './packSceneData';
import { planTextureLayers } from './textureLayers';

/** Places the untextured colour, the placeholder and every decoded image in texture layers. */
export function layoutTextures(bitmaps: readonly (ImageBitmap | null)[], side: number, maxLayers: number) {
  const images: (ImageBitmap | RawImage)[] = [UNTEXTURED_IMAGE, PLACEHOLDER_IMAGE];
  const slots = new Map<ImageBitmap, number>();
  const slotOf = bitmaps.map((bitmap) => {
    if (!bitmap) return -1;
    let slot = slots.get(bitmap);
    if (slot === undefined) {
      slot = images.push(bitmap) - 1;
      slots.set(bitmap, slot);
    }
    return slot;
  });
  const plan = planTextureLayers(images, side, maxLayers);
  const at = (index: number) => {
    const place = plan.placements[index];
    if (!place) throw new Error(`texture image ${index} has no placement`);
    return place;
  };
  const textures: MaterialTextures = {
    untextured: at(0),
    placeholder: at(1),
    textures: slotOf.map((slot) => (slot >= 0 ? at(slot) : null)),
  };
  return { plan, images, textures };
}
