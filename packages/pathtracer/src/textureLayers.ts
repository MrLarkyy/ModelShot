import { PathTracerError } from './PathTracerError';

/** Where one image lies in the texture layers: layer index and texel rectangle. */
export interface TexturePlacement {
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A TEXTURE_2D_ARRAY of `layers` layers of `width` × `height` and the place of every image in it. */
export interface TextureLayerPlan {
  readonly width: number;
  readonly height: number;
  readonly layers: number;
  /** Indexed like the sizes passed to `planTextureLayers`. */
  readonly placements: readonly TexturePlacement[];
}

interface Size {
  readonly width: number;
  readonly height: number;
}

function shelfPack(sizes: readonly Size[], order: readonly number[], width: number, height: number) {
  const placements: TexturePlacement[] = new Array<TexturePlacement>(sizes.length);
  let layer = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;
  let used = 0;
  for (const index of order) {
    const size = sizes[index] ?? { width: 1, height: 1 };
    if (x + size.width > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    if (y + size.height > height) {
      layer++;
      y = 0;
      x = 0;
      shelf = 0;
    }
    placements[index] = { layer, x, y, width: size.width, height: size.height };
    x += size.width;
    shelf = Math.max(shelf, size.height);
    used = Math.max(used, y + shelf);
  }
  return { placements, layers: layer + 1, used };
}

/**
 * Shelf-packs images (tallest first, then by index, so the result is deterministic) into texture layers: one layer of
 * the smallest power-of-two width that holds everything within a square, else layers of `maxSide` × `maxSide`. GLSL ES
 * 3.00 cannot pick a sampler by a dynamic index, so every texture of a scene shares one array texture; a lookup
 * clamped to its face's rectangle and offset by its placement never reads a neighbour. An image over `maxSide` or more
 * layers than `maxLayers` throws `PathTracerError` `SCENE_TOO_LARGE`.
 */
export function planTextureLayers(sizes: readonly Size[], maxSide: number, maxLayers: number): TextureLayerPlan {
  sizes.forEach((size, index) => {
    const ok = Number.isInteger(size.width) && Number.isInteger(size.height) && size.width >= 1 && size.height >= 1;
    if (!ok || size.width > maxSide || size.height > maxSide) {
      throw new PathTracerError(
        'SCENE_TOO_LARGE',
        `texture image ${index} is ${size.width}x${size.height}; each side must be 1..${maxSide}`,
      );
    }
  });
  const order = sizes.map((_, index) => index);
  order.sort((a, b) => (sizes[b]?.height ?? 0) - (sizes[a]?.height ?? 0) || a - b);
  const widest = Math.max(1, ...sizes.map((size) => size.width));
  for (let width = 2 ** Math.ceil(Math.log2(widest)); width <= maxSide; width *= 2) {
    const packed = shelfPack(sizes, order, width, width);
    if (packed.layers === 1)
      return { width, height: Math.max(1, packed.used), layers: 1, placements: packed.placements };
  }
  const packed = shelfPack(sizes, order, maxSide, maxSide);
  if (packed.layers > maxLayers) {
    throw new PathTracerError(
      'SCENE_TOO_LARGE',
      `textures need ${packed.layers} layers of ${maxSide}x${maxSide}; this GPU allows ${maxLayers}`,
    );
  }
  return { width: maxSide, height: maxSide, layers: packed.layers, placements: packed.placements };
}
