import type { SceneTexture } from '@modelshot/scene';
import type { RendererWarning } from './RendererWarning';

export interface TextureLimits {
  /** Width or height in pixels; the renderer passes min(option, MAX_TEXTURE_SIZE). */
  readonly maxTextureSide: number;
  /** Sum of width × height over every decoded texture of a scene. */
  readonly maxTexturePixelsTotal: number;
}

export const DEFAULT_MAX_TEXTURE_PIXELS_TOTAL = 64 * 1024 * 1024;

export interface TextureDecodePlan {
  /** Per texture: whether its bytes may be decoded. */
  readonly decode: readonly boolean[];
  readonly warnings: readonly RendererWarning[];
}

export interface DecodedTextures {
  /** Per texture: the decoded image, or `null` where the placeholder is drawn instead. */
  readonly bitmaps: readonly (ImageBitmap | null)[];
  readonly warnings: readonly RendererWarning[];
}

/**
 * Decides from the header sizes alone, before anything is decoded, which textures stay within `limits`; the others
 * become placeholders with a warning. Textures are admitted in order until the total pixel budget is spent.
 */
export function planTextureDecode(textures: readonly SceneTexture[], limits: TextureLimits): TextureDecodePlan {
  const warnings: RendererWarning[] = [];
  let pixels = 0;
  const decode = textures.map((texture, index) => {
    if (texture.bytes === null || texture.missing) {
      warnings.push({
        code: 'TEXTURE_MISSING',
        texture: index,
        message: `texture ${index} "${texture.name}" is missing`,
      });
      return false;
    }
    const { width, height } = texture;
    if (width < 1 || height < 1 || width > limits.maxTextureSide || height > limits.maxTextureSide) {
      warnings.push({
        code: 'TEXTURE_TOO_LARGE',
        texture: index,
        message: `texture ${index} is ${width}x${height}; each side must be 1..${limits.maxTextureSide}`,
      });
      return false;
    }
    if (pixels + width * height > limits.maxTexturePixelsTotal) {
      warnings.push({
        code: 'TEXTURE_TOO_LARGE',
        texture: index,
        message: `texture ${index} would exceed the total of ${limits.maxTexturePixelsTotal} texture pixels`,
      });
      return false;
    }
    pixels += width * height;
    return true;
  });
  return { decode, warnings };
}

async function decodeOne(texture: SceneTexture): Promise<ImageBitmap> {
  // A copy into a plain ArrayBuffer: the scene's bytes may be a view into a larger or shared buffer.
  const blob = new Blob([new Uint8Array(texture.bytes ?? new Uint8Array(0))], { type: texture.mimeType });
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
}

/**
 * Decodes the admitted textures from their bytes (a Blob, never a URL, so nothing is fetched). A failed decode or an
 * image whose decoded size differs from its header becomes a placeholder with a warning. When `isCurrent()` turns
 * false the decoded images are closed and `null` is returned.
 */
export async function decodeTextures(
  textures: readonly SceneTexture[],
  limits: TextureLimits,
  isCurrent: () => boolean,
): Promise<DecodedTextures | null> {
  const plan = planTextureDecode(textures, limits);
  const warnings = [...plan.warnings];
  const results = await Promise.all(
    textures.map(async (texture, index): Promise<ImageBitmap | null> => {
      if (!plan.decode[index]) return null;
      try {
        const bitmap = await decodeOne(texture);
        if (bitmap.width !== texture.width || bitmap.height !== texture.height) {
          bitmap.close();
          warnings.push({
            code: 'TEXTURE_SIZE_MISMATCH',
            texture: index,
            message: `texture ${index} decodes to ${bitmap.width}x${bitmap.height}, its header says ${texture.width}x${texture.height}`,
          });
          return null;
        }
        return bitmap;
      } catch {
        warnings.push({
          code: 'TEXTURE_DECODE_FAILED',
          texture: index,
          message: `texture ${index} could not be decoded`,
        });
        return null;
      }
    }),
  );
  if (!isCurrent()) {
    for (const bitmap of results) bitmap?.close();
    return null;
  }
  warnings.sort((a, b) => a.texture - b.texture);
  return { bitmaps: results, warnings };
}
