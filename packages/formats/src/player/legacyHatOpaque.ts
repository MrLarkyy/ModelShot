import type { PngRgbaImage } from '../png/decodePngRgba';

/** Alpha at or above this counts as opaque, as in Minecraft's check (`alpha >= 128`). */
const OPAQUE_ALPHA = 128;

/**
 * Whether a legacy 64 × 32 skin (any 64 · 2^k × half size) has no transparent texel in its hat area, x 32..64 and
 * y 0..32 of the 64 × 32 UV space. Minecraft then clears that area (`doNotchTransparencyHack`): old skins often filled
 * it with an opaque colour, which would otherwise show as a box around the head.
 */
export function isLegacyHatOpaque(image: PngRgbaImage): boolean {
  const scale = image.width / 64;
  if (!Number.isInteger(scale) || scale < 1) return false;
  const x1 = 64 * scale;
  const y1 = Math.min(32 * scale, image.height);
  for (let y = 0; y < y1; y++) {
    for (let x = 32 * scale; x < x1; x++) {
      if ((image.rgba[(y * image.width + x) * 4 + 3] ?? 0) < OPAQUE_ALPHA) return false;
    }
  }
  return true;
}
